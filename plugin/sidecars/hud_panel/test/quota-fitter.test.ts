import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeCallCost, getCurrentPricingSig, poolKeyForModel } from '../lib/pricing.ts';
import { attachQuotaBudgetEstimates, attachTelemetryQuotaPredictions } from '../lib/quota-budget.ts';
import {
  FAMILY_CLASSIFIER_VERSION,
  computeBaseReferenceUSD,
  ingestQuotaObservation,
  loadQuotaFitStore,
  reconcilePoolSamplesPricing,
  resolveModelFamily,
  solvePoolFitModel,
} from '../lib/quota-fitter.ts';

function makeGeminiCall(ts, modelId, newIn, cached, out) {
  const c = computeCallCost(modelId, modelId, modelId, newIn, cached, out, 0);
  return {
    ts,
    genUncertainStartTs: ts,
    poolKey: 'gemini',
    modelId,
    modelDisplay: modelId,
    model: modelId,
    newInput: newIn,
    cachedInput: cached,
    outputTokens: out,
    costUSD: c.costUSD,
    priced: true,
  };
}

function makeUltraQuota(tsMs, reset5h, reset7d, used5Pct, used7Pct) {
  return {
    available: true,
    planName: 'Pro',
    tierName: 'Google AI Ultra',
    teamsTier: 'TEAMS_TIER_PRO',
    reqStartedAtMs: tsMs - 100,
    fetchedAtMs: tsMs,
    pools: [
      {
        label: 'Gemini',
        remainingPct: Number((100 - used5Pct).toFixed(6)),
        resetAtMs: reset5h,
        windows: [
          { spanKey: '5h', label: '5h', remainingPct: Number((100 - used5Pct).toFixed(6)), resetTime: '', resetAtMs: reset5h },
          { spanKey: '7d', label: '7d', remainingPct: Number((100 - used7Pct).toFixed(6)), resetTime: '', resetAtMs: reset7d },
        ],
      },
    ],
  };
}

test('cold-start 5h_boot with external burn stays anchored at $150/$600 (prov.) without deflating to $135.6/$542.3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-cold-boot-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const tBoot = 1_795_267_491_187;
    const reset5h = tBoot + 32 * 60_000 + 53_000; // ~4.45h into active 5h window
    const reset7d = reset5h + 6 * 24 * 3_600_000 + 19 * 3_600_000;
    const w5Start = reset5h - 5 * 3_600_000;

    // Local spend = $6.372 (Neon $3.437 + Hydrogen $2.935) while server used 4.7003% ($7.05 at $150 -> $0.68 external burn)
    const calls = [
      makeGeminiCall(w5Start + 1_000_000, 'gemini-4-neon', 496_792, 5_953_555, 70_265),
      makeGeminiCall(w5Start + 2_000_000, 'gemini-4-hydrogen', 1_098_289, 12_634_601, 45_316),
    ];

    const res = attachQuotaBudgetEstimates(
      makeUltraQuota(tBoot, reset5h, reset7d, 4.7003, 1.175075),
      { summaries: [{ latestTsMs: tBoot - 10_000, recentCalls: calls }] },
      { calibrationPath: calPath, fitPath, nowMs: tBoot },
    );

    const w5 = res.pools[0].windows.find((w) => w.spanKey === '5h');
    const w7 = res.pools[0].windows.find((w) => w.spanKey === '7d');

    assert.ok(Math.abs(w5.estFullUSD - 150) < 0.1, `expected 5h cap ~$150 (not $135.6), got ${w5.estFullUSD}`);
    assert.ok(Math.abs(w7.estFullUSD - 600) < 0.5, `expected 7d cap ~$600 (not $542.3), got ${w7.estFullUSD}`);
    assert.equal(w5.estConfidence, 'low');
    assert.equal(w7.estConfidence, 'low');
    assert.equal(w5.estRemoteUSD, 0);
    assert.equal(w7.estRemoteUSD, 0);
    // Must not pollute legacy calibration file with depressed boot ratio
    assert.equal(existsSync(calPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('real-world boot + single-sample +508% spike + clean deltas never jumps to $135.6 or $49.5', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-no-jump-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const tBoot = 1_795_267_491_187;
    const reset5h = tBoot + 32 * 60_000 + 53_000;
    const reset7d = reset5h + 6 * 24 * 3_600_000 + 19 * 3_600_000;
    const w5Start = reset5h - 5 * 3_600_000;

    const calls = [
      makeGeminiCall(w5Start + 1_000_000, 'gemini-4-neon', 496_792, 5_953_555, 70_265),
      makeGeminiCall(w5Start + 2_000_000, 'gemini-4-hydrogen', 1_098_289, 12_634_601, 45_316),
    ];

    let used5 = 4.7003;
    let used7 = 1.175075;
    const observe = (tsMs) => attachQuotaBudgetEstimates(
      makeUltraQuota(tsMs, reset5h, reset7d, used5, used7),
      { summaries: [{ latestTsMs: tsMs, recentCalls: [...calls] }] },
      { calibrationPath: calPath, fitPath, nowMs: tsMs },
    );

    // Step 1: 5h_boot (shortCleanCount = 0)
    const r1 = observe(tBoot);
    // Step 2: 1st delta with +0.174% (+508%) cache-flush spike (shortCleanCount = 1)
    const t1 = tBoot + 17_002;
    calls.push(makeGeminiCall(tBoot + 8_000, 'gemini-4-neon', 5_746, 202_462, 247)); // $0.0513
    used5 += 0.208095;
    used7 += 0.05202;
    const r2 = observe(t1);

    // Step 3..6: 4 clean deltas matching $150/5h (gamma=4)
    const cleanDeltas = [
      { dt: 18_293, tokens: [5_044, 207_293, 454], du5: 0.035351, du7: 0.00885 },
      { dt: 17_293, tokens: [6_086, 213_460, 312], du5: 0.036639, du7: 0.00916 },
      { dt: 22_463, tokens: [6_921, 160_801, 4_969], du5: 0.079600, du7: 0.019903 },
      { dt: 20_477, tokens: [10_408, 108_096, 1_304], du5: 0.044660, du7: 0.01117 },
    ];
    let curTs = t1;
    const results = [r1, r2];
    for (const d of cleanDeltas) {
      calls.push(makeGeminiCall(curTs + 8_000, 'gemini-4-neon', d.tokens[0], d.tokens[1], d.tokens[2]));
      curTs += d.dt;
      used5 += d.du5;
      used7 += d.du7;
      results.push(observe(curTs));
    }

    for (let i = 0; i < results.length; i++) {
      const pool = results[i].pools[0];
      const w5 = pool.windows.find((w) => w.spanKey === '5h');
      const w7 = pool.windows.find((w) => w.spanKey === '7d');
      assert.ok(
        w5.estFullUSD >= 148 && w5.estFullUSD <= 152,
        `step ${i + 1}: expected 5h cap in [148, 152], got ${w5.estFullUSD}`,
      );
      assert.ok(
        w7.estFullUSD >= 590 && w7.estFullUSD <= 610,
        `step ${i + 1}: expected 7d cap in [590, 610], got ${w7.estFullUSD}`,
      );
      const neon = pool.fitSummary?.models?.find((m) => m.family === 'gemini-4-neon');
      assert.ok(
        neon && neon.k >= 0.95 && neon.k <= 1.05,
        `step ${i + 1}: expected neon k near 1.0, got ${neon?.k}`,
      );
    }

    // Final step must reach high quality with exact $150/$600
    const finalPool = results.at(-1).pools[0];
    assert.equal(finalPool.fitSummary.quality, 'high');
    assert.equal(finalPool.windows.find((w) => w.spanKey === '5h').estConfidence, 'high');
    assert.ok(Math.abs(finalPool.fitSummary.full5hUSD - 150) < 0.25);
    assert.ok(Math.abs(finalPool.fitSummary.full7dUSD - 600) < 1.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start Carbon (k=3) normalizes effective spend to $150/$600 (prov.) instead of raw $50', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-carbon-cold-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const tBoot = 1_800_000_000_000;
    const reset5h = tBoot + 3 * 3_600_000;
    const reset7d = tBoot + 6 * 24 * 3_600_000;
    const w5Start = reset5h - 5 * 3_600_000;

    // Carbon baseUSD = (500k*$2 + 0 + 100k*$10)/1e6 = $2.00; at k=3 -> 4.0% of $150 (raw $2/4% = $50!)
    const calls = [makeGeminiCall(w5Start + 600_000, 'gemini-4-carbon', 500_000, 0, 100_000)];
    const res = attachQuotaBudgetEstimates(
      makeUltraQuota(tBoot, reset5h, reset7d, 4.0, 1.0),
      { summaries: [{ latestTsMs: tBoot - 10_000, recentCalls: calls }] },
      { calibrationPath: calPath, fitPath, nowMs: tBoot },
    );

    const w5 = res.pools[0].windows.find((w) => w.spanKey === '5h');
    const w7 = res.pools[0].windows.find((w) => w.spanKey === '7d');
    assert.ok(Math.abs(w5.estFullUSD - 150) < 0.1, `expected $150 (prov.), got ${w5.estFullUSD}`);
    assert.ok(Math.abs(w7.estFullUSD - 600) < 0.5, `expected $600 (prov.), got ${w7.estFullUSD}`);
    assert.ok(Math.abs(w5.estEffectiveSpentUSD - 6.0) < 0.05);
    assert.equal(w5.estConfidence, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-Ultra tier ($30 Gemini 5h cap) avoids false $150 anchor and converges to $30 after 2+ agreeing deltas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-pro-tier-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const tBoot = 1_810_000_000_000;
    const reset5h = tBoot + 3 * 3_600_000;
    const reset7d = tBoot + 6 * 24 * 3_600_000;
    const w5Start = reset5h - 5 * 3_600_000;

    // $1.50 Hydrogen burns 5.0% -> true cap = $30 (0.20x of $150 Ultra prior)
    const calls = [makeGeminiCall(w5Start + 600_000, 'gemini-4-hydrogen', 500_000, 0, 100_000)];
    let used5 = 5.0;
    let used7 = 1.25;

    const observe = (tsMs) => attachQuotaBudgetEstimates(
      {
        ...makeUltraQuota(tsMs, reset5h, reset7d, used5, used7),
        tierName: 'Google AI Pro',
      },
      { summaries: [{ latestTsMs: tsMs, recentCalls: [...calls] }] },
      { calibrationPath: calPath, fitPath, nowMs: tsMs },
    );

    const rBoot = observe(tBoot);
    const w5Boot = rBoot.pools[0].windows.find((w) => w.spanKey === '5h');
    assert.ok(Math.abs(w5Boot.estFullUSD - 30) < 0.5, `expected cold-start ~$30 (not $150), got ${w5Boot.estFullUSD}`);
    assert.equal(w5Boot.estConfidence, 'low');

    // Add 3 clean short deltas at true $30 cap ($0.30 -> +1.0% 5h, +0.25% 7d)
    let curTs = tBoot;
    let lastRes = rBoot;
    for (let i = 0; i < 3; i++) {
      calls.push(makeGeminiCall(curTs + 10_000, 'gemini-4-hydrogen', 100_000, 0, 20_000)); // $0.30
      curTs += 30_000;
      used5 += 1.0;
      used7 += 0.25;
      lastRes = observe(curTs);
    }

    const w5Final = lastRes.pools[0].windows.find((w) => w.spanKey === '5h');
    const w7Final = lastRes.pools[0].windows.find((w) => w.spanKey === '7d');
    assert.ok(Math.abs(w5Final.estFullUSD - 30) < 0.5, `expected converged 5h cap ~$30, got ${w5Final.estFullUSD}`);
    assert.ok(Math.abs(w7Final.estFullUSD - 120) < 2.0, `expected converged 7d cap ~$120, got ${w7Final.estFullUSD}`);

    // Sanity check persisted fit file reflects true $30 tier
    const savedFit = JSON.parse(readFileSync(fitPath, 'utf-8'));
    const ps: any = Object.values(savedFit.pools)[0];
    assert.ok(Math.abs(ps.fit.full5hUSD - 30) < 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('k-multiplier quota fitter recovers Hydrogen 1x & Carbon 3x, resists long-window pollution, separates pool gammas, and predicts per-call quota % ± CI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-kfit-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const tBase = 1_810_000_000_000;
    const reset5h = tBase + 4 * 3_600_000;
    const reset7d = tBase + 5 * 24 * 3_600_000;

    // Ground truth:
    // Gemini pool: F_5h = $150, gamma = 4.0 (F_7d = $600), Hydrogen k = 1.0, Carbon k = 3.0
    // Claude & GPT pool: F_5h = $12, gamma = 2.0 (F_7d = $24), Sonnet k = 1.0
    const allGemCalls: any[] = [];
    const allClaudeCalls: any[] = [];
    let gemU5 = 0;
    let gemU7 = 0;
    let claudeU5 = 0;
    let claudeU7 = 0;
    let curMs = tBase;

    const makeSnap = (tsMs) => ({
      available: true,
      planName: 'Pro',
      tierName: 'Pro',
      teamsTier: 'PRO',
      reqStartedAtMs: tsMs - 80,
      fetchedAtMs: tsMs,
      pools: [
        {
          label: 'Gemini',
          remainingPct: 100 - gemU5,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: Number((100 - gemU5).toFixed(6)), resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: Number((100 - gemU7).toFixed(6)), resetTime: '', resetAtMs: reset7d },
          ],
        },
        {
          label: 'Claude & GPT',
          remainingPct: 100 - claudeU5,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: Number((100 - claudeU5).toFixed(6)), resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: Number((100 - claudeU7).toFixed(6)), resetTime: '', resetAtMs: reset7d },
          ],
        },
      ],
    });

    const stepAndObserve = (dtSec, gemSpecs, claudeSpecs, extGem5hPct = 0) => {
      const nextMs = curMs + dtSec * 1000;
      for (let i = 0; i < gemSpecs.length; i++) {
        const sp = gemSpecs[i];
        const callTs = curMs + Math.floor(((i + 1) / (gemSpecs.length + 1)) * (dtSec * 1000 - 4_000)) + 2_000;
        const c = computeCallCost(sp.modelId, sp.modelId, sp.modelId, sp.newIn, sp.cached, sp.out, 0);
        const trueK = sp.modelId.includes('carbon') ? 3.0 : 1.0;
        const d5 = (trueK * c.costUSD / 150) * 100;
        gemU5 += d5;
        gemU7 += d5 / 4.0;
        allGemCalls.push({
          ts: callTs,
          poolKey: 'gemini',
          modelId: sp.modelId,
          modelDisplay: sp.modelId,
          model: sp.modelId,
          newInput: sp.newIn,
          cachedInput: sp.cached,
          outputTokens: sp.out,
          costUSD: c.costUSD,
          priced: true,
        });
      }
      gemU5 += extGem5hPct;
      gemU7 += extGem5hPct / 4.0;

      for (let i = 0; i < claudeSpecs.length; i++) {
        const sp = claudeSpecs[i];
        const callTs = curMs + 3_000 + i * 2_000;
        const c = computeCallCost(sp.modelId, sp.modelId, sp.modelId, sp.newIn, sp.cached, sp.out, 0);
        const d5 = (1.0 * c.costUSD / 12) * 100;
        claudeU5 += d5;
        claudeU7 += d5 / 2.0;
        allClaudeCalls.push({
          ts: callTs,
          poolKey: 'claude_gpt',
          modelId: sp.modelId,
          modelDisplay: sp.modelId,
          model: sp.modelId,
          newInput: sp.newIn,
          cachedInput: sp.cached,
          outputTokens: sp.out,
          costUSD: c.costUSD,
          priced: true,
        });
      }

      curMs = nextMs;
      return attachQuotaBudgetEstimates(
        makeSnap(curMs),
        {
          summaries: [
            { latestTsMs: curMs, recentCalls: [...allGemCalls] },
            { latestTsMs: curMs, recentCalls: [...allClaudeCalls] },
          ],
        },
        { calibrationPath: calPath, fitPath, nowMs: curMs },
      );
    };

    // Baseline anchor at tBase
    attachQuotaBudgetEstimates(
      makeSnap(curMs),
      { summaries: [] },
      { calibrationPath: calPath, fitPath, nowMs: curMs },
    );

    // 8 short clean micro-windows (<= 120s) mixing Hydrogen and Carbon + Claude Sonnet
    const shortSchedule = [
      [{ modelId: 'gemini-4-hydrogen', newIn: 12_000, cached: 50_000, out: 1_500 }],
      [{ modelId: 'gemini-4-carbon', newIn: 20_000, cached: 80_000, out: 2_500 }],
      [{ modelId: 'gemini-4-hydrogen', newIn: 30_000, cached: 120_000, out: 4_000 }],
      [
        { modelId: 'gemini-4-hydrogen', newIn: 15_000, cached: 60_000, out: 2_000 },
        { modelId: 'gemini-4-carbon', newIn: 18_000, cached: 40_000, out: 3_000 },
      ],
      [{ modelId: 'gemini-4-carbon', newIn: 25_000, cached: 100_000, out: 3_500 }],
      [{ modelId: 'gemini-4-hydrogen', newIn: 40_000, cached: 150_000, out: 5_000 }],
      [{ modelId: 'gemini-4-carbon', newIn: 15_000, cached: 90_000, out: 2_000 }],
      [
        { modelId: 'gemini-4-hydrogen', newIn: 22_000, cached: 80_000, out: 2_800 },
        { modelId: 'gemini-4-carbon', newIn: 12_000, cached: 70_000, out: 1_800 },
      ],
    ];

    let cleanRes;
    for (const gemSpecs of shortSchedule) {
      cleanRes = stepAndObserve(
        90,
        gemSpecs,
        [{ modelId: 'claude-sonnet-5-5', newIn: 10_000, cached: 30_000, out: 1_200 }],
      );
    }

    const gemPoolClean = cleanRes.pools[0];
    const claudePoolClean = cleanRes.pools[1];
    assert.equal(gemPoolClean.fitSummary.quality, 'high');
    assert.ok(gemPoolClean.fitSummary.holdoutCount >= 2);
    assert.ok(gemPoolClean.fitSummary.oosRelErrPct < 1.0);
    assert.ok(Math.abs(gemPoolClean.fitSummary.gamma - 4.0) < 0.02);
    assert.ok(Math.abs(claudePoolClean.fitSummary.gamma - 2.0) < 0.02);
    assert.ok(Math.abs(gemPoolClean.fitSummary.full5hUSD - 150) < 1.5);
    assert.ok(Math.abs(gemPoolClean.fitSummary.full7dUSD - 600) < 6.0);
    assert.ok(Math.abs(claudePoolClean.fitSummary.full5hUSD - 12) < 0.3);
    assert.ok(Math.abs(claudePoolClean.fitSummary.full7dUSD - 24) < 0.6);

    const hFit = gemPoolClean.fitSummary.models.find((m) => m.family === 'gemini-4-hydrogen');
    const cFit = gemPoolClean.fitSummary.models.find((m) => m.family === 'gemini-4-carbon');
    assert.ok(hFit && Math.abs(hFit.k - 1.0) < 0.03);
    assert.ok(cFit && Math.abs(cFit.k - 3.0) < 0.06);

    // Pure local Carbon + Hydrogen spend must NOT trigger false cloud spend!
    const gemWin5hClean = gemPoolClean.windows.find((w) => w.spanKey === '5h');
    assert.equal(gemWin5hClean.estRemoteUSD, 0);
    assert.ok(gemWin5hClean.estEffectiveSpentUSD > gemWin5hClean.estSpentUSD * 1.5);

    // Now inject a long 40-minute interval with +2.0% external cloud burn ($3.00 of $150):
    // 1) Long window must NOT corrupt k_carbon (3.0) or F_5h ($150)
    // 2) Signed window residual surfaces ~$3.00 ± CI cloud spend
    const extRes = stepAndObserve(
      2400,
      [{ modelId: 'gemini-4-hydrogen', newIn: 10_000, cached: 40_000, out: 1_000 }],
      [],
      2.0,
    );
    const gemAfterExt = extRes.pools[0];
    assert.ok(Math.abs(gemAfterExt.fitSummary.full5hUSD - 150) < 1.5);
    const cAfterExt = gemAfterExt.fitSummary.models.find((m) => m.family === 'gemini-4-carbon');
    assert.ok(Math.abs(cAfterExt.k - 3.0) < 0.06);
    const gemWin5hExt = gemAfterExt.windows.find((w) => w.spanKey === '5h');
    assert.ok(Math.abs(gemWin5hExt.estRemoteUSD - 3.0) < 0.15);
    assert.ok(gemWin5hExt.estRemoteUSDPlusMinus > 0 && gemWin5hExt.estRemoteUSDPlusMinus < 0.5);
    assert.ok(extRes.remoteEstimate.activeWindowPlusMinusUSD > 0);

    // Verify per-call quota predictions on telemetry (both Hydrogen 1x and Carbon 3x)
    const fakeTelemetry = {
      invocations: [
        {
          idx: 0,
          modelId: 'gemini-4-hydrogen',
          modelDisplay: 'Gemini Hydrogen',
          model: 'gemini-4-hydrogen',
          newInput: 9_192,
          cachedInput: 50_758,
          outputTokens: 1_585,
        },
        {
          idx: 1,
          modelId: 'gemini-4-carbon',
          modelDisplay: 'Gemini Carbon',
          model: 'gemini-4-carbon',
          newInput: 10_000,
          cachedInput: 50_000,
          outputTokens: 2_000,
        },
      ],
      latest: {
        idx: 1,
        modelId: 'gemini-4-carbon',
        modelDisplay: 'Gemini Carbon',
        model: 'gemini-4-carbon',
        newInput: 10_000,
        cachedInput: 50_000,
        outputTokens: 2_000,
      },
      compactions: [],
    };
    const decorated = attachTelemetryQuotaPredictions(fakeTelemetry, extRes, { fitPath });
    // INV 51 exact check from verify.py: 0.019658% on Hydrogen
    assert.ok(Math.abs(decorated.invocations[0].quotaPct5h - 0.019658) < 0.0003);
    assert.ok(Math.abs(decorated.invocations[0].quotaPct7d - 0.019658 / 4) < 0.0001);
    assert.equal(decorated.invocations[0].quotaFitSource, 'fitted');
    assert.ok(decorated.invocations[0].quotaPct5hErr > 0);
    // Carbon call: baseUSD = (10k*2 + 50k*0.1 + 2k*10)/1e6 = $0.045 -> 3x * $0.045 / $150 = 0.090%
    assert.ok(Math.abs(decorated.invocations[1].quotaPct5h - 0.09) < 0.002);
    assert.ok(Math.abs(decorated.invocations[1].quotaMultiplierK - 3.0) < 0.06);
    assert.ok(Math.abs(decorated.latest.quotaPct5h - 0.09) < 0.002);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-P3 regression: Carbon-only short windows anchor F=$150/k=3 without Hydrogen long-window distortion, Claude fits 3-param provisional tokenWeights, tool-stall boundary is caught, and 7d unmodeled family uses prior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-p0p3-'));
  const calPath = join(dir, 'quota-calibration.json');
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const t0 = 1_820_000_000_000;
    const w5Start = t0 - 1600_000; // 26.7m into active 5h window (so 5h_boot is a long window!)
    const reset5h = w5Start + 5 * 3_600_000;
    const reset7d = w5Start + 4 * 24 * 3_600_000;

    const calls: any[] = [];
    let gemU5 = 0;
    let gemU7 = 0;
    let claudeU5 = 0;
    let claudeU7 = 0;

    const pushGem = (uncStartTs, completedTs, modelId, newIn, cached, out) => {
      const c = computeCallCost(modelId, modelId, modelId, newIn, cached, out, 0);
      const kTrue = modelId.includes('carbon') ? 3.0 : 1.0;
      const d5 = (kTrue * c.costUSD / 150) * 100;
      calls.push({
        ts: completedTs,
        genUncertainStartTs: uncStartTs,
        poolKey: 'gemini',
        modelId,
        modelDisplay: modelId,
        model: modelId,
        newInput: newIn,
        cachedInput: cached,
        outputTokens: out,
        costUSD: c.costUSD,
        priced: true,
      });
      return d5;
    };

    const pushClaudeOpus = (ts, newIn, cached, out) => {
      const c = computeCallCost('claude-opus-5-5', 'Claude Opus', 'claude-opus-5-5', newIn, cached, out, 0);
      // Simulate Anthropic 1.25x prompt-cache write on newInput: [5.0, 0.2, 20.0] on F_5h = $12.50 -> [40, 1.6, 160] %/M
      const d5 = ((newIn * 40 + cached * 1.6 + out * 160) / 1e6);
      calls.push({
        ts,
        endTs: ts,
        poolKey: 'claude_gpt',
        modelId: 'claude-opus-5-5',
        modelDisplay: 'Claude Opus',
        model: 'claude-opus-5-5',
        newInput: newIn,
        cachedInput: cached,
        outputTokens: out,
        costUSD: c.costUSD,
        priced: true,
      });
      return d5;
    };

    // Earlier 7d-only Flash call (unmodeled in 5h short windows -> tests P3!) + $6.00 (+1.0% on 7d) external Gemini burn
    const flashD5 = pushGem(w5Start - 24 * 3_600_000, w5Start - 24 * 3_600_000, 'gemini-3.8-flash', 400_000, 1_000_000, 50_000);
    gemU7 += flashD5 / 4.0 + 1.0; // +1.0% external 7d burn = $6.00 of $600

    // Boot long window (1600s) containing Hydrogen + Carbon + +0.30% unexplained spike (tests P0!)
    gemU5 += pushGem(w5Start + 100_000, w5Start + 100_000, 'gemini-4-hydrogen', 300_000, 2_000_000, 30_000);
    gemU5 += pushGem(w5Start + 200_000, w5Start + 200_000, 'gemini-4-carbon', 200_000, 1_000_000, 20_000);
    gemU5 += 0.30; // +0.30% unmodeled spike in boot long window!
    gemU7 += gemU5 / 4.0;

    const snap = (tsMs) => ({
      available: true,
      planName: 'Pro',
      tierName: 'Google AI Ultra',
      teamsTier: 'TEAMS_TIER_PRO',
      reqStartedAtMs: tsMs - 100,
      fetchedAtMs: tsMs,
      pools: [
        {
          label: 'Gemini',
          remainingPct: 100 - gemU5,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: Number((100 - gemU5).toFixed(6)), resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: Number((100 - gemU7).toFixed(6)), resetTime: '', resetAtMs: reset7d },
          ],
        },
        {
          label: 'Claude & GPT',
          remainingPct: 100 - claudeU5,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: Number((100 - claudeU5).toFixed(6)), resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: Number((100 - claudeU7).toFixed(6)), resetTime: '', resetAtMs: reset7d },
          ],
        },
      ],
    });

    let curMs = t0;
    attachQuotaBudgetEstimates(snap(curMs), { summaries: [{ latestTsMs: curMs, recentCalls: [...calls] }] }, { calibrationPath: calPath, fitPath, nowMs: curMs });

    // 1 boundary-straddling tool-stall window (P2): genEndTs = curMs + 25_000, step completed endTs = curMs + 35_000, snap at curMs + 30_000!
    const stallD5 = pushGem(curMs + 25_000, curMs + 35_000, 'gemini-4-carbon', 30_000, 100_000, 3_000);
    gemU5 += stallD5;
    gemU7 += stallD5 / 4.0;
    curMs += 30_000; // right inside [genEndTs, endTs] tool stall!
    attachQuotaBudgetEstimates(snap(curMs), { summaries: [{ latestTsMs: curMs, recentCalls: [...calls] }] }, { calibrationPath: calPath, fitPath, nowMs: curMs });

    // 8 clean Carbon-only short windows + 8 heterogeneous Claude Opus short windows (cache-miss + cache-hit + high-out)
    const opusMix = [
      [110_000, 100_000, 800],
      [15_000, 220_000, 2_000],
      [40_000, 240_000, 4_200],
      [6_000, 150_000, 2_400],
      [9_000, 145_000, 4_500],
      [8_000, 310_000, 3_200],
      [160_000, 10_000, 1_300],
      [3_000, 170_000, 600],
    ];
    let finalRes;
    curMs += 20_000; // clear previous stall endTs
    attachQuotaBudgetEstimates(snap(curMs), { summaries: [{ latestTsMs: curMs, recentCalls: [...calls] }] }, { calibrationPath: calPath, fitPath, nowMs: curMs });

    for (let i = 0; i < opusMix.length; i++) {
      const callTs = curMs + 15_000;
      const dG = pushGem(callTs, callTs + 500, 'gemini-4-carbon', 15_000 + i * 5_000, 80_000, 2_000 + i * 300);
      gemU5 += dG;
      gemU7 += dG / 4.0;
      const [ni, ca, ou] = opusMix[i];
      const dC = pushClaudeOpus(callTs, ni, ca, ou);
      claudeU5 += dC;
      claudeU7 += dC / 2.0;
      curMs += 35_000;
      finalRes = attachQuotaBudgetEstimates(
        snap(curMs),
        { summaries: [{ latestTsMs: curMs, recentCalls: [...calls] }] },
        { calibrationPath: calPath, fitPath, nowMs: curMs },
      );
    }

    // Verify P0: Gemini F_5h = $150 (NOT $102.6), Carbon k = 3.0, Hydrogen uses prior (beta = 0.6667, k = 1.0)
    const gemFit = finalRes.pools[0].fitSummary;
    assert.equal(gemFit.quality, 'high');
    assert.ok(Math.abs(gemFit.full5hUSD - 150) < 0.5, `expected F_5h ~150, got ${gemFit.full5hUSD}`);
    const carbonM = gemFit.models.find((m) => m.family === 'gemini-4-carbon');
    const hydroM = gemFit.models.find((m) => m.family === 'gemini-4-hydrogen');
    assert.ok(Math.abs(carbonM.k - 3.0) < 0.02);
    assert.ok(Math.abs(carbonM.beta - 2.0) < 0.01);
    assert.equal(hydroM.source, 'prior');
    assert.ok(Math.abs(hydroM.beta - 2 / 3) < 0.01);
    assert.ok(Math.abs(hydroM.k - 1.0) < 0.01);

    // Verify P2: tool-stall straddling sample was flagged boundaryClean === false
    const rawFitFile = JSON.parse(readFileSync(fitPath, 'utf-8'));
    const gemSamples = rawFitFile.pools['pro:google ai ultra:teams_tier_pro|gemini'].samples;
    assert.equal(gemSamples[1].boundaryClean, false);

    // Verify P1: Claude fits 3-param tokenWeights [~40, ~1.6, ~160] with OOS < 2.5%, AND stays 'provisional' (<12 short wins)
    const claudeFit = finalRes.pools[1].fitSummary;
    assert.equal(claudeFit.quality, 'provisional');
    assert.ok(claudeFit.oosRelErrPct !== null && claudeFit.oosRelErrPct < 2.5, `expected Claude OOS < 2.5%, got ${claudeFit.oosRelErrPct}`);
    const opusM = claudeFit.models.find((m) => m.family === 'claude-opus-5-5');
    assert.equal(opusM.mode, 'per_token');
    assert.ok(Array.isArray(opusM.tokenWeights) && opusM.tokenWeights.length === 3);
    assert.ok(Math.abs(opusM.tokenWeights[0] - 40) < 3.0);
    assert.ok(Math.abs(opusM.tokenWeights[1] - 1.6) < 0.25);
    assert.ok(Math.abs(opusM.tokenWeights[2] - 160) < 12.0);

    // Verify P3: Gemini 7d window still estimates external residual (~$6.00 + $1.80 boot = ~$6.45 on 7d) despite unmodeled gemini-3.8-flash!
    const gemWin7d = finalRes.pools[0].windows.find((w) => w.spanKey === '7d');
    assert.ok(gemWin7d.estRemoteUSD > 5.0 && gemWin7d.estRemoteUSD < 8.0, `expected 7d ext ~$6.45, got ${gemWin7d.estRemoteUSD}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discordant 2-sample startup rejects high-weight spike and locks onto clean sample', () => {
  const poolState = {
    gamma: 4.0,
    samples: [
      {
        t0: 1_000_000,
        t1: 1_020_000,
        dtSec: 20,
        du5: 0.208095,
        du7: 0.05202,
        source: '5h_delta',
        boundaryClean: true,
        isShort: true,
        tsMode: 'completed_v2',
        byModel: { 'gemini-4-neon': 0.0513123 },
        byModelTokens: { 'gemini-4-neon': [0.0057, 0.202, 0.00025] },
        callCount: 1, // highest weight (1/sqrt(1) = 1.0)
        totalBaseUSD: 0.0513123,
        nominalFamilies: [],
      },
      {
        t0: 1_020_000,
        t1: 1_060_000,
        dtSec: 40,
        du5: 0.06667,
        du7: 0.01667,
        source: '5h_delta',
        boundaryClean: true,
        isShort: true,
        tsMode: 'completed_v2',
        byModel: { 'gemini-4-neon': 0.10 },
        byModelTokens: { 'gemini-4-neon': [0.02, 0.1, 0.0017] },
        callCount: 9, // lower weight (1/sqrt(9) = 0.333)
        totalBaseUSD: 0.10,
        nominalFamilies: [],
      },
    ],
  };

  const fit = solvePoolFitModel(poolState, 'gemini');
  assert.ok(fit && fit.full5hUSD !== null);
  assert.ok(Math.abs(fit.full5hUSD - 150) < 2.0, `expected F_5h ~150 despite high-weight spike, got ${fit.full5hUSD}`);
  assert.equal(fit.anomalySpikeCount, 1);
});

test('drift guardrails & pricing invariants: Hydrogen 0.6667 prior check, +20% >3σ & OOS >0.5% auto-downgrade, pricingSig invalidation, and GA cutoff invariance', () => {
  // 1) Hydrogen short clean windows: exact beta_H = 0.6667 recovery vs +20% (0.800) >3σ drift downgrade
  const makeHydroState = (trueBetaH, oosJitter = 0) => ({
    gamma: 4.0,
    samples: Array.from({ length: 8 }, (_, i) => {
      const usd = 0.05 + i * 0.015;
      const mult = (i % 4 === 3 && oosJitter > 0) ? (1 + oosJitter) : 1;
      return {
        t0: 1_000_000 + i * 60_000,
        t1: 1_000_000 + (i + 1) * 60_000,
        dtSec: 60,
        du5: usd * trueBetaH * mult,
        du7: (usd * trueBetaH * mult) / 4.0,
        source: '5h_delta',
        boundaryClean: true,
        isShort: true,
        tsMode: 'completed_v2',
        byModel: { 'gemini-4-hydrogen': usd },
        byModelTokens: { 'gemini-4-hydrogen': [usd / 3, 0, usd / 15] },
        callCount: 1,
        totalBaseUSD: usd,
        nominalFamilies: [],
      };
    }),
  });

  const cleanHydro = makeHydroState(2 / 3);
  const fitOk = solvePoolFitModel(cleanHydro, 'gemini')!;
  assert.equal(fitOk.quality, 'high');
  assert.equal(fitOk.driftWarning, false);
  const hmOk = fitOk.models['gemini-4-hydrogen'];
  assert.ok(Math.abs(hmOk.beta - 2 / 3) < 0.002);
  assert.ok(Math.abs((hmOk.priorBeta ?? 0) - 2 / 3) < 1e-6);
  assert.ok(Math.abs(hmOk.priorRelDiffPct ?? 999) < 0.3);
  assert.ok((hmOk.priorZScore ?? 999) < 0.5);

  // +20% shift in beta_H (0.800 vs prior 0.6667 -> >3σ) must downgrade to provisional and flag driftWarning!
  const driftedHydro = makeHydroState(0.8);
  const fitDrift = solvePoolFitModel(driftedHydro, 'gemini')!;
  assert.equal(fitDrift.quality, 'provisional');
  assert.equal(fitDrift.driftWarning, true);
  assert.ok((fitDrift.driftReasons ?? []).some((r) => r.includes('gemini-4-hydrogen:prior_3sigma')));
  assert.ok(Math.abs((fitDrift.models['gemini-4-hydrogen'].priorRelDiffPct ?? 0) - 20) < 0.5);
  assert.ok((fitDrift.models['gemini-4-hydrogen'].priorZScore ?? 0) > 3.0);

  // Rolling OOS median error > 0.5% on Gemini must also downgrade to provisional!
  const noisyOosState = makeHydroState(2 / 3, 0.012); // 1.2% OOS error (> 0.5%)
  const fitOosWarn = solvePoolFitModel(noisyOosState, 'gemini')!;
  assert.equal(fitOosWarn.quality, 'provisional');
  assert.equal(fitOosWarn.driftWarning, true);
  assert.ok((fitOosWarn.driftReasons ?? []).some((r) => r.includes('oos_exceeded')));

  // 2) (a) pricingSig change recomputes token-backed samples and discards token-less stale samples
  const psStale = {
    pricingSig: 'old_sig_v0',
    samples: [
      {
        t0: 100,
        t1: 200,
        dtSec: 100,
        du5: 0.2,
        isShort: true,
        boundaryClean: true,
        tsMode: 'completed_v2',
        pricingSig: 'old_sig_v0',
        byModel: { 'gemini-4-carbon': 0.10 },
        byModelTokens: { 'gemini-4-carbon': [0.05, 0, 0] }, // 50k newIn
        callCount: 1,
        totalBaseUSD: 0.10,
      },
      {
        // Legacy sample with stale pricingSig and NO byModelTokens + outside DB coverage -> must be discarded!
        t0: 10,
        t1: 50,
        dtSec: 40,
        du5: 0.1,
        isShort: true,
        boundaryClean: true,
        tsMode: 'completed_v2',
        pricingSig: 'old_sig_v0',
        byModel: { 'gemini-4-carbon': 0.05 },
        callCount: 1,
        totalBaseUSD: 0.05,
      },
    ],
  };
  const changed = reconcilePoolSamplesPricing(psStale, {
    currentSig: 'new_sig_v1',
    rateFn: () => [4.0, 0.2, 20.0], // doubled input rate: 0.05M * $4.0 = $0.20
    allCalls: [],
    earliestCallTs: Infinity,
    poolKey: 'gemini',
  });
  assert.equal(changed, true);
  assert.equal(psStale.samples.length, 1); // stale token-less sample dropped
  assert.equal(psStale.samples[0].pricingSig, 'new_sig_v1');
  assert.ok(Math.abs(psStale.samples[0].totalBaseUSD - 0.20) < 1e-9); // recomputed from byModelTokens!

  // 3) (b) Post-2026-12-01 GA cutoff: display API cost switches 2x to GA, while fitter reference vector stays invariant!
  const preGaMs = Date.parse('2026-11-20T00:00:00Z');
  const postGaMs = Date.parse('2026-12-15T00:00:00Z');
  const costPre = computeCallCost('gemini-4-carbon', 'Gemini Carbon', 'gemini-4-carbon', 100_000, 500_000, 10_000, preGaMs);
  const costPost = computeCallCost('gemini-4-carbon', 'Gemini Carbon', 'gemini-4-carbon', 100_000, 500_000, 10_000, postGaMs);
  assert.equal(costPre.pricingKey, 'gemini-4-pro-preview');
  assert.equal(costPost.pricingKey, 'gemini-4-pro-ga');
  assert.ok(Math.abs(costPost.costUSD - costPre.costUSD * 2) < 1e-9);

  const baseRef = computeBaseReferenceUSD('gemini-4-carbon', 'Gemini Carbon', 'gemini-4-carbon', 100_000, 500_000, 10_000);
  assert.ok(Math.abs(baseRef.baseUSD - costPre.costUSD) < 1e-9); // always preview reference ($0.35), never $0.70!

  // 4) loadQuotaFitStore auto-reconciles token-backed v2 pools on disk when pricingSig changes
  const autoDir = mkdtempSync(join(tmpdir(), 'agy-hud-autofit-'));
  try {
    const autoFitPath = join(autoDir, 'quota-model-fit.json');
    const tokVec = [0.1, 0.2, 0.01]; // 0.1*1.5 + 0.2*0.075 + 0.01*7.5 = $0.24 under Hydrogen ($150 pool -> du5 = 0.16%)
    const staleWrongUSD = 0.1 * 0.75 + 0.2 * 0.075 + 0.01 * 3.75; // $0.1275 under old Flash mismatch
    const seededSamples = Array.from({ length: 6 }, (_, i) => ({
      t0: 2_000_000 + i * 30_000,
      t1: 2_000_000 + (i + 1) * 30_000,
      dtSec: 30,
      du5: 0.16,
      du7: 0.04,
      source: '5h_delta',
      boundaryClean: true,
      isShort: true,
      tsMode: 'completed_v2',
      pricingSig: 'stale_sig_before_fix',
      byModel: { 'gemini-4-hydrogen': staleWrongUSD },
      byModelTokens: { 'gemini-4-hydrogen': tokVec },
      callCount: 1,
      totalBaseUSD: staleWrongUSD,
      nominalFamilies: [],
    }));
    writeFileSync(
      autoFitPath,
      JSON.stringify({
        version: 1,
        pools: {
          'pro:google ai ultra:teams_tier_pro|gemini': {
            gamma: 4.0,
            pricingSig: 'stale_sig_before_fix',
            samples: seededSamples,
            fit: { schemaVersion: 3, quality: 'provisional', driftWarning: true, full5hUSD: 79.7 },
          },
        },
      }),
      'utf8',
    );
    const healedStore = loadQuotaFitStore(autoFitPath);
    const healedPool = healedStore.pools['pro:google ai ultra:teams_tier_pro|gemini'];
    assert.equal(healedPool.pricingSig, getCurrentPricingSig());
    assert.ok(Math.abs(healedPool.samples[0].totalBaseUSD - 0.24) < 1e-9);
    assert.equal(healedPool.fit?.quality, 'high');
    assert.equal(healedPool.fit?.driftWarning, false);
    assert.ok(Math.abs((healedPool.fit?.full5hUSD ?? 0) - 150) < 0.5);
    const persisted = JSON.parse(readFileSync(autoFitPath, 'utf8'));
    assert.equal(persisted.pools['pro:google ai ultra:teams_tier_pro|gemini'].fit.quality, 'high');
  } finally {
    rmSync(autoDir, { recursive: true, force: true });
  }
});

test('adaptive MAD 6σ outlier rejection (<0.01% bias on 30+1 +54% spike) and GetUserStatus stale-cache rewind guard', () => {
  // 1) 30 exact Carbon short windows + 1 (+54%) window + 1 (+310%) spike -> beta bias < 0.01%!
  const samples: any[] = [];
  for (let i = 0; i < 30; i++) {
    const usd = 0.04 + (i % 7) * 0.025;
    samples.push({
      t0: 1_000_000 + i * 40_000,
      t1: 1_000_000 + (i + 1) * 40_000,
      dtSec: 40,
      du5: Number((usd * 2.0).toFixed(6)),
      du7: Number((usd * 0.5).toFixed(6)),
      source: '5h_delta',
      boundaryClean: true,
      isShort: true,
      tsMode: 'completed_v2',
      byModel: { 'gemini-4-carbon': usd },
      byModelTokens: { 'gemini-4-carbon': [usd / 4, 0, usd / 20] },
      callCount: 1,
      totalBaseUSD: usd,
      nominalFamilies: [],
    });
  }
  // Insert +54% window into trainSet (index 10, 10 % 4 !== 3) and +310% window (index 14, 14 % 4 !== 3)
  samples.splice(10, 0, {
    t0: 2_500_000,
    t1: 2_621_000,
    dtSec: 121,
    du5: 0.59858,
    du7: 0.14965,
    source: '5h_delta',
    boundaryClean: true,
    isShort: true,
    tsMode: 'completed_v2',
    byModel: { 'gemini-4-carbon': 0.194494 }, // true pred = 0.388988 -> +53.9%
    byModelTokens: { 'gemini-4-carbon': [0.05, 0.5, 0.0044494] },
    callCount: 4,
    totalBaseUSD: 0.194494,
    nominalFamilies: [],
  });
  samples.splice(14, 0, {
    t0: 2_700_000,
    t1: 2_738_000,
    dtSec: 38,
    du5: 0.566834,
    du7: 0.141709,
    source: '5h_delta',
    boundaryClean: true,
    isShort: true,
    tsMode: 'completed_v2',
    byModel: { 'gemini-4-carbon': 0.0551935 }, // true pred = 0.110387 -> +413%
    byModelTokens: { 'gemini-4-carbon': [0.01, 0.2, 0.00151935] },
    callCount: 1,
    totalBaseUSD: 0.0551935,
    nominalFamilies: [],
  });

  const ps = { gamma: 4.0, samples };
  const fit = solvePoolFitModel(ps, 'gemini')!;
  const relBias = Math.abs(fit.models['gemini-4-carbon'].beta - 2.0) / 2.0;
  assert.ok(relBias < 0.0001, `expected beta relative bias < 0.01% (0.0001), got ${relBias}`);
  assert.ok(Math.abs((fit.full5hUSD ?? 0) - 150) < 0.015);
  assert.equal(fit.quality, 'high');
  assert.equal(fit.anomalySpikeCount, 1);

  // 2) Stale GetUserStatus ('user_status' 5h-only backward jump) must NEVER rewind lastSnap or create a rebound spike!
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-stale-rewind-'));
  const fitPath = join(dir, 'quota-model-fit.json');
  try {
    const baseTs = 1_830_000_000_000;
    const reset5h = baseTs + 3 * 3_600_000;
    const reset7d = baseTs + 4 * 24 * 3_600_000;

    // Step 1: live RetrieveUserQuotaSummary at 15.592708% used
    ingestQuotaObservation(
      {
        available: true,
        source: 'summary',
        planName: 'Pro',
        tierName: 'Google AI Ultra',
        teamsTier: 'TEAMS_TIER_PRO',
        fetchedAtMs: baseTs,
        pools: [{
          label: 'Gemini',
          remainingPct: 100 - 15.592708,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: 100 - 15.592708, resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: 75.0, resetAtMs: reset7d },
          ],
        }],
      },
      { summaries: [] },
      { fitPath, nowMs: baseTs },
    );

    // Step 2: 30s later, RetrieveUserQuotaSummary times out -> degraded 'user_status' returns frozen 15.308041% (-0.284667% rewind!)
    ingestQuotaObservation(
      {
        available: true,
        source: 'user_status',
        planName: 'Pro',
        tierName: 'Google AI Ultra',
        teamsTier: 'TEAMS_TIER_PRO',
        fetchedAtMs: baseTs + 30_000,
        pools: [{
          label: 'Gemini',
          remainingPct: 100 - 15.308041,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: 100 - 15.308041, resetAtMs: reset5h },
          ],
        }],
      },
      { summaries: [] },
      { fitPath, nowMs: baseTs + 30_000 },
    );

    // Step 3: 42s later, 1 Carbon call ($0.0486455 -> +0.097291%) finishes and RetrieveUserQuotaSummary succeeds at 15.689999%
    const call = {
      ts: baseTs + 66_000,
      genUncertainStartTs: baseTs + 66_000,
      poolKey: 'gemini',
      family: 'gemini-4-carbon',
      modelId: 'gemini-4-carbon',
      newInput: 3722,
      cachedInput: 264913,
      outputTokens: 1471,
      baseUSD: 0.0486453,
      costUSD: 0.0486453,
      priced: true,
    };
    const storeAfter = ingestQuotaObservation(
      {
        available: true,
        source: 'summary',
        planName: 'Pro',
        tierName: 'Google AI Ultra',
        teamsTier: 'TEAMS_TIER_PRO',
        fetchedAtMs: baseTs + 72_000,
        pools: [{
          label: 'Gemini',
          remainingPct: 100 - 15.689999,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: 100 - 15.689999, resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: 74.975677, resetAtMs: reset7d },
          ],
        }],
      },
      { summaries: [{ latestTsMs: baseTs + 66_000, recentCalls: [call] }] },
      { fitPath, nowMs: baseTs + 72_000 },
    );

    const gemPs = storeAfter.pools['pro:google ai ultra:teams_tier_pro|gemini'];
    const lastDelta = gemPs.samples[gemPs.samples.length - 1];
    // Recorded du5 is exact 0.097291% (NOT 0.381958%!)
    assert.ok(Math.abs(lastDelta.du5 - 0.097291) < 1e-5, `expected exact 0.097291%, got ${lastDelta.du5}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcilePoolSamplesPricing and FAMILY_CLASSIFIER_VERSION heal misfiled Orchestrator (Neon) samples and Neon nominal flags', () => {
  const sigNow = getCurrentPricingSig();
  const baseTs = 1_840_000_000_000;
  const allCalls: any[] = [];
  const samples: any[] = [];

  for (let i = 0; i < 6; i++) {
    const t0 = baseTs + i * 60_000;
    const t1 = t0 + 40_000;
    const callTs = t0 + 20_000;
    const orchIn = 40_000 + i * 5_000;
    const orchCa = 100_000;
    const orchOut = 2_000;
    const neonIn = 20_000 + i * 3_000;
    const neonCa = 50_000;
    const neonOut = 1_000;

    // True Neon cost: ($3*in + $0.15*cache + $15*out)/1e6, 1x on $150 pool
    const trueOrchUSD = (orchIn * 3 + orchCa * 0.15 + orchOut * 15) / 1e6;
    const trueNeonUSD = (neonIn * 3 + neonCa * 0.15 + neonOut * 15) / 1e6;
    const du5 = ((trueOrchUSD + trueNeonUSD) / 150) * 100;

    allCalls.push(
      {
        ts: callTs,
        genUncertainStartTs: callTs,
        poolKey: 'gemini',
        modelId: 'gemini-pro-orchestrator-neon',
        modelDisplay: 'Orchestrator (Neon)',
        model: 'gemini-pro-orchestrator-neon',
        newInput: orchIn,
        cachedInput: orchCa,
        outputTokens: orchOut,
        costUSD: trueOrchUSD,
        priced: true,
      },
      {
        ts: callTs + 5000,
        genUncertainStartTs: callTs + 5000,
        poolKey: 'gemini',
        modelId: 'gemini-4-neon',
        modelDisplay: 'Gemini 4 Neon (High)',
        model: 'gemini-4-neon',
        newInput: neonIn,
        cachedInput: neonCa,
        outputTokens: neonOut,
        costUSD: trueNeonUSD,
        priced: true,
      },
    );

    // Seed pre-fix buggy sample: Orchestrator (Neon) was misfiled as gemini-4-carbon (2/0.1/10)
    // and Gemini 4 Neon (High) fell back to nominal [1.5, 0.1, 7.5] with 'gemini-4-neon' in nominalFamilies!
    const oldCarbonUSD = (orchIn * 2 + orchCa * 0.1 + orchOut * 10) / 1e6;
    const oldNomNeonUSD = (neonIn * 1.5 + neonCa * 0.1 + neonOut * 7.5) / 1e6;
    samples.push({
      t0,
      t1,
      dtSec: 40,
      du5,
      du7: du5 / 4,
      source: '5h_delta',
      boundaryClean: true,
      isShort: true,
      tsMode: 'completed_v2',
      pricingSig: 'old_sig_before_neon',
      byModel: { 'gemini-4-carbon': oldCarbonUSD, 'gemini-4-neon': oldNomNeonUSD },
      byModelTokens: {
        'gemini-4-carbon': [orchIn / 1e6, orchCa / 1e6, orchOut / 1e6],
        'gemini-4-neon': [neonIn / 1e6, neonCa / 1e6, neonOut / 1e6],
      },
      callCount: 2,
      totalBaseUSD: oldCarbonUSD + oldNomNeonUSD,
      nominalFamilies: ['gemini-4-neon'],
    });
  }

  // Also include a clean empty external-burn sample (must be preserved, not dropped!)
  samples.push({
    t0: baseTs + 6 * 60_000,
    t1: baseTs + 6 * 60_000 + 30_000,
    dtSec: 30,
    du5: 1.0,
    du7: 0.25,
    source: '7d_scaled',
    boundaryClean: true,
    isShort: true,
    tsMode: 'completed_v2',
    pricingSig: 'old_sig_before_neon',
    byModel: {},
    byModelTokens: {},
    callCount: 0,
    totalBaseUSD: 0,
    nominalFamilies: [],
  });

  const ps = { gamma: 4.0, pricingSig: 'old_sig_before_neon', samples };

  // 1) Token-only reconcile (cold loadQuotaFitStore, allCalls: []): updates pricingSig and clears nominalFamilies,
  //    preserves empty external-burn sample, and leaves familyVersion unbumped so DB re-agg runs next!
  const changedCold = reconcilePoolSamplesPricing(ps, {
    currentSig: sigNow,
    allCalls: [],
    earliestCallTs: Infinity,
    poolKey: 'gemini',
  });
  assert.equal(changedCold, true);
  assert.equal(ps.samples.length, 7);
  assert.equal(ps.pricingSig, sigNow);
  assert.equal(ps.samples[0].pricingSig, sigNow);
  assert.deepEqual(ps.samples[0].nominalFamilies, []);
  assert.equal(ps.samples[0].familyVersion, undefined);
  assert.equal(ps.samples[6].pricingSig, sigNow);

  // Calling token-only reconcile again when pricingSig matches and allCalls is empty must be a no-op!
  assert.equal(
    reconcilePoolSamplesPricing(ps, { currentSig: sigNow, allCalls: [], earliestCallTs: Infinity, poolKey: 'gemini' }),
    false,
  );

  // 2) Full reconcile with raw allCalls: moves Orchestrator (Neon) tokens out of gemini-4-carbon into gemini-4-neon!
  const changedDb = reconcilePoolSamplesPricing(ps, {
    currentSig: sigNow,
    allCalls,
    earliestCallTs: baseTs,
    poolKey: 'gemini',
  });
  assert.equal(changedDb, true);
  assert.equal(ps.samples.length, 7);
  for (let i = 0; i < 6; i++) {
    assert.equal(ps.samples[i].familyVersion, FAMILY_CLASSIFIER_VERSION);
    assert.equal(ps.samples[i].byModel['gemini-4-carbon'], undefined);
    assert.equal(ps.samples[i].byModelTokens['gemini-4-carbon'], undefined);
    assert.ok(ps.samples[i].byModel['gemini-4-neon'] > 0);
    assert.deepEqual(ps.samples[i].nominalFamilies, []);
  }
  assert.equal(ps.samples[6].familyVersion, FAMILY_CLASSIFIER_VERSION);
  assert.equal(ps.samples[6].callCount, 0);

  // Second DB reconcile must be strictly idempotent
  assert.equal(
    reconcilePoolSamplesPricing(ps, { currentSig: sigNow, allCalls, earliestCallTs: baseTs, poolKey: 'gemini' }),
    false,
  );

  const fit = solvePoolFitModel(ps, 'gemini')!;
  assert.equal(fit.quality, 'high');
  assert.equal(fit.driftWarning, false);
  assert.ok(Math.abs((fit.full5hUSD ?? 0) - 150) < 0.5, `expected full5hUSD ~150, got ${fit.full5hUSD}`);
  assert.ok(Math.abs(fit.models['gemini-4-neon'].k - 1.0) < 0.01);
  assert.equal(fit.models['gemini-4-carbon'], undefined);
});
