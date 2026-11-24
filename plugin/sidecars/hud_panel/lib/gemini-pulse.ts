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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveGeminiPulsePath } from './constants.ts';
import { median, resolveModelFamily } from './quota-solver.ts';

export const PULSE_TTL_MS = 5 * 60_000;
const PULSE_FETCH_TIMEOUT_MS = 8_000;
const LOCAL_BASELINE_DAYS = 7;

export interface GeminiPulseModelSpec {
  family: string;
  slug: string;
  label: string;
}

export const GEMINI_PULSE_MODELS: readonly GeminiPulseModelSpec[] = Object.freeze([
  { family: 'gemini-4-neon', slug: 'google/gemini-4-neon', label: 'Gemini 4 Neon' },
  { family: 'gemini-4-hydrogen', slug: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { family: 'gemini-4-carbon', slug: 'google/gemini-4-carbon', label: 'Gemini 4 Carbon' },
  { family: 'gemini-4-argon', slug: 'google/gemini-4-argon', label: 'Gemini 4 Argon' },
  { family: 'gemini-3.8-flash', slug: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
]);

export type PulseHealthStatus = 'ok' | 'degraded' | 'outage';

export type TtftVerdictKind =
  | 'normal'
  | 'upstream_degraded'
  | 'cache_miss'
  | 'local_concurrency'
  | 'account_or_network';

export interface GeminiEndpointPulse {
  endpointId: string;
  providerName: string;
  providerSlug: string;
  cacheHitPct: number | null;
  p50TtftSec: number | null;
  p75TtftSec: number | null;
  p90TtftSec: number | null;
  p95TtftSec?: number | null;
  p99TtftSec?: number | null;
  meanTtftSec?: number | null;
  p50Tps: number | null;
  p75Tps?: number | null;
  p90Tps: number | null;
  p95Tps?: number | null;
  p99Tps?: number | null;
  effectiveInputPrice?: number | null;
  effectiveOutputPrice?: number | null;
  totalTokens?: number;
  requestCount: number;
  windowMinutes: number;
}

export interface GeminiTimeSeriesPoint {
  x: string;
  tsMs: number;
  value: number;
  byProvider?: Record<string, number>;
}

export interface GeminiUptimeBucket {
  x: string;
  tsMs: number;
  availability: number;
  rawAvailability: number | null;
}

export interface GeminiIntradayPoint {
  bucketMs: number;
  x: string;
  p50TtftSec: number | null;
  p90TtftSec?: number | null;
  p99TtftSec?: number | null;
  p50Tps: number | null;
  cacheHitPct: number | null;
  uptime30mPct: number | null;
  requestCount30m?: number;
  byProvider?: Record<string, { ttft?: number | null; tps?: number | null; cache?: number | null }>;
}

export interface GeminiModelTimeSeries {
  ttft7d: GeminiTimeSeriesPoint[];
  e2e7d?: GeminiTimeSeriesPoint[];
  tps7d: GeminiTimeSeriesPoint[];
  cache7d: GeminiTimeSeriesPoint[];
  uptime7d?: GeminiTimeSeriesPoint[];
  uptime24h: GeminiUptimeBucket[];
  intraday30m?: GeminiIntradayPoint[];
}

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

export interface GeminiLocalBaseline {
  calls7d: number;
  p50TtftSec: number | null;
  p90TtftSec: number | null;
  hitP50TtftSec: number | null;
  missP50TtftSec: number | null;
  p50Tps: number | null;
  cacheHitPct: number | null;
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
}

export interface GcpActiveIncident {
  id: string;
  service: string;
  severity: string;
  impact: string;
  summary: string;
  begin: string;
  url: string;
}

export interface TtftAttribution {
  verdict: TtftVerdictKind;
  family: string;
  label: string;
  currentTtftSec: number;
  currentTps: number;
  currentCachePct: number | null;
  currentNewInput: number;
  inFlightCount: number;
  localP50TtftSec: number | null;
  localP90TtftSec: number | null;
  localBucket: 'hit' | 'miss' | 'all';
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
const GCP_GEMINI_RE = /vertex|gemini|generative|ai platform|cloud ai|model garden/i;

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

function roundNum(v: number | null | undefined, digits = 2): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function normalizeProviderLabel(raw: string): string {
  const s = String(raw || '').trim();
  if (/vertex/i.test(s)) return 'Google Vertex';
  if (/ai[- ]?studio/i.test(s)) return 'AI Studio';
  return s.replace(/\s*\(\d+\)\s*$/, '').trim() || 'Provider';
}

function parseUtcTimestampMs(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  // "2026-11-23 03:50:00" or "2026-11-18"
  const iso = s.includes('T')
    ? s
    : s.includes(' ')
      ? `${s.replace(' ', 'T')}Z`
      : `${s}T12:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Extract 24h availability buckets embedded in OpenRouter model SSR HTML (`model-uptime`).
 */
export function parseOpenRouterUptimeBuckets(unescHtml: string): GeminiUptimeBucket[] {
  const m = /"buckets":(\[\{"timestamp":"[^"]+"[\s\S]*?\}\])/.exec(unescHtml);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr) || !arr.length) return [];
    const parsed: GeminiUptimeBucket[] = [];
    for (const row of arr) {
      if (!row || typeof row.timestamp !== 'string') continue;
      const avail = typeof row.availability === 'number' && Number.isFinite(row.availability)
        ? Math.max(0, Math.min(100, roundNum(row.availability, 2) ?? 0))
        : null;
      if (avail === null) continue;
      const rawAvail =
        typeof row.availabilityWithoutRouting === 'number' && Number.isFinite(row.availabilityWithoutRouting)
          ? Math.max(0, Math.min(100, roundNum(row.availabilityWithoutRouting, 2) ?? 0))
          : null;
      const tsMs = parseUtcTimestampMs(row.timestamp);
      parsed.push({
        x: row.timestamp.slice(0, 16),
        tsMs,
        availability: avail,
        rawAvailability: rawAvail,
      });
    }
    if (parsed.length <= 72) return parsed;
    // Downsample to <=72 evenly-spaced points while preserving the latest point and any outage dips
    const out: GeminiUptimeBucket[] = [];
    const step = Math.ceil(parsed.length / 72);
    for (let i = 0; i < parsed.length; i += step) {
      let chosen = parsed[i];
      for (let j = i + 1; j < Math.min(parsed.length, i + step); j++) {
        if (parsed[j].availability < chosen.availability) chosen = parsed[j];
      }
      out.push(chosen);
    }
    const last = parsed[parsed.length - 1];
    if (out[out.length - 1]?.x !== last.x) out.push(last);
    return out;
  } catch {
    return [];
  }
}

/**
 * Parse OpenRouter `/api/frontend/v1/stats/{latency,throughput,cache-hit-rate}-comparison` JSON.
 */
export function parseOpenRouterComparisonSeries(
  raw: any,
  kind: 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime',
  endpoints: GeminiEndpointPulse[],
): GeminiTimeSeriesPoint[] {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  if (!rows.length) return [];

  const epPriority = new Map<string, number>();
  const epLabel = new Map<string, string>();
  endpoints.forEach((ep, idx) => {
    epPriority.set(ep.endpointId, idx);
    epLabel.set(ep.endpointId, normalizeProviderLabel(ep.providerName || ep.providerSlug));
  });
  const primaryId = endpoints[0]?.endpointId || '';

  const out: GeminiTimeSeriesPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row.x !== 'string' || !row.y || typeof row.y !== 'object') continue;
    const xLabel = row.x.slice(0, 10);
    const tsMs = parseUtcTimestampMs(row.x);
    const entries = Object.entries(row.y as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number) && (v as number) > 0)
      .map(([epId, v]) => {
        const num = v as number;
        const scaled =
          kind === 'ttft' || kind === 'e2e'
            ? roundNum(num / 1000, 2) ?? 0
            : kind === 'cache'
              ? Math.max(0, Math.min(100, roundNum(num, 1) ?? 0))
              : kind === 'uptime'
                ? Math.max(0, Math.min(100, roundNum(num, 2) ?? 0))
                : roundNum(num, 1) ?? 0;
        return {
          epId,
          val: scaled,
          prio: epPriority.has(epId) ? epPriority.get(epId)! : 999,
          provider: epLabel.get(epId) || '',
        };
      })
      .filter((e) => e.val > 0);

    if (!entries.length) continue;

    // Headline value: primary high-volume endpoint if present, otherwise median across known endpoints
    const primaryHit = primaryId ? entries.find((e) => e.epId === primaryId) : null;
    let headline = primaryHit ? primaryHit.val : null;
    if (headline === null) {
      const known = entries.filter((e) => e.prio < 999).sort((a, b) => a.prio - b.prio);
      if (known.length > 0) {
        headline = known[0].val;
      } else {
        const vals = entries.map((e) => e.val).sort((a, b) => a - b);
        headline = vals[Math.floor(vals.length / 2)];
      }
    }

    // Per-provider breakdown (pick highest-volume endpoint per provider name)
    const byProvider: Record<string, number> = {};
    const sortedKnown = entries.filter((e) => e.provider).sort((a, b) => a.prio - b.prio);
    for (const e of sortedKnown) {
      if (!(e.provider in byProvider)) {
        byProvider[e.provider] = e.val;
      }
    }

    out.push({
      x: xLabel,
      tsMs,
      value: headline,
      ...(Object.keys(byProvider).length > 0 ? { byProvider } : {}),
    });
  }

  return out;
}

/**
 * Parse OpenRouter public model page SSR payload for 30m endpoint latency/throughput stats,
 * weighted global cache hit rate, permaslug, and 24h availability buckets.
 */
export function parseOpenRouterModelHtml(html: string): {
  permaslug: string | null;
  weightedCacheHitPct: number | null;
  endpoints: GeminiEndpointPulse[];
  uptime24h: GeminiUptimeBucket[];
  toolCallErrorPct?: number | null;
  toolCalls24h?: number;
  reasoningSharePct?: number | null;
} {
  if (!html || typeof html !== 'string') {
    return { permaslug: null, weightedCacheHitPct: null, endpoints: [], uptime24h: [] };
  }
  const unesc = html.replace(/\\"/g, '"');
  const psMatch = /"permaslug":"(google\/[a-zA-Z0-9._-]+)"/.exec(unesc);
  const permaslug = psMatch ? psMatch[1] : null;

  let weightedCacheHitPct: number | null = null;
  const providerMeta = new Map<
    string,
    {
      providerName?: string;
      providerSlug?: string;
      cacheHitRate?: number;
      totalTokens?: number;
      effectiveInputPrice?: number;
      effectiveOutputPrice?: number;
    }
  >();
  const cacheRe = /"weightedCacheHitRate":([0-9.]+|null),"providerSummaries":(\[[^\]]*\])/g;
  let cm: RegExpExecArray | null;
  while ((cm = cacheRe.exec(unesc)) !== null) {
    if (cm[1] !== 'null') {
      const rate = Number(cm[1]);
      if (Number.isFinite(rate) && rate >= 0 && rate <= 1) {
        weightedCacheHitPct = roundNum(rate * 100, 1);
      }
    }
    try {
      const arr = JSON.parse(cm[2]);
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p && typeof p.endpointId === 'string') {
            providerMeta.set(p.endpointId, p);
          }
        }
      }
    } catch {
      /* ignore malformed chunk */
    }
  }

  // Extract latest daily aggregate stats embedded in SSR (tool-call error rate & reasoning share)
  let toolCallErrorPct: number | null = null;
  let toolCalls24h = 0;
  let reasoningSharePct: number | null = null;
  const dailyRe =
    /"total_completion_tokens":(\d+)[^}]*?"total_native_tokens_reasoning":(\d+)[^}]*?"total_tool_calls":(\d+),"requests_with_tool_call_errors":(\d+)/g;
  let dm: RegExpExecArray | null;
  while ((dm = dailyRe.exec(unesc)) !== null) {
    const compTok = Number(dm[1]);
    const reasonTok = Number(dm[2]);
    const toolCalls = Number(dm[3]);
    const toolErrs = Number(dm[4]);
    if (Number.isFinite(toolCalls) && toolCalls > 0) {
      toolCalls24h = toolCalls;
      toolCallErrorPct = roundNum((toolErrs / toolCalls) * 100, 2);
    }
    if (Number.isFinite(compTok) && compTok > 0 && Number.isFinite(reasonTok) && reasonTok >= 0) {
      reasoningSharePct = Math.max(0, Math.min(100, roundNum((reasonTok / compTok) * 100, 1) ?? 0));
    }
  }

  const byEp = new Map<string, GeminiEndpointPulse>();
  const statsRe = /"stats":(\{"endpoint_id":"[^"]+"[^}]+\})/g;
  let sm: RegExpExecArray | null;
  while ((sm = statsRe.exec(unesc)) !== null) {
    try {
      const st = JSON.parse(sm[1]);
      if (!st || typeof st.endpoint_id !== 'string' || byEp.has(st.endpoint_id)) continue;
      const meta = providerMeta.get(st.endpoint_id);
      const p50Ms = typeof st.p50_latency === 'number' && st.p50_latency > 0 ? st.p50_latency : null;
      const p75Ms = typeof st.p75_latency === 'number' && st.p75_latency > 0 ? st.p75_latency : null;
      const p90Ms = typeof st.p90_latency === 'number' && st.p90_latency > 0 ? st.p90_latency : null;
      const p95Ms = typeof st.p95_latency === 'number' && st.p95_latency > 0 ? st.p95_latency : null;
      const p99Ms = typeof st.p99_latency === 'number' && st.p99_latency > 0 ? st.p99_latency : null;
      const meanMs = typeof st.mean_latency === 'number' && st.mean_latency > 0 ? st.mean_latency : null;
      const p50Tps = typeof st.p50_throughput === 'number' && st.p50_throughput > 0 ? st.p50_throughput : null;
      const p75Tps = typeof st.p75_throughput === 'number' && st.p75_throughput > 0 ? st.p75_throughput : null;
      const p90Tps = typeof st.p90_throughput === 'number' && st.p90_throughput > 0 ? st.p90_throughput : null;
      const p95Tps = typeof st.p95_throughput === 'number' && st.p95_throughput > 0 ? st.p95_throughput : null;
      const p99Tps = typeof st.p99_throughput === 'number' && st.p99_throughput > 0 ? st.p99_throughput : null;
      const cacheHitPct = typeof meta?.cacheHitRate === 'number' && meta.cacheHitRate >= 0 && meta.cacheHitRate <= 1
        ? roundNum(meta.cacheHitRate * 100, 1)
        : null;
      const effIn = typeof meta?.effectiveInputPrice === 'number' && Number.isFinite(meta.effectiveInputPrice)
        ? roundNum(meta.effectiveInputPrice, 3)
        : null;
      const effOut = typeof meta?.effectiveOutputPrice === 'number' && Number.isFinite(meta.effectiveOutputPrice)
        ? roundNum(meta.effectiveOutputPrice, 2)
        : null;
      byEp.set(st.endpoint_id, {
        endpointId: st.endpoint_id,
        providerName: typeof meta?.providerName === 'string' ? meta.providerName : '',
        providerSlug: typeof meta?.providerSlug === 'string' ? meta.providerSlug : '',
        cacheHitPct,
        p50TtftSec: p50Ms !== null ? roundNum(p50Ms / 1000, 2) : null,
        p75TtftSec: p75Ms !== null ? roundNum(p75Ms / 1000, 2) : null,
        p90TtftSec: p90Ms !== null ? roundNum(p90Ms / 1000, 2) : null,
        ...(p95Ms !== null ? { p95TtftSec: roundNum(p95Ms / 1000, 2) } : {}),
        ...(p99Ms !== null ? { p99TtftSec: roundNum(p99Ms / 1000, 2) } : {}),
        ...(meanMs !== null ? { meanTtftSec: roundNum(meanMs / 1000, 2) } : {}),
        p50Tps: p50Tps !== null ? roundNum(p50Tps, 1) : null,
        ...(p75Tps !== null ? { p75Tps: roundNum(p75Tps, 1) } : {}),
        p90Tps: p90Tps !== null ? roundNum(p90Tps, 1) : null,
        ...(p95Tps !== null ? { p95Tps: roundNum(p95Tps, 1) } : {}),
        ...(p99Tps !== null ? { p99Tps: roundNum(p99Tps, 1) } : {}),
        ...(effIn !== null ? { effectiveInputPrice: effIn } : {}),
        ...(effOut !== null ? { effectiveOutputPrice: effOut } : {}),
        ...(typeof meta?.totalTokens === 'number' && meta.totalTokens > 0 ? { totalTokens: Math.round(meta.totalTokens) } : {}),
        requestCount: typeof st.request_count === 'number' && st.request_count > 0 ? Math.round(st.request_count) : 0,
        windowMinutes: typeof st.window_minutes === 'number' && st.window_minutes > 0 ? st.window_minutes : 30,
      });
    } catch {
      /* ignore malformed stats object */
    }
  }

  const endpoints = [...byEp.values()].sort((a, b) => b.requestCount - a.requestCount);
  const uptime24h = parseOpenRouterUptimeBuckets(unesc);
  return {
    permaslug,
    weightedCacheHitPct,
    endpoints,
    uptime24h,
    ...(toolCallErrorPct !== null ? { toolCallErrorPct } : {}),
    ...(toolCalls24h > 0 ? { toolCalls24h } : {}),
    ...(reasoningSharePct !== null ? { reasoningSharePct } : {}),
  };
}

/**
 * Parse OpenRouter `/api/v1/models/<slug>/endpoints` JSON for 5m/30m/1d uptime & provider status flags.
 */
export function parseOpenRouterEndpointsJson(raw: any): {
  uptime5mPct?: number | null;
  uptime30mPct: number | null;
  uptime1dPct?: number | null;
  degradedProviders: string[];
} {
  const eps = Array.isArray(raw?.data?.endpoints) ? raw.data.endpoints : [];
  if (!eps.length) return { uptime5mPct: null, uptime30mPct: null, uptime1dPct: null, degradedProviders: [] };

  // Prefer primary standard endpoints (google-vertex/global, google-ai-studio) over low-traffic flex/priority tiers.
  const isStandard = (tag: string) => {
    const t = String(tag || '').toLowerCase();
    return t === 'google-vertex/global' || t === 'google-ai-studio';
  };
  const stdEps = eps.filter((e: any) => isStandard(e?.tag));
  const pool = stdEps.length > 0 ? stdEps : eps;

  const uptimes5m: number[] = [];
  const uptimes30m: number[] = [];
  const uptimes1d: number[] = [];
  const degradedProviders: string[] = [];
  for (const e of pool) {
    const tag = String(e?.tag || e?.provider_name || 'provider');
    const up5 = typeof e?.uptime_last_5m === 'number' && Number.isFinite(e.uptime_last_5m)
      ? Math.max(0, Math.min(100, e.uptime_last_5m))
      : null;
    const up30 = typeof e?.uptime_last_30m === 'number' && Number.isFinite(e.uptime_last_30m)
      ? Math.max(0, Math.min(100, e.uptime_last_30m))
      : null;
    const up1d = typeof e?.uptime_last_1d === 'number' && Number.isFinite(e.uptime_last_1d)
      ? Math.max(0, Math.min(100, e.uptime_last_1d))
      : null;
    if (up5 !== null) uptimes5m.push(up5);
    if (up30 !== null) uptimes30m.push(up30);
    if (up1d !== null) uptimes1d.push(up1d);
    const st = typeof e?.status === 'number' ? e.status : 0;
    if (st < 0 || (up30 !== null && up30 < 95)) {
      const label = tag.includes('vertex') ? 'Google Vertex' : (tag.includes('ai-studio') ? 'AI Studio' : tag);
      if (!degradedProviders.includes(label)) degradedProviders.push(label);
    }
  }

  const uptime5mPct = uptimes5m.length > 0 ? roundNum(Math.min(...uptimes5m), 1) : null;
  const uptime30mPct = uptimes30m.length > 0 ? roundNum(Math.min(...uptimes30m), 1) : null;
  const uptime1dPct = uptimes1d.length > 0 ? roundNum(Math.min(...uptimes1d), 1) : null;
  return { uptime5mPct, uptime30mPct, uptime1dPct, degradedProviders };
}

/**
 * Filter Google Cloud Service Health incidents.json for active Gemini / Vertex AI disruptions.
 */
export function parseGcpGeminiIncidents(raw: any): GcpActiveIncident[] {
  if (!Array.isArray(raw)) return [];
  const out: GcpActiveIncident[] = [];
  for (const inc of raw) {
    if (!inc || inc.end) continue; // Only active unresolved incidents
    const service = String(inc.service_name || '');
    const desc = String(inc.external_desc || inc.most_recent_update?.text || '');
    const products = Array.isArray(inc.affected_products)
      ? inc.affected_products.map((p: any) => String(p?.title || '')).join(' ')
      : '';
    const matchesGemini = GCP_GEMINI_RE.test(`${service} ${desc} ${products}`);
    const isMajorMulti = /multiple products/i.test(service) && String(inc.severity || '').toLowerCase() === 'high';
    if (!matchesGemini && !isMajorMulti) continue;
    const uri = typeof inc.uri === 'string' && inc.uri
      ? (inc.uri.startsWith('http') ? inc.uri : `https://status.cloud.google.com/${inc.uri.replace(/^\/+/, '')}`)
      : 'https://status.cloud.google.com/';
    out.push({
      id: String(inc.id || inc.number || ''),
      service: service || 'Google Cloud AI',
      severity: String(inc.severity || 'medium').toLowerCase(),
      impact: String(inc.status_impact || 'SERVICE_DISRUPTION'),
      summary: desc.slice(0, 180),
      begin: String(inc.begin || inc.created || ''),
      url: uri,
    });
  }
  return out;
}

export function classifyModelPulseStatus(
  params: {
    uptime30mPct: number | null;
    degradedProviders: string[];
    p50TtftSec: number | null;
    p90TtftSec: number | null;
  },
  activeIncidents: GcpActiveIncident[],
): PulseHealthStatus {
  const hasHighIncident = activeIncidents.some((i) => i.severity === 'high' || /OUTAGE/i.test(i.impact));
  if (hasHighIncident || (params.uptime30mPct !== null && params.uptime30mPct < 85)) {
    return 'outage';
  }
  if (
    activeIncidents.length > 0
    || (params.uptime30mPct !== null && params.uptime30mPct < 98)
    || params.degradedProviders.length > 0
    || (params.p90TtftSec !== null && params.p90TtftSec >= 20)
    || (params.p50TtftSec !== null && params.p50TtftSec >= 9)
  ) {
    return 'degraded';
  }
  return 'ok';
}

const INTRADAY_BUCKET_MS = 30 * 60_000;
const INTRADAY_MAX_AGE_MS = 48 * 3_600_000;

export function formatUtcBucketLabel(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Append a live 30m snapshot into a 48-hour ring buffer (deduplicated per 30m UTC bucket).
 */
export function mergeIntradayHistory(
  existing: GeminiIntradayPoint[] | undefined,
  current: GeminiModelGlobalPulse,
  nowMs = Date.now(),
  extraPoints?: GeminiIntradayPoint[],
): GeminiIntradayPoint[] {
  const cutoff = nowMs - INTRADAY_MAX_AGE_MS;
  const byBucket = new Map<number, GeminiIntradayPoint>();
  for (const list of [existing || [], extraPoints || []]) {
    for (const pt of list) {
      if (!pt || typeof pt.bucketMs !== 'number' || !Number.isFinite(pt.bucketMs) || pt.bucketMs < cutoff) continue;
      byBucket.set(pt.bucketMs, pt);
    }
  }

  if (
    current.p50TtftSec !== null ||
    current.p50Tps !== null ||
    current.cacheHitPct !== null ||
    current.uptime30mPct !== null
  ) {
    const bucketMs = Math.floor(nowMs / INTRADAY_BUCKET_MS) * INTRADAY_BUCKET_MS;
    const byProvider: Record<string, { ttft?: number | null; tps?: number | null; cache?: number | null }> = {};
    for (const ep of current.endpoints || []) {
      const prov = normalizeProviderLabel(ep.providerName || ep.providerSlug);
      if (!prov || prov in byProvider) continue;
      byProvider[prov] = {
        ttft: ep.p50TtftSec,
        tps: ep.p50Tps,
        cache: ep.cacheHitPct,
      };
    }
    byBucket.set(bucketMs, {
      bucketMs,
      x: formatUtcBucketLabel(bucketMs),
      p50TtftSec: current.p50TtftSec,
      ...(current.p90TtftSec !== null ? { p90TtftSec: current.p90TtftSec } : {}),
      ...(current.p99TtftSec !== null && current.p99TtftSec !== undefined ? { p99TtftSec: current.p99TtftSec } : {}),
      p50Tps: current.p50Tps,
      cacheHitPct: current.cacheHitPct,
      uptime30mPct: current.uptime30mPct,
      ...(current.requestCount30m > 0 ? { requestCount30m: current.requestCount30m } : {}),
      ...(Object.keys(byProvider).length > 0 ? { byProvider } : {}),
    });
  }

  return [...byBucket.values()]
    .sort((a, b) => a.bucketMs - b.bucketMs)
    .slice(-96);
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

/**
 * Compute the user's own 7-day local baseline per Gemini family from graph summaries,
 * stratified into high-cache-hit vs cold-prefill buckets.
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
    byDay: Map<string, { ttfts: number[]; tps: number[]; cachedSum: number; promptSum: number; calls: number }>;
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
          byDay: new Map(),
        };
        acc.set(fam, b);
      }
      b.calls += 1;
      const newIn = c.newInput || 0;
      const cachedIn = c.cachedInput || 0;
      const totIn = newIn + cachedIn;
      b.cachedSum += cachedIn;
      b.promptSum += totIn;
      const cachePct = totIn > 0 ? (cachedIn / totIn) * 100 : null;
      const validTtft = typeof c.ttftSec === 'number' && Number.isFinite(c.ttftSec) && c.ttftSec > 0 && c.ttftSec < 300;
      const validTps = typeof c.genTps === 'number' && Number.isFinite(c.genTps) && c.genTps > 0 && c.genTps < 2000;

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

  const out: Record<string, GeminiLocalBaseline> = Object.create(null);
  for (const [fam, b] of acc.entries()) {
    b.ttfts.sort((a, x) => a - x);
    b.hitTtfts.sort((a, x) => a - x);
    b.missTtfts.sort((a, x) => a - x);
    b.tps.sort((a, x) => a - x);
    b.ttfts24h.sort((a, x) => a - x);
    b.tps24h.sort((a, x) => a - x);
    b.ttfts30m.sort((a, x) => a - x);
    b.tps30m.sort((a, x) => a - x);

    const daily7d: GeminiLocalDailyPoint[] = [...b.byDay.entries()]
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

    out[fam] = {
      calls7d: b.calls,
      p50TtftSec: roundNum(quantile(b.ttfts, 0.5), 2),
      p90TtftSec: roundNum(quantile(b.ttfts, 0.9), 2),
      hitP50TtftSec: b.hitTtfts.length >= 3 ? roundNum(quantile(b.hitTtfts, 0.5), 2) : null,
      missP50TtftSec: b.missTtfts.length >= 3 ? roundNum(quantile(b.missTtfts, 0.5), 2) : null,
      p50Tps: roundNum(quantile(b.tps, 0.5), 1),
      cacheHitPct: b.promptSum > 0 ? roundNum((b.cachedSum / b.promptSum) * 100, 1) : null,
      calls30m: b.calls30m,
      p50Ttft30mSec: roundNum(quantile(b.ttfts30m, 0.5), 2),
      p50Tps30m: roundNum(quantile(b.tps30m, 0.5), 1),
      cacheHit30mPct: b.promptSum30m > 0 ? roundNum((b.cachedSum30m / b.promptSum30m) * 100, 1) : null,
      calls24h: b.calls24h,
      p50Ttft24hSec: roundNum(quantile(b.ttfts24h, 0.5), 2),
      p50Tps24h: roundNum(quantile(b.tps24h, 0.5), 1),
      cacheHit24hPct: b.promptSum24h > 0 ? roundNum((b.cachedSum24h / b.promptSum24h) * 100, 1) : null,
      daily7d,
    };
  }
  return out;
}

/**
 * Attribute the latest Gemini invocation's TTFT latency into 4 actionable root causes
 * (plus `normal`), comparing current request vs local 7d bucketed baseline vs OpenRouter 30m global stats.
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

  let localBucket: 'hit' | 'miss' | 'all' = 'all';
  let localRefP50 = localBaseline?.p50TtftSec ?? null;
  if (isColdPrefill && localBaseline?.missP50TtftSec !== null && localBaseline?.missP50TtftSec !== undefined) {
    localBucket = 'miss';
    localRefP50 = localBaseline.missP50TtftSec;
  } else if (!isColdPrefill && localBaseline?.hitP50TtftSec !== null && localBaseline?.hitP50TtftSec !== undefined) {
    localBucket = 'hit';
    localRefP50 = localBaseline.hitP50TtftSec;
  }

  const gP50 = globalModel?.p50TtftSec ?? null;
  const gP90 = globalModel?.p90TtftSec ?? null;
  const gStatus: PulseHealthStatus | 'unknown' = globalModel?.status ?? (activeIncidents.length > 0 ? 'degraded' : 'unknown');

  const slowThreshold = Math.max(
    4.0,
    localRefP50 !== null ? localRefP50 * 1.85 : 4.5,
  );
  const isSlow = ttft >= slowThreshold;

  let verdict: TtftVerdictKind = 'normal';
  if (isSlow) {
    const upstreamUnhealthy = activeIncidents.length > 0 || gStatus === 'outage' || gStatus === 'degraded';
    // Even if uptime is 100%, if global P50 itself is elevated (>=4s) and user's TTFT sits within
    // the global P50..P90 band, the whole upstream pool is running slow right now.
    const withinElevatedGlobalBand = gP50 !== null
      && gP50 >= 4.0
      && ttft <= Math.max(gP90 ?? gP50 * 2.2, gP50 * 2.0) * 1.15;

    if (upstreamUnhealthy || withinElevatedGlobalBand) {
      verdict = 'upstream_degraded';
    } else if (isColdPrefill) {
      verdict = 'cache_miss';
    } else if (inFlightCount >= 2) {
      verdict = 'local_concurrency';
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

export function getGeminiPulseVersion(): number {
  return pulseSeq;
}

function loadDiskCache(cachePath: string): GeminiPulseCacheFile {
  if (memCache && memCachePath === cachePath) return memCache;
  let loaded: GeminiPulseCacheFile | null = null;
  try {
    if (cachePath && existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.version >= 1 && raw.version <= 4) {
        loaded = {
          version: raw.version,
          enabled: raw.enabled !== false,
          fetchedAtMs: typeof raw.fetchedAtMs === 'number' ? raw.fetchedAtMs : 0,
          models: Array.isArray(raw.models) ? raw.models : [],
          incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
          ...(typeof raw.error === 'string' && raw.error ? { error: raw.error } : {}),
        };
      }
    }
  } catch {
    /* ignore corrupt cache */
  }
  memCache = loaded || { version: 4, enabled: true, fetchedAtMs: 0, models: [], incidents: [] };
  memCachePath = cachePath;
  return memCache;
}

function saveDiskCache(cachePath: string, data: GeminiPulseCacheFile): void {
  memCache = data;
  memCachePath = cachePath;
  if (!cachePath) return;
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
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

async function tryFetchRemotePulseFeed(
  feedUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ fetchedAtMs: number; models: GeminiModelGlobalPulse[]; incidents: GcpActiveIncident[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULSE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(feedUrl, {
      headers: { 'User-Agent': 'agy-hud/1.2.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.models) || json.models.length === 0) return null;
    return {
      fetchedAtMs: typeof json.fetchedAtMs === 'number' && json.fetchedAtMs > 0 ? json.fetchedAtMs : Date.now(),
      models: json.models as GeminiModelGlobalPulse[],
      incidents: Array.isArray(json.incidents) ? (json.incidents as GcpActiveIncident[]) : [],
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
  fetchImpl?: typeof globalThis.fetch;
  feedUrl?: string;
  nowMs?: number;
} = {}): Promise<GeminiPulseCacheFile> {
  const cachePath = opts.cachePath || resolveGeminiPulsePath(opts.appDataDir);
  const cur = loadDiskCache(cachePath);
  const nowMs = opts.nowMs ?? Date.now();
  if (!cur.enabled && !opts.force) return cur;
  if (!opts.force && cur.fetchedAtMs > 0 && nowMs - cur.fetchedAtMs < PULSE_TTL_MS && cur.models.length > 0) {
    return cur;
  }
  if (fetchInFlight && !opts.force) return fetchInFlight;

  const prevByFamily = new Map<string, GeminiModelGlobalPulse>(
    cur.models.map((m) => [m.family, m]),
  );

  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const run = (async (): Promise<GeminiPulseCacheFile> => {
    try {
      // Optional remote Cloudflare Worker Gemini Pulse feed (auto-falls back to direct OpenRouter on failure)
      const feedEndpoint = resolveRemoteFeedEndpoint(opts.feedUrl);
      if (feedEndpoint) {
        const remote = await tryFetchRemotePulseFeed(feedEndpoint, fetchImpl);
        if (remote) {
          const mergedModels = remote.models.map((rm) => {
            const prev = prevByFamily.get(rm.family);
            const intraday30m = mergeIntradayHistory(
              prev?.series?.intraday30m,
              rm,
              remote.fetchedAtMs,
              rm.series?.intraday30m,
            );
            return {
              ...rm,
              series: {
                ttft7d: rm.series?.ttft7d || prev?.series?.ttft7d || [],
                ...(rm.series?.e2e7d?.length ? { e2e7d: rm.series.e2e7d } : {}),
                tps7d: rm.series?.tps7d || prev?.series?.tps7d || [],
                cache7d: rm.series?.cache7d || prev?.series?.cache7d || [],
                ...(rm.series?.uptime7d?.length ? { uptime7d: rm.series.uptime7d } : {}),
                uptime24h: rm.series?.uptime24h || prev?.series?.uptime24h || [],
                ...(intraday30m.length ? { intraday30m } : {}),
              },
            };
          });
          const next: GeminiPulseCacheFile = {
            version: 4,
            enabled: cur.enabled,
            fetchedAtMs: Date.now(),
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
        { 'User-Agent': 'agy-hud/1.2.0', Accept: 'application/json' },
      )
        .then((txt) => parseGcpGeminiIncidents(JSON.parse(txt)))
        .catch(() => [] as GcpActiveIncident[]);

      const modelPromises = GEMINI_PULSE_MODELS.map(async (spec) => {
        const [htmlRes, epRes] = await Promise.allSettled([
          fetchTextSafe(
            `https://openrouter.ai/${spec.slug}`,
            fetchImpl,
            { 'User-Agent': 'Mozilla/5.0 (compatible; agy-hud/1.2.0)', Accept: 'text/html' },
          ),
          fetchTextSafe(
            `https://openrouter.ai/api/v1/models/${spec.slug}/endpoints`,
            fetchImpl,
            { 'User-Agent': 'agy-hud/1.2.0', Accept: 'application/json' },
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
        } = { uptime5mPct: null, uptime30mPct: null, uptime1dPct: null, degradedProviders: [] };
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
        const ps = htmlParsed.permaslug;
        if (ps) {
          const qs = `permaslug=${encodeURIComponent(ps)}`;
          const hdrs = { 'User-Agent': 'Mozilla/5.0 (compatible; agy-hud/1.2.0)', Accept: 'application/json' };
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
        const failed: GeminiPulseCacheFile = {
          ...cur,
          error: 'Unable to reach OpenRouter Gemini stats',
        };
        saveDiskCache(cachePath, failed);
        pulseSeq += 1;
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
              ttft7d: base.series?.ttft7d || [],
              ...(base.series?.e2e7d?.length ? { e2e7d: base.series.e2e7d } : {}),
              tps7d: base.series?.tps7d || [],
              cache7d: base.series?.cache7d || [],
              ...(base.series?.uptime7d?.length ? { uptime7d: base.series.uptime7d } : {}),
              uptime24h: base.series?.uptime24h || [],
              intraday30m,
            };
          }
          return base;
        });

      const next: GeminiPulseCacheFile = {
        version: 4,
        enabled: cur.enabled,
        fetchedAtMs: snapMs,
        models,
        incidents,
      };
      saveDiskCache(cachePath, next);
      pulseSeq += 1;
      return next;
    } catch (err: any) {
      const failed: GeminiPulseCacheFile = {
        ...cur,
        error: err?.message || String(err),
      };
      saveDiskCache(cachePath, failed);
      pulseSeq += 1;
      return failed;
    } finally {
      fetchInFlight = null;
    }
  })();

  fetchInFlight = run;
  return run;
}

/**
 * Non-blocking read for `/api/stats`: returns cached/disk Gemini pulse enriched with
 * local 7-day baselines and current TTFT attribution, kicking off a background refresh
 * if the cache is empty or stale (>5m).
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

  if (triggerRefresh && cache.enabled && isStale && !fetchInFlight) {
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
