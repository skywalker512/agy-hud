import type { ChartMetric, Compaction, Invocation } from '../../types/telemetry.ts';

export type RangePreset = '20' | '50' | '100' | 'all' | 'custom';
export type AxisMode = 'seq' | 'time';

export interface ViewRange {
  start: number;
  end: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface ViewportStats {
  count: number;
  latest: number | null;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
  sum: number;
  deltaVsAvgPct: number | null;
  deltaVsAvgPp: number | null;
  thinkSharePct: number | null;
  highCacheCount: number;
  validCacheCount: number;
  compactsInView: number;
  headroomTurns: number | null;
  latestIsBuffered: boolean;
}

export interface CompactionMarker {
  x: number;
  compaction: Compaction;
}

export interface XLayout {
  xs: number[];
  barW: number;
  useTimeMode: boolean;
  minTsMs: number;
  maxTsMs: number;
}

export const TREND_RANGE_STORAGE_KEY = 'agy_hud_trend_range';

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Round a raw positive maximum up to a clean commercial tick ceiling
 * using the 1 / 2 / 2.5 / 5 / 10 * 10^k ladder with 12% headroom.
 */
export function niceMax(rawMax: number, minFloor = 1): number {
  const safeRaw = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 0;
  const target = Math.max(safeRaw * 1.12, minFloor);
  if (!Number.isFinite(target) || target <= 0) return minFloor;

  const exp = Math.floor(Math.log10(target));
  const mag = 10 ** exp;
  const norm = target / mag;

  let step = 10;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;

  return Number((step * mag).toPrecision(10));
}

export function formatYTick(val: number, metric: ChartMetric): string {
  if (!Number.isFinite(val)) return '0';
  const v = Math.abs(val) < 1e-12 ? 0 : val;
  if (metric === 'cache' || metric === 'ctx') {
    return `${Math.round(v)}%`;
  }
  if (metric === 'ttft') {
    if (v === 0) return '0s';
    if (v >= 10) return `${Math.round(v)}s`;
    if (Math.abs(v - Math.round(v)) < 1e-6) return `${Math.round(v)}s`;
    return `${Number(v.toFixed(1))}s`;
  }
  if (metric === 'out') {
    if (v === 0) return '0';
    if (v >= 1_000_000) return `${Number((v / 1_000_000).toFixed(1))}M`;
    if (v >= 1_000) {
      const k = v / 1_000;
      return `${Math.abs(k - Math.round(k)) < 1e-6 ? Math.round(k) : Number(k.toFixed(1))}k`;
    }
    return String(Math.round(v));
  }
  if (metric === 'quota') {
    if (v === 0) return '0%';
    if (v < 0.01) return `${Number(v.toFixed(3))}%`;
    if (v < 0.1) return `${Number(v.toFixed(2))}%`;
    if (v < 10) return `${Number(v.toFixed(2))}%`;
    return `${Math.round(v)}%`;
  }
  // tps
  if (v === 0) return '0';
  if (v >= 1_000) return `${Number((v / 1_000).toFixed(1))}k`;
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return String(Number(v.toFixed(1)));
}

export function percentile(values: number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const pct = clamp(p, 0, 1);
  const idx = pct * (clean.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return clean[lo];
  const frac = idx - lo;
  return clean[lo] + (clean[hi] - clean[lo]) * frac;
}

export function computeEma(values: number[], period = 5): number[] {
  if (!values.length) return [];
  const p = Math.max(1, period);
  const alpha = 2 / (p + 1);
  const out = new Array<number>(values.length);
  let prev = Number.isFinite(values[0]) ? values[0] : 0;
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = Number.isFinite(values[i]) ? values[i] : prev;
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Fritsch-Carlson monotone cubic spline SVG path, clamped to [minY, maxY]
 * so curves never overshoot the chart bounds.
 */
export function buildMonotonePath(pts: Point2D[], minY: number, maxY: number): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-3, pts[i + 1].x - pts[i].x);
    h.push(dx);
    d.push((pts[i + 1].y - pts[i].y) / dx);
  }

  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const step = h[i] / 3;
    const cp1x = pts[i].x + step;
    const cp1y = clamp(pts[i].y + m[i] * step, minY, maxY);
    const cp2x = pts[i + 1].x - step;
    const cp2y = clamp(pts[i + 1].y - m[i + 1] * step, minY, maxY);
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
  }
  return path;
}

export function getMetricValue(inv: Invocation, metric: ChartMetric): number {
  if (metric === 'ttft') return Math.max(0, inv.ttftSec || 0);
  if (metric === 'out') return Math.max(0, inv.outputTokens || 0);
  if (metric === 'cache') return clamp(inv.cacheHitPct ?? 0, 0, 100);
  if (metric === 'ctx') return clamp(inv.contextPct || 0, 0, 100);
  if (metric === 'quota') return Math.max(0, inv.quotaPct5h || 0);
  const v = inv.isBuffered ? inv.e2eTps : inv.genTps;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function computeYAxisCeiling(visible: Invocation[], metric: ChartMetric): number {
  if (metric === 'cache' || metric === 'ctx') return 100;
  if (!visible.length) {
    if (metric === 'ttft') return 5;
    if (metric === 'out') return 1000;
    if (metric === 'quota') return 0.1;
    return 100;
  }
  let rawMax = 0;
  for (const inv of visible) {
    const v = getMetricValue(inv, metric);
    if (v > rawMax) rawMax = v;
  }
  if (metric === 'ttft') return niceMax(rawMax, 1);
  if (metric === 'out') return niceMax(rawMax, 100);
  if (metric === 'quota') return niceMax(rawMax, 0.02);
  return niceMax(rawMax, 10);
}

export function getMinSpan(total: number): number {
  if (total <= 0) return 0;
  return Math.min(total, 4);
}

export function isSavedRangePreset(v: unknown): v is Exclude<RangePreset, 'custom'> {
  return v === '20' || v === '50' || v === '100' || v === 'all';
}

export function getDefaultPreset(total: number, savedPreset?: string | null): Exclude<RangePreset, 'custom'> {
  if (isSavedRangePreset(savedPreset)) {
    return savedPreset;
  }
  return total > 50 ? '50' : 'all';
}

export function computeRangeForPreset(total: number, preset: RangePreset): ViewRange {
  if (total <= 0) return { start: 0, end: 0 };
  if (preset === 'all' || preset === 'custom') {
    return { start: 0, end: total - 1 };
  }
  const n = Number(preset);
  if (!Number.isFinite(n) || n <= 0) return { start: 0, end: total - 1 };
  const span = Math.min(total, Math.max(getMinSpan(total), Math.floor(n)));
  return { start: total - span, end: total - 1 };
}

export function clampViewRange(range: ViewRange, total: number): ViewRange {
  if (total <= 0) return { start: 0, end: 0 };
  const minSpan = getMinSpan(total);
  let start = Math.round(Number.isFinite(range.start) ? range.start : 0);
  let end = Math.round(Number.isFinite(range.end) ? range.end : total - 1);
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  start = clamp(start, 0, total - 1);
  end = clamp(end, 0, total - 1);

  const curSpan = end - start + 1;
  if (curSpan < minSpan) {
    const deficit = minSpan - curSpan;
    const growLeft = Math.floor(deficit / 2);
    const growRight = deficit - growLeft;
    start -= growLeft;
    end += growRight;
    if (start < 0) {
      end = Math.min(total - 1, end - start);
      start = 0;
    }
    if (end > total - 1) {
      start = Math.max(0, start - (end - (total - 1)));
      end = total - 1;
    }
  }
  return { start, end };
}

export function advanceRangeOnDataUpdate(
  prevRange: ViewRange,
  prevTotal: number,
  nextTotal: number,
  followLive: boolean,
  preset: RangePreset,
): ViewRange {
  if (nextTotal <= 0) return { start: 0, end: 0 };
  if (prevTotal <= 0) {
    return computeRangeForPreset(nextTotal, preset === 'custom' ? (nextTotal > 50 ? '50' : 'all') : preset);
  }
  if (followLive) {
    if (preset === 'all') return { start: 0, end: nextTotal - 1 };
    if (preset === '20' || preset === '50' || preset === '100') {
      return computeRangeForPreset(nextTotal, preset);
    }
    // Custom span pinned to live edge
    const prevSpan = Math.max(getMinSpan(nextTotal), prevRange.end - prevRange.start + 1);
    const clampedSpan = Math.min(nextTotal, prevSpan);
    return { start: nextTotal - clampedSpan, end: nextTotal - 1 };
  }
  // Paused in history: preserve exact indices unless data shrank
  return clampViewRange(prevRange, nextTotal);
}

export function zoomViewRange(
  range: ViewRange,
  total: number,
  factor: number,
  anchorRatio: number,
  wasFollowingLive = false,
): { range: ViewRange; followLive: boolean; preset: RangePreset } {
  if (total <= 0) {
    return { range: { start: 0, end: 0 }, followLive: true, preset: 'all' };
  }
  const safeRange = clampViewRange(range, total);
  const curSpan = safeRange.end - safeRange.start + 1;
  const minSpan = getMinSpan(total);

  let nextSpan = Math.round(curSpan * factor);
  if (factor < 1 && nextSpan >= curSpan && curSpan > minSpan) {
    nextSpan = curSpan - 1;
  } else if (factor > 1 && nextSpan <= curSpan && curSpan < total) {
    nextSpan = curSpan + 1;
  }
  nextSpan = clamp(nextSpan, minSpan, total);

  if (nextSpan >= total) {
    return { range: { start: 0, end: total - 1 }, followLive: true, preset: 'all' };
  }

  const ratio = clamp(anchorRatio, 0, 1);
  const anchorIdx = safeRange.start + ratio * (curSpan - 1);
  let nextStart = Math.round(anchorIdx - ratio * (nextSpan - 1));
  let nextEnd = nextStart + nextSpan - 1;

  if (nextStart < 0) {
    nextEnd = Math.min(total - 1, nextEnd - nextStart);
    nextStart = 0;
  }
  if (nextEnd > total - 1) {
    nextStart = Math.max(0, nextStart - (nextEnd - (total - 1)));
    nextEnd = total - 1;
  }

  const nextRange = clampViewRange({ start: nextStart, end: nextEnd }, total);
  const atRightEdge = nextRange.end >= total - 1;
  const followLive = atRightEdge && (wasFollowingLive || ratio >= 0.98);
  return { range: nextRange, followLive, preset: 'custom' };
}

export function panViewRange(
  range: ViewRange,
  total: number,
  deltaItems: number,
): { range: ViewRange; followLive: boolean } {
  if (total <= 0) return { range: { start: 0, end: 0 }, followLive: true };
  const safe = clampViewRange(range, total);
  const span = safe.end - safe.start + 1;
  if (span >= total) {
    return { range: { start: 0, end: total - 1 }, followLive: true };
  }
  const shift = Math.round(deltaItems);
  let nextStart = safe.start + shift;
  if (nextStart < 0) nextStart = 0;
  if (nextStart + span > total) nextStart = total - span;
  const nextEnd = nextStart + span - 1;
  return {
    range: { start: nextStart, end: nextEnd },
    followLive: nextEnd >= total - 1,
  };
}

export function centerViewRangeAt(
  range: ViewRange,
  total: number,
  centerIndex: number,
): { range: ViewRange; followLive: boolean } {
  if (total <= 0) return { range: { start: 0, end: 0 }, followLive: true };
  const safe = clampViewRange(range, total);
  const span = safe.end - safe.start + 1;
  if (span >= total) {
    return { range: { start: 0, end: total - 1 }, followLive: true };
  }
  let nextStart = Math.round(centerIndex - (span - 1) / 2);
  if (nextStart < 0) nextStart = 0;
  if (nextStart + span > total) nextStart = total - span;
  const nextEnd = nextStart + span - 1;
  return {
    range: { start: nextStart, end: nextEnd },
    followLive: nextEnd >= total - 1,
  };
}

export function computeXLayout(
  visible: Invocation[],
  axisMode: AxisMode,
  padLeft: number,
  plotW: number,
): XLayout {
  const n = visible.length;
  if (n === 0) {
    return { xs: [], barW: 8, useTimeMode: false, minTsMs: 0, maxTsMs: 0 };
  }
  if (n === 1) {
    return {
      xs: [padLeft + plotW / 2],
      barW: clamp(plotW * 0.12, 8, 24),
      useTimeMode: false,
      minTsMs: visible[0].timestampMs || 0,
      maxTsMs: visible[0].timestampMs || 0,
    };
  }

  const slotW = plotW / n;
  if (axisMode === 'time') {
    const timestamps = visible.map((r) => (Number.isFinite(r.timestampMs) && r.timestampMs > 0 ? r.timestampMs : 0));
    const validTs = timestamps.filter((ts) => ts > 0);
    if (validTs.length === n) {
      const minTsMs = Math.min(...validTs);
      const maxTsMs = Math.max(...validTs);
      const spanMs = maxTsMs - minTsMs;
      if (spanMs > 0) {
        const edgePad = Math.min(10, Math.max(4, slotW * 0.45));
        const innerW = Math.max(10, plotW - edgePad * 2);
        const xs = timestamps.map((ts) => padLeft + edgePad + ((ts - minTsMs) / spanMs) * innerW);
        let minGap = innerW;
        for (let i = 1; i < xs.length; i++) {
          const gap = xs[i] - xs[i - 1];
          if (gap > 0.5 && gap < minGap) minGap = gap;
        }
        const barW = clamp(Math.min(minGap * 0.72, slotW * 0.72), 2.5, 20);
        return { xs, barW, useTimeMode: true, minTsMs, maxTsMs };
      }
    }
  }

  const xs = visible.map((_, i) => padLeft + (i + 0.5) * slotW);
  const barW = clamp(slotW * 0.68, 2.5, 22);
  return {
    xs,
    barW,
    useTimeMode: false,
    minTsMs: visible[0].timestampMs || 0,
    maxTsMs: visible[n - 1].timestampMs || 0,
  };
}

export function findNearestIndex(xs: number[], targetX: number): number {
  const n = xs.length;
  if (n <= 0) return -1;
  if (n === 1) return 0;
  let bestIdx = 0;
  let bestDist = Math.abs(xs[0] - targetX);
  for (let i = 1; i < n; i++) {
    const dist = Math.abs(xs[i] - targetX);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function formatTimeAxisLabel(ms: number, spanMs: number): string {
  if (!ms || !Number.isFinite(ms)) return '--';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (spanMs > 0 && spanMs < 5 * 60_000) {
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  if (spanMs >= 24 * 3_600_000) {
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${mo}-${da} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

export function locateCompactionMarkers(
  visible: Invocation[],
  compactions: Compaction[],
  xs: number[],
  useTimeMode = false,
): CompactionMarker[] {
  if (visible.length < 2 || !compactions.length || xs.length !== visible.length) return [];
  const markers: CompactionMarker[] = [];

  for (const c of compactions) {
    let placed = false;
    if (c.afterGmIdx !== null && c.afterGmIdx !== undefined) {
      for (let i = 1; i < visible.length; i++) {
        if (visible[i - 1].idx < c.afterGmIdx && visible[i].idx >= c.afterGmIdx) {
          let x = (xs[i - 1] + xs[i]) / 2;
          if (
            useTimeMode
            && c.timestampMs > 0
            && visible[i - 1].timestampMs > 0
            && visible[i].timestampMs > visible[i - 1].timestampMs
          ) {
            const frac = clamp(
              (c.timestampMs - visible[i - 1].timestampMs) / (visible[i].timestampMs - visible[i - 1].timestampMs),
              0.08,
              0.92,
            );
            x = xs[i - 1] + (xs[i] - xs[i - 1]) * frac;
          }
          markers.push({ x, compaction: c });
          placed = true;
          break;
        }
      }
    }
    if (!placed && c.timestampMs > 0) {
      for (let i = 1; i < visible.length; i++) {
        if (
          visible[i - 1].timestampMs > 0
          && visible[i].timestampMs > 0
          && visible[i - 1].timestampMs <= c.timestampMs
          && c.timestampMs <= visible[i].timestampMs
        ) {
          const span = visible[i].timestampMs - visible[i - 1].timestampMs;
          const frac = useTimeMode && span > 0 ? clamp((c.timestampMs - visible[i - 1].timestampMs) / span, 0.1, 0.9) : 0.5;
          markers.push({ x: xs[i - 1] + (xs[i] - xs[i - 1]) * frac, compaction: c });
          break;
        }
      }
    }
  }
  return markers;
}

/**
 * Compute fractional [0..1] positions of compactions across the entire filtered series
 * for the minimap scrubber.
 */
export function locateMinimapCompactionFractions(
  allFiltered: Invocation[],
  compactions: Compaction[],
): number[] {
  const n = allFiltered.length;
  if (n < 2 || !compactions.length) return [];
  const fracs: number[] = [];
  for (const c of compactions) {
    if (c.afterGmIdx !== null && c.afterGmIdx !== undefined) {
      for (let i = 1; i < n; i++) {
        if (allFiltered[i - 1].idx < c.afterGmIdx && allFiltered[i].idx >= c.afterGmIdx) {
          fracs.push((i - 0.5) / (n - 1));
          break;
        }
      }
    }
  }
  return fracs;
}

function estimateViewportHeadroomTurns(visible: Invocation[]): number | null {
  if (visible.length < 2) return null;
  const last = visible[visible.length - 1];
  const limit = last.contextLimit || 0;
  const used = last.totalContext || 0;
  if (limit <= 0) return null;
  if (used >= limit) return 0;

  let startIdx = 0;
  for (let i = visible.length - 1; i > 0; i--) {
    if (visible[i].totalContext < visible[i - 1].totalContext * 0.65) {
      startIdx = i;
      break;
    }
  }
  const postCmp = visible.slice(startIdx);
  const byTurn: Array<{ k: string | number; ctx: number }> = [];
  for (const r of postCmp) {
    const k = r.turnIndex ?? `call:${r.idx}`;
    const prev = byTurn.length ? byTurn[byTurn.length - 1] : null;
    if (prev && prev.k === k) {
      if (r.totalContext > prev.ctx) prev.ctx = r.totalContext;
    } else {
      byTurn.push({ k, ctx: r.totalContext });
    }
  }
  const series = byTurn.length >= 3 ? byTurn.map((x) => x.ctx) : postCmp.map((x) => x.totalContext);
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return null;
  const recentDeltas = deltas.slice(-6).sort((a, b) => a - b);
  const mid = Math.floor(recentDeltas.length / 2);
  const medianDelta =
    recentDeltas.length % 2 === 1
      ? recentDeltas[mid]
      : Math.round((recentDeltas[mid - 1] + recentDeltas[mid]) / 2);
  if (medianDelta <= 0) return null;
  return Math.max(0, Math.floor((limit - used) / medianDelta));
}

export function computeViewportStats(
  visible: Invocation[],
  metric: ChartMetric,
  compactions: Compaction[] = [],
): ViewportStats {
  const count = visible.length;
  if (count === 0) {
    return {
      count: 0,
      latest: null,
      avg: null,
      p50: null,
      p95: null,
      min: null,
      max: null,
      sum: 0,
      deltaVsAvgPct: null,
      deltaVsAvgPp: null,
      thinkSharePct: null,
      highCacheCount: 0,
      validCacheCount: 0,
      compactsInView: 0,
      headroomTurns: null,
      latestIsBuffered: false,
    };
  }

  const last = visible[count - 1];
  const dummyXs = visible.map((_, i) => i);
  const compactsInView = locateCompactionMarkers(visible, compactions, dummyXs, false).length;

  if (metric === 'tps') {
    const sustained = visible.filter((r) => !r.isBuffered && Number.isFinite(r.genTps) && r.genTps > 0).map((r) => r.genTps);
    const pool = sustained.length > 0 ? sustained : visible.map((r) => getMetricValue(r, 'tps')).filter((v) => v > 0);
    const latest = getMetricValue(last, 'tps');
    const sum = pool.reduce((a, b) => a + b, 0);
    const avg = pool.length ? sum / pool.length : null;
    const p50 = percentile(pool, 0.5);
    const p95 = percentile(pool, 0.95);
    const min = pool.length ? Math.min(...pool) : null;
    const max = pool.length ? Math.max(...pool) : null;
    const deltaVsAvgPct = avg && avg > 0 && latest > 0 ? ((latest - avg) / avg) * 100 : null;
    return {
      count,
      latest,
      avg,
      p50,
      p95,
      min,
      max,
      sum,
      deltaVsAvgPct,
      deltaVsAvgPp: null,
      thinkSharePct: null,
      highCacheCount: 0,
      validCacheCount: 0,
      compactsInView,
      headroomTurns: null,
      latestIsBuffered: Boolean(last.isBuffered),
    };
  }

  if (metric === 'ttft') {
    const vals = visible.map((r) => Math.max(0, r.ttftSec || 0));
    const latest = vals[count - 1];
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    const deltaVsAvgPct = avg > 0 ? ((latest - avg) / avg) * 100 : null;
    return {
      count,
      latest,
      avg,
      p50: percentile(vals, 0.5),
      p95: percentile(vals, 0.95),
      min: Math.min(...vals),
      max: Math.max(...vals),
      sum,
      deltaVsAvgPct,
      deltaVsAvgPp: null,
      thinkSharePct: null,
      highCacheCount: 0,
      validCacheCount: 0,
      compactsInView,
      headroomTurns: null,
      latestIsBuffered: false,
    };
  }

  if (metric === 'out') {
    const vals = visible.map((r) => Math.max(0, r.outputTokens || 0));
    const sum = vals.reduce((a, b) => a + b, 0);
    const thkSum = visible.reduce((a, r) => a + Math.max(0, r.thinkingTokens || 0), 0);
    const avg = sum / count;
    const latest = vals[count - 1];
    const deltaVsAvgPct = avg > 0 ? ((latest - avg) / avg) * 100 : null;
    return {
      count,
      latest,
      avg,
      p50: percentile(vals, 0.5),
      p95: percentile(vals, 0.95),
      min: Math.min(...vals),
      max: Math.max(...vals),
      sum,
      deltaVsAvgPct,
      deltaVsAvgPp: null,
      thinkSharePct: sum > 0 ? clamp((thkSum / sum) * 100, 0, 100) : 0,
      highCacheCount: 0,
      validCacheCount: 0,
      compactsInView,
      headroomTurns: null,
      latestIsBuffered: false,
    };
  }

  if (metric === 'cache') {
    const valid = visible
      .map((r) => r.cacheHitPct)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    const latest = last.cacheHitPct !== null && last.cacheHitPct !== undefined && Number.isFinite(last.cacheHitPct)
      ? last.cacheHitPct
      : null;
    const sum = valid.reduce((a, b) => a + b, 0);
    const avg = valid.length ? sum / valid.length : null;
    const highCacheCount = valid.filter((v) => v >= 80).length;
    const deltaVsAvgPp = latest !== null && avg !== null ? latest - avg : null;
    return {
      count,
      latest,
      avg,
      p50: percentile(valid, 0.5),
      p95: percentile(valid, 0.95),
      min: valid.length ? Math.min(...valid) : null,
      max: valid.length ? Math.max(...valid) : null,
      sum,
      deltaVsAvgPct: null,
      deltaVsAvgPp,
      thinkSharePct: null,
      highCacheCount,
      validCacheCount: valid.length,
      compactsInView,
      headroomTurns: null,
      latestIsBuffered: false,
    };
  }

  if (metric === 'ctx') {
    const vals = visible.map((r) => clamp(r.contextPct || 0, 0, 100));
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    const latest = vals[count - 1];
    return {
      count,
      latest,
      avg,
      p50: percentile(vals, 0.5),
      p95: percentile(vals, 0.95),
      min: Math.min(...vals),
      max: Math.max(...vals),
      sum,
      deltaVsAvgPct: null,
      deltaVsAvgPp: latest - avg,
      thinkSharePct: null,
      highCacheCount: 0,
      validCacheCount: 0,
      compactsInView,
      headroomTurns: estimateViewportHeadroomTurns(visible),
      latestIsBuffered: false,
    };
  }

  // quota
  const vals = visible.map((r) => Math.max(0, r.quotaPct5h || 0));
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const latest = vals[count - 1];
  const deltaVsAvgPct = avg > 0 ? ((latest - avg) / avg) * 100 : null;
  return {
    count,
    latest,
    avg,
    p50: percentile(vals, 0.5),
    p95: percentile(vals, 0.95),
    min: Math.min(...vals),
    max: Math.max(...vals),
    sum,
    deltaVsAvgPct,
    deltaVsAvgPp: null,
    thinkSharePct: null,
    highCacheCount: 0,
    validCacheCount: 0,
    compactsInView,
    headroomTurns: null,
    latestIsBuffered: false,
  };
}
