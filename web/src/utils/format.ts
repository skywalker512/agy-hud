import type { Translations } from '../i18n';
import type {
  ActiveStep,
  Compaction,
  PoolQuotaUsageItem,
  SessionKind,
  SessionQuotaUsage,
  StatsSnapshot,
} from '../types/telemetry';

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
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

export function fmtClockHm(ms: number | null | undefined, refNowMs?: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (refNowMs && Number.isFinite(refNowMs)) {
    const ref = new Date(refNowMs);
    if (d.getFullYear() !== ref.getFullYear() || d.getMonth() !== ref.getMonth() || d.getDate() !== ref.getDate()) {
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${mo}-${da} ${hh}:${mm}`;
    }
  }
  return `${hh}:${mm}`;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return '$0.00';
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(1)}`;
}

export function fmtUsdWithBand(v: number | null | undefined, err?: number | null): string {
  const base = fmtUsd(v);
  if (err && Number.isFinite(err) && err >= 0.01) {
    return `${base}±${fmtUsd(err)}`;
  }
  return base;
}

export function fmtQuotaPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct <= 0) return '';
  if (pct < 0.001) return '<0.001%';
  if (pct < 0.1) return `${pct.toFixed(3)}%`;
  if (pct < 10) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

function formatSinglePoolQuota(p: PoolQuotaUsageItem | undefined, ultraShort: boolean): string {
  if (!p || !(p.pct5h >= 0.001)) return '';
  const approx = p.isFitted === false ? '~' : '';
  const hasWin = typeof p.active5hPct === 'number' || typeof p.active7dPct === 'number';
  if (hasWin) {
    const a5 = typeof p.active5hPct === 'number' ? p.active5hPct : 0;
    const a7 = typeof p.active7dPct === 'number' ? p.active7dPct : 0;
    if (a5 >= 0.001) {
      const s5 = `5h ${approx}-${fmtQuotaPct(a5)}`;
      if (!ultraShort && a7 >= 0.001 && p.pct5h > a5 + 0.05) {
        return `${s5} · 7d ${approx}-${fmtQuotaPct(a7)}`;
      }
      return s5;
    }
    if (a7 >= 0.001) {
      return `7d ${approx}-${fmtQuotaPct(a7)}`;
    }
    return '';
  }
  return `5h ${approx}-${fmtQuotaPct(p.pct5h)}`;
}

export function formatSessionQuotaCompact(q: SessionQuotaUsage | null | undefined, ultraShort = false): string {
  if (!q) return '';
  const gStr = formatSinglePoolQuota(q.gemini, ultraShort);
  const cStr = formatSinglePoolQuota(q.claude_gpt, ultraShort);
  if (gStr && cStr) {
    return `G ${gStr} · C ${cStr}`;
  }
  return gStr || cStr || '';
}

function formatTinyPoolVal(p: PoolQuotaUsageItem | undefined): string {
  if (!p || !(p.pct5h >= 0.001)) return '';
  const approx = p.isFitted === false ? '~' : '';
  const hasWin = typeof p.active5hPct === 'number' || typeof p.active7dPct === 'number';
  const raw = hasWin
    ? typeof p.active5hPct === 'number' && p.active5hPct >= 0.001
      ? p.active5hPct
      : typeof p.active7dPct === 'number' && p.active7dPct >= 0.001
        ? p.active7dPct
        : 0
    : p.pct5h;
  if (!(raw >= 0.001)) return '';
  const numStr = raw >= 1 ? `${raw.toFixed(1)}%` : fmtQuotaPct(raw);
  return `${approx}-${numStr}`;
}

export function formatSessionQuotaTiny(q: SessionQuotaUsage | null | undefined): string {
  if (!q) return '';
  const gVal = formatTinyPoolVal(q.gemini);
  const cVal = formatTinyPoolVal(q.claude_gpt);
  if (gVal && cVal) {
    return `G ${gVal} · C ${cVal}`;
  }
  return gVal || cVal || '';
}

function buildPoolTipBlock(poolName: string, p: PoolQuotaUsageItem | undefined, t: Translations): string {
  if (!p || !(p.pct5h >= 0.001)) return '';
  const hasWin = typeof p.active5hPct === 'number' || typeof p.active7dPct === 'number';
  if (!hasWin) {
    return t.sessionQuotaPoolLine(poolName, '', '', '', fmtQuotaPct(p.pct5h), p.isFitted !== false);
  }
  const a5Val = typeof p.active5hPct === 'number' ? p.active5hPct : 0;
  const a7Val = typeof p.active7dPct === 'number' ? p.active7dPct : 0;
  if (a5Val < 0.001 && a7Val < 0.001) return '';
  const a5Str = a5Val >= 0.001 ? fmtQuotaPct(a5Val) : '';
  const a7Str = a7Val >= 0.001 ? fmtQuotaPct(a7Val) : '';
  const expiredVal = Math.max(0, p.pct5h - a5Val);
  const expStr = expiredVal >= 0.05 ? fmtQuotaPct(expiredVal) : '';
  return t.sessionQuotaPoolLine(poolName, a5Str, a7Str, expStr, '', p.isFitted !== false);
}

export function formatSessionQuotaTip(q: SessionQuotaUsage | null | undefined, t: Translations): string {
  if (!q) return '';
  const lines: string[] = [];
  const gLine = buildPoolTipBlock('Gemini', q.gemini, t);
  if (gLine) lines.push(gLine);
  const cLine = buildPoolTipBlock('Claude & GPT', q.claude_gpt, t);
  if (cLine) lines.push(cLine);
  return lines.length ? t.sessionQuotaTip(lines.join('\n')) : '';
}

export function friendlyFamilyName(family: string): string {
  const f = String(family || '').toLowerCase();
  if (f === 'gemini-4-carbon') return 'Gemini 4 Carbon';
  if (f === 'gemini-4-neon') return 'Gemini 4 Neon';
  if (f === 'gemini-4-hydrogen') return 'Gemini 4 Hydrogen';
  if (f === 'gemini-4-argon') return 'Gemini 4 Argon';
  if (f === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
  if (f === 'claude-opus-5-5') return 'Claude Opus';
  if (f === 'claude-sonnet-5-5') return 'Claude Sonnet';
  if (f === 'gpt-oss') return 'GPT-OSS';
  return family;
}

const DISPLAY_TIER_RE = /\((xhigh|high|medium|low|minimal)\)\s*$/i;
const ID_TIER_SUFFIX_RE = /-(xhigh|high|medium|low|minimal)$/i;

export function formatModelTag(
  modelId: string | undefined,
  modelDisplay: string | undefined,
  model: string | undefined,
): string {
  const rawId = String(modelId || '').trim();
  const disp = String(modelDisplay || '').trim();
  const fallback = String(model || '').trim();
  const idCandidate = rawId || (fallback && !/\s/.test(fallback) ? fallback : '');
  if (idCandidate) {
    if (!ID_TIER_SUFFIX_RE.test(idCandidate)) {
      const m = DISPLAY_TIER_RE.exec(disp);
      if (m) {
        return `${idCandidate}-${m[1].toLowerCase()}`;
      }
    }
    return idCandidate;
  }
  return disp || fallback;
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

export function evalCacheSurvival(
  params: { bgMissRate: number; t50Sec: number; shapeK: number },
  ageSec: number,
): number {
  const p0 = Math.min(0.5, Math.max(0, Number.isFinite(params.bgMissRate) ? params.bgMissRate : 0.01));
  const t50 = Math.max(1, Number.isFinite(params.t50Sec) ? params.t50Sec : 600);
  const k = Math.max(0.2, Number.isFinite(params.shapeK) ? params.shapeK : 2.0);
  const t = Math.max(0, Number.isFinite(ageSec) ? ageSec : 0);
  if (t <= 0) return 1 - p0;
  return Math.min(1, Math.max(0, (1 - p0) / (1 + Math.pow(t / t50, k))));
}

export function fmtTtlDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return '0s';
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = sec / 60;
  if (min < 10) return `${min.toFixed(1)}m`;
  if (min < 90) return `${Math.round(min)}m`;
  const hr = min / 60;
  return hr < 10 ? `${hr.toFixed(1)}h` : `${Math.round(hr)}h`;
}
