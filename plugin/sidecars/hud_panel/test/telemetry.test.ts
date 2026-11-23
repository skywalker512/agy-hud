import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clipLiveStreamText,
  extractLiveStepFromTrajectory,
  isLoopbackHost,
  iterFields,
  parseContextBreakdown,
  parseGenRow,
  parsePlannerPayload,
  readDurationSec,
  readTelemetry,
  readVarint,
  resolveLsGeneratorModel,
} from '../server.ts';
import {
  bField,
  buildContextTreeBlob,
  buildGenMetadataBlob,
  buildPlannerStepPayload,
  buildStepMetadata,
  createSchema,
  durationMsg,
  encodeVarint,
  vField,
} from './helpers/fixtures.ts';

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
    assert.ok(parsed1);
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
  assert.ok(detail);
  assert.equal(detail.thinkingChars, longThinking.length);
  assert.equal(detail.thinking, longThinking);
  assert.ok(detail.thinking.endsWith('TAIL_MARKER_25848'));

  const live = parsePlannerPayload(payload, true);
  assert.ok(live);
  assert.equal(live.thinkingChars, longThinking.length);
  assert.equal(live.thinkingTruncated, true);
  assert.equal(live.thinking.length, 24_000);
  assert.ok(live.thinking.startsWith('…'));
  assert.ok(live.thinking.endsWith('TAIL_MARKER_25848'));

  const shortLive = clipLiveStreamText('short thought', 24_000);
  assert.equal(shortLive.truncatedHead, false);
  assert.equal(shortLive.totalChars, 13);
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

test('parseContextBreakdown and readTelemetry expose additive mcpTools, skills, rules, and checkpointTokens sub-counts', () => {
  const richTree = buildContextTreeBlob([
    {
      name: 'System Prompt',
      items: [
        { name: 'identity', tokens: 300 },
        { name: 'guidelines', tokens: 1_200 },
        { name: 'skills', tokens: 1_850 },
        { name: 'user_rules', tokens: 640 },
        { name: 'workspace_rules', tokens: 260 },
      ],
    },
    {
      name: 'Tools',
      items: [
        { name: 'read_file', tokens: 900 },
        { name: 'run_command', tokens: 1_100 },
        { name: 'mcp_github_list_issues', tokens: 750 },
        { name: 'mcp__linear__get_issue', tokens: 450 },
        { name: 'mcp:figma:get_node', tokens: 300 },
      ],
    },
    {
      name: 'Chat Messages',
      items: [
        { name: 'CORTEX_STEP_TYPE_USER_INPUT', tokens: 2_000 },
        { name: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', tokens: 5_000 },
        { name: 'CORTEX_STEP_TYPE_CHECKPOINT', tokens: 4_200 },
        { name: 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE', tokens: 500 },
        { name: 'CORTEX_STEP_TYPE_GENERIC', tokens: 8_000 },
      ],
    },
  ]);

  const blob = buildGenMetadataBlob({
    reportedCtx: 27_450,
    ctxLimit: 256_000,
    contextTree: richTree,
  });

  const bd = parseContextBreakdown(blob);
  assert.ok(bd);
  assert.equal(bd.systemPrompt, 4_250);
  assert.equal(bd.toolsSchema, 3_500);
  assert.equal(bd.checkpoint, 4_200);
  assert.equal(bd.checkpointTokens, 4_200);
  assert.equal(bd.skills, 1_850);
  assert.equal(bd.rules, 900); // user_rules (640) + workspace_rules (260); excludes guidelines (1200)
  assert.equal(bd.mcpTools, 1_500); // mcp_github (750) + mcp__linear (450) + mcp:figma (300)

  const dir = mkdtempSync(join(tmpdir(), 'agy-hud-ctx-sub-'));
  try {
    const dbPath = join(dir, 'ctx.db');
    const db = createSchema(dbPath);
    db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(0, blob);
    db.close();

    const tel = readTelemetry(dbPath);
    assert.ok(tel.contextBreakdown);
    assert.equal(tel.contextBreakdown.mcpTools, 1_500);
    assert.equal(tel.contextBreakdown.skills, 1_850);
    assert.equal(tel.contextBreakdown.rules, 900);
    assert.equal(tel.contextBreakdown.checkpointTokens, 4_200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Plain session with no MCP tools, skills, rules, or checkpoints returns 0 cleanly
  const plainTree = buildContextTreeBlob([
    {
      name: 'System Prompt',
      items: [
        { name: 'identity', tokens: 300 },
        { name: 'guidelines', tokens: 900 },
      ],
    },
    {
      name: 'Tools',
      items: [{ name: 'read_file', tokens: 800 }],
    },
    {
      name: 'Chat Messages',
      items: [{ name: 'CORTEX_STEP_TYPE_USER_INPUT', tokens: 1_000 }],
    },
  ]);
  const plainBd = parseContextBreakdown(buildGenMetadataBlob({ reportedCtx: 3_000, contextTree: plainTree }));
  assert.ok(plainBd);
  assert.equal(plainBd.mcpTools, 0);
  assert.equal(plainBd.skills, 0);
  assert.equal(plainBd.rules, 0);
  assert.equal(plainBd.checkpointTokens, 0);
});
