import type { Translations } from '../../i18n';
import type {
  ActiveStep,
  CallDetailPayload,
  ChartMetric,
  Compaction,
  Invocation,
  TurnSummary,
} from '../../types/telemetry';
import { CallLogCard } from './CallLogCard';
import { TrendChartCard } from './TrendChartCard';

interface CallsTabProps {
  invocations: Invocation[];
  compactions: Compaction[];
  turns: TurnSummary[];
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
  nowMs: number;
  latestContext: number;
  convId: string;
  metric: ChartMetric;
  expandedRows: Set<number>;
  expandedCompacts: Set<number>;
  collapsedTurns: Set<number>;
  compactOnly: boolean;
  showAllHistory: boolean;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  onSelectMetric: (m: ChartMetric) => void;
  onToggleCompactOnly: () => void;
  onToggleFoldAllTurns: () => void;
  onToggleShowAllHistory: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
}

export function CallsTab({
  invocations,
  compactions,
  turns,
  activeStep,
  serverTimeMs,
  nowMs,
  latestContext,
  convId,
  metric,
  expandedRows,
  expandedCompacts,
  collapsedTurns,
  compactOnly,
  showAllHistory,
  detailCache,
  detailLoading,
  t,
  onSelectMetric,
  onToggleCompactOnly,
  onToggleFoldAllTurns,
  onToggleShowAllHistory,
  onToggleTurnCollapsed,
  onToggleInvocation,
  onToggleCompact,
}: CallsTabProps) {
  return (
    <section id="tab-calls" className="flex flex-col gap-2.5 min-w-0">
      <TrendChartCard
        invocations={invocations}
        compactions={compactions}
        convId={convId}
        metric={metric}
        t={t}
        onSelectMetric={onSelectMetric}
      />
      <CallLogCard
        invocations={invocations}
        compactions={compactions}
        turns={turns}
        activeStep={activeStep}
        serverTimeMs={serverTimeMs}
        nowMs={nowMs}
        latestContext={latestContext}
        convId={convId}
        expandedRows={expandedRows}
        expandedCompacts={expandedCompacts}
        collapsedTurns={collapsedTurns}
        compactOnly={compactOnly}
        showAllHistory={showAllHistory}
        detailCache={detailCache}
        detailLoading={detailLoading}
        t={t}
        onToggleCompactOnly={onToggleCompactOnly}
        onToggleFoldAllTurns={onToggleFoldAllTurns}
        onToggleShowAllHistory={onToggleShowAllHistory}
        onToggleTurnCollapsed={onToggleTurnCollapsed}
        onToggleInvocation={onToggleInvocation}
        onToggleCompact={onToggleCompact}
      />
    </section>
  );
}
