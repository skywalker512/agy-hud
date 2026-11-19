import type { Translations } from '../../i18n';
import type { AccountQuota, QuotaWindow } from '../../types/telemetry';
import { fmtClockHm, fmtDurationShort, fmtQuotaPct, fmtUsd, fmtUsdWithBand } from '../../utils/format';

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

        const formatWinEst = (w: QuotaWindow) => {
          const spent = w.estSpentUSD || 0;
          const eff = w.estEffectiveSpentUSD;
          const effStr =
            typeof eff === 'number' && eff > 0 && Math.abs(eff - spent) >= Math.max(0.05, spent * 0.08)
              ? fmtUsd(eff)
              : '';
          const remoteStr =
            typeof w.estRemoteUSD === 'number' && w.estRemoteUSD > 0
              ? fmtUsdWithBand(w.estRemoteUSD, w.estRemoteUSDPlusMinus)
              : '';
          if (typeof w.estFullUSD === 'number' && w.estFullUSD > 0) {
            return t.winBudgetEst(fmtUsd(spent), fmtUsd(w.estFullUSD), w.estConfidence === 'low', remoteStr, effStr);
          }
          if (spent > 0) {
            return t.winSpentOnly(fmtUsd(spent), w.estMinSamplePct ? `${w.estMinSamplePct}%` : '0.5%');
          }
          return '';
        };

        const winsTextLines = wins.map((w) => {
          const pct = Math.max(0, Math.min(100, w.remainingPct || 0));
          const remSec = w.resetAtMs > nowMs ? (w.resetAtMs - nowMs) / 1000 : 0;
          const resetStr = remSec > 0 ? fmtDurationShort(remSec) : '';
          const metaStr = t.winMeta(pct, resetStr);
          const tag = w.spanKey || w.label || '5h';
          const estLine = formatWinEst(w);
          return estLine ? `${tag}: ${metaStr} (${estLine})` : `${tag}: ${metaStr}`;
        });

        let fitNotes = '';
        if (p.fitSummary && p.fitSummary.models.length > 0) {
          const modelsStr = p.fitSummary.models
            .slice()
            .sort((a, b) => b.obsCalls - a.obsCalls)
            .map((m) => {
              if (m.mode === 'per_token' && m.tokenWeights?.length === 3) {
                return `${m.family} [${m.tokenWeights.map((v) => v.toFixed(1)).join('/')}%/M]`;
              }
              const suffix = m.source === 'prior' ? '(prior)' : '';
              return `${m.family} ${m.k.toFixed(2)}×${suffix}`;
            })
            .join(' · ');
          const gammaStr = p.fitSummary.gamma ? `${p.fitSummary.gamma.toFixed(2)}×` : '';
          const baseErr =
            p.fitSummary.oosRelErrPct !== null && p.fitSummary.holdoutCount > 0
              ? `OOS ${p.fitSummary.oosRelErrPct.toFixed(1)}%`
              : `±${p.fitSummary.relErrPct.toFixed(1)}%`;
          const errLabel = p.fitSummary.quality === 'high' ? baseErr : `provisional · ${baseErr}`;
          fitNotes = t.poolFitTipLine(modelsStr, gammaStr, p.fitSummary.shortCleanCount, errLabel);
        }

        return (
          <div
            key={`${p.label}:${idx}`}
            className={`${
              idx === 0 ? 'pt-0.5 pb-1' : 'pt-2 pb-1 border-t border-hud-border'
            } flex flex-col gap-[5px] min-w-0`}
            data-tip={t.poolTip(p.label, winsTextLines.join('\n'), p.heldByWeekly, fitNotes, Boolean(p.fitSummary?.driftWarning))}
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
                const estLine = formatWinEst(w);

                const rw = w.runway;
                let runwayNode = null;
                if (rw && remSec > 0) {
                  if (rw.status === 'exhausted') {
                    runwayNode = (
                      <span className="runway-pill is-bad w-fit">{t.winRunwayExhausted}</span>
                    );
                  } else {
                    const liveSec = Math.max(0, (rw.exhaustAtMs - nowMs) / 1000);
                    const durStr = fmtDurationShort(liveSec);
                    const clockStr = fmtClockHm(rw.exhaustAtMs, nowMs);
                    const remAtResetStr = `${Math.round(rw.projectedRemAtResetPct)}%`;
                    const burnStr = fmtQuotaPct(rw.burnPctPerHour) || `${rw.burnPctPerHour.toFixed(2)}%`;
                    const rwTip = t.winRunwayTip(
                      burnStr,
                      durStr,
                      clockStr,
                      remAtResetStr,
                      rw.willExhaustBeforeReset,
                      rw.basis === 'active_blend',
                    );
                    if (rw.willExhaustBeforeReset) {
                      const pillCls = liveSec <= 3600 ? 'runway-pill is-bad' : 'runway-pill is-warn';
                      runwayNode = (
                        <span className={`${pillCls} w-fit cursor-help`} data-tip={rwTip}>
                          {t.winRunwayWarn(durStr, clockStr)}
                        </span>
                      );
                    } else {
                      runwayNode = (
                        <span className="runway-pill is-safe w-fit cursor-help" data-tip={rwTip}>
                          {t.winRunwaySafe(remAtResetStr)}
                        </span>
                      );
                    }
                  }
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
                    {(runwayNode || estLine) && (
                      <div className="col-span-full w-0 min-w-full pl-[30px] flex flex-col gap-[2px]">
                        {runwayNode}
                        {estLine && (
                          <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums leading-[1.35] break-words">
                            {estLine}
                          </span>
                        )}
                      </div>
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
