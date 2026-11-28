import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { statSafe } from '../../../plugin/sidecars/hud_panel/lib/constants.ts';
import {
  getConversationGraph,
  pickTargetConversation,
} from '../../../plugin/sidecars/hud_panel/lib/graph.ts';
import { parseGenRow } from '../../../plugin/sidecars/hud_panel/lib/protobuf.ts';
import { listConversations } from '../../../plugin/sidecars/hud_panel/lib/telemetry.ts';
import { detectFrameAnomalies } from './anomalies.mjs';
import { callLsRpc, discoverLsConnection, resolveDataDir } from './ls-probe.mjs';
import {
  asBuffer,
  compactLsStepForTrace,
  evaluateHudFromDbAndLs,
  sha1Hex,
  summarizeDbStep,
  TRACE_SCHEMA_VERSION,
} from './step-decoder.mjs';

export class TraceRecorder {
  constructor({
    outPath,
    appDataDir = resolveDataDir(),
    mode = 'auto',
    explicitConvId = '',
    useLs = true,
    lsTailSteps = 16,
    includeRawDb = true,
    heartbeatMs = 10_000,
  }) {
    this.outPath = outPath;
    this.appDataDir = appDataDir;
    this.conversationsDir = join(appDataDir, 'conversations');
    this.annotationsDir = join(appDataDir, 'annotations');
    this.mode = mode;
    this.explicitConvId = explicitConvId;
    this.useLs = useLs;
    this.lsTailSteps = lsTailSteps;
    this.includeRawDb = includeRawDb;
    this.heartbeatMs = heartbeatMs;

    this.lsConn = useLs ? discoverLsConnection(appDataDir) : null;
    this.fd = null;
    this.startedAtMs = 0;
    this.seq = 0;
    this.lastEmitMs = 0;
    this.lastToolStreamEmitMs = 0;
    this.prevAutoTargetId = '';
    this.recentTargets = [];
    this.prevConvState = new Map();
    this.prevLsSigByConv = new Map();
    this.prevHudSig = '';
    this.prevFrameCtx = null;
    this.seenLsErrorStepIdxs = new Set();
    this.seenLsFailedStepIdxs = new Set();

    this.stats = {
      polls: 0,
      framesWritten: 0,
      anomaliesCount: 0,
      anomalyCountsByCode: {},
      targetConvIds: new Set(),
    };
  }

  open() {
    mkdirSync(dirname(this.outPath), { recursive: true });
    this.fd = openSync(this.outPath, 'w');
    this.startedAtMs = Date.now();
    this._writeLine({
      kind: 'meta',
      schemaVersion: TRACE_SCHEMA_VERSION,
      startedAtMs: this.startedAtMs,
      startedAtIso: new Date(this.startedAtMs).toISOString(),
      appDataDir: this.appDataDir,
      mode: this.mode,
      explicitConvId: this.explicitConvId,
      useLs: this.useLs,
      lsInfo: this.lsConn
        ? {
            source: this.lsConn.source,
            pid: this.lsConn.pid,
            lsVersion: this.lsConn.lsVersion,
            baseUrls: this.lsConn.baseUrls,
          }
        : null,
    });
  }

  close() {
    if (this.fd !== null) {
      this._writeLine({
        kind: 'summary',
        endedAtMs: Date.now(),
        elapsedMs: Date.now() - this.startedAtMs,
        polls: this.stats.polls,
        framesWritten: this.stats.framesWritten,
        anomaliesCount: this.stats.anomaliesCount,
        anomalyCountsByCode: this.stats.anomalyCountsByCode,
        targetConvIds: [...this.stats.targetConvIds],
      });
      closeSync(this.fd);
      this.fd = null;
    }
  }

  _writeLine(obj) {
    if (this.fd === null) throw new Error('TraceRecorder is not open');
    writeSync(this.fd, `${JSON.stringify(obj)}\n`, null, 'utf8');
  }

  async pollOnce() {
    this.stats.polls += 1;
    const nowMs = Date.now();
    const conversations = listConversations(this.conversationsDir, this.annotationsDir, 0);

    let lsAllRes = null;
    let lsSummaries = undefined;
    if (this.useLs) {
      if (!this.lsConn) this.lsConn = discoverLsConnection(this.appDataDir);
      if (this.lsConn) {
        lsAllRes = await callLsRpc(this.lsConn, 'GetAllCascadeTrajectories', {}, 1200);
        if (lsAllRes.ok) {
          lsSummaries = lsAllRes.data?.trajectorySummaries || {};
        } else {
          const fresh = discoverLsConnection(this.appDataDir);
          if (fresh) this.lsConn = fresh;
        }
      }
    }

    if (!conversations.length) {
      return { written: false, targetId: '', anomalies: [] };
    }

    const graph = getConversationGraph(conversations, this.explicitConvId);
    const target = pickTargetConversation({
      mode: this.mode,
      explicitConvId: this.explicitConvId,
      conversations,
      graph,
      lsSummaries,
      prevAutoTargetId: this.prevAutoTargetId,
    });
    if (!this.explicitConvId && target?.id) {
      this.prevAutoTargetId = target.id;
    }
    this.stats.targetConvIds.add(target.id);
    this.recentTargets.push(target.id);
    if (this.recentTargets.length > 10) this.recentTargets.shift();

    let lsTailRes = null;
    let lsTargetSum = lsSummaries?.[target.id] || null;
    let stepOffset = 0;
    let rawLsSteps = [];
    let compactLsSteps = [];
    if (this.useLs && this.lsConn && lsAllRes?.ok && lsTargetSum) {
      const stepCount = Number(lsTargetSum.stepCount || 0);
      const prevKnownCount = this.prevLsSigByConv.get(target.id)?.stepCount ?? stepCount;
      const startHint = Math.min(Math.max(0, prevKnownCount - 2), Math.max(0, stepCount - this.lsTailSteps));
      stepOffset = stepCount > 0 ? startHint : 0;
      if (stepCount > 0) {
        lsTailRes = await callLsRpc(
          this.lsConn,
          'GetCascadeTrajectorySteps',
          { cascadeId: target.id, stepOffset },
          1200,
        );
        if (lsTailRes.ok && Array.isArray(lsTailRes.data?.steps)) {
          rawLsSteps = lsTailRes.data.steps;
          compactLsSteps = rawLsSteps.map((s, i) => compactLsStepForTrace(s, stepOffset + i));
        }
      }
    }

    const dbSnap = this._readDbWithDelta(target);
    const lsTrajectory = lsTargetSum
      ? { summary: lsTargetSum, stepOffset, steps: rawLsSteps, nowMs }
      : null;
    const hudEval = evaluateHudFromDbAndLs({
      dbPath: target.dbPath,
      conversations,
      fallbackTsMs: target.dbMtimeMs || target.updatedMs || nowMs,
      lsTrajectory,
    });

    const lsOk = this.useLs
      ? Boolean(this.lsConn && lsAllRes?.ok && (!lsTargetSum || lsTailRes?.ok || Number(lsTargetSum.stepCount || 0) === 0))
      : true;
    const lsErr = !this.useLs
      ? ''
      : !this.lsConn
        ? 'no_ls_daemon'
        : !lsAllRes?.ok
          ? (lsAllRes?.error || 'ls_all_error')
          : (lsTailRes && !lsTailRes.ok ? lsTailRes.error : '');

    const lsBlock = {
      enabled: this.useLs,
      ok: lsOk,
      error: lsErr,
      latencyMs: (lsAllRes?.latencyMs || 0) + (lsTailRes?.latencyMs || 0),
      trajectoryCount: lsSummaries ? Object.keys(lsSummaries).length : 0,
      summary: lsTargetSum
        ? {
            stepCount: Number(lsTargetSum.stepCount || 0),
            status: lsTargetSum.status || '',
            lastModifiedTime: lsTargetSum.lastModifiedTime || '',
            createdTime: lsTargetSum.createdTime || '',
          }
        : null,
      stepOffset,
      steps: compactLsSteps,
    };

    const tel = hudEval.telemetry;
    const hudBlock = {
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
      tsMs: nowMs,
      target: { id: target.id, key: target.key, annoKey: target.annoKey },
      ls: lsBlock,
      db: {
        dbSize: dbSnap.dbSize,
        walSize: dbSnap.walSize,
        walMtimeMs: dbSnap.walMtimeMs,
        stepCount: dbSnap.stepCount,
        gmCount: dbSnap.gmCount,
        stepsDelta: dbSnap.stepsDelta,
        stepsRemoved: dbSnap.stepsRemoved,
        gmDelta: dbSnap.gmDelta,
        gmRemoved: dbSnap.gmRemoved,
        stepSummaryMap: dbSnap.stepSummaryMap,
      },
      hud: hudBlock,
    };

    const prevWithSeen = this.prevFrameCtx
      ? {
          ...this.prevFrameCtx,
          _seenLsErrorStepIdxs: this.seenLsErrorStepIdxs,
          _seenLsFailedStepIdxs: this.seenLsFailedStepIdxs,
        }
      : null;
    const anomalies = detectFrameAnomalies({
      curr: currCtx,
      prev: prevWithSeen,
      recentTargets: this.recentTargets,
      isBaseline: this.seq === 0,
      nowMs,
    });

    for (let i = 0; i < compactLsSteps.length; i++) {
      const st = compactLsSteps[i];
      if (!st) continue;
      const stepIdx = stepOffset + i;
      if (st.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') this.seenLsErrorStepIdxs.add(stepIdx);
      if (st.status === 'CORTEX_STEP_STATUS_ERROR' || st.status === 'CORTEX_STEP_STATUS_CANCELLED' || st.status === 'CORTEX_STEP_STATUS_CANCELED') {
        this.seenLsFailedStepIdxs.add(`${stepIdx}:${st.status}`);
      }
    }

    const lsSig = JSON.stringify({
      ok: lsBlock.ok,
      err: lsBlock.error,
      sum: lsBlock.summary,
      steps: compactLsSteps.map((s) => ({
        idx: s.idx,
        t: s.type,
        st: s.status,
        tc: s.plannerResponse?.thinking?.length || 0,
        rc: (s.plannerResponse?.modifiedResponse || s.plannerResponse?.response || '').length,
        tcs: (s.plannerResponse?.toolCalls || []).length,
        gm: s.metadata?.generatorModel || '',
        err: s.errorMessage ? 1 : 0,
      })),
    });
    const prevLs = this.prevLsSigByConv.get(target.id);
    const lsChanged = !prevLs || prevLs.sig !== lsSig;
    this.prevLsSigByConv.set(target.id, { sig: lsSig, stepCount: lsBlock.summary?.stepCount || 0 });

    const hudSig = JSON.stringify({
      ok: hudBlock.ok,
      err: hudBlock.error,
      target: target.id,
      key: target.key,
      active: hudBlock.telemetry?.activeStep
        ? `${hudBlock.telemetry.activeStep.idx}:${hudBlock.telemetry.activeStep.stepType}:${hudBlock.telemetry.activeStep.status}:${hudBlock.telemetry.activeStep.thinkingChars}:${hudBlock.telemetry.activeStep.replyChars}:${hudBlock.telemetry.activeStep.syntheticFallback ? 1 : 0}`
        : '',
      cnt: hudBlock.telemetry?.summary?.count || 0,
      turns: hudBlock.telemetry?.turnsCount || 0,
    });
    const hudChanged = this.prevHudSig !== hudSig;
    this.prevHudSig = hudSig;

    const dbChanged = dbSnap.hasDelta;
    const isOnlyToolPayloadChurn = dbChanged
      && !lsChanged
      && !hudChanged
      && !anomalies.length
      && !dbSnap.gmDelta.length
      && !dbSnap.gmRemoved.length
      && !dbSnap.stepsRemoved.length
      && dbSnap.stepsDelta.length > 0
      && dbSnap.stepsDelta.every((s) => s.stepType === 132 && !s.isNew && !s.headerChanged);
    const targetChanged = this.prevFrameCtx && this.prevFrameCtx.target.id !== target.id;
    const heartbeatDue = this.heartbeatMs > 0 && nowMs - this.lastEmitMs >= this.heartbeatMs;

    this.prevFrameCtx = currCtx;

    if (this.seq > 0) {
      if (isOnlyToolPayloadChurn && nowMs - this.lastToolStreamEmitMs < 2000 && !heartbeatDue) {
        return { written: false, targetId: target.id, anomalies: [] };
      }
      if (!dbChanged && !lsChanged && !hudChanged && !targetChanged && !anomalies.length && !heartbeatDue) {
        return { written: false, targetId: target.id, anomalies: [] };
      }
    }
    if (isOnlyToolPayloadChurn) {
      this.lastToolStreamEmitMs = nowMs;
    }
    dbSnap.commit();

    const frame = {
      kind: 'frame',
      seq: this.seq++,
      tsMs: nowMs,
      elapsedMs: nowMs - this.startedAtMs,
      target: {
        id: target.id,
        key: target.key,
        annoKey: target.annoKey,
      },
      ls: lsBlock,
      db: {
        dbSize: dbSnap.dbSize,
        walSize: dbSnap.walSize,
        walMtimeMs: dbSnap.walMtimeMs,
        stepCount: dbSnap.stepCount,
        gmCount: dbSnap.gmCount,
        stepsDelta: dbSnap.stepsDelta,
        stepsRemoved: dbSnap.stepsRemoved,
        gmDelta: dbSnap.gmDelta,
        gmRemoved: dbSnap.gmRemoved,
      },
      hud: hudBlock,
      anomalies,
    };

    this._writeLine(frame);
    this.lastEmitMs = nowMs;
    this.stats.framesWritten += 1;
    this.stats.anomaliesCount += anomalies.length;
    for (const a of anomalies) {
      this.stats.anomalyCountsByCode[a.code] = (this.stats.anomalyCountsByCode[a.code] || 0) + 1;
    }

    return { written: true, frame, targetId: target.id, anomalies };
  }

  _readDbWithDelta(target) {
    const dbStat = statSafe(target.dbPath);
    const walStat = statSafe(`${target.dbPath}-wal`);
    let prev = this.prevConvState.get(target.id);
    if (!prev) {
      prev = { stepHashes: new Map(), gmHashes: new Map() };
      this.prevConvState.set(target.id, prev);
    }

    const nextStepHashes = new Map(prev.stepHashes);
    const nextGmHashes = new Map(prev.gmHashes);
    const stepsDelta = [];
    const gmDelta = [];
    const stepSummaryMap = new Map();
    const seenStepIdxs = new Set();
    const seenGmIdxs = new Set();
    let stepCount = 0;
    let gmCount = 0;

    let db;
    try {
      db = new DatabaseSync(target.dbPath, { readOnly: true });
      const stepRows = db
        .prepare('SELECT idx, step_type, status, metadata, step_payload FROM steps ORDER BY idx ASC')
        .all();
      stepCount = stepRows.length;
      for (const r of stepRows) {
        seenStepIdxs.add(r.idx);
        const metaBuf = asBuffer(r.metadata);
        const payloadBuf = asBuffer(r.step_payload);
        const headerHash = sha1Hex(Buffer.concat([Buffer.from(`${r.step_type}:${r.status}:`), metaBuf]));
        const rowHash = sha1Hex(Buffer.concat([Buffer.from(`${headerHash}:`), payloadBuf]));
        const sum = summarizeDbStep(r);
        stepSummaryMap.set(r.idx, sum);
        const prevEntry = prev.stepHashes.get(r.idx);
        const prevRowHash = typeof prevEntry === 'string' ? prevEntry : prevEntry?.rowHash;
        const prevHeaderHash = typeof prevEntry === 'string' ? '' : (prevEntry?.headerHash || '');
        if (prevRowHash !== rowHash) {
          nextStepHashes.set(r.idx, { rowHash, headerHash });
          stepsDelta.push({
            idx: r.idx,
            stepType: r.step_type,
            status: r.status,
            isNew: !prevEntry,
            headerChanged: !prevEntry || prevHeaderHash !== headerHash,
            summary: sum,
            ...(this.includeRawDb
              ? {
                  metadataB64: metaBuf.length ? metaBuf.toString('base64') : '',
                  stepPayloadB64: payloadBuf.length ? payloadBuf.toString('base64') : '',
                }
              : {}),
          });
        }
      }

      const gmRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      gmCount = gmRows.length;
      for (const r of gmRows) {
        seenGmIdxs.add(r.idx);
        const dataBuf = asBuffer(r.data);
        const rowHash = sha1Hex(dataBuf);
        if (prev.gmHashes.get(r.idx) !== rowHash) {
          nextGmHashes.set(r.idx, rowHash);
          const parsed = parseGenRow(r.idx, dataBuf);
          gmDelta.push({
            idx: r.idx,
            parsedSummary: parsed
              ? {
                  idx: parsed.idx,
                  lastStepIndex: parsed.lastStepIndex,
                  botId: parsed.botId,
                  model: parsed.model,
                  modelId: parsed.modelId,
                  modelDisplay: parsed.modelDisplay,
                  modelEnum: parsed.modelEnum,
                  newInput: parsed.newInput,
                  cachedInput: parsed.cachedInput,
                  outputTokens: parsed.outputTokens,
                  thinkingTokens: parsed.thinkingTokens,
                  candidateTokens: parsed.candidateTokens,
                  ttftSec: parsed.ttftSec,
                  genSec: parsed.genSec,
                  totalContext: parsed.totalContext,
                  contextLimit: parsed.contextLimit,
                }
              : null,
            ...(this.includeRawDb ? { dataB64: dataBuf.toString('base64') } : {}),
          });
        }
      }
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }

    const stepsRemoved = [];
    for (const k of [...nextStepHashes.keys()]) {
      if (!seenStepIdxs.has(k)) {
        nextStepHashes.delete(k);
        stepsRemoved.push(k);
      }
    }
    const gmRemoved = [];
    for (const k of [...nextGmHashes.keys()]) {
      if (!seenGmIdxs.has(k)) {
        nextGmHashes.delete(k);
        gmRemoved.push(k);
      }
    }

    return {
      dbSize: dbStat.size,
      walSize: walStat.size,
      walMtimeMs: walStat.mtimeMs,
      stepCount,
      gmCount,
      stepsDelta,
      stepsRemoved,
      gmDelta,
      gmRemoved,
      stepSummaryMap,
      hasDelta: stepsDelta.length > 0 || stepsRemoved.length > 0 || gmDelta.length > 0 || gmRemoved.length > 0,
      commit: () => {
        prev.stepHashes = nextStepHashes;
        prev.gmHashes = nextGmHashes;
      },
    };
  }
}
