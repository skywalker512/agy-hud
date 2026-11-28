import { memo } from 'preact/compat';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { Translations } from '../../i18n';
import { getTrendTranslations, resolveTrendLang } from '../../i18n/trend';
import type { ChartMetric, Compaction, GeminiPulseSnapshot, Invocation, Lang } from '../../types/telemetry';
import { GlobalTrendView, type GlobalTrendMetric } from './GlobalTrendView';
import {
  formatPrimaryMetricValue,
  getModelKey,
  readSavedPreset,
  shortModelName,
  writeSavedPreset,
} from './trend/modelLabels';
import {
  buildGlobalRefs,
  buildPopoverDelta,
  buildPopoverGrid,
  buildSessionModels,
  buildStatCells,
  getPulseMetricVal,
  type DragZoomVisual,
  type Pt,
  type TrendSeries,
  type XTickItem,
} from './trend/trendBuilders';
import { TrendMinimap } from './trend/TrendMinimap';
import { TrendPopover } from './trend/TrendPopover';
import { TrendSvgPlot } from './trend/TrendSvgPlot';
import { TrendHeader, TrendSessionStrips } from './trend/TrendToolbar';
import {
  advanceRangeOnDataUpdate,
  buildMonotonePath,
  clamp,
  clampViewRange,
  computeEma,
  computeRangeForPreset,
  computeViewportStats,
  computeXLayout,
  computeYAxisCeiling,
  findNearestIndex,
  formatTimeAxisLabel,
  formatYTick,
  getDefaultPreset,
  getMetricValue,
  getMinSpan,
  locateCompactionMarkers,
  niceMax,
  panViewRange,
  zoomViewRange,
  type AxisMode,
  type RangePreset,
  type ViewRange,
} from './trendMath';

export interface TrendChartCardProps {
  invocations: Invocation[];
  compactions?: Compaction[];
  convId: string;
  metric: ChartMetric;
  lang?: Lang;
  t: Translations;
  onSelectMetric: (m: ChartMetric) => void;
  onInspectCall?: (invIdx: number) => void;
  selectedModel?: string;
  onSelectModel?: (modelKey: string) => void;
  geminiPulse?: GeminiPulseSnapshot;
}

const RANGE_PRESETS: Array<Exclude<RangePreset, 'custom'>> = ['20', '50', '100', 'all'];

function TrendChartCardImpl({
  invocations,
  compactions = [],
  convId,
  metric,
  lang,
  t,
  onSelectMetric,
  onInspectCall,
  selectedModel: selectedModelProp,
  onSelectModel,
  geminiPulse,
}: TrendChartCardProps) {
  const resolvedLang = resolveTrendLang(lang, t);
  const tt = useMemo(() => getTrendTranslations(resolvedLang), [resolvedLang]);
  const rawId = useId();
  const gradPrefix = `tc-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [svgW, boxRef] = useElementWidth(380);
  const mainSvgRef = useRef<SVGSVGElement | null>(null);
  const [mainSvgEl, setMainSvgEl] = useState<SVGSVGElement | null>(null);
  const bindMainSvg = useCallback((node: SVGSVGElement | null) => {
    mainSvgRef.current = node;
    setMainSvgEl(node);
  }, []);

  const [internalModel, setInternalModel] = useState<string>('all');
  const [axisMode, setAxisMode] = useState<AxisMode>('seq');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [dragZoom, setDragZoom] = useState<DragZoomVisual | null>(null);
  const [chartSource, setChartSource] = useState<'session' | 'global'>('session');
  const [globalMetric, setGlobalMetric] = useState<GlobalTrendMetric>('ttft');
  const [pinnedArenaFamilies, setPinnedArenaFamilies] = useState<string[] | null>(null);

  const handleSwitchChartSource = (next: 'session' | 'global') => {
    setChartSource(next);
    if (next === 'global') {
      if (metric === 'ttft' || metric === 'tps' || metric === 'cache') {
        setGlobalMetric(metric);
      }
    } else if (globalMetric === 'ttft' || globalMetric === 'tps' || globalMetric === 'cache') {
      onSelectMetric(globalMetric);
    }
  };

  const isModelControlled = selectedModelProp !== undefined && typeof onSelectModel === 'function';
  const activeModel = isModelControlled ? selectedModelProp : internalModel;

  const setActiveModel = (next: string) => {
    if (isModelControlled) onSelectModel(next);
    else setInternalModel(next);
  };

  useEffect(() => {
    if (!isModelControlled) setInternalModel('all');
  }, [convId, isModelControlled]);

  const { sessionModels, modelColorMap } = useMemo(
    () => buildSessionModels(invocations, metric),
    [invocations, metric],
  );

  useEffect(() => {
    if (activeModel !== 'all' && invocations.length > 0 && !invocations.some((r) => getModelKey(r) === activeModel)) {
      setActiveModel('all');
    }
  }, [invocations, activeModel]);

  const filteredInvs = useMemo(
    () => (activeModel === 'all' ? invocations : invocations.filter((r) => getModelKey(r) === activeModel)),
    [invocations, activeModel],
  );
  const totalCount = filteredInvs.length;

  const [rangePreset, setRangePreset] = useState<RangePreset>(() => getDefaultPreset(totalCount, readSavedPreset()));
  const [viewRange, setViewRange] = useState<ViewRange>(() =>
    computeRangeForPreset(totalCount, getDefaultPreset(totalCount, readSavedPreset())),
  );
  const [followLive, setFollowLive] = useState<boolean>(true);

  const prevCtxRef = useRef<string>(`${convId}::${activeModel}`);
  const prevTotalRef = useRef<number>(totalCount);

  useEffect(() => {
    const ctxKey = `${convId}::${activeModel}`;
    const ctxChanged = prevCtxRef.current !== ctxKey;
    const prevTotal = prevTotalRef.current;

    if (ctxChanged) {
      prevCtxRef.current = ctxKey;
      prevTotalRef.current = totalCount;
      const nextPreset = getDefaultPreset(totalCount, readSavedPreset());
      setRangePreset(nextPreset);
      setViewRange(computeRangeForPreset(totalCount, nextPreset));
      setFollowLive(true);
      setHoveredIdx(null);
      setDragZoom(null);
      return;
    }

    if (totalCount !== prevTotal) {
      prevTotalRef.current = totalCount;
      setViewRange((prev) => advanceRangeOnDataUpdate(prev, prevTotal, totalCount, followLive, rangePreset));
    }
  }, [convId, activeModel, totalCount, followLive, rangePreset]);

  const safeRange = useMemo(() => clampViewRange(viewRange, totalCount), [viewRange, totalCount]);
  const visible = useMemo(
    () => (totalCount > 0 ? filteredInvs.slice(safeRange.start, safeRange.end + 1) : []),
    [filteredInvs, safeRange.start, safeRange.end, totalCount],
  );
  const visibleSpan = visible.length;
  const minSpan = getMinSpan(totalCount);

  const isNarrow = svgW < 340;
  const isWide = svgW >= 480;
  const sizeClass = isNarrow ? 'is-narrow' : isWide ? 'is-wide' : 'is-medium';

  const isMultiInView = useMemo(
    () => visible.length >= 2 && new Set(visible.map(getModelKey)).size >= 2,
    [visible],
  );

  const pulseModels = useMemo(
    () => (geminiPulse?.available ? geminiPulse.models : []),
    [geminiPulse?.available, geminiPulse?.models],
  );

  const defaultArenaFamily = useMemo(() => {
    if (!pulseModels.length) return '';
    const probe = (activeModel !== 'all' ? activeModel : '') || geminiPulse?.activeFamily || '';
    const pLower = probe.toLowerCase();
    const matched =
      pulseModels.find((m) => m.family === probe) ||
      pulseModels.find((m) => pLower && (pLower.includes(m.family.replace('gemini-4-', '')) || pLower.includes(m.label.toLowerCase()))) ||
      geminiPulse?.activeModel ||
      null;
    return matched?.family || '';
  }, [pulseModels, activeModel, geminiPulse?.activeFamily, geminiPulse?.activeModel]);

  const activeArenaFamilies = useMemo(() => {
    if (!pulseModels.length || (metric !== 'ttft' && metric !== 'tps' && metric !== 'cache')) return [];
    if (pinnedArenaFamilies !== null) {
      return pinnedArenaFamilies.filter((fam) => pulseModels.some((m) => m.family === fam));
    }
    return defaultArenaFamily ? [defaultArenaFamily] : [];
  }, [pulseModels, metric, pinnedArenaFamilies, defaultArenaFamily]);

  const toggleArenaFamily = (family: string) => {
    setPinnedArenaFamilies((prev) => {
      const current = prev !== null ? prev : defaultArenaFamily ? [defaultArenaFamily] : [];
      if (current.includes(family)) return current.filter((f) => f !== family);
      const next = [...current, family];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  };

  const baseYMax = useMemo(() => computeYAxisCeiling(visible, metric), [visible, metric]);
  const yMax = useMemo(() => {
    if (!activeArenaFamilies.length || metric === 'cache') return baseYMax;
    let maxOverlay = 0;
    for (const fam of activeArenaFamilies) {
      const m = pulseModels.find((x) => x.family === fam);
      const v = m ? getPulseMetricVal(m, metric) : null;
      if (v !== null && v > maxOverlay) maxOverlay = v;
    }
    if (maxOverlay > baseYMax * 0.94) {
      const cap = pinnedArenaFamilies !== null ? maxOverlay * 1.15 : Math.min(maxOverlay * 1.15, baseYMax * 3.5);
      if (cap > baseYMax) return niceMax(cap);
    }
    return baseYMax;
  }, [baseYMax, activeArenaFamilies, pulseModels, metric, pinnedArenaFamilies]);

  const yTickLabels = useMemo(
    () => [formatYTick(yMax, metric), formatYTick(yMax * 0.5, metric), formatYTick(0, metric)],
    [yMax, metric],
  );
  const maxYTickChars = useMemo(
    () => yTickLabels.reduce((acc, s) => Math.max(acc, s.length), 2),
    [yTickLabels],
  );

  const svgH = isWide ? 148 : isNarrow ? 120 : 134;
  const minimapH = isWide ? 26 : isNarrow ? 22 : 24;
  const padLeft = Math.max(isNarrow ? 28 : 34, Math.ceil(maxYTickChars * 5.8) + 10);
  const padRight = 14;
  const padTop = 14;
  const padBottom = isMultiInView ? 25 : 21;
  const chartH = Math.max(48, svgH - padTop - padBottom);
  const yBase = padTop + chartH;
  const plotW = Math.max(60, svgW - padLeft - padRight);

  const stats = useMemo(() => computeViewportStats(visible, metric, compactions), [visible, metric, compactions]);
  const xLayout = useMemo(() => computeXLayout(visible, axisMode, padLeft, plotW), [visible, axisMode, padLeft, plotW]);
  const valY = (val: number) => padTop + chartH - clamp(yMax > 0 ? val / yMax : 0, 0, 1) * chartH;

  const seriesList = useMemo<TrendSeries[]>(() => {
    const byKey = new Map<string, TrendSeries>();
    visible.forEach((r, i) => {
      const key = getModelKey(r);
      const color = modelColorMap.get(key) || 'var(--hud-accent)';
      const val = getMetricValue(r, metric);
      const pt: Pt = { x: xLayout.xs[i], y: valY(val), val, inv: r, slotIdx: i };
      const existing = byKey.get(key);
      if (existing) existing.points.push(pt);
      else byKey.set(key, { key, color, points: [pt] });
    });
    return [...byKey.values()];
  }, [visible, modelColorMap, metric, xLayout.xs, yMax, padTop, chartH]);

  const singleCurveSeries = seriesList.length === 1 ? seriesList[0] : null;
  const allPoints = useMemo<Pt[]>(
    () =>
      visible.map((r, i) => {
        const val = getMetricValue(r, metric);
        return { x: xLayout.xs[i], y: valY(val), val, inv: r, slotIdx: i };
      }),
    [visible, metric, xLayout.xs, yMax, padTop, chartH],
  );

  const emaPath = useMemo(() => {
    if (visible.length < 6) return '';
    if (metric === 'tps' && singleCurveSeries) {
      const emaVals = computeEma(visible.map((r) => getMetricValue(r, 'tps')), 5);
      return buildMonotonePath(emaVals.map((v, i) => ({ x: xLayout.xs[i], y: valY(v) })), padTop, yBase);
    }
    if (metric === 'out') {
      const emaVals = computeEma(visible.map((r) => Math.max(0, r.outputTokens || 0)), 5);
      return buildMonotonePath(emaVals.map((v, i) => ({ x: xLayout.xs[i], y: valY(v) })), padTop, yBase);
    }
    return '';
  }, [visible, metric, singleCurveSeries, xLayout.xs, yMax, padTop, chartH, yBase]);

  const emaLastY = useMemo(() => {
    if (!emaPath || visible.length < 6) return null;
    const emaVals = computeEma(visible.map((r) => getMetricValue(r, metric)), 5);
    return valY(emaVals[emaVals.length - 1]);
  }, [emaPath, visible, metric, yMax, padTop, chartH]);

  const compactMarkers = useMemo(
    () => locateCompactionMarkers(visible, compactions, xLayout.xs, xLayout.useTimeMode),
    [visible, compactions, xLayout.xs, xLayout.useTimeMode],
  );
  const ctxCurvePath = useMemo(
    () => (metric === 'ctx' && allPoints.length >= 2 ? buildMonotonePath(allPoints, padTop, yBase) : ''),
    [metric, allPoints, padTop, yBase],
  );

  const xTicks = useMemo<XTickItem[]>(() => {
    const n = visible.length;
    if (n === 0) return [];
    const spanMs = Math.max(0, xLayout.maxTsMs - xLayout.minTsMs);
    const makeLabel = (idx: number): string =>
      xLayout.useTimeMode ? formatTimeAxisLabel(visible[idx].timestampMs, spanMs) : `#${visible[idx].idx + 1}`;
    if (n === 1) return [{ x: xLayout.xs[0], label: makeLabel(0), anchor: 'middle' }];
    if (n === 2) {
      return [
        { x: xLayout.xs[0], label: makeLabel(0), anchor: 'start' },
        { x: xLayout.xs[1], label: makeLabel(1), anchor: 'end' },
      ];
    }
    const mid = Math.floor((n - 1) / 2);
    return [
      { x: xLayout.xs[0], label: makeLabel(0), anchor: 'start' },
      { x: xLayout.xs[mid], label: makeLabel(mid), anchor: 'middle' },
      { x: xLayout.xs[n - 1], label: makeLabel(n - 1), anchor: 'end' },
    ];
  }, [visible, xLayout]);

  const statCells = useMemo(() => buildStatCells(visible.length, metric, stats, tt), [visible.length, metric, stats, tt]);

  const handleSelectPreset = (p: Exclude<RangePreset, 'custom'>) => {
    writeSavedPreset(p);
    setRangePreset(p);
    setViewRange(computeRangeForPreset(totalCount, p));
    setFollowLive(true);
    setHoveredIdx(null);
  };

  const handleFollowLive = () => {
    const targetPreset = rangePreset === 'custom' ? getDefaultPreset(totalCount, readSavedPreset()) : rangePreset;
    const span =
      targetPreset === 'all'
        ? totalCount
        : Math.min(totalCount, Math.max(minSpan, Number(targetPreset) || visibleSpan));
    setRangePreset(targetPreset);
    setViewRange({ start: Math.max(0, totalCount - span), end: Math.max(0, totalCount - 1) });
    setFollowLive(true);
    setHoveredIdx(null);
  };

  const handleZoomButton = (direction: 'in' | 'out') => {
    if (totalCount <= minSpan) return;
    const next = zoomViewRange(safeRange, totalCount, direction === 'in' ? 0.5 : 2, followLive ? 1 : 0.5, followLive);
    setViewRange(next.range);
    setFollowLive(next.followLive);
    setRangePreset(next.preset);
    setHoveredIdx(null);
  };

  // Main SVG Pointer State Machine (0ms Hover + Drag-to-Zoom + Click-to-Inspect)
  const plotDragRef = useRef({ active: false, pointerId: -1, startX: 0, currentX: 0, isDragZoom: false });

  const getMainSvgX = (clientX: number): number => {
    const svg = mainSvgRef.current;
    if (!svg) return padLeft;
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 ? ((clientX - rect.left) / rect.width) * svgW : padLeft;
  };

  const handleMainPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || visible.length === 0) return;
    const svg = mainSvgRef.current;
    if (!svg) return;
    const sx = clamp(getMainSvgX(e.clientX), padLeft, padLeft + plotW);
    plotDragRef.current = { active: true, pointerId: e.pointerId, startX: sx, currentX: sx, isDragZoom: false };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without pointer capture
    }
  };

  const handleMainPointerMove = (e: PointerEvent) => {
    if (visible.length === 0) return;
    const rawX = getMainSvgX(e.clientX);
    const drag = plotDragRef.current;

    if (drag.active && drag.pointerId === e.pointerId) {
      const clampedX = clamp(rawX, padLeft, padLeft + plotW);
      drag.currentX = clampedX;
      if (!drag.isDragZoom && Math.abs(clampedX - drag.startX) >= 8 && totalCount > minSpan) {
        drag.isDragZoom = true;
        setHoveredIdx(null);
      }
      if (drag.isDragZoom) {
        const x1 = Math.min(drag.startX, clampedX);
        const x2 = Math.max(drag.startX, clampedX);
        const count = Math.abs(findNearestIndex(xLayout.xs, x2) - findNearestIndex(xLayout.xs, x1)) + 1;
        setDragZoom({ x1, x2, count });
      }
      return;
    }

    if (rawX >= padLeft - 8 && rawX <= padLeft + plotW + 8) {
      const idx = findNearestIndex(xLayout.xs, rawX);
      if (idx >= 0) setHoveredIdx(idx);
    } else {
      setHoveredIdx(null);
    }
  };

  const finishMainPointer = (e: PointerEvent, cancelled: boolean) => {
    const drag = plotDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const svg = mainSvgRef.current;
    if (svg) {
      try {
        if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    const wasDragZoom = drag.isDragZoom;
    const startX = drag.startX;
    const endX = clamp(getMainSvgX(e.clientX), padLeft, padLeft + plotW);
    drag.active = false;
    drag.isDragZoom = false;
    setDragZoom(null);

    if (cancelled || visible.length === 0) return;

    if (wasDragZoom) {
      const localA = findNearestIndex(xLayout.xs, Math.min(startX, endX));
      const localB = findNearestIndex(xLayout.xs, Math.max(startX, endX));
      if (localA >= 0 && localB >= 0) {
        const lo = Math.min(localA, localB);
        const hi = Math.max(localA, localB);
        setViewRange(clampViewRange({ start: safeRange.start + lo, end: safeRange.start + hi }, totalCount));
        setFollowLive(false);
        setRangePreset('custom');
        setHoveredIdx(null);
      }
      return;
    }

    if (Math.abs(endX - startX) < 6 && onInspectCall) {
      const idx = findNearestIndex(xLayout.xs, endX);
      const target = idx >= 0 ? visible[idx] : null;
      if (target) onInspectCall(target.idx);
    }
  };

  const wheelStateRef = useRef({ safeRange, totalCount, followLive, padLeft, plotW, svgW, minSpan });
  wheelStateRef.current = { safeRange, totalCount, followLive, padLeft, plotW, svgW, minSpan };
  const panAccumRef = useRef(0);
  const hasVisible = visible.length > 0;

  useEffect(() => {
    if (hoveredIdx === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHoveredIdx(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoveredIdx !== null]);

  useEffect(() => {
    const svg = mainSvgEl;
    if (!svg || !hasVisible) return;
    const onWheel = (e: WheelEvent) => {
      const st = wheelStateRef.current;
      if (st.totalCount <= st.minSpan) return;

      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(delta) < 0.5) return;
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const svgX = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * st.svgW : st.padLeft + st.plotW / 2;
        const anchorRatio = clamp((svgX - st.padLeft) / Math.max(1, st.plotW), 0, 1);
        const next = zoomViewRange(st.safeRange, st.totalCount, delta > 0 ? 1.28 : 0.78, anchorRatio, st.followLive);
        setViewRange(next.range);
        setFollowLive(next.followLive);
        setRangePreset(next.preset);
        return;
      }

      const curSpan = st.safeRange.end - st.safeRange.start + 1;
      if (curSpan < st.totalCount && Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1.5) {
        e.preventDefault();
        panAccumRef.current += (e.deltaX / Math.max(40, st.plotW)) * curSpan * 1.15;
        const step = Math.trunc(panAccumRef.current);
        if (step !== 0) {
          panAccumRef.current -= step;
          const next = panViewRange(st.safeRange, st.totalCount, step);
          setViewRange(next.range);
          setFollowLive(next.followLive);
          if (!next.followLive) setRangePreset('custom');
        }
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [mainSvgEl, hasVisible]);

  const showMinimap = totalCount > 8;
  const handleMinimapRangeChange = useCallback((range: ViewRange, nextFollow: boolean, nextPreset: RangePreset) => {
    setViewRange(range);
    setFollowLive(nextFollow);
    setRangePreset(nextPreset);
  }, []);
  const handleClearHover = useCallback(() => setHoveredIdx(null), []);

  const safeHoveredIdx =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < allPoints.length && !dragZoom ? hoveredIdx : null;
  const hoveredPt = safeHoveredIdx !== null ? allPoints[safeHoveredIdx] : null;
  const hoveredInv = hoveredPt ? hoveredPt.inv : null;

  const popoverDelta = useMemo(() => buildPopoverDelta(hoveredInv, stats.avg, metric, tt), [hoveredInv, stats.avg, metric, tt]);
  const popoverGrid = useMemo(() => buildPopoverGrid(hoveredInv, metric, tt), [hoveredInv, metric, tt]);
  const popoverLeftPx = useMemo(() => {
    if (!hoveredPt) return 8;
    const popW = isNarrow ? 192 : 214;
    const raw = hoveredPt.x > svgW * 0.54 ? hoveredPt.x - popW - 12 : hoveredPt.x + 12;
    return clamp(Math.round(raw), 4, Math.max(4, svgW - popW - 4));
  }, [hoveredPt, svgW, isNarrow]);

  const showModelPills = sessionModels.length >= 2 || activeModel !== 'all';
  const yTicks = [yMax, yMax * 0.5, 0];
  const canZoomIn = totalCount > minSpan && visibleSpan > minSpan;
  const canZoomOut = totalCount > minSpan && visibleSpan < totalCount;
  const isZoomedOrHistorical = !followLive && visible.length > 0;
  const visiblePresets = totalCount <= 20 ? (['all'] as const) : RANGE_PRESETS;

  const ttftSla3Y = metric === 'ttft' && 3 < yMax * 0.96 ? valY(3) : null;
  const ttftSla10Y = metric === 'ttft' && 10 < yMax * 0.96 ? valY(10) : null;
  const ttftP95Y =
    metric === 'ttft' && visible.length >= 3 && stats.p95 !== null && stats.p95 > 0 && stats.p95 <= yMax
      ? valY(stats.p95)
      : null;
  const cacheTargetY = metric === 'cache' ? valY(80) : null;
  const ctxDangerY = metric === 'ctx' ? valY(80) : null;
  const quotaAvgY =
    metric === 'quota' && visible.length >= 2 && stats.avg !== null && stats.avg > 0 ? valY(stats.avg) : null;

  const globalRefs = useMemo(
    () =>
      buildGlobalRefs({
        activeArenaFamilies,
        pinnedArenaFamilies,
        defaultArenaFamily,
        pulseModels,
        metric,
        yMax,
        padTop,
        chartH,
        yBase,
        plotW,
        ttftSla3Y,
        ttftSla10Y,
        cacheTargetY,
        emaLastY,
        ttftP95Y,
        t,
      }),
    [
      activeArenaFamilies,
      pinnedArenaFamilies,
      defaultArenaFamily,
      pulseModels,
      metric,
      yMax,
      padTop,
      chartH,
      yBase,
      plotW,
      ttftSla3Y,
      ttftSla10Y,
      cacheTargetY,
      emaLastY,
      ttftP95Y,
      t,
    ],
  );

  const showGlobalToggle = Boolean(geminiPulse?.enabled && (geminiPulse?.available || geminiPulse?.loading));
  const isGlobalSource = chartSource === 'global' && showGlobalToggle;

  return (
    <section className={`hud-card relative flex flex-col gap-2 ${sizeClass}`}>
      <TrendHeader
        t={t}
        tt={tt}
        showGlobalToggle={showGlobalToggle}
        isGlobalSource={isGlobalSource}
        onSwitchChartSource={handleSwitchChartSource}
        totalInvocations={invocations.length}
        metric={metric}
        onSelectMetric={onSelectMetric}
        showModelPills={showModelPills}
        sessionModels={sessionModels}
        activeModel={activeModel}
        onSelectModel={setActiveModel}
        isNarrow={isNarrow}
        totalCount={totalCount}
        visiblePresets={visiblePresets}
        followLive={followLive}
        rangePreset={rangePreset}
        onSelectPreset={handleSelectPreset}
        minSpan={minSpan}
        canZoomOut={canZoomOut}
        canZoomIn={canZoomIn}
        onZoomButton={handleZoomButton}
        axisMode={axisMode}
        onSelectAxisMode={setAxisMode}
      />

      {isGlobalSource ? (
        <GlobalTrendView
          geminiPulse={geminiPulse}
          metric={globalMetric}
          onSelectMetric={setGlobalMetric}
          lang={resolvedLang}
        />
      ) : (
        <>
          <TrendSessionStrips
            tt={tt}
            isZoomedOrHistorical={isZoomedOrHistorical}
            visible={visible}
            totalCount={totalCount}
            visibleSpan={visibleSpan}
            onFollowLive={handleFollowLive}
            statCells={statCells}
            isNarrow={isNarrow}
            pulseModels={pulseModels}
            metric={metric}
            activeArenaFamilies={activeArenaFamilies}
            onToggleArenaFamily={toggleArenaFamily}
            onClearArenaFamilies={() => setPinnedArenaFamilies([])}
          />

          <div ref={boxRef} className="relative w-full min-w-0 select-none">
            <TrendSvgPlot
              bindMainSvg={bindMainSvg}
              gradPrefix={gradPrefix}
              metric={metric}
              invocationsCount={invocations.length}
              visible={visible}
              svgW={svgW}
              svgH={svgH}
              padLeft={padLeft}
              padTop={padTop}
              chartH={chartH}
              yBase={yBase}
              plotW={plotW}
              yMax={yMax}
              yTicks={yTicks}
              yTickLabels={yTickLabels}
              stats={stats}
              xLayout={xLayout}
              seriesList={seriesList}
              allPoints={allPoints}
              modelColorMap={modelColorMap}
              isMultiInView={isMultiInView}
              emaPath={emaPath}
              emaLastY={emaLastY}
              compactMarkers={compactMarkers}
              ctxCurvePath={ctxCurvePath}
              xTicks={xTicks}
              ttftSla3Y={ttftSla3Y}
              ttftSla10Y={ttftSla10Y}
              ttftP95Y={ttftP95Y}
              cacheTargetY={cacheTargetY}
              ctxDangerY={ctxDangerY}
              quotaAvgY={quotaAvgY}
              globalRefs={globalRefs}
              safeHoveredIdx={safeHoveredIdx}
              hoveredPt={hoveredPt}
              dragZoom={dragZoom}
              t={t}
              tt={tt}
              onPointerDown={handleMainPointerDown}
              onPointerMove={handleMainPointerMove}
              onPointerUp={(e) => finishMainPointer(e, false)}
              onPointerCancel={(e) => finishMainPointer(e, true)}
              onPointerLeave={() => {
                if (!plotDragRef.current.active) setHoveredIdx(null);
              }}
              onKeyDown={(e) => {
                if (!allPoints.length) return;
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setHoveredIdx((prev) => (prev === null ? 0 : Math.min(allPoints.length - 1, prev + 1)));
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setHoveredIdx((prev) => (prev === null ? allPoints.length - 1 : Math.max(0, prev - 1)));
                } else if (e.key === 'Enter' && hoveredIdx !== null && allPoints[hoveredIdx] && onInspectCall) {
                  e.preventDefault();
                  onInspectCall(allPoints[hoveredIdx].inv.idx);
                } else if (e.key === 'Escape') {
                  setHoveredIdx(null);
                }
              }}
            />

            <div className="sr-only" aria-live="polite">
              {hoveredInv ? `#${hoveredInv.idx + 1} ${shortModelName(hoveredInv)} ${formatPrimaryMetricValue(hoveredInv, metric)}` : ''}
            </div>

            {hoveredPt && hoveredInv && (
              <TrendPopover
                inv={hoveredInv}
                metric={metric}
                modelColor={modelColorMap.get(getModelKey(hoveredInv)) || 'var(--hud-accent)'}
                leftPx={popoverLeftPx}
                isNarrow={isNarrow}
                delta={popoverDelta}
                grid={popoverGrid}
                canInspect={Boolean(onInspectCall)}
                tt={tt}
              />
            )}
          </div>

          {showMinimap && (
            <TrendMinimap
              filteredInvs={filteredInvs}
              compactions={compactions}
              metric={metric}
              svgW={svgW}
              minimapH={minimapH}
              totalCount={totalCount}
              minSpan={minSpan}
              safeRange={safeRange}
              followLive={followLive}
              isZoomed={rangePreset === 'custom'}
              tt={tt}
              onRangeChange={handleMinimapRangeChange}
              onClearHover={handleClearHover}
              onFollowLive={handleFollowLive}
            />
          )}
        </>
      )}
    </section>
  );
}

export const TrendChartCard = memo(TrendChartCardImpl);
