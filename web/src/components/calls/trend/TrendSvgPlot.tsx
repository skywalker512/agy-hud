import type { Translations } from '../../../i18n';
import type { TrendTranslations } from '../../../i18n/trend';
import type { ChartMetric, Invocation } from '../../../types/telemetry';
import { cacheTier, fmtSec, ttftTier } from '../../../utils/format';
import {
  buildMonotonePath,
  clamp,
  type CompactionMarker,
  type ViewportStats,
  type XLayout,
} from '../trendMath';
import { getModelKey } from './modelLabels';
import type {
  DragZoomVisual,
  GlobalRefOverlay,
  Pt,
  TrendSeries,
  XTickItem,
} from './trendBuilders';

export interface TrendSvgPlotProps {
  bindMainSvg: (node: SVGSVGElement | null) => void;
  gradPrefix: string;
  metric: ChartMetric;
  invocationsCount: number;
  visible: Invocation[];
  svgW: number;
  svgH: number;
  padLeft: number;
  padTop: number;
  chartH: number;
  yBase: number;
  plotW: number;
  yMax: number;
  yTicks: number[];
  yTickLabels: string[];
  stats: ViewportStats;
  xLayout: XLayout;
  seriesList: TrendSeries[];
  allPoints: Pt[];
  modelColorMap: Map<string, string>;
  isMultiInView: boolean;
  emaPath: string;
  emaLastY: number | null;
  compactMarkers: CompactionMarker[];
  ctxCurvePath: string;
  xTicks: XTickItem[];
  ttftSla3Y: number | null;
  ttftSla10Y: number | null;
  ttftP95Y: number | null;
  cacheTargetY: number | null;
  ctxDangerY: number | null;
  quotaAvgY: number | null;
  globalRefs: GlobalRefOverlay[];
  safeHoveredIdx: number | null;
  hoveredPt: Pt | null;
  dragZoom: DragZoomVisual | null;
  t: Translations;
  tt: TrendTranslations;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function TrendSvgPlot({
  bindMainSvg,
  gradPrefix,
  metric,
  invocationsCount,
  visible,
  svgW,
  svgH,
  padLeft,
  padTop,
  chartH,
  yBase,
  plotW,
  yMax,
  yTicks,
  yTickLabels,
  stats,
  xLayout,
  seriesList,
  allPoints,
  modelColorMap,
  isMultiInView,
  emaPath,
  emaLastY,
  compactMarkers,
  ctxCurvePath,
  xTicks,
  ttftSla3Y,
  ttftSla10Y,
  ttftP95Y,
  cacheTargetY,
  ctxDangerY,
  quotaAvgY,
  globalRefs,
  safeHoveredIdx,
  hoveredPt,
  dragZoom,
  t,
  tt,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onKeyDown,
}: TrendSvgPlotProps) {
  const valY = (val: number) => padTop + chartH - clamp(yMax > 0 ? val / yMax : 0, 0, 1) * chartH;

  if (visible.length === 0) {
    return (
      <svg className="trend-main-svg block w-full overflow-visible" style={{ height: `${svgH}px` }} viewBox={`0 0 ${svgW} ${svgH}`}>
        {[padTop, padTop + chartH * 0.5, yBase].map((gy, gi) => (
          <line
            key={gi}
            x1={padLeft}
            y1={gy.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={gy.toFixed(1)}
            stroke="var(--hud-border)"
            stroke-width="1"
            stroke-dasharray={gi === 2 ? undefined : '2 3'}
            opacity="0.45"
          />
        ))}
        <text
          x={(svgW / 2).toFixed(1)}
          y={(padTop + chartH * 0.52).toFixed(1)}
          text-anchor="middle"
          className="trend-axis-label"
          style={{ fontSize: '11px' }}
        >
          {invocationsCount > 0 ? tt.emptyFiltered : t.noCalls}
        </text>
      </svg>
    );
  }

  return (
    <svg
      ref={bindMainSvg}
      tabIndex={0}
      role="img"
      aria-label={tt.plotAria}
      className={`trend-main-svg block w-full overflow-visible focus:outline-none focus-visible:ring-1 focus-visible:ring-hud-accent rounded${dragZoom ? ' is-selecting' : ''}`}
      style={{ height: `${svgH}px` }}
      viewBox={`0 0 ${svgW} ${svgH}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <defs>
        <linearGradient id={`${gradPrefix}-ctx`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--seg-input)" stop-opacity="0.22" />
          <stop offset="100%" stop-color="var(--seg-input)" stop-opacity="0" />
        </linearGradient>
        {seriesList.map((s, si) => (
          <linearGradient key={`grad-${si}`} id={`${gradPrefix}-area-${si}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stop-color={s.color}
              stop-opacity={seriesList.length === 1 ? '0.2' : '0.1'}
            />
            <stop offset="100%" stop-color={s.color} stop-opacity="0" />
          </linearGradient>
        ))}
        <linearGradient id={`${gradPrefix}-danger`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--hud-bad)" stop-opacity="0.14" />
          <stop offset="100%" stop-color="var(--hud-bad)" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      {/* Context 80-100% shaded danger zone */}
      {ctxDangerY !== null && (
        <g>
          <rect
            x={padLeft}
            y={padTop}
            width={plotW}
            height={Math.max(0, ctxDangerY - padTop)}
            fill={`url(#${gradPrefix}-danger)`}
          />
          <line
            x1={padLeft}
            y1={ctxDangerY.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={ctxDangerY.toFixed(1)}
            stroke="var(--hud-bad)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.45"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(ctxDangerY - 2.5).toFixed(1)}
            text-anchor="end"
            className="trend-ref-label"
            fill="var(--hud-bad)"
            opacity="0.78"
          >
            {tt.refDanger80}
          </text>
        </g>
      )}

      {/* Nice Y-axis horizontal gridlines & left gutter labels */}
      {yTicks.map((tickVal, gi) => {
        const gy = valY(tickVal);
        const label = yTickLabels[gi];
        return (
          <g key={`grid-${gi}`}>
            <line
              x1={padLeft}
              y1={gy.toFixed(1)}
              x2={(padLeft + plotW).toFixed(1)}
              y2={gy.toFixed(1)}
              stroke="var(--hud-fg)"
              stroke-width="1"
              stroke-dasharray={gi === 2 ? undefined : '2 3'}
              opacity={gi === 2 ? 0.12 : 0.06}
            />
            <text
              x={(padLeft - 6).toFixed(1)}
              y={(gy + 3).toFixed(1)}
              text-anchor="end"
              className="trend-axis-label"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* TTFT SLA thresholds (3s / 10s) + P95 line */}
      {ttftSla3Y !== null && (
        <g>
          <line
            x1={padLeft}
            y1={ttftSla3Y.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={ttftSla3Y.toFixed(1)}
            stroke="var(--hud-warn)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.48"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(ttftSla3Y - 2.5).toFixed(1)}
            text-anchor="end"
            className="trend-ref-label"
            fill="var(--hud-warn)"
            opacity="0.82"
          >
            {tt.refSla3}
          </text>
        </g>
      )}
      {ttftSla10Y !== null && (
        <g>
          <line
            x1={padLeft}
            y1={ttftSla10Y.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={ttftSla10Y.toFixed(1)}
            stroke="var(--hud-bad)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.52"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(ttftSla10Y - 2.5).toFixed(1)}
            text-anchor="end"
            className="trend-ref-label"
            fill="var(--hud-bad)"
            opacity="0.85"
          >
            {tt.refSla10}
          </text>
        </g>
      )}
      {ttftP95Y !== null && (
        <g>
          <line
            x1={padLeft}
            y1={ttftP95Y.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={ttftP95Y.toFixed(1)}
            stroke="var(--hud-fg)"
            stroke-width="1"
            stroke-dasharray="4 3"
            opacity="0.28"
          />
          <rect
            className="trend-y-pill-bg"
            x={(padLeft + 3).toFixed(1)}
            y={(Math.max(padTop + 1, ttftP95Y - 10.5)).toFixed(1)}
            width={Math.max(38, `${tt.refP95} ${fmtSec(stats.p95)}`.length * 5.2 + 6)}
            height="10"
            rx="2.5"
          />
          <text
            x={(padLeft + 6).toFixed(1)}
            y={(Math.max(padTop + 8.5, ttftP95Y - 2.5)).toFixed(1)}
            text-anchor="start"
            className="trend-ref-label"
            fill="var(--hud-muted)"
          >
            {tt.refP95} {fmtSec(stats.p95)}
          </text>
        </g>
      )}

      {/* Global OpenRouter 30m P50 dashed lines rendered behind curves; pills rendered on top later */}
      {globalRefs.map((ref) => (
        <line
          key={`gref-line-${ref.family}`}
          x1={padLeft}
          y1={ref.y.toFixed(1)}
          x2={(padLeft + plotW).toFixed(1)}
          y2={ref.y.toFixed(1)}
          stroke={ref.color}
          stroke-width="1.1"
          stroke-dasharray="3 3"
          opacity="0.72"
        />
      ))}

      {/* Cache 80% target line */}
      {cacheTargetY !== null && (
        <g>
          <line
            x1={padLeft}
            y1={cacheTargetY.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={cacheTargetY.toFixed(1)}
            stroke="var(--hud-ok)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.46"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(cacheTargetY - 2.5).toFixed(1)}
            text-anchor="end"
            className="trend-ref-label"
            fill="var(--hud-ok)"
            opacity="0.82"
          >
            {tt.refTarget80}
          </text>
        </g>
      )}

      {/* Quota mean reference line */}
      {quotaAvgY !== null && (
        <g>
          <line
            x1={padLeft}
            y1={quotaAvgY.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={quotaAvgY.toFixed(1)}
            stroke="var(--hud-accent)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.42"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(quotaAvgY - 2.5).toFixed(1)}
            text-anchor="end"
            className="trend-ref-label"
            fill="var(--hud-accent-ink)"
            opacity="0.82"
          >
            {tt.refAvg}
          </text>
        </g>
      )}

      {/* Single-call reference line (n = 1 edge state) */}
      {visible.length === 1 && allPoints[0] && (
        <g>
          <line
            x1={padLeft}
            y1={allPoints[0].y.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={allPoints[0].y.toFixed(1)}
            stroke="var(--hud-accent)"
            stroke-width="1"
            stroke-dasharray="3 3"
            opacity="0.42"
          />
          <text
            x={(padLeft + plotW - 2).toFixed(1)}
            y={(padTop + 9).toFixed(1)}
            text-anchor="end"
            className="trend-axis-label"
          >
            {tt.singleCallNote}
          </text>
        </g>
      )}

      {/* Cross-metric Compaction Markers */}
      {compactMarkers.map((m, ci) => (
        <g key={`cmp-${ci}`}>
          <line
            x1={m.x.toFixed(1)}
            y1={padTop}
            x2={m.x.toFixed(1)}
            y2={yBase.toFixed(1)}
            stroke="var(--seg-think)"
            stroke-width="1.2"
            stroke-dasharray="2.5 2.5"
            opacity={metric === 'ctx' ? 0.82 : 0.56}
          />
          <polygon
            points={`${m.x.toFixed(1)},${(padTop - 3.5).toFixed(1)} ${(m.x + 3.2).toFixed(1)},${padTop.toFixed(1)} ${m.x.toFixed(1)},${(padTop + 3.5).toFixed(1)} ${(m.x - 3.2).toFixed(1)},${padTop.toFixed(1)}`}
            fill="var(--seg-think)"
            opacity={metric === 'ctx' ? 0.95 : 0.78}
          />
        </g>
      ))}

      {/* Metric: OUT (stacked thinking violet atop visible green + 5-call EMA polyline) */}
      {metric === 'out' && (
        <g>
          {visible.map((r, i) => {
            const x = xLayout.xs[i] - xLayout.barW / 2;
            const tot = Math.max(0, r.outputTokens || 0);
            const thk = Math.max(0, r.thinkingTokens || 0);
            const vis = Math.max(0, r.candidateTokens || tot - thk);
            const totH = tot > 0 ? Math.max(3, (tot / yMax) * chartH) : 1.5;
            const isHovered = safeHoveredIdx === i;

            if (tot > 0 && thk > 0 && vis > 0) {
              const thkH = Math.max(1.5, (thk / tot) * totH);
              const visH = Math.max(1.5, totH - thkH);
              const yThk = yBase - totH;
              const yVis = yBase - visH;
              return (
                <g key={`out-${r.idx}`} opacity={isHovered ? 1 : 0.88}>
                  <rect
                    className="chart-bar out-thk"
                    x={x.toFixed(1)}
                    y={yThk.toFixed(1)}
                    width={xLayout.barW.toFixed(1)}
                    height={thkH.toFixed(1)}
                    rx="1.5"
                  />
                  <rect
                    className="chart-bar out-vis"
                    x={x.toFixed(1)}
                    y={yVis.toFixed(1)}
                    width={xLayout.barW.toFixed(1)}
                    height={visH.toFixed(1)}
                    rx="1.5"
                  />
                </g>
              );
            }
            const cls = thk > vis ? 'chart-bar out-thk' : 'chart-bar out-vis';
            return (
              <rect
                key={`out-${r.idx}`}
                className={cls}
                x={x.toFixed(1)}
                y={(yBase - totH).toFixed(1)}
                width={xLayout.barW.toFixed(1)}
                height={totH.toFixed(1)}
                rx="2"
                opacity={isHovered ? 1 : 0.86}
              />
            );
          })}
          {emaPath && (
            <path
              d={emaPath}
              fill="none"
              stroke="var(--hud-fg)"
              stroke-width="1.25"
              stroke-dasharray="3 2.5"
              opacity="0.52"
              stroke-linecap="round"
            />
          )}
        </g>
      )}

      {/* Metric: CTX (monotone curve + area + model dots) */}
      {metric === 'ctx' && (
        <g>
          {ctxCurvePath && (
            <>
              <path
                d={`${ctxCurvePath} L ${allPoints[allPoints.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${allPoints[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`}
                fill={`url(#${gradPrefix}-ctx)`}
              />
              <path
                d={ctxCurvePath}
                fill="none"
                stroke="var(--seg-input)"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </>
          )}
          {allPoints.map((pt, i) => {
            const color = modelColorMap.get(getModelKey(pt.inv)) || 'var(--seg-input)';
            const isLast = i === allPoints.length - 1;
            const dense = visible.length > 56;
            if (dense && !isLast && safeHoveredIdx !== i) return null;
            return (
              <circle
                key={`ctx-pt-${pt.inv.idx}`}
                cx={pt.x.toFixed(1)}
                cy={pt.y.toFixed(1)}
                r={isLast ? 3.4 : 2.2}
                fill={color}
                stroke="var(--hud-card)"
                stroke-width="1.1"
              />
            );
          })}
        </g>
      )}

      {/* Metric: QUOTA (rounded bars colored by model or high-k multiplier) */}
      {metric === 'quota' &&
        visible.map((r, i) => {
          const x = xLayout.xs[i] - xLayout.barW / 2;
          const val = Math.max(0, r.quotaPct5h || 0);
          const barH = val > 0 ? Math.max(3, (val / yMax) * chartH) : 1.5;
          const isHighMult = (r.quotaMultiplierK || 1) >= 1.8;
          const fill = isMultiInView
            ? modelColorMap.get(getModelKey(r)) || 'var(--hud-accent)'
            : isHighMult
              ? 'var(--seg-out)'
              : 'var(--hud-accent)';
          const isEmphasized = i === visible.length - 1 || safeHoveredIdx === i;
          return (
            <rect
              key={`quota-${r.idx}`}
              x={x.toFixed(1)}
              y={(yBase - barH).toFixed(1)}
              width={xLayout.barW.toFixed(1)}
              height={barH.toFixed(1)}
              rx="2"
              fill={fill}
              opacity={isEmphasized ? 1 : 0.82}
            />
          );
        })}

      {/* Metrics: TPS / TTFT / CACHE (monotone curves + gradient area + EMA + special markers) */}
      {metric !== 'out' && metric !== 'ctx' && metric !== 'quota' && (
        <g>
          {seriesList.map((s, si) => {
            const curve = s.points.length >= 2 ? buildMonotonePath(s.points, padTop, yBase) : '';
            const meanVal = s.points.reduce((acc, p) => acc + p.val, 0) / Math.max(1, s.points.length);
            const meanY = valY(meanVal);
            const dense = visible.length > 56;

            return (
              <g key={`series-${s.key}`}>
                {s.points.length >= 2 && !(metric === 'tps' && emaPath) && (
                  <line
                    x1={padLeft}
                    y1={meanY.toFixed(1)}
                    x2={(padLeft + plotW).toFixed(1)}
                    y2={meanY.toFixed(1)}
                    stroke={s.color}
                    stroke-width="1"
                    stroke-dasharray="3 3"
                    opacity="0.26"
                  />
                )}
                {curve && (
                  <path
                    d={`${curve} L ${s.points[s.points.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${s.points[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`}
                    fill={`url(#${gradPrefix}-area-${si})`}
                  />
                )}
                {curve && (
                  <path
                    d={curve}
                    fill="none"
                    stroke={s.color}
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                )}
                {s.points.map((pt) => {
                  const isLast = pt.slotIdx === visible.length - 1;
                  const isBufNode = metric === 'tps' && pt.inv.isBuffered;
                  const isStallNode = metric === 'tps' && pt.inv.isToolStall;
                  const isLowCache =
                    metric === 'cache' && pt.inv.cacheHitPct !== null && pt.inv.cacheHitPct < 40;
                  const isSlowTtft = metric === 'ttft' && ttftTier(pt.inv.ttftSec || 0) === 'slow';
                  const isSpecial = isLast || isBufNode || isStallNode || isLowCache || isSlowTtft;

                  if (dense && !isSpecial && safeHoveredIdx !== pt.slotIdx) return null;

                  let dotFill = isBufNode ? 'var(--hud-card)' : s.color;
                  if (!isMultiInView && !isBufNode) {
                    if (metric === 'ttft') {
                      const tier = ttftTier(pt.inv.ttftSec || 0);
                      dotFill =
                        tier === 'slow' ? 'var(--hud-bad)' : tier === 'mid' ? 'var(--hud-warn)' : s.color;
                    } else if (metric === 'cache') {
                      const tier = cacheTier(pt.inv.cacheHitPct);
                      dotFill =
                        tier === 'low' ? 'var(--hud-bad)' : tier === 'mid' ? 'var(--hud-warn)' : s.color;
                    }
                  } else if (isLowCache) {
                    dotFill = 'var(--hud-bad)';
                  }

                  return (
                    <g key={`pt-${pt.inv.idx}`}>
                      {isStallNode && (
                        <circle
                          cx={pt.x.toFixed(1)}
                          cy={pt.y.toFixed(1)}
                          r={isLast ? 5.6 : 4.6}
                          fill="none"
                          stroke="var(--hud-warn)"
                          stroke-width="1.4"
                          opacity="0.92"
                        />
                      )}
                      <circle
                        cx={pt.x.toFixed(1)}
                        cy={pt.y.toFixed(1)}
                        r={isLast ? 3.5 : isBufNode ? 2.8 : 2.3}
                        fill={dotFill}
                        stroke={isBufNode ? s.color : 'var(--hud-card)'}
                        stroke-width={isBufNode ? '1.5' : '1.1'}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {metric === 'tps' && emaPath && (
            <g>
              <path
                d={emaPath}
                fill="none"
                stroke="var(--hud-fg)"
                stroke-width="1.25"
                stroke-dasharray="4 3"
                opacity="0.52"
                stroke-linecap="round"
              />
              {emaLastY !== null && (
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={clamp(emaLastY - 3.5, padTop + 8, yBase - 4).toFixed(1)}
                  text-anchor="end"
                  className="trend-ref-label"
                  fill="var(--hud-muted)"
                >
                  {tt.refEma}
                </text>
              )}
            </g>
          )}
        </g>
      )}

      {/* Multi-model phase indicator strip along X baseline */}
      {isMultiInView &&
        visible.map((r, i) => {
          const color = modelColorMap.get(getModelKey(r)) || 'var(--hud-accent)';
          const wTick = Math.max(2, Math.min(xLayout.barW, plotW / visible.length));
          const x = xLayout.xs[i] - wTick / 2;
          return (
            <rect
              key={`phase-${r.idx}`}
              x={x.toFixed(1)}
              y={(yBase + 2.5).toFixed(1)}
              width={wTick.toFixed(1)}
              height="2.5"
              rx="1"
              fill={color}
              opacity="0.86"
            />
          );
        })}

      {/* X-axis tick labels */}
      {xTicks.map((tk, ti) => (
        <text
          key={`xtick-${ti}`}
          x={tk.x.toFixed(1)}
          y={(svgH - 4).toFixed(1)}
          text-anchor={tk.anchor}
          className="trend-axis-label"
        >
          {tk.label}
        </text>
      ))}

      {/* Global OpenRouter 30m P50 pill labels rendered ABOVE curves/bars/dots */}
      {globalRefs.map((ref) => {
        const rectX =
          ref.side === 'right'
            ? Math.max(padLeft + 2, padLeft + plotW - ref.pillW - 2)
            : padLeft + 3;
        const textX = ref.side === 'right' ? rectX + ref.pillW - 4 : rectX + 4;
        return (
          <g key={`gref-pill-${ref.family}`} pointer-events="none">
            <rect
              className="trend-y-pill-bg"
              x={rectX.toFixed(1)}
              y={ref.pillY.toFixed(1)}
              width={ref.pillW.toFixed(1)}
              height="11.5"
              rx="3"
              stroke={ref.color}
              stroke-opacity="0.32"
              stroke-width="0.75"
            />
            <text
              x={textX.toFixed(1)}
              y={(ref.pillY + 8.4).toFixed(1)}
              text-anchor={ref.side === 'right' ? 'end' : 'start'}
              className="trend-ref-label"
              fill={ref.color}
            >
              {ref.label}
            </text>
          </g>
        );
      })}

      {/* Zero-lag SVG Crosshair + Horizontal Value Guide + Focus Halo */}
      {hoveredPt && (
        <g pointer-events="none">
          {(metric === 'out' || metric === 'quota') && (
            <rect
              className="trend-hover-col"
              x={(hoveredPt.x - Math.max(4, xLayout.barW * 0.65)).toFixed(1)}
              y={padTop}
              width={Math.max(8, xLayout.barW * 1.3).toFixed(1)}
              height={chartH}
              rx="2"
            />
          )}
          <line
            className="trend-crosshair-line"
            x1={hoveredPt.x.toFixed(1)}
            y1={padTop}
            x2={hoveredPt.x.toFixed(1)}
            y2={yBase.toFixed(1)}
          />
          <line
            className="trend-crosshair-guide"
            x1={padLeft}
            y1={hoveredPt.y.toFixed(1)}
            x2={(padLeft + plotW).toFixed(1)}
            y2={hoveredPt.y.toFixed(1)}
          />
          <circle
            cx={hoveredPt.x.toFixed(1)}
            cy={hoveredPt.y.toFixed(1)}
            r="6.5"
            fill={modelColorMap.get(getModelKey(hoveredPt.inv)) || 'var(--hud-accent)'}
            opacity="0.22"
          />
          <circle
            cx={hoveredPt.x.toFixed(1)}
            cy={hoveredPt.y.toFixed(1)}
            r="3.5"
            fill={modelColorMap.get(getModelKey(hoveredPt.inv)) || 'var(--hud-accent)'}
            stroke="var(--hud-card)"
            stroke-width="1.4"
          />
        </g>
      )}

      {/* Drag-to-Zoom Selection Marquee */}
      {dragZoom && (
        <g pointer-events="none">
          <rect
            className="trend-zoom-marquee"
            x={dragZoom.x1.toFixed(1)}
            y={padTop}
            width={Math.max(2, dragZoom.x2 - dragZoom.x1).toFixed(1)}
            height={chartH}
            rx="2"
          />
          <g
            transform={`translate(${clamp((dragZoom.x1 + dragZoom.x2) / 2, padLeft + 28, padLeft + plotW - 28).toFixed(1)}, ${(padTop + 13).toFixed(1)})`}
          >
            <rect className="trend-zoom-badge-bg" x="-26" y="-9" width="52" height="15" rx="4" />
            <text className="trend-zoom-badge-text" x="0" y="1.5" text-anchor="middle">
              {tt.zoomSelecting(dragZoom.count)}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
