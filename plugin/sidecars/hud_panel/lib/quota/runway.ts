/**
 * Historical pace estimation, quota window runway forecasting, and token capacity projection.
 */
import { localDayKey } from '../constants.ts';
import { hasTrustedPoolFit, predictFamilyAggregateQuota } from '../quota-fitter.ts';
import type { QuotaFitStore, QuotaPoolState } from '../quota-fitter.ts';

export const HIST_LOOKBACK_DAYS = 30;
const HIST_MIN_ACTIVE_DAYS = 2;
const HIST_MIN_ACTIVE_HOURS = 2;
const ACCOUNT_HIST_MIN_5H_COVERED_HR = 1.0;
const ACCOUNT_HIST_MIN_7D_COVERED_HR = 24.0;
const HIST_EWMA_HALF_LIFE_5H_DAYS = 4.0;
const HIST_EWMA_HALF_LIFE_7D_DAYS = 14.0;
const REMOTE_ACTIVITY_LOOKBACK_MS = 14 * 86_400_000;
const RUNWAY_SHRINKAGE_TAU_7D_HR = 24.0;
const RUNWAY_SHRINKAGE_TAU_5H_HR = 1.0;
const TOKEN_CAP_7D_MIN_CALLS = 5;
const TOKEN_CAP_7D_MIN_TOKENS = 50_000;

export interface QuotaWindowTokenCapacity {
  remainingTotalTokens: number;
  fullTotalTokens: number;
  remainingNewInputTokens: number;
  fullNewInputTokens: number;
  remainingCachedTokens: number;
  fullCachedTokens: number;
  remainingOutputTokens: number;
  fullOutputTokens: number;
  cacheHitPct: number;
  outSharePct: number;
  sampleCalls: number;
  basisWindow: '7d' | '30d';
  isProvisional: boolean;
}

export interface HistoricalPace {
  histRatePerHr: number;
  activeHoursPerDay: number;
  activeDays: number;
  activeHours: number;
  source: 'account' | 'local';
}

function computeAccountActiveHoursPerDay(ps: QuotaPoolState | undefined, startMs: number): number {
  const burnLog = ps?.burnLog;
  if (!Array.isArray(burnLog) || !burnLog.length) return 0;
  const minTs = startMs - HIST_LOOKBACK_DAYS * 86_400_000;
  const hoursByDay = new Map<string, Set<number>>();
  for (const e of burnLog) {
    if (!(e?.t1 > e?.t0) || e.t0 >= startMs || e.t1 < minTs) continue;
    // Skip coarse sleep/anchor spans (>2h) so offline gaps never inflate active hours/day.
    if (e.t1 - e.t0 > 2 * 3_600_000) continue;
    if (!(e.du5 > 0) && !((e.du7 ?? 0) > 0)) continue;
    const midTs = Math.min(startMs - 1, Math.floor((e.t0 + e.t1) / 2));
    const hourBucket = Math.floor(midTs / 3_600_000);
    const dk = localDayKey(midTs);
    if (!dk) continue;
    let daySet = hoursByDay.get(dk);
    if (!daySet) {
      daySet = new Set<number>();
      hoursByDay.set(dk, daySet);
    }
    daySet.add(hourBucket);
  }
  if (hoursByDay.size < HIST_MIN_ACTIVE_DAYS) return 0;
  let sumDailyHours = 0;
  for (const daySet of hoursByDay.values()) sumDailyHours += daySet.size;
  return Number((sumDailyHours / hoursByDay.size).toFixed(2));
}

function computeAccountHistoricalPace({
  ps,
  spanKey,
  startMs,
  resetAtMs,
}: {
  ps: QuotaPoolState | undefined;
  spanKey: string;
  startMs: number;
  resetAtMs: number;
}): HistoricalPace | null {
  if (!ps) return null;
  const lookbackStartMs = startMs - HIST_LOOKBACK_DAYS * 86_400_000;

  if (spanKey === '7d') {
    const peaks = ps.winPeaks7d;
    if (!Array.isArray(peaks) || !peaks.length) return null;
    let weightedPct = 0;
    let weightedHr = 0;
    let totalCoveredHr = 0;
    let windowCount = 0;
    for (const p of peaks) {
      if (!(p?.resetAtMs > 0) || !(p.maxUsedPct > 0)) continue;
      if (Math.abs(p.resetAtMs - resetAtMs) <= 60_000) continue;
      if (p.resetAtMs > startMs + 60_000 || p.resetAtMs < lookbackStartMs) continue;
      const wStart = p.resetAtMs - 7 * 24 * 3_600_000;
      const endObs = p.maxUsedPct >= 99.5 && p.peakReachedAtMs ? p.peakReachedAtMs : p.lastSeenMs;
      const coveredHr = Math.min(168, Math.max(1, (endObs - wStart) / 3_600_000));
      const ageDays = Math.max(0, (startMs - p.resetAtMs) / 86_400_000);
      const decay = Math.pow(0.5, ageDays / HIST_EWMA_HALF_LIFE_7D_DAYS);
      weightedPct += decay * p.maxUsedPct;
      weightedHr += decay * coveredHr;
      totalCoveredHr += coveredHr;
      windowCount++;
    }
    if (windowCount < 1 || totalCoveredHr < ACCOUNT_HIST_MIN_7D_COVERED_HR || !(weightedPct > 0) || !(weightedHr > 0)) {
      return null;
    }
    const histRatePerHr = weightedPct / weightedHr;
    if (!Number.isFinite(histRatePerHr) || !(histRatePerHr > 0.005)) return null;
    return {
      histRatePerHr,
      activeHoursPerDay: computeAccountActiveHoursPerDay(ps, startMs),
      activeDays: Math.max(1, Math.round(totalCoveredHr / 24)),
      activeHours: Math.round(totalCoveredHr),
      source: 'account',
    };
  }

  const peaks = ps.winPeaks5h;
  if (!Array.isArray(peaks) || !peaks.length) return null;
  let weightedPct = 0;
  let weightedHr = 0;
  let totalCoveredHr = 0;
  let windowCount = 0;
  for (const p of peaks) {
    if (!(p?.resetAtMs > 0) || !(p.maxUsedPct > 0)) continue;
    if (Math.abs(p.resetAtMs - resetAtMs) <= 60_000) continue;
    if (p.resetAtMs > startMs + 60_000 || p.resetAtMs < lookbackStartMs) continue;
    const wStart = p.resetAtMs - 5 * 3_600_000;
    const rawElapsedMs = p.lastSeenMs - wStart;
    if (rawElapsedMs < 15 * 60_000 && p.maxUsedPct < 1.0) continue;
    const endObs = p.maxUsedPct >= 99.5 && p.peakReachedAtMs ? p.peakReachedAtMs : p.lastSeenMs;
    const coveredHr = Math.min(5, Math.max(0.5, (endObs - wStart) / 3_600_000));
    const ageDays = Math.max(0, (startMs - p.resetAtMs) / 86_400_000);
    const decay = Math.pow(0.5, ageDays / HIST_EWMA_HALF_LIFE_5H_DAYS);
    weightedPct += decay * p.maxUsedPct;
    weightedHr += decay * coveredHr;
    totalCoveredHr += coveredHr;
    windowCount++;
  }
  if (windowCount < 1 || totalCoveredHr < ACCOUNT_HIST_MIN_5H_COVERED_HR || !(weightedPct > 0) || !(weightedHr > 0)) {
    return null;
  }
  const histRatePerHr = weightedPct / weightedHr;
  if (!Number.isFinite(histRatePerHr) || !(histRatePerHr > 0.005)) return null;
  return {
    histRatePerHr,
    activeHoursPerDay: computeAccountActiveHoursPerDay(ps, startMs),
    activeDays: windowCount,
    activeHours: Math.round(totalCoveredHr),
    source: 'account',
  };
}

function computeLocalHistoricalPace({
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
    source: 'local',
  };
}

function computeHistoricalPace({
  ps,
  histCalls,
  spanKey,
  startMs,
  resetAtMs,
  callPct,
  allowLocalFallback = true,
}: {
  ps: QuotaPoolState | undefined;
  histCalls: any[];
  spanKey: string;
  startMs: number;
  resetAtMs: number;
  callPct: (c: any) => number;
  allowLocalFallback?: boolean;
}): HistoricalPace | null {
  const accountPace = computeAccountHistoricalPace({ ps, spanKey, startMs, resetAtMs });
  if (accountPace) {
    const localActiveHours = accountPace.activeHoursPerDay > 0
      ? accountPace.activeHoursPerDay
      : (computeLocalHistoricalPace({ histCalls, spanKey, startMs, callPct })?.activeHoursPerDay || 0);
    return {
      ...accountPace,
      activeHoursPerDay: localActiveHours,
    };
  }
  if (!allowLocalFallback) return null;
  return computeLocalHistoricalPace({ histCalls, spanKey, startMs, callPct });
}

export function computeWindowRunway({
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
  remoteUSD = 0,
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
  const burnLog = Array.isArray(ps?.burnLog) ? ps.burnLog : [];
  let firstBurnLogT0 = Infinity;

  if (burnLog.length > 0) {
    const has7dBurnEntries = burnLog.some((e) => typeof e.du7 === 'number' && e.du7 > 0);
    for (const e of burnLog) {
      if (!(e.t1 > e.t0)) continue;
      let entryDu = 0;
      if (w.spanKey === '5h') {
        if (!(e.du5 > 0)) continue;
        if (e.w5ResetAtMs && Math.abs(e.w5ResetAtMs - w.resetAtMs) >= 60_000) continue;
        if (!e.w5ResetAtMs && e.t0 < startMs - 60_000) continue;
        entryDu = e.du5;
      } else {
        if (e.w7ResetAtMs && Math.abs(e.w7ResetAtMs - w.resetAtMs) >= 60_000) continue;
        if (!e.w7ResetAtMs && e.t0 < startMs - 60_000) continue;
        entryDu = typeof e.du7 === 'number'
          ? e.du7
          : (!has7dBurnEntries && gamma > 0 ? (e.du5 || 0) / gamma : 0);
      }
      if (!(entryDu > 0)) continue;
      if (e.t0 < firstBurnLogT0) firstBurnLogT0 = e.t0;
      if (!(e.t1 > tRecent0) || !(e.t0 < nowMs)) continue;
      const overlapMs = Math.max(0, Math.min(nowMs, e.t1) - Math.max(tRecent0, e.t0));
      const frac = Math.min(1, overlapMs / Math.max(1000, e.t1 - e.t0));
      recentObsPct += entryDu * frac;
    }
  }

  // Seamless upgrade fallback: stitch pre-burnLog ps.samples strictly before firstBurnLogT0.
  const sampleEndCap = Math.min(nowMs, firstBurnLogT0);
  if (sampleEndCap > tRecent0) {
    for (const s of ps?.samples || []) {
      if (!(s.t1 > tRecent0) || !(s.t0 < sampleEndCap)) continue;
      if (w.spanKey === '5h' && (s.source === '7d_scaled' || s.t0 < startMs - 60_000)) continue;
      const sampleDu = w.spanKey === '7d'
        ? (typeof s.du7 === 'number' ? s.du7 : (gamma > 0 ? (s.du5 || 0) / gamma : 0))
        : (s.du5 || 0);
      if (!(sampleDu > 0)) continue;
      const overlapMs = Math.max(0, Math.min(sampleEndCap, s.t1) - Math.max(tRecent0, s.t0));
      const frac = Math.min(1, overlapMs / Math.max(1000, s.t1 - s.t0));
      recentObsPct += sampleDu * frac;
    }
  }

  const recentBurnPct = Math.min(effectiveUsedPct, Math.max(recentLocalPct, recentObsPct));
  const recentRatePerHr = recentBurnPct / recentSpanHr;
  const isRecentActive = recentBurnPct >= (w.spanKey === '7d' ? 0.15 : 0.05);
  const curRate = isRecentActive
    ? (0.6 * recentRatePerHr + 0.4 * avgRatePerHr)
    : avgRatePerHr;

  const hasRemoteActivity = remoteUSD > 0
    || burnLog.some((e) => (
      e.remoteOnly === true
      && e.t1 >= nowMs - REMOTE_ACTIVITY_LOOKBACK_MS
      && (w.spanKey === '5h' ? e.du5 > 0 : (e.du7 ?? 0) > 0)
    ));
  const localWindowPct = sumCallsPct(callsInNow);
  const isProvisionalLocalInflated = !hasTrustedPoolFit(ps?.fit, 2)
    && localWindowPct > Math.max(effectiveUsedPct * 1.35, effectiveUsedPct + 1.0);

  const histPace = computeHistoricalPace({
    ps,
    histCalls,
    spanKey: w.spanKey,
    startMs,
    resetAtMs: w.resetAtMs,
    callPct,
    allowLocalFallback: !hasRemoteActivity && !isProvisionalLocalInflated,
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
          habitSource: histPace.source,
          habitWeight,
          histBurnPctPerHour: histPace.histRatePerHr,
          activeHoursPerDay: histPace.activeHoursPerDay,
        }
      : {}),
  };
}

export function computeWindowTokenCapacity({
  w,
  poolHistCalls,
  ps,
  fitStore,
  tierKey,
  nowMs,
}: {
  w: any;
  poolHistCalls: any[];
  ps: QuotaPoolState | undefined;
  fitStore: QuotaFitStore | null | undefined;
  tierKey: string;
  nowMs: number;
}): QuotaWindowTokenCapacity | null {
  if (!Array.isArray(poolHistCalls) || !poolHistCalls.length) return null;

  const cutoff7d = nowMs - 7 * 86_400_000;
  const calls7d: any[] = [];
  let tok7d = 0;
  const calls30d: any[] = [];
  for (const c of poolHistCalls) {
    const tot = Math.max(0, c?.newInput || 0) + Math.max(0, c?.cachedInput || 0) + Math.max(0, c?.outputTokens || 0);
    if (!(tot > 0)) continue;
    calls30d.push(c);
    if ((c.ts || 0) >= cutoff7d) {
      calls7d.push(c);
      tok7d += tot;
    }
  }
  if (!calls30d.length) return null;

  const use7d = calls7d.length >= TOKEN_CAP_7D_MIN_CALLS && tok7d >= TOKEN_CAP_7D_MIN_TOKENS;
  const basisCalls = use7d ? calls7d : calls30d;
  const basisWindow: '7d' | '30d' = use7d ? '7d' : '30d';

  const fit = ps?.fit;
  const gamma = fit?.gamma || ps?.gamma || null;
  const fitFullForSpan = w.spanKey === '7d' ? (fit?.full7dUSD || 0) : (fit?.full5hUSD || 0);
  const winFullUSD = typeof w.estFullUSD === 'number' && w.estFullUSD > 0 ? w.estFullUSD : 0;
  const canUseFitterPred = Boolean(
    fit
    && fitFullForSpan > 0
    && (hasTrustedPoolFit(fit, 2) || !(winFullUSD > 0) || Math.abs(winFullUSD - fitFullForSpan) / fitFullForSpan <= 0.05),
  );
  const tierPrefix = `${tierKey}|`;

  let sumPct = 0;
  let sumNewIn = 0;
  let sumCachedIn = 0;
  let sumOut = 0;
  let sampleCalls = 0;

  for (const c of basisCalls) {
    const newIn = Math.max(0, c.newInput || 0);
    const cachedIn = Math.max(0, c.cachedInput || 0);
    const outTok = Math.max(0, c.outputTokens || 0);
    const totTok = newIn + cachedIn + outTok;
    if (!(totTok > 0)) continue;

    let pct = 0;
    if (canUseFitterPred) {
      const baseUSD = typeof c.baseUSD === 'number' ? c.baseUSD : 0;
      if (baseUSD > 0) {
        const pred = predictFamilyAggregateQuota(
          {
            poolKey: c.poolKey,
            family: c.family || '',
            baseUSD,
            inM: newIn / 1e6,
            caM: cachedIn / 1e6,
            outM: outTok / 1e6,
          },
          fitStore ?? null,
          tierPrefix,
        );
        if (pred && pred.quotaPct5h > 0) {
          pct = w.spanKey === '7d'
            ? (pred.quotaPct7d && pred.quotaPct7d > 0
                ? pred.quotaPct7d
                : (gamma && gamma > 0 ? pred.quotaPct5h / gamma : 0))
            : pred.quotaPct5h;
        }
      }
    }
    if (!(pct > 0) && c.priced && (c.costUSD || 0) > 0 && winFullUSD > 0) {
      pct = (c.costUSD / winFullUSD) * 100;
    }
    if (!(pct > 0)) continue;

    sumPct += pct;
    sumNewIn += newIn;
    sumCachedIn += cachedIn;
    sumOut += outTok;
    sampleCalls += 1;
  }

  const sumTotal = sumNewIn + sumCachedIn + sumOut;
  if (sampleCalls === 0 || !(sumPct > 0) || !(sumTotal > 0)) return null;

  const sumPrompt = sumNewIn + sumCachedIn;
  const cacheHitPct = sumPrompt > 0 ? (sumCachedIn / sumPrompt) * 100 : 0;
  const outSharePct = (sumOut / sumTotal) * 100;
  const scaleFull = 100 / sumPct;
  const remFrac = Math.max(0, Math.min(100, w.remainingPct ?? 0)) / 100;

  const fullTotalTokens = Math.round(sumTotal * scaleFull);
  const fullNewInputTokens = Math.round(sumNewIn * scaleFull);
  const fullCachedTokens = Math.round(sumCachedIn * scaleFull);
  const fullOutputTokens = Math.round(sumOut * scaleFull);
  const isProvisional = !(w.estConfidence === 'high' || (hasTrustedPoolFit(fit, 2) && fit?.quality === 'high'));

  return {
    remainingTotalTokens: Math.round(fullTotalTokens * remFrac),
    fullTotalTokens,
    remainingNewInputTokens: Math.round(fullNewInputTokens * remFrac),
    fullNewInputTokens,
    remainingCachedTokens: Math.round(fullCachedTokens * remFrac),
    fullCachedTokens,
    remainingOutputTokens: Math.round(fullOutputTokens * remFrac),
    fullOutputTokens,
    cacheHitPct: Number(cacheHitPct.toFixed(1)),
    outSharePct: Number(outSharePct.toFixed(2)),
    sampleCalls,
    basisWindow,
    isProvisional,
  };
}
