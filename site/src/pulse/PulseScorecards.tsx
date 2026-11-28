import { GEMINI_SPECS, type PulseModelData } from './pulseApi';
import { fmtPrice, makePlaceholderPulseModel, type PulseInsights } from './pulseInsights';

export function PulseScorecards({
  models,
  selectedFamilies,
  isZh,
  onSelectModel,
}: {
  models: PulseModelData[];
  selectedFamilies: string[];
  isZh: boolean;
  onSelectModel: (family: string) => void;
}) {
  const items = models.length ? models : GEMINI_SPECS.map(makePlaceholderPulseModel);

  return (
    <section class="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((m) => {
        const isSel = selectedFamilies.includes(m.family);
        return (
          <button
            key={m.family}
            type="button"
            onClick={() => onSelectModel(m.family)}
            class={`flex cursor-pointer flex-col justify-between rounded-2xl border p-3.5 text-left transition-all ${
              isSel
                ? 'bg-[var(--surface)] shadow-sm'
                : 'border-[var(--border)] bg-[var(--surface)]/55 opacity-70 hover:opacity-100'
            }`}
            style={isSel ? { borderColor: `${m.color}88` } : undefined}
          >
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-2 text-[13px] font-semibold text-[var(--fg)]">
                  <span class="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: m.color }} />
                  <span class="truncate">{m.shortLabel}</span>
                </span>
                <span
                  class={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    m.status === 'outage'
                      ? 'bg-red-500/15 text-red-400'
                      : m.status === 'degraded'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-400'
                  }`}
                >
                  {m.uptime30mPct !== null ? `${m.uptime30mPct.toFixed(1)}%` : m.status.toUpperCase()}
                </span>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 tabular-nums">
                <div>
                  <div class="text-[10px] text-[var(--faint)]">TTFT P50</div>
                  <div class="font-mono text-[14px] font-bold text-[var(--fg)]">
                    {m.p50TtftSec !== null ? `${m.p50TtftSec.toFixed(m.p50TtftSec >= 10 ? 1 : 2)}s` : '--'}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] text-[var(--faint)]">{isZh ? '生成速度' : 'Speed'}</div>
                  <div class="font-mono text-[14px] font-bold text-[var(--fg)]">
                    {m.p50Tps !== null ? `${Math.round(m.p50Tps)} t/s` : '--'}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] text-[var(--faint)]">{isZh ? 'E2E 总耗' : 'E2E Lat'}</div>
                  <div class="font-mono text-[12px] font-semibold text-[var(--fg-2)]">
                    {m.e2eLatestSec !== null ? `${m.e2eLatestSec.toFixed(1)}s` : '--'}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] text-[var(--faint)]">{isZh ? '缓存命中' : 'Cache Hit'}</div>
                  <div class="font-mono text-[12px] font-semibold text-[var(--seg-cache)]">
                    {m.cacheHitPct !== null ? `${Math.round(m.cacheHitPct)}%` : '--'}
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center justify-between gap-1 border-t border-[var(--border)] pt-2 font-mono text-[10px] text-[var(--muted)]">
              {m.p99TtftSec !== null ? (
                <span>P99 {m.p99TtftSec.toFixed(1)}s</span>
              ) : (
                <span>5m {m.uptime5mPct !== null ? `${m.uptime5mPct.toFixed(0)}%` : '--'}</span>
              )}
              {m.avgPromptTokens !== null ? (
                <span title={isZh ? 'OpenRouter 全球日均输入上下文大小' : 'OpenRouter global average prompt context size'}>
                  {isZh ? '均' : 'ctx'} {Math.round(m.avgPromptTokens / 1000)}k
                </span>
              ) : null}
              {m.toolCallErrorPct !== null ? (
                <span class={m.toolCallErrorPct >= 3 ? 'text-amber-400' : ''}>
                  Err {m.toolCallErrorPct}%
                </span>
              ) : (
                <span>1d {m.uptime1dPct !== null ? `${m.uptime1dPct.toFixed(1)}%` : '--'}</span>
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}

export function PulseInsightsStrip({
  insights,
  isZh,
}: {
  insights: PulseInsights;
  isZh: boolean;
}) {
  return (
    <section class="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div class="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[var(--seg-cache)]">
          {isZh ? '⚡ 当前速度标杆' : '⚡ SPEED LEADERS NOW'}
        </div>
        <div class="mt-2 flex flex-col gap-1.5 text-[12.5px]">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-[var(--muted)]">{isZh ? '首字最快' : 'Fastest TTFT'}</span>
            <span class="font-mono font-bold text-[var(--fg)] tabular-nums">
              {insights.fastestTtft
                ? `${insights.fastestTtft.shortLabel} · ${insights.fastestTtft.p50TtftSec?.toFixed(2)}s`
                : '--'}
            </span>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-[var(--muted)]">{isZh ? '吐字最快' : 'Highest TPS'}</span>
            <span class="font-mono font-bold text-[var(--fg)] tabular-nums">
              {insights.fastestTps
                ? `${insights.fastestTps.shortLabel} · ${Math.round(insights.fastestTps.p50Tps || 0)} t/s`
                : '--'}
            </span>
          </div>
        </div>
        {insights.trendTarget && insights.ttftTrendPct !== null && (
          <div class="mt-2.5 border-t border-[var(--border)] pt-2 font-mono text-[10.5px] text-[var(--muted)] tabular-nums">
            {insights.trendTarget.shortLabel} 5m TTFT{' '}
            <span
              class={
                insights.ttftTrendPct > 12
                  ? 'font-semibold text-amber-400'
                  : insights.ttftTrendPct < -10
                    ? 'font-semibold text-emerald-400'
                    : 'text-[var(--fg-2)]'
              }
            >
              {insights.ttftTrendPct >= 0 ? '+' : ''}
              {insights.ttftTrendPct.toFixed(0)}%
            </span>{' '}
            {isZh ? '对比近 2h 均值' : 'vs 2h avg'}
          </div>
        )}
      </div>

      <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div class="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
          {isZh ? '💰 全网缓存真实省钱' : '💰 REAL CACHE SAVINGS'}
        </div>
        {insights.bestDiscount ? (
          <>
            <div class="mt-2 flex items-baseline justify-between gap-2">
              <span class="text-[13px] font-semibold text-[var(--fg)]">
                {insights.bestDiscount.model.shortLabel}
              </span>
              <span class="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-400 tabular-nums">
                -{Math.round(insights.bestDiscount.savePct)}%
              </span>
            </div>
            <div class="mt-1 font-mono text-[12px] text-[var(--fg-2)] tabular-nums">
              {fmtPrice(insights.bestDiscount.listIn)} →{' '}
              <span class="font-bold text-[var(--seg-cache)]">{fmtPrice(insights.bestDiscount.effIn)}</span> / 1M in
            </div>
            <div class="mt-2.5 border-t border-[var(--border)] pt-2 font-mono text-[10.5px] text-[var(--muted)] tabular-nums">
              {isZh
                ? `全网缓存命中 ${Math.round(insights.bestDiscount.model.cacheHitPct || 0)}% 折后实付价`
                : `Effective input price at ${Math.round(insights.bestDiscount.model.cacheHitPct || 0)}% cache hit`}
            </div>
          </>
        ) : (
          <p class="mt-2 text-[12px] text-[var(--muted)]">
            {isZh ? '接入 Worker 采集源后展示缓存折后实付价' : 'Available with Worker feed'}
          </p>
        )}
      </div>

      <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div class="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-amber-400">
          {isZh ? '⚠️ 稳定性 & Agent 风险' : '⚠️ TAIL & AGENT RISKS'}
        </div>
        <div class="mt-2 flex flex-col gap-1.5 text-[12px] tabular-nums">
          {insights.lowestUp1d && (
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[var(--muted)]">{isZh ? '24h 最低可用率' : 'Lowest 1d Up'}</span>
              <span
                class={`font-mono font-semibold ${
                  (insights.lowestUp1d.uptime1dPct ?? 100) < 97 ? 'text-amber-400' : 'text-[var(--fg)]'
                }`}
              >
                {insights.lowestUp1d.shortLabel} · {insights.lowestUp1d.uptime1dPct?.toFixed(1)}%
              </span>
            </div>
          )}
          {insights.highestToolErr && (
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[var(--muted)]">{isZh ? 'Tool 最高报错' : 'Peak Tool Err'}</span>
              <span
                class={`font-mono font-semibold ${
                  (insights.highestToolErr.toolCallErrorPct ?? 0) >= 3 ? 'text-amber-400' : 'text-[var(--fg)]'
                }`}
              >
                {insights.highestToolErr.shortLabel} · {insights.highestToolErr.toolCallErrorPct}%
              </span>
            </div>
          )}
        </div>
        {insights.worstTail && (
          <div class="mt-2.5 border-t border-[var(--border)] pt-2 font-mono text-[10.5px] text-[var(--muted)] tabular-nums">
            {isZh ? '最陡长尾：' : 'Steepest tail: '}
            <span class="font-semibold text-[var(--fg-2)]">
              {insights.worstTail.model.shortLabel} P99 {insights.worstTail.model.p99TtftSec?.toFixed(0)}s (
              {insights.worstTail.ratio.toFixed(0)}×)
            </span>
          </div>
        )}
      </div>

      <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div class="font-mono text-[10.5px] font-semibold uppercase tracking-wide text-[var(--seg-think)]">
          {isZh ? '🧠 全网流量 & 思考画像' : '🧠 TRAFFIC & WORKLOAD'}
        </div>
        <div class="mt-2 flex items-baseline justify-between gap-2 tabular-nums">
          <span class="font-mono text-[18px] font-bold text-[var(--fg)]">
            {insights.totalReq30m > 0 ? `${Math.round(insights.totalReq30m / 1000)}K` : '--'}
          </span>
          <span class="font-mono text-[11px] text-[var(--muted)]">
            {insights.totalReq30m > 0
              ? `${(insights.totalReq30m / 30_000).toFixed(1)}K req/min`
              : isZh ? '近 30 分钟请求' : '30m requests'}
          </span>
        </div>
        <div class="mt-1 font-mono text-[11px] text-[var(--fg-2)] tabular-nums">
          {insights.topReasoning
            ? isZh
              ? `思考最重：${insights.topReasoning.shortLabel} (${Math.round(insights.topReasoning.reasoningSharePct || 0)}%)`
              : `Top thinking: ${insights.topReasoning.shortLabel} (${Math.round(insights.topReasoning.reasoningSharePct || 0)}%)`
            : '--'}
        </div>
        <div class="mt-2.5 border-t border-[var(--border)] pt-2 font-mono text-[10.5px] text-[var(--muted)] tabular-nums">
          {insights.topContext
            ? isZh
              ? `最大平均上下文：${insights.topContext.shortLabel} · ${Math.round((insights.topContext.avgPromptTokens || 0) / 1000)}K`
              : `Largest avg ctx: ${insights.topContext.shortLabel} · ${Math.round((insights.topContext.avgPromptTokens || 0) / 1000)}K`
            : '--'}
        </div>
      </div>
    </section>
  );
}
