import { memo } from 'preact/compat';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { TrendTranslations } from '../../../i18n/trend';
import type { ChartMetric, Compaction, Invocation } from '../../../types/telemetry';
import {
  centerViewRangeAt,
  clamp,
  getMetricValue,
  locateMinimapCompactionFractions,
  panViewRange,
  zoomViewRange,
  type RangePreset,
  type ViewRange,
} from '../trendMath';

type BrushMode = 'pan' | 'resize-left' | 'resize-right';

interface TrendMinimapProps {
  filteredInvs: Invocation[];
  compactions: Compaction[];
  metric: ChartMetric;
  svgW: number;
  minimapH: number;
  totalCount: number;
  minSpan: number;
  safeRange: ViewRange;
  followLive: boolean;
  isZoomed: boolean;
  tt: TrendTranslations;
  onRangeChange: (range: ViewRange, followLive: boolean, preset: RangePreset) => void;
  onClearHover: () => void;
  onFollowLive: () => void;
}

function TrendMinimapImpl({
  filteredInvs,
  compactions,
  metric,
  svgW,
  minimapH,
  totalCount,
  minSpan,
  safeRange,
  followLive,
  isZoomed,
  tt,
  onRangeChange,
  onClearHover,
  onFollowLive,
}: TrendMinimapProps) {
  const minimapSvgRef = useRef<SVGSVGElement>(null);
  const [brushDragging, setBrushDragging] = useState(false);

  const miniPadX = 3;
  const miniPlotW = Math.max(40, svgW - miniPadX * 2);
  const miniInnerTop = 3;
  const miniInnerH = Math.max(10, minimapH - 6);

  const minimapData = useMemo(() => {
    const vals = filteredInvs.map((r) => getMetricValue(r, metric));
    const maxV = Math.max(metric === 'cache' || metric === 'ctx' ? 100 : 1e-6, ...vals);
    const isBars = metric === 'out' || metric === 'quota';
    const compactFracs = locateMinimapCompactionFractions(filteredInvs, compactions);
    const compactXs = compactFracs.map((f) => miniPadX + f * miniPlotW);

    if (isBars) {
      const bucketCount = Math.min(totalCount, Math.max(40, Math.floor(miniPlotW / 3)));
      const bars: Array<{ x: number; h: number }> = [];
      for (let b = 0; b < bucketCount; b++) {
        const s = Math.floor((b * totalCount) / bucketCount);
        const eIdx = Math.max(s + 1, Math.floor(((b + 1) * totalCount) / bucketCount));
        let peak = 0;
        for (let k = s; k < eIdx; k++) {
          if (vals[k] > peak) peak = vals[k];
        }
        const x = miniPadX + ((b + 0.5) / bucketCount) * miniPlotW;
        const bh = Math.max(1.5, clamp(peak / maxV, 0, 1) * miniInnerH);
        bars.push({ x, h: bh });
      }
      return { isBars: true, path: '', areaPath: '', bars, compactXs };
    }

    const maxPts = 220;
    const stride = totalCount > maxPts ? totalCount / maxPts : 1;
    const pts: Array<{ x: number; y: number }> = [];
    const steps = stride > 1 ? maxPts : totalCount;
    for (let i = 0; i < steps; i++) {
      const idx = Math.min(totalCount - 1, Math.round(i * stride));
      const x = miniPadX + (idx / Math.max(1, totalCount - 1)) * miniPlotW;
      const y = miniInnerTop + miniInnerH - clamp(vals[idx] / maxV, 0, 1) * miniInnerH;
      pts.push({ x, y });
    }
    if (pts.length && pts[pts.length - 1].x < miniPadX + miniPlotW - 0.5) {
      const lastVal = vals[totalCount - 1];
      pts.push({
        x: miniPadX + miniPlotW,
        y: miniInnerTop + miniInnerH - clamp(lastVal / maxV, 0, 1) * miniInnerH,
      });
    }
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const baseY = (miniInnerTop + miniInnerH).toFixed(1);
    const areaPath =
      pts.length >= 2
        ? `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${baseY} L ${pts[0].x.toFixed(1)} ${baseY} Z`
        : '';
    return { isBars: false, path: linePath, areaPath, bars: [], compactXs };
  }, [filteredInvs, metric, compactions, miniPlotW, miniInnerH, totalCount]);

  const rawVx1 = totalCount > 1 ? miniPadX + (safeRange.start / (totalCount - 1)) * miniPlotW : miniPadX;
  const rawVx2 = totalCount > 1 ? miniPadX + (safeRange.end / (totalCount - 1)) * miniPlotW : miniPadX + miniPlotW;
  const minWinPx = 14;
  let vx1 = rawVx1;
  let vx2 = rawVx2;
  if (vx2 - vx1 < minWinPx) {
    const mid = (vx1 + vx2) / 2;
    vx1 = clamp(mid - minWinPx / 2, miniPadX, miniPadX + miniPlotW - minWinPx);
    vx2 = vx1 + minWinPx;
  }

  const brushRef = useRef<{
    active: boolean;
    pointerId: number;
    mode: BrushMode;
    startX: number;
    initRange: ViewRange;
  }>({
    active: false,
    pointerId: -1,
    mode: 'pan',
    startX: 0,
    initRange: { start: 0, end: 0 },
  });

  const getMiniX = (clientX: number): number => {
    const svg = minimapSvgRef.current;
    if (!svg) return miniPadX;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return miniPadX;
    return ((clientX - rect.left) / rect.width) * svgW;
  };

  const miniXToIndex = (mx: number): number => {
    if (totalCount <= 1) return 0;
    const ratio = clamp((mx - miniPadX) / Math.max(1, miniPlotW), 0, 1);
    return Math.round(ratio * (totalCount - 1));
  };

  const handleMiniPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const svg = minimapSvgRef.current;
    if (!svg) return;
    const mx = clamp(getMiniX(e.clientX), miniPadX, miniPadX + miniPlotW);
    onClearHover();

    let mode: BrushMode = 'pan';
    let initRange = safeRange;

    if (Math.abs(mx - vx1) <= 7) {
      mode = 'resize-left';
    } else if (Math.abs(mx - vx2) <= 7) {
      mode = 'resize-right';
    } else if (mx >= vx1 && mx <= vx2) {
      mode = 'pan';
    } else {
      const clickedIdx = miniXToIndex(mx);
      const centered = centerViewRangeAt(safeRange, totalCount, clickedIdx);
      initRange = centered.range;
      onRangeChange(centered.range, centered.followLive, centered.followLive ? 'all' : 'custom');
      mode = 'pan';
    }

    brushRef.current = {
      active: true,
      pointerId: e.pointerId,
      mode,
      startX: mx,
      initRange,
    };
    setBrushDragging(true);
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handleMiniPointerMove = (e: PointerEvent) => {
    const b = brushRef.current;
    if (!b.active || b.pointerId !== e.pointerId || totalCount <= 1) return;
    const mx = clamp(getMiniX(e.clientX), miniPadX, miniPadX + miniPlotW);
    const deltaIdx = Math.round(((mx - b.startX) / Math.max(1, miniPlotW)) * (totalCount - 1));

    if (b.mode === 'pan') {
      const next = panViewRange(b.initRange, totalCount, deltaIdx);
      onRangeChange(next.range, next.followLive, next.followLive ? 'all' : 'custom');
    } else if (b.mode === 'resize-left') {
      const maxStart = b.initRange.end - minSpan + 1;
      const nextStart = clamp(b.initRange.start + deltaIdx, 0, Math.max(0, maxStart));
      const nextRange = { start: nextStart, end: b.initRange.end };
      const isFull = nextRange.start === 0 && nextRange.end === totalCount - 1;
      onRangeChange(nextRange, isFull ? true : nextRange.end >= totalCount - 1 && followLive, isFull ? 'all' : 'custom');
    } else if (b.mode === 'resize-right') {
      const minEnd = b.initRange.start + minSpan - 1;
      const nextEnd = clamp(b.initRange.end + deltaIdx, Math.min(totalCount - 1, minEnd), totalCount - 1);
      const nextRange = { start: b.initRange.start, end: nextEnd };
      const isFull = nextRange.start === 0 && nextRange.end === totalCount - 1;
      onRangeChange(nextRange, isFull ? true : nextEnd >= totalCount - 1, isFull ? 'all' : 'custom');
    }
  };

  const handleMiniPointerUp = (e: PointerEvent) => {
    const b = brushRef.current;
    if (!b.active || b.pointerId !== e.pointerId) return;
    const svg = minimapSvgRef.current;
    if (svg) {
      try {
        if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    b.active = false;
    setBrushDragging(false);
  };

  const handleMiniDoubleClick = () => {
    onRangeChange({ start: 0, end: Math.max(0, totalCount - 1) }, true, 'all');
    onClearHover();
  };

  const handleMiniKeyDown = (e: KeyboardEvent) => {
    const span = safeRange.end - safeRange.start + 1;
    const step = Math.max(1, Math.round(span * 0.25));
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = panViewRange(safeRange, totalCount, -step);
      onRangeChange(next.range, next.followLive, next.followLive ? 'all' : 'custom');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = panViewRange(safeRange, totalCount, step);
      onRangeChange(next.range, next.followLive, next.followLive ? 'all' : 'custom');
    } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = zoomViewRange(safeRange, totalCount, 0.5, 0.5, followLive);
      onRangeChange(next.range, next.followLive, next.preset);
    } else if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = zoomViewRange(safeRange, totalCount, 2, 0.5, followLive);
      onRangeChange(next.range, next.followLive, next.preset);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const next = panViewRange(safeRange, totalCount, -totalCount);
      onRangeChange(next.range, next.followLive, 'custom');
    } else if (e.key === 'End') {
      e.preventDefault();
      const next = panViewRange(safeRange, totalCount, totalCount);
      onRangeChange(next.range, next.followLive, next.followLive ? 'all' : 'custom');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onFollowLive();
    }
  };

  const firstCallNum = filteredInvs[safeRange.start]?.idx != null ? filteredInvs[safeRange.start].idx + 1 : safeRange.start + 1;
  const lastCallNum = filteredInvs[safeRange.end]?.idx != null ? filteredInvs[safeRange.end].idx + 1 : safeRange.end + 1;

  return (
    <div className="w-full min-w-0 mt-px select-none" title={tt.minimapTip}>
      <svg
        ref={minimapSvgRef}
        className="trend-minimap-svg block w-full rounded-[5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-hud-accent"
        style={{ height: `${minimapH}px` }}
        viewBox={`0 0 ${svgW} ${minimapH}`}
        tabIndex={0}
        role="slider"
        aria-label={tt.minimapAria}
        aria-valuemin={1}
        aria-valuemax={totalCount}
        aria-valuenow={safeRange.end + 1}
        aria-valuetext={tt.viewingRange(firstCallNum, lastCallNum, totalCount, isZoomed)}
        onPointerDown={handleMiniPointerDown}
        onPointerMove={handleMiniPointerMove}
        onPointerUp={handleMiniPointerUp}
        onPointerCancel={handleMiniPointerUp}
        onDblClick={handleMiniDoubleClick}
        onKeyDown={handleMiniKeyDown}
      >
        <rect
          className="trend-minimap-track"
          x="0.5"
          y="0.5"
          width={Math.max(1, svgW - 1)}
          height={Math.max(1, minimapH - 1)}
          rx="4"
        />

        {minimapData.isBars ? (
          <g opacity="0.48">
            {minimapData.bars.map((b, bi) => (
              <rect
                key={bi}
                x={(b.x - 1).toFixed(1)}
                y={(miniInnerTop + miniInnerH - b.h).toFixed(1)}
                width="2"
                height={b.h.toFixed(1)}
                rx="0.7"
                fill="var(--hud-muted)"
              />
            ))}
          </g>
        ) : (
          <g>
            {minimapData.areaPath && <path d={minimapData.areaPath} fill="var(--hud-muted)" opacity="0.16" />}
            {minimapData.path && (
              <path
                d={minimapData.path}
                fill="none"
                stroke="var(--hud-muted)"
                stroke-width="1.15"
                opacity="0.58"
                stroke-linejoin="round"
              />
            )}
          </g>
        )}

        {minimapData.compactXs.map((cx, ci) => (
          <line
            key={`mcmp-${ci}`}
            x1={cx.toFixed(1)}
            y1="2"
            x2={cx.toFixed(1)}
            y2={(minimapH - 2).toFixed(1)}
            stroke="var(--seg-think)"
            stroke-width="1.2"
            opacity="0.78"
          />
        ))}

        {vx1 > miniPadX && (
          <rect
            className="trend-minimap-dim"
            x="1"
            y="1"
            width={Math.max(0, vx1 - 1).toFixed(1)}
            height={Math.max(0, minimapH - 2)}
            rx="3"
          />
        )}
        {vx2 < svgW - 1 && (
          <rect
            className="trend-minimap-dim"
            x={vx2.toFixed(1)}
            y="1"
            width={Math.max(0, svgW - 1 - vx2).toFixed(1)}
            height={Math.max(0, minimapH - 2)}
            rx="3"
          />
        )}

        <rect
          className={`trend-minimap-window${brushDragging ? ' is-dragging' : ''}`}
          x={vx1.toFixed(1)}
          y="1.5"
          width={Math.max(4, vx2 - vx1).toFixed(1)}
          height={Math.max(4, minimapH - 3)}
          rx="3"
        />

        <rect
          className="trend-minimap-handle"
          x={Math.max(1, vx1 - 2.5).toFixed(1)}
          y="3"
          width="5"
          height={Math.max(4, minimapH - 6)}
          rx="2"
        />
        <line
          className="trend-minimap-grip"
          x1={Math.max(3.5, vx1).toFixed(1)}
          y1={(minimapH * 0.34).toFixed(1)}
          x2={Math.max(3.5, vx1).toFixed(1)}
          y2={(minimapH * 0.66).toFixed(1)}
        />
        <rect
          className="trend-minimap-handle-hit"
          x={Math.max(0, vx1 - 6).toFixed(1)}
          y="0"
          width="12"
          height={minimapH}
        />

        <rect
          className="trend-minimap-handle"
          x={Math.min(svgW - 6, vx2 - 2.5).toFixed(1)}
          y="3"
          width="5"
          height={Math.max(4, minimapH - 6)}
          rx="2"
        />
        <line
          className="trend-minimap-grip"
          x1={Math.min(svgW - 3.5, vx2).toFixed(1)}
          y1={(minimapH * 0.34).toFixed(1)}
          x2={Math.min(svgW - 3.5, vx2).toFixed(1)}
          y2={(minimapH * 0.66).toFixed(1)}
        />
        <rect
          className="trend-minimap-handle-hit"
          x={Math.max(0, vx2 - 6).toFixed(1)}
          y="0"
          width="12"
          height={minimapH}
        />
      </svg>
    </div>
  );
}

export const TrendMinimap = memo(TrendMinimapImpl);
