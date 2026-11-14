import type { Translations } from '../../i18n';
import type { CallDetailPayload, Invocation } from '../../types/telemetry';
import { cacheTier, fmtCachePct, fmtClock, fmtNum, fmtSec, fmtTps, fmtUsd } from '../../utils/format';
import { ContentBlocks } from './ContentBlocks';

interface InvocationRowProps {
  inv: Invocation;
  isLatest: boolean;
  expanded: boolean;
  convId: string;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  onToggle: (idx: number, hasDetail: boolean) => void;
}

export function InvocationRow({
  inv: r,
  isLatest,
  expanded,
  convId,
  detailCache,
  detailLoading,
  t,
  onToggle,
}: InvocationRowProps) {
  const modelTag = r.modelId || r.modelDisplay || r.model;
  const modelTitle = r.modelDisplay && r.modelId ? `${r.modelDisplay} (${r.modelId})` : modelTag;
  const cPct = fmtCachePct(r.cacheHitPct);
  const cTier = cacheTier(r.cacheHitPct);

  const stallNote = r.isToolStall && r.toolGenSec > 0 ? t.histStallNote(fmtSec(r.toolGenSec)) : '';
  const detail = t.histDetail(
    fmtClock(r.timestampMs),
    fmtNum(r.cachedInput),
    fmtNum(r.newInput),
    r.outputTokens,
    r.thinkingTokens,
    fmtSec(r.ttftSec),
    fmtSec(r.genSec),
    stallNote,
  );

  const hasDetail = Boolean(r.hasThinking || r.hasReply || (r.toolCount || 0) > 0);
  const primary = r.isBuffered ? t.histBuf((r.genSec * 1000).toFixed(0)) : `${fmtTps(r.genTps)} tok/s`;

  const cacheKey = `${convId}:inv:${r.idx}`;
  const cached = convId ? detailCache.get(cacheKey) : undefined;
  const isLoading = convId ? detailLoading.has(cacheKey) : false;
  const inlineContent =
    r.thinkingPreview || r.replyPreview || (r.toolCalls && r.toolCalls.length > 0) ? r : undefined;
  const contentSrc = cached || inlineContent;

  let fullText = '';
  if (expanded) {
    const baseFull = t.histFull(
      r.idx + 1,
      modelTitle,
      fmtClock(r.timestampMs),
      cPct,
      r.cachedInput.toLocaleString(),
      r.newInput.toLocaleString(),
      r.outputTokens.toLocaleString(),
      r.thinkingTokens.toLocaleString(),
      r.candidateTokens.toLocaleString(),
      fmtSec(r.ttftSec),
      fmtSec(r.genSec),
      fmtTps(r.e2eTps),
      r.totalContext.toLocaleString(),
      r.contextLimit.toLocaleString(),
      r.contextPct,
    );
    const phaseLine =
      r.toolGenSec > 0 && (r.thinkSec > 0 || r.stepToolCount > 0)
        ? t.histPhaseLine(fmtSec(r.thinkSec || 0), fmtSec(r.toolGenSec), r.stepToolCount || r.toolCount || 0)
        : '';
    const costLine = r.priced
      ? t.histCostTip(fmtUsd(r.costUSD), r.cacheSavedUSD > 0 ? fmtUsd(r.cacheSavedUSD) : '')
      : t.histUnpricedTip;
    fullText = baseFull + phaseLine + costLine;
  }

  return (
    <div
      className={`history-row${isLatest ? ' is-latest' : ''}${expanded ? ' is-expanded' : ''}`}
      onClick={() => onToggle(r.idx, hasDetail)}
    >
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-[5px] min-w-0 flex-1">
          <span className="font-hud-mono text-[11px] text-hud-muted shrink-0">#{r.idx + 1}</span>
          <span className="history-model">{modelTag}</span>
          <span className={`cache-pill ${cTier}`}>{cPct}</span>
          {r.priced && (
            <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums whitespace-nowrap">
              {fmtUsd(r.costUSD)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-hud-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
            {primary}
          </span>
          <span className="history-e2e font-hud-mono text-[10.5px] text-hud-muted tabular-nums whitespace-nowrap">
            E2E {fmtTps(r.e2eTps)}
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
          {contentSrc ? (
            <ContentBlocks item={contentSrc} t={t} />
          ) : isLoading ? (
            <div className="text-[11px] text-hud-muted font-hud-mono py-0.5">{t.loadingDetail}</div>
          ) : hasDetail ? (
            <div className="text-[11px] text-hud-muted font-hud-mono py-0.5">{t.noDetailBody}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
