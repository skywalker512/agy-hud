import assert from 'node:assert/strict';
import test from 'node:test';

import { computeActivityInsights } from '../src/utils/activityStats.ts';

test('computeActivityInsights calculates streak, peak day, cache rate, and Ultra persona accurately', () => {
  const days = [
    { date: '2026-11-18', calls: 12, appCalls: 10, cliCalls: 2, costUSD: 25, outputTokens: 1_200_000, newTokens: 5_000_000, cachedTokens: 45_000_000 },
    { date: '2026-11-19', calls: 0, appCalls: 0, cliCalls: 0, costUSD: 0, outputTokens: 0, newTokens: 0, cachedTokens: 0 },
    { date: '2026-11-20', calls: 24, appCalls: 20, cliCalls: 4, costUSD: 72.5, outputTokens: 3_000_000, newTokens: 12_000_000, cachedTokens: 110_000_000 },
    { date: '2026-11-21', calls: 15, appCalls: 12, cliCalls: 3, costUSD: 30, outputTokens: 1_500_000, newTokens: 6_000_000, cachedTokens: 54_000_000 },
    { date: '2026-11-22', calls: 18, appCalls: 14, cliCalls: 4, costUSD: 40, outputTokens: 2_000_000, newTokens: 8_000_000, cachedTokens: 72_000_000 },
  ];

  const ins = computeActivityInsights(days);
  assert.equal(ins.activeDays, 4);
  assert.equal(ins.currentStreak, 3);
  assert.equal(ins.longestStreak, 3);
  assert.equal(ins.peakDate, '2026-11-20');
  assert.equal(ins.peakCostUSD, 72.5);
  assert.equal(ins.totalCalls, 69);
  assert.ok(ins.cacheHitPct !== null && ins.cacheHitPct >= 89 && ins.cacheHitPct <= 91);
  assert.equal(ins.persona.id, 'ultra_titan');
});

test('computeActivityInsights classifies Cache Alchemist and CLI Speedrunner personas', () => {
  const cacheDays = [
    { date: '2026-11-20', calls: 20, appCalls: 20, cliCalls: 0, costUSD: 15, outputTokens: 500_000, newTokens: 2_000_000, cachedTokens: 30_000_000 },
    { date: '2026-11-21', calls: 20, appCalls: 20, cliCalls: 0, costUSD: 15, outputTokens: 500_000, newTokens: 2_000_000, cachedTokens: 30_000_000 },
  ];
  assert.equal(computeActivityInsights(cacheDays).persona.id, 'cache_alchemist');

  const cliDays = [
    { date: '2026-11-19', calls: 10, appCalls: 2, cliCalls: 8, costUSD: 5, outputTokens: 100_000, newTokens: 500_000, cachedTokens: 1_000_000 },
    { date: '2026-11-20', calls: 10, appCalls: 2, cliCalls: 8, costUSD: 5, outputTokens: 100_000, newTokens: 500_000, cachedTokens: 1_000_000 },
    { date: '2026-11-21', calls: 10, appCalls: 2, cliCalls: 8, costUSD: 5, outputTokens: 100_000, newTokens: 500_000, cachedTokens: 1_000_000 },
  ];
  assert.equal(computeActivityInsights(cliDays).persona.id, 'cli_phantom');
});
