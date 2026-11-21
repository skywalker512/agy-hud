import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceRangeOnDataUpdate,
  buildMonotonePath,
  centerViewRangeAt,
  clampViewRange,
  computeEma,
  computeRangeForPreset,
  computeViewportStats,
  computeXLayout,
  computeYAxisCeiling,
  findNearestIndex,
  formatTimeAxisLabel,
  formatYTick,
  getDefaultPreset,
  locateCompactionMarkers,
  locateMinimapCompactionFractions,
  niceMax,
  panViewRange,
  percentile,
  zoomViewRange,
} from '../../../../web/src/components/calls/trendMath.ts';
import type { Compaction, Invocation } from '../../../../web/src/types/telemetry.ts';

function makeInv(overrides: Partial<Invocation> = {}): Invocation {
  const idx = overrides.idx ?? 0;
  return {
    idx,
    stepIdx: idx * 2,
    turnIndex: Math.floor(idx / 3) + 1,
    lastStepIndex: idx * 2 + 1,
    botId: `bot-${idx}`,
    modelEnum: null,
    model: 'gemini-4-carbon',
    modelId: 'gemini-4-carbon',
    modelDisplay: 'Gemini 4 Carbon',
    parentCascadeId: '',
    subagentType: '',
    newInput: 1000,
    cachedInput: 9000,
    totalPromptTokens: 10000,
    cacheHitPct: 90,
    outputTokens: 500,
    thinkingTokens: 200,
    candidateTokens: 300,
    ttftSec: 1.5,
    genSec: 6.25,
    totalSec: 7.75,
    isBuffered: false,
    genTps: 80,
    e2eTps: 64.5,
    totalContext: 10000 + idx * 1500,
    contextLimit: 256000,
    contextPct: ((10000 + idx * 1500) / 256000) * 100,
    timestampMs: 1_750_000_000_000 + idx * 15_000,
    priced: true,
    pricingKey: 'gemini-4-carbon',
    costUSD: 0.02,
    cacheSavedUSD: 0.05,
    quotaPool: 'gemini',
    quotaPct5h: 0.08,
    quotaPct7d: 0.01,
    quotaMultiplierK: 1.0,
    quotaFitSource: 'fitted',
    thinkSec: 2.5,
    toolGenSec: 0,
    stepToolCount: 0,
    isToolStall: false,
    ...overrides,
  };
}

function makeCompaction(overrides: Partial<Compaction> = {}): Compaction {
  return {
    stepIdx: 10,
    turnIndex: 4,
    afterGmIdx: 5,
    timestampMs: 1_750_000_000_000 + 4.5 * 15_000,
    durationSec: 4.2,
    model: 'gemini-4-carbon',
    modelId: 'gemini-4-carbon',
    modelDisplay: 'Gemini 4 Carbon',
    cachedInput: 10000,
    newInput: 500,
    outputTokens: 400,
    thinkingTokens: 0,
    candidateTokens: 400,
    beforeCtx: 180000,
    afterCtx: 42000,
    ...overrides,
  };
}

test('niceMax rounds cleanly to 1 / 2 / 2.5 / 5 / 10 * 10^k ladder with headroom', () => {
  assert.equal(niceMax(84, 10), 100);
  assert.equal(niceMax(42, 10), 50);
  assert.equal(niceMax(21, 10), 25);
  assert.equal(niceMax(15, 10), 20);
  assert.equal(niceMax(0.04, 0.02), 0.05);
  assert.equal(niceMax(0, 10), 10);
  assert.equal(niceMax(Number.NaN, 5), 5);
});

test('formatYTick formats all 6 metrics cleanly', () => {
  assert.equal(formatYTick(100, 'cache'), '100%');
  assert.equal(formatYTick(50, 'ctx'), '50%');
  assert.equal(formatYTick(0, 'ttft'), '0s');
  assert.equal(formatYTick(2.5, 'ttft'), '2.5s');
  assert.equal(formatYTick(12, 'ttft'), '12s');
  assert.equal(formatYTick(1500, 'out'), '1.5k');
  assert.equal(formatYTick(2000, 'out'), '2k');
  assert.equal(formatYTick(0.05, 'quota'), '0.05%');
  assert.equal(formatYTick(0.005, 'quota'), '0.005%');
  assert.equal(formatYTick(120, 'tps'), '120');
});

test('percentile and computeEma handle edge cases and compute accurate values', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([42], 0.95), 42);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
  const p95 = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, Number.NaN], 0.95);
  assert.ok(p95 !== null && Math.abs(p95 - 9.55) < 1e-9);

  assert.deepEqual(computeEma([], 5), []);
  assert.deepEqual(computeEma([50], 5), [50]);
  const ema = computeEma([60, 60, 90, 90, 90, 90], 5);
  assert.equal(ema.length, 6);
  assert.equal(ema[0], 60);
  assert.ok(Math.abs(ema[1] - 60) < 1e-9);
  assert.ok(ema[2] > 69 && ema[2] < 71);
  assert.ok(ema[5] > ema[2] && ema[5] < 90);
});

test('buildMonotonePath clamps control points within [minY, maxY]', () => {
  assert.equal(buildMonotonePath([], 10, 100), '');
  assert.equal(buildMonotonePath([{ x: 10, y: 50 }], 10, 100), '');
  assert.equal(buildMonotonePath([{ x: 10, y: 50 }, { x: 40, y: 20 }], 10, 100), 'M 10.0 50.0 L 40.0 20.0');

  const path = buildMonotonePath(
    [
      { x: 0, y: 90 },
      { x: 20, y: 12 },
      { x: 40, y: 95 },
      { x: 60, y: 15 },
    ],
    10,
    100,
  );
  assert.ok(path.startsWith('M 0.0 90.0 C '));
  assert.ok(path.includes('60.0 15.0'));
});

test('viewport preset, clamping, zoom, pan, and followLive state machine work deterministically', () => {
  assert.equal(getDefaultPreset(30), 'all');
  assert.equal(getDefaultPreset(80), '50');
  assert.equal(getDefaultPreset(80, '20'), '20');

  assert.deepEqual(computeRangeForPreset(100, '20'), { start: 80, end: 99 });
  assert.deepEqual(computeRangeForPreset(100, 'all'), { start: 0, end: 99 });
  assert.deepEqual(computeRangeForPreset(12, '50'), { start: 0, end: 11 });

  // Clamp enforces minSpan = 4 when total >= 4
  const clamped = clampViewRange({ start: 10, end: 11 }, 50);
  assert.equal(clamped.end - clamped.start + 1, 4);

  // Follow Live = true advances with streaming calls
  assert.deepEqual(
    advanceRangeOnDataUpdate({ start: 30, end: 79 }, 80, 84, true, '50'),
    { start: 34, end: 83 },
  );
  assert.deepEqual(
    advanceRangeOnDataUpdate({ start: 0, end: 79 }, 80, 84, true, 'all'),
    { start: 0, end: 83 },
  );

  // Follow Live = false NEVER yanks the user's historical inspection window
  assert.deepEqual(
    advanceRangeOnDataUpdate({ start: 10, end: 29 }, 80, 95, false, 'custom'),
    { start: 10, end: 29 },
  );

  // Zoom in 2x from [0..99] anchored at midpoint -> span ~50, paused
  const zoomedIn = zoomViewRange({ start: 0, end: 99 }, 100, 0.5, 0.5, true);
  assert.equal(zoomedIn.range.end - zoomedIn.range.start + 1, 50);
  assert.equal(zoomedIn.followLive, false);
  assert.equal(zoomedIn.preset, 'custom');

  // Zoom all the way out -> restores all + followLive
  const zoomedOut = zoomViewRange(zoomedIn.range, 100, 3, 0.5, false);
  assert.deepEqual(zoomedOut.range, { start: 0, end: 99 });
  assert.equal(zoomedOut.followLive, true);
  assert.equal(zoomedOut.preset, 'all');

  // Pan to right edge re-enables followLive
  const pannedLeft = panViewRange({ start: 50, end: 99 }, 100, -20);
  assert.deepEqual(pannedLeft.range, { start: 30, end: 79 });
  assert.equal(pannedLeft.followLive, false);

  const pannedRight = panViewRange(pannedLeft.range, 100, 40);
  assert.deepEqual(pannedRight.range, { start: 50, end: 99 });
  assert.equal(pannedRight.followLive, true);

  // Center on minimap track click
  const centered = centerViewRangeAt({ start: 60, end: 79 }, 100, 15);
  assert.equal(centered.range.end - centered.range.start + 1, 20);
  assert.ok(centered.range.start <= 15 && centered.range.end >= 15);
  assert.equal(centered.followLive, false);
});

test('computeXLayout supports uniform #Seq and proportional Time modes with neighbor-clamped barW', () => {
  const invs = [
    makeInv({ idx: 0, timestampMs: 1_750_000_000_000 }),
    makeInv({ idx: 1, timestampMs: 1_750_000_010_000 }), // +10s
    makeInv({ idx: 2, timestampMs: 1_750_000_100_000 }), // +90s gap
  ];

  const seq = computeXLayout(invs, 'seq', 30, 300);
  assert.equal(seq.useTimeMode, false);
  assert.equal(seq.xs.length, 3);
  assert.ok(Math.abs((seq.xs[1] - seq.xs[0]) - (seq.xs[2] - seq.xs[1])) < 0.01);

  const timed = computeXLayout(invs, 'time', 30, 300);
  assert.equal(timed.useTimeMode, true);
  assert.ok((timed.xs[2] - timed.xs[1]) > (timed.xs[1] - timed.xs[0]) * 5);
  assert.ok(timed.barW >= 2.5 && timed.barW <= 20);

  assert.equal(findNearestIndex(timed.xs, timed.xs[1] + 2), 1);
  assert.equal(findNearestIndex(timed.xs, timed.xs[2] - 1), 2);
  assert.match(formatTimeAxisLabel(1_750_000_000_000, 120_000), /^\d{2}:\d{2}:\d{2}$/);
  assert.match(formatTimeAxisLabel(1_750_000_000_000, 900_000), /^\d{2}:\d{2}$/);
});

test('locateCompactionMarkers places markers across metrics and minimap fractions', () => {
  const invs = Array.from({ length: 10 }, (_, i) => makeInv({ idx: i }));
  const cmp = makeCompaction({ afterGmIdx: 5 });
  const layout = computeXLayout(invs, 'seq', 20, 200);
  const markers = locateCompactionMarkers(invs, [cmp], layout.xs, false);
  assert.equal(markers.length, 1);
  assert.ok(markers[0].x > layout.xs[4] && markers[0].x < layout.xs[5]);

  const fracs = locateMinimapCompactionFractions(invs, [cmp]);
  assert.equal(fracs.length, 1);
  assert.ok(fracs[0] > 0.4 && fracs[0] < 0.6);
});

test('computeViewportStats computes metric-specific distribution stats accurately', () => {
  const invs = [
    makeInv({ idx: 0, genTps: 60, e2eTps: 50, ttftSec: 1.0, outputTokens: 400, thinkingTokens: 100, cacheHitPct: 95, contextPct: 20, quotaPct5h: 0.05 }),
    makeInv({ idx: 1, genTps: 80, e2eTps: 70, ttftSec: 2.0, outputTokens: 600, thinkingTokens: 300, cacheHitPct: 85, contextPct: 35, quotaPct5h: 0.10 }),
    makeInv({ idx: 2, genTps: 100, e2eTps: 90, ttftSec: 4.0, outputTokens: 1000, thinkingTokens: 600, cacheHitPct: 35, contextPct: 50, quotaPct5h: 0.15 }),
    makeInv({ idx: 3, isBuffered: true, genTps: 0, e2eTps: 20, ttftSec: 12.0, outputTokens: 200, thinkingTokens: 0, cacheHitPct: null, contextPct: 62, quotaPct5h: 0.20 }),
  ];

  // TPS: sustained avg excludes BUF call (#3), latest uses e2eTps (20) with latestIsBuffered=true
  const tps = computeViewportStats(invs, 'tps');
  assert.equal(tps.avg, 80);
  assert.equal(tps.p50, 80);
  assert.equal(tps.max, 100);
  assert.equal(tps.latest, 20);
  assert.equal(tps.latestIsBuffered, true);

  // TTFT: P95 & max
  const ttft = computeViewportStats(invs, 'ttft');
  assert.equal(ttft.max, 12.0);
  assert.ok((ttft.p95 ?? 0) > 10);

  // OUT: sum & thinkSharePct (1000 / 2200)
  const out = computeViewportStats(invs, 'out');
  assert.equal(out.sum, 2200);
  assert.ok(Math.abs((out.thinkSharePct ?? 0) - (1000 / 2200) * 100) < 0.01);

  // CACHE: valid count = 3 (ignores null), highCacheCount = 2 (>=80%), min = 35
  const cache = computeViewportStats(invs, 'cache');
  assert.equal(cache.validCacheCount, 3);
  assert.equal(cache.highCacheCount, 2);
  assert.equal(cache.min, 35);
  assert.equal(cache.latest, null);

  // CTX: ceiling fixed to 100, compacts counted
  assert.equal(computeYAxisCeiling(invs, 'ctx'), 100);
  assert.equal(computeYAxisCeiling(invs, 'cache'), 100);
  const ctx = computeViewportStats(invs, 'ctx', [makeCompaction({ afterGmIdx: 2 })]);
  assert.equal(ctx.compactsInView, 1);
  assert.equal(ctx.max, 62);
  assert.ok(ctx.headroomTurns !== null && ctx.headroomTurns > 0);

  // QUOTA: sum = 0.50, peak = 0.20
  const quota = computeViewportStats(invs, 'quota');
  assert.ok(Math.abs(quota.sum - 0.5) < 1e-9);
  assert.equal(quota.max, 0.2);
});
