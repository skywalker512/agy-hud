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

  const cells = [
    {
      k: t.spendSession,
      v: s?.pricedCount ? fmtUsd(s.totalCostUSD || 0) : '--',
      sub: s?.pricedCount
        ? t.spendSavedSub(fmtUsd(s.totalSavedUSD || 0))
        : t.spendCallsSub(s?.count || 0),
    },
    {
      k: t.spendToday,
      v: fmtUsd(h?.todayCostUSD || 0),
      sub: t.spendCallsSub(h?.todayCalls || 0),
    },
    {
      k: t.spendMonth,
      v: fmtUsd(h?.monthCostUSD || 0),
      sub: t.spendCallsSub(h?.monthCalls || 0),
    },
    {
      k: t.spendAll,
      v: fmtUsd(h?.totalCostUSD || 0),
      sub: h?.indexing
        ? t.spendIndexingSub(h.indexedCount || 0, h.dbCount || 0)
        : t.spendCallsSub(h?.totalCalls || 0, h?.dbCount || 0),
    },
  ];

  return (
    <div className="spend-grid grid grid-cols-4 gap-1.5">
      {cells.map((c) => (
        <div key={c.k} className="spend-cell">
          <span className="text-[9.5px] font-semibold text-hud-muted tracking-[0.02em] truncate">
            {c.k}
          </span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-fg tabular-nums">
            {c.v}
          </span>
          <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
            {c.sub}
          </span>
        </div>
      ))}
    </div>
  );
}
