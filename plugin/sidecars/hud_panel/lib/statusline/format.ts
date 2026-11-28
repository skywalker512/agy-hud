/**
 * Shared types, formatting helpers, context headroom estimation, and stdin parsing
 * for the AGY-HUD CLI statusline and read-only telemetry inspector.
 */

// ---------------------------------------------------------------------------
// Types matching official Antigravity CLI `/statusline` stdin JSON schema
// https://antigravity.google/docs/cli/statusline
// ---------------------------------------------------------------------------

export interface CliQuotaBucket {
  remaining_fraction?: number;
  remaining_amount?: number;
  reset_time?: string;
  reset_in_seconds?: number;
  disabled?: boolean;
}

export interface CliStatuslinePayload {
  cwd?: string;
  session_id?: string;
  conversation_id?: string;
  conversation_title?: string;
  transcript_path?: string;
  model?: {
    id?: string;
    display_name?: string;
    effort?: string;
  } | null;
  workspace?: {
    current_dir?: string;
    project_dir?: string;
  };
  version?: string;
  context_window?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    used_percentage?: number;
    remaining_percentage?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  exceeds_200k_tokens?: boolean | null;
  agent?: { name?: string };
  product?: string;
  quota?: Record<string, CliQuotaBucket>;
  agent_state?:
    | 'idle'
    | 'working'
    | 'tool_use'
    | 'reviewing'
    | 'authenticating'
    | 'initializing'
    | 'error'
    | string;
  vcs?: { type?: string };
  cycle_mode?: string;
  sandbox?: { enabled?: boolean };
  subagents?: { name?: string; role?: string; status?: string }[];
  artifact_count?: number;
  plan_tier?: string;
  email?: string;
  pending_input_count?: number;
  tool_confirmation_pending?: boolean;
  task_count?: number;
  terminal_width?: number;
  vim?: { mode?: string };
  cost?: {
    total_usd?: number;
    subagent_usd?: number;
    estimated?: boolean;
  };
}

export interface FastDbSnapshot {
  conversationId: string;
  dbPath: string;
  source: string;
  modelDisplay: string;
  modelId: string;
  genTps: number | null;
  e2eTps: number | null;
  avgGenTps: number | null;
  ttftSec: number | null;
  isBuffered: boolean;
  cacheHitPct: number | null;
  contextUsed: number;
  contextLimit: number;
  contextPct: number | null;
  headroomTurns: number | null;
  costUSD: number;
  savedUSD: number;
  callCount: number;
  compactCount: number;
  latestCallMs: number;
  cacheSurvivalProb: number | null;
  cacheP80RemSec: number | null;
  cacheMissPenaltyUSD: number | null;
}

export interface RenderStatuslineOptions {
  payload?: CliStatuslinePayload | null;
  dbSnap?: FastDbSnapshot | null;
  width?: number;
  color?: boolean;
  twoLine?: boolean;
  nowMs?: number;
}

export interface InspectTelemetryOptions {
  appDataDir?: string;
  conversationId?: string;
  callsLimit?: number;
  includeLiveQuota?: boolean;
  /** Optional pre-fetched raw quota snapshot (used for testing / callers that already polled LS). */
  rawQuotaOverride?: any;
  nowMs?: number;
}

export interface InspectCallRow {
  seq: number;
  model: string;
  ttftSec: number | null;
  genTps: number | null;
  e2eTps: number | null;
  outputTokens: number;
  contextUsed: number;
  cacheHitPct: number | null;
  costUSD: number | null;
  quota5hPct: number | null;
  flags: string[];
  timestampMs: number;
}

export interface InspectTelemetryReport {
  found: boolean;
  generatedAtMs: number;
  conversationId: string;
  title: string;
  source: string;
  dbPath: string;
  model: {
    display: string;
    id: string;
    isActive: boolean;
  };
  speed: {
    latestGenTps: number | null;
    avgGenTps: number | null;
    peakGenTps: number | null;
    latestE2eTps: number | null;
    latestTtftSec: number | null;
    avgTtftSec: number | null;
    p95TtftSec: number | null;
    isBuffered: boolean;
  };
  context: {
    used: number;
    limit: number;
    usedPct: number;
    free: number;
    headroomTurns: number | null;
    medianDeltaTokens: number | null;
    compactCount: number;
    breakdown: {
      systemPrompt: number;
      toolsSchema: number;
      toolResults: number;
      assistant: number;
      userAndOther: number;
      topTools: { name: string; tokens: number }[];
    } | null;
  };
  cache: {
    latestHitPct: number | null;
    sessionHitPct: number | null;
    savedUSD: number;
    ttl: {
      family: string;
      confidence: string;
      idleSec: number;
      survivalProbPct: number;
      p80Sec: number;
      p50Sec: number;
      remSafeSec: number;
      missPenaltyUSD: number;
      missPenaltyQuota5hPct: number | null;
    } | null;
  };
  session: {
    calls: number;
    totalCostUSD: number;
    totalSavedUSD: number;
    totalOutputTokens: number;
    treeTotals: {
      descendantCount: number;
      totalCostUSD: number;
      totalCalls: number;
      swarmWorkerCount: number;
    } | null;
    swarm: {
      title: string;
      memberCount: number;
      workingCount: number;
      waitingCount: number;
      boardSeq: number;
    } | null;
  };
  account: {
    tier: string;
    tierId: string;
    tierMultiplier: '5x' | '20x' | null;
    todayCostUSD: number;
    monthCostUSD: number;
    totalCostUSD: number;
    totalCalls: number;
    dbCount: number;
    quotaAvailable: boolean;
    pools: {
      label: string;
      usedPct5h: number | null;
      remainingPct5h: number | null;
      reset5hMs: number | null;
      runway5hSec: number | null;
      usedPct7d: number | null;
      remainingPct7d: number | null;
      reset7dMs: number | null;
      runway7dSec: number | null;
    }[];
  };
  recentCalls: InspectCallRow[];
  hints: string[];
}

export interface ConfigureStatuslineOptions {
  settingsPath?: string;
  scriptPath: string;
  homeDir?: string;
  twoLine?: boolean;
  noColor?: boolean;
  stackWithDefault?: boolean;
}

export interface ConfigureStatuslineResult {
  ok: boolean;
  action: 'configured' | 'removed' | 'noop' | 'blocked';
  settingsPath: string;
  command: string | null;
  previousCommand: string | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function paint(text: string, code: string, enabled: boolean): string {
  if (!enabled || !code) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function fmtCompactNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '--';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(3)}`;
  return '$0.00';
}

export function fmtDurationCompact(secRaw: number | null | undefined): string {
  if (secRaw === null || secRaw === undefined || !Number.isFinite(secRaw) || secRaw < 0) return '--';
  const sec = Math.round(secRaw);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const remS = sec % 60;
    return remS > 0 && min < 10 ? `${min}m${remS}s` : `${min}m`;
  }
  const hrs = Math.floor(min / 60);
  if (hrs < 48) {
    const remM = min % 60;
    return remM > 0 ? `${hrs}h${remM}m` : `${hrs}h`;
  }
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return remH > 0 ? `${days}d${remH}h` : `${days}d`;
}

export function shortenModelLabel(raw: string, compact = false): string {
  const s = String(raw || '').trim();
  if (!s) return 'Antigravity';
  if (!compact) return s;

  // Compact display for narrow terminals (<80 cols)
  const effortMatch = /\((xhigh|high|medium|med|low|max)\)/i.exec(s);
  const effortTag = effortMatch
    ? effortMatch[1].toLowerCase() === 'xhigh'
      ? '·XH'
      : effortMatch[1].toLowerCase() === 'medium' || effortMatch[1].toLowerCase() === 'med'
        ? '·M'
        : effortMatch[1].toLowerCase() === 'max'
          ? '·Max'
          : `·${effortMatch[1][0].toUpperCase()}`
    : '';

  const base = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const simplified = base
    .replace(/^Gemini\s+/i, 'G')
    .replace(/^Claude\s+/i, 'C ')
    .replace(/^Orchestrator/i, 'Orch')
    .replace(/\s+Preview$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const combined = `${simplified}${effortTag}`;
  return combined.length > 18 ? `${combined.slice(0, 17)}…` : combined;
}

export function getInvocationContextTokens(inv: any): number {
  if (!inv) return 0;
  if (typeof inv.totalContext === 'number' && inv.totalContext > 0) return inv.totalContext;
  const sum = (inv.cachedInput || 0) + (inv.newInput || 0) + (inv.outputTokens || 0);
  return sum > 0 ? sum : 0;
}

export function resolveEffectiveContext(tel: any): {
  used: number;
  limit: number;
  pct: number | null;
  compactCount: number;
} {
  const latest = tel?.latest || null;
  const invs: any[] = Array.isArray(tel?.invocations) ? tel.invocations : [];
  const compactions: any[] = Array.isArray(tel?.compactions) ? tel.compactions : [];
  const lastCmp = compactions.length ? compactions[compactions.length - 1] : null;
  const isTrailingCompact = Boolean(
    lastCmp &&
      lastCmp.afterCtx > 0 &&
      (lastCmp.afterGmIdx !== null && lastCmp.afterGmIdx !== undefined
        ? lastCmp.afterGmIdx >= invs.length
        : lastCmp.stepIdx > (latest?.stepIdx ?? -1)),
  );

  if (isTrailingCompact && lastCmp) {
    const limit = latest?.contextLimit || 256_000;
    const used = lastCmp.afterCtx;
    return {
      used,
      limit,
      pct: limit > 0 ? Math.min(100, (used / limit) * 100) : null,
      compactCount: compactions.length,
    };
  }

  const limit = latest?.contextLimit || 0;
  const used =
    getInvocationContextTokens(latest) ||
    (tel?.contextBreakdown?.reportedTotal > 0 ? tel.contextBreakdown.reportedTotal : 0);
  const pct =
    typeof latest?.contextPct === 'number' && latest.contextPct > 0
      ? latest.contextPct
      : limit > 0 && used > 0
        ? Math.min(100, (used / limit) * 100)
        : null;
  return {
    used,
    limit,
    pct,
    compactCount: compactions.length,
  };
}

export function computeHeadroomFromInvocations(
  invocations: any[],
  used: number,
  limit: number,
): { turns: number; medianDelta: number } | null {
  if (!(limit > 0) || !(used >= 0) || !Array.isArray(invocations) || invocations.length < 2) {
    return null;
  }
  if (used >= limit) return { turns: 0, medianDelta: 0 };

  let startIdx = 0;
  for (let i = invocations.length - 1; i > 0; i--) {
    const cur = getInvocationContextTokens(invocations[i]);
    const prev = getInvocationContextTokens(invocations[i - 1]);
    if (prev > 0 && cur < prev * 0.65) {
      startIdx = i;
      break;
    }
  }
  const slice = invocations.slice(startIdx);
  const byTurn: { k: string | number; ctx: number }[] = [];
  for (const r of slice) {
    const ctx = getInvocationContextTokens(r);
    if (!(ctx > 0)) continue;
    const k = r.turnIndex || `call:${r.idx}`;
    const prev = byTurn.length ? byTurn[byTurn.length - 1] : null;
    if (prev && prev.k === k) {
      if (ctx > prev.ctx) prev.ctx = ctx;
    } else {
      byTurn.push({ k, ctx });
    }
  }
  const series =
    byTurn.length >= 3
      ? byTurn.map((x) => x.ctx)
      : slice.map((x) => getInvocationContextTokens(x)).filter((v) => v > 0);
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d > 50 && d < limit * 0.45) {
      deltas.push(d);
    }
  }
  if (!deltas.length) return null;
  const recentDeltas = deltas.slice(-6).sort((a, b) => a - b);
  const mid = Math.floor(recentDeltas.length / 2);
  const medianDelta =
    recentDeltas.length % 2 === 1
      ? recentDeltas[mid]
      : (recentDeltas[mid - 1] + recentDeltas[mid]) / 2;
  if (!(medianDelta > 0)) return null;
  const remaining = Math.max(0, limit - used);
  const turns = Math.max(0, Math.floor(remaining / medianDelta));
  return { turns, medianDelta: Math.round(medianDelta) };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Stdin JSON parser (never throws)
// ---------------------------------------------------------------------------

export function parseStatuslineStdin(raw: string): CliStatuslinePayload | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as CliStatuslinePayload;
  } catch {
    return null;
  }
}
