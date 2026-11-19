import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
  buildAccountHistory,
  clipLiveStreamText,
  computeBaseReferenceUSD,
  computeCallCost,
  extractLiveStepFromTrajectory,
  getConversationGraph,
  ingestQuotaObservation,
  isLoopbackHost,
  iterFields,
  listConversations,
  parseGenRow,
  parsePlannerPayload,
  pickTargetConversation,
  readDurationSec,
  readTelemetry,
  readVarint,
  reconcilePoolSamplesPricing,
  resolveAllAppDataDirs,
  resolveLsGeneratorModel,
  solvePoolFitModel,
  summarizeConversationDb,
} from '../server.mjs';
import { parseProcessCommandLines } from '../lib/constants.mjs';
import { getCurrentPricingSig, poolKeyForModel } from '../lib/pricing.mjs';
import { FAMILY_CLASSIFIER_VERSION, loadQuotaFitStore, resolveModelFamily } from '../lib/quota-fitter.mjs';

function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function vField(fieldNum, value) {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 0), encodeVarint(value)]);
}

function bField(fieldNum, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return Buffer.concat([encodeVarint((fieldNum << 3) | 2), encodeVarint(buf.length), buf]);
}

function durationMsg(secFloat) {
  const sec = Math.floor(secFloat);
  const nanos = Math.round((secFloat - sec) * 1e9);
  const parts = [];
  if (sec > 0) parts.push(vField(1, sec));
  if (nanos > 0) parts.push(vField(2, nanos));
  return Buffer.concat(parts);
}

function buildGenMetadataBlob({
  modelId = 'gemini-4-carbon',
  modelDisplay = 'Gemini 4 Carbon',
  modelEnum = 1037,
  cached = 100_000,
  newIn = 5_000,
  output = 244,
  thinking = 88,
  candidate = 156,
  reportedCtx = 105_000,
  ctxLimit = 256_000,
  ttftSec = 2.0,
  genSec = 4.0,
}) {
  const usage = Buffer.concat([
    vField(2, newIn),
    vField(3, output),
    vField(5, cached),
    vField(9, thinking),
    vField(10, candidate),
  ]);
  const ctxInner = Buffer.concat([vField(1, reportedCtx), vField(4, ctxLimit)]);
  const ctxOuter = bField(10, ctxInner);
  const inner = Buffer.concat([
    vField(3, modelEnum),
    bField(4, usage),
    bField(9, ctxOuter),
    bField(11, durationMsg(ttftSec)),
    bField(12, durationMsg(genSec)),
    bField(19, modelId),
    bField(21, modelDisplay),
  ]);
  return bField(1, inner);
}

function buildStepMetadata({
  createdSec = 0,
  streamStartSec = 0,
  completedSec = 0,
  endSec = 0,
  modelEnum = null,
  toolName = '',
  gmIdx = null,
}) {
  const parts = [];
  if (createdSec > 0) parts.push(bField(1, durationMsg(createdSec)));
  if (toolName) parts.push(bField(4, bField(2, toolName)));
  if (streamStartSec > 0) parts.push(bField(6, durationMsg(streamStartSec)));
  if (completedSec > 0) parts.push(bField(7, durationMsg(completedSec)));
  if (endSec > 0) parts.push(bField(8, durationMsg(endSec)));
  if (modelEnum !== null) parts.push(vField(11, modelEnum));
  if (gmIdx !== null) parts.push(bField(20, vField(3, gmIdx)));
  return Buffer.concat(parts);
}

function buildPlannerStepPayload({ thinking = '', reply = '', toolCalls = [] }) {
  const parts = [];
  if (reply) parts.push(bField(1, reply));
  if (thinking) parts.push(bField(3, thinking));
  for (const tc of toolCalls) {
    parts.push(bField(7, Buffer.concat([bField(2, tc.name), bField(3, tc.args || '')])));
  }
  return bField(20, Buffer.concat(parts));
}

function createSchema(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER,
      status INTEGER,
      metadata BLOB,
      step_payload BLOB
    );
    CREATE TABLE parent_references (idx INTEGER PRIMARY KEY, data BLOB);
    CREATE TABLE trajectory_meta (trajectory_type INTEGER);
  `);
  return db;
}

test('protobuf varint and duration decoders round-trip cleanly', () => {
  const msg = durationMsg(27.944);
  assert.ok(Math.abs(readDurationSec(msg) - 27.944) < 1e-6);
  const [val, next] = readVarint(encodeVarint(256_000), 0);
  assert.equal(val, 256_000n);
  assert.equal(next, encodeVarint(256_000).length);
  assert.equal([...iterFields(msg)].length, 2);
});

test('readTelemetry excludes buffered turns from avgGenTps and detects #8-style tool-call stalls + clamped tool intervals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-test-'));
  try {
    const dbPath = join(dir, 'ff88a419-709a-4a6c-8906-05213320d9a5.db');
    const db = createSchema(dbPath);
    const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    const insStep = db.prepare(
      'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)'
    );

    // Call #1 (gmIdx=0): sustained multi-tool turn (500 tok over 10s = 50 tok/s)
    // Tool 1 finishes streaming at t=1037.184 while planner finishes at t=1039.606; tool execution ends at t=1040.606 (true exec = 1.0s).
    insGm.run(
      0,
      buildGenMetadataBlob({
        output: 500,
        thinking: 200,
        candidate: 300,
        ttftSec: 5.0,
        genSec: 10.0,
      })
    );
    insStep.run(
      0,
      14,
      3,
      buildStepMetadata({ createdSec: 1024.0, completedSec: 1024.0 }),
      bField(19, bField(2, 'Inspect codebase'))
    );
    insStep.run(
      1,
      15,
      3,
      buildStepMetadata({
        createdSec: 1024.6,
        streamStartSec: 1029.606,
        completedSec: 1039.606,
        endSec: 1039.606,
        gmIdx: 0,
      }),
      buildPlannerStepPayload({
        thinking: 'Checking files',
        toolCalls: [
          { name: 'read_file', args: '{"Path":"/a"}' },
          { name: 'read_file', args: '{"Path":"/b"}' },
        ],
      })
    );
    insStep.run(
      2,
      132,
      3,
      buildStepMetadata({
        createdSec: 1035.0,
        streamStartSec: 1037.184, // Tool 1 finished streaming 2.422s BEFORE planner finished
        completedSec: 1037.184,
        endSec: 1040.606,
        toolName: 'read_file',
        gmIdx: 0,
      }),
      null
    );

    // Call #2 (gmIdx=1): single-packet buffered turn (300 tok in 2ms -> artificial genTps = 150,000 tok/s)
    insGm.run(
      1,
      buildGenMetadataBlob({
        output: 300,
        thinking: 50,
        candidate: 250,
        ttftSec: 6.0,
        genSec: 0.002,
      })
    );
    insStep.run(
      3,
      15,
      3,
      buildStepMetadata({
        createdSec: 1041.0,
        streamStartSec: 1047.0,
        completedSec: 1047.002,
        endSec: 1047.002,
        gmIdx: 1,
      }),
      buildPlannerStepPayload({ reply: 'Short buffered reply' })
    );

    // Call #3 (gmIdx=2): #8-style slow tool-call turn (244 tok in 27.944s = 8.73 tok/s: 0.599s thinking + 27.345s tool gen stall)
    insGm.run(
      2,
      buildGenMetadataBlob({
        cached: 153_600,
        newIn: 6_400,
        output: 244,
        thinking: 88,
        candidate: 156,
        reportedCtx: 160_000,
        ctxLimit: 256_000,
        ttftSec: 26.951,
        genSec: 27.944,
      })
    );
    insStep.run(
      4,
      15,
      3,
      buildStepMetadata({
        createdSec: 1725.139,
        streamStartSec: 1752.09,
        completedSec: 1780.034,
        endSec: 1780.034,
        gmIdx: 2,
      }),
      buildPlannerStepPayload({
        thinking: 'Need to run syntax check',
        toolCalls: [{ name: 'run_command', args: '{"CommandLine":"node --check server.mjs"}' }],
      })
    );
    insStep.run(
      5,
      132,
      3,
      buildStepMetadata({
        createdSec: 1752.689,
        streamStartSec: 1780.033,
        completedSec: 1780.033,
        endSec: 1782.998, // 2.964s post-planner tool execution
        toolName: 'run_command',
        gmIdx: 2,
      }),
      null
    );
    db.close();

    const parsed1 = parseGenRow(1, buildGenMetadataBlob({ output: 300, ttftSec: 6.0, genSec: 0.002 }));
    assert.equal(parsed1.isBuffered, true);

    const tel = readTelemetry(dbPath);
    assert.equal(tel.invocations.length, 3);
    assert.ok(
      tel.summary.avgGenTps <= tel.summary.peakGenTps,
      `avgGenTps (${tel.summary.avgGenTps}) must never exceed peakGenTps (${tel.summary.peakGenTps})`
    );
    assert.equal(tel.summary.peakGenTps, 50);

    const slowCall = tel.invocations[2];
    assert.equal(slowCall.isToolStall, true);
    assert.equal(slowCall.stepToolCount, 1);
    assert.ok(Math.abs(slowCall.thinkSec - 0.599) < 0.01);
    assert.ok(Math.abs(slowCall.toolGenSec - 27.345) < 0.01);

    // Total tool execution time = 1.000s (from call #1, clamped at 1039.606) + 2.964s (from call #3, clamped at 1780.034) = 3.964s
    assert.ok(
      Math.abs(tel.summary.totalToolSec - 3.964) < 0.02,
      `expected clamped totalToolSec ~3.964s, got ${tel.summary.totalToolSec}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parsePlannerPayload and clipLiveStreamText preserve full detail and sliding tail for #9-scale 25k thinking', () => {
  const longThinking = `${'A'.repeat(25_800)}TAIL_MARKER_25848`;
  const payload = buildPlannerStepPayload({ thinking: longThinking, reply: 'Done.' });

  const detail = parsePlannerPayload(payload, false);
  assert.equal(detail.thinkingChars, longThinking.length);
  assert.equal(detail.thinking, longThinking);
  assert.ok(detail.thinking.endsWith('TAIL_MARKER_25848'));

  const live = parsePlannerPayload(payload, true);
  assert.equal(live.thinkingChars, longThinking.length);
  assert.equal(live.thinkingTruncated, true);
  assert.equal(live.thinking.length, 24_000);
  assert.ok(live.thinking.startsWith('…'));
  assert.ok(live.thinking.endsWith('TAIL_MARKER_25848'));

  const shortLive = clipLiveStreamText('short thought', 24_000);
  assert.equal(shortLive.truncatedHead, false);
  assert.equal(shortLive.totalChars, 13);
});

test('resolveLsGeneratorModel resolves -high/-low tier suffixes and placeholder enums immediately', () => {
  const carbonHigh = resolveLsGeneratorModel('gemini-4-carbon-high');
  assert.equal(carbonHigh.modelId, 'gemini-4-carbon');
  assert.equal(carbonHigh.model, 'gemini-4-carbon');

  const m37 = resolveLsGeneratorModel('MODEL_PLACEHOLDER_M37');
  assert.equal(m37.modelId, 'gemini-4-carbon');

  const neonXHigh = resolveLsGeneratorModel('gemini-4-neon-xhigh');
  assert.equal(neonXHigh.modelId, 'gemini-4-neon');
  assert.ok(neonXHigh.modelDisplay.includes('(XHigh)'));

  const m537 = resolveLsGeneratorModel('MODEL_PLACEHOLDER_M537');
  assert.equal(m537.modelId, 'gemini-pro-orchestrator-neon');
  assert.equal(m537.modelDisplay, 'Orchestrator (Neon)');

  // Unknown future placeholder never leaks raw MODEL_PLACEHOLDER_* when fallback exists
  const futurePlaceholder = resolveLsGeneratorModel('MODEL_PLACEHOLDER_M999', {
    model: 'gemini-4-carbon',
    modelId: 'gemini-4-carbon',
    modelDisplay: 'Gemini 4 Carbon',
  });
  assert.equal(futurePlaceholder.modelId, 'gemini-4-carbon');
});

test('isLoopbackHost strictly gates loopback addresses', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('example.com'), false);
  assert.equal(isLoopbackHost('192.168.1.20'), false);
  assert.equal(isLoopbackHost(''), false);
});

test('pickTargetConversation prevents Calls 3 <-> 6 oscillation from idle WAL checkpoints or subagents', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-target-'));
  try {
    const convDir = join(root, 'conversations');
    const annoDir = join(root, 'annotations');
    const { mkdirSync } = requireBuiltinFs();
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

function requireBuiltinFs() {
  return { mkdirSync: (p, opts) => writeDirHelper(p, opts) };
}

import { mkdirSync as writeDirHelper } from 'node:fs';

test('extractLiveStepFromTrajectory detects /compact across user inputs, checkpoints, and queued messages', () => {
  const compactCmd = extractLiveStepFromTrajectory({
    stepCount: 5,
    runStatus: 'CASCADE_RUN_STATUS_RUNNING',
    lastModifiedTime: '2026-11-14T11:17:19.000Z',
    steps: [
      { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', status: 'CORTEX_STEP_STATUS_DONE' },
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { createdAt: '2026-11-14T11:17:19.000Z', generatorModel: 'gemini-4-carbon' },
        userInput: { items: [{ text: '/compact' }] },
      },
    ],
  });
  assert.equal(compactCmd.liveStep?.stepType, 23);
  assert.equal(compactCmd.liveStep?.statusName, 'COMPACTING');

  const compactWithQueuedFollowup = extractLiveStepFromTrajectory({
    stepCount: 6,
    runStatus: 'CASCADE_RUN_STATUS_RUNNING',
    lastModifiedTime: '2026-11-14T11:17:25.000Z',
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { createdAt: '2026-11-14T11:17:19.000Z', generatorModel: 'gemini-4-carbon' },
        userInput: { items: [{ command: 'collapse_all' }] },
      },
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_PENDING',
        metadata: { createdAt: '2026-11-14T11:17:24.000Z' },
        userInput: { items: [{ text: 'continue after compact' }] },
      },
    ],
  });
  assert.equal(compactWithQueuedFollowup.liveStep?.stepType, 23);
  assert.equal(compactWithQueuedFollowup.liveStep?.statusName, 'COMPACTING');

  const runningCheckpoint = extractLiveStepFromTrajectory({
    stepCount: 6,
    runStatus: 'CASCADE_RUN_STATUS_RUNNING',
    lastModifiedTime: '2026-11-14T11:17:20.000Z',
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_CHECKPOINT',
        status: 'CORTEX_STEP_STATUS_UNSPECIFIED',
        metadata: { startedAt: '2026-11-14T11:17:20.000Z', generatorModel: 'gemini-4-carbon' },
      },
    ],
  });
  assert.equal(runningCheckpoint.liveStep?.stepType, 23);
  assert.equal(runningCheckpoint.liveStep?.statusName, 'COMPACTING');

  const normalFallback = extractLiveStepFromTrajectory({
    stepCount: 4,
    runStatus: 'CASCADE_RUN_STATUS_RUNNING',
    lastModifiedTime: '2026-11-14T11:18:00.000Z',
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { createdAt: '2026-11-14T11:18:00.000Z' },
        userInput: { items: [{ text: 'normal prompt' }] },
      },
    ],
  });
  assert.equal(normalFallback.liveStep?.stepType, 15);
  assert.equal(normalFallback.liveStep?.syntheticFallback, true);
});

test('readTelemetry resolves compaction model from meta.f9.f1, marks compact turns, and detects active checkpoints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-compact-'));
  try {
    const dbPath = join(dir, '11111111-2222-3333-4444-555555555555.db');
    const db = createSchema(dbPath);
    const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    const insStep = db.prepare(
      'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)'
    );

    // Turn 1: initial invocation establishing enum 1037 -> gemini-4-carbon and 160k context
    insGm.run(0, buildGenMetadataBlob({ reportedCtx: 160_000, ctxLimit: 256_000 }));
    insStep.run(
      0,
      14,
      3,
      buildStepMetadata({ createdSec: 1_700_000_000 }),
      bField(19, bField(2, 'First prompt'))
    );
    insStep.run(
      1,
      15,
      3,
      buildStepMetadata({ createdSec: 1_700_000_001, streamStartSec: 1_700_000_003, completedSec: 1_700_000_007, gmIdx: 0 }),
      buildPlannerStepPayload({ reply: 'First answer' })
    );

    // Turn 2: /compact turn with completed step_type = 23 whose meta.f9.f1 = 1037 (modelEnum)
    insStep.run(
      2,
      14,
      3,
      buildStepMetadata({ createdSec: 1_700_000_010 }),
      bField(19, bField(2, '/compact'))
    );
    const compactUsage = Buffer.concat([
      vField(1, 1037),
      vField(2, 1200),
      vField(3, 450),
      vField(5, 120_000),
      vField(9, 100),
      vField(10, 350),
    ]);
    const compactMeta = Buffer.concat([
      bField(1, durationMsg(1_700_000_011)),
      bField(7, durationMsg(1_700_000_016)),
      bField(8, durationMsg(1_700_000_016)),
      bField(9, compactUsage),
      bField(20, vField(3, 1)),
    ]);
    insStep.run(
      3,
      23,
      3,
      compactMeta,
      bField(30, bField(5, 'Compacted context summary'))
    );

    // Post-compact invocation at gmIdx=1 showing context drop 160k -> 24k
    insGm.run(1, buildGenMetadataBlob({ reportedCtx: 24_000, ctxLimit: 256_000 }));
    insStep.run(
      4,
      14,
      3,
      buildStepMetadata({ createdSec: 1_700_000_020 }),
      bField(19, bField(2, 'After compact'))
    );
    insStep.run(
      5,
      15,
      3,
      buildStepMetadata({ createdSec: 1_700_000_021, streamStartSec: 1_700_000_023, completedSec: 1_700_000_027, gmIdx: 1 }),
      buildPlannerStepPayload({ reply: 'Second answer' })
    );

    // Ongoing compaction: turn 4 /compact + active step_type = 23 with status = 0 and no end/completed timestamp
    insStep.run(
      6,
      14,
      3,
      buildStepMetadata({ createdSec: 1_700_000_030 }),
      bField(19, bField(2, '/compact'))
    );
    insStep.run(
      7,
      23,
      0,
      Buffer.concat([bField(32, durationMsg(1_700_000_031)), vField(11, 1037)]),
      null
    );
    db.close();

    const tel = readTelemetry(dbPath);
    assert.equal(tel.compactions.length, 1);
    const cmp = tel.compactions[0];
    assert.equal(cmp.modelId, 'gemini-4-carbon');
    assert.equal(cmp.outputTokens, 450);
    assert.equal(cmp.beforeCtx, 160_000);
    assert.equal(cmp.afterCtx, 24_000);
    assert.equal(cmp.priced, true);
    assert.ok(cmp.costUSD > 0);
    assert.equal(cmp.summaryPreview, 'Compacted context summary');
    assert.equal(tel.turns[1].isCompact, true);
    assert.equal(tel.turns[1].compactCount, 1);
    assert.equal(tel.activeStep?.stepType, 23);
    assert.equal(tel.activeStep?.statusName, 'COMPACTING');
    assert.equal(tel.activeStep?.modelId, 'gemini-4-carbon');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readTelemetry estimates trailing /compact afterCtx immediately via KNOWN_MODEL_ENUMS until next gmIdx arrives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-compact-est-'));
  const dbPath = join(dir, 'test.db');
  try {
    const db = createSchema(dbPath);
    const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    const insStep = db.prepare(
      'INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)'
    );

    // First invocation: enum 1427 with empty modelId/modelDisplay, testing KNOWN_MODEL_ENUMS fallback
    insGm.run(0, buildGenMetadataBlob({
      modelId: '',
      modelDisplay: '',
      modelEnum: 1427,
      newIn: 14_000,
      cached: 8_000,
      reportedCtx: 24_000,
      ctxLimit: 256_000,
    }));
    insStep.run(0, 14, 3, buildStepMetadata({ createdSec: 1_700_000_000 }), bField(19, bField(2, 'First')));
    insStep.run(
      1,
      15,
      3,
      buildStepMetadata({ createdSec: 1_700_000_001, streamStartSec: 1_700_000_002, completedSec: 1_700_000_005, gmIdx: 0 }),
      buildPlannerStepPayload({ reply: 'First reply' })
    );

    // Peak invocation before /compact
    insGm.run(1, buildGenMetadataBlob({
      modelId: '',
      modelDisplay: '',
      modelEnum: 1427,
      newIn: 5_000,
      cached: 200_000,
      reportedCtx: 207_827,
      ctxLimit: 256_000,
    }));
    insStep.run(2, 14, 3, buildStepMetadata({ createdSec: 1_700_000_010 }), bField(19, bField(2, 'Second')));
    insStep.run(
      3,
      15,
      3,
      buildStepMetadata({ createdSec: 1_700_000_011, streamStartSec: 1_700_000_013, completedSec: 1_700_000_018, gmIdx: 1 }),
      buildPlannerStepPayload({ reply: 'Second reply' })
    );

    // Completed /compact pointing to future gmIdx = 2 (not inserted yet)
    insStep.run(4, 14, 3, buildStepMetadata({ createdSec: 1_700_000_020 }), bField(19, bField(2, '/compact')));
    const compactUsage = Buffer.concat([
      vField(1, 1427),
      vField(2, 2000),
      vField(3, 6300),
      vField(5, 205_000),
      vField(9, 127),
      vField(10, 6173),
    ]);
    const compactMeta = Buffer.concat([
      bField(1, durationMsg(1_700_000_021)),
      bField(7, durationMsg(1_700_000_035)),
      bField(8, durationMsg(1_700_000_035)),
      bField(9, compactUsage),
      bField(20, vField(3, 2)),
    ]);
    insStep.run(5, 23, 3, compactMeta, bField(30, bField(5, 'Immediate summary')));

    const telBefore = readTelemetry(dbPath);
    assert.equal(telBefore.compactions.length, 1);
    const cmpEst = telBefore.compactions[0];
    assert.equal(cmpEst.modelId, 'gemini-4-carbon');
    assert.equal(cmpEst.beforeCtx, 207_827);
    assert.equal(cmpEst.afterCtx, 24_173);
    assert.equal(cmpEst.afterCtxEstimated, true);

    // Now the next invocation arrives at gmIdx = 2 with exact reportedCtx
    insGm.run(2, buildGenMetadataBlob({
      modelId: '',
      modelDisplay: '',
      modelEnum: 1427,
      newIn: 4_000,
      cached: 24_000,
      reportedCtx: 28_658,
      ctxLimit: 256_000,
    }));
    db.close();

    const telAfter = readTelemetry(dbPath);
    assert.equal(telAfter.compactions.length, 1);
    const cmpExact = telAfter.compactions[0];
    assert.equal(cmpExact.beforeCtx, 207_827);
    assert.equal(cmpExact.afterCtx, 28_658);
    assert.equal(cmpExact.afterCtxEstimated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('built sidecar ui/index.html uses classic non-module non-crossorigin tags for iframe gateway compatibility', () => {
  const uiIndexPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'index.html');
  const html = readFileSync(uiIndexPath, 'utf-8');
  assert.ok(html.includes('<script src="/preload.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="/styles.css">'));
  assert.ok(html.includes('<script src="/app.js"></script>'));
  assert.equal(html.includes('crossorigin'), false);
  assert.equal(html.includes('type="module"'), false);
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

test('resolveAllAppDataDirs merges antigravity and sibling antigravity-cli stores into buildAccountHistory', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-multiroot-'));
  try {
    const appDir = join(root, 'antigravity');
    const cliDir = join(root, 'antigravity-cli');
    const appConvDir = join(appDir, 'conversations');
    const cliConvDir = join(cliDir, 'conversations');
    writeDirHelper(appConvDir, { recursive: true });
    writeDirHelper(cliConvDir, { recursive: true });

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
      writeDirHelper(join(d, 'conversations'), { recursive: true });
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
    writeDirHelper(join(arbitraryDir, 'conversations'), { recursive: true });
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
    const allGemCalls = [];
    const allClaudeCalls = [];
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

    const calls = [];
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
  const fitOk = solvePoolFitModel(cleanHydro, 'gemini');
  assert.equal(fitOk.quality, 'high');
  assert.equal(fitOk.driftWarning, false);
  const hmOk = fitOk.models['gemini-4-hydrogen'];
  assert.ok(Math.abs(hmOk.beta - 2 / 3) < 0.002);
  assert.ok(Math.abs(hmOk.priorBeta - 2 / 3) < 1e-6);
  assert.ok(Math.abs(hmOk.priorRelDiffPct) < 0.3);
  assert.ok(hmOk.priorZScore < 0.5);

  // +20% shift in beta_H (0.800 vs prior 0.6667 -> >3σ) must downgrade to provisional and flag driftWarning!
  const driftedHydro = makeHydroState(0.8);
  const fitDrift = solvePoolFitModel(driftedHydro, 'gemini');
  assert.equal(fitDrift.quality, 'provisional');
  assert.equal(fitDrift.driftWarning, true);
  assert.ok(fitDrift.driftReasons.some((r) => r.includes('gemini-4-hydrogen:prior_3sigma')));
  assert.ok(Math.abs(fitDrift.models['gemini-4-hydrogen'].priorRelDiffPct - 20) < 0.5);
  assert.ok(fitDrift.models['gemini-4-hydrogen'].priorZScore > 3.0);

  // Rolling OOS median error > 0.5% on Gemini must also downgrade to provisional!
  const noisyOosState = makeHydroState(2 / 3, 0.012); // 1.2% OOS error (> 0.5%)
  const fitOosWarn = solvePoolFitModel(noisyOosState, 'gemini');
  assert.equal(fitOosWarn.quality, 'provisional');
  assert.equal(fitOosWarn.driftWarning, true);
  assert.ok(fitOosWarn.driftReasons.some((r) => r.includes('oos_exceeded')));

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
    assert.equal(healedPool.fit.quality, 'high');
    assert.equal(healedPool.fit.driftWarning, false);
    assert.ok(Math.abs(healedPool.fit.full5hUSD - 150) < 0.5);
    const persisted = JSON.parse(readFileSync(autoFitPath, 'utf8'));
    assert.equal(persisted.pools['pro:google ai ultra:teams_tier_pro|gemini'].fit.quality, 'high');
  } finally {
    rmSync(autoDir, { recursive: true, force: true });
  }
});

test('adaptive MAD 6σ outlier rejection (<0.01% bias on 30+1 +54% spike) and GetUserStatus stale-cache rewind guard', () => {
  // 1) 30 exact Carbon short windows + 1 (+54%) window + 1 (+310%) spike -> beta bias < 0.01%!
  const samples = [];
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
  const fit = solvePoolFitModel(ps, 'gemini');
  const relBias = Math.abs(fit.models['gemini-4-carbon'].beta - 2.0) / 2.0;
  assert.ok(relBias < 0.0001, `expected beta relative bias < 0.01% (0.0001), got ${relBias}`);
  assert.ok(Math.abs(fit.full5hUSD - 150) < 0.015);
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

test('reconcilePoolSamplesPricing and FAMILY_CLASSIFIER_VERSION heal misfiled Orchestrator (Neon) samples and Neon nominal flags', () => {
  const sigNow = getCurrentPricingSig();
  const baseTs = 1_840_000_000_000;
  const allCalls = [];
  const samples = [];

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

  const fit = solvePoolFitModel(ps, 'gemini');
  assert.equal(fit.quality, 'high');
  assert.equal(fit.driftWarning, false);
  assert.ok(Math.abs(fit.full5hUSD - 150) < 0.5, `expected full5hUSD ~150, got ${fit.full5hUSD}`);
  assert.ok(Math.abs(fit.models['gemini-4-neon'].k - 1.0) < 0.01);
  assert.equal(fit.models['gemini-4-carbon'], undefined);
});

test('extractLiveStepFromTrajectory preserves model from tail steps on syntheticFallback and resolves M461 placeholder', () => {
  const m461 = resolveLsGeneratorModel('MODEL_PLACEHOLDER_M461');
  assert.equal(m461.modelId, 'gemini-4-hydrogen-high');
  assert.equal(m461.modelDisplay, 'Gemini 4 Hydrogen (High)');

  const res = extractLiveStepFromTrajectory({
    stepCount: 3,
    runStatus: 'CASCADE_RUN_STATUS_RUNNING',
    lastModifiedTime: '2026-11-15T03:46:38.000Z',
    offset: 0,
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { generatorModel: 'MODEL_PLACEHOLDER_M461' },
      },
      {
        type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
        status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { generatorModel: 'MODEL_PLACEHOLDER_M461' },
      },
    ],
  });
  assert.equal(res.liveStep.syntheticFallback, true);
  assert.equal(res.liveStep.modelId, 'gemini-4-hydrogen-high');
  assert.equal(res.liveStep.modelDisplay, 'Gemini 4 Hydrogen (High)');
});
