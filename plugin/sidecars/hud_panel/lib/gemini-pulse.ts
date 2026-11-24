/**
 * Gemini Global Pulse & TTFT Attribution.
 *
 * Fetches read-only public Gemini telemetry from:
 * - OpenRouter public model pages & endpoint status (30m P50/P75/P90 TTFT, P50/P90 TPS,
 *   global cache hit rate, 30m uptime & provider degradation flags; zero API key required)
 * - Google Cloud Service Health incidents.json (active Vertex AI / Gemini outages)
 *
 * Combines global upstream telemetry with the user's 7-day local per-model baseline
 * (stratified by cache hit vs cold prefill) and local concurrency (`inFlightCount`)
 * to attribute slow TTFT to:
 * - `upstream_degraded`: whole Gemini upstream / OpenRouter global pool is slow or degraded
 * - `cache_miss`: cold prompt prefill (large uncached newInput / low cache hit)
 * - `local_concurrency`: multiple concurrent chats / Swarm workers / subagents queuing
 * - `account_or_network`: local/account/proxy slow while global Gemini pool is fast & healthy
 * - `normal`: within expected latency bounds
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGeminiPulsePath } from './constants.ts';
import {
  GEMINI_PULSE_FAMILY_SET,
  GEMINI_PULSE_MODELS,
  clampPct,
  classifyModelPulseStatus,
  downsampleUptimeBuckets,
  finiteNum,
  formatUtcBucketLabel,
  hasAnyLiveMetric,
  mergeIntradayHistory,
  normalizeProviderLabel,
  parseGcpGeminiIncidents,
  parseOpenRouterComparisonSeries,
  parseOpenRouterEndpointsJson,
  parseOpenRouterModelHtml,
  parseOpenRouterUptimeBuckets,
  parseUtcTimestampMs,
  roundNum,
  sanitizeEndpointPulses,
  sanitizeGcpIncidentUrl,
  sanitizeIncident,
  sanitizeIntradayPoints,
  sanitizeSeriesPoints,
  sanitizeUptimeBuckets,
  type GcpActiveIncident,
  type GeminiEndpointPulse,
  type GeminiIntradayPoint,
  type GeminiModelTimeSeries,
  type GeminiPulseModelSpec,
  type GeminiTimeSeriesPoint,
  type GeminiUptimeBucket,
  type PulseHealthStatus,
} from './pulse-core.ts';
import { median, resolveModelFamily } from './quota-solver.ts';

export {
  GEMINI_PULSE_MODELS,
  classifyModelPulseStatus,
  downsampleUptimeBuckets,
  formatUtcBucketLabel,
  mergeIntradayHistory,
  parseGcpGeminiIncidents,
  parseOpenRouterComparisonSeries,
  parseOpenRouterEndpointsJson,
  parseOpenRouterModelHtml,
  parseOpenRouterUptimeBuckets,
  sanitizeGcpIncidentUrl,
  type GcpActiveIncident,
  type GeminiEndpointPulse,
  type GeminiIntradayPoint,
  type GeminiModelTimeSeries,
  type GeminiPulseModelSpec,
  type GeminiTimeSeriesPoint,
  type GeminiUptimeBucket,
  type PulseHealthStatus,
};

export const PULSE_TTL_MS = 5 * 60_000;
const PULSE_FETCH_TIMEOUT_MS = 8_000;
const REMOTE_MAX_STALE_MS = 20 * 60_000;
const MAX_REMOTE_FEED_BYTES = 5 * 1024 * 1024;
const LOCAL_BASELINE_DAYS = 7;

function readPluginVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifestPath = join(here, '..', '..', '..', 'plugin.json');
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (typeof raw?.version === 'string' && raw.version.trim()) {
      return raw.version.trim();
    }
  } catch {
    /* fallback below */
  }
  return '1.2.0';
}

const PLUGIN_VERSION = readPluginVersion();
const PULSE_UA = `agy-hud/${PLUGIN_VERSION}`;
const PULSE_HTML_UA = `Mozilla/5.0 (compatible; agy-hud/${PLUGIN_VERSION})`;

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

const ALLOWED_PULSE_HOSTS = new Set(['openrouter.ai', 'status.cloud.google.com']);

function isAllowedPulseUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' && ALLOWED_PULSE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function quantile(sortedAsc: number[], q: number): number | null {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((sortedAsc.length - 1) * q)));
  return sortedAsc[idx];
}

export function summarizeModelPulse(
  spec: GeminiPulseModelSpec,
  htmlParsed: {
    permaslug?: string | null;
    weightedCacheHitPct: number | null;
    endpoints: GeminiEndpointPulse[];
    uptime24h?: GeminiUptimeBucket[];
    toolCallErrorPct?: number | null;
    toolCalls24h?: number;
    reasoningSharePct?: number | null;
    avgPromptTokens?: number | null;
    avgOutputTokens?: number | null;
  },
  epParsed: {
    uptime5mPct?: number | null;
    uptime30mPct: number | null;
    uptime1dPct?: number | null;
    degradedProviders: string[];
  },
  activeIncidents: GcpActiveIncident[],
  seriesOverride?: Partial<GeminiModelTimeSeries>,
): GeminiModelGlobalPulse {
  const eps = htmlParsed.endpoints.filter((e) => e.p50TtftSec !== null || e.p50Tps !== null);
  // Primary endpoint is the highest-volume active provider (e.g. Google Vertex 30k req/30m).
  const primary = eps[0] || null;
  const totalReq = eps.reduce((acc, e) => acc + (e.requestCount || 0), 0);

  const p50TtftSec = primary?.p50TtftSec ?? null;
  const p75TtftSec = primary?.p75TtftSec ?? null;
  const p90TtftSec = primary?.p90TtftSec ?? null;
  const p95TtftSec = primary?.p95TtftSec ?? null;
  const p99TtftSec = primary?.p99TtftSec ?? null;
  const meanTtftSec = primary?.meanTtftSec ?? null;
  const p50Tps = primary?.p50Tps ?? null;
  const p90Tps = primary?.p90Tps ?? null;
  const cacheHitPct = htmlParsed.weightedCacheHitPct ?? primary?.cacheHitPct ?? null;
  const rawProv = primary?.providerName || primary?.providerSlug || '';
  const primaryProvider = /vertex/i.test(rawProv)
    ? 'Google Vertex'
    : /ai[- ]?studio/i.test(rawProv)
      ? 'AI Studio'
      : rawProv;

  const status = classifyModelPulseStatus(
    {
      uptime30mPct: epParsed.uptime30mPct,
      degradedProviders: epParsed.degradedProviders,
      p50TtftSec,
      p90TtftSec,
    },
    activeIncidents,
  );

  const series: GeminiModelTimeSeries = {
    ttft7d: seriesOverride?.ttft7d || [],
    ...(seriesOverride?.e2e7d?.length ? { e2e7d: seriesOverride.e2e7d } : {}),
    tps7d: seriesOverride?.tps7d || [],
    cache7d: seriesOverride?.cache7d || [],
    ...(seriesOverride?.uptime7d?.length ? { uptime7d: seriesOverride.uptime7d } : {}),
    uptime24h: seriesOverride?.uptime24h || htmlParsed.uptime24h || [],
    ...(seriesOverride?.intraday30m?.length ? { intraday30m: seriesOverride.intraday30m } : {}),
  };
  const hasSeries =
    series.ttft7d.length > 0 ||
    (series.e2e7d?.length || 0) > 0 ||
    series.tps7d.length > 0 ||
    series.cache7d.length > 0 ||
    (series.uptime7d?.length || 0) > 0 ||
    series.uptime24h.length > 0 ||
    (series.intraday30m?.length || 0) > 0;

  return {
    family: spec.family,
    slug: spec.slug,
    ...(htmlParsed.permaslug ? { permaslug: htmlParsed.permaslug } : {}),
    label: spec.label,
    status,
    p50TtftSec,
    p75TtftSec,
    p90TtftSec,
    ...(p95TtftSec !== null ? { p95TtftSec } : {}),
    ...(p99TtftSec !== null ? { p99TtftSec } : {}),
    ...(meanTtftSec !== null ? { meanTtftSec } : {}),
    p50Tps,
    p90Tps,
    cacheHitPct,
    ...(epParsed.uptime5mPct !== null && epParsed.uptime5mPct !== undefined ? { uptime5mPct: epParsed.uptime5mPct } : {}),
    uptime30mPct: epParsed.uptime30mPct,
    ...(epParsed.uptime1dPct !== null && epParsed.uptime1dPct !== undefined ? { uptime1dPct: epParsed.uptime1dPct } : {}),
    ...(htmlParsed.toolCallErrorPct !== null && htmlParsed.toolCallErrorPct !== undefined ? { toolCallErrorPct: htmlParsed.toolCallErrorPct } : {}),
    ...(htmlParsed.toolCalls24h ? { toolCalls24h: htmlParsed.toolCalls24h } : {}),
    ...(htmlParsed.reasoningSharePct !== null && htmlParsed.reasoningSharePct !== undefined ? { reasoningSharePct: htmlParsed.reasoningSharePct } : {}),
    ...(htmlParsed.avgPromptTokens !== null && htmlParsed.avgPromptTokens !== undefined ? { avgPromptTokens: htmlParsed.avgPromptTokens } : {}),
    ...(htmlParsed.avgOutputTokens !== null && htmlParsed.avgOutputTokens !== undefined ? { avgOutputTokens: htmlParsed.avgOutputTokens } : {}),
    ...(primary?.effectiveInputPrice !== null && primary?.effectiveInputPrice !== undefined ? { effectiveInputPrice: primary.effectiveInputPrice } : {}),
    ...(primary?.effectiveOutputPrice !== null && primary?.effectiveOutputPrice !== undefined ? { effectiveOutputPrice: primary.effectiveOutputPrice } : {}),
    requestCount30m: totalReq,
    windowMinutes: primary?.windowMinutes || 30,
    primaryProvider,
    degradedProviders: epParsed.degradedProviders,
    endpoints: eps.slice(0, 6),
    ...(hasSeries ? { series } : {}),
  };
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

// ---------------------------------------------------------------------------
// Cache & background fetcher (non-blocking, disk-persisted, strict allowlist)
// ---------------------------------------------------------------------------

let memCache: GeminiPulseCacheFile | null = null;
let memCachePath = '';
let fetchInFlight: Promise<GeminiPulseCacheFile> | null = null;
let pulseSeq = 0;
const lastKnownEnabledByPath = new Map<string, boolean>();

export function getGeminiPulseVersion(): number {
  return pulseSeq;
}

export function getFailureBackoffMs(failCount: number): number {
  if (!Number.isFinite(failCount) || failCount <= 0) return 0;
  return Math.min(15 * 60_000, 60_000 * 2 ** Math.min(4, failCount - 1));
}

function loadDiskCache(cachePath: string): GeminiPulseCacheFile {
  if (memCache && memCachePath === cachePath) return memCache;
  let loaded: GeminiPulseCacheFile | null = null;
  try {
    if (cachePath && existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.version >= 1 && raw.version <= 4) {
        const enabled = raw.enabled !== false;
        lastKnownEnabledByPath.set(cachePath, enabled);
        loaded = {
          version: raw.version,
          enabled,
          fetchedAtMs: typeof raw.fetchedAtMs === 'number' && Number.isFinite(raw.fetchedAtMs) ? raw.fetchedAtMs : 0,
          ...(typeof raw.checkedAtMs === 'number' && Number.isFinite(raw.checkedAtMs) ? { checkedAtMs: raw.checkedAtMs } : {}),
          ...(typeof raw.lastAttemptMs === 'number' && Number.isFinite(raw.lastAttemptMs) ? { lastAttemptMs: raw.lastAttemptMs } : {}),
          ...(typeof raw.failCount === 'number' && Number.isFinite(raw.failCount) && raw.failCount > 0 ? { failCount: raw.failCount } : {}),
          models: Array.isArray(raw.models) ? raw.models : [],
          incidents: Array.isArray(raw.incidents)
            ? raw.incidents.map(sanitizeIncident).filter((x: GcpActiveIncident | null): x is GcpActiveIncident => x !== null)
            : [],
          ...(typeof raw.error === 'string' && raw.error ? { error: raw.error } : {}),
        };
      }
    }
  } catch {
    /* ignore corrupt cache; preserve last known opt-out preference below */
  }
  const fallbackEnabled = lastKnownEnabledByPath.has(cachePath) ? lastKnownEnabledByPath.get(cachePath)! : true;
  memCache = loaded || { version: 4, enabled: fallbackEnabled, fetchedAtMs: 0, models: [], incidents: [] };
  memCachePath = cachePath;
  return memCache;
}

function saveDiskCache(cachePath: string, data: GeminiPulseCacheFile): void {
  memCache = data;
  memCachePath = cachePath;
  if (cachePath) lastKnownEnabledByPath.set(cachePath, data.enabled);
  if (!cachePath) return;
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    // Atomic compact write: write temp sibling and rename so a crash/tear never corrupts the cache
    const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
    renameSync(tmpPath, cachePath);
  } catch {
    /* non-fatal cache write error */
  }
}

export function setGeminiPulseEnabled(
  enabled: boolean,
  opts: { appDataDir?: string; cachePath?: string } = {},
): GeminiPulseCacheFile {
  const cachePath = opts.cachePath || resolveGeminiPulsePath(opts.appDataDir);
  const cur = loadDiskCache(cachePath);
  const next: GeminiPulseCacheFile = { ...cur, enabled: Boolean(enabled) };
  saveDiskCache(cachePath, next);
  pulseSeq += 1;
  return next;
}

async function fetchTextSafe(url: string, fetchImpl: typeof globalThis.fetch, headers: Record<string, string>) {
  if (!isAllowedPulseUrl(url)) throw new Error(`Disallowed pulse URL: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_GEMINI_PULSE_FEED_URL = 'https://agy-hud.512.pub';

function resolveRemoteFeedEndpoint(rawUrl?: string): string | null {
  const envVal = process.env.AGY_HUD_PULSE_FEED_URL;
  const candidate = (rawUrl !== undefined ? rawUrl : envVal !== undefined ? envVal : DEFAULT_GEMINI_PULSE_FEED_URL).trim();
  if (!candidate || candidate.toLowerCase() === 'direct' || candidate.toLowerCase() === 'none') return null;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:') return null;
    if (u.pathname.endsWith('.json')) return u.toString();
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/v1/pulse.json`;
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeRemoteModel(raw: unknown): GeminiModelGlobalPulse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const family = typeof r.family === 'string' ? r.family : '';
  if (!GEMINI_PULSE_FAMILY_SET.has(family)) return null;
  const spec = GEMINI_PULSE_MODELS.find((m) => m.family === family);
  if (!spec) return null;

  const status: PulseHealthStatus =
    r.status === 'outage' || r.status === 'degraded' || r.status === 'ok' ? r.status : 'ok';
  const p50TtftSec = finiteNum(r.p50TtftSec);
  const p75TtftSec = finiteNum(r.p75TtftSec);
  const p90TtftSec = finiteNum(r.p90TtftSec);
  const p95TtftSec = finiteNum(r.p95TtftSec);
  const p99TtftSec = finiteNum(r.p99TtftSec);
  const meanTtftSec = finiteNum(r.meanTtftSec);
  const p50Tps = finiteNum(r.p50Tps);
  const p90Tps = finiteNum(r.p90Tps);
  const cacheHitPct = clampPct(r.cacheHitPct, 1);
  const uptime5mPct = clampPct(r.uptime5mPct, 1);
  const uptime30mPct = clampPct(r.uptime30mPct, 1);
  const uptime1dPct = clampPct(r.uptime1dPct, 1);

  if (!hasAnyLiveMetric({ p50TtftSec, p50Tps, cacheHitPct, uptime5mPct, uptime30mPct })) {
    return null;
  }

  const reqCount = finiteNum(r.requestCount30m);
  const winMin = finiteNum(r.windowMinutes);
  const toolCalls = finiteNum(r.toolCalls24h);
  const degradedProviders = Array.isArray(r.degradedProviders)
    ? r.degradedProviders.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 64))
    : [];
  const endpoints = sanitizeEndpointPulses(r.endpoints);
  const rawSeries = (r.series && typeof r.series === 'object' ? r.series : {}) as Record<string, unknown>;
  const series: GeminiModelTimeSeries = {
    ttft7d: sanitizeSeriesPoints(rawSeries.ttft7d),
    ...(sanitizeSeriesPoints(rawSeries.e2e7d).length ? { e2e7d: sanitizeSeriesPoints(rawSeries.e2e7d) } : {}),
    tps7d: sanitizeSeriesPoints(rawSeries.tps7d),
    cache7d: sanitizeSeriesPoints(rawSeries.cache7d),
    ...(sanitizeSeriesPoints(rawSeries.uptime7d).length ? { uptime7d: sanitizeSeriesPoints(rawSeries.uptime7d) } : {}),
    uptime24h: sanitizeUptimeBuckets(rawSeries.uptime24h),
    ...(sanitizeIntradayPoints(rawSeries.intraday30m).length
      ? { intraday30m: sanitizeIntradayPoints(rawSeries.intraday30m) }
      : {}),
  };

  return {
    family: spec.family,
    slug: spec.slug,
    ...(typeof r.permaslug === 'string' && /^google\/[a-zA-Z0-9._-]+$/.test(r.permaslug) ? { permaslug: r.permaslug } : {}),
    label: spec.label,
    status,
    p50TtftSec,
    p75TtftSec,
    p90TtftSec,
    ...(p95TtftSec !== null ? { p95TtftSec } : {}),
    ...(p99TtftSec !== null ? { p99TtftSec } : {}),
    ...(meanTtftSec !== null ? { meanTtftSec } : {}),
    p50Tps,
    p90Tps,
    cacheHitPct,
    ...(uptime5mPct !== null ? { uptime5mPct } : {}),
    uptime30mPct,
    ...(uptime1dPct !== null ? { uptime1dPct } : {}),
    ...(finiteNum(r.toolCallErrorPct) !== null ? { toolCallErrorPct: finiteNum(r.toolCallErrorPct) } : {}),
    ...(toolCalls !== null && toolCalls > 0 ? { toolCalls24h: Math.round(toolCalls) } : {}),
    ...(clampPct(r.reasoningSharePct, 1) !== null ? { reasoningSharePct: clampPct(r.reasoningSharePct, 1) } : {}),
    ...(finiteNum(r.avgPromptTokens) !== null ? { avgPromptTokens: Math.round(finiteNum(r.avgPromptTokens)!) } : {}),
    ...(finiteNum(r.avgOutputTokens) !== null ? { avgOutputTokens: Math.round(finiteNum(r.avgOutputTokens)!) } : {}),
    ...(finiteNum(r.effectiveInputPrice) !== null ? { effectiveInputPrice: finiteNum(r.effectiveInputPrice) } : {}),
    ...(finiteNum(r.effectiveOutputPrice) !== null ? { effectiveOutputPrice: finiteNum(r.effectiveOutputPrice) } : {}),
    requestCount30m: reqCount !== null && reqCount > 0 ? Math.round(reqCount) : 0,
    windowMinutes: winMin !== null && winMin > 0 ? Math.round(winMin) : 30,
    primaryProvider: normalizeProviderLabel(typeof r.primaryProvider === 'string' ? r.primaryProvider : ''),
    degradedProviders,
    endpoints,
    series,
  };
}

async function tryFetchRemotePulseFeed(
  feedUrl: string,
  fetchImpl: typeof globalThis.fetch,
  nowMs: number,
): Promise<{ fetchedAtMs: number; models: GeminiModelGlobalPulse[]; incidents: GcpActiveIncident[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(feedUrl, {
      headers: { 'User-Agent': PULSE_UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    // Cap body size to 5MB and parse safely from text
    const text = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json());
    if (!text || text.length > MAX_REMOTE_FEED_BYTES) return null;
    const json = JSON.parse(text);
    if (!json || !Array.isArray(json.models) || json.models.length === 0) return null;
    const remoteFetchedAt = finiteNum(json.fetchedAtMs);
    if (remoteFetchedAt === null || remoteFetchedAt <= 0) return null;
    // Reject stale remote snapshots (>20 min old) so sidecar falls back to direct OpenRouter
    if (nowMs - remoteFetchedAt > REMOTE_MAX_STALE_MS) return null;

    const models = json.models
      .map(sanitizeRemoteModel)
      .filter((m: GeminiModelGlobalPulse | null): m is GeminiModelGlobalPulse => m !== null);
    if (models.length === 0) return null;

    const incidents = Array.isArray(json.incidents)
      ? json.incidents.map(sanitizeIncident).filter((x: GcpActiveIncident | null): x is GcpActiveIncident => x !== null)
      : [];

    return {
      fetchedAtMs: Math.min(remoteFetchedAt, nowMs + 60_000),
      models,
      incidents,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshGeminiPulse(opts: {
  appDataDir?: string;
  cachePath?: string;
  force?: boolean;
  allowWhenDisabled?: boolean;
  fetchImpl?: typeof globalThis.fetch;
  feedUrl?: string;
  nowMs?: number;
} = {}): Promise<GeminiPulseCacheFile> {
  const cachePath = opts.cachePath || resolveGeminiPulsePath(opts.appDataDir);
  const nowMs = opts.nowMs ?? Date.now();
  let cur = loadDiskCache(cachePath);

  // Privacy guard: never make network requests when disabled unless explicitly invoked by the enable flow
  if (!cur.enabled && !opts.allowWhenDisabled) return cur;

  const lastFreshCheck = cur.checkedAtMs || cur.fetchedAtMs;
  if (!opts.force && lastFreshCheck > 0 && nowMs - lastFreshCheck < PULSE_TTL_MS && cur.models.length > 0) {
    return cur;
  }
  if (!opts.force && (cur.failCount || 0) > 0 && (cur.lastAttemptMs || 0) > 0) {
    if (nowMs - cur.lastAttemptMs! < getFailureBackoffMs(cur.failCount!)) {
      return cur;
    }
  }

  if (fetchInFlight) {
    if (!opts.force) return fetchInFlight;
    // Wait for the in-flight run to settle so concurrent force refreshes never race on stale `cur`
    try {
      await fetchInFlight;
    } catch {
      /* ignore prior failure */
    }
    cur = loadDiskCache(cachePath);
    if (!cur.enabled && !opts.allowWhenDisabled) return cur;
  }

  const prevByFamily = new Map<string, GeminiModelGlobalPulse>(
    cur.models.map((m) => [m.family, m]),
  );

  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  let run: Promise<GeminiPulseCacheFile> | null = null;
  run = (async (): Promise<GeminiPulseCacheFile> => {
    try {
      // Optional remote Cloudflare Worker Gemini Pulse feed (auto-falls back to direct OpenRouter on failure/staleness)
      const feedEndpoint = resolveRemoteFeedEndpoint(opts.feedUrl);
      if (feedEndpoint) {
        const remote = await tryFetchRemotePulseFeed(feedEndpoint, fetchImpl, nowMs);
        if (remote) {
          const mergedModels = remote.models.map((rm) => {
            const prev = prevByFamily.get(rm.family);
            const intraday30m = mergeIntradayHistory(
              prev?.series?.intraday30m,
              rm,
              remote.fetchedAtMs,
              rm.series?.intraday30m,
            );
            const e2e7d = rm.series?.e2e7d?.length ? rm.series.e2e7d : prev?.series?.e2e7d;
            const uptime7d = rm.series?.uptime7d?.length ? rm.series.uptime7d : prev?.series?.uptime7d;
            return {
              ...rm,
              series: {
                ttft7d: rm.series?.ttft7d?.length ? rm.series.ttft7d : (prev?.series?.ttft7d || []),
                ...(e2e7d?.length ? { e2e7d } : {}),
                tps7d: rm.series?.tps7d?.length ? rm.series.tps7d : (prev?.series?.tps7d || []),
                cache7d: rm.series?.cache7d?.length ? rm.series.cache7d : (prev?.series?.cache7d || []),
                ...(uptime7d?.length ? { uptime7d } : {}),
                uptime24h: rm.series?.uptime24h?.length ? rm.series.uptime24h : (prev?.series?.uptime24h || []),
                ...(intraday30m.length ? { intraday30m } : {}),
              },
            };
          });
          const next: GeminiPulseCacheFile = {
            version: 4,
            enabled: cur.enabled,
            fetchedAtMs: remote.fetchedAtMs,
            checkedAtMs: nowMs,
            lastAttemptMs: nowMs,
            models: mergedModels,
            incidents: remote.incidents,
          };
          saveDiskCache(cachePath, next);
          pulseSeq += 1;
          return next;
        }
      }

      const gcpPromise = fetchTextSafe(
        'https://status.cloud.google.com/incidents.json',
        fetchImpl,
        { 'User-Agent': PULSE_UA, Accept: 'application/json' },
      )
        .then((txt) => parseGcpGeminiIncidents(JSON.parse(txt)))
        .catch(() => [] as GcpActiveIncident[]);

      const modelPromises = GEMINI_PULSE_MODELS.map(async (spec) => {
        const [htmlRes, epRes] = await Promise.allSettled([
          fetchTextSafe(
            `https://openrouter.ai/${spec.slug}`,
            fetchImpl,
            { 'User-Agent': PULSE_HTML_UA, Accept: 'text/html' },
          ),
          fetchTextSafe(
            `https://openrouter.ai/api/v1/models/${spec.slug}/endpoints`,
            fetchImpl,
            { 'User-Agent': PULSE_UA, Accept: 'application/json' },
          ),
        ]);
        const htmlParsed = htmlRes.status === 'fulfilled'
          ? parseOpenRouterModelHtml(htmlRes.value)
          : { permaslug: null, weightedCacheHitPct: null, endpoints: [], uptime24h: [] };
        let epParsed: {
          uptime5mPct?: number | null;
          uptime30mPct: number | null;
          uptime1dPct?: number | null;
          degradedProviders: string[];
          permaslugFallback?: string | null;
        } = { uptime5mPct: null, uptime30mPct: null, uptime1dPct: null, degradedProviders: [], permaslugFallback: null };
        if (epRes.status === 'fulfilled') {
          try {
            epParsed = parseOpenRouterEndpointsJson(JSON.parse(epRes.value));
          } catch {
            /* ignore */
          }
        }

        // Fetch public OpenRouter 7d comparison time-series (TTFT / E2E / TPS / Cache / Uptime) via permaslug
        let ttft7d: GeminiTimeSeriesPoint[] = [];
        let e2e7d: GeminiTimeSeriesPoint[] = [];
        let tps7d: GeminiTimeSeriesPoint[] = [];
        let cache7d: GeminiTimeSeriesPoint[] = [];
        let uptime7d: GeminiTimeSeriesPoint[] = [];
        const ps = htmlParsed.permaslug || epParsed.permaslugFallback;
        if (ps) {
          const qs = `permaslug=${encodeURIComponent(ps)}`;
          const hdrs = { 'User-Agent': PULSE_HTML_UA, Accept: 'application/json' };
          const [latRes, e2eRes, tpsRes, cacheRes, upRes] = await Promise.allSettled([
            fetchTextSafe(`https://openrouter.ai/api/frontend/v1/stats/latency-comparison?${qs}`, fetchImpl, hdrs),
            fetchTextSafe(`https://openrouter.ai/api/frontend/v1/stats/latency-e2e-comparison?${qs}`, fetchImpl, hdrs),
            fetchTextSafe(`https://openrouter.ai/api/frontend/v1/stats/throughput-comparison?${qs}`, fetchImpl, hdrs),
            fetchTextSafe(`https://openrouter.ai/api/frontend/v1/stats/cache-hit-rate-comparison?${qs}`, fetchImpl, hdrs),
            fetchTextSafe(`https://openrouter.ai/api/frontend/v1/stats/uptime-comparison?${qs}`, fetchImpl, hdrs),
          ]);
          if (latRes.status === 'fulfilled') {
            try {
              ttft7d = parseOpenRouterComparisonSeries(JSON.parse(latRes.value), 'ttft', htmlParsed.endpoints);
            } catch { /* ignore */ }
          }
          if (e2eRes.status === 'fulfilled') {
            try {
              e2e7d = parseOpenRouterComparisonSeries(JSON.parse(e2eRes.value), 'e2e', htmlParsed.endpoints);
            } catch { /* ignore */ }
          }
          if (tpsRes.status === 'fulfilled') {
            try {
              tps7d = parseOpenRouterComparisonSeries(JSON.parse(tpsRes.value), 'tps', htmlParsed.endpoints);
            } catch { /* ignore */ }
          }
          if (cacheRes.status === 'fulfilled') {
            try {
              cache7d = parseOpenRouterComparisonSeries(JSON.parse(cacheRes.value), 'cache', htmlParsed.endpoints);
            } catch { /* ignore */ }
          }
          if (upRes.status === 'fulfilled') {
            try {
              uptime7d = parseOpenRouterComparisonSeries(JSON.parse(upRes.value), 'uptime', htmlParsed.endpoints);
            } catch { /* ignore */ }
          }
        }

        return {
          spec,
          htmlParsed,
          epParsed,
          series: { ttft7d, e2e7d, tps7d, cache7d, uptime7d, uptime24h: htmlParsed.uptime24h },
          ok: htmlRes.status === 'fulfilled' || epRes.status === 'fulfilled',
        };
      });

      const [incidents, results] = await Promise.all([gcpPromise, Promise.all(modelPromises)]);
      const anyOk = results.some((r) => r.ok);
      if (!anyOk) {
        const errMsg = 'Unable to reach OpenRouter Gemini stats';
        const failed: GeminiPulseCacheFile = {
          ...cur,
          lastAttemptMs: nowMs,
          failCount: (cur.failCount || 0) + 1,
          error: errMsg,
        };
        saveDiskCache(cachePath, failed);
        if (cur.error !== errMsg) pulseSeq += 1;
        return failed;
      }

      const snapMs = opts.nowMs ?? Date.now();
      const models = results
        .filter((r) => r.ok)
        .map((r) => {
          const base = summarizeModelPulse(r.spec, r.htmlParsed, r.epParsed, incidents, r.series);
          const prev = prevByFamily.get(base.family);
          const intraday30m = mergeIntradayHistory(prev?.series?.intraday30m, base, snapMs);
          if (intraday30m.length > 0) {
            base.series = {
              ttft7d: base.series?.ttft7d?.length ? base.series.ttft7d : (prev?.series?.ttft7d || []),
              ...(base.series?.e2e7d?.length ? { e2e7d: base.series.e2e7d } : {}),
              tps7d: base.series?.tps7d?.length ? base.series.tps7d : (prev?.series?.tps7d || []),
              cache7d: base.series?.cache7d?.length ? base.series.cache7d : (prev?.series?.cache7d || []),
              ...(base.series?.uptime7d?.length ? { uptime7d: base.series.uptime7d } : {}),
              uptime24h: base.series?.uptime24h?.length ? base.series.uptime24h : (prev?.series?.uptime24h || []),
              intraday30m,
            };
          }
          return base;
        });

      const next: GeminiPulseCacheFile = {
        version: 4,
        enabled: cur.enabled,
        fetchedAtMs: snapMs,
        checkedAtMs: snapMs,
        lastAttemptMs: snapMs,
        models,
        incidents,
      };
      saveDiskCache(cachePath, next);
      pulseSeq += 1;
      return next;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const failed: GeminiPulseCacheFile = {
        ...cur,
        lastAttemptMs: nowMs,
        failCount: (cur.failCount || 0) + 1,
        error: errMsg,
      };
      saveDiskCache(cachePath, failed);
      if (cur.error !== errMsg) pulseSeq += 1;
      return failed;
    } finally {
      if (fetchInFlight === run) {
        fetchInFlight = null;
      }
    }
  })();

  fetchInFlight = run;
  return run;
}

/**
 * Non-blocking read for `/api/stats`: returns cached/disk Gemini pulse enriched with
 * local 7-day baselines and current TTFT attribution, kicking off a background refresh
 * if the cache is empty or stale (>5m) and not inside exponential failure backoff.
 */
export function buildGeminiPulseSnapshot({
  appDataDir,
  cachePath,
  summaries = [],
  latest = null,
  currentModel = null,
  inFlightCount = 0,
  nowMs = Date.now(),
  triggerRefresh = true,
}: {
  appDataDir?: string;
  cachePath?: string;
  summaries?: any[];
  latest?: any;
  currentModel?: any;
  inFlightCount?: number;
  nowMs?: number;
  triggerRefresh?: boolean;
}): GeminiPulseSnapshot {
  const path = cachePath || resolveGeminiPulsePath(appDataDir);
  const cache = loadDiskCache(path);
  const needsSeriesUpgrade =
    cache.version < 4 &&
    cache.models.length > 0 &&
    !cache.models.some((m) => m.series && ((m.series.e2e7d?.length || 0) > 0 || (m.series.intraday30m?.length || 0) > 0));
  const isStale = !(cache.fetchedAtMs > 0) || (nowMs - cache.fetchedAtMs >= PULSE_TTL_MS) || needsSeriesUpgrade;
  const lastCheckMs = cache.checkedAtMs || cache.fetchedAtMs;
  const needsCheck = !(lastCheckMs > 0) || (nowMs - lastCheckMs >= PULSE_TTL_MS) || needsSeriesUpgrade;
  const inBackoff =
    (cache.failCount || 0) > 0 &&
    (cache.lastAttemptMs || 0) > 0 &&
    nowMs - cache.lastAttemptMs! < getFailureBackoffMs(cache.failCount!);

  if (triggerRefresh && cache.enabled && needsCheck && !inBackoff && !fetchInFlight) {
    void refreshGeminiPulse({ appDataDir, cachePath: path, force: needsSeriesUpgrade, nowMs }).catch(() => {});
  }

  const localBaselines = computeLocalGeminiBaselines(summaries, nowMs);
  const models: GeminiModelGlobalPulse[] = cache.enabled
    ? cache.models.map((m) => ({ ...m, local: localBaselines[m.family] || null }))
    : [];
  const incidents = cache.enabled ? cache.incidents : [];

  const activeProbe = latest || currentModel;
  const activeFamily = activeProbe
    ? resolveModelFamily(activeProbe.modelId, activeProbe.modelDisplay, activeProbe.model)
    : '';
  const activeModel = activeFamily.startsWith('gemini')
    ? (models.find((m) => m.family === activeFamily) || null)
    : null;

  const attribution = activeFamily.startsWith('gemini') && latest
    ? evaluateTtftAttribution({
        latest,
        globalModel: activeModel,
        localBaseline: localBaselines[activeFamily] || null,
        activeIncidents: incidents,
        inFlightCount,
      })
    : null;

  let overallStatus: PulseHealthStatus | 'unknown' = 'unknown';
  if (cache.enabled && (models.length > 0 || incidents.length > 0)) {
    if (incidents.some((i) => i.severity === 'high') || models.some((m) => m.status === 'outage')) {
      overallStatus = 'outage';
    } else if (incidents.length > 0 || models.some((m) => m.status === 'degraded')) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'ok';
    }
  }

  return {
    enabled: cache.enabled,
    available: cache.enabled && models.length > 0,
    loading: cache.enabled && Boolean(fetchInFlight) && models.length === 0,
    stale: cache.enabled && isStale && models.length > 0,
    fetchedAtMs: cache.fetchedAtMs,
    overallStatus,
    models,
    incidents,
    activeFamily: activeFamily.startsWith('gemini') ? activeFamily : '',
    activeModel,
    attribution,
    ...(cache.error ? { error: cache.error } : {}),
  };
}
