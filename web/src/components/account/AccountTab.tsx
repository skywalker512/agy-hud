import type { Translations } from '../../i18n';
import type { StatsSnapshot } from '../../types/telemetry';
import { fmtClock, fmtNum, fmtUsdWithBand } from '../../utils/format';
import { ActivityHeatmapCard } from './ActivityHeatmapCard';
import { QuotaPoolsList } from './QuotaPoolsList';
import { QuotaRulesCard } from './QuotaRulesCard';
import { SpendGrid } from './SpendGrid';

interface AccountTabProps {
  snap: StatsSnapshot | null;
  nowMs: number;
  t: Translations;
  onRefreshQuota: () => void;
}

export function AccountTab({ snap, nowMs, t, onRefreshQuota }: AccountTabProps) {
  const q = snap?.accountQuota;
  const s = snap?.summary;
  const h = snap?.accountHistory;

  const tierLabel = q?.available
    ? [q.tierName, q.planName]
        .filter((v): v is string => Boolean(v))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(' · ')
    : '';

  const creditsStr =
    q?.available && typeof q.availableCredits === 'number' && q.availableCredits > 0
      ? fmtNum(q.availableCredits)
      : '';

  const totalUnpriced = h?.unpricedCount || s?.unpricedCount || 0;
  const footnote = totalUnpriced > 0 ? t.unpricedNote(totalUnpriced) : t.pricedAllNote;
  const remoteActiveUsd = q?.available && q.remoteEstimate?.activeWindowUSD ? q.remoteEstimate.activeWindowUSD : 0;

  return (
    <section id="tab-account" className="flex flex-col gap-2.5 min-w-0">
      <section className="hud-card">
        <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
            <span className="card-k">{t.accountTitle}</span>
            {tierLabel && (
              <span className="inline-flex items-center px-1.5 py-[1px] rounded-full font-hud-mono text-[10px] font-medium text-hud-muted bg-hud-fill border border-hud-border whitespace-nowrap max-w-full truncate">
                {tierLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            {creditsStr && (
              <span
                className="card-sub !mt-0 cursor-help"
                data-tip={t.creditsRealTip(creditsStr)}
              >
                {t.creditsRealMini(creditsStr)}
              </span>
            )}
            <button
              type="button"
              className="collapse-btn"
              aria-label="Refresh Quota"
              data-tip={t.quotaRefreshTip(q?.fetchedAtMs ? fmtClock(q.fetchedAtMs) : '')}
              onClick={onRefreshQuota}
            >
              ↻
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-2 min-w-0">
          <QuotaPoolsList quota={q} nowMs={nowMs} t={t} />
          <SpendGrid summary={s} history={h} t={t} />
          {remoteActiveUsd > 0 && (
            <div
              className="flex items-center justify-between gap-2 px-2 py-1 rounded-[5px] bg-hud-fill border border-hud-border font-hud-mono text-[10px] text-hud-muted cursor-help"
              data-tip={t.remoteWinBannerTip}
            >
              <span className="truncate">
                {t.remoteWinBanner(fmtUsdWithBand(remoteActiveUsd, q?.remoteEstimate?.activeWindowPlusMinusUSD))}
              </span>
            </div>
          )}
          <div className="text-[10px] text-hud-muted leading-[1.35] break-words">{footnote}</div>
        </div>
      </section>

      <QuotaRulesCard quota={q} t={t} />
      <ActivityHeatmapCard history={h} t={t} />
    </section>
  );
}
