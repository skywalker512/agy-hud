import type { GEMINI_SPECS, PulseModelData } from './pulseApi';

export function fmtClock(ms: number): string {
  if (!ms) return '--';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function fmtPrice(v: number | null): string {
  if (v === null) return '--';
  return `$${v >= 1 ? v.toFixed(2) : v.toFixed(3)}`;
}

export function fmtTokens(n: number | null): string {
  if (!n) return '--';
  if (n >= 1_000_000) return `${(n / 1_048_576).toFixed(n % 1_048_576 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function makePlaceholderPulseModel(spec: (typeof GEMINI_SPECS)[number]): PulseModelData {
  return {
    ...spec,
    status: 'ok',
    p50TtftSec: null,
    p75TtftSec: null,
    p90TtftSec: null,
    p95TtftSec: null,
    p99TtftSec: null,
    meanTtftSec: null,
    p50Tps: null,
    p90Tps: null,
    e2eLatestSec: null,
    cacheHitPct: null,
    uptime5mPct: null,
    uptime30mPct: null,
    uptime1dPct: null,
    toolCallErrorPct: null,
    toolCalls24h: 0,
    reasoningSharePct: null,
    avgPromptTokens: null,
    avgOutputTokens: null,
    effectiveInputPrice: null,
    effectiveOutputPrice: null,
    requestCount30m: 0,
    degradedProviders: [],
    routes: [],
    series: { ttft7d: [], e2e7d: [], tps7d: [], cache7d: [], uptime7d: [], intraday30m: [] },
  };
}

export interface PulseInsights {
  fastestTtft: PulseModelData | null;
  fastestTps: PulseModelData | null;
  trendTarget: PulseModelData | null;
  ttftTrendPct: number | null;
  bestDiscount: { model: PulseModelData; listIn: number; effIn: number; savePct: number } | null;
  lowestUp1d: PulseModelData | null;
  highestToolErr: PulseModelData | null;
  worstTail: { model: PulseModelData; ratio: number } | null;
  totalReq30m: number;
  totalToolCalls24h: number;
  topTraffic: PulseModelData | null;
  topReasoning: PulseModelData | null;
  topContext: PulseModelData | null;
}

export function computePulseInsights(models: PulseModelData[]): PulseInsights | null {
  if (!models.length) return null;

  const withTtft = models.filter((m) => m.p50TtftSec !== null);
  const fastestTtft = [...withTtft].sort((a, b) => (a.p50TtftSec ?? 999) - (b.p50TtftSec ?? 999))[0] || null;

  const withTps = models.filter((m) => m.p50Tps !== null);
  const fastestTps = [...withTps].sort((a, b) => (b.p50Tps ?? 0) - (a.p50Tps ?? 0))[0] || null;

  const trendTarget =
    models.find((m) => m.family === 'gemini-4-neon' && m.series.intraday30m.length >= 4) ||
    models.find((m) => m.series.intraday30m.length >= 4) ||
    null;
  let ttftTrendPct: number | null = null;
  if (trendTarget) {
    const pts = trendTarget.series.intraday30m.filter((p) => p.p50TtftSec !== null);
    if (pts.length >= 4) {
      const latestV = pts[pts.length - 1].p50TtftSec!;
      const earlier = pts.slice(Math.max(0, pts.length - 25), pts.length - 1).map((p) => p.p50TtftSec!);
      const avgEarlier = earlier.reduce((s, v) => s + v, 0) / earlier.length;
      if (avgEarlier > 0) ttftTrendPct = ((latestV - avgEarlier) / avgEarlier) * 100;
    }
  }

  let bestDiscount: PulseInsights['bestDiscount'] = null;
  for (const m of models) {
    const stdRoute = m.routes.find((r) => r.promptPerM !== null && r.promptPerM > 0);
    const listIn = stdRoute?.promptPerM ?? null;
    if (listIn && m.effectiveInputPrice !== null && m.effectiveInputPrice > 0 && m.effectiveInputPrice < listIn) {
      const savePct = ((listIn - m.effectiveInputPrice) / listIn) * 100;
      if (!bestDiscount || savePct > bestDiscount.savePct) {
        bestDiscount = { model: m, listIn, effIn: m.effectiveInputPrice, savePct };
      }
    }
  }

  const lowestUp1d =
    [...models]
      .filter((m) => m.uptime1dPct !== null)
      .sort((a, b) => (a.uptime1dPct ?? 100) - (b.uptime1dPct ?? 100))[0] || null;
  const highestToolErr =
    [...models]
      .filter((m) => m.toolCallErrorPct !== null)
      .sort((a, b) => (b.toolCallErrorPct ?? 0) - (a.toolCallErrorPct ?? 0))[0] || null;
  const worstTail =
    [...models]
      .filter((m) => m.p50TtftSec && m.p99TtftSec)
      .map((m) => ({ model: m, ratio: m.p99TtftSec! / m.p50TtftSec! }))
      .sort((a, b) => b.ratio - a.ratio)[0] || null;

  const totalReq30m = models.reduce((s, m) => s + (m.requestCount30m || 0), 0);
  const totalToolCalls24h = models.reduce((s, m) => s + (m.toolCalls24h || 0), 0);
  const topTraffic = [...models].sort((a, b) => (b.requestCount30m || 0) - (a.requestCount30m || 0))[0] || null;
  const topReasoning =
    [...models]
      .filter((m) => m.reasoningSharePct !== null)
      .sort((a, b) => (b.reasoningSharePct ?? 0) - (a.reasoningSharePct ?? 0))[0] || null;
  const topContext =
    [...models]
      .filter((m) => m.avgPromptTokens !== null)
      .sort((a, b) => (b.avgPromptTokens ?? 0) - (a.avgPromptTokens ?? 0))[0] || null;

  return {
    fastestTtft,
    fastestTps,
    trendTarget,
    ttftTrendPct,
    bestDiscount,
    lowestUp1d,
    highestToolErr,
    worstTail,
    totalReq30m,
    totalToolCalls24h,
    topTraffic,
    topReasoning,
    topContext,
  };
}
