import { memo } from 'preact/compat';
import type { TrendTranslations } from '../../../i18n/trend';
import type { ChartMetric, Invocation } from '../../../types/telemetry';
import { fmtClock } from '../../../utils/format';
import { formatPrimaryMetricValue, shortModelName } from './modelLabels';

export interface PopoverDelta {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
}

export interface PopoverGridItem {
  k: string;
  v: string;
}

interface TrendPopoverProps {
  inv: Invocation;
  metric: ChartMetric;
  modelColor: string;
  leftPx: number;
  isNarrow: boolean;
  delta: PopoverDelta | null;
  grid: PopoverGridItem[];
  canInspect: boolean;
  tt: TrendTranslations;
}

function TrendPopoverImpl({
  inv,
  metric,
  modelColor,
  leftPx,
  isNarrow,
  delta,
  grid,
  canInspect,
  tt,
}: TrendPopoverProps) {
  return (
    <div
      className={`trend-popover absolute top-1 z-[24] max-w-[calc(100%-8px)] rounded-[7px] border pointer-events-none tabular-nums flex flex-col gap-[5px] ${isNarrow ? 'w-[192px] px-2 py-1.5' : 'w-[214px] px-[9px] py-[7px]'}`}
      style={{ left: `${leftPx}px` }}
    >
      <div className="trend-pop-head flex items-center justify-between gap-1 font-hud-mono text-hud-muted min-w-0">
        <span className="inline-flex items-center gap-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="font-bold text-hud-fg">#{inv.idx + 1}</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: modelColor }} />
          <span>{shortModelName(inv)}</span>
          {inv.timestampMs > 0 && <span>· {fmtClock(inv.timestampMs)}</span>}
        </span>
        {(inv.isBuffered || inv.isToolStall) && (
          <span className="inline-flex items-center gap-[3px] shrink-0">
            {inv.isBuffered && (
              <span className="trend-pop-badge px-1 rounded-[3px] font-bold leading-[1.4] text-hud-muted bg-hud-fill border border-hud-border">
                {tt.popBadgeBuf}
              </span>
            )}
            {inv.isToolStall && (
              <span className="trend-pop-badge is-stall px-1 rounded-[3px] font-bold leading-[1.4] border">
                {tt.popBadgeStall}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-1.5 pb-1 border-b border-hud-border">
        <span className="trend-pop-val font-hud-mono font-bold leading-tight text-hud-fg">
          {formatPrimaryMetricValue(inv, metric)}
        </span>
        {delta && (
          <span className={`trend-stat-delta inline-flex items-center px-1 rounded font-hud-mono font-bold leading-[1.35] whitespace-nowrap is-${delta.tone}`}>
            {delta.text}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-[3px]">
        {grid.map((item, idx) => (
          <div key={idx} className="flex flex-col min-w-0">
            <span className="trend-pop-k font-hud-mono font-semibold tracking-[0.03em] text-hud-muted">
              {item.k}
            </span>
            <span className="trend-pop-v font-hud-mono font-semibold text-hud-fg whitespace-nowrap overflow-hidden text-ellipsis">
              {item.v}
            </span>
          </div>
        ))}
      </div>

      <div className="trend-pop-foot font-hud-mono text-hud-faint pt-0.5 border-t border-dashed border-hud-border">
        {canInspect ? tt.popHintInspectDrag : tt.popHintDragOnly}
      </div>
    </div>
  );
}

export const TrendPopover = memo(TrendPopoverImpl);
