import { useNowMs } from '../../hooks/useNow';
import type { Translations } from '../../i18n';
import type { AccountQuota, QuotaPool, QuotaWindow, SessionInfo, TelemetrySummary } from '../../types/telemetry';
import { fmtClockHm, fmtDurationShort, fmtQuotaPct } from '../../utils/format';
import { IconArrowRight } from '../common/Icons';

interface LiveQuotaCardProps {
  quota: AccountQuota | undefined;
  summary: TelemetrySummary | undefined;
  sessionInfo?: SessionInfo | null;
  t: Translations;
  onOpenAccount: () => void;
}

function selectActivePools(
  pools: QuotaPool[],
  summary: TelemetrySummary | undefined,
  sessionInfo?: SessionInfo | null,
): QuotaPool[] {
  if (!pools.length) return [];
  const sq = sessionInfo?.treeTotals?.quotaUsage || summary?.sessionQuota || sessionInfo?.quotaUsage;
  const usedGemini = Boolean(sq?.gemini && (sq.gemini.pct5h > 0 || (sq.gemini.pct7d || 0) > 0));
  const usedClaude = Boolean(sq?.claude_gpt && (sq.claude_gpt.pct5h > 0 || (sq.claude_gpt.pct7d || 0) > 0));
  if (usedGemini || usedClaude) {
    const matched = pools.filter((p) => {
      const lbl = (p.label || '').toLowerCase();
      if (usedGemini && lbl.includes('gemini')) return true;
      if (usedClaude && (lbl.includes('claude') || lbl.includes('gpt'))) return true;
      return false;
    });
    if (matched.length > 0) return matched;
  }
  return pools.slice(0, 1);
}

export function LiveQuotaCard({ quota, summary, sessionInfo, t, onOpenAccount }: LiveQuotaCardProps) {
  const nowMs = useNowMs();
  if (!quota?.available || !quota.pools?.length) return null;

  const activePools = selectActivePools(quota.pools, summary, sessionInfo);
  if (!activePools.length) return null;

  return (
    <section className="hud-card flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="card-k">{t.liveQuotaTitle}</span>
          {activePools.length === 1 && (
            <span className="font-hud text-[10.5px] font-medium text-hud-fg-2 truncate">
              {activePools[0].label}
            </span>
          )}
        </div>
        <button
          type="button"
          className="link-btn inline-flex items-center gap-0.5 shrink-0"
          onClick={onOpenAccount}
        >
          <span>{t.liveQuotaAll}</span>
          <IconArrowRight size={10} />
        </button>
      </div>

      <div className="flex flex-col gap-2 min-w-0">
        {activePools.map((pool, pIdx) => {
          const wins: QuotaWindow[] =
            Array.isArray(pool.windows) && pool.windows.length
              ? pool.windows
              : [
                  {
                    spanKey: '5h',
                    label: '5h',
                    remainingPct: pool.remainingPct,
                    resetTime: pool.resetTime,
                    resetAtMs: pool.resetAtMs,
                  },
                ];

          return (
            <div
              key={`${pool.label}:${pIdx}`}
              className={`${pIdx > 0 ? 'pt-1.5 border-t border-hud-hairline ' : ''}flex flex-col gap-1.5 min-w-0`}
            >
              {activePools.length > 1 && (
                <span className="font-hud text-[10px] font-semibold text-hud-fg-2 truncate">
                  {pool.label}
                </span>
              )}

              {wins.map((w, wIdx) => {
                const pct = Math.max(0, Math.min(100, w.remainingPct || 0));
                const remSec = w.resetAtMs > nowMs ? (w.resetAtMs - nowMs) / 1000 : 0;
                const resetStr = remSec > 0 ? fmtDurationShort(remSec) : '';
                const metaStr = t.winMeta(pct, resetStr);
                const rw = w.runway;

                const isExhausted = Boolean(rw && rw.status === 'exhausted');
                const willExhaust = Boolean(rw && remSec > 0 && rw.willExhaustBeforeReset);
                const liveSec = rw && remSec > 0 ? Math.max(0, (rw.exhaustAtMs - nowMs) / 1000) : 0;
                const isUrgent = isExhausted || (willExhaust && liveSec <= 3600);

                const solidPct =
                  rw && remSec > 0 && !isExhausted
                    ? willExhaust
                      ? 0
                      : Math.max(0, Math.min(pct, rw.projectedRemAtResetPct))
                    : pct;
                const projectedBurnPct =
                  rw && remSec > 0 && !isExhausted ? Math.max(0, pct - solidPct) : 0;

                const fillBg = isUrgent
                  ? 'bg-hud-bad'
                  : willExhaust
                    ? 'bg-hud-warn'
                    : solidPct >= 30
                      ? 'bg-hud-ok'
                      : solidPct >= 15
                        ? 'bg-hud-warn'
                        : 'bg-hud-bad';
                const hatchCls = isUrgent
                  ? 'runway-hatch-bad'
                  : willExhaust || solidPct < 30
                    ? 'runway-hatch-warn'
                    : 'runway-hatch-safe';

                let tip: string | undefined;
                if (rw && remSec > 0 && !isExhausted) {
                  const durStr = fmtDurationShort(liveSec);
                  const clockStr = fmtClockHm(rw.exhaustAtMs, nowMs);
                  const remAtResetStr = `${Math.round(rw.projectedRemAtResetPct)}%`;
                  const burnStr = fmtQuotaPct(rw.burnPctPerHour) || `${rw.burnPctPerHour.toFixed(2)}%`;
                  tip = t.winRunwayTip(
                    burnStr,
                    durStr,
                    clockStr,
                    remAtResetStr,
                    rw.willExhaustBeforeReset,
                    rw.basis === 'active_blend',
                    Boolean(rw.habitBlended),
                    rw.activeHoursPerDay,
                  );
                }

                return (
                  <div
                    key={`${w.spanKey || w.label || wIdx}`}
                    className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2 min-w-0${tip ? ' cursor-help' : ''}`}
                    data-tip={tip}
                  >
                    <span className="font-hud-mono text-[10px] font-semibold text-hud-muted">
                      {w.spanKey || w.label || '5h'}
                    </span>
                    <div className="h-[7px] rounded-full bg-hud-fill overflow-hidden flex">
                      {solidPct > 0 && (
                        <div
                          className={`h-full transition-[width] duration-250 ${fillBg} ${
                            projectedBurnPct > 0.2 ? 'rounded-l-full' : 'rounded-full'
                          }`}
                          style={{ width: `${solidPct.toFixed(1)}%` }}
                        />
                      )}
                      {projectedBurnPct > 0.2 && (
                        <div
                          className={`h-full transition-[width] duration-250 ${hatchCls} ${
                            solidPct > 0 ? 'rounded-r-full' : 'rounded-full'
                          }`}
                          style={{ width: `${projectedBurnPct.toFixed(1)}%` }}
                        />
                      )}
                    </div>
                    <span
                      className={`font-hud-mono text-[10px] tabular-nums text-right whitespace-nowrap ${
                        isUrgent ? 'text-hud-bad font-semibold' : willExhaust ? 'text-hud-warn font-semibold' : 'text-hud-muted'
                      }`}
                    >
                      {metaStr}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
