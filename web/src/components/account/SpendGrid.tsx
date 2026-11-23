import type { Translations } from '../../i18n';
import type { AccountHistory, TelemetrySummary } from '../../types/telemetry';
import { fmtUsd } from '../../utils/format';

interface SpendGridProps {
  summary: TelemetrySummary | undefined;
  history: AccountHistory | undefined;
  t: Translations;
}

export function SpendGrid({ summary, history, t }: SpendGridProps) {
  const s = summary;
  const h = history;

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
      v: s?.pricedCount ? fmtUsd(s.totalCostUSD || 0) : '--',
      sub: s?.pricedCount
        ? t.spendSavedSub(fmtUsd(s.totalSavedUSD || 0))
        : t.spendCallsSub(s?.count || 0),
      tip: t.spendSessionTip,
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
