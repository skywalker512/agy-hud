/**
 * Shared protobuf & SQLite fixture builders for AGY-HUD sidecar tests.
 */
import { DatabaseSync } from 'node:sqlite';

export function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

export function vField(fieldNum, value) {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 0), encodeVarint(value)]);
}

export function bField(fieldNum, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return Buffer.concat([encodeVarint((fieldNum << 3) | 2), encodeVarint(buf.length), buf]);
}

export function durationMsg(secFloat) {
  const sec = Math.floor(secFloat);
  const nanos = Math.round((secFloat - sec) * 1e9);
  const parts = [];
  if (sec > 0) parts.push(vField(1, sec));
  if (nanos > 0) parts.push(vField(2, nanos));
  return Buffer.concat(parts);
}

export function buildGenMetadataBlob({
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
} = {}) {
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

export function buildStepMetadata({
  createdSec = 0,
  streamStartSec = 0,
  completedSec = 0,
  endSec = 0,
  modelEnum = null,
  toolName = '',
  gmIdx = null,
} = {}) {
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

export function buildPlannerStepPayload({ thinking = '', reply = '', toolCalls = [] } = {}) {
  const parts = [];
  if (reply) parts.push(bField(1, reply));
  if (thinking) parts.push(bField(3, thinking));
  for (const tc of toolCalls) {
    parts.push(bField(7, Buffer.concat([bField(2, tc.name), bField(3, tc.args || '')])));
  }
  return bField(20, Buffer.concat(parts));
}

export function createSchema(dbPath) {
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
