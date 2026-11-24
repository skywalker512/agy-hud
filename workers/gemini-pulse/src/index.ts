/**
 * AGY-HUD Gemini Pulse Collector — Cloudflare Workers Free + KV ($0/mo, no card required).
 *
 * Collects 30-minute Gemini global telemetry snapshots from OpenRouter & Google Cloud Service Health,
 * maintains a 48-hour 30m ring buffer in Workers KV (48 writes/day, <5% of Free tier),
 * and serves CORS-enabled, edge-cached JSON consumed by both the AGY-HUD sidecar and `/pulse/` site.
 */

export interface Env {
  GEMINI_PULSE_KV: KVNamespace;
  ASSETS?: Fetcher;
  REFRESH_TOKEN?: string;
}

interface GeminiModelSpec {
  family: string;
  slug: string;
  label: string;
}

const GEMINI_MODELS: readonly GeminiModelSpec[] = [
  { family: 'gemini-4-neon', slug: 'google/gemini-4-neon', label: 'Gemini 4 Neon' },
  { family: 'gemini-4-hydrogen', slug: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { family: 'gemini-4-carbon', slug: 'google/gemini-4-carbon', label: 'Gemini 4 Carbon' },
  { family: 'gemini-4-argon', slug: 'google/gemini-4-argon', label: 'Gemini 4 Argon' },
  { family: 'gemini-3.8-flash', slug: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

const KV_KEY_SNAPSHOT = 'gemini:pulse:v4';
const BUCKET_MS = 5 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;
const MAX_INTRADAY_POINTS = 288;
const SERIES_7D_TTL_MS = 30 * 60_000;
const GCP_GEMINI_RE = /vertex|gemini|generative|ai platform|cloud ai|model garden/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function roundNum(v: number | null | undefined, digits = 2): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function normalizeProvider(raw: string): string {
  const s = String(raw || '').trim();
  if (/vertex/i.test(s)) return 'Google Vertex';
  if (/ai[- ]?studio/i.test(s)) return 'AI Studio';
  return s.replace(/\s*\(\d+\)\s*$/, '').trim() || 'Provider';
}

function parseUtcMs(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const iso = s.includes('T') ? s : s.includes(' ') ? `${s.replace(' ', 'T')}Z` : `${s}T12:00:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function formatUtcBucket(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Low-CPU targeted extractor for OpenRouter SSR HTML (avoids unescaping the full ~900KB HTML).
 */
function extractModelSsrLite(html: string) {
  let permaslug: string | null = null;
  let psPos = 0;
  while (psPos >= 0 && !permaslug) {
    const psIdx = html.indexOf('permaslug', psPos);
    if (psIdx < 0) break;
    const chunk = html.slice(Math.max(0, psIdx - 4), psIdx + 140).replace(/\\"/g, '"');
    const m = /"permaslug":"(google\/[a-zA-Z0-9._-]+)"/.exec(chunk);
    if (m) permaslug = m[1];
    psPos = psIdx + 12;
  }

  let weightedCacheHitPct: number | null = null;
  const providerMeta = new Map<string, Record<string, unknown>>();
  let searchPos = 0;
  while (searchPos >= 0) {
    const idx = html.indexOf('weightedCacheHitRate', searchPos);
    if (idx < 0) break;
    const chunk = html.slice(Math.max(0, idx - 4), idx + 4000).replace(/\\"/g, '"');
    const cm = /"weightedCacheHitRate":([0-9.]+|null),"providerSummaries":(\[[^\]]*\])/.exec(chunk);
    if (cm) {
      if (cm[1] !== 'null') {
        const rate = Number(cm[1]);
        if (Number.isFinite(rate) && rate >= 0 && rate <= 1) weightedCacheHitPct = roundNum(rate * 100, 1);
      }
      try {
        const arr = JSON.parse(cm[2]);
        if (Array.isArray(arr)) {
          for (const p of arr) {
            if (p && typeof p.endpointId === 'string') providerMeta.set(p.endpointId, p);
          }
        }
      } catch {
        /* ignore */
      }
    }
    searchPos = idx + 24;
  }

  // Extract 30m endpoint stats blocks by locating `"endpoint_id":` occurrences directly
  const endpoints: Array<Record<string, unknown>> = [];
  const seenEp = new Set<string>();
  let stPos = 0;
  while (stPos >= 0) {
    const idx = html.indexOf('endpoint_id', stPos);
    if (idx < 0) break;
    const start = Math.max(0, idx - 12);
    const chunk = html.slice(start, idx + 700).replace(/\\"/g, '"');
    const sm = /(\{"endpoint_id":"[^"]+"[^}]+\})/.exec(chunk);
    if (sm) {
      try {
        const st = JSON.parse(sm[1]);
        if (st && typeof st.endpoint_id === 'string' && !seenEp.has(st.endpoint_id)) {
          seenEp.add(st.endpoint_id);
          const meta = providerMeta.get(st.endpoint_id);
          const cacheHitRate = typeof meta?.cacheHitRate === 'number' ? meta.cacheHitRate : null;
          endpoints.push({
            endpointId: st.endpoint_id,
            providerName: typeof meta?.providerName === 'string' ? meta.providerName : '',
            providerSlug: typeof meta?.providerSlug === 'string' ? meta.providerSlug : '',
            cacheHitPct: cacheHitRate !== null && cacheHitRate >= 0 && cacheHitRate <= 1 ? roundNum(cacheHitRate * 100, 1) : null,
            p50TtftSec: typeof st.p50_latency === 'number' && st.p50_latency > 0 ? roundNum(st.p50_latency / 1000, 2) : null,
            p75TtftSec: typeof st.p75_latency === 'number' && st.p75_latency > 0 ? roundNum(st.p75_latency / 1000, 2) : null,
            p90TtftSec: typeof st.p90_latency === 'number' && st.p90_latency > 0 ? roundNum(st.p90_latency / 1000, 2) : null,
            p95TtftSec: typeof st.p95_latency === 'number' && st.p95_latency > 0 ? roundNum(st.p95_latency / 1000, 2) : null,
            p99TtftSec: typeof st.p99_latency === 'number' && st.p99_latency > 0 ? roundNum(st.p99_latency / 1000, 2) : null,
            meanTtftSec: typeof st.mean_latency === 'number' && st.mean_latency > 0 ? roundNum(st.mean_latency / 1000, 2) : null,
            p50Tps: typeof st.p50_throughput === 'number' && st.p50_throughput > 0 ? roundNum(st.p50_throughput, 1) : null,
            p90Tps: typeof st.p90_throughput === 'number' && st.p90_throughput > 0 ? roundNum(st.p90_throughput, 1) : null,
            effectiveInputPrice: typeof meta?.effectiveInputPrice === 'number' ? roundNum(meta.effectiveInputPrice, 3) : null,
            effectiveOutputPrice: typeof meta?.effectiveOutputPrice === 'number' ? roundNum(meta.effectiveOutputPrice, 2) : null,
            requestCount: typeof st.request_count === 'number' && st.request_count > 0 ? Math.round(st.request_count) : 0,
            windowMinutes: typeof st.window_minutes === 'number' && st.window_minutes > 0 ? st.window_minutes : 30,
          });
        }
      } catch {
        /* ignore */
      }
    }
    stPos = idx + 16;
  }
  endpoints.sort((a, b) => Number(b.requestCount || 0) - Number(a.requestCount || 0));

  // Extract latest daily tool-call error rate & reasoning share
  let toolCallErrorPct: number | null = null;
  let toolCalls24h = 0;
  let reasoningSharePct: number | null = null;
  const toolIdx = html.lastIndexOf('requests_with_tool_call_errors');
  if (toolIdx >= 0) {
    const chunk = html.slice(Math.max(0, toolIdx - 500), toolIdx + 120).replace(/\\"/g, '"');
    const tm = /"total_completion_tokens":(\d+)[^}]*?"total_native_tokens_reasoning":(\d+)[^}]*?"total_tool_calls":(\d+),"requests_with_tool_call_errors":(\d+)/.exec(chunk);
    if (tm) {
      const comp = Number(tm[1]);
      const reason = Number(tm[2]);
      const calls = Number(tm[3]);
      const errs = Number(tm[4]);
      if (calls > 0) {
        toolCalls24h = calls;
        toolCallErrorPct = roundNum((errs / calls) * 100, 2);
      }
      if (comp > 0 && reason >= 0) {
        reasoningSharePct = Math.max(0, Math.min(100, roundNum((reason / comp) * 100, 1) ?? 0));
      }
    }
  }

  // Extract 24h availability buckets
  const uptime24h: Array<{ x: string; tsMs: number; availability: number; rawAvailability: number | null }> = [];
  const bIdx = html.indexOf('availabilityWithoutRouting');
  if (bIdx >= 0) {
    const bStart = html.lastIndexOf('buckets', bIdx);
    if (bStart >= 0) {
      const chunk = html.slice(bStart, bStart + 24000).replace(/\\"/g, '"');
      const bm = /buckets":(\[\{"timestamp":"[^"]+"[\s\S]*?\}\])/.exec(chunk);
      if (bm) {
        try {
          const arr = JSON.parse(bm[1]);
          if (Array.isArray(arr)) {
            for (const row of arr) {
              if (!row || typeof row.timestamp !== 'string' || typeof row.availability !== 'number') continue;
              uptime24h.push({
                x: row.timestamp.slice(0, 16),
                tsMs: parseUtcMs(row.timestamp),
                availability: Math.max(0, Math.min(100, roundNum(row.availability, 2) ?? 0)),
                rawAvailability:
                  typeof row.availabilityWithoutRouting === 'number'
                    ? Math.max(0, Math.min(100, roundNum(row.availabilityWithoutRouting, 2) ?? 0))
                    : null,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { permaslug, weightedCacheHitPct, endpoints, uptime24h, toolCallErrorPct, toolCalls24h, reasoningSharePct };
}

function parseComparison(
  raw: { data?: Array<{ x?: string; y?: Record<string, unknown> }> },
  kind: 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime',
  endpoints: Array<Record<string, unknown>>,
) {
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  const epPrio = new Map<string, number>();
  const epLabel = new Map<string, string>();
  endpoints.forEach((ep, i) => {
    const id = String(ep.endpointId || '');
    if (id) {
      epPrio.set(id, i);
      epLabel.set(id, normalizeProvider(String(ep.providerName || ep.providerSlug || '')));
    }
  });
  const primaryId = String(endpoints[0]?.endpointId || '');

  const out: Array<{ x: string; tsMs: number; value: number; byProvider?: Record<string, number> }> = [];
  for (const row of rows) {
    if (!row?.x || !row.y || typeof row.y !== 'object') continue;
    const entries = Object.entries(row.y)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
      .map(([epId, v]) => {
        const num = v as number;
        const val =
          kind === 'ttft' || kind === 'e2e'
            ? roundNum(num / 1000, 2) ?? 0
            : kind === 'cache'
              ? Math.max(0, Math.min(100, roundNum(num, 1) ?? 0))
              : kind === 'uptime'
                ? Math.max(0, Math.min(100, roundNum(num, 2) ?? 0))
                : roundNum(num, 1) ?? 0;
        return { epId, val, prio: epPrio.get(epId) ?? 999, provider: epLabel.get(epId) || '' };
      })
      .filter((e) => e.val > 0);
    if (!entries.length) continue;

    const primary = entries.find((e) => e.epId === primaryId);
    const known = entries.filter((e) => e.prio < 999).sort((a, b) => a.prio - b.prio);
    const headline =
      primary?.val ??
      known[0]?.val ??
      entries.map((e) => e.val).sort((a, b) => a - b)[Math.floor(entries.length / 2)];
    const byProvider: Record<string, number> = {};
    for (const e of known) {
      if (e.provider && !(e.provider in byProvider)) byProvider[e.provider] = e.val;
    }
    out.push({
      x: row.x.slice(0, 10),
      tsMs: parseUtcMs(row.x),
      value: headline,
      ...(Object.keys(byProvider).length ? { byProvider } : {}),
    });
  }
  return out;
}

async function fetchJsonSafe<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function collectAndStore(env: Env): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const prevRaw = await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'json') as {
    series7dFetchedAtMs?: number;
    models?: Array<Record<string, any>>;
  } | null;
  const prevByFamily = new Map<string, Record<string, any>>(
    (prevRaw?.models || []).map((m) => [String(m.family), m]),
  );
  const prev7dAt = typeof prevRaw?.series7dFetchedAtMs === 'number' ? prevRaw.series7dFetchedAtMs : 0;
  const shouldRefresh7d = !prev7dAt || nowMs - prev7dAt >= SERIES_7D_TTL_MS;

  const gcpRaw = await fetchJsonSafe<Array<Record<string, any>>>('https://status.cloud.google.com/incidents.json', {
    'User-Agent': 'agy-hud-worker/1.0',
    Accept: 'application/json',
  });
  const incidents = (gcpRaw || [])
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
      summary: String(inc.external_desc || inc.most_recent_update?.text || '').slice(0, 180),
      begin: String(inc.begin || inc.created || ''),
      url: typeof inc.uri === 'string' && inc.uri
        ? (inc.uri.startsWith('http') ? inc.uri : `https://status.cloud.google.com/${inc.uri.replace(/^\/+/, '')}`)
        : 'https://status.cloud.google.com/',
    }));

  const models: Array<Record<string, unknown>> = [];
  for (const spec of GEMINI_MODELS) {
    const [htmlRes, epJson] = await Promise.all([
      fetch(`https://openrouter.ai/${spec.slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; agy-hud-worker/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(8000),
      }).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
      fetchJsonSafe<{ data?: { endpoints?: Array<Record<string, any>> } }>(
        `https://openrouter.ai/api/v1/models/${spec.slug}/endpoints`,
        { 'User-Agent': 'agy-hud-worker/1.0', Accept: 'application/json' },
      ),
    ]);

    const ssr = htmlRes ? extractModelSsrLite(htmlRes) : {
      permaslug: null,
      weightedCacheHitPct: null,
      endpoints: [],
      uptime24h: [],
      toolCallErrorPct: null,
      toolCalls24h: 0,
      reasoningSharePct: null,
    };

    const rawEps = Array.isArray(epJson?.data?.endpoints) ? epJson.data.endpoints : [];
    const stdEps = rawEps.filter((e) => e?.tag === 'google-vertex/global' || e?.tag === 'google-ai-studio');
    const epPool = stdEps.length ? stdEps : rawEps;
    const up5s = epPool.map((e) => e?.uptime_last_5m).filter((v): v is number => typeof v === 'number');
    const up30s = epPool.map((e) => e?.uptime_last_30m).filter((v): v is number => typeof v === 'number');
    const up1ds = epPool.map((e) => e?.uptime_last_1d).filter((v): v is number => typeof v === 'number');
    const uptime5mPct = up5s.length ? roundNum(Math.min(...up5s), 1) : null;
    const uptime30mPct = up30s.length ? roundNum(Math.min(...up30s), 1) : null;
    const uptime1dPct = up1ds.length ? roundNum(Math.min(...up1ds), 1) : null;
    const degradedProviders = [...new Set(
      epPool
        .filter((e) => (typeof e?.status === 'number' && e.status < 0) || (typeof e?.uptime_last_30m === 'number' && e.uptime_last_30m < 95))
        .map((e) => normalizeProvider(String(e?.tag || e?.provider_name || ''))),
    )];

    let ps = ssr.permaslug;
    if (!ps) {
      for (const e of rawEps) {
        if (typeof e?.name === 'string') {
          const pm = /(google\/[a-zA-Z0-9._-]+)$/.exec(e.name.trim());
          if (pm) { ps = pm[1]; break; }
        }
      }
    }
    const prev = prevByFamily.get(spec.family);
    const hasPrev7d = Array.isArray(prev?.series?.ttft7d) && prev.series.ttft7d.length > 0;
    let ttft7d: any[] = hasPrev7d ? prev.series.ttft7d : [];
    let e2e7d: any[] = Array.isArray(prev?.series?.e2e7d) ? prev.series.e2e7d : [];
    let tps7d: any[] = Array.isArray(prev?.series?.tps7d) ? prev.series.tps7d : [];
    let cache7d: any[] = Array.isArray(prev?.series?.cache7d) ? prev.series.cache7d : [];
    let uptime7d: any[] = Array.isArray(prev?.series?.uptime7d) ? prev.series.uptime7d : [];
    if (ps && (shouldRefresh7d || !hasPrev7d)) {
      const qs = `permaslug=${encodeURIComponent(ps)}`;
      const hdrs = { 'User-Agent': 'agy-hud-worker/1.0', Accept: 'application/json' };
      const [latR, e2eR, tpsR, cacheR, upR] = await Promise.all([
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-comparison?${qs}`, hdrs),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-e2e-comparison?${qs}`, hdrs),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/throughput-comparison?${qs}`, hdrs),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/cache-hit-rate-comparison?${qs}`, hdrs),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/uptime-comparison?${qs}`, hdrs),
      ]);
      if (latR) ttft7d = parseComparison(latR, 'ttft', ssr.endpoints);
      if (e2eR) e2e7d = parseComparison(e2eR, 'e2e', ssr.endpoints);
      if (tpsR) tps7d = parseComparison(tpsR, 'tps', ssr.endpoints);
      if (cacheR) cache7d = parseComparison(cacheR, 'cache', ssr.endpoints);
      if (upR) uptime7d = parseComparison(upR, 'uptime', ssr.endpoints);
    }

    const primary = ssr.endpoints[0] || null;
    const p50TtftSec = (primary?.p50TtftSec as number | null) ?? null;
    const p90TtftSec = (primary?.p90TtftSec as number | null) ?? null;
    const p99TtftSec = (primary?.p99TtftSec as number | null) ?? null;
    const p50Tps = (primary?.p50Tps as number | null) ?? null;
    const cacheHitPct = ssr.weightedCacheHitPct ?? (primary?.cacheHitPct as number | null) ?? null;
    const requestCount30m = ssr.endpoints.reduce((acc, e) => acc + Number(e.requestCount || 0), 0);

    const status =
      incidents.some((i) => i.severity === 'high' || /OUTAGE/i.test(i.impact)) || (uptime30mPct !== null && uptime30mPct < 85)
        ? 'outage'
        : incidents.length > 0 || (uptime30mPct !== null && uptime30mPct < 98) || degradedProviders.length > 0 || (p90TtftSec !== null && p90TtftSec >= 20) || (p50TtftSec !== null && p50TtftSec >= 9)
          ? 'degraded'
          : 'ok';

    // Merge 24h 5m high-resolution ring buffer (up to 288 points)
    const cutoff = nowMs - MAX_AGE_MS;
    const byBucket = new Map<number, Record<string, unknown>>();
    for (const pt of (prev?.series?.intraday30m || []) as Array<Record<string, any>>) {
      if (typeof pt?.bucketMs === 'number' && pt.bucketMs >= cutoff) byBucket.set(pt.bucketMs, pt);
    }
    const bucketMs = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
    const byProvider: Record<string, { ttft?: number | null; tps?: number | null; cache?: number | null }> = {};
    for (const ep of ssr.endpoints) {
      const prov = normalizeProvider(String(ep.providerName || ep.providerSlug || ''));
      if (prov && !(prov in byProvider)) {
        byProvider[prov] = {
          ttft: (ep.p50TtftSec as number | null) ?? null,
          tps: (ep.p50Tps as number | null) ?? null,
          cache: (ep.cacheHitPct as number | null) ?? null,
        };
      }
    }
    byBucket.set(bucketMs, {
      bucketMs,
      x: formatUtcBucket(bucketMs),
      p50TtftSec,
      p90TtftSec,
      p99TtftSec,
      p50Tps,
      cacheHitPct,
      uptime5mPct,
      uptime30mPct,
      requestCount30m,
      ...(Object.keys(byProvider).length ? { byProvider } : {}),
    });
    const intraday30m = [...byBucket.values()]
      .sort((a, b) => Number(a.bucketMs) - Number(b.bucketMs))
      .slice(-MAX_INTRADAY_POINTS);

    models.push({
      family: spec.family,
      slug: spec.slug,
      ...(ps ? { permaslug: ps } : {}),
      label: spec.label,
      status,
      p50TtftSec,
      p75TtftSec: (primary?.p75TtftSec as number | null) ?? null,
      p90TtftSec,
      p95TtftSec: (primary?.p95TtftSec as number | null) ?? null,
      p99TtftSec,
      meanTtftSec: (primary?.meanTtftSec as number | null) ?? null,
      p50Tps,
      p90Tps: (primary?.p90Tps as number | null) ?? null,
      cacheHitPct,
      uptime5mPct,
      uptime30mPct,
      uptime1dPct,
      toolCallErrorPct: ssr.toolCallErrorPct,
      toolCalls24h: ssr.toolCalls24h,
      reasoningSharePct: ssr.reasoningSharePct,
      effectiveInputPrice: (primary?.effectiveInputPrice as number | null) ?? null,
      effectiveOutputPrice: (primary?.effectiveOutputPrice as number | null) ?? null,
      requestCount30m,
      windowMinutes: 30,
      primaryProvider: normalizeProvider(String(primary?.providerName || primary?.providerSlug || '')),
      degradedProviders,
      endpoints: ssr.endpoints.slice(0, 6),
      series: {
        ttft7d,
        e2e7d,
        tps7d,
        cache7d,
        uptime7d,
        uptime24h: ssr.uptime24h.slice(-72),
        intraday30m,
      },
    });
  }

  const payload = {
    version: 4,
    source: 'agy-hud-cloudflare-worker',
    sampleIntervalMinutes: 5,
    fetchedAtMs: nowMs,
    series7dFetchedAtMs: shouldRefresh7d ? nowMs : prev7dAt || nowMs,
    models,
    incidents,
  };
  await env.GEMINI_PULSE_KV.put(KV_KEY_SNAPSHOT, JSON.stringify(payload));
  console.log(JSON.stringify({ event: 'gemini_pulse_collected', intervalMin: 5, refreshed7d: shouldRefresh7d, models: models.length, incidents: incidents.length, fetchedAtMs: nowMs }));
  return payload;
}

async function timingSafeTokenEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  const key = await crypto.subtle.importKey('raw', ab, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigA = await crypto.subtle.sign('HMAC', key, ab);
  const sigB = await crypto.subtle.sign('HMAC', key, bb);
  const va = new Uint8Array(sigA);
  const vb = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/v1/health') {
      const snap = await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'json') as {
        fetchedAtMs?: number;
        models?: Array<{ family: string; series?: { intraday30m?: unknown[] } }>;
        incidents?: unknown[];
      } | null;
      return Response.json(
        {
          ok: Boolean(snap?.models?.length),
          sampleIntervalMinutes: 5,
          fetchedAtMs: snap?.fetchedAtMs || 0,
          models: snap?.models?.length || 0,
          intradayPoints: snap?.models?.[0]?.series?.intraday30m?.length || 0,
          incidents: snap?.incidents?.length || 0,
        },
        { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=30' } },
      );
    }

    if (url.pathname === '/v1/refresh' && request.method === 'POST') {
      if (!env.REFRESH_TOKEN) {
        return Response.json({ error: 'Manual refresh disabled' }, { status: 403, headers: CORS_HEADERS });
      }
      const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const ok = await timingSafeTokenEqual(auth, env.REFRESH_TOKEN);
      if (!ok) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
      }
      const snap = await collectAndStore(env);
      return Response.json({ ok: true, fetchedAtMs: snap.fetchedAtMs }, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/v1/pulse.json') {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      let raw = await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'text');
      if (!raw) {
        const seeded = await collectAndStore(env);
        raw = JSON.stringify(seeded);
      }
      const response = new Response(raw, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=90, stale-while-revalidate=300',
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Serve the official AGY-HUD static website (`/` and `/pulse/`) via Workers Static Assets
    if (env.ASSETS) {
      if (url.pathname === '/pulse' || url.pathname === '/hud-demo') {
        return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
      }
      return env.ASSETS.fetch(request);
    }

    return Response.json({ error: 'Not Found' }, { status: 404, headers: CORS_HEADERS });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(collectAndStore(env));
  },
} satisfies ExportedHandler<Env>;
