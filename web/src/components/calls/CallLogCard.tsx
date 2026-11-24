import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  ActiveStep,
  CallDetailPayload,
  Compaction,
  Invocation,
  Lang,
  StatsSnapshot,
  TurnSummary,
} from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
import { downloadOrCopyJson, formatSessionJson, formatSessionMarkdown } from '../../utils/exportReport';
import { formatModelTag } from '../../utils/format';
import { FixedPopover } from '../common/FixedPopover';
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconSearch,
  IconX,
} from '../common/Icons';
import { SelectPopover, type SelectPopoverOption } from '../common/SelectPopover';
import { CompactCard } from './CompactCard';
import { InvocationRow } from './InvocationRow';
import { LiveCallRow } from './LiveCallRow';
import { TurnDivider } from './TurnDivider';
import { buildTimelineDesc, type TimelineItem } from './timeline';

export type CallSortMode = 'timeline' | 'slowest' | 'ttft' | 'low_tps' | 'cost';

export interface JumpRequest {
  invIdx: number;
  nonce: number;
}

export interface CallLogCardProps {
  invocations: Invocation[];
  compactions: Compaction[];
  turns: TurnSummary[];
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
  latestContext: number;
  convId: string;
  expandedRows: Set<number>;
  expandedCompacts: Set<number>;
  collapsedTurns: Set<number>;
  compactOnly: boolean;
  showAllHistory: boolean;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  onToggleCompactOnly: () => void;
  onToggleFoldAllTurns: () => void;
  onToggleShowAllHistory: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
  variant?: 'full' | 'recent';
  title?: string;
  initialLimit?: number;
  open?: boolean;
  onToggleOpen?: () => void;
  onViewAll?: () => void;
  // Optional Wave 2 Track B props (used by CallsTab full view)
  snap?: StatsSnapshot | null;
  lang?: Lang;
  selectedModel?: string;
  onClearModel?: () => void;
  jumpRequest?: JumpRequest | null;
  onSetCompactOnly?: (val: boolean) => void;
  onEnsureShowAllHistory?: () => void;
  onUnfoldTurn?: (turnIdx: number) => void;
  onEnsureInvocationExpanded?: (idx: number, hasDetail: boolean) => void;
}

function getModelKey(r: Invocation): string {
  return formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
}

function matchesSearch(
  r: Invocation,
  q: string,
  convId: string,
  turnMap: Map<number, TurnSummary>,
  detailCache: Map<string, CallDetailPayload>,
): boolean {
  if (!q) return true;
  const idxNum = String(r.idx + 1);
  if (q === idxNum || q === `#${idxNum}` || `#${idxNum}`.includes(q)) return true;

  const modelTag = formatModelTag(r.modelId, r.modelDisplay, r.model).toLowerCase();
  if (modelTag.includes(q)) return true;
  if (r.modelDisplay && r.modelDisplay.toLowerCase().includes(q)) return true;
  if (r.model && r.model.toLowerCase().includes(q)) return true;

  if (r.turnIndex != null) {
    const turn = turnMap.get(r.turnIndex);
    if (turn?.promptPreview && turn.promptPreview.toLowerCase().includes(q)) return true;
  }

  const cached = convId ? detailCache.get(`${convId}:inv:${r.idx}`) : undefined;
  const tools = cached?.toolCalls || r.toolCalls || [];
  for (const tc of tools) {
    if (tc.name && tc.name.toLowerCase().includes(q)) return true;
  }
  const think = cached?.thinkingPreview || r.thinkingPreview || '';
  if (think && think.toLowerCase().includes(q)) return true;
  const reply = cached?.replyPreview || r.replyPreview || '';
  if (reply && reply.toLowerCase().includes(q)) return true;

  return false;
}

export function CallLogCard({
  invocations,
  compactions,
  turns,
  activeStep,
  serverTimeMs,
  latestContext,
  convId,
  expandedRows,
  expandedCompacts,
  collapsedTurns,
  compactOnly,
  showAllHistory,
  detailCache,
  detailLoading,
  t,
  onToggleCompactOnly,
  onToggleFoldAllTurns,
  onToggleShowAllHistory,
  onToggleTurnCollapsed,
  onToggleInvocation,
  onToggleCompact,
  variant = 'full',
  title,
  initialLimit,
  open,
  onToggleOpen,
  onViewAll,
  snap,
  lang = 'en',
  selectedModel = '',
  onClearModel,
  jumpRequest,
  onSetCompactOnly,
  onEnsureShowAllHistory,
  onUnfoldTurn,
  onEnsureInvocationExpanded,
}: CallLogCardProps) {
  const isRecent = variant === 'recent';
  const isFull = !isRecent;
  const isCollapsible = typeof onToggleOpen === 'function';
  const isOpen = isCollapsible ? Boolean(open) : true;
  const timelineDesc = useMemo(() => buildTimelineDesc(invocations, compactions), [invocations, compactions]);
  const revCompacts = useMemo(() => [...compactions].reverse(), [compactions]);
  const limit = initialLimit ?? (isRecent ? 6 : 40);
  const cardTitle = title ?? (isRecent ? t.recentTitle : t.histTitle);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<CallSortMode>('timeline');
  const [slowTtftOnly, setSlowTtftOnly] = useState(false);
  const [lowCacheOnly, setLowCacheOnly] = useState(false);
  const [stallBufOnly, setStallBufOnly] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCloseExport = useCallback(() => setExportMenuOpen(false), []);

  // Reset local filters when conversation changes
  useEffect(() => {
    setSearchQuery('');
    setSortBy('timeline');
    setSlowTtftOnly(false);
    setLowCacheOnly(false);
    setStallBufOnly(false);
    setHighlightedIdx(null);
  }, [convId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  }, []);

  // Listen for global Escape event from App shortcuts
  useEffect(() => {
    if (!isFull) return;
    const onGlobalEsc = () => {
      setExportMenuOpen(false);
      setSearchQuery('');
    };
    window.addEventListener('agy-hud-esc', onGlobalEsc);
    return () => window.removeEventListener('agy-hud-esc', onGlobalEsc);
  }, [isFull]);

  const activeModelFilter = selectedModel && selectedModel !== 'all' ? selectedModel : '';
  const turnByIdx = useMemo(() => new Map(turns.map((u) => [u.turnIndex, u])), [turns]);

  // Anomaly counts computed over model-scoped invocations
  const modelScopedInvs = useMemo(() => {
    if (!isFull || !activeModelFilter) return invocations;
    return invocations.filter((r) => getModelKey(r) === activeModelFilter);
  }, [isFull, invocations, activeModelFilter]);

  const anomalyCounts = useMemo(() => {
    let slowTtft = 0;
    let lowCache = 0;
    let stallBuf = 0;
    for (const r of modelScopedInvs) {
      if (r.ttftSec > 3) slowTtft += 1;
      if (r.cacheHitPct !== null && r.cacheHitPct < 60) lowCache += 1;
      if (r.isToolStall || r.isBuffered) stallBuf += 1;
    }
    return { slowTtft, lowCache, stallBuf };
  }, [modelScopedInvs]);

  const trimmedSearch = searchQuery.trim().toLowerCase();
  const hasInvFilter =
    isFull &&
    (Boolean(trimmedSearch) || Boolean(activeModelFilter) || slowTtftOnly || lowCacheOnly || stallBufOnly);
  const isFlatMode = isFull && !compactOnly && (sortBy !== 'timeline' || hasInvFilter);
  const hasAnyActiveFilter = isFull && (hasInvFilter || compactOnly || sortBy !== 'timeline');

  const clearAllFilters = () => {
    setSearchQuery('');
    setSortBy('timeline');
    setSlowTtftOnly(false);
    setLowCacheOnly(false);
    setStallBufOnly(false);
    if (compactOnly) onSetCompactOnly ? onSetCompactOnly(false) : onToggleCompactOnly();
    onClearModel?.();
  };

  // Filtered & sorted flat invocations
  const flatInvocations = useMemo(() => {
    if (!isFlatMode) return [];
    const filtered = invocations.filter((r) => {
      if (activeModelFilter && getModelKey(r) !== activeModelFilter) return false;
      if (slowTtftOnly && !(r.ttftSec > 3)) return false;
      if (lowCacheOnly && !(r.cacheHitPct !== null && r.cacheHitPct < 60)) return false;
      if (stallBufOnly && !(r.isToolStall || r.isBuffered)) return false;
      if (trimmedSearch && !matchesSearch(r, trimmedSearch, convId, turnByIdx, detailCache)) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'slowest') {
      sorted.sort((a, b) => b.totalSec - a.totalSec || b.idx - a.idx);
    } else if (sortBy === 'ttft') {
      sorted.sort((a, b) => b.ttftSec - a.ttftSec || b.idx - a.idx);
    } else if (sortBy === 'low_tps') {
      sorted.sort((a, b) => {
        if (a.isBuffered !== b.isBuffered) return a.isBuffered ? 1 : -1;
        return a.genTps - b.genTps || b.idx - a.idx;
      });
    } else if (sortBy === 'cost') {
      sorted.sort(
        (a, b) =>
          (b.quotaPct5h || 0) - (a.quotaPct5h || 0) || b.costUSD - a.costUSD || b.idx - a.idx,
      );
    } else {
      sorted.sort((a, b) => b.idx - a.idx);
    }
    return sorted;
  }, [
    isFlatMode,
    invocations,
    activeModelFilter,
    slowTtftOnly,
    lowCacheOnly,
    stallBufOnly,
    trimmedSearch,
    convId,
    turnByIdx,
    detailCache,
    sortBy,
  ]);

  // Chart-to-log drill-down handler
  useEffect(() => {
    if (!isFull || !jumpRequest) return;
    const target = invocations.find((r) => r.idx === jumpRequest.invIdx);
    if (!target) return;

    if (compactOnly) {
      if (onSetCompactOnly) onSetCompactOnly(false);
      else onToggleCompactOnly();
    }
    if (activeModelFilter && getModelKey(target) !== activeModelFilter) {
      onClearModel?.();
    }
    if (slowTtftOnly && !(target.ttftSec > 3)) setSlowTtftOnly(false);
    if (lowCacheOnly && !(target.cacheHitPct !== null && target.cacheHitPct < 60)) setLowCacheOnly(false);
    if (stallBufOnly && !(target.isToolStall || target.isBuffered)) setStallBufOnly(false);
    if (trimmedSearch && !matchesSearch(target, trimmedSearch, convId, turnByIdx, detailCache)) {
      setSearchQuery('');
    }
    if (target.turnIndex != null && collapsedTurns.has(target.turnIndex)) {
      onUnfoldTurn?.(target.turnIndex);
    }
    if (!showAllHistory && invocations.length > limit) {
      // Ensure target isn't clipped by initial limit
      const rankFromEnd = invocations.length - 1 - invocations.findIndex((r) => r.idx === target.idx);
      if (rankFromEnd >= limit || isFlatMode) {
        onEnsureShowAllHistory?.();
      }
    }

    const hasDetail = Boolean(target.hasThinking || target.hasReply || (target.toolCount || 0) > 0);
    if (onEnsureInvocationExpanded) {
      onEnsureInvocationExpanded(target.idx, hasDetail);
    } else if (!expandedRows.has(target.idx)) {
      onToggleInvocation(target.idx, hasDetail);
    }

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-inv-idx="${target.idx}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setHighlightedIdx(target.idx);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedIdx((cur) => (cur === target.idx ? null : cur));
        }, 1250);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // Trigger strictly on new jumpRequest nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpRequest?.nonce]);

  const handleExportMd = async () => {
    if (!snap?.found) return;
    const ok = await copyText(formatSessionMarkdown(snap, lang));
    if (!ok) return;
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    setExportFeedback(t.copied);
    exportTimerRef.current = setTimeout(() => {
      setExportFeedback(null);
      setExportMenuOpen(false);
    }, 900);
  };

  const handleExportJson = async () => {
    if (!snap?.found) return;
    const shortId = (snap.conversationId || 'session').slice(0, 8);
    const res = await downloadOrCopyJson(`agy-hud-${shortId}.json`, formatSessionJson(snap));
    if (res === 'failed') return;
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    setExportFeedback(res === 'downloaded' ? t.exportedJsonSaved : t.exportedJsonCopied);
    exportTimerRef.current = setTimeout(() => {
      setExportFeedback(null);
      setExportMenuOpen(false);
    }, 950);
  };

  const hasLiveRow = Boolean(activeStep && (activeStep.stepType === 15 || activeStep.stepType === 23));
  const allFolded = turns.length > 0 && turns.every((u) => collapsedTurns.has(u.turnIndex));
  const latestInvIdx = invocations.length > 0 ? invocations[invocations.length - 1].idx : -1;

  const nodes: ComponentChildren[] = [];

  if (isOpen && compactOnly) {
    if (hasLiveRow) {
      nodes.push(
        <LiveCallRow
          key="live-call"
          invCount={invocations.length}
          activeStep={activeStep}
          serverTimeMs={serverTimeMs}
          latestContext={latestContext}
          t={t}
        />,
      );
    }
    if (revCompacts.length > 0) {
      revCompacts.forEach((c, idx) => {
        const cmpKey = convId ? `${convId}:compact:${c.stepIdx}` : '';
        nodes.push(
          <CompactCard
            key={`cmp-${c.stepIdx}`}
            compact={c}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedCompacts.has(c.stepIdx)}
            cached={cmpKey ? detailCache.get(cmpKey) : undefined}
            isLoading={cmpKey ? detailLoading.has(cmpKey) : false}
            t={t}
            onToggle={onToggleCompact}
          />,
        );
      });
    } else if (!hasLiveRow) {
      nodes.push(
        <div key="empty-compact" className="py-[18px] px-2 text-center text-[12px] text-hud-muted">
          {t.noCompactions}
        </div>,
      );
    }
  } else if (isOpen && isFlatMode) {
    const visibleFlat = !showAllHistory && flatInvocations.length > limit
      ? flatInvocations.slice(0, limit)
      : flatInvocations;

    visibleFlat.forEach((r) => {
      const invKey = convId ? `${convId}:inv:${r.idx}` : '';
      nodes.push(
        <InvocationRow
          key={`inv-${r.idx}`}
          inv={r}
          isLatest={r.idx === latestInvIdx && !hasLiveRow}
          expanded={expandedRows.has(r.idx)}
          cached={invKey ? detailCache.get(invKey) : undefined}
          isLoading={invKey ? detailLoading.has(invKey) : false}
          lang={lang}
          t={t}
          onToggle={onToggleInvocation}
          showTurnBadge={true}
          highlighted={highlightedIdx === r.idx}
        />,
      );
    });

    if (flatInvocations.length > limit) {
      nodes.push(
        <button
          key="toggle-all-history"
          type="button"
          onClick={onToggleShowAllHistory}
          className="w-full mt-0.5 px-2.5 py-1.5 rounded-md border border-hud-border bg-hud-fill text-hud-muted font-hud-mono text-[11px] font-semibold cursor-pointer hover:text-hud-fg hover:border-hud-accent transition-colors"
        >
          {showAllHistory ? t.collapseHistoryBtn(limit) : t.showAllHistoryBtn(visibleFlat.length, flatInvocations.length)}
        </button>,
      );
    }

    if (flatInvocations.length === 0) {
      nodes.push(
        <div key="no-match" className="py-[18px] px-2 text-center text-[12px] text-hud-muted">
          {t.filterNoMatches}
        </div>,
      );
    }
  } else if (isOpen) {
    type TimelineBlock =
      | { kind: 'turn'; turn: TurnSummary; items: ComponentChildren[] }
      | { kind: 'node'; node: ComponentChildren };

    const blocks: TimelineBlock[] = [];
    const turnBlockMap = new Map<number, { kind: 'turn'; turn: TurnSummary; items: ComponentChildren[] }>();

    const ensureTurnBlock = (turnIdx: number | null | undefined) => {
      if (!turnIdx) return null;
      const existing = turnBlockMap.get(turnIdx);
      if (existing) return existing;
      const turn = turnByIdx.get(turnIdx);
      if (!turn) return null;
      const block = { kind: 'turn' as const, turn, items: [] as ComponentChildren[] };
      turnBlockMap.set(turnIdx, block);
      blocks.push(block);
      return block;
    };

    const appendToTurnOrRoot = (turnIdx: number | null | undefined, node: ComponentChildren) => {
      const block = ensureTurnBlock(turnIdx);
      if (block) {
        block.items.push(node);
      } else {
        blocks.push({ kind: 'node', node });
      }
    };

    const latestTurn = turns.length ? turns[turns.length - 1] : null;
    if (hasLiveRow) {
      const activeTurnIdx = activeStep?.turnIndex || latestTurn?.turnIndex || null;
      ensureTurnBlock(activeTurnIdx);
      if (!activeTurnIdx || !collapsedTurns.has(activeTurnIdx)) {
        appendToTurnOrRoot(
          activeTurnIdx,
          <LiveCallRow
            key="live-call"
            invCount={invocations.length}
            activeStep={activeStep}
            serverTimeMs={serverTimeMs}
            latestContext={latestContext}
            t={t}
          />,
        );
      }
    } else if (latestTurn && (latestTurn.callCount || 0) === 0 && (latestTurn.compactCount || 0) === 0) {
      ensureTurnBlock(latestTurn.turnIndex);
    }

    let visibleItems: TimelineItem[] = timelineDesc;
    let shownInvCount = invocations.length;

    if (!showAllHistory && invocations.length > limit) {
      visibleItems = [];
      shownInvCount = 0;
      for (const item of timelineDesc) {
        if (item.kind === 'inv') {
          if (shownInvCount >= limit) break;
          shownInvCount += 1;
        }
        visibleItems.push(item);
      }
    }

    visibleItems.forEach((entry, idx) => {
      const turnIdx = entry.kind === 'inv' ? entry.inv.turnIndex : entry.compact.turnIndex;
      ensureTurnBlock(turnIdx);
      const isTurnCollapsed = Boolean(turnIdx && collapsedTurns.has(turnIdx));
      if (isTurnCollapsed) return;

      if (entry.kind === 'inv') {
        const r = entry.inv;
        const invKey = convId ? `${convId}:inv:${r.idx}` : '';
        appendToTurnOrRoot(
          turnIdx,
          <InvocationRow
            key={`inv-${r.idx}`}
            inv={r}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedRows.has(r.idx)}
            cached={invKey ? detailCache.get(invKey) : undefined}
            isLoading={invKey ? detailLoading.has(invKey) : false}
            lang={lang}
            t={t}
            onToggle={onToggleInvocation}
            highlighted={highlightedIdx === r.idx}
          />,
        );
      } else {
        const c = entry.compact;
        const cmpKey = convId ? `${convId}:compact:${c.stepIdx}` : '';
        appendToTurnOrRoot(
          turnIdx,
          <CompactCard
            key={`cmp-${c.stepIdx}`}
            compact={c}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedCompacts.has(c.stepIdx)}
            cached={cmpKey ? detailCache.get(cmpKey) : undefined}
            isLoading={cmpKey ? detailLoading.has(cmpKey) : false}
            t={t}
            onToggle={onToggleCompact}
          />,
        );
      }
    });

    for (const b of blocks) {
      if (b.kind === 'turn') {
        nodes.push(
          <div key={`turn-grp-${b.turn.turnIndex}`} className="turn-group">
            <TurnDivider
              turn={b.turn}
              collapsed={collapsedTurns.has(b.turn.turnIndex)}
              convId={convId}
              detailCache={detailCache}
              t={t}
              onToggle={onToggleTurnCollapsed}
            />
            {b.items}
          </div>,
        );
      } else {
        nodes.push(b.node);
      }
    }

    if (invocations.length > limit) {
      nodes.push(
        <button
          key="toggle-all-history"
          type="button"
          onClick={onToggleShowAllHistory}
          className="w-full mt-0.5 px-2.5 py-1.5 rounded-md border border-hud-border bg-hud-fill text-hud-muted font-hud-mono text-[11px] font-semibold cursor-pointer hover:text-hud-fg hover:border-hud-accent transition-colors"
        >
          {showAllHistory ? t.collapseHistoryBtn(limit) : t.showAllHistoryBtn(shownInvCount, invocations.length)}
        </button>,
      );
    }

    if (nodes.length === 0) {
      nodes.push(
        <div key="wait-out" className="py-[18px] px-2 text-center text-[12px] text-hud-muted">
          {t.waitOut}
        </div>,
      );
    }
  }

  const sortOptions = useMemo<SelectPopoverOption[]>(
    () => [
      { value: 'timeline', label: t.sortTimeline },
      { value: 'slowest', label: t.sortSlowest },
      { value: 'ttft', label: t.sortTtft },
      { value: 'low_tps', label: t.sortLowTps },
      { value: 'cost', label: t.sortCost },
    ],
    [t.sortTimeline, t.sortSlowest, t.sortTtft, t.sortLowTps, t.sortCost],
  );

  const shouldScrollInline = isRecent && (showAllHistory || (compactOnly && compactions.length > limit));

  const showSlowChip = anomalyCounts.slowTtft > 0 || slowTtftOnly;
  const showLowCacheChip = anomalyCounts.lowCache > 0 || lowCacheOnly;
  const showStallChip = anomalyCounts.stallBuf > 0 || stallBufOnly;
  const showCompactChip = compactions.length > 0 || compactOnly;
  const hasChipRow = Boolean(activeModelFilter) || showSlowChip || showLowCacheChip || showStallChip || showCompactChip;

  return (
    <section id={isRecent ? undefined : 'call-log-card'} className="hud-card">
      <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div
          className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0${isCollapsible ? ' cursor-pointer select-none' : ''}`}
          onClick={isCollapsible ? onToggleOpen : undefined}
        >
          <span className="card-k">{cardTitle}</span>
          {invocations.length > 0 && <span className="micro-badge">{invocations.length}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
          {isOpen && turns.length > 0 && !compactOnly && !isFlatMode && (
            <button
              type="button"
              className={`filter-chip${allFolded ? ' is-active' : ''}`}
              onClick={onToggleFoldAllTurns}
            >
              {allFolded ? t.unfoldAllTurns : t.foldAllTurns}
            </button>
          )}
          {isRecent && isOpen && compactions.length > 0 && (
            <button
              type="button"
              className={`filter-chip${compactOnly ? ' is-active' : ''}`}
              onClick={onToggleCompactOnly}
            >
              {t.compactFilterBtn(compactions.length, compactOnly)}
            </button>
          )}
          {isFull && snap?.found && invocations.length > 0 && (
            <div className="relative">
              <button
                ref={exportBtnRef}
                type="button"
                className="insp-copy-btn"
                aria-expanded={exportMenuOpen}
                onClick={() => setExportMenuOpen((p) => !p)}
              >
                {exportFeedback ? (
                  <span>{exportFeedback}</span>
                ) : (
                  <>
                    <IconDownload size={10} />
                    <span>{t.btnExport}</span>
                    <IconChevronDown size={10} />
                  </>
                )}
              </button>
              <FixedPopover
                open={exportMenuOpen}
                triggerRef={exportBtnRef}
                onClose={handleCloseExport}
                align="right"
                role="menu"
                minWidthPx={184}
                maxWidthPx={232}
              >
                <button
                  type="button"
                  onClick={() => void handleExportMd()}
                  className="w-full text-left px-2 py-[5px] border-0 rounded-[6px] bg-transparent text-hud-fg-2 text-[11px] cursor-pointer hover:bg-hud-fill hover:text-hud-fg transition-colors"
                >
                  {t.btnCopyReportMd}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportJson()}
                  className="w-full text-left px-2 py-[5px] border-0 rounded-[6px] bg-transparent text-hud-fg-2 text-[11px] cursor-pointer hover:bg-hud-fill hover:text-hud-fg transition-colors"
                >
                  {t.btnExportJson}
                </button>
              </FixedPopover>
            </div>
          )}
          {onViewAll ? (
            <button type="button" className="link-btn" onClick={onViewAll}>
              <span>{t.viewAll}</span>
              <IconArrowRight size={11} />
            </button>
          ) : (
            <span className="text-[10.5px] font-hud text-hud-muted">{t.histHint}</span>
          )}
          {isCollapsible && (
            <button
              type="button"
              className="collapse-btn"
              aria-expanded={isOpen}
              onClick={onToggleOpen}
            >
              {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* Call Explorer Toolbar (full view only) */}
      {isFull && isOpen && (invocations.length > 0 || compactions.length > 0) && (
        <div className="call-toolbar mt-2 flex flex-col gap-1.5 min-w-0">
          {/* Row 1: Instant Search + Custom SelectPopover Metric Sort */}
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <div className="relative flex items-center flex-1 min-w-[140px]">
              <span
                className="pointer-events-none absolute left-[8px] text-hud-muted inline-flex items-center"
                aria-hidden="true"
              >
                <IconSearch size={11} />
              </span>
              <input
                id="call-log-search"
                type="text"
                value={searchQuery}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
                onInput={(e) => setSearchQuery((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setSearchQuery('');
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="call-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t.filterClear}
                  onClick={() => setSearchQuery('')}
                  className="absolute right-[6px] border-0 bg-transparent text-hud-muted hover:text-hud-fg inline-flex items-center justify-center p-0.5 cursor-pointer"
                >
                  <IconX size={11} />
                </button>
              )}
            </div>

            <SelectPopover
              ariaLabel="Sort calls"
              value={sortBy}
              options={sortOptions}
              onChange={(val) => setSortBy(val as CallSortMode)}
              align="right"
              size="sm"
              className="w-auto min-w-[126px] shrink-0"
              popoverClassName="min-w-[172px]"
            />
          </div>

          {/* Row 2: Anomaly & Synced Model Filter Chips */}
          {hasChipRow && (
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              {activeModelFilter && (
                <button
                  type="button"
                  className="anomaly-chip is-model is-active"
                  onClick={() => onClearModel?.()}
                >
                  <span>{t.chipModelFilter(activeModelFilter)}</span>
                  <IconX size={10} />
                </button>
              )}
              {showSlowChip && (
                <button
                  type="button"
                  className={`anomaly-chip is-bad${slowTtftOnly ? ' is-active' : ''}`}
                  onClick={() => {
                    if (compactOnly) onSetCompactOnly ? onSetCompactOnly(false) : onToggleCompactOnly();
                    setSlowTtftOnly((p) => !p);
                  }}
                >
                  {t.chipSlowTtft(anomalyCounts.slowTtft)}
                </button>
              )}
              {showLowCacheChip && (
                <button
                  type="button"
                  className={`anomaly-chip is-warn${lowCacheOnly ? ' is-active' : ''}`}
                  onClick={() => {
                    if (compactOnly) onSetCompactOnly ? onSetCompactOnly(false) : onToggleCompactOnly();
                    setLowCacheOnly((p) => !p);
                  }}
                >
                  {t.chipLowCache(anomalyCounts.lowCache)}
                </button>
              )}
              {showStallChip && (
                <button
                  type="button"
                  className={`anomaly-chip is-warn${stallBufOnly ? ' is-active' : ''}`}
                  onClick={() => {
                    if (compactOnly) onSetCompactOnly ? onSetCompactOnly(false) : onToggleCompactOnly();
                    setStallBufOnly((p) => !p);
                  }}
                >
                  {t.chipStallBuf(anomalyCounts.stallBuf)}
                </button>
              )}
              {showCompactChip && (
                <button
                  type="button"
                  className={`anomaly-chip is-think${compactOnly ? ' is-active' : ''}`}
                  onClick={onToggleCompactOnly}
                >
                  {t.compactFilterBtn(compactions.length, compactOnly)}
                </button>
              )}
            </div>
          )}

          {/* Active Filter Count Banner */}
          {hasAnyActiveFilter && (
            <div className="l2-well flex items-center justify-between gap-2 px-2.5 py-[4px] font-hud-mono text-[10px] text-hud-muted tabular-nums">
              <span>
                {compactOnly
                  ? t.compactFilterBtn(compactions.length, true)
                  : t.filterBanner(isFlatMode ? flatInvocations.length : invocations.length, invocations.length)}
              </span>
              <button type="button" className="link-btn !py-0 !text-[10px]" onClick={clearAllFilters}>
                {t.filterClear}
              </button>
            </div>
          )}
        </div>
      )}

      {isOpen && (
        <div
          id={isRecent ? undefined : 'history-list'}
          className={`mt-2 flex flex-col gap-1.5${shouldScrollInline ? ' call-log-scroll max-h-[460px] pr-1' : ''}`}
        >
          {nodes}
        </div>
      )}
    </section>
  );
}
