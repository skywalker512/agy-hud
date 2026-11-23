import type { Translations } from '../../i18n';
import type { HudTab } from '../../types/telemetry';
import { IconAccount, IconCalls, IconPulse } from '../common/Icons';

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
        <IconPulse size={12} className="hud-tab-icon opacity-80" />
        <span>{t.tabLive}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'calls'}
        className={`hud-tab-btn${tab === 'calls' ? ' is-active' : ''}`}
        onClick={() => onSwitchTab('calls')}
      >
        <IconCalls size={12} className="hud-tab-icon opacity-80" />
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
        <IconAccount size={12} className="hud-tab-icon opacity-80" />
        <span>{t.tabAccount}</span>
      </button>
    </nav>
  );
}
