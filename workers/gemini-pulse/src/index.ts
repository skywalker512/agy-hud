/**
 * AGY-HUD Gemini Pulse Collector — Cloudflare Workers Free + KV ($0/mo, no card required).
 *
 * Collects 5-minute Gemini global telemetry snapshots from OpenRouter & Google Cloud Service Health,
 * maintains a 24-hour 5m ring buffer in Workers KV (288 writes/day, <29% of Free tier),
 * and serves CORS-enabled, edge-cached JSON plus the official static site (`/` and `/pulse/`)
 * via Workers Static Assets.
 */
import {
  GEMINI_PULSE_MODELS,
  classifyModelPulseStatus,
  hasAnyLiveMetric,
  mergeIntradayHistory,
  normalizeProviderLabel,
  parseGcpGeminiIncidents,
  parseOpenRouterComparisonSeries,
  parseOpenRouterEndpointsJson,
  parseOpenRouterModelHtml,
  type GeminiIntradayPoint,
  type GeminiTimeSeriesPoint,
  type GeminiUptimeBucket,
} from '../../../plugin/sidecars/hud_panel/lib/pulse-core.ts';

export interface Env {
  GEMINI_PULSE_KV: KVNamespace;
  ASSETS?: Fetcher;
  REFRESH_TOKEN?: string;
}

const KV_KEY_SNAPSHOT = 'gemini:pulse:v4';
const KV_KEY_SEED_LOCK = 'gemini:pulse:seed-lock';
const SERIES_7D_TTL_MS = 30 * 60_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
};

async function fetchJsonSafe<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function collectAndStore(
  env: Env,
  opts: { fetchImpl?: typeof fetch; nowMs?: number } = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = opts.fetchImpl || fetch;
  const nowMs = opts.nowMs ?? Date.now();
  const prevRaw = (await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'json')) as {
    fetchedAtMs?: number;
    series7dFetchedAtMs?: number;
    series7dFetchedAtByFamily?: Record<string, number>;
    models?: Array<Record<string, any>>;
    incidents?: unknown[];
  } | null;

  const prevByFamily = new Map<string, Record<string, any>>(
    (prevRaw?.models || []).map((m) => [String(m.family), m]),
  );
  const prev7dByFamily: Record<string, number> = { ...(prevRaw?.series7dFetchedAtByFamily || {}) };
  const legacy7dAt = typeof prevRaw?.series7dFetchedAtMs === 'number' ? prevRaw.series7dFetchedAtMs : 0;

  const gcpPromise = fetchJsonSafe<Array<Record<string, any>>>(
    'https://status.cloud.google.com/incidents.json',
    { 'User-Agent': 'agy-hud-worker/1.0', Accept: 'application/json' },
    fetchImpl,
  ).then((raw) => (raw ? parseGcpGeminiIncidents(raw) : null));

  // Fetch all 5 Gemini models concurrently to keep wall-clock time minimal
  const modelTasks = GEMINI_PULSE_MODELS.map(async (spec) => {
    const [htmlRes, epJson] = await Promise.all([
      fetchImpl(`https://openrouter.ai/${spec.slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; agy-hud-worker/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(8000),
      })
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => ''),
      fetchJsonSafe<{ data?: { endpoints?: Array<Record<string, any>> } }>(
        `https://openrouter.ai/api/v1/models/${spec.slug}/endpoints`,
        { 'User-Agent': 'agy-hud-worker/1.0', Accept: 'application/json' },
        fetchImpl,
      ),
    ]);

    const ssr = htmlRes
      ? parseOpenRouterModelHtml(htmlRes)
      : { permaslug: null, weightedCacheHitPct: null, endpoints: [], uptime24h: [] as GeminiUptimeBucket[] };
    const epParsed = parseOpenRouterEndpointsJson(epJson);
    const hasFreshData = ssr.endpoints.length > 0 || epParsed.endpointCount > 0;
    const prev = prevByFamily.get(spec.family);

    if (!hasFreshData) {
      return {
        spec,
        hasFreshData: false,
        refreshed7d: false,
        prev,
        ssr,
        epParsed,
        ps: (prev?.permaslug as string | undefined) || null,
        ttft7d: (Array.isArray(prev?.series?.ttft7d) ? prev.series.ttft7d : []) as GeminiTimeSeriesPoint[],
        e2e7d: (Array.isArray(prev?.series?.e2e7d) ? prev.series.e2e7d : []) as GeminiTimeSeriesPoint[],
        tps7d: (Array.isArray(prev?.series?.tps7d) ? prev.series.tps7d : []) as GeminiTimeSeriesPoint[],
        cache7d: (Array.isArray(prev?.series?.cache7d) ? prev.series.cache7d : []) as GeminiTimeSeriesPoint[],
        uptime7d: (Array.isArray(prev?.series?.uptime7d) ? prev.series.uptime7d : []) as GeminiTimeSeriesPoint[],
      };
    }

    const ps = ssr.permaslug || epParsed.permaslugFallback || (typeof prev?.permaslug === 'string' ? prev.permaslug : null);
    const prevModel7dAt = prev7dByFamily[spec.family] ?? legacy7dAt;
    const hasPrev7d = Array.isArray(prev?.series?.ttft7d) && prev.series.ttft7d.length > 0;
    const needs7d = !prevModel7dAt || nowMs - prevModel7dAt >= SERIES_7D_TTL_MS || !hasPrev7d;

    let ttft7d: GeminiTimeSeriesPoint[] = hasPrev7d ? prev.series.ttft7d : [];
    let e2e7d: GeminiTimeSeriesPoint[] = Array.isArray(prev?.series?.e2e7d) ? prev.series.e2e7d : [];
    let tps7d: GeminiTimeSeriesPoint[] = Array.isArray(prev?.series?.tps7d) ? prev.series.tps7d : [];
    let cache7d: GeminiTimeSeriesPoint[] = Array.isArray(prev?.series?.cache7d) ? prev.series.cache7d : [];
    let uptime7d: GeminiTimeSeriesPoint[] = Array.isArray(prev?.series?.uptime7d) ? prev.series.uptime7d : [];
    let refreshed7d = false;

    if (ps && needs7d) {
      const qs = `permaslug=${encodeURIComponent(ps)}`;
      const hdrs = { 'User-Agent': 'agy-hud-worker/1.0', Accept: 'application/json' };
      const [latR, e2eR, tpsR, cacheR, upR] = await Promise.all([
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-comparison?${qs}`, hdrs, fetchImpl),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/latency-e2e-comparison?${qs}`, hdrs, fetchImpl),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/throughput-comparison?${qs}`, hdrs, fetchImpl),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/cache-hit-rate-comparison?${qs}`, hdrs, fetchImpl),
        fetchJsonSafe<any>(`https://openrouter.ai/api/frontend/v1/stats/uptime-comparison?${qs}`, hdrs, fetchImpl),
      ]);
      const parsedLat = latR ? parseOpenRouterComparisonSeries(latR, 'ttft', ssr.endpoints) : [];
      const parsedE2e = e2eR ? parseOpenRouterComparisonSeries(e2eR, 'e2e', ssr.endpoints) : [];
      const parsedTps = tpsR ? parseOpenRouterComparisonSeries(tpsR, 'tps', ssr.endpoints) : [];
      const parsedCache = cacheR ? parseOpenRouterComparisonSeries(cacheR, 'cache', ssr.endpoints) : [];
      const parsedUp = upR ? parseOpenRouterComparisonSeries(upR, 'uptime', ssr.endpoints) : [];
      if (parsedLat.length > 0) { ttft7d = parsedLat; refreshed7d = true; }
      if (parsedE2e.length > 0) { e2e7d = parsedE2e; refreshed7d = true; }
      if (parsedTps.length > 0) { tps7d = parsedTps; refreshed7d = true; }
      if (parsedCache.length > 0) { cache7d = parsedCache; refreshed7d = true; }
      if (parsedUp.length > 0) { uptime7d = parsedUp; refreshed7d = true; }
    }

    return {
      spec,
      hasFreshData: true,
      refreshed7d,
      prev,
      ssr,
      epParsed,
      ps,
      ttft7d,
      e2e7d,
      tps7d,
      cache7d,
      uptime7d,
    };
  });

  const [gcpIncidents, results] = await Promise.all([gcpPromise, Promise.all(modelTasks)]);
  const anyFreshModel = results.some((r) => r.hasFreshData);

  // If OpenRouter failed/blocked for every model, do NOT overwrite healthy KV state with empty/null junk
  if (!anyFreshModel) {
    console.warn(
      JSON.stringify({
        event: 'gemini_pulse_collect_skipped',
        reason: 'all_models_empty',
        keptPrev: Boolean(prevRaw?.models?.length),
        nowMs,
      }),
    );
    if (prevRaw && Array.isArray(prevRaw.models) && prevRaw.models.length > 0) {
      return prevRaw as Record<string, unknown>;
    }
    return {
      version: 4,
      source: 'agy-hud-cloudflare-worker',
      sampleIntervalMinutes: 5,
      fetchedAtMs: 0,
      models: [],
      incidents: gcpIncidents || [],
    };
  }

  const incidents = gcpIncidents ?? (Array.isArray(prevRaw?.incidents) ? (prevRaw.incidents as any[]) : []);
  const next7dByFamily: Record<string, number> = { ...prev7dByFamily };
  let anyRefreshed7d = false;

  const models: Array<Record<string, unknown>> = [];
  for (const r of results) {
    if (!r.hasFreshData) {
      // Reuse previous valid model snapshot rather than writing a bogus status:'ok' + all-null metrics
      if (r.prev) {
        models.push(r.prev);
      }
      continue;
    }

    if (r.refreshed7d) {
      next7dByFamily[r.spec.family] = nowMs;
      anyRefreshed7d = true;
    }

    const primary = r.ssr.endpoints[0] || null;
    const p50TtftSec = primary?.p50TtftSec ?? null;
    const p90TtftSec = primary?.p90TtftSec ?? null;
    const p99TtftSec = primary?.p99TtftSec ?? null;
    const p50Tps = primary?.p50Tps ?? null;
    const cacheHitPct = r.ssr.weightedCacheHitPct ?? primary?.cacheHitPct ?? null;
    const requestCount30m = r.ssr.endpoints.reduce((acc, e) => acc + Number(e.requestCount || 0), 0);

    const status = classifyModelPulseStatus(
      {
        uptime30mPct: r.epParsed.uptime30mPct,
        degradedProviders: r.epParsed.degradedProviders,
        p50TtftSec,
        p90TtftSec,
      },
      incidents,
    );

    const candidateCurrent = {
      p50TtftSec,
      p90TtftSec,
      p99TtftSec,
      p50Tps,
      cacheHitPct,
      uptime5mPct: r.epParsed.uptime5mPct,
      uptime30mPct: r.epParsed.uptime30mPct,
      requestCount30m,
      endpoints: r.ssr.endpoints,
    };

    // Only append a 5m intraday bucket when at least one metric is actually non-null
    const intraday30m = hasAnyLiveMetric(candidateCurrent)
      ? mergeIntradayHistory(r.prev?.series?.intraday30m as GeminiIntradayPoint[] | undefined, candidateCurrent, nowMs)
      : (Array.isArray(r.prev?.series?.intraday30m) ? r.prev.series.intraday30m : []);

    const uptime24h = r.ssr.uptime24h.length > 0
      ? r.ssr.uptime24h
      : (Array.isArray(r.prev?.series?.uptime24h) ? r.prev.series.uptime24h : []);

    models.push({
      family: r.spec.family,
      slug: r.spec.slug,
      ...(r.ps ? { permaslug: r.ps } : {}),
      label: r.spec.label,
      status,
      p50TtftSec,
      p75TtftSec: primary?.p75TtftSec ?? null,
      p90TtftSec,
      p95TtftSec: primary?.p95TtftSec ?? null,
      p99TtftSec,
      meanTtftSec: primary?.meanTtftSec ?? null,
      p50Tps,
      p90Tps: primary?.p90Tps ?? null,
      cacheHitPct,
      uptime5mPct: r.epParsed.uptime5mPct,
      uptime30mPct: r.epParsed.uptime30mPct,
      uptime1dPct: r.epParsed.uptime1dPct,
      toolCallErrorPct: r.ssr.toolCallErrorPct ?? null,
      toolCalls24h: r.ssr.toolCalls24h ?? 0,
      reasoningSharePct: r.ssr.reasoningSharePct ?? null,
      avgPromptTokens: r.ssr.avgPromptTokens ?? null,
      avgOutputTokens: r.ssr.avgOutputTokens ?? null,
      effectiveInputPrice: primary?.effectiveInputPrice ?? null,
      effectiveOutputPrice: primary?.effectiveOutputPrice ?? null,
      requestCount30m,
      windowMinutes: 30,
      primaryProvider: normalizeProviderLabel(String(primary?.providerName || primary?.providerSlug || '')),
      degradedProviders: r.epParsed.degradedProviders,
      endpoints: r.ssr.endpoints.slice(0, 6),
      series: {
        ttft7d: r.ttft7d,
        e2e7d: r.e2e7d,
        tps7d: r.tps7d,
        cache7d: r.cache7d,
        uptime7d: r.uptime7d,
        uptime24h,
        intraday30m,
      },
    });
  }

  const payload = {
    version: 4,
    source: 'agy-hud-cloudflare-worker',
    sampleIntervalMinutes: 5,
    fetchedAtMs: nowMs,
    series7dFetchedAtMs: anyRefreshed7d ? nowMs : legacy7dAt,
    series7dFetchedAtByFamily: next7dByFamily,
    models,
    incidents,
  };
  await env.GEMINI_PULSE_KV.put(KV_KEY_SNAPSHOT, JSON.stringify(payload));
  console.log(
    JSON.stringify({
      event: 'gemini_pulse_collected',
      intervalMin: 5,
      refreshed7d: anyRefreshed7d,
      models: models.length,
      incidents: incidents.length,
      fetchedAtMs: nowMs,
    }),
  );
  return payload;
}

/**
 * Constant-time token comparison without an early length-mismatch return:
 * HMAC both inputs with a per-call random 32-byte key and compare the 32-byte digests.
 */
async function timingSafeTokenEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', nonce, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(sigA);
  const vb = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function buildCanonicalCacheKey(url: URL): Request {
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}

function extractFetchedAtFromRaw(raw: string): number {
  const m = /"fetchedAtMs"\s*:\s*(\d+)/.exec(raw);
  return m ? Number(m[1]) || 0 : 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/v1/health') {
      const cache = caches.default;
      const cacheKey = buildCanonicalCacheKey(url);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const snap = (await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'json')) as {
        fetchedAtMs?: number;
        models?: Array<{ family: string; series?: { intraday30m?: unknown[] } }>;
        incidents?: unknown[];
      } | null;
      const response = Response.json(
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
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
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
      const cacheKey = buildCanonicalCacheKey(url);
      const ifNoneMatch = request.headers.get('If-None-Match');
      const cached = await cache.match(cacheKey);
      if (cached) {
        const cachedEtag = cached.headers.get('ETag');
        if (cachedEtag && ifNoneMatch && ifNoneMatch.includes(cachedEtag)) {
          return new Response(null, {
            status: 304,
            headers: {
              ...CORS_HEADERS,
              ETag: cachedEtag,
              'Cache-Control': cached.headers.get('Cache-Control') || 'public, max-age=90, stale-while-revalidate=300',
            },
          });
        }
        return cached;
      }

      const raw = await env.GEMINI_PULSE_KV.get(KV_KEY_SNAPSHOT, 'text');
      if (!raw) {
        // Cold KV: avoid stampeding inline 36-subrequest scrapes; acquire short lock and seed in background
        const lock = await env.GEMINI_PULSE_KV.get(KV_KEY_SEED_LOCK);
        if (!lock) {
          await env.GEMINI_PULSE_KV.put(KV_KEY_SEED_LOCK, String(Date.now()), { expirationTtl: 90 });
          ctx.waitUntil(
            collectAndStore(env).catch((err) => {
              console.error(JSON.stringify({ event: 'gemini_pulse_seed_error', error: String(err) }));
            }),
          );
        }
        return Response.json(
          { error: 'Pulse snapshot is warming up; please retry shortly.' },
          {
            status: 503,
            headers: {
              ...CORS_HEADERS,
              'Retry-After': '10',
              'Cache-Control': 'no-store',
            },
          },
        );
      }

      const fetchedAtMs = extractFetchedAtFromRaw(raw);
      const etag = `W/"pulse-${fetchedAtMs}"`;
      if (fetchedAtMs > 0 && ifNoneMatch && ifNoneMatch.includes(etag)) {
        return new Response(null, {
          status: 304,
          headers: {
            ...CORS_HEADERS,
            ETag: etag,
            'Cache-Control': 'public, max-age=90, stale-while-revalidate=300',
          },
        });
      }

      const response = new Response(raw, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          ETag: etag,
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

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await collectAndStore(env);
    } catch (err) {
      console.error(JSON.stringify({ event: 'gemini_pulse_cron_error', error: String(err) }));
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
