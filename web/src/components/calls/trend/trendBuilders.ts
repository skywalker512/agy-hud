import type { Translations } from '../../../i18n';
import type { TrendTranslations } from '../../../i18n/trend';
import type { ChartMetric, GeminiModelGlobalPulse, Invocation } from '../../../types/telemetry';
import {
  cacheTier,
  fmtCachePct,
  fmtNum,
  fmtQuotaPct,
  fmtSec,
  fmtTps,
  fmtUsd,
  ttftTier,
} from '../../../utils/format';
import { stableGeminiModelColor } from '../GlobalTrendView';
import { clamp, getMetricValue, type ViewportStats } from '../trendMath';
import {
  estimateSvgLabelWidth,
  fmtSignedPct,
  fmtSignedPp,
  formatModelMetricAvg,
  getModelKey,
  preferredModelColor,
  shortArenaModelName,
  shortModelName,
} from './modelLabels';

export interface Pt {
  x: number;
  y: number;
  val: number;
  inv: Invocation;
  slotIdx: number;
}

export interface ModelMeta {
  key: string;
  label: string;
  color: string;
  count: number;
  avgBadge: string;
}

export interface StatCellModel {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'bad';
  deltaText?: string;
  deltaTone?: 'good' | 'bad' | 'neutral';
  badge?: string;
}

export interface DragZoomVisual {
  x1: number;
  x2: number;
  count: number;
}

export interface GlobalRefOverlay {
  family: string;
  y: number;
  pillY: number;
  label: string;
  color: string;
  pillW: number;
  side: 'left' | 'right';
}

export interface TrendSeries {
  key: string;
  color: string;
  points: Pt[];
}

export interface XTickItem {
  x: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
}

const MODEL_PALETTE = ['var(--seg-think)', 'var(--seg-cache)', 'var(--seg-input)', 'var(--seg-out)'];

export function getPulseMetricVal(m: GeminiModelGlobalPulse, metric: ChartMetric): number | null {
  if (metric === 'ttft') return m.p50TtftSec !== null && m.p50TtftSec > 0 ? m.p50TtftSec : null;
  if (metric === 'tps') return m.p50Tps !== null && m.p50Tps > 0 ? m.p50Tps : null;
  if (metric === 'cache') return m.cacheHitPct !== null && m.cacheHitPct > 0 ? m.cacheHitPct : null;
  return null;
}

export function buildSessionModels(
  invocations: Invocation[],
  metric: ChartMetric,
): { sessionModels: ModelMeta[]; modelColorMap: Map<string, string> } {
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
}

export function buildStatCells(
  visibleCount: number,
  metric: ChartMetric,
  stats: ViewportStats,
  tt: TrendTranslations,
): StatCellModel[] {
  if (visibleCount === 0) return [];
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
        tone:
          stats.headroomTurns !== null && stats.headroomTurns <= 3
            ? 'bad'
            : stats.headroomTurns !== null && stats.headroomTurns <= 8
              ? 'warn'
              : undefined,
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
  const fmtQ = (v: number | null) => {
    if (v === null || v <= 0) return '0%';
    const s = fmtQuotaPct(v);
    return s ? `-${s}` : '0%';
  };
  return [
    { label: tt.statLatest, value: fmtQ(stats.latest) },
    { label: tt.statAvg, value: fmtQ(stats.avg) },
    { label: tt.statPeak, value: fmtQ(stats.max) },
    { label: tt.statSum, value: fmtQ(stats.sum) },
  ];
}

export function buildPopoverDelta(
  hoveredInv: Invocation | null,
  statsAvg: number | null,
  metric: ChartMetric,
  tt: TrendTranslations,
): { text: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (!hoveredInv || statsAvg === null) return null;
  if (metric === 'cache') {
    if (hoveredInv.cacheHitPct === null || hoveredInv.cacheHitPct === undefined) return null;
    const diff = hoveredInv.cacheHitPct - statsAvg;
    return {
      text: tt.popVsAvg(fmtSignedPp(diff)),
      tone: diff >= 2 ? 'good' : diff <= -8 ? 'bad' : 'neutral',
    };
  }
  if (metric === 'ctx') {
    const diff = (hoveredInv.contextPct || 0) - statsAvg;
    return {
      text: tt.popVsAvg(fmtSignedPp(diff)),
      tone: 'neutral',
    };
  }
  if (statsAvg <= 0) return null;
  const val = getMetricValue(hoveredInv, metric);
  const pct = ((val - statsAvg) / statsAvg) * 100;
  let tone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (metric === 'tps') {
    tone = pct >= 5 ? 'good' : pct <= -15 ? 'bad' : 'neutral';
  } else if (metric === 'ttft') {
    tone = pct <= -10 ? 'good' : pct >= 20 ? 'bad' : 'neutral';
  }
  return { text: tt.popVsAvg(fmtSignedPct(pct)), tone };
}

export function buildPopoverGrid(
  hoveredInv: Invocation | null,
  metric: ChartMetric,
  tt: TrendTranslations,
): Array<{ k: string; v: string }> {
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
  return [
    { k: tt.popE2eTps, v: `${fmtTps(r.e2eTps)} t/s` },
    { k: tt.popTtft, v: fmtSec(r.ttftSec) },
    { k: tt.popOutput, v: `${fmtNum(totOut)} tok` },
    { k: tt.popCache, v: fmtCachePct(r.cacheHitPct) },
  ];
}

export function buildGlobalRefs(params: {
  activeArenaFamilies: string[];
  pinnedArenaFamilies: string[] | null;
  defaultArenaFamily: string;
  pulseModels: GeminiModelGlobalPulse[];
  metric: ChartMetric;
  yMax: number;
  padTop: number;
  chartH: number;
  yBase: number;
  plotW: number;
  ttftSla3Y: number | null;
  ttftSla10Y: number | null;
  cacheTargetY: number | null;
  emaLastY: number | null;
  ttftP95Y: number | null;
  t: Translations;
}): GlobalRefOverlay[] {
  const {
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
  } = params;
  if (!activeArenaFamilies.length) return [];

  const valY = (val: number) => padTop + chartH - clamp(yMax > 0 ? val / yMax : 0, 0, 1) * chartH;
  const multi =
    activeArenaFamilies.length > 1 ||
    (pinnedArenaFamilies !== null && activeArenaFamilies[0] !== defaultArenaFamily);
  const items: GlobalRefOverlay[] = [];

  const rightOccupiedYs: number[] = [];
  if (ttftSla3Y !== null) rightOccupiedYs.push(ttftSla3Y - 6);
  if (ttftSla10Y !== null) rightOccupiedYs.push(ttftSla10Y - 6);
  if (cacheTargetY !== null) rightOccupiedYs.push(cacheTargetY - 6);
  if (metric === 'tps' && emaLastY !== null) rightOccupiedYs.push(emaLastY - 6);

  const leftOccupiedYs: number[] = [];
  if (ttftP95Y !== null) leftOccupiedYs.push(ttftP95Y - 6);

  activeArenaFamilies.forEach((fam, idx) => {
    const mIdx = pulseModels.findIndex((x) => x.family === fam);
    const m = mIdx >= 0 ? pulseModels[mIdx] : null;
    if (!m) return;
    const val = getPulseMetricVal(m, metric);
    if (val === null || val > yMax) return;
    const y = valY(val);
    const valStr = metric === 'ttft' ? fmtSec(val) : metric === 'tps' ? fmtTps(val) : `${Math.round(val)}%`;
    const label = multi ? `${shortArenaModelName(m.label)} ${valStr}` : t.trendGlobalRef(valStr);
    const pillW = Math.min(plotW - 8, Math.max(50, estimateSvgLabelWidth(label)));
    const color = stableGeminiModelColor(m.family, mIdx);

    let desiredY = clamp(y - 11.5, padTop + 1, yBase - 12);
    const collides = (ys: number[], candidate: number) => ys.some((oy) => Math.abs(oy - candidate) < 12.5);
    let side: 'left' | 'right' = 'right';
    if (collides(rightOccupiedYs, desiredY)) {
      if (!collides(leftOccupiedYs, desiredY)) {
        side = 'left';
      } else {
        const belowY = clamp(y + 2, padTop + 1, yBase - 12);
        if (!collides(rightOccupiedYs, belowY)) {
          desiredY = belowY;
          side = 'right';
        } else if (!collides(leftOccupiedYs, belowY)) {
          desiredY = belowY;
          side = 'left';
        } else {
          side = idx % 2 === 0 ? 'left' : 'right';
          desiredY = clamp(desiredY + (idx % 2 === 0 ? -12 : 12), padTop + 1, yBase - 12);
        }
      }
    }

    if (side === 'right') rightOccupiedYs.push(desiredY);
    else leftOccupiedYs.push(desiredY);

    items.push({ family: fam, y, pillY: desiredY, label, color, pillW, side });
  });

  return items;
}
