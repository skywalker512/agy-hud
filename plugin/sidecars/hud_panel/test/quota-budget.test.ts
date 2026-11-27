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
} from '../server.ts';

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
    const savedEntry: any = Object.values(saved.entries)[0];
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
    const entryAfterRemote: any = Object.values(savedAfterRemote.entries)[0];
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
    const entryAfterIdx: any = Object.values(savedWhileIndexing.entries)[0];
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

test('computeWindowRunway applies Historical Rhythm Bayesian Shrinkage on early bursts, falls back on cold start, and converges late-cycle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-runway-habit-'));
  try {
    // Fixed local anchor: Tue 2026-11-17 16:00:00
    const fixedNow = new Date(2026, 10, 17, 16, 0, 0).getTime();
    const DAY_MS = 86_400_000;
    const HR_MS = 3_600_000;

    // Helper: build N prior days of Gemini 4 Hydrogen calls before a cutoff day.
    // Gemini prior cap: $150 (5h) / $600 (7d) -> baseUSD $15 = 10% (5h) / 2.5% (7d); baseUSD $9 = 6% (5h) / 1.5% (7d).
    const makePriorHistory = (daysBackStart: number, daysBackEnd: number, hoursPerDay: number, baseUsdPerHour: number) => {
      const calls: any[] = [];
      for (let d = daysBackStart; d >= daysBackEnd; d--) {
        const dayNoon = new Date(2026, 10, 17 - d, 10, 15, 0).getTime();
        for (let h = 0; h < hoursPerDay; h++) {
          calls.push({
            ts: dayNoon + h * HR_MS,
            poolKey: 'gemini',
            family: 'gemini-4-hydrogen',
            baseUSD: baseUsdPerHour,
            costUSD: baseUsdPerHour,
            priced: true,
          });
        }
      }
      return calls;
    };

    const runRunway = (
      label: string,
      {
        rem5h,
        elapsed5hHr,
        rem7d,
        elapsed7dHr,
        calls,
      }: {
        rem5h: number;
        elapsed5hHr: number;
        rem7d: number;
        elapsed7dHr: number;
        calls: any[];
      },
    ) => {
      const calPath = join(dir, `${label}-cal.json`);
      const fitPath = join(dir, `${label}-fit.json`);
      const reset5h = fixedNow + (5 - elapsed5hHr) * HR_MS;
      const reset7d = fixedNow + (168 - elapsed7dHr) * HR_MS;
      const graph = {
        indexing: false,
        summaries: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            source: 'app',
            latestTsMs: fixedNow,
            recentCalls: calls,
          },
        ],
      };
      const out = attachQuotaBudgetEstimates(
        {
          available: true,
          planName: 'Ultra',
          tierName: 'Ultra',
          teamsTier: 'ULTRA',
          fetchedAtMs: fixedNow,
          pools: [
            {
              label: 'Gemini',
              remainingPct: rem5h,
              resetAtMs: reset5h,
              windows: [
                { spanKey: '5h', label: '5h', remainingPct: rem5h, resetTime: '', resetAtMs: reset5h },
                { spanKey: '7d', label: '7d', remainingPct: rem7d, resetTime: '', resetAtMs: reset7d },
              ],
            },
          ],
        },
        graph,
        { calibrationPath: calPath, fitPath, nowMs: fixedNow },
      );
      return {
        w5: out.pools[0].windows[0].runway,
        w7: out.pools[0].windows[1].runway,
      };
    };

    // 1) Cold-start fallback: only 1 prior active day -> no habit blending, legacy formula untouched
    const oneDayCalls = [
      ...makePriorHistory(1, 1, 4, 9),
      {
        ts: fixedNow - 10 * 60_000,
        poolKey: 'gemini',
        family: 'gemini-4-hydrogen',
        baseUSD: 22.5, // 15% of 5h, 3.75% of 7d
        costUSD: 22.5,
        priced: true,
      },
    ];
    const cold = runRunway('cold', {
      rem5h: 85, // 15% burned in 0.25h -> legacy curRate = 60%/hr
      elapsed5hHr: 0.25,
      rem7d: 88, // 12% burned in 2h -> legacy curRate = 2.4%/hr -> warning
      elapsed7dHr: 2,
      calls: oneDayCalls,
    });
    assert.ok(cold.w5);
    assert.equal(cold.w5.habitBlended, undefined);
    assert.equal(cold.w5.habitWeight, undefined);
    assert.ok(Math.abs(cold.w5.burnPctPerHour - 60) < 0.1);
    assert.ok(cold.w7);
    assert.equal(cold.w7.habitBlended, undefined);
    assert.equal(cold.w7.status, 'warning');

    // 2) Early-cycle burst smoothing (both 5h and 7d):
    // 10 prior days (days -10 .. -1), 4 active hrs/day, $9/hr Hydrogen = 6%/active-hr (5h) and 1.5%/active-hr (7d)
    // -> 7d daily pace = 6%/day = 0.25%/hr calendar avg; 5h active-hr pace = 6%/hr.
    const steadyHist = makePriorHistory(10, 1, 4, 9);
    const early5h = runRunway('early-5h', {
      rem5h: 85, // 15% in 0.25h -> curRate = 60%/hr; wCur = 0.25/1.25 = 0.2, habitWeight = 0.8
      elapsed5hHr: 0.25,
      rem7d: 96,
      elapsed7dHr: 2,
      calls: [
        ...steadyHist,
        {
          ts: fixedNow - 10 * 60_000,
          poolKey: 'gemini',
          family: 'gemini-4-hydrogen',
          baseUSD: 22.5, // 15% of 5h inside current 5h window
          costUSD: 22.5,
          priced: true,
        },
      ],
    });

    // 5h check: 0.2 * 60 + 0.8 * 6 = 16.8%/hr (damped dramatically from 60%/hr!)
    assert.ok(early5h.w5);
    assert.equal(early5h.w5.habitBlended, true);
    assert.ok(Math.abs(early5h.w5.habitWeight - 0.8) < 1e-4);
    assert.ok(Math.abs(early5h.w5.histBurnPctPerHour - 6.0) < 0.05);
    assert.equal(early5h.w5.activeHoursPerDay, 4);
    assert.ok(Math.abs(early5h.w5.burnPctPerHour - 16.8) < 0.15, `expected ~16.8%/hr, got ${early5h.w5.burnPctPerHour}`);

    const early7d = runRunway('early-7d', {
      rem5h: 52,
      elapsed5hHr: 2,
      rem7d: 88, // 12% in 2h -> curRate = 2.4%/hr; wCur = 2/26, habitWeight = 24/26
      elapsed7dHr: 2,
      calls: [
        ...steadyHist,
        {
          ts: fixedNow - 90 * 60_000,
          poolKey: 'gemini',
          family: 'gemini-4-hydrogen',
          baseUSD: 49.5,
          costUSD: 49.5,
          priced: true,
        },
        {
          ts: fixedNow - 10 * 60_000,
          poolKey: 'gemini',
          family: 'gemini-4-hydrogen',
          baseUSD: 22.5, // + 49.5 = $72 = 12% of 7d in first 2h
          costUSD: 22.5,
          priced: true,
        },
      ],
    });

    // 7d check: calendar pace (~0.236%/hr over ~10.6d span) pulls 2.4%/hr down to ~0.40%/hr -> SAFE instead of false alarm!
    assert.ok(early7d.w7);
    assert.equal(early7d.w7.habitBlended, true);
    assert.ok(Math.abs(early7d.w7.habitWeight - (24 / 26)) < 1e-4);
    assert.equal(early7d.w7.activeHoursPerDay, 4);
    assert.ok(early7d.w7.histBurnPctPerHour > 0.2 && early7d.w7.histBurnPctPerHour < 0.27);
    assert.ok(early7d.w7.burnPctPerHour < 0.5, `expected damped 7d rate < 0.5%/hr, got ${early7d.w7.burnPctPerHour}`);
    assert.equal(early7d.w7.willExhaustBeforeReset, false);
    assert.equal(early7d.w7.status, 'safe');

    // 3) Late-cycle convergence:
    // - 5h at elapsedHr = 4.0h -> wCur = 4/5 = 0.8, habitWeight = 0.2 (converges to sustained 20%/hr burn)
    // - 7d at elapsedHr = 120h (5 days) -> wCur = 120/144 = 5/6, habitWeight = 1/6 (converges to sustained 0.7%/hr -> warning)
    const latePriorHist = makePriorHistory(18, 6, 4, 9); // 13 prior days strictly before start7d (day -5)
    const late5h = runRunway('late-5h', {
      rem5h: 20, // 80% burned in 4h -> avg=20%/hr, recent=20%/hr -> curRate=20%/hr
      elapsed5hHr: 4.0,
      rem7d: 50,
      elapsed7dHr: 120.0,
      calls: [
        ...latePriorHist,
        {
          ts: fixedNow - 15 * 60_000,
          poolKey: 'gemini',
          family: 'gemini-4-hydrogen',
          baseUSD: 22.5, // 15% of 5h in 45m -> 20%/hr recent
          costUSD: 22.5,
          priced: true,
        },
      ],
    });
    assert.ok(late5h.w5);
    assert.equal(late5h.w5.habitBlended, true);
    assert.ok(Math.abs(late5h.w5.habitWeight - 0.2) < 1e-4);
    // 0.8 * 20 + 0.2 * 6 = 17.2%/hr (dominated by current cycle)
    assert.ok(Math.abs(late5h.w5.burnPctPerHour - 17.2) < 0.2, `expected ~17.2%/hr, got ${late5h.w5.burnPctPerHour}`);

    const late7d = runRunway('late-7d', {
      rem5h: 80,
      elapsed5hHr: 2.0,
      rem7d: 16, // 84% burned in 120h -> avg=0.7%/hr, recent=0.7%/hr -> curRate=0.7%/hr
      elapsed7dHr: 120.0,
      calls: [
        ...latePriorHist,
        {
          ts: fixedNow - 12 * HR_MS,
          poolKey: 'gemini',
          family: 'gemini-4-hydrogen',
          baseUSD: 100.8, // 16.8% of 7d in recent 24h -> 0.7%/hr recent
          costUSD: 100.8,
          priced: true,
        },
      ],
    });
    assert.ok(late7d.w7);
    assert.equal(late7d.w7.habitBlended, true);
    assert.ok(Math.abs(late7d.w7.habitWeight - (24 / 144)) < 1e-4);
    // 5/6 * 0.7 + 1/6 * ~0.25 ≈ 0.625%/hr -> over 48h remaining burns 30% > 16% rem -> warning!
    assert.ok(late7d.w7.burnPctPerHour > 0.58 && late7d.w7.burnPctPerHour < 0.68);
    assert.equal(late7d.w7.willExhaustBeforeReset, true);
    assert.equal(late7d.w7.status, 'warning');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeWindowRunway synthesizes cross-device recent burn and account-wide historical pace across devices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-runway-multidev-'));
  try {
    const HR_MS = 3_600_000;
    const DAY_MS = 24 * HR_MS;
    const tBase = new Date(2026, 10, 20, 14, 0, 0).getTime();

    const makeQuotaSnap = (fetchedAtMs: number, reset5h: number, rem5h: number, reset7d: number, rem7d: number) => ({
      available: true,
      planName: 'Ultra',
      tierName: 'Ultra',
      teamsTier: 'ULTRA',
      email: 'multi@example.com',
      fetchedAtMs,
      pools: [
        {
          label: 'Gemini',
          remainingPct: rem5h,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: rem5h, resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: rem7d, resetTime: '', resetAtMs: reset7d },
          ],
        },
      ],
    });

    const makeGraph = (calls: any[], latestTsMs: number) => ({
      indexing: false,
      summaries: calls.length
        ? [{ id: '22222222-2222-2222-2222-222222222222', source: 'app', latestTsMs, recentCalls: calls }]
        : [],
    });

    // 1) Pure remote/other-device recent burn:
    // Device A runs calls locally (+15% 5h, +3.75% 7d in 30 min); Device B is completely idle (0 local calls).
    // Both observe the same two snapshots at t0 (elapsed 2h of 5h, 30h of 7d) and t1 (t0 + 30m).
    const devACal = join(dir, 'devA-cal.json');
    const devAFit = join(dir, 'devA-fit.json');
    const devBCal = join(dir, 'devB-cal.json');
    const devBFit = join(dir, 'devB-fit.json');

    const reset5h = tBase + 3 * HR_MS; // 2h elapsed at tBase
    const reset7d = tBase + 138 * HR_MS; // 30h elapsed at tBase
    const t0 = tBase;
    const t1 = tBase + 30 * 60_000;

    // Initial snapshot at t0: 5h has 90% rem (10% used), 7d has 90% rem (10% used)
    attachQuotaBudgetEstimates(makeQuotaSnap(t0, reset5h, 90, reset7d, 90), makeGraph([], t0), {
      calibrationPath: devACal,
      fitPath: devAFit,
      nowMs: t0,
    });
    attachQuotaBudgetEstimates(makeQuotaSnap(t0, reset5h, 90, reset7d, 90), makeGraph([], t0), {
      calibrationPath: devBCal,
      fitPath: devBFit,
      nowMs: t0,
    });

    // At t1 (30m later): another burst burns +15% of 5h (rem 75%) and +3.75% of 7d (rem 86.25%)
    const devACalls = [
      {
        ts: t0 + 15 * 60_000,
        poolKey: 'gemini',
        family: 'gemini-4-hydrogen',
        baseUSD: 22.5, // 15% of 5h, 3.75% of 7d on $150/$600 prior
        costUSD: 22.5,
        priced: true,
      },
    ];
    const outA = attachQuotaBudgetEstimates(
      makeQuotaSnap(t1, reset5h, 75, reset7d, 86.25),
      makeGraph(devACalls, t1),
      { calibrationPath: devACal, fitPath: devAFit, nowMs: t1 },
    );
    const outB = attachQuotaBudgetEstimates(
      makeQuotaSnap(t1, reset5h, 75, reset7d, 86.25),
      makeGraph([], t1), // 0 local calls on idle Device B!
      { calibrationPath: devBCal, fitPath: devBFit, nowMs: t1 },
    );

    const rwA5 = outA.pools[0].windows[0].runway;
    const rwB5 = outB.pools[0].windows[0].runway;
    const rwA7 = outA.pools[0].windows[1].runway;
    const rwB7 = outB.pools[0].windows[1].runway;
    assert.ok(rwA5 && rwB5 && rwA7 && rwB7);
    assert.equal(rwB5.basis, 'active_blend', 'idle device should detect remote recent burn via burnLog');
    assert.equal(rwB7.basis, 'active_blend', 'idle device should detect remote 7d burn via burnLog');
    assert.ok(
      Math.abs(rwA5.burnPctPerHour - rwB5.burnPctPerHour) < 0.05,
      `5h burn rates should match across devices: A=${rwA5.burnPctPerHour}, B=${rwB5.burnPctPerHour}`,
    );
    assert.ok(
      Math.abs(rwA5.projectedRemAtResetPct - rwB5.projectedRemAtResetPct) < 0.2,
      `5h projected remaining should match: A=${rwA5.projectedRemAtResetPct}, B=${rwB5.projectedRemAtResetPct}`,
    );
    assert.ok(
      Math.abs(rwA7.burnPctPerHour - rwB7.burnPctPerHour) < 0.02,
      `7d burn rates should match across devices: A=${rwA7.burnPctPerHour}, B=${rwB7.burnPctPerHour}`,
    );

    // Verify Device B's fitter samples were NOT polluted by the 0-local-call remote burn
    const devBStore = JSON.parse(readFileSync(devBFit, 'utf8'));
    const devBPool = Object.values(devBStore.pools)[0] as any;
    assert.equal(devBPool.samples.length, 0, 'pure remote burn must not pollute model fitter samples');
    assert.ok(devBPool.burnLog.length >= 2, 'burnLog should persist account-wide intervals');

    // 2) Multi-device historical pace convergence:
    // Both Device Heavy (local $100/day) and Device Light (local $5/day) observed the same prior account-wide
    // 5h windows (each 30% burned over 4h -> 7.5%/hr) and prior 7d window (84% burned over 168h -> 0.5%/hr).
    // Now a fresh 5h + 7d window starts (early cycle where historical habit carries high weight).
    const heavyCal = join(dir, 'heavy-cal.json');
    const heavyFit = join(dir, 'heavy-fit.json');
    const lightCal = join(dir, 'light-cal.json');
    const lightFit = join(dir, 'light-fit.json');

    const curStart7d = tBase;
    const curReset7d = curStart7d + 7 * DAY_MS;
    const curStart5h = curStart7d + 24 * HR_MS; // Day 1 into new 7d window
    const curReset5h = curStart5h + 5 * HR_MS;
    const nowNew = curStart5h + 30 * 60_000; // 0.5h into new 5h window, 24.5h into new 7d window

    // Feed 3 prior 5h windows + 1 prior 7d window (spanning 7 full days before curStart7d) to BOTH devices
    const priorReset7d = curStart7d;
    const priorSnaps: Array<[number, number, number, number, number]> = [
      // Prior 7d start + 3 prior 5h windows across days -6, -4, -2 (each observed at 4h mark with 30% used = 7.5%/hr)
      [priorReset7d - 6 * DAY_MS + 4 * HR_MS, priorReset7d - 6 * DAY_MS + 5 * HR_MS, 70, priorReset7d, 85],
      [priorReset7d - 4 * DAY_MS + 4 * HR_MS, priorReset7d - 4 * DAY_MS + 5 * HR_MS, 70, priorReset7d, 55],
      [priorReset7d - 2 * DAY_MS + 4 * HR_MS, priorReset7d - 2 * DAY_MS + 5 * HR_MS, 70, priorReset7d, 30],
      // Prior 7d end (168h observed, 84% used -> 0.50%/hr; 5h window unused at 100% -> skipped by 5h peak guard)
      [priorReset7d - 5 * 60_000, priorReset7d + 5 * HR_MS, 100, priorReset7d, 16],
    ];
    for (const [ts, r5, rem5, r7, rem7] of priorSnaps) {
      attachQuotaBudgetEstimates(makeQuotaSnap(ts, r5, rem5, r7, rem7), makeGraph([], ts), {
        calibrationPath: heavyCal,
        fitPath: heavyFit,
        nowMs: ts,
      });
      attachQuotaBudgetEstimates(makeQuotaSnap(ts, r5, rem5, r7, rem7), makeGraph([], ts), {
        calibrationPath: lightCal,
        fitPath: lightFit,
        nowMs: ts,
      });
    }

    // Give Heavy vs Light wildly different local 10-day call histories
    const makeLocalCalls = (usdPerHr: number) => {
      const arr: any[] = [];
      for (let d = 10; d >= 2; d--) {
        for (let h = 0; h < 4; h++) {
          arr.push({
            ts: curStart7d - d * DAY_MS + (10 + h) * HR_MS,
            poolKey: 'gemini',
            family: 'gemini-4-hydrogen',
            baseUSD: usdPerHr,
            costUSD: usdPerHr,
            priced: true,
          });
        }
      }
      return arr;
    };

    const outHeavy = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 96, curReset7d, 88), // 4% in 0.5h (5h), 12% in 24.5h (7d)
      makeGraph(makeLocalCalls(25), nowNew),
      { calibrationPath: heavyCal, fitPath: heavyFit, nowMs: nowNew },
    );
    const outLight = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 96, curReset7d, 88),
      makeGraph(makeLocalCalls(1), nowNew),
      { calibrationPath: lightCal, fitPath: lightFit, nowMs: nowNew },
    );

    const h5 = outHeavy.pools[0].windows[0].runway;
    const l5 = outLight.pools[0].windows[0].runway;
    const h7 = outHeavy.pools[0].windows[1].runway;
    const l7 = outLight.pools[0].windows[1].runway;
    assert.ok(h5 && l5 && h7 && l7);
    assert.equal(h5.habitSource, 'account');
    assert.equal(l5.habitSource, 'account');
    assert.equal(h7.habitSource, 'account');
    assert.equal(l7.habitSource, 'account');
    assert.ok(Math.abs(h5.histBurnPctPerHour - 7.5) < 0.05, `expected ~7.5%/hr 5h account pace, got ${h5.histBurnPctPerHour}`);
    assert.ok(Math.abs(h7.histBurnPctPerHour - 0.5) < 0.02, `expected ~0.5%/hr 7d account pace, got ${h7.histBurnPctPerHour}`);
    assert.ok(Math.abs(h5.projectedRemAtResetPct - l5.projectedRemAtResetPct) < 0.05);
    assert.ok(Math.abs(h7.projectedRemAtResetPct - l7.projectedRemAtResetPct) < 0.05);

    // 3) 100% cap saturation uses peakReachedAtMs rather than diluting across locked-out hours
    const capCal = join(dir, 'cap-cal.json');
    const capFit = join(dir, 'cap-fit.json');
    const capReset1 = curStart5h - 24 * HR_MS;
    const capReset2 = curStart5h - 12 * HR_MS;
    // Both prior 5h windows hit 100% in 2 hours (50%/hr) and remain locked out at 100% until 4.9h
    for (const r5 of [capReset1, capReset2]) {
      const wStart = r5 - 5 * HR_MS;
      attachQuotaBudgetEstimates(makeQuotaSnap(wStart + 2 * HR_MS, r5, 0, curReset7d, 50), makeGraph([], wStart + 2 * HR_MS), {
        calibrationPath: capCal,
        fitPath: capFit,
        nowMs: wStart + 2 * HR_MS,
      });
      attachQuotaBudgetEstimates(makeQuotaSnap(wStart + 4.9 * HR_MS, r5, 0, curReset7d, 50), makeGraph([], wStart + 4.9 * HR_MS), {
        calibrationPath: capCal,
        fitPath: capFit,
        nowMs: wStart + 4.9 * HR_MS,
      });
    }
    const capOut = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 90, curReset7d, 45),
      makeGraph([], nowNew),
      { calibrationPath: capCal, fitPath: capFit, nowMs: nowNew },
    );
    const capRw5 = capOut.pools[0].windows[0].runway;
    assert.ok(capRw5 && capRw5.habitSource === 'account');
    assert.ok(
      Math.abs(capRw5.histBurnPctPerHour - 50) < 0.5,
      `capped 5h windows exhausted in 2h should yield ~50%/hr, got ${capRw5.histBurnPctPerHour}`,
    );

    // 4) Cold-start multi-device guard & provisional cap-inflation guard:
    //    (a) When remoteOnly burn is observed and no prior account windows exist yet, skip single-device local habit
    //    (b) When provisional cap inflates localWindowPct > 1.35x server usedPct (e.g. $177 prov vs $600 real), skip local habit
    const remGuardCal = join(dir, 'rem-guard-cal.json');
    const remGuardFit = join(dir, 'rem-guard-fit.json');
    const remGuardOut = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 90, curReset7d, 85), // 10% 5h, 15% 7d with 0 local calls in current windows -> remoteOnly!
      makeGraph(makeLocalCalls(1), nowNew), // 9 days of tiny local history before curStart7d
      { calibrationPath: remGuardCal, fitPath: remGuardFit, nowMs: nowNew },
    );
    assert.equal(remGuardOut.pools[0].windows[0].runway.habitBlended, undefined, 'remote-only cold start must bypass local habit (5h)');
    assert.equal(remGuardOut.pools[0].windows[1].runway.habitBlended, undefined, 'remote-only cold start must bypass local habit (7d)');

    const inflCal = join(dir, 'infl-cal.json');
    const inflFit = join(dir, 'infl-fit.json');
    const inflCalls = [
      ...makeLocalCalls(10),
      {
        ts: nowNew - 15 * 60_000,
        poolKey: 'gemini',
        family: 'gemini-4-hydrogen',
        baseUSD: 9.0, // on $150 prior = 6.0% >> 2.8% actual server usedPct -> provisional cap inflated!
        costUSD: 9.0,
        priced: true,
      },
    ];
    const inflOut = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 97.2, curReset7d, 85),
      makeGraph(inflCalls, nowNew),
      { calibrationPath: inflCal, fitPath: inflFit, nowMs: nowNew },
    );
    assert.equal(inflOut.pools[0].windows[0].runway.habitBlended, undefined, 'inflated provisional cap must bypass distorted local habit');

    // 5) Fast 1-window account learning & EWMA recency weighting:
    //    1 prior 5h window (1.5h covered) + 1 prior 7d window (24h covered) immediately activates account pace;
    //    recent 5h window (1d ago, 20%/hr) strongly outweighs older window (12d ago, 4%/hr) under 4d EWMA half-life.
    const ewmaCal = join(dir, 'ewma-cal.json');
    const ewmaFit = join(dir, 'ewma-fit.json');
    const oldWin5 = curStart5h - 12 * DAY_MS;
    const recentWin5 = curStart5h - 1 * DAY_MS;
    // Old 5h window: 4h elapsed, 16% used = 4%/hr; Prior 7d window observed at 24h mark with 12% used = 0.5%/hr
    attachQuotaBudgetEstimates(
      makeQuotaSnap(oldWin5 - 1 * HR_MS, oldWin5, 84, priorReset7d, 96),
      makeGraph([], oldWin5 - 1 * HR_MS),
      { calibrationPath: ewmaCal, fitPath: ewmaFit, nowMs: oldWin5 - 1 * HR_MS },
    );
    attachQuotaBudgetEstimates(
      makeQuotaSnap(priorReset7d - 6 * DAY_MS, recentWin5, 100, priorReset7d, 88), // 24h into prior 7d, 12% used
      makeGraph([], priorReset7d - 6 * DAY_MS),
      { calibrationPath: ewmaCal, fitPath: ewmaFit, nowMs: priorReset7d - 6 * DAY_MS },
    );
    // Recent 5h window (1d ago): 2h elapsed, 40% used = 20%/hr
    attachQuotaBudgetEstimates(
      makeQuotaSnap(recentWin5 - 3 * HR_MS, recentWin5, 60, curReset7d, 95),
      makeGraph([], recentWin5 - 3 * HR_MS),
      { calibrationPath: ewmaCal, fitPath: ewmaFit, nowMs: recentWin5 - 3 * HR_MS },
    );
    const ewmaOut = attachQuotaBudgetEstimates(
      makeQuotaSnap(nowNew, curReset5h, 92, curReset7d, 88),
      makeGraph([], nowNew),
      { calibrationPath: ewmaCal, fitPath: ewmaFit, nowMs: nowNew },
    );
    const ewma5 = ewmaOut.pools[0].windows[0].runway;
    const ewma7 = ewmaOut.pools[0].windows[1].runway;
    assert.ok(ewma5 && ewma7);
    assert.equal(ewma5.habitSource, 'account');
    assert.equal(ewma7.habitSource, 'account');
    assert.ok(
      ewma5.histBurnPctPerHour > 15,
      `EWMA should weight recent 20%/hr much more heavily than 12d-old 4%/hr (got ${ewma5.histBurnPctPerHour})`,
    );
    assert.ok(
      Math.abs(ewma7.histBurnPctPerHour - 0.5) < 0.02,
      `24h-covered prior 7d window should immediately activate ~0.5%/hr account pace (got ${ewma7.histBurnPctPerHour})`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accountLedger preserves account-wide spend across mid-window Gemini resets and early window shifts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-reset-ledger-'));
  try {
    const HR_MS = 3_600_000;
    const t0 = new Date(2026, 10, 25, 10, 0, 0).getTime();
    const reset5h = t0 + 4 * HR_MS;
    const reset7d = t0 + 5 * 24 * HR_MS;
    const calPath = join(dir, 'cal.json');
    const fitPath = join(dir, 'fit.json');

    const snap = (fetchedAtMs: number, r5: number, rem5: number, r7: number, rem7: number, source = 'summary') => ({
      available: true,
      source,
      planName: 'Ultra',
      tierName: 'Google AI Ultra',
      teamsTier: 'TEAMS_TIER_PRO',
      email: 'acct@example.com',
      fetchedAtMs,
      pools: [
        {
          label: 'Gemini',
          remainingPct: rem5,
          resetAtMs: r5,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: rem5, resetTime: '', resetAtMs: r5 },
            { spanKey: '7d', label: '7d', remainingPct: rem7, resetTime: '', resetAtMs: r7 },
          ],
        },
      ],
    });
    const emptyGraph = { indexing: false, summaries: [] };

    // 1) Initial morning burn: 5h reaches 40% used, 7d reaches 10% used (both start today at 09:00)
    attachQuotaBudgetEstimates(snap(t0, reset5h, 100, reset7d, 100), emptyGraph, { calibrationPath: calPath, fitPath, nowMs: t0 });
    attachQuotaBudgetEstimates(snap(t0 + 30 * 60_000, reset5h, 60, reset7d, 90), emptyGraph, {
      calibrationPath: calPath,
      fitPath,
      nowMs: t0 + 30 * 60_000,
    });

    // 2) Server resets 5h mid-window back to 0% used (same reset5h!) — Poll 1 holds pendingRewind (no false alarm on single glitch)
    const poll1 = attachQuotaBudgetEstimates(snap(t0 + 40 * 60_000, reset5h, 100, reset7d, 90), emptyGraph, {
      calibrationPath: calPath,
      fitPath,
      nowMs: t0 + 40 * 60_000,
    });
    assert.equal(poll1.accountLedger.recentResets.length, 0, 'single rewind poll should wait for 2nd-poll confirmation');

    // 3) Poll 2 confirms reset and already shows +2% fresh post-reset burn (rem5 = 98%)
    const poll2 = attachQuotaBudgetEstimates(snap(t0 + 42 * 60_000, reset5h, 98, reset7d, 89.5), emptyGraph, {
      calibrationPath: calPath,
      fitPath,
      nowMs: t0 + 42 * 60_000,
    });
    assert.equal(poll2.accountLedger.recentResets.length, 1);
    assert.equal(poll2.accountLedger.recentResets[0].kind, 'in_window_rewind');
    assert.equal(poll2.accountLedger.recentResets[0].spanKey, '5h');
    assert.ok(Math.abs(poll2.accountLedger.recentResets[0].reclaimedPct - 40) < 0.05);

    // 4) Subsequent +10% burn after reset must NOT be frozen at old 40% high-water mark!
    const poll3 = attachQuotaBudgetEstimates(snap(t0 + 50 * 60_000, reset5h, 88, reset7d, 87), emptyGraph, {
      calibrationPath: calPath,
      fitPath,
      nowMs: t0 + 50 * 60_000,
    });
    // Total 5h burned today = 40 (pre-reset) + 2 (post-reset during confirm) + 10 (after confirm) = 52%!
    assert.ok(
      Math.abs(poll3.accountLedger.today.pct5hSum - 52) < 0.1,
      `expected 52% total 5h burned across reset, got ${poll3.accountLedger.today.pct5hSum}`,
    );
    assert.ok(poll3.accountLedger.today.usd > 0);
    assert.equal(poll3.accountLedger.today.resets, 1);

    // 5) Early window shift: server jumps reset5h forward while >2h remained and clears 12% -> 0%
    const newReset5h = t0 + 6 * HR_MS;
    const poll4 = attachQuotaBudgetEstimates(snap(t0 + 60 * 60_000, newReset5h, 100, reset7d, 87), emptyGraph, {
      calibrationPath: calPath,
      fitPath,
      nowMs: t0 + 60 * 60_000,
    });
    assert.equal(poll4.accountLedger.recentResets.length, 2);
    assert.equal(poll4.accountLedger.recentResets[0].kind, 'early_window_shift');
    assert.ok(Math.abs(poll4.accountLedger.recentResets[0].reclaimedPct - 12) < 0.05);
    assert.equal(poll4.accountLedger.all.resets, 2);

    // Verify model fitter samples stayed completely clean (0 negative/remote samples)
    const persisted = JSON.parse(readFileSync(fitPath, 'utf8'));
    const ps = Object.values(persisted.pools)[0] as any;
    assert.equal(ps.samples.length, 0);
    assert.equal(ps.resetEvents.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('attachQuotaBudgetEstimates computes cache-ratio-projected token capacity for 5h and 7d windows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-tok-cap-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const nowMs = 1_800_000_000_000;
    const reset5h = nowMs + 4 * 3_600_000;
    const reset7d = nowMs + 6 * 86_400_000;

    // 6 calls in last 7d with 90% prompt cache hit rate:
    // Each call: 100k newInput ($0.30 @ $3/M), 900k cachedInput ($0.135 @ $0.15/M), 10k output ($0.15 @ $15/M)
    // Total tokens/call = 1,010,000; cost/call = $0.585
    // 6 calls -> total cost = $3.51; total tokens = 6,060,000
    // With 5h remaining = 80% (20% used -> $17.55 full cap on legacy cold start, or $150 prior if Gemini)
    const calls = Array.from({ length: 6 }, (_, i) => ({
      ts: nowMs - (i + 1) * 60_000,
      poolKey: 'gemini',
      family: 'gemini-4-neon',
      newInput: 100_000,
      cachedInput: 900_000,
      outputTokens: 10_000,
      baseUSD: 0.585,
      costUSD: 0.585,
      priced: true,
    }));

    const res = attachQuotaBudgetEstimates(
      {
        available: true,
        planName: 'Pro',
        tierName: 'Pro',
        teamsTier: 'PRO',
        fetchedAtMs: nowMs,
        pools: [
          {
            label: 'Gemini',
            remainingPct: 80,
            resetAtMs: reset5h,
            windows: [
              { spanKey: '5h', label: '5h', remainingPct: 80, resetTime: '', resetAtMs: reset5h },
              { spanKey: '7d', label: '7d', remainingPct: 95, resetTime: '', resetAtMs: reset7d },
            ],
          },
        ],
      },
      { summaries: [{ latestTsMs: nowMs, recentCalls: calls }] },
      { calibrationPath: calPath, fitPath, nowMs },
    );

    const w5 = res.pools[0].windows.find((w: any) => w.spanKey === '5h');
    const w7 = res.pools[0].windows.find((w: any) => w.spanKey === '7d');
    assert.ok(w5?.estTokenCapacity, '5h window should include estTokenCapacity');
    assert.ok(w7?.estTokenCapacity, '7d window should include estTokenCapacity');

    const tc5 = w5.estTokenCapacity;
    assert.equal(tc5.basisWindow, '7d');
    assert.equal(tc5.sampleCalls, 6);
    assert.equal(tc5.cacheHitPct, 90);
    // Remaining should be 80% of full capacity
    assert.ok(Math.abs(tc5.remainingTotalTokens / tc5.fullTotalTokens - 0.8) < 0.001);
    assert.ok(tc5.fullTotalTokens > 25_000_000, `expected realistic multi-million token capacity, got ${tc5.fullTotalTokens}`);
    assert.ok(tc5.fullCachedTokens > tc5.fullNewInputTokens * 8, 'cached share should reflect 90% cache hit ratio');

    // 7d window with 95% remaining should reflect larger full capacity than 5h
    const tc7 = w7.estTokenCapacity;
    assert.ok(Math.abs(tc7.remainingTotalTokens / tc7.fullTotalTokens - 0.95) < 0.001);
    assert.ok(tc7.fullTotalTokens > tc5.fullTotalTokens, '7d full token capacity should exceed 5h');

    // Fallback to 30d when 7d has <5 calls
    const oldCalls = [
      {
        ts: nowMs - 12 * 86_400_000,
        poolKey: 'claude_gpt',
        family: 'claude-sonnet-5-5',
        newInput: 200_000,
        cachedInput: 800_000,
        outputTokens: 20_000,
        baseUSD: 0.76,
        costUSD: 0.76,
        priced: true,
      },
    ];
    const res30 = attachQuotaBudgetEstimates(
      {
        available: true,
        planName: 'Pro',
        tierName: 'Pro',
        teamsTier: 'PRO',
        fetchedAtMs: nowMs,
        pools: [
          {
            label: 'Claude & GPT',
            remainingPct: 50,
            resetAtMs: reset5h,
            windows: [
              { spanKey: '5h', label: '5h', remainingPct: 50, resetTime: '', resetAtMs: reset5h },
            ],
          },
        ],
      },
      {
        summaries: [
          {
            latestTsMs: nowMs,
            recentCalls: [
              ...oldCalls,
              {
                ts: nowMs - 60_000,
                poolKey: 'claude_gpt',
                family: 'claude-sonnet-5-5',
                newInput: 200_000,
                cachedInput: 800_000,
                outputTokens: 20_000,
                baseUSD: 0.76,
                costUSD: 0.76,
                priced: true,
              },
            ],
          },
        ],
      },
      { calibrationPath: calPath, fitPath, nowMs },
    );
    const tc30 = res30.pools[0].windows[0].estTokenCapacity;
    assert.ok(tc30, 'should fall back to 30d calls when <5 calls exist in 7d');
    assert.equal(tc30.basisWindow, '30d');
    assert.equal(tc30.sampleCalls, 2);
    assert.equal(tc30.cacheHitPct, 80);
    assert.ok(Math.abs(tc30.remainingTotalTokens / tc30.fullTotalTokens - 0.5) < 0.001);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
