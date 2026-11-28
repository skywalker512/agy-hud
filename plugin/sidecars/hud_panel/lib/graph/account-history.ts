/**
 * Account-wide spend aggregation and 16-week / 52-week local activity heatmap builder.
 */
import { localDayKey } from '../constants.ts';

const HEATMAP_WEEKS = 16;
const HEATMAP_WEEKS_52 = 52;

export interface DailyHeatmapDay {
  date: string;
  calls: number;
  appCalls: number;
  cliCalls: number;
  costUSD: number;
  outputTokens: number;
  newTokens: number;
  cachedTokens: number;
}

export function buildAccountHistory(graph, nowMs = Date.now()) {
  const todayKey = localDayKey(nowMs);
  const monthPrefix = todayKey.slice(0, 7);
  let totalCalls = 0;
  let totalOutput = 0;
  let totalCostUSD = 0;
  let totalSavedUSD = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let todayCalls = 0;
  let todayCostUSD = 0;
  let todaySavedUSD = 0;
  let monthCalls = 0;
  let monthCostUSD = 0;
  let monthSavedUSD = 0;
  const callsBySource = { app: 0, cli: 0, ide: 0 };
  const costBySource = { app: 0, cli: 0, ide: 0 };
  const indexedBySource = { app: 0, cli: 0, ide: 0 };
  const dailyMap = Object.create(null);

  for (const s of graph.summaries) {
    const src = s.source === 'cli' || s.source === 'ide' ? s.source : 'app';
    indexedBySource[src] += 1;
    callsBySource[src] += s.calls;
    costBySource[src] += s.costUSD;
    totalCalls += s.calls;
    totalOutput += s.outputTokens;
    totalCostUSD += s.costUSD;
    totalSavedUSD += s.savedUSD;
    pricedCount += s.pricedCount;
    unpricedCount += s.unpricedCount;
    for (const [dk, b] of Object.entries(s.dayBuckets || {}) as [string, any][]) {
      if (dk === todayKey) {
        todayCalls += b.calls;
        todayCostUSD += b.costUSD;
        todaySavedUSD += b.savedUSD;
      }
      if (dk.startsWith(monthPrefix)) {
        monthCalls += b.calls;
        monthCostUSD += b.costUSD;
        monthSavedUSD += b.savedUSD;
      }
      if (!dailyMap[dk]) {
        dailyMap[dk] = {
          calls: 0,
          appCalls: 0,
          cliCalls: 0,
          costUSD: 0,
          outputTokens: 0,
          newTokens: 0,
          cachedTokens: 0,
        };
      }
      const dm = dailyMap[dk];
      dm.calls += b.calls || 0;
      if (src === 'cli') dm.cliCalls += b.calls || 0;
      else dm.appCalls += b.calls || 0;
      dm.costUSD += b.costUSD || 0;
      dm.outputTokens += b.outputTokens || 0;
      dm.newTokens += b.newTokens || 0;
      dm.cachedTokens += b.cachedTokens || 0;
    }
  }

  const [ty, tm, td] = todayKey.split('-').map(Number);
  const todayNoon = new Date(ty, tm - 1, td, 12, 0, 0);
  const dowMon0 = (todayNoon.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  const totalGridDays16 = (HEATMAP_WEEKS - 1) * 7 + dowMon0 + 1;
  const totalGridDays52 = (HEATMAP_WEEKS_52 - 1) * 7 + dowMon0 + 1;
  const startNoon52 = new Date(ty, tm - 1, td - (totalGridDays52 - 1), 12, 0, 0);
  const heatmapDays52: DailyHeatmapDay[] = [];
  let activeDays52 = 0;
  let peakCostUSD52 = 0;
  let peakDate52 = '';

  for (let i = 0; i < totalGridDays52; i++) {
    const d = new Date(startNoon52.getFullYear(), startNoon52.getMonth(), startNoon52.getDate() + i, 12, 0, 0);
    const dk = localDayKey(d.getTime());
    const entry = dailyMap[dk];
    const calls = entry?.calls || 0;
    const costUSD = entry?.costUSD || 0;
    if (calls > 0 || costUSD > 0) activeDays52 += 1;
    if (costUSD > peakCostUSD52) {
      peakCostUSD52 = costUSD;
      peakDate52 = dk;
    }
    heatmapDays52.push({
      date: dk,
      calls,
      appCalls: entry?.appCalls || 0,
      cliCalls: entry?.cliCalls || 0,
      costUSD,
      outputTokens: entry?.outputTokens || 0,
      newTokens: entry?.newTokens || 0,
      cachedTokens: entry?.cachedTokens || 0,
    });
  }

  const heatmapDays = heatmapDays52.slice(heatmapDays52.length - totalGridDays16);
  let activeDays = 0;
  let peakCostUSD = 0;
  let peakDate = '';
  for (const hd of heatmapDays) {
    if (hd.calls > 0 || hd.costUSD > 0) activeDays += 1;
    if (hd.costUSD > peakCostUSD) {
      peakCostUSD = hd.costUSD;
      peakDate = hd.date;
    }
  }

  let streakDays = 0;
  for (let i = heatmapDays52.length - 1; i >= 0; i--) {
    const hd = heatmapDays52[i];
    if (hd.calls > 0 || hd.costUSD > 0) {
      streakDays += 1;
    } else if (i === heatmapDays52.length - 1) {
      continue;
    } else {
      break;
    }
  }

  return {
    dbCount: graph.totalDbFiles || graph.summaries.length,
    dbCountBySource: graph.sourceCounts || indexedBySource,
    indexedCount: graph.summaries.length,
    indexing: Boolean(graph.indexing),
    callsBySource,
    costBySource,
    totalCalls,
    totalOutput,
    totalCostUSD,
    totalSavedUSD,
    pricedCount,
    unpricedCount,
    todayCalls,
    todayCostUSD,
    todaySavedUSD,
    monthCalls,
    monthCostUSD,
    monthSavedUSD,
    dailyHeatmap: {
      weeks: HEATMAP_WEEKS,
      weeks52: HEATMAP_WEEKS_52,
      activeDays,
      activeDays52,
      streakDays,
      peakCostUSD,
      peakDate,
      peakCostUSD52,
      peakDate52,
      days: heatmapDays,
      days52: heatmapDays52,
    },
  };
}
