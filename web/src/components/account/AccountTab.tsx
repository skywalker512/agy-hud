import { useEffect, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  StatsSnapshot,
  UpdateApplyResponse,
  UpdateStatusResponse,
} from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { fmtClock, fmtNum, fmtUsdWithBand } from '../../utils/format';
import { ActivityHeatmapCard } from './ActivityHeatmapCard';
import { CacheTtlCard } from './CacheTtlCard';
import { QuotaPoolsList } from './QuotaPoolsList';
import { QuotaRulesCard } from './QuotaRulesCard';
import { SpendGrid } from './SpendGrid';

interface AccountTabProps {
  snap: StatsSnapshot | null;
  nowMs: number;
  t: Translations;
  updateStatus: UpdateStatusResponse | null;
  updateChecking: boolean;
  updateApplying: boolean;
  updateApplyResult: UpdateApplyResponse | null;
  updateError: string | null;
  highlightUpdates?: boolean;
  onRefreshQuota: () => void;
  onCheckUpdates: (force?: boolean) => Promise<UpdateStatusResponse | null>;
  onApplyUpdate: (force?: boolean) => Promise<UpdateApplyResponse | null>;
}

const CLI_UPDATE_CMD = 'node plugin/install.mjs --update';

export function AccountTab({
  snap,
  nowMs,
  t,
  updateStatus,
  updateChecking,
  updateApplying,
  updateApplyResult,
  updateError,
  highlightUpdates = false,
  onRefreshQuota,
  onCheckUpdates,
  onApplyUpdate,
}: AccountTabProps) {
  const [copiedCli, setCopiedCli] = useState(false);
  const cliTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cliTimerRef.current) clearTimeout(cliTimerRef.current);
    };
  }, []);

  const handleCopyCli = async () => {
    const ok = await copyText(CLI_UPDATE_CMD);
    if (!ok) return;
    if (cliTimerRef.current) clearTimeout(cliTimerRef.current);
    setCopiedCli(true);
    cliTimerRef.current = setTimeout(() => setCopiedCli(false), 1100);
  };

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

  const curVer = updateStatus?.currentVersion || '1.2.0';
  const latestVer = updateStatus?.latestVersion || null;
  const isLinked = Boolean(updateStatus?.isLinked || updateStatus?.blockReason === 'dev_symlink');
  const isApplied = Boolean(updateApplyResult?.ok);
  const isAvailable = Boolean(updateStatus?.updateAvailable && latestVer && !isLinked && !isApplied);
  const checkedClock = updateStatus?.checkedAtMs ? fmtClock(updateStatus.checkedAtMs) : '';
  const effectiveError =
    updateError ||
    (updateApplyResult && !updateApplyResult.ok ? updateApplyResult.message : null) ||
    (updateStatus?.status === 'error' ? updateStatus.error || null : null);
  const showCliFallback = Boolean(
    effectiveError ||
      updateStatus?.status === 'offline' ||
      updateStatus?.status === 'rate_limited' ||
      (isAvailable && !updateStatus?.canSelfUpdate),
  );

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
      <CacheTtlCard cacheTtl={snap?.cacheTtl} t={t} />
      <ActivityHeatmapCard history={h} t={t} />

      {/* Compact Plugin & Updates Card */}
      <section
        id="plugin-updates-card"
        className={`hud-card${highlightUpdates ? ' is-jump-highlight' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="card-k">{t.updateCardTitle}</span>
            <span className="inline-flex items-center px-1.5 py-[1px] rounded-full font-hud-mono text-[10px] font-semibold text-hud-fg bg-hud-surface-2 border border-hud-border tabular-nums">
              v{curVer}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-[1px] rounded-full font-hud-mono text-[9.5px] font-semibold border ${
                isLinked
                  ? 'text-hud-warn border-hud-border bg-hud-surface-2'
                  : 'text-hud-muted border-hud-border bg-hud-surface-2'
              }`}
            >
              {isLinked ? t.updateModeDev : t.updateModeInstalled}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {checkedClock && (
              <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums">
                {t.updateLastChecked(checkedClock)}
              </span>
            )}
            <button
              type="button"
              disabled={updateChecking || updateApplying}
              className="hud-btn !py-[2px] !px-2 !text-[10px]"
              onClick={() => void onCheckUpdates(true)}
            >
              {updateChecking ? t.updateBtnChecking : t.updateBtnCheck}
            </button>
          </div>
        </div>

        <div className="mt-2 rounded-md border border-hud-border bg-hud-surface-2 px-2.5 py-2 flex flex-col gap-1.5 min-w-0">
          {updateApplying ? (
            <div className="flex items-center gap-2 font-hud-mono text-[11px] text-hud-accent-ink">
              <span className="inline-block w-2 h-2 rounded-full bg-hud-accent animate-pulse" />
              <span>{t.updateBtnUpdating}</span>
            </div>
          ) : isApplied ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-hud-mono text-[11px] text-hud-ok font-semibold">
                ✓ {t.updateAppliedMsg(updateApplyResult?.newVersion || latestVer || curVer)}
              </span>
              <button
                type="button"
                className="update-action-btn"
                onClick={() => location.reload()}
              >
                {t.updateBtnReload}
              </button>
            </div>
          ) : effectiveError ? (
            <div className="font-hud-mono text-[11px] text-hud-bad break-words">
              {updateApplyResult && !updateApplyResult.ok
                ? t.updateApplyFailed(effectiveError)
                : t.updateStatusError(effectiveError)}
            </div>
          ) : isLinked ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-hud-mono text-[10.5px] text-hud-muted">
                {t.updateDevHint}
              </span>
              {updateStatus?.updateAvailable && latestVer && (
                <span className="font-hud-mono text-[10px] text-hud-accent-ink tabular-nums">
                  v{curVer} → v{latestVer}
                </span>
              )}
            </div>
          ) : isAvailable && latestVer ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-hud-mono text-[11px] font-semibold text-hud-fg tabular-nums">
                  {t.updateStatusAvailable(curVer, latestVer)}
                </span>
                {updateStatus?.releaseUrl && (
                  <a
                    href={updateStatus.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-hud-mono text-[10.5px] text-hud-accent-ink no-underline hover:underline"
                  >
                    {t.updateReleaseNotes}
                  </a>
                )}
              </div>
              {updateStatus?.canSelfUpdate && (
                <button
                  type="button"
                  disabled={updateApplying}
                  className="update-action-btn"
                  onClick={() => void onApplyUpdate(false)}
                >
                  {t.updateBtnNow}
                </button>
              )}
            </div>
          ) : updateStatus?.status === 'offline' ? (
            <div className="font-hud-mono text-[10.5px] text-hud-warn">{t.updateStatusOffline}</div>
          ) : updateStatus?.status === 'rate_limited' ? (
            <div className="font-hud-mono text-[10.5px] text-hud-warn">{t.updateStatusRateLimited}</div>
          ) : updateStatus?.status === 'ahead' ? (
            <div className="font-hud-mono text-[10.5px] text-hud-ok">✓ {t.updateStatusAhead}</div>
          ) : (
            <div className="font-hud-mono text-[10.5px] text-hud-ok">
              ✓ {t.updateStatusUpToDate}
            </div>
          )}

          {showCliFallback && (
            <div className="pt-1.5 border-t border-hud-border/70 flex flex-wrap items-center justify-between gap-1.5 font-hud-mono text-[10px] text-hud-muted">
              <div className="flex items-center gap-1.5 min-w-0">
                <span>{t.updateCliFallback}</span>
                <code className="px-1.5 py-[1px] rounded bg-hud-card border border-hud-border text-hud-fg truncate">
                  {CLI_UPDATE_CMD}
                </code>
              </div>
              <button
                type="button"
                className={`insp-copy-btn${copiedCli ? ' is-copied' : ''}`}
                onClick={() => void handleCopyCli()}
              >
                {copiedCli ? t.copied : t.inspCopy}
              </button>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
