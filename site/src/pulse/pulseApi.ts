export interface GeminiSpec {
  family: string;
  slug: string;
  label: string;
  shortLabel: string;
  color: string;
}

export const GEMINI_SPECS: readonly GeminiSpec[] = [
  { family: 'gemini-4-neon', slug: 'google/gemini-4-neon', label: 'Gemini 4 Neon', shortLabel: 'Neon', color: '#4f86f7' },
  { family: 'gemini-4-hydrogen', slug: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', shortLabel: 'Hydrogen', color: '#34d399' },
  { family: 'gemini-4-carbon', slug: 'google/gemini-4-carbon', label: 'Gemini 4 Carbon', shortLabel: 'Carbon', color: '#a78bfa' },
  { family: 'gemini-4-argon', slug: 'google/gemini-4-argon', label: 'Gemini 4 Argon', shortLabel: 'Argon', color: '#fbbf24' },
  { family: 'gemini-3.8-flash', slug: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', shortLabel: '3.8 Flash', color: '#f87171' },
];

export interface PulseTimeSeriesPoint {
  x: string;
  tsMs: number;
  value: number;
  byProvider?: Record<string, number>;
}

export interface PulseIntradayPoint {
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
  status: 'ok' | 'degraded' | 'outage';
  p50TtftSec: number | null;
  p90TtftSec: number | null;
  p99TtftSec: number | null;
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

export interface GcpIncident {
  id: string;
  service: string;
  severity: string;
  impact: string;
  summary: string;
  begin: string;
  url: string;
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
const GCP_GEMINI_RE = /vertex|gemini|generative|ai platform|cloud ai|model garden/i;

function roundNum(v: number | null | undefined, digits = 2): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function parseUtcMs(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const iso = s.includes('T') ? s : s.includes(' ') ? `${s.replace(' ', 'T')}Z` : `${s}T12:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function parsePricePerM(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundNum(n * 1_000_000, 3);
}

export function getSavedFeedUrl(): string {
  try {
    const qs = new URLSearchParams(window.location.search).get('feed');
    if (qs && /^https:\/\//i.test(qs.trim())) {
      const clean = qs.trim().replace(/\/+$/, '');
      localStorage.setItem(FEED_URL_KEY, clean);
      return clean;
    }
    return (localStorage.getItem(FEED_URL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveFeedUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem(FEED_URL_KEY, clean);
    else localStorage.removeItem(FEED_URL_KEY);
  } catch {
    /* ignore */
  }
}

export function loadCachedPulse(): PulseDashboardData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PulseDashboardData;
    if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) return parsed;
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

function parseDirectComparison(
  raw: { data?: Array<{ x?: string; y?: Record<string, unknown> }> } | null,
  kind: 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime',
): PulseTimeSeriesPoint[] {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const out: PulseTimeSeriesPoint[] = [];
  for (const row of rows) {
    if (!row?.x || !row.y || typeof row.y !== 'object') continue;
    const vals = Object.values(row.y)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
      .map((num) =>
        kind === 'ttft' || kind === 'e2e'
          ? roundNum(num / 1000, 2) ?? 0
          : kind === 'cache'
            ? Math.max(0, Math.min(100, roundNum(num, 1) ?? 0))
            : kind === 'uptime'
              ? Math.max(0, Math.min(100, roundNum(num, 2) ?? 0))
              : roundNum(num, 1) ?? 0,
      )
      .filter((v) => v > 0);
    const med = median(vals);
    if (med === null) continue;
    out.push({
      x: row.x.slice(0, 10),
      tsMs: parseUtcMs(row.x),
      value: roundNum(med, kind === 'tps' || kind === 'cache' ? 1 : 2) ?? med,
    });
  }
  return out;
}

function normalizeProvider(tag: string, name: string): string {
  const probe = `${tag} ${name}`.toLowerCase();
  if (probe.includes('vertex')) return 'Google Vertex';
  if (probe.includes('ai-studio') || probe.includes('ai studio')) return 'AI Studio';
  return name || tag || 'Provider';
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
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
      providerName: normalizeProvider(String(e?.tag || ''), String(e?.provider_name || '')),
      tag: String(e?.tag || ''),
      serviceTier: String(e?.service_tier || 'standard'),
      status: typeof e?.status === 'number' ? e.status : 0,
      uptime5m: typeof e?.uptime_last_5m === 'number' ? roundNum(e.uptime_last_5m, 1) : null,
      uptime30m: typeof e?.uptime_last_30m === 'number' ? roundNum(e.uptime_last_30m, 1) : null,
      uptime1d: typeof e?.uptime_last_1d === 'number' ? roundNum(e.uptime_last_1d, 1) : null,
      contextLength: typeof e?.context_length === 'number' ? e.context_length : null,
      maxCompletionTokens: typeof e?.max_completion_tokens === 'number' ? e.max_completion_tokens : null,
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
    const m = json.models.find((row: any) => row.family === spec.family) || {};
    const e2e7d: PulseTimeSeriesPoint[] = Array.isArray(m.series?.e2e7d) ? m.series.e2e7d : [];
    return {
      family: spec.family,
      slug: spec.slug,
      permaslug: m.permaslug,
      label: spec.label,
      shortLabel: spec.shortLabel,
      color: spec.color,
      status: m.status === 'outage' || m.status === 'degraded' ? m.status : 'ok',
      p50TtftSec: typeof m.p50TtftSec === 'number' ? m.p50TtftSec : null,
      p90TtftSec: typeof m.p90TtftSec === 'number' ? m.p90TtftSec : null,
      p99TtftSec: typeof m.p99TtftSec === 'number' ? m.p99TtftSec : null,
      p50Tps: typeof m.p50Tps === 'number' ? m.p50Tps : null,
      p90Tps: typeof m.p90Tps === 'number' ? m.p90Tps : null,
      e2eLatestSec: e2e7d.length ? e2e7d[e2e7d.length - 1].value : null,
      cacheHitPct: typeof m.cacheHitPct === 'number' ? m.cacheHitPct : null,
      uptime5mPct: typeof m.uptime5mPct === 'number' ? m.uptime5mPct : null,
      uptime30mPct: typeof m.uptime30mPct === 'number' ? m.uptime30mPct : null,
      uptime1dPct: typeof m.uptime1dPct === 'number' ? m.uptime1dPct : null,
      toolCallErrorPct: typeof m.toolCallErrorPct === 'number' ? m.toolCallErrorPct : null,
      toolCalls24h: typeof m.toolCalls24h === 'number' ? m.toolCalls24h : 0,
      reasoningSharePct: typeof m.reasoningSharePct === 'number' ? m.reasoningSharePct : null,
      effectiveInputPrice: typeof m.effectiveInputPrice === 'number' ? m.effectiveInputPrice : null,
      effectiveOutputPrice: typeof m.effectiveOutputPrice === 'number' ? m.effectiveOutputPrice : null,
      requestCount30m: typeof m.requestCount30m === 'number' ? m.requestCount30m : 0,
      degradedProviders: Array.isArray(m.degradedProviders) ? m.degradedProviders : [],
      routes: routeMap.get(spec.family) || [],
      series: {
        ttft7d: Array.isArray(m.series?.ttft7d) ? m.series.ttft7d : [],
        e2e7d,
        tps7d: Array.isArray(m.series?.tps7d) ? m.series.tps7d : [],
        cache7d: Array.isArray(m.series?.cache7d) ? m.series.cache7d : [],
        uptime7d: Array.isArray(m.series?.uptime7d) ? m.series.uptime7d : [],
        intraday30m: Array.isArray(m.series?.intraday30m) ? m.series.intraday30m : [],
      },
    };
  });

  const data: PulseDashboardData = {
    mode: 'worker',
    feedUrl,
    fetchedAtMs: typeof json.fetchedAtMs === 'number' && json.fetchedAtMs > 0 ? json.fetchedAtMs : Date.now(),
    models,
    incidents: Array.isArray(json.incidents) ? json.incidents : [],
  };
  saveCachedPulse(data);
  return data;
}

export async function fetchLiveGeminiPulse(feedUrl?: string): Promise<PulseDashboardData> {
  const cleanFeed = (feedUrl || '').trim();
  if (cleanFeed && /^https:\/\//i.test(cleanFeed)) {
    const workerData = await tryFetchWorkerFeed(cleanFeed);
    if (workerData) return workerData;
  }

  // Direct zero-server browser live fetch (OpenRouter CORS APIs + Google Cloud Service Health JSON)
  const gcpPromise = fetchJson<Array<Record<string, any>>>('https://status.cloud.google.com/incidents.json').then((raw) =>
    (raw || [])
      .filter((inc) => inc && !inc.end)
      .filter((inc) => {
        const text = `${inc.service_name || ''} ${inc.external_desc || ''} ${(inc.affected_products || []).map((p: any) => p?.title || '').join(' ')}`;
        return GCP_GEMINI_RE.test(text) || (/multiple products/i.test(String(inc.service_name || '')) && String(inc.severity || '').toLowerCase() === 'high');
      })
      .map((inc) => ({
        id: String(inc.id || inc.number || ''),
        service: String(inc.service_name || 'Google Cloud AI'),
        severity: String(inc.severity || 'medium').toLowerCase(),
        impact: String(inc.status_impact || 'SERVICE_DISRUPTION'),
        summary: String(inc.external_desc || inc.most_recent_update?.text || '').slice(0, 200),
        begin: String(inc.begin || inc.created || ''),
        url: typeof inc.uri === 'string' && inc.uri
          ? (inc.uri.startsWith('http') ? inc.uri : `https://status.cloud.google.com/${inc.uri.replace(/^\/+/, '')}`)
          : 'https://status.cloud.google.com/',
      })),
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
    const degradedProviders = [...new Set(
      pool.filter((r) => r.status < 0 || (r.uptime30m !== null && r.uptime30m < 95)).map((r) => r.providerName),
    )];

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
      ttft7d = parseDirectComparison(latR, 'ttft');
      e2e7d = parseDirectComparison(e2eR, 'e2e');
      tps7d = parseDirectComparison(tpsR, 'tps');
      cache7d = parseDirectComparison(cacheR, 'cache');
      uptime7d = parseDirectComparison(upR, 'uptime');
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
  const hasHighIncident = incidents.some((i) => i.severity === 'high' || /OUTAGE/i.test(i.impact));

  const models: PulseModelData[] = rows.map((r) => {
    const status: 'ok' | 'degraded' | 'outage' =
      hasHighIncident || (r.uptime30mPct !== null && r.uptime30mPct < 85)
        ? 'outage'
        : incidents.length > 0 || (r.uptime30mPct !== null && r.uptime30mPct < 98) || r.degradedProviders.length > 0 || (r.latestTtft !== null && r.latestTtft >= 9)
          ? 'degraded'
          : 'ok';
    return {
      family: r.spec.family,
      slug: r.spec.slug,
      permaslug: r.permaslug,
      label: r.spec.label,
      shortLabel: r.spec.shortLabel,
      color: r.spec.color,
      status,
      p50TtftSec: r.latestTtft,
      p90TtftSec: null,
      p99TtftSec: null,
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
