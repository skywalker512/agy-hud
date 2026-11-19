import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  KNOWN_MODEL_ENUMS,
  localDayKey,
  parseIsoMs,
  resolveQuotaCalibrationPath,
  resolveQuotaFitPath,
  SYNC_GRAPH_WARM_LIMIT,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from './constants.mjs';
import { isCascadeStatusActive } from './ls-client.mjs';
import { computeCallCost, poolKeyForGroupLabel, poolKeyForModel } from './pricing.mjs';
import {
  computeBaseReferenceUSD,
  evaluatePoolWindowResidual,
  getFamilyBaseRates,
  ingestQuotaObservation,
  loadQuotaFitStore,
  predictCallQuota,
  predictFamilyAggregateQuota,
  resolveActiveTierPrefix,
} from './quota-fitter.mjs';
import {
  iterFields,
  parseAnnotationPbtxt,
  parseGenRow,
  parseStepMetadata,
  parseUserPromptPayload,
} from './protobuf.mjs';

const convSummaryCache = new Map();
const pendingBgSummaries = new Map();
let bgSummaryWarmScheduled = false;
let bgSummaryWarmSeq = 0;

export function getBgSummaryWarmSeq() {
  return bgSummaryWarmSeq;
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
  const dayBuckets = Object.create(null);
  const familyUsage = Object.create(null);
  const recentCutoffMs = Date.now() - 8 * 86_400_000;
  const recentCalls = [];

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

    const stepTimeByGmIdx = new Map();
    const stepTimeByBotId = new Map();
    const stepTimeByIdx = new Map();
    const firstToolCreatedByGmIdx = new Map();
    const compactionMetas = [];
    try {
      const firstPromptRow = db.prepare('SELECT step_payload FROM steps WHERE step_type = 14 AND step_payload IS NOT NULL ORDER BY idx ASC LIMIT 1').get();
      if (firstPromptRow?.step_payload) {
        const prompt = parseUserPromptPayload(firstPromptRow.step_payload);
        if (prompt?.preview) fallbackTitle = prompt.preview;
      }
      const stRows = db.prepare('SELECT idx, step_type, status, metadata FROM steps WHERE step_type IN (14, 15, 23, 132) AND metadata IS NOT NULL ORDER BY idx ASC').all();
      let lastPlannerGmIdx = null;
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
        const ts = meta.completedAtMs || meta.endAtMs || meta.createdAtMs || 0;
        if (ts > 0) {
          if (ts > stepLatestTsMs) stepLatestTsMs = ts;
          stepTimeByIdx.set(s.idx, ts);
          if (meta.gmIdx !== null) stepTimeByGmIdx.set(meta.gmIdx, ts);
          if (meta.botId) stepTimeByBotId.set(meta.botId, ts);
        }
        if (s.step_type === 23) {
          const isDone = TERMINAL_STEP_STATUSES.has(s.status) || meta.endAtMs > 0 || meta.completedAtMs > 0;
          if (isDone && meta.usage) {
            compactionMetas.push({ ts, usage: meta.usage });
          }
        }
      }
    } catch { /* table missing */ }

    latestTsMs = stepLatestTsMs;

    const recordSpend = ({ modelId, modelDisplay, model, newIn, cachedIn, outTok, ts, genUncertainStartTs = ts, countStats }) => {
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
          poolKey: ref.poolKey,
          family: ref.family,
          newInput: newIn,
          cachedInput: cachedIn,
          outputTokens: outTok,
          baseUSD: ref.baseUSD,
          costUSD: cost.costUSD,
          priced: cost.priced,
        });
      }
      const dk = localDayKey(ts);
      if (dk) {
        if (!dayBuckets[dk]) {
          dayBuckets[dk] = { calls: 0, outputTokens: 0, costUSD: 0, savedUSD: 0, pricedCount: 0, unpricedCount: 0 };
        }
        const b = dayBuckets[dk];
        if (countStats) {
          b.calls += 1;
          b.outputTokens += outTok;
        }
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
        const stepTs = stepTimeByGmIdx.get(row.idx)
          || (parsed.botId ? stepTimeByBotId.get(parsed.botId) : 0)
          || (stepIdx !== null ? stepTimeByIdx.get(stepIdx) : 0);
        if (stepTs > stepLatestTsMs) stepLatestTsMs = stepTs;
        const completedTs = stepTs || conv.dbMtimeMs || conv.updatedMs || 0;
        if (completedTs > latestTsMs) latestTsMs = completedTs;
        const firstToolMs = firstToolCreatedByGmIdx.get(row.idx) || 0;
        const genUncertainStartTs = (firstToolMs > 0 && stepTs > 0 && firstToolMs <= stepTs)
          ? firstToolMs
          : completedTs;

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

  const resolvedSource = (conv.source && conv.source !== 'app')
    ? conv.source
    : (dbSourceCode === 17 ? 'cli' : 'app');

  return {
    id: conv.id,
    source: resolvedSource,
    key: `${conv.key}|${conv.annoKey}`,
    updatedMs: conv.updatedMs,
    stepLatestTsMs,
    latestTsMs: latestTsMs || conv.updatedMs,
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

export function getConversationGraph(conversations, optsOrRequiredId = '', syncAllArg = false) {
  const requiredConvId = typeof optsOrRequiredId === 'object' && optsOrRequiredId !== null
    ? String(optsOrRequiredId.requiredConvId || '')
    : String(optsOrRequiredId || '');
  const syncAll = typeof optsOrRequiredId === 'object' && optsOrRequiredId !== null
    ? Boolean(optsOrRequiredId.syncAll)
    : Boolean(syncAllArg);
  const summaries = [];
  const byId = new Map();
  const convById = new Map(conversations.map((c) => [c.id, c]));

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

  for (const s of summaries) {
    const link = parentLinks.get(s.id);
    if (!link) continue;
    if (!childrenByParent.has(link.parentId)) childrenByParent.set(link.parentId, []);
    childrenByParent.get(link.parentId).push({
      id: s.id,
      kind: link.kind,
      subagentType: s.subagentType || '',
      title: sqTitleOverrides.get(s.id) || s.title || '',
      calls: s.calls,
      outputTokens: s.outputTokens,
      costUSD: s.costUSD,
      savedUSD: s.savedUSD,
      pricedCount: s.pricedCount,
      unpricedCount: s.unpricedCount,
      updatedMs: s.updatedMs,
      latestTsMs: s.latestTsMs,
      key: s.key,
    });
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => b.updatedMs - a.updatedMs);
  }

  const sourceCounts = { app: 0, cli: 0, ide: 0 };
  for (const conv of conversations) {
    const sum = byId.get(conv.id);
    const rawSrc = sum?.source || conv.source;
    const src = rawSrc === 'cli' || rawSrc === 'ide' ? rawSrc : 'app';
    sourceCounts[src] += 1;
  }

  return {
    summaries,
    byId,
    parentLinks,
    childrenByParent,
    sqTitleOverrides,
    sourceCounts,
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

export function buildSessionInfo(targetId, graph) {
  const s = graph.byId.get(targetId);
  const link = graph.parentLinks.get(targetId);
  const parentSum = link ? graph.byId.get(link.parentId) : null;
  const kind = link ? link.kind : (s?.trajectoryType === 22 ? 'side_question' : 'main');
  const title = graph.sqTitleOverrides.get(targetId) || s?.title || '';
  const childSessions = (graph.childrenByParent.get(targetId) || []).map(({ key: _key, ...rest }) => rest);

  return {
    id: targetId,
    title,
    kind,
    subagentType: s?.subagentType || '',
    parentSession: parentSum
      ? {
          id: parentSum.id,
          title: graph.sqTitleOverrides.get(parentSum.id) || parentSum.title || '',
          calls: parentSum.calls,
          outputTokens: parentSum.outputTokens,
          costUSD: parentSum.costUSD,
        }
      : null,
    childSessions,
    childKeys: (graph.childrenByParent.get(targetId) || []).map((c) => `${c.id}:${c.key}`).join(','),
  };
}

const HEATMAP_WEEKS = 16;

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
    for (const [dk, b] of Object.entries(s.dayBuckets || {})) {
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
        dailyMap[dk] = { calls: 0, appCalls: 0, cliCalls: 0, costUSD: 0, outputTokens: 0 };
      }
      const dm = dailyMap[dk];
      dm.calls += b.calls || 0;
      if (src === 'cli') dm.cliCalls += b.calls || 0;
      else dm.appCalls += b.calls || 0;
      dm.costUSD += b.costUSD || 0;
      dm.outputTokens += b.outputTokens || 0;
    }
  }

  const [ty, tm, td] = todayKey.split('-').map(Number);
  const todayNoon = new Date(ty, tm - 1, td, 12, 0, 0);
  const dowMon0 = (todayNoon.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  const totalGridDays = (HEATMAP_WEEKS - 1) * 7 + dowMon0 + 1;
  const startNoon = new Date(ty, tm - 1, td - (totalGridDays - 1), 12, 0, 0);
  const heatmapDays = [];
  let activeDays = 0;
  let peakCostUSD = 0;
  let peakDate = '';

  for (let i = 0; i < totalGridDays; i++) {
    const d = new Date(startNoon.getFullYear(), startNoon.getMonth(), startNoon.getDate() + i, 12, 0, 0);
    const dk = localDayKey(d.getTime());
    const entry = dailyMap[dk];
    const calls = entry?.calls || 0;
    const costUSD = entry?.costUSD || 0;
    if (calls > 0 || costUSD > 0) activeDays += 1;
    if (costUSD > peakCostUSD) {
      peakCostUSD = costUSD;
      peakDate = dk;
    }
    heatmapDays.push({
      date: dk,
      calls,
      appCalls: entry?.appCalls || 0,
      cliCalls: entry?.cliCalls || 0,
      costUSD,
      outputTokens: entry?.outputTokens || 0,
    });
  }

  let streakDays = 0;
  for (let i = heatmapDays.length - 1; i >= 0; i--) {
    const hd = heatmapDays[i];
    if (hd.calls > 0 || hd.costUSD > 0) {
      streakDays += 1;
    } else if (i === heatmapDays.length - 1) {
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
      activeDays,
      streakDays,
      peakCostUSD,
      peakDate,
      days: heatmapDays,
    },
  };
}

const quotaCalibrationMemCache = new Map();
const QUOTA_CAL_VERSION = 2;
const PRIOR_U0 = 0.02;
const REMOTE_GAP_RATIO_THRESHOLD = 0.72;
const DELTA_MIN_U = 0.015;

function loadQuotaCalibration(calPath) {
  if (!calPath) return { version: QUOTA_CAL_VERSION, entries: {} };
  const cached = quotaCalibrationMemCache.get(calPath);
  if (cached) return cached;
  let parsed = null;
  try {
    if (existsSync(calPath)) {
      const raw = JSON.parse(readFileSync(calPath, 'utf-8'));
      if (
        raw
        && typeof raw === 'object'
        && raw.version === QUOTA_CAL_VERSION
        && raw.entries
        && typeof raw.entries === 'object'
      ) {
        parsed = { version: QUOTA_CAL_VERSION, entries: { ...raw.entries } };
      }
    }
  } catch {
    /* corrupt calibration file; reset cleanly */
  }
  const store = parsed || { version: QUOTA_CAL_VERSION, entries: {} };
  quotaCalibrationMemCache.set(calPath, store);
  return store;
}

function saveQuotaCalibration(calPath, store) {
  if (!calPath) return;
  try {
    mkdirSync(dirname(calPath), { recursive: true });
    writeFileSync(calPath, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    /* ignore non-fatal calibration write errors */
  }
}

function blendPriorWithSpend(priorUSD, spentUSD, u, pricedRatio) {
  if (spentUSD > 0 && u > 0 && pricedRatio >= 0.5) {
    return (PRIOR_U0 * priorUSD + spentUSD) / (PRIOR_U0 + u);
  }
  return priorUSD;
}

function sumPoolWindowSpend(summaries, poolKey, startMs, endMs) {
  let estSpentUSD = 0;
  let estPricedCalls = 0;
  let estUnpricedCalls = 0;
  for (const s of summaries) {
    if (s.latestTsMs && s.latestTsMs < startMs) continue;
    for (const c of (s.recentCalls || [])) {
      if (c.ts < startMs || c.ts > endMs) continue;
      if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
      if (c.priced) {
        estSpentUSD += c.costUSD;
        estPricedCalls += 1;
      } else {
        estUnpricedCalls += 1;
      }
    }
  }
  return { estSpentUSD, estPricedCalls, estUnpricedCalls };
}

function isValidFullUsd(v) {
  return Number.isFinite(v) && v >= 0.5 && v <= 50_000;
}

function updateCalibrationEntry(store, calKey, { rawFull, usedPct, localAtSnapUSD, resetAtMs, nowMs }) {
  const prev = store.entries[calKey];
  if (!prev || !(prev.fullUSD > 0)) {
    if (!(localAtSnapUSD > 0) || !isValidFullUsd(rawFull)) return false;
    store.entries[calKey] = {
      fullUSD: rawFull,
      samples: 1,
      lastResetAtMs: resetAtMs,
      lastUsedPct: usedPct,
      lastLocalUSD: localAtSnapUSD,
      updatedAtMs: nowMs,
    };
    return true;
  }

  const u = usedPct / 100;
  if (prev.lastResetAtMs === resetAtMs) {
    const prevU = (prev.lastUsedPct || 0) / 100;
    const prevS = prev.lastLocalUSD || 0;
    const du = u - prevU;
    const ds = localAtSnapUSD - prevS;
    const deltaFull = (du >= DELTA_MIN_U && ds > 0) ? (ds / du) : 0;
    const deltaPolluted = du >= DELTA_MIN_U && (ds <= 0 || deltaFull < prev.fullUSD * 0.65);
    const windowHasExternalSpend = localAtSnapUSD <= 0 || rawFull < prev.fullUSD * REMOTE_GAP_RATIO_THRESHOLD;

    if (windowHasExternalSpend || deltaPolluted) {
      if (du < DELTA_MIN_U) return false;
      let nextFull = prev.fullUSD;
      if (deltaFull >= prev.fullUSD * 0.65 && deltaFull <= prev.fullUSD * 1.55) {
        // Earlier remote spend exists in this window, but this latest interval was clean local work.
        nextFull = prev.fullUSD * 0.65 + deltaFull * 0.35;
      } else if ((prev.samples || 1) <= 2 && deltaFull > prev.fullUSD * 1.55 && isValidFullUsd(deltaFull)) {
        nextFull = prev.fullUSD * 0.55 + deltaFull * 0.45;
      }
      store.entries[calKey] = {
        ...prev,
        fullUSD: nextFull,
        lastUsedPct: usedPct,
        lastLocalUSD: localAtSnapUSD,
        updatedAtMs: nowMs,
      };
      return true;
    }

    if (!isValidFullUsd(rawFull)) return false;
    const withinRange = rawFull <= prev.fullUSD * 1.55 || ((prev.samples || 1) <= 2 && usedPct >= 8);
    if (!withinRange) return false;
    const alpha = rawFull > prev.fullUSD * 1.55 ? 0.35 : (usedPct >= 10 ? 0.65 : 0.4);
    const nextFull = prev.fullUSD * (1 - alpha) + rawFull * alpha;
    const relChange = Math.abs(nextFull - prev.fullUSD) / prev.fullUSD;
    if (relChange > 0.005 || du >= DELTA_MIN_U) {
      store.entries[calKey] = {
        ...prev,
        fullUSD: nextFull,
        lastUsedPct: usedPct,
        lastLocalUSD: localAtSnapUSD,
        updatedAtMs: nowMs,
      };
      return true;
    }
    return false;
  }

  // New reset window: protect prior fullUSD when remote/other-device spend dominates the start of the window.
  if (localAtSnapUSD <= 0 || rawFull < prev.fullUSD * REMOTE_GAP_RATIO_THRESHOLD || !isValidFullUsd(rawFull)) {
    store.entries[calKey] = {
      ...prev,
      lastResetAtMs: resetAtMs,
      lastUsedPct: usedPct,
      lastLocalUSD: localAtSnapUSD,
      updatedAtMs: nowMs,
    };
    return true;
  }

  const withinRange = rawFull <= prev.fullUSD * 1.55 || usedPct >= 8;
  if (!withinRange) {
    store.entries[calKey] = {
      ...prev,
      lastResetAtMs: resetAtMs,
      lastUsedPct: usedPct,
      lastLocalUSD: localAtSnapUSD,
      updatedAtMs: nowMs,
    };
    return true;
  }

  const alpha = rawFull > prev.fullUSD * 1.55 ? 0.25 : 0.4;
  const nextFull = prev.fullUSD * (1 - alpha) + rawFull * alpha;
  store.entries[calKey] = {
    fullUSD: nextFull,
    samples: (prev.samples || 1) + 1,
    lastResetAtMs: resetAtMs,
    lastUsedPct: usedPct,
    lastLocalUSD: localAtSnapUSD,
    updatedAtMs: nowMs,
  };
  return true;
}

function collectPoolWindowCalls(summaries, poolKey, startMs, endMs) {
  const out = [];
  for (const s of summaries) {
    if (s.latestTsMs && s.latestTsMs < startMs) continue;
    for (const c of (s.recentCalls || [])) {
      if (c.ts < startMs || c.ts > endMs) continue;
      if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
      out.push(c);
    }
  }
  return out;
}

function findRatio5hTo7d(pools, storeEntries, tierKey, targetPoolKey = '', fitStore = null) {
  const validRatio = (r) => Number.isFinite(r) && r >= 0.02 && r <= 0.9;
  const collectMedian = (ratios) => {
    if (!ratios.length) return null;
    const sorted = [...ratios].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  if (targetPoolKey && fitStore?.pools) {
    const gamma = fitStore.pools[`${tierKey}|${targetPoolKey}`]?.gamma;
    if (gamma > 0 && validRatio(1 / gamma)) return 1 / gamma;
  }

  const prefix = `${tierKey}|`;
  const byPool = new Map();
  for (const [k, entry] of Object.entries(storeEntries || {})) {
    if (!k.startsWith(prefix) || !(entry?.fullUSD > 0)) continue;
    const rest = k.slice(prefix.length);
    const sep = rest.lastIndexOf('|');
    if (sep <= 0) continue;
    const pool = rest.slice(0, sep);
    const span = rest.slice(sep + 1);
    if (span !== '5h' && span !== '7d') continue;
    if (!byPool.has(pool)) byPool.set(pool, {});
    byPool.get(pool)[span] = entry.fullUSD;
  }

  if (targetPoolKey && byPool.has(targetPoolKey)) {
    const pair = byPool.get(targetPoolKey);
    if (pair['5h'] > 0 && pair['7d'] > 0 && validRatio(pair['5h'] / pair['7d'])) {
      return pair['5h'] / pair['7d'];
    }
  }

  const strongRatios = [];
  const allLiveRatios = [];
  for (const p of pools) {
    const w5 = p.windows?.find((w) => w.spanKey === '5h' && w.estFullUSD > 0);
    const w7 = p.windows?.find((w) => w.spanKey === '7d' && w.estFullUSD > 0);
    if (!w5 || !w7) continue;
    const r = w5.estFullUSD / w7.estFullUSD;
    if (!validRatio(r)) continue;
    allLiveRatios.push(r);
    if (w5.estConfidence !== 'low' && w7.estConfidence !== 'low') {
      strongRatios.push(r);
    }
  }
  const livePick = collectMedian(strongRatios) ?? collectMedian(allLiveRatios);
  if (livePick) return livePick;

  const calRatios = [];
  for (const pair of byPool.values()) {
    if (pair['5h'] > 0 && pair['7d'] > 0) {
      const r = pair['5h'] / pair['7d'];
      if (validRatio(r)) calRatios.push(r);
    }
  }
  return collectMedian(calRatios);
}

function computeWindowRemoteEst(win, snapMeta) {
  const estFullUSD = win?.estFullUSD;
  if (!(estFullUSD > 0) || !snapMeta) return 0;
  const { u, localAtSnapUSD, pricedCallRatio, unpricedCalls } = snapMeta;
  const usedPct = u * 100;
  if (usedPct < 0.5 || pricedCallRatio < 0.85 || unpricedCalls > 0) return 0;
  const impliedSnapUSD = u * estFullUSD;
  const gapUSD = impliedSnapUSD - localAtSnapUSD;
  const minGapUSD = localAtSnapUSD > 0
    ? Math.max(0.5, estFullUSD * 0.015, impliedSnapUSD * 0.15)
    : Math.max(0.25, estFullUSD * 0.008);
  return gapUSD >= minGapUSD ? gapUSD : 0;
}

export function attachQuotaBudgetEstimates(accountQuota, graph, opts = {}) {
  if (!accountQuota?.available || !Array.isArray(accountQuota.pools) || !accountQuota.pools.length) {
    return accountQuota;
  }
  const nowMs = opts.nowMs || Date.now();
  const quotaSnapMs = (accountQuota.fetchedAtMs > 0 && accountQuota.fetchedAtMs <= nowMs)
    ? accountQuota.fetchedAtMs
    : nowMs;
  const canPersistCal = !graph?.indexing;
  const calPath = opts.calibrationPath || resolveQuotaCalibrationPath();
  const fitPath = opts.fitPath || (opts.calibrationPath ? join(dirname(opts.calibrationPath), 'quota-model-fit.json') : resolveQuotaFitPath());
  const store = loadQuotaCalibration(calPath);
  const fitStore = ingestQuotaObservation(accountQuota, graph, { fitPath, nowMs: quotaSnapMs });
  const summaries = graph?.summaries || [];
  const tierKey = [accountQuota.planName, accountQuota.tierName, accountQuota.teamsTier]
    .filter(Boolean)
    .join(':')
    .toLowerCase() || 'default';

  let calDirty = false;
  const metaByWin = new WeakMap();
  const poolCalKeyMap = new WeakMap();

  const pools = accountQuota.pools.map((p) => {
    const pk = poolKeyForGroupLabel(p.label);
    const calPoolKey = pk === 'other' ? `other:${String(p.label || '').toLowerCase()}` : pk;
    const windows = (p.windows || []).map((w) => {
      const spanMs = w.spanKey === '7d' ? 7 * 24 * 3_600_000 : (w.spanKey === '5h' ? 5 * 3_600_000 : 0);
      if (!spanMs || !w.resetAtMs || w.resetAtMs <= nowMs) return w;

      const startMs = w.resetAtMs - spanMs;
      const winSum = sumPoolWindowSpend(summaries, pk, startMs, nowMs);
      const snapSum = quotaSnapMs < nowMs
        ? sumPoolWindowSpend(summaries, pk, startMs, quotaSnapMs)
        : winSum;

      const estSpentUSD = winSum.estSpentUSD;
      const localAtSnapUSD = snapSum.estSpentUSD;
      const snapTotalCalls = snapSum.estPricedCalls + snapSum.estUnpricedCalls;
      const snapPricedRatio = snapTotalCalls > 0 ? snapSum.estPricedCalls / snapTotalCalls : 1;

      const usedPct = Math.max(0, 100 - (w.remainingPct || 0));
      const u = usedPct / 100;
      const hasFrac = Math.abs((w.remainingPct || 0) - Math.round(w.remainingPct || 0)) > 1e-4;
      const minDirectPct = hasFrac ? 0.5 : 1.0;
      const rawFull = u > 0 ? localAtSnapUSD / u : 0;

      const calKey = `${tierKey}|${calPoolKey}|${w.spanKey}`;
      const priorEntry = store.entries[calKey];
      const priorBefore = (priorEntry && Number.isFinite(priorEntry.fullUSD) && priorEntry.fullUSD > 0)
        ? priorEntry.fullUSD
        : null;

      if (canPersistCal && usedPct >= 3 && snapPricedRatio >= 0.85) {
        if (updateCalibrationEntry(store, calKey, {
          rawFull,
          usedPct,
          localAtSnapUSD,
          resetAtMs: w.resetAtMs,
          nowMs: quotaSnapMs,
        })) {
          calDirty = true;
        }
      }

      const effectivePrior = store.entries[calKey]?.fullUSD > 0 ? store.entries[calKey].fullUSD : priorBefore;
      const rawMatchesPrior = !priorBefore || !(u > 0) || (rawFull >= priorBefore * REMOTE_GAP_RATIO_THRESHOLD);

      let estFullUSD = null;
      let estConfidence = null;
      if (priorBefore && !rawMatchesPrior) {
        estFullUSD = effectivePrior;
        estConfidence = 'prior';
      } else if (usedPct >= 3 && localAtSnapUSD > 0) {
        estFullUSD = (priorBefore > 0 && usedPct < 10 && snapPricedRatio >= 0.85)
          ? blendPriorWithSpend(priorBefore, localAtSnapUSD, u, snapPricedRatio)
          : rawFull;
        estConfidence = 'high';
      } else if (priorBefore > 0) {
        estFullUSD = rawMatchesPrior
          ? blendPriorWithSpend(priorBefore, localAtSnapUSD, u, snapPricedRatio)
          : effectivePrior;
        estConfidence = 'prior';
      } else if (usedPct >= minDirectPct && localAtSnapUSD > 0 && snapPricedRatio >= 0.5) {
        estFullUSD = rawFull;
        estConfidence = 'low';
      }

      const outWin = {
        ...w,
        estSpentUSD,
        estFullUSD,
        estConfidence,
        estMinSamplePct: minDirectPct,
        estPricedCalls: winSum.estPricedCalls,
        estUnpricedCalls: winSum.estUnpricedCalls,
      };
      metaByWin.set(outWin, {
        pk,
        startMs,
        usedPct,
        u,
        localAtSnapUSD,
        pricedCallRatio: snapPricedRatio,
        unpricedCalls: snapSum.estUnpricedCalls,
      });
      return outWin;
    });
    const ps = fitStore?.pools?.[`${tierKey}|${calPoolKey}`];
    const fit = ps?.fit;
    const fitModelsList = fit
      ? Object.entries(fit.models || {}).map(([family, m]) => ({
          family,
          k: m.k,
          beta: m.beta,
          betaPlusMinus: m.betaPlusMinus,
          source: m.source || 'fitted',
          mode: m.mode || 'scalar',
          baseRates: getFamilyBaseRates(family),
          ...(m.priorBeta !== undefined ? {
            priorBeta: m.priorBeta,
            priorRelDiffPct: m.priorRelDiffPct,
            priorZScore: m.priorZScore,
          } : {}),
          ...(m.tokenWeights ? { tokenWeights: m.tokenWeights } : {}),
          obsCalls: m.obsCalls,
        }))
      : [];
    if (fit && calPoolKey === 'gemini' && fit.refBeta > 0 && !fitModelsList.some((m) => m.family === 'gemini-4-hydrogen')) {
      fitModelsList.push({
        family: 'gemini-4-hydrogen',
        k: 1.0,
        beta: fit.refBeta,
        betaPlusMinus: fit.refBeta * 0.12,
        source: 'prior',
        mode: 'scalar',
        baseRates: getFamilyBaseRates('gemini-4-hydrogen'),
        obsCalls: 0,
      });
    }
    const fitSummary = fit ? {
      quality: fit.quality,
      driftWarning: Boolean(fit.driftWarning),
      driftReasons: fit.driftReasons || [],
      full5hUSD: fit.full5hUSD,
      full7dUSD: fit.full7dUSD,
      gamma: fit.gamma || ps?.gamma || null,
      sampleCount: fit.sampleCount,
      shortCleanCount: fit.shortCleanCount,
      holdoutCount: fit.holdoutCount,
      oosRelErrPct: fit.oosRelErrPct,
      relErrPct: fit.relErrPct,
      models: fitModelsList,
    } : null;
    const outPool = { ...p, windows, ...(fitSummary ? { fitSummary } : {}) };
    poolCalKeyMap.set(outPool, calPoolKey);
    return outPool;
  });

  for (const p of pools) {
    const calPoolKey = poolCalKeyMap.get(p) || '';
    const ratio5hTo7d = findRatio5hTo7d(pools, store.entries, tierKey, calPoolKey, fitStore);
    if (!(ratio5hTo7d > 0)) continue;
    const w5 = p.windows?.find((w) => w.spanKey === '5h');
    const w7 = p.windows?.find((w) => w.spanKey === '7d');
    if (w5 && w5.estFullUSD === null && w7?.estFullUSD > 0) {
      const meta = metaByWin.get(w5) || { u: 0, localAtSnapUSD: 0, pricedCallRatio: 1, unpricedCalls: 0 };
      const crossPrior = w7.estFullUSD * ratio5hTo7d;
      const rawMatchesCross = !(meta.u > 0) || (meta.localAtSnapUSD / meta.u) >= crossPrior * REMOTE_GAP_RATIO_THRESHOLD;
      w5.estFullUSD = rawMatchesCross
        ? blendPriorWithSpend(crossPrior, meta.localAtSnapUSD, meta.u, meta.pricedCallRatio)
        : crossPrior;
      w5.estConfidence = 'low';
    } else if (w7 && w7.estFullUSD === null && w5?.estFullUSD > 0) {
      const meta = metaByWin.get(w7) || { u: 0, localAtSnapUSD: 0, pricedCallRatio: 1, unpricedCalls: 0 };
      const crossPrior = w5.estFullUSD / ratio5hTo7d;
      const rawMatchesCross = !(meta.u > 0) || (meta.localAtSnapUSD / meta.u) >= crossPrior * REMOTE_GAP_RATIO_THRESHOLD;
      w7.estFullUSD = rawMatchesCross
        ? blendPriorWithSpend(crossPrior, meta.localAtSnapUSD, meta.u, meta.pricedCallRatio)
        : crossPrior;
      w7.estConfidence = 'low';
    }
  }

  const computeWindowRunway = ({ w, heldByWeekly, startMs, usedPct, callsInNow, ps }) => {
    if (w.disabled || !w.resetAtMs || w.resetAtMs <= nowMs) return null;
    if (heldByWeekly && w.spanKey === '5h') return null;

    const remainingPct = Math.max(0, Math.min(100, w.remainingPct ?? 0));
    const remToResetMs = Math.max(0, w.resetAtMs - nowMs);
    if (remToResetMs <= 0) return null;
    if (remainingPct <= 0.05) {
      return {
        status: 'exhausted',
        burnPctPerHour: 0,
        exhaustInSec: 0,
        exhaustAtMs: nowMs,
        willExhaustBeforeReset: true,
        projectedRemAtResetPct: 0,
        basis: 'exhausted',
      };
    }

    const tierPrefix = `${tierKey}|`;
    const sumCallsPct = (subset) => {
      let sum = 0;
      for (const c of subset) {
        const baseUSD = typeof c.baseUSD === 'number' ? c.baseUSD : 0;
        if (baseUSD > 0) {
          const pred = predictFamilyAggregateQuota(
            {
              poolKey: c.poolKey,
              family: c.family || '',
              baseUSD,
              inM: (c.newInput || 0) / 1e6,
              caM: (c.cachedInput || 0) / 1e6,
              outM: (c.outputTokens || 0) / 1e6,
            },
            fitStore,
            tierPrefix,
          );
          if (pred) {
            sum += w.spanKey === '7d' ? (pred.quotaPct7d ?? 0) : pred.quotaPct5h;
            continue;
          }
        }
        if ((c.costUSD || 0) > 0 && (w.estFullUSD || 0) > 0) {
          sum += (c.costUSD / w.estFullUSD) * 100;
        }
      }
      return sum;
    };

    const postSnapPct = quotaSnapMs < nowMs
      ? sumCallsPct(callsInNow.filter((c) => c.ts > quotaSnapMs && c.ts <= nowMs))
      : 0;
    const effectiveUsedPct = Math.min(100, Math.max(0, usedPct) + postSnapPct);
    const minUsedForRunway = w.spanKey === '7d' ? 0.5 : 0.25;
    if (effectiveUsedPct < minUsedForRunway) return null;

    const elapsedHr = Math.max(1 / 60, (nowMs - startMs) / 3_600_000);
    const minAvgHr = w.spanKey === '7d' ? 4.0 : 0.25;
    const avgRatePerHr = effectiveUsedPct / Math.max(minAvgHr, elapsedHr);

    const lookbackMs = w.spanKey === '7d' ? 24 * 3_600_000 : 45 * 60_000;
    const minRecentHr = w.spanKey === '7d' ? 6.0 : 0.25;
    const tRecent0 = Math.max(startMs, nowMs - lookbackMs);
    const recentSpanHr = Math.max(minRecentHr, (nowMs - tRecent0) / 3_600_000);
    const recentLocalPct = sumCallsPct(callsInNow.filter((c) => c.ts >= tRecent0 && c.ts <= nowMs));

    let recentObsPct = 0;
    const gamma = ps?.fit?.gamma || ps?.gamma || null;
    for (const s of ps?.samples || []) {
      if (!(s.t1 > tRecent0) || !(s.t0 < nowMs)) continue;
      if (w.spanKey === '5h' && s.t0 < startMs - 60_000) continue;
      const sampleDu = w.spanKey === '7d'
        ? (typeof s.du7 === 'number' ? s.du7 : (gamma > 0 ? (s.du5 || 0) / gamma : 0))
        : (s.du5 || 0);
      if (!(sampleDu > 0)) continue;
      const overlapMs = Math.max(0, Math.min(nowMs, s.t1) - Math.max(tRecent0, s.t0));
      const frac = Math.min(1, overlapMs / Math.max(1000, s.t1 - s.t0));
      recentObsPct += sampleDu * frac;
    }

    const recentBurnPct = Math.max(recentLocalPct, recentObsPct);
    const recentRatePerHr = recentBurnPct / recentSpanHr;
    const isRecentActive = recentBurnPct >= (w.spanKey === '7d' ? 0.15 : 0.05);
    const burnPctPerHour = isRecentActive
      ? (0.6 * recentRatePerHr + 0.4 * avgRatePerHr)
      : avgRatePerHr;

    if (!(burnPctPerHour > 0.005)) return null;

    const hoursToExhaust = remainingPct / burnPctPerHour;
    const exhaustInSec = Math.max(1, Math.round(hoursToExhaust * 3600));
    const exhaustAtMs = Math.round(nowMs + hoursToExhaust * 3_600_000);
    const remToResetHr = remToResetMs / 3_600_000;
    const willExhaustBeforeReset = exhaustAtMs < w.resetAtMs;
    const projectedRemAtResetPct = Math.max(0, Math.min(100, remainingPct - burnPctPerHour * remToResetHr));

    return {
      status: willExhaustBeforeReset ? 'warning' : 'safe',
      burnPctPerHour,
      exhaustInSec,
      exhaustAtMs,
      willExhaustBeforeReset,
      projectedRemAtResetPct,
      basis: isRecentActive ? 'active_blend' : 'window_avg',
    };
  };

  let remoteActiveWindowUSD = 0;
  let remoteActivePlusMinusUSD = 0;
  let remote5hUSD = 0;
  let remote7dUSD = 0;
  for (const p of pools) {
    const calPoolKey = poolCalKeyMap.get(p) || '';
    const ps = fitStore?.pools?.[`${tierKey}|${calPoolKey}`];
    let pool7d = 0;
    let pool7dErr = 0;
    let pool5h = 0;
    let pool5hErr = 0;
    let has7d = false;
    for (const w of p.windows || []) {
      const snapMeta = metaByWin.get(w);
      let rem = computeWindowRemoteEst(w, snapMeta);
      let remErr = rem > 0 ? rem * 0.15 : 0;
      let callsInNow = null;

      if (ps?.fit && snapMeta) {
        const callsInSnap = collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, quotaSnapMs);
        callsInNow = quotaSnapMs < nowMs
          ? collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, nowMs)
          : callsInSnap;
        const fitEval = evaluatePoolWindowResidual({
          poolState: ps,
          spanKey: w.spanKey,
          usedPct: snapMeta.usedPct,
          callsInSnap,
          callsInNow,
        });
        if (fitEval) {
          w.estPredLocalPct = fitEval.predLocalPct;
          w.estResidualPct = fitEval.signedResidualPct;
          w.estBandPct = fitEval.bandPct;
          if (fitEval.fullUSD > 0 && (ps.fit.quality === 'high' || ps.fit.shortCleanCount >= 1)) {
            w.estFullUSD = fitEval.fullUSD;
            w.estConfidence = ps.fit.quality === 'high' ? 'high' : 'low';
            w.estEffectiveSpentUSD = fitEval.effectiveLocalUSD;
            if (ps.fit.quality === 'high' || ps.fit.shortCleanCount >= 2) {
              rem = fitEval.extUSD;
              remErr = fitEval.extUSDPlusMinus;
              w.estRemotePct = fitEval.extPct;
              w.estRemotePctPlusMinus = fitEval.extPctPlusMinus;
            }
          }
        }
      }

      if (snapMeta) {
        if (!callsInNow) {
          callsInNow = collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, nowMs);
        }
        const rw = computeWindowRunway({
          w,
          heldByWeekly: Boolean(p.heldByWeekly),
          startMs: snapMeta.startMs,
          usedPct: snapMeta.usedPct,
          callsInNow,
          ps,
        });
        if (rw) w.runway = rw;
      }

      w.estRemoteUSD = rem;
      w.estRemoteUSDPlusMinus = rem > 0 ? remErr : 0;
      w.estTotalUSD = (w.estSpentUSD || 0) + rem;
      if (w.spanKey === '7d') {
        has7d = true;
        pool7d = rem;
        pool7dErr = remErr;
        remote7dUSD += rem;
      } else if (w.spanKey === '5h') {
        pool5h = rem;
        pool5hErr = remErr;
        remote5hUSD += rem;
      }
    }
    remoteActiveWindowUSD += has7d ? pool7d : pool5h;
    remoteActivePlusMinusUSD = Math.hypot(remoteActivePlusMinusUSD, has7d ? pool7dErr : pool5hErr);
  }

  if (calDirty) {
    saveQuotaCalibration(calPath, store);
  }
  return {
    ...accountQuota,
    pools,
    remoteEstimate: {
      activeWindowUSD: remoteActiveWindowUSD,
      activeWindowPlusMinusUSD: remoteActiveWindowUSD > 0 ? remoteActivePlusMinusUSD : 0,
      window5hUSD: remote5hUSD,
      window7dUSD: remote7dUSD,
      snapshotAtMs: quotaSnapMs,
    },
  };
}

export function extractActivePoolWindows(accountQuota, nowMs = Date.now(), fitStore = null, tierPrefix = 'default|') {
  const out = Object.create(null);
  let any = false;
  if (accountQuota?.available && Array.isArray(accountQuota.pools)) {
    for (const p of accountQuota.pools) {
      const pk = poolKeyForGroupLabel(p.label);
      if (pk !== 'gemini' && pk !== 'claude_gpt') continue;
      const w5 = (p.windows || []).find((w) => w.spanKey === '5h' && w.resetAtMs > nowMs);
      const w7 = (p.windows || []).find((w) => w.spanKey === '7d' && w.resetAtMs > nowMs);
      if (w5 || w7) {
        out[pk] = {
          start5hMs: w5 ? w5.resetAtMs - 5 * 3_600_000 : null,
          start7dMs: w7 ? w7.resetAtMs - 7 * 24 * 3_600_000 : null,
        };
        any = true;
      }
    }
  }
  if (!any && fitStore?.pools) {
    for (const pk of ['gemini', 'claude_gpt']) {
      const snap = fitStore.pools[`${tierPrefix}${pk}`]?.lastSnap;
      if (!snap) continue;
      const w5Ok = snap.w5ResetAtMs > nowMs;
      const w7Ok = snap.w7ResetAtMs > nowMs;
      if (w5Ok || w7Ok) {
        out[pk] = {
          start5hMs: w5Ok ? snap.w5ResetAtMs - 5 * 3_600_000 : null,
          start7dMs: w7Ok ? snap.w7ResetAtMs - 7 * 24 * 3_600_000 : null,
        };
        any = true;
      }
    }
  }
  return any ? out : null;
}

export function computeSummaryQuotaUsage(summary, fitStore, tierPrefix = 'default|', activePoolWindows = null) {
  if (!summary) return null;
  const acc = Object.create(null);
  const ensurePool = (pk) => {
    if (!acc[pk]) {
      const hasWin5 = Boolean(activePoolWindows?.[pk]?.start5hMs);
      const hasWin7 = Boolean(activePoolWindows?.[pk]?.start7dMs);
      acc[pk] = {
        pct5h: 0,
        fittedPct5h: 0,
        pct7d: 0,
        has7d: false,
        active5hPct: hasWin5 ? 0 : null,
        active7dPct: hasWin7 ? 0 : null,
      };
    }
    return acc[pk];
  };

  const famEntries = summary.familyUsage ? Object.entries(summary.familyUsage) : [];
  if (famEntries.length > 0) {
    for (const [family, fu] of famEntries) {
      const pred = predictFamilyAggregateQuota(
        {
          poolKey: fu.poolKey,
          family,
          baseUSD: fu.baseUSD,
          inM: fu.inM || 0,
          caM: fu.caM || 0,
          outM: fu.outM || 0,
        },
        fitStore,
        tierPrefix,
      );
      if (!pred || !(pred.quotaPct5h > 0)) continue;
      const b = ensurePool(pred.quotaPool);
      b.pct5h += pred.quotaPct5h;
      if (pred.quotaFitSource === 'fitted') b.fittedPct5h += pred.quotaPct5h;
      if (pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
        b.pct7d += pred.quotaPct7d;
        b.has7d = true;
      }
    }
  } else if (Array.isArray(summary.recentCalls) && summary.recentCalls.length > 0) {
    for (const c of summary.recentCalls) {
      const pred = predictFamilyAggregateQuota(
        {
          poolKey: c.poolKey,
          family: c.family || '',
          baseUSD: c.baseUSD || 0,
          inM: (c.newInput || 0) / 1e6,
          caM: (c.cachedInput || 0) / 1e6,
          outM: (c.outputTokens || 0) / 1e6,
        },
        fitStore,
        tierPrefix,
      );
      if (!pred || !(pred.quotaPct5h > 0)) continue;
      const b = ensurePool(pred.quotaPool);
      b.pct5h += pred.quotaPct5h;
      if (pred.quotaFitSource === 'fitted') b.fittedPct5h += pred.quotaPct5h;
      if (pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
        b.pct7d += pred.quotaPct7d;
        b.has7d = true;
      }
    }
  }

  if (activePoolWindows && Array.isArray(summary.recentCalls)) {
    for (const c of summary.recentCalls) {
      const win = activePoolWindows[c.poolKey];
      if (!win) continue;
      const in5h = Boolean(win.start5hMs && c.ts >= win.start5hMs);
      const in7d = Boolean(win.start7dMs && c.ts >= win.start7dMs);
      if (!in5h && !in7d) continue;
      const pred = predictFamilyAggregateQuota(
        {
          poolKey: c.poolKey,
          family: c.family || '',
          baseUSD: c.baseUSD || 0,
          inM: (c.newInput || 0) / 1e6,
          caM: (c.cachedInput || 0) / 1e6,
          outM: (c.outputTokens || 0) / 1e6,
        },
        fitStore,
        tierPrefix,
      );
      if (!pred || !acc[pred.quotaPool]) continue;
      if (in5h && pred.quotaPct5h > 0) {
        acc[pred.quotaPool].active5hPct = (acc[pred.quotaPool].active5hPct || 0) + pred.quotaPct5h;
      }
      if (in7d && pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
        acc[pred.quotaPool].active7dPct = (acc[pred.quotaPool].active7dPct || 0) + pred.quotaPct7d;
      }
    }
  }

  const out = {};
  let hasAny = false;
  for (const pk of ['gemini', 'claude_gpt']) {
    if (acc[pk] && acc[pk].pct5h > 0) {
      out[pk] = {
        pct5h: acc[pk].pct5h,
        pct7d: acc[pk].has7d ? acc[pk].pct7d : null,
        active5hPct: acc[pk].active5hPct,
        active7dPct: acc[pk].active7dPct,
        isFitted: acc[pk].fittedPct5h / acc[pk].pct5h >= 0.75,
      };
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

export function attachGraphQuotaSummaries({
  conversations = [],
  sessionInfo = null,
  graph = null,
  accountQuota = null,
  opts = {},
}) {
  const fitPath = opts.fitPath ?? resolveQuotaFitPath();
  const nowMs = opts.nowMs || Date.now();
  const fitStore = loadQuotaFitStore(fitPath);
  const tierPrefix = resolveActiveTierPrefix(accountQuota, fitStore);
  const activeWins = extractActivePoolWindows(accountQuota, nowMs, fitStore, tierPrefix);

  const lookup = (id) => {
    const s = graph?.byId?.get(id);
    return s ? computeSummaryQuotaUsage(s, fitStore, tierPrefix, activeWins) : null;
  };

  const nextConversations = conversations.map((c) => {
    const q = lookup(c.id);
    return q ? { ...c, quotaUsage: q } : c;
  });

  let nextSessionInfo = sessionInfo;
  if (sessionInfo) {
    const selfQ = lookup(sessionInfo.id);
    const nextParent = sessionInfo.parentSession
      ? (() => {
          const pq = lookup(sessionInfo.parentSession.id);
          return pq ? { ...sessionInfo.parentSession, quotaUsage: pq } : sessionInfo.parentSession;
        })()
      : null;
    const nextChildren = Array.isArray(sessionInfo.childSessions)
      ? sessionInfo.childSessions.map((ch) => {
          const cq = lookup(ch.id);
          return cq ? { ...ch, quotaUsage: cq } : ch;
        })
      : sessionInfo.childSessions;
    nextSessionInfo = {
      ...sessionInfo,
      ...(selfQ ? { quotaUsage: selfQ } : {}),
      parentSession: nextParent,
      childSessions: nextChildren,
    };
  }

  return { conversations: nextConversations, sessionInfo: nextSessionInfo };
}

export function attachTelemetryQuotaPredictions(telemetry, accountQuota, opts = {}) {
  if (!telemetry) return telemetry;
  const fitPath = opts.fitPath ?? resolveQuotaFitPath();
  const nowMs = opts.nowMs || Date.now();
  const fitStore = loadQuotaFitStore(fitPath);
  const tierPrefix = resolveActiveTierPrefix(accountQuota, fitStore);
  const activeWins = extractActivePoolWindows(accountQuota, nowMs, fitStore, tierPrefix);

  const decorate = (item) => {
    if (!item) return item;
    const pred = predictCallQuota(item, fitStore, tierPrefix);
    return pred ? { ...item, ...pred } : item;
  };

  const invocations = Array.isArray(telemetry.invocations) ? telemetry.invocations.map(decorate) : telemetry.invocations;
  const compactions = Array.isArray(telemetry.compactions) ? telemetry.compactions.map(decorate) : telemetry.compactions;

  // Aggregate per-turn quota burn across invocations + compactions
  const turnAgg = new Map();
  const poolAcc = Object.create(null);

  const recordItem = (item) => {
    if (!item || !(item.quotaPct5h > 0)) return;
    const pk = item.quotaPool || poolKeyForModel(item.modelId, item.modelDisplay, item.model);
    if (pk === 'gemini' || pk === 'claude_gpt') {
      if (!poolAcc[pk]) {
        const hasWin5 = Boolean(activeWins?.[pk]?.start5hMs);
        const hasWin7 = Boolean(activeWins?.[pk]?.start7dMs);
        poolAcc[pk] = {
          pct5h: 0,
          fittedPct5h: 0,
          pct7d: 0,
          has7d: false,
          active5hPct: hasWin5 ? 0 : null,
          active7dPct: hasWin7 ? 0 : null,
        };
      }
      const b = poolAcc[pk];
      b.pct5h += item.quotaPct5h;
      if (item.quotaFitSource === 'fitted') b.fittedPct5h += item.quotaPct5h;
      if (item.quotaPct7d !== null && item.quotaPct7d !== undefined && item.quotaPct7d > 0) {
        b.pct7d += item.quotaPct7d;
        b.has7d = true;
      }
      const start5h = activeWins?.[pk]?.start5hMs;
      if (start5h && item.timestampMs >= start5h) {
        b.active5hPct = (b.active5hPct || 0) + item.quotaPct5h;
      }
      const start7d = activeWins?.[pk]?.start7dMs;
      if (start7d && item.timestampMs >= start7d && item.quotaPct7d > 0) {
        b.active7dPct = (b.active7dPct || 0) + item.quotaPct7d;
      }
    }

    if (item.turnIndex) {
      let ta = turnAgg.get(item.turnIndex);
      if (!ta) {
        ta = { pct5hByPool: Object.create(null), pct7dByPool: Object.create(null), fitted5h: 0, total5h: 0 };
        turnAgg.set(item.turnIndex, ta);
      }
      const key = pk === 'claude_gpt' ? 'claude_gpt' : 'gemini';
      ta.pct5hByPool[key] = (ta.pct5hByPool[key] || 0) + item.quotaPct5h;
      ta.total5h += item.quotaPct5h;
      if (item.quotaFitSource === 'fitted') ta.fitted5h += item.quotaPct5h;
      if (item.quotaPct7d > 0) {
        ta.pct7dByPool[key] = (ta.pct7dByPool[key] || 0) + item.quotaPct7d;
      }
    }
  };

  if (Array.isArray(invocations)) invocations.forEach(recordItem);
  if (Array.isArray(compactions)) compactions.forEach(recordItem);

  const turns = Array.isArray(telemetry.turns)
    ? telemetry.turns.map((u) => {
        const ta = turnAgg.get(u.turnIndex);
        if (!ta || !(ta.total5h > 0)) return u;
        const g5 = ta.pct5hByPool.gemini || 0;
        const c5 = ta.pct5hByPool.claude_gpt || 0;
        const domPool = c5 > g5 ? 'claude_gpt' : 'gemini';
        return {
          ...u,
          quotaPool: domPool,
          quotaPct5h: g5 + c5,
          quotaPct7d: (ta.pct7dByPool.gemini || 0) + (ta.pct7dByPool.claude_gpt || 0) || null,
          quotaFitSource: ta.fitted5h / ta.total5h >= 0.75 ? 'fitted' : 'prior',
        };
      })
    : telemetry.turns;

  let sessionQuota = null;
  for (const pk of ['gemini', 'claude_gpt']) {
    if (poolAcc[pk] && poolAcc[pk].pct5h > 0) {
      if (!sessionQuota) sessionQuota = {};
      sessionQuota[pk] = {
        pct5h: poolAcc[pk].pct5h,
        pct7d: poolAcc[pk].has7d ? poolAcc[pk].pct7d : null,
        active5hPct: poolAcc[pk].active5hPct,
        active7dPct: poolAcc[pk].active7dPct,
        isFitted: poolAcc[pk].fittedPct5h / poolAcc[pk].pct5h >= 0.75,
      };
    }
  }

  const summary = telemetry.summary && sessionQuota
    ? { ...telemetry.summary, sessionQuota }
    : telemetry.summary;

  return {
    ...telemetry,
    ...(summary ? { summary } : {}),
    ...(turns ? { turns } : {}),
    invocations,
    latest: decorate(telemetry.latest),
    latestSustained: decorate(telemetry.latestSustained),
    compactions,
  };
}
