import type { Translations } from '../../i18n';
import type { AccountHistory, SessionInfo, TelemetrySummary } from '../../types/telemetry';
import { fmtUsd } from '../../utils/format';

interface SpendGridProps {
  summary: TelemetrySummary | undefined;
  history: AccountHistory | undefined;
  sessionInfo?: SessionInfo | null;
  t: Translations;
}

export function SpendGrid({ summary, history, sessionInfo, t }: SpendGridProps) {
  const s = summary;
  const h = history;
  const tree = sessionInfo?.treeTotals;
  const isZh = t.spendSession === '本会话';

  const rootCost = s?.totalCostUSD || 0;
  const rootSaved = s?.totalSavedUSD || 0;
  const rootPriced = s?.pricedCount || 0;
  const rootCalls = s?.count || 0;

  const childCount = tree?.descendantCount || 0;
  const childCost = tree?.childCostUSD || 0;
  const childSaved = tree?.childSavedUSD || 0;
  const childPriced = tree?.childPricedCount || 0;
  const childCalls = tree?.childCalls || 0;
  const hasChildRollup = childCount > 0 && (childCost > 0 || childCalls > 0);

  const effCost = rootCost + childCost;
  const effSaved = rootSaved + childSaved;
  const effPriced = rootPriced + childPriced;
  const effCalls = rootCalls + childCalls;

  const sessionSub = hasChildRollup
    ? isZh
      ? `含${childCount}子 · 省${fmtUsd(effSaved)}`
      : `+${childCount} sub · -${fmtUsd(effSaved)}`
    : effPriced
      ? t.spendSavedSub(fmtUsd(effSaved))
      : t.spendCallsSub(effCalls);

  const sessionBreakdownTip = hasChildRollup
    ? isZh
      ? `本会话总计（含 Swarm / 递归子会话）：${fmtUsd(effCost)}（省 ${fmtUsd(effSaved)}，${effCalls} 次调用）\n` +
        `• 主会话：${fmtUsd(rootCost)}（${rootCalls} 次）\n` +
        `• ${tree?.swarmWorkerCount ? `Swarm / 子会话` : '子会话'}（${childCount} 个）：${fmtUsd(childCost)}（${childCalls} 次）\n\n${t.spendSessionTip}`
      : `Session total (incl. Swarm / recursive subagents): ${fmtUsd(effCost)} (saved ${fmtUsd(effSaved)}, ${effCalls} calls)\n` +
        `• Main session: ${fmtUsd(rootCost)} (${rootCalls} calls)\n` +
        `• ${tree?.swarmWorkerCount ? 'Swarm / subagents' : 'Subagents'} (${childCount}): ${fmtUsd(childCost)} (${childCalls} calls)\n\n${t.spendSessionTip}`
    : t.spendSessionTip;

  const cliDbs = h?.dbCountBySource?.cli || 0;
  const cliCalls = h?.callsBySource?.cli || 0;
  const allSourceDetail =
    cliDbs > 0 || cliCalls > 0
      ? t.spendAllSourceTip(
          fmtUsd(h?.costBySource?.app || 0),
          h?.callsBySource?.app || 0,
          h?.dbCountBySource?.app || 0,
          fmtUsd(h?.costBySource?.cli || 0),
          cliCalls,
          cliDbs,
        )
      : '';

  const cells = [
    {
      k: t.spendSession,
      v: effPriced > 0 || effCost > 0 ? fmtUsd(effCost) : '--',
      sub: sessionSub,
      tip: sessionBreakdownTip,
    },
    {
      k: t.spendToday,
      v: fmtUsd(h?.todayCostUSD || 0),
      sub: t.spendCallsSub(h?.todayCalls || 0),
      tip: t.spendLocalScopeTip,
    },
    {
      k: t.spendMonth,
      v: fmtUsd(h?.monthCostUSD || 0),
      sub: t.spendCallsSub(h?.monthCalls || 0),
      tip: t.spendLocalScopeTip,
    },
    {
      k: t.spendAll,
      v: fmtUsd(h?.totalCostUSD || 0),
      sub: h?.indexing
        ? t.spendIndexingSub(h.indexedCount || 0, h.dbCount || 0)
        : t.spendCallsSub(h?.totalCalls || 0, h?.dbCount || 0),
      tip: allSourceDetail ? `${allSourceDetail}\n\n${t.spendLocalScopeTip}` : t.spendLocalScopeTip,
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-hud text-[9.5px] font-semibold uppercase tracking-[0.04em] text-hud-muted">
          {t.spendScopeLabel}
        </span>
      </div>
      <div className="spend-grid grid grid-cols-4 gap-1.5">
        {cells.map((c) => (
          <div key={c.k} className="spend-cell cursor-help" data-tip={c.tip}>
            <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">
              {c.k}
            </span>
            <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums">
              {c.v}
            </span>
            <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
              {c.sub}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
