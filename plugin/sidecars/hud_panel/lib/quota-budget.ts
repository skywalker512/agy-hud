/**
 * Quota budget estimation, legacy calibration store, window runway forecasting,
 * and per-conversation / per-call quota usage decoration.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { localDayKey, resolveQuotaCalibrationPath, resolveQuotaFitPath } from './constants.ts';
import { poolKeyForGroupLabel, poolKeyForModel } from './pricing.ts';
import {
  buildAccountTierKey,
  evaluatePoolWindowResidual,
  getFamilyBaseRates,
  hasPoolPrior,
  ingestQuotaObservation,
  isCallOwnedByOtherAccount,
  loadQuotaFitStore,
  predictCallQuota,
  predictFamilyAggregateQuota,
  resolveAccountId,
  resolveActiveTierPrefix,
} from './quota-fitter.ts';
import type { QuotaFitStore, QuotaModelFitEntry, QuotaPoolState } from './quota-fitter.ts';

interface CalibrationEntry {
  fullUSD: number;
  samples: number;
  lastResetAtMs: number;
  lastUsedPct: number;
  lastLocalUSD: number;
  updatedAtMs: number;
}

interface CalibrationStore {
  version: number;
  entries: Record<string, CalibrationEntry>;
}

export interface AttachQuotaBudgetOptions {
  nowMs?: number;
  calibrationPath?: string;
  fitPath?: string;
}

export interface QuotaAttachOptions {
  fitPath?: string;
  nowMs?: number;
}

export interface ActivePoolWindowBounds {
  start5hMs: number | null;
  start7dMs: number | null;
}

const QUOTA_CAL_VERSION = 2;
const PRIOR_U0 = 0.02;
const REMOTE_GAP_RATIO_THRESHOLD = 0.72;
const DELTA_MIN_U = 0.015;
const COLD_PRIOR_MATCH_LO = 0.65;
const COLD_PRIOR_MATCH_HI = 1.25;
const HIST_LOOKBACK_DAYS = 30;
const HIST_MIN_ACTIVE_DAYS = 2;
const HIST_MIN_ACTIVE_HOURS = 2;
const RUNWAY_SHRINKAGE_TAU_7D_HR = 24.0;
const RUNWAY_SHRINKAGE_TAU_5H_HR = 1.0;

const quotaCalibrationMemCache = new Map<string, CalibrationStore>();

function loadQuotaCalibration(calPath: string): CalibrationStore {
  if (!calPath) return { version: QUOTA_CAL_VERSION, entries: {} };
  const cached = quotaCalibrationMemCache.get(calPath);
  if (cached) return cached;

  let parsed: CalibrationStore | null = null;
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

function sumPoolWindowSpend(
  summaries,
  poolKey,
  startMs,
  endMs,
  accountFilter?: { fitStore?: QuotaFitStore; activeAccountId?: string },
) {
  let estSpentUSD = 0;
  let estPricedCalls = 0;
  let estUnpricedCalls = 0;
  const activeAccountId = accountFilter?.activeAccountId || '';
  for (const s of summaries) {
    if (s.latestTsMs && s.latestTsMs < startMs) continue;
    for (const c of (s.recentCalls || [])) {
      if (c.ts < startMs || c.ts > endMs) continue;
      if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
      if (activeAccountId && isCallOwnedByOtherAccount(accountFilter?.fitStore, activeAccountId, c.ts, c.source)) {
        continue;
      }
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

function collectPoolWindowCalls(
  summaries: any[],
  poolKey: string,
  startMs: number,
  endMs: number,
  accountFilter?: { fitStore?: QuotaFitStore; activeAccountId?: string },
): any[] {
  const out: any[] = [];
  const activeAccountId = accountFilter?.activeAccountId || '';
  for (const s of summaries) {
    if (s.latestTsMs && s.latestTsMs < startMs) continue;
    for (const c of (s.recentCalls || [])) {
      if (c.ts < startMs || c.ts > endMs) continue;
      if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
      if (activeAccountId && isCallOwnedByOtherAccount(accountFilter?.fitStore, activeAccountId, c.ts, c.source)) {
        continue;
      }
      out.push(c);
    }
  }
  return out;
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

function findRatio5hTo7d(
  pools: any[],
  storeEntries: Record<string, CalibrationEntry>,
  tierKey: string,
  targetPoolKey = '',
  fitStore: QuotaFitStore | null = null,
): number | null {
  const validRatio = (r: number) => Number.isFinite(r) && r >= 0.02 && r <= 0.9;
  const collectMedian = (ratios: number[]) => {
    if (!ratios.length) return null;
    const sorted = [...ratios].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  if (targetPoolKey && fitStore?.pools) {
    const ps = fitStore.pools[`${tierKey}|${targetPoolKey}`];
    const gamma = ps?.gamma || ps?.fit?.gamma || 0;
    if (gamma > 0 && validRatio(1 / gamma)) return 1 / gamma;
  }

  const prefix = `${tierKey}|`;
  const byPool = new Map<string, { '5h'?: number; '7d'?: number }>();
  for (const [k, entry] of Object.entries(storeEntries || {})) {
    if (!k.startsWith(prefix) || !(entry?.fullUSD > 0)) continue;
    const rest = k.slice(prefix.length);
    const sep = rest.lastIndexOf('|');
    if (sep <= 0) continue;
    const pool = rest.slice(0, sep);
    const span = rest.slice(sep + 1);
    if (span !== '5h' && span !== '7d') continue;
    if (!byPool.has(pool)) byPool.set(pool, {});
    byPool.get(pool)![span] = entry.fullUSD;
  }

  if (targetPoolKey && byPool.has(targetPoolKey)) {
    const pair = byPool.get(targetPoolKey)!;
    if ((pair['5h'] ?? 0) > 0 && (pair['7d'] ?? 0) > 0 && validRatio(pair['5h']! / pair['7d']!)) {
      return pair['5h']! / pair['7d']!;
    }
  }

  const strongRatios: number[] = [];
  const allLiveRatios: number[] = [];
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

  const calRatios: number[] = [];
  for (const pair of byPool.values()) {
    if ((pair['5h'] ?? 0) > 0 && (pair['7d'] ?? 0) > 0) {
      const r = pair['5h']! / pair['7d']!;
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

function buildPoolFitSummary(ps: QuotaPoolState | undefined, calPoolKey: string) {
  const fit = ps?.fit;
  if (!fit) return null;

  const fitModelsList: any[] = Object.entries(fit.models || {}).map(([family, m]: [string, QuotaModelFitEntry]) => ({
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
  }));

  if (calPoolKey === 'gemini' && fit.refBeta > 0 && !fitModelsList.some((m) => m.family === 'gemini-4-hydrogen')) {
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

  return {
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
  };
}

interface HistoricalPace {
  histRatePerHr: number;
  activeHoursPerDay: number;
  activeDays: number;
  activeHours: number;
}

function computeHistoricalPace({
  histCalls,
  spanKey,
  startMs,
  callPct,
}: {
  histCalls: any[];
  spanKey: string;
  startMs: number;
  callPct: (c: any) => number;
}): HistoricalPace | null {
  if (!Array.isArray(histCalls) || !histCalls.length) return null;

  let totalHistPct = 0;
  let earliestTs = Infinity;
  const allActiveHours = new Set<number>();
  const hoursByDay = new Map<string, Set<number>>();

  for (const c of histCalls) {
    if (!(c?.ts > 0) || c.ts >= startMs) continue;
    const pct = callPct(c);
    if (!(pct > 0)) continue;
    totalHistPct += pct;
    if (c.ts < earliestTs) earliestTs = c.ts;
    const hourBucket = Math.floor(c.ts / 3_600_000);
    allActiveHours.add(hourBucket);
    const dk = localDayKey(c.ts);
    if (dk) {
      let daySet = hoursByDay.get(dk);
      if (!daySet) {
        daySet = new Set<number>();
        hoursByDay.set(dk, daySet);
      }
      daySet.add(hourBucket);
    }
  }

  const activeDays = hoursByDay.size;
  const activeHours = allActiveHours.size;
  if (activeDays < HIST_MIN_ACTIVE_DAYS || activeHours < HIST_MIN_ACTIVE_HOURS || !(totalHistPct > 0)) {
    return null;
  }

  let sumDailyHours = 0;
  for (const daySet of hoursByDay.values()) sumDailyHours += daySet.size;
  const activeHoursPerDay = Number((sumDailyHours / activeDays).toFixed(2));

  let histRatePerHr = 0;
  if (spanKey === '7d') {
    const earliestKey = localDayKey(earliestTs);
    let spanFromEarliest = (startMs - earliestTs) / 86_400_000;
    if (earliestKey) {
      const [ey, em, ed] = earliestKey.split('-').map(Number);
      const earliestDayStartMs = new Date(ey, em - 1, ed, 0, 0, 0).getTime();
      if (Number.isFinite(earliestDayStartMs) && startMs > earliestDayStartMs) {
        spanFromEarliest = (startMs - earliestDayStartMs) / 86_400_000;
      }
    }
    const spanDays = Math.min(HIST_LOOKBACK_DAYS, Math.max(activeDays, spanFromEarliest));
    const histDailyPct = totalHistPct / spanDays;
    histRatePerHr = histDailyPct / 24;
  } else {
    histRatePerHr = totalHistPct / activeHours;
  }

  if (!Number.isFinite(histRatePerHr) || !(histRatePerHr > 0.005)) {
    return null;
  }

  return {
    histRatePerHr,
    activeHoursPerDay,
    activeDays,
    activeHours,
  };
}

function computeWindowRunway({
  w,
  heldByWeekly,
  startMs,
  usedPct,
  callsInNow,
  histCalls = [] as any[],
  ps,
  nowMs,
  quotaSnapMs,
  fitStore,
  tierKey,
}) {
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
  const callPct = (c) => {
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
        return w.spanKey === '7d' ? (pred.quotaPct7d ?? 0) : pred.quotaPct5h;
      }
    }
    if ((c.costUSD || 0) > 0 && (w.estFullUSD || 0) > 0) {
      return (c.costUSD / w.estFullUSD) * 100;
    }
    return 0;
  };
  const sumCallsPct = (subset) => {
    let sum = 0;
    for (const c of subset) sum += callPct(c);
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

  const recentBurnPct = Math.min(effectiveUsedPct, Math.max(recentLocalPct, recentObsPct));
  const recentRatePerHr = recentBurnPct / recentSpanHr;
  const isRecentActive = recentBurnPct >= (w.spanKey === '7d' ? 0.15 : 0.05);
  const curRate = isRecentActive
    ? (0.6 * recentRatePerHr + 0.4 * avgRatePerHr)
    : avgRatePerHr;

  const histPace = computeHistoricalPace({
    histCalls,
    spanKey: w.spanKey,
    startMs,
    callPct,
  });

  let burnPctPerHour = curRate;
  let habitBlended = false;
  let habitWeight = 0;
  if (histPace) {
    const tauHr = w.spanKey === '7d' ? RUNWAY_SHRINKAGE_TAU_7D_HR : RUNWAY_SHRINKAGE_TAU_5H_HR;
    const wCur = elapsedHr / (elapsedHr + tauHr);
    habitWeight = 1 - wCur;
    burnPctPerHour = wCur * curRate + habitWeight * histPace.histRatePerHr;
    habitBlended = true;
  }

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
    ...(habitBlended && histPace
      ? {
          habitBlended: true,
          habitWeight,
          histBurnPctPerHour: histPace.histRatePerHr,
          activeHoursPerDay: histPace.activeHoursPerDay,
        }
      : {}),
  };
}

/**
 * Reconcile a window's cap & remote-burn estimate with the statistical fitter output.
 * Prevents cold-start (shortCleanCount === 0) external-burn deflation and single-sample
 * (shortCleanCount === 1) spike jumps while remaining adaptive for non-prior tiers.
 */
function applyFitterWindowEstimate({ w, ps, calPoolKey, snapMeta, fitEval, legacyRem, legacyRemErr }) {
  w.estPredLocalPct = fitEval.predLocalPct;
  w.estResidualPct = fitEval.signedResidualPct;
  w.estBandPct = fitEval.bandPct;

  const fit = ps.fit;
  const hasEmpiricalConsensus = fit.quality === 'high' || fit.shortCleanCount >= 2;

  if (fitEval.fullUSD > 0 && hasEmpiricalConsensus) {
    w.estFullUSD = fitEval.fullUSD;
    w.estConfidence = fit.quality === 'high' ? 'high' : 'low';
    w.estEffectiveSpentUSD = fitEval.effectiveLocalUSD;
    w.estRemotePct = fitEval.extPct;
    w.estRemotePctPlusMinus = fitEval.extPctPlusMinus;
    return { rem: fitEval.extUSD, remErr: fitEval.extUSDPlusMinus };
  }

  // Cold start (0 or 1 short clean windows): avoid naive long-window deflation when observed
  // k-weighted spend is consistent with the pool's structural prior, and stay adaptive if a
  // different account tier clearly falls outside the prior band.
  const effectiveRawFull = snapMeta.u > 0 && fitEval.effectiveSnapUSD > 0
    ? fitEval.effectiveSnapUSD / snapMeta.u
    : 0;
  const matchesPriorBand = !(effectiveRawFull > 0)
    || (effectiveRawFull >= fitEval.fullUSD * COLD_PRIOR_MATCH_LO
      && effectiveRawFull <= fitEval.fullUSD * COLD_PRIOR_MATCH_HI);

  if (fitEval.fullUSD > 0 && hasPoolPrior(calPoolKey) && matchesPriorBand) {
    w.estFullUSD = fitEval.fullUSD;
    w.estConfidence = 'low';
    w.estEffectiveSpentUSD = fitEval.effectiveLocalUSD;
    return { rem: 0, remErr: 0 };
  }

  if (effectiveRawFull > 0 && snapMeta.usedPct >= (w.estMinSamplePct || 0.5) && snapMeta.pricedCallRatio >= 0.5) {
    w.estFullUSD = effectiveRawFull;
    w.estConfidence = 'low';
    w.estEffectiveSpentUSD = fitEval.effectiveLocalUSD;
    return { rem: 0, remErr: 0 };
  }

  return { rem: legacyRem, remErr: legacyRemErr };
}

export function attachQuotaBudgetEstimates(accountQuota: any, graph: any, opts: AttachQuotaBudgetOptions = {}) {
  if (!accountQuota?.available || !Array.isArray(accountQuota.pools) || !accountQuota.pools.length) {
    return accountQuota;
  }
  const nowMs = opts.nowMs || Date.now();
  const quotaSnapMs = (accountQuota.fetchedAtMs > 0 && accountQuota.fetchedAtMs <= nowMs)
    ? accountQuota.fetchedAtMs
    : nowMs;
  const canPersistCal = !graph?.indexing;
  const calPath = opts.calibrationPath || resolveQuotaCalibrationPath();
  const fitPath = opts.fitPath
    || (opts.calibrationPath ? join(dirname(opts.calibrationPath), 'quota-model-fit.json') : resolveQuotaFitPath());
  const store = loadQuotaCalibration(calPath);
  const fitStore = ingestQuotaObservation(accountQuota, graph, { fitPath, nowMs: quotaSnapMs });
  const summaries = graph?.summaries || [];
  const activeAccountId = resolveAccountId(accountQuota);
  const accountFilter = activeAccountId ? { fitStore, activeAccountId } : undefined;
  const tierKey = buildAccountTierKey(accountQuota);

  let calDirty = false;
  const metaByWin = new WeakMap();
  const poolCalKeyMap = new WeakMap();

  const pools = accountQuota.pools.map((p) => {
    const pk = poolKeyForGroupLabel(p.label);
    const calPoolKey = pk === 'other' ? `other:${String(p.label || '').toLowerCase()}` : pk;
    const ps = fitStore?.pools?.[`${tierKey}|${calPoolKey}`];
    // Once the statistical fitter tracks this pool, quota-model-fit.json is the single source of truth;
    // do not write into legacy quota-calibration.json so the two stores never fight each other.
    const hasFitter = Boolean(ps?.fit);

    const windows = (p.windows || []).map((w) => {
      const spanMs = w.spanKey === '7d' ? 7 * 24 * 3_600_000 : (w.spanKey === '5h' ? 5 * 3_600_000 : 0);
      if (!spanMs || !w.resetAtMs || w.resetAtMs <= nowMs) return w;

      const startMs = w.resetAtMs - spanMs;
      const winSum = sumPoolWindowSpend(summaries, pk, startMs, nowMs, accountFilter);
      const snapSum = quotaSnapMs < nowMs
        ? sumPoolWindowSpend(summaries, pk, startMs, quotaSnapMs, accountFilter)
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

      if (canPersistCal && !hasFitter && usedPct >= 3 && snapPricedRatio >= 0.85) {
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

      let estFullUSD: number | null = null;
      let estConfidence: string | null = null;
      if (priorBefore !== null && !rawMatchesPrior) {
        estFullUSD = effectivePrior;
        estConfidence = 'prior';
      } else if (usedPct >= 3 && localAtSnapUSD > 0) {
        estFullUSD = (priorBefore !== null && priorBefore > 0 && usedPct < 10 && snapPricedRatio >= 0.85)
          ? blendPriorWithSpend(priorBefore, localAtSnapUSD, u, snapPricedRatio)
          : rawFull;
        estConfidence = 'high';
      } else if (priorBefore !== null && priorBefore > 0) {
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

    const fitSummary = buildPoolFitSummary(ps, calPoolKey);
    const outPool = { ...p, windows, ...(fitSummary ? { fitSummary } : {}) };
    poolCalKeyMap.set(outPool, calPoolKey);
    return outPool;
  });

  // Cross-window fallback for windows lacking a direct estimate
  for (const p of pools) {
    const calPoolKey = poolCalKeyMap.get(p) || '';
    const ratio5hTo7d = findRatio5hTo7d(pools, store.entries, tierKey, calPoolKey, fitStore);
    if (ratio5hTo7d === null || !(ratio5hTo7d > 0)) continue;
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

  let remoteActiveWindowUSD = 0;
  let remoteActivePlusMinusUSD = 0;
  let remote5hUSD = 0;
  let remote7dUSD = 0;

  const histStartMs = nowMs - HIST_LOOKBACK_DAYS * 86_400_000;

  for (const p of pools) {
    const calPoolKey = poolCalKeyMap.get(p) || '';
    const pk = poolKeyForGroupLabel(p.label);
    const poolHistCalls = collectPoolWindowCalls(summaries, pk, histStartMs, nowMs);
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
      let callsInNow: any[] | null = null;

      if (ps?.fit && snapMeta) {
        const callsInSnap = collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, quotaSnapMs, accountFilter);
        callsInNow = quotaSnapMs < nowMs
          ? collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, nowMs, accountFilter)
          : callsInSnap;
        const fitEval = evaluatePoolWindowResidual({
          poolState: ps,
          spanKey: w.spanKey,
          usedPct: snapMeta.usedPct,
          callsInSnap,
          callsInNow,
          poolKind: calPoolKey,
        });
        if (fitEval) {
          ({ rem, remErr } = applyFitterWindowEstimate({
            w,
            ps,
            calPoolKey,
            snapMeta,
            fitEval,
            legacyRem: rem,
            legacyRemErr: remErr,
          }));
        }
      }

      if (snapMeta) {
        if (!callsInNow) {
          callsInNow = collectPoolWindowCalls(summaries, snapMeta.pk, snapMeta.startMs, nowMs, accountFilter);
        }
        const rw = computeWindowRunway({
          w,
          heldByWeekly: Boolean(p.heldByWeekly),
          startMs: snapMeta.startMs,
          usedPct: snapMeta.usedPct,
          callsInNow,
          histCalls: poolHistCalls,
          ps,
          nowMs,
          quotaSnapMs,
          fitStore,
          tierKey,
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

export function extractActivePoolWindows(
  accountQuota: any,
  nowMs = Date.now(),
  fitStore: QuotaFitStore | null = null,
  tierPrefix = 'default|',
): Record<string, ActivePoolWindowBounds> | null {
  const out: Record<string, ActivePoolWindowBounds> = Object.create(null);
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

function createPoolQuotaAccumulator(activePoolWindows, pk) {
  return {
    pct5h: 0,
    fittedPct5h: 0,
    pct7d: 0,
    has7d: false,
    active5hPct: activePoolWindows?.[pk]?.start5hMs ? 0 : null,
    active7dPct: activePoolWindows?.[pk]?.start7dMs ? 0 : null,
  };
}

function finalizePoolQuotaMap(acc) {
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

export function computeSummaryQuotaUsage(
  summary: any,
  fitStore: QuotaFitStore | null,
  tierPrefix = 'default|',
  activePoolWindows: Record<string, ActivePoolWindowBounds> | null = null,
) {
  if (!summary) return null;
  const acc: Record<string, any> = Object.create(null);
  const ensurePool = (pk: string) => {
    if (!acc[pk]) acc[pk] = createPoolQuotaAccumulator(activePoolWindows, pk);
    return acc[pk];
  };

  const addPred = (pred: any) => {
    if (!pred || !(pred.quotaPct5h > 0)) return;
    const b = ensurePool(pred.quotaPool);
    b.pct5h += pred.quotaPct5h;
    if (pred.quotaFitSource === 'fitted') b.fittedPct5h += pred.quotaPct5h;
    if (pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
      b.pct7d += pred.quotaPct7d;
      b.has7d = true;
    }
  };

  const famEntries = summary.familyUsage ? (Object.entries(summary.familyUsage) as [string, any][]) : [];
  if (famEntries.length > 0) {
    for (const [family, fu] of famEntries) {
      addPred(predictFamilyAggregateQuota(
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
      ));
    }
  } else if (Array.isArray(summary.recentCalls) && summary.recentCalls.length > 0) {
    for (const c of summary.recentCalls) {
      addPred(predictFamilyAggregateQuota(
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
      ));
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

  return finalizePoolQuotaMap(acc);
}

export function attachGraphQuotaSummaries({
  conversations = [],
  sessionInfo = null,
  graph = null,
  accountQuota = null,
  opts = {},
}: {
  conversations?: any[];
  sessionInfo?: any;
  graph?: any;
  accountQuota?: any;
  opts?: QuotaAttachOptions;
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

export function attachTelemetryQuotaPredictions(telemetry: any, accountQuota: any, opts: QuotaAttachOptions = {}) {
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

  const turnAgg = new Map();
  const poolAcc = Object.create(null);

  const recordItem = (item) => {
    if (!item || !(item.quotaPct5h > 0)) return;
    const pk = item.quotaPool || poolKeyForModel(item.modelId, item.modelDisplay, item.model);
    if (pk === 'gemini' || pk === 'claude_gpt') {
      if (!poolAcc[pk]) poolAcc[pk] = createPoolQuotaAccumulator(activeWins, pk);
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

  const sessionQuota = finalizePoolQuotaMap(poolAcc);
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
