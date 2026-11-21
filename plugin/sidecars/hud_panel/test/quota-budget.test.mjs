import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  buildAccountHistory,
} from '../server.mjs';

test('attachQuotaBudgetEstimates supports low-sample cold start, Bayesian prior smoothing across resets, and unpriced pollution guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-quota-cal-'));
  const calPath = join(dir, 'quota-calibration.json');
  try {
    const nowMs = 1_800_000_000_000;
    const reset1 = nowMs + 4 * 3_600_000;
    const baseQuota = (remainingPct, resetAtMs) => ({
      available: true,
      planName: 'Pro',
      tierName: 'Pro',
      teamsTier: 'PRO',
      pools: [
        {
          label: 'Claude & GPT',
          remainingPct,
          resetAtMs,
          windows: [{ spanKey: '5h', label: '5h', remainingPct, resetTime: '', resetAtMs }],
        },
      ],
    });

    // 1. Cold start at 0.9% used with fractional remainingPct -> immediate low-sample estimate ($20)
    const coldRes = attachQuotaBudgetEstimates(
      baseQuota(99.1, reset1),
      {
        summaries: [{
          latestTsMs: nowMs,
          recentCalls: [{ ts: nowMs - 60_000, poolKey: 'claude_gpt', costUSD: 0.18, priced: true }],
        }],
      },
      { calibrationPath: calPath, nowMs },
    );
    const coldWin = coldRes.pools[0].windows[0];
    assert.ok(Math.abs(coldWin.estFullUSD - 20) < 1e-6);
    assert.equal(coldWin.estConfidence, 'low');

    // 2. High-sample calibration (20% used, $4.40 spent -> $22 cap persisted)
    const highRes = attachQuotaBudgetEstimates(
      baseQuota(80, reset1),
      {
        summaries: [{
          latestTsMs: nowMs,
          recentCalls: [{ ts: nowMs - 60_000, poolKey: 'claude_gpt', costUSD: 4.4, priced: true }],
        }],
      },
      { calibrationPath: calPath, nowMs },
    );
    const highWin = highRes.pools[0].windows[0];
    assert.ok(Math.abs(highWin.estFullUSD - 22) < 1e-6);
    assert.equal(highWin.estConfidence, 'high');

    // 3. New reset window at 0.2% used ($0.04 spent) -> Bayesian blend with prior $22 -> ~$21.82 immediately
    const reset2 = reset1 + 5 * 3_600_000;
    const nextWinNow = reset1 + 120_000;
    const priorRes = attachQuotaBudgetEstimates(
      baseQuota(99.8, reset2),
      {
        summaries: [{
          latestTsMs: nextWinNow,
          recentCalls: [{ ts: nextWinNow - 30_000, poolKey: 'claude_gpt', costUSD: 0.04, priced: true }],
        }],
      },
      { calibrationPath: calPath, nowMs: nextWinNow },
    );
    const priorWin = priorRes.pools[0].windows[0];
    assert.equal(priorWin.estConfidence, 'prior');
    assert.ok(Math.abs(priorWin.estFullUSD - (0.02 * 22 + 0.04) / (0.02 + 0.002)) < 1e-4);

    // 4. Unpriced-dominated window must NOT pollute stored calibration ($22 remains intact)
    const pollNow = nextWinNow + 60_000;
    attachQuotaBudgetEstimates(
      baseQuota(90, reset2),
      {
        summaries: [{
          latestTsMs: pollNow,
          recentCalls: [
            { ts: pollNow - 20_000, poolKey: 'claude_gpt', costUSD: 0.5, priced: true },
            { ts: pollNow - 15_000, poolKey: 'claude_gpt', costUSD: 0, priced: false },
            { ts: pollNow - 10_000, poolKey: 'claude_gpt', costUSD: 0, priced: false },
          ],
        }],
      },
      { calibrationPath: calPath, nowMs: pollNow },
    );
    const saved = JSON.parse(readFileSync(calPath, 'utf-8'));
    assert.equal(saved.version, 2);
    const savedEntry = Object.values(saved.entries)[0];
    assert.ok(savedEntry);
    assert.ok(Math.abs(savedEntry.fullUSD - 22) < 1e-6);

    // 5. Timestamp alignment: local spend occurring AFTER quota.fetchedAtMs must NOT inflate fullUSD
    const snapTime = nextWinNow + 120_000;
    const afterSnapNow = snapTime + 180_000;
    const alignedRes = attachQuotaBudgetEstimates(
      { ...baseQuota(80, reset2), fetchedAtMs: snapTime }, // 20% used at snapTime -> $4.40 local
      {
        summaries: [{
          latestTsMs: afterSnapNow,
          recentCalls: [
            { ts: snapTime - 10_000, poolKey: 'claude_gpt', costUSD: 4.4, priced: true },
            { ts: snapTime + 30_000, poolKey: 'claude_gpt', costUSD: 2.0, priced: true }, // post-snapshot local work
          ],
        }],
      },
      { calibrationPath: calPath, nowMs: afterSnapNow },
    );
    const alignedWin = alignedRes.pools[0].windows[0];
    assert.ok(Math.abs(alignedWin.estSpentUSD - 6.4) < 1e-6);
    assert.ok(Math.abs(alignedWin.estFullUSD - 22) < 0.5);
    assert.equal(alignedWin.estRemoteUSD, 0);

    // 6. Remote Agent consumption in a new window must NOT pollute fullUSD and must surface as estRemoteUSD
    const reset3 = reset2 + 5 * 3_600_000;
    const remoteNow = reset3 - 3 * 3_600_000;
    const remoteRes = attachQuotaBudgetEstimates(
      { ...baseQuota(50, reset3), fetchedAtMs: remoteNow }, // 50% used ($11 of $22), only $1 local -> ~$10 remote!
      {
        summaries: [{
          latestTsMs: remoteNow,
          recentCalls: [
            { ts: remoteNow - 60_000, poolKey: 'claude_gpt', costUSD: 1.0, priced: true },
          ],
        }],
      },
      { calibrationPath: calPath, nowMs: remoteNow },
    );
    const remoteWin = remoteRes.pools[0].windows[0];
    assert.ok(Math.abs(remoteWin.estFullUSD - 22) < 0.5);
    assert.ok(Math.abs(remoteWin.estRemoteUSD - 10) < 0.5);
    assert.ok(Math.abs(remoteRes.remoteEstimate.activeWindowUSD - 10) < 0.5);
    const savedAfterRemote = JSON.parse(readFileSync(calPath, 'utf-8'));
    const entryAfterRemote = Object.values(savedAfterRemote.entries)[0];
    assert.ok(Math.abs(entryAfterRemote.fullUSD - 22) < 0.5);

    // 7. Subsequent clean local work in the same remote-contaminated window still works cleanly without corrupting fullUSD
    const localAfterRemote = remoteNow + 300_000;
    const cleanDeltaRes = attachQuotaBudgetEstimates(
      { ...baseQuota(30, reset3), fetchedAtMs: localAfterRemote }, // +20% used ($4.40 local delta)
      {
        summaries: [{
          latestTsMs: localAfterRemote,
          recentCalls: [
            { ts: remoteNow - 60_000, poolKey: 'claude_gpt', costUSD: 1.0, priced: true },
            { ts: localAfterRemote - 30_000, poolKey: 'claude_gpt', costUSD: 4.4, priced: true },
          ],
        }],
      },
      { calibrationPath: calPath, nowMs: localAfterRemote },
    );
    const cleanDeltaWin = cleanDeltaRes.pools[0].windows[0];
    assert.ok(Math.abs(cleanDeltaWin.estFullUSD - 22) < 0.5);
    assert.ok(Math.abs(cleanDeltaWin.estRemoteUSD - 10) < 0.5);

    // 8. graph.indexing === true must not write calibration entries
    const reset4 = reset3 + 5 * 3_600_000;
    const idxNow = reset4 - 2 * 3_600_000;
    attachQuotaBudgetEstimates(
      { ...baseQuota(60, reset4), fetchedAtMs: idxNow },
      {
        indexing: true,
        summaries: [{
          latestTsMs: idxNow,
          recentCalls: [{ ts: idxNow - 10_000, poolKey: 'claude_gpt', costUSD: 16.0, priced: true }],
        }],
      },
      { calibrationPath: calPath, nowMs: idxNow },
    );
    const savedWhileIndexing = JSON.parse(readFileSync(calPath, 'utf-8'));
    const entryAfterIdx = Object.values(savedWhileIndexing.entries)[0];
    assert.ok(Math.abs(entryAfterIdx.fullUSD - 22) < 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dailyHeatmap, Runway depletion forecasts, and per-conversation/turn quota proportions work end-to-end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-ux-enh-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    // 1) Daily spend heatmap (16-week Monday-aligned grid, App vs CLI split, streak & peak)
    const fixedNow = new Date(2026, 10, 17, 15, 0, 0).getTime(); // Tue 2026-11-17 local
    const mockGraph = {
      totalDbFiles: 2,
      sourceCounts: { app: 1, cli: 1, ide: 0 },
      indexing: false,
      summaries: [
        {
          id: 'aaaa1111-1111-1111-1111-111111111111',
          source: 'app',
          calls: 10,
          outputTokens: 20_000,
          costUSD: 5.5,
          savedUSD: 1.2,
          pricedCount: 10,
          unpricedCount: 0,
          dayBuckets: {
            '2026-11-16': { calls: 4, outputTokens: 8_000, costUSD: 2.0, savedUSD: 0.4 },
            '2026-11-17': { calls: 6, outputTokens: 12_000, costUSD: 3.5, savedUSD: 0.8 },
          },
          familyUsage: {
            'gemini-4-carbon': { poolKey: 'gemini', baseUSD: 1.5, inM: 0.3, caM: 1.0, outM: 0.08, calls: 10 },
          },
          recentCalls: [
            { ts: fixedNow - 1800_000, poolKey: 'gemini', family: 'gemini-4-carbon', baseUSD: 1.5, costUSD: 1.5, priced: true },
          ],
        },
        {
          id: 'bbbb2222-2222-2222-2222-222222222222',
          source: 'cli',
          calls: 5,
          outputTokens: 9_000,
          costUSD: 4.0,
          savedUSD: 0.5,
          pricedCount: 5,
          unpricedCount: 0,
          dayBuckets: {
            '2026-11-17': { calls: 5, outputTokens: 9_000, costUSD: 4.0, savedUSD: 0.5 },
          },
          familyUsage: {
            'claude-opus-5-5': { poolKey: 'claude_gpt', baseUSD: 0.8, inM: 0.05, caM: 0.2, outM: 0.02, calls: 5 },
          },
          recentCalls: [
            { ts: fixedNow - 900_000, poolKey: 'claude_gpt', family: 'claude-opus-5-5', baseUSD: 0.8, costUSD: 0.8, priced: true },
          ],
        },
      ],
      byId: new Map(),
    };
    for (const s of mockGraph.summaries) mockGraph.byId.set(s.id, s);

    const hist = buildAccountHistory(mockGraph, fixedNow);
    assert.ok(hist.dailyHeatmap);
    assert.equal(hist.dailyHeatmap.weeks, 16);
    assert.equal(hist.dailyHeatmap.activeDays, 2);
    assert.equal(hist.dailyHeatmap.streakDays, 2);
    assert.ok(Math.abs(hist.dailyHeatmap.peakCostUSD - 7.5) < 1e-6);
    assert.equal(hist.dailyHeatmap.peakDate, '2026-11-17');
    const lastDay = hist.dailyHeatmap.days[hist.dailyHeatmap.days.length - 1];
    assert.equal(lastDay.date, '2026-11-17');
    assert.equal(lastDay.appCalls, 6);
    assert.equal(lastDay.cliCalls, 5);
    // First day in grid must be a Monday (getDay() === 1)
    const [fy, fm, fd] = hist.dailyHeatmap.days[0].date.split('-').map(Number);
    assert.equal(new Date(fy, fm - 1, fd, 12, 0, 0).getDay(), 1);

    // 2) Runway forecast: warning when high burn hits 0% before reset vs safe when calm burn leaves headroom
    const reset5h = fixedNow + 3 * 3_600_000; // 2h elapsed, 3h remaining
    const reset7d = fixedNow + 5 * 24 * 3_600_000;
    const quotaWithRunway = attachQuotaBudgetEstimates(
      {
        available: true,
        planName: 'Pro',
        tierName: 'Pro',
        teamsTier: 'PRO',
        fetchedAtMs: fixedNow,
        pools: [
          {
            label: 'Gemini',
            remainingPct: 40, // 60% burned in 2h = 30%/hr -> hits 0% in 1.33h (< 3h reset)!
            resetAtMs: reset5h,
            windows: [
              { spanKey: '5h', label: '5h', remainingPct: 40, resetTime: '', resetAtMs: reset5h },
              { spanKey: '7d', label: '7d', remainingPct: 92, resetTime: '', resetAtMs: reset7d }, // 8% in 48h = 0.167%/hr -> safe!
            ],
          },
          {
            label: 'Claude & GPT',
            remainingPct: 80,
            heldByWeekly: true,
            resetAtMs: reset5h,
            windows: [
              { spanKey: '5h', label: '5h', remainingPct: 80, resetTime: '', resetAtMs: reset5h },
              { spanKey: '7d', label: '7d', remainingPct: 0, resetTime: '', resetAtMs: reset7d },
            ],
          },
        ],
      },
      mockGraph,
      { calibrationPath: calPath, fitPath, nowMs: fixedNow },
    );

    const gemW5 = quotaWithRunway.pools[0].windows[0];
    const gemW7 = quotaWithRunway.pools[0].windows[1];
    assert.ok(gemW5.runway);
    assert.equal(gemW5.runway.willExhaustBeforeReset, true);
    assert.equal(gemW5.runway.status, 'warning');
    assert.ok(gemW5.runway.exhaustAtMs > fixedNow && gemW5.runway.exhaustAtMs < reset5h);

    assert.ok(gemW7.runway);
    assert.equal(gemW7.runway.willExhaustBeforeReset, false);
    assert.equal(gemW7.runway.status, 'safe');
    assert.ok(gemW7.runway.projectedRemAtResetPct > 65);

    // Held-by-weekly suppresses misleading 5h safe badge while 7d reports 'exhausted'
    const claudeW5 = quotaWithRunway.pools[1].windows[0];
    const claudeW7 = quotaWithRunway.pools[1].windows[1];
    assert.equal(claudeW5.runway, undefined);
    assert.equal(claudeW7.runway.status, 'exhausted');

    // 3) Per-conversation, per-turn, and graph quota summaries (works even on cold fitStore via structural priors!)
    const coldFitPath = join(dir, 'nonexistent-fit.json');
    const tel = {
      summary: { count: 2, pricedCount: 2, totalCostUSD: 0.06, totalSavedUSD: 0.1 },
      turns: [{ turnIndex: 1, stepIdx: 0, timestampMs: fixedNow - 60_000, promptPreview: 'hi', callCount: 2, outputTokens: 3000, totalSec: 5 }],
      invocations: [
        {
          idx: 0,
          turnIndex: 1,
          timestampMs: fixedNow - 50_000,
          modelId: 'gemini-4-carbon',
          modelDisplay: 'Carbon',
          model: 'gemini-4-carbon',
          newInput: 10_000,
          cachedInput: 50_000,
          outputTokens: 2_000, // baseUSD = $0.045 -> Carbon 3x on $150 = 0.090%
        },
        {
          idx: 1,
          turnIndex: 1,
          timestampMs: fixedNow - 30_000,
          modelId: 'gemini-4-hydrogen',
          modelDisplay: 'Hydrogen',
          model: 'gemini-4-hydrogen',
          newInput: 10_000,
          cachedInput: 0,
          outputTokens: 2_000, // baseUSD = (15 + 15)/1000 = $0.030 -> Hydrogen 1x on $150 = 0.020%
        },
      ],
      compactions: [],
    };
    const decTel = attachTelemetryQuotaPredictions(tel, quotaWithRunway, { fitPath: coldFitPath, nowMs: fixedNow });
    assert.equal(decTel.invocations[0].quotaFitSource, 'prior');
    assert.ok(Math.abs(decTel.invocations[0].quotaPct5h - 0.09) < 1e-5);
    assert.ok(Math.abs(decTel.invocations[1].quotaPct5h - 0.02) < 1e-5);
    assert.ok(Math.abs(decTel.turns[0].quotaPct5h - 0.11) < 1e-5);
    assert.ok(decTel.summary.sessionQuota.gemini);
    assert.ok(Math.abs(decTel.summary.sessionQuota.gemini.pct5h - 0.11) < 1e-5);
    assert.ok(Math.abs(decTel.summary.sessionQuota.gemini.active5hPct - 0.11) < 1e-5);

    const enriched = attachGraphQuotaSummaries({
      conversations: [{ id: mockGraph.summaries[0].id, title: 'App conv' }],
      sessionInfo: {
        id: mockGraph.summaries[0].id,
        title: 'App conv',
        kind: 'main',
        subagentType: '',
        parentSession: null,
        childSessions: [{ id: mockGraph.summaries[1].id, title: 'CLI sub', kind: 'subagent' }],
      },
      graph: mockGraph,
      accountQuota: quotaWithRunway,
      opts: { fitPath: coldFitPath, nowMs: fixedNow },
    });
    // $1.50 baseUSD of Carbon (3x on $150) = 3.00%
    assert.ok(Math.abs(enriched.conversations[0].quotaUsage.gemini.pct5h - 3.0) < 1e-5);
    assert.ok(enriched.sessionInfo.childSessions[0].quotaUsage.claude_gpt.pct5h > 5.0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
