import { createHash } from 'node:crypto';

import {
  extractLiveStepFromTrajectory,
} from '../../../plugin/sidecars/hud_panel/lib/ls-client.ts';
import {
  iterFields,
  parseCompactPayload,
  parsePlannerPayload,
  parseStepMetadata,
  parseUserPromptPayload,
} from '../../../plugin/sidecars/hud_panel/lib/protobuf.ts';
import {
  readTelemetry,
  toLightTelemetryPayload,
} from '../../../plugin/sidecars/hud_panel/lib/telemetry.ts';

export const TRACE_SCHEMA_VERSION = 1;

export const DB_STEP_TYPE_NAMES = {
  14: 'USER_INPUT',
  15: 'PLANNER_RESPONSE',
  17: 'ERROR_MESSAGE',
  23: 'CHECKPOINT_COMPACT',
  101: 'EPHEMERAL_OR_CMD_STATE',
  132: 'TOOL_STEP',
};

export const DB_STEP_STATUS_NAMES = {
  0: 'UNSPECIFIED',
  1: 'PENDING',
  2: 'RUNNING',
  3: 'DONE',
  4: 'ERROR',
  5: 'CANCELLED',
  6: 'REJECTED_OR_CANCELLED',
  7: 'FAILED',
  8: 'GENERATING',
  9: 'WAITING',
  11: 'QUEUED',
};

export function sha1Hex(bufOrStr) {
  return createHash('sha1').update(bufOrStr).digest('hex');
}

export function asBuffer(val) {
  if (!val) return Buffer.alloc(0);
  return Buffer.isBuffer(val) ? val : Buffer.from(val);
}

export function decodeErrorStepPayload(payloadBuf) {
  const buf = asBuffer(payloadBuf);
  if (!buf.length) return null;
  let userMessage = '';
  let shortError = '';
  let fullError = '';
  let errorId = '';
  let category = null;

  const readErrorDetails = (subBuf) => {
    for (const [fn, wt, val] of iterFields(subBuf)) {
      if (wt !== 2) continue;
      const str = Buffer.from(val).toString('utf8');
      if (fn === 1 && !userMessage) userMessage = str;
      else if (fn === 2 && !shortError) shortError = str;
      else if (fn === 3 && !fullError) fullError = str;
      else if (fn === 6 && !errorId) errorId = str;
    }
  };

  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt !== 2) continue;
    if (fn === 24) {
      for (const [ef, ew, ev] of iterFields(val)) {
        if (ew === 2 && ef === 3) readErrorDetails(ev);
        else if (ew === 0 && ef === 5) category = Number(ev);
      }
    } else if (fn === 31) {
      readErrorDetails(val);
    }
  }

  if (!userMessage && !shortError && !fullError) return null;
  return {
    userMessage: userMessage.slice(0, 400),
    shortError: shortError.slice(0, 600),
    fullError: fullError.slice(0, 2000),
    errorId,
    category,
  };
}

export function decodeToolErrorPayload(payloadBuf) {
  const buf = asBuffer(payloadBuf);
  if (!buf.length) return null;
  let userMessage = '';
  let shortError = '';
  let fullError = '';
  for (const [fn, wt, val] of iterFields(buf)) {
    if (wt === 2 && fn === 31) {
      for (const [ef, ew, ev] of iterFields(val)) {
        if (ew !== 2) continue;
        const s = Buffer.from(ev).toString('utf8');
        if (ef === 1 && !userMessage) userMessage = s;
        else if (ef === 2 && !shortError) shortError = s;
        else if (ef === 3 && !fullError) fullError = s;
      }
    }
  }
  if (!userMessage && !shortError && !fullError) return null;
  return {
    userMessage: userMessage.slice(0, 400),
    shortError: shortError.slice(0, 600),
    fullError: fullError.slice(0, 2000),
  };
}

export function summarizeDbStep(row) {
  const meta = row.metadata ? parseStepMetadata(asBuffer(row.metadata)) : null;
  const payloadBuf = asBuffer(row.step_payload);
  let error = null;
  let promptPreview = '';
  let plannerSummary = null;
  let compactSummary = '';

  if (row.step_type === 14 && payloadBuf.length) {
    const p = parseUserPromptPayload(payloadBuf);
    promptPreview = p.preview;
  } else if (row.step_type === 15 && payloadBuf.length) {
    const pr = parsePlannerPayload(payloadBuf, true);
    if (pr) {
      plannerSummary = {
        thinkingChars: pr.thinkingChars,
        replyChars: pr.replyChars,
        toolCalls: (pr.toolCalls || []).map((tc) => tc.name),
      };
    }
  } else if (row.step_type === 17 && payloadBuf.length) {
    error = decodeErrorStepPayload(payloadBuf);
  } else if (row.step_type === 23 && payloadBuf.length) {
    compactSummary = parseCompactPayload(payloadBuf).slice(0, 200);
  } else if (row.step_type === 132 && (row.status === 6 || row.status === 7 || row.status === 4) && payloadBuf.length) {
    error = decodeToolErrorPayload(payloadBuf);
  }

  return {
    idx: row.idx,
    stepType: row.step_type,
    stepTypeName: DB_STEP_TYPE_NAMES[row.step_type] || `TYPE_${row.step_type}`,
    status: row.status,
    statusName: DB_STEP_STATUS_NAMES[row.status] || `STATUS_${row.status}`,
    createdAtMs: meta?.createdAtMs || 0,
    startedAtMs: meta?.startedAtMs || 0,
    streamStartMs: meta?.streamStartMs || 0,
    completedAtMs: meta?.completedAtMs || 0,
    endAtMs: meta?.endAtMs || 0,
    modelEnum: meta?.modelEnum ?? null,
    toolName: meta?.toolName || '',
    gmIdx: meta?.gmIdx ?? null,
    botId: meta?.botId || '',
    promptPreview,
    plannerSummary,
    compactSummary,
    error,
  };
}

export function compactLsStepForTrace(step, idx) {
  if (!step || typeof step !== 'object') return null;
  const meta = step.metadata || {};
  const pr = step.plannerResponse || null;
  const ui = step.userInput || null;
  const errMsg = step.errorMessage || step.error || null;
  return {
    idx,
    type: step.type || '',
    status: step.status || '',
    metadata: {
      createdAt: meta.createdAt || '',
      startedAt: meta.startedAt || '',
      viewableAt: meta.viewableAt || '',
      finishedGeneratingAt: meta.finishedGeneratingAt || '',
      completedAt: meta.completedAt || '',
      finishedAt: meta.finishedAt || '',
      generatorModel: meta.generatorModel || '',
      executionId: meta.executionId || '',
      toolCall: meta.toolCall ? { id: meta.toolCall.id || '', name: meta.toolCall.name || '' } : null,
      modelUsage: meta.modelUsage || null,
      internalMetadata: meta.internalMetadata?.statusTransitions
        ? { statusTransitions: meta.internalMetadata.statusTransitions }
        : undefined,
    },
    plannerResponse: pr
      ? {
          thinking: pr.thinking || '',
          response: pr.response || '',
          modifiedResponse: pr.modifiedResponse || '',
          toolCalls: (pr.toolCalls || []).map((tc) => ({
            id: tc.id || '',
            name: tc.name || '',
            argumentsJson: tc.argumentsJson || '',
          })),
        }
      : undefined,
    userInput: ui
      ? {
          userResponse: ui.userResponse || '',
          text: ui.text || '',
          query: ui.query || '',
          items: Array.isArray(ui.items) ? ui.items : undefined,
        }
      : undefined,
    errorMessage: errMsg || undefined,
    rawKeys: Object.keys(step),
  };
}

export function mergeTelemetryWithLiveOverlay(telemetry, liveOverlay) {
  if (!liveOverlay?.available && !liveOverlay?.liveStep) return telemetry;
  const out = { ...telemetry };
  if (!liveOverlay.liveStep) {
    out.activeStep = null;
    if (out.currentModel?.isActive) {
      out.currentModel = out.latest
        ? {
            model: out.latest.model,
            modelId: out.latest.modelId,
            modelDisplay: out.latest.modelDisplay,
            isActive: false,
            stepType: null,
            toolName: '',
          }
        : null;
    }
    return out;
  }
  let lsStep = liveOverlay.liveStep;
  if (lsStep.syntheticFallback && out.pendingCompact) {
    lsStep = {
      ...lsStep,
      stepType: 23,
      statusName: 'COMPACTING',
      createdAtMs: out.pendingCompact.startedAtMs || out.pendingCompact.createdAtMs || lsStep.createdAtMs,
    };
  }
  const latestTurn = out.turns?.length ? out.turns[out.turns.length - 1] : null;
  const fallbackModel = out.currentModel || out.latest || null;
  const resolvedModel = (lsStep.modelDisplay || lsStep.model)
    ? lsStep
    : {
        model: fallbackModel?.model || '',
        modelId: fallbackModel?.modelId || '',
        modelDisplay: fallbackModel?.modelDisplay || '',
      };
  out.activeStep = {
    ...lsStep,
    turnIndex: latestTurn?.turnIndex || null,
    model: resolvedModel.model,
    modelId: resolvedModel.modelId,
    modelDisplay: resolvedModel.modelDisplay,
  };
  if (resolvedModel.modelDisplay || resolvedModel.model) {
    out.currentModel = {
      model: resolvedModel.model,
      modelId: resolvedModel.modelId,
      modelDisplay: resolvedModel.modelDisplay,
      isActive: true,
      stepType: lsStep.stepType,
      toolName: lsStep.toolName,
      statusName: lsStep.statusName,
    };
  }
  return out;
}

export function evaluateHudFromDbAndLs({ dbPath, conversations = [], fallbackTsMs = 0, lsTrajectory = null }) {
  try {
    const rawTel = readTelemetry(dbPath, conversations, fallbackTsMs);
    const light = toLightTelemetryPayload(rawTel);
    const dbHadActiveStep = Boolean(light.activeStep);
    let liveOverlay = null;
    if (lsTrajectory && lsTrajectory.summary) {
      liveOverlay = extractLiveStepFromTrajectory({
        stepCount: Number(lsTrajectory.summary.stepCount || 0),
        runStatus: String(lsTrajectory.summary.status || ''),
        lastModifiedTime: lsTrajectory.summary.lastModifiedTime || '',
        steps: lsTrajectory.steps || [],
        offset: Number(lsTrajectory.stepOffset || 0),
        nowMs: lsTrajectory.nowMs || Date.now(),
      });
    }
    const merged = mergeTelemetryWithLiveOverlay(light, liveOverlay);
    return {
      ok: true,
      error: '',
      dbHadActiveStep,
      liveOverlay,
      telemetry: merged,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.stack || err?.message || String(err),
      dbHadActiveStep: false,
      liveOverlay: null,
      telemetry: null,
    };
  }
}
