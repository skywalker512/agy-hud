import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  KNOWN_MODEL_ENUMS,
  localDayKey,
  parseIsoMs,
  resolveQuotaCalibrationPath,
  SYNC_GRAPH_WARM_LIMIT,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from './constants.mjs';
import { isCascadeStatusActive } from './ls-client.mjs';
import { computeCallCost, poolKeyForGroupLabel, poolKeyForModel } from './pricing.mjs';
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
  const recentCutoffMs = Date.now() - 8 * 86_400_000;
  const recentCalls = [];

  let db;
  try {
    db = new DatabaseSync(conv.dbPath, { readOnly: true });
    try {
      const tm = db.prepare('SELECT trajectory_type FROM trajectory_meta LIMIT 1').get();
      if (tm && Number.isFinite(tm.trajectory_type)) trajectoryType = tm.trajectory_type;
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
    const compactionMetas = [];
    try {
      const firstPromptRow = db.prepare('SELECT step_payload FROM steps WHERE step_type = 14 AND step_payload IS NOT NULL ORDER BY idx ASC LIMIT 1').get();
      if (firstPromptRow?.step_payload) {
        const prompt = parseUserPromptPayload(firstPromptRow.step_payload);
        if (prompt?.preview) fallbackTitle = prompt.preview;
      }
      const stRows = db.prepare('SELECT idx, step_type, status, metadata FROM steps WHERE step_type IN (14, 15, 23) AND metadata IS NOT NULL').all();
      for (const s of stRows) {
        const meta = parseStepMetadata(s.metadata);
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

    const recordSpend = ({ modelId, modelDisplay, model, newIn, cachedIn, outTok, ts, countStats }) => {
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
      if (ts >= recentCutoffMs) {
        recentCalls.push({
          ts,
          poolKey: poolKeyForModel(modelId, modelDisplay, model),
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
        const ts = stepTs || conv.dbMtimeMs || conv.updatedMs || 0;
        if (ts > latestTsMs) latestTsMs = ts;

        recordSpend({
          modelId: parsed.modelId,
          modelDisplay: parsed.modelDisplay,
          model: parsed.model,
          newIn: parsed.newInput,
          cachedIn: parsed.cachedInput,
          outTok: parsed.outputTokens,
          ts,
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

  return {
    id: conv.id,
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

  return {
    summaries,
    byId,
    parentLinks,
    childrenByParent,
    sqTitleOverrides,
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

export function buildAccountHistory(graph) {
  const todayKey = localDayKey(Date.now());
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

  for (const s of graph.summaries) {
    totalCalls += s.calls;
    totalOutput += s.outputTokens;
    totalCostUSD += s.costUSD;
    totalSavedUSD += s.savedUSD;
    pricedCount += s.pricedCount;
    unpricedCount += s.unpricedCount;
    for (const [dk, b] of Object.entries(s.dayBuckets)) {
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
    }
  }

  return {
    dbCount: graph.totalDbFiles || graph.summaries.length,
    indexedCount: graph.summaries.length,
    indexing: Boolean(graph.indexing),
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
  };
}

const quotaCalibrationMemCache = new Map();
const PRIOR_U0 = 0.02;

function loadQuotaCalibration(calPath) {
  if (!calPath) return { version: 1, entries: {} };
  const cached = quotaCalibrationMemCache.get(calPath);
  if (cached) return cached;
  let parsed = null;
  try {
    if (existsSync(calPath)) {
      const raw = JSON.parse(readFileSync(calPath, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') {
        parsed = { version: 1, entries: { ...raw.entries } };
      }
    }
  } catch {
    /* corrupt calibration file; reset cleanly */
  }
  const store = parsed || { version: 1, entries: {} };
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

function sumPoolWindowSpend(summaries, poolKey, startMs, nowMs) {
  let estSpentUSD = 0;
  let estPricedCalls = 0;
  let estUnpricedCalls = 0;
  for (const s of summaries) {
    if (s.latestTsMs && s.latestTsMs < startMs) continue;
    for (const c of (s.recentCalls || [])) {
      if (c.ts < startMs || c.ts > nowMs) continue;
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

function updateCalibrationEntry(store, calKey, rawFull, usedPct, resetAtMs, nowMs) {
  if (!Number.isFinite(rawFull) || rawFull < 0.5 || rawFull > 50_000) return false;
  const prev = store.entries[calKey];
  if (!prev || !(prev.fullUSD > 0)) {
    store.entries[calKey] = {
      fullUSD: rawFull,
      samples: 1,
      lastResetAtMs: resetAtMs,
      updatedAtMs: nowMs,
    };
    return true;
  }
  let nextFull;
  let nextSamples = prev.samples || 1;
  if (prev.lastResetAtMs === resetAtMs) {
    const alpha = usedPct >= 10 ? 0.65 : 0.4;
    nextFull = prev.fullUSD * (1 - alpha) + rawFull * alpha;
  } else {
    nextFull = prev.fullUSD * 0.6 + rawFull * 0.4;
    nextSamples += 1;
  }
  const relChange = Math.abs(nextFull - prev.fullUSD) / prev.fullUSD;
  if (relChange > 0.005 || prev.lastResetAtMs !== resetAtMs) {
    store.entries[calKey] = {
      fullUSD: nextFull,
      samples: nextSamples,
      lastResetAtMs: resetAtMs,
      updatedAtMs: nowMs,
    };
    return true;
  }
  return false;
}

function findRatio5hTo7d(pools, storeEntries, tierKey) {
  const validRatio = (r) => Number.isFinite(r) && r >= 0.02 && r <= 0.8;
  const collectMedian = (ratios) => {
    if (!ratios.length) return null;
    const sorted = [...ratios].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

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
  const calRatios = [];
  for (const pair of byPool.values()) {
    if (pair['5h'] > 0 && pair['7d'] > 0) {
      const r = pair['5h'] / pair['7d'];
      if (validRatio(r)) calRatios.push(r);
    }
  }
  return collectMedian(calRatios);
}

export function attachQuotaBudgetEstimates(accountQuota, graph, opts = {}) {
  if (!accountQuota?.available || !Array.isArray(accountQuota.pools) || !accountQuota.pools.length) {
    return accountQuota;
  }
  const nowMs = opts.nowMs || Date.now();
  const calPath = opts.calibrationPath || resolveQuotaCalibrationPath();
  const store = loadQuotaCalibration(calPath);
  const summaries = graph?.summaries || [];
  const tierKey = [accountQuota.planName, accountQuota.tierName, accountQuota.teamsTier]
    .filter(Boolean)
    .join(':')
    .toLowerCase() || 'default';

  let calDirty = false;
  const metaByWin = new WeakMap();

  const pools = accountQuota.pools.map((p) => {
    const pk = poolKeyForGroupLabel(p.label);
    const calPoolKey = pk === 'other' ? `other:${String(p.label || '').toLowerCase()}` : pk;
    const windows = (p.windows || []).map((w) => {
      const spanMs = w.spanKey === '7d' ? 7 * 24 * 3_600_000 : (w.spanKey === '5h' ? 5 * 3_600_000 : 0);
      if (!spanMs || !w.resetAtMs || w.resetAtMs <= nowMs) return w;

      const startMs = w.resetAtMs - spanMs;
      const { estSpentUSD, estPricedCalls, estUnpricedCalls } = sumPoolWindowSpend(summaries, pk, startMs, nowMs);
      const totalCalls = estPricedCalls + estUnpricedCalls;
      const pricedCallRatio = totalCalls > 0 ? estPricedCalls / totalCalls : 1;
      const usedPct = Math.max(0, 100 - (w.remainingPct || 0));
      const u = usedPct / 100;
      const hasFrac = Math.abs((w.remainingPct || 0) - Math.round(w.remainingPct || 0)) > 1e-4;
      const minDirectPct = hasFrac ? 0.5 : 1.0;

      const calKey = `${tierKey}|${calPoolKey}|${w.spanKey}`;
      const priorEntry = store.entries[calKey];
      const priorBefore = (priorEntry && Number.isFinite(priorEntry.fullUSD) && priorEntry.fullUSD > 0)
        ? priorEntry.fullUSD
        : null;

      if (usedPct >= 3 && estSpentUSD > 0 && pricedCallRatio >= 0.85) {
        const rawFull = estSpentUSD / u;
        if (updateCalibrationEntry(store, calKey, rawFull, usedPct, w.resetAtMs, nowMs)) {
          calDirty = true;
        }
      }

      let estFullUSD = null;
      let estConfidence = null;
      if (usedPct >= 3 && estSpentUSD > 0) {
        estFullUSD = (priorBefore > 0 && usedPct < 10 && pricedCallRatio >= 0.85)
          ? blendPriorWithSpend(priorBefore, estSpentUSD, u, pricedCallRatio)
          : (estSpentUSD / u);
        estConfidence = 'high';
      } else if (priorBefore > 0) {
        estFullUSD = blendPriorWithSpend(priorBefore, estSpentUSD, u, pricedCallRatio);
        estConfidence = 'prior';
      } else if (usedPct >= minDirectPct && estSpentUSD > 0 && pricedCallRatio >= 0.5) {
        estFullUSD = estSpentUSD / u;
        estConfidence = 'low';
      }

      const outWin = {
        ...w,
        estSpentUSD,
        estFullUSD,
        estConfidence,
        estMinSamplePct: minDirectPct,
        estPricedCalls,
        estUnpricedCalls,
      };
      metaByWin.set(outWin, { u, pricedCallRatio });
      return outWin;
    });
    return { ...p, windows };
  });

  const ratio5hTo7d = findRatio5hTo7d(pools, store.entries, tierKey);
  if (ratio5hTo7d > 0) {
    for (const p of pools) {
      const w5 = p.windows?.find((w) => w.spanKey === '5h');
      const w7 = p.windows?.find((w) => w.spanKey === '7d');
      if (w5 && w5.estFullUSD === null && w7?.estFullUSD > 0) {
        const meta = metaByWin.get(w5) || { u: 0, pricedCallRatio: 1 };
        const crossPrior = w7.estFullUSD * ratio5hTo7d;
        w5.estFullUSD = blendPriorWithSpend(crossPrior, w5.estSpentUSD || 0, meta.u, meta.pricedCallRatio);
        w5.estConfidence = 'low';
      } else if (w7 && w7.estFullUSD === null && w5?.estFullUSD > 0) {
        const meta = metaByWin.get(w7) || { u: 0, pricedCallRatio: 1 };
        const crossPrior = w5.estFullUSD / ratio5hTo7d;
        w7.estFullUSD = blendPriorWithSpend(crossPrior, w7.estSpentUSD || 0, meta.u, meta.pricedCallRatio);
        w7.estConfidence = 'low';
      }
    }
  }

  if (calDirty) {
    saveQuotaCalibration(calPath, store);
  }
  return { ...accountQuota, pools };
}
