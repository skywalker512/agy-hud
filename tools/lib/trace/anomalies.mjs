import {
  ACTIVE_STEP_STATUSES,
  LS_TERMINAL_STEP_STATUSES,
  TERMINAL_STEP_STATUSES,
} from '../../../plugin/sidecars/hud_panel/lib/constants.ts';
import { isCascadeStatusActive } from '../../../plugin/sidecars/hud_panel/lib/ls-client.ts';

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
