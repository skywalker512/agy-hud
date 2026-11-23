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

export interface SimCacheTtlModel {
  family: string;
  label: string;
  kindEn: string;
  kindZh: string;
  p80Label: string;
  p50Label: string;
  bgMissPct: string;
  longGaps: number;
  buckets: Array<{ label: string; obs: number | null; pred: number }>;
}

export const SIM_SWARM_WORKERS: SimSwarmWorker[] = [
  {
    rosterName: 'hud-ui',
    state: 'working',
    workspace: 'share',
    model: 'gemini-4-carbon',
    taskEn: 'Layered borderless cards, hatched runway bar & 2-col X-Ray',
    taskZh: '无边框分层卡片、斜线续航条与双列上下文 X 光',
    calls: 17,
    outTokens: '21.4k',
    costUsd: '$0.64',
    quota5h: '-0.44%',
    lastPostSeq: 24,
    lastPostEn: 'Switched L2 wells to recessed luminance; zero clipping at 240px',
    lastPostZh: 'L2 内嵌指标已改为柔和低对比凹槽，240px 窄栏零截断',
    updatedAt: '00:02:41',
  },
  {
    rosterName: 'hud-backend',
    state: 'working',
    workspace: 'share',
    model: 'gemini-4-carbon',
    taskEn: 'Additive 52w Iceberg token split & finer MCP context breakdown',
    taskZh: '52 周冰山图新旧 Token 拆分与细粒度 MCP 上下文剖析',
    calls: 14,
    outTokens: '16.9k',
    costUsd: '$0.51',
    quota5h: '-0.35%',
    lastPostSeq: 23,
    lastPostEn: 'Added days52 + newTokens/cachedTokens; 68/68 unit tests green',
    lastPostZh: '已新增 days52 与新旧 Token 字段，68/68 项单元测试通过',
    updatedAt: '00:01:58',
  },
  {
    rosterName: 'verifier',
    state: 'waiting',
    workspace: 'inherit',
    model: 'gemini-3.8-flash-k',
    taskEn: 'Retina 2x visual verification across Dark/Light & narrow panes',
    taskZh: 'Retina 2x 深浅双色与窄栏布局自动化视觉验收',
    calls: 7,
    outTokens: '5.8k',
    costUsd: '$0.09',
    quota5h: '-0.06%',
    lastPostSeq: 22,
    lastPostEn: 'Capture harness ready; awaiting branch merge for final matrix',
    lastPostZh: '高清截图框架已就绪，等待分支合并后执行全矩阵验收',
    updatedAt: '00:01:12',
  },
];

export const SIM_CONTEXT_SEGMENTS: SimContextSegment[] = [
  {
    id: 'sys',
    labelEn: 'Sys Prompt',
    labelZh: '系统提示词',
    tokens: 14600,
    pct: 5.7,
    colorVar: 'var(--seg-input)',
    detailEn: '14.6k tok · 100% prefix cached',
    detailZh: '14.6k tok · 100% 前缀命中缓存',
  },
  {
    id: 'defs',
    labelEn: 'Tool Defs',
    labelZh: '工具定义',
    tokens: 22100,
    pct: 8.6,
    colorVar: 'var(--seg-think)',
    detailEn: '22.1k tok · 16 MCP & built-in schemas',
    detailZh: '22.1k tok · 16 个内置与 MCP 工具定义',
  },
  {
    id: 'tools',
    labelEn: 'Tool Results',
    labelZh: '工具输出',
    tokens: 71800,
    pct: 28.0,
    colorVar: 'var(--seg-out)',
    detailEn: '71.8k tok · read_file 39.4k · run_command 18.8k · edit_file 13.6k',
    detailZh: '71.8k tok · read_file 39.4k · run_command 18.8k · edit_file 13.6k',
  },
  {
    id: 'replies',
    labelEn: 'Model Replies',
    labelZh: '模型回复',
    tokens: 24300,
    pct: 9.5,
    colorVar: 'var(--seg-cache)',
    detailEn: '24.3k tok · visible responses & reasoning summaries',
    detailZh: '24.3k tok · 可见回复与推理摘要',
  },
  {
    id: 'user',
    labelEn: 'User / Ckpt',
    labelZh: '用户 / 检查点',
    tokens: 8900,
    pct: 3.5,
    colorVar: 'var(--muted)',
    detailEn: '8.9k tok · user prompts & compaction checkpoint',
    detailZh: '8.9k tok · 用户输入与压缩检查点',
  },
];

export const SIM_CACHE_TTL_MODELS: SimCacheTtlModel[] = [
  {
    family: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    kindEn: 'LRU Decay',
    kindZh: 'LRU 渐进衰减',
    p80Label: '~18m',
    p50Label: '~26m',
    bgMissPct: '1.1%',
    longGaps: 38,
    buckets: [
      { label: '<1m', obs: 0.99, pred: 0.99 },
      { label: '1-5m', obs: 0.96, pred: 0.97 },
      { label: '5-10m', obs: 0.91, pred: 0.92 },
      { label: '10-20m', obs: 0.82, pred: 0.80 },
      { label: '20-60m', obs: 0.44, pred: 0.46 },
      { label: '1-2h', obs: 0.14, pred: 0.15 },
      { label: '2h+', obs: 0.04, pred: 0.05 },
    ],
  },
  {
    family: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    kindEn: 'Hard 5m TTL',
    kindZh: '5 分钟硬过期',
    p80Label: '~4m 20s',
    p50Label: '~5m 02s',
    bgMissPct: '0.9%',
    longGaps: 24,
    buckets: [
      { label: '<1m', obs: 0.99, pred: 0.99 },
      { label: '1-5m', obs: 0.96, pred: 0.95 },
      { label: '5-10m', obs: 0.08, pred: 0.07 },
      { label: '10-20m', obs: 0.02, pred: 0.01 },
      { label: '20-60m', obs: 0.0, pred: 0.0 },
      { label: '1-2h', obs: null, pred: 0.0 },
      { label: '2h+', obs: null, pred: 0.0 },
    ],
  },
];

// Deterministic PRNG (Mulberry32) for organic, non-sinusoidal LLM telemetry variance
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Organic 60-call engineering session trace:
// - Realistic model switching (Carbon main coding, Flash-K quick reads/verifies, occasional Sonnet review)
// - Non-uniform TPS jitter (no sine wave), realistic cold-prefix / heavy-think TTFT spikes
// - Tool-heavy TC-WAIT turns, 2 BUF single-packet responses, 1 realistic compaction drop at call #34
function generateOrganicSessionCalls(): SimCallPoint[] {
  const rand = makeRng(20260419);
  const gauss = () => {
    const u = Math.max(1e-6, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Realistic model schedule (clusters of Carbon coding turns, occasional Flash-K tool bursts, brief Sonnet audit)
  const flashTurns = new Set([4, 9, 10, 17, 23, 28, 35, 36, 44, 51, 56]);
  const sonnetTurns = new Set([19, 20, 41, 42]);
  const slowTtftTurns = new Set([1, 14, 34, 49]);
  const toolStallTurns = new Set([26, 54]);
  const bufTurns = new Set([17, 44]);

  const toolBank: Array<Array<{ name: string; args: Record<string, unknown>; ms: number }>> = [
    [
      { name: 'read_file', args: { Path: 'web/src/styles/app.css', StartLine: 1, EndLine: 180 }, ms: 14 },
      { name: 'read_file', args: { Path: 'web/src/hooks/useThemeSync.ts', StartLine: 1, EndLine: 120 }, ms: 11 },
    ],
    [
      { name: 'edit_file', args: { Path: 'web/src/components/live/ContextWindowCard.tsx', Target: 'ctx-legend' }, ms: 22 },
    ],
    [
      { name: 'run_command', args: { CommandLine: 'npm run build --prefix web' }, ms: 1420 },
    ],
    [
      { name: 'read_file', args: { Path: 'plugin/sidecars/hud_panel/lib/cache-ttl.ts', StartLine: 150, EndLine: 320 }, ms: 16 },
      { name: 'edit_file', args: { Path: 'plugin/sidecars/hud_panel/lib/telemetry.ts', Target: 'activityHeatmap' }, ms: 29 },
    ],
    [
      { name: 'run_command', args: { CommandLine: 'node --test plugin/sidecars/hud_panel/test/*.test.ts' }, ms: 618 },
    ],
  ];

  const calls: SimCallPoint[] = [];
  let ctx = 14.2;
  let elapsedSec = 0;

  for (let i = 1; i <= 60; i++) {
    const isFlash = flashTurns.has(i);
    const isSonnet = sonnetTurns.has(i);
    const isCompactAfter = i === 33;
    const isPostCompact = i === 34;
    const isToolStall = toolStallTurns.has(i);
    const isBuf = bufTurns.has(i);

    if (isPostCompact) {
      ctx = 19.4;
    } else if (i > 1) {
      const growth = isFlash
        ? 0.7 + rand() * 1.1
        : isToolStall
          ? 4.2 + rand() * 1.9
          : 1.5 + rand() * 2.4;
      ctx = Math.min(84.8, ctx + growth);
    }

    // Organic TPS: model baseline + skewed realistic jitter + subtle context-load drag
    const ctxDrag = (ctx / 100) * 8.5;
    let genTps: number;
    if (isFlash) {
      genTps = 132 + gauss() * 9.5 - ctxDrag * 0.4;
      genTps = Math.max(112, Math.min(151, genTps));
    } else if (isSonnet) {
      genTps = 67 + gauss() * 6.2 - ctxDrag * 0.35;
      genTps = Math.max(54, Math.min(82, genTps));
    } else {
      genTps = 95 + gauss() * 9.8 - ctxDrag;
      if (i === 14 || i === 49) genTps -= 11.4; // momentary backend load dip
      genTps = Math.max(68, Math.min(118, genTps));
    }
    genTps = Number(genTps.toFixed(1));

    // Realistic TTFT with occasional cold-cache / heavy-prompt spikes
    let ttftSec: number;
    if (i === 1) {
      ttftSec = 3.42;
    } else if (isPostCompact) {
      ttftSec = 3.86;
    } else if (isToolStall) {
      ttftSec = 2.15 + rand() * 0.85;
    } else if (slowTtftTurns.has(i)) {
      ttftSec = 3.6 + rand() * 1.65;
    } else if (isFlash) {
      ttftSec = 0.58 + rand() * 0.48;
    } else {
      ttftSec = 1.08 + Math.abs(gauss()) * 0.55 + (ctx / 100) * 0.45;
    }
    ttftSec = Number(ttftSec.toFixed(2));

    const thinkSec = Number(
      (isFlash
        ? 0.32 + rand() * 0.55
        : isSonnet
          ? 2.4 + rand() * 2.8
          : 1.3 + rand() * 3.1 + (i === 14 || i === 49 ? 2.1 : 0)
      ).toFixed(2),
    );
    const toolGenSec = Number(
      (isToolStall
        ? 3.15 + rand() * 1.15
        : isBuf
          ? 0.14
          : 0.42 + rand() * 1.35
      ).toFixed(2),
    );
    const streamSec = Number(
      (isBuf ? 0.18 : 0.78 + rand() * 2.35).toFixed(2),
    );
    const totalSec = ttftSec + thinkSec + toolGenSec + streamSec;

    const thinkTok = Math.round(thinkSec * genTps * (isFlash ? 0.45 : 0.78));
    const visTok = Math.max(48, Math.round((streamSec + toolGenSec * 0.55) * genTps));
    const totalOut = thinkTok + visTok;
    const e2eTps = Number((totalOut / Math.max(0.35, totalSec)).toFixed(1));

    // Realistic cache hit curve: cold on turn 1 & post-compaction, brief dip on model switch, 91-98% steady state
    let cachePct: number;
    if (i === 1) {
      cachePct = 42.6;
    } else if (isPostCompact) {
      cachePct = 47.3;
    } else if (i === 19 || i === 41) {
      cachePct = 61.8 + rand() * 7.2; // model family switch
    } else if (i === 14) {
      cachePct = 71.4; // minor prefix churn after idle pause
    } else {
      cachePct = Math.min(98.2, Math.max(84.5, 93.4 + gauss() * 2.6));
    }
    cachePct = Number(cachePct.toFixed(1));

    const totalPrompt = Math.round((ctx / 100) * 256_000);
    const cachedTok = Math.round((totalPrompt * cachePct) / 100);
    const newInputTok = Math.max(380, totalPrompt - cachedTok);

    const kMult = isFlash ? 0.4 : isSonnet ? 2.4 : 3.0;
    const costUsd = Number(
      (isFlash
        ? 0.006 + (totalPrompt / 256_000) * 0.008
        : isSonnet
          ? 0.028 + (totalPrompt / 256_000) * 0.036
          : 0.026 + (totalPrompt / 256_000) * 0.039
      ).toFixed(3),
    );
    const savedUsd = Number(((cachedTok / 1_000_000) * (isFlash ? 0.32 : 3.15)).toFixed(2));
    const quota5h = Number((costUsd * kMult * 1.42).toFixed(2));

    elapsedSec += Math.round(totalSec + 9 + rand() * 34);
    const baseMin = 14 * 60 + 8;
    const totalMin = baseMin + Math.floor(elapsedSec / 60);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    const ss = String(elapsedSec % 60).padStart(2, '0');

    const model = isFlash
      ? 'gemini-3.8-flash-k'
      : isSonnet
        ? 'claude-sonnet-4-6'
        : 'gemini-4-carbon';
    const shortModel = isFlash ? 'Flash-K' : isSonnet ? 'Sonnet' : 'Carbon';

    calls.push({
      idx: i,
      time: `${hh}:${mm}:${ss}`,
      model,
      shortModel,
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
      tools: toolBank[(i + (isToolStall ? 2 : 0)) % toolBank.length],
    });
  }

  return calls;
}

export const SIM_CALLS: SimCallPoint[] = generateOrganicSessionCalls();

export interface HeatmapDay {
  week: number;
  day: number;
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  tokensM: number;
  newTokensM: number;
  cachedTokensM: number;
  costUsd: number;
}

function generateHeatmap(): HeatmapDay[] {
  const rand = makeRng(90421);
  const days: HeatmapDay[] = [];
  const start = new Date('2026-08-03T00:00:00Z');
  for (let w = 0; w < 16; w++) {
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const dt = new Date(start.getTime() + idx * 86_400_000);
      const iso = dt.toISOString().slice(0, 10);
      const isWeekend = d === 5 || d === 6;
      const r = rand();
      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (isWeekend) {
        level = r > 0.78 ? 2 : r > 0.56 ? 1 : 0;
      } else {
        level = r > 0.78 ? 4 : r > 0.52 ? 3 : r > 0.24 ? 2 : r > 0.08 ? 1 : 0;
      }
      if (w >= 13 && !isWeekend && level < 2) level = 2;
      if (w === 15 && (d === 2 || d === 3)) level = 4;

      const tokensM = level === 0 ? 0 : Number((level * 1.45 + rand() * 1.1).toFixed(1));
      const cacheShare = 0.78 + rand() * 0.14;
      const cachedTokensM = level === 0 ? 0 : Number((tokensM * cacheShare).toFixed(1));
      const newTokensM = level === 0 ? 0 : Number(Math.max(0.1, tokensM - cachedTokensM).toFixed(1));
      const costUsd = level === 0 ? 0 : Number((newTokensM * 1.95 + cachedTokensM * 0.24).toFixed(2));
      days.push({ week: w, day: d, date: iso, level, tokensM, newTokensM, cachedTokensM, costUsd });
    }
  }
  return days;
}

export const SIM_HEATMAP: HeatmapDay[] = generateHeatmap();

// Organic live trailing GEN TPS points (natural variance, never sinusoidal)
export const SIM_LIVE_SPARKLINE_BASE = [84.2, 91.6, 79.4, 88.9, 102.3, 94.1, 86.7, 97.4, 93.8, 96.2];
export const SIM_LIVE_TICK_STREAM = [93.4, 98.1, 89.7, 95.6, 101.2, 91.8, 94.5, 87.9, 96.8, 92.3];
