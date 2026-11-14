import type { Translations } from '../i18n';
import type { ActiveStep, Compaction, SessionKind, StatsSnapshot } from '../types/telemetry';

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtTps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return '--';
  return v >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export function fmtSec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return '--';
  return s >= 10 ? `${s.toFixed(1)}s` : `${s.toFixed(2)}s`;
}

export function fmtCachePct(pct: number | null | undefined): string {
  return pct === null || pct === undefined || !Number.isFinite(pct) ? '--' : `${pct.toFixed(1)}%`;
}

export type CacheTier = 'good' | 'mid' | 'low' | 'muted';

export function cacheTier(pct: number | null | undefined): CacheTier {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'muted';
  if (pct >= 80) return 'good';
  if (pct >= 40) return 'mid';
  return 'low';
}

export type TtftTier = 'fast' | 'mid' | 'slow';

export function ttftTier(sec: number): TtftTier {
  if (sec <= 3) return 'fast';
  if (sec <= 10) return 'mid';
  return 'slow';
}

export function fmtClock(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString(undefined, { hour12: false }) : '';
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return '$0.00';
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(1)}`;
}

export function fmtDurationShort(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined || !Number.isFinite(totalSec) || totalSec < 0) return '--';
  const s = Math.floor(totalSec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m${String(remS).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h${String(remM).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24}h`;
}

export function shortTitleLabel(title: string | undefined, id: string | undefined): string {
  const clean = String(title || '').trim();
  if (!clean) return id ? `${id.slice(0, 8)}…` : '--';
  return clean.length > 26 ? `${clean.slice(0, 25)}…` : clean;
}

export function kindBadgeText(kind: SessionKind, t: Translations): string {
  if (kind === 'side_question') return t.kindSq;
  if (kind === 'subagent') return t.kindSub;
  return t.kindMain;
}

export function kindBadgeClass(kind: SessionKind): string {
  if (kind === 'side_question') return 'kind-sq';
  if (kind === 'subagent') return 'kind-sub';
  return 'kind-main';
}

export interface EffectiveContextState {
  limit: number;
  totalUsed: number;
  pct: number;
  isPostCompact: boolean;
  isEstimated: boolean;
  trailingCompact: Compaction | null;
}

export function getEffectiveContextState(snap: StatsSnapshot | null): EffectiveContextState {
  const latest = snap?.found ? snap?.latest || null : null;
  const invs = snap?.found && Array.isArray(snap?.invocations) ? snap.invocations : [];
  const compactions = snap?.found && Array.isArray(snap?.compactions) ? snap.compactions : [];
  const lastCmp = compactions.length ? compactions[compactions.length - 1] : null;

  const isTrailingCompact = Boolean(
    lastCmp
    && lastCmp.afterCtx > 0
    && (lastCmp.afterGmIdx !== null && lastCmp.afterGmIdx !== undefined
      ? lastCmp.afterGmIdx >= invs.length
      : lastCmp.stepIdx > (latest?.stepIdx ?? -1)),
  );

  if (isTrailingCompact && lastCmp) {
    const limit = latest?.contextLimit || 256_000;
    const totalUsed = lastCmp.afterCtx;
    const pct = limit > 0 ? Math.min(100, (totalUsed / limit) * 100) : 0;
    return {
      limit,
      totalUsed,
      pct,
      isPostCompact: true,
      isEstimated: Boolean(lastCmp.afterCtxEstimated),
      trailingCompact: lastCmp,
    };
  }

  const limit = latest?.contextLimit || 0;
  const totalUsed = latest?.totalContext || 0;
  const pct = latest?.contextPct || (limit > 0 ? Math.min(100, (totalUsed / limit) * 100) : 0);
  return {
    limit,
    totalUsed,
    pct,
    isPostCompact: false,
    isEstimated: false,
    trailingCompact: null,
  };
}

export interface HeadroomEstimate {
  turns: number;
  medianDelta: number;
}

export function computeHeadroomTurns(snap: StatsSnapshot | null): HeadroomEstimate | null {
  const effCtx = getEffectiveContextState(snap);
  const invs = snap?.invocations;
  if ((!snap?.latest && !effCtx.isPostCompact) || !Array.isArray(invs) || invs.length < 2) return null;
  const limit = effCtx.limit;
  const totalUsed = effCtx.totalUsed;
  if (limit <= 0 || totalUsed >= limit) {
    return totalUsed >= limit && limit > 0 ? { turns: 0, medianDelta: 0 } : null;
  }

  let startIdx = 0;
  for (let i = invs.length - 1; i > 0; i--) {
    if (invs[i].totalContext < invs[i - 1].totalContext * 0.65) {
      startIdx = i;
      break;
    }
  }
  const slice = invs.slice(startIdx);
  const byTurn: Array<{ k: string | number; ctx: number }> = [];
  for (const r of slice) {
    const k = r.turnIndex || `call:${r.idx}`;
    const prev = byTurn.length ? byTurn[byTurn.length - 1] : null;
    if (prev && prev.k === k) {
      if (r.totalContext > prev.ctx) prev.ctx = r.totalContext;
    } else {
      byTurn.push({ k, ctx: r.totalContext });
    }
  }
  let deltas: number[] = [];
  const series = byTurn.length >= 3 ? byTurn.map((x) => x.ctx) : slice.map((x) => x.totalContext);
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return null;
  deltas = deltas.slice(-6).sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const medianDelta = deltas.length % 2 === 1 ? deltas[mid] : Math.round((deltas[mid - 1] + deltas[mid]) / 2);
  if (medianDelta <= 0) return null;
  const turns = Math.max(0, Math.floor((limit - totalUsed) / medianDelta));
  return { turns, medianDelta };
}

export interface LiveStageFormatted {
  isCompact: boolean;
  isStreaming: boolean;
  badge: string;
  rightText: string;
  detail: string;
}

export function formatLiveStage(
  active: ActiveStep,
  serverTimeMs: number | undefined,
  nowMs: number,
  t: Translations,
  latestContext = 0,
): LiveStageFormatted {
  const startMs = active.createdAtMs || serverTimeMs || nowMs;
  if (active.stepType === 23) {
    const sec = Math.max(0, (nowMs - startMs) / 1000).toFixed(1);
    const ctxStr = latestContext > 0 ? fmtNum(latestContext) : '';
    return {
      isCompact: true,
      isStreaming: false,
      badge: t.compactLiveBadge,
      rightText: `${sec}s`,
      detail: t.compactLiveDetail(sec, fmtClock(active.createdAtMs), ctxStr || undefined),
    };
  }
  if (active.streamStartMs > 0) {
    const ttftSec = active.createdAtMs > 0 && active.streamStartMs >= active.createdAtMs
      ? (active.streamStartMs - active.createdAtMs) / 1000
      : 0;
    const genSec = Math.max(0, (nowMs - active.streamStartMs) / 1000);
    return {
      isCompact: false,
      isStreaming: true,
      badge: t.liveStreamBadge,
      rightText: t.liveRowTagStream,
      detail: t.liveStreamDetail(fmtSec(ttftSec), genSec.toFixed(1)),
    };
  }
  const waitSec = Math.max(0, (nowMs - startMs) / 1000);
  return {
    isCompact: false,
    isStreaming: false,
    badge: t.liveWaitBadge,
    rightText: t.liveRowTagWait,
    detail: t.liveWaitDetail(waitSec.toFixed(1), fmtClock(active.createdAtMs)),
  };
}
