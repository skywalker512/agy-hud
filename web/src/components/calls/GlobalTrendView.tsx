import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GeminiIntradayPoint, GeminiModelGlobalPulse, GeminiPulseSnapshot, Lang } from '../../types/telemetry';
import { fmtClock, fmtSec, fmtTps } from '../../utils/format';
import { buildMonotonePath, clamp, niceMax } from './trendMath';

export type GlobalTrendMetric = 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime';

interface GlobalTrendViewProps {
  geminiPulse?: GeminiPulseSnapshot;
  metric: GlobalTrendMetric;
  onSelectMetric: (m: GlobalTrendMetric) => void;
  lang: Lang;
}

interface SeriesLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  isLocal?: boolean;
  points: Array<{ xIdx: number; xLabel: string; val: number; isLive30m?: boolean }>;
  latestVal: number;
}

const FALLBACK_COLORS = [
  'var(--seg-input)',
  'var(--seg-cache)',
  'var(--seg-think)',
  'var(--seg-out)',
  'var(--hud-bad)',
] as const;

// Stable, permanent color per Gemini family so toggling models NEVER shifts line/pill colors!
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

function stableProviderColor(provider: string, idx: number): string {
  if (/vertex/i.test(provider)) return 'var(--seg-input)';
  if (/ai\s*studio/i.test(provider)) return 'var(--seg-out)';
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function shortName(label: string): string {
  return label
    .replace(/^Gemini\s+/i, '')
    .replace(/^4\s+Hydrogen$/i, 'Hydro')
    .replace(/^4\s+Carbon$/i, 'Carbon')
    .replace(/^4\s+Neon$/i, 'Neon')
    .replace(/^4\s+Argon$/i, 'Argon');
}

function fmtVal(val: number, metric: GlobalTrendMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return fmtSec(val);
  if (metric === 'tps') return `${fmtTps(val)} t/s`;
  if (metric === 'uptime') return `${val.toFixed(1)}%`;
  return `${Math.round(val)}%`;
}

function fmtAxisTick(val: number, metric: GlobalTrendMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return val >= 10 ? `${Math.round(val)}s` : `${val.toFixed(1)}s`;
  if (metric === 'tps') return `${Math.round(val)}`;
  return `${Math.round(val)}%`;
}

function fmtShortX(xLabel: string, metric: GlobalTrendMetric, isZh: boolean, isIntraday = false): string {
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

export function GlobalTrendView({
  geminiPulse,
  metric,
  onSelectMetric,
  lang,
}: GlobalTrendViewProps) {
  const isZh = lang === 'zh';
  const models = geminiPulse?.available ? geminiPulse.models : [];
  const boxRef = useRef<HTMLDivElement>(null);
  const [svgW, setSvgW] = useState(380);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [splitProviders, setSplitProviders] = useState<boolean>(false);
  const [showLocalOverlay, setShowLocalOverlay] = useState<boolean>(true);
  const [granularity, setGranularity] = useState<'7d' | '5m'>('7d');
  const [selectedFamilies, setSelectedFamilies] = useState<string[] | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setSvgW(Math.max(220, Math.round(el.clientWidth)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth;
      if (w > 0) setSvgW(Math.max(220, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const modelIndexMap = useMemo(
    () => new Map(models.map((m, idx) => [m.family, idx])),
    [models],
  );

  // Default selection: active Gemini model + top 2 peers (3 lines cleanly readable)
  const defaultFamilies = useMemo(() => {
    if (!models.length) return [];
    const active = geminiPulse?.activeFamily || '';
    const out: string[] = [];
    if (active && models.some((m) => m.family === active)) out.push(active);
    for (const m of models) {
      if (out.length >= 3) break;
      if (!out.includes(m.family)) out.push(m.family);
    }
    return out;
  }, [models, geminiPulse?.activeFamily]);

  const activeFamilies = useMemo(() => {
    if (!models.length) return [];
    if (selectedFamilies !== null) {
      const valid = selectedFamilies.filter((f) => models.some((m) => m.family === f));
      if (valid.length > 0) return valid;
    }
    return defaultFamilies;
  }, [models, selectedFamilies, defaultFamilies]);

  const toggleFamily = (fam: string) => {
    setSelectedFamilies((prev) => {
      const cur = prev !== null ? prev : defaultFamilies;
      if (cur.includes(fam)) {
        return cur.length > 1 ? cur.filter((x) => x !== fam) : cur;
      }
      return [...cur, fam];
    });
  };

  const focusSingleModel = (fam: string) => {
    setSelectedFamilies([fam]);
  };

  const singleSelectedModel: GeminiModelGlobalPulse | null =
    activeFamilies.length === 1 ? models.find((m) => m.family === activeFamilies[0]) || null : null;

  const maxIntradayPoints = useMemo(
    () => models.reduce((acc, m) => Math.max(acc, m.series?.intraday30m?.length || 0), 0),
    [models],
  );
  const canUseIntraday = metric !== 'e2e' && maxIntradayPoints >= 2;
  const effectiveIntraday = granularity === '5m' && canUseIntraday;

  const canSplitProviders = useMemo(() => {
    if (!singleSelectedModel?.series) return false;
    if (metric === 'uptime') {
      return singleSelectedModel.series.uptime24h.some((b) => b.rawAvailability !== null);
    }
    if (effectiveIntraday) {
      const provs = new Set<string>();
      for (const pt of singleSelectedModel.series.intraday30m || []) {
        for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
      }
      return provs.size >= 2;
    }
    const arr =
      metric === 'ttft'
        ? singleSelectedModel.series.ttft7d
        : metric === 'e2e'
          ? singleSelectedModel.series.e2e7d || []
          : metric === 'tps'
            ? singleSelectedModel.series.tps7d
            : singleSelectedModel.series.cache7d;
    const provs = new Set<string>();
    for (const pt of arr) {
      for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
    }
    return provs.size >= 2;
  }, [singleSelectedModel, metric, effectiveIntraday]);

  const effectiveSplit = splitProviders && canSplitProviders && singleSelectedModel !== null;

  const hasAnyLocalCurve = useMemo(
    () => metric !== 'uptime' && metric !== 'e2e' && !effectiveIntraday && models.some((m) => (m.local?.calls7d || 0) > 0),
    [metric, effectiveIntraday, models],
  );

  // Build unified X-axis labels & plotted SeriesLine[]
  const { xLabels, seriesLines } = useMemo(() => {
    if (!models.length || !activeFamilies.length) {
      return { xLabels: [] as string[], seriesLines: [] as SeriesLine[] };
    }

    const targetModels = activeFamilies
      .map((f) => models.find((m) => m.family === f))
      .filter((m): m is GeminiModelGlobalPulse => Boolean(m));

    // True 30-minute intraday mode (populated from local 48h ring buffer or Cloudflare Worker feed)
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
          label: shortName(m.label),
          color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
          points: pts,
          latestVal: pts[pts.length - 1].val,
        });
      }
      return { xLabels: sortedX, seriesLines: lines };
    }

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
          label: shortName(m.label),
          color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
          points: pts,
          latestVal: pts[pts.length - 1].val,
        });
      }
      return { xLabels: sortedX, seriesLines: lines };
    }

    // 7d daily series (ttft / tps / cache) + live 30m point + optional LOCAL 7d+30m overlay curve!
    const localFocusModel: GeminiModelGlobalPulse | null =
      (singleSelectedModel && (singleSelectedModel.local?.calls7d || 0) > 0
        ? singleSelectedModel
        : null) ||
      targetModels.find((m) => m.family === geminiPulse?.activeFamily && (m.local?.calls7d || 0) > 0) ||
      [...targetModels]
        .filter((m) => (m.local?.calls7d || 0) > 0)
        .sort((a, b) => (b.local?.calls7d || 0) - (a.local?.calls7d || 0))[0] ||
      models.find((m) => m.family === geminiPulse?.activeFamily && (m.local?.calls7d || 0) > 0) ||
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

    const dateSet = new Set<string>();
    for (const m of targetModels) {
      for (const pt of getArr(m)) dateSet.add(pt.x);
    }
    if (showLocalOverlay && localFocusModel?.local?.daily7d) {
      for (const pt of localFocusModel.local.daily7d) {
        const v = getLocalDailyVal(pt);
        if (v !== null && v > 0) dateSet.add(pt.x);
      }
    }
    const sortedDates = [...dateSet].sort();
    const hasAnyLive =
      targetModels.some((m) => {
        const v = getLive30m(m);
        return v !== null && v > 0;
      }) || Boolean(showLocalOverlay && localFocusModel && getLocalLive30m(localFocusModel) !== null);
    const finalX = hasAnyLive ? [...sortedDates, '__live30m__'] : sortedDates;
    const idxMap = new Map(finalX.map((x, i) => [x, i]));

    const buildLocalSeriesLine = (m: GeminiModelGlobalPulse | null): SeriesLine | null => {
      if (!showLocalOverlay || metric === 'e2e' || !m?.local) return null;
      const pts: SeriesLine['points'] = [];
      for (const dp of m.local.daily7d || []) {
        const v = getLocalDailyVal(dp);
        if (v !== null && v > 0 && idxMap.has(dp.x)) {
          pts.push({ xIdx: idxMap.get(dp.x)!, xLabel: dp.x, val: v });
        }
      }
      const liveV = getLocalLive30m(m);
      if (liveV !== null && liveV > 0 && idxMap.has('__live30m__')) {
        pts.push({ xIdx: idxMap.get('__live30m__')!, xLabel: '__live30m__', val: liveV, isLive30m: true });
      }
      // Graceful fallback if local 7d summary exists before daily7d buckets are populated
      if (pts.length === 0) {
        const baseV = metric === 'ttft' ? m.local.p50TtftSec : metric === 'tps' ? m.local.p50Tps : m.local.cacheHitPct;
        if (baseV !== null && baseV > 0 && finalX.length >= 2) {
          pts.push({ xIdx: 0, xLabel: finalX[0], val: baseV });
          pts.push({ xIdx: finalX.length - 1, xLabel: finalX[finalX.length - 1], val: baseV });
        }
      }
      if (!pts.length) return null;
      return {
        id: `local:${m.family}`,
        label: isZh ? `本机 · ${shortName(m.label)}` : `Mine · ${shortName(m.label)}`,
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
        label: shortName(m.label),
        color: stableGeminiModelColor(m.family, modelIndexMap.get(m.family) || 0),
        points: pts,
        latestVal: pts[pts.length - 1].val,
      });
    }

    const localLine = buildLocalSeriesLine(localFocusModel);
    if (localLine) lines.push(localLine);

    return { xLabels: finalX, seriesLines: lines };
  }, [
    models,
    activeFamilies,
    metric,
    effectiveSplit,
    effectiveIntraday,
    singleSelectedModel,
    showLocalOverlay,
    geminiPulse?.activeFamily,
    modelIndexMap,
    isZh,
  ]);

  const hasTimeSeries = xLabels.length >= 2 && seriesLines.length > 0;
  const isNarrow = svgW < 340;
  const svgH = isNarrow ? 132 : 148;
  const padTop = 14;
  const padBottom = 22;
  const padRight = 14;

  // Y scale
  const { yMin, yMax } = useMemo(() => {
    const allVals = seriesLines.flatMap((s) => s.points.map((p) => p.val));
    if (!allVals.length) return { yMin: 0, yMax: 100 };
    const lo = Math.min(...allVals);
    const hi = Math.max(...allVals);
    if (metric === 'uptime') {
      if (lo >= 95) return { yMin: 90, yMax: 100 };
      if (lo >= 80) return { yMin: 70, yMax: 100 };
      return { yMin: Math.max(0, Math.floor((lo - 5) / 10) * 10), yMax: 100 };
    }
    if (metric === 'cache') {
      return { yMin: 0, yMax: 100 };
    }
    return { yMin: 0, yMax: niceMax(hi * 1.12) };
  }, [seriesLines, metric]);

  const yTickVals = [yMax, (yMax + yMin) * 0.5, yMin];
  const yTickLabels = yTickVals.map((v) => fmtAxisTick(v, metric));
  const maxYChars = yTickLabels.reduce((a, b) => Math.max(a, b.length), 2);
  const padLeft = Math.max(isNarrow ? 30 : 36, Math.ceil(maxYChars * 5.8) + 10);
  const plotW = Math.max(60, svgW - padLeft - padRight);
  const chartH = Math.max(54, svgH - padTop - padBottom);
  const yBase = padTop + chartH;

  const valY = (v: number) => {
    const span = Math.max(0.001, yMax - yMin);
    return padTop + chartH - clamp((v - yMin) / span, 0, 1) * chartH;
  };
  const slotX = (idx: number) =>
    xLabels.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (xLabels.length - 1)) * plotW;

  // Summary strip metrics (4 cells)
  const summaryCells = useMemo(() => {
    if (!seriesLines.length) return [];
    const globalLines = seriesLines.filter((s) => !s.isLocal);
    const poolForBest = globalLines.length ? globalLines : seriesLines;
    const lowerIsBetter = metric === 'ttft' || metric === 'e2e';
    const sorted = [...poolForBest].sort((a, b) =>
      lowerIsBetter ? a.latestVal - b.latestVal : b.latestVal - a.latestVal,
    );
    const best = sorted[0];
    const focusLine =
      poolForBest.find((s) => s.id === geminiPulse?.activeFamily) || poolForBest[0];
    const allVals = seriesLines.flatMap((s) => s.points.map((p) => p.val));
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);

    const localLine = seriesLines.find((s) => s.isLocal);
    const refModel =
      models.find((m) => m.family === (singleSelectedModel?.family || geminiPulse?.activeFamily || activeFamilies[0])) || null;
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

    const fourthCell =
      metric === 'e2e' && refModel?.p99TtftSec != null
        ? {
            k: 'P99 TTFT',
            v: fmtSec(refModel.p99TtftSec),
            sub: refModel.toolCallErrorPct != null
              ? `Tool Err ${refModel.toolCallErrorPct}%`
              : shortName(refModel.label),
            tone: refModel.p99TtftSec >= 30 ? 'text-hud-warn' : 'text-hud-fg',
          }
        : {
            k: isZh ? '我的实测' : 'MY LOCAL',
            v: localVal !== null ? fmtVal(localVal, metric) : '--',
            sub: localLine ? localLine.label : refModel ? shortName(refModel.label) : '--',
            tone: 'text-hud-accent-ink',
          };

    return [
      {
        k: isZh ? '🏆 大盘最优' : '🏆 LEADER',
        v: fmtVal(best.latestVal, metric),
        sub: best.label,
        tone: 'text-hud-ok',
      },
      {
        k: focusLine.label,
        v: fmtVal(focusLine.latestVal, metric),
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
        v: `${fmtAxisTick(minV, metric)}–${fmtAxisTick(maxV, metric)}`,
        sub: effectiveIntraday
          ? `${xLabels.length}×5m`
          : metric === 'uptime'
            ? '24h'
            : isZh ? '近 7 天' : '7d',
        tone: 'text-hud-fg',
      },
      fourthCell,
    ];
  }, [seriesLines, metric, effectiveIntraday, xLabels.length, geminiPulse?.activeFamily, models, singleSelectedModel, activeFamilies, isZh]);

  const safeHoverIdx = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < xLabels.length ? hoveredIdx : null;
  const hoverRows = useMemo(() => {
    if (safeHoverIdx === null) return [];
    const rows = seriesLines
      .map((s) => {
        const pt = s.points.find((p) => p.xIdx === safeHoverIdx);
        return pt ? { label: s.label, color: s.color, isLocal: s.isLocal, val: pt.val } : null;
      })
      .filter((r): r is { label: string; color: string; isLocal: boolean | undefined; val: number } => Boolean(r));
    rows.sort((a, b) => (metric === 'ttft' || metric === 'e2e' ? a.val - b.val : b.val - a.val));
    return rows;
  }, [safeHoverIdx, seriesLines, metric]);

  const hoverX = safeHoverIdx !== null ? slotX(safeHoverIdx) : 0;
  const popoverLeftPx = useMemo(() => {
    if (safeHoverIdx === null) return 8;
    const popW = isNarrow ? 182 : 204;
    const preferLeft = hoverX > svgW * 0.54;
    const raw = preferLeft ? hoverX - popW - 10 : hoverX + 10;
    return clamp(Math.round(raw), 4, Math.max(4, svgW - popW - 4));
  }, [safeHoverIdx, hoverX, svgW, isNarrow]);

  const xTicks = useMemo(() => {
    const n = xLabels.length;
    if (n === 0) return [];
    if (n === 1) return [{ idx: 0, label: fmtShortX(xLabels[0], metric, isZh, effectiveIntraday), anchor: 'middle' as const }];
    const mid = Math.floor((n - 1) / 2);
    return [
      { idx: 0, label: fmtShortX(xLabels[0], metric, isZh, effectiveIntraday), anchor: 'start' as const },
      { idx: mid, label: fmtShortX(xLabels[mid], metric, isZh, effectiveIntraday), anchor: 'middle' as const },
      { idx: n - 1, label: fmtShortX(xLabels[n - 1], metric, isZh, effectiveIntraday), anchor: 'end' as const },
    ];
  }, [xLabels, metric, isZh, effectiveIntraday]);

  const handlePointerMove = (e: PointerEvent) => {
    if (!boxRef.current || xLabels.length === 0) return;
    const rect = boxRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const frac = clamp((relX - padLeft) / Math.max(1, plotW), 0, 1);
    const idx = Math.round(frac * (xLabels.length - 1));
    setHoveredIdx(idx);
  };

  if (!geminiPulse?.enabled) {
    return (
      <div className="l2-well px-3 py-4 text-center font-hud text-[11px] text-hud-muted">
        {isZh ? '大盘已设为离线模式，请在「账号 → GEMINI 全局大盘」开启在线同步。' : 'Global Pulse is offline. Enable it in Account → Gemini Global Pulse.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Global Metric Tabs + Local Overlay + Provider Split toggle */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
        <div className="metric-tabs" role="tablist" aria-label="Global metric">
          {(['ttft', 'e2e', 'tps', 'cache', 'uptime'] as const).map((gm) => (
            <button
              key={gm}
              type="button"
              role="tab"
              aria-selected={metric === gm}
              className={`metric-tab${metric === gm ? ' is-active' : ''}`}
              onClick={() => {
                onSelectMetric(gm);
                setHoveredIdx(null);
              }}
            >
              {gm === 'ttft'
                ? isZh ? '首字' : 'TTFT'
                : gm === 'e2e'
                  ? isZh ? '总耗' : 'E2E'
                  : gm === 'tps'
                    ? isZh ? '速度' : 'TPS'
                    : gm === 'cache'
                      ? isZh ? '缓存' : 'Cache'
                      : isZh ? '可用率' : 'Uptime'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {canUseIntraday && (
            <button
              type="button"
              onClick={() => {
                setGranularity((g) => (g === '5m' ? '7d' : '5m'));
                setHoveredIdx(null);
              }}
              className={`px-1.5 py-[2px] rounded-full border font-hud-mono text-[9px] cursor-pointer transition-colors ${
                effectiveIntraday
                  ? 'bg-tint-accent border-tint-accent-border text-hud-accent-ink font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? `切换 5 分钟高精度实时折线（已采集 ${maxIntradayPoints} 个 5m 节点，最多 24h）`
                  : `Toggle 5-minute high-res live curves (${maxIntradayPoints} buckets, up to 24h)`
              }
            >
              {effectiveIntraday ? `5m (${maxIntradayPoints})` : '5m'}
            </button>
          )}
          {hasAnyLocalCurve && (
            <button
              type="button"
              onClick={() => setShowLocalOverlay((v) => !v)}
              className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                showLocalOverlay
                  ? 'bg-hud-card border-hud-fg/45 text-hud-fg font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? '在同图叠加/隐藏你本机的 7 天每日实测 + 近 30m 曲线（虚线空心点）'
                  : 'Toggle your local 7d daily + live 30m curve (dashed hollow rings)'
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full border border-hud-fg shrink-0"
                style={{ background: showLocalOverlay ? 'var(--hud-card)' : 'transparent' }}
              />
              <span>{isZh ? '叠加本机' : 'Mine'}</span>
            </button>
          )}
          {singleSelectedModel && canSplitProviders && (
            <button
              type="button"
              onClick={() => setSplitProviders((v) => !v)}
              className={`px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                effectiveSplit
                  ? 'bg-tint-accent border-tint-accent-border text-hud-accent-ink font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? '将当前单模型拆分为各上游节点（Google Vertex vs AI Studio）折线对比'
                  : 'Split single model into upstream provider curves (Google Vertex vs AI Studio)'
              }
            >
              {isZh ? '节点拆解' : 'By Provider'}
            </button>
          )}
          <span className="font-hud-mono text-[9px] text-hud-muted">
            {effectiveIntraday ? '24h·5m' : metric === 'uptime' ? '24h' : metric === 'e2e' ? '7d' : '7d + 30m'}
          </span>
        </div>
      </div>

      {/* Model Multi-Select Pills with PERMANENT stable colors per model */}
      {models.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {models.map((m, mi) => {
            const isSel = activeFamilies.includes(m.family);
            const color = stableGeminiModelColor(m.family, mi);
            return (
              <button
                key={m.family}
                type="button"
                onClick={() => toggleFamily(m.family)}
                onDblClick={() => focusSingleModel(m.family)}
                className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                  isSel
                    ? 'bg-hud-card text-hud-fg font-semibold'
                    : 'bg-hud-fill/60 border-transparent text-hud-muted hover:text-hud-fg'
                }`}
                style={isSel ? { borderColor: `color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
                data-tip={
                  isZh
                    ? `单击叠加/取消 ${m.label} 折线；双击独显该模型（可开节点拆解）`
                    : `Click to toggle ${m.label}; double-click to solo (enables provider split)`
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: color, opacity: isSel ? 1 : 0.35 }}
                />
                <span>{shortName(m.label)}</span>
              </button>
            );
          })}
          {models.length > 1 && activeFamilies.length < models.length && (
            <button
              type="button"
              className="px-1.5 py-[1.5px] rounded font-hud text-[9px] text-hud-muted hover:text-hud-fg cursor-pointer"
              onClick={() => setSelectedFamilies(models.map((m) => m.family))}
            >
              {isZh ? '全选' : 'All'}
            </button>
          )}
        </div>
      )}

      {/* 4-Cell Summary Strip */}
      {summaryCells.length > 0 && (
        <div className={`grid gap-1.5 ${isNarrow ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {summaryCells.map((c, idx) => (
            <div key={idx} className="trend-stat-cell flex flex-col gap-px min-w-0 px-2 py-[5px] rounded-lg tabular-nums">
              <span className="trend-stat-label font-hud font-semibold text-hud-muted truncate">{c.k}</span>
              <span className={`trend-stat-val font-hud-mono font-bold leading-tight truncate ${c.tone}`}>{c.v}</span>
              <span className="font-hud text-[8.5px] text-hud-muted truncate">{c.sub}</span>
            </div>
          ))}
        </div>
      )}

      {/* Interactive Multi-Line SVG Canvas */}
      <div ref={boxRef} className="relative w-full min-w-0 select-none">
        {!hasTimeSeries ? (
          <div className="l2-well px-3 py-5 text-center font-hud text-[10.5px] text-hud-muted leading-[1.45]">
            {geminiPulse?.loading
              ? isZh ? '正在拉取 OpenRouter 历史折线数据…' : 'Loading OpenRouter historical curves…'
              : isZh
                ? '暂无历史折线缓存（请点击「账号 → GEMINI 全局大盘」右上角刷新，或 Reload 插件以同步最新 7d/24h 曲线）。'
                : 'No historical curves cached yet. Click Refresh in Account → Gemini Global Pulse or reload the plugin.'}
          </div>
        ) : (
          <svg
            className="trend-main-svg block w-full overflow-visible"
            style={{ height: `${svgH}px` }}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoveredIdx(null)}
          >
            {/* Horizontal grid lines + Y ticks */}
            {yTickVals.map((tv, gi) => {
              const gy = valY(tv);
              return (
                <g key={`g-grid-${gi}`}>
                  <line
                    x1={padLeft}
                    y1={gy.toFixed(1)}
                    x2={(padLeft + plotW).toFixed(1)}
                    y2={gy.toFixed(1)}
                    stroke="var(--hud-fg)"
                    stroke-width="1"
                    stroke-dasharray={gi === 2 ? undefined : '2 3'}
                    opacity={gi === 2 ? 0.14 : 0.07}
                  />
                  <text
                    x={(padLeft - 6).toFixed(1)}
                    y={(gy + 3).toFixed(1)}
                    text-anchor="end"
                    className="trend-axis-label"
                  >
                    {yTickLabels[gi]}
                  </text>
                </g>
              );
            })}

            {/* Live 30m vertical divider for 7d + 30m charts */}
            {metric !== 'uptime' && xLabels[xLabels.length - 1] === '__live30m__' && xLabels.length >= 2 && (
              <line
                x1={slotX(xLabels.length - 1).toFixed(1)}
                y1={padTop}
                x2={slotX(xLabels.length - 1).toFixed(1)}
                y2={yBase.toFixed(1)}
                stroke="var(--hud-accent)"
                stroke-width="1"
                stroke-dasharray="2 3"
                opacity="0.35"
              />
            )}

            {/* Multi-model smooth monotone curves + Local dashed overlay */}
            {seriesLines.map((s) => {
              const coords = s.points.map((pt) => ({ x: slotX(pt.xIdx), y: valY(pt.val) }));
              const pathD = coords.length >= 2 ? buildMonotonePath(coords, padTop, yBase) : '';
              return (
                <g key={`gline-${s.id}`}>
                  {pathD && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={s.color}
                      stroke-width={s.isLocal ? '1.9' : '1.75'}
                      stroke-dasharray={s.isLocal ? '4.5 3' : s.dashed ? '4 2.5' : undefined}
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      opacity={s.isLocal ? '0.92' : '0.9'}
                    />
                  )}
                  {s.points.map((pt, pi) => {
                    const isLast = pi === s.points.length - 1;
                    const isHov = safeHoverIdx === pt.xIdx;
                    if ((metric === 'uptime' || (effectiveIntraday && s.points.length > 24)) && !isLast && !isHov) return null;
                    return (
                      <circle
                        key={`gpt-${s.id}-${pt.xIdx}`}
                        cx={slotX(pt.xIdx).toFixed(1)}
                        cy={valY(pt.val).toFixed(1)}
                        r={isHov ? 4.2 : isLast ? 3.4 : s.isLocal ? 2.6 : 2.1}
                        fill={s.isLocal ? 'var(--hud-card)' : s.color}
                        stroke={s.isLocal ? s.color : 'var(--hud-card)'}
                        stroke-width={s.isLocal ? '1.6' : '1.1'}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* X-axis tick labels */}
            {xTicks.map((tk, ti) => (
              <text
                key={`gxt-${ti}`}
                x={slotX(tk.idx).toFixed(1)}
                y={(svgH - 4).toFixed(1)}
                text-anchor={tk.anchor}
                className="trend-axis-label"
              >
                {tk.label}
              </text>
            ))}

            {/* Zero-lag vertical crosshair */}
            {safeHoverIdx !== null && (
              <line
                className="trend-crosshair-line"
                x1={hoverX.toFixed(1)}
                y1={padTop}
                x2={hoverX.toFixed(1)}
                y2={yBase.toFixed(1)}
              />
            )}
          </svg>
        )}

        {/* Structured Floating Popover on Hover */}
        {hasTimeSeries && safeHoverIdx !== null && hoverRows.length > 0 && (
          <div
            className="trend-popover pointer-events-none absolute top-1 z-20 rounded-lg border px-2 py-1.5 flex flex-col gap-1"
            style={{ left: `${popoverLeftPx}px`, width: `${isNarrow ? 182 : 204}px` }}
          >
            <div className="flex items-center justify-between gap-2 font-hud-mono text-[9.5px] font-semibold text-hud-muted border-b border-hud-hairline pb-0.5">
              <span>{fmtShortX(xLabels[safeHoverIdx], metric, isZh, effectiveIntraday)}</span>
              <span>
                {effectiveIntraday
                  ? isZh ? '5m 快照' : '5m Bucket'
                  : xLabels[safeHoverIdx] === '__live30m__'
                    ? isZh ? '实时 30m' : 'Live 30m'
                    : metric === 'uptime'
                      ? '24h'
                      : isZh ? '日均 P50' : 'Daily P50'}
              </span>
            </div>
            {hoverRows.map((row, ri) => (
              <div key={row.label} className="flex items-center justify-between gap-2 font-hud-mono text-[10px] tabular-nums">
                <span className="inline-flex items-center gap-1.5 min-w-0 font-hud text-hud-fg/90">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={
                      row.isLocal
                        ? { background: 'var(--hud-card)', border: `1.5px solid ${row.color}` }
                        : { background: row.color }
                    }
                  />
                  <span className={`truncate ${row.isLocal ? 'font-semibold text-hud-fg' : ''}`}>{row.label}</span>
                </span>
                <span className={`font-semibold shrink-0 ${ri === 0 && hoverRows.length > 1 ? 'text-hud-ok' : 'text-hud-fg'}`}>
                  {fmtVal(row.val, metric)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compact Source Footnote */}
      <div className="flex items-center justify-between gap-2 font-hud text-[9px] text-hud-muted">
        <span className="truncate">
          {effectiveSplit
            ? isZh
              ? `${singleSelectedModel?.label} 上游节点${showLocalOverlay && hasAnyLocalCurve ? ' + 本机实测' : ''}折线对比`
              : `${singleSelectedModel?.label} provider${showLocalOverlay && hasAnyLocalCurve ? ' + local' : ''} curves`
            : isZh
              ? '实线：OpenRouter 大盘 · 虚线空心点：本机实测'
              : 'Solid: OpenRouter global · Dashed ring: your local'}
        </span>
        {geminiPulse?.fetchedAtMs ? (
          <span className="font-hud-mono shrink-0">{fmtClock(geminiPulse.fetchedAtMs)}</span>
        ) : null}
      </div>
    </div>
  );
}
