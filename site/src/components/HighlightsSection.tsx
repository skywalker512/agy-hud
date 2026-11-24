import type { Locale, SiteCopy } from '../i18n/content';
import type { DemoJumpRequest } from './LiveHudFrame';

interface HighlightsSectionProps {
  locale: Locale;
  copy: SiteCopy;
  onJumpDemo: (req: DemoJumpRequest) => void;
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

          {/* Card 6 (5 cols): Live TTFT Root-Cause Attribution */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-5">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-out)]">
                  {isZh ? '🎯 首字慢归因诊断' : '🎯 LIVE TTFT ATTRIBUTION'}
                </span>
                <TryButton
                  req={{ id: 'live', tab: 'live', action: 'live-top' }}
                  label={isZh ? '看实时面板' : 'Open Live'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '到底是大盘崩了，还是我账号/网络慢？' : 'Upstream outage, large context, or your own account?'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '联合全网 30m 大盘、Google Cloud 状态、按上下文分桶的本机基线与并发数，自动给出精准归因结论。'
                  : 'Combines global 30m pulse, GCP status, context-bucketed local baselines, and live concurrency into an instant verdict.'}
              </p>
            </div>

            <div class="grid grid-cols-2 gap-2">
              {[
                {
                  dot: 'bg-[var(--seg-out)]',
                  bg: 'bg-[var(--tint-out)] border-[var(--tint-out-border)] text-[var(--seg-out)]',
                  pill: isZh ? '大盘偏慢 · 6.4s' : 'Upstream · 6.4s',
                  desc: isZh ? '全网节点一起波动' : 'Global Gemini elevated',
                },
                {
                  dot: 'bg-[var(--seg-input)]',
                  bg: 'bg-[var(--tint-accent)] border-[var(--tint-accent-border)] text-[var(--accent-ink)]',
                  pill: isZh ? '冷预填充 / 大上下文' : 'Cold / Large ctx',
                  desc: isZh ? '缓存失效或超长输入' : 'Uncached or >150k prompt',
                },
                {
                  dot: 'bg-[var(--seg-think)]',
                  bg: 'bg-[var(--tint-think)] border-[var(--tint-think-border)] text-[var(--seg-think)]',
                  pill: isZh ? '3 路并发排队' : '3× parallel',
                  desc: isZh ? '多会话/Worker 争抢' : 'Multi-agent queueing',
                },
                {
                  dot: 'bg-[var(--seg-bad)]',
                  bg: 'bg-[var(--tint-bad)] border-[var(--tint-bad-border)] text-[var(--seg-bad)]',
                  pill: isZh ? '仅本地慢' : 'Local slow',
                  desc: isZh ? '大盘健康·疑似限速/代理' : 'Global ok · account/proxy',
                },
              ].map((v) => (
                <div key={v.pill} class="bento-well flex flex-col gap-1.5 p-2.5">
                  <span class={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${v.bg}`}>
                    <span class={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
                    <span>{v.pill}</span>
                  </span>
                  <span class="text-[11px] text-[var(--muted)]">{v.desc}</span>
                </div>
              ))}
            </div>
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
      </div>
    </section>
  );
}
