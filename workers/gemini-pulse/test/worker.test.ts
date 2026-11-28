import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { classifyInstallerRoute, collectAndStore } from '../src/index.ts';

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

test('h.512.pub short-link serves install.sh to curl, install.ps1 to PowerShell, and redirects browsers to agy-hud.512.pub', async () => {
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://h.512.pub/'), 'curl/8.7.1'),
    { kind: 'script', script: 'sh', uaDependent: true },
  );
  assert.deepEqual(
    classifyInstallerRoute(
      new URL('https://h.512.pub/'),
      'Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.2506',
    ),
    { kind: 'script', script: 'ps1', uaDependent: true },
  );
  assert.deepEqual(
    classifyInstallerRoute(
      new URL('https://h.512.pub/'),
      'Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; en-US) PowerShell/7.4.6',
    ),
    { kind: 'script', script: 'ps1', uaDependent: true },
  );
  assert.deepEqual(
    classifyInstallerRoute(
      new URL('https://h.512.pub/'),
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    ),
    { kind: 'redirect', location: 'https://agy-hud.512.pub/', uaDependent: true },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://h.512.pub/pulse/'), 'Mozilla/5.0 Chrome/131.0'),
    { kind: 'redirect', location: 'https://agy-hud.512.pub/pulse/', uaDependent: false },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://agy-hud.512.pub/install.sh'), 'Mozilla/5.0 Chrome/131.0'),
    { kind: 'script', script: 'sh', uaDependent: false },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://agy-hud.512.pub/'), 'curl/8.7.1'),
    { kind: 'passthrough' },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://h.512.pub/agent'), 'Mozilla/5.0 Chrome/131.0'),
    { kind: 'doc', doc: 'agents' },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://h.512.pub/AGENTS.md'), 'curl/8.7.1'),
    { kind: 'doc', doc: 'agents' },
  );
  assert.deepEqual(
    classifyInstallerRoute(new URL('https://agy-hud.512.pub/llms.txt'), 'Claude-User'),
    { kind: 'doc', doc: 'agents' },
  );

  const fakeEnv = {
    GEMINI_PULSE_KV: {} as any,
    ASSETS: {
      fetch: async (req: Request) => {
        const p = new URL(req.url).pathname;
        if (p === '/install.sh') return new Response('#!/bin/sh\necho ok\n', { status: 200 });
        if (p === '/install.ps1') return new Response('Write-Host "ok"\n', { status: 200 });
        if (p === '/AGENTS.md') return new Response('# AGY-HUD — AI Agent Guide\n', { status: 200 });
        return new Response('<html>site</html>', { status: 200 });
      },
    } as any,
  };
  const fakeCtx = { waitUntil: () => {} } as any;

  // curl -> 200 install.sh with Vary: User-Agent & no-store
  const curlRes = await worker.fetch(
    new Request('https://h.512.pub/', { headers: { 'User-Agent': 'curl/8.7.1' } }),
    fakeEnv,
    fakeCtx,
  );
  assert.equal(curlRes.status, 200);
  assert.equal(curlRes.headers.get('Vary'), 'User-Agent');
  assert.equal(curlRes.headers.get('Cache-Control'), 'no-store');
  assert.match(await curlRes.text(), /^#!\/bin\/sh/);

  // PowerShell -> 200 install.ps1
  const psRes = await worker.fetch(
    new Request('https://h.512.pub/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT; Windows NT 10.0) WindowsPowerShell/5.1.22621' },
    }),
    fakeEnv,
    fakeCtx,
  );
  assert.equal(psRes.status, 200);
  assert.equal(psRes.headers.get('Vary'), 'User-Agent');
  assert.match(await psRes.text(), /Write-Host/);

  // Browser -> 302 redirect to https://agy-hud.512.pub/
  const browserRes = await worker.fetch(
    new Request('https://h.512.pub/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1.15' },
    }),
    fakeEnv,
    fakeCtx,
  );
  assert.equal(browserRes.status, 302);
  assert.equal(browserRes.headers.get('Location'), 'https://agy-hud.512.pub/');
  assert.equal(browserRes.headers.get('Vary'), 'User-Agent');

  // Explicit /sh on browser still returns install.sh (inspectable in browser)
  const inspectRes = await worker.fetch(
    new Request('https://h.512.pub/sh', {
      headers: { 'User-Agent': 'Mozilla/5.0 Safari/605.1.15' },
    }),
    fakeEnv,
    fakeCtx,
  );
  assert.equal(inspectRes.status, 200);
  assert.equal(inspectRes.headers.get('Cache-Control'), 'public, max-age=300');
  assert.match(await inspectRes.text(), /^#!\/bin\/sh/);

  // /agent serves AGENTS.md directly as text/markdown regardless of UA
  const agentRes = await worker.fetch(
    new Request('https://h.512.pub/agent', {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131.0' },
    }),
    fakeEnv,
    fakeCtx,
  );
  assert.equal(agentRes.status, 200);
  assert.equal(agentRes.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.match(await agentRes.text(), /^# AGY-HUD — AI Agent Guide/);
});
