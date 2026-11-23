import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { parseProcessCommandLines } from '../lib/constants.ts';
import { poolKeyForModel } from '../lib/pricing.ts';
import { resolveModelFamily } from '../lib/quota-solver.ts';
import {
  buildAccountHistory,
  computeBaseReferenceUSD,
  computeCallCost,
  getConversationGraph,
  listConversations,
  pickTargetConversation,
  resolveAllAppDataDirs,
  summarizeConversationDb,
} from '../server.ts';
import {
  bField,
  buildGenMetadataBlob,
  buildPlannerStepPayload,
  buildStepMetadata,
  createSchema,
  durationMsg,
  vField,
} from './helpers/fixtures.ts';

test('pickTargetConversation prevents Calls 3 <-> 6 oscillation from idle WAL checkpoints or subagents', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-target-'));
  try {
    const convDir = join(root, 'conversations');
    const annoDir = join(root, 'annotations');
    mkdirSync(convDir, { recursive: true });
    mkdirSync(annoDir, { recursive: true });

    const oldSixCallsId = '68f3a538-8789-4d13-b0b5-dbfa727695fa';
    const currentThreeCallsId = 'ff88a419-709a-4a6c-8906-05213320d9a5';
    const subagentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // 1) Previous conversation with 6 calls (true step timestamp = 1,700,000,000s)
    const oldDbPath = join(convDir, `${oldSixCallsId}.db`);
    {
      const db = createSchema(oldDbPath);
      const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
      const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < 6; i++) {
        insGm.run(i, buildGenMetadataBlob({ output: 120 }));
        insStep.run(
          i,
          15,
          3,
          buildStepMetadata({ createdSec: 1_700_000_000 + i * 10, completedSec: 1_700_000_005 + i * 10, gmIdx: i }),
          null
        );
      }
      db.close();
    }

    // 2) Active main conversation with 3 calls (true step timestamp = 1,700_005_000s, i.e. 83 minutes newer)
    const curDbPath = join(convDir, `${currentThreeCallsId}.db`);
    {
      const db = createSchema(curDbPath);
      const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
      const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
      for (let i = 0; i < 3; i++) {
        insGm.run(i, buildGenMetadataBlob({ output: 150 }));
        insStep.run(
          i,
          15,
          3,
          buildStepMetadata({ createdSec: 1_700_005_000 + i * 10, completedSec: 1_700_005_005 + i * 10, gmIdx: i }),
          null
        );
      }
      db.close();
    }

    // 3) Subagent conversation spawned by currentThreeCallsId with even newer step timestamp
    const subDbPath = join(convDir, `${subagentId}.db`);
    {
      const db = createSchema(subDbPath);
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(0, buildGenMetadataBlob({ output: 80 }));
      db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)').run(
        0,
        15,
        3,
        buildStepMetadata({ createdSec: 1_700_005_500, completedSec: 1_700_005_505, gmIdx: 0 }),
        null
      );
      // Link subagent -> parent via parent_references (field 6 = parent UUID)
      db.prepare('INSERT INTO parent_references (idx, data) VALUES (?, ?)').run(
        0,
        bField(6, currentThreeCallsId)
      );
      db.close();
    }

    // Simulate an idle SQLite WAL truncate checkpoint bumping oldSixCallsId's filesystem mtime AFTER currentThreeCallsId!
    const oldWalPath = `${oldDbPath}-wal`;
    writeFileSync(oldWalPath, Buffer.alloc(0));
    const baseSec = 1_700_006_000;
    utimesSync(curDbPath, baseSec, baseSec);
    utimesSync(oldDbPath, baseSec + 120, baseSec + 120);
    utimesSync(oldWalPath, baseSec + 180, baseSec + 180);
    utimesSync(subDbPath, baseSec + 240, baseSec + 240);

    const conversations = listConversations(convDir, annoDir);
    // Raw filesystem mtime order puts subagent and oldSixCallsId ahead of currentThreeCallsId:
    assert.equal(conversations[0].id, subagentId);
    assert.equal(conversations[1].id, oldSixCallsId);

    const graph = getConversationGraph(conversations, { syncAll: true });
    const picked = pickTargetConversation({
      mode: 'auto',
      explicitConvId: '',
      conversations,
      graph,
      lsSummaries: null,
      prevAutoTargetId: currentThreeCallsId,
      nowMs: (baseSec + 250) * 1000,
    });
    assert.equal(picked.id, currentThreeCallsId);
    assert.equal(graph.byId.get(picked.id).calls, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computeCallCost and summarizeConversationDb price orchestrator/flash-worker, backfill enums, and include /compact spend', () => {
  const orchCost = computeCallCost(
    'gemini-pro-orchestrator',
    'Orchestrator (Carbon)',
    'gemini-pro-orchestrator',
    100_000,
    500_000,
    10_000,
    1_700_000_000_000,
  );
  assert.equal(orchCost.priced, true);
  assert.equal(orchCost.pricingKey, 'gemini-4-pro-preview');
  assert.ok(Math.abs(orchCost.costUSD - 0.35) < 1e-9);

  const flashCost = computeCallCost(
    'gemini-flash-worker-agy',
    'Gemini Flash',
    'gemini-flash-worker-agy',
    100_000,
    500_000,
    10_000,
    1_700_000_000_000,
  );
  assert.equal(flashCost.priced, true);
  assert.equal(flashCost.pricingKey, 'gemini-3.8-flash');

  const hydOrchCost = computeCallCost(
    'gemini-flash-worker-agy',
    'Gemini 4 Hydrogen (Orchestrator)',
    'gemini-flash-worker-agy',
    100_000,
    500_000,
    10_000,
    1_700_000_000_000,
  );
  assert.equal(hydOrchCost.priced, true);
  assert.equal(hydOrchCost.pricingKey, 'gemini-4-hydrogen');
  assert.ok(Math.abs(hydOrchCost.costUSD - 0.2625) < 1e-9);

  const hydOrchBase = computeBaseReferenceUSD(
    'gemini-flash-worker-agy',
    'Gemini 4 Hydrogen (Orchestrator)',
    'gemini-flash-worker-agy',
    100_000,
    500_000,
    10_000,
  );
  assert.equal(hydOrchBase.family, 'gemini-4-hydrogen');
  assert.deepEqual(hydOrchBase.rates, [1.5, 0.075, 7.5]);
  assert.ok(Math.abs(hydOrchBase.baseUSD - 0.2625) < 1e-9);

  // Gemini 4 Neon ($3.00 / $0.15 / $15.00): 100k*3 + 500k*0.15 + 10k*15 = $0.525
  const neonCost = computeCallCost('gemini-4-neon', 'Gemini 4 Neon (High)', 'gemini-4-neon', 100_000, 500_000, 10_000, 1_700_000_000_000);
  assert.equal(neonCost.priced, true);
  assert.equal(neonCost.pricingKey, 'gemini-4-neon');
  assert.ok(Math.abs(neonCost.costUSD - 0.525) < 1e-9);
  const neonBase = computeBaseReferenceUSD('gemini-4-neon', 'Gemini 4 Neon (High)', 'gemini-4-neon', 100_000, 500_000, 10_000);
  assert.equal(neonBase.family, 'gemini-4-neon');
  assert.equal(neonBase.poolKey, 'gemini');
  assert.deepEqual(neonBase.rates, [3.0, 0.15, 15.0]);

  // Orchestrator (Neon) must match Neon rule ($3.00 / $0.15 / $15.00), NOT Carbon's 'gemini-pro-orchestrator' substring!
  const orchNeonCost = computeCallCost('gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', 'gemini-pro-orchestrator-neon', 100_000, 500_000, 10_000, 1_700_000_000_000);
  assert.equal(orchNeonCost.priced, true);
  assert.equal(orchNeonCost.pricingKey, 'gemini-4-neon');
  assert.ok(Math.abs(orchNeonCost.costUSD - 0.525) < 1e-9);
  assert.equal(resolveModelFamily('gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', 'gemini-pro-orchestrator-neon'), 'gemini-4-neon');
  assert.equal(poolKeyForModel('gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', 'gemini-pro-orchestrator-neon'), 'gemini');

  // Orchestrator (Argon) prices via Gemini 4 Pro preview/GA rule and pools with 'gemini'
  const orchArgonCost = computeCallCost('gemini-pro-orchestrator-argon', 'Orchestrator (Argon)', 'gemini-pro-orchestrator-argon', 100_000, 500_000, 10_000, 1_700_000_000_000);
  assert.equal(orchArgonCost.priced, true);
  assert.equal(orchArgonCost.pricingKey, 'gemini-4-pro-preview');
  assert.ok(Math.abs(orchArgonCost.costUSD - 0.35) < 1e-9);
  assert.equal(resolveModelFamily('gemini-pro-orchestrator-argon', 'Orchestrator (Argon)', 'gemini-pro-orchestrator-argon'), 'gemini-4-argon');
  assert.equal(poolKeyForModel('gemini-pro-orchestrator-argon', 'Orchestrator (Argon)', 'gemini-pro-orchestrator-argon'), 'gemini');

  const ossCost = computeCallCost('gpt-oss-120b', 'GPT-OSS', 'gpt-oss-120b', 100_000, 0, 1_000, 1_700_000_000_000);
  assert.equal(ossCost.priced, false);
  assert.equal(ossCost.costUSD, 0);

  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-sum-compact-'));
  const dbPath = join(dir, 'conv.db');
  try {
    const nowSec = Math.floor(Date.now() / 1000) - 300;
    const db = createSchema(dbPath);
    const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    const insStep = db.prepare(
      'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)'
    );

    // Call 0: enum 1667 with empty modelId/modelDisplay -> backfilled via KNOWN_MODEL_ENUMS
    insGm.run(0, buildGenMetadataBlob({
      modelId: '',
      modelDisplay: '',
      modelEnum: 1667,
      newIn: 50_000,
      cached: 0,
      output: 1_000,
    }));
    insStep.run(
      0,
      15,
      3,
      buildStepMetadata({ createdSec: nowSec, streamStartSec: nowSec + 1, completedSec: nowSec + 3, gmIdx: 0 }),
      buildPlannerStepPayload({ reply: 'Plan step' })
    );

    // Call 1: flash worker
    insGm.run(1, buildGenMetadataBlob({
      modelId: 'gemini-flash-worker-agy',
      modelDisplay: 'Gemini Flash',
      modelEnum: 1669,
      newIn: 100_000,
      cached: 0,
      output: 2_000,
    }));
    insStep.run(
      1,
      15,
      3,
      buildStepMetadata({ createdSec: nowSec + 10, streamStartSec: nowSec + 11, completedSec: nowSec + 13, gmIdx: 1 }),
      buildPlannerStepPayload({ reply: 'Exec step' })
    );

    // Completed /compact step with usage on enum 1667
    const compactUsage = Buffer.concat([
      vField(1, 1667),
      vField(2, 50_000),
      vField(3, 1_000),
      vField(5, 0),
      vField(9, 200),
      vField(10, 800),
    ]);
    const compactMeta = Buffer.concat([
      bField(1, durationMsg(nowSec + 20)),
      bField(7, durationMsg(nowSec + 25)),
      bField(8, durationMsg(nowSec + 25)),
      bField(9, compactUsage),
    ]);
    insStep.run(2, 23, 3, compactMeta, bField(30, bField(5, 'Summary')));
    db.close();

    const conv = {
      id: '11111111-1111-1111-1111-111111111111',
      dbPath,
      annoPath: null,
      key: '1',
      annoKey: '',
      updatedMs: (nowSec + 25) * 1000,
      dbMtimeMs: (nowSec + 25) * 1000,
    };
    const sum = summarizeConversationDb(conv);
    assert.equal(sum.calls, 2);
    assert.equal(sum.pricedCount, 3);
    assert.equal(sum.unpricedCount, 0);
    assert.equal(sum.recentCalls.length, 3);
    const expectedOrch = computeCallCost('gemini-pro-orchestrator', 'Orchestrator (Carbon)', '', 50_000, 0, 1_000, nowSec * 1000).costUSD;
    const expectedFlash = computeCallCost('gemini-flash-worker-agy', 'Gemini Flash', '', 100_000, 0, 2_000, (nowSec + 10) * 1000).costUSD;
    assert.ok(Math.abs(sum.costUSD - (expectedOrch * 2 + expectedFlash)) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveAllAppDataDirs merges antigravity and sibling antigravity-cli stores into buildAccountHistory', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-multiroot-'));
  try {
    const appDir = join(root, 'antigravity');
    const cliDir = join(root, 'antigravity-cli');
    const appConvDir = join(appDir, 'conversations');
    const cliConvDir = join(cliDir, 'conversations');
    mkdirSync(appConvDir, { recursive: true });
    mkdirSync(cliConvDir, { recursive: true });

    const nowSec = Math.floor(Date.now() / 1000) - 120;
    const appId = '11111111-1111-1111-1111-111111111111';
    const cliId = '22222222-2222-2222-2222-222222222222';

    const writeDb = (dbPath, outputTok) => {
      const db = createSchema(dbPath);
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        0,
        buildGenMetadataBlob({ newIn: 100_000, cached: 0, output: outputTok })
      );
      db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)').run(
        0,
        15,
        3,
        buildStepMetadata({ createdSec: nowSec, streamStartSec: nowSec + 1, completedSec: nowSec + 3, gmIdx: 0 }),
        buildPlannerStepPayload({ reply: 'ok' })
      );
      db.close();
    };

    writeDb(join(appConvDir, `${appId}.db`), 1_000);
    writeDb(join(cliConvDir, `${cliId}.db`), 2_000);

    const roots = resolveAllAppDataDirs(appDir);
    assert.equal(roots.length, 2);
    assert.deepEqual(roots.map((r) => r.source), ['app', 'cli']);

    const convs = listConversations(roots, '', 0);
    assert.equal(convs.length, 2);
    const graph = getConversationGraph(convs, { syncAll: true });
    const history = buildAccountHistory(graph);
    assert.equal(history.dbCount, 2);
    assert.equal(history.dbCountBySource.app, 1);
    assert.equal(history.dbCountBySource.cli, 1);
    assert.equal(history.callsBySource.app, 1);
    assert.equal(history.callsBySource.cli, 1);
    assert.ok(history.costBySource.cli > history.costBySource.app);
    assert.ok(Math.abs(history.totalCostUSD - (history.costBySource.app + history.costBySource.cli)) < 1e-9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveAllAppDataDirs discovers running agy/acp across OS command formats, persists discovered-roots.json, and trajectory_meta.source=17 classifies cli', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-acp-'));
  try {
    const appDir = join(root, '.gemini', 'antigravity');
    const siblingAcpDir = join(root, '.gemini', 'antigravity-acp');
    const externalAcpDir = join(root, 'any-wrapper', 'hash1234', 'antigravity-acp');
    const customGeminiDir = join(root, 'custom gemini');
    const customCliDir = join(customGeminiDir, 'antigravity-cli');
    const customFlagDir = join(root, 'explicit-abs-app');
    const rootsPath = join(root, 'discovered-roots.json');

    for (const d of [appDir, siblingAcpDir, externalAcpDir, customCliDir, customFlagDir]) {
      mkdirSync(join(d, 'conversations'), { recursive: true });
    }

    const fakePs = [
      '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper --type=renderer --user-data-dir=/tmp/x',
      `/Users/sky/.local/bin/agy acp --gemini-dir ${join(root, 'any-wrapper', 'hash1234')} --app-data-dir antigravity-acp`,
      `agy --gemini-dir="${customGeminiDir}" -p "hello"`,
      `/usr/local/bin/agy --app-data-dir ${customFlagDir}`,
      'CommandLine="C:\\Users\\sky\\AppData\\Local\\agy.exe" acp --gemini-dir "C:\\Users\\sky\\AppData\\Roaming\\T3\\hash" --app-data-dir antigravity-acp',
    ].join('\n');

    const parsed = parseProcessCommandLines(fakePs, root);
    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed.map((p) => p.source), ['cli', 'cli', 'cli', 'cli']);
    assert.ok(parsed.some((p) => p.appDataDir.includes('C:\\Users\\sky\\AppData\\Roaming\\T3\\hash')));

    // 1. Live process discovery writes discovered-roots.json
    const rootsLive = resolveAllAppDataDirs(appDir, {
      discoverExternal: true,
      homeDir: root,
      discoveredRootsPath: rootsPath,
      processCommands: fakePs,
    });
    const dirsLive = rootsLive.map((r) => r.appDataDir);
    assert.ok(dirsLive.includes(appDir));
    assert.ok(dirsLive.includes(siblingAcpDir));
    assert.ok(dirsLive.includes(externalAcpDir));
    assert.ok(dirsLive.includes(customCliDir));
    assert.ok(dirsLive.includes(customFlagDir));

    // 2. After process exits (empty processCommands), persisted discovered-roots.json keeps the roots
    const rootsAfterExit = resolveAllAppDataDirs(appDir, {
      discoverExternal: true,
      homeDir: root,
      discoveredRootsPath: rootsPath,
      processCommands: '',
    });
    const dirsAfterExit = rootsAfterExit.map((r) => r.appDataDir);
    assert.ok(dirsAfterExit.includes(externalAcpDir));
    assert.ok(dirsAfterExit.includes(customCliDir));
    assert.ok(dirsAfterExit.includes(customFlagDir));

    // 3. DB-level trajectory_meta.source = 17 classifies a conversation as 'cli' regardless of folder name
    const arbitraryDir = join(root, 'arbitrary-folder');
    mkdirSync(join(arbitraryDir, 'conversations'), { recursive: true });
    const convId = '33333333-3333-3333-3333-333333333333';
    const dbPath = join(arbitraryDir, 'conversations', `${convId}.db`);
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
      CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB, step_payload BLOB);
      CREATE TABLE trajectory_meta (trajectory_id TEXT PRIMARY KEY, cascade_id TEXT, trajectory_type INTEGER, source INTEGER);
    `);
    db.prepare('INSERT INTO trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) VALUES (?, ?, ?, ?)').run(
      'traj-1',
      convId,
      4,
      17,
    );
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
      0,
      buildGenMetadataBlob({ newIn: 10_000, cached: 0, output: 500 }),
    );
    db.close();

    const convs = listConversations([{ appDataDir: arbitraryDir, conversationsDir: join(arbitraryDir, 'conversations'), annotationsDir: '', source: 'app' }], '', 0);
    const graph = getConversationGraph(convs, { syncAll: true });
    assert.equal(graph.byId.get(convId)?.source, 'cli');
    assert.equal(graph.sourceCounts.cli, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dailyHeatmap exposes additive newTokens/cachedTokens iceberg split and 52-week days52 history', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-iceberg-52w-'));
  try {
    const appConvDir = join(root, 'antigravity', 'conversations');
    const cliConvDir = join(root, 'antigravity-cli', 'conversations');
    mkdirSync(appConvDir, { recursive: true });
    mkdirSync(cliConvDir, { recursive: true });

    // Anchor "now" to Tue 2026-11-17 15:00 local time
    const nowMs = new Date(2026, 10, 17, 15, 0, 0).getTime();
    const todaySec = Math.floor(new Date(2026, 10, 17, 11, 0, 0).getTime() / 1000);
    const old30wSec = Math.floor(new Date(2026, 3, 21, 11, 0, 0).getTime() / 1000); // ~30 weeks earlier (outside 16w, inside 52w)

    const appId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const cliId = 'bbbbbbbb-1111-2222-3333-444444444444';

    // App DB: one call today (newIn=10_000, cached=80_000, output=2_500 [thinking 1_000 + candidate 1_500])
    // plus one call ~30 weeks ago (newIn=40_000, cached=200_000, output=5_000)
    {
      const db = createSchema(join(appConvDir, `${appId}.db`));
      const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
      const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
      insGm.run(0, buildGenMetadataBlob({ newIn: 40_000, cached: 200_000, output: 5_000, thinking: 2_000, candidate: 3_000 }));
      insStep.run(0, 15, 3, buildStepMetadata({ createdSec: old30wSec, completedSec: old30wSec + 5, gmIdx: 0 }), null);

      insGm.run(1, buildGenMetadataBlob({ newIn: 10_000, cached: 80_000, output: 2_500, thinking: 1_000, candidate: 1_500 }));
      insStep.run(1, 15, 3, buildStepMetadata({ createdSec: todaySec, completedSec: todaySec + 4, gmIdx: 1 }), null);
      db.close();
    }

    // CLI DB: one call today (newIn=4_000, cached=20_000, output=1_000)
    {
      const db = createSchema(join(cliConvDir, `${cliId}.db`));
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        0,
        buildGenMetadataBlob({ newIn: 4_000, cached: 20_000, output: 1_000, thinking: 400, candidate: 600 }),
      );
      db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)').run(
        0,
        15,
        3,
        buildStepMetadata({ createdSec: todaySec + 60, completedSec: todaySec + 63, gmIdx: 0 }),
        null,
      );
      db.close();
    }

    const roots = resolveAllAppDataDirs(join(root, 'antigravity'));
    const convs = listConversations(roots, '', 0);
    const graph = getConversationGraph(convs, { syncAll: true });
    const history = buildAccountHistory(graph, nowMs);
    const hm = history.dailyHeatmap;

    // Backward-compatible 16w grid
    assert.equal(hm.weeks, 16);
    assert.equal(hm.activeDays, 1);
    assert.equal(hm.days[hm.days.length - 1].date, '2026-11-17');

    // Additive 52w grid
    assert.equal(hm.weeks52, 52);
    assert.ok(Array.isArray(hm.days52));
    assert.ok(hm.days52.length >= 358 && hm.days52.length <= 364);
    assert.equal(hm.days52[hm.days52.length - 1].date, '2026-11-17');
    const [f52y, f52m, f52d] = hm.days52[0].date.split('-').map(Number);
    assert.equal(new Date(f52y, f52m - 1, f52d, 12, 0, 0).getDay(), 1); // Monday-aligned
    assert.deepEqual(hm.days52.slice(hm.days52.length - hm.days.length), hm.days);
    assert.equal(hm.activeDays52, 2);
    assert.equal(hm.peakDate52, '2026-04-21');
    assert.ok(hm.peakCostUSD52 > hm.peakCostUSD);

    // Iceberg split on today (app + cli combined):
    // newTokens = (10_000 + 2_500) + (4_000 + 1_000) = 17_500 (no double counting of thinking)
    // cachedTokens = 80_000 + 20_000 = 100_000
    const todayEntry = hm.days[hm.days.length - 1];
    assert.equal(todayEntry.calls, 2);
    assert.equal(todayEntry.appCalls, 1);
    assert.equal(todayEntry.cliCalls, 1);
    assert.equal(todayEntry.outputTokens, 3_500);
    assert.equal(todayEntry.newTokens, 17_500);
    assert.equal(todayEntry.cachedTokens, 100_000);

    // Iceberg split on 30w-old day inside days52:
    const oldEntry = hm.days52.find((d) => d.date === '2026-04-21');
    assert.ok(oldEntry);
    assert.equal(oldEntry.calls, 1);
    assert.equal(oldEntry.newTokens, 45_000);
    assert.equal(oldEntry.cachedTokens, 200_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
