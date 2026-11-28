import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { parseGenRow } from '../../../plugin/sidecars/hud_panel/lib/protobuf.ts';
import { detectFrameAnomalies } from './anomalies.mjs';
import {
  asBuffer,
  evaluateHudFromDbAndLs,
  summarizeDbStep,
  TRACE_SCHEMA_VERSION,
} from './step-decoder.mjs';

export function loadTraceFile(tracePath) {
  const raw = readFileSync(tracePath, 'utf8').trim();
  if (!raw) return { meta: null, summary: null, frames: [] };
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === 'agy_hud_trace_fixture' && Array.isArray(parsed.frames)) {
        return {
          meta: {
            kind: 'meta',
            schemaVersion: parsed.schemaVersion || TRACE_SCHEMA_VERSION,
            startedAtIso: parsed.exportedAtIso || '',
            redacted: Boolean(parsed.redacted),
          },
          summary: null,
          frames: parsed.frames,
        };
      }
    } catch {
      /* fall through to NDJSON parsing */
    }
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let meta = null;
  let summary = null;
  const frames = [];
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.kind === 'meta') meta = obj;
    else if (obj.kind === 'summary') summary = obj;
    else if (obj.kind === 'frame') frames.push(obj);
  }
  return { meta, summary, frames };
}

function createReplayDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
    CREATE TABLE IF NOT EXISTS steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER,
      status INTEGER,
      metadata BLOB,
      step_payload BLOB
    );
    CREATE TABLE IF NOT EXISTS parent_references (idx INTEGER PRIMARY KEY, data BLOB);
    CREATE TABLE IF NOT EXISTS trajectory_meta (trajectory_type INTEGER);
  `);
  return db;
}

export function replayTrace(tracePath, { recompute = false } = {}) {
  const trace = loadTraceFile(tracePath);
  const tmpDir = mkdtempSync(join(tmpdir(), 'agy-hud-replay-'));
  const convDbs = new Map();
  const convRecords = new Map();
  const recentTargets = [];
  const seenLsErrorStepIdxs = new Set();
  const seenLsFailedStepIdxs = new Set();

  let prevCtx = null;
  const results = [];

  try {
    for (const frame of trace.frames) {
      const targetId = frame.target?.id || '00000000-0000-4000-8000-000000000000';
      let dbInfo = convDbs.get(targetId);
      if (!dbInfo) {
        const dbPath = join(tmpDir, `${targetId}.db`);
        const db = createReplayDb(dbPath);
        dbInfo = {
          dbPath,
          db,
          insStep: db.prepare(
            'INSERT OR REPLACE INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)',
          ),
          delStep: db.prepare('DELETE FROM steps WHERE idx = ?'),
          insGm: db.prepare('INSERT OR REPLACE INTO gen_metadata (idx, data) VALUES (?, ?)'),
          delGm: db.prepare('DELETE FROM gen_metadata WHERE idx = ?'),
          stepSummaryMap: new Map(),
          hasRawBytes: false,
        };
        convDbs.set(targetId, dbInfo);
      }

      const dbDelta = frame.db || {};
      for (const s of dbDelta.stepsDelta || []) {
        if (s.summary) dbInfo.stepSummaryMap.set(s.idx, s.summary);
        if (s.metadataB64 !== undefined || s.stepPayloadB64 !== undefined) {
          dbInfo.hasRawBytes = true;
          const metaBuf = s.metadataB64 ? Buffer.from(s.metadataB64, 'base64') : null;
          const payBuf = s.stepPayloadB64 ? Buffer.from(s.stepPayloadB64, 'base64') : null;
          dbInfo.insStep.run(s.idx, s.stepType, s.status, metaBuf, payBuf);
        }
      }
      for (const idx of dbDelta.stepsRemoved || []) {
        dbInfo.stepSummaryMap.delete(idx);
        dbInfo.delStep.run(idx);
      }
      for (const g of dbDelta.gmDelta || []) {
        if (g.dataB64) {
          dbInfo.hasRawBytes = true;
          dbInfo.insGm.run(g.idx, Buffer.from(g.dataB64, 'base64'));
        }
      }
      for (const idx of dbDelta.gmRemoved || []) {
        dbInfo.delGm.run(idx);
      }

      convRecords.set(targetId, {
        id: targetId,
        dbPath: dbInfo.dbPath,
        annoPath: '',
        dbMtimeMs: frame.tsMs,
        walMtimeMs: frame.db?.walMtimeMs || frame.tsMs,
        updatedMs: frame.tsMs,
        key: frame.target?.key || `${frame.tsMs}`,
        annoKey: frame.target?.annoKey || '0:0',
      });

      recentTargets.push(targetId);
      if (recentTargets.length > 10) recentTargets.shift();

      let evaluatedHud = frame.hud;
      let evaluatedAnomalies = frame.anomalies || [];

      if (recompute && dbInfo.hasRawBytes) {
        const lsTraj = frame.ls?.summary
          ? {
              summary: frame.ls.summary,
              stepOffset: frame.ls.stepOffset || 0,
              steps: frame.ls.steps || [],
              nowMs: frame.tsMs,
            }
          : null;
        const hudEval = evaluateHudFromDbAndLs({
          dbPath: dbInfo.dbPath,
          conversations: [...convRecords.values()],
          fallbackTsMs: frame.tsMs,
          lsTrajectory: lsTraj,
        });
        const tel = hudEval.telemetry;
        evaluatedHud = {
          ok: hudEval.ok,
          error: hudEval.error,
          dbHadActiveStep: Boolean(hudEval.dbHadActiveStep),
          telemetry: tel
            ? {
                summary: tel.summary,
                activeStep: tel.activeStep,
                currentModel: tel.currentModel,
                pendingCompact: tel.pendingCompact,
                latest: tel.latest,
                turnsCount: tel.turns?.length || 0,
                compactionsCount: tel.compactions?.length || 0,
              }
            : null,
        };
        const currCtx = {
          tsMs: frame.tsMs,
          target: frame.target,
          ls: frame.ls,
          db: {
            ...frame.db,
            stepSummaryMap: dbInfo.stepSummaryMap,
          },
          hud: evaluatedHud,
        };
        const prevWithSeen = prevCtx
          ? {
              ...prevCtx,
              _seenLsErrorStepIdxs: seenLsErrorStepIdxs,
              _seenLsFailedStepIdxs: seenLsFailedStepIdxs,
            }
          : null;
        evaluatedAnomalies = detectFrameAnomalies({
          curr: currCtx,
          prev: prevWithSeen,
          recentTargets,
          isBaseline: frame.seq === 0,
          nowMs: frame.tsMs,
        });
        prevCtx = currCtx;
      } else {
        prevCtx = {
          target: frame.target,
          ls: frame.ls,
          db: {
            ...frame.db,
            stepSummaryMap: dbInfo.stepSummaryMap,
          },
          hud: frame.hud,
        };
      }

      const lsOffset = Number(frame.ls?.stepOffset || 0);
      for (let i = 0; i < (frame.ls?.steps || []).length; i++) {
        const st = frame.ls.steps[i];
        if (!st) continue;
        const stepIdx = lsOffset + i;
        if (st.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') seenLsErrorStepIdxs.add(stepIdx);
        if (st.status === 'CORTEX_STEP_STATUS_ERROR' || st.status === 'CORTEX_STEP_STATUS_CANCELLED' || st.status === 'CORTEX_STEP_STATUS_CANCELED') {
          seenLsFailedStepIdxs.add(`${stepIdx}:${st.status}`);
        }
      }

      const recordedCodes = new Set((frame.anomalies || []).map((a) => a.code));
      const recomputedCodes = new Set(evaluatedAnomalies.map((a) => a.code));
      const resolvedCodes = [...recordedCodes].filter((c) => !recomputedCodes.has(c));
      const newCodes = [...recomputedCodes].filter((c) => !recordedCodes.has(c));

      results.push({
        seq: frame.seq,
        tsMs: frame.tsMs,
        elapsedMs: frame.elapsedMs,
        targetId,
        lsStatus: frame.ls?.summary?.status || '',
        lsStepCount: frame.ls?.summary?.stepCount ?? null,
        dbStepCount: frame.db?.stepCount ?? null,
        dbGmCount: frame.db?.gmCount ?? null,
        recordedHud: frame.hud,
        evaluatedHud,
        recordedAnomalies: frame.anomalies || [],
        evaluatedAnomalies,
        resolvedCodes,
        newCodes,
        stepsDeltaCount: (frame.db?.stepsDelta || []).length,
        gmDeltaCount: (frame.db?.gmDelta || []).length,
      });
    }
  } finally {
    for (const info of convDbs.values()) {
      try { info.db.close(); } catch { /* ignore */ }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    meta: trace.meta,
    summary: trace.summary,
    recomputed: recompute,
    frames: results,
  };
}

export function buildTimelineFromDb(dbPath) {
  let db;
  const events = [];
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const stepRows = db
      .prepare('SELECT idx, step_type, status, metadata, step_payload FROM steps ORDER BY idx ASC')
      .all();
    const gmRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    const parsedGms = new Map();
    for (const r of gmRows) {
      const p = parseGenRow(r.idx, asBuffer(r.data));
      if (p) parsedGms.set(r.idx, p);
    }

    for (const r of stepRows) {
      const sum = summarizeDbStep(r);
      const tsMs = sum.completedAtMs || sum.endAtMs || sum.startedAtMs || sum.createdAtMs || 0;
      if (r.step_type === 14) {
        events.push({
          tsMs,
          kind: 'USER_TURN',
          severity: 'info',
          stepIdx: r.idx,
          title: `Turn step #${r.idx}`,
          detail: sum.promptPreview || '(empty prompt)',
        });
      } else if (r.step_type === 15) {
        const gm = sum.gmIdx !== null ? parsedGms.get(sum.gmIdx) : null;
        const sev = r.status === 4 || r.status === 7 ? 'error' : r.status === 5 || r.status === 6 ? 'warn' : 'info';
        events.push({
          tsMs,
          kind: 'MODEL_CALL',
          severity: sev,
          stepIdx: r.idx,
          gmIdx: sum.gmIdx,
          title: `Planner #${r.idx} (${sum.statusName})`,
          detail: gm
            ? `${gm.model} | ttft=${gm.ttftSec.toFixed(2)}s gen=${gm.genSec.toFixed(2)}s out=${gm.outputTokens} ctx=${gm.totalContext}/${gm.contextLimit}${sum.plannerSummary?.toolCalls?.length ? ` tools=[${sum.plannerSummary.toolCalls.join(',')}]` : ''}`
            : `tools=[${(sum.plannerSummary?.toolCalls || []).join(',')}] (no gen_metadata link)`,
        });
      } else if (r.step_type === 17) {
        events.push({
          tsMs,
          kind: 'API_ERROR',
          severity: 'error',
          stepIdx: r.idx,
          title: `API Error #${r.idx}`,
          detail: sum.error?.shortError || sum.error?.userMessage || 'Unknown step_type=17 error',
          error: sum.error,
        });
      } else if (r.step_type === 23) {
        events.push({
          tsMs,
          kind: 'COMPACTION',
          severity: 'info',
          stepIdx: r.idx,
          title: `Checkpoint / Compact #${r.idx} (${sum.statusName})`,
          detail: sum.compactSummary ? sum.compactSummary.slice(0, 120) : '',
        });
      } else if (r.step_type === 132) {
        const sev = r.status === 4 || r.status === 7 ? 'error' : r.status === 6 ? 'warn' : 'info';
        const durSec = sum.endAtMs > sum.createdAtMs && sum.createdAtMs > 0 ? (sum.endAtMs - sum.createdAtMs) / 1000 : 0;
        events.push({
          tsMs,
          kind: sev === 'error' ? 'TOOL_ERROR' : sev === 'warn' ? 'TOOL_CANCELLED' : 'TOOL_STEP',
          severity: sev,
          stepIdx: r.idx,
          title: `Tool #${r.idx} ${sum.toolName || 'tool'} (${sum.statusName})`,
          detail: `${durSec > 0 ? `${durSec.toFixed(2)}s ` : ''}${sum.error?.shortError || sum.error?.userMessage || ''}`.trim(),
          error: sum.error,
        });
      }
    }
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return events;
}

export function buildTimelineFromTrace(tracePath) {
  const { meta, summary, frames } = loadTraceFile(tracePath);
  const events = [];
  let prevTargetId = '';
  let prevRunStatus = '';
  let prevActiveKey = '';

  for (const f of frames) {
    if (f.target?.id && f.target.id !== prevTargetId) {
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: 'TARGET_SWITCH',
        severity: 'info',
        title: `Target -> ${f.target.id.slice(0, 8)}`,
        detail: `steps=${f.db?.stepCount ?? 0} gm=${f.db?.gmCount ?? 0}`,
      });
      prevTargetId = f.target.id;
    }

    const lsStatus = f.ls?.summary?.status || '';
    if (lsStatus && lsStatus !== prevRunStatus) {
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: 'LS_RUN_STATUS',
        severity: /ERROR|FAIL/i.test(lsStatus) ? 'error' : 'info',
        title: `LS ${prevRunStatus || '(init)'} -> ${lsStatus}`,
        detail: `lsSteps=${f.ls?.summary?.stepCount ?? 0} dbSteps=${f.db?.stepCount ?? 0}`,
      });
      prevRunStatus = lsStatus;
    }

    const active = f.hud?.telemetry?.activeStep;
    const activeKey = active ? `${active.idx}:${active.stepType}:${active.statusName}:${active.toolName || ''}:${active.syntheticFallback ? 'fb' : 'real'}` : 'idle';
    if (activeKey !== prevActiveKey) {
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: 'HUD_ACTIVE_PHASE',
        severity: active?.syntheticFallback ? 'warn' : 'info',
        title: active
          ? `HUD Active #${active.idx} ${active.statusName}${active.toolName ? ` (${active.toolName})` : ''}${active.syntheticFallback ? ' [FALLBACK]' : ''}`
          : 'HUD Active -> IDLE',
        detail: active?.modelDisplay || active?.model || '',
      });
      prevActiveKey = activeKey;
    }

    for (const s of f.db?.stepsDelta || []) {
      const sum = s.summary;
      if (!sum) continue;
      const sev = sum.stepType === 17 || sum.status === 4 || sum.status === 7
        ? 'error'
        : sum.status === 6
          ? 'warn'
          : 'info';
      let detail = '';
      if (sum.stepType === 14) detail = sum.promptPreview;
      else if (sum.stepType === 15) detail = `think=${sum.plannerSummary?.thinkingChars || 0}ch reply=${sum.plannerSummary?.replyChars || 0}ch tools=[${(sum.plannerSummary?.toolCalls || []).join(',')}]`;
      else if (sum.error) detail = sum.error.shortError || sum.error.userMessage || '';
      else if (sum.toolName) detail = sum.toolName;
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: `DB_STEP_${sum.stepTypeName}`,
        severity: sev,
        title: `DB step #${sum.idx} ${sum.stepTypeName} -> ${sum.statusName}`,
        detail,
      });
    }

    for (const g of f.db?.gmDelta || []) {
      const p = g.parsedSummary;
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: 'DB_GEN_METADATA',
        severity: 'info',
        title: `DB gen_metadata #${g.idx} (step=${p?.lastStepIndex !== null && p?.lastStepIndex !== undefined ? p.lastStepIndex + 1 : '?'})`,
        detail: p ? `${p.model} | ttft=${p.ttftSec.toFixed(2)}s gen=${p.genSec.toFixed(2)}s out=${p.outputTokens} ctx=${p.totalContext}/${p.contextLimit}` : '',
      });
    }

    for (const a of f.anomalies || []) {
      events.push({
        tsMs: f.tsMs,
        elapsedMs: f.elapsedMs,
        seq: f.seq,
        kind: `ANOMALY_${a.code}`,
        severity: a.severity,
        title: `[${a.layer.toUpperCase()}:${a.code}]`,
        detail: a.message,
      });
    }
  }

  return { meta, summary, events };
}
