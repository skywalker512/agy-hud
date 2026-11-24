import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type {
  ActiveStep,
  CallDetailPayload,
  ChartMetric,
  Compaction,
  Invocation,
  Lang,
  StatsSnapshot,
  TurnSummary,
} from '../../types/telemetry';
import { CallLogCard, type JumpRequest } from './CallLogCard';
import { TrendChartCard } from './TrendChartCard';

interface CallsTabProps {
  snap: StatsSnapshot | null;
  lang: Lang;
  invocations: Invocation[];
  compactions: Compaction[];
  turns: TurnSummary[];
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
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
  onSetCompactOnly: (val: boolean) => void;
  onToggleFoldAllTurns: () => void;
  onToggleShowAllHistory: () => void;
  onEnsureShowAllHistory: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onUnfoldTurn: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onEnsureInvocationExpanded: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
}

export function CallsTab({
  snap,
  lang,
  invocations,
  compactions,
  turns,
  activeStep,
  serverTimeMs,
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
  onSetCompactOnly,
  onToggleFoldAllTurns,
  onToggleShowAllHistory,
  onEnsureShowAllHistory,
  onToggleTurnCollapsed,
  onUnfoldTurn,
  onToggleInvocation,
  onEnsureInvocationExpanded,
  onToggleCompact,
}: CallsTabProps) {
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  const jumpNonceRef = useRef(0);

  useEffect(() => {
    setSelectedModel('all');
    setJumpRequest(null);
  }, [convId]);

  const handleSelectModel = useCallback((modelKey: string) => {
    setSelectedModel(modelKey || 'all');
  }, []);

  const handleInspectCall = useCallback((invIdx: number) => {
    jumpNonceRef.current += 1;
    setJumpRequest({ invIdx, nonce: jumpNonceRef.current });
  }, []);

  const handleClearModel = useCallback(() => {
    setSelectedModel('all');
  }, []);

  return (
    <section id="tab-calls" className="flex flex-col gap-2.5 min-w-0">
      <TrendChartCard
        invocations={invocations}
        compactions={compactions}
        convId={convId}
        metric={metric}
        lang={lang}
        t={t}
        onSelectMetric={onSelectMetric}
        onInspectCall={handleInspectCall}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        geminiPulse={snap?.geminiPulse}
      />
      <CallLogCard
        snap={snap}
        lang={lang}
        invocations={invocations}
        compactions={compactions}
        turns={turns}
        activeStep={activeStep}
        serverTimeMs={serverTimeMs}
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
        selectedModel={selectedModel}
        onClearModel={handleClearModel}
        jumpRequest={jumpRequest}
        onToggleCompactOnly={onToggleCompactOnly}
        onSetCompactOnly={onSetCompactOnly}
        onToggleFoldAllTurns={onToggleFoldAllTurns}
        onToggleShowAllHistory={onToggleShowAllHistory}
        onEnsureShowAllHistory={onEnsureShowAllHistory}
        onToggleTurnCollapsed={onToggleTurnCollapsed}
        onUnfoldTurn={onUnfoldTurn}
        onToggleInvocation={onToggleInvocation}
        onEnsureInvocationExpanded={onEnsureInvocationExpanded}
        onToggleCompact={onToggleCompact}
      />
    </section>
  );
}
