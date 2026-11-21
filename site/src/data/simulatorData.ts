export type SimTab = 'live' | 'calls' | 'account';
export type SimChartMetric = 'tps' | 'ttft' | 'cache' | 'ctx';
export type SimRangePreset = '20' | '50' | 'all';

export interface SimSwarmWorker {
  rosterName: string;
  state: 'working' | 'waiting' | 'stopped' | 'killed';
  workspace: 'inherit' | 'share' | 'branch';
  model: string;
  taskEn: string;
  taskZh: string;
  calls: number;
  outTokens: string;
  costUsd: string;
  quota5h: string;
  lastPostSeq: number;
  lastPostEn: string;
  lastPostZh: string;
  updatedAt: string;
}

export interface SimContextSegment {
  id: string;
  labelEn: string;
  labelZh: string;
  tokens: number;
  pct: number;
  colorVar: string;
  detailEn: string;
  detailZh: string;
}

export interface SimCallPoint {
  idx: number;
  time: string;
  model: string;
  shortModel: string;
  genTps: number;
  e2eTps: number;
  ttftSec: number;
  thinkSec: number;
  toolGenSec: number;
  streamSec: number;
  cachePct: number;
  ctxPct: number;
  cachedTok: number;
  newInputTok: number;
  thinkTok: number;
  visTok: number;
  costUsd: number;
  savedUsd: number;
  quota5h: number;
  kMult: number;
  isBuf?: boolean;
  isToolStall?: boolean;
  isCompactAfter?: boolean;
  tools: Array<{ name: string; args: Record<string, unknown>; ms: number }>;
}

export const SIM_SWARM_WORKERS: SimSwarmWorker[] = [
  {
    rosterName: 'researcher',
    state: 'working',
    workspace: 'inherit',
    model: 'gemini-4-carbon',
    taskEn: 'Benchmark competitor HUDs, swarm telemetry & waterfall UX',
    taskZh: '对标竞品 HUD、Swarm 遥测与瀑布图交互规范',
    calls: 12,
    outTokens: '14.8k',
    costUsd: '$0.42',
    quota5h: '-0.29%',
    lastPostSeq: 22,
    lastPostEn: 'Published research_spec.md with 8 killer differentiators',
    lastPostZh: '已发布 research_spec.md，梳理 8 项核心差异化优势',
    updatedAt: '00:02:18',
  },
  {
    rosterName: 'trend-viz',
    state: 'working',
    workspace: 'share',
    model: 'gemini-4-carbon',
    taskEn: 'Implement minimap brush, drag-to-zoom & 0ms crosshair',
    taskZh: '实现缩略图刷选、拖拽缩放与 0ms 十字准线',
    calls: 19,
    outTokens: '26.1k',
    costUsd: '$0.78',
    quota5h: '-0.51%',
    lastPostSeq: 24,
    lastPostEn: 'Minimap brush + Follow Live state machine passing 65 tests',
    lastPostZh: '缩略图刷选与 Follow Live 状态机已通过 65 项测试',
    updatedAt: '00:03:09',
  },
  {
    rosterName: 'inspector',
    state: 'waiting',
    workspace: 'inherit',
    model: 'gemini-3.8-flash-k',
    taskEn: 'Audit Node 22.18+ contract, zip-slip defense & UI build',
    taskZh: '审计 Node 22.18+ 契约、路径穿越防护与 UI 构建',
    calls: 7,
    outTokens: '5.4k',
    costUsd: '$0.09',
    quota5h: '-0.06%',
    lastPostSeq: 23,
    lastPostEn: 'PASS: zero runtime deps, atomic rollback & allowlist verified',
    lastPostZh: '通过：零运行时依赖、原子回滚与白名单校验全部达标',
    updatedAt: '00:01:44',
  },
];

export const SIM_CONTEXT_SEGMENTS: SimContextSegment[] = [
  {
    id: 'sys',
    labelEn: 'Sys Prompt',
    labelZh: '系统提示词',
    tokens: 14800,
    pct: 5.8,
    colorVar: 'var(--seg-input)',
    detailEn: '14.8k tok · 100% prefix cached',
    detailZh: '14.8k tok · 100% 前缀命中缓存',
  },
  {
    id: 'defs',
    labelEn: 'Tool Defs',
    labelZh: '工具定义',
    tokens: 21400,
    pct: 8.4,
    colorVar: 'var(--seg-think)',
    detailEn: '21.4k tok · 16 MCP & built-in schemas',
    detailZh: '21.4k tok · 16 个内置与 MCP 工具定义',
  },
  {
    id: 'tools',
    labelEn: 'Tool Results',
    labelZh: '工具输出',
    tokens: 74200,
    pct: 29.0,
    colorVar: 'var(--seg-out)',
    detailEn: '74.2k tok · read_file 41.2k · run_command 19.6k · edit_file 13.4k',
    detailZh: '74.2k tok · read_file 41.2k · run_command 19.6k · edit_file 13.4k',
  },
  {
    id: 'replies',
    labelEn: 'Model Replies',
    labelZh: '模型回复',
    tokens: 22900,
    pct: 8.9,
    colorVar: 'var(--seg-cache)',
    detailEn: '22.9k tok · visible responses & reasoning summaries',
    detailZh: '22.9k tok · 可见回复与推理摘要',
  },
  {
    id: 'user',
    labelEn: 'User / Ckpt',
    labelZh: '用户 / 检查点',
    tokens: 9100,
    pct: 3.5,
    colorVar: 'var(--muted)',
    detailEn: '9.1k tok · user turns & compaction checkpoint',
    detailZh: '9.1k tok · 用户输入与压缩检查点',
  },
];

// Deterministic 60-call session trace for the Calls tab simulator
function generateSessionCalls(): SimCallPoint[] {
  const calls: SimCallPoint[] = [];
  let ctx = 12.4;
  for (let i = 1; i <= 60; i++) {
    const isFlash = i % 5 === 0;
    const isCompactAfter = i === 24 || i === 47;
    if (i === 25) ctx = 18.2;
    else if (i === 48) ctx = 21.5;
    else ctx = Math.min(86.4, ctx + (isFlash ? 1.4 : 2.8) + ((i * 7) % 11) * 0.14);

    const wave = Math.sin(i * 0.42) * 11 + Math.cos(i * 0.19) * 6;
    const isBuf = i === 18 || i === 41;
    const isToolStall = i === 33 || i === 54;
    const genTps = Number((isFlash ? 128 + wave * 0.7 : 91 + wave).toFixed(1));
    const ttftSec = Number(
      (
        (isToolStall ? 4.4 : i === 25 || i === 48 ? 2.9 : 1.15) +
        ((i * 13) % 9) * 0.14
      ).toFixed(2),
    );
    const thinkSec = Number((isFlash ? 0.65 : 2.1 + ((i * 5) % 8) * 0.42).toFixed(2));
    const toolGenSec = Number((isToolStall ? 3.85 : 0.7 + ((i * 3) % 6) * 0.24).toFixed(2));
    const streamSec = Number((1.1 + ((i * 11) % 7) * 0.34).toFixed(2));
    const totalSec = ttftSec + thinkSec + toolGenSec + streamSec;

    const thinkTok = Math.round(thinkSec * genTps * 0.85);
    const visTok = Math.round((streamSec + toolGenSec * 0.5) * genTps);
    const totalOut = Math.max(80, thinkTok + visTok);
    const e2eTps = Number((totalOut / Math.max(0.4, totalSec)).toFixed(1));

    const cachePct = Number(
      (
        i === 1 || i === 25 || i === 48
          ? 44.8 + (i % 7) * 1.4
          : Math.min(98.4, 88.2 + ((i * 17) % 10) * 1.02)
      ).toFixed(1),
    );

    const totalPrompt = Math.round((ctx / 100) * 256_000);
    const cachedTok = Math.round((totalPrompt * cachePct) / 100);
    const newInputTok = Math.max(420, totalPrompt - cachedTok);
    const costUsd = Number((isFlash ? 0.008 + (i % 5) * 0.002 : 0.032 + (ctx / 100) * 0.034).toFixed(3));
    const savedUsd = Number(((cachedTok / 1_000_000) * (isFlash ? 0.3 : 3.2)).toFixed(2));
    const kMult = isFlash ? 0.4 : 3.0;
    const quota5h = Number((costUsd * kMult * 1.45).toFixed(2));

    const mins = Math.floor(i * 0.75);
    const secs = (i * 19) % 60;
    const time = `14:${String(10 + mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const tools =
      i % 2 === 0
        ? [
            {
              name: 'read_file',
              args: { Path: 'plugin/sidecars/hud_panel/lib/swarm.ts', StartLine: 1, EndLine: 160 },
              ms: 18,
            },
            {
              name: 'edit_file',
              args: { Path: 'web/src/components/calls/TrendChartCard.tsx', Target: 'slice(-32)' },
              ms: 24,
            },
          ]
        : [
            {
              name: 'run_command',
              args: { CommandLine: 'node --test plugin/sidecars/hud_panel/test/*.test.ts' },
              ms: 412,
            },
          ];

    calls.push({
      idx: i,
      time,
      model: isFlash ? 'gemini-3.8-flash-k' : 'gemini-4-carbon',
      shortModel: isFlash ? 'Flash-K' : 'Carbon',
      genTps,
      e2eTps,
      ttftSec,
      thinkSec,
      toolGenSec,
      streamSec,
      cachePct,
      ctxPct: Number(ctx.toFixed(1)),
      cachedTok,
      newInputTok,
      thinkTok,
      visTok,
      costUsd,
      savedUsd,
      quota5h,
      kMult,
      isBuf,
      isToolStall,
      isCompactAfter,
      tools,
    });
  }
  return calls;
}

export const SIM_CALLS: SimCallPoint[] = generateSessionCalls();

export interface HeatmapDay {
  week: number;
  day: number;
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  tokensM: number;
  costUsd: number;
}

function generateHeatmap(): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const start = new Date('2026-08-03T00:00:00Z');
  for (let w = 0; w < 16; w++) {
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const dt = new Date(start.getTime() + idx * 86_400_000);
      const iso = dt.toISOString().slice(0, 10);
      const isWeekend = d === 5 || d === 6;
      const hash = ((idx * 37 + w * 13 + d * 7) % 19);
      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (isWeekend) {
        level = hash > 14 ? 2 : hash > 10 ? 1 : 0;
      } else {
        level = hash > 14 ? 4 : hash > 9 ? 3 : hash > 4 ? 2 : hash > 1 ? 1 : 0;
      }
      if (w >= 14 && !isWeekend) level = (Math.min(4, Math.max(2, level + 1)) as 2 | 3 | 4);
      const tokensM = level === 0 ? 0 : Number((level * 1.35 + (hash % 4) * 0.28).toFixed(1));
      const costUsd = level === 0 ? 0 : Number((tokensM * 0.62).toFixed(2));
      days.push({ week: w, day: d, date: iso, level, tokensM, costUsd });
    }
  }
  return days;
}

export const SIM_HEATMAP: HeatmapDay[] = generateHeatmap();

export const SIM_LIVE_SPARKLINE_BASE = [78.2, 84.5, 81.0, 89.4, 92.1, 87.6, 95.8, 94.6];
