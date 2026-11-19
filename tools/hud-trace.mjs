#!/usr/bin/env node
/**
 * AGY-HUD Execution & Telemetry Trace Collector / Replay CLI.
 * Captures mid-execution state transitions across Antigravity Language Server RPCs,
 * SQLite steps/gen_metadata deltas, and evaluated HUD telemetry, then replays or
 * exports sanitized regression fixtures.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  listConversations,
} from '../plugin/sidecars/hud_panel/lib/telemetry.mjs';
import {
  buildTimelineFromDb,
  buildTimelineFromTrace,
  callLsRpc,
  discoverLsConnection,
  exportTraceFixture,
  replayTrace,
  resolveDataDir,
  TraceRecorder,
} from './lib/trace-core.mjs';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) {
      positionals.push(tok);
      continue;
    }
    const eqIdx = tok.indexOf('=');
    if (eqIdx !== -1) {
      flags[tok.slice(2, eqIdx)] = tok.slice(eqIdx + 1);
      continue;
    }
    const name = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { cmd: positionals[0] || 'help', args: positionals.slice(1), flags };
}

function fmtTime(ms) {
  if (!ms) return '--:--:--.---';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const msStr = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${msStr}`;
}

function fmtElapsed(ms) {
  if (ms === null || ms === undefined) return '';
  return `+${(ms / 1000).toFixed(2)}s`;
}

function defaultTraceOutPath(appDataDir) {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '_',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('');
  return join(appDataDir, 'sidecar_data', 'agy-hud', 'hud_panel', 'traces', `trace-${stamp}.jsonl`);
}

function printHelp() {
  console.log(`AGY-HUD 日志收集与重放工具 (Conversation <-> Model Execution Tracer)

用法:
  node tools/hud-trace.mjs <command> [options]

命令:
  discover                     探测数据目录、Language Server 守护进程和最近会话
  record [options]             实时采集 LS + SQLite DB + HUD 中间态轨迹 (NDJSON)
  replay <trace.jsonl|json>    逐帧重放录制轨迹 (支持 --recompute 用当前代码重算对比)
  timeline <trace|db|uuid>     按时间轴展示对话/模型执行/工具失败/HUD异常事件
  export-fixture <trace.jsonl> 导出脱敏回归测试 Fixture JSON (可选 --test-snippet)

常用选项:
  --data-dir <dir>             指定数据目录 (默认 ~/.gemini/antigravity; CLI 用 ~/.gemini/antigravity-cli)
  --conv <uuid>                指定监听或分析的会话 UUID
  --mode <auto|latest>         会话跟随策略 (默认 auto)
  --interval <ms>              record 轮询间隔毫秒数 (默认 250)
  --duration <sec>             record 最长录制秒数 (不传则持续录制直到 Ctrl+C)
  --out <path>                 输出文件路径
  --no-ls                      record 时不连接 Language Server (仅采集 SQLite DB)
  --recompute                  replay 时用当前 HUD 解析逻辑重算每一帧并输出差异
  --anomalies-only             replay 仅输出含异常的帧
  --changes-only               replay 仅输出状态或 Delta 变化的帧
  --errors-only                timeline 仅输出 error / warn 事件
  --from <seq> / --to <seq>    限制帧序号范围
  --around-anomaly <seq>       export-fixture 以某异常帧为中心截取窗口 (默认前后各 5 帧)
  --radius <n>                 export-fixture 截取半径 (默认 5)
  --no-redact                  export-fixture 不脱敏 (默认会脱敏 prompt/thinking/reply/路径/UUID)
  --test-snippet               export-fixture 同时打印 node:test 回放测试代码片段
  --speed <mult>               replay 按真实时间倍速回放 (如 --speed 2)
  --tail <n>                   timeline 仅显示最后 n 条事件
  --json                       以 JSON 输出`);
}

async function cmdDiscover(flags) {
  const appDataDir = resolveDataDir(typeof flags['data-dir'] === 'string' ? flags['data-dir'] : '');
  const convDir = join(appDataDir, 'conversations');
  const annoDir = join(appDataDir, 'annotations');
  const convs = listConversations(convDir, annoDir, 0);
  const lsConn = discoverLsConnection(appDataDir);

  let lsProbe = null;
  if (lsConn) {
    const res = await callLsRpc(lsConn, 'GetAllCascadeTrajectories', {}, 1500);
    lsProbe = {
      ok: res.ok,
      latencyMs: res.latencyMs,
      error: res.error,
      trajectoryCount: res.ok ? Object.keys(res.data?.trajectorySummaries || {}).length : 0,
    };
  }

  const out = {
    appDataDir,
    conversationsCount: convs.length,
    latestConversations: convs.slice(0, 5).map((c) => ({
      id: c.id,
      updatedIso: c.updatedMs ? new Date(c.updatedMs).toISOString() : '',
      dbPath: c.dbPath,
    })),
    lsConnection: lsConn
      ? {
          source: lsConn.source,
          pid: lsConn.pid,
          lsVersion: lsConn.lsVersion,
          baseUrls: lsConn.baseUrls,
          probe: lsProbe,
        }
      : null,
  };

  if (flags.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Data Dir:       ${out.appDataDir}`);
  console.log(`Conversations:  ${out.conversationsCount}`);
  if (lsConn) {
    console.log(`LS Daemon:      ${lsConn.baseUrls[0]} (pid=${lsConn.pid || '?'}, v=${lsConn.lsVersion || '?'}, src=${lsConn.source})`);
    console.log(`LS RPC Probe:   ${lsProbe.ok ? `OK (${lsProbe.latencyMs}ms, trajectories=${lsProbe.trajectoryCount})` : `FAILED: ${lsProbe.error}`}`);
  } else {
    console.log('LS Daemon:      未检测到活跃 daemon (record 将以 DB-only 或等待模式运行)');
  }
  if (out.latestConversations.length) {
    console.log('\n最近活跃会话:');
    for (const c of out.latestConversations) {
      console.log(`  - ${c.id}  (${c.updatedIso})`);
    }
  }
}

async function cmdRecord(flags) {
  const appDataDir = resolveDataDir(typeof flags['data-dir'] === 'string' ? flags['data-dir'] : '');
  const convId = typeof flags.conv === 'string' ? flags.conv : '';
  const mode = flags.mode === 'latest' ? 'latest' : 'auto';
  const intervalMs = Math.max(80, Number(flags.interval || 250) || 250);
  const durationSec = Number(flags.duration || 0);
  const useLs = !flags['no-ls'];
  const outPath = resolve(
    typeof flags.out === 'string' && flags.out ? flags.out : defaultTraceOutPath(appDataDir),
  );

  const recorder = new TraceRecorder({
    outPath,
    appDataDir,
    mode,
    explicitConvId: convId,
    useLs,
    includeRawDb: !flags['no-raw-db'],
  });
  recorder.open();

  console.log(`[hud-trace] 开始录制 -> ${outPath}`);
  console.log(`[hud-trace] dataDir=${appDataDir} mode=${mode}${convId ? ` conv=${convId}` : ''} interval=${intervalMs}ms ls=${recorder.lsConn ? recorder.lsConn.baseUrls[0] : (useLs ? 'waiting' : 'disabled')}`);
  console.log('[hud-trace] 按 Ctrl+C 结束录制并生成摘要...\n');

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const deadlineMs = durationSec > 0 ? Date.now() + durationSec * 1000 : Infinity;

  try {
    while (!stopping && Date.now() < deadlineMs) {
      const tStart = Date.now();
      const res = await recorder.pollOnce();
      if (res.written && res.frame) {
        const f = res.frame;
        const active = f.hud?.telemetry?.activeStep;
        const calls = f.hud?.telemetry?.summary?.count ?? 0;
        const lsSt = f.ls?.summary?.status ? f.ls.summary.status.replace(/^CASCADE_RUN_STATUS_/, '') : (f.ls?.enabled ? 'NO_LS' : 'DB_ONLY');
        const activeStr = active
          ? `${active.statusName}#${active.idx}${active.toolName ? `(${active.toolName})` : ''}${active.thinkingChars ? ` thk=${active.thinkingChars}` : ''}${active.replyChars ? ` rep=${active.replyChars}` : ''}`
          : 'IDLE';
        const deltaStr = [
          f.db.stepsDelta.length ? `+steps:${f.db.stepsDelta.length}` : '',
          f.db.gmDelta.length ? `+gm:${f.db.gmDelta.length}` : '',
        ].filter(Boolean).join(' ');
        console.log(
          `#${String(f.seq).padStart(4, ' ')} ${fmtTime(f.tsMs)} ${fmtElapsed(f.elapsedMs).padStart(7)} | ${f.target.id.slice(0, 8)} | LS:${lsSt}(${f.ls?.summary?.stepCount ?? '-'}) DB:(s=${f.db.stepCount},gm=${f.db.gmCount}) Calls=${calls} | ${activeStr}${deltaStr ? ` | ${deltaStr}` : ''}`,
        );
        for (const a of res.anomalies || []) {
          console.log(`   ! [${a.severity.toUpperCase()}][${a.layer}:${a.code}] ${a.message}`);
        }
      }
      const waitMs = Math.max(20, intervalMs - (Date.now() - tStart));
      if (!stopping && Date.now() + waitMs < deadlineMs) {
        await sleep(waitMs);
      } else if (Date.now() >= deadlineMs) {
        break;
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    recorder.close();
  }

  console.log('\n[hud-trace] 录制已停止:');
  console.log(`  文件:     ${outPath}`);
  console.log(`  总轮询:   ${recorder.stats.polls} 次, 写入变化帧: ${recorder.stats.framesWritten} 帧`);
  console.log(`  异常总数: ${recorder.stats.anomaliesCount}`);
  if (Object.keys(recorder.stats.anomalyCountsByCode).length) {
    console.log(`  异常分布: ${JSON.stringify(recorder.stats.anomalyCountsByCode)}`);
  }
  console.log('\n下一步排查命令:');
  console.log(`  node tools/hud-trace.mjs timeline "${outPath}"`);
  console.log(`  node tools/hud-trace.mjs replay "${outPath}" --recompute --anomalies-only`);
  console.log(`  node tools/hud-trace.mjs export-fixture "${outPath}" --out /tmp/hud-fixture.json --test-snippet`);
}

async function cmdReplay(args, flags) {
  const target = args[0];
  if (!target) {
    console.error('缺少参数: replay <trace.jsonl|fixture.json>');
    process.exitCode = 1;
    return;
  }
  const tracePath = resolve(target);
  const recompute = Boolean(flags.recompute);
  const anomaliesOnly = Boolean(flags['anomalies-only']);
  const changesOnly = Boolean(flags['changes-only']);
  const fromSeq = flags.from !== undefined ? Number(flags.from) : 0;
  const toSeq = flags.to !== undefined ? Number(flags.to) : Infinity;
  const speed = Number(flags.speed || 0);

  const rep = replayTrace(tracePath, { recompute });
  const selected = [];
  let prevElapsed = null;
  let prevSig = '';

  for (const r of rep.frames) {
    if (r.seq < fromSeq || r.seq > toSeq) continue;
    const activeAnoms = recompute ? r.evaluatedAnomalies : r.recordedAnomalies;
    if (anomaliesOnly && !activeAnoms.length && !r.resolvedCodes.length && !r.newCodes.length) continue;

    const sig = JSON.stringify({
      t: r.targetId,
      ls: r.lsStatus,
      lsc: r.lsStepCount,
      dbs: r.dbStepCount,
      dbgm: r.dbGmCount,
      act: r.evaluatedHud?.telemetry?.activeStep?.statusName || '',
      actIdx: r.evaluatedHud?.telemetry?.activeStep?.idx ?? null,
      calls: r.evaluatedHud?.telemetry?.summary?.count ?? 0,
      gd: r.gmDeltaCount,
      a: activeAnoms.map((x) => x.code),
    });
    if (changesOnly && sig === prevSig && !activeAnoms.length) continue;
    prevSig = sig;
    selected.push(r);
  }

  if (flags.json) {
    console.log(JSON.stringify({ meta: rep.meta, recomputed: recompute, frames: selected }, null, 2));
    return;
  }

  let totalRecordedAnom = 0;
  let totalEvalAnom = 0;
  let totalResolved = 0;
  let totalNew = 0;
  for (const r of rep.frames) {
    totalRecordedAnom += r.recordedAnomalies.length;
    totalEvalAnom += r.evaluatedAnomalies.length;
    totalResolved += r.resolvedCodes.length;
    totalNew += r.newCodes.length;
  }

  console.log(`[hud-trace] Replay: ${tracePath} (totalFrames=${rep.frames.length}, shown=${selected.length}, recompute=${recompute})`);
  if (recompute) {
    console.log(`[hud-trace] 异常对比: 录制时=${totalRecordedAnom} -> 当前代码重算=${totalEvalAnom} (已修复=${totalResolved}, 新增=${totalNew})\n`);
  } else {
    console.log(`[hud-trace] 录制异常数: ${totalRecordedAnom}\n`);
  }

  for (const r of selected) {
    if (speed > 0 && prevElapsed !== null) {
      const dt = Math.max(0, (r.elapsedMs - prevElapsed) / speed);
      if (dt > 0) await sleep(Math.min(dt, 5000));
    }
    prevElapsed = r.elapsedMs;

    const hud = recompute ? r.evaluatedHud : r.recordedHud;
    const active = hud?.telemetry?.activeStep;
    const calls = hud?.telemetry?.summary?.count ?? 0;
    const lsSt = r.lsStatus ? r.lsStatus.replace(/^CASCADE_RUN_STATUS_/, '') : '-';
    const actStr = active
      ? `${active.statusName}#${active.idx}${active.toolName ? `(${active.toolName})` : ''}${active.syntheticFallback ? '[FB]' : ''}`
      : 'IDLE';
    console.log(
      `#${String(r.seq).padStart(4, ' ')} ${fmtTime(r.tsMs)} ${fmtElapsed(r.elapsedMs).padStart(7)} | ${r.targetId.slice(0, 8)} | LS:${lsSt}(${r.lsStepCount ?? '-'}) DB:(s=${r.dbStepCount},gm=${r.dbGmCount}) Calls=${calls} | ${actStr}`,
    );
    const list = recompute ? r.evaluatedAnomalies : r.recordedAnomalies;
    for (const a of list) {
      const histTag = a.historical ? '[HIST]' : '';
      console.log(`   ! [${a.severity.toUpperCase()}]${histTag}[${a.layer}:${a.code}] ${a.message}`);
    }
    if (recompute && r.resolvedCodes.length) {
      console.log(`   + [RESOLVED] ${r.resolvedCodes.join(', ')}`);
    }
    if (recompute && r.newCodes.length) {
      console.log(`   - [NEW_ANOMALY] ${r.newCodes.join(', ')}`);
    }
  }
}

function cmdTimeline(args, flags) {
  const appDataDir = resolveDataDir(typeof flags['data-dir'] === 'string' ? flags['data-dir'] : '');
  const input = args[0] || (typeof flags.conv === 'string' ? flags.conv : '');
  if (!input) {
    console.error('缺少参数: timeline <trace.jsonl|conversation.db|uuid>');
    process.exitCode = 1;
    return;
  }

  let resolvedPath = resolve(input);
  if (!existsSync(resolvedPath)) {
    const candidateDb = join(appDataDir, 'conversations', input.endsWith('.db') ? input : `${input}.db`);
    if (existsSync(candidateDb)) {
      resolvedPath = candidateDb;
    } else {
      console.error(`找不到文件或会话 DB: ${input}`);
      process.exitCode = 1;
      return;
    }
  }

  let events = [];
  if (resolvedPath.endsWith('.db')) {
    events = buildTimelineFromDb(resolvedPath);
  } else {
    events = buildTimelineFromTrace(resolvedPath).events;
  }

  if (flags['errors-only'] || flags['anomalies-only']) {
    events = events.filter((e) => e.severity === 'error' || e.severity === 'warn' || e.kind.startsWith('ANOMALY_'));
  }
  const tailN = Number(flags.tail || 0);
  if (tailN > 0 && events.length > tailN) {
    events = events.slice(-tailN);
  }

  if (flags.json) {
    console.log(JSON.stringify({ source: resolvedPath, count: events.length, events }, null, 2));
    return;
  }

  console.log(`[hud-trace] Timeline: ${resolvedPath} (${events.length} events)\n`);
  for (const ev of events) {
    const sevTag = ev.severity === 'error' ? '[ERR ]' : ev.severity === 'warn' ? '[WARN]' : '[INFO]';
    const seqPart = ev.seq !== undefined ? `#${String(ev.seq).padStart(4, ' ')} ` : '';
    const elPart = ev.elapsedMs !== undefined ? ` ${fmtElapsed(ev.elapsedMs).padStart(7)}` : '';
    console.log(`${seqPart}${fmtTime(ev.tsMs)}${elPart} ${sevTag} ${ev.title}${ev.detail ? ` — ${ev.detail}` : ''}`);
  }
}

function cmdExportFixture(args, flags) {
  const target = args[0];
  if (!target) {
    console.error('缺少参数: export-fixture <trace.jsonl>');
    process.exitCode = 1;
    return;
  }
  const tracePath = resolve(target);
  const fromSeq = flags.from !== undefined ? Number(flags.from) : 0;
  const toSeq = flags.to !== undefined ? Number(flags.to) : Infinity;
  const aroundAnomalySeq = flags['around-anomaly'] !== undefined ? Number(flags['around-anomaly']) : null;
  const windowRadius = flags.radius !== undefined ? Number(flags.radius) : 5;
  const redact = !flags['no-redact'];

  const fixture = exportTraceFixture(tracePath, {
    fromSeq,
    toSeq,
    aroundAnomalySeq,
    windowRadius,
    redact,
  });

  const outPath = typeof flags.out === 'string' && flags.out ? resolve(flags.out) : '';
  const serialized = JSON.stringify(fixture, null, 2);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, serialized, 'utf8');
    console.log(`[hud-trace] 已导出${redact ? '脱敏' : '未脱敏'} Fixture (${fixture.frameCount} 帧) -> ${outPath}`);
  } else {
    console.log(serialized);
  }

  if (flags['test-snippet']) {
    const relOrPath = outPath || '/path/to/fixture.json';
    console.log(`
// === node:test 回归测试片段 ===
import assert from 'node:assert/strict';
import test from 'node:test';
import { replayTrace } from './tools/lib/trace-core.mjs';

test('replays captured mid-execution trace without regression', () => {
  const rep = replayTrace(${JSON.stringify(relOrPath)}, { recompute: true });
  assert.ok(rep.frames.length > 0);
  const hudErrors = rep.frames.flatMap((f) =>
    f.evaluatedAnomalies.filter((a) => a.layer === 'hud' && a.severity === 'error'),
  );
  assert.deepEqual(hudErrors, []);
});
`);
  }
}

async function main() {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'help' || cmd === '--help' || cmd === '-h' || flags.help) {
    printHelp();
    return;
  }
  if (cmd === 'discover') {
    await cmdDiscover(flags);
    return;
  }
  if (cmd === 'record') {
    await cmdRecord(flags);
    return;
  }
  if (cmd === 'replay') {
    await cmdReplay(args, flags);
    return;
  }
  if (cmd === 'timeline') {
    cmdTimeline(args, flags);
    return;
  }
  if (cmd === 'export-fixture') {
    cmdExportFixture(args, flags);
    return;
  }
  console.error(`未知命令: ${cmd}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('[hud-trace] Fatal:', err);
  process.exitCode = 1;
});
