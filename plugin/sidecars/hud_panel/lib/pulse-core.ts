/**
 * Shared, dependency-free Gemini Pulse core: model catalog, OpenRouter SSR/API parsers,
 * GCP incident filtering & URL sanitization, status classification, and 5m intraday ring buffer.
 *
 * Consumed directly by:
 * - AGY-HUD sidecar (`plugin/sidecars/hud_panel/lib/gemini-pulse.ts`, Node 22 native TS)
 * - Cloudflare Worker (`workers/gemini-pulse/src/index.ts`, Wrangler/esbuild)
 * - Launch site `/pulse/` (`site/src/pulse/pulseApi.ts`, Vite)
 *
 * Lives inside `plugin/` so the installed Antigravity sidecar stays 100% self-contained.
 */

export interface GeminiPulseModelSpec {
  family: string;
  slug: string;
  label: string;
  shortLabel: string;
  color: string;
}

export const GEMINI_PULSE_MODELS: readonly GeminiPulseModelSpec[] = Object.freeze([
  { family: 'gemini-4-neon', slug: 'google/gemini-4-neon', label: 'Gemini 4 Neon', shortLabel: 'Neon', color: '#4f86f7' },
  { family: 'gemini-4-hydrogen', slug: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', shortLabel: 'Hydrogen', color: '#34d399' },
  { family: 'gemini-4-carbon', slug: 'google/gemini-4-carbon', label: 'Gemini 4 Carbon', shortLabel: 'Carbon', color: '#a78bfa' },
  { family: 'gemini-4-argon', slug: 'google/gemini-4-argon', label: 'Gemini 4 Argon', shortLabel: 'Argon', color: '#fbbf24' },
  { family: 'gemini-3.8-flash', slug: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', shortLabel: '3.8 Flash', color: '#f87171' },
]);

export const GEMINI_PULSE_FAMILY_SET: ReadonlySet<string> = new Set(
  GEMINI_PULSE_MODELS.map((m) => m.family),
);

export const GCP_STATUS_ROOT = 'https://status.cloud.google.com/';
export const GCP_GEMINI_RE = /vertex|gemini|generative|ai platform|cloud ai|model garden/i;

export const INTRADAY_BUCKET_MS = 5 * 60_000;
export const INTRADAY_MAX_AGE_MS = 24 * 3_600_000;
export const INTRADAY_MAX_POINTS = 288;

export type PulseHealthStatus = 'ok' | 'degraded' | 'outage';

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
  uptime5mPct?: number | null;
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

export interface GcpActiveIncident {
  id: string;
  service: string;
  severity: string;
  impact: string;
  summary: string;
  begin: string;
  url: string;
}

export interface OpenRouterHtmlParsed {
  permaslug: string | null;
  weightedCacheHitPct: number | null;
  endpoints: GeminiEndpointPulse[];
  uptime24h: GeminiUptimeBucket[];
  toolCallErrorPct?: number | null;
  toolCalls24h?: number;
  reasoningSharePct?: number | null;
  avgPromptTokens?: number | null;
  avgOutputTokens?: number | null;
}

export interface OpenRouterEndpointsParsed {
  uptime5mPct: number | null;
  uptime30mPct: number | null;
  uptime1dPct: number | null;
  degradedProviders: string[];
  permaslugFallback: string | null;
  endpointCount: number;
}

export function roundNum(v: number | null | undefined, digits = 2): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function clampPct(v: unknown, digits = 1): number | null {
  const n = finiteNum(v);
  if (n === null) return null;
  const r = roundNum(n, digits);
  if (r === null) return null;
  return Math.max(0, Math.min(100, r));
}

export function normalizeProviderLabel(raw: string): string {
  const s = String(raw || '').trim();
  if (/vertex/i.test(s)) return 'Google Vertex';
  if (/ai[- ]?studio/i.test(s)) return 'AI Studio';
  return s.replace(/\s*\(\d+\)\s*$/, '').trim() || 'Provider';
}

export function parseUtcTimestampMs(raw: string): number {
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

export function formatUtcBucketLabel(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Strictly enforce that incident links point to `https://status.cloud.google.com/...`.
 * Blocks `javascript:`, `data:`, and arbitrary third-party URLs from untrusted feeds.
 */
export function sanitizeGcpIncidentUrl(raw: unknown): string {
  if (typeof raw !== 'string') return GCP_STATUS_ROOT;
  const trimmed = raw.trim();
  if (!trimmed) return GCP_STATUS_ROOT;
  if (/^https:\/\/status\.cloud\.google\.com(\/|$)/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'https:' && u.hostname.toLowerCase() === 'status.cloud.google.com') {
        return u.toString();
      }
    } catch {
      return GCP_STATUS_ROOT;
    }
  }
  return GCP_STATUS_ROOT;
}

/**
 * Sanitize an untrusted incident record (from remote feeds or localStorage cache).
 */
export function sanitizeIncident(raw: unknown): GcpActiveIncident | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.slice(0, 80) : '';
  const summary = typeof r.summary === 'string' ? r.summary.slice(0, 240) : '';
  if (!id && !summary) return null;
  return {
    id: id || summary.slice(0, 32),
    service: typeof r.service === 'string' && r.service.trim() ? r.service.slice(0, 120) : 'Google Cloud AI',
    severity: typeof r.severity === 'string' && r.severity.trim() ? r.severity.toLowerCase().slice(0, 32) : 'medium',
    impact: typeof r.impact === 'string' && r.impact.trim() ? r.impact.slice(0, 64) : 'SERVICE_DISRUPTION',
    summary,
    begin: typeof r.begin === 'string' ? r.begin.slice(0, 64) : '',
    url: sanitizeGcpIncidentUrl(r.url),
  };
}

/**
 * Evenly downsample 24h availability buckets to <=maxPoints while preserving the latest point
 * and keeping the lowest availability (outage dip) in every window.
 */
export function downsampleUptimeBuckets(
  parsed: GeminiUptimeBucket[],
  maxPoints = 72,
): GeminiUptimeBucket[] {
  if (parsed.length <= maxPoints) return parsed;
  const out: GeminiUptimeBucket[] = [];
  const step = Math.ceil(parsed.length / maxPoints);
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
      const avail = clampPct(row.availability, 2);
      if (avail === null) continue;
      const rawAvail = clampPct(row.availabilityWithoutRouting, 2);
      const tsMs = parseUtcTimestampMs(row.timestamp);
      parsed.push({
        x: row.timestamp.slice(0, 16),
        tsMs,
        availability: avail,
        rawAvailability: rawAvail,
      });
    }
    return downsampleUptimeBuckets(parsed, 72);
  } catch {
    return [];
  }
}

/**
 * Parse OpenRouter `/api/frontend/v1/stats/{latency,latency-e2e,throughput,cache-hit-rate,uptime}-comparison` JSON.
 */
export function parseOpenRouterComparisonSeries(
  raw: any,
  kind: 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime',
  endpoints: Array<{ endpointId?: string; providerName?: string; providerSlug?: string }> = [],
): GeminiTimeSeriesPoint[] {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  if (!rows.length) return [];

  const epPriority = new Map<string, number>();
  const epLabel = new Map<string, string>();
  endpoints.forEach((ep, idx) => {
    const id = String(ep.endpointId || '');
    if (id) {
      epPriority.set(id, idx);
      epLabel.set(id, normalizeProviderLabel(String(ep.providerName || ep.providerSlug || '')));
    }
  });
  const primaryId = String(endpoints[0]?.endpointId || '');

  const out: GeminiTimeSeriesPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row.x !== 'string' || !row.y || typeof row.y !== 'object') continue;
    const xLabel = row.x.slice(0, 10);
    const tsMs = parseUtcTimestampMs(row.x);
    const entries = Object.entries(row.y as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
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

    // Headline value: primary high-volume endpoint if present, otherwise median across endpoints
    const primaryHit = primaryId ? entries.find((e) => e.epId === primaryId) : null;
    let headline = primaryHit ? primaryHit.val : null;
    if (headline === null) {
      const known = entries.filter((e) => e.prio < 999).sort((a, b) => a.prio - b.prio);
      if (known.length > 0) {
        headline = known[0].val;
      } else {
        const vals = entries.map((e) => e.val).sort((a, b) => a - b);
        const mid = Math.floor(vals.length / 2);
        headline = vals.length % 2 === 1 ? vals[mid] : roundNum((vals[mid - 1] + vals[mid]) / 2, kind === 'tps' || kind === 'cache' ? 1 : 2) ?? vals[mid];
      }
    }

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
 * Low-CPU targeted extractor for OpenRouter model page SSR HTML.
 * Avoids full-page string unescaping (safe within Cloudflare Workers' 10ms CPU budget),
 * anchors stats objects strictly to `"stats":`, and downsamples 24h uptime evenly.
 */
export function parseOpenRouterModelHtml(html: string): OpenRouterHtmlParsed {
  if (!html || typeof html !== 'string') {
    return { permaslug: null, weightedCacheHitPct: null, endpoints: [], uptime24h: [] };
  }

  // 1) Permaslug
  let permaslug: string | null = null;
  let psPos = 0;
  while (psPos >= 0 && !permaslug) {
    const idx = html.indexOf('permaslug', psPos);
    if (idx < 0) break;
    const chunk = html.slice(Math.max(0, idx - 4), idx + 140).replace(/\\"/g, '"');
    const m = /"permaslug":"(google\/[a-zA-Z0-9._-]+)"/.exec(chunk);
    if (m) permaslug = m[1];
    psPos = idx + 12;
  }

  // 2) Weighted cache hit rate + providerSummaries metadata
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
  let cachePos = 0;
  while (cachePos >= 0) {
    const idx = html.indexOf('weightedCacheHitRate', cachePos);
    if (idx < 0) break;
    const chunk = html.slice(Math.max(0, idx - 4), idx + 6000).replace(/\\"/g, '"');
    const cm = /"weightedCacheHitRate":([0-9.]+|null),"providerSummaries":(\[[^\]]*\])/.exec(chunk);
    if (cm) {
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
    cachePos = idx + 24;
  }

  // 3) Latest daily aggregate stats (tool-call error rate, reasoning share & avg prompt/output tokens)
  let toolCallErrorPct: number | null = null;
  let toolCalls24h = 0;
  let reasoningSharePct: number | null = null;
  let avgPromptTokens: number | null = null;
  let avgOutputTokens: number | null = null;
  const toolIdx = html.lastIndexOf('requests_with_tool_call_errors');
  if (toolIdx >= 0) {
    const chunk = html.slice(Math.max(0, toolIdx - 560), toolIdx + 120).replace(/\\"/g, '"');
    const dm =
      /"total_completion_tokens":(\d+)(?:,"total_prompt_tokens":(\d+))?[^}]*?"total_native_tokens_reasoning":(\d+)(?:,"count":(\d+))?[^}]*?"total_tool_calls":(\d+),"requests_with_tool_call_errors":(\d+)/.exec(
        chunk,
      );
    if (dm) {
      const compTok = Number(dm[1]);
      const promptTok = dm[2] ? Number(dm[2]) : 0;
      const reasonTok = Number(dm[3]);
      const reqCnt = dm[4] ? Number(dm[4]) : 0;
      const toolCalls = Number(dm[5]);
      const toolErrs = Number(dm[6]);
      if (Number.isFinite(toolCalls) && toolCalls > 0) {
        toolCalls24h = toolCalls;
        toolCallErrorPct = roundNum((toolErrs / toolCalls) * 100, 2);
      }
      if (Number.isFinite(compTok) && compTok > 0 && Number.isFinite(reasonTok) && reasonTok >= 0) {
        reasoningSharePct = Math.max(0, Math.min(100, roundNum((reasonTok / compTok) * 100, 1) ?? 0));
      }
      if (Number.isFinite(reqCnt) && reqCnt > 0) {
        if (Number.isFinite(promptTok) && promptTok > 0) avgPromptTokens = Math.round(promptTok / reqCnt);
        if (Number.isFinite(compTok) && compTok > 0) avgOutputTokens = Math.round(compTok / reqCnt);
      }
    }
  }

  // 4) 30m endpoint stats blocks anchored strictly on `"stats":`
  const byEp = new Map<string, GeminiEndpointPulse>();
  let stPos = 0;
  while (stPos >= 0) {
    const idx = html.indexOf('endpoint_id', stPos);
    if (idx < 0) break;
    const chunk = html.slice(Math.max(0, idx - 32), idx + 760).replace(/\\"/g, '"');
    const sm = /"stats":(\{"endpoint_id":"[^"]+"[^}]+\})/.exec(chunk);
    if (sm) {
      try {
        const st = JSON.parse(sm[1]);
        if (st && typeof st.endpoint_id === 'string' && !byEp.has(st.endpoint_id)) {
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
          const cacheHitPct =
            typeof meta?.cacheHitRate === 'number' && meta.cacheHitRate >= 0 && meta.cacheHitRate <= 1
              ? roundNum(meta.cacheHitRate * 100, 1)
              : null;
          const effIn =
            typeof meta?.effectiveInputPrice === 'number' && Number.isFinite(meta.effectiveInputPrice)
              ? roundNum(meta.effectiveInputPrice, 3)
              : null;
          const effOut =
            typeof meta?.effectiveOutputPrice === 'number' && Number.isFinite(meta.effectiveOutputPrice)
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
        }
      } catch {
        /* ignore malformed stats object */
      }
    }
    stPos = idx + 16;
  }

  const endpoints = [...byEp.values()].sort((a, b) => b.requestCount - a.requestCount);

  // 5) 24h availability buckets (targeted slice around `availabilityWithoutRouting` or `buckets`)
  let uptime24h: GeminiUptimeBucket[] = [];
  const availIdx = html.indexOf('availabilityWithoutRouting');
  const bStart = availIdx >= 0 ? html.lastIndexOf('buckets', availIdx) : html.indexOf('buckets');
  if (bStart >= 0) {
    const bChunk = html.slice(Math.max(0, bStart - 4), bStart + 28000).replace(/\\"/g, '"');
    uptime24h = parseOpenRouterUptimeBuckets(bChunk);
  }

  return {
    permaslug,
    weightedCacheHitPct,
    endpoints,
    uptime24h,
    ...(toolCallErrorPct !== null ? { toolCallErrorPct } : {}),
    ...(toolCalls24h > 0 ? { toolCalls24h } : {}),
    ...(reasoningSharePct !== null ? { reasoningSharePct } : {}),
    ...(avgPromptTokens !== null ? { avgPromptTokens } : {}),
    ...(avgOutputTokens !== null ? { avgOutputTokens } : {}),
  };
}

/**
 * Parse OpenRouter `/api/v1/models/<slug>/endpoints` JSON for 5m/30m/1d uptime & provider status flags.
 */
export function parseOpenRouterEndpointsJson(raw: any): OpenRouterEndpointsParsed {
  const eps = Array.isArray(raw?.data?.endpoints) ? raw.data.endpoints : [];
  if (!eps.length) {
    return {
      uptime5mPct: null,
      uptime30mPct: null,
      uptime1dPct: null,
      degradedProviders: [],
      permaslugFallback: null,
      endpointCount: 0,
    };
  }

  let permaslugFallback: string | null = null;
  for (const e of eps) {
    if (!permaslugFallback && typeof e?.name === 'string') {
      const m = /(google\/[a-zA-Z0-9._-]+)$/.exec(e.name.trim());
      if (m) permaslugFallback = m[1];
    }
  }

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
    const up5 = clampPct(e?.uptime_last_5m, 1);
    const up30 = clampPct(e?.uptime_last_30m, 1);
    const up1d = clampPct(e?.uptime_last_1d, 1);
    if (up5 !== null) uptimes5m.push(up5);
    if (up30 !== null) uptimes30m.push(up30);
    if (up1d !== null) uptimes1d.push(up1d);
    const st = typeof e?.status === 'number' ? e.status : 0;
    if (st < 0 || (up30 !== null && up30 < 95)) {
      const label = normalizeProviderLabel(tag);
      if (!degradedProviders.includes(label)) degradedProviders.push(label);
    }
  }

  return {
    uptime5mPct: uptimes5m.length > 0 ? roundNum(Math.min(...uptimes5m), 1) : null,
    uptime30mPct: uptimes30m.length > 0 ? roundNum(Math.min(...uptimes30m), 1) : null,
    uptime1dPct: uptimes1d.length > 0 ? roundNum(Math.min(...uptimes1d), 1) : null,
    degradedProviders,
    permaslugFallback,
    endpointCount: eps.length,
  };
}

/**
 * Filter Google Cloud Service Health incidents.json for active Gemini / Vertex AI disruptions.
 */
export function parseGcpGeminiIncidents(raw: any): GcpActiveIncident[] {
  if (!Array.isArray(raw)) return [];
  const out: GcpActiveIncident[] = [];
  for (const inc of raw) {
    if (!inc || inc.end) continue;
    const service = String(inc.service_name || '');
    const desc = String(inc.external_desc || inc.most_recent_update?.text || '');
    const products = Array.isArray(inc.affected_products)
      ? inc.affected_products.map((p: any) => String(p?.title || '')).join(' ')
      : '';
    const matchesGemini = GCP_GEMINI_RE.test(`${service} ${desc} ${products}`);
    const isMajorMulti = /multiple products/i.test(service) && String(inc.severity || '').toLowerCase() === 'high';
    if (!matchesGemini && !isMajorMulti) continue;
    const rawUri =
      typeof inc.uri === 'string' && inc.uri
        ? inc.uri.startsWith('http')
          ? inc.uri
          : `${GCP_STATUS_ROOT}${inc.uri.replace(/^\/+/, '')}`
        : GCP_STATUS_ROOT;
    out.push({
      id: String(inc.id || inc.number || ''),
      service: service || 'Google Cloud AI',
      severity: String(inc.severity || 'medium').toLowerCase(),
      impact: String(inc.status_impact || 'SERVICE_DISRUPTION'),
      summary: desc.slice(0, 180),
      begin: String(inc.begin || inc.created || ''),
      url: sanitizeGcpIncidentUrl(rawUri),
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
    activeIncidents.length > 0 ||
    (params.uptime30mPct !== null && params.uptime30mPct < 98) ||
    params.degradedProviders.length > 0 ||
    (params.p90TtftSec !== null && params.p90TtftSec >= 20) ||
    (params.p50TtftSec !== null && params.p50TtftSec >= 9)
  ) {
    return 'degraded';
  }
  return 'ok';
}

export function hasAnyLiveMetric(sample: {
  p50TtftSec?: number | null;
  p50Tps?: number | null;
  cacheHitPct?: number | null;
  uptime5mPct?: number | null;
  uptime30mPct?: number | null;
}): boolean {
  return (
    finiteNum(sample.p50TtftSec) !== null ||
    finiteNum(sample.p50Tps) !== null ||
    finiteNum(sample.cacheHitPct) !== null ||
    finiteNum(sample.uptime5mPct) !== null ||
    finiteNum(sample.uptime30mPct) !== null
  );
}

/**
 * Append a live snapshot into a 24-hour 5-minute ring buffer (up to 288 points).
 * Never appends an all-null point when upstream fetches failed or returned empty data.
 */
export function mergeIntradayHistory(
  existing: GeminiIntradayPoint[] | undefined,
  current: {
    p50TtftSec: number | null;
    p90TtftSec?: number | null;
    p99TtftSec?: number | null;
    p50Tps: number | null;
    cacheHitPct: number | null;
    uptime5mPct?: number | null;
    uptime30mPct: number | null;
    requestCount30m?: number;
    endpoints?: Array<{
      providerName?: string;
      providerSlug?: string;
      p50TtftSec?: number | null;
      p50Tps?: number | null;
      cacheHitPct?: number | null;
    }>;
  },
  nowMs = Date.now(),
  extraPoints?: GeminiIntradayPoint[],
): GeminiIntradayPoint[] {
  const cutoff = nowMs - INTRADAY_MAX_AGE_MS;
  const byBucket = new Map<number, GeminiIntradayPoint>();
  for (const list of [existing || [], extraPoints || []]) {
    for (const pt of list) {
      if (!pt || typeof pt.bucketMs !== 'number' || !Number.isFinite(pt.bucketMs) || pt.bucketMs < cutoff) continue;
      if (!hasAnyLiveMetric(pt)) continue;
      byBucket.set(pt.bucketMs, pt);
    }
  }

  if (hasAnyLiveMetric(current)) {
    const bucketMs = Math.floor(nowMs / INTRADAY_BUCKET_MS) * INTRADAY_BUCKET_MS;
    const byProvider: Record<string, { ttft?: number | null; tps?: number | null; cache?: number | null }> = {};
    for (const ep of current.endpoints || []) {
      const prov = normalizeProviderLabel(String(ep.providerName || ep.providerSlug || ''));
      if (!prov || prov in byProvider) continue;
      byProvider[prov] = {
        ttft: finiteNum(ep.p50TtftSec),
        tps: finiteNum(ep.p50Tps),
        cache: finiteNum(ep.cacheHitPct),
      };
    }
    byBucket.set(bucketMs, {
      bucketMs,
      x: formatUtcBucketLabel(bucketMs),
      p50TtftSec: finiteNum(current.p50TtftSec),
      ...(finiteNum(current.p90TtftSec) !== null ? { p90TtftSec: finiteNum(current.p90TtftSec) } : {}),
      ...(finiteNum(current.p99TtftSec) !== null ? { p99TtftSec: finiteNum(current.p99TtftSec) } : {}),
      p50Tps: finiteNum(current.p50Tps),
      cacheHitPct: finiteNum(current.cacheHitPct),
      ...(finiteNum(current.uptime5mPct) !== null ? { uptime5mPct: finiteNum(current.uptime5mPct) } : {}),
      uptime30mPct: finiteNum(current.uptime30mPct),
      ...(typeof current.requestCount30m === 'number' && current.requestCount30m > 0
        ? { requestCount30m: Math.round(current.requestCount30m) }
        : {}),
      ...(Object.keys(byProvider).length > 0 ? { byProvider } : {}),
    });
  }

  return [...byBucket.values()]
    .sort((a, b) => a.bucketMs - b.bucketMs)
    .slice(-INTRADAY_MAX_POINTS);
}

// ---------------------------------------------------------------------------
// Remote feed payload sanitizers (shared by sidecar & `/pulse/` site)
// ---------------------------------------------------------------------------

export function sanitizeSeriesPoints(raw: unknown, maxLen = 64): GeminiTimeSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: GeminiTimeSeriesPoint[] = [];
  for (const item of raw) {
    if (out.length >= maxLen) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const x = typeof r.x === 'string' ? r.x.slice(0, 32) : '';
    const val = finiteNum(r.value);
    if (!x || val === null) continue;
    const tsMs = finiteNum(r.tsMs) ?? parseUtcTimestampMs(x);
    let byProvider: Record<string, number> | undefined;
    if (r.byProvider && typeof r.byProvider === 'object' && !Array.isArray(r.byProvider)) {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.byProvider as Record<string, unknown>)) {
        const n = finiteNum(v);
        if (k && n !== null) clean[k.slice(0, 48)] = n;
      }
      if (Object.keys(clean).length > 0) byProvider = clean;
    }
    out.push({ x, tsMs, value: val, ...(byProvider ? { byProvider } : {}) });
  }
  return out;
}

export function sanitizeUptimeBuckets(raw: unknown, maxLen = 96): GeminiUptimeBucket[] {
  if (!Array.isArray(raw)) return [];
  const out: GeminiUptimeBucket[] = [];
  for (const item of raw) {
    if (out.length >= maxLen) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const x = typeof r.x === 'string' ? r.x.slice(0, 32) : '';
    const availability = clampPct(r.availability, 2);
    if (!x || availability === null) continue;
    out.push({
      x,
      tsMs: finiteNum(r.tsMs) ?? parseUtcTimestampMs(x),
      availability,
      rawAvailability: clampPct(r.rawAvailability, 2),
    });
  }
  return out;
}

export function sanitizeIntradayPoints(raw: unknown, maxLen = INTRADAY_MAX_POINTS): GeminiIntradayPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: GeminiIntradayPoint[] = [];
  for (const item of raw) {
    if (out.length >= maxLen) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const bucketMs = finiteNum(r.bucketMs);
    if (bucketMs === null || bucketMs <= 0) continue;
    const pt: GeminiIntradayPoint = {
      bucketMs,
      x: typeof r.x === 'string' && r.x ? r.x.slice(0, 32) : formatUtcBucketLabel(bucketMs),
      p50TtftSec: finiteNum(r.p50TtftSec),
      ...(finiteNum(r.p90TtftSec) !== null ? { p90TtftSec: finiteNum(r.p90TtftSec) } : {}),
      ...(finiteNum(r.p99TtftSec) !== null ? { p99TtftSec: finiteNum(r.p99TtftSec) } : {}),
      p50Tps: finiteNum(r.p50Tps),
      cacheHitPct: clampPct(r.cacheHitPct, 1),
      ...(clampPct(r.uptime5mPct, 1) !== null ? { uptime5mPct: clampPct(r.uptime5mPct, 1) } : {}),
      uptime30mPct: clampPct(r.uptime30mPct, 1),
      ...(finiteNum(r.requestCount30m) !== null && (r.requestCount30m as number) > 0
        ? { requestCount30m: Math.round(r.requestCount30m as number) }
        : {}),
    };
    if (r.byProvider && typeof r.byProvider === 'object' && !Array.isArray(r.byProvider)) {
      const bp: Record<string, { ttft?: number | null; tps?: number | null; cache?: number | null }> = {};
      for (const [k, v] of Object.entries(r.byProvider as Record<string, unknown>)) {
        if (!k || !v || typeof v !== 'object') continue;
        const vr = v as Record<string, unknown>;
        bp[k.slice(0, 48)] = {
          ttft: finiteNum(vr.ttft),
          tps: finiteNum(vr.tps),
          cache: clampPct(vr.cache, 1),
        };
      }
      if (Object.keys(bp).length > 0) pt.byProvider = bp;
    }
    if (hasAnyLiveMetric(pt)) out.push(pt);
  }
  return out;
}

export function sanitizeEndpointPulses(raw: unknown, maxLen = 8): GeminiEndpointPulse[] {
  if (!Array.isArray(raw)) return [];
  const out: GeminiEndpointPulse[] = [];
  for (const item of raw) {
    if (out.length >= maxLen) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const endpointId = typeof r.endpointId === 'string' ? r.endpointId.slice(0, 128) : '';
    if (!endpointId) continue;
    out.push({
      endpointId,
      providerName: typeof r.providerName === 'string' ? r.providerName.slice(0, 80) : '',
      providerSlug: typeof r.providerSlug === 'string' ? r.providerSlug.slice(0, 80) : '',
      cacheHitPct: clampPct(r.cacheHitPct, 1),
      p50TtftSec: finiteNum(r.p50TtftSec),
      p75TtftSec: finiteNum(r.p75TtftSec),
      p90TtftSec: finiteNum(r.p90TtftSec),
      ...(finiteNum(r.p95TtftSec) !== null ? { p95TtftSec: finiteNum(r.p95TtftSec) } : {}),
      ...(finiteNum(r.p99TtftSec) !== null ? { p99TtftSec: finiteNum(r.p99TtftSec) } : {}),
      ...(finiteNum(r.meanTtftSec) !== null ? { meanTtftSec: finiteNum(r.meanTtftSec) } : {}),
      p50Tps: finiteNum(r.p50Tps),
      ...(finiteNum(r.p75Tps) !== null ? { p75Tps: finiteNum(r.p75Tps) } : {}),
      p90Tps: finiteNum(r.p90Tps),
      ...(finiteNum(r.p95Tps) !== null ? { p95Tps: finiteNum(r.p95Tps) } : {}),
      ...(finiteNum(r.p99Tps) !== null ? { p99Tps: finiteNum(r.p99Tps) } : {}),
      ...(finiteNum(r.effectiveInputPrice) !== null ? { effectiveInputPrice: finiteNum(r.effectiveInputPrice) } : {}),
      ...(finiteNum(r.effectiveOutputPrice) !== null ? { effectiveOutputPrice: finiteNum(r.effectiveOutputPrice) } : {}),
      ...(finiteNum(r.totalTokens) !== null && (r.totalTokens as number) > 0 ? { totalTokens: Math.round(r.totalTokens as number) } : {}),
      requestCount: finiteNum(r.requestCount) !== null && (r.requestCount as number) > 0 ? Math.round(r.requestCount as number) : 0,
      windowMinutes: finiteNum(r.windowMinutes) !== null && (r.windowMinutes as number) > 0 ? Math.round(r.windowMinutes as number) : 30,
    });
  }
  return out;
}
