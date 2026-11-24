import type { Locale, SiteCopy } from '../i18n/content';
import type { DemoJumpRequest } from './LiveHudFrame';

interface HighlightsSectionProps {
  locale: Locale;
  copy: SiteCopy;
  onJumpDemo: (req: DemoJumpRequest) => void;
}

export function HighlightsSection({ locale, copy, onJumpDemo }: HighlightsSectionProps) {
  const isZh = locale === 'zh';

  // Mini heatmap intensity grid for Wrapped Poster preview (7x12)
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

        {/* 6-Card Interactive Visual Bento Wall */}
        <div class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* Card 1 (7 cols): Global Gemini 7d/24h Curves + Cyber Cricket Arena PK */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-7">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-input)]">
                  {isZh ? '🌐 全球大盘折线 · ⚔ 赛博斗蛐蛐' : '🌐 GLOBAL CURVES · ⚔ CYBER ARENA PK'}
                </span>
                <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                  {isZh ? 'OpenRouter 7 天折线、24h 可用率 & 多模型同图 PK' : 'OpenRouter 7d/24h Gemini curves & head-to-head Arena PK'}
                </h3>
                <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {isZh
                    ? '在 Calls 趋势图一键切到「🌐 大盘折线」对比 5 个 Gemini 模型及 Vertex / AI Studio 节点曲线；在 Account 打开「⚔ 赛博斗蛐蛐」，按 30m/24h/7d 同口径拿本机实测与全球大盘正面硬刚。'
                    : 'Switch Calls Trend directly to Global 7d/24h curves across all Gemini models (and split Vertex vs AI Studio). Open Cyber Arena PK in Account to duel your local 30m/24h/7d speed against the global pool.'}
                </p>
              </div>
              <div class="flex items-center gap-1.5">
                <TryButton
                  req={{ id: 'global-trend', tab: 'calls', action: 'global-trend' }}
                  label={isZh ? '看大盘折线' : '7d Curves'}
                />
                <TryButton
                  req={{ id: 'arena', tab: 'account', action: 'arena' }}
                  label={isZh ? '斗蛐蛐 PK' : 'Arena PK'}
                />
              </div>
            </div>

            {/* Dual visual preview: Mini 7d Curves + Mini Red/Blue PK Duel */}
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="bento-well p-3">
                <div class="flex items-center justify-between text-[10px] font-mono text-[var(--muted)]">
                  <span>{isZh ? 'TTFT 7d + 近30m' : 'TTFT 7d + Live 30m'}</span>
                  <span class="text-[var(--seg-cache)]">Hydro 1.52s</span>
                </div>
                <svg viewBox="0 0 220 74" class="mt-2 block h-[72px] w-full overflow-visible" aria-hidden="true">
                  <line x1="0" y1="18" x2="220" y2="18" stroke="var(--border)" stroke-dasharray="2 3" />
                  <line x1="0" y1="44" x2="220" y2="44" stroke="var(--border)" stroke-dasharray="2 3" />
                  <line x1="0" y1="68" x2="220" y2="68" stroke="var(--border)" />
                  {/* Carbon (slow) */}
                  <path d="M4,24 C40,28 74,14 110,20 C146,26 180,10 214,15" fill="none" stroke="var(--seg-out)" stroke-width="1.8" stroke-linecap="round" />
                  {/* Neon (mid) */}
                  <path d="M4,42 C40,38 74,35 110,40 C146,34 180,37 214,35" fill="none" stroke="var(--seg-input)" stroke-width="1.8" stroke-linecap="round" />
                  {/* Hydrogen (fast) */}
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
                  <span class="font-bold text-[var(--seg-cache)]">{isZh ? '本机 Carbon · 96分' : 'Mine Carbon · 96'}</span>
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

          {/* Card 2 (5 cols): Live TTFT Root-Cause Attribution */}
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
                {isZh ? '到底是大盘崩了，还是我账号/网络慢？' : 'Upstream outage, cold prefill, or your own account?'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '联合 OpenRouter 30m 大盘、Google Cloud 状态、本机 7 天命中/冷启动分桶基线与并发数，直接给出 4 类精准结论。'
                  : 'Combines OpenRouter 30m pulse, GCP status, stratified local cache-hit vs cold baselines, and live concurrency into an instant verdict.'}
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
                  pill: isZh ? '冷预填充 92k' : 'Cold prefill 92k',
                  desc: isZh ? '缓存失效触发重算' : 'Uncached large prompt',
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

          {/* Card 3 (5 cols): 2x PNG Wrapped Share Poster */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-5">
            <div>
              <div class="flex items-start justify-between gap-2">
                <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)]">
                  {isZh ? '✨ 活跃趋势 & 分享战报' : '✨ WRAPPED 2X PNG POSTER'}
                </span>
                <TryButton
                  req={{ id: 'wrapped', tab: 'account', action: 'wrapped' }}
                  label={isZh ? '打开海报弹窗' : 'Open Poster'}
                />
              </div>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '一键生成 2x 高清社交战报海报' : 'One-click 2x Retina Wrapped share posters'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '自动解锁段位称号、连肝记录与巅峰单日；纯前端 Canvas 渲染暗夜霓虹 / 黑金 Ultra / 极简白 3 套海报，支持一键「隐藏金额」与复制 PNG。'
                  : 'Auto-unlocks persona badges, streaks, and peak days. Zero-dependency Canvas 2D renders Cyber Dark, Obsidian Gold, or Minimal Light posters with a privacy $ toggle.'}
              </p>
            </div>

            {/* Stylized mini Wrapped Poster card preview */}
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
              {/* Mini 6x12 glowing heatmap preview */}
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

          {/* Card 4 (7 cols): Calibrated Ultra 20x Quota Runway + Recursive Swarm Rollup */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-7">
            <div>
              <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-think)]">
                {isZh ? '⚡ 配额自校准 · 🐝 SWARM 递归归账' : '⚡ IRLS QUOTA RUNWAY · 🐝 RECURSIVE SWARM ROLLUP'}
              </span>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '抗并发污染的 5h/7d 配额续航，与主会话 + 全量 Swarm 合并统计' : 'Multi-agent-hardened 5h/7d runway + full Swarm session tree rollup'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '对数空间 IRLS 与并发 Regime 守卫精准校准 Pro / Ultra 20x（$600/5h · $2.4k/7d）额度；「本会话」自动递归合并主对话、Swarm Workers、子 Agent 与 Side-Q 的真实总花费、输出与配额。'
                  : 'Log-space IRLS with concurrency guards calibrates Pro & Ultra 20x pools; “This Session” recursively rolls up root chat, Swarm workers, nested subagents, and Side-Q spend & quota.'}
              </p>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Hatched Runway Mini Visual */}
              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div class="flex items-baseline justify-between font-mono text-[10.5px] tabular-nums">
                  <span class="font-semibold text-[var(--fg)]">Gemini Pool · 5h</span>
                  <span class="font-bold text-[var(--seg-cache)]">68.4% left</span>
                </div>
                <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div class="absolute inset-y-0 left-0 w-[68.4%] rounded-full bg-[var(--seg-cache)]" />
                  <div class="hatched-runway absolute inset-y-0 left-[44%] w-[24.4%] rounded-r-full" />
                </div>
                <div class="flex items-center justify-between font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                  <span>{isZh ? '预计重置时剩 44%' : 'Projected 44% at reset'}</span>
                  <span>Ultra 20x</span>
                </div>
              </div>

              {/* Recursive Session Tree Rollup Visual */}
              <div class="bento-well flex flex-col justify-between gap-2 p-3">
                <div class="flex items-baseline justify-between font-mono text-[10.5px] tabular-nums">
                  <span class="font-semibold text-[var(--fg)]">
                    {isZh ? '本会话总计 · +4 子' : 'Session Total · +4 sub'}
                  </span>
                  <span class="font-bold text-[var(--fg)]">$12.20</span>
                </div>
                <div class="flex flex-wrap items-center gap-1 font-mono text-[9.5px]">
                  <span class="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[var(--fg-2)]">
                    {isZh ? '主会话 $2.40' : 'Main $2.40'}
                  </span>
                  <span class="text-[var(--faint)]">+</span>
                  <span class="rounded bg-[var(--tint-think)] px-1.5 py-0.5 text-[var(--seg-think)]">
                    {isZh ? '4 Swarm/子会话 $9.80' : '4 Workers $9.80'}
                  </span>
                </div>
                <div class="font-mono text-[9.5px] text-[var(--seg-cache)]">
                  {isZh ? '缓存累计省 $38.60 · 防环递归统计' : 'Saved $38.60 via cache · cycle-safe'}
                </div>
              </div>
            </div>
          </article>

          {/* Card 5 (6 cols): Cache TTL Survival Curve + Context X-Ray */}
          <article class="bento-card flex flex-col justify-between gap-4 p-5 sm:p-6 md:col-span-6">
            <div>
              <span class="font-mono text-[10.5px] font-semibold text-[var(--seg-cache)]">
                {isZh ? '🧊 缓存 TTL 存活曲线 · 🔍 上下文 X-RAY' : '🧊 CACHE TTL SURVIVAL · 🔍 CONTEXT X-RAY'}
              </span>
              <h3 class="display-heading mt-1 text-[19px] font-semibold text-[var(--fg)]">
                {isZh ? '掉缓存前提前预警，展开每个工具的上下文账单' : 'Stay ahead of cache expiry & inspect every context token'}
              </h3>
              <p class="mt-1.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {isZh
                  ? '用对数逻辑斯蒂模型拟合本机 Gemini / Claude 真实缓存衰减，提醒你晾多久会触发重算；双列 X-Ray 拆解 System、MCP Tools、Skills、Rules 与工具输出。'
                  : 'Fits your real local Gemini LRU / Claude 5m cache survival curve so you know before a pause causes a re-prefill, paired with a full breakdown of MCP tools, Skills, and tool outputs.'}
              </p>
            </div>

            <div class="bento-well flex flex-col gap-2.5 p-3">
              {/* Context Segmented Bar */}
              <div>
                <div class="flex items-center justify-between font-mono text-[10px] tabular-nums">
                  <span class="text-[var(--muted)]">{isZh ? '上下文窗口' : 'Context Window'}</span>
                  <span class="font-semibold text-[var(--fg)]">114.6K / 256K · 45%</span>
                </div>
                <div class="mt-1.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div class="h-full w-[8%] rounded-l-full bg-[var(--seg-think)]" />
                  <div class="h-full w-[10%] bg-[var(--seg-input)]" />
                  <div class="h-full w-[19%] bg-[var(--seg-out)]" />
                  <div class="h-full w-[8%] rounded-r-full bg-[var(--seg-cache)]" />
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] text-[var(--muted)]">
                <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-think)]" />System/Skills</span>
                <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-input)]" />MCP Tools</span>
                <span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-out)]" />Tool Results</span>
                <span class="text-[var(--seg-cache)] font-semibold">{isZh ? '缓存存活 P50 ~8m' : 'Cache P50 ~8m'}</span>
              </div>
            </div>
          </article>

          {/* Card 6 (6 cols): Pure Official Sidecar Safety Comparison */}
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
                  ? '基于 Node.js 22.18+ 内置 node:sqlite（?mode=ro 只读），严格运行在 Antigravity 官方插件侧边栏内，并 1:1 对齐官方 Google Sans Flex 字体与 16 套主题。'
                  : 'Built on Node.js 22.18+ built-in read-only node:sqlite (?mode=ro) with zero runtime npm deps, 1:1 Antigravity Hub typography, and 16-theme live sync.'}
              </p>
            </div>

            <div class="bento-well divide-y divide-[var(--border-subtle)] overflow-hidden text-[11.5px]">
              {[
                {
                  k: isZh ? 'Electron / app.asar' : 'Electron / app.asar',
                  v: isZh ? '✓ 零修改，永不破坏签名与更新' : '✓ Untouched — survives every update',
                },
                {
                  k: isZh ? '调试端口 / 本地代理' : 'CDP / MITM Proxy',
                  v: isZh ? '✓ 零 --remote-debugging-port，零抓包' : '✓ No debug port, no network proxy',
                },
                {
                  k: isZh ? '运行时依赖与隐私' : 'Runtime & Privacy',
                  v: isZh ? '✓ 零 npm 依赖 · 大盘可一键切纯离线' : '✓ Zero deps · 1-click offline toggle',
                },
                {
                  k: isZh ? '视觉融合度' : 'Native Craft',
                  v: isZh ? '✓ 16 套主题 · 强对比 · 官方字体 1:1' : '✓ 16 themes · High contrast · Hub fonts',
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
