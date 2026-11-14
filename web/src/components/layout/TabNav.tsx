import type { Translations } from '../../i18n';
import type { HudTab } from '../../types/telemetry';

interface TabNavProps {
  tab: HudTab;
  totalCalls: number;
  t: Translations;
  onSwitchTab: (next: HudTab) => void;
}

export function TabNav({ tab, totalCalls, t, onSwitchTab }: TabNavProps) {
  return (
    <nav className="hud-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'live'}
        className={`hud-tab-btn${tab === 'live' ? ' is-active' : ''}`}
        onClick={() => onSwitchTab('live')}
      >
        {t.tabLive}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'calls'}
        className={`hud-tab-btn${tab === 'calls' ? ' is-active' : ''}`}
        onClick={() => onSwitchTab('calls')}
      >
        <span>{t.tabCalls}</span>
        {totalCalls > 0 && <span className="micro-badge">{totalCalls}</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'account'}
        className={`hud-tab-btn${tab === 'account' ? ' is-active' : ''}`}
        onClick={() => onSwitchTab('account')}
      >
        {t.tabAccount}
      </button>
    </nav>
  );
}
