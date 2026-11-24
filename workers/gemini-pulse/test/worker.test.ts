import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAndStore } from '../src/index.ts';

test('Worker collectAndStore skips KV put on empty OpenRouter responses and reuses 7d series on subsequent ticks', async () => {
  const kvStore = new Map<string, string>();
  let putCount = 0;
  const fakeEnv = {
    GEMINI_PULSE_KV: {
      get: async (k: string, mode?: string) => {
        const v = kvStore.get(k) ?? null;
        if (v === null) return null;
        return mode === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => {
        putCount += 1;
        kvStore.set(k, v);
      },
    } as any,
  };

  // 1) All-blocked OpenRouter fetch must NOT write empty/ok junk to KV
  const blockedFetch = (async () => ({ ok: false, status: 403, text: async () => '', json: async () => null })) as any;
  const skipped = await collectAndStore(fakeEnv, { fetchImpl: blockedFetch, nowMs: 1_800_000_000_000 });
  assert.equal(putCount, 0);
  assert.deepEqual(skipped.models, []);

  // 2) Valid fetch writes snapshot and populates 5m intraday + 7d series
  let comparisonFetches = 0;
  const okFetch = (async (url: string) => {
    if (url.includes('status.cloud.google.com')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/endpoints')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            endpoints: [
              {
                name: 'Google: google/gemini-4-neon',
                tag: 'google-vertex/global',
                status: 0,
                uptime_last_5m: 100,
                uptime_last_30m: 99.9,
                uptime_last_1d: 99.8,
              },
            ],
          },
        }),
      };
    }
    if (url.includes('-comparison?')) {
      comparisonFetches += 1;
      return { ok: true, status: 200, json: async () => ({ data: [{ x: '2026-11-24', y: { ep1: 4200 } }] }) };
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        `{"permaslug":"google/gemini-4-neon","weightedCacheHitRate":0.82,"providerSummaries":[{"endpointId":"ep1","providerName":"Google Vertex","providerSlug":"google-vertex","cacheHitRate":0.82}]}{"stats":{"endpoint_id":"ep1","p50_latency":4200,"p75_latency":6000,"p90_latency":9500,"p50_throughput":80,"p90_throughput":24,"request_count":15000,"window_minutes":30}}`,
    };
  }) as any;

  const t1 = 1_800_000_000_000;
  const snap1 = await collectAndStore(fakeEnv, { fetchImpl: okFetch, nowMs: t1 });
  assert.equal(putCount, 1);
  assert.equal((snap1.models as any[]).length, 5);
  assert.equal(comparisonFetches, 25); // 5 models × 5 comparison endpoints

  // 3) Tick 5m later reuses 7d series (0 comparison fetches) and appends second 5m intraday point
  const snap2 = await collectAndStore(fakeEnv, { fetchImpl: okFetch, nowMs: t1 + 5 * 60_000 });
  assert.equal(putCount, 2);
  assert.equal(comparisonFetches, 25); // reused!
  assert.equal((snap2.models as any[])[0].series.intraday30m.length, 2);

  // 4) Subsequent blocked tick preserves existing KV snapshot without overwriting
  const snap3 = await collectAndStore(fakeEnv, { fetchImpl: blockedFetch, nowMs: t1 + 10 * 60_000 });
  assert.equal(putCount, 2);
  assert.equal(snap3.fetchedAtMs, t1 + 5 * 60_000);
});
