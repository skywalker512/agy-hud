import type { Translations } from '../../i18n';
import type { CallDetailPayload, TurnSummary } from '../../types/telemetry';
import { fmtClock, fmtNum, fmtQuotaPct, fmtSec } from '../../utils/format';

interface TurnDividerProps {
  turn: TurnSummary;
  collapsed: boolean;
  convId: string;
  detailCache: Map<string, CallDetailPayload>;
  t: Translations;
  onToggle: (turnIdx: number) => void;
}

export function TurnDivider({
  turn,
  collapsed,
  convId,
  detailCache,
  t,
  onToggle,
}: TurnDividerProps) {
  const tm = fmtClock(turn.timestampMs);
  const outStr = turn.outputTokens > 0 ? fmtNum(turn.outputTokens) : '';
  const secStr = turn.totalSec > 0 ? fmtSec(turn.totalSec) : '';
  const compacts = turn.compactCount || (turn.isCompact ? 1 : 0);
  const quotaStr = fmtQuotaPct(turn.quotaPct5h);
  const stats = t.turnDividerStats(turn.callCount || 0, outStr, secStr, compacts, quotaStr);

  const cachedPrompt = convId ? detailCache.get(`${convId}:turn:${turn.turnIndex}`)?.promptFull : '';
  const promptText = cachedPrompt || turn.promptFull || turn.promptPreview || '';
  const tip = t.turnDividerTip(
    turn.turnIndex,
    tm,
    turn.callCount || 0,
    turn.outputTokens || 0,
    secStr,
    promptText,
    compacts,
    quotaStr,
  );

  const isCompactTurn = Boolean(
    turn.isCompact || ((turn.compactCount || 0) > 0 && (turn.callCount || 0) === 0),
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      data-turn-idx={turn.turnIndex}
      data-has-full={turn.hasFullPrompt && !cachedPrompt ? '1' : '0'}
      data-tip={tip}
      onClick={() => onToggle(turn.turnIndex)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(turn.turnIndex);
        }
      }}
      className={`turn-divider${isCompactTurn ? ' is-compact-turn' : ''}${collapsed ? ' is-collapsed' : ''}`}
    >
      <span className="turn-divider-badge">
        <span className="text-[9px] leading-none">{collapsed ? '▸' : '▾'}</span>
        {t.turnDividerBadge(turn.turnIndex)}
      </span>
      {tm && <span className="shrink-0 tabular-nums">{tm}</span>}
      {turn.promptPreview && (
        <span className="min-w-0 flex-initial max-w-[170px] truncate font-hud text-hud-fg opacity-80">
          {turn.promptPreview}
        </span>
      )}
      {stats && <span className="shrink-0 text-hud-muted tabular-nums">{stats}</span>}
    </div>
  );
}
