import { useEffect, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  StatsSnapshot,
  UpdateApplyResponse,
  UpdateStatusResponse,
} from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { fmtClock, fmtNum, fmtUsd, fmtUsdWithBand } from '../../utils/format';
import { IconArrowRight, IconCheck, IconCopy, IconExternalLink, IconRefresh } from '../common/Icons';
import { ActivityHeatmapCard } from './ActivityHeatmapCard';
import { CacheTtlCard } from './CacheTtlCard';
import { GeminiPulseCard } from './GeminiPulseCard';
import { QuotaPoolsList } from './QuotaPoolsList';
import { QuotaRulesCard } from './QuotaRulesCard';
import { SpendGrid } from './SpendGrid';

interface AccountTabProps {
  snap: StatsSnapshot | null;
  t: Translations;
  updateStatus: UpdateStatusResponse | null;
  updateChecking: boolean;
  updateApplying: boolean;
  updateApplyResult: UpdateApplyResponse | null;
  updateError: string | null;
  highlightUpdates?: boolean;
  pulseRefreshing: boolean;
  onRefreshQuota: () => void;
  onRefreshPulse: () => void;
  onTogglePulse: (enabled: boolean) => void;
  onCheckUpdates: (force?: boolean) => Promise<UpdateStatusResponse | null>;
  onApplyUpdate: (force?: boolean) => Promise<UpdateApplyResponse | null>;
}

const INSTALL_CMD_UNIX = 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | bash';
const INSTALL_CMD_WIN = 'irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex';
const DEV_UPDATE_CMD = 'git pull && node plugin/install.mjs --update';

function detectWindowsClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
  return /win/i.test(ua);
}

export function AccountTab({
  snap,
  t,
  updateStatus,
  updateChecking,
  updateApplying,
  updateApplyResult,
  updateError,
  highlightUpdates = false,
  pulseRefreshing,
  onRefreshQuota,
  onRefreshPulse,
  onTogglePulse,
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

  const q = snap?.accountQuota;
  const s = snap?.summary;
  const h = snap?.accountHistory;

  const tierMeta = q?.available ? q.tierMeta : undefined;
  const tierLabel = q?.available ? tierMeta?.displayLabel || q.tierName || q.planName || '' : '';
  const tierTip =
    q?.available && tierMeta && (tierMeta.tierId || tierMeta.multiplier || tierMeta.fittedGemini5hUSD)
      ? t.tierBadgeTip({
          tierId: tierMeta.tierId || q.tierId || '',
          multiplier: tierMeta.multiplier,
          source: tierMeta.multiplierSource,
          fitted5hStr: tierMeta.fittedGemini5hUSD ? fmtUsd(tierMeta.fittedGemini5hUSD) : '',
        })
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

  const manualUpdateCmd = isLinked
    ? DEV_UPDATE_CMD
    : detectWindowsClient()
      ? INSTALL_CMD_WIN
      : INSTALL_CMD_UNIX;

  const handleCopyCli = async () => {
    const ok = await copyText(manualUpdateCmd);
    if (!ok) return;
    if (cliTimerRef.current) clearTimeout(cliTimerRef.current);
    setCopiedCli(true);
    cliTimerRef.current = setTimeout(() => setCopiedCli(false), 1100);
  };

  return (
    <section id="tab-account" className="flex flex-col gap-2.5 min-w-0">
      <section className="hud-card">
        <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
            <span className="card-k">{t.accountTitle}</span>
            {tierLabel && (
              <span
                className={`inline-flex items-center px-1.5 py-[1px] rounded-full font-hud text-[10px] font-medium text-hud-muted bg-hud-fill whitespace-nowrap max-w-full truncate${tierTip ? ' cursor-help' : ''}`}
                {...(tierTip ? { 'data-tip': tierTip } : {})}
              >
                {tierLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            {creditsStr && (
              <span
                className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums cursor-help"
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
              <IconRefresh size={12} />
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-col gap-2.5 min-w-0">
          <QuotaPoolsList quota={q} t={t} />
          <SpendGrid summary={s} history={h} sessionInfo={snap?.sessionInfo} accountLedger={q?.accountLedger} t={t} />
          {remoteActiveUsd > 0 && (
            <div
              className="l2-well flex items-center justify-between gap-2 px-2.5 py-1.5 font-hud text-[10px] text-hud-muted cursor-help"
              data-tip={t.remoteWinBannerTip}
            >
              <span className="truncate">
                {t.remoteWinBanner(fmtUsdWithBand(remoteActiveUsd, q?.remoteEstimate?.activeWindowPlusMinusUSD))}
              </span>
            </div>
          )}
          <div className="text-[10px] font-hud text-hud-muted leading-[1.38] break-words">{footnote}</div>
        </div>
      </section>

      <QuotaRulesCard quota={q} t={t} />
      <CacheTtlCard cacheTtl={snap?.cacheTtl} t={t} />
      <GeminiPulseCard
        pulse={snap?.geminiPulse}
        refreshing={pulseRefreshing}
        onRefresh={onRefreshPulse}
        onToggleEnabled={onTogglePulse}
        t={t}
      />
      <ActivityHeatmapCard history={h} tierLabel={tierLabel} t={t} />

      {/* Compact Plugin & Updates Card */}
      <section
        id="plugin-updates-card"
        className={`hud-card${highlightUpdates ? ' is-jump-highlight' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="card-k">{t.updateCardTitle}</span>
            <span className="inline-flex items-center px-1.5 py-[1px] rounded-full font-hud-mono text-[10px] font-semibold text-hud-fg bg-hud-surface-2 tabular-nums">
              v{curVer}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-[1px] rounded-full font-hud text-[9.5px] font-medium ${
                isLinked ? 'text-hud-warn bg-tint-warn' : 'text-hud-muted bg-hud-fill'
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
              className="hud-btn !py-[2.5px] !px-2 !text-[10px]"
              onClick={() => void onCheckUpdates(true)}
            >
              {updateChecking ? t.updateBtnChecking : t.updateBtnCheck}
            </button>
          </div>
        </div>

        <div className="l2-well mt-2 px-2.5 py-2 flex flex-col gap-1.5 min-w-0">
          {updateApplying ? (
            <div className="flex items-center gap-2 font-hud text-[11px] text-hud-accent-ink">
              <span className="inline-block w-2 h-2 rounded-full bg-hud-accent animate-pulse" />
              <span>{t.updateBtnUpdating}</span>
            </div>
          ) : isApplied ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-hud text-[11px] text-hud-ok font-semibold">
                <IconCheck size={12} />
                <span>{t.updateAppliedMsg(updateApplyResult?.newVersion || latestVer || curVer)}</span>
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
            <div className="font-hud text-[11px] text-hud-bad break-words">
              {updateApplyResult && !updateApplyResult.ok
                ? t.updateApplyFailed(effectiveError)
                : t.updateStatusError(effectiveError)}
            </div>
          ) : isLinked ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-hud text-[10.5px] text-hud-muted">
                {t.updateDevHint}
              </span>
              {updateStatus?.updateAvailable && latestVer && (
                <span className="inline-flex items-center gap-1 font-hud-mono text-[10px] text-hud-accent-ink tabular-nums">
                  <span>v{curVer}</span>
                  <IconArrowRight size={10} />
                  <span>v{latestVer}</span>
                </span>
              )}
            </div>
          ) : isAvailable && latestVer ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-hud text-[11px] font-semibold text-hud-fg tabular-nums">
                  {t.updateStatusAvailable(curVer, latestVer)}
                </span>
                {updateStatus?.releaseUrl && (
                  <a
                    href={updateStatus.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-hud text-[10.5px] text-hud-accent-ink no-underline hover:underline"
                  >
                    <span>{t.updateReleaseNotes}</span>
                    <IconExternalLink size={10} />
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
            <div className="font-hud text-[10.5px] text-hud-warn">{t.updateStatusOffline}</div>
          ) : updateStatus?.status === 'rate_limited' ? (
            <div className="font-hud text-[10.5px] text-hud-warn">{t.updateStatusRateLimited}</div>
          ) : updateStatus?.status === 'ahead' ? (
            <div className="inline-flex items-center gap-1.5 font-hud text-[10.5px] text-hud-fg-2">
              <IconCheck size={11} className="text-hud-ok" />
              <span>{t.updateStatusAhead}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 font-hud text-[10.5px] text-hud-fg-2">
              <IconCheck size={11} className="text-hud-ok" />
              <span>{t.updateStatusUpToDate}</span>
            </div>
          )}

          {showCliFallback && (
            <div className="pt-1.5 border-t border-hud-hairline flex flex-wrap items-center justify-between gap-1.5 font-hud text-[10px] text-hud-muted">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="shrink-0">{t.updateCliFallback}</span>
                <code className="px-1.5 py-[1.5px] rounded bg-hud-card font-hud-mono text-[9.5px] text-hud-fg truncate">
                  {manualUpdateCmd}
                </code>
              </div>
              <button
                type="button"
                className={`insp-copy-btn shrink-0${copiedCli ? ' is-copied' : ''}`}
                onClick={() => void handleCopyCli()}
              >
                {copiedCli ? <IconCheck size={10} /> : <IconCopy size={10} />}
                <span>{copiedCli ? t.copied : t.inspCopy}</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
