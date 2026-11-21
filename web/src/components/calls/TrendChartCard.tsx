import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import { getTrendTranslations, resolveTrendLang } from '../../i18n/trend';
import type { ChartMetric, Compaction, Invocation, Lang } from '../../types/telemetry';
import {
  cacheTier,
  fmtCachePct,
  fmtClock,
  fmtNum,
  fmtQuotaPct,
  fmtSec,
  fmtTps,
  fmtUsd,
  formatModelTag,
  ttftTier,
} from '../../utils/format';
import {
  TREND_RANGE_STORAGE_KEY,
  advanceRangeOnDataUpdate,
  buildMonotonePath,
  centerViewRangeAt,
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
  isSavedRangePreset,
  locateCompactionMarkers,
  locateMinimapCompactionFractions,
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
}

interface Pt {
  x: number;
  y: number;
  val: number;
  inv: Invocation;
  slotIdx: number;
}

interface ModelMeta {
  key: string;
  label: string;
  color: string;
  count: number;
  avgBadge: string;
}

interface StatCellModel {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
  deltaText?: string;
  deltaTone?: 'good' | 'bad' | 'neutral';
  badge?: string;
}

interface DragZoomVisual {
  x1: number;
  x2: number;
  count: number;
}

type BrushMode = 'pan' | 'resize-left' | 'resize-right';

const METRICS: ChartMetric[] = ['tps', 'ttft', 'out', 'cache', 'ctx', 'quota'];
const RANGE_PRESETS: Array<Exclude<RangePreset, 'custom'>> = ['20', '50', '100', 'all'];
const MODEL_PALETTE = ['var(--seg-think)', 'var(--seg-cache)', 'var(--seg-input)', 'var(--seg-out)'];

function readSavedPreset(): Exclude<RangePreset, 'custom'> | null {
  try {
    const raw = window.localStorage.getItem(TREND_RANGE_STORAGE_KEY);
    return isSavedRangePreset(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeSavedPreset(preset: Exclude<RangePreset, 'custom'>): void {
  try {
    window.localStorage.setItem(TREND_RANGE_STORAGE_KEY, preset);
  } catch {
    // Ignore storage errors in restricted webviews
  }
}

function getModelKey(r: Invocation): string {
  return formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
}

function shortTierSuffix(probe: string): string {
  const m = /(?:\(|-)(xhigh|high|medium|low|minimal)\)?\s*$/i.exec(probe.trim());
  if (!m) return '';
  const tier = m[1].toLowerCase();
  if (tier === 'xhigh') return '·XH';
  if (tier === 'low') return '·L';
  if (tier === 'medium') return '·M';
  if (tier === 'minimal') return '·Min';
  return '';
}

function shortModelName(r: Invocation): string {
  const fullTag = formatModelTag(r.modelId, r.modelDisplay, r.model);
  const probe = `${r.modelDisplay || ''} ${fullTag} ${r.model || ''}`.toLowerCase();
  const tier = shortTierSuffix(fullTag || r.modelDisplay || '');
  if (probe.includes('orchestrator')) {
    if (probe.includes('carbon')) return 'Orch·Carbon';
    if (probe.includes('neon')) return 'Orch·Neon';
    if (probe.includes('argon')) return 'Orch·Argon';
    if (probe.includes('hydrogen')) return 'Orch·Hydro';
    return 'Orchestrator';
  }
  if (probe.includes('flash-worker')) return 'Flash·Worker';
  if (probe.includes('3.8-flash') || probe.includes('3.8 flash')) return `3.8 Flash${tier}`;
  if (probe.includes('carbon')) return `Carbon${tier}`;
  if (probe.includes('argon')) return `Argon${tier}`;
  if (probe.includes('hydrogen')) return `Hydrogen${tier}`;
  if (probe.includes('neon')) return `Neon${tier}`;
  if (probe.includes('opus')) return `Opus${tier}`;
  if (probe.includes('sonnet')) return `Sonnet${tier}`;
  const raw = r.modelDisplay || fullTag || r.model || 'Model';
  return raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
}

function preferredModelColor(r: Invocation): string {
  const probe = `${r.modelDisplay || ''} ${r.modelId || ''} ${r.model || ''}`.toLowerCase();
  if (probe.includes('flash') || probe.includes('hydrogen')) {
    return 'var(--seg-cache)';
  }
  if (probe.includes('neon') || probe.includes('sonnet')) {
    return 'var(--seg-input)';
  }
  if (probe.includes('orchestrator') || probe.includes('carbon') || probe.includes('argon') || probe.includes('opus')) {
    return 'var(--seg-think)';
  }
  return 'var(--seg-out)';
}

function formatModelMetricAvg(items: Invocation[], metric: ChartMetric): string {
  if (!items.length) return '';
  if (metric === 'ttft') {
    const avg = items.reduce((s, r) => s + (r.ttftSec || 0), 0) / items.length;
    return fmtSec(avg);
  }
  if (metric === 'out') {
    const avg = items.reduce((s, r) => s + (r.outputTokens || 0), 0) / items.length;
    return fmtNum(avg);
  }
  if (metric === 'cache') {
    const valid = items.map((r) => r.cacheHitPct).filter((v): v is number => v !== null && Number.isFinite(v));
    const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    return fmtCachePct(avg);
  }
  if (metric === 'ctx') {
    return `${items.length}`;
  }
  if (metric === 'quota') {
    const avg = items.reduce((s, r) => s + (r.quotaPct5h || 0), 0) / items.length;
    const f = fmtQuotaPct(avg);
    return f ? `-${f}` : '';
  }
  const sustained = items.filter((r) => !r.isBuffered && r.genTps > 0);
  const pool = sustained.length ? sustained : items;
  const avg = pool.reduce((s, r) => s + (r.isBuffered ? r.e2eTps : r.genTps), 0) / pool.length;
  return `${fmtTps(avg)} t/s`;
}

function fmtSignedPct(deltaPct: number): string {
  const rounded = Math.round(deltaPct);
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

function fmtSignedPp(deltaPp: number): string {
  const rounded = Number(deltaPp.toFixed(1));
  if (Math.abs(rounded) < 0.05) return '0pp';
  return rounded > 0 ? `+${rounded.toFixed(1)}pp` : `${rounded.toFixed(1)}pp`;
}

function formatPrimaryMetricValue(inv: Invocation, metric: ChartMetric): string {
  if (metric === 'ttft') return fmtSec(inv.ttftSec);
  if (metric === 'out') return `${fmtNum(inv.outputTokens)} tok`;
  if (metric === 'cache') return fmtCachePct(inv.cacheHitPct);
  if (metric === 'ctx') return `${(inv.contextPct || 0).toFixed(1)}%`;
  if (metric === 'quota') {
    const q = fmtQuotaPct(inv.quotaPct5h);
    return q ? `-${q}` : '0%';
  }
  const v = inv.isBuffered ? inv.e2eTps : inv.genTps;
  return `${fmtTps(v)} t/s`;
}

export function TrendChartCard({
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
}: TrendChartCardProps) {
  const resolvedLang = resolveTrendLang(lang, t);
  const tt = useMemo(() => getTrendTranslations(resolvedLang), [resolvedLang]);
  const gradPrefix = useMemo(() => `tc-${Math.random().toString(36).slice(2, 8)}`, []);

  const boxRef = useRef<HTMLDivElement>(null);
  const mainSvgRef = useRef<SVGSVGElement>(null);
  const minimapSvgRef = useRef<SVGSVGElement>(null);

  const [svgW, setSvgW] = useState(380);
  const [internalModel, setInternalModel] = useState<string>('all');
  const [axisMode, setAxisMode] = useState<AxisMode>('seq');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [dragZoom, setDragZoom] = useState<DragZoomVisual | null>(null);
  const [brushDragging, setBrushDragging] = useState(false);

  const isModelControlled = selectedModelProp !== undefined && typeof onSelectModel === 'function';
  const activeModel = isModelControlled ? selectedModelProp : internalModel;

  const setActiveModel = (next: string) => {
    if (isModelControlled) {
      onSelectModel(next);
    } else {
      setInternalModel(next);
    }
  };

  // Reset uncontrolled model filter on conversation switch
  useEffect(() => {
    if (!isModelControlled) {
      setInternalModel('all');
    }
  }, [convId, isModelControlled]);

  // Measure container width dynamically for responsive breakpoints
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setSvgW(Math.max(220, Math.round(el.clientWidth)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || el.clientWidth;
      if (width > 0) setSvgW(Math.max(220, Math.round(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build model roster & color map across FULL session history
  const { sessionModels, modelColorMap } = useMemo(() => {
    const grouped = new Map<string, { items: Invocation[]; label: string }>();
    for (const r of invocations) {
      const key = getModelKey(r);
      const entry = grouped.get(key);
      if (entry) {
        entry.items.push(r);
      } else {
        grouped.set(key, { items: [r], label: shortModelName(r) });
      }
    }

    const usedColors = new Set<string>();
    const colorMap = new Map<string, string>();
    const metas: ModelMeta[] = [];
    let fallbackIdx = 0;

    for (const [key, { items, label }] of grouped.entries()) {
      let color = preferredModelColor(items[0]);
      if (usedColors.has(color)) {
        const free = MODEL_PALETTE.find((c) => !usedColors.has(c));
        color = free || MODEL_PALETTE[fallbackIdx % MODEL_PALETTE.length];
      }
      usedColors.add(color);
      colorMap.set(key, color);
      fallbackIdx += 1;
      metas.push({
        key,
        label,
        color,
        count: items.length,
        avgBadge: formatModelMetricAvg(items, metric),
      });
    }
    return { sessionModels: metas, modelColorMap: colorMap };
  }, [invocations, metric]);

  // Auto-clear stale model filter if no invocations match
  useEffect(() => {
    if (activeModel !== 'all' && invocations.length > 0 && !invocations.some((r) => getModelKey(r) === activeModel)) {
      setActiveModel('all');
    }
  }, [invocations, activeModel]);

  // Full chronological filtered series (NO slice(-32) truncation!)
  const filteredInvs = useMemo(() => {
    if (activeModel === 'all') return invocations;
    return invocations.filter((r) => getModelKey(r) === activeModel);
  }, [invocations, activeModel]);

  const totalCount = filteredInvs.length;

  // Viewport state: rangePreset, viewRange, followLive
  const initialPreset = getDefaultPreset(totalCount, readSavedPreset());
  const [rangePreset, setRangePreset] = useState<RangePreset>(initialPreset);
  const [viewRange, setViewRange] = useState<ViewRange>(() => computeRangeForPreset(totalCount, initialPreset));
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

  // Synchronous clamped view range so renders never use out-of-bounds indices
  const safeRange = useMemo(() => clampViewRange(viewRange, totalCount), [viewRange, totalCount]);
  const visible = useMemo(
    () => (totalCount > 0 ? filteredInvs.slice(safeRange.start, safeRange.end + 1) : []),
    [filteredInvs, safeRange.start, safeRange.end, totalCount],
  );
  const visibleSpan = visible.length;
  const minSpan = getMinSpan(totalCount);

  // Responsive layout breakpoints (<340px, 340-479px, >=480px)
  const isNarrow = svgW < 340;
  const isWide = svgW >= 480;
  const sizeClass = isNarrow ? 'is-narrow' : isWide ? 'is-wide' : 'is-medium';

  const isMultiInView = useMemo(() => {
    if (visible.length < 2) return false;
    const keys = new Set(visible.map(getModelKey));
    return keys.size >= 2;
  }, [visible]);

  const svgH = isWide ? 148 : isNarrow ? 118 : 132;
  const minimapH = isWide ? 26 : isNarrow ? 22 : 24;
  const padLeft = isNarrow ? 6 : isWide ? 34 : 30;
  const padRight = 10;
  const padTop = 12;
  const padBottom = isMultiInView ? 25 : 21;
  const chartH = Math.max(48, svgH - padTop - padBottom);
  const yBase = padTop + chartH;
  const plotW = Math.max(60, svgW - padLeft - padRight);

  // Nice Y-axis scale + viewport summary stats
  const yMax = useMemo(() => computeYAxisCeiling(visible, metric), [visible, metric]);
  const stats = useMemo(
    () => computeViewportStats(visible, metric, compactions),
    [visible, metric, compactions],
  );
  const xLayout = useMemo(
    () => computeXLayout(visible, axisMode, padLeft, plotW),
    [visible, axisMode, padLeft, plotW],
  );

  const valY = (val: number) => padTop + chartH - clamp(yMax > 0 ? val / yMax : 0, 0, 1) * chartH;

  // Build per-model series for curve metrics
  const seriesList = useMemo(() => {
    const byKey = new Map<string, { key: string; color: string; points: Pt[] }>();
    visible.forEach((r, i) => {
      const key = getModelKey(r);
      const color = modelColorMap.get(key) || 'var(--hud-accent)';
      const val = getMetricValue(r, metric);
      const pt: Pt = { x: xLayout.xs[i], y: valY(val), val, inv: r, slotIdx: i };
      const existing = byKey.get(key);
      if (existing) {
        existing.points.push(pt);
      } else {
        byKey.set(key, { key, color, points: [pt] });
      }
    });
    return [...byKey.values()];
  }, [visible, modelColorMap, metric, xLayout.xs, yMax, padTop, chartH]);

  const singleCurveSeries = seriesList.length === 1 ? seriesList[0] : null;

  // Unified point list for crosshair / ctx / EMA
  const allPoints = useMemo<Pt[]>(
    () =>
      visible.map((r, i) => {
        const val = getMetricValue(r, metric);
        return { x: xLayout.xs[i], y: valY(val), val, inv: r, slotIdx: i };
      }),
    [visible, metric, xLayout.xs, yMax, padTop, chartH],
  );

  // 5-call EMA trendline for TPS (single series, n >= 6) and OUT (n >= 6)
  const emaPath = useMemo(() => {
    if (visible.length < 6) return '';
    if (metric === 'tps' && singleCurveSeries) {
      const emaVals = computeEma(
        visible.map((r) => getMetricValue(r, 'tps')),
        5,
      );
      const pts = emaVals.map((v, i) => ({ x: xLayout.xs[i], y: valY(v) }));
      return buildMonotonePath(pts, padTop, yBase);
    }
    if (metric === 'out') {
      const emaVals = computeEma(
        visible.map((r) => Math.max(0, r.outputTokens || 0)),
        5,
      );
      const pts = emaVals.map((v, i) => ({ x: xLayout.xs[i], y: valY(v) }));
      return buildMonotonePath(pts, padTop, yBase);
    }
    return '';
  }, [visible, metric, singleCurveSeries, xLayout.xs, yMax, padTop, chartH, yBase]);

  const emaLastY = useMemo(() => {
    if (!emaPath || visible.length < 6) return null;
    const emaVals = computeEma(
      visible.map((r) => getMetricValue(r, metric)),
      5,
    );
    return valY(emaVals[emaVals.length - 1]);
  }, [emaPath, visible, metric, yMax, padTop, chartH]);

  // Cross-metric compaction markers (rendered across ALL 6 metrics!)
  const compactMarkers = useMemo(
    () => locateCompactionMarkers(visible, compactions, xLayout.xs, xLayout.useTimeMode),
    [visible, compactions, xLayout.xs, xLayout.useTimeMode],
  );

  const ctxCurvePath = useMemo(
    () => (metric === 'ctx' && allPoints.length >= 2 ? buildMonotonePath(allPoints, padTop, yBase) : ''),
    [metric, allPoints, padTop, yBase],
  );

  // X-axis tick labels (left / mid / right)
  const xTicks = useMemo(() => {
    const n = visible.length;
    if (n === 0) return [];
    const spanMs = Math.max(0, xLayout.maxTsMs - xLayout.minTsMs);
    const makeLabel = (idx: number): string => {
      const inv = visible[idx];
      if (xLayout.useTimeMode) {
        return formatTimeAxisLabel(inv.timestampMs, spanMs);
      }
      return `#${inv.idx + 1}`;
    };
    if (n === 1) {
      return [{ x: xLayout.xs[0], label: makeLabel(0), anchor: 'middle' as const }];
    }
    if (n === 2) {
      return [
        { x: xLayout.xs[0], label: makeLabel(0), anchor: 'start' as const },
        { x: xLayout.xs[1], label: makeLabel(1), anchor: 'end' as const },
      ];
    }
    const mid = Math.floor((n - 1) / 2);
    return [
      { x: xLayout.xs[0], label: makeLabel(0), anchor: 'start' as const },
      { x: xLayout.xs[mid], label: makeLabel(mid), anchor: 'middle' as const },
      { x: xLayout.xs[n - 1], label: makeLabel(n - 1), anchor: 'end' as const },
    ];
  }, [visible, xLayout]);

  // 4-cell metric-aware viewport stat strip
  const statCells = useMemo<StatCellModel[]>(() => {
    if (visible.length === 0) return [];
    if (metric === 'tps') {
      const d = stats.deltaVsAvgPct;
      const deltaTone: StatCellModel['deltaTone'] =
        d === null ? undefined : d >= 5 ? 'good' : d <= -15 ? 'bad' : 'neutral';
      return [
        {
          label: tt.statLatest,
          value: stats.latest !== null && stats.latest > 0 ? `${fmtTps(stats.latest)}` : '--',
          deltaText: d !== null ? fmtSignedPct(d) : undefined,
          deltaTone,
          badge: stats.latestIsBuffered ? tt.popBadgeBuf : undefined,
        },
        {
          label: tt.statAvg,
          value: stats.avg !== null ? `${fmtTps(stats.avg)} t/s` : '--',
        },
        {
          label: tt.statP50,
          value: stats.p50 !== null ? `${fmtTps(stats.p50)} t/s` : '--',
        },
        {
          label: tt.statPeak,
          value: stats.max !== null ? `${fmtTps(stats.max)} t/s` : '--',
        },
      ];
    }
    if (metric === 'ttft') {
      const d = stats.deltaVsAvgPct;
      const deltaTone: StatCellModel['deltaTone'] =
        d === null ? undefined : d <= -10 ? 'good' : d >= 20 ? 'bad' : 'neutral';
      const latestTier = stats.latest !== null ? ttftTier(stats.latest) : null;
      return [
        {
          label: tt.statLatest,
          value: fmtSec(stats.latest),
          tone: latestTier === 'slow' ? 'bad' : latestTier === 'mid' ? 'warn' : undefined,
          deltaText: d !== null ? fmtSignedPct(d) : undefined,
          deltaTone,
        },
        {
          label: tt.statAvg,
          value: fmtSec(stats.avg),
        },
        {
          label: tt.statP95,
          value: fmtSec(stats.p95),
          tone: stats.p95 !== null && stats.p95 > 10 ? 'bad' : stats.p95 !== null && stats.p95 > 3 ? 'warn' : undefined,
        },
        {
          label: tt.statMax,
          value: fmtSec(stats.max),
        },
      ];
    }
    if (metric === 'out') {
      return [
        {
          label: tt.statLatest,
          value: fmtNum(stats.latest),
        },
        {
          label: tt.statAvg,
          value: fmtNum(stats.avg),
        },
        {
          label: tt.statThinkShare,
          value: stats.thinkSharePct !== null ? `${Math.round(stats.thinkSharePct)}%` : '--',
        },
        {
          label: tt.statSum,
          value: fmtNum(stats.sum),
        },
      ];
    }
    if (metric === 'cache') {
      const d = stats.deltaVsAvgPp;
      const deltaTone: StatCellModel['deltaTone'] =
        d === null ? undefined : d >= 2 ? 'good' : d <= -8 ? 'bad' : 'neutral';
      const tier = cacheTier(stats.latest);
      return [
        {
          label: tt.statLatest,
          value: fmtCachePct(stats.latest),
          tone: tier === 'good' ? 'ok' : tier === 'low' ? 'bad' : tier === 'mid' ? 'warn' : undefined,
          deltaText: d !== null ? fmtSignedPp(d) : undefined,
          deltaTone,
        },
        {
          label: tt.statAvg,
          value: fmtCachePct(stats.avg),
        },
        {
          label: tt.statMin,
          value: fmtCachePct(stats.min),
          tone: stats.min !== null && stats.min < 40 ? 'bad' : undefined,
        },
        {
          label: tt.statHighCache,
          value: stats.validCacheCount > 0 ? `${stats.highCacheCount}/${stats.validCacheCount}` : '--',
        },
      ];
    }
    if (metric === 'ctx') {
      const latestCtx = stats.latest ?? 0;
      const ctxTone: StatCellModel['tone'] = latestCtx >= 90 ? 'bad' : latestCtx >= 80 ? 'warn' : undefined;
      return [
        {
          label: tt.statLatest,
          value: `${latestCtx.toFixed(1)}%`,
          tone: ctxTone,
        },
        {
          label: tt.statHeadroom,
          value: stats.headroomTurns !== null ? tt.statTurns(stats.headroomTurns) : '--',
          tone: stats.headroomTurns !== null && stats.headroomTurns <= 3 ? 'bad' : stats.headroomTurns !== null && stats.headroomTurns <= 8 ? 'warn' : undefined,
        },
        {
          label: tt.statPeak,
          value: stats.max !== null ? `${stats.max.toFixed(1)}%` : '--',
        },
        {
          label: tt.statCompacts,
          value: String(stats.compactsInView),
        },
      ];
    }
    // quota
    const fmtQ = (v: number | null) => {
      if (v === null || v <= 0) return '0%';
      const s = fmtQuotaPct(v);
      return s ? `-${s}` : '0%';
    };
    return [
      {
        label: tt.statLatest,
        value: fmtQ(stats.latest),
      },
      {
        label: tt.statAvg,
        value: fmtQ(stats.avg),
      },
      {
        label: tt.statPeak,
        value: fmtQ(stats.max),
      },
      {
        label: tt.statSum,
        value: fmtQ(stats.sum),
      },
    ];
  }, [visible.length, metric, stats, tt]);

  // Actions: Range Preset, Zoom In/Out, Follow Live
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
    const factor = direction === 'in' ? 0.5 : 2;
    const anchor = followLive ? 1 : 0.5;
    const next = zoomViewRange(safeRange, totalCount, factor, anchor, followLive);
    setViewRange(next.range);
    setFollowLive(next.followLive);
    setRangePreset(next.preset);
    setHoveredIdx(null);
  };

  // Main SVG Pointer State Machine (0ms Hover + Drag-to-Zoom + Click-to-Inspect)
  const plotDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    currentX: number;
    isDragZoom: boolean;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    currentX: 0,
    isDragZoom: false,
  });

  const getMainSvgX = (clientX: number): number => {
    const svg = mainSvgRef.current;
    if (!svg) return padLeft;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return padLeft;
    return ((clientX - rect.left) / rect.width) * svgW;
  };

  const handleMainPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || visible.length === 0) return;
    const svg = mainSvgRef.current;
    if (!svg) return;
    const sx = clamp(getMainSvgX(e.clientX), padLeft, padLeft + plotW);
    plotDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: sx,
      currentX: sx,
      isDragZoom: false,
    };
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
        const i1 = findNearestIndex(xLayout.xs, x1);
        const i2 = findNearestIndex(xLayout.xs, x2);
        const count = Math.abs(i2 - i1) + 1;
        setDragZoom({ x1, x2, count });
      }
      return;
    }

    // Zero-lag crosshair snap
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
      const x1 = Math.min(startX, endX);
      const x2 = Math.max(startX, endX);
      const localA = findNearestIndex(xLayout.xs, x1);
      const localB = findNearestIndex(xLayout.xs, x2);
      if (localA >= 0 && localB >= 0) {
        const lo = Math.min(localA, localB);
        const hi = Math.max(localA, localB);
        const nextRange = clampViewRange(
          { start: safeRange.start + lo, end: safeRange.start + hi },
          totalCount,
        );
        setViewRange(nextRange);
        setFollowLive(false);
        setRangePreset('custom');
        setHoveredIdx(null);
      }
      return;
    }

    // Click-to-inspect (< 6px horizontal movement)
    if (Math.abs(endX - startX) < 6 && onInspectCall) {
      const idx = findNearestIndex(xLayout.xs, endX);
      const target = idx >= 0 ? visible[idx] : null;
      if (target) {
        onInspectCall(target.idx);
      }
    }
  };

  // Non-passive wheel listener: Modifier+Wheel zoom + horizontal trackpad pan (never hijacks normal vertical scroll!)
  const wheelStateRef = useRef({
    safeRange,
    totalCount,
    followLive,
    padLeft,
    plotW,
    svgW,
    minSpan,
  });
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
    const svg = mainSvgRef.current;
    if (!svg || !hasVisible) return;
    const onWheel = (e: WheelEvent) => {
      const st = wheelStateRef.current;
      if (st.totalCount <= st.minSpan) return;

      // 1) Ctrl / Meta / Shift + Wheel => cursor-centered smooth zoom
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(delta) < 0.5) return;
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const svgX = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * st.svgW : st.padLeft + st.plotW / 2;
        const anchorRatio = clamp((svgX - st.padLeft) / Math.max(1, st.plotW), 0, 1);
        const factor = delta > 0 ? 1.28 : 0.78;
        const next = zoomViewRange(st.safeRange, st.totalCount, factor, anchorRatio, st.followLive);
        setViewRange(next.range);
        setFollowLive(next.followLive);
        setRangePreset(next.preset);
        return;
      }

      // 2) Horizontal trackpad swipe => smooth pan ONLY when zoomed in
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
  }, [hasVisible]);

  // Minimap geometry & data (rendered whenever totalCount > 8)
  const showMinimap = totalCount > 8;
  const miniPadX = 3;
  const miniPlotW = Math.max(40, svgW - miniPadX * 2);
  const miniInnerTop = 3;
  const miniInnerH = Math.max(10, minimapH - 6);

  const minimapData = useMemo(() => {
    if (!showMinimap) {
      return { isBars: false, path: '', areaPath: '', bars: [] as Array<{ x: number; h: number }>, compactXs: [] as number[] };
    }
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

    // Decimate sparkline cleanly if session has > 220 calls
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
  }, [showMinimap, filteredInvs, metric, compactions, miniPlotW, miniInnerH, totalCount]);

  // Minimap viewport window coordinates
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

  // Minimap Brush Pointer State Machine (setPointerCapture)
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
    if (e.button !== 0 || !showMinimap) return;
    const svg = minimapSvgRef.current;
    if (!svg) return;
    const mx = clamp(getMiniX(e.clientX), miniPadX, miniPadX + miniPlotW);
    setHoveredIdx(null);

    let mode: BrushMode = 'pan';
    let initRange = safeRange;

    if (Math.abs(mx - vx1) <= 7) {
      mode = 'resize-left';
    } else if (Math.abs(mx - vx2) <= 7) {
      mode = 'resize-right';
    } else if (mx >= vx1 && mx <= vx2) {
      mode = 'pan';
    } else {
      // Clicked outside viewport on minimap track -> center immediately and allow continued drag
      const clickedIdx = miniXToIndex(mx);
      const centered = centerViewRangeAt(safeRange, totalCount, clickedIdx);
      initRange = centered.range;
      setViewRange(centered.range);
      setFollowLive(centered.followLive);
      if (!centered.followLive) setRangePreset('custom');
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
      setViewRange(next.range);
      setFollowLive(next.followLive);
      if (!next.followLive) setRangePreset('custom');
    } else if (b.mode === 'resize-left') {
      const maxStart = b.initRange.end - minSpan + 1;
      const nextStart = clamp(b.initRange.start + deltaIdx, 0, Math.max(0, maxStart));
      const nextRange = { start: nextStart, end: b.initRange.end };
      setViewRange(nextRange);
      const isFull = nextRange.start === 0 && nextRange.end === totalCount - 1;
      setFollowLive(isFull ? true : nextRange.end >= totalCount - 1 && followLive);
      setRangePreset(isFull ? 'all' : 'custom');
    } else if (b.mode === 'resize-right') {
      const minEnd = b.initRange.start + minSpan - 1;
      const nextEnd = clamp(b.initRange.end + deltaIdx, Math.min(totalCount - 1, minEnd), totalCount - 1);
      const nextRange = { start: b.initRange.start, end: nextEnd };
      setViewRange(nextRange);
      const isFull = nextRange.start === 0 && nextRange.end === totalCount - 1;
      setFollowLive(isFull ? true : nextEnd >= totalCount - 1);
      setRangePreset(isFull ? 'all' : 'custom');
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
    if (!showMinimap) return;
    setRangePreset('all');
    setViewRange({ start: 0, end: Math.max(0, totalCount - 1) });
    setFollowLive(true);
    setHoveredIdx(null);
  };

  // Active hovered point & popover details
  const safeHoveredIdx = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < allPoints.length && !dragZoom ? hoveredIdx : null;
  const hoveredPt = safeHoveredIdx !== null ? allPoints[safeHoveredIdx] : null;
  const hoveredInv = hoveredPt ? hoveredPt.inv : null;

  const popoverDelta = useMemo(() => {
    if (!hoveredInv || stats.avg === null) return null;
    if (metric === 'cache') {
      if (hoveredInv.cacheHitPct === null || hoveredInv.cacheHitPct === undefined) return null;
      const diff = hoveredInv.cacheHitPct - stats.avg;
      return {
        text: tt.popVsAvg(fmtSignedPp(diff)),
        tone: diff >= 2 ? ('good' as const) : diff <= -8 ? ('bad' as const) : ('neutral' as const),
      };
    }
    if (metric === 'ctx') {
      const diff = (hoveredInv.contextPct || 0) - stats.avg;
      return {
        text: tt.popVsAvg(fmtSignedPp(diff)),
        tone: 'neutral' as const,
      };
    }
    if (stats.avg <= 0) return null;
    const val = getMetricValue(hoveredInv, metric);
    const pct = ((val - stats.avg) / stats.avg) * 100;
    let tone: 'good' | 'bad' | 'neutral' = 'neutral';
    if (metric === 'tps') {
      tone = pct >= 5 ? 'good' : pct <= -15 ? 'bad' : 'neutral';
    } else if (metric === 'ttft') {
      tone = pct <= -10 ? 'good' : pct >= 20 ? 'bad' : 'neutral';
    }
    return { text: tt.popVsAvg(fmtSignedPct(pct)), tone };
  }, [hoveredInv, stats.avg, metric, tt]);

  const popoverGrid = useMemo(() => {
    if (!hoveredInv) return [];
    const r = hoveredInv;
    const totOut = Math.max(0, r.outputTokens || 0);
    const thk = Math.max(0, r.thinkingTokens || 0);
    const vis = Math.max(0, r.candidateTokens || totOut - thk);

    if (metric === 'ttft') {
      return [
        { k: tt.popGenTime, v: fmtSec(r.genSec) },
        { k: tt.popTotalTime, v: fmtSec(r.totalSec) },
        { k: tt.popCache, v: fmtCachePct(r.cacheHitPct) },
        { k: tt.popContext, v: `${fmtNum(r.totalContext)} (${(r.contextPct || 0).toFixed(0)}%)` },
      ];
    }
    if (metric === 'out') {
      return [
        { k: tt.popThinkVis, v: `${fmtNum(thk)} / ${fmtNum(vis)}` },
        { k: tt.popGenTime, v: fmtSec(r.genSec) },
        { k: tt.popGenTps, v: `${fmtTps(r.isBuffered ? r.e2eTps : r.genTps)} t/s` },
        { k: tt.popCost, v: r.priced ? fmtUsd(r.costUSD) : '--' },
      ];
    }
    if (metric === 'cache') {
      return [
        { k: tt.popPrompt, v: `${fmtNum(r.cachedInput)} / ${fmtNum(r.newInput)}` },
        { k: tt.popTtft, v: fmtSec(r.ttftSec) },
        { k: tt.popContext, v: `${(r.contextPct || 0).toFixed(1)}%` },
        { k: tt.popCost, v: r.priced ? fmtUsd(r.costUSD) : '--' },
      ];
    }
    if (metric === 'ctx') {
      return [
        { k: tt.popContext, v: `${fmtNum(r.totalContext)} / ${fmtNum(r.contextLimit)}` },
        { k: tt.popCache, v: fmtCachePct(r.cacheHitPct) },
        { k: tt.popOutput, v: `${fmtNum(totOut)} tok` },
        { k: tt.popTtft, v: fmtSec(r.ttftSec) },
      ];
    }
    if (metric === 'quota') {
      const q7 = r.quotaPct7d ? `-${fmtQuotaPct(r.quotaPct7d)}` : '--';
      return [
        { k: tt.popQuota7d, v: q7 },
        { k: tt.popRateK, v: `${(r.quotaMultiplierK || 1).toFixed(2)}×` },
        { k: tt.popCost, v: r.priced ? fmtUsd(r.costUSD) : '--' },
        { k: tt.popOutput, v: `${fmtNum(totOut)} tok` },
      ];
    }
    // tps
    return [
      { k: tt.popE2eTps, v: `${fmtTps(r.e2eTps)} t/s` },
      { k: tt.popTtft, v: fmtSec(r.ttftSec) },
      { k: tt.popOutput, v: `${fmtNum(totOut)} tok` },
      { k: tt.popCache, v: fmtCachePct(r.cacheHitPct) },
    ];
  }, [hoveredInv, metric, tt]);

  const popoverLeftPx = useMemo(() => {
    if (!hoveredPt) return 8;
    const popW = isNarrow ? 192 : 214;
    const preferLeft = hoveredPt.x > svgW * 0.54;
    const raw = preferLeft ? hoveredPt.x - popW - 12 : hoveredPt.x + 12;
    return clamp(Math.round(raw), 4, Math.max(4, svgW - popW - 4));
  }, [hoveredPt, svgW, isNarrow]);

  const metricLabel = (m: ChartMetric): string => {
    if (m === 'tps') return t.tabTps;
    if (m === 'ttft') return t.tabTtft;
    if (m === 'out') return t.tabOut;
    if (m === 'cache') return t.tabCache;
    if (m === 'quota') return t.tabQuota;
    return t.tabCtx;
  };

  const showModelPills = sessionModels.length >= 2 || activeModel !== 'all';
  const yTicks = [yMax, yMax * 0.5, 0];
  const canZoomIn = totalCount > minSpan && visibleSpan > minSpan;
  const canZoomOut = totalCount > minSpan && visibleSpan < totalCount;
  const isZoomedOrHistorical = !followLive && visible.length > 0;
  const visiblePresets = totalCount <= 20 ? (['all'] as const) : RANGE_PRESETS;

  // Reference Y positions for metric overlays
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

  const statToneClass = (tone?: 'ok' | 'warn' | 'bad'): string => {
    if (tone === 'ok') return 'text-hud-ok';
    if (tone === 'warn') return 'text-hud-warn';
    if (tone === 'bad') return 'text-hud-bad';
    return 'text-hud-fg';
  };

  return (
    <section className={`hud-card relative flex flex-col gap-1.5 ${sizeClass}`}>
      {/* Row 1: Title + Total Count + Metric Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="card-k">{t.chartTitle}</span>
          <span className="trend-count-badge inline-flex items-center px-1.5 py-px rounded-full font-hud-mono tabular-nums font-semibold text-hud-muted bg-hud-fill border border-hud-border">
            {t.chartMeta(invocations.length)}
          </span>
        </div>

        <div className="metric-tabs" role="tablist" aria-label={t.chartTitle}>
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metric === m}
              className={`metric-tab${metric === m ? ' is-active' : ''}`}
              onClick={() => onSelectMetric(m)}
            >
              {metricLabel(m)}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Model Pills + Range Presets + Zoom Micro-Buttons + Dual X-Axis Toggle */}
      {(showModelPills || totalCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
          {showModelPills && (
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <button
                type="button"
                className={`trend-model-pill${activeModel === 'all' ? ' is-active' : ''}`}
                onClick={() => setActiveModel('all')}
              >
                {t.chartAllModels(invocations.length)}
              </button>
              {sessionModels.map((m) => {
                const active = activeModel === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`trend-model-pill${active ? ' is-active' : ''}`}
                    data-tip={t.chartModelFilterTip(m.label, m.count, m.avgBadge, active)}
                    onClick={() => setActiveModel(active ? 'all' : m.key)}
                  >
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ backgroundColor: m.color }}
                    />
                    <span>{m.label}</span>
                    {!isNarrow && m.avgBadge && <span className="text-hud-fg/75">{m.avgBadge}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {totalCount > 0 && (
            <div className="inline-flex flex-wrap items-center gap-1 ml-auto min-w-0">
              {/* Quick Range Presets */}
              <div
                className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track border border-hud-border"
                role="group"
              >
                {visiblePresets.map((p) => {
                  const isAll = p === 'all';
                  const num = isAll ? 0 : Number(p);
                  const available = isAll || totalCount > num;
                  const active = followLive && rangePreset === p;
                  const label = isAll ? tt.rangeAll : p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!available}
                      className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg font-hud-mono tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors${active ? ' is-active' : ''}`}
                      title={isAll ? tt.rangeAll : tt.rangePresetTip(p, available)}
                      onClick={() => handleSelectPreset(p)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Micro Zoom [-] / [+] Buttons */}
              {totalCount > minSpan && (
                <div
                  className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track border border-hud-border"
                  role="group"
                >
                  <button
                    type="button"
                    className="trend-seg-btn trend-icon-btn min-w-[20px] border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg font-hud-mono font-bold leading-tight px-[5px] py-0.5 rounded cursor-pointer text-center transition-colors"
                    disabled={!canZoomOut}
                    title={tt.zoomOutTip}
                    aria-label={tt.zoomOutTip}
                    onClick={() => handleZoomButton('out')}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="trend-seg-btn trend-icon-btn min-w-[20px] border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg font-hud-mono font-bold leading-tight px-[5px] py-0.5 rounded cursor-pointer text-center transition-colors"
                    disabled={!canZoomIn}
                    title={tt.zoomInTip}
                    aria-label={tt.zoomInTip}
                    onClick={() => handleZoomButton('in')}
                  >
                    +
                  </button>
                </div>
              )}

              {/* Dual X-Axis Toggle (#Seq vs Time) */}
              <div
                className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track border border-hud-border"
                role="group"
              >
                <button
                  type="button"
                  className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:text-hud-fg font-hud-mono tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors${axisMode === 'seq' ? ' is-active' : ''}`}
                  title={tt.axisSeqTip}
                  onClick={() => setAxisMode('seq')}
                >
                  {isNarrow ? tt.axisSeqShort : tt.axisSeq}
                </button>
                <button
                  type="button"
                  className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:text-hud-fg font-hud-mono tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors${axisMode === 'time' ? ' is-active' : ''}`}
                  title={tt.axisTimeTip}
                  onClick={() => setAxisMode('time')}
                >
                  {isNarrow ? tt.axisTimeShort : tt.axisTime}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conditional Historical / Paused Follow-Live Banner */}
      {isZoomedOrHistorical && (
        <div className="trend-live-banner flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 py-1 rounded-md border font-hud-mono tabular-nums text-hud-fg">
          <span className="inline-flex items-center gap-1.5 min-w-0 text-hud-fg-2">
            <span className="w-1.5 h-1.5 rounded-full bg-hud-warn shrink-0" />
            <span>
              {tt.viewingRange(
                visible[0].idx + 1,
                visible[visible.length - 1].idx + 1,
                totalCount,
                visibleSpan < totalCount,
              )}
            </span>
          </span>
          <button
            type="button"
            className="trend-follow-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] border font-hud-mono font-bold text-hud-accent-ink cursor-pointer whitespace-nowrap transition-colors"
            title={tt.followLiveTip}
            onClick={handleFollowLive}
          >
            {tt.followLiveBtn}
          </button>
        </div>
      )}

      {/* Row 3: 4-Cell Metric-Aware Viewport Summary Stat Strip */}
      {statCells.length > 0 && (
        <div className={`grid gap-[5px] ${isNarrow ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {statCells.map((cell, ci) => (
            <div
              key={ci}
              className="trend-stat-cell flex flex-col gap-px min-w-0 px-[7px] py-[5px] rounded-md border border-hud-border tabular-nums"
            >
              <div className="trend-stat-label flex items-center justify-between gap-1 font-hud-mono font-semibold tracking-[0.04em] text-hud-muted whitespace-nowrap overflow-hidden text-ellipsis">
                <span>{cell.label}</span>
                {cell.badge && (
                  <span className="trend-stat-buf-tag inline-flex items-center px-1 rounded-[3px] font-hud-mono font-bold text-hud-muted border border-hud-border bg-hud-card">
                    {cell.badge}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 min-w-0 flex-wrap">
                <span className={`trend-stat-val font-hud-mono font-bold leading-tight whitespace-nowrap ${statToneClass(cell.tone)}`}>
                  {cell.value}
                </span>
                {cell.deltaText && (
                  <span className={`trend-stat-delta inline-flex items-center px-1 rounded font-hud-mono font-bold leading-[1.35] whitespace-nowrap is-${cell.deltaTone || 'neutral'}`}>
                    {cell.deltaText}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Row 4: Main SVG Plot Canvas + Zero-Lag Crosshair + Structured Popover */}
      <div ref={boxRef} className="relative w-full min-w-0 select-none">
        {visible.length === 0 ? (
          <svg className="trend-main-svg block w-full overflow-visible" style={{ height: `${svgH}px` }} viewBox={`0 0 ${svgW} ${svgH}`}>
            {[padTop, padTop + chartH * 0.5, yBase].map((gy, gi) => (
              <line
                key={gi}
                x1={padLeft}
                y1={gy.toFixed(1)}
                x2={(padLeft + plotW).toFixed(1)}
                y2={gy.toFixed(1)}
                stroke="var(--hud-border)"
                strokeWidth="1"
                strokeDasharray={gi === 2 ? undefined : '2 3'}
                opacity="0.45"
              />
            ))}
            <text
              x={(svgW / 2).toFixed(1)}
              y={(padTop + chartH * 0.52).toFixed(1)}
              textAnchor="middle"
              className="trend-axis-label"
              style={{ fontSize: '11px' }}
            >
              {invocations.length > 0 ? tt.emptyFiltered : t.noCalls}
            </text>
          </svg>
        ) : (
          <svg
            ref={mainSvgRef}
            className={`trend-main-svg block w-full overflow-visible${dragZoom ? ' is-selecting' : ''}`}
            style={{ height: `${svgH}px` }}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onPointerDown={handleMainPointerDown}
            onPointerMove={handleMainPointerMove}
            onPointerUp={(e) => finishMainPointer(e, false)}
            onPointerCancel={(e) => finishMainPointer(e, true)}
            onPointerLeave={() => {
              if (!plotDragRef.current.active) setHoveredIdx(null);
            }}
          >
            <defs>
              <linearGradient id={`${gradPrefix}-ctx`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--seg-input)" stopOpacity="0.26" />
                <stop offset="100%" stopColor="var(--seg-input)" stopOpacity="0.02" />
              </linearGradient>
              {singleCurveSeries && (
                <linearGradient id={`${gradPrefix}-area-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={singleCurveSeries.color} stopOpacity="0.24" />
                  <stop offset="100%" stopColor={singleCurveSeries.color} stopOpacity="0.02" />
                </linearGradient>
              )}
              <linearGradient id={`${gradPrefix}-danger`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--hud-bad)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--hud-bad)" stopOpacity="0.04" />
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
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.45"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(ctxDangerY - 2.5).toFixed(1)}
                  textAnchor="end"
                  className="trend-ref-label"
                  fill="var(--hud-bad)"
                  opacity="0.78"
                >
                  {tt.refDanger80}
                </text>
              </g>
            )}

            {/* Nice Y-axis horizontal gridlines & labels */}
            {yTicks.map((tickVal, gi) => {
              const gy = valY(tickVal);
              const label = formatYTick(tickVal, metric);
              return (
                <g key={`grid-${gi}`}>
                  <line
                    x1={padLeft}
                    y1={gy.toFixed(1)}
                    x2={(padLeft + plotW).toFixed(1)}
                    y2={gy.toFixed(1)}
                    stroke="var(--hud-border)"
                    strokeWidth="1"
                    strokeDasharray={gi === 2 ? undefined : '2 3'}
                    opacity={gi === 2 ? 0.78 : 0.62}
                  />
                  {isNarrow ? (
                    <g>
                      <rect
                        className="trend-y-pill-bg"
                        x={(padLeft + 1).toFixed(1)}
                        y={(gi === 0 ? gy + 1 : gy - 9.5).toFixed(1)}
                        width={Math.max(18, label.length * 5.6 + 6)}
                        height="10"
                        rx="2"
                      />
                      <text
                        x={(padLeft + 4).toFixed(1)}
                        y={(gi === 0 ? gy + 8.5 : gy - 2).toFixed(1)}
                        textAnchor="start"
                        className="trend-axis-label"
                      >
                        {label}
                      </text>
                    </g>
                  ) : (
                    <text
                      x={(padLeft - 5).toFixed(1)}
                      y={(gy + 3).toFixed(1)}
                      textAnchor="end"
                      className="trend-axis-label"
                    >
                      {label}
                    </text>
                  )}
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
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.48"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(ttftSla3Y - 2.5).toFixed(1)}
                  textAnchor="end"
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
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.52"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(ttftSla10Y - 2.5).toFixed(1)}
                  textAnchor="end"
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
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  opacity="0.34"
                />
                <text
                  x={(padLeft + 3).toFixed(1)}
                  y={(ttftP95Y - 2.5).toFixed(1)}
                  textAnchor="start"
                  className="trend-ref-label"
                  fill="var(--hud-muted)"
                >
                  {tt.refP95} {fmtSec(stats.p95)}
                </text>
              </g>
            )}

            {/* Cache 80% target line */}
            {cacheTargetY !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={cacheTargetY.toFixed(1)}
                  x2={(padLeft + plotW).toFixed(1)}
                  y2={cacheTargetY.toFixed(1)}
                  stroke="var(--hud-ok)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.46"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(cacheTargetY - 2.5).toFixed(1)}
                  textAnchor="end"
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
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.42"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(quotaAvgY - 2.5).toFixed(1)}
                  textAnchor="end"
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
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.42"
                />
                <text
                  x={(padLeft + plotW - 2).toFixed(1)}
                  y={(padTop + 9).toFixed(1)}
                  textAnchor="end"
                  className="trend-axis-label"
                >
                  {tt.singleCallNote}
                </text>
              </g>
            )}

            {/* Cross-metric Compaction Markers (ALL 6 metrics!) */}
            {compactMarkers.map((m, ci) => (
              <g key={`cmp-${ci}`}>
                <line
                  x1={m.x.toFixed(1)}
                  y1={padTop}
                  x2={m.x.toFixed(1)}
                  y2={yBase.toFixed(1)}
                  stroke="var(--seg-think)"
                  strokeWidth="1.2"
                  strokeDasharray="2.5 2.5"
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
                    strokeWidth="1.25"
                    strokeDasharray="3 2.5"
                    opacity="0.52"
                    strokeLinecap="round"
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
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
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
                      strokeWidth="1.1"
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
            {metric !== 'out' &&
              metric !== 'ctx' &&
              metric !== 'quota' && (
                <g>
                  {seriesList.map((s) => {
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
                            strokeWidth="1"
                            strokeDasharray="3 3"
                            opacity="0.3"
                          />
                        )}
                        {curve && singleCurveSeries?.key === s.key && (
                          <path
                            d={`${curve} L ${s.points[s.points.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${s.points[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`}
                            fill={`url(#${gradPrefix}-area-${metric})`}
                          />
                        )}
                        {curve && (
                          <path
                            d={curve}
                            fill="none"
                            stroke={s.color}
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
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
                                  strokeWidth="1.4"
                                  opacity="0.92"
                                />
                              )}
                              <circle
                                cx={pt.x.toFixed(1)}
                                cy={pt.y.toFixed(1)}
                                r={isLast ? 3.5 : isBufNode ? 2.8 : 2.3}
                                fill={dotFill}
                                stroke={isBufNode ? s.color : 'var(--hud-card)'}
                                strokeWidth={isBufNode ? '1.5' : '1.1'}
                              />
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* TPS 5-call EMA dashed trendline (single series, n >= 6) */}
                  {metric === 'tps' && emaPath && (
                    <g>
                      <path
                        d={emaPath}
                        fill="none"
                        stroke="var(--hud-fg)"
                        strokeWidth="1.25"
                        strokeDasharray="4 3"
                        opacity="0.52"
                        strokeLinecap="round"
                      />
                      {emaLastY !== null && (
                        <text
                          x={(padLeft + plotW - 2).toFixed(1)}
                          y={clamp(emaLastY - 3.5, padTop + 8, yBase - 4).toFixed(1)}
                          textAnchor="end"
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

            {/* X-axis tick labels (#Seq or Time) */}
            {xTicks.map((tk, ti) => (
              <text
                key={`xtick-${ti}`}
                x={tk.x.toFixed(1)}
                y={(svgH - 4).toFixed(1)}
                textAnchor={tk.anchor}
                className="trend-axis-label"
              >
                {tk.label}
              </text>
            ))}

            {/* Zero-lag SVG Crosshair + Horizontal Value Guide + Focus Halo */}
            {hoveredPt && (
              <g pointerEvents="none">
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
                  strokeWidth="1.4"
                />
              </g>
            )}

            {/* Drag-to-Zoom Selection Marquee */}
            {dragZoom && (
              <g pointerEvents="none">
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
                  <text className="trend-zoom-badge-text" x="0" y="1.5" textAnchor="middle">
                    {tt.zoomSelecting(dragZoom.count)}
                  </text>
                </g>
              </g>
            )}
          </svg>
        )}

        {/* Structured Zero-Lag Floating In-Card Popover */}
        {hoveredPt && hoveredInv && (
          <div
            className={`trend-popover absolute top-1 z-[24] max-w-[calc(100%-8px)] rounded-[7px] border pointer-events-none tabular-nums flex flex-col gap-[5px] ${isNarrow ? 'w-[192px] px-2 py-1.5' : 'w-[214px] px-[9px] py-[7px]'}`}
            style={{ left: `${popoverLeftPx}px` }}
          >
            <div className="trend-pop-head flex items-center justify-between gap-1 font-hud-mono text-hud-muted min-w-0">
              <span className="inline-flex items-center gap-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                <span className="font-bold text-hud-fg">#{hoveredInv.idx + 1}</span>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: modelColorMap.get(getModelKey(hoveredInv)) || 'var(--hud-accent)' }}
                />
                <span>{shortModelName(hoveredInv)}</span>
                {hoveredInv.timestampMs > 0 && <span>· {fmtClock(hoveredInv.timestampMs)}</span>}
              </span>
              {(hoveredInv.isBuffered || hoveredInv.isToolStall) && (
                <span className="inline-flex items-center gap-[3px] shrink-0">
                  {hoveredInv.isBuffered && (
                    <span className="trend-pop-badge px-1 rounded-[3px] font-bold leading-[1.4] text-hud-muted bg-hud-fill border border-hud-border">
                      {tt.popBadgeBuf}
                    </span>
                  )}
                  {hoveredInv.isToolStall && (
                    <span className="trend-pop-badge is-stall px-1 rounded-[3px] font-bold leading-[1.4] border">
                      {tt.popBadgeStall}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-baseline justify-between gap-1.5 pb-1 border-b border-hud-border">
              <span className="trend-pop-val font-hud-mono font-bold leading-tight text-hud-fg">
                {formatPrimaryMetricValue(hoveredInv, metric)}
              </span>
              {popoverDelta && (
                <span className={`trend-stat-delta inline-flex items-center px-1 rounded font-hud-mono font-bold leading-[1.35] whitespace-nowrap is-${popoverDelta.tone}`}>
                  {popoverDelta.text}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-2 gap-y-[3px]">
              {popoverGrid.map((item, idx) => (
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
              {onInspectCall ? tt.popHintInspectDrag : tt.popHintDragOnly}
            </div>
          </div>
        )}
      </div>

      {/* Row 5: Interactive Minimap Brush / Scrubber (shown whenever filteredInvs.length > 8) */}
      {showMinimap && (
        <div className="w-full min-w-0 mt-px select-none" title={tt.minimapTip}>
          <svg
            ref={minimapSvgRef}
            className="trend-minimap-svg block w-full rounded-[5px]"
            style={{ height: `${minimapH}px` }}
            viewBox={`0 0 ${svgW} ${minimapH}`}
            role="slider"
            aria-label={tt.minimapAria}
            aria-valuemin={1}
            aria-valuemax={totalCount}
            aria-valuenow={safeRange.end + 1}
            onPointerDown={handleMiniPointerDown}
            onPointerMove={handleMiniPointerMove}
            onPointerUp={handleMiniPointerUp}
            onPointerCancel={handleMiniPointerUp}
            onDblClick={handleMiniDoubleClick}
          >
            {/* Track background */}
            <rect
              className="trend-minimap-track"
              x="0.5"
              y="0.5"
              width={Math.max(1, svgW - 1)}
              height={Math.max(1, minimapH - 1)}
              rx="4"
            />

            {/* Full-session miniature silhouette */}
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
                {minimapData.areaPath && (
                  <path d={minimapData.areaPath} fill="var(--hud-muted)" opacity="0.16" />
                )}
                {minimapData.path && (
                  <path
                    d={minimapData.path}
                    fill="none"
                    stroke="var(--hud-muted)"
                    strokeWidth="1.15"
                    opacity="0.58"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            )}

            {/* Historical Compaction Tick Markers on Minimap */}
            {minimapData.compactXs.map((cx, ci) => (
              <line
                key={`mcmp-${ci}`}
                x1={cx.toFixed(1)}
                y1="2"
                x2={cx.toFixed(1)}
                y2={(minimapH - 2).toFixed(1)}
                stroke="var(--seg-think)"
                strokeWidth="1.2"
                opacity="0.78"
              />
            ))}

            {/* Dimmed outside masks */}
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

            {/* Draggable Viewport Window */}
            <rect
              className={`trend-minimap-window${brushDragging ? ' is-dragging' : ''}`}
              x={vx1.toFixed(1)}
              y="1.5"
              width={Math.max(4, vx2 - vx1).toFixed(1)}
              height={Math.max(4, minimapH - 3)}
              rx="3"
            />

            {/* Left 6px resize handle */}
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

            {/* Right 6px resize handle */}
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
      )}
    </section>
  );
}
