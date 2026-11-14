import type { ComponentChildren } from 'preact';
import type { Translations } from '../../i18n';
import type {
  ActiveStep,
  CallDetailPayload,
  Compaction,
  Invocation,
  TurnSummary,
} from '../../types/telemetry';
import { CompactCard } from './CompactCard';
import { InvocationRow } from './InvocationRow';
import { LiveCallRow } from './LiveCallRow';
import { TurnDivider } from './TurnDivider';
import { buildTimelineDesc, type TimelineItem } from './timeline';

export interface CallLogCardProps {
  invocations: Invocation[];
  compactions: Compaction[];
  turns: TurnSummary[];
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
  nowMs: number;
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
}

export function CallLogCard({
  invocations,
  compactions,
  turns,
  activeStep,
  serverTimeMs,
  nowMs,
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
}: CallLogCardProps) {
  const isRecent = variant === 'recent';
  const isCollapsible = typeof onToggleOpen === 'function';
  const isOpen = isCollapsible ? Boolean(open) : true;
  const limit = initialLimit ?? (isRecent ? 6 : 40);
  const cardTitle = title ?? (isRecent ? t.recentTitle : t.histTitle);

  const hasLiveRow = Boolean(activeStep && (activeStep.stepType === 15 || activeStep.stepType === 23));
  const allFolded = turns.length > 0 && turns.every((u) => collapsedTurns.has(u.turnIndex));

  const nodes: ComponentChildren[] = [];

  if (isOpen && compactOnly) {
    if (hasLiveRow) {
      nodes.push(
        <LiveCallRow
          key="live-call"
          invCount={invocations.length}
          activeStep={activeStep}
          serverTimeMs={serverTimeMs}
          nowMs={nowMs}
          latestContext={latestContext}
          t={t}
        />,
      );
    }
    if (compactions.length > 0) {
      const revCompacts = [...compactions].reverse();
      revCompacts.forEach((c, idx) => {
        nodes.push(
          <CompactCard
            key={`cmp-${c.stepIdx}`}
            compact={c}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedCompacts.has(c.stepIdx)}
            convId={convId}
            detailCache={detailCache}
            detailLoading={detailLoading}
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
  } else if (isOpen) {
    type TimelineBlock =
      | { kind: 'turn'; turn: TurnSummary; items: ComponentChildren[] }
      | { kind: 'node'; node: ComponentChildren };

    const turnByIdx = new Map(turns.map((u) => [u.turnIndex, u]));
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
            nowMs={nowMs}
            latestContext={latestContext}
            t={t}
          />,
        );
      }
    } else if (latestTurn && (latestTurn.callCount || 0) === 0 && (latestTurn.compactCount || 0) === 0) {
      ensureTurnBlock(latestTurn.turnIndex);
    }

    const timelineDesc = buildTimelineDesc(invocations, compactions);
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
        appendToTurnOrRoot(
          turnIdx,
          <InvocationRow
            key={`inv-${r.idx}`}
            inv={r}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedRows.has(r.idx)}
            convId={convId}
            detailCache={detailCache}
            detailLoading={detailLoading}
            t={t}
            onToggle={onToggleInvocation}
          />,
        );
      } else {
        const c = entry.compact;
        appendToTurnOrRoot(
          turnIdx,
          <CompactCard
            key={`cmp-${c.stepIdx}`}
            compact={c}
            isLatest={idx === 0 && !hasLiveRow}
            expanded={expandedCompacts.has(c.stepIdx)}
            convId={convId}
            detailCache={detailCache}
            detailLoading={detailLoading}
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

  const shouldScrollInline = isRecent && (showAllHistory || (compactOnly && compactions.length > limit));

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
          {isOpen && turns.length > 0 && !compactOnly && (
            <button
              type="button"
              className={`filter-chip${allFolded ? ' is-active' : ''}`}
              onClick={onToggleFoldAllTurns}
            >
              {allFolded ? t.unfoldAllTurns : t.foldAllTurns}
            </button>
          )}
          {isOpen && compactions.length > 0 && (
            <button
              type="button"
              className={`filter-chip${compactOnly ? ' is-active' : ''}`}
              onClick={onToggleCompactOnly}
            >
              {t.compactFilterBtn(compactions.length, compactOnly)}
            </button>
          )}
          {onViewAll ? (
            <button type="button" className="link-btn" onClick={onViewAll}>
              {t.viewAll}
            </button>
          ) : (
            <span className="card-sub !mt-0">{t.histHint}</span>
          )}
          {isCollapsible && (
            <button
              type="button"
              className="collapse-btn"
              aria-expanded={isOpen}
              onClick={onToggleOpen}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          )}
        </div>
      </div>

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
