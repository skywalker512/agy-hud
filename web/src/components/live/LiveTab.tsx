import type { Translations } from '../../i18n';
import type { CallDetailPayload, Lang, StatsSnapshot } from '../../types/telemetry';
import { ContextWindowCard } from './ContextWindowCard';
import { HeroSpeedCards } from './HeroSpeedCards';
import { KpiGrid } from './KpiGrid';
import { RecentCallsCard } from './RecentCallsCard';
import { SubagentsCard } from './SubagentsCard';

interface LiveTabProps {
  snap: StatsSnapshot | null;
  nowMs: number;
  lang?: Lang;
  recentOpen: boolean;
  expandedRows: Set<number>;
  expandedCompacts: Set<number>;
  collapsedTurns: Set<number>;
  compactOnly: boolean;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  onToggleRecentOpen: () => void;
  onViewAll: () => void;
  onJumpConversation: (convId: string) => void;
  onToggleCompactOnly: () => void;
  onToggleFoldAllTurns: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
}

export function LiveTab({
  snap,
  nowMs,
  lang,
  recentOpen,
  expandedRows,
  expandedCompacts,
  collapsedTurns,
  compactOnly,
  detailCache,
  detailLoading,
  t,
  onToggleRecentOpen,
  onViewAll,
  onJumpConversation,
  onToggleCompactOnly,
  onToggleFoldAllTurns,
  onToggleTurnCollapsed,
  onToggleInvocation,
  onToggleCompact,
}: LiveTabProps) {
  const found = Boolean(snap?.found);
  const latest = found ? snap?.latest || null : null;
  const invocations = found ? snap?.invocations || [] : [];
  const compactions = found ? snap?.compactions || [] : [];
  const turns = found ? snap?.turns || [] : [];
  const children = found ? snap?.sessionInfo?.childSessions || [] : [];

  return (
    <section id="tab-live" className="flex flex-col gap-2.5 min-w-0">
      <HeroSpeedCards
        found={found}
        latest={latest}
        latestSustained={snap?.latestSustained}
        activeStep={found ? snap?.activeStep : null}
        t={t}
      />

      <ContextWindowCard snap={snap} nowMs={nowMs} t={t} />

      <KpiGrid
        found={found}
        hasLatest={Boolean(latest)}
        summary={found ? snap?.summary : undefined}
        t={t}
      />

      <RecentCallsCard
        invocations={invocations}
        compactions={compactions}
        turns={turns}
        activeStep={found ? snap?.activeStep : null}
        serverTimeMs={snap?.serverTimeMs}
        nowMs={nowMs}
        latestContext={latest?.totalContext || 0}
        convId={snap?.conversationId || ''}
        recentOpen={recentOpen}
        expandedRows={expandedRows}
        expandedCompacts={expandedCompacts}
        collapsedTurns={collapsedTurns}
        compactOnly={compactOnly}
        detailCache={detailCache}
        detailLoading={detailLoading}
        t={t}
        onToggleRecentOpen={onToggleRecentOpen}
        onViewAll={onViewAll}
        onToggleCompactOnly={onToggleCompactOnly}
        onToggleFoldAllTurns={onToggleFoldAllTurns}
        onToggleTurnCollapsed={onToggleTurnCollapsed}
        onToggleInvocation={onToggleInvocation}
        onToggleCompact={onToggleCompact}
      />

      <SubagentsCard
        found={found}
        children={children}
        sessionInfo={found ? snap?.sessionInfo || null : null}
        summary={found ? snap?.summary || null : null}
        lang={lang}
        t={t}
        onJumpConversation={onJumpConversation}
      />
    </section>
  );
}
