import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACTIVE_STEP_STATUSES,
  inferAppDataSource,
  KNOWN_MODEL_ENUMS,
  mergeIntervalDurationSec,
  statSafe,
  STEP_STATUS_NAMES,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from './constants.ts';
import { getLsModelCatalogVersion } from './ls-client.ts';
import { computeCallCost, resolveModelPricing } from './pricing.ts';
import {
  parseCompactPayload,
  parseContextBreakdown,
  parseGenRow,
  parseParentReference,
  parsePlannerPayload,
  parseStepMetadata,
  parseUserPromptPayload,
} from './protobuf.ts';

export type CacheDiagKind =
  | 'side_cold'
  | 'sys_prefix_only'
  | 'partial_prefix'
  | 'ttl_expired'
  | 'revert_kept'
  | 'revert_miss'
  | 'gemini_2k_floor';

export interface CacheDiagInfo {
  kind: CacheDiagKind;
  idleGapSec?: number;
  prevPromptTokens?: number;
  missCostUSD?: number;
  sysPrefixOnly?: boolean;
  sessionChanged?: boolean;
  revertStepIdx?: number;
}

export interface RevertEvent {
  stepIdx: number;
  count: number;
  afterGmIdx: number | null;
  turnIndex: number | null;
  timestampMs: number;
  idleGapSec: number | null;
  cacheHitPct: number | null;
  cacheKept: boolean | null;
  sessionKept: boolean | null;
}

export interface ForkInfo {
  parentCascadeId: string;
  forkStepIndex: number;
  inheritedCalls: number;
  ownCalls: number;
  firstOwnGmIdx: number | null;
  firstOwnCacheHitPct: number | null;
  firstOwnCachedInput: number;
  firstOwnTotalPrompt: number;
  firstOwnColdCostUSD: number;
  sysPrefixOnly: boolean;
  sessionChanged: boolean;
}

const globalModelEnumCache = new Map<number, { model: string; modelId: string; modelDisplay: string }>();
let lastCatalogScanMs = 0;
let listConvCache: { sig: string; atMs: number; items: any[] } = { sig: '', atMs: 0, items: [] };

export function listConversations(dirOrRoots, annotationsDir = '', maxAgeMs = 180) {
  const roots = Array.isArray(dirOrRoots)
    ? dirOrRoots.map((r) => (typeof r === 'string'
      ? {
          appDataDir: r,
          conversationsDir: join(r, 'conversations'),
          annotationsDir: join(r, 'annotations'),
          source: inferAppDataSource(r),
        }
      : r))
    : [{
        appDataDir: annotationsDir ? dirname(annotationsDir) : dirname(String(dirOrRoots || '')),
        conversationsDir: String(dirOrRoots || ''),
        annotationsDir: String(annotationsDir || ''),
        source: inferAppDataSource(annotationsDir ? dirname(annotationsDir) : dirname(String(dirOrRoots || ''))),
      }];

  const sig = roots.map((r) => `${r?.conversationsDir || ''}|${r?.annotationsDir || ''}`).join(';');
  const now = Date.now();
  if (maxAgeMs > 0 && listConvCache.sig === sig && now - listConvCache.atMs < maxAgeMs) {
    return listConvCache.items;
  }

  const byId = new Map();
  for (const root of roots) {
    const dir = root?.conversationsDir;
    const annoDir = root?.annotationsDir || '';
    const appDataDir = root?.appDataDir || (dir ? dirname(dir) : '');
    const source = root?.source || inferAppDataSource(appDataDir);
    if (!dir) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.db')) continue;
      const id = name.slice(0, -3);
      if (!UUID_RE.test(id)) continue;
      const dbPath = join(dir, name);
      const dbStat = statSafe(dbPath);
      const walStat = statSafe(`${dbPath}-wal`);
      const annoPath = annoDir ? join(annoDir, `${id}.pbtxt`) : '';
      const annoStat = annoPath ? statSafe(annoPath) : { mtimeMs: 0, size: 0 };
      const updatedMs = Math.max(dbStat.mtimeMs, walStat.mtimeMs);
      const dbSize = dbStat.size + walStat.size;
      const item = {
        id,
        dbPath,
        annoPath,
        appDataDir,
        source,
        dbMtimeMs: dbStat.mtimeMs,
        walMtimeMs: walStat.mtimeMs,
        dbSize,
        updatedMs,
        key: `${dbStat.mtimeMs}:${dbStat.size}:${walStat.mtimeMs}:${walStat.size}`,
        annoKey: `${annoStat.mtimeMs}:${annoStat.size}`,
      };
      const prev = byId.get(id);
      if (!prev || item.updatedMs > prev.updatedMs || (item.updatedMs === prev.updatedMs && item.dbSize > prev.dbSize)) {
        byId.set(id, item);
      }
    }
  }

  const items = [...byId.values()];
  items.sort((a, b) => b.updatedMs - a.updatedMs);
  listConvCache = { sig, atMs: now, items };
  return items;
}

function findTurnForStep(turns, stepIdx) {
  if (stepIdx === null || stepIdx === undefined || !turns.length) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].stepIdx <= stepIdx) return turns[i];
  }
  return null;
}

function upsertEnumModel(map, modelEnum, info) {
  if (modelEnum === null || modelEnum === undefined || !info) return;
  const known = KNOWN_MODEL_ENUMS.get(modelEnum);
  const existing = map.get(modelEnum);
  const modelId = info.modelId || existing?.modelId || known?.modelId || '';
  const modelDisplay = info.modelDisplay || existing?.modelDisplay || known?.modelDisplay || '';
  const model = modelId || info.model || existing?.model || modelDisplay || known?.model || '';
  if (!model || model === 'Unknown Model') return;
  map.set(modelEnum, { model, modelId, modelDisplay });
}

function refreshGlobalModelCatalog(conversations, force = false) {
  const now = Date.now();
  if (!force && now - lastCatalogScanMs < 15_000 && globalModelEnumCache.size > 0) return;
  lastCatalogScanMs = now;
  for (const conv of conversations.slice(0, 15)) {
    let db;
    try {
      db = new DatabaseSync(conv.dbPath, { readOnly: true });
      const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx DESC LIMIT 12').all();
      for (const row of rows) {
        const parsed = parseGenRow(row.idx, row.data);
        if (parsed && parsed.modelEnum !== null && parsed.model !== 'Unknown Model') {
          upsertEnumModel(globalModelEnumCache, parsed.modelEnum, {
            model: parsed.model,
            modelId: parsed.modelId,
            modelDisplay: parsed.modelDisplay,
          });
        }
      }
    } catch {
      /* ignore */
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  }
}

function resolveEnumModel(modelEnum, localEnumMap, conversations) {
  if (modelEnum === null || modelEnum === undefined) return null;
  const known = KNOWN_MODEL_ENUMS.get(modelEnum);
  let found = localEnumMap.get(modelEnum) || globalModelEnumCache.get(modelEnum) || null;
  if (!found || (!found.modelId && !known?.modelId)) {
    refreshGlobalModelCatalog(conversations, !found);
    found = localEnumMap.get(modelEnum) || globalModelEnumCache.get(modelEnum) || found;
  }
  if (found && known) {
    const modelId = found.modelId || known.modelId || '';
    const modelDisplay = found.modelDisplay || known.modelDisplay || '';
    return {
      model: modelId || found.model || modelDisplay || known.model,
      modelId,
      modelDisplay,
    };
  }
  return found || known || {
    model: `enum:${modelEnum}`,
    modelId: '',
    modelDisplay: `Model #${modelEnum}`,
  };
}

export function readTelemetry(dbPath: string, conversations: any[] = [], fallbackTsMs = 0) {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const gmRows: any[] = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    const stepRows: any[] = db.prepare(
      'SELECT idx, step_type, status, metadata, CASE WHEN step_type IN (14, 15, 23) OR status IN (1, 2) THEN step_payload ELSE NULL END AS step_payload FROM steps ORDER BY idx ASC'
    ).all();

    let trajectoryType = 0;
    let ownCascadeId = '';
    const baseName = basename(String(dbPath || ''), '.db');
    if (UUID_RE.test(baseName)) ownCascadeId = baseName;
    try {
      let tm: any;
      try {
        tm = db.prepare('SELECT trajectory_type, cascade_id FROM trajectory_meta LIMIT 1').get();
      } catch {
        tm = db.prepare('SELECT trajectory_type FROM trajectory_meta LIMIT 1').get();
      }
      if (tm && Number.isFinite(tm.trajectory_type)) trajectoryType = tm.trajectory_type;
      if (tm && typeof tm.cascade_id === 'string' && UUID_RE.test(tm.cascade_id)) {
        ownCascadeId = tm.cascade_id;
      }
    } catch { /* table missing */ }

    let forkParentCascadeId = '';
    let forkStepIndex: number | null = null;
    const rawRevertCounts = new Map<number, number>();
    try {
      const prRows: any[] = db.prepare('SELECT data FROM parent_references ORDER BY idx ASC').all();
      let lastExternalFork: { parentCascadeId: string; stepIndex: number } | null = null;
      for (const pr of prRows) {
        if (!pr?.data) continue;
        const ref = parseParentReference(pr.data);
        if (ref.parentCascadeId && ownCascadeId && ref.parentCascadeId !== ownCascadeId) {
          if (ref.stepIndex !== null && ref.stepIndex >= 0) {
            lastExternalFork = { parentCascadeId: ref.parentCascadeId, stepIndex: ref.stepIndex };
          }
        } else if (ref.parentCascadeId && ownCascadeId && ref.parentCascadeId === ownCascadeId) {
          if (ref.stepIndex !== null && ref.stepIndex >= 0) {
            rawRevertCounts.set(ref.stepIndex, (rawRevertCounts.get(ref.stepIndex) || 0) + 1);
          }
        }
      }
      if (trajectoryType === 22 && lastExternalFork) {
        forkParentCascadeId = lastExternalFork.parentCascadeId;
        forkStepIndex = lastExternalFork.stepIndex;
      }
    } catch { /* table missing */ }

    const plannerByStepIdx = new Map<number, any>();
    const plannerByGmIdx = new Map<number, any>();
    const plannerByBotId = new Map<string, any>();
    const toolStepsByGmIdx = new Map<number, any[]>();
    const rawToolSteps: any[] = [];
    const compactionRows: any[] = [];
    const turns: any[] = [];
    const stepMetaList: any[] = [];
    const toolIntervals: [number, number][] = [];
    let userTurns = 0;
    let toolStepCount = 0;
    let lastPlannerEntry: any = null;
    let pendingCompactRaw: { idx: number; createdAtMs: number; startedAtMs: number } | null = null;

    for (const s of stepRows) {
      const meta = s.metadata ? parseStepMetadata(s.metadata) : {
        createdAtMs: 0,
        startedAtMs: 0,
        streamStartMs: 0,
        completedAtMs: 0,
        endAtMs: 0,
        modelEnum: null,
        toolName: '',
        gmIdx: null,
        botId: '',
        usage: null,
      };
      stepMetaList.push({ s, meta });
      if (s.step_type === 14) {
        userTurns += 1;
        const prompt = parseUserPromptPayload(s.step_payload);
        turns.push({
          turnIndex: userTurns,
          stepIdx: s.idx,
          timestampMs: meta.createdAtMs || 0,
          promptPreview: prompt.preview,
          promptFull: prompt.full,
          isCompact: Boolean(prompt.isCompact),
          isInherited: forkStepIndex !== null && s.idx <= forkStepIndex,
          compactCount: 0,
          callCount: 0,
          outputTokens: 0,
          totalSec: 0,
        });
        if (prompt.isCompact) {
          pendingCompactRaw = {
            idx: s.idx,
            createdAtMs: meta.createdAtMs || 0,
            startedAtMs: meta.startedAtMs || meta.createdAtMs || 0,
          };
        }
      } else if (s.step_type === 101) {
        if (pendingCompactRaw && meta.createdAtMs > 0) {
          pendingCompactRaw.startedAtMs = meta.createdAtMs;
        }
      } else if (s.step_type === 15) {
        pendingCompactRaw = null;
        const content = s.step_payload ? parsePlannerPayload(s.step_payload, false) : null;
        const entry = { stepIdx: s.idx, meta, content };
        lastPlannerEntry = entry;
        plannerByStepIdx.set(s.idx, entry);
        if (meta.gmIdx !== null) plannerByGmIdx.set(meta.gmIdx, entry);
        if (meta.botId) plannerByBotId.set(meta.botId, entry);
      } else if (s.step_type === 17) {
        pendingCompactRaw = null;
      } else if (s.step_type === 23) {
        const isDone = TERMINAL_STEP_STATUSES.has(s.status) || meta.endAtMs > 0 || meta.completedAtMs > 0;
        if (isDone) {
          pendingCompactRaw = null;
          compactionRows.push({
            stepIdx: s.idx,
            meta,
            summaryPreview: parseCompactPayload(s.step_payload),
          });
        }
      } else if (s.step_type === 132) {
        toolStepCount += 1;
        const resolvedGmIdx = meta.gmIdx !== null
          ? meta.gmIdx
          : (lastPlannerEntry?.meta?.gmIdx ?? null);
        const toolEntry = { stepIdx: s.idx, status: s.status, meta, gmIdx: resolvedGmIdx, fallbackPlanner: lastPlannerEntry };
        rawToolSteps.push(toolEntry);
        if (resolvedGmIdx !== null) {
          if (!toolStepsByGmIdx.has(resolvedGmIdx)) toolStepsByGmIdx.set(resolvedGmIdx, []);
          toolStepsByGmIdx.get(resolvedGmIdx)!.push(toolEntry);
        }
      }
    }

    for (const te of rawToolSteps) {
      if (te.status !== 3 && te.status !== 6 && te.status !== 7) continue;
      const parentPlanner = (te.gmIdx !== null ? plannerByGmIdx.get(te.gmIdx) : null) || te.fallbackPlanner;
      const plannerDoneMs = parentPlanner?.meta?.completedAtMs || parentPlanner?.meta?.endAtMs || 0;
      const rawStartMs = te.meta.streamStartMs || te.meta.createdAtMs;
      const startMs = plannerDoneMs > 0 ? Math.max(rawStartMs, plannerDoneMs) : rawStartMs;
      const endMs = te.meta.endAtMs || te.meta.completedAtMs;
      if (startMs > 0 && endMs >= startMs) {
        toolIntervals.push([startMs, endMs]);
      }
    }

    let activeStepRaw: any = null;
    for (let i = stepMetaList.length - 1; i >= 0; i--) {
      const { s, meta } = stepMetaList[i];
      const isCheckpointRunning = s.step_type === 23
        && !TERMINAL_STEP_STATUSES.has(s.status)
        && !meta.endAtMs
        && !meta.completedAtMs;
      const isRunning = isCheckpointRunning || ((
        ACTIVE_STEP_STATUSES.has(s.status)
        || (s.status > 0 && !TERMINAL_STEP_STATUSES.has(s.status))
      ) && !meta.endAtMs);
      if (isRunning) {
        const liveContent = s.step_type === 15 && s.step_payload ? parsePlannerPayload(s.step_payload, true) : null;
        activeStepRaw = {
          idx: s.idx,
          stepType: s.step_type,
          status: s.status || 2,
          statusName: s.step_type === 23 ? 'COMPACTING' : (STEP_STATUS_NAMES[s.status] || 'RUNNING'),
          createdAtMs: meta.startedAtMs || meta.createdAtMs,
          streamStartMs: meta.streamStartMs,
          modelEnum: meta.modelEnum,
          toolName: meta.toolName,
          thinkingPreview: liveContent?.thinking || '',
          thinkingChars: liveContent?.thinkingChars || 0,
          thinkingTruncated: Boolean(liveContent?.thinkingTruncated),
          replyPreview: liveContent?.reply || '',
          replyChars: liveContent?.replyChars || 0,
          replyTruncated: Boolean(liveContent?.replyTruncated),
          toolCalls: liveContent?.toolCalls || [],
        };
        break;
      }
      if (s.step_type === 14 || s.step_type === 15 || s.step_type === 17 || s.step_type === 23) {
        break;
      }
    }

    const invocations: any[] = [];
    const localEnumMap = new Map<number, { model: string; modelId: string; modelDisplay: string }>();
    for (const row of gmRows) {
      const parsed = parseGenRow(row.idx, row.data);
      if (!parsed) continue;
      if (parsed.modelEnum !== null) {
        const fb = localEnumMap.get(parsed.modelEnum)
          || globalModelEnumCache.get(parsed.modelEnum)
          || KNOWN_MODEL_ENUMS.get(parsed.modelEnum);
        if (fb) {
          if (!parsed.modelId && fb.modelId) parsed.modelId = fb.modelId;
          if (!parsed.modelDisplay && fb.modelDisplay) parsed.modelDisplay = fb.modelDisplay;
          if ((!parsed.model || parsed.model === 'Unknown Model') && fb.model) parsed.model = fb.model;
        }
        if (parsed.model && parsed.model !== 'Unknown Model') {
          const info = {
            model: parsed.model,
            modelId: parsed.modelId,
            modelDisplay: parsed.modelDisplay,
          };
          upsertEnumModel(localEnumMap, parsed.modelEnum, info);
          upsertEnumModel(globalModelEnumCache, parsed.modelEnum, info);
        }
      }
      const stepIdx = parsed.lastStepIndex !== null ? parsed.lastStepIndex + 1 : null;
      const linked = plannerByGmIdx.get(row.idx)
        || (parsed.botId ? plannerByBotId.get(parsed.botId) : null)
        || (stepIdx !== null ? plannerByStepIdx.get(stepIdx) : null);
      const resolvedStepIdx = linked?.stepIdx ?? stepIdx;
      const turn = findTurnForStep(turns, resolvedStepIdx);
      if (turn) {
        turn.callCount += 1;
        turn.outputTokens += parsed.outputTokens;
        turn.totalSec += parsed.totalSec;
      }
      const times = linked?.meta;
      const content = linked?.content;
      const timestampMs = times?.completedAtMs || times?.createdAtMs || 0;
      const cost = computeCallCost(
        parsed.modelId,
        parsed.modelDisplay,
        parsed.model,
        parsed.newInput,
        parsed.cachedInput,
        parsed.outputTokens,
        timestampMs || fallbackTsMs,
      );

      let thinkSec = 0;
      let toolGenSec = 0;
      const linkedToolSteps = toolStepsByGmIdx.get(row.idx) || [];
      if (linkedToolSteps.length > 0 && times?.streamStartMs > 0) {
        let firstToolCreatedMs = 0;
        for (const ts of linkedToolSteps) {
          if (ts.meta.createdAtMs > 0 && (firstToolCreatedMs === 0 || ts.meta.createdAtMs < firstToolCreatedMs)) {
            firstToolCreatedMs = ts.meta.createdAtMs;
          }
        }
        const streamEndMs = times.completedAtMs || times.endAtMs || 0;
        if (firstToolCreatedMs >= times.streamStartMs && streamEndMs >= firstToolCreatedMs) {
          thinkSec = (firstToolCreatedMs - times.streamStartMs) / 1000;
          toolGenSec = (streamEndMs - firstToolCreatedMs) / 1000;
        }
      }
      const nonThinkTokens = Math.max(1, parsed.candidateTokens || Math.max(0, parsed.outputTokens - parsed.thinkingTokens));
      const isToolStall = Boolean(
        !parsed.isBuffered
        && toolGenSec >= 4.0
        && parsed.genTps > 0
        && parsed.genTps < 22
        && (nonThinkTokens / toolGenSec) < 15
      );

      const isInherited = forkStepIndex !== null && (
        (resolvedStepIdx !== null && resolvedStepIdx <= forkStepIndex)
        || Boolean(parsed.cascadeId && ownCascadeId && parsed.cascadeId !== ownCascadeId)
      );

      invocations.push({
        ...parsed,
        stepIdx: resolvedStepIdx,
        turnIndex: turn ? turn.turnIndex : null,
        timestampMs,
        isInherited,
        ...cost,
        thinkSec,
        toolGenSec,
        stepToolCount: linkedToolSteps.length,
        isToolStall,
        thinkingPreview: content?.thinking || '',
        thinkingChars: content?.thinkingChars || 0,
        replyPreview: content?.reply || '',
        replyChars: content?.replyChars || 0,
        toolCalls: content?.toolCalls || [],
      });
    }

    let contextBreakdown: ReturnType<typeof parseContextBreakdown> = null;
    for (let i = gmRows.length - 1; i >= 0; i--) {
      contextBreakdown = parseContextBreakdown(gmRows[i].data);
      if (contextBreakdown) break;
    }

    const gmDataByIdx = new Map<number, Uint8Array>(gmRows.map((r) => [r.idx, r.data]));
    const invByIdx = new Map<number, any>(invocations.map((inv) => [inv.idx, inv]));
    const firstInv = invocations.length ? invocations[0] : null;
    let lastVerifiedBaseOverhead = 0;

    const compactions: any[] = [];
    for (const c of compactionRows) {
      const { meta, stepIdx, summaryPreview } = c;
      const resolved = resolveEnumModel(meta.modelEnum, localEnumMap, conversations);
      const u = meta.usage || { cachedInput: 0, newInput: 0, outputTokens: 0, thinkingTokens: 0, candidateTokens: 0 };
      const outTok = u.outputTokens || (u.thinkingTokens + u.candidateTokens);
      const summaryTok = u.candidateTokens
        || Math.max(0, outTok - (u.thinkingTokens || 0))
        || outTok
        || (summaryPreview ? Math.round(summaryPreview.length / 3.2) : 0);

      let beforeCtx = meta.gmIdx !== null ? (invByIdx.get(meta.gmIdx - 1)?.totalContext || 0) : 0;
      if (!beforeCtx) {
        for (let i = invocations.length - 1; i >= 0; i--) {
          const inv = invocations[i];
          const isBefore = (inv.stepIdx !== null && inv.stepIdx < stepIdx)
            || (meta.gmIdx !== null && inv.idx < meta.gmIdx);
          if (isBefore && inv.totalContext > 0) {
            beforeCtx = inv.totalContext;
            break;
          }
        }
      }
      if (!beforeCtx && (u.cachedInput + u.newInput) > 0) {
        beforeCtx = u.cachedInput + u.newInput;
      }

      const exactAfter = meta.gmIdx !== null ? (invByIdx.get(meta.gmIdx)?.totalContext || 0) : 0;
      let afterCtx = exactAfter;
      let afterCtxEstimated = false;

      if (exactAfter > 0) {
        if (summaryTok > 0 && exactAfter > summaryTok) {
          lastVerifiedBaseOverhead = Math.max(0, exactAfter - summaryTok);
        }
      } else if (beforeCtx > 0 || summaryTok > 0) {
        let baseOverhead = 0;
        if (lastVerifiedBaseOverhead > 0) {
          baseOverhead = lastVerifiedBaseOverhead;
        } else {
          const prevRaw = meta.gmIdx !== null ? gmDataByIdx.get(meta.gmIdx - 1) : null;
          const bd = (prevRaw ? parseContextBreakdown(prevRaw) : null) || contextBreakdown;
          if (bd && (bd.systemPrompt + bd.toolsSchema) > 0) {
            baseOverhead = bd.systemPrompt + bd.toolsSchema + (bd.sysMsg || 1000);
          } else if (firstInv && firstInv.totalContext > 0) {
            const excessFirst = Math.max(0, (firstInv.totalPromptTokens || 0) - 16_000);
            baseOverhead = Math.max(8_000, firstInv.totalContext - excessFirst);
          } else {
            baseOverhead = 21_500;
          }
        }
        let estAfter = baseOverhead + summaryTok;
        if (beforeCtx > 0 && estAfter >= beforeCtx) {
          if (summaryTok > 0 && summaryTok < beforeCtx * 0.8) {
            estAfter = Math.min(estAfter, Math.round(beforeCtx * 0.85));
          } else {
            estAfter = 0;
          }
        }
        afterCtx = estAfter;
        afterCtxEstimated = estAfter > 0;
      }

      const durationSec = meta.endAtMs > meta.createdAtMs && meta.createdAtMs > 0
        ? (meta.endAtMs - meta.createdAtMs) / 1000
        : 0;
      const timestampMs = meta.endAtMs || meta.completedAtMs || meta.createdAtMs || 0;
      const model = resolved?.model || '';
      const modelId = resolved?.modelId || '';
      const modelDisplay = resolved?.modelDisplay || '';
      const cost = computeCallCost(
        modelId,
        modelDisplay,
        model,
        u.newInput,
        u.cachedInput,
        outTok,
        timestampMs || fallbackTsMs,
      );
      const turn = findTurnForStep(turns, stepIdx);
      if (turn) {
        turn.compactCount = (turn.compactCount || 0) + 1;
        turn.outputTokens += outTok;
        turn.totalSec += durationSec;
      }
      compactions.push({
        stepIdx,
        turnIndex: turn ? turn.turnIndex : null,
        afterGmIdx: meta.gmIdx,
        timestampMs,
        durationSec,
        model,
        modelId,
        modelDisplay,
        cachedInput: u.cachedInput,
        newInput: u.newInput,
        outputTokens: outTok,
        thinkingTokens: u.thinkingTokens,
        candidateTokens: u.candidateTokens,
        beforeCtx,
        afterCtx,
        afterCtxEstimated,
        ...cost,
        summaryPreview,
      });
    }

    let activeStep: any = null;
    if (activeStepRaw) {
      const resolved = resolveEnumModel(activeStepRaw.modelEnum, localEnumMap, conversations);
      const turn = findTurnForStep(turns, activeStepRaw.idx) || (turns.length ? turns[turns.length - 1] : null);
      activeStep = {
        ...activeStepRaw,
        turnIndex: turn ? turn.turnIndex : null,
        model: resolved?.model || '',
        modelId: resolved?.modelId || '',
        modelDisplay: resolved?.modelDisplay || '',
      };
    }

    // Attach per-call cache diagnostics, build in-conversation revert markers, and fork metadata
    const sortedRevertEntries = [...rawRevertCounts.entries()].sort((a, b) => a[0] - b[0]);
    const revertAfterInvIdx = new Map<number, { revStep: number; count: number; beforeInv: any; afterInv: any }>();
    const reverts: RevertEvent[] = [];

    for (const [revStep, count] of sortedRevertEntries) {
      let beforeInv: any = null;
      let afterInv: any = null;
      for (const inv of invocations) {
        if (inv.stepIdx !== null && inv.stepIdx <= revStep) {
          beforeInv = inv;
        } else if (inv.stepIdx !== null && inv.stepIdx > revStep) {
          afterInv = inv;
          break;
        }
      }
      const idleGapSec = (beforeInv?.timestampMs && afterInv?.timestampMs)
        ? Math.max(0, Math.round((afterInv.timestampMs - beforeInv.timestampMs) / 1000))
        : null;
      const cacheHitPct = afterInv && afterInv.totalPromptTokens > 0 ? afterInv.cacheHitPct : null;
      const cacheKept = cacheHitPct !== null ? cacheHitPct >= 80 : null;
      const sessionKept = (beforeInv?.sessionId && afterInv?.sessionId)
        ? beforeInv.sessionId === afterInv.sessionId
        : null;
      const turn = findTurnForStep(turns, afterInv?.stepIdx ?? revStep);
      reverts.push({
        stepIdx: revStep,
        count,
        afterGmIdx: afterInv ? afterInv.idx : null,
        turnIndex: turn ? turn.turnIndex : null,
        timestampMs: afterInv?.timestampMs || beforeInv?.timestampMs || 0,
        idleGapSec,
        cacheHitPct,
        cacheKept,
        sessionKept,
      });
      if (afterInv) {
        revertAfterInvIdx.set(afterInv.idx, { revStep, count, beforeInv, afterInv });
      }
    }

    const computeMissExtraUSD = (inv: any, prevPromptTokens: number) => {
      const rates = resolveModelPricing(inv.modelId, inv.modelDisplay, inv.model, inv.timestampMs || fallbackTsMs);
      if (!rates) return 0;
      const uncached = Math.max(0, prevPromptTokens - (inv.cachedInput || 0));
      return Number(((uncached * Math.max(0, rates.input - rates.cached)) / 1e6).toFixed(4));
    };

    let forkInfo: ForkInfo | null = null;
    let firstOwnAfterForkIdx: number | null = null;
    if (forkStepIndex !== null) {
      const inheritedList = invocations.filter((x) => x.isInherited);
      const ownList = invocations.filter((x) => !x.isInherited);
      const lastInherited = inheritedList.length ? inheritedList[inheritedList.length - 1] : null;
      const firstOwn = ownList.find((x) => x.totalPromptTokens > 0) || ownList[0] || null;
      let coldCost = 0;
      let sysPrefixOnly = false;
      let sessionChanged = false;
      if (firstOwn && lastInherited && lastInherited.totalPromptTokens > 2_000) {
        firstOwnAfterForkIdx = firstOwn.idx;
        const retention = firstOwn.cachedInput / lastInherited.totalPromptTokens;
        sysPrefixOnly = firstOwn.cachedInput > 0 && firstOwn.cachedInput <= 20_000 && retention < 0.5;
        sessionChanged = Boolean(lastInherited.sessionId && firstOwn.sessionId && lastInherited.sessionId !== firstOwn.sessionId);
        if (retention < 0.5) {
          coldCost = computeMissExtraUSD(firstOwn, lastInherited.totalPromptTokens);
        }
      }
      forkInfo = {
        parentCascadeId: forkParentCascadeId,
        forkStepIndex,
        inheritedCalls: inheritedList.length,
        ownCalls: ownList.length,
        firstOwnGmIdx: firstOwn ? firstOwn.idx : null,
        firstOwnCacheHitPct: firstOwn ? firstOwn.cacheHitPct : null,
        firstOwnCachedInput: firstOwn?.cachedInput || 0,
        firstOwnTotalPrompt: firstOwn?.totalPromptTokens || 0,
        firstOwnColdCostUSD: coldCost,
        sysPrefixOnly,
        sessionChanged,
      };
    }

    for (let i = 0; i < invocations.length; i++) {
      const inv = invocations[i];
      if (inv.totalPromptTokens <= 0) continue;
      const prev = i > 0 ? invocations[i - 1] : null;
      const prevTotal = prev?.totalPromptTokens || 0;
      const idleGapSec = (prev?.timestampMs && inv.timestampMs && inv.timestampMs >= prev.timestampMs)
        ? Math.round((inv.timestampMs - prev.timestampMs) / 1000)
        : undefined;
      const sameModel = Boolean(prev && prev.model === inv.model);
      const compactedBetween = Boolean(prev && compactions.some((cp) => (
        (cp.afterGmIdx !== null && cp.afterGmIdx > prev.idx && cp.afterGmIdx <= inv.idx)
        || (prev.stepIdx !== null && inv.stepIdx !== null && cp.stepIdx > prev.stepIdx && cp.stepIdx < inv.stepIdx)
      )));

      // 1. Side conversation first call after fork
      if (firstOwnAfterForkIdx !== null && inv.idx === firstOwnAfterForkIdx && prev && prevTotal > 2_000) {
        const retention = inv.cachedInput / prevTotal;
        if (retention < 0.5) {
          const sysPrefixOnly = inv.cachedInput > 0 && inv.cachedInput <= 20_000;
          const sessionChanged = Boolean(prev.sessionId && inv.sessionId && prev.sessionId !== inv.sessionId);
          inv.cacheDiag = {
            kind: 'side_cold',
            idleGapSec,
            prevPromptTokens: prevTotal,
            missCostUSD: computeMissExtraUSD(inv, prevTotal),
            sysPrefixOnly,
            sessionChanged,
          };
          continue;
        }
      }

      // 2. First call right after an in-conversation revert
      const revHit = revertAfterInvIdx.get(inv.idx);
      if (revHit && !compactedBetween) {
        const revPrevTotal = revHit.beforeInv?.totalPromptTokens || prevTotal;
        if (inv.cacheHitPct !== null && inv.cacheHitPct >= 80) {
          inv.cacheDiag = {
            kind: 'revert_kept',
            idleGapSec,
            prevPromptTokens: revPrevTotal,
            revertStepIdx: revHit.revStep,
          };
          continue;
        }
        if (revPrevTotal > 2_000) {
          inv.cacheDiag = {
            kind: 'revert_miss',
            idleGapSec,
            prevPromptTokens: revPrevTotal,
            missCostUSD: computeMissExtraUSD(inv, revPrevTotal),
            revertStepIdx: revHit.revStep,
          };
          continue;
        }
      }

      if (!prev || prevTotal <= 2_000 || !sameModel || compactedBetween) continue;
      const retention = inv.cachedInput / prevTotal;
      const sessionChanged = Boolean(prev.sessionId && inv.sessionId && prev.sessionId !== inv.sessionId);

      // 3. Global system+tools prefix only (~16.9K) when history missed
      if (prevTotal > 25_000 && inv.cachedInput > 0 && inv.cachedInput <= 20_000 && retention < 0.5) {
        inv.cacheDiag = {
          kind: 'sys_prefix_only',
          idleGapSec,
          prevPromptTokens: prevTotal,
          missCostUSD: computeMissExtraUSD(inv, prevTotal),
          sysPrefixOnly: true,
          sessionChanged,
        };
        continue;
      }

      // 4. TTL expired (full miss after >= 60s idle, same model & session)
      if (inv.cachedInput === 0 && !sessionChanged && idleGapSec !== undefined && idleGapSec >= 60) {
        inv.cacheDiag = {
          kind: 'ttl_expired',
          idleGapSec,
          prevPromptTokens: prevTotal,
          missCostUSD: computeMissExtraUSD(inv, prevTotal),
        };
        continue;
      }

      // 5. Prefix-tree partial fallback (hit > 20K but dropped < 80% of prev prompt)
      if (prevTotal > 25_000 && inv.cachedInput > 20_000 && retention < 0.8) {
        inv.cacheDiag = {
          kind: 'partial_prefix',
          idleGapSec,
          prevPromptTokens: prevTotal,
          missCostUSD: computeMissExtraUSD(inv, prevTotal),
        };
        continue;
      }

      // 6. Gemini ~2,048-token implicit cache tail floor (delta ≈ -2049 on short follow-ups)
      const isGemini = /gemini|neon|hydrogen|carbon|argon|flash/i.test(`${inv.modelId} ${inv.modelDisplay} ${inv.model}`);
      const deltaFromPrev = inv.cachedInput - prevTotal;
      const promptGrowth = inv.totalPromptTokens - prevTotal;
      if (
        isGemini
        && !sessionChanged
        && inv.cachedInput > 0
        && promptGrowth >= 0
        && promptGrowth < 2_050
        && deltaFromPrev <= -800
        && deltaFromPrev >= -2_200
        && inv.newInput >= 2_040
        && inv.cacheHitPct !== null
        && inv.cacheHitPct < 93
      ) {
        inv.cacheDiag = {
          kind: 'gemini_2k_floor',
          idleGapSec,
          prevPromptTokens: prevTotal,
        };
      }
    }

    const summaryInvocations = forkStepIndex !== null
      ? invocations.filter((x) => !x.isInherited)
      : invocations;
    const summaryCompactions = forkStepIndex !== null
      ? compactions.filter((c) => c.stepIdx > forkStepIndex!)
      : compactions;
    const summaryUserTurns = forkStepIndex !== null
      ? turns.filter((t) => !t.isInherited).length
      : userTurns;
    const inheritedCount = forkStepIndex !== null
      ? invocations.length - summaryInvocations.length
      : 0;

    let totalOutput = 0;
    let totalThinking = 0;
    let totalCandidate = 0;
    let totalCachedInput = 0;
    let totalNewInput = 0;
    let totalTtftSec = 0;
    let totalE2eSec = 0;
    let sustainedOutput = 0;
    let sustainedGenSec = 0;
    let totalCostUSD = 0;
    let totalSavedUSD = 0;
    let pricedCount = 0;
    let unpricedCount = 0;
    let latestCallMs = 0;
    let peakGenTps = 0;
    let latestSustained: any = null;

    for (const inv of summaryInvocations) {
      totalOutput += inv.outputTokens;
      totalThinking += inv.thinkingTokens;
      totalCandidate += inv.candidateTokens;
      totalCachedInput += inv.cachedInput;
      totalNewInput += inv.newInput;
      totalTtftSec += inv.ttftSec;
      totalE2eSec += inv.totalSec;
      if (inv.priced) {
        pricedCount += 1;
        totalCostUSD += inv.costUSD;
        totalSavedUSD += inv.cacheSavedUSD;
      } else {
        unpricedCount += 1;
      }
      if (inv.timestampMs > latestCallMs) latestCallMs = inv.timestampMs;
      if (!inv.isBuffered) {
        latestSustained = inv;
        sustainedOutput += inv.outputTokens;
        sustainedGenSec += inv.genSec;
        if (inv.genTps > peakGenTps) peakGenTps = inv.genTps;
      }
    }
    for (const c of summaryCompactions) {
      if (c.priced) {
        pricedCount += 1;
        totalCostUSD += c.costUSD;
        totalSavedUSD += c.cacheSavedUSD;
      }
      if (c.timestampMs > latestCallMs) latestCallMs = c.timestampMs;
    }

    if (peakGenTps === 0 && summaryInvocations.length) {
      peakGenTps = Math.max(...summaryInvocations.map((i) => i.e2eTps));
    }
    const avgE2eTps = totalE2eSec > 0 ? totalOutput / totalE2eSec : 0;
    const avgGenTps = sustainedGenSec > 0 ? (sustainedOutput / sustainedGenSec) : avgE2eTps;

    const totalPrompt = totalCachedInput + totalNewInput;
    const avgCacheHitPct = totalPrompt > 0 ? (totalCachedInput / totalPrompt) * 100 : null;
    const totalToolSec = mergeIntervalDurationSec(toolIntervals);
    const latest = summaryInvocations.length
      ? summaryInvocations[summaryInvocations.length - 1]
      : (invocations.length ? invocations[invocations.length - 1] : null);
    if (!latestCallMs && stepMetaList.length) {
      for (let i = stepMetaList.length - 1; i >= 0; i--) {
        const m = stepMetaList[i].meta;
        const ts = m.completedAtMs || m.endAtMs || m.createdAtMs || 0;
        if (ts > 0) {
          latestCallMs = ts;
          break;
        }
      }
    }

    const currentModel = (activeStep && (activeStep.modelDisplay || activeStep.model))
      ? {
          model: activeStep.model,
          modelId: activeStep.modelId,
          modelDisplay: activeStep.modelDisplay,
          isActive: true,
          stepType: activeStep.stepType,
          toolName: activeStep.toolName,
          statusName: activeStep.statusName,
        }
      : (latest
          ? {
              model: latest.model,
              modelId: latest.modelId,
              modelDisplay: latest.modelDisplay,
              isActive: false,
              stepType: null,
              toolName: '',
            }
          : null);

    return {
      invocations,
      latest,
      latestSustained,
      currentModel,
      summary: {
        count: summaryInvocations.length,
        inheritedCount,
        userTurns: summaryUserTurns,
        totalSteps: stepRows.length,
        toolStepCount,
        totalOutput,
        totalThinking,
        totalCandidate,
        totalCachedInput,
        totalNewInput,
        avgCacheHitPct,
        avgTtftSec: summaryInvocations.length > 0 ? totalTtftSec / summaryInvocations.length : 0,
        totalModelSec: totalE2eSec,
        totalToolSec,
        avgGenTps,
        avgE2eTps,
        peakGenTps,
        totalCostUSD,
        totalSavedUSD,
        pricedCount,
        unpricedCount,
        latestCallMs,
      },
      activeStep,
      pendingCompact: pendingCompactRaw
        ? {
            stepIdx: pendingCompactRaw.idx,
            createdAtMs: pendingCompactRaw.startedAtMs || pendingCompactRaw.createdAtMs || 0,
          }
        : null,
      compactions,
      reverts,
      forkInfo,
      turns,
      contextBreakdown,
    };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

const telemetryCache = new Map();
const TELEMETRY_CACHE_MAX = 8;

export function getTelemetryCached(target, conversations) {
  const cacheKey = `${target.id}|${target.dbPath || ''}|${target.key}|${getLsModelCatalogVersion()}`;
  const hit = telemetryCache.get(cacheKey);
  if (hit) {
    telemetryCache.delete(cacheKey);
    telemetryCache.set(cacheKey, hit);
    return hit;
  }
  const fallbackTsMs = target.dbMtimeMs || target.updatedMs || 0;
  const telemetry = readTelemetry(target.dbPath, conversations, fallbackTsMs);
  const detailIndex = {
    inv: new Map(),
    compact: new Map(),
    turn: new Map(),
  };
  for (const inv of telemetry.invocations || []) {
    detailIndex.inv.set(inv.idx, {
      thinkingPreview: inv.thinkingPreview || '',
      thinkingChars: inv.thinkingChars || 0,
      replyPreview: inv.replyPreview || '',
      replyChars: inv.replyChars || 0,
      toolCalls: inv.toolCalls || [],
    });
  }
  for (const c of telemetry.compactions || []) {
    detailIndex.compact.set(c.stepIdx, {
      summaryPreview: c.summaryPreview || '',
    });
  }
  for (const t of telemetry.turns || []) {
    detailIndex.turn.set(t.turnIndex, {
      promptFull: t.promptFull || t.promptPreview || '',
    });
  }
  const entry = { telemetry, detailIndex };
  telemetryCache.set(cacheKey, entry);
  if (telemetryCache.size > TELEMETRY_CACHE_MAX) {
    const oldestKey = telemetryCache.keys().next().value;
    if (oldestKey) telemetryCache.delete(oldestKey);
  }
  return entry;
}

export function stripInvocationDetails(inv) {
  if (!inv) return inv;
  const { thinkingPreview, replyPreview, toolCalls, ...rest } = inv;
  const toolArrCount = Array.isArray(toolCalls) ? toolCalls.length : 0;
  return {
    ...rest,
    hasThinking: Boolean(thinkingPreview),
    hasReply: Boolean(replyPreview),
    toolCount: Math.max(toolArrCount, inv.stepToolCount || 0),
  };
}

export function createEmptyTelemetry() {
  return {
    invocations: [],
    latest: null,
    latestSustained: null,
    currentModel: null,
    summary: {
      count: 0,
      inheritedCount: 0,
      userTurns: 0,
      totalSteps: 0,
      toolStepCount: 0,
      totalOutput: 0,
      totalThinking: 0,
      totalCandidate: 0,
      totalCachedInput: 0,
      totalNewInput: 0,
      avgCacheHitPct: null,
      avgTtftSec: 0,
      totalModelSec: 0,
      totalToolSec: 0,
      avgGenTps: 0,
      avgE2eTps: 0,
      peakGenTps: 0,
      totalCostUSD: 0,
      totalSavedUSD: 0,
      pricedCount: 0,
      unpricedCount: 0,
      latestCallMs: 0,
    },
    activeStep: null,
    pendingCompact: null,
    compactions: [],
    reverts: [],
    forkInfo: null,
    turns: [],
    contextBreakdown: null,
  };
}

export function toLightTelemetryPayload(telemetry) {
  return {
    ...telemetry,
    invocations: (telemetry.invocations || []).map(stripInvocationDetails),
    latest: stripInvocationDetails(telemetry.latest),
    latestSustained: stripInvocationDetails(telemetry.latestSustained),
    compactions: (telemetry.compactions || []).map((c) => {
      const { summaryPreview, ...rest } = c;
      return { ...rest, hasSummary: Boolean(summaryPreview) };
    }),
    turns: (telemetry.turns || []).map((t) => {
      const { promptFull, ...rest } = t;
      return { ...rest, hasFullPrompt: Boolean(promptFull && promptFull !== t.promptPreview) };
    }),
  };
}
