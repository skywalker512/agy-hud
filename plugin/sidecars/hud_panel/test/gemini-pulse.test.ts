import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GEMINI_PULSE_MODELS,
  buildGeminiPulseSnapshot,
  computeLocalGeminiBaselines,
  evaluateTtftAttribution,
  mergeIntradayHistory,
  parseGcpGeminiIncidents,
  parseOpenRouterComparisonSeries,
  parseOpenRouterEndpointsJson,
  parseOpenRouterModelHtml,
  parseOpenRouterUptimeBuckets,
  refreshGeminiPulse,
  setGeminiPulseEnabled,
  summarizeModelPulse,
} from '../lib/gemini-pulse.ts';

test('parseOpenRouterModelHtml extracts 30m latency/throughput stats and weighted cache hit rate', () => {
  const fakeHtml = `
    <html><script>self.__next_f.push([1,"{\\"weightedCacheHitRate\\":0.8375,\\"providerSummaries\\":[{\\"endpointId\\":\\"ep-vertex\\",\\"providerName\\":\\"Google Vertex (4)\\",\\"providerSlug\\":\\"google-vertex\\",\\"cacheHitRate\\":0.832,\\"totalTokens\\":18941459479},{\\"endpointId\\":\\"ep-studio\\",\\"providerName\\":\\"Google AI Studio (2)\\",\\"providerSlug\\":\\"google-ai-studio\\",\\"cacheHitRate\\":0.858,\\"totalTokens\\":3894886215}]}"])</script>
    <script>self.__next_f.push([1,"{\\"stats\\":{\\"endpoint_id\\":\\"ep-studio\\",\\"p50_latency\\":6226,\\"p75_latency\\":8441,\\"p90_latency\\":12081,\\"p50_throughput\\":71,\\"p90_throughput\\":23,\\"request_count\\":3958,\\"window_minutes\\":30}}"])</script>
    <script>self.__next_f.push([1,"{\\"stats\\":{\\"endpoint_id\\":\\"ep-vertex\\",\\"p50_latency\\":4827,\\"p75_latency\\":7474,\\"p90_latency\\":11182,\\"p50_throughput\\":76,\\"p90_throughput\\":25,\\"request_count\\":30713,\\"window_minutes\\":30}}"])</script></html>
  `;
  const parsed = parseOpenRouterModelHtml(fakeHtml);
  assert.equal(parsed.weightedCacheHitPct, 83.8);
  assert.equal(parsed.endpoints.length, 2);
  // Sorted descending by requestCount so high-volume Google Vertex is primary
  assert.equal(parsed.endpoints[0].endpointId, 'ep-vertex');
  assert.equal(parsed.endpoints[0].p50TtftSec, 4.83);
  assert.equal(parsed.endpoints[0].p90TtftSec, 11.18);
  assert.equal(parsed.endpoints[0].p50Tps, 76);
  assert.equal(parsed.endpoints[0].cacheHitPct, 83.2);
  assert.equal(parsed.endpoints[0].requestCount, 30713);
});

test('parseOpenRouterEndpointsJson and parseGcpGeminiIncidents detect degraded providers and active AI outages', () => {
  const ep = parseOpenRouterEndpointsJson({
    data: {
      endpoints: [
        { tag: 'google-vertex/global', status: -2, uptime_last_30m: 80 },
        { tag: 'google-ai-studio', status: 0, uptime_last_30m: 100 },
        { tag: 'google-vertex/global/priority', status: 0, uptime_last_30m: 0 }, // ignored because standard endpoints exist
      ],
    },
  });
  assert.equal(ep.uptime30mPct, 80);
  assert.deepEqual(ep.degradedProviders, ['Google Vertex']);

  const incidents = parseGcpGeminiIncidents([
    { id: 'resolved-1', service_name: 'Vertex AI', severity: 'high', end: '2026-11-20T00:00:00Z', external_desc: 'Resolved' },
    { id: 'other-1', service_name: 'Cloud Storage', severity: 'medium', end: '', external_desc: 'GCS issue' },
    { id: 'active-ai', service_name: 'Vertex AI', severity: 'medium', status_impact: 'SERVICE_DISRUPTION', end: '', external_desc: 'Elevated Gemini API latency', uri: 'incidents/active-ai' },
  ]);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].id, 'active-ai');
  assert.equal(incidents[0].url, 'https://status.cloud.google.com/incidents/active-ai');

  const summary = summarizeModelPulse(
    GEMINI_PULSE_MODELS[2],
    { weightedCacheHitPct: 82, endpoints: [{ endpointId: 'ep-1', providerName: 'Google Vertex', providerSlug: 'google-vertex', cacheHitPct: 82, p50TtftSec: 12.2, p75TtftSec: 19, p90TtftSec: 36.7, p50Tps: 35, p90Tps: 12, requestCount: 18000, windowMinutes: 30 }] },
    ep,
    incidents,
  );
  assert.equal(summary.status, 'outage'); // uptime 80 < 85
});

test('computeLocalGeminiBaselines stratifies hit vs cold-miss TTFT and evaluateTtftAttribution classifies all 5 verdicts', () => {
  const now = 1_800_000_000_000;
  const recentCalls = [
    // Recent 30m cached hit calls (~1.2s TTFT)
    { ts: now - 10 * 60_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 3000, cachedInput: 90000, ttftSec: 1.1, genTps: 140 },
    { ts: now - 15 * 60_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 4000, cachedInput: 95000, ttftSec: 1.2, genTps: 145 },
    { ts: now - 20 * 60_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 5000, cachedInput: 100000, ttftSec: 1.3, genTps: 150 },
    // Older (>30m, <24h) cold prefill calls (~5.0s TTFT)
    { ts: now - 3300_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 80000, cachedInput: 0, ttftSec: 4.8, genTps: 135 },
    { ts: now - 3200_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 90000, cachedInput: 10000, ttftSec: 5.0, genTps: 130 },
    { ts: now - 3100_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 110000, cachedInput: 5000, ttftSec: 5.4, genTps: 128 },
    // Ignored: non-Gemini and >7d old
    { ts: now - 3000_000, poolKey: 'claude_gpt', family: 'claude-opus-5-5', newInput: 2000, cachedInput: 50000, ttftSec: 9.0, genTps: 50 },
    { ts: now - 9 * 86_400_000, poolKey: 'gemini', family: 'gemini-4-hydrogen', newInput: 2000, cachedInput: 50000, ttftSec: 30.0, genTps: 10 },
  ];

  const baselines = computeLocalGeminiBaselines([{ latestTsMs: now - 10 * 60_000, recentCalls }], now);
  const hb = baselines['gemini-4-hydrogen'];
  assert.ok(hb);
  assert.equal(hb.calls7d, 6);
  assert.equal(hb.calls24h, 6);
  assert.equal(hb.calls30m, 3);
  assert.equal(hb.p50Ttft30mSec, 1.2);
  assert.equal(hb.p50Tps30m, 145);
  assert.ok(Array.isArray(hb.daily7d) && hb.daily7d.length >= 1);
  assert.equal(hb.daily7d[0].calls, 6);
  assert.equal(hb.hitP50TtftSec, 1.2);
  assert.equal(hb.missP50TtftSec, 5.0);
  assert.equal(baselines['claude-opus-5-5'], undefined);

  const healthyGlobal = {
    family: 'gemini-4-hydrogen',
    slug: 'google/gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    status: 'ok' as const,
    p50TtftSec: 1.4,
    p75TtftSec: 2.1,
    p90TtftSec: 3.0,
    p50Tps: 149,
    p90Tps: 90,
    cacheHitPct: 79.3,
    uptime30mPct: 100,
    requestCount30m: 22000,
    windowMinutes: 30,
    primaryProvider: 'Google Vertex',
    degradedProviders: [],
  };

  // 1) Normal fast call
  const vNormal = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-hydrogen', ttftSec: 1.3, newInput: 4000, cachedInput: 90000, genTps: 145 },
    globalModel: healthyGlobal,
    localBaseline: hb,
    activeIncidents: [],
    inFlightCount: 0,
  });
  assert.equal(vNormal?.verdict, 'normal');

  // 2) Account / local slow while global is fast (1.4s P50, 3.0s P90, 100% uptime), high cache hit, no concurrency
  const vAccount = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-hydrogen', ttftSec: 9.2, newInput: 3000, cachedInput: 95000, genTps: 120 },
    globalModel: healthyGlobal,
    localBaseline: hb,
    activeIncidents: [],
    inFlightCount: 0,
  });
  assert.equal(vAccount?.verdict, 'account_or_network');

  // 3) Cold prefill cache miss (120k uncached input)
  const vCold = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-hydrogen', ttftSec: 10.5, newInput: 120_000, cachedInput: 5000, genTps: 130 },
    globalModel: healthyGlobal,
    localBaseline: hb,
    activeIncidents: [],
    inFlightCount: 0,
  });
  assert.equal(vCold?.verdict, 'cache_miss');

  // 4) Local concurrency queuing (3 parallel conversations)
  const vConc = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-hydrogen', ttftSec: 6.5, newInput: 4000, cachedInput: 90000, genTps: 110 },
    globalModel: healthyGlobal,
    localBaseline: hb,
    activeIncidents: [],
    inFlightCount: 3,
  });
  assert.equal(vConc?.verdict, 'local_concurrency');

  // 5) Upstream degraded / global pool slow
  const vUpstream = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-hydrogen', ttftSec: 8.5, newInput: 4000, cachedInput: 90000, genTps: 90 },
    globalModel: { ...healthyGlobal, status: 'degraded', p50TtftSec: 6.8, p90TtftSec: 18.0, uptime30mPct: 92 },
    localBaseline: hb,
    activeIncidents: [],
    inFlightCount: 0,
  });
  assert.equal(vUpstream?.verdict, 'upstream_degraded');

  // 6) Non-Gemini model returns null (Gemini-only scope)
  const vClaude = evaluateTtftAttribution({
    latest: { modelId: 'claude-opus-5-5', ttftSec: 9.0, newInput: 3000, cachedInput: 80000, genTps: 50 },
    globalModel: null,
    localBaseline: null,
    activeIncidents: [],
  });
  assert.equal(vClaude, null);
});

test('refreshGeminiPulse persists disk cache and setGeminiPulseEnabled toggles offline mode cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-gemini-pulse-'));
  const cachePath = join(dir, 'gemini-pulse-cache.json');
  try {
    const mockFetch = (async (url: string) => {
      if (url.includes('status.cloud.google.com')) {
        return { ok: true, status: 200, text: async () => '[]' };
      }
      if (url.endsWith('/endpoints')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: { endpoints: [{ tag: 'google-vertex/global', status: 0, uptime_last_30m: 100 }] } }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => `{"weightedCacheHitRate":0.84,"providerSummaries":[{"endpointId":"ep1","providerName":"Google Vertex","providerSlug":"google-vertex","cacheHitRate":0.84,"totalTokens":1000}]}{"stats":{"endpoint_id":"ep1","p50_latency":4800,"p75_latency":7100,"p90_latency":11000,"p50_throughput":76,"p90_throughput":25,"request_count":30000,"window_minutes":30}}`,
      };
    }) as any;

    const cached = await refreshGeminiPulse({ cachePath, force: true, fetchImpl: mockFetch });
    assert.equal(cached.models.length, GEMINI_PULSE_MODELS.length);
    assert.equal(existsSync(cachePath), true);

    const snap = buildGeminiPulseSnapshot({
      cachePath,
      triggerRefresh: false,
      latest: { modelId: 'gemini-4-neon', ttftSec: 5.1, newInput: 5000, cachedInput: 80000, genTps: 72 },
    });
    assert.equal(snap.available, true);
    assert.equal(snap.overallStatus, 'ok');
    assert.equal(snap.activeFamily, 'gemini-4-neon');
    assert.equal(snap.activeModel?.p50TtftSec, 4.8);
    assert.equal(snap.attribution?.verdict, 'upstream_degraded'); // 5.1s inside elevated global P50 4.8s..P90 11s band!

    // Disable -> offline mode returns empty models & available=false
    setGeminiPulseEnabled(false, { cachePath });
    const offSnap = buildGeminiPulseSnapshot({ cachePath, triggerRefresh: false });
    assert.equal(offSnap.enabled, false);
    assert.equal(offSnap.available, false);
    assert.equal(offSnap.models.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseOpenRouterComparisonSeries and parseOpenRouterUptimeBuckets extract 7d curves and 24h availability series', () => {
  const endpoints = [
    {
      endpointId: 'ep-vertex',
      providerName: 'Google Vertex (4)',
      providerSlug: 'google-vertex',
      cacheHitPct: 83.2,
      p50TtftSec: 4.5,
      p75TtftSec: 7.0,
      p90TtftSec: 11.0,
      p50Tps: 80,
      p90Tps: 25,
      requestCount: 30000,
      windowMinutes: 30,
    },
    {
      endpointId: 'ep-studio',
      providerName: 'Google AI Studio (2)',
      providerSlug: 'google-ai-studio',
      cacheHitPct: 85.0,
      p50TtftSec: 5.2,
      p75TtftSec: 8.1,
      p90TtftSec: 12.0,
      p50Tps: 72,
      p90Tps: 22,
      requestCount: 5000,
      windowMinutes: 30,
    },
  ];

  const latSeries = parseOpenRouterComparisonSeries(
    {
      data: [
        { x: '2026-11-22', y: { 'ep-vertex': 2400, 'ep-studio': 3800 } },
        { x: '2026-11-23', y: { 'ep-vertex': 4100, 'ep-studio': 5200 } },
      ],
    },
    'ttft',
    endpoints,
  );
  assert.equal(latSeries.length, 2);
  assert.equal(latSeries[0].x, '2026-11-22');
  assert.equal(latSeries[0].value, 2.4);
  assert.equal(latSeries[0].byProvider?.['Google Vertex'], 2.4);
  assert.equal(latSeries[0].byProvider?.['AI Studio'], 3.8);

  const tpsSeries = parseOpenRouterComparisonSeries(
    { data: [{ x: '2026-11-23', y: { 'ep-vertex': 84.5, 'ep-studio': 92 } }] },
    'tps',
    endpoints,
  );
  assert.equal(tpsSeries[0].value, 84.5);
  assert.equal(tpsSeries[0].byProvider?.['AI Studio'], 92);

  const buckets = parseOpenRouterUptimeBuckets(
    '"buckets":[{"timestamp":"2026-11-23 03:50:00","availability":99.71,"availabilityWithoutRouting":99.11},{"timestamp":"2026-11-23 04:00:00","availability":98.5,"availabilityWithoutRouting":97.2}]',
  );
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].availability, 99.71);
  assert.equal(buckets[0].rawAvailability, 99.11);
  assert.equal(buckets[1].x, '2026-11-23 04:00');
});

test('parseOpenRouterModelHtml extracts P95/P99, tool call error rate, reasoning share & mergeIntradayHistory maintains 48h 30m ring buffer', () => {
  const html = `
    <script>self.__next_f.push([1,"{\\"weightedCacheHitRate\\":0.82,\\"providerSummaries\\":[{\\"endpointId\\":\\"ep-v\\",\\"providerName\\":\\"Google Vertex (4)\\",\\"providerSlug\\":\\"google-vertex\\",\\"cacheHitRate\\":0.82,\\"effectiveInputPrice\\":0.66,\\"effectiveOutputPrice\\":15,\\"totalTokens\\":44000000000}]}"])</script>
    <script>self.__next_f.push([1,"{\\"stats\\":{\\"endpoint_id\\":\\"ep-v\\",\\"p50_latency\\":4300,\\"p75_latency\\":7400,\\"p90_latency\\":13900,\\"p95_latency\\":20600,\\"p99_latency\\":40290,\\"mean_latency\\":7080,\\"p50_throughput\\":67,\\"p90_throughput\\":18,\\"request_count\\":22476,\\"window_minutes\\":30}}"])</script>
    <script>self.__next_f.push([1,"{\\"total_completion_tokens\\":200000,\\"total_native_tokens_reasoning\\":84000,\\"total_tool_calls\\":10000,\\"requests_with_tool_call_errors\\":125}"])</script>
  `;
  const parsed = parseOpenRouterModelHtml(html);
  assert.equal(parsed.endpoints[0].p95TtftSec, 20.6);
  assert.equal(parsed.endpoints[0].p99TtftSec, 40.29);
  assert.equal(parsed.endpoints[0].meanTtftSec, 7.08);
  assert.equal(parsed.endpoints[0].effectiveInputPrice, 0.66);
  assert.equal(parsed.toolCalls24h, 10000);
  assert.equal(parsed.toolCallErrorPct, 1.25);
  assert.equal(parsed.reasoningSharePct, 42);

  const e2eSeries = parseOpenRouterComparisonSeries(
    { data: [{ x: '2026-11-23', y: { 'ep-v': 10200 } }] },
    'e2e',
    parsed.endpoints,
  );
  assert.equal(e2eSeries[0].value, 10.2);

  const t0 = Date.UTC(2026, 10, 24, 10, 7, 0);
  const tOld = t0 - 26 * 3_600_000;
  const model = summarizeModelPulse(
    GEMINI_PULSE_MODELS[0],
    parsed,
    { uptime5mPct: 100, uptime30mPct: 99.8, uptime1dPct: 99.9, degradedProviders: [] },
    [],
  );
  assert.equal(model.p99TtftSec, 40.29);
  assert.equal(model.toolCallErrorPct, 1.25);
  assert.equal(model.uptime5mPct, 100);

  const merged = mergeIntradayHistory(
    [
      { bucketMs: tOld, x: '2026-11-23 08:00', p50TtftSec: 9.9, p50Tps: 40, cacheHitPct: 70, uptime30mPct: 99 },
      { bucketMs: Date.UTC(2026, 10, 24, 10, 0, 0), x: '2026-11-24 10:00', p50TtftSec: 4.1, p50Tps: 70, cacheHitPct: 81, uptime30mPct: 100 },
    ],
    model,
    t0,
  );
  assert.equal(merged.length, 2); // pruned >24h old bucket, kept 10:00 + added 10:05
  assert.equal(merged[1].x, '2026-11-24 10:05');
  assert.equal(merged[1].p50TtftSec, 4.3);
  assert.equal(merged[1].p99TtftSec, 40.29);
  assert.equal(merged[1].uptime5mPct, 100);
});

test('avgPromptTokens extraction, context-bucketed local baselines, isBuffered filtering, and large_context TTFT verdict', () => {
  const html = `<script>self.__next_f.push([1,"{\\"total_completion_tokens\\":200000000,\\"total_prompt_tokens\\":8000000000,\\"total_native_tokens_reasoning\\":100000000,\\"count\\":100000,\\"total_tool_calls\\":50000,\\"requests_with_tool_call_errors\\":200}"])</script>`;
  const parsed = parseOpenRouterModelHtml(html);
  assert.equal(parsed.avgPromptTokens, 80000);
  assert.equal(parsed.avgOutputTokens, 2000);

  const now = 1_800_000_000_000;
  const recentCalls = [
    // Small context (<100k) fast calls
    { ts: now - 10 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 4000, cachedInput: 50000, ttftSec: 4.0, genTps: 160 },
    { ts: now - 20 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 4000, cachedInput: 60000, ttftSec: 4.2, genTps: 155 },
    { ts: now - 30 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 4000, cachedInput: 65000, ttftSec: 4.4, genTps: 150 },
    // Buffered turn should be excluded from TPS
    { ts: now - 35 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 4000, cachedInput: 50000, ttftSec: 4.1, genTps: 999, isBuffered: true },
    // Large context (>=200k) slower calls
    { ts: now - 40 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 5000, cachedInput: 220000, ttftSec: 7.4, genTps: 135 },
    { ts: now - 50 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 5000, cachedInput: 230000, ttftSec: 7.6, genTps: 130 },
    { ts: now - 60 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 5000, cachedInput: 240000, ttftSec: 7.8, genTps: 128 },
    { ts: now - 70 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 5000, cachedInput: 250000, ttftSec: 7.5, genTps: 132 },
    { ts: now - 80 * 60_000, poolKey: 'gemini', family: 'gemini-4-neon', newInput: 5000, cachedInput: 260000, ttftSec: 7.9, genTps: 129 },
  ];
  const baselines = computeLocalGeminiBaselines([{ latestTsMs: now - 10 * 60_000, recentCalls }], now);
  const nb = baselines['gemini-4-neon'];
  assert.ok(nb);
  assert.equal(nb.matched100k?.calls, 4);
  assert.equal(nb.matched100k?.p50TtftSec, 4.1);
  assert.equal(nb.matched100k?.p50Tps, 155); // excludes isBuffered 999!
  assert.ok((nb.ctxBuckets || []).some((b) => b.key === '>=200k' && b.calls === 5 && b.p50TtftSec === 7.6));

  const vLarge = evaluateTtftAttribution({
    latest: { modelId: 'gemini-4-neon', ttftSec: 8.2, newInput: 6000, cachedInput: 230000, genTps: 130 },
    globalModel: {
      family: 'gemini-4-neon',
      slug: 'google/gemini-4-neon',
      label: 'Gemini 4 Neon',
      status: 'ok',
      p50TtftSec: 3.9,
      p75TtftSec: 6.0,
      p90TtftSec: 11.0,
      p50Tps: 70,
      p90Tps: 20,
      cacheHitPct: 83,
      uptime30mPct: 100,
      avgPromptTokens: 80000,
      requestCount30m: 20000,
      windowMinutes: 30,
      primaryProvider: 'Google Vertex',
      degradedProviders: [],
    },
    localBaseline: nb,
    activeIncidents: [],
    inFlightCount: 0,
  });
  assert.equal(vLarge?.verdict, 'large_context');
  assert.equal(vLarge?.currentCtxTokens, 236000);
  assert.equal(vLarge?.globalAvgCtxTokens, 80000);
  assert.equal(vLarge?.localBucket, '>=200k');
});
