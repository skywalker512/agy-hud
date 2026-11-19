import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildTimelineFromDb,
  buildTimelineFromTrace,
  decodeErrorStepPayload,
  decodeToolErrorPayload,
  detectFrameAnomalies,
  exportTraceFixture,
  loadTraceFile,
  replayTrace,
  TraceRecorder,
} from '../lib/trace-core.mjs';

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
  cached = 80_000,
  newIn = 4_000,
  output = 320,
  thinking = 120,
  candidate = 200,
  reportedCtx = 84_000,
  ctxLimit = 256_000,
  ttftSec = 1.5,
  genSec = 3.2,
  botId = 'b1111111-2222-4333-8444-555555555555',
}) {
  const usage = Buffer.concat([
    vField(2, newIn),
    vField(3, output),
    vField(5, cached),
    vField(9, thinking),
    vField(10, candidate),
    bField(7, botId),
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
  startedSec = 0,
  streamStartSec = 0,
  completedSec = 0,
  endSec = 0,
  modelEnum = null,
  toolName = '',
  gmIdx = null,
  botId = '',
}) {
  const parts = [];
  if (createdSec > 0) parts.push(bField(1, durationMsg(createdSec)));
  if (toolName) parts.push(bField(4, bField(2, toolName)));
  if (streamStartSec > 0) parts.push(bField(6, durationMsg(streamStartSec)));
  if (completedSec > 0) parts.push(bField(7, durationMsg(completedSec)));
  if (endSec > 0) parts.push(bField(8, durationMsg(endSec)));
  if (botId) parts.push(bField(9, bField(7, botId)));
  if (modelEnum !== null) parts.push(vField(11, modelEnum));
  if (gmIdx !== null) parts.push(bField(20, vField(3, gmIdx)));
  if (startedSec > 0) parts.push(bField(32, durationMsg(startedSec)));
  return Buffer.concat(parts);
}

function buildPlannerPayload({ thinking = '', reply = '', toolCalls = [] }) {
  const parts = [];
  if (reply) parts.push(bField(1, reply));
  if (thinking) parts.push(bField(3, thinking));
  for (const tc of toolCalls) {
    parts.push(bField(7, Buffer.concat([bField(2, tc.name), bField(3, tc.args || '')])));
  }
  return bField(20, Buffer.concat(parts));
}

function buildErrorStepPayload({ userMessage, shortError, fullError, errorId = 'err-id-1' }) {
  const errDetails = Buffer.concat([
    bField(1, userMessage),
    bField(2, shortError),
    bField(3, fullError || shortError),
    bField(6, errorId),
  ]);
  return Buffer.concat([vField(1, 17), vField(4, 3), bField(24, bField(3, errDetails))]);
}

function buildToolErrorPayload({ shortError }) {
  return Buffer.concat([vField(1, 132), vField(4, 7), bField(31, bField(2, shortError))]);
}

function createConvSchema(dbPath) {
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

test('decodeErrorStepPayload and decodeToolErrorPayload extract API and tool failures', () => {
  const err17 = buildErrorStepPayload({
    userMessage: 'Invalid thought signature.',
    shortError: 'INVALID_ARGUMENT (code 400): Invalid thought signature.',
    fullError: 'Full trace for /Users/secretuser/project/file.ts',
  });
  const dec17 = decodeErrorStepPayload(err17);
  assert.equal(dec17.userMessage, 'Invalid thought signature.');
  assert.equal(dec17.shortError, 'INVALID_ARGUMENT (code 400): Invalid thought signature.');
  assert.equal(dec17.errorId, 'err-id-1');

  const toolErr = buildToolErrorPayload({ shortError: 'failed to generate content: 429 Too Many Requests' });
  const decTool = decodeToolErrorPayload(toolErr);
  assert.equal(decTool.shortError, 'failed to generate content: 429 Too Many Requests');
});

test('detectFrameAnomalies catches mid-execution gaps, DB desyncs, and HUD invariants', () => {
  const anomalies = detectFrameAnomalies({
    curr: {
      target: { id: 'conv-a' },
      ls: {
        enabled: true,
        ok: true,
        summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 5 },
        stepOffset: 3,
        steps: [
          {
            idx: 3,
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            status: 'CORTEX_STEP_STATUS_DONE',
            metadata: {},
          },
          {
            idx: 4,
            type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
            status: 'CORTEX_STEP_STATUS_DONE',
            errorMessage: { shortError: 'API error (attempt 1): RESOURCE_EXHAUSTED (code 429)' },
          },
        ],
      },
      db: {
        stepCount: 4,
        walSize: 4096,
        stepSummaryMap: new Map([[3, { idx: 3, stepType: 15, status: 2, statusName: 'RUNNING' }]]),
        stepsDelta: [],
      },
      hud: {
        ok: true,
        telemetry: {
          summary: { count: 1, avgGenTps: 80, peakGenTps: 50 },
          activeStep: null,
          latest: null,
        },
      },
    },
    prev: null,
    recentTargets: ['conv-a', 'conv-b', 'conv-a'],
  });

  const codes = new Set(anomalies.map((a) => a.code));
  assert.ok(codes.has('TARGET_OSCILLATION'));
  assert.ok(codes.has('ACTIVE_STEP_MISSING'));
  assert.ok(codes.has('LS_DB_STEP_SKEW'));
  assert.ok(codes.has('LS_DB_STATUS_DESYNC'));
  assert.ok(codes.has('AGENT_LS_ERROR_STEP'));
  assert.ok(codes.has('TPS_INVARIANT_BROKEN'));
});

test('TraceRecorder records DB transitions, replayTrace recomputes them, and exportTraceFixture redacts PII cleanly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-trace-test-'));
  try {
    const convDir = join(root, 'conversations');
    const annoDir = join(root, 'annotations');
    mkdirSync(convDir, { recursive: true });
    mkdirSync(annoDir, { recursive: true });

    const convId = '11111111-2222-4333-8444-555555555555';
    const dbPath = join(convDir, `${convId}.db`);
    const tracePath = join(root, 'trace.jsonl');
    const fixturePath = join(root, 'fixture.json');

    const db = createConvSchema(dbPath);
    const insStep = db.prepare('INSERT OR REPLACE INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
    const insGm = db.prepare('INSERT OR REPLACE INTO gen_metadata (idx, data) VALUES (?, ?)');

    // Frame 0: initial user input with secret path/prompt
    insStep.run(
      0,
      14,
      3,
      buildStepMetadata({ createdSec: 1_794_700_000, completedSec: 1_794_700_000 }),
      bField(19, bField(2, 'Secret prompt mentioning /Users/alice/private-repo')),
    );

    const recorder = new TraceRecorder({
      outPath: tracePath,
      appDataDir: root,
      explicitConvId: convId,
      useLs: false,
      includeRawDb: true,
    });
    recorder.open();

    const r0 = await recorder.pollOnce();
    assert.equal(r0.written, true);
    assert.equal(r0.frame.db.stepsDelta.length, 1);

    // Frame 1: model planner step starts (status=8 GENERATING) before gen_metadata exists
    insStep.run(
      1,
      15,
      8,
      buildStepMetadata({ createdSec: 1_794_700_001, streamStartSec: 1_794_700_002, modelEnum: 1037 }),
      buildPlannerPayload({ thinking: 'Secret internal chain of thought', reply: '' }),
    );
    const r1 = await recorder.pollOnce();
    assert.equal(r1.written, true);
    assert.equal(r1.frame.hud.telemetry.activeStep.statusName, 'GENERATING');

    // Frame 2: API error step (step_type=17) occurs mid-turn
    insStep.run(
      2,
      17,
      3,
      buildStepMetadata({ createdSec: 1_794_700_003, completedSec: 1_794_700_003 }),
      buildErrorStepPayload({
        userMessage: 'Rate limited',
        shortError: 'RESOURCE_EXHAUSTED (code 429) in /Users/alice/secret',
      }),
    );
    const r2 = await recorder.pollOnce();
    assert.equal(r2.written, true);
    assert.ok(r2.anomalies.some((a) => a.code === 'AGENT_DB_ERROR_STEP'));

    // Frame 3: planner finishes + tool error step + gen_metadata arrives
    insStep.run(
      1,
      15,
      3,
      buildStepMetadata({
        createdSec: 1_794_700_001,
        streamStartSec: 1_794_700_002.5,
        completedSec: 1_794_700_005.7,
        endSec: 1_794_700_005.7,
        modelEnum: 1037,
        gmIdx: 0,
      }),
      buildPlannerPayload({
        thinking: 'Secret internal chain of thought',
        reply: 'Secret assistant final reply',
        toolCalls: [{ name: 'run_command', args: '{"CommandLine":"cat /Users/alice/secret.txt"}' }],
      }),
    );
    insStep.run(
      3,
      132,
      7,
      buildStepMetadata({ createdSec: 1_794_700_006, endSec: 1_794_700_007, toolName: 'run_command', gmIdx: 0 }),
      buildToolErrorPayload({ shortError: 'Command failed on /Users/alice/secret.txt' }),
    );
    insGm.run(0, buildGenMetadataBlob({ output: 320, ttftSec: 1.5, genSec: 3.2 }));

    const r3 = await recorder.pollOnce();
    assert.equal(r3.written, true);
    assert.equal(r3.frame.hud.telemetry.summary.count, 1);
    assert.ok(r3.anomalies.some((a) => a.code === 'TOOL_DB_ERROR_STEP'));

    // No-op poll should skip writing duplicate frame
    const r4 = await recorder.pollOnce();
    assert.equal(r4.written, false);

    recorder.close();
    db.close();

    // Verify replay with recompute matches recorded HUD outputs across all frames
    const rep = replayTrace(tracePath, { recompute: true });
    assert.equal(rep.frames.length, 4);
    assert.equal(rep.frames[3].evaluatedHud.telemetry.summary.count, 1);
    assert.equal(rep.frames[3].evaluatedHud.telemetry.latest.outputTokens, 320);
    assert.deepEqual(rep.frames[3].newCodes, []);
    assert.deepEqual(rep.frames[3].resolvedCodes, []);

    // Verify timeline from both trace and raw DB
    const tlTrace = buildTimelineFromTrace(tracePath);
    assert.ok(tlTrace.events.some((e) => e.kind === 'ANOMALY_AGENT_DB_ERROR_STEP'));
    assert.ok(tlTrace.events.some((e) => e.kind === 'DB_GEN_METADATA'));

    const tlDb = buildTimelineFromDb(dbPath);
    assert.ok(tlDb.some((e) => e.kind === 'API_ERROR'));
    assert.ok(tlDb.some((e) => e.kind === 'TOOL_ERROR'));
    assert.ok(tlDb.some((e) => e.kind === 'MODEL_CALL'));

    // Verify sanitized fixture export around anomaly frame 2
    const fixture = exportTraceFixture(tracePath, { aroundAnomalySeq: 2, windowRadius: 1, redact: true });
    assert.equal(fixture.redacted, true);
    assert.equal(fixture.frameCount, 3); // seq 1, 2, 3
    const fixtureText = JSON.stringify(fixture);
    assert.equal(fixtureText.includes('Secret prompt'), false);
    assert.equal(fixtureText.includes('Secret internal chain of thought'), false);
    assert.equal(fixtureText.includes('Secret assistant final reply'), false);
    assert.equal(fixtureText.includes('/Users/alice'), false);
    assert.equal(fixtureText.includes(convId), false);

    // Exported fixture must STILL be replayable and preserve exact token/speed metrics!
    writeFileSync(fixturePath, fixtureText, 'utf8');
    const loaded = loadTraceFile(fixturePath);
    assert.equal(loaded.frames.length, 3);
    const fixReplay = replayTrace(fixturePath, { recompute: true });
    assert.equal(fixReplay.frames.length, 3);
    assert.equal(fixReplay.frames[2].evaluatedHud.telemetry.summary.count, 1);
    assert.equal(fixReplay.frames[2].evaluatedHud.telemetry.latest.outputTokens, 320);
    assert.equal(fixReplay.frames[2].evaluatedHud.telemetry.latest.totalContext, 84_000);
    assert.equal(fixReplay.frames[2].evaluatedHud.telemetry.latest.contextLimit, 256_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
