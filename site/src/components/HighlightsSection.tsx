import { useEffect, useState } from 'preact/hooks';
import type { Locale, SiteCopy } from '../i18n/content';
import type { DemoJumpRequest } from './LiveHudFrame';

interface HighlightsSectionProps {
  locale: Locale;
  copy: SiteCopy;
  onJumpDemo: (req: DemoJumpRequest) => void;
}

function LiveTtftShowcase({ isZh }: { isZh: boolean }) {
  const [scenario, setScenario] = useState<'slow' | 'fast'>('slow');
  const [paused, setPaused] = useState(false);
  const [tickMs, setTickMs] = useState(3200);

  // Cycle lengths: Slow (wait 5.8s -> stream 3.6s = 9.4s), Fast (wait 1.3s -> stream 3.4s = 4.7s)
  const waitTargetMs = scenario === 'slow' ? 5800 : 1300;
  const cycleMs = waitTargetMs + (scenario === 'slow' ? 3600 : 3400);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setTickMs((prev) => (prev + 120) % cycleMs);
    }, 120);
    return () => window.clearInterval(id);
  }, [paused, cycleMs]);

  const isWaiting = tickMs < waitTargetMs;
  const elapsedSec = isWaiting ? tickMs / 1000 : waitTargetMs / 1000;
  const genElapsedSec = isWaiting ? 0 : (tickMs - waitTargetMs) / 1000;
  const avgSec = 1.44;
  const isStalled = isWaiting && elapsedSec >= 3.8;
  const isSlow = isWaiting && !isStalled && elapsedSec >= 2.2;

  const recentBars = [1.1, 1.5, 0.9, 1.8, 1.3, 1.2, 1.6, 1.0, 1.4];
  const allBars = [...recentBars, Math.max(0.25, elapsedSec)];
  const maxBar = Math.max(...allBars, 2.2);
  const avgTopPct = Math.max(8, Math.min(88, 100 - (avgSec / maxBar) * 100));

  const barColor = (v: number) =>
    v <= 2.0 ? 'var(--seg-cache)' : v <= 4.0 ? 'var(--seg-out)' : '#ef4444';

  const statusPill = isWaiting
    ? isStalled
      ? { cls: 'border-[var(--tint-bad-border)] bg-[var(--tint-bad)] text-[var(--seg-bad)]', text: isZh ? '首字偏慢' : 'SLOW TTFT' }
      : isSlow
        ? { cls: 'border-[var(--tint-out-border)] bg-[var(--tint-out)] text-[var(--seg-out)]', text: isZh ? '等待偏长' : 'WAIT LONG' }
        : { cls: 'border-[var(--tint-out-border)] bg-[var(--tint-out)] text-[var(--seg-out)]', text: isZh ? '等待首字' : 'WAIT TTFT' }
    : { cls: 'border-[var(--tint-cache-border)] bg-[var(--tint-cache)] text-[var(--seg-cache)]', text: isZh ? '首字已出 · 114 t/s' : '1ST TOK · 114 t/s' };

  const numColorCls = isStalled
    ? 'text-[var(--seg-bad)]'
    : isSlow
      ? 'text-[var(--seg-out)]'
      : isWaiting
        ? 'text-[var(--fg)]'
        : 'text-[var(--seg-cache)]';

  const liveSubLine = isWaiting
    ? elapsedSec >= 2.1
      ? isZh
        ? `已超均值 ${(elapsedSec / avgSec).toFixed(1)}× · 仍在等首字 (均 1.44s)`
        : `${(elapsedSec / avgSec).toFixed(1)}× avg (1.44s) · still waiting…`
      : isZh
        ? '正在等首字返回… · 会话均值 1.44s'
        : 'Waiting for first token… · avg 1.44s'
    : isZh
      ? `首字 ${elapsedSec.toFixed(1)}s 已到达 · 流式生成 ${genElapsedSec.toFixed(1)}s`
      : `First token locked at ${elapsedSec.toFixed(1)}s · streaming ${genElapsedSec.toFixed(1)}s`;

  return (
    <div class="bento-well flex flex-col gap-2.5 p-3">
      {/* Interactive Scenario Switcher */}
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <div class="inline-flex items-center gap-1 rounded-md bg-[var(--surface)] p-0.5 font-mono text-[9.5px]">
          <button
            type="button"
            onClick={() => {
              setScenario('slow');
              setTickMs(200);
              setPaused(false);
            }}
            class={`cursor-pointer rounded px-2 py-0.5 font-semibold transition-colors ${
              scenario === 'slow'
                ? 'bg-[var(--tint-bad)] text-[var(--seg-bad)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {isZh ? '🐢 卡首字慢响' : '🐢 Slow Wait'}
          </button>
          <button
            type="button"
            onClick={() => {
              setScenario('fast');
              setTickMs(200);
              setPaused(false);
            }}
            class={`cursor-pointer rounded px-2 py-0.5 font-semibold transition-colors ${
              scenario === 'fast'
                ? 'bg-[var(--tint-cache)] text-[var(--seg-cache)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {isZh ? '⚡ 正常快响' : '⚡ Fast TTFT'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          class="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[9.5px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
        >
          {paused ? (isZh ? '▶ 继续' : '▶ Play') : (isZh ? '⏸ 暂停' : '⏸ Pause')}
        </button>
      </div>

      {/* Live Hero TTFT Stopwatch Surface (1:1 mirror of real HeroSpeedCards) */}
      <div
        class={`relative overflow-hidden rounded-lg border bg-[var(--surface)] p-2.5 transition-colors ${
          isStalled
            ? 'border-[var(--tint-bad-border)]'
            : isWaiting
              ? 'border-[var(--tint-out-border)]'
              : 'border-[var(--tint-cache-border)]'
        }`}
      >
        <div
          class="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-full transition-colors"
          style={{
            background: isStalled
              ? 'var(--seg-bad)'
              : isWaiting
                ? 'var(--seg-out)'
                : 'var(--seg-cache)',
            opacity: isWaiting && !paused ? 0.9 : 0.65,
          }}
        />
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-[10px] font-semibold text-[var(--muted)]">
            {isZh ? '首字等待 · Orchestrator (Neon)' : 'FIRST TOKEN · Orchestrator (Neon)'}
          </span>
          <span class={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] font-mono text-[9.5px] font-semibold ${statusPill.cls}`}>
            <span class={`h-1.5 w-1.5 rounded-full bg-current ${isWaiting && !paused ? 'animate-pulse' : ''}`} />
            <span>{statusPill.text}</span>
          </span>
        </div>

        <div class="mt-1.5 flex items-baseline justify-between gap-2">
          <div class={`font-mono text-[24px] leading-none font-bold tabular-nums transition-colors ${numColorCls}`}>
            {elapsedSec.toFixed(1)}
            <span class="ml-0.5 text-[11px] font-medium text-[var(--muted)]">s</span>
          </div>
          <span class="inline-flex items-center gap-1 font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
            <span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-cache)]" />
            <span>{isZh ? '全球 P50 · 1.5s' : 'Global P50 · 1.5s'}</span>
          </span>
        </div>

        <div class="mt-1 truncate font-mono text-[10px] text-[var(--muted)] tabular-nums">
          {liveSubLine}
        </div>

        {/* Live Waiting Progress Track Crossing Session Avg Tick (matches real HeroSpeedCards) */}
        {isWaiting && (
          <div class="relative mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              class="h-full rounded-full transition-all duration-100"
              style={{
                width: `${Math.min(100, Math.max(6, (elapsedSec / 6.5) * 100)).toFixed(1)}%`,
                backgroundColor: isStalled ? 'var(--seg-bad)' : isSlow ? 'var(--seg-out)' : 'var(--seg-cache)',
              }}
            />
            <span
              class="pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-[var(--fg)] opacity-55"
              style={{ left: `${((avgSec / 6.5) * 100).toFixed(1)}%` }}
            />
          </div>
        )}

        {/* 10-Bar Live Growing TTFT Bar Chart vs Session Avg Dashed Line */}
        <div class="relative mt-2.5 h-[36px] w-full">
          <div
            class="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--border-strong)]"
            style={{ top: `${avgTopPct.toFixed(1)}%` }}
          />
          <span
            class="pointer-events-none absolute right-0 font-mono text-[8px] text-[var(--muted)] opacity-75"
            style={{ top: `calc(${avgTopPct.toFixed(1)}% - 10px)` }}
          >
            {isZh ? '均 1.4s' : 'avg 1.4s'}
          </span>
          <div class="grid h-full grid-cols-10 items-end gap-1">
            {allBars.map((v, i) => {
              const isLiveBar = i === allBars.length - 1;
              const hPct = Math.max(10, Math.min(100, (v / maxBar) * 100));
              return (
                <div key={i} class="flex h-full items-end">
                  <div
                    class={`w-full rounded-t-[2.5px] transition-all duration-100 ${isLiveBar && isWaiting && !paused ? 'animate-pulse' : ''}`}
                    style={{
                      height: `${hPct.toFixed(1)}%`,
                      background: barColor(v),
                      opacity: isLiveBar ? 0.96 : 0.45,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Matching Real LiveCallRow Preview Strip */}
      <div class="flex items-center justify-between gap-2 rounded-md bg-[var(--surface)] px-2.5 py-1.5 font-mono text-[10px] tabular-nums">
        <span class="inline-flex min-w-0 items-center gap-1.5 truncate text-[var(--fg)]">
          <span class="text-[var(--muted)]">#65</span>
          <span class="truncate font-medium">gemini-pro-orchestrator-neon</span>
        </span>
        <span class={`shrink-0 rounded-full border px-1.5 py-[0.5px] text-[9.5px] font-semibold ${statusPill.cls}`}>
          TTFT {isWaiting ? `${elapsedSec.toFixed(1)}s…` : `${elapsedSec.toFixed(1)}s`}
        </span>
      </div>
    </div>
  );
}

export function HighlightsSection({ locale, copy, onJumpDemo }: HighlightsSectionProps) {
  const isZh = locale === 'zh';

  // Mini heatmap intensity grid for Wrapped Poster preview (6x12)
  const posterHeat = [
    1, 2, 0, 3, 4, 2, 1, 3, 4, 4, 2, 3,
    2, 3, 1, 4, 3, 1, 2, 4, 3, 2, 3, 4,
    0, 1, 2, 3, 4, 3, 2, 2, 4, 4, 1, 3,
    1, 4, 3, 2, 3, 4, 1, 3, 2, 3, 4, 4,
    2, 2, 1, 4, 4, 2, 0, 2, 3, 4, 3, 2,
    0, 1, 0, 2, 1, 1, 1, 1, 2, 3, 2, 1,
  ];

  const TryButton = ({
    req,
    label,
  }: {
    req: DemoJumpRequest;
    label?: string;
  }) => (
    <button
      type="button"
      onClick={() => onJumpDemo(req)}
      class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-[var(--tint-accent-border)] bg-[var(--tint-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-85"
    >
      <span>{label || copy.highlights.tryLive}</span>
      <span aria-hidden="true">↗</span>
    </button>
  );

  return (
    <section id="overview" class="scroll-mt-16 border-t border-[var(--border)] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section Header */}
        <div class="max-w-2xl">
          <div class="font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--accent-ink)]">
            {copy.highlights.eyebrow}
          </div>
          <h2 class="display-heading mt-2 text-[28px] leading-[1.15] font-bold text-[var(--fg)] sm:text-[36px]">
            {copy.highlights.heading}
          </h2>
          <p class="mt-3 text-[15px] leading-[1.7] text-[var(--muted)]">
            {copy.highlights.subhead}
          </p>
        </div>

        {/* 8-Card Interactive Visual Bento Wall (4 balanced 12-col rows) */}
        <div class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* ── Row 1: Quota & Per-Model Burn Comparison (7) + Native Swarm Cockpit (5) ── */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-7">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)]">
                  {isZh ? '⚡ 配额续航预测 · 各模型消耗倍率对比' : '⚡ QUOTA RUNWAY · PER-MODEL BURN COMPARISON'}
                </span>
                <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                  {isZh ? '每个模型吃多少配额、重置前够不够用，算得清清楚楚' : 'Know which model burns quota fastest — and if you will last until reset'}
                </h3>
                <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {isZh
                    ? '实测拟合各模型真实消耗倍率（Carbon / Argon 3× vs Neon / Hydrogen 1× vs Claude 独立池），结合你近 30 天作息用斜纹条预估 5h/7d 重置前余量，并自动区分本机（App + CLI + IDE）与跨设备远程消耗。'
                    : 'Empirically fits each model family’s real quota multiplier (Carbon/Argon 3× vs Neon/Hydrogen 1× vs Claude pool), projects 5h/7d runway inside the bar using your 30-day rhythm, and separates local (App + CLI + IDE) from remote spend.'}
                </p>
              </div>
              <TryButton
                req={{ id: 'quota', tab: 'account', action: 'quota' }}
                label={isZh ? '看配额与倍率' : 'Quota & k-Rules'}
              />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Left: Hatched 5h/7d Runway Preview */}
              <div class="bento-well flex flex-col justify-between gap-2.5 p-3">
                <div>
                  <div class="flex items-baseline justify-between font-mono text-[10.5px] tabular-nums">
                    <span class="font-semibold text-[var(--fg)]">Gemini Pool · 5h</span>
                    <span class="font-bold text-[var(--seg-cache)]">68.4% left</span>
                  </div>
                  <div class="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div class="absolute inset-y-0 left-0 w-[68.4%] rounded-full bg-[var(--seg-cache)]" />
                    <div class="hatched-runway absolute inset-y-0 left-[44%] w-[24.4%] rounded-r-full" />
                  </div>
                  <div class="mt-1 flex items-center justify-between font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                    <span>{isZh ? '重置前预计剩 44%' : 'Projected 44% at reset'}</span>
                    <span>Ultra 20x</span>
                  </div>
                </div>
                <div class="border-t border-[var(--border-subtle)] pt-2">
                  <div class="flex items-baseline justify-between font-mono text-[10.5px] tabular-nums">
                    <span class="font-semibold text-[var(--fg)]">Claude / GPT · 5h</span>
                    <span class="font-bold text-[var(--seg-out)]">84.5% left</span>
                  </div>
                  <div class="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div class="absolute inset-y-0 left-0 w-[84.5%] rounded-full bg-[var(--seg-out)]" />
                  </div>
                </div>
              </div>

              {/* Right: Per-Model Burn Multiplier Comparison */}
              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div class="flex items-center justify-between font-mono text-[10px] text-[var(--muted)]">
                  <span>{isZh ? '各模型实测消耗倍率' : 'Fitted Model Burn Rates'}</span>
                  <span class="text-[var(--seg-cache)]">IRLS</span>
                </div>
                <div class="flex flex-col gap-1.5 font-mono text-[10px] tabular-nums">
                  {[
                    { name: 'Hydrogen', k: '1.0×', pct: '33%', color: 'bg-[var(--seg-cache)]', note: isZh ? '高性价比' : '1× base' },
                    { name: 'Neon', k: '1.0×', pct: '33%', color: 'bg-[var(--seg-input)]', note: isZh ? '主力平衡' : '1× base' },
                    { name: 'Carbon', k: '3.0×', pct: '100%', color: 'bg-[var(--seg-think)]', note: isZh ? '高倍消耗' : '3× burn' },
                    { name: 'Opus 5.5', k: '~4.8%/$', pct: '78%', color: 'bg-[var(--seg-out)]', note: isZh ? 'Claude池' : 'Claude pool' },
                  ].map((m) => (
                    <div key={m.name} class="flex items-center gap-2">
                      <span class="w-[58px] shrink-0 truncate text-[var(--fg-2)]">{m.name}</span>
                      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class={`h-full rounded-full ${m.color}`} style={{ width: m.pct }} />
                      </div>
                      <span class="w-[46px] shrink-0 text-right font-semibold text-[var(--fg)]">{m.k}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          {/* Card 2 (5 cols): Native AGY Swarm Cockpit & Recursive Tree Rollup */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-5">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-think)]">
                  {isZh ? '🐝 原生 AGY 蜂群适配' : '🐝 NATIVE AGY SWARM COCKPIT'}
                </span>
                <TryButton
                  req={{ id: 'swarm', tab: 'live', action: 'swarm' }}
                  label={isZh ? '看蜂群视图' : 'Swarm View'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '原生适配 Swarm 蜂群，多 Agent 状态与整树花销一屏掌握' : 'First-class Swarm visibility & recursive session tree rollup'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '直读 Antigravity 磁盘原生 Swarm 状态，实时追踪每个 @worker 运行态、工作树与公告板进度；自动递归合并主会话、所有 Worker、嵌套子 Agent 与 Side-Q 的总费用和配额，支持一键互跳。'
                  : 'Reads Antigravity’s native on-disk Swarm state to track every @worker’s live state, worktree, and Board #seq — while recursively rolling up cost, output, and quota across nested subagents & Side-Q.'}
              </p>
            </div>

            <div class="bento-well flex flex-col gap-2 p-3 font-mono text-[10px]">
              <div class="flex items-center justify-between text-[var(--muted)]">
                <span class="font-semibold text-[var(--fg)]">{isZh ? 'Swarm 蜂群 · 4 Workers' : 'Swarm · 4 Workers'}</span>
                <span class="rounded bg-[var(--tint-think)] px-1.5 py-0.5 text-[9.5px] text-[var(--seg-think)]">Board #42</span>
              </div>
              <div class="flex flex-col gap-1.5">
                {[
                  { name: '@architect', state: isZh ? '运行中' : 'working', badge: 'share', dot: 'bg-[var(--seg-cache)]', cost: '$3.84' },
                  { name: '@frontend', state: isZh ? '运行中' : 'working', badge: 'share', dot: 'bg-[var(--seg-cache)]', cost: '$4.12' },
                  { name: '@verifier', state: isZh ? '待命' : 'waiting', badge: 'inherit', dot: 'bg-[var(--seg-out)]', cost: '$1.84' },
                ].map((w) => (
                  <div key={w.name} class="flex items-center justify-between gap-2 rounded-md bg-[var(--surface)] px-2 py-1">
                    <span class="inline-flex items-center gap-1.5 truncate text-[var(--fg)]">
                      <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${w.dot}`} />
                      <span class="font-semibold">{w.name}</span>
                      <span class="text-[9px] text-[var(--faint)]">{w.badge}</span>
                    </span>
                    <span class="shrink-0 text-[var(--fg-2)] tabular-nums">{w.state} · {w.cost}</span>
                  </div>
                ))}
              </div>
              <div class="flex items-center justify-between border-t border-[var(--border-subtle)] pt-1.5 text-[9.5px]">
                <span class="text-[var(--muted)]">{isZh ? '递归总计 (主 + 4子)' : 'Tree Total (Main + 4)'}</span>
                <span class="font-bold text-[var(--seg-cache)]">$12.20 · -4.1% 5h</span>
              </div>
            </div>
          </article>

          {/* ── Row 2: Prompt Cache Expiry & TTL Survival (5) + Context X-Ray & Call Waterfall (7) ── */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-5">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)]">
                  {isZh ? '🧊 缓存失效预警 · TTL 生存模型' : '🧊 CACHE EXPIRY ALERTS · TTL CURVE'}
                </span>
                <TryButton
                  req={{ id: 'cache-ttl', tab: 'account', action: 'cache-ttl' }}
                  label={isZh ? '看缓存曲线' : 'TTL Curve'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '别等离开几分钟掉缓存了，才发现白烧一轮重算' : 'Know before a pause expires your cache and triggers a costly re-prefill'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '基于本机历史实测拟合生存曲线，精准区分 Claude ~5 分钟硬断崖与 Gemini 平滑 LRU 衰减；实时展示当前会话缓存存活率、P80/P50 安全间隔，以及一旦失效会多烧多少美元和 5h 配额。'
                  : 'Fits your real local cache survival curve — separating Claude’s sharp 5-minute cliff from Gemini’s gradual LRU decay — with live survival %, P80/P50 safe horizons, and exact miss penalty in $ and 5h quota.'}
              </p>
            </div>

            <div class="bento-well flex flex-col gap-2 p-3">
              {/* Real CacheTtlCard replica: Model Header */}
              <div class="flex flex-wrap items-center justify-between gap-1.5">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[11px] font-semibold text-[var(--fg)]">Gemini 4 Neon</span>
                  <span class="rounded bg-[var(--surface-3)] px-1.5 py-[1px] text-[9px] text-[var(--muted)]">
                    {isZh ? 'LRU 衰减' : 'LRU decay'}
                  </span>
                </div>
                <span class="inline-flex items-center gap-1 rounded-full bg-[var(--surface-3)] px-1.5 py-[1px] font-mono text-[9px] text-[var(--fg-2)] tabular-nums">
                  <span class="text-[var(--seg-cache)]">✓</span>
                  <span>{isZh ? '实测 (81 长间隔)' : 'Fitted (81 ≥3m)'}</span>
                </span>
              </div>

              {/* 3-Metric Recessed Wells Strip (P80 / P50 / Bg Noise) */}
              <div class="grid grid-cols-3 gap-1.5">
                <div class="rounded-md bg-[var(--surface)] px-2 py-1">
                  <div class="truncate text-[9px] text-[var(--muted)]">{isZh ? 'P80 安全窗' : 'Safe (P80)'}</div>
                  <div class="font-mono text-[11.5px] font-bold text-[var(--seg-cache)] tabular-nums">~14m</div>
                </div>
                <div class="rounded-md bg-[var(--surface)] px-2 py-1">
                  <div class="truncate text-[9px] text-[var(--muted)]">{isZh ? 'P50 半衰期' : 'Half-life (P50)'}</div>
                  <div class="font-mono text-[11.5px] font-bold text-[var(--fg)] tabular-nums">~52m</div>
                </div>
                <div class="rounded-md bg-[var(--surface)] px-2 py-1">
                  <div class="truncate text-[9px] text-[var(--muted)]">{isZh ? '短间隔底噪' : 'Noise miss'}</div>
                  <div class="font-mono text-[11.5px] font-bold text-[var(--fg)] tabular-nums">1.7%</div>
                </div>
              </div>

              {/* 7-Bucket Empirical Hit-Rate Bars + Fitted Survival Curve Overlay */}
              {(() => {
                const buckets = [
                  { label: '<1m', emp: 98, pred: 98 },
                  { label: '1-5m', emp: 95, pred: 95 },
                  { label: '5-10m', emp: 90, pred: 89 },
                  { label: '10-20m', emp: 79, pred: 80 },
                  { label: '20-60m', emp: 55, pred: 60 },
                  { label: '1-2h', emp: 25, pred: 37 },
                  { label: '2h+', emp: 0, pred: 21 },
                ];
                const polyPts = buckets
                  .map((b, i) => `${(((i + 0.5) / buckets.length) * 100).toFixed(1)},${(100 - b.pred).toFixed(1)}`)
                  .join(' ');
                const barTone = (emp: number) =>
                  emp >= 75 ? 'var(--seg-cache)' : emp >= 40 ? 'var(--seg-out)' : '#ef4444';
                return (
                  <div class="flex flex-col gap-1.5 rounded-md bg-[var(--surface)] px-2.5 py-2">
                    <div class="flex items-center justify-between text-[9px] text-[var(--muted)]">
                      <div class="flex items-center gap-2.5">
                        <span class="inline-flex items-center gap-1">
                          <span class="inline-block h-2 w-2 rounded-[2px] bg-[var(--seg-cache)] opacity-75" />
                          <span>{isZh ? '实测命中率' : 'Observed'}</span>
                        </span>
                        <span class="inline-flex items-center gap-1">
                          <span class="inline-block h-2 w-2 rounded-full bg-[var(--accent-ink)]" />
                          <span>{isZh ? '拟合曲线' : 'Fitted curve'}</span>
                        </span>
                      </div>
                      <span class="font-mono opacity-65">100%</span>
                    </div>

                    <div class="relative h-[54px]">
                      <div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--border-strong)] opacity-70" />
                      <span class="pointer-events-none absolute right-0 top-[calc(50%-10px)] font-mono text-[8px] text-[var(--muted)] opacity-60">
                        50%
                      </span>
                      <svg
                        class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <polyline
                          fill="none"
                          stroke="var(--accent-ink)"
                          stroke-width="1.8"
                          stroke-linejoin="round"
                          stroke-linecap="round"
                          vector-effect="non-scaling-stroke"
                          opacity="0.9"
                          points={polyPts}
                        />
                      </svg>
                      <div class="relative z-10 grid h-full grid-cols-7 gap-1">
                        {buckets.map((b) => (
                          <div key={b.label} class="relative flex h-full items-end justify-center">
                            {b.emp > 0 ? (
                              <div
                                class="w-[56%] rounded-t-[2.5px]"
                                style={{ height: `${Math.max(4, b.emp)}%`, background: barTone(b.emp), opacity: 0.72 }}
                              />
                            ) : (
                              <div class="h-[2px] w-[56%] rounded-full bg-[var(--border-strong)]" />
                            )}
                            <span
                              class="pointer-events-none absolute h-[5px] w-[5px] rounded-full bg-[var(--accent-ink)]"
                              style={{ bottom: `calc(${b.pred}% - 2.5px)`, boxShadow: '0 0 0 1.2px var(--surface)' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div class="grid grid-cols-7 gap-0.5 border-t border-[var(--border-subtle)] pt-1 text-center font-mono tabular-nums">
                      {buckets.map((b) => (
                        <div key={b.label} class="flex flex-col leading-[1.2]">
                          <span class="truncate text-[8.5px] font-medium text-[var(--fg)]">{b.label}</span>
                          <span class="truncate text-[8px] text-[var(--muted)]">{b.emp}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Expired Miss Cost Footer */}
              <div class="flex items-center justify-between font-mono text-[9.5px] tabular-nums">
                <span class="text-[var(--muted)]">{isZh ? '2,605 对样本' : '2,605 pairs'}</span>
                <span class="font-semibold text-[var(--seg-out)]">
                  {isZh ? '过期重算 26 次 (+$14.60)' : '26 expired misses (+$14.60)'}
                </span>
              </div>
            </div>
          </article>

          {/* Card 4 (7 cols): Context Window X-Ray & 5-Tab Call Waterfall */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-7">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-input)]">
                  {isZh ? '🔍 上下文 X-RAY · ⏱ 调用耗时瀑布图' : '🔍 CONTEXT X-RAY · ⏱ TIMING WATERFALL'}
                </span>
                <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                  {isZh ? '拆穿上下文膨胀元凶，定位每一秒卡在思考还是工具' : 'See what fills your context window & where every second went'}
                </h3>
                <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {isZh
                    ? '双列 X-Ray 拆解 System、MCP Tools、Skills、Rules 与单工具输出排行，预估还能撑几轮触发 /compact；全历史趋势图配缩略图缩放，展开任意调用即看 TTFT / 思考 / TC-WAIT 工具卡顿 / 正文耗时瀑布图。'
                    : 'Breaks down System, MCP Tools, Skills, Rules, and per-tool outputs with turns-until-compact headroom; full-history Trend Explorer + 5-tab Call Inspector separates TTFT, Thinking, TC-WAIT stalls, and Reply streaming.'}
                </p>
              </div>
              <TryButton
                req={{ id: 'calls', tab: 'calls', action: 'calls-top' }}
                label={isZh ? '看调用详情' : 'Call Inspector'}
              />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Context Breakdown */}
              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div>
                  <div class="flex items-center justify-between font-mono text-[10px] tabular-nums">
                    <span class="text-[var(--muted)]">{isZh ? '上下文窗口' : 'Context Window'}</span>
                    <span class="font-semibold text-[var(--fg)]">114.6K / 512K · {isZh ? '剩 ~14 轮' : '~14t left'}</span>
                  </div>
                  <div class="mt-1.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div class="h-full w-[10%] rounded-l-full bg-[var(--seg-think)]" />
                    <div class="h-full w-[14%] bg-[var(--seg-input)]" />
                    <div class="h-full w-[26%] bg-[var(--seg-out)]" />
                    <div class="h-full w-[12%] rounded-r-full bg-[var(--seg-cache)]" />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                  <span class="flex justify-between"><span>MCP Tools</span><b class="text-[var(--fg-2)]">13.2K</b></span>
                  <span class="flex justify-between"><span>read_file</span><b class="text-[var(--fg-2)]">34.8K</b></span>
                  <span class="flex justify-between"><span>System/Rules</span><b class="text-[var(--fg-2)]">8.4K</b></span>
                  <span class="flex justify-between"><span>{isZh ? '模型回复' : 'Replies'}</span><b class="text-[var(--fg-2)]">18.9K</b></span>
                </div>
              </div>

              {/* Per-Call Timing Waterfall */}
              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div class="flex items-center justify-between font-mono text-[10px] tabular-nums">
                  <span class="text-[var(--muted)]">{isZh ? '单次耗时瀑布图' : 'Call Timing Waterfall'}</span>
                  <span class="font-semibold text-[var(--fg)]">8.2s · 128 t/s</span>
                </div>
                <div class="flex flex-col gap-1.5 font-mono text-[9.5px] tabular-nums">
                  {[
                    { lbl: 'TTFT', val: '1.4s', left: '0%', w: '17%', cls: 'bg-[var(--seg-input)]' },
                    { lbl: isZh ? '思考' : 'Think', val: '2.8s', left: '17%', w: '34%', cls: 'bg-[var(--seg-think)]' },
                    { lbl: 'TC-WAIT', val: '0.9s', left: '51%', w: '11%', cls: 'bg-[var(--seg-out)]' },
                    { lbl: isZh ? '正文' : 'Reply', val: '3.1s', left: '62%', w: '38%', cls: 'bg-[var(--seg-cache)]' },
                  ].map((s) => (
                    <div key={s.lbl} class="flex items-center gap-2">
                      <span class="w-[46px] shrink-0 text-[var(--muted)]">{s.lbl}</span>
                      <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class={`absolute inset-y-0 rounded-full ${s.cls}`} style={{ left: s.left, width: s.w }} />
                      </div>
                      <span class="w-[30px] shrink-0 text-right text-[var(--fg-2)]">{s.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>

          {/* ── Row 3: Global Gemini 7d/5m Curves + Cyber Arena PK (7) + Live TTFT Attribution (5) ── */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-7">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-input)]">
                  {isZh ? '🌐 全球大盘折线 · ⚔ 赛博斗蛐蛐' : '🌐 GLOBAL CURVES · ⚔ CYBER ARENA PK'}
                </span>
                <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                  {isZh ? 'Gemini 全球 7 天/5 分钟大盘，拿本机速度直接同图 PK' : 'Global 7d/5m Gemini curves & head-to-head Arena PK'}
                </h3>
                <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {isZh
                    ? '实时追踪 5 个 Gemini 模型的全网首字、吐字、缓存与 Vertex / AI Studio 节点可用率，并在「赛博斗蛐蛐」里把你本机的 30m/24h/7d 实测和全球大盘直接 1v1 对比。'
                    : 'Tracks global TTFT, TPS, cache hit %, and Vertex vs AI Studio uptime across 5 Gemini models — overlay your local curve or duel your 30m/24h/7d metrics head-to-head in Cyber Arena PK.'}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <TryButton
                  req={{ id: 'global-trend', tab: 'calls', action: 'global-trend' }}
                  label={isZh ? '大盘折线' : '7d Curves'}
                />
                <TryButton
                  req={{ id: 'arena', tab: 'account', action: 'arena' }}
                  label={isZh ? '斗蛐蛐 PK' : 'Arena PK'}
                />
                <a
                  href="./pulse/"
                  class="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg)] no-underline transition-colors hover:border-[var(--seg-cache)]"
                >
                  <span>{isZh ? '独立雷达' : '/pulse/'}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="bento-well p-3">
                <div class="flex items-center justify-between text-[10px] font-mono text-[var(--muted)]">
                  <span>{isZh ? 'TTFT 7d + 近5m' : 'TTFT 7d + 5m Live'}</span>
                  <span class="text-[var(--seg-cache)]">Hydro 1.52s</span>
                </div>
                <svg viewBox="0 0 220 74" class="mt-2 block h-[72px] w-full overflow-visible" aria-hidden="true">
                  <line x1="0" y1="18" x2="220" y2="18" stroke="var(--border)" stroke-dasharray="2 3" />
                  <line x1="0" y1="44" x2="220" y2="44" stroke="var(--border)" stroke-dasharray="2 3" />
                  <line x1="0" y1="68" x2="220" y2="68" stroke="var(--border)" />
                  <path d="M4,24 C40,28 74,14 110,20 C146,26 180,10 214,15" fill="none" stroke="var(--seg-out)" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M4,42 C40,38 74,35 110,40 C146,34 180,37 214,35" fill="none" stroke="var(--seg-input)" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M4,58 C40,56 74,59 110,55 C146,57 180,54 214,56" fill="none" stroke="var(--seg-cache)" stroke-width="2" stroke-linecap="round" />
                  <circle cx="214" cy="15" r="3" fill="var(--seg-out)" />
                  <circle cx="214" cy="35" r="3" fill="var(--seg-input)" />
                  <circle cx="214" cy="56" r="3.2" fill="var(--seg-cache)" />
                </svg>
                <div class="mt-1 flex items-center gap-3 font-mono text-[9.5px] text-[var(--muted)]">
                  <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-cache)]" />Hydro</span>
                  <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-input)]" />Neon</span>
                  <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-out)]" />Carbon</span>
                </div>
              </div>

              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div class="flex items-center justify-between font-mono text-[10px]">
                  <span class="font-bold text-[var(--seg-cache)]">{isZh ? '本机 Neon · 96分' : 'Mine Neon · 96'}</span>
                  <span class="text-[var(--faint)]">VS</span>
                  <span class="font-bold text-[var(--seg-input)]">{isZh ? '大盘 30m · 61分' : 'Global 30m · 61'}</span>
                </div>
                <div class="flex flex-col gap-2">
                  <div>
                    <div class="flex justify-between font-mono text-[9.5px] tabular-nums">
                      <span class="font-semibold text-[var(--seg-cache)]">1.44s ★</span>
                      <span class="text-[var(--muted)]">TTFT</span>
                      <span class="text-[var(--fg-2)]">6.45s</span>
                    </div>
                    <div class="mt-1 grid grid-cols-2 gap-1 h-1.5">
                      <div class="flex justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class="h-full w-[92%] rounded-full bg-[var(--seg-cache)]" />
                      </div>
                      <div class="overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class="h-full w-[32%] rounded-full bg-[var(--seg-input)] opacity-60" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div class="flex justify-between font-mono text-[9.5px] tabular-nums">
                      <span class="font-semibold text-[var(--seg-cache)]">96.8 t/s ★</span>
                      <span class="text-[var(--muted)]">TPS</span>
                      <span class="text-[var(--fg-2)]">56.0 t/s</span>
                    </div>
                    <div class="mt-1 grid grid-cols-2 gap-1 h-1.5">
                      <div class="flex justify-end overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class="h-full w-[88%] rounded-full bg-[var(--seg-cache)]" />
                      </div>
                      <div class="overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div class="h-full w-[51%] rounded-full bg-[var(--seg-input)] opacity-60" />
                      </div>
                    </div>
                  </div>
                </div>
                <div class="rounded-md bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--fg-2)]">
                  💬 {isZh ? '本机首字快 4.5x，吐字快 1.7x，碾压大盘' : 'Local TTFT 4.5× faster & 1.7× higher TPS'}
                </div>
              </div>
            </div>
          </article>

          {/* Card 6 (5 cols): Live First-Token Stopwatch */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-5">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-out)]">
                  {isZh ? '⏱ 实时首字监控 · 动态读秒' : '⏱ LIVE FIRST-TOKEN MONITOR'}
                </span>
                <TryButton
                  req={{ id: 'simulate-ttft', tab: 'live', action: 'simulate-ttft' }}
                  label={isZh ? '模拟等首字' : 'Sim TTFT'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '模型卡在等首字吗？实时读秒一眼看清' : 'Waiting for first token? Watch live TTFT tick in real time'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '请求发出瞬间就开始跳秒计时并动态生长延迟柱；越过本机均值自动由绿转琥珀、再转红提醒，同时对照全球大盘 P50 参考，首字到达立刻锁值并切入流式吐字。'
                  : 'Ticks live the moment a request starts with a growing latency bar and baseline marker — shifting green → amber → red past your session average alongside global P50 reference, then locking TTFT the instant streaming begins.'}
              </p>
            </div>

            <LiveTtftShowcase isZh={isZh} />
          </article>

          {/* ── Row 4: 16w/52w Iceberg Heatmap + 2x Wrapped Poster (6) + Official Sidecar Safety (6) ── */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-6">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)]">
                  {isZh ? '✨ 冰山热力图 · 2x 战报海报' : '✨ ICEBERG HEATMAP · 2X WRAPPED POSTER'}
                </span>
                <TryButton
                  req={{ id: 'wrapped', tab: 'account', action: 'wrapped' }}
                  label={isZh ? '打开海报弹窗' : 'Open Poster'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '16w/52w Token 冰山热力图 & 一键 2x 高清战报海报' : '16w/52w Token Iceberg & one-click 2x Wrapped share posters'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '合并 App + CLI + IDE 全年活跃数据，单色冰山图一眼看清每日新增 vs 缓存读取杠杆；纯前端 Canvas 一键导出暗夜 / 黑金 / 极简白 2x PNG 战报，支持一键「隐藏金额」。'
                  : 'Unifies App, CLI & IDE activity into a 16w/52w heatmap and Monochrome Token Iceberg (new vs cached), plus zero-dep 2x PNG Wrapped posters in 3 themes with a privacy $ toggle.'}
              </p>
            </div>

            <div
              class="relative overflow-hidden rounded-xl border border-white/10 p-3.5 text-white"
              style={{
                background:
                  'radial-gradient(circle at 18% 12%, rgba(52,211,153,0.24), transparent 55%), radial-gradient(circle at 86% 88%, rgba(245,196,81,0.18), transparent 52%), linear-gradient(155deg, #0b101b 0%, #131b2b 100%)',
              }}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[9.5px] font-bold tracking-wider text-emerald-300">
                  AGY-HUD // WRAPPED
                </span>
                <span class="rounded-full bg-emerald-400/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-emerald-200">
                  2x PNG · 52W
                </span>
              </div>
              <div class="mt-2 flex items-baseline justify-between gap-2">
                <div class="text-[14px] font-bold">
                  {isZh ? '👑 Ultra 算力霸主' : '👑 Ultra Compute Titan'}
                </div>
                <div class="font-mono text-[11px] font-semibold text-amber-300 tabular-nums">
                  {isZh ? '🔥 连肝 18 天' : '🔥 18d Streak'}
                </div>
              </div>
              <div class="mt-2.5 grid grid-cols-12 gap-[3px]">
                {posterHeat.map((lvl, idx) => (
                  <span
                    key={idx}
                    class="aspect-square rounded-[2px]"
                    style={{
                      backgroundColor:
                        lvl === 0
                          ? 'rgba(255,255,255,0.07)'
                          : lvl === 1
                            ? '#065f46'
                            : lvl === 2
                              ? '#059669'
                              : lvl === 3
                                ? '#10b981'
                                : '#34d399',
                    }}
                  />
                ))}
              </div>
              <div class="mt-2.5 flex items-center justify-between font-mono text-[9.5px] text-slate-300">
                <span>118M tok · Cache 89.2%</span>
                <span class="text-emerald-300">{isZh ? '暗夜 / 黑金 / 极简白' : 'Cyber · Gold · Light'}</span>
              </div>
            </div>
          </article>

          {/* Card 8 (6 cols): Pure Official Sidecar Safety Comparison */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-6">
            <div>
              <span class="font-mono text-[10.5px] font-semibold text-[var(--accent-ink)]">
                {isZh ? '🛡️ 纯官方 SIDECAR 安全边界' : '🛡️ OFFICIAL SIDECAR ARCHITECTURE'}
              </span>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '绝不改包、不开调试口，像原生自带一样安全' : 'Zero app patching, zero CDP, 1:1 native typography & themes'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '基于 Node.js 22.18+ 内置只读 node:sqlite（?mode=ro），零第三方 npm 运行时依赖，1:1 对齐官方 Google Sans Flex 字体与全部 16 套主题，并内置安全一键自升级。'
                  : 'Built on Node.js 22.18+ read-only node:sqlite (?mode=ro) with zero runtime npm deps, 1:1 Antigravity Hub typography, all 16 official themes, and atomic in-app self-updates.'}
              </p>
            </div>

            <div class="bento-well divide-y divide-[var(--border-subtle)] overflow-hidden text-[11.5px]">
              {[
                {
                  k: 'Electron / app.asar',
                  v: isZh ? '✓ 零修改，永不破坏签名与更新' : '✓ Untouched — survives every update',
                },
                {
                  k: isZh ? '调试端口 / 本地代理' : 'CDP / MITM Proxy',
                  v: isZh ? '✓ 零 --remote-debugging-port，零抓包' : '✓ No debug port, no network proxy',
                },
                {
                  k: isZh ? '运行时依赖与数据' : 'Runtime & Data',
                  v: isZh ? '✓ 零 npm 依赖 · 纯本地 SQLite 只读' : '✓ Zero npm deps · Read-only SQLite',
                },
                {
                  k: isZh ? '视觉融合与更新' : 'Native Craft & Updates',
                  v: isZh ? '✓ 16 套主题 · 强对比 · 一键安全自升级' : '✓ 16 themes · High contrast · Atomic updates',
                },
              ].map((row) => (
                <div key={row.k} class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="font-medium text-[var(--muted)]">{row.k}</span>
                  <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)] text-right">{row.v}</span>
                </div>
              ))}
            </div>
          </article>
        </div>

        {/* Built-in Power-User Capabilities Strip (Excavated Real Product Features) */}
        <div class="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-5 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="font-mono text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[var(--accent-ink)]">
                {isZh ? '更多已内置的实用细节' : 'MORE BUILT-IN TELEMETRY CRAFT'}
              </div>
              <h3 class="mt-1 text-[16px] font-semibold text-[var(--fg)]">
                {isZh ? '从单次排障到全年复盘，这些细节也已经全部做好' : 'Everyday engineering details already wired into the side pane'}
              </h3>
            </div>
            <span class="font-mono text-[11px] text-[var(--muted)]">
              {isZh ? '全部开箱即用 · 零额外配置' : 'Zero config · Ready out of the box'}
            </span>
          </div>

          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: '📋',
                title: isZh ? '5 维排序筛选 + 一键导出报告' : '5-Way Sort & 1-Click Report Export',
                desc: isZh
                  ? '调用日志支持按最慢、最高首字、最低 TPS、最高费用或仅看 /compact 筛选；一键复制 Markdown 诊断报告或下载完整 JSON 快照。'
                  : 'Sort calls by slowest, worst TTFT, lowest TPS, highest cost, or /compact-only — copy a Markdown report or export full JSON in one click.',
              },
              {
                icon: '🔀',
                title: isZh ? 'Orchestrator 双模型配比透视' : 'Per-Session Model Mix Breakdown',
                desc: isZh
                  ? '编排模式或中途切模型时自动展开模型配比表，分别列出每个模型的调用次数、均速、首字、缓存命中与 5h 配额占比。'
                  : 'Automatically splits multi-model & Orchestrator sessions by model — comparing calls, TPS, TTFT, cache hit %, cost, and 5h quota.',
              },
              {
                icon: '🖥️',
                title: isZh ? 'App + CLI + IDE 三端合并 & 远程消耗' : 'App · CLI · IDE + Remote Spend',
                desc: isZh
                  ? '自动聚合本机桌面端、agy CLI 与 IDE 全部会话数据库，并通过配额扣减差值识别跨设备远程消耗与 7d 周配额卡控。'
                  : 'Unifies Desktop App, agy CLI, and IDE databases locally while estimating cross-device remote spend and weekly-cap holds.',
              },
              {
                icon: '💓',
                title: isZh ? '吸顶微脉搏条 + 一键复制 JSONL' : 'Scroll PulseBar & Transcript Copy',
                desc: isZh
                  ? '翻看长日志时顶部自动滑出超薄脉搏条（速度/上下文/缓存年龄/花费）；顶栏一键复制会话 ID 与 transcript.jsonl 路径。'
                  : 'Slim scroll-aware PulseBar keeps TPS, context headroom, cache age, and spend pinned — plus 1-click session ID & JSONL path copy.',
              },
              {
                icon: '🗜️',
                title: isZh ? '全历史缩略图缩放 & /compact 复盘' : 'Minimap Zoom & /compact Replay',
                desc: isZh
                  ? '趋势图内置底部缩略图刷选与滚轮缩放，点任意散点直达调用详情；完整记录每次 /compact 压缩前后体积、耗时与摘要。'
                  : 'Brush-zoom full session history with a minimap, click any dot to jump to that call, and inspect before/after /compact checkpoints.',
              },
              {
                icon: '🔄',
                title: isZh ? '240px 极窄自适应 & 应用内原子升级' : '240px Narrow Rail & Atomic Updates',
                desc: isZh
                  ? '侧边栏拉到最窄 240px 依旧清晰不溢出；内置版本检测与一键原子热更新，失败自动回滚，无需重跑安装命令。'
                  : 'Reflows cleanly down to a 240px side rail with zero clipping, plus built-in release checks and atomic rollback-safe self-updates.',
              },
            ].map((item) => (
              <div key={item.title} class="bento-well flex flex-col gap-1.5 p-3">
                <div class="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--fg)]">
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.title}</span>
                </div>
                <p class="text-[12px] leading-[1.6] text-[var(--muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
