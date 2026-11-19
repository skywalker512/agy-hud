import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  attachQuotaBudgetEstimates,
  clipLiveStreamText,
  computeCallCost,
  extractLiveStepFromTrajectory,
  getConversationGraph,
  isLoopbackHost,
  iterFields,
  listConversations,
  parseGenRow,
  parsePlannerPayload,
  pickTargetConversation,
  readDurationSec,
  readTelemetry,
  readVarint,
  resolveLsGeneratorModel,
  summarizeConversationDb,
} from '../server.mjs';

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
    const savedEntry = Object.values(saved.entries)[0];
    assert.ok(savedEntry);
    assert.ok(Math.abs(savedEntry.fullUSD - 22) < 1e-6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
