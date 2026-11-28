import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAccountHistory,
  buildCacheTtlOverview,
  buildCacheTtlStats,
  buildSessionInfo,
  evalCacheSurvival,
  fitCacheSurvivalModel,
  getCacheTtlPrior,
  getConversationGraph,
  parseParentReference,
  readTelemetry,
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

function buildGenWithBotId(
  opts: Parameters<typeof buildGenMetadataBlob>[0] & { botId?: string; sessionId?: string; lastStepIndex?: number; cascadeId?: string },
) {
  const { botId, sessionId, lastStepIndex, cascadeId, ...rest } = opts;
  if (!botId && !sessionId && lastStepIndex === undefined && !cascadeId) return buildGenMetadataBlob(rest);
  const usageParts = [
    vField(2, rest.newIn ?? 5_000),
    vField(3, rest.output ?? 244),
    vField(5, rest.cached ?? 100_000),
  ];
  if (botId) usageParts.push(bField(7, botId));
  if (sessionId) {
    usageParts.push(bField(8, Buffer.concat([bField(1, 'sessionID'), bField(2, sessionId)])));
  }
  usageParts.push(vField(9, rest.thinking ?? 88), vField(10, rest.candidate ?? 156));
  const usage = Buffer.concat(usageParts);
  const ctxInner = Buffer.concat([
    vField(1, rest.reportedCtx ?? ((rest.cached ?? 100_000) + (rest.newIn ?? 5_000))),
    vField(4, rest.ctxLimit ?? 512_000),
  ]);
  const innerParts: Buffer[] = [
    vField(3, rest.modelEnum ?? 1532),
    bField(4, usage),
    bField(9, bField(10, ctxInner)),
    bField(11, durationMsg(rest.ttftSec ?? 2.0)),
    bField(12, durationMsg(rest.genSec ?? 3.0)),
    bField(19, rest.modelId ?? 'gemini-4-neon'),
    bField(21, rest.modelDisplay ?? 'Gemini 4 Neon'),
  ];
  if (lastStepIndex !== undefined) {
    innerParts.push(bField(20, Buffer.concat([bField(1, 'last_step_index'), bField(2, String(lastStepIndex))])));
  }
  if (cascadeId) {
    innerParts.push(bField(20, Buffer.concat([bField(1, 'cascade_id'), bField(2, cascadeId)])));
  }
  return bField(1, Buffer.concat(innerParts));
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

test('Side-Q fork deduplicates inherited calls, isolates cold start from TTL, and tracks reverts + Gemini 2K floor', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agy-hud-side-revert-'));
  try {
    const parentId = '11111111-1111-4111-8111-111111111111';
    const sideId = '22222222-2222-4222-8222-222222222222';
    const oldTrajId = '33333333-3333-4333-8333-333333333333';
    const parentDbPath = join(tmpDir, `${parentId}.db`);
    const sideDbPath = join(tmpDir, `${sideId}.db`);
    const t0 = 1_760_100_000;

    // Verify parseParentReference handles valid step and u64(-1) reset sentinel
    const validRef = parseParentReference(Buffer.concat([bField(1, oldTrajId), vField(2, 5), bField(6, parentId)]));
    assert.equal(validRef.parentTrajectoryId, oldTrajId);
    assert.equal(validRef.stepIndex, 5);
    assert.equal(validRef.isResetToStart, false);
    assert.equal(validRef.parentCascadeId, parentId);

    const resetRef = parseParentReference(Buffer.concat([bField(1, oldTrajId), vField(2, 18446744073709551615n), bField(6, parentId)]));
    assert.equal(resetRef.stepIndex, null);
    assert.equal(resetRef.isResetToStart, true);

    // Parent DB: 4 calls with a revert at step 5 (between gm#1 step=5 and gm#2 step=7) and a Gemini 2K tail floor at gm#3
    const pDb = createSchema(parentDbPath);
    pDb.prepare('INSERT INTO trajectory_meta (trajectory_type) VALUES (?)').run(4);
    pDb.prepare('INSERT INTO parent_references (idx, data) VALUES (?, ?)').run(
      0,
      Buffer.concat([bField(1, oldTrajId), vField(2, 5), bField(6, parentId)]),
    );
    const parentRows = [
      // gm#0 step=1: initial 20k
      { idx: 0, stepIdx: 1, cSec: t0, dSec: t0 + 5, cached: 0, newIn: 20_000, botId: 'p-bot-0', sess: 'sess-parent' },
      // gm#1 step=5: normal hit 20001 + 2500 = 22501
      { idx: 1, stepIdx: 5, cSec: t0 + 25, dSec: t0 + 30, cached: 20_001, newIn: 2_500, botId: 'p-bot-1', sess: 'sess-parent' },
      // gm#2 step=7: after revert to step 5 (gap=80s), same sessionID -> 91.6% cache kept! (22502 + 2050 = 24552)
      { idx: 2, stepIdx: 7, cSec: t0 + 110, dSec: t0 + 115, cached: 22_502, newIn: 2_050, botId: 'p-bot-2', sess: 'sess-parent' },
      // gm#3 step=9: short follow-up (+900 tokens < 2048) -> Gemini 2K tail floor: cached = 24552 - 2049 = 22503, new = 2949 (hit=88.4%)
      { idx: 3, stepIdx: 9, cSec: t0 + 135, dSec: t0 + 140, cached: 22_503, newIn: 2_949, botId: 'p-bot-3', sess: 'sess-parent' },
    ];
    for (const r of parentRows) {
      pDb.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, 15, 3, ?, NULL)').run(
        r.stepIdx,
        buildStepMetadata({ createdSec: r.cSec, completedSec: r.dSec, gmIdx: r.idx }),
      );
      pDb.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        r.idx,
        buildGenWithBotId({
          botId: r.botId,
          sessionId: r.sess,
          lastStepIndex: r.stepIdx - 1,
          cascadeId: parentId,
          modelId: 'gemini-4-neon',
          modelDisplay: 'Gemini 4 Neon',
          cached: r.cached,
          newIn: r.newIn,
        }),
      );
    }
    pDb.close();

    // Side DB: copies parent's 4 calls up to step 9 (forkStepIndex = 9), then adds 2 own calls:
    //   gm#4 (step=11, gap=20s): 1st own call -> new sessionID, hits only 16,989 global prefix out of 180k (side_cold!)
    //   gm#5 (step=13, gap=15s): 2nd own call -> 98% hit inside side conversation
    const sDb = createSchema(sideDbPath);
    sDb.prepare('INSERT INTO trajectory_meta (trajectory_type) VALUES (?)').run(22);
    sDb.prepare('INSERT INTO parent_references (idx, data) VALUES (?, ?)').run(
      0,
      Buffer.concat([bField(1, oldTrajId), vField(2, 9), bField(6, parentId)]),
    );
    const sideRows = [
      ...parentRows.slice(0, 3),
      { idx: 3, stepIdx: 9, cSec: t0 + 135, dSec: t0 + 140, cached: 170_000, newIn: 10_000, botId: 'p-bot-3', sess: 'sess-parent', cascade: parentId },
      { idx: 4, stepIdx: 11, cSec: t0 + 160, dSec: t0 + 168, cached: 16_989, newIn: 165_011, botId: 's-bot-4', sess: 'sess-side', cascade: sideId },
      { idx: 5, stepIdx: 13, cSec: t0 + 183, dSec: t0 + 189, cached: 182_001, newIn: 3_000, botId: 's-bot-5', sess: 'sess-side', cascade: sideId },
    ];
    for (const r of sideRows) {
      sDb.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, 15, 3, ?, NULL)').run(
        r.stepIdx,
        buildStepMetadata({ createdSec: r.cSec, completedSec: r.dSec, gmIdx: r.idx }),
      );
      sDb.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        r.idx,
        buildGenWithBotId({
          botId: r.botId,
          sessionId: r.sess,
          lastStepIndex: r.stepIdx - 1,
          cascadeId: (r as any).cascade || parentId,
          modelId: 'gemini-4-neon',
          modelDisplay: 'Gemini 4 Neon',
          cached: r.cached,
          newIn: r.newIn,
        }),
      );
    }
    sDb.close();

    const convList = [
      { id: sideId, dbPath: sideDbPath, annoPath: '', key: 'sk', annoKey: 'sa', updatedMs: (t0 + 200) * 1000, dbMtimeMs: (t0 + 200) * 1000 },
      { id: parentId, dbPath: parentDbPath, annoPath: '', key: 'pk', annoKey: 'pa', updatedMs: (t0 + 140) * 1000, dbMtimeMs: (t0 + 140) * 1000 },
    ];

    const graph = getConversationGraph(convList, { syncAll: true });
    const pSum = graph.byId.get(parentId);
    const sSum = graph.byId.get(sideId);

    // Side DB must only count its 2 own calls (4 inherited calls deduplicated!)
    assert.equal(pSum.calls, 4);
    assert.equal(sSum.calls, 2);
    assert.equal(sSum.inheritedCalls, 4);
    assert.equal(sSum.forkStepIndex, 9);
    assert.ok(sSum.firstOwnCacheHitPct !== null && sSum.firstOwnCacheHitPct < 10);
    assert.ok(sSum.sideColdCostUSD > 0.4, `expected side cold penalty > $0.40, got ${sSum.sideColdCostUSD}`);

    // Account history & session tree totals must sum 4 + 2 = 6 calls (zero double-counting!)
    const hist = buildAccountHistory(graph, (t0 + 300) * 1000);
    assert.equal(hist.totalCalls, 6);
    const pSession = buildSessionInfo(parentId, graph);
    assert.equal(pSession.treeTotals.calls, 6);
    assert.equal(pSession.childSessions[0].calls, 2);
    assert.equal(pSession.childSessions[0].inheritedCalls, 4);

    // Cache TTL stats: Side cold start MUST NOT pollute <1m cachePairs, and MUST be tracked separately alongside reverts!
    const ttlStats = buildCacheTtlStats(graph.summaries);
    // Parent has 3 valid pairs (#0->#1, #1->#2, #2->#3), Side has 1 valid own pair (#4->#5) -> total 4 pairs, ALL hits!
    assert.equal(ttlStats.totalPairs, 4);
    assert.equal(ttlStats.models[0].missCount, 0);
    assert.equal(ttlStats.sideColdStartCount, 1);
    assert.equal(ttlStats.sideSysPrefixOnlyCount, 1);
    assert.ok(ttlStats.sideColdStartCostUSD > 0.4);
    assert.equal(ttlStats.revertTotalCount, 1);
    assert.equal(ttlStats.revertKeptCount, 1);

    // readTelemetry diagnostics: parent sees revert_kept & gemini_2k_floor; side sees forkInfo, inherited flag, own-only summary, & side_cold!
    const pTel = readTelemetry(parentDbPath, convList, (t0 + 140) * 1000);
    assert.equal(pTel.reverts.length, 1);
    assert.equal(pTel.reverts[0].stepIdx, 5);
    assert.equal(pTel.reverts[0].cacheKept, true);
    assert.equal(pTel.invocations[2].cacheDiag?.kind, 'revert_kept');
    assert.equal(pTel.invocations[3].cacheDiag?.kind, 'gemini_2k_floor');

    const sTel = readTelemetry(sideDbPath, convList, (t0 + 200) * 1000);
    assert.equal(sTel.summary.count, 2);
    assert.equal(sTel.summary.inheritedCount, 4);
    assert.ok(sTel.forkInfo);
    assert.equal(sTel.forkInfo.forkStepIndex, 9);
    assert.equal(sTel.forkInfo.sysPrefixOnly, true);
    assert.equal(sTel.forkInfo.sessionChanged, true);
    assert.equal(sTel.invocations[3].isInherited, true);
    assert.equal(sTel.invocations[4].isInherited, false);
    assert.equal(sTel.invocations[4].cacheDiag?.kind, 'side_cold');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
