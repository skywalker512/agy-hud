import { GEMINI_SPECS, type PulseModelData } from './pulseApi';
import { fmtPrice, fmtTokens, type PulseInsights } from './pulseInsights';

export function PulseTelemetryMatrix({
  models,
  insights,
  routeModelFamily,
  isZh,
  onSelectRouteModel,
}: {
  models: PulseModelData[];
  insights: PulseInsights | null;
  routeModelFamily: string;
  isZh: boolean;
  onSelectRouteModel: (family: string) => void;
}) {
  if (!models.length) return null;

  return (
    <section class="mb-7 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="text-[15px] font-semibold text-[var(--fg)]">
            {isZh ? '全模型深度指标与 Agent 负载矩阵' : 'Full-Model Deep Telemetry & Agent Workload Matrix'}
          </h2>
          <p class="mt-0.5 text-[12px] text-[var(--muted)]">
            {isZh
              ? '完整展开 P50–P99 长尾延迟阶梯、平均上下文、思考占比、24h Tool Call 报错率、缓存折后实付输入价与 30m 流量占比。'
              : 'Full P50–P99 latency ladder, average prompt/output context, reasoning share, 24h Tool Call error rate, effective post-cache input cost, and 30m traffic share.'}
          </p>
        </div>
        {insights && insights.totalToolCalls24h > 0 && (
          <span class="font-mono text-[11px] text-[var(--muted)] tabular-nums">
            {isZh
              ? `24h 合计 ${(insights.totalToolCalls24h / 1_000_000).toFixed(2)}M 次 Tool Call`
              : `${(insights.totalToolCalls24h / 1_000_000).toFixed(2)}M Tool Calls / 24h`}
          </span>
        )}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-[12px] tabular-nums">
          <thead>
            <tr class="border-b border-[var(--border)] text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint)]">
              <th class="py-2 pr-3">{isZh ? '模型' : 'Model'}</th>
              <th class="py-2 pr-3">TTFT P50 / P75 / P90 / P95 / P99</th>
              <th class="py-2 pr-3">{isZh ? '吞吐 P50/P90' : 'TPS P50/P90'}</th>
              <th class="py-2 pr-3">{isZh ? '均上下文 (In/Out)' : 'Avg Ctx (In/Out)'}</th>
              <th class="py-2 pr-3">{isZh ? '思考占比' : 'Reasoning'}</th>
              <th class="py-2 pr-3">{isZh ? 'Tool 报错 (24h)' : 'Tool Err (24h)'}</th>
              <th class="py-2 pr-3">{isZh ? '折后输入价' : 'Eff. In /1M'}</th>
              <th class="py-2 pr-2">{isZh ? '30m 流量' : '30m Traffic'}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const totalReq = insights?.totalReq30m || 0;
              const reqShare = totalReq > 0 && m.requestCount30m > 0 ? (m.requestCount30m / totalReq) * 100 : 0;
              const tailMult = m.p50TtftSec && m.p99TtftSec ? m.p99TtftSec / m.p50TtftSec : null;
              const isRouteSel = routeModelFamily === m.family;
              return (
                <tr
                  key={m.family}
                  onClick={() => onSelectRouteModel(m.family)}
                  class={`cursor-pointer border-b border-[var(--border)]/60 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]/60 ${
                    isRouteSel ? 'bg-[var(--surface-2)]/40' : ''
                  }`}
                >
                  <td class="py-2.5 pr-3 font-semibold text-[var(--fg)] whitespace-nowrap">
                    <span class="inline-flex items-center gap-2">
                      <span class="h-2 w-2 rounded-full shrink-0" style={{ background: m.color }} />
                      <span>{m.shortLabel}</span>
                    </span>
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap">
                    <span class="font-semibold text-[var(--fg)]">
                      {m.p50TtftSec !== null ? `${m.p50TtftSec.toFixed(1)}s` : '--'}
                    </span>
                    <span class="text-[var(--faint)]"> / </span>
                    <span class="text-[var(--fg-2)]">
                      {m.p75TtftSec !== null ? `${m.p75TtftSec.toFixed(1)}s` : '--'}
                    </span>
                    <span class="text-[var(--faint)]"> / </span>
                    <span class="text-[var(--fg-2)]">
                      {m.p90TtftSec !== null ? `${m.p90TtftSec.toFixed(1)}s` : '--'}
                    </span>
                    <span class="text-[var(--faint)]"> / </span>
                    <span class="text-[var(--muted)]">
                      {m.p95TtftSec !== null ? `${m.p95TtftSec.toFixed(1)}s` : '--'}
                    </span>
                    <span class="text-[var(--faint)]"> / </span>
                    <span class={tailMult && tailMult >= 12 ? 'font-semibold text-amber-400' : 'text-[var(--muted)]'}>
                      {m.p99TtftSec !== null ? `${m.p99TtftSec.toFixed(0)}s` : '--'}
                    </span>
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap">
                    <span class="font-semibold text-[var(--fg)]">
                      {m.p50Tps !== null ? Math.round(m.p50Tps) : '--'}
                    </span>
                    <span class="text-[var(--faint)]"> / </span>
                    <span class="text-[var(--muted)]">
                      {m.p90Tps !== null ? `${Math.round(m.p90Tps)} t/s` : '--'}
                    </span>
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap text-[var(--fg-2)]">
                    {m.avgPromptTokens !== null ? `${Math.round(m.avgPromptTokens / 1000)}K` : '--'}
                    <span class="text-[var(--faint)]"> / </span>
                    <span class="text-[var(--muted)]">
                      {m.avgOutputTokens !== null ? `${(m.avgOutputTokens / 1000).toFixed(1)}K` : '--'}
                    </span>
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap">
                    {m.reasoningSharePct !== null ? (
                      <div class="flex items-center gap-1.5">
                        <div class="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div
                            class="h-full rounded-full bg-[var(--seg-think)]"
                            style={{ width: `${Math.min(100, m.reasoningSharePct)}%` }}
                          />
                        </div>
                        <span class="text-[var(--fg-2)]">{Math.round(m.reasoningSharePct)}%</span>
                      </div>
                    ) : (
                      <span class="text-[var(--muted)]">--</span>
                    )}
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap">
                    {m.toolCallErrorPct !== null ? (
                      <span class={m.toolCallErrorPct >= 3 ? 'font-semibold text-amber-400' : 'text-[var(--fg-2)]'}>
                        {m.toolCallErrorPct}%
                        {m.toolCalls24h > 0 && (
                          <span class="ml-1 text-[10.5px] font-normal text-[var(--faint)]">
                            ({m.toolCalls24h >= 1_000_000
                              ? `${(m.toolCalls24h / 1_000_000).toFixed(1)}M`
                              : `${Math.round(m.toolCalls24h / 1000)}K`})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span class="text-[var(--muted)]">--</span>
                    )}
                  </td>
                  <td class="py-2.5 pr-3 font-mono whitespace-nowrap">
                    <span class="font-semibold text-[var(--seg-cache)]">{fmtPrice(m.effectiveInputPrice)}</span>
                    {m.cacheHitPct !== null && (
                      <span class="ml-1 text-[10.5px] text-[var(--faint)]">({Math.round(m.cacheHitPct)}%)</span>
                    )}
                  </td>
                  <td class="py-2.5 pr-2 font-mono whitespace-nowrap">
                    {m.requestCount30m > 0 ? (
                      <div class="flex items-center gap-1.5">
                        <div class="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div
                            class="h-full rounded-full"
                            style={{ width: `${Math.max(4, reqShare)}%`, background: m.color }}
                          />
                        </div>
                        <span class="text-[var(--fg-2)]">{Math.round(m.requestCount30m / 1000)}K</span>
                      </div>
                    ) : (
                      <span class="text-[var(--muted)]">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PulseRoutesTable({
  activeRouteModel,
  routeModelFamily,
  loading,
  isZh,
  onSelectRouteModel,
}: {
  activeRouteModel: PulseModelData | null;
  routeModelFamily: string;
  loading: boolean;
  isZh: boolean;
  onSelectRouteModel: (family: string) => void;
}) {
  return (
    <section class="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-[15px] font-semibold text-[var(--fg)]">
            {isZh ? 'Google Vertex vs AI Studio 实时线路与定价' : 'Google Vertex vs AI Studio Live Routes & Pricing'}
          </h2>
          <p class="mt-0.5 text-[12px] text-[var(--muted)]">
            {isZh
              ? '直接读取 OpenRouter `/endpoints` 公开接口，覆盖 Standard / Flex / Priority 线路的 5m / 30m / 1d 可用率与每百万 Token 标价。'
              : 'Direct from OpenRouter `/endpoints` API — live 5m / 30m / 1d uptime and per-1M-token pricing across Standard, Flex & Priority tiers.'}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          {GEMINI_SPECS.map((s) => (
            <button
              key={s.family}
              type="button"
              onClick={() => onSelectRouteModel(s.family)}
              class={`cursor-pointer rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                routeModelFamily === s.family
                  ? 'border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              {s.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-[12.5px] tabular-nums">
          <thead>
            <tr class="border-b border-[var(--border)] text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">
              <th class="py-2 pr-4">{isZh ? '上游渠道' : 'Provider'}</th>
              <th class="py-2 pr-4">{isZh ? '线路分级' : 'Tier'}</th>
              <th class="py-2 pr-4">5m</th>
              <th class="py-2 pr-4">30m</th>
              <th class="py-2 pr-4">1d</th>
              <th class="py-2 pr-4">{isZh ? '上下文' : 'Context'}</th>
              <th class="py-2 pr-4">{isZh ? '输入 / 缓存 / 输出 (1M)' : 'In / Cache / Out (1M)'}</th>
            </tr>
          </thead>
          <tbody>
            {(activeRouteModel?.routes || []).length === 0 ? (
              <tr>
                <td colSpan={7} class="py-6 text-center text-[var(--muted)]">
                  {loading ? (isZh ? '正在拉取线路详情…' : 'Loading route matrix…') : isZh ? '暂无线路数据' : 'No route data'}
                </td>
              </tr>
            ) : (
              (activeRouteModel?.routes || []).map((r, i) => (
                <tr key={`${r.tag}-${i}`} class="border-b border-[var(--border)]/60 last:border-b-0">
                  <td class="py-2.5 pr-4 font-medium text-[var(--fg)]">
                    <div class="flex items-center gap-2">
                      <span
                        class="h-2 w-2 rounded-full"
                        style={{ background: r.status < 0 || (r.uptime30m !== null && r.uptime30m < 95) ? '#f59e0b' : '#34d399' }}
                      />
                      <span>{r.providerName}</span>
                    </div>
                  </td>
                  <td class="py-2.5 pr-4 font-mono text-[11.5px] text-[var(--muted)]">{r.serviceTier}</td>
                  <td class="py-2.5 pr-4 font-mono">{r.uptime5m !== null ? `${r.uptime5m.toFixed(1)}%` : '--'}</td>
                  <td class="py-2.5 pr-4 font-mono font-semibold text-[var(--fg)]">
                    {r.uptime30m !== null ? `${r.uptime30m.toFixed(1)}%` : '--'}
                  </td>
                  <td class="py-2.5 pr-4 font-mono text-[var(--muted)]">
                    {r.uptime1d !== null ? `${r.uptime1d.toFixed(1)}%` : '--'}
                  </td>
                  <td class="py-2.5 pr-4 font-mono text-[var(--muted)]">{fmtTokens(r.contextLength)}</td>
                  <td class="py-2.5 pr-4 font-mono text-[var(--fg-2)]">
                    {fmtPrice(r.promptPerM)} / <span class="text-[var(--seg-cache)]">{fmtPrice(r.cachedPerM)}</span> / {fmtPrice(r.completionPerM)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
