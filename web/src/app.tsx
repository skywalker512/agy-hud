import { useCallback } from 'preact/hooks';
import { AccountTab } from './components/account/AccountTab';
import { CallsTab } from './components/calls/CallsTab';
import { TooltipPortal } from './components/common/TooltipPortal';
import { PulseBar } from './components/layout/PulseBar';
import { TabNav } from './components/layout/TabNav';
import { TopBar } from './components/layout/TopBar';
import { LiveTab } from './components/live/LiveTab';
import { useHudStore } from './hooks/useHudStore';
import { useThemeSync } from './hooks/useThemeSync';

export function App() {
  useThemeSync();
  const store = useHudStore();
  const { snap, t } = store;

  const handleInspectChildren = useCallback(() => {
    store.switchTab('live');
    requestAnimationFrame(() => {
      document.getElementById('child-sessions-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [store.switchTab]);

  const totalCalls = snap?.found ? snap.invocations?.length || 0 : 0;
  const showEmptyBox = Boolean(snap && !snap.found);

  return (
    <div className="hud-shell">
      <TopBar
        snap={snap}
        retrying={store.retrying}
        nowMs={store.nowMs}
        mode={store.mode}
        selectedConv={store.selectedConv}
        lang={store.lang}
        t={t}
        onSelectConversation={store.selectConversationOption}
        onJumpConversation={store.jumpToConversation}
        onInspectChildren={handleInspectChildren}
        onToggleLang={store.toggleLang}
      />

      <PulseBar snap={snap} nowMs={store.nowMs} t={t} />

      <TabNav
        tab={store.tab}
        totalCalls={totalCalls}
        t={t}
        onSwitchTab={store.switchTab}
      />

      {store.tab === 'live' && (
        <LiveTab
          snap={snap}
          nowMs={store.nowMs}
          recentOpen={store.recentOpen}
          expandedRows={store.expandedRows}
          expandedCompacts={store.expandedCompacts}
          collapsedTurns={store.collapsedTurns}
          compactOnly={store.compactOnly}
          detailCache={store.detailCache}
          detailLoading={store.detailLoading}
          t={t}
          onToggleRecentOpen={store.toggleRecentOpen}
          onViewAll={() => store.switchTab('calls')}
          onJumpConversation={store.jumpToConversation}
          onToggleCompactOnly={store.toggleCompactOnly}
          onToggleFoldAllTurns={store.toggleFoldAllTurns}
          onToggleTurnCollapsed={store.toggleTurnCollapsed}
          onToggleInvocation={store.toggleInvocationExpanded}
          onToggleCompact={store.toggleCompactExpanded}
        />
      )}

      {store.tab === 'calls' && (
        <CallsTab
          invocations={snap?.found ? snap.invocations || [] : []}
          compactions={snap?.found ? snap.compactions || [] : []}
          turns={snap?.found ? snap.turns || [] : []}
          activeStep={snap?.found ? snap.activeStep : null}
          serverTimeMs={snap?.serverTimeMs}
          nowMs={store.nowMs}
          latestContext={snap?.found ? snap.latest?.totalContext || 0 : 0}
          convId={snap?.conversationId || ''}
          metric={store.metric}
          expandedRows={store.expandedRows}
          expandedCompacts={store.expandedCompacts}
          collapsedTurns={store.collapsedTurns}
          compactOnly={store.compactOnly}
          showAllHistory={store.showAllHistory}
          detailCache={store.detailCache}
          detailLoading={store.detailLoading}
          t={t}
          onSelectMetric={store.setMetric}
          onToggleCompactOnly={store.toggleCompactOnly}
          onToggleFoldAllTurns={store.toggleFoldAllTurns}
          onToggleShowAllHistory={store.toggleShowAllHistory}
          onToggleTurnCollapsed={store.toggleTurnCollapsed}
          onToggleInvocation={store.toggleInvocationExpanded}
          onToggleCompact={store.toggleCompactExpanded}
        />
      )}

      {store.tab === 'account' && (
        <AccountTab
          snap={snap}
          nowMs={store.nowMs}
          t={t}
          onRefreshQuota={store.refreshQuota}
        />
      )}

      {showEmptyBox && (
        <div className="px-3 py-[18px] text-center text-[12px] text-hud-muted bg-hud-card border border-hud-border rounded-lg">
          {t.noDbEmpty}
        </div>
      )}

      <TooltipPortal snap={snap} t={t} loadCallDetail={store.loadCallDetail} />
    </div>
  );
}
