/**
 * Conversation SQLite summarization, parent/subagent/Side-Q graph assembly,
 * target conversation selection, and multi-store account spend & activity heatmap.
 *
 * Quota budget estimation & decoration live in ./quota-budget.mjs and are re-exported
 * below for backwards compatibility.
 */
import { DatabaseSync } from 'node:sqlite';
import {
  KNOWN_MODEL_ENUMS,
  localDayKey,
  parseIsoMs,
  SYNC_GRAPH_WARM_LIMIT,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from './constants.mjs';
import { isCascadeStatusActive } from './ls-client.mjs';
import { computeCallCost } from './pricing.mjs';
import { computeBaseReferenceUSD } from './quota-solver.mjs';
import {
  iterFields,
  parseAnnotationPbtxt,
  parseGenRow,
  parseStepMetadata,
  parseUserPromptPayload,
} from './protobuf.mjs';

export {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  computeSummaryQuotaUsage,
  extractActivePoolWindows,
} from './quota-budget.mjs';

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

