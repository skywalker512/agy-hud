import { useEffect, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  ActiveStep,
  CallDetailPayload,
  Compaction,
  ForkInfo,
  Invocation,
  RevertEvent,
  TurnSummary,
} from '../../types/telemetry';
import { CallLogCard } from '../calls/CallLogCard';

interface RecentCallsCardProps {
  invocations: Invocation[];
  compactions: Compaction[];
  reverts?: RevertEvent[];
  forkInfo?: ForkInfo | null;
  turns: TurnSummary[];
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
  latestContext: number;
  convId: string;
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
  onToggleCompactOnly: () => void;
  onToggleFoldAllTurns: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
}

export function RecentCallsCard({
  invocations,
  compactions,
  reverts,
  forkInfo,
  turns,
  activeStep,
  serverTimeMs,
  latestContext,
  convId,
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
  onToggleCompactOnly,
  onToggleFoldAllTurns,
  onToggleTurnCollapsed,
  onToggleInvocation,
  onToggleCompact,
}: RecentCallsCardProps) {
  const [recentShowAll, setRecentShowAll] = useState(false);

  useEffect(() => {
    setRecentShowAll(false);
  }, [convId]);

  return (
    <CallLogCard
      variant="recent"
      title={t.recentTitle}
      initialLimit={6}
      open={recentOpen}
      onToggleOpen={onToggleRecentOpen}
      onViewAll={onViewAll}
      invocations={invocations}
      compactions={compactions}
      reverts={reverts}
      forkInfo={forkInfo}
      turns={turns}
      activeStep={activeStep}
      serverTimeMs={serverTimeMs}
      latestContext={latestContext}
      convId={convId}
      expandedRows={expandedRows}
      expandedCompacts={expandedCompacts}
      collapsedTurns={collapsedTurns}
      compactOnly={compactOnly}
      showAllHistory={recentShowAll}
      detailCache={detailCache}
      detailLoading={detailLoading}
      t={t}
      onToggleCompactOnly={onToggleCompactOnly}
      onToggleFoldAllTurns={onToggleFoldAllTurns}
      onToggleShowAllHistory={() => setRecentShowAll((p) => !p)}
      onToggleTurnCollapsed={onToggleTurnCollapsed}
      onToggleInvocation={onToggleInvocation}
      onToggleCompact={onToggleCompact}
    />
  );
}
