/**
 * Conversation SQLite summarization, parent/subagent/Side-Q graph assembly,
 * target conversation selection, and multi-store account spend & activity heatmap.
 *
 * Quota budget estimation & decoration live in ./quota-budget.mjs and are re-exported
 * below for backwards compatibility.
 */
import { basename, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACTIVE_STEP_STATUSES,
  clipText,
  KNOWN_MODEL_ENUMS,
  localDayKey,
  parseIsoMs,
  SYNC_GRAPH_WARM_LIMIT,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from './constants.ts';
import type { AppDataRoot } from './constants.ts';
import { isCascadeStatusActive } from './ls-client.ts';
import { computeCallCost, resolveModelPricing } from './pricing.ts';
import { computeBaseReferenceUSD, resolveModelFamily } from './quota-solver.ts';
import {
  CACHE_EXPIRED_MISS_MIN_GAP_SEC,
  CACHE_HIT_RETENTION_THRESHOLD,
  CACHE_MIN_PREV_PROMPT_TOKENS,
} from './cache-ttl.ts';
import type { CacheGapSample } from './cache-ttl.ts';
import {
  iterFields,
  parseAnnotationPbtxt,
  parseGenRow,
  parseStepMetadata,
  parseUserPromptPayload,
} from './protobuf.ts';
import type { UsageSubmsg } from './protobuf.ts';
import { buildSwarmOverview, loadSwarmIndex } from './swarm.ts';
import type { SwarmMemberState } from './swarm.ts';

export {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  computeSummaryQuotaUsage,
  extractActivePoolWindows,
} from './quota-budget.ts';

const convSummaryCache = new Map();
const pendingBgSummaries = new Map();
let bgSummaryWarmScheduled = false;
let bgSummaryWarmSeq = 0;

export function getBgSummaryWarmSeq() {
  return bgSummaryWarmSeq;
}

export function cleanFallbackPromptTitle(raw: string, maxLen = 96): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, ' ')
    .replace(/<\/?[A-Z_]+>/g, ' ')
    .trim();
  if (!text) return '';
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;
    line = line
      .replace(/^#+\s+/, '')
      .replace(/^[-*•>]\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) return clipText(line, maxLen);
  }
  return '';
}

export function summarizeConversationDb(conv) {
  const anno = conv.annoPath ? parseAnnotationPbtxt(conv.annoPath) : { title: '', sideQuestionIds: [], sideQuestionTitles: {} };
  const parentIds = new Set();
  let trajectoryType = 0;
  let dbSourceCode = null;
  let subagentType = '';
  let fallbackTitle = '';
  let calls = 0;
  let outputTokens = 0;
  let newInput = 0;
  let cachedInput = 0;
  let costUSD = 0;
  let savedUSD = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let stepLatestTsMs = 0;
  let latestTsMs = 0;
  let hasActiveGenStep = false;
  let activeGenStepStartMs = 0;
  let resolvedSource = (conv.source && conv.source !== 'app') ? conv.source : 'app';
  const dayBuckets: Record<string, any> = Object.create(null);
  const familyUsage: Record<string, any> = Object.create(null);
  const recentCutoffMs = Date.now() - 30 * 86_400_000;
  const recentCalls: any[] = [];
  const cachePairs: CacheGapSample[] = [];

  let db;
  try {
    db = new DatabaseSync(conv.dbPath, { readOnly: true });
    try {
      let tm;
      try {
        tm = db.prepare('SELECT trajectory_type, source FROM trajectory_meta LIMIT 1').get();
      } catch {
        tm = db.prepare('SELECT trajectory_type FROM trajectory_meta LIMIT 1').get();
      }
      if (tm && Number.isFinite(tm.trajectory_type)) trajectoryType = tm.trajectory_type;
      if (tm && Number.isFinite(tm.source)) dbSourceCode = tm.source;
    } catch { /* table missing */ }

    if (resolvedSource === 'app' && dbSourceCode === 17) {
      resolvedSource = 'cli';
    }

    try {
      const prRows = db.prepare('SELECT data FROM parent_references').all();
      for (const pr of prRows) {
        for (const [fn, wt, val] of iterFields(pr.data)) {
          if (fn === 6 && wt === 2) {
            const pid = Buffer.from(val).toString('utf8');
            if (UUID_RE.test(pid) && pid !== conv.id) parentIds.add(pid);
          }
        }
      }
    } catch { /* table missing */ }

    const stepTimeByGmIdx = new Map<number, number>();
    const stepTimeByBotId = new Map<string, number>();
    const stepTimeByIdx = new Map<number, number>();
    const stepStartByGmIdx = new Map<number, number>();
    const stepStartByBotId = new Map<string, number>();
    const stepStartByIdx = new Map<number, number>();
    const firstToolCreatedByGmIdx = new Map<number, number>();
    const compactionMetas: { ts: number; usage: UsageSubmsg }[] = [];
    const compactionSpans: { stepIdx: number; gmIdx: number | null; ts: number }[] = [];
    try {
      const firstPromptRow: any = db.prepare('SELECT step_payload FROM steps WHERE step_type = 14 AND step_payload IS NOT NULL ORDER BY idx ASC LIMIT 1').get();
      if (firstPromptRow?.step_payload) {
        const prompt = parseUserPromptPayload(firstPromptRow.step_payload);
        const rawPrompt = prompt?.full || prompt?.preview || '';
        if (rawPrompt) fallbackTitle = cleanFallbackPromptTitle(rawPrompt) || prompt.preview;
      }
      const stRows: any[] = db.prepare('SELECT idx, step_type, status, metadata FROM steps WHERE step_type IN (14, 15, 23, 132) AND metadata IS NOT NULL ORDER BY idx ASC').all();
      let lastPlannerGmIdx: number | null = null;
      for (const s of stRows) {
        const meta = parseStepMetadata(s.metadata);
        if (s.step_type === 132) {
          const gm = meta.gmIdx !== null ? meta.gmIdx : lastPlannerGmIdx;
          if (gm !== null && meta.createdAtMs > 0) {
            const prev = firstToolCreatedByGmIdx.get(gm) || 0;
            if (!prev || meta.createdAtMs < prev) firstToolCreatedByGmIdx.set(gm, meta.createdAtMs);
          }
          continue;
        }
        if (s.step_type === 15 && meta.gmIdx !== null) {
          lastPlannerGmIdx = meta.gmIdx;
        }
        const startTs = meta.startedAtMs || meta.createdAtMs || 0;
        const ts = meta.completedAtMs || meta.endAtMs || meta.createdAtMs || 0;
        if (startTs > 0) {
          stepStartByIdx.set(s.idx, startTs);
          if (meta.gmIdx !== null) stepStartByGmIdx.set(meta.gmIdx, startTs);
          if (meta.botId) stepStartByBotId.set(meta.botId, startTs);
        }
        if (ts > 0) {
          if (ts > stepLatestTsMs) stepLatestTsMs = ts;
          stepTimeByIdx.set(s.idx, ts);
          if (meta.gmIdx !== null) stepTimeByGmIdx.set(meta.gmIdx, ts);
          if (meta.botId) stepTimeByBotId.set(meta.botId, ts);
        }
        if (s.step_type === 23) {
          compactionSpans.push({ stepIdx: s.idx, gmIdx: meta.gmIdx, ts });
          const isDone = TERMINAL_STEP_STATUSES.has(s.status) || meta.endAtMs > 0 || meta.completedAtMs > 0;
          if (isDone && meta.usage) {
            compactionMetas.push({ ts, usage: meta.usage });
          }
        }
      }
      // Inspect tail steps to see if an LLM generation / compaction step is currently in-flight.
      for (let i = stRows.length - 1; i >= 0; i--) {
        const s = stRows[i];
        if (s.step_type !== 15 && s.step_type !== 23) continue;
        const meta = parseStepMetadata(s.metadata);
        const isDone = TERMINAL_STEP_STATUSES.has(s.status) || meta.endAtMs > 0 || meta.completedAtMs > 0;
        if (!isDone && (ACTIVE_STEP_STATUSES.has(s.status) || s.status > 0)) {
          hasActiveGenStep = true;
          activeGenStepStartMs = meta.startedAtMs || meta.createdAtMs || conv.updatedMs || 0;
        }
        break;
      }
    } catch { /* table missing */ }

    latestTsMs = stepLatestTsMs;

    const recordSpend = ({ modelId, modelDisplay, model, newIn, cachedIn, outTok, ts, genUncertainStartTs = ts, countStats, ttftSec = 0, genTps = 0 }) => {
      const cost = computeCallCost(modelId, modelDisplay, model, newIn, cachedIn, outTok, ts);
      if (countStats) {
        calls += 1;
        outputTokens += outTok;
        newInput += newIn;
        cachedInput += cachedIn;
      }
      if (cost.priced) {
        pricedCount += 1;
        costUSD += cost.costUSD;
        savedUSD += cost.cacheSavedUSD;
      } else {
        unpricedCount += 1;
      }
      const ref = computeBaseReferenceUSD(modelId, modelDisplay, model, newIn, cachedIn, outTok);
      if (ref.baseUSD > 0 && ref.poolKey !== 'other') {
        if (!familyUsage[ref.family]) {
          familyUsage[ref.family] = { poolKey: ref.poolKey, baseUSD: 0, inM: 0, caM: 0, outM: 0, calls: 0 };
        }
        const fu = familyUsage[ref.family];
        fu.baseUSD += ref.baseUSD;
        fu.inM += (newIn || 0) / 1e6;
        fu.caM += (cachedIn || 0) / 1e6;
        fu.outM += (outTok || 0) / 1e6;
        fu.calls += 1;
      }
      if (ts >= recentCutoffMs) {
        recentCalls.push({
          ts,
          genUncertainStartTs,
          source: resolvedSource,
          poolKey: ref.poolKey,
          family: ref.family,
          newInput: newIn,
          cachedInput: cachedIn,
          outputTokens: outTok,
          baseUSD: ref.baseUSD,
          costUSD: cost.costUSD,
          priced: cost.priced,
          ...(ttftSec > 0 ? { ttftSec } : {}),
          ...(genTps > 0 ? { genTps } : {}),
        });
      }
      const dk = localDayKey(ts);
      if (dk) {
        if (!dayBuckets[dk]) {
          dayBuckets[dk] = {
            calls: 0,
            outputTokens: 0,
            newTokens: 0,
            cachedTokens: 0,
            costUSD: 0,
            savedUSD: 0,
            pricedCount: 0,
            unpricedCount: 0,
          };
        }
        const b = dayBuckets[dk];
        if (countStats) {
          b.calls += 1;
          b.outputTokens += outTok;
        }
        b.newTokens += Math.max(0, newIn || 0) + Math.max(0, outTok || 0);
        b.cachedTokens += Math.max(0, cachedIn || 0);
        if (cost.priced) {
          b.pricedCount += 1;
          b.costUSD += cost.costUSD;
          b.savedUSD += cost.cacheSavedUSD;
        } else {
          b.unpricedCount += 1;
        }
      }
    };

    const localEnumMap = new Map();
    const resolveEnumInfo = (enumId) => (
      enumId !== null
        ? (localEnumMap.get(enumId) || KNOWN_MODEL_ENUMS.get(enumId) || null)
        : null
    );

    try {
      const gmRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      let prevCacheInv: {
        idx: number;
        stepIdx: number | null;
        botId: string;
        family: string;
        totalPrompt: number;
        completedTs: number;
      } | null = null;
      for (const row of gmRows) {
        const parsed = parseGenRow(row.idx, row.data);
        if (!parsed) continue;
        if (parsed.parentCascadeId && parsed.parentCascadeId !== conv.id) {
          parentIds.add(parsed.parentCascadeId);
        }
        if (parsed.subagentType && !subagentType) subagentType = parsed.subagentType;

        if (parsed.modelEnum !== null) {
          const fb = resolveEnumInfo(parsed.modelEnum);
          if (fb) {
            if (!parsed.modelId && fb.modelId) parsed.modelId = fb.modelId;
            if (!parsed.modelDisplay && fb.modelDisplay) parsed.modelDisplay = fb.modelDisplay;
            if ((!parsed.model || parsed.model === 'Unknown Model') && fb.model) parsed.model = fb.model;
          }
          if (parsed.modelId || parsed.modelDisplay || (parsed.model && parsed.model !== 'Unknown Model')) {
            const prev = localEnumMap.get(parsed.modelEnum);
            localEnumMap.set(parsed.modelEnum, {
              model: (parsed.model && parsed.model !== 'Unknown Model' ? parsed.model : prev?.model) || '',
              modelId: parsed.modelId || prev?.modelId || '',
              modelDisplay: parsed.modelDisplay || prev?.modelDisplay || '',
            });
          }
        }

        const stepIdx = parsed.lastStepIndex !== null ? parsed.lastStepIndex + 1 : null;
        const stepStartTs = stepStartByGmIdx.get(row.idx)
          || (parsed.botId ? stepStartByBotId.get(parsed.botId) : 0)
          || (stepIdx !== null ? stepStartByIdx.get(stepIdx) : 0)
          || 0;
        const stepTs = stepTimeByGmIdx.get(row.idx)
          || (parsed.botId ? stepTimeByBotId.get(parsed.botId) : 0)
          || (stepIdx !== null ? stepTimeByIdx.get(stepIdx) : 0)
          || 0;
        if (stepTs > stepLatestTsMs) stepLatestTsMs = stepTs;
        const completedTs = stepTs || conv.dbMtimeMs || conv.updatedMs || 0;
        if (completedTs > latestTsMs) latestTsMs = completedTs;
        const firstToolMs = firstToolCreatedByGmIdx.get(row.idx) || 0;
        let genUncertainStartTs = completedTs;
        if (firstToolMs > 0 && firstToolMs < genUncertainStartTs) genUncertainStartTs = firstToolMs;
        if (stepStartTs > 0 && stepStartTs < genUncertainStartTs) genUncertainStartTs = stepStartTs;

        const currFamily = resolveModelFamily(parsed.modelId, parsed.modelDisplay, parsed.model);
        const currTotalPrompt = parsed.totalPromptTokens || (parsed.cachedInput + parsed.newInput);
        if (
          prevCacheInv
          && prevCacheInv.completedTs > 0
          && stepStartTs > 0
          && currFamily !== 'unknown'
          && prevCacheInv.family === currFamily
          && prevCacheInv.totalPrompt >= CACHE_MIN_PREV_PROMPT_TOKENS
          && currTotalPrompt >= prevCacheInv.totalPrompt * 0.9
        ) {
          const compactedBetween = compactionSpans.some((cp) => (
            (cp.gmIdx !== null && cp.gmIdx > prevCacheInv!.idx && cp.gmIdx <= row.idx)
            || (prevCacheInv!.stepIdx !== null && stepIdx !== null && cp.stepIdx > prevCacheInv!.stepIdx && cp.stepIdx < stepIdx)
            || (cp.ts > prevCacheInv!.completedTs && cp.ts < stepStartTs)
          ));
          const rawGapSec = (stepStartTs - prevCacheInv.completedTs) / 1000;
          if (!compactedBetween && rawGapSec >= -5) {
            const idleGapSec = Math.max(0, rawGapSec);
            const retention = parsed.cachedInput / prevCacheInv.totalPrompt;
            const hit = retention >= CACHE_HIT_RETENTION_THRESHOLD;
            let missCostUSD = 0;
            if (!hit && idleGapSec >= CACHE_EXPIRED_MISS_MIN_GAP_SEC) {
              const rates = resolveModelPricing(parsed.modelId, parsed.modelDisplay, parsed.model, completedTs);
              if (rates) {
                const uncachedPrefix = Math.max(0, prevCacheInv.totalPrompt - parsed.cachedInput);
                missCostUSD = (uncachedPrefix * Math.max(0, rates.input - rates.cached)) / 1e6;
              }
            }
            const pairKey = (prevCacheInv.botId && parsed.botId)
              ? `${prevCacheInv.botId}->${parsed.botId}`
              : `${currFamily}:${prevCacheInv.completedTs}:${stepStartTs}:${currTotalPrompt}`;
            cachePairs.push({
              key: pairKey,
              family: currFamily,
              idleGapSec: Number(idleGapSec.toFixed(1)),
              prevPromptTokens: prevCacheInv.totalPrompt,
              cachedInput: parsed.cachedInput,
              retention: Number(retention.toFixed(4)),
              hit,
              missCostUSD: Number(missCostUSD.toFixed(5)),
              ts: stepStartTs,
            });
          }
        }
        prevCacheInv = {
          idx: row.idx,
          stepIdx,
          botId: parsed.botId || '',
          family: currFamily,
          totalPrompt: currTotalPrompt,
          completedTs: stepTs || stepStartTs || 0,
        };

        recordSpend({
          modelId: parsed.modelId,
          modelDisplay: parsed.modelDisplay,
          model: parsed.model,
          newIn: parsed.newInput,
          cachedIn: parsed.cachedInput,
          outTok: parsed.outputTokens,
          ts: completedTs,
          genUncertainStartTs,
          countStats: true,
          ttftSec: parsed.ttftSec || 0,
          genTps: parsed.isBuffered ? 0 : (parsed.genTps || 0),
        });
      }
    } catch { /* table missing */ }

    for (const cm of compactionMetas) {
      const u = cm.usage;
      const resolved = resolveEnumInfo(u.modelEnum);
      const outTok = u.outputTokens || (u.thinkingTokens + u.candidateTokens);
      const ts = cm.ts || conv.dbMtimeMs || conv.updatedMs || 0;
      if (ts > latestTsMs) latestTsMs = ts;
      recordSpend({
        modelId: resolved?.modelId || '',
        modelDisplay: resolved?.modelDisplay || '',
        model: resolved?.model || '',
        newIn: u.newInput,
        cachedIn: u.cachedInput,
        outTok,
        ts,
        countStats: false,
      });
    }
  } catch {
    /* db unreadable */
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }

  return {
    id: conv.id,
    source: resolvedSource,
    key: `${conv.key}|${conv.annoKey}`,
    updatedMs: conv.updatedMs,
    stepLatestTsMs,
    latestTsMs: latestTsMs || conv.updatedMs,
    hasActiveGenStep,
    activeGenStepStartMs,
    title: anno.title || fallbackTitle || '',
    annoTitle: anno.title || '',
    sideQuestionIds: anno.sideQuestionIds,
    sideQuestionTitles: anno.sideQuestionTitles,
    trajectoryType,
    parentIds: [...parentIds],
    subagentType,
    calls,
    outputTokens,
    newInput,
    cachedInput,
    costUSD,
    savedUSD,
    pricedCount,
    unpricedCount,
    dayBuckets,
    familyUsage,
    recentCalls,
    cachePairs,
  };
}

function scheduleBgSummaryWarm() {
  if (bgSummaryWarmScheduled || pendingBgSummaries.size === 0) return;
  bgSummaryWarmScheduled = true;
  const step = setImmediate(() => {
    bgSummaryWarmScheduled = false;
    let processed = 0;
    for (const [id, conv] of pendingBgSummaries) {
      pendingBgSummaries.delete(id);
      const cacheKey = `${conv.key}|${conv.annoKey}`;
      const existing = convSummaryCache.get(id);
      if (!existing || existing.key !== cacheKey) {
        convSummaryCache.set(id, summarizeConversationDb(conv));
        bgSummaryWarmSeq += 1;
      }
      processed += 1;
      if (processed >= 8) break;
    }
    if (pendingBgSummaries.size > 0) {
      scheduleBgSummaryWarm();
    }
  });
  step.unref?.();
}

export function getConversationGraph(
  conversations: any[],
  optsOrRequiredId: string | {
    requiredConvId?: string;
    syncAll?: boolean;
    appDataRoots?: (string | AppDataRoot)[];
  } = '',
  syncAllArg = false,
) {
  const requiredConvId = typeof optsOrRequiredId === 'object' && optsOrRequiredId !== null
    ? String(optsOrRequiredId.requiredConvId || '')
    : String(optsOrRequiredId || '');
  const syncAll = typeof optsOrRequiredId === 'object' && optsOrRequiredId !== null
    ? Boolean(optsOrRequiredId.syncAll)
    : Boolean(syncAllArg);
  const explicitAppDataRoots = typeof optsOrRequiredId === 'object' && optsOrRequiredId !== null && Array.isArray(optsOrRequiredId.appDataRoots)
    ? optsOrRequiredId.appDataRoots
    : [];
  const summaries: any[] = [];
  const byId = new Map<string, any>();
  const convById = new Map<string, any>(conversations.map((c) => [c.id, c]));

  const ensureSynced = (conv) => {
    const cacheKey = `${conv.key}|${conv.annoKey}`;
    let sum = convSummaryCache.get(conv.id);
    if (!sum || sum.key !== cacheKey) {
      sum = summarizeConversationDb(conv);
      convSummaryCache.set(conv.id, sum);
      pendingBgSummaries.delete(conv.id);
    }
    return sum;
  };

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const cacheKey = `${conv.key}|${conv.annoKey}`;
    const cached = convSummaryCache.get(conv.id);
    if (cached && cached.key === cacheKey) {
      summaries.push(cached);
      byId.set(conv.id, cached);
      continue;
    }
    if (syncAll || i < SYNC_GRAPH_WARM_LIMIT || conv.id === requiredConvId) {
      const sum = ensureSynced(conv);
      summaries.push(sum);
      byId.set(conv.id, sum);
    } else {
      pendingBgSummaries.set(conv.id, conv);
      if (cached) {
        summaries.push(cached);
        byId.set(conv.id, cached);
      }
    }
  }

  for (const s of [...summaries]) {
    for (const relId of [...(s.parentIds || []), ...(s.sideQuestionIds || [])]) {
      if (!byId.has(relId) && convById.has(relId)) {
        const relSum = ensureSynced(convById.get(relId));
        summaries.push(relSum);
        byId.set(relId, relSum);
      }
    }
  }

  // Discover native AGY Swarms across explicit roots + conversation appDataDirs
  const swarmRootDirs: (string | AppDataRoot)[] = [...explicitAppDataRoots];
  for (const conv of conversations) {
    if (conv?.appDataDir) {
      swarmRootDirs.push(conv.appDataDir);
    } else if (typeof conv?.dbPath === 'string' && conv.dbPath) {
      const parentDir = dirname(conv.dbPath);
      if (basename(parentDir) === 'conversations') {
        swarmRootDirs.push(dirname(parentDir));
      }
    }
  }
  const swarmIndex = loadSwarmIndex(swarmRootDirs, conversations.map((c) => c.id));

  // Ensure swarm coordinator & worker DBs are synced for any discovered swarm tied to requiredConvId or loaded summaries
  const ensureSwarmRelatedSynced = (coordId: string) => {
    const swarm = swarmIndex.swarmsByCoordinator.get(coordId);
    if (!swarm) return;
    if (!byId.has(coordId) && convById.has(coordId)) {
      const coordSum = ensureSynced(convById.get(coordId));
      summaries.push(coordSum);
      byId.set(coordId, coordSum);
    }
    for (const member of swarm.members.values()) {
      const mid = member.conversationId;
      if (mid && !byId.has(mid) && convById.has(mid)) {
        const mSum = ensureSynced(convById.get(mid));
        summaries.push(mSum);
        byId.set(mid, mSum);
      }
    }
  };
  if (requiredConvId) {
    if (swarmIndex.swarmsByCoordinator.has(requiredConvId)) {
      ensureSwarmRelatedSynced(requiredConvId);
    } else {
      const wLookup = swarmIndex.memberLookup.get(requiredConvId);
      if (wLookup) ensureSwarmRelatedSynced(wLookup.coordinatorConvId);
    }
  }
  for (const s of [...summaries]) {
    if (swarmIndex.swarmsByCoordinator.has(s.id)) {
      ensureSwarmRelatedSynced(s.id);
    } else {
      const wLookup = swarmIndex.memberLookup.get(s.id);
      if (wLookup) ensureSwarmRelatedSynced(wLookup.coordinatorConvId);
    }
  }

  if (pendingBgSummaries.size > 0) {
    scheduleBgSummaryWarm();
  }

  const parentLinks = new Map();
  const childrenByParent = new Map();
  const sqTitleOverrides = new Map();

  for (const s of summaries) {
    for (const sqId of s.sideQuestionIds || []) {
      if (!byId.has(sqId) || sqId === s.id) continue;
      if (!parentLinks.has(sqId)) parentLinks.set(sqId, { parentId: s.id, kind: 'side_question' });
      if (s.sideQuestionTitles?.[sqId]) sqTitleOverrides.set(sqId, s.sideQuestionTitles[sqId]);
    }
  }

  for (const s of summaries) {
    if (!parentLinks.has(s.id) && s.parentIds.length) {
      const validParent = s.parentIds.find((pid) => byId.has(pid) && pid !== s.id);
      if (validParent) {
        parentLinks.set(s.id, {
          parentId: validParent,
          kind: s.trajectoryType === 22 ? 'side_question' : 'subagent',
        });
      }
    }
  }

  // Swarm reverse-lookup: link every swarm worker to its coordinator even if SQLite parent_references is missing
  for (const [workerConvId, lookup] of swarmIndex.memberLookup) {
    if (!parentLinks.has(workerConvId) && workerConvId !== lookup.coordinatorConvId) {
      parentLinks.set(workerConvId, {
        parentId: lookup.coordinatorConvId,
        kind: 'subagent',
      });
    }
  }

  for (const s of summaries) {
    const link = parentLinks.get(s.id);
    if (!link) continue;
    const swarmLookup = swarmIndex.memberLookup.get(s.id);
    if (!childrenByParent.has(link.parentId)) childrenByParent.set(link.parentId, []);
    childrenByParent.get(link.parentId).push({
      id: s.id,
      kind: link.kind,
      subagentType: s.subagentType || (swarmLookup ? 'worker' : ''),
      title: sqTitleOverrides.get(s.id) || s.title || swarmLookup?.member.meta.taskTitle || '',
      calls: s.calls,
      outputTokens: s.outputTokens,
      costUSD: s.costUSD,
      savedUSD: s.savedUSD,
      pricedCount: s.pricedCount,
      unpricedCount: s.unpricedCount,
      updatedMs: s.updatedMs,
      latestTsMs: s.latestTsMs,
      key: s.key,
      ...(swarmLookup ? { swarm: swarmLookup.member.meta } : {}),
    });
  }

  // Ensure every swarm worker in members.json appears under its coordinator (including newly spawned 0-call workers)
  for (const swarm of swarmIndex.swarmsByCoordinator.values()) {
    if (!childrenByParent.has(swarm.coordinatorConvId)) {
      childrenByParent.set(swarm.coordinatorConvId, []);
    }
    const list = childrenByParent.get(swarm.coordinatorConvId);
    const existingIds = new Set(list.map((c) => c.id));
    for (const member of swarm.members.values()) {
      if (member.role === 'coordinator' || member.conversationId === swarm.coordinatorConvId) continue;
      const memberId = member.conversationId || `swarm:${swarm.swarmId}:${member.rosterName}`;
      if (existingIds.has(memberId)) continue;
      const sum = member.conversationId ? byId.get(member.conversationId) : null;
      const fallbackMs = parseIsoMs(member.meta.lastPostTime) || parseIsoMs(swarm.createdAt) || 0;
      list.push({
        id: memberId,
        kind: 'subagent',
        subagentType: sum?.subagentType || 'worker',
        title: (sum && (sqTitleOverrides.get(sum.id) || sum.title)) || member.meta.taskTitle || `@${member.rosterName}`,
        calls: sum?.calls || 0,
        outputTokens: sum?.outputTokens || 0,
        costUSD: sum?.costUSD || 0,
        savedUSD: sum?.savedUSD || 0,
        pricedCount: sum?.pricedCount || 0,
        unpricedCount: sum?.unpricedCount || 0,
        updatedMs: sum?.updatedMs || fallbackMs,
        latestTsMs: sum?.latestTsMs || fallbackMs,
        key: sum?.key || `swarm:${member.rosterName}:${member.state}`,
        swarm: member.meta,
      });
      existingIds.add(memberId);
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (b.updatedMs - a.updatedMs) || String(a.swarm?.rosterName || a.id).localeCompare(String(b.swarm?.rosterName || b.id)));
  }

  const sourceCounts = { app: 0, cli: 0, ide: 0 };
  const nowForFlight = Date.now();
  let inFlightCount = 0;
  for (const conv of conversations) {
    const sum = byId.get(conv.id);
    const rawSrc = sum?.source || conv.source;
    const src = rawSrc === 'cli' || rawSrc === 'ide' ? rawSrc : 'app';
    sourceCounts[src] += 1;
    if (sum?.hasActiveGenStep && sum.activeGenStepStartMs > 0 && nowForFlight - sum.activeGenStepStartMs < 600_000) {
      inFlightCount += 1;
    }
  }

  return {
    summaries,
    byId,
    parentLinks,
    childrenByParent,
    sqTitleOverrides,
    sourceCounts,
    swarmIndex,
    inFlightCount,
    indexing: pendingBgSummaries.size > 0,
    totalDbFiles: conversations.length,
  };
}

export function conversationEffectiveMs(conv, graph, lsSummaries, nowMs = Date.now()) {
  const sum = graph?.byId?.get(conv.id);
  const lsSum = lsSummaries?.[conv.id];
  const stepMs = sum?.stepLatestTsMs || 0;
  const lsMs = parseIsoMs(lsSum?.lastModifiedTime) || parseIsoMs(lsSum?.createdTime) || 0;
  if (stepMs > 0 || lsMs > 0) {
    return Math.max(stepMs, lsMs);
  }
  const isActive = isCascadeStatusActive(lsSum?.status);
  if (isActive || (sum && sum.calls === 0 && nowMs - conv.updatedMs < 120_000)) {
    return conv.updatedMs;
  }
  return conv.dbMtimeMs || conv.updatedMs || 0;
}

export function pickTargetConversation({
  mode = 'auto',
  explicitConvId = '',
  conversations = [],
  graph = null,
  lsSummaries = null,
  prevAutoTargetId = '',
  nowMs = Date.now(),
}: {
  mode?: string;
  explicitConvId?: string;
  conversations?: any[];
  graph?: any;
  lsSummaries?: Record<string, any> | null;
  prevAutoTargetId?: string;
  nowMs?: number;
}) {
  if (!conversations.length) return null;

  if (mode === 'auto' && explicitConvId) {
    const matched = conversations.find((c) => c.id === explicitConvId);
    if (matched) return matched;
  }

  const metas = conversations.map((c) => {
    const sum = graph?.byId?.get(c.id);
    const link = graph?.parentLinks?.get(c.id);
    const kind = link ? link.kind : (sum?.trajectoryType === 22 ? 'side_question' : 'main');
    const lsSum = lsSummaries?.[c.id];
    const isActive = isCascadeStatusActive(lsSum?.status);
    const effectiveMs = conversationEffectiveMs(c, graph, lsSummaries, nowMs);
    return { conv: c, kind, isActive, effectiveMs };
  });

  const nonSubagent = metas.filter((m) => m.kind !== 'subagent');
  const basePool = nonSubagent.length ? nonSubagent : metas;

  const mainPool = basePool.filter((m) => m.kind === 'main');
  const activeSq = basePool.filter((m) => m.kind === 'side_question' && m.isActive);
  const anyMainActive = mainPool.some((m) => m.isActive);

  let pool = mainPool.length ? mainPool : basePool;
  if (activeSq.length && !anyMainActive) {
    pool = [...activeSq, ...pool];
  }

  const activePool = pool.filter((m) => m.isActive);
  if (activePool.length) {
    if (prevAutoTargetId) {
      const sticky = activePool.find((m) => m.conv.id === prevAutoTargetId);
      if (sticky) return sticky.conv;
    }
    activePool.sort((a, b) => (b.effectiveMs - a.effectiveMs) || (b.conv.updatedMs - a.conv.updatedMs));
    return activePool[0].conv;
  }

  pool.sort((a, b) => {
    if (b.effectiveMs !== a.effectiveMs) return b.effectiveMs - a.effectiveMs;
    if (prevAutoTargetId) {
      if (a.conv.id === prevAutoTargetId) return -1;
      if (b.conv.id === prevAutoTargetId) return 1;
    }
    return b.conv.updatedMs - a.conv.updatedMs;
  });
  return pool[0].conv;
}

export function getConversationSwarmMeta(
  convId: string,
  graph: any,
): { swarmRosterName: string; swarmState: SwarmMemberState } | null {
  const swarmIndex = graph?.swarmIndex;
  if (!swarmIndex || !convId) return null;
  const workerHit = swarmIndex.memberLookup?.get(convId);
  if (workerHit) {
    return {
      swarmRosterName: workerHit.rosterName,
      swarmState: workerHit.member.state,
    };
  }
  const coordSwarm = swarmIndex.swarmsByCoordinator?.get(convId);
  if (coordSwarm) {
    const coordMember = coordSwarm.members.get('coordinator') || coordSwarm.memberByConvId.get(convId);
    return {
      swarmRosterName: 'coordinator',
      swarmState: coordMember?.state || (coordSwarm.workingCount > 0 ? 'working' : 'waiting'),
    };
  }
  return null;
}

export function buildSessionInfo(targetId, graph) {
  const s = graph.byId.get(targetId);
  const link = graph.parentLinks.get(targetId);
  const swarmIndex = graph.swarmIndex;
  const coordSwarm = swarmIndex?.swarmsByCoordinator?.get(targetId) || null;
  const workerLookup = !coordSwarm ? (swarmIndex?.memberLookup?.get(targetId) || null) : null;

  const effectiveParentId = link?.parentId || workerLookup?.coordinatorConvId || '';
  const parentSum = effectiveParentId ? graph.byId.get(effectiveParentId) : null;
  const kind = link
    ? link.kind
    : (workerLookup ? 'subagent' : (s?.trajectoryType === 22 ? 'side_question' : 'main'));
  const title = graph.sqTitleOverrides.get(targetId)
    || s?.title
    || (coordSwarm?.swarmTitle || workerLookup?.member.meta.taskTitle || '');
  const rawChildren = graph.childrenByParent.get(targetId) || [];
  const childSessions = rawChildren.map(({ key: _key, ...rest }) => rest);

  const swarmOverview = coordSwarm
    ? buildSwarmOverview(coordSwarm, true)
    : (workerLookup ? buildSwarmOverview(workerLookup.swarm, false, workerLookup.member.meta) : null);
  const swarmSig = (coordSwarm || workerLookup?.swarm)?.sig || '';

  const parentSession = parentSum
    ? {
        id: parentSum.id,
        title: graph.sqTitleOverrides.get(parentSum.id) || parentSum.title || workerLookup?.swarm.swarmTitle || '',
        calls: parentSum.calls,
        outputTokens: parentSum.outputTokens,
        costUSD: parentSum.costUSD,
      }
    : (workerLookup
        ? {
            id: workerLookup.coordinatorConvId,
            title: workerLookup.swarm.swarmTitle || '',
            calls: 0,
            outputTokens: 0,
            costUSD: 0,
          }
        : null);

  return {
    id: targetId,
    title,
    kind,
    subagentType: s?.subagentType || (workerLookup ? 'worker' : ''),
    parentSession,
    childSessions,
    ...(swarmOverview ? { swarm: swarmOverview } : {}),
    childKeys: rawChildren.map((c) => `${c.id}:${c.key}`).join(','),
    swarmSig,
  };
}

const HEATMAP_WEEKS = 16;
const HEATMAP_WEEKS_52 = 52;

export interface DailyHeatmapDay {
  date: string;
  calls: number;
  appCalls: number;
  cliCalls: number;
  costUSD: number;
  outputTokens: number;
  newTokens: number;
  cachedTokens: number;
}

export function buildAccountHistory(graph, nowMs = Date.now()) {
  const todayKey = localDayKey(nowMs);
  const monthPrefix = todayKey.slice(0, 7);
  let totalCalls = 0;
  let totalOutput = 0;
  let totalCostUSD = 0;
  let totalSavedUSD = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let todayCalls = 0;
  let todayCostUSD = 0;
  let todaySavedUSD = 0;
  let monthCalls = 0;
  let monthCostUSD = 0;
  let monthSavedUSD = 0;
  const callsBySource = { app: 0, cli: 0, ide: 0 };
  const costBySource = { app: 0, cli: 0, ide: 0 };
  const indexedBySource = { app: 0, cli: 0, ide: 0 };
  const dailyMap = Object.create(null);

  for (const s of graph.summaries) {
    const src = s.source === 'cli' || s.source === 'ide' ? s.source : 'app';
    indexedBySource[src] += 1;
    callsBySource[src] += s.calls;
    costBySource[src] += s.costUSD;
    totalCalls += s.calls;
    totalOutput += s.outputTokens;
    totalCostUSD += s.costUSD;
    totalSavedUSD += s.savedUSD;
    pricedCount += s.pricedCount;
    unpricedCount += s.unpricedCount;
    for (const [dk, b] of Object.entries(s.dayBuckets || {}) as [string, any][]) {
      if (dk === todayKey) {
        todayCalls += b.calls;
        todayCostUSD += b.costUSD;
        todaySavedUSD += b.savedUSD;
      }
      if (dk.startsWith(monthPrefix)) {
        monthCalls += b.calls;
        monthCostUSD += b.costUSD;
        monthSavedUSD += b.savedUSD;
      }
      if (!dailyMap[dk]) {
        dailyMap[dk] = {
          calls: 0,
          appCalls: 0,
          cliCalls: 0,
          costUSD: 0,
          outputTokens: 0,
          newTokens: 0,
          cachedTokens: 0,
        };
      }
      const dm = dailyMap[dk];
      dm.calls += b.calls || 0;
      if (src === 'cli') dm.cliCalls += b.calls || 0;
      else dm.appCalls += b.calls || 0;
      dm.costUSD += b.costUSD || 0;
      dm.outputTokens += b.outputTokens || 0;
      dm.newTokens += b.newTokens || 0;
      dm.cachedTokens += b.cachedTokens || 0;
    }
  }

  const [ty, tm, td] = todayKey.split('-').map(Number);
  const todayNoon = new Date(ty, tm - 1, td, 12, 0, 0);
  const dowMon0 = (todayNoon.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  const totalGridDays16 = (HEATMAP_WEEKS - 1) * 7 + dowMon0 + 1;
  const totalGridDays52 = (HEATMAP_WEEKS_52 - 1) * 7 + dowMon0 + 1;
  const startNoon52 = new Date(ty, tm - 1, td - (totalGridDays52 - 1), 12, 0, 0);
  const heatmapDays52: DailyHeatmapDay[] = [];
  let activeDays52 = 0;
  let peakCostUSD52 = 0;
  let peakDate52 = '';

  for (let i = 0; i < totalGridDays52; i++) {
    const d = new Date(startNoon52.getFullYear(), startNoon52.getMonth(), startNoon52.getDate() + i, 12, 0, 0);
    const dk = localDayKey(d.getTime());
    const entry = dailyMap[dk];
    const calls = entry?.calls || 0;
    const costUSD = entry?.costUSD || 0;
    if (calls > 0 || costUSD > 0) activeDays52 += 1;
    if (costUSD > peakCostUSD52) {
      peakCostUSD52 = costUSD;
      peakDate52 = dk;
    }
    heatmapDays52.push({
      date: dk,
      calls,
      appCalls: entry?.appCalls || 0,
      cliCalls: entry?.cliCalls || 0,
      costUSD,
      outputTokens: entry?.outputTokens || 0,
      newTokens: entry?.newTokens || 0,
      cachedTokens: entry?.cachedTokens || 0,
    });
  }

  const heatmapDays = heatmapDays52.slice(heatmapDays52.length - totalGridDays16);
  let activeDays = 0;
  let peakCostUSD = 0;
  let peakDate = '';
  for (const hd of heatmapDays) {
    if (hd.calls > 0 || hd.costUSD > 0) activeDays += 1;
    if (hd.costUSD > peakCostUSD) {
      peakCostUSD = hd.costUSD;
      peakDate = hd.date;
    }
  }

  let streakDays = 0;
  for (let i = heatmapDays52.length - 1; i >= 0; i--) {
    const hd = heatmapDays52[i];
    if (hd.calls > 0 || hd.costUSD > 0) {
      streakDays += 1;
    } else if (i === heatmapDays52.length - 1) {
      continue;
    } else {
      break;
    }
  }

  return {
    dbCount: graph.totalDbFiles || graph.summaries.length,
    dbCountBySource: graph.sourceCounts || indexedBySource,
    indexedCount: graph.summaries.length,
    indexing: Boolean(graph.indexing),
    callsBySource,
    costBySource,
    totalCalls,
    totalOutput,
    totalCostUSD,
    totalSavedUSD,
    pricedCount,
    unpricedCount,
    todayCalls,
    todayCostUSD,
    todaySavedUSD,
    monthCalls,
    monthCostUSD,
    monthSavedUSD,
    dailyHeatmap: {
      weeks: HEATMAP_WEEKS,
      weeks52: HEATMAP_WEEKS_52,
      activeDays,
      activeDays52,
      streakDays,
      peakCostUSD,
      peakDate,
      peakCostUSD52,
      peakDate52,
      days: heatmapDays,
      days52: heatmapDays52,
    },
  };
}

