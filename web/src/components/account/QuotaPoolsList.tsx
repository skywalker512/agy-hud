import type { Translations } from '../../i18n';
import type { AccountQuota, QuotaWindow } from '../../types/telemetry';
import { fmtDurationShort, fmtUsd } from '../../utils/format';

interface QuotaPoolsListProps {
  quota: AccountQuota | undefined;
  nowMs: number;
  t: Translations;
}

export function QuotaPoolsList({ quota, nowMs, t }: QuotaPoolsListProps) {
  if (quota?.deferred) {
    return (
      <div className="text-[11px] text-hud-muted px-[7px] py-1 rounded-[5px] bg-hud-fill">
        {t.quotaDeferred}
      </div>
    );
  }

  if (!quota?.available) {
    return (
      <div className="text-[11px] text-hud-muted px-[7px] py-1 rounded-[5px] bg-hud-fill">
        {t.quotaOffline}
      </div>
    );
  }

  const pools = quota.pools || [];
  if (!pools.length) {
    return (
      <div className="text-[11px] text-hud-muted px-[7px] py-1 rounded-[5px] bg-hud-fill">
        {t.quotaOffline}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {pools.map((p, idx) => {
        const wins: QuotaWindow[] =
          Array.isArray(p.windows) && p.windows.length
            ? p.windows
            : [
                {
                  spanKey: '5h',
                  label: '5h',
                  remainingPct: p.remainingPct,
                  resetTime: p.resetTime,
                  resetAtMs: p.resetAtMs,
                },
              ];

        const winsTextLines = wins.map((w) => {
          const pct = Math.max(0, Math.min(100, w.remainingPct || 0));
          const remSec = w.resetAtMs > nowMs ? (w.resetAtMs - nowMs) / 1000 : 0;
          const resetStr = remSec > 0 ? fmtDurationShort(remSec) : '';
          const metaStr = t.winMeta(pct, resetStr);
          const tag = w.spanKey || w.label || '5h';
          if (typeof w.estFullUSD === 'number' && w.estFullUSD > 0) {
            return `${tag}: ${metaStr} (${t.winBudgetEst(fmtUsd(w.estSpentUSD || 0), fmtUsd(w.estFullUSD), w.estConfidence === 'low')})`;
          }
          if (typeof w.estSpentUSD === 'number' && w.estSpentUSD > 0) {
            return `${tag}: ${metaStr} (${t.winSpentOnly(fmtUsd(w.estSpentUSD), w.estMinSamplePct ? `${w.estMinSamplePct}%` : '0.5%')})`;
          }
          return `${tag}: ${metaStr}`;
        });

        return (
          <div
            key={`${p.label}:${idx}`}
            className={`${
              idx === 0 ? 'pt-0.5 pb-1' : 'pt-2 pb-1 border-t border-hud-border'
            } flex flex-col gap-[5px] min-w-0`}
            data-tip={t.poolTip(p.label, winsTextLines.join('\n'), p.heldByWeekly)}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] font-hud-mono tabular-nums">
              <div className="inline-flex items-center gap-1.5 min-w-0">
                <span className="text-hud-fg font-semibold truncate">{p.label}</span>
                {p.heldByWeekly && (
                  <span
                    className="px-[5px] rounded text-[9.5px] font-bold text-hud-bad whitespace-nowrap"
                    style={{ background: 'color-mix(in srgb, var(--hud-bad) 15%, transparent)' }}
                  >
                    {t.heldByWeeklyTag}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-[5px] min-w-0">
              {wins.map((w, wIdx) => {
                const pct = Math.max(0, Math.min(100, w.remainingPct || 0));
                const fillBg = pct >= 50 ? 'bg-hud-ok' : pct >= 20 ? 'bg-hud-warn' : 'bg-hud-bad';
                const remSec = w.resetAtMs > nowMs ? (w.resetAtMs - nowMs) / 1000 : 0;
                const resetStr = remSec > 0 ? fmtDurationShort(remSec) : '';
                const metaStr = t.winMeta(pct, resetStr);

                let estLine = '';
                if (typeof w.estFullUSD === 'number' && w.estFullUSD > 0) {
                  estLine = t.winBudgetEst(fmtUsd(w.estSpentUSD || 0), fmtUsd(w.estFullUSD), w.estConfidence === 'low');
                } else if (typeof w.estSpentUSD === 'number' && w.estSpentUSD > 0) {
                  estLine = t.winSpentOnly(fmtUsd(w.estSpentUSD), w.estMinSamplePct ? `${w.estMinSamplePct}%` : '0.5%');
                }

                return (
                  <div
                    key={`${w.spanKey || w.label || wIdx}`}
                    className="grid grid-cols-[24px_minmax(0,1fr)_minmax(86px,auto)] items-center gap-x-1.5 gap-y-[3px] min-w-0"
                  >
                    <span className="font-hud-mono text-[10px] font-bold text-hud-muted">
                      {w.spanKey || w.label || '5h'}
                    </span>
                    <div className="h-1.5 rounded-full bg-hud-fill overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-250 ${fillBg}`}
                        style={{ width: `${pct.toFixed(1)}%` }}
                      />
                    </div>
                    <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums text-right whitespace-nowrap">
                      {metaStr}
                    </span>
                    {estLine && (
                      <span className="col-span-full w-0 min-w-full pl-[30px] font-hud-mono text-[9.5px] text-hud-muted tabular-nums leading-[1.35] break-words">
                        {estLine}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
