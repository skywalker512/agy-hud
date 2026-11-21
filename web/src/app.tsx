import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AccountTab } from './components/account/AccountTab';
import { CallsTab } from './components/calls/CallsTab';
import { TooltipPortal } from './components/common/TooltipPortal';
import { PulseBar } from './components/layout/PulseBar';
import { TabNav } from './components/layout/TabNav';
import { TopBar } from './components/layout/TopBar';
import { LiveTab } from './components/live/LiveTab';
import { useHudStore } from './hooks/useHudStore';
import { useThemeSync } from './hooks/useThemeSync';

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function App() {
  useThemeSync();
  const store = useHudStore();
  const { snap, t } = store;

  const [highlightUpdates, setHighlightUpdates] = useState(false);
  const updateHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (updateHighlightTimerRef.current) clearTimeout(updateHighlightTimerRef.current);
    };
  }, []);

  const handleInspectChildren = useCallback(() => {
    store.switchTab('live');
    requestAnimationFrame(() => {
      document.getElementById('child-sessions-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [store.switchTab]);

  const handleOpenUpdates = useCallback(() => {
    store.switchTab('account');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('plugin-updates-card')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        setHighlightUpdates(true);
        if (updateHighlightTimerRef.current) clearTimeout(updateHighlightTimerRef.current);
        updateHighlightTimerRef.current = setTimeout(() => setHighlightUpdates(false), 1250);
      });
    });
  }, [store.switchTab]);

  // Global keyboard shortcuts: 1/2/3 tabs, / call search, Esc clear/close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('agy-hud-esc'));
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (e.key === '1') {
        store.switchTab('live');
      } else if (e.key === '2') {
        store.switchTab('calls');
      } else if (e.key === '3') {
        store.switchTab('account');
      } else if (e.key === '/') {
        e.preventDefault();
        if (store.tab !== 'calls') {
          store.switchTab('calls');
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const input = document.getElementById('call-log-search') as HTMLInputElement | null;
            input?.focus();
            input?.select();
          });
        });
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store.switchTab, store.tab]);

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
        updateStatus={store.updateStatus}
        updateChecking={store.updateChecking}
        onSelectConversation={store.selectConversationOption}
        onJumpConversation={store.jumpToConversation}
        onInspectChildren={handleInspectChildren}
        onToggleLang={store.toggleLang}
        onOpenUpdates={handleOpenUpdates}
        onCheckUpdates={store.checkForUpdates}
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
          lang={store.lang}
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
          snap={snap}
          lang={store.lang}
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
          onSetCompactOnly={store.setCompactOnlyValue}
          onToggleFoldAllTurns={store.toggleFoldAllTurns}
          onToggleShowAllHistory={store.toggleShowAllHistory}
          onEnsureShowAllHistory={store.ensureShowAllHistory}
          onToggleTurnCollapsed={store.toggleTurnCollapsed}
          onUnfoldTurn={store.unfoldTurn}
          onToggleInvocation={store.toggleInvocationExpanded}
          onEnsureInvocationExpanded={store.ensureInvocationExpanded}
          onToggleCompact={store.toggleCompactExpanded}
        />
      )}

      {store.tab === 'account' && (
        <AccountTab
          snap={snap}
          nowMs={store.nowMs}
          t={t}
          updateStatus={store.updateStatus}
          updateChecking={store.updateChecking}
          updateApplying={store.updateApplying}
          updateApplyResult={store.updateApplyResult}
          updateError={store.updateError}
          highlightUpdates={highlightUpdates}
          onRefreshQuota={store.refreshQuota}
          onCheckUpdates={store.checkForUpdates}
          onApplyUpdate={store.applyUpdate}
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
