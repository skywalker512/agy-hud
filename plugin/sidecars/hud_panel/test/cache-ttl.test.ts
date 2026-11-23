import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCacheTtlOverview,
  buildCacheTtlStats,
  evalCacheSurvival,
  fitCacheSurvivalModel,
  getCacheTtlPrior,
  solveTimeForSurvival,
  summarizeConversationDb,
} from '../server.ts';
import type { CacheGapSample } from '../lib/cache-ttl.ts';
import {
  bField,
  buildGenMetadataBlob,
  buildStepMetadata,
  createSchema,
  durationMsg,
  vField,
} from './helpers/fixtures.ts';

function writeTestDb(
  dbPath: string,
  { steps, gens }: { steps: { idx: number; stepType: number; status: number; metadata: Buffer }[]; gens: { idx: number; data: Buffer }[] },
) {
  const db = createSchema(dbPath);
  const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, NULL)');
  for (const s of steps) insStep.run(s.idx, s.stepType, s.status, s.metadata);
  const insGen = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
  for (const g of gens) insGen.run(g.idx, g.data);
  db.close();
}

function buildGenWithBotId(opts: Parameters<typeof buildGenMetadataBlob>[0] & { botId?: string }) {
  const { botId, ...rest } = opts;
  if (!botId) return buildGenMetadataBlob(rest);
  const usage = Buffer.concat([
    vField(2, rest.newIn ?? 5_000),
    vField(3, rest.output ?? 244),
    vField(5, rest.cached ?? 100_000),
    bField(7, botId),
    vField(9, rest.thinking ?? 88),
    vField(10, rest.candidate ?? 156),
  ]);
  const ctxInner = Buffer.concat([
    vField(1, rest.reportedCtx ?? ((rest.cached ?? 100_000) + (rest.newIn ?? 5_000))),
    vField(4, rest.ctxLimit ?? 512_000),
  ]);
  const inner = Buffer.concat([
    vField(3, rest.modelEnum ?? 1532),
    bField(4, usage),
    bField(9, bField(10, ctxInner)),
    bField(11, durationMsg(rest.ttftSec ?? 2.0)),
    bField(12, durationMsg(rest.genSec ?? 3.0)),
    bField(19, rest.modelId ?? 'gemini-4-neon'),
    bField(21, rest.modelDisplay ?? 'Gemini 4 Neon'),
  ]);
  return bField(1, inner);
}

test('evalCacheSurvival and solveTimeForSurvival are monotonic and invert accurately', () => {
  const params = { bgMissRate: 0.015, t50Sec: 1200, shapeK: 2.0 };
  const s0 = evalCacheSurvival(params, 0);
  const s1 = evalCacheSurvival(params, 300);
  const s2 = evalCacheSurvival(params, 1200);
  const s3 = evalCacheSurvival(params, 3600);
  assert.ok(s0 > s1 && s1 > s2 && s2 > s3);
  assert.ok(Math.abs(s0 - 0.985) < 1e-6);

  for (const q of [0.8, 0.5, 0.2]) {
    const t = solveTimeForSurvival(params, q);
    const back = evalCacheSurvival(params, t);
    assert.ok(Math.abs(back - q) < 1e-4, `expected ${back} ≈ ${q}`);
  }
  assert.equal(solveTimeForSurvival(params, 0.995), 0);
});

test('fitCacheSurvivalModel distinguishes Gemini LRU decay from Claude 5m hard TTL cliff', () => {
  // Synthetic Gemini Hydrogen data: gradual decay centered around ~18m (1080s)
  const geminiSamples: CacheGapSample[] = [];
  let seq = 0;
  const addBatch = (arr: CacheGapSample[], family: string, gapSec: number, hits: number, misses: number) => {
    for (let i = 0; i < hits; i++) {
      arr.push({
        key: `${family}:${seq++}`,
        family,
        idleGapSec: gapSec,
        prevPromptTokens: 100_000,
        cachedInput: 98_000,
        retention: 0.98,
        hit: true,
        missCostUSD: 0,
        ts: 1_700_000_000_000 + seq * 1000,
      });
    }
    for (let i = 0; i < misses; i++) {
      arr.push({
        key: `${family}:${seq++}`,
        family,
        idleGapSec: gapSec,
        prevPromptTokens: 100_000,
        cachedInput: 0,
        retention: 0,
        hit: false,
        missCostUSD: gapSec >= 60 ? 0.1425 : 0,
        ts: 1_700_000_000_000 + seq * 1000,
      });
    }
  };

  addBatch(geminiSamples, 'gemini-4-hydrogen', 20, 198, 2);
  addBatch(geminiSamples, 'gemini-4-hydrogen', 180, 19, 1);
  addBatch(geminiSamples, 'gemini-4-hydrogen', 480, 12, 3);
  addBatch(geminiSamples, 'gemini-4-hydrogen', 1080, 10, 10);
  addBatch(geminiSamples, 'gemini-4-hydrogen', 2100, 3, 12);
  addBatch(geminiSamples, 'gemini-4-hydrogen', 5400, 0, 10);

  const gFit = fitCacheSurvivalModel('gemini-4-hydrogen', geminiSamples);
  assert.equal(gFit.providerKind, 'gemini');
  assert.equal(gFit.confidence, 'fitted');
  assert.ok(gFit.p50Sec >= 750 && gFit.p50Sec <= 1500, `expected gemini p50 ~1080s, got ${gFit.p50Sec}`);
  assert.ok(gFit.p80Sec > 300 && gFit.p80Sec < gFit.p50Sec, `expected p80 < p50, got ${gFit.p80Sec} vs ${gFit.p50Sec}`);
  assert.ok(gFit.shapeK < 4.0, `expected gradual LRU shapeK < 4, got ${gFit.shapeK}`);
  assert.equal(gFit.expiredMissCount, 36);
  assert.ok(gFit.missCostUSD > 4.5);

  // Synthetic Claude Sonnet data: hard cliff right at 5m (300s)
  const claudeSamples: CacheGapSample[] = [];
  addBatch(claudeSamples, 'claude-sonnet-5-5', 30, 80, 1);
  addBatch(claudeSamples, 'claude-sonnet-5-5', 240, 18, 0);
  addBatch(claudeSamples, 'claude-sonnet-5-5', 285, 10, 1);
  addBatch(claudeSamples, 'claude-sonnet-5-5', 320, 0, 12);
  addBatch(claudeSamples, 'claude-sonnet-5-5', 420, 0, 10);

  const cFit = fitCacheSurvivalModel('claude-sonnet-5-5', claudeSamples);
  assert.equal(cFit.providerKind, 'claude');
  assert.equal(cFit.confidence, 'fitted');
  assert.ok(cFit.p50Sec >= 270 && cFit.p50Sec <= 335, `expected claude p50 ~300s, got ${cFit.p50Sec}`);
  assert.ok(cFit.shapeK > gFit.shapeK * 2, `expected claude cliff shapeK (${cFit.shapeK}) >> gemini (${gFit.shapeK})`);
});

test('fitCacheSurvivalModel falls back to provider prior on cold start', () => {
  const prior = getCacheTtlPrior('claude-opus-5-5');
  const fit = fitCacheSurvivalModel('claude-opus-5-5', []);
  assert.equal(fit.confidence, 'prior');
  assert.equal(fit.t50Sec, prior.t50Sec);
  assert.equal(fit.sampleCount, 0);
  assert.equal(fit.buckets.length, 7);
});

test('summarizeConversationDb extracts clean cache pairs, excludes compactions/switches/rewinds, and deduplicates forks', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agy-hud-cache-ttl-'));
  try {
    const t0 = 1_760_000_000;
    const db1Path = join(tmpDir, 'conv-main.db');
    const db2Path = join(tmpDir, 'conv-fork.db');

    const rows = [
      // #0: initial prompt 100k
      {
        idx: 0,
        stepIdx: 1,
        createdSec: t0,
        completedSec: t0 + 5,
        gen: buildGenWithBotId({ botId: 'bot-0', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon', cached: 0, newIn: 100_000 }),
      },
      // #1: 4m later, HIT (98k cached) -> valid pair (gap = 240s, hit=true)
      {
        idx: 1,
        stepIdx: 3,
        createdSec: t0 + 5 + 240,
        completedSec: t0 + 5 + 240 + 6,
        gen: buildGenWithBotId({ botId: 'bot-1', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon', cached: 98_000, newIn: 6_000 }),
      },
      // #2: 25m later, MISS (0 cached, 108k new) -> valid pair (gap = 1500s, hit=false, missCostUSD > 0)
      {
        idx: 2,
        stepIdx: 5,
        createdSec: t0 + 5 + 240 + 6 + 1500,
        completedSec: t0 + 5 + 240 + 6 + 1500 + 8,
        gen: buildGenWithBotId({ botId: 'bot-2', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon', cached: 0, newIn: 108_000 }),
      },
      // #3: after compaction (step_type=23 at stepIdx=6) -> MUST be excluded!
      {
        idx: 3,
        stepIdx: 7,
        createdSec: t0 + 5 + 240 + 6 + 1500 + 40,
        completedSec: t0 + 5 + 240 + 6 + 1500 + 45,
        gen: buildGenWithBotId({ botId: 'bot-3', modelId: 'gemini-4-neon', modelDisplay: 'Gemini 4 Neon', cached: 0, newIn: 30_000 }),
      },
      // #4: model switch to hydrogen -> MUST be excluded!
      {
        idx: 4,
        stepIdx: 9,
        createdSec: t0 + 5 + 240 + 6 + 1500 + 60,
        completedSec: t0 + 5 + 240 + 6 + 1500 + 64,
        gen: buildGenWithBotId({ botId: 'bot-4', modelId: 'gemini-4-hydrogen', modelDisplay: 'Gemini 4 Hydrogen', cached: 0, newIn: 35_000 }),
      },
    ];

    const makeStepsAndGens = () => ({
      steps: [
        ...rows.map((r) => ({
          idx: r.stepIdx,
          stepType: 15,
          status: 3,
          metadata: buildStepMetadata({
            createdSec: r.createdSec,
            completedSec: r.completedSec,
            gmIdx: r.idx,
          }),
        })),
        {
          idx: 6,
          stepType: 23,
          status: 3,
          metadata: buildStepMetadata({
            createdSec: t0 + 5 + 240 + 6 + 1500 + 20,
            completedSec: t0 + 5 + 240 + 6 + 1500 + 25,
            gmIdx: 3,
          }),
        },
      ],
      gens: rows.map((r) => ({ idx: r.idx, data: r.gen })),
    });

    writeTestDb(db1Path, makeStepsAndGens());
    // Forked conversation containing the exact same botIds
    writeTestDb(db2Path, makeStepsAndGens());

    const sum1 = summarizeConversationDb({ id: 'conv-main', dbPath: db1Path, key: 'k1', annoKey: 'a1', updatedMs: (t0 + 2000) * 1000 });
    const sum2 = summarizeConversationDb({ id: 'conv-fork', dbPath: db2Path, key: 'k2', annoKey: 'a2', updatedMs: (t0 + 2000) * 1000 });

    // Only pairs #0->#1 and #1->#2 are valid (compaction #2->#3 and model switch #3->#4 excluded)
    assert.equal(sum1.cachePairs.length, 2);
    assert.equal(sum1.cachePairs[0].hit, true);
    assert.equal(sum1.cachePairs[0].idleGapSec, 240);
    assert.equal(sum1.cachePairs[1].hit, false);
    assert.equal(sum1.cachePairs[1].idleGapSec, 1500);
    assert.ok(sum1.cachePairs[1].missCostUSD > 0.25, `expected neon 104k miss cost ~$0.30, got ${sum1.cachePairs[1].missCostUSD}`);

    // Global stats across both main + fork must deduplicate by botId -> still 2 pairs, not 4!
    const stats = buildCacheTtlStats([sum1, sum2]);
    assert.equal(stats.totalPairs, 2);
    assert.equal(stats.totalLongGapPairs, 2);
    assert.equal(stats.totalExpiredMisses, 1);
    assert.equal(stats.models.length, 1);
    assert.equal(stats.models[0].family, 'gemini-4-neon');

    // Current session prediction includes missPenaltyUSD & quota penalty
    const overview = buildCacheTtlOverview(
      [sum1, sum2],
      {
        latest: {
          modelId: 'gemini-4-neon',
          modelDisplay: 'Gemini 4 Neon',
          model: 'gemini-4-neon',
          totalPromptTokens: 200_000,
          totalContext: 200_000,
          timestampMs: (t0 + 2000) * 1000,
        },
        summary: { latestCallMs: (t0 + 2000) * 1000 },
      },
      {
        available: true,
        pools: [
          {
            label: 'Gemini',
            fitSummary: {
              models: [{ family: 'gemini-4-neon', beta: 2.0, k: 1.0 }],
            },
          },
        ],
      },
    );
    assert.ok(overview.currentSession);
    assert.equal(overview.currentSession.family, 'gemini-4-neon');
    assert.equal(overview.currentSession.cachedContextTokens, 200_000);
    // 200k * ($3.00 - $0.15) / 1e6 = $0.57
    assert.ok(Math.abs(overview.currentSession.missPenaltyUSD - 0.57) < 0.01);
    // 0.57 * beta(2.0) = 1.14% 5h quota
    assert.ok(overview.currentSession.missPenaltyQuota5hPct !== null);
    assert.ok(Math.abs(overview.currentSession.missPenaltyQuota5hPct - 1.14) < 0.05);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
