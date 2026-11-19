import type { Translations } from '../../i18n';
import type { CallDetailPayload, Compaction } from '../../types/telemetry';
import { fmtClock, fmtNum, fmtQuotaPct, fmtSec, fmtUsd, formatModelTag } from '../../utils/format';

interface CompactCardProps {
  compact: Compaction;
  isLatest?: boolean;
  expanded: boolean;
  convId: string;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  onToggle: (stepIdx: number, hasDetail: boolean) => void;
}

export function CompactCard({
  compact: c,
  isLatest = false,
  expanded,
  convId,
  detailCache,
  detailLoading,
  t,
  onToggle,
}: CompactCardProps) {
  const modelTag = formatModelTag(c.modelId, c.modelDisplay, c.model) || 'Auto';
  const modelTitle =
    c.modelDisplay && modelTag && c.modelDisplay !== modelTag
      ? `${c.modelDisplay} (${modelTag})`
      : c.modelDisplay || modelTag;

  let dropStr = '';
  if (c.beforeCtx > 0 && c.afterCtx > 0) {
    const pctDrop = Math.round((1 - c.afterCtx / c.beforeCtx) * 100);
    const prefix = c.afterCtxEstimated ? '~' : '';
    const pctLabel = pctDrop >= 0 ? `-${pctDrop}%` : `+${Math.abs(pctDrop)}%`;
    dropStr = `${fmtNum(c.beforeCtx)} → ${prefix}${fmtNum(c.afterCtx)} (${pctLabel})`;
  } else if (c.beforeCtx > 0) {
    dropStr = `${fmtNum(c.beforeCtx)} → …`;
  }

  const detail = t.compactDetail(
    fmtClock(c.timestampMs),
    fmtNum(c.cachedInput),
    fmtNum(c.newInput),
    c.outputTokens.toLocaleString(),
    fmtSec(c.durationSec),
    dropStr,
  );

  const hasDetail = Boolean(c.hasSummary || c.summaryPreview);
  const cacheKey = `${convId}:compact:${c.stepIdx}`;
  const cached = convId ? detailCache.get(cacheKey) : undefined;
  const isLoading = convId ? detailLoading.has(cacheKey) : false;
  const summaryText = cached?.summaryPreview ?? c.summaryPreview ?? '';

  const qPctStr = fmtQuotaPct(c.quotaPct5h);
  const qErrStr = c.quotaPct5hErr ? fmtQuotaPct(c.quotaPct5hErr) : '';
  const q7dStr = c.quotaPct7d ? fmtQuotaPct(c.quotaPct7d) : '';
  const multVal = c.quotaMultiplierK || 1;
  const kStr = multVal.toFixed(2);
  const isHighMult = multVal >= 1.8;
  const multBadge = isHighMult
    ? `· ${Math.abs(multVal - Math.round(multVal)) < 0.08 ? Math.round(multVal) : multVal.toFixed(1)}×`
    : '';
  const isFitted = c.quotaFitSource === 'fitted';

  let fullText = '';
  if (expanded) {
    const baseFull = t.compactFull(
      c.stepIdx,
      modelTitle,
      fmtClock(c.timestampMs),
      dropStr,
      c.cachedInput.toLocaleString(),
      c.newInput.toLocaleString(),
      c.outputTokens.toLocaleString(),
      c.thinkingTokens.toLocaleString(),
      c.candidateTokens.toLocaleString(),
      fmtSec(c.durationSec),
    );
    const costLine = c.priced && c.costUSD !== undefined
      ? t.histCostTip(fmtUsd(c.costUSD), (c.cacheSavedUSD || 0) > 0 ? fmtUsd(c.cacheSavedUSD) : '')
      : '';
    const quotaLine = qPctStr ? t.histQuotaLine(qPctStr, qErrStr, q7dStr, kStr, isFitted) : '';
    fullText = baseFull + costLine + quotaLine;
  }

  return (
    <div
      className={`history-row is-compact${isLatest ? ' is-latest' : ''}${expanded ? ' is-expanded' : ''}`}
      onClick={() => onToggle(c.stepIdx, hasDetail)}
    >
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-[5px] min-w-0 flex-1">
          <span className="compact-pill">{t.compactBadge}</span>
          <span className="history-model">{modelTag}</span>
          {c.priced && c.costUSD !== undefined && (
            <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums whitespace-nowrap">
              {fmtUsd(c.costUSD)}
            </span>
          )}
          {qPctStr && (
            <span
              className={`quota-burn-pill${isHighMult ? ' is-high-mult' : ''} cursor-help`}
              data-tip={t.histQuotaPillTip(qPctStr, qErrStr, q7dStr, kStr, isFitted)}
            >
              <span>{isFitted ? `-${qPctStr}` : `~-${qPctStr}`}</span>
              {multBadge && <span>{multBadge}</span>}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-hud-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
            {dropStr || fmtSec(c.durationSec)}
          </span>
        </div>
      </div>

      <div className="font-hud-mono text-[10.5px] leading-[1.4] text-hud-muted break-words">
        {detail}
      </div>

      {expanded && (
        <div
          className="pt-[5px] border-t border-dashed border-hud-border font-hud-mono text-[11px] text-hud-muted leading-[1.5] break-words flex flex-col gap-1.5 cursor-text select-text"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="whitespace-pre-line">{fullText}</div>
          {summaryText ? (
            <div className="history-content-block">
              <span className="history-content-label">{t.lblSummary}</span>
              <div className="history-content-text">{summaryText}</div>
            </div>
          ) : isLoading ? (
            <div className="text-[11px] text-hud-muted font-hud-mono py-0.5">{t.loadingDetail}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
