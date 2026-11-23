import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { CallDetailPayload, Invocation, Lang } from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { formatCallJson, formatCallMarkdown } from '../../utils/exportReport';
import {
  cacheTier,
  fmtCachePct,
  fmtClock,
  fmtNum,
  fmtQuotaPct,
  fmtSec,
  fmtTps,
  fmtUsd,
  formatModelTag,
  ttftTier,
} from '../../utils/format';
import { IconCheck, IconChevronDown, IconChevronRight, IconCopy } from '../common/Icons';
import { ReplyPane, ThinkingPane, ToolsPane } from './ContentBlocks';

type InspectorTab = 'overview' | 'thinking' | 'tools' | 'reply' | 'raw';

interface InvocationRowProps {
  inv: Invocation;
  isLatest: boolean;
  expanded: boolean;
  convId: string;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  lang?: Lang;
  t: Translations;
  onToggle: (idx: number, hasDetail: boolean) => void;
  showTurnBadge?: boolean;
  highlighted?: boolean;
}

interface BarSegment {
  key: string;
  label: string;
  value: number;
  pct: number;
  widthPct: number;
  colorClass: string;
  extraClass?: string;
  tip: string;
}

function normSlug(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function allocateVisibleWidths(values: number[], minPct = 3): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v > 0 ? (v / total) * 100 : 0));
  const clamped = raw.map((p) => (p > 0 ? Math.max(minPct, p) : 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  return sum > 0 ? clamped.map((p) => (p / sum) * 100) : clamped;
}

export function InvocationRow({
  inv: r,
  isLatest,
  expanded,
  convId,
  detailCache,
  detailLoading,
  lang = 'en',
  t,
  onToggle,
  showTurnBadge = false,
  highlighted = false,
}: InvocationRowProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
  const [copiedBtn, setCopiedBtn] = useState<'md' | 'json' | 'raw-md' | 'raw-json' | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!expanded) setActiveTab('overview');
  }, [expanded, r.idx]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const modelTag = formatModelTag(r.modelId, r.modelDisplay, r.model);
  const cPct = fmtCachePct(r.cacheHitPct);
  const cTier = cacheTier(r.cacheHitPct);
  const tTier = ttftTier(r.ttftSec);

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

  const qPctStr = fmtQuotaPct(r.quotaPct5h);
  const qErrStr = r.quotaPct5hErr ? fmtQuotaPct(r.quotaPct5hErr) : '';
  const q7dStr = r.quotaPct7d ? fmtQuotaPct(r.quotaPct7d) : '';
  const multVal = r.quotaMultiplierK || 1;
  const kStr = multVal.toFixed(2);
  const isHighMult = multVal >= 1.8;
  const multBadge = isHighMult
    ? `· ${Math.abs(multVal - Math.round(multVal)) < 0.08 ? Math.round(multVal) : multVal.toFixed(1)}×`
    : '';
  const isFitted = r.quotaFitSource === 'fitted';

  const hasThinkingTab = Boolean(r.hasThinking || contentSrc?.thinkingPreview);
  const toolCallsList = contentSrc?.toolCalls || [];
  const toolCount = Math.max(r.toolCount || 0, toolCallsList.length);
  const hasToolsTab = toolCount > 0;
  const hasReplyTab = Boolean(r.hasReply || contentSrc?.replyPreview);
  const thinkingChars = Math.max(r.thinkingChars || 0, cached?.thinkingChars || 0, contentSrc?.thinkingPreview?.length || 0);
  const replyChars = Math.max(r.replyChars || 0, cached?.replyChars || 0, contentSrc?.replyPreview?.length || 0);

  // Latency proportions for collapsed 2px bottom hairline & expanded waterfall
  const ttftSec = Math.max(0, r.ttftSec || 0);
  const genSec = Math.max(0, r.genSec || 0);
  const thinkSec = Math.max(0, Math.min(genSec, r.thinkSec || 0));
  const toolSec = Math.max(0, Math.min(genSec - thinkSec, r.toolGenSec || 0));
  const streamSec = Math.max(0, genSec - thinkSec - toolSec);
  const phaseTotalSec = ttftSec + thinkSec + toolSec + streamSec;
  const displayTotalSec = Math.max(r.totalSec || 0, phaseTotalSec);

  const hairlineTotal = ttftSec + genSec;
  const hairlineTtftPct = hairlineTotal > 0 ? (ttftSec / hairlineTotal) * 100 : 0;
  const hairlineThinkPct = hairlineTotal > 0 ? (thinkSec / hairlineTotal) * 100 : 0;
  const hairlineToolPct = hairlineTotal > 0 ? (toolSec / hairlineTotal) * 100 : 0;
  const hairlineStreamPct = hairlineTotal > 0 ? Math.max(0, 100 - hairlineTtftPct - hairlineThinkPct - hairlineToolPct) : 0;

  const waterfallSegments: BarSegment[] = useMemo(() => {
    const rawItems: Array<{ key: string; label: string; value: number; colorClass: string; extraClass?: string }> = [];
    if (ttftSec > 0) {
      rawItems.push({ key: 'ttft', label: t.inspPhaseTtft, value: ttftSec, colorClass: 'bg-seg-input' });
    }
    if (thinkSec > 0) {
      rawItems.push({ key: 'think', label: t.inspPhaseThink, value: thinkSec, colorClass: 'bg-seg-think' });
    }
    if (toolSec > 0) {
      rawItems.push({
        key: 'tool',
        label: r.isToolStall ? t.inspPhaseToolStall : t.inspPhaseTool,
        value: toolSec,
        colorClass: 'bg-seg-out',
        extraClass: r.isToolStall ? 'is-stall' : undefined,
      });
    }
    if (streamSec > 0 || (rawItems.length === 0 && genSec > 0)) {
      const val = streamSec > 0 ? streamSec : genSec;
      const lbl = thinkSec === 0 && toolSec === 0 ? t.inspPhaseGen : t.inspPhaseStream;
      rawItems.push({ key: 'stream', label: lbl, value: val, colorClass: 'bg-seg-cache' });
    }
    const tot = rawItems.reduce((a, b) => a + b.value, 0);
    const widths = allocateVisibleWidths(
      rawItems.map((x) => x.value),
      3,
    );
    return rawItems.map((item, idx) => {
      const pct = tot > 0 ? (item.value / tot) * 100 : 0;
      return {
        ...item,
        pct,
        widthPct: widths[idx],
        tip: `${item.label}: ${fmtSec(item.value)} (${pct.toFixed(0)}%)`,
      };
    });
  }, [ttftSec, thinkSec, toolSec, streamSec, genSec, r.isToolStall, t]);

  // Prompt & output composition widths
  const promptTotal = Math.max(0, (r.cachedInput || 0) + (r.newInput || 0));
  const [cachedW, newInW] = allocateVisibleWidths([Math.max(0, r.cachedInput || 0), Math.max(0, r.newInput || 0)], 3);
  const outTotal = Math.max(0, r.outputTokens || 0);
  const visTok = Math.max(0, r.candidateTokens || 0);
  const thkTok = Math.max(0, r.thinkingTokens || 0);
  const [thkW, visW] = allocateVisibleWidths([thkTok, visTok], 3);
  const thkSharePct = outTotal > 0 ? Math.round((thkTok / outTotal) * 100) : 0;

  const triggerCopy = async (kind: 'md' | 'json' | 'raw-md' | 'raw-json') => {
    const payload =
      kind === 'md' || kind === 'raw-md'
        ? formatCallMarkdown(r, cached, lang)
        : formatCallJson(r, cached);
    const ok = await copyText(payload);
    if (!ok) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopiedBtn(kind);
    copyTimerRef.current = setTimeout(() => setCopiedBtn(null), 1100);
  };

  const rawJsonText = useMemo(() => {
    if (!expanded || activeTab !== 'raw') return '';
    return formatCallJson(r, cached);
  }, [expanded, activeTab, r, cached]);

  const ttftTierLabel = tTier === 'fast' ? t.inspTtftFast : tTier === 'mid' ? t.inspTtftMid : t.inspTtftSlow;
  const ttftTierColor = tTier === 'fast' ? 'text-hud-ok' : tTier === 'mid' ? 'text-hud-warn' : 'text-hud-bad';
  const cacheTierColor =
    cTier === 'good' ? 'text-hud-ok' : cTier === 'mid' ? 'text-hud-warn' : cTier === 'low' ? 'text-hud-bad' : 'text-hud-muted';

  const normModelTag = normSlug(modelTag);
  const normDisplay = normSlug(r.modelDisplay);
  const normPricing = normSlug(r.pricingKey);
  const showDisplayAlias = Boolean(r.modelDisplay && normDisplay && normDisplay !== normModelTag);
  const showPricingFallback = Boolean(
    r.pricingKey &&
      normPricing &&
      !normModelTag.startsWith(normPricing) &&
      !normPricing.startsWith(normModelTag),
  );
  const routedTipParts = [
    `${t.inspMetaRouted}: ${modelTag}`,
    r.modelDisplay ? `UI: ${r.modelDisplay}` : '',
    r.pricingKey ? `${t.inspMetaPricing}: ${r.pricingKey}` : '',
  ].filter(Boolean);
  const routedTip = routedTipParts.length > 1 ? routedTipParts.join('\n') : undefined;

  return (
    <div
      data-inv-idx={r.idx}
      className={`history-row${isLatest ? ' is-latest' : ''}${expanded ? ' is-expanded' : ''}${highlighted ? ' is-jump-highlight' : ''}`}
      onClick={() => onToggle(r.idx, hasDetail)}
    >
      {/* Collapsed Row Line 1 */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-[5px] min-w-0 flex-1 flex-wrap">
          <span className="font-hud-mono text-[11px] text-hud-muted tabular-nums shrink-0">#{r.idx + 1}</span>
          {showTurnBadge && r.turnIndex != null && (
            <span className="row-micro-pill is-turn">T#{r.turnIndex}</span>
          )}
          <span className="history-model">{modelTag}</span>
          <span className={`cache-pill ${cTier}`}>{cPct}</span>
          {r.isBuffered && <span className="row-micro-pill is-buf">{t.inspBufTag}</span>}
          {r.isToolStall && r.toolGenSec > 0 && <span className="row-micro-pill is-stall">{t.inspStallTag}</span>}
          {r.priced && (
            <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums whitespace-nowrap">
              {fmtUsd(r.costUSD)}
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
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-hud-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
            {primary}
          </span>
          <span className="history-e2e font-hud-mono text-[10.5px] text-hud-muted tabular-nums whitespace-nowrap">
            E2E {fmtTps(r.e2eTps)}
          </span>
          <span className="text-hud-muted opacity-70 inline-flex items-center">
            {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
          </span>
        </div>
      </div>

      {/* Collapsed Row Line 2 */}
      <div className="font-hud-mono text-[10.5px] leading-[1.4] text-hud-muted tabular-nums break-words">
        {detail}
      </div>

      {/* 2px Bottom-Edge Latency Proportion Hairline (collapsed state) */}
      {!expanded && hairlineTotal > 0 && (
        <div className="row-latency-hairline" aria-hidden="true">
          {hairlineTtftPct > 0 && (
            <span className="bg-seg-input" style={{ width: `${hairlineTtftPct.toFixed(2)}%` }} />
          )}
          {hairlineThinkPct > 0 && (
            <span className="bg-seg-think" style={{ width: `${hairlineThinkPct.toFixed(2)}%` }} />
          )}
          {hairlineToolPct > 0 && (
            <span className="bg-seg-out" style={{ width: `${hairlineToolPct.toFixed(2)}%` }} />
          )}
          {hairlineStreamPct > 0 && (
            <span className="bg-seg-cache" style={{ width: `${hairlineStreamPct.toFixed(2)}%` }} />
          )}
        </div>
      )}

      {/* Expanded Tabbed Call Detail Inspector */}
      {expanded && (
        <div
          className="hud-expand-anim mt-1.5 pt-2 border-t border-hud-hairline flex flex-col gap-2 cursor-default select-text min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Compact Tab Bar + Quick Copy */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
            <div
              className="inline-flex flex-wrap items-center gap-0.5 p-[2px] rounded-md bg-hud-tab-track min-w-0"
              style={{ border: '1px solid var(--hud-hairline)' }}
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'overview'}
                className={`insp-tab${activeTab === 'overview' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                {t.inspTabOverview}
              </button>
              {hasThinkingTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'thinking'}
                  className={`insp-tab${activeTab === 'thinking' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('thinking')}
                >
                  <span>{t.inspTabThinking}</span>
                  {thinkingChars > 0 && <span className="opacity-70 font-hud-mono text-[9px]">{fmtNum(thinkingChars)}</span>}
                </button>
              )}
              {hasToolsTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'tools'}
                  className={`insp-tab${activeTab === 'tools' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('tools')}
                >
                  <span>{t.inspTabTools}</span>
                  <span className="opacity-70 font-hud-mono text-[9px]">{toolCount}</span>
                </button>
              )}
              {hasReplyTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'reply'}
                  className={`insp-tab${activeTab === 'reply' ? ' is-active' : ''}`}
                  onClick={() => setActiveTab('reply')}
                >
                  <span>{t.inspTabReply}</span>
                  {replyChars > 0 && <span className="opacity-70 font-hud-mono text-[9px]">{fmtNum(replyChars)}</span>}
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'raw'}
                className={`insp-tab${activeTab === 'raw' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('raw')}
              >
                {t.inspTabRaw}
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className={`insp-copy-btn${copiedBtn === 'md' ? ' is-copied' : ''}`}
                data-tip={t.inspCopyMdReport}
                onClick={() => void triggerCopy('md')}
              >
                {copiedBtn === 'md' ? <IconCheck size={10} /> : <IconCopy size={10} />}
                <span>{t.inspCopyMd}</span>
              </button>
              <button
                type="button"
                className={`insp-copy-btn${copiedBtn === 'json' ? ' is-copied' : ''}`}
                data-tip={t.inspCopyFullJson}
                onClick={() => void triggerCopy('json')}
              >
                {copiedBtn === 'json' ? <IconCheck size={10} /> : <IconCopy size={10} />}
                <span>{t.inspCopyJson}</span>
              </button>
            </div>
          </div>

          {/* TAB 1: OVERVIEW (Instant, Zero Wait) */}
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-2 min-w-0">
              {/* 1. 4-Cell Inset Summary Strip */}
              <div className="insp-grid-4 grid grid-cols-4 gap-1.5 min-w-0">
                <div className="insp-cell">
                  <span className="insp-cell-k">{t.inspGenE2e}</span>
                  <span className="insp-cell-v">
                    {r.isBuffered ? t.inspBufTag : fmtTps(r.genTps)} / {fmtTps(r.e2eTps)}
                  </span>
                  <span className="insp-cell-sub">
                    {r.isBuffered ? `${(r.genSec * 1000).toFixed(0)}ms` : 'tok/s'}
                  </span>
                </div>

                <div className="insp-cell">
                  <span className="insp-cell-k">{t.inspTtftTotal}</span>
                  <span className="insp-cell-v">
                    {fmtSec(r.ttftSec)} / {fmtSec(displayTotalSec)}
                  </span>
                  <span className={`insp-cell-sub font-semibold ${ttftTierColor}`}>{ttftTierLabel}</span>
                </div>

                <div className="insp-cell">
                  <span className="insp-cell-k">{t.inspCacheHit}</span>
                  <span className={`insp-cell-v ${cacheTierColor}`}>{cPct}</span>
                  <span className="insp-cell-sub">
                    {r.cacheSavedUSD > 0 ? t.inspSaved(fmtUsd(r.cacheSavedUSD)) : t.inspCachedTok(fmtNum(r.cachedInput))}
                  </span>
                </div>

                <div className="insp-cell">
                  <span className="insp-cell-k">{t.inspCostQuota}</span>
                  <span className="insp-cell-v">
                    {r.priced ? fmtUsd(r.costUSD) : t.inspUnpriced}
                    {qPctStr ? ` · -${qPctStr}` : ''}
                  </span>
                  <span className="insp-cell-sub">
                    {qPctStr || r.quotaMultiplierK
                      ? `${kStr}× · ${isFitted ? t.inspFitFitted : t.inspFitProv}${q7dStr ? ` · 7d -${q7dStr}` : ''}`
                      : r.pricingKey || '--'}
                  </span>
                </div>
              </div>

              {/* 2. Proportional Timing Waterfall Bar */}
              <div className="rounded-md bg-hud-card px-2.5 py-2 flex flex-col gap-1.5 min-w-0" style={{ border: '1px solid var(--hud-hairline)' }}>
                <div className="flex items-center justify-between gap-2 font-hud-mono text-[9.5px] text-hud-muted tabular-nums">
                  <span className="font-hud font-semibold uppercase tracking-[0.04em]">{t.inspWaterfallTitle}</span>
                  <span>
                    0s — {fmtSec(displayTotalSec / 2)} — {fmtSec(displayTotalSec)}
                  </span>
                </div>

                <div className="w-full h-[9px] rounded-full flex overflow-hidden gap-[1.5px] bg-hud-fill">
                  {waterfallSegments.map((seg) => (
                    <span
                      key={seg.key}
                      className={`insp-wf-seg h-full first:rounded-l-full last:rounded-r-full transition-opacity hover:opacity-85 ${seg.colorClass}${seg.extraClass ? ` ${seg.extraClass}` : ''}`}
                      style={{ width: `${seg.widthPct.toFixed(2)}%` }}
                      data-tip={seg.tip}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums">
                  {waterfallSegments.map((seg) => (
                    <span key={seg.key} className="inline-flex items-center gap-1">
                      <span className={`inline-block w-[7px] h-[7px] rounded-[2px] shrink-0 ${seg.colorClass}`} />
                      <span className="font-hud text-hud-fg font-medium">{seg.label}</span>
                      <span>
                        {fmtSec(seg.value)} ({seg.pct.toFixed(0)}%)
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* 3. Token Composition Bar + Deduplicated Metadata Footer */}
              <div className="rounded-md bg-hud-card px-2.5 py-2 flex flex-col gap-1.5 min-w-0" style={{ border: '1px solid var(--hud-hairline)' }}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-hud-mono text-[9.5px] text-hud-muted tabular-nums">
                  <span className="font-hud font-semibold uppercase tracking-[0.04em]">{t.inspTokenCompTitle}</span>
                  <span>
                    {t.inspPromptLbl(fmtNum(promptTotal), cPct)} · {t.inspOutputLbl(fmtNum(outTotal), thkSharePct)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="h-[8px] rounded-[4px] flex overflow-hidden gap-[1px] bg-hud-fill flex-[7] min-w-0">
                    {r.cachedInput > 0 && (
                      <span
                        className="h-full bg-seg-cache"
                        style={{ width: `${cachedW.toFixed(2)}%` }}
                        data-tip={`${t.inspCachedSeg}: ${r.cachedInput.toLocaleString()} tok (${cPct})`}
                      />
                    )}
                    {r.newInput > 0 && (
                      <span
                        className="h-full bg-seg-input"
                        style={{ width: `${newInW.toFixed(2)}%` }}
                        data-tip={`${t.inspNewInSeg}: ${r.newInput.toLocaleString()} tok`}
                      />
                    )}
                  </div>
                  <span className="text-hud-muted/60 font-hud-mono text-[10px] shrink-0">│</span>
                  <div className="h-[8px] rounded-[4px] flex overflow-hidden gap-[1px] bg-hud-fill flex-[3] min-w-[42px]">
                    {thkTok > 0 && (
                      <span
                        className="h-full bg-seg-think"
                        style={{ width: `${thkW.toFixed(2)}%` }}
                        data-tip={`${t.inspThinkSeg}: ${thkTok.toLocaleString()} tok (${thkSharePct}%)`}
                      />
                    )}
                    {visTok > 0 && (
                      <span
                        className="h-full bg-seg-out"
                        style={{ width: `${visW.toFixed(2)}%` }}
                        data-tip={`${t.inspVisibleSeg}: ${visTok.toLocaleString()} tok`}
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-[7px] h-[7px] rounded-[2px] bg-seg-cache" />
                    {t.inspCachedSeg} {fmtNum(r.cachedInput)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-[7px] h-[7px] rounded-[2px] bg-seg-input" />
                    {t.inspNewInSeg} {fmtNum(r.newInput)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-[7px] h-[7px] rounded-[2px] bg-seg-think" />
                    {t.inspThinkSeg} {fmtNum(thkTok)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-[7px] h-[7px] rounded-[2px] bg-seg-out" />
                    {t.inspVisibleSeg} {fmtNum(visTok)}
                  </span>
                </div>

                <div className="pt-1 border-t border-hud-hairline flex flex-wrap items-center gap-x-2 gap-y-0.5 font-hud-mono text-[9.5px] text-hud-muted tabular-nums">
                  <span className={routedTip ? 'cursor-help' : undefined} data-tip={routedTip}>
                    {t.inspMetaRouted}: <span className="text-hud-fg">{modelTag}</span>
                    {showDisplayAlias ? ` (${r.modelDisplay})` : ''}
                  </span>
                  <span>·</span>
                  <span>
                    {t.inspMetaCtx}: {fmtNum(r.totalContext)} / {fmtNum(r.contextLimit)} ({r.contextPct.toFixed(1)}%)
                  </span>
                  {showPricingFallback && r.pricingKey && (
                    <>
                      <span>·</span>
                      <span>
                        {t.inspMetaPricing}: {r.pricingKey}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: THINKING */}
          {activeTab === 'thinking' && (
            <ThinkingPane
              text={contentSrc?.thinkingPreview || ''}
              totalChars={thinkingChars}
              isLoading={isLoading}
              t={t}
            />
          )}

          {/* TAB 3: TOOLS */}
          {activeTab === 'tools' && (
            <ToolsPane toolCalls={toolCallsList} isLoading={isLoading} t={t} />
          )}

          {/* TAB 4: REPLY */}
          {activeTab === 'reply' && (
            <ReplyPane
              text={contentSrc?.replyPreview || ''}
              totalChars={replyChars}
              isLoading={isLoading}
              t={t}
            />
          )}

          {/* TAB 5: RAW / EXPORT */}
          {activeTab === 'raw' && (
            <div className="rounded-md bg-hud-card px-2.5 py-2 flex flex-col gap-1.5 min-w-0" style={{ border: '1px solid var(--hud-hairline)' }}>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={`insp-copy-btn${copiedBtn === 'raw-md' ? ' is-copied' : ''}`}
                  onClick={() => void triggerCopy('raw-md')}
                >
                  {copiedBtn === 'raw-md' ? <IconCheck size={10} /> : <IconCopy size={10} />}
                  <span>{copiedBtn === 'raw-md' ? t.copied : t.inspCopyMdReport}</span>
                </button>
                <button
                  type="button"
                  className={`insp-copy-btn${copiedBtn === 'raw-json' ? ' is-copied' : ''}`}
                  onClick={() => void triggerCopy('raw-json')}
                >
                  {copiedBtn === 'raw-json' ? <IconCheck size={10} /> : <IconCopy size={10} />}
                  <span>{copiedBtn === 'raw-json' ? t.copied : t.inspCopyFullJson}</span>
                </button>
              </div>
              <pre className="m-0 font-hud-mono text-[10.5px] text-hud-fg leading-[1.42] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto tabular-nums">
                {rawJsonText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
