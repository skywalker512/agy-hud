/**
 * Gemini Pulse local 7-day baseline aggregation & TTFT root-cause attribution.
 *
 * Extracted from `../gemini-pulse.ts` to keep local statistical baseline &
 * attribution logic cleanly decoupled from remote feed fetching and disk caching.
 */
import {
  GEMINI_PULSE_MODELS,
  roundNum,
  type GcpActiveIncident,
  type GeminiEndpointPulse,
  type GeminiModelTimeSeries,
  type PulseHealthStatus,
} from '../pulse-core.ts';
import { resolveModelFamily } from '../quota-solver.ts';

const LOCAL_BASELINE_DAYS = 7;

export type TtftVerdictKind =
  | 'normal'
  | 'upstream_degraded'
  | 'cache_miss'
  | 'large_context'
  | 'local_concurrency'
  | 'account_or_network';

export interface GeminiModelGlobalPulse {
  family: string;
  slug: string;
  permaslug?: string;
  label: string;
  status: PulseHealthStatus;
  p50TtftSec: number | null;
  p75TtftSec: number | null;
  p90TtftSec: number | null;
  p95TtftSec?: number | null;
  p99TtftSec?: number | null;
  meanTtftSec?: number | null;
  p50Tps: number | null;
  p90Tps: number | null;
  cacheHitPct: number | null;
  uptime5mPct?: number | null;
  uptime30mPct: number | null;
  uptime1dPct?: number | null;
  toolCallErrorPct?: number | null;
  toolCalls24h?: number;
  reasoningSharePct?: number | null;
  avgPromptTokens?: number | null;
  avgOutputTokens?: number | null;
  effectiveInputPrice?: number | null;
  effectiveOutputPrice?: number | null;
  requestCount30m: number;
  windowMinutes: number;
  primaryProvider: string;
  degradedProviders: string[];
  /** Individual OpenRouter upstream provider endpoints (30m window) for Arena comparison */
  endpoints?: GeminiEndpointPulse[];
  /** OpenRouter historical time-series (7d TTFT/E2E/TPS/Cache/Uptime + 24h Uptime + 48h 30m ring buffer) */
  series?: GeminiModelTimeSeries;
  /** Present when local history exists for this family */
  local?: GeminiLocalBaseline | null;
}

export interface GeminiLocalDailyPoint {
  x: string;
  calls: number;
  p50TtftSec: number | null;
  p50Tps: number | null;
  cacheHitPct: number | null;
}

export interface GeminiLocalCtxBucket {
  key: '<50k' | '50k-100k' | '100k-200k' | '>=200k';
  calls: number;
  p50TtftSec: number | null;
  p50Tps: number | null;
}

export interface GeminiLocalBaseline {
  calls7d: number;
  p50TtftSec: number | null;
  p90TtftSec: number | null;
  hitP50TtftSec: number | null;
  missP50TtftSec: number | null;
  p50Tps: number | null;
  cacheHitPct: number | null;
  avgCtxTokens?: number | null;
  medianCtxTokens?: number | null;
  /** Context-matched (<100k) 7d local stats aligned with OpenRouter's 46k-80k global traffic */
  matched100k?: {
    calls: number;
    p50TtftSec: number | null;
    p50Tps: number | null;
    cacheHitPct: number | null;
  } | null;
  /** 7d local calls stratified across 4 prompt context size bands */
  ctxBuckets?: GeminiLocalCtxBucket[];
  /** Strict 30m window aligned with OpenRouter 30m stats */
  calls30m: number;
  p50Ttft30mSec: number | null;
  p50Tps30m: number | null;
  cacheHit30mPct: number | null;
  /** Rolling 24h local window */
  calls24h: number;
  p50Ttft24hSec: number | null;
  p50Tps24h: number | null;
  cacheHit24hPct: number | null;
  /** Daily UTC buckets over the last 7 days aligned with OpenRouter 7d comparison curves */
  daily7d?: GeminiLocalDailyPoint[];
  /** Context-matched (<100k) daily UTC buckets for apples-to-apples comparison vs OpenRouter */
  daily7dMatched?: GeminiLocalDailyPoint[];
}

export interface TtftAttribution {
  verdict: TtftVerdictKind;
  family: string;
  label: string;
  currentTtftSec: number;
  currentTps: number;
  currentCachePct: number | null;
  currentNewInput: number;
  currentCtxTokens?: number;
  globalAvgCtxTokens?: number | null;
  inFlightCount: number;
  localP50TtftSec: number | null;
  localP90TtftSec: number | null;
  localBucket: 'hit' | 'miss' | 'all' | '<50k' | '50k-100k' | '100k-200k' | '>=200k';
  globalP50TtftSec: number | null;
  globalP90TtftSec: number | null;
  globalP50Tps: number | null;
  globalCachePct: number | null;
  globalUptime30mPct: number | null;
  globalStatus: PulseHealthStatus | 'unknown';
  globalRequests30m: number;
  activeIncidentCount: number;
}

export interface GeminiPulseCacheFile {
  version: number;
  enabled: boolean;
  fetchedAtMs: number;
  checkedAtMs?: number;
  lastAttemptMs?: number;
  failCount?: number;
  models: GeminiModelGlobalPulse[];
  incidents: GcpActiveIncident[];
  error?: string;
}

export interface GeminiPulseSnapshot {
  enabled: boolean;
  available: boolean;
  loading: boolean;
  stale: boolean;
  fetchedAtMs: number;
  overallStatus: PulseHealthStatus | 'unknown';
  models: GeminiModelGlobalPulse[];
  incidents: GcpActiveIncident[];
  activeFamily: string;
  activeModel: GeminiModelGlobalPulse | null;
  attribution: TtftAttribution | null;
  error?: string;
}

function quantile(sortedAsc: number[], q: number): number | null {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((sortedAsc.length - 1) * q)));
  return sortedAsc[idx];
}

function ctxBandKey(totalPrompt: number): GeminiLocalCtxBucket['key'] {
  if (totalPrompt < 50_000) return '<50k';
  if (totalPrompt < 100_000) return '50k-100k';
  if (totalPrompt < 200_000) return '100k-200k';
  return '>=200k';
}

const CTX_BAND_ORDER: readonly GeminiLocalCtxBucket['key'][] = ['<50k', '50k-100k', '100k-200k', '>=200k'];

/**
 * Compute the user's own 7-day local baseline per Gemini family from graph summaries,
 * stratified into high-cache-hit vs cold-prefill AND 4 prompt context size bands (<50k..>=200k).
 */
export function computeLocalGeminiBaselines(
  summaries: any[],
  nowMs = Date.now(),
): Record<string, GeminiLocalBaseline> {
  const cutoff7d = nowMs - LOCAL_BASELINE_DAYS * 86_400_000;
  const cutoff24h = nowMs - 86_400_000;
  const cutoff30m = nowMs - 30 * 60_000;
  const acc = new Map<string, {
    ttfts: number[];
    hitTtfts: number[];
    missTtfts: number[];
    tps: number[];
    ctxs: number[];
    cachedSum: number;
    promptSum: number;
    calls: number;
    ttfts30m: number[];
    tps30m: number[];
    cachedSum30m: number;
    promptSum30m: number;
    calls30m: number;
    ttfts24h: number[];
    tps24h: number[];
    cachedSum24h: number;
    promptSum24h: number;
    calls24h: number;
    m100Calls: number;
    m100Ttfts: number[];
    m100Tps: number[];
    m100Cached: number;
    m100Prompt: number;
    byCtx: Map<GeminiLocalCtxBucket['key'], { calls: number; ttfts: number[]; tps: number[] }>;
    byDay: Map<string, { ttfts: number[]; tps: number[]; cachedSum: number; promptSum: number; calls: number }>;
    byDayMatched: Map<string, { ttfts: number[]; tps: number[]; cachedSum: number; promptSum: number; calls: number }>;
  }>();

  for (const s of summaries || []) {
    if (s.latestTsMs && s.latestTsMs < cutoff7d) continue;
    for (const c of s.recentCalls || []) {
      if (c.ts < cutoff7d || c.poolKey !== 'gemini') continue;
      const fam = c.family || '';
      if (!fam || !fam.startsWith('gemini')) continue;
      let b = acc.get(fam);
      if (!b) {
        b = {
          ttfts: [],
          hitTtfts: [],
          missTtfts: [],
          tps: [],
          ctxs: [],
          cachedSum: 0,
          promptSum: 0,
          calls: 0,
          ttfts30m: [],
          tps30m: [],
          cachedSum30m: 0,
          promptSum30m: 0,
          calls30m: 0,
          ttfts24h: [],
          tps24h: [],
          cachedSum24h: 0,
          promptSum24h: 0,
          calls24h: 0,
          m100Calls: 0,
          m100Ttfts: [],
          m100Tps: [],
          m100Cached: 0,
          m100Prompt: 0,
          byCtx: new Map(),
          byDay: new Map(),
          byDayMatched: new Map(),
        };
        acc.set(fam, b);
      }
      b.calls += 1;
      const newIn = c.newInput || 0;
      const cachedIn = c.cachedInput || 0;
      const totIn = newIn + cachedIn;
      b.cachedSum += cachedIn;
      b.promptSum += totIn;
      if (totIn > 0) b.ctxs.push(totIn);
      const cachePct = totIn > 0 ? (cachedIn / totIn) * 100 : null;
      const validTtft = typeof c.ttftSec === 'number' && Number.isFinite(c.ttftSec) && c.ttftSec > 0 && c.ttftSec < 300;
      const validTps = !c.isBuffered && typeof c.genTps === 'number' && Number.isFinite(c.genTps) && c.genTps > 0 && c.genTps < 2000;

      // Context size band bucket
      const band = ctxBandKey(totIn);
      let cb = b.byCtx.get(band);
      if (!cb) {
        cb = { calls: 0, ttfts: [], tps: [] };
        b.byCtx.set(band, cb);
      }
      cb.calls += 1;
      if (validTtft) cb.ttfts.push(c.ttftSec);
      if (validTps) cb.tps.push(c.genTps);

      // UTC date key ("YYYY-MM-DD") aligned with OpenRouter 7d comparison chart X-axis
      const dayKey = new Date(c.ts).toISOString().slice(0, 10);
      let dayBucket = b.byDay.get(dayKey);
      if (!dayBucket) {
        dayBucket = { ttfts: [], tps: [], cachedSum: 0, promptSum: 0, calls: 0 };
        b.byDay.set(dayKey, dayBucket);
      }
      dayBucket.calls += 1;
      dayBucket.cachedSum += cachedIn;
      dayBucket.promptSum += totIn;
      if (validTtft) dayBucket.ttfts.push(c.ttftSec);
      if (validTps) dayBucket.tps.push(c.genTps);

      // Context-matched (<100k) bucket for apples-to-apples comparison against OpenRouter global (avg 46k-80k)
      if (totIn < 100_000) {
        b.m100Calls += 1;
        b.m100Cached += cachedIn;
        b.m100Prompt += totIn;
        if (validTtft) b.m100Ttfts.push(c.ttftSec);
        if (validTps) b.m100Tps.push(c.genTps);
        let dmBucket = b.byDayMatched.get(dayKey);
        if (!dmBucket) {
          dmBucket = { ttfts: [], tps: [], cachedSum: 0, promptSum: 0, calls: 0 };
          b.byDayMatched.set(dayKey, dmBucket);
        }
        dmBucket.calls += 1;
        dmBucket.cachedSum += cachedIn;
        dmBucket.promptSum += totIn;
        if (validTtft) dmBucket.ttfts.push(c.ttftSec);
        if (validTps) dmBucket.tps.push(c.genTps);
      }

      if (validTtft) {
        b.ttfts.push(c.ttftSec);
        if (newIn >= 25_000 || (cachePct !== null && cachePct < 60)) {
          b.missTtfts.push(c.ttftSec);
        } else {
          b.hitTtfts.push(c.ttftSec);
        }
      }
      if (validTps) {
        b.tps.push(c.genTps);
      }

      if (c.ts >= cutoff24h) {
        b.calls24h += 1;
        b.cachedSum24h += cachedIn;
        b.promptSum24h += totIn;
        if (validTtft) b.ttfts24h.push(c.ttftSec);
        if (validTps) b.tps24h.push(c.genTps);
      }
      if (c.ts >= cutoff30m) {
        b.calls30m += 1;
        b.cachedSum30m += cachedIn;
        b.promptSum30m += totIn;
        if (validTtft) b.ttfts30m.push(c.ttftSec);
        if (validTps) b.tps30m.push(c.genTps);
      }
    }
  }

  const mapDaily = (dayMap: Map<string, { ttfts: number[]; tps: number[]; cachedSum: number; promptSum: number; calls: number }>): GeminiLocalDailyPoint[] =>
    [...dayMap.entries()]
      .sort(([d1], [d2]) => d1.localeCompare(d2))
      .map(([x, db]) => {
        db.ttfts.sort((a, v) => a - v);
        db.tps.sort((a, v) => a - v);
        return {
          x,
          calls: db.calls,
          p50TtftSec: roundNum(quantile(db.ttfts, 0.5), 2),
          p50Tps: roundNum(quantile(db.tps, 0.5), 1),
          cacheHitPct: db.promptSum > 0 ? roundNum((db.cachedSum / db.promptSum) * 100, 1) : null,
        };
      });

  const out: Record<string, GeminiLocalBaseline> = Object.create(null);
  for (const [fam, b] of acc.entries()) {
    b.ttfts.sort((a, x) => a - x);
    b.hitTtfts.sort((a, x) => a - x);
    b.missTtfts.sort((a, x) => a - x);
    b.tps.sort((a, x) => a - x);
    b.ctxs.sort((a, x) => a - x);
    b.ttfts24h.sort((a, x) => a - x);
    b.tps24h.sort((a, x) => a - x);
    b.ttfts30m.sort((a, x) => a - x);
    b.tps30m.sort((a, x) => a - x);
    b.m100Ttfts.sort((a, x) => a - x);
    b.m100Tps.sort((a, x) => a - x);

    const ctxBuckets: GeminiLocalCtxBucket[] = CTX_BAND_ORDER
      .map((key) => {
        const cb = b.byCtx.get(key);
        if (!cb || cb.calls === 0) return null;
        cb.ttfts.sort((a, v) => a - v);
        cb.tps.sort((a, v) => a - v);
        return {
          key,
          calls: cb.calls,
          p50TtftSec: roundNum(quantile(cb.ttfts, 0.5), 2),
          p50Tps: roundNum(quantile(cb.tps, 0.5), 1),
        };
      })
      .filter((x): x is GeminiLocalCtxBucket => Boolean(x));

    const avgCtxTokens = b.ctxs.length > 0 ? Math.round(b.ctxs.reduce((s, v) => s + v, 0) / b.ctxs.length) : null;
    const medianCtxTokens = b.ctxs.length > 0 ? Math.round(quantile(b.ctxs, 0.5) || 0) : null;
    const matched100k = b.m100Calls > 0
      ? {
          calls: b.m100Calls,
          p50TtftSec: roundNum(quantile(b.m100Ttfts, 0.5), 2),
          p50Tps: roundNum(quantile(b.m100Tps, 0.5), 1),
          cacheHitPct: b.m100Prompt > 0 ? roundNum((b.m100Cached / b.m100Prompt) * 100, 1) : null,
        }
      : null;

    out[fam] = {
      calls7d: b.calls,
      p50TtftSec: roundNum(quantile(b.ttfts, 0.5), 2),
      p90TtftSec: roundNum(quantile(b.ttfts, 0.9), 2),
      hitP50TtftSec: b.hitTtfts.length >= 3 ? roundNum(quantile(b.hitTtfts, 0.5), 2) : null,
      missP50TtftSec: b.missTtfts.length >= 3 ? roundNum(quantile(b.missTtfts, 0.5), 2) : null,
      p50Tps: roundNum(quantile(b.tps, 0.5), 1),
      cacheHitPct: b.promptSum > 0 ? roundNum((b.cachedSum / b.promptSum) * 100, 1) : null,
      avgCtxTokens,
      medianCtxTokens,
      matched100k,
      ctxBuckets,
      calls30m: b.calls30m,
      p50Ttft30mSec: roundNum(quantile(b.ttfts30m, 0.5), 2),
      p50Tps30m: roundNum(quantile(b.tps30m, 0.5), 1),
      cacheHit30mPct: b.promptSum30m > 0 ? roundNum((b.cachedSum30m / b.promptSum30m) * 100, 1) : null,
      calls24h: b.calls24h,
      p50Ttft24hSec: roundNum(quantile(b.ttfts24h, 0.5), 2),
      p50Tps24h: roundNum(quantile(b.tps24h, 0.5), 1),
      cacheHit24hPct: b.promptSum24h > 0 ? roundNum((b.cachedSum24h / b.promptSum24h) * 100, 1) : null,
      daily7d: mapDaily(b.byDay),
      daily7dMatched: mapDaily(b.byDayMatched),
    };
  }
  return out;
}

/**
 * Attribute the latest Gemini invocation's TTFT latency into 5 actionable root causes
 * (plus `normal`), comparing current request vs context-stratified local 7d baseline vs OpenRouter 30m stats.
 */
export function evaluateTtftAttribution({
  latest,
  globalModel,
  localBaseline,
  activeIncidents,
  inFlightCount = 0,
}: {
  latest: any;
  globalModel: GeminiModelGlobalPulse | null;
  localBaseline: GeminiLocalBaseline | null;
  activeIncidents: GcpActiveIncident[];
  inFlightCount?: number;
}): TtftAttribution | null {
  if (!latest || typeof latest.ttftSec !== 'number' || !Number.isFinite(latest.ttftSec) || latest.ttftSec < 0) {
    return null;
  }
  const family = resolveModelFamily(latest.modelId, latest.modelDisplay, latest.model);
  if (!family.startsWith('gemini')) return null;

  const spec = GEMINI_PULSE_MODELS.find((m) => m.family === family);
  const label = globalModel?.label || spec?.label || latest.modelDisplay || family;
  const ttft = latest.ttftSec;
  const newIn = latest.newInput || 0;
  const cachedIn = latest.cachedInput || 0;
  const totIn = newIn + cachedIn;
  const currentCachePct = totIn > 0 ? roundNum((cachedIn / totIn) * 100, 1) : null;
  const isColdPrefill = newIn >= 25_000 && (currentCachePct === null || currentCachePct < 60);
  const globalAvgCtx = globalModel?.avgPromptTokens ?? null;
  const band = ctxBandKey(totIn);
  const matchedCtxBucket = (localBaseline?.ctxBuckets || []).find((b) => b.key === band && b.calls >= 5 && b.p50TtftSec !== null);

  let localBucket: TtftAttribution['localBucket'] = 'all';
  let localRefP50 = localBaseline?.p50TtftSec ?? null;
  if (matchedCtxBucket && !isColdPrefill) {
    localBucket = matchedCtxBucket.key;
    localRefP50 = matchedCtxBucket.p50TtftSec;
  } else if (isColdPrefill && localBaseline?.missP50TtftSec !== null && localBaseline?.missP50TtftSec !== undefined) {
    localBucket = 'miss';
    localRefP50 = localBaseline.missP50TtftSec;
  } else if (!isColdPrefill && localBaseline?.hitP50TtftSec !== null && localBaseline?.hitP50TtftSec !== undefined) {
    localBucket = 'hit';
    localRefP50 = localBaseline.hitP50TtftSec;
  }

  const gP50 = globalModel?.p50TtftSec ?? null;
  const gP90 = globalModel?.p90TtftSec ?? null;
  const gStatus: PulseHealthStatus | 'unknown' = globalModel?.status ?? (activeIncidents.length > 0 ? 'degraded' : 'unknown');

  const baseP50ForThreshold = localBaseline?.matched100k?.p50TtftSec ?? localBaseline?.hitP50TtftSec ?? localRefP50;
  const slowThreshold = Math.max(
    4.0,
    baseP50ForThreshold !== null ? baseP50ForThreshold * 1.85 : 4.5,
  );
  const isLargeContext = totIn >= 150_000 && (globalAvgCtx === null || totIn >= globalAvgCtx * 1.6);
  const isSlow = ttft >= slowThreshold || (isLargeContext && gP50 !== null && ttft >= Math.max(6.0, gP50 * 1.75));

  let verdict: TtftVerdictKind = 'normal';
  if (isSlow) {
    const upstreamUnhealthy = activeIncidents.length > 0 || gStatus === 'outage' || gStatus === 'degraded';
    // Even if uptime is 100%, if global P50 itself is elevated (>=4s) and user's TTFT sits within
    // the global P50..P90 band, the whole upstream pool is running slow right now.
    const withinElevatedGlobalBand = gP50 !== null
      && gP50 >= 4.0
      && ttft <= Math.max(gP90 ?? gP50 * 2.2, gP50 * 2.0) * 1.15;

    if (upstreamUnhealthy || (withinElevatedGlobalBand && !isLargeContext)) {
      verdict = 'upstream_degraded';
    } else if (isColdPrefill) {
      verdict = 'cache_miss';
    } else if (inFlightCount >= 2) {
      verdict = 'local_concurrency';
    } else if (
      isLargeContext
      && (
        (matchedCtxBucket?.p50TtftSec != null && ttft <= matchedCtxBucket.p50TtftSec * 1.65)
        || (gP50 !== null && ttft <= Math.max(15.0, gP50 * 3.2))
      )
    ) {
      verdict = 'large_context';
    } else if (
      gP50 !== null
      && gStatus === 'ok'
      && ttft > Math.max(4.5, (gP90 ?? gP50 * 2.4) * 1.15)
    ) {
      verdict = 'account_or_network';
    } else if (localRefP50 !== null && ttft >= Math.max(5.0, localRefP50 * 2.5)) {
      verdict = 'account_or_network';
    }
  }

  return {
    verdict,
    family,
    label,
    currentTtftSec: roundNum(ttft, 2) ?? 0,
    currentTps: roundNum(latest.isBuffered ? latest.e2eTps : latest.genTps, 1) ?? 0,
    currentCachePct,
    currentNewInput: newIn,
    currentCtxTokens: totIn,
    globalAvgCtxTokens: globalAvgCtx,
    inFlightCount,
    localP50TtftSec: localRefP50,
    localP90TtftSec: localBaseline?.p90TtftSec ?? null,
    localBucket,
    globalP50TtftSec: gP50,
    globalP90TtftSec: gP90,
    globalP50Tps: globalModel?.p50Tps ?? null,
    globalCachePct: globalModel?.cacheHitPct ?? null,
    globalUptime30mPct: globalModel?.uptime30mPct ?? null,
    globalStatus: gStatus,
    globalRequests30m: globalModel?.requestCount30m ?? 0,
    activeIncidentCount: activeIncidents.length,
  };
}
