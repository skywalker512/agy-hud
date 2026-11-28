import type { GeminiIntradayPoint, GeminiModelGlobalPulse } from '../../../types/telemetry';
import { fmtSec, fmtTps } from '../../../utils/format';

export type GlobalTrendMetric = 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime';

export interface SeriesLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  isLocal?: boolean;
  points: Array<{ xIdx: number; xLabel: string; val: number; isLive30m?: boolean }>;
  latestVal: number;
}

export interface GlobalSummaryCell {
  k: string;
  v: string;
  sub: string;
  tone: string;
}

const FALLBACK_COLORS = [
  'var(--seg-input)',
  'var(--seg-cache)',
  'var(--seg-think)',
  'var(--seg-out)',
  'var(--hud-bad)',
] as const;

// Stable, permanent color per Gemini family so toggling models NEVER shifts line/pill colors.
export const GEMINI_FAMILY_COLORS: Record<string, string> = {
  'gemini-4-neon': 'var(--seg-input)',
  'gemini-4-hydrogen': 'var(--seg-cache)',
  'gemini-4-carbon': 'var(--seg-think)',
  'gemini-4-argon': 'var(--seg-out)',
  'gemini-3.8-flash': 'var(--hud-bad)',
};

export function stableGeminiModelColor(family: string, modelListIndex = 0): string {
  return GEMINI_FAMILY_COLORS[family] || FALLBACK_COLORS[modelListIndex % FALLBACK_COLORS.length];
}

export function stableProviderColor(provider: string, idx: number): string {
  if (/vertex/i.test(provider)) return 'var(--seg-input)';
  if (/ai\s*studio/i.test(provider)) return 'var(--seg-out)';
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

export function shortGlobalModelName(label: string): string {
  return label
    .replace(/^Gemini\s+/i, '')
    .replace(/^4\s+Hydrogen$/i, 'Hydro')
    .replace(/^4\s+Carbon$/i, 'Carbon')
    .replace(/^4\s+Neon$/i, 'Neon')
    .replace(/^4\s+Argon$/i, 'Argon');
}

export function fmtGlobalVal(val: number, metric: GlobalTrendMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return fmtSec(val);
  if (metric === 'tps') return `${fmtTps(val)} t/s`;
  if (metric === 'uptime') return `${val.toFixed(1)}%`;
  return `${Math.round(val)}%`;
}

export function fmtGlobalAxisTick(val: number, metric: GlobalTrendMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return val >= 10 ? `${Math.round(val)}s` : `${val.toFixed(1)}s`;
  if (metric === 'tps') return `${Math.round(val)}`;
  return `${Math.round(val)}%`;
}

export function fmtGlobalShortX(xLabel: string, metric: GlobalTrendMetric, isZh: boolean, isIntraday = false): string {
  if (xLabel === '__live30m__') return isZh ? '近30m' : '30m';
  if (metric === 'uptime' || isIntraday) {
    const ms = Date.parse(`${xLabel.replace(' ', 'T')}:00Z`);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return xLabel.slice(11, 16) || xLabel;
  }
  return xLabel.slice(5, 10);
}

export function buildGlobalSeries(params: {
  models: GeminiModelGlobalPulse[];
  activeFamilies: string[];
  metric: GlobalTrendMetric;
  effectiveSplit: boolean;
  effectiveIntraday: boolean;
  singleSelectedModel: GeminiModelGlobalPulse | null;
  showLocalOverlay: boolean;
  matchLocalCtx: boolean;
  activeFamily?: string;
  modelIndexMap: Map<string, number>;
  isZh: boolean;
}): { xLabels: string[]; seriesLines: SeriesLine[] } {
  const {
    models,
    activeFamilies,
    metric,
    effectiveSplit,
    effectiveIntraday,
    singleSelectedModel,
    showLocalOverlay,
    matchLocalCtx,
    activeFamily,
    modelIndexMap,
    isZh,
  } = params;

  if (!models.length || !activeFamilies.length) {
    return { xLabels: [], seriesLines: [] };
  }

  const targetModels = activeFamilies
    .map((f) => models.find((m) => m.family === f))
    .filter((m): m is GeminiModelGlobalPulse => Boolean(m));

  // Intraday 5m ring-buffer mode
  if (effectiveIntraday) {
    const labelSet = new Set<string>();
    for (const m of targetModels) {
      for (const b of m.series?.intraday30m || []) labelSet.add(b.x);
    }
    const sortedX = [...labelSet].sort();
    const idxMap = new Map(sortedX.map((x, i) => [x, i]));

    const pickIntradayVal = (pt: GeminiIntradayPoint) =>
      metric === 'ttft'
        ? pt.p50TtftSec
        : metric === 'tps'
          ? pt.p50Tps
          : metric === 'cache'
            ? pt.cacheHitPct
            : pt.uptime5mPct ?? pt.uptime30mPct;

    if (effectiveSplit && singleSelectedModel) {
      const buckets = singleSelectedModel.series?.intraday30m || [];
      const provs = new Set<string>();
      for (const b of buckets) {
        for (const k of Object.keys(b.byProvider || {})) provs.add(k);
      }
      const lines: SeriesLine[] = [];
      let ci = 0;
      for (const prov of provs) {
        const pts: SeriesLine['points'] = [];
        for (const b of buckets) {
          const pObj = b.byProvider?.[prov];
          const v = metric === 'ttft' ? pObj?.ttft : metric === 'tps' ? pObj?.tps : pObj?.cache;
          if (typeof v === 'number' && v > 0 && idxMap.has(b.x)) {
            pts.push({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: v });
          }
        }
        if (!pts.length) continue;
        lines.push({
          id: prov,
          label: prov,
          color: stableProviderColor(prov, ci),
          points: pts,
          latestVal: pts[pts.length - 1].val,
        });
        ci += 1;
      }
      return { xLabels: sortedX, seriesLines: lines };
    }

    const lines: SeriesLine[] = [];
    for (const m of targetModels) {
      const pts: SeriesLine['points'] = [];
      for (const b of m.series?.intraday30m || []) {
        const v = pickIntradayVal(b);
        if (typeof v === 'number' && v > 0 && idxMap.has(b.x)) {
          pts.push({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: v });
        }
      }
      if (!pts.length) continue;
      lines.push({
        id: m.family,
        label: shortGlobalModelName(m.label),
        color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
        points: pts,
        latestVal: pts[pts.length - 1].val,
      });
    }
    return { xLabels: sortedX, seriesLines: lines };
  }

  // 24h uptime series
  if (metric === 'uptime') {
    const labelSet = new Set<string>();
    for (const m of targetModels) {
      for (const b of m.series?.uptime24h || []) labelSet.add(b.x);
    }
    const sortedX = [...labelSet].sort();
    const idxMap = new Map(sortedX.map((x, i) => [x, i]));

    if (effectiveSplit && singleSelectedModel) {
      const buckets = singleSelectedModel.series?.uptime24h || [];
      const routedPts = buckets
        .filter((b) => idxMap.has(b.x))
        .map((b) => ({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: b.availability }));
      const rawPts = buckets
        .filter((b) => idxMap.has(b.x) && b.rawAvailability !== null)
        .map((b) => ({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: b.rawAvailability! }));
      const lines: SeriesLine[] = [];
      if (routedPts.length) {
        lines.push({
          id: 'routed',
          label: isZh ? 'OpenRouter 路由可用' : 'Routed Uptime',
          color: 'var(--seg-cache)',
          points: routedPts,
          latestVal: routedPts[routedPts.length - 1].val,
        });
      }
      if (rawPts.length) {
        lines.push({
          id: 'raw',
          label: isZh ? '单节点裸可用率' : 'Raw (No Routing)',
          color: 'var(--seg-out)',
          dashed: true,
          points: rawPts,
          latestVal: rawPts[rawPts.length - 1].val,
        });
      }
      return { xLabels: sortedX, seriesLines: lines };
    }

    const lines: SeriesLine[] = [];
    for (const m of targetModels) {
      const pts = (m.series?.uptime24h || [])
        .filter((b) => idxMap.has(b.x))
        .map((b) => ({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: b.availability }));
      if (!pts.length) continue;
      lines.push({
        id: m.family,
        label: shortGlobalModelName(m.label),
        color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
        points: pts,
        latestVal: pts[pts.length - 1].val,
      });
    }
    return { xLabels: sortedX, seriesLines: lines };
  }

  // 7d daily series + live 30m point + optional local overlay curve
  const localFocusModel: GeminiModelGlobalPulse | null =
    (singleSelectedModel && (singleSelectedModel.local?.calls7d || 0) > 0 ? singleSelectedModel : null) ||
    targetModels.find((m) => m.family === activeFamily && (m.local?.calls7d || 0) > 0) ||
    [...targetModels]
      .filter((m) => (m.local?.calls7d || 0) > 0)
      .sort((a, b) => (b.local?.calls7d || 0) - (a.local?.calls7d || 0))[0] ||
    models.find((m) => m.family === activeFamily && (m.local?.calls7d || 0) > 0) ||
    null;

  const getArr = (m: GeminiModelGlobalPulse) =>
    metric === 'ttft'
      ? m.series?.ttft7d || []
      : metric === 'e2e'
        ? m.series?.e2e7d || []
        : metric === 'tps'
          ? m.series?.tps7d || []
          : m.series?.cache7d || [];
  const getLive30m = (m: GeminiModelGlobalPulse): number | null =>
    metric === 'ttft' ? m.p50TtftSec : metric === 'tps' ? m.p50Tps : metric === 'cache' ? m.cacheHitPct : null;
  const getLocalDailyVal = (pt: {
    p50TtftSec: number | null;
    p50Tps: number | null;
    cacheHitPct: number | null;
  }): number | null =>
    metric === 'ttft' ? pt.p50TtftSec : metric === 'tps' ? pt.p50Tps : metric === 'cache' ? pt.cacheHitPct : null;
  const getLocalLive30m = (m: GeminiModelGlobalPulse): number | null => {
    if (metric === 'e2e') return null;
    const loc = m.local;
    if (!loc) return null;
    const v30 = metric === 'ttft' ? loc.p50Ttft30mSec : metric === 'tps' ? loc.p50Tps30m : loc.cacheHit30mPct;
    if (typeof v30 === 'number' && v30 > 0) return v30;
    const v24 = metric === 'ttft' ? loc.p50Ttft24hSec : metric === 'tps' ? loc.p50Tps24h : loc.cacheHit24hPct;
    return typeof v24 === 'number' && v24 > 0 ? v24 : null;
  };
  const localDailySrc = (m: GeminiModelGlobalPulse | null) =>
    matchLocalCtx && m?.local?.daily7dMatched?.length ? m.local.daily7dMatched : m?.local?.daily7d || [];

  const dateSet = new Set<string>();
  for (const m of targetModels) {
    for (const pt of getArr(m)) dateSet.add(pt.x);
  }
  if (showLocalOverlay && localFocusModel) {
    for (const pt of localDailySrc(localFocusModel)) {
      const v = getLocalDailyVal(pt);
      if (v !== null && v > 0) dateSet.add(pt.x);
    }
  }
  const sortedDates = [...dateSet].sort();
  const hasAnyLive =
    targetModels.some((m) => {
      const v = getLive30m(m);
      return v !== null && v > 0;
    }) || Boolean(showLocalOverlay && !matchLocalCtx && localFocusModel && getLocalLive30m(localFocusModel) !== null);
  const finalX = hasAnyLive ? [...sortedDates, '__live30m__'] : sortedDates;
  const idxMap = new Map(finalX.map((x, i) => [x, i]));

  const buildLocalSeriesLine = (m: GeminiModelGlobalPulse | null): SeriesLine | null => {
    if (!showLocalOverlay || metric === 'e2e' || !m?.local) return null;
    const pts: SeriesLine['points'] = [];
    for (const dp of localDailySrc(m)) {
      const v = getLocalDailyVal(dp);
      if (v !== null && v > 0 && idxMap.has(dp.x)) {
        pts.push({ xIdx: idxMap.get(dp.x)!, xLabel: dp.x, val: v });
      }
    }
    const liveV = matchLocalCtx ? null : getLocalLive30m(m);
    if (liveV !== null && liveV > 0 && idxMap.has('__live30m__')) {
      pts.push({ xIdx: idxMap.get('__live30m__')!, xLabel: '__live30m__', val: liveV, isLive30m: true });
    }
    if (pts.length === 0) {
      const matched = matchLocalCtx ? m.local.matched100k : null;
      const baseV = matched
        ? (metric === 'ttft' ? matched.p50TtftSec : metric === 'tps' ? matched.p50Tps : matched.cacheHitPct)
        : (metric === 'ttft' ? m.local.p50TtftSec : metric === 'tps' ? m.local.p50Tps : m.local.cacheHitPct);
      if (baseV !== null && baseV > 0 && finalX.length >= 2) {
        pts.push({ xIdx: 0, xLabel: finalX[0], val: baseV });
        pts.push({ xIdx: finalX.length - 1, xLabel: finalX[finalX.length - 1], val: baseV });
      }
    }
    if (!pts.length) return null;
    const ctxTag = matchLocalCtx ? ' <100k' : '';
    return {
      id: `local:${m.family}`,
      label: isZh ? `本机${ctxTag} · ${shortGlobalModelName(m.label)}` : `Mine${ctxTag} · ${shortGlobalModelName(m.label)}`,
      color: 'var(--hud-fg)',
      dashed: true,
      isLocal: true,
      points: pts,
      latestVal: pts[pts.length - 1].val,
    };
  };

  if (effectiveSplit && singleSelectedModel) {
    const arr = getArr(singleSelectedModel);
    const provNames = new Set<string>();
    for (const pt of arr) {
      for (const k of Object.keys(pt.byProvider || {})) provNames.add(k);
    }
    const lines: SeriesLine[] = [];
    let ci = 0;
    for (const prov of provNames) {
      const pts: SeriesLine['points'] = [];
      for (const pt of arr) {
        const v = pt.byProvider?.[prov];
        if (typeof v === 'number' && v > 0 && idxMap.has(pt.x)) {
          pts.push({ xIdx: idxMap.get(pt.x)!, xLabel: pt.x, val: v });
        }
      }
      const epMatch = (singleSelectedModel.endpoints || []).find((ep) => {
        const n = /vertex/i.test(ep.providerName || ep.providerSlug)
          ? 'Google Vertex'
          : /ai[- ]?studio/i.test(ep.providerName || ep.providerSlug)
            ? 'AI Studio'
            : ep.providerName || ep.providerSlug;
        return n === prov;
      });
      const epLive = epMatch
        ? metric === 'ttft'
          ? epMatch.p50TtftSec
          : metric === 'tps'
            ? epMatch.p50Tps
            : metric === 'cache'
              ? epMatch.cacheHitPct
              : null
        : null;
      if (epLive !== null && epLive > 0 && idxMap.has('__live30m__')) {
        pts.push({ xIdx: idxMap.get('__live30m__')!, xLabel: '__live30m__', val: epLive, isLive30m: true });
      }
      if (!pts.length) continue;
      lines.push({
        id: prov,
        label: prov,
        color: stableProviderColor(prov, ci),
        points: pts,
        latestVal: pts[pts.length - 1].val,
      });
      ci += 1;
    }
    const localLine = buildLocalSeriesLine(singleSelectedModel);
    if (localLine) lines.push(localLine);
    return { xLabels: finalX, seriesLines: lines };
  }

  const lines: SeriesLine[] = [];
  for (const m of targetModels) {
    const arr = getArr(m);
    const pts: SeriesLine['points'] = arr
      .filter((pt) => idxMap.has(pt.x))
      .map((pt) => ({ xIdx: idxMap.get(pt.x)!, xLabel: pt.x, val: pt.value }));
    const liveVal = getLive30m(m);
    if (liveVal !== null && liveVal > 0 && idxMap.has('__live30m__')) {
      pts.push({ xIdx: idxMap.get('__live30m__')!, xLabel: '__live30m__', val: liveVal, isLive30m: true });
    }
    if (!pts.length) continue;
    lines.push({
      id: m.family,
      label: shortGlobalModelName(m.label),
      color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
      points: pts,
      latestVal: pts[pts.length - 1].val,
    });
  }

  const localLine = buildLocalSeriesLine(localFocusModel);
  if (localLine) lines.push(localLine);

  return { xLabels: finalX, seriesLines: lines };
}

export function buildGlobalSummaryCells(params: {
  seriesLines: SeriesLine[];
  metric: GlobalTrendMetric;
  effectiveIntraday: boolean;
  xLabelCount: number;
  activeFamily?: string;
  models: GeminiModelGlobalPulse[];
  singleSelectedModel: GeminiModelGlobalPulse | null;
  activeFamilies: string[];
  isZh: boolean;
}): GlobalSummaryCell[] {
  const {
    seriesLines,
    metric,
    effectiveIntraday,
    xLabelCount,
    activeFamily,
    models,
    singleSelectedModel,
    activeFamilies,
    isZh,
  } = params;
  if (!seriesLines.length) return [];

  const globalLines = seriesLines.filter((s) => !s.isLocal);
  const poolForBest = globalLines.length ? globalLines : seriesLines;
  const lowerIsBetter = metric === 'ttft' || metric === 'e2e';
  const sorted = [...poolForBest].sort((a, b) =>
    lowerIsBetter ? a.latestVal - b.latestVal : b.latestVal - a.latestVal,
  );
  const best = sorted[0];
  const focusLine = poolForBest.find((s) => s.id === activeFamily) || poolForBest[0];
  const allVals = seriesLines.flatMap((s) => s.points.map((p) => p.val));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);

  const localLine = seriesLines.find((s) => s.isLocal);
  const refModel =
    models.find((m) => m.family === (singleSelectedModel?.family || activeFamily || activeFamilies[0])) || null;
  const localVal =
    localLine?.latestVal ??
    (refModel?.local
      ? metric === 'ttft'
        ? refModel.local.p50TtftSec
        : metric === 'tps'
          ? refModel.local.p50Tps
          : metric === 'cache'
            ? refModel.local.cacheHitPct
            : null
      : null);

  const fourthCell: GlobalSummaryCell =
    metric === 'e2e' && refModel?.p99TtftSec != null
      ? {
          k: 'P99 TTFT',
          v: fmtSec(refModel.p99TtftSec),
          sub: refModel.toolCallErrorPct != null
            ? `Tool Err ${refModel.toolCallErrorPct}%`
            : shortGlobalModelName(refModel.label),
          tone: refModel.p99TtftSec >= 30 ? 'text-hud-warn' : 'text-hud-fg',
        }
      : {
          k: isZh ? '我的实测' : 'MY LOCAL',
          v: localVal !== null ? fmtGlobalVal(localVal, metric) : '--',
          sub: localLine ? localLine.label : refModel ? shortGlobalModelName(refModel.label) : '--',
          tone: 'text-hud-accent-ink',
        };

  return [
    {
      k: isZh ? '🏆 大盘最优' : '🏆 LEADER',
      v: fmtGlobalVal(best.latestVal, metric),
      sub: best.label,
      tone: 'text-hud-ok',
    },
    {
      k: focusLine.label,
      v: fmtGlobalVal(focusLine.latestVal, metric),
      sub: effectiveIntraday
        ? isZh ? '5m 实时' : 'Live 5m'
        : metric === 'uptime'
          ? (isZh ? '近 24h 最新' : 'Latest 24h')
          : metric === 'e2e'
            ? (isZh ? '最新日均' : 'Latest Day')
            : isZh ? '近 30m 实时' : 'Live 30m',
      tone: 'text-hud-fg',
    },
    {
      k: isZh ? '区间波动' : 'RANGE',
      v: `${fmtGlobalAxisTick(minV, metric)}–${fmtGlobalAxisTick(maxV, metric)}`,
      sub: effectiveIntraday
        ? `${xLabelCount}×5m`
        : metric === 'uptime'
          ? '24h'
          : isZh ? '近 7 天' : '7d',
      tone: 'text-hud-fg',
    },
    fourthCell,
  ];
}
