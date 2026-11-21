import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ACTIVE_STEP_STATUSES,
  LS_ACTIVE_STEP_STATUSES,
  LS_TERMINAL_STEP_STATUSES,
  parseIsoMs,
  statSafe,
  STEP_STATUS_NAMES,
  TERMINAL_STEP_STATUSES,
  UUID_RE,
} from '../../plugin/sidecars/hud_panel/lib/constants.ts';
import {
  getConversationGraph,
  pickTargetConversation,
} from '../../plugin/sidecars/hud_panel/lib/graph.ts';
import {
  extractLiveStepFromTrajectory,
  isCascadeStatusActive,
  isLoopbackHost,
  normalizeLsBaseUrl,
} from '../../plugin/sidecars/hud_panel/lib/ls-client.ts';
import {
  iterFields,
  parseCompactPayload,
  parseGenRow,
  parsePlannerPayload,
  parseStepMetadata,
  parseUserPromptPayload,
} from '../../plugin/sidecars/hud_panel/lib/protobuf.ts';
import {
  listConversations,
  readTelemetry,
  toLightTelemetryPayload,
} from '../../plugin/sidecars/hud_panel/lib/telemetry.ts';

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

function sha1Hex(bufOrStr) {
  return createHash('sha1').update(bufOrStr).digest('hex');
}

function asBuffer(val) {
  if (!val) return Buffer.alloc(0);
  return Buffer.isBuffer(val) ? val : Buffer.from(val);
}

export function resolveDataDir(explicitDir = '') {
  if (explicitDir) return explicitDir;
  if (process.env.ANTIGRAVITY_APP_DATA_DIR) return process.env.ANTIGRAVITY_APP_DATA_DIR;
  return join(homedir(), '.gemini', 'antigravity');
}

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function buildBaseUrlsFromAddr(rawAddr) {
  const norm = normalizeLsBaseUrl(rawAddr);
  if (!norm) return [];
  const out = [norm];
  if (!/^https?:\/\//i.test(String(rawAddr).trim()) && norm.startsWith('https://')) {
    try {
      if (isLoopbackHost(new URL(norm).hostname)) {
        out.push(norm.replace(/^https:/, 'http:'));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function discoverLsConnection(appDataDir = resolveDataDir()) {
  const envAddr = process.env.ANTIGRAVITY_LS_ADDRESS || '';
  const envCsrf = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  if (envAddr && envCsrf) {
    const baseUrls = buildBaseUrlsFromAddr(envAddr);
    if (baseUrls.length) {
      return {
        source: 'env',
        baseUrls,
        csrfToken: envCsrf,
        pid: null,
        lsVersion: '',
        daemonFile: '',
      };
    }
  }

  const daemonDir = join(appDataDir, 'daemon');
  if (!existsSync(daemonDir)) return null;

  let files = [];
  try {
    files = readdirSync(daemonDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = join(daemonDir, f);
        return { path: p, stat: statSafe(p) };
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  } catch {
    return null;
  }

  for (const item of files) {
    try {
      const raw = JSON.parse(readFileSync(item.path, 'utf8'));
      if (!raw?.csrfToken) continue;
      if (raw.pid && !isPidAlive(raw.pid)) continue;
      const baseUrls = [];
      if (raw.httpPort) baseUrls.push(`http://127.0.0.1:${raw.httpPort}`);
      if (raw.httpsPort) baseUrls.push(`https://127.0.0.1:${raw.httpsPort}`);
      if (!baseUrls.length) continue;
      return {
        source: 'daemon',
        baseUrls,
        csrfToken: String(raw.csrfToken),
        pid: Number(raw.pid || 0) || null,
        lsVersion: String(raw.lsVersion || ''),
        daemonFile: item.path,
      };
    } catch {
      /* ignore malformed daemon file */
    }
  }
  return null;
}

function postConnectJson(urlStr, headers, payload, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = url.protocol === 'https:';
    const isLocal = isLoopbackHost(url.hostname);
    if (!isLocal) {
      reject(new Error(`refusing non-loopback LS host: ${url.hostname}`));
      return;
    }
    const mod = isHttps ? https : http;
    const body = JSON.stringify(payload);
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Connect-Protocol-Version': '1',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`invalid JSON response: ${err.message}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function callLsRpc(conn, method, payload, timeoutMs = 1500) {
  if (!conn || !conn.baseUrls?.length || !conn.csrfToken) {
    return { ok: false, latencyMs: 0, error: 'no_ls_connection', data: null };
  }
  const path = `/exa.language_server_pb.LanguageServerService/${method}`;
  const headers = { 'x-codeium-csrf-token': conn.csrfToken };
  const t0 = performance.now();
  let lastErr = null;

  for (const baseUrl of conn.baseUrls) {
    try {
      const data = await postConnectJson(`${baseUrl}${path}`, headers, payload, timeoutMs);
      if (conn.baseUrls[0] !== baseUrl) {
        conn.baseUrls = [baseUrl, ...conn.baseUrls.filter((u) => u !== baseUrl)];
      }
      return { ok: true, latencyMs: Math.round(performance.now() - t0), error: '', data };
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    ok: false,
    latencyMs: Math.round(performance.now() - t0),
    error: lastErr?.message || 'rpc_error',
    data: null,
  };
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

export function detectFrameAnomalies({ curr, prev = null, recentTargets = [], isBaseline = false, nowMs = 0 }) {
  const anomalies = [];
  const push = (code, severity, layer, message, details = {}, historical = false) => {
    anomalies.push({ code, severity, layer, message, details, ...(historical ? { historical: true } : {}) });
  };

  if (curr.ls && curr.ls.enabled && !curr.ls.ok) {
    push('LS_RPC_ERROR', 'error', 'ls', `LS RPC 失败: ${curr.ls.error}`, {
      error: curr.ls.error,
      latencyMs: curr.ls.latencyMs,
    });
  }

  if (curr.hud && !curr.hud.ok) {
    push('DB_READ_ERROR', 'error', 'hud', `HUD telemetry 解析异常: ${curr.hud.error}`, {
      error: curr.hud.error,
    });
  }

  if (recentTargets.length >= 3) {
    const a = recentTargets[recentTargets.length - 3];
    const b = recentTargets[recentTargets.length - 2];
    const c = recentTargets[recentTargets.length - 1];
    if (a && b && c && a === c && a !== b) {
      push('TARGET_OSCILLATION', 'warn', 'hud', `目标会话发生抖动: ${a.slice(0, 8)} -> ${b.slice(0, 8)} -> ${c.slice(0, 8)}`, {
        sequence: [a, b, c],
      });
    }
  }

  const lsSum = curr.ls?.summary || null;
  const lsSteps = curr.ls?.steps || [];
  const lsOffset = Number(curr.ls?.stepOffset || 0);
  const lsActive = lsSum ? isCascadeStatusActive(lsSum.status) : false;
  const tel = curr.hud?.telemetry || null;

  if (lsActive && tel) {
    if (!tel.activeStep) {
      push('ACTIVE_STEP_MISSING', 'warn', 'hud', `LS 状态活跃 (${lsSum.status}), 但 HUD activeStep 为空`, {
        runStatus: lsSum.status,
        lsStepCount: lsSum.stepCount,
      });
    } else if (tel.activeStep.syntheticFallback) {
      const refNow = nowMs || curr.tsMs || Date.now();
      const stallSec = tel.activeStep.createdAtMs > 0 ? (refNow - tel.activeStep.createdAtMs) / 1000 : 0;
      let nonTerminalAfterBarrier = false;
      for (let i = lsSteps.length - 1; i >= 0; i--) {
        const s = lsSteps[i];
        if (!s) continue;
        if (s.type === 'CORTEX_STEP_TYPE_USER_INPUT' || s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' || s.type === 'CORTEX_STEP_TYPE_FINISH') {
          if (s.status && !LS_TERMINAL_STEP_STATUSES.has(s.status) && s.type !== 'CORTEX_STEP_TYPE_USER_INPUT') {
            nonTerminalAfterBarrier = true;
          }
          break;
        }
        if (s.status && s.status !== 'CORTEX_STEP_STATUS_UNSPECIFIED' && !LS_TERMINAL_STEP_STATUSES.has(s.status)) {
          nonTerminalAfterBarrier = true;
          break;
        }
      }
      if (nonTerminalAfterBarrier || stallSec >= 10) {
        push('ACTIVE_STEP_SYNTHETIC_FALLBACK', 'warn', 'hud', `LS 活跃但退化为 syntheticFallback (${stallSec.toFixed(1)}s, nonTerminal=${nonTerminalAfterBarrier})`, {
          runStatus: lsSum.status,
          stepCount: lsSum.stepCount,
          stepType: tel.activeStep.stepType,
          stallSec,
          nonTerminalAfterBarrier,
        });
      }
    }
  } else if (lsSum && !lsActive && curr.hud?.dbHadActiveStep && tel && !tel.activeStep) {
    push('STALE_DB_ACTIVE_CLEARED', 'info', 'db', 'DB 存在滞留 RUNNING 步骤，已被 LS IDLE 状态清理', {
      lsStatus: lsSum.status,
    });
  }

  if (lsSum && curr.db && Number.isFinite(curr.db.stepCount)) {
    const lsCount = Number(lsSum.stepCount || 0);
    const dbCount = Number(curr.db.stepCount || 0);
    if (lsCount > dbCount) {
      push('LS_DB_STEP_SKEW', 'info', 'db', `LS 内存步数 (${lsCount}) 领先 SQLite DB (${dbCount}) ${lsCount - dbCount} 步`, {
        lsStepCount: lsCount,
        dbStepCount: dbCount,
        walSize: curr.db.walSize,
      });
    }
  }

  // Check LS vs DB status divergence & error steps in LS tail
  const dbStepMap = curr.db?.stepSummaryMap || null;
  for (let i = 0; i < lsSteps.length; i++) {
    const st = lsSteps[i];
    if (!st) continue;
    const stepIdx = lsOffset + i;
    if (st.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE' && (!prev || !prev._seenLsErrorStepIdxs?.has(stepIdx))) {
      push('AGENT_LS_ERROR_STEP', 'error', 'agent', `LS 出现错误步骤 #${stepIdx}: ${st.errorMessage?.shortError || st.errorMessage?.userMessage || 'ERROR_MESSAGE'}`, {
        stepIdx,
        errorMessage: st.errorMessage || null,
      });
    }
    if (
      (st.status === 'CORTEX_STEP_STATUS_ERROR' || st.status === 'CORTEX_STEP_STATUS_CANCELLED' || st.status === 'CORTEX_STEP_STATUS_CANCELED')
      && (!prev || !prev._seenLsFailedStepIdxs?.has(`${stepIdx}:${st.status}`))
    ) {
      push('LS_STEP_FAILED', st.status === 'CORTEX_STEP_STATUS_ERROR' ? 'error' : 'warn', 'agent', `LS 步骤 #${stepIdx} (${st.type}) 状态为 ${st.status}`, {
        stepIdx,
        type: st.type,
        status: st.status,
        toolName: st.metadata?.toolCall?.name || '',
      });
    }
    if (dbStepMap && dbStepMap.has(stepIdx)) {
      const dbStep = dbStepMap.get(stepIdx);
      const lsIsTerminal = LS_TERMINAL_STEP_STATUSES.has(st.status);
      const dbIsActive = ACTIVE_STEP_STATUSES.has(dbStep.status);
      if (lsIsTerminal && dbIsActive) {
        push('LS_DB_STATUS_DESYNC', 'warn', 'db', `步骤 #${stepIdx} LS 已终态 (${st.status}), 但 DB 仍为活跃 (${dbStep.statusName})`, {
          stepIdx,
          lsStatus: st.status,
          dbStatus: dbStep.status,
          dbStepType: dbStep.stepType,
        });
      }
    }
  }

  // Newly added/updated DB steps errors (17 or status 4/6/7)
  if (curr.db?.stepsDelta) {
    for (const s of curr.db.stepsDelta) {
      const sum = s.summary;
      if (!sum) continue;
      if (sum.stepType === 17) {
        push(
          'AGENT_DB_ERROR_STEP',
          'error',
          'agent',
          `DB 错误步骤 #${sum.idx}: ${sum.error?.shortError || sum.error?.userMessage || 'step_type=17'}`,
          { stepIdx: sum.idx, error: sum.error },
          isBaseline,
        );
      } else if (sum.status === 4 || sum.status === 7) {
        push(
          'TOOL_DB_ERROR_STEP',
          'error',
          'agent',
          `DB 步骤失败 #${sum.idx} (${sum.toolName || sum.stepTypeName}, status=${sum.status}): ${sum.error?.shortError || sum.error?.userMessage || 'failed'}`,
          { stepIdx: sum.idx, status: sum.status, toolName: sum.toolName, error: sum.error },
          isBaseline,
        );
      } else if (sum.status === 6) {
        push(
          'TOOL_DB_CANCELLED_STEP',
          'warn',
          'agent',
          `DB 工具步骤被取消/拒绝 #${sum.idx} (${sum.toolName || sum.stepTypeName}, status=6)`,
          { stepIdx: sum.idx, status: sum.status, toolName: sum.toolName },
          isBaseline,
        );
      } else if (sum.stepType === 15 && TERMINAL_STEP_STATUSES.has(sum.status) && sum.gmIdx === null && !sum.botId) {
        push(
          'PLANNER_MISSING_GM_LINK',
          'warn',
          'db',
          `Planner 步骤 #${sum.idx} 已结束但缺少 gmIdx 与 botId 关联`,
          { stepIdx: sum.idx, status: sum.status },
          isBaseline,
        );
      }
    }
  }

  // HUD telemetry invariants
  if (tel) {
    const sm = tel.summary || {};
    if (sm.peakGenTps > 0 && sm.avgGenTps > sm.peakGenTps + 1e-6) {
      push('TPS_INVARIANT_BROKEN', 'error', 'hud', `avgGenTps (${sm.avgGenTps.toFixed(2)}) > peakGenTps (${sm.peakGenTps.toFixed(2)})`, {
        avgGenTps: sm.avgGenTps,
        peakGenTps: sm.peakGenTps,
      });
    }
    if (tel.activeStep) {
      const m = `${tel.activeStep.modelDisplay || ''} ${tel.activeStep.modelId || ''} ${tel.activeStep.model || ''}`.trim();
      if (!m && tel.activeStep.stepType === 15) {
        push('ACTIVE_MODEL_EMPTY', 'warn', 'hud', `活跃 Planner 步骤 #${tel.activeStep.idx} 模型标识为空`, {
          stepIdx: tel.activeStep.idx,
          statusName: tel.activeStep.statusName,
        });
      } else if (/MODEL_PLACEHOLDER_|^enum:\d+/.test(m)) {
        push('MODEL_PLACEHOLDER_LEAK', 'warn', 'hud', `模型标识未映射: ${m}`, {
          model: tel.activeStep.model,
          modelDisplay: tel.activeStep.modelDisplay,
        });
      }
    }
    if (tel.latest) {
      const inv = tel.latest;
      if (inv.ttftSec < 0 || inv.genSec < 0 || inv.thinkSec < 0 || inv.toolGenSec < 0) {
        push('NEGATIVE_DURATION', 'error', 'hud', `最新调用 #${inv.idx} 出现负耗时`, {
          idx: inv.idx,
          ttftSec: inv.ttftSec,
          genSec: inv.genSec,
          thinkSec: inv.thinkSec,
          toolGenSec: inv.toolGenSec,
        });
      }
      if (/Unknown Model|^enum:\d+/.test(inv.model || '')) {
        push('CALL_MODEL_UNRESOLVED', 'warn', 'hud', `调用 #${inv.idx} 模型未解析: ${inv.model}`, {
          idx: inv.idx,
          modelEnum: inv.modelEnum,
          model: inv.model,
        });
      }
    }

    if (prev?.hud?.telemetry && prev.target?.id === curr.target?.id) {
      const pSm = prev.hud.telemetry.summary || {};
      if ((sm.count || 0) < (pSm.count || 0)) {
        push('CALL_COUNT_REGRESSION', 'error', 'hud', `同会话 Calls 数倒退: ${pSm.count} -> ${sm.count}`, {
          prevCount: pSm.count,
          currCount: sm.count,
        });
      }
      if (prev.ls?.summary && isCascadeStatusActive(prev.ls.summary.status) && !lsActive && (sm.count || 0) === (pSm.count || 0) && prev.hud.telemetry.activeStep?.stepType === 15) {
        push('RUN_ENDED_WITHOUT_NEW_GM', 'info', 'db', `LS 运行结束但尚未见到新的 gen_metadata 落库 (Calls=${sm.count})`, {
          calls: sm.count,
          prevActiveIdx: prev.hud.telemetry.activeStep?.idx,
        });
      }
    }
  }

  return anomalies;
}

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
          // Retry discovery once if daemon restarted
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
    if (!this.recentTargets.length || this.recentTargets[this.recentTargets.length - 1] !== target.id) {
      this.recentTargets.push(target.id);
      if (this.recentTargets.length > 10) this.recentTargets.shift();
    } else {
      this.recentTargets.push(target.id);
      if (this.recentTargets.length > 10) this.recentTargets.shift();
    }

    // Fetch LS trajectory tail steps for target
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

    // Read SQLite DB rows & compute deltas
    const dbSnap = this._readDbWithDelta(target);

    // Evaluate HUD state with exact server logic
    const lsTrajectory = lsTargetSum
      ? { summary: lsTargetSum, stepOffset, steps: rawLsSteps, nowMs }
      : null;
    const hudEval = evaluateHudFromDbAndLs({
      dbPath: target.dbPath,
      conversations,
      fallbackTsMs: target.dbMtimeMs || target.updatedMs || nowMs,
      lsTrajectory,
    });

    const lsOk = this.useLs ? Boolean(this.lsConn && lsAllRes?.ok && (!lsTargetSum || lsTailRes?.ok || Number(lsTargetSum.stepCount || 0) === 0)) : true;
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
        const currCtx = {
          target: frame.target,
          ls: frame.ls,
          db: {
            ...frame.db,
            stepSummaryMap: dbInfo.stepSummaryMap,
          },
          hud: frame.hud,
        };
        prevCtx = currCtx;
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

function wireField(fieldNum, wireType, val) {
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | BigInt(wireType));
  if (wireType === 0) {
    return Buffer.concat([tag, encodeVarint(val)]);
  }
  if (wireType === 2) {
    const b = Buffer.isBuffer(val) ? val : Buffer.from(val);
    return Buffer.concat([tag, encodeVarint(b.length), b]);
  }
  return Buffer.concat([tag, asBuffer(val)]);
}

function redactTextPaths(text, uuidMapper) {
  if (!text) return '';
  let out = String(text)
    .replace(/\/Users\/[^/\s"']+/g, '/Users/redacted')
    .replace(/\/home\/[^/\s"']+/g, '/home/redacted')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\redacted');
  if (uuidMapper) {
    out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => uuidMapper(m));
  }
  return out;
}

function rewriteProtobufMessage(buf, transformField) {
  const fields = iterFields(asBuffer(buf));
  if (!fields.length) return asBuffer(buf);
  const parts = [];
  for (const [fn, wt, val] of fields) {
    const next = transformField(fn, wt, val);
    if (next === null) continue;
    parts.push(wireField(fn, wt, next));
  }
  return Buffer.concat(parts);
}

export function redactProtobufBlob(kind, rawBuf, uuidMapper = (id) => id) {
  const buf = asBuffer(rawBuf);
  if (!buf.length) return buf;

  if (kind === 'step_metadata') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 9) {
        return rewriteProtobufMessage(val, (uf, uw, uv) => {
          if (uw === 2 && uf === 7) {
            return Buffer.from(uuidMapper(Buffer.from(uv).toString('utf8')), 'utf8');
          }
          return uv;
        });
      }
      return val;
    });
  }

  if (kind === 'gen_metadata') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 1) {
        return rewriteProtobufMessage(val, (gf, gw, gv) => {
          if (gw === 2 && gf === 4) {
            return redactProtobufBlob('usage_submsg', gv, uuidMapper);
          }
          if (gw === 2 && gf === 17) {
            return rewriteProtobufMessage(gv, (lf, lw, lv) => (
              lw === 2 && lf === 2 ? redactProtobufBlob('usage_submsg', lv, uuidMapper) : lv
            ));
          }
          if (gw === 2 && gf === 20) {
            let k = '';
            for (const [kf, kw, kv] of iterFields(gv)) {
              if (kw === 2 && kf === 1) k = Buffer.from(kv).toString('utf8');
            }
            if (k === 'parent_cascade_id') {
              return rewriteProtobufMessage(gv, (kf, kw, kv) => (
                kw === 2 && kf === 2
                  ? Buffer.from(uuidMapper(Buffer.from(kv).toString('utf8')), 'utf8')
                  : kv
              ));
            }
          }
          return gv;
        });
      }
      return val;
    });
  }

  if (kind === 'usage_submsg') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt === 2 && fn === 7) {
        return Buffer.from(uuidMapper(Buffer.from(val).toString('utf8')), 'utf8');
      }
      return val;
    });
  }

  if (kind === 'step_payload') {
    return rewriteProtobufMessage(buf, (fn, wt, val) => {
      if (wt !== 2) return val;
      if (fn === 19) {
        // User input prompt
        return rewriteProtobufMessage(val, (uf, uw, uv) => {
          if (uw !== 2) return uv;
          if (uf === 2) {
            const orig = Buffer.from(uv).toString('utf8');
            const isComp = /^\s*\/compact(?:\s|$)/i.test(orig);
            return Buffer.from(isComp ? '/compact' : `[REDACTED_PROMPT_${orig.length}ch]`, 'utf8');
          }
          if (uf === 3) {
            return rewriteProtobufMessage(uv, (itf, itw, itv) => {
              if (itw === 2 && itf === 1) {
                const orig = Buffer.from(itv).toString('utf8');
                const isComp = /^\s*\/compact(?:\s|$)/i.test(orig);
                return Buffer.from(isComp ? '/compact' : `[REDACTED_ITEM_${orig.length}ch]`, 'utf8');
              }
              return itv;
            });
          }
          return uv;
        });
      }
      if (fn === 20) {
        // Planner response
        return rewriteProtobufMessage(val, (pf, pw, pv) => {
          if (pw !== 2) return pv;
          if (pf === 1 || pf === 8) {
            const orig = Buffer.from(pv).toString('utf8');
            return Buffer.from(`[REDACTED_REPLY_${orig.length}ch]`, 'utf8');
          }
          if (pf === 3) {
            const orig = Buffer.from(pv).toString('utf8');
            return Buffer.from(`[REDACTED_THINKING_${orig.length}ch]`, 'utf8');
          }
          if (pf === 7) {
            return rewriteProtobufMessage(pv, (tf, tw, tv) => {
              if (tw === 2 && tf === 3) {
                const orig = Buffer.from(tv).toString('utf8');
                return Buffer.from(JSON.stringify({ redacted: true, len: orig.length }), 'utf8');
              }
              return tv;
            });
          }
          return pv;
        });
      }
      if (fn === 30) {
        // Compact summary
        return rewriteProtobufMessage(val, (cf, cw, cv) => {
          if (cw === 2 && cf === 5) {
            const orig = Buffer.from(cv).toString('utf8');
            return Buffer.from(`[REDACTED_COMPACT_${orig.length}ch]`, 'utf8');
          }
          return cv;
        });
      }
      if (fn === 24) {
        // Error message step
        return rewriteProtobufMessage(val, (ef, ew, ev) => {
          if (ew === 2 && ef === 3) {
            return rewriteProtobufMessage(ev, (df, dw, dv) => {
              if (dw === 2 && (df === 1 || df === 2 || df === 3 || df === 6)) {
                return Buffer.from(redactTextPaths(Buffer.from(dv).toString('utf8'), uuidMapper), 'utf8');
              }
              return dv;
            });
          }
          return ev;
        });
      }
      if (fn === 31) {
        return rewriteProtobufMessage(val, (ef, ew, ev) => {
          if (ew === 2 && (ef === 1 || ef === 2 || ef === 3)) {
            return Buffer.from(redactTextPaths(Buffer.from(ev).toString('utf8'), uuidMapper), 'utf8');
          }
          return ev;
        });
      }
      return val;
    });
  }

  return buf;
}

export function createUuidAnonymizer() {
  const map = new Map();
  let counter = 1;
  return (rawId) => {
    const clean = String(rawId || '').trim();
    if (!clean || !UUID_RE.test(clean)) return clean;
    const key = clean.toLowerCase();
    if (!map.has(key)) {
      const hex = String(counter++).padStart(12, '0');
      map.set(key, `00000000-0000-4000-8000-${hex}`);
    }
    return map.get(key);
  };
}

export function exportTraceFixture(
  tracePath,
  {
    fromSeq = 0,
    toSeq = Infinity,
    aroundAnomalySeq = null,
    windowRadius = 5,
    redact = true,
  } = {},
) {
  const trace = loadTraceFile(tracePath);
  const allFrames = trace.frames;
  if (!allFrames.length) {
    throw new Error('trace contains no frames');
  }

  let minSeq = fromSeq;
  let maxSeq = toSeq;
  if (aroundAnomalySeq !== null && aroundAnomalySeq !== undefined) {
    minSeq = Math.max(0, aroundAnomalySeq - windowRadius);
    maxSeq = aroundAnomalySeq + windowRadius;
  }

  // Reconstruct baseline DB & target state right BEFORE minSeq so the slice is 100% self-contained!
  const stepMapByConv = new Map();
  const gmMapByConv = new Map();
  const uuidMap = redact ? createUuidAnonymizer() : (x) => x;

  const redactStringVal = (s, tag = 'TEXT') => {
    if (!redact || !s) return s;
    return `[REDACTED_${tag}_${s.length}ch]`;
  };

  const redactLsStep = (st) => {
    if (!redact || !st) return st;
    const out = structuredClone(st);
    if (out.metadata?.executionId) out.metadata.executionId = uuidMap(out.metadata.executionId);
    if (out.metadata?.toolCall?.id) out.metadata.toolCall.id = 'call_redacted';
    if (out.plannerResponse) {
      if (out.plannerResponse.thinking) out.plannerResponse.thinking = redactStringVal(out.plannerResponse.thinking, 'THINKING');
      if (out.plannerResponse.response) out.plannerResponse.response = redactStringVal(out.plannerResponse.response, 'REPLY');
      if (out.plannerResponse.modifiedResponse) out.plannerResponse.modifiedResponse = redactStringVal(out.plannerResponse.modifiedResponse, 'REPLY');
      if (Array.isArray(out.plannerResponse.toolCalls)) {
        out.plannerResponse.toolCalls = out.plannerResponse.toolCalls.map((tc) => ({
          ...tc,
          id: tc.id ? 'call_redacted' : '',
          argumentsJson: tc.argumentsJson ? JSON.stringify({ redacted: true, len: tc.argumentsJson.length }) : '',
        }));
      }
    }
    if (out.userInput) {
      if (out.userInput.userResponse && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.userResponse)) {
        out.userInput.userResponse = redactStringVal(out.userInput.userResponse, 'PROMPT');
      }
      if (out.userInput.text && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.text)) {
        out.userInput.text = redactStringVal(out.userInput.text, 'PROMPT');
      }
      if (out.userInput.query && !/^\s*\/compact(?:\s|$)/i.test(out.userInput.query)) {
        out.userInput.query = redactStringVal(out.userInput.query, 'PROMPT');
      }
      if (Array.isArray(out.userInput.items)) {
        out.userInput.items = out.userInput.items.map((it) => (
          it?.text && !/^\s*\/compact(?:\s|$)/i.test(it.text)
            ? { ...it, text: redactStringVal(it.text, 'ITEM') }
            : it
        ));
      }
    }
    if (out.errorMessage) {
      for (const k of ['userMessage', 'shortError', 'fullError']) {
        if (typeof out.errorMessage[k] === 'string') {
          out.errorMessage[k] = redactTextPaths(out.errorMessage[k], uuidMap);
        }
      }
    }
    return out;
  };

  const sanitizeStepDelta = (s) => {
    const out = structuredClone(s);
    if (redact) {
      if (out.summary) {
        if (out.summary.botId) out.summary.botId = uuidMap(out.summary.botId);
        if (out.summary.promptPreview) out.summary.promptPreview = '[REDACTED_PROMPT]';
        if (out.summary.compactSummary) out.summary.compactSummary = '[REDACTED_COMPACT]';
        if (out.summary.error) {
          for (const k of ['userMessage', 'shortError', 'fullError']) {
            if (out.summary.error[k]) out.summary.error[k] = redactTextPaths(out.summary.error[k], uuidMap);
          }
        }
      }
      if (out.metadataB64) {
        out.metadataB64 = redactProtobufBlob('step_metadata', Buffer.from(out.metadataB64, 'base64'), uuidMap).toString('base64');
      }
      if (out.stepPayloadB64) {
        out.stepPayloadB64 = redactProtobufBlob('step_payload', Buffer.from(out.stepPayloadB64, 'base64'), uuidMap).toString('base64');
      }
    }
    return out;
  };

  const sanitizeGmDelta = (g) => {
    const out = structuredClone(g);
    if (redact) {
      if (out.parsedSummary?.botId) out.parsedSummary.botId = uuidMap(out.parsedSummary.botId);
      if (out.dataB64) {
        out.dataB64 = redactProtobufBlob('gen_metadata', Buffer.from(out.dataB64, 'base64'), uuidMap).toString('base64');
      }
    }
    return out;
  };

  const slicedFrames = [];
  const initializedConvs = new Set();

  for (const frame of allFrames) {
    const cid = frame.target?.id || '00000000-0000-4000-8000-000000000000';
    if (!stepMapByConv.has(cid)) stepMapByConv.set(cid, new Map());
    if (!gmMapByConv.has(cid)) gmMapByConv.set(cid, new Map());
    const sMap = stepMapByConv.get(cid);
    const gMap = gmMapByConv.get(cid);

    if (frame.seq < minSeq) {
      for (const s of frame.db?.stepsDelta || []) sMap.set(s.idx, s);
      for (const idx of frame.db?.stepsRemoved || []) sMap.delete(idx);
      for (const g of frame.db?.gmDelta || []) gMap.set(g.idx, g);
      for (const idx of frame.db?.gmRemoved || []) gMap.delete(idx);
      continue;
    }
    if (frame.seq > maxSeq) break;

    let frameStepsDelta = frame.db?.stepsDelta || [];
    let frameGmDelta = frame.db?.gmDelta || [];
    const isFirstForConv = !initializedConvs.has(cid);
    if (isFirstForConv) {
      initializedConvs.add(cid);
      for (const s of frameStepsDelta) sMap.set(s.idx, s);
      for (const idx of frame.db?.stepsRemoved || []) sMap.delete(idx);
      for (const g of frameGmDelta) gMap.set(g.idx, g);
      for (const idx of frame.db?.gmRemoved || []) gMap.delete(idx);
      frameStepsDelta = [...sMap.values()].sort((a, b) => a.idx - b.idx);
      frameGmDelta = [...gMap.values()].sort((a, b) => a.idx - b.idx);
    }

    const sanitizeHudBlock = (hud) => {
      if (!redact || !hud) return hud;
      const out = structuredClone(hud);
      if (out.error) out.error = redactTextPaths(out.error, uuidMap);
      if (out.telemetry?.activeStep) {
        const act = out.telemetry.activeStep;
        if (act.thinkingPreview) act.thinkingPreview = redactStringVal(act.thinkingPreview, 'THINKING');
        if (act.replyPreview) act.replyPreview = redactStringVal(act.replyPreview, 'REPLY');
        if (Array.isArray(act.toolCalls)) {
          act.toolCalls = act.toolCalls.map((tc) => ({
            ...tc,
            args: tc.args ? JSON.stringify({ redacted: true, len: tc.args.length }) : '',
          }));
        }
      }
      if (out.telemetry?.latest?.botId) {
        out.telemetry.latest.botId = uuidMap(out.telemetry.latest.botId);
      }
      if (out.telemetry?.latest?.parentCascadeId) {
        out.telemetry.latest.parentCascadeId = uuidMap(out.telemetry.latest.parentCascadeId);
      }
      return out;
    };

    const sanitizeAnomaly = (a) => {
      if (!redact) return a;
      const out = structuredClone(a);
      if (out.message) out.message = redactTextPaths(out.message, uuidMap);
      if (out.details) {
        const cleanDetails = (val) => {
          if (typeof val === 'string') return redactTextPaths(val, uuidMap);
          if (Array.isArray(val)) return val.map(cleanDetails);
          if (val && typeof val === 'object') {
            const o = {};
            for (const [k, v] of Object.entries(val)) o[k] = cleanDetails(v);
            return o;
          }
          return val;
        };
        out.details = cleanDetails(out.details);
      }
      return out;
    };

    slicedFrames.push({
      kind: 'frame',
      seq: frame.seq,
      tsMs: frame.tsMs,
      elapsedMs: frame.elapsedMs,
      target: {
        id: uuidMap(cid),
        key: frame.target?.key || '',
        annoKey: frame.target?.annoKey || '0:0',
      },
      ls: {
        ...frame.ls,
        steps: (frame.ls?.steps || []).map(redactLsStep),
      },
      db: {
        ...frame.db,
        stepsDelta: frameStepsDelta.map(sanitizeStepDelta),
        stepsRemoved: isFirstForConv ? [] : (frame.db?.stepsRemoved || []),
        gmDelta: frameGmDelta.map(sanitizeGmDelta),
        gmRemoved: isFirstForConv ? [] : (frame.db?.gmRemoved || []),
      },
      hud: sanitizeHudBlock(frame.hud),
      anomalies: (frame.anomalies || []).map(sanitizeAnomaly),
    });
  }

  return {
    kind: 'agy_hud_trace_fixture',
    schemaVersion: TRACE_SCHEMA_VERSION,
    exportedAtIso: new Date().toISOString(),
    redacted: Boolean(redact),
    range: { fromSeq: minSeq, toSeq: maxSeq },
    frameCount: slicedFrames.length,
    frames: slicedFrames,
  };
}
