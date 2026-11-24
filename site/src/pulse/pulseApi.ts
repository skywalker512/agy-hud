import {
  GEMINI_PULSE_MODELS,
  classifyModelPulseStatus,
  finiteNum,
  normalizeProviderLabel,
  parseGcpGeminiIncidents,
  parseOpenRouterComparisonSeries,
  roundNum,
  sanitizeGcpIncidentUrl,
  sanitizeIncident,
  sanitizeIntradayPoints,
  sanitizeSeriesPoints,
  type GcpActiveIncident,
  type GeminiIntradayPoint,
  type GeminiPulseModelSpec,
  type GeminiTimeSeriesPoint,
  type PulseHealthStatus,
} from '../../../plugin/sidecars/hud_panel/lib/pulse-core.ts';

export type GeminiSpec = GeminiPulseModelSpec;
export const GEMINI_SPECS: readonly GeminiSpec[] = GEMINI_PULSE_MODELS;
export type PulseTimeSeriesPoint = GeminiTimeSeriesPoint;
export type PulseIntradayPoint = GeminiIntradayPoint;
export type GcpIncident = GcpActiveIncident;

export { sanitizeGcpIncidentUrl };

export interface PulseEndpointRoute {
  providerName: string;
  tag: string;
  serviceTier: string;
  status: number;
  uptime5m: number | null;
  uptime30m: number | null;
  uptime1d: number | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  promptPerM: number | null;
  cachedPerM: number | null;
  completionPerM: number | null;
}

export interface PulseModelData {
  family: string;
  slug: string;
  permaslug?: string;
  label: string;
  shortLabel: string;
  color: string;
  status: PulseHealthStatus;
  p50TtftSec: number | null;
  p75TtftSec: number | null;
  p90TtftSec: number | null;
  p95TtftSec: number | null;
  p99TtftSec: number | null;
  meanTtftSec: number | null;
  p50Tps: number | null;
  p90Tps: number | null;
  e2eLatestSec: number | null;
  cacheHitPct: number | null;
  uptime5mPct: number | null;
  uptime30mPct: number | null;
  uptime1dPct: number | null;
  toolCallErrorPct: number | null;
  toolCalls24h: number;
  reasoningSharePct: number | null;
  avgPromptTokens: number | null;
  avgOutputTokens: number | null;
  effectiveInputPrice: number | null;
  effectiveOutputPrice: number | null;
  requestCount30m: number;
  degradedProviders: string[];
  routes: PulseEndpointRoute[];
  series: {
    ttft7d: PulseTimeSeriesPoint[];
    e2e7d: PulseTimeSeriesPoint[];
    tps7d: PulseTimeSeriesPoint[];
    cache7d: PulseTimeSeriesPoint[];
    uptime7d: PulseTimeSeriesPoint[];
    intraday30m: PulseIntradayPoint[];
  };
}

export interface PulseDashboardData {
  mode: 'worker' | 'direct';
  feedUrl?: string;
  fetchedAtMs: number;
  models: PulseModelData[];
  incidents: GcpIncident[];
}

const CACHE_KEY = 'agy-hud-gemini-pulse-web-v1';
const FEED_URL_KEY = 'agy-hud-gemini-pulse-feed-url';
export const DEFAULT_WORKER_FEED_URL = 'https://agy-hud.512.pub';
const MAX_FEED_BODY_BYTES = 5 * 1024 * 1024;

function parsePricePerM(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundNum(n * 1_000_000, 3);
}

function isValidHttpsFeedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve active feed URL.
 * Security: `?feed=...` query overrides are strictly session-only and NEVER persisted to
 * `localStorage`, preventing shared links from permanently poisoning the browser's feed.
 */
export function getSavedFeedUrl(): string {
  try {
    const qs = new URLSearchParams(window.location.search).get('feed');
    if (qs !== null) {
      const trimmed = qs.trim();
      if (trimmed === 'direct' || trimmed === 'none') {
        return '';
      }
      if (isValidHttpsFeedUrl(trimmed)) {
        return trimmed.replace(/\/+$/, '');
      }
    }
    const saved = localStorage.getItem(FEED_URL_KEY);
    if (saved === null) return DEFAULT_WORKER_FEED_URL;
    if (saved === 'direct') return '';
    const clean = saved.trim().replace(/\/+$/, '');
    return isValidHttpsFeedUrl(clean) ? clean : DEFAULT_WORKER_FEED_URL;
  } catch {
    return DEFAULT_WORKER_FEED_URL;
  }
}

export function saveFeedUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (!clean) {
      localStorage.setItem(FEED_URL_KEY, 'direct');
    } else if (isValidHttpsFeedUrl(clean)) {
      localStorage.setItem(FEED_URL_KEY, clean);
    }
  } catch {
    /* ignore */
  }
}

export function loadCachedPulse(): PulseDashboardData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PulseDashboardData;
    if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) {
      const safeIncidents = Array.isArray(parsed.incidents)
        ? parsed.incidents.map(sanitizeIncident).filter((x): x is GcpIncident => x !== null)
        : [];
      return {
        ...parsed,
        incidents: safeIncidents,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveCachedPulse(data: PulseDashboardData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

async function fetchJson<T>(url: string, timeoutMs = 8000, maxBytes = MAX_FEED_BODY_BYTES): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchModelRoutes(slug: string): Promise<{ permaslug: string | null; routes: PulseEndpointRoute[] }> {
  const json = await fetchJson<{ data?: { endpoints?: Array<Record<string, any>> } }>(
    `https://openrouter.ai/api/v1/models/${slug}/endpoints`,
  );
  const eps = Array.isArray(json?.data?.endpoints) ? json.data.endpoints : [];
  let permaslug: string | null = null;
  const routes: PulseEndpointRoute[] = [];
  for (const e of eps) {
    if (!permaslug && typeof e?.name === 'string') {
      const m = /(google\/[a-zA-Z0-9._-]+)$/.exec(e.name.trim());
      if (m) permaslug = m[1];
    }
    routes.push({
      providerName: normalizeProviderLabel(String(e?.tag || e?.provider_name || '')),
      tag: String(e?.tag || ''),
      serviceTier: String(e?.service_tier || 'standard'),
      status: finiteNum(e?.status) ?? 0,
      uptime5m: finiteNum(e?.uptime_last_5m) !== null ? roundNum(e.uptime_last_5m, 1) : null,
      uptime30m: finiteNum(e?.uptime_last_30m) !== null ? roundNum(e.uptime_last_30m, 1) : null,
      uptime1d: finiteNum(e?.uptime_last_1d) !== null ? roundNum(e.uptime_last_1d, 1) : null,
      contextLength: finiteNum(e?.context_length),
      maxCompletionTokens: finiteNum(e?.max_completion_tokens),
      promptPerM: parsePricePerM(e?.pricing?.prompt),
      cachedPerM: parsePricePerM(e?.pricing?.input_cache_read),
      completionPerM: parsePricePerM(e?.pricing?.completion),
    });
  }
  return { permaslug, routes };
}

async function tryFetchWorkerFeed(feedUrl: string): Promise<PulseDashboardData | null> {
  const endpoint = feedUrl.endsWith('.json') ? feedUrl : `${feedUrl.replace(/\/+$/, '')}/v1/pulse.json`;
  const json = await fetchJson<any>(endpoint, 8000);
  if (!json || !Array.isArray(json.models) || json.models.length === 0) return null;

  // Enrich with live routes & pricing from OpenRouter's fast CORS /endpoints API in parallel
  const routeMap = new Map<string, PulseEndpointRoute[]>();
  await Promise.all(
    GEMINI_SPECS.map(async (spec) => {
      const { routes } = await fetchModelRoutes(spec.slug);
      routeMap.set(spec.family, routes);
    }),
  );

  const models: PulseModelData[] = GEMINI_SPECS.map((spec) => {
    const m = json.models.find((row: any) => row && row.family === spec.family) || {};
    const ttft7d = sanitizeSeriesPoints(m.series?.ttft7d);
    const e2e7d = sanitizeSeriesPoints(m.series?.e2e7d);
    const tps7d = sanitizeSeriesPoints(m.series?.tps7d);
    const cache7d = sanitizeSeriesPoints(m.series?.cache7d);
    const uptime7d = sanitizeSeriesPoints(m.series?.uptime7d);
    const intraday30m = sanitizeIntradayPoints(m.series?.intraday30m);
    const degradedProviders = Array.isArray(m.degradedProviders)
      ? m.degradedProviders.filter((p: unknown): p is string => typeof p === 'string').map((p: string) => p.slice(0, 64))
      : [];
    const reqCount = finiteNum(m.requestCount30m);
    const toolCalls = finiteNum(m.toolCalls24h);
    return {
      family: spec.family,
      slug: spec.slug,
      permaslug: typeof m.permaslug === 'string' && /^google\/[a-zA-Z0-9._-]+$/.test(m.permaslug) ? m.permaslug : undefined,
      label: spec.label,
      shortLabel: spec.shortLabel,
      color: spec.color,
      status: m.status === 'outage' || m.status === 'degraded' ? m.status : 'ok',
      p50TtftSec: finiteNum(m.p50TtftSec),
      p75TtftSec: finiteNum(m.p75TtftSec),
      p90TtftSec: finiteNum(m.p90TtftSec),
      p95TtftSec: finiteNum(m.p95TtftSec),
      p99TtftSec: finiteNum(m.p99TtftSec),
      meanTtftSec: finiteNum(m.meanTtftSec),
      p50Tps: finiteNum(m.p50Tps),
      p90Tps: finiteNum(m.p90Tps),
      e2eLatestSec: e2e7d.length ? e2e7d[e2e7d.length - 1].value : null,
      cacheHitPct: finiteNum(m.cacheHitPct),
      uptime5mPct: finiteNum(m.uptime5mPct),
      uptime30mPct: finiteNum(m.uptime30mPct),
      uptime1dPct: finiteNum(m.uptime1dPct),
      toolCallErrorPct: finiteNum(m.toolCallErrorPct),
      toolCalls24h: toolCalls !== null && toolCalls > 0 ? Math.round(toolCalls) : 0,
      reasoningSharePct: finiteNum(m.reasoningSharePct),
      avgPromptTokens: finiteNum(m.avgPromptTokens),
      avgOutputTokens: finiteNum(m.avgOutputTokens),
      effectiveInputPrice: finiteNum(m.effectiveInputPrice),
      effectiveOutputPrice: finiteNum(m.effectiveOutputPrice),
      requestCount30m: reqCount !== null && reqCount > 0 ? Math.round(reqCount) : 0,
      degradedProviders,
      routes: routeMap.get(spec.family) || [],
      series: {
        ttft7d,
        e2e7d,
        tps7d,
        cache7d,
        uptime7d,
        intraday30m,
      },
    };
  });

  const safeIncidents = Array.isArray(json.incidents)
    ? json.incidents.map(sanitizeIncident).filter((x: GcpIncident | null): x is GcpIncident => x !== null)
    : [];

  const fetchedAtMs = finiteNum(json.fetchedAtMs);
  const data: PulseDashboardData = {
    mode: 'worker',
    feedUrl,
    fetchedAtMs: fetchedAtMs !== null && fetchedAtMs > 0 ? fetchedAtMs : Date.now(),
    models,
    incidents: safeIncidents,
  };
  // Only overwrite browser cache when using the default/saved feed (avoid caching untrusted ?feed= overrides)
  if (feedUrl === DEFAULT_WORKER_FEED_URL || !new URLSearchParams(window.location.search).has('feed')) {
    saveCachedPulse(data);
  }
  return data;
}

export async function fetchLiveGeminiPulse(feedUrl?: string): Promise<PulseDashboardData> {
  const cleanFeed = (feedUrl || '').trim();
  if (cleanFeed && isValidHttpsFeedUrl(cleanFeed)) {
    const workerData = await tryFetchWorkerFeed(cleanFeed);
    if (workerData) return workerData;
  }

  // Direct zero-server browser live fetch (OpenRouter CORS APIs + Google Cloud Service Health JSON)
  const gcpPromise = fetchJson<Array<Record<string, any>>>('https://status.cloud.google.com/incidents.json').then(
    (raw) => parseGcpGeminiIncidents(raw),
  );

  const modelPromises = GEMINI_SPECS.map(async (spec) => {
    const { permaslug, routes } = await fetchModelRoutes(spec.slug);
    const stdRoutes = routes.filter((r) => r.tag === 'google-vertex/global' || r.tag === 'google-ai-studio');
    const pool = stdRoutes.length ? stdRoutes : routes;
    const up5s = pool.map((r) => r.uptime5m).filter((v): v is number => v !== null);
    const up30s = pool.map((r) => r.uptime30m).filter((v): v is number => v !== null);
    const up1ds = pool.map((r) => r.uptime1d).filter((v): v is number => v !== null);
    const uptime5mPct = up5s.length ? roundNum(Math.min(...up5s), 1) : null;
    const uptime30mPct = up30s.length ? roundNum(Math.min(...up30s), 1) : null;
    const uptime1dPct = up1ds.length ? roundNum(Math.min(...up1ds), 1) : null;
    const degradedProviders = [
      ...new Set(
        pool.filter((r) => r.status < 0 || (r.uptime30m !== null && r.uptime30m < 95)).map((r) => r.providerName),
      ),
    ];

    let ttft7d: PulseTimeSeriesPoint[] = [];
    let e2e7d: PulseTimeSeriesPoint[] = [];
    let tps7d: PulseTimeSeriesPoint[] = [];
    let cache7d: PulseTimeSeriesPoint[] = [];
    let uptime7d: PulseTimeSeriesPoint[] = [];

    if (permaslug) {
      const qs = `permaslug=${encodeURIComponent(permaslug)}`;
      const [latR, e2eR, tpsR, cacheR, upR] = await Promise.all([
        fetchJson<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-comparison?${qs}`),
        fetchJson<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-e2e-comparison?${qs}`),
        fetchJson<any>(`https://openrouter.ai/api/frontend/v1/stats/throughput-comparison?${qs}`),
        fetchJson<any>(`https://openrouter.ai/api/frontend/v1/stats/cache-hit-rate-comparison?${qs}`),
        fetchJson<any>(`https://openrouter.ai/api/frontend/v1/stats/uptime-comparison?${qs}`),
      ]);
      ttft7d = parseOpenRouterComparisonSeries(latR, 'ttft');
      e2e7d = parseOpenRouterComparisonSeries(e2eR, 'e2e');
      tps7d = parseOpenRouterComparisonSeries(tpsR, 'tps');
      cache7d = parseOpenRouterComparisonSeries(cacheR, 'cache');
      uptime7d = parseOpenRouterComparisonSeries(upR, 'uptime');
    }

    const latestTtft = ttft7d.length ? ttft7d[ttft7d.length - 1].value : null;
    const latestE2e = e2e7d.length ? e2e7d[e2e7d.length - 1].value : null;
    const latestTps = tps7d.length ? tps7d[tps7d.length - 1].value : null;
    const latestCache = cache7d.length ? cache7d[cache7d.length - 1].value : null;

    return {
      spec,
      permaslug: permaslug || undefined,
      routes,
      uptime5mPct,
      uptime30mPct,
      uptime1dPct,
      degradedProviders,
      latestTtft,
      latestE2e,
      latestTps,
      latestCache,
      series: { ttft7d, e2e7d, tps7d, cache7d, uptime7d, intraday30m: [] as PulseIntradayPoint[] },
    };
  });

  const [incidents, rows] = await Promise.all([gcpPromise, Promise.all(modelPromises)]);

  const models: PulseModelData[] = rows.map((r) => {
    const status = classifyModelPulseStatus(
      {
        uptime30mPct: r.uptime30mPct,
        degradedProviders: r.degradedProviders,
        p50TtftSec: r.latestTtft,
        p90TtftSec: null,
      },
      incidents,
    );
    return {
      family: r.spec.family,
      slug: r.spec.slug,
      permaslug: r.permaslug,
      label: r.spec.label,
      shortLabel: r.spec.shortLabel,
      color: r.spec.color,
      status,
      p50TtftSec: r.latestTtft,
      p75TtftSec: null,
      p90TtftSec: null,
      p95TtftSec: null,
      p99TtftSec: null,
      meanTtftSec: null,
      p50Tps: r.latestTps,
      p90Tps: null,
      e2eLatestSec: r.latestE2e,
      cacheHitPct: r.latestCache,
      uptime5mPct: r.uptime5mPct,
      uptime30mPct: r.uptime30mPct,
      uptime1dPct: r.uptime1dPct,
      toolCallErrorPct: null,
      toolCalls24h: 0,
      reasoningSharePct: null,
      avgPromptTokens: null,
      avgOutputTokens: null,
      effectiveInputPrice: null,
      effectiveOutputPrice: null,
      requestCount30m: 0,
      degradedProviders: r.degradedProviders,
      routes: r.routes,
      series: r.series,
    };
  });

  const data: PulseDashboardData = {
    mode: 'direct',
    fetchedAtMs: Date.now(),
    models,
    incidents,
  };
  saveCachedPulse(data);
  return data;
}
