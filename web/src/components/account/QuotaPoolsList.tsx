import type { Translations } from '../../i18n';
import type { AccountQuota, QuotaWindow } from '../../types/telemetry';
import { fmtClockHm, fmtDurationShort, fmtQuotaPct, fmtUsd, fmtUsdWithBand } from '../../utils/format';
import { IconAlert } from '../common/Icons';

interface QuotaPoolsListProps {
  quota: AccountQuota | undefined;
  nowMs: number;
  t: Translations;
}

export function QuotaPoolsList({ quota, nowMs, t }: QuotaPoolsListProps) {
  if (quota?.deferred) {
    return (
      <div className="l2-well text-[11px] font-hud text-hud-muted px-2.5 py-1.5">
        {t.quotaDeferred}
      </div>
    );
  }

  if (!quota?.available) {
    return (
      <div className="l2-well text-[11px] font-hud text-hud-muted px-2.5 py-1.5">
        {t.quotaOffline}
      </div>
    );
  }

  const pools = quota.pools || [];
  if (!pools.length) {
    return (
      <div className="l2-well text-[11px] font-hud text-hud-muted px-2.5 py-1.5">
        {t.quotaOffline}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
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
          const verifiedWins = p.fitSummary.shortCleanCount > 0
            ? p.fitSummary.shortCleanCount
            : (p.fitSummary.inlierCount || 0);
          fitNotes = t.poolFitTipLine(modelsStr, gammaStr, verifiedWins, errLabel);
        }

        return (
          <div
            key={`${p.label}:${idx}`}
            className={`${
              idx === 0 ? 'pt-0.5 pb-1' : 'pt-2.5 pb-1 border-t border-hud-hairline'
            } flex flex-col gap-1.5 min-w-0`}
            data-tip={t.poolTip(p.label, winsTextLines.join('\n'), p.heldByWeekly, fitNotes, Boolean(p.fitSummary?.driftWarning))}
          >
            <div className="flex items-center justify-between gap-2 text-[11.5px] font-hud tabular-nums">
              <div className="inline-flex items-center gap-1.5 min-w-0">
                <span className="text-hud-fg font-semibold truncate">{p.label}</span>
                {p.heldByWeekly && (
                  <span className="px-1.5 py-[0.5px] rounded font-hud text-[9.5px] font-semibold text-hud-bad bg-tint-bad whitespace-nowrap">
                    {t.heldByWeeklyTag}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 min-w-0">
              {wins.map((w, wIdx) => {
                const pct = Math.max(0, Math.min(100, w.remainingPct || 0));
                const remSec = w.resetAtMs > nowMs ? (w.resetAtMs - nowMs) / 1000 : 0;
                const resetStr = remSec > 0 ? fmtDurationShort(remSec) : '';
                const metaStr = t.winMeta(pct, resetStr);
                const estLine = formatWinEst(w);
                const rw = w.runway;

                // Hatched diagonal runway bar geometry:
                // - Solid segment = projected remaining at reset
                // - Diagonal hatched stripe = projected burn between now and reset
                // - Track = already consumed (100 - remainingPct)
                let solidPct = pct;
                let hatchPct = 0;
                let solidBg = pct >= 50 ? 'bg-hud-ok' : pct >= 20 ? 'bg-hud-warn' : 'bg-hud-bad';
                let hatchCls = 'runway-hatch-safe';
                let runwayCaption: { text: string; tone: 'calm' | 'warn' | 'bad'; tip?: string } | null = null;

                if (rw && remSec > 0) {
                  if (rw.status === 'exhausted') {
                    solidPct = 0;
                    hatchPct = 0;
                    runwayCaption = { text: t.winRunwayExhausted, tone: 'bad' };
                  } else {
                    const liveSec = Math.max(0, (rw.exhaustAtMs - nowMs) / 1000);
                    const durStr = fmtDurationShort(liveSec);
                    const clockStr = fmtClockHm(rw.exhaustAtMs, nowMs);
                    const projRem = Math.max(0, Math.min(pct, rw.projectedRemAtResetPct));
                    const remAtResetStr = `${Math.round(projRem)}%`;
                    const burnStr = fmtQuotaPct(rw.burnPctPerHour) || `${rw.burnPctPerHour.toFixed(2)}%`;
                    const rwTip = t.winRunwayTip(
                      burnStr,
                      durStr,
                      clockStr,
                      remAtResetStr,
                      rw.willExhaustBeforeReset,
                      rw.basis === 'active_blend',
                      rw.habitBlended,
                      rw.activeHoursPerDay,
                    );

                    if (rw.willExhaustBeforeReset) {
                      solidPct = 0;
                      hatchPct = pct;
                      const isUrgent = liveSec <= 3600;
                      hatchCls = isUrgent ? 'runway-hatch-bad' : 'runway-hatch-warn';
                      runwayCaption = {
                        text: t.winRunwayWarn(durStr, clockStr),
                        tone: isUrgent ? 'bad' : 'warn',
                        tip: rwTip,
                      };
                    } else {
                      solidPct = projRem;
                      hatchPct = Math.max(0, pct - projRem);
                      solidBg = projRem >= 30 ? 'bg-hud-ok' : 'bg-hud-warn';
                      hatchCls = projRem >= 30 ? 'runway-hatch-safe' : 'runway-hatch-warn';
                      runwayCaption = {
                        text: t.winRunwaySafe(remAtResetStr),
                        tone: 'calm',
                        tip: rwTip,
                      };
                    }
                  }
                }

                return (
                  <div
                    key={`${w.spanKey || w.label || wIdx}`}
                    className="grid grid-cols-[24px_minmax(0,1fr)_minmax(86px,auto)] items-center gap-x-2 gap-y-[3px] min-w-0"
                  >
                    <span className="font-hud-mono text-[10px] font-semibold text-hud-muted">
                      {w.spanKey || w.label || '5h'}
                    </span>

                    {/* Hatched Runway Progress Bar */}
                    <div
                      className={`h-2 rounded-full bg-hud-fill overflow-hidden flex${runwayCaption?.tip ? ' cursor-help' : ''}`}
                      data-tip={runwayCaption?.tip}
                    >
                      {solidPct > 0 && (
                        <div
                          className={`h-full transition-[width] duration-250 ${solidBg} ${
                            hatchPct > 0 ? 'rounded-l-full' : 'rounded-full'
                          }`}
                          style={{ width: `${solidPct.toFixed(1)}%` }}
                        />
                      )}
                      {hatchPct > 0 && (
                        <div
                          className={`h-full transition-[width] duration-250 ${hatchCls} ${
                            solidPct > 0 ? 'rounded-r-full' : 'rounded-full'
                          }`}
                          style={{ width: `${hatchPct.toFixed(1)}%` }}
                        />
                      )}
                    </div>

                    <span className="font-hud-mono text-[10.5px] font-medium text-hud-fg-2 tabular-nums text-right whitespace-nowrap">
                      {metaStr}
                    </span>

                    {(runwayCaption || estLine) && (
                      <div className="col-span-full w-0 min-w-full pl-[32px] flex flex-col gap-[2px]">
                        {runwayCaption && (
                          <span
                            className={`inline-flex items-center gap-1 w-fit font-hud-mono text-[9.5px] tabular-nums leading-[1.35] ${
                              runwayCaption.tip ? 'cursor-help ' : ''
                            }${
                              runwayCaption.tone === 'bad'
                                ? 'text-hud-bad font-semibold'
                                : runwayCaption.tone === 'warn'
                                  ? 'text-hud-warn font-semibold'
                                  : 'text-hud-muted'
                            }`}
                            data-tip={runwayCaption.tip}
                          >
                            {runwayCaption.tone !== 'calm' && <IconAlert size={10} />}
                            <span>{runwayCaption.text}</span>
                          </span>
                        )}
                        {estLine && (
                          <span className="font-hud-mono text-[9.5px] text-hud-muted/85 tabular-nums leading-[1.35] break-words">
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
