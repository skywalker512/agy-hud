import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AccountTab } from './components/account/AccountTab';
import { CallsTab } from './components/calls/CallsTab';
import { TooltipPortal } from './components/common/TooltipPortal';
import { PulseBar } from './components/layout/PulseBar';
import { TabNav } from './components/layout/TabNav';
import { TopBar } from './components/layout/TopBar';
import { LiveTab } from './components/live/LiveTab';
import { useHudStore } from './hooks/useHudStore';
import { NowProvider } from './hooks/useNow';
import { useThemeSync } from './hooks/useThemeSync';
import type { HudTab } from './types/telemetry';

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
  const [dockStuck, setDockStuck] = useState(false);
  const [heroPassed, setHeroPassed] = useState(false);
  const updateHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyDockRef = useRef<HTMLDivElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const heroSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (updateHighlightTimerRef.current) clearTimeout(updateHighlightTimerRef.current);
    };
  }, []);

  // Keep --hud-sticky-h synced to the unified PulseBar + TabNav dock height
  useEffect(() => {
    const el = stickyDockRef.current;
    if (!el) return;
    const syncHeight = () => {
      const h = Math.floor(el.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--hud-sticky-h', `${h}px`);
      }
    };
    syncHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track when the sticky dock is pinned at viewport top for subtle elevation
  useEffect(() => {
    const sentinel = stickySentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setDockStuck(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Smart PulseBar: on Live tab, reveal PulseBar ONLY when scrolled past HeroSpeedCards
  useEffect(() => {
    if (store.tab !== 'live') {
      setHeroPassed(false);
      return;
    }
    const sentinel = heroSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      setHeroPassed(false);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Reveal PulseBar when sentinel has scrolled above viewport top
        setHeroPassed(!entry.isIntersecting && entry.boundingClientRect.top < 80);
      },
      { threshold: 0, rootMargin: '-46px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [store.tab]);

  const handleSwitchTab = useCallback(
    (next: HudTab) => {
      const changed = next !== store.tab;
      store.switchTab(next);
      if (changed) {
        setHeroPassed(false);
        if (window.scrollY > 0) {
          window.scrollTo(0, 0);
        }
      }
    },
    [store.switchTab, store.tab],
  );

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
        handleSwitchTab('live');
      } else if (e.key === '2') {
        handleSwitchTab('calls');
      } else if (e.key === '3') {
        handleSwitchTab('account');
      } else if (e.key === '/') {
        e.preventDefault();
        if (store.tab !== 'calls') {
          store.switchTab('calls');
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const input = document.getElementById('call-log-search') as HTMLInputElement | null;
            input?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            input?.focus();
            input?.select();
          });
        });
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleSwitchTab, store.switchTab, store.tab]);

  const totalCalls = snap?.found ? snap.invocations?.length || 0 : 0;
  const showEmptyBox = Boolean(snap && !snap.found);
  const showPulseBar = store.tab !== 'live' || heroPassed;

  return (
    <NowProvider isActiveStep={Boolean(snap?.activeStep)} clockSkewMs={store.clockSkewMs}>
    <div className="hud-shell">
      <TopBar
        snap={snap}
        retrying={store.retrying}
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

      <div ref={stickySentinelRef} className="h-0 -my-[5px] pointer-events-none" aria-hidden="true" />
      <div
        ref={stickyDockRef}
        className={`hud-sticky-dock${dockStuck ? ' is-stuck' : ''}`}
      >
        <PulseBar snap={snap} t={t} visible={showPulseBar} />
        <TabNav
          tab={store.tab}
          totalCalls={totalCalls}
          t={t}
          onSwitchTab={handleSwitchTab}
        />
      </div>

      {store.tab === 'live' && (
        <LiveTab
          snap={snap}
          lang={store.lang}
          recentOpen={store.recentOpen}
          expandedRows={store.expandedRows}
          expandedCompacts={store.expandedCompacts}
          collapsedTurns={store.collapsedTurns}
          compactOnly={store.compactOnly}
          detailCache={store.detailCache}
          detailLoading={store.detailLoading}
          t={t}
          heroSentinelRef={heroSentinelRef}
          onToggleRecentOpen={store.toggleRecentOpen}
          onViewAll={() => handleSwitchTab('calls')}
          onOpenAccount={() => handleSwitchTab('account')}
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
          t={t}
          updateStatus={store.updateStatus}
          updateChecking={store.updateChecking}
          updateApplying={store.updateApplying}
          updateApplyResult={store.updateApplyResult}
          updateError={store.updateError}
          highlightUpdates={highlightUpdates}
          pulseRefreshing={store.pulseRefreshing}
          onRefreshQuota={store.refreshQuota}
          onRefreshPulse={store.refreshGeminiPulse}
          onTogglePulse={store.toggleGeminiPulse}
          onCheckUpdates={store.checkForUpdates}
          onApplyUpdate={store.applyUpdate}
        />
      )}

      {showEmptyBox && (
        <div className="px-3 py-[18px] text-center text-[12px] text-hud-muted hud-card">
          {t.noDbEmpty}
        </div>
      )}

      <TooltipPortal snap={snap} t={t} loadCallDetail={store.loadCallDetail} />
    </div>
    </NowProvider>
  );
}
