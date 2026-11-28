/**
 * AGY-HUD CLI Statusline & Read-Only Telemetry Inspector Core.
 *
 * Zero external runtime dependencies — runs natively on Node.js 22.18+ (`node:sqlite`, read-only).
 * Supports:
 * 1. Antigravity CLI `/statusline` protocol (stdin JSON -> width-adaptive ANSI statusline)
 * 2. Local SQLite/WAL enrichment (GEN/E2E TPS, TTFT, Context X-Ray, Headroom, Cache TTL survival)
 * 3. Full read-only telemetry inspection (`--inspect`, `--json`) for humans & the bundled `/agy-hud` skill
 * 4. Atomic `0600` setup/removal of `~/.gemini/antigravity-cli/settings.json` `statusLine`
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  evalCacheSurvival,
  getCacheTtlPrior,
  solveTimeForSurvival,
  buildCacheTtlOverview,
} from './cache-ttl.ts';
import {
  inferAppDataSource,
  resolveAllAppDataDirs,
  resolveAppDataDir,
  resolveQuotaCalibrationPath,
  resolveQuotaFitPath,
  statSafe,
  UUID_RE,
} from './constants.ts';
import {
  buildAccountHistory,
  buildSessionInfo,
  getConversationGraph,
  pickTargetConversation,
} from './graph.ts';
import { getUserStatusCached } from './ls-client.ts';
import { resolveModelPricing } from './pricing.ts';
import {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
} from './quota-budget.ts';
import { resolveModelFamily } from './quota-solver.ts';
import { listConversations, readTelemetry } from './telemetry.ts';

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

function paint(text: string, code: string, enabled: boolean): string {
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

function getInvocationContextTokens(inv: any): number {
  if (!inv) return 0;
  if (typeof inv.totalContext === 'number' && inv.totalContext > 0) return inv.totalContext;
  const sum = (inv.cachedInput || 0) + (inv.newInput || 0) + (inv.outputTokens || 0);
  return sum > 0 ? sum : 0;
}

function resolveEffectiveContext(tel: any): {
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

function percentile(values: number[], p: number): number | null {
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

// ---------------------------------------------------------------------------
// Fast Single-Conversation DB Enrichment (for /statusline hot path)
// ---------------------------------------------------------------------------

function locateConversationDbFast(
  conversationId: string,
  appDataRoots: { appDataDir: string; conversationsDir: string; source: string }[],
): { id: string; dbPath: string; source: string; updatedMs: number } | null {
  if (conversationId && UUID_RE.test(conversationId)) {
    let best: { id: string; dbPath: string; source: string; updatedMs: number; size: number } | null = null;
    for (const root of appDataRoots) {
      const dbPath = join(root.conversationsDir, `${conversationId}.db`);
      const st = statSafe(dbPath);
      if (!(st.size > 0)) continue;
      const wal = statSafe(`${dbPath}-wal`);
      const updatedMs = Math.max(st.mtimeMs, wal.mtimeMs);
      const size = st.size + wal.size;
      if (!best || updatedMs > best.updatedMs || (updatedMs === best.updatedMs && size > best.size)) {
        best = {
          id: conversationId,
          dbPath,
          source: root.source || inferAppDataSource(root.appDataDir),
          updatedMs,
          size,
        };
      }
    }
    if (best) return best;
  }

  // Fallback when no conversation_id provided: pick newest conversation across roots
  const all = listConversations(appDataRoots, '', 0);
  if (!all.length) return null;
  const top = all[0];
  return {
    id: top.id,
    dbPath: top.dbPath,
    source: top.source || 'app',
    updatedMs: top.updatedMs,
  };
}

export function readFastConversationSnapshot(options: {
  conversationId?: string;
  appDataDir?: string;
  nowMs?: number;
} = {}): FastDbSnapshot | null {
  try {
    const nowMs = options.nowMs ?? Date.now();
    const baseAppDataDir = options.appDataDir ? resolve(options.appDataDir) : resolveAppDataDir();
    const roots = options.appDataDir
      ? [{
          appDataDir: baseAppDataDir,
          conversationsDir: join(baseAppDataDir, 'conversations'),
          annotationsDir: join(baseAppDataDir, 'annotations'),
          source: inferAppDataSource(baseAppDataDir),
        }]
      : resolveAllAppDataDirs(baseAppDataDir, { discoverExternal: false });

    const target = locateConversationDbFast(options.conversationId || '', roots);
    if (!target) return null;

    const tel = readTelemetry(target.dbPath, [], target.updatedMs);
    if (!tel) return null;

    const latest = tel.latest || null;
    const summary = tel.summary || ({} as any);
    const invocations = Array.isArray(tel.invocations) ? tel.invocations : [];

    const effCtx = resolveEffectiveContext(tel);
    const contextUsed = effCtx.used;
    const contextLimit = effCtx.limit;
    const contextPct = effCtx.pct;
    const headroom = computeHeadroomFromInvocations(invocations, contextUsed, contextLimit);

    const modelDisplay =
      tel.currentModel?.modelDisplay ||
      latest?.modelDisplay ||
      tel.currentModel?.model ||
      latest?.model ||
      '';
    const modelId = tel.currentModel?.modelId || latest?.modelId || latest?.model || '';
    const modelRaw = tel.currentModel?.model || latest?.model || modelId;

    const latestCallMs = summary.latestCallMs || latest?.timestampMs || 0;
    let cacheSurvivalProb: number | null = null;
    let cacheP80RemSec: number | null = null;
    let cacheMissPenaltyUSD: number | null = null;

    if (latestCallMs > 0 && contextUsed >= 2_000) {
      const family = resolveModelFamily(modelId, modelDisplay, modelRaw);
      const prior = getCacheTtlPrior(family);
      const ageSec = Math.max(0, Math.floor((nowMs - latestCallMs) / 1000));
      cacheSurvivalProb = evalCacheSurvival(prior, ageSec);
      const p80Sec = solveTimeForSurvival(prior, 0.8);
      cacheP80RemSec = Math.max(0, Math.round(p80Sec - ageSec));
      const pricing = resolveModelPricing(modelId, modelDisplay, modelRaw, latestCallMs);
      if (pricing) {
        const cachedTok = latest?.cachedInput || contextUsed;
        cacheMissPenaltyUSD = Math.max(0, (cachedTok / 1_000_000) * Math.max(0, pricing.input - pricing.cached));
      }
    }

    return {
      conversationId: target.id,
      dbPath: target.dbPath,
      source: target.source,
      modelDisplay,
      modelId,
      genTps: typeof latest?.genTps === 'number' && Number.isFinite(latest.genTps) ? latest.genTps : null,
      e2eTps: typeof latest?.e2eTps === 'number' && Number.isFinite(latest.e2eTps) ? latest.e2eTps : null,
      avgGenTps: typeof summary.avgGenTps === 'number' && Number.isFinite(summary.avgGenTps) ? summary.avgGenTps : null,
      ttftSec: typeof latest?.ttftSec === 'number' && Number.isFinite(latest.ttftSec) ? latest.ttftSec : null,
      isBuffered: Boolean(latest?.isBuffered),
      cacheHitPct:
        typeof latest?.cacheHitPct === 'number' && Number.isFinite(latest.cacheHitPct) ? latest.cacheHitPct : null,
      contextUsed,
      contextLimit,
      contextPct,
      headroomTurns: headroom ? headroom.turns : null,
      costUSD: typeof summary.totalCostUSD === 'number' ? summary.totalCostUSD : 0,
      savedUSD: typeof summary.totalSavedUSD === 'number' ? summary.totalSavedUSD : 0,
      callCount: typeof summary.count === 'number' ? summary.count : invocations.length,
      compactCount: effCtx.compactCount,
      latestCallMs,
      cacheSurvivalProb,
      cacheP80RemSec,
      cacheMissPenaltyUSD,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Width-Adaptive ANSI Statusline Renderer
// ---------------------------------------------------------------------------

function pickTightestQuota(quota?: Record<string, CliQuotaBucket>): {
  label: string;
  remainingPct: number;
  resetSec: number | null;
} | null {
  if (!quota || typeof quota !== 'object') return null;
  let best: { label: string; remainingPct: number; resetSec: number | null } | null = null;
  for (const [bucketId, entry] of Object.entries(quota)) {
    if (!entry || entry.disabled) continue;
    if (typeof entry.remaining_fraction !== 'number' || !Number.isFinite(entry.remaining_fraction)) {
      continue;
    }
    const pct = Math.max(0, Math.min(100, entry.remaining_fraction * 100));
    const lower = bucketId.toLowerCase();
    const label = /5h|hour/.test(lower)
      ? '5h'
      : /7d|week/.test(lower)
        ? '7d'
        : 'Q';
    const resetSec =
      typeof entry.reset_in_seconds === 'number' && Number.isFinite(entry.reset_in_seconds)
        ? entry.reset_in_seconds
        : null;
    if (!best || pct < best.remainingPct) {
      best = { label, remainingPct: pct, resetSec };
    }
  }
  return best;
}

function buildContextBar(pct: number, width: number, color: boolean): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const tone = clamped >= 85 ? '31' : clamped >= 70 ? '33' : '32';
  return (
    paint('█'.repeat(filled), tone, color) +
    paint('░'.repeat(empty), '90', color)
  );
}

function joinSegmentsFittingWidth(segments: string[], sep: string, maxWidth: number): string {
  const kept: string[] = [];
  let curLen = 0;
  const sepLen = visibleLength(sep);
  for (const seg of segments) {
    if (!seg) continue;
    const segLen = visibleLength(seg);
    const addLen = kept.length === 0 ? segLen : sepLen + segLen;
    if (kept.length > 0 && curLen + addLen > maxWidth) {
      break;
    }
    kept.push(seg);
    curLen += addLen;
  }
  return kept.join(sep);
}

export function renderStatusline(options: RenderStatuslineOptions): string {
  const payload = options.payload ?? null;
  const dbSnap = options.dbSnap ?? null;
  const color = options.color ?? true;
  const twoLine = Boolean(options.twoLine);
  const rawWidth =
    options.width ??
    (typeof payload?.terminal_width === 'number' && payload.terminal_width > 20
      ? payload.terminal_width
      : 100);
  const width = Math.max(40, Math.floor(rawWidth));
  const isNarrow = width < 82;

  const sep = paint(' │ ', '90', color);

  // 1. State icon + Model name
  const state = payload?.tool_confirmation_pending
    ? 'reviewing'
    : (payload?.agent_state || 'idle');
  let stateIcon = paint('●', '90', color);
  if (state === 'working') stateIcon = paint('●', '32', color);
  else if (state === 'tool_use') stateIcon = paint('⚙', '36', color);
  else if (state === 'reviewing') stateIcon = paint('◆', '33', color);
  else if (state === 'error') stateIcon = paint('✖', '31', color);
  else if (state === 'initializing' || state === 'authenticating') stateIcon = paint('◌', '33', color);

  const rawModel =
    payload?.model?.display_name ||
    payload?.model?.id ||
    dbSnap?.modelDisplay ||
    dbSnap?.modelId ||
    'AGY-HUD';
  const modelText = paint(shortenModelLabel(rawModel, isNarrow), '1;37', color);
  const segModel = `${stateIcon} ${modelText}`;

  // 2. Context Window + Headroom
  const ctxPct =
    typeof payload?.context_window?.used_percentage === 'number' &&
    Number.isFinite(payload.context_window.used_percentage)
      ? payload.context_window.used_percentage
      : dbSnap?.contextPct ?? null;

  let segCtx = '';
  if (ctxPct !== null) {
    const pctTone = ctxPct >= 85 ? '1;31' : ctxPct >= 70 ? '1;33' : '32';
    const pctText = paint(`${ctxPct < 10 ? ctxPct.toFixed(1) : Math.round(ctxPct)}%`, pctTone, color);
    const bar = width >= 72 ? `${buildContextBar(ctxPct, isNarrow ? 5 : 8, color)} ` : '';
    const headroom =
      dbSnap?.headroomTurns !== null && dbSnap?.headroomTurns !== undefined && width >= 92
        ? paint(` ~${dbSnap.headroomTurns}t`, dbSnap.headroomTurns <= 3 ? '31' : dbSnap.headroomTurns <= 8 ? '33' : '90', color)
        : '';
    segCtx = `${bar}${pctText}${headroom}`;
  } else if (dbSnap && dbSnap.contextUsed > 0) {
    segCtx = paint(`ctx ${fmtCompactNum(dbSnap.contextUsed)}`, '36', color);
  }

  // 3. Speed (GEN TPS) & TTFT (AGY-HUD signature)
  let segSpeed = '';
  if (dbSnap && (dbSnap.genTps !== null || dbSnap.ttftSec !== null || dbSnap.isBuffered)) {
    const parts: string[] = [];
    if (dbSnap.isBuffered) {
      parts.push(paint('BUF', '36', color));
    } else if (dbSnap.genTps !== null && dbSnap.genTps > 0) {
      parts.push(paint(`${Math.round(dbSnap.genTps)} t/s`, '32', color));
    }
    if (dbSnap.ttftSec !== null && dbSnap.ttftSec >= 0) {
      const ttftTone = dbSnap.ttftSec >= 4 ? '31' : dbSnap.ttftSec >= 2 ? '33' : '36';
      parts.push(paint(`${dbSnap.ttftSec.toFixed(1)}s`, ttftTone, color));
    }
    if (parts.length) {
      segSpeed = parts.join(paint(' · ', '90', color));
    }
  }

  // 4. Cache Hit % & Prompt Cache TTL Survival
  let cacheHitPct = dbSnap?.cacheHitPct ?? null;
  if (cacheHitPct === null && payload?.context_window?.current_usage) {
    const cu = payload.context_window.current_usage;
    const read = cu.cache_read_input_tokens || 0;
    const totalIn = (cu.input_tokens || 0) + read + (cu.cache_creation_input_tokens || 0);
    if (totalIn > 0 && read > 0) {
      cacheHitPct = (read / totalIn) * 100;
    }
  }
  let segCache = '';
  if (cacheHitPct !== null || dbSnap?.cacheSurvivalProb !== null && dbSnap?.cacheSurvivalProb !== undefined) {
    const parts: string[] = [];
    if (cacheHitPct !== null) {
      const cTone = cacheHitPct < 60 ? '33' : '36';
      parts.push(paint(`C ${Math.round(cacheHitPct)}%`, cTone, color));
    }
    if (dbSnap?.cacheSurvivalProb !== null && dbSnap?.cacheSurvivalProb !== undefined) {
      const pPct = Math.round(dbSnap.cacheSurvivalProb * 100);
      const tTone = pPct < 40 ? '31' : pPct < 75 ? '33' : '32';
      const remTag =
        dbSnap.cacheP80RemSec !== null && dbSnap.cacheP80RemSec >= 15 && width >= 105
          ? ` ${fmtDurationCompact(dbSnap.cacheP80RemSec)}`
          : '';
      parts.push(paint(`TTL ~${pPct}%${remTag}`, tTone, color));
    }
    if (parts.length) {
      segCache = parts.join(paint(' · ', '90', color));
    }
  }

  // 5. Quota remaining
  const tightQuota = pickTightestQuota(payload?.quota);
  let segQuota = '';
  if (tightQuota) {
    const qTone = tightQuota.remainingPct <= 15 ? '1;31' : tightQuota.remainingPct <= 35 ? '33' : '32';
    const resetSuffix =
      tightQuota.resetSec !== null && tightQuota.remainingPct < 50 && width >= 100
        ? paint(` (${fmtDurationCompact(tightQuota.resetSec)})`, '90', color)
        : '';
    segQuota = `${paint(`${tightQuota.label} ${Math.round(tightQuota.remainingPct)}%`, qTone, color)}${resetSuffix}`;
  }

  // 6. Session cost
  const totalUsd =
    typeof payload?.cost?.total_usd === 'number' && Number.isFinite(payload.cost.total_usd)
      ? payload.cost.total_usd
      : dbSnap && dbSnap.costUSD > 0
        ? dbSnap.costUSD
        : null;
  const segCost = totalUsd !== null && totalUsd > 0 ? paint(fmtUsd(totalUsd), '37', color) : '';

  // 7. Compact live chips (subagents, tasks, mode, sandbox, git/dir)
  const chips: string[] = [];
  const runningSub = Array.isArray(payload?.subagents)
    ? payload.subagents.filter((s) => s?.status === 'running').length
    : 0;
  if (runningSub > 0) chips.push(paint(`sub:${runningSub}`, '35', color));
  if (payload?.task_count && payload.task_count > 0) {
    chips.push(paint(`tasks:${payload.task_count}`, '36', color));
  }
  if (payload?.cycle_mode) chips.push(paint(payload.cycle_mode, '33', color));
  if (payload?.sandbox?.enabled) chips.push(paint('sandbox', '32', color));
  if (payload?.vim?.mode) chips.push(paint(payload.vim.mode, '35', color));
  const segChips = chips.join(' ');

  const projectDir = payload?.workspace?.current_dir || payload?.workspace?.project_dir || payload?.cwd || '';
  const dirLabel = projectDir ? basename(projectDir) : '';
  const segDir = dirLabel
    ? paint(`${payload?.vcs?.type ? `${payload.vcs.type}:` : ''}${dirLabel}`, '90', color)
    : '';

  if (twoLine) {
    const line1 = joinSegmentsFittingWidth(
      [segModel, segCtx, segSpeed, segQuota, segCost],
      sep,
      width,
    );
    const line2Parts = [segCache, segChips, segDir].filter(Boolean);
    const line2 = line2Parts.length ? joinSegmentsFittingWidth(line2Parts, sep, width) : '';
    return line2 ? `${line1}\n${line2}` : line1;
  }

  return joinSegmentsFittingWidth(
    [segModel, segCtx, segSpeed, segQuota, segCache, segCost, segChips, segDir],
    sep,
    width,
  );
}

// ---------------------------------------------------------------------------
// Full Read-Only Telemetry Inspector (`--inspect` & `/agy-hud` skill)
// ---------------------------------------------------------------------------

export async function buildInspectReport(
  options: InspectTelemetryOptions = {},
): Promise<InspectTelemetryReport> {
  const nowMs = options.nowMs ?? Date.now();
  const callsLimit = Math.max(1, Math.min(30, options.callsLimit ?? 8));
  const baseAppDataDir = options.appDataDir ? resolve(options.appDataDir) : resolveAppDataDir();
  const appDataRoots = options.appDataDir
    ? [{
        appDataDir: baseAppDataDir,
        conversationsDir: join(baseAppDataDir, 'conversations'),
        annotationsDir: join(baseAppDataDir, 'annotations'),
        source: inferAppDataSource(baseAppDataDir),
      }]
    : resolveAllAppDataDirs(baseAppDataDir);

  const conversations = listConversations(appDataRoots, '', 0);
  const explicitConvId =
    options.conversationId && UUID_RE.test(options.conversationId)
      ? options.conversationId
      : process.env.ANTIGRAVITY_CONVERSATION_ID && UUID_RE.test(process.env.ANTIGRAVITY_CONVERSATION_ID)
        ? process.env.ANTIGRAVITY_CONVERSATION_ID
        : '';

  const emptyReport: InspectTelemetryReport = {
    found: false,
    generatedAtMs: nowMs,
    conversationId: explicitConvId,
    title: '',
    source: '',
    dbPath: '',
    model: { display: '', id: '', isActive: false },
    speed: {
      latestGenTps: null,
      avgGenTps: null,
      peakGenTps: null,
      latestE2eTps: null,
      latestTtftSec: null,
      avgTtftSec: null,
      p95TtftSec: null,
      isBuffered: false,
    },
    context: {
      used: 0,
      limit: 0,
      usedPct: 0,
      free: 0,
      headroomTurns: null,
      medianDeltaTokens: null,
      compactCount: 0,
      breakdown: null,
    },
    cache: { latestHitPct: null, sessionHitPct: null, savedUSD: 0, ttl: null },
    session: { calls: 0, totalCostUSD: 0, totalSavedUSD: 0, totalOutputTokens: 0, treeTotals: null, swarm: null },
    account: {
      tier: '',
      tierId: '',
      tierMultiplier: null,
      todayCostUSD: 0,
      monthCostUSD: 0,
      totalCostUSD: 0,
      totalCalls: 0,
      dbCount: 0,
      quotaAvailable: false,
      pools: [],
    },
    recentCalls: [],
    hints: ['No Antigravity conversation database found yet. Start a conversation in Antigravity first.'],
  };

  if (!conversations.length) {
    return emptyReport;
  }

  const graph = getConversationGraph(conversations, { requiredConvId: explicitConvId, appDataRoots });
  const target = pickTargetConversation({
    mode: explicitConvId ? 'auto' : 'latest',
    explicitConvId,
    conversations,
    graph,
  });

  if (!target) {
    return emptyReport;
  }

  let rawQuota: any = options.rawQuotaOverride ?? { available: false, reason: 'skipped' };
  if (
    options.rawQuotaOverride === undefined &&
    options.includeLiveQuota !== false &&
    process.env.ANTIGRAVITY_LS_ADDRESS &&
    process.env.ANTIGRAVITY_CSRF_TOKEN
  ) {
    try {
      rawQuota = await getUserStatusCached(true, false);
    } catch {
      rawQuota = { available: false, reason: 'unavailable' };
    }
  }

  const rawTelemetry = readTelemetry(target.dbPath, conversations, target.updatedMs);
  if (!rawTelemetry) {
    return emptyReport;
  }

  const quotaCalPath = resolveQuotaCalibrationPath(baseAppDataDir);
  const quotaFitPath = resolveQuotaFitPath(baseAppDataDir);
  const fittedQuota = attachQuotaBudgetEstimates(rawQuota, graph, {
    nowMs,
    calibrationPath: quotaCalPath,
    fitPath: quotaFitPath,
  });
  const decoratedTelemetry = attachTelemetryQuotaPredictions(rawTelemetry, fittedQuota, {
    fitPath: quotaFitPath,
    nowMs,
  });
  const cacheTtl = buildCacheTtlOverview(graph.summaries, decoratedTelemetry, fittedQuota);
  const sessionInfoFull = buildSessionInfo(target.id, graph);
  const enrichedGraph = attachGraphQuotaSummaries({
    conversations: [],
    sessionInfo: sessionInfoFull,
    graph,
    accountQuota: fittedQuota,
    opts: { fitPath: quotaFitPath, nowMs },
  });
  const accountHistory = buildAccountHistory(graph, nowMs);

  const invs: any[] = Array.isArray(decoratedTelemetry.invocations) ? decoratedTelemetry.invocations : [];
  const latest = decoratedTelemetry.latest || null;
  const s = decoratedTelemetry.summary || {};

  const ttftList = invs
    .map((x) => x.ttftSec)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const avgTtftSec = ttftList.length ? ttftList.reduce((a, b) => a + b, 0) / ttftList.length : null;
  const p95TtftSec = percentile(ttftList, 95);

  const effCtx = resolveEffectiveContext(decoratedTelemetry);
  const ctxUsed = effCtx.used;
  const ctxLimit = effCtx.limit;
  const ctxPct = effCtx.pct ?? 0;
  const headroom = computeHeadroomFromInvocations(invs, ctxUsed, ctxLimit);

  const bd = decoratedTelemetry.contextBreakdown;
  const breakdown = bd && bd.reportedTotal > 0
    ? {
        systemPrompt: bd.systemPrompt || 0,
        toolsSchema: bd.toolsSchema || 0,
        toolResults: bd.toolResults || 0,
        assistant: bd.assistant || 0,
        userAndOther: bd.userAndOther || 0,
        topTools: (Array.isArray(bd.toolResultsByTool) && bd.toolResultsByTool.length
          ? bd.toolResultsByTool
          : bd.toolSchemaItems || []
        )
          .slice(0, 5)
          .map((it: any) => ({ name: String(it.name || ''), tokens: Number(it.tokens || 0) })),
      }
    : null;

  const totalCachedIn = invs.reduce((acc, x) => acc + (x.cachedInput || 0), 0);
  const totalPromptIn = invs.reduce((acc, x) => acc + (x.cachedInput || 0) + (x.newInput || 0), 0);
  const sessionHitPct = totalPromptIn > 0 ? (totalCachedIn / totalPromptIn) * 100 : null;

  const cs = cacheTtl?.currentSession || null;
  let ttlBlock: InspectTelemetryReport['cache']['ttl'] = null;
  if (cs && cs.lastCallMs > 0) {
    const idleSec = Math.max(0, Math.floor((nowMs - cs.lastCallMs) / 1000));
    const prob = evalCacheSurvival(cs, idleSec);
    ttlBlock = {
      family: cs.family,
      confidence: cs.confidence,
      idleSec,
      survivalProbPct: Math.round(prob * 100),
      p80Sec: cs.p80Sec,
      p50Sec: cs.p50Sec,
      remSafeSec: Math.max(0, Math.round(cs.p80Sec - idleSec)),
      missPenaltyUSD: cs.missPenaltyUSD || 0,
      missPenaltyQuota5hPct: cs.missPenaltyQuota5hPct ?? null,
    };
  }

  const recentCalls: InspectCallRow[] = invs.slice(-callsLimit).reverse().map((inv, idx) => {
    const flags: string[] = [];
    const promptTok = (inv.cachedInput || 0) + (inv.newInput || 0);
    if (typeof inv.ttftSec === 'number' && inv.ttftSec > 3.0) flags.push('SLOW-TTFT');
    if (typeof inv.cacheHitPct === 'number' && inv.cacheHitPct < 60 && promptTok >= 2_000) {
      flags.push('LOW-CACHE');
    }
    if (inv.isBuffered) flags.push('BUF');
    return {
      seq: invs.length - idx,
      model: inv.modelDisplay || inv.model || 'Unknown',
      ttftSec: typeof inv.ttftSec === 'number' ? inv.ttftSec : null,
      genTps: typeof inv.genTps === 'number' ? inv.genTps : null,
      e2eTps: typeof inv.e2eTps === 'number' ? inv.e2eTps : null,
      outputTokens: inv.outputTokens || 0,
      contextUsed: getInvocationContextTokens(inv),
      cacheHitPct: typeof inv.cacheHitPct === 'number' ? inv.cacheHitPct : null,
      costUSD: typeof inv.costUSD === 'number' ? inv.costUSD : null,
      quota5hPct:
        typeof inv.quotaPct5h === 'number' && Number.isFinite(inv.quotaPct5h) ? inv.quotaPct5h : null,
      flags,
      timestampMs: inv.timestampMs || 0,
    };
  });

  const pools = Array.isArray(fittedQuota?.pools)
    ? fittedQuota.pools.map((p: any) => {
        const wins: any[] = Array.isArray(p.windows) ? p.windows : [];
        const w5 = wins.find((w) => w?.spanKey === '5h');
        const w7 = wins.find((w) => w?.spanKey === '7d');
        const rem5 = typeof w5?.remainingPct === 'number' && Number.isFinite(w5.remainingPct) ? w5.remainingPct : null;
        const rem7 = typeof w7?.remainingPct === 'number' && Number.isFinite(w7.remainingPct) ? w7.remainingPct : null;
        return {
          label: p.label || p.poolId || 'Pool',
          usedPct5h: rem5 !== null ? Number(Math.max(0, Math.min(100, 100 - rem5)).toFixed(2)) : null,
          remainingPct5h: rem5,
          reset5hMs: typeof w5?.resetAtMs === 'number' && w5.resetAtMs > 0 ? w5.resetAtMs : null,
          runway5hSec:
            typeof w5?.runway?.exhaustInSec === 'number' && Number.isFinite(w5.runway.exhaustInSec)
              ? w5.runway.exhaustInSec
              : null,
          usedPct7d: rem7 !== null ? Number(Math.max(0, Math.min(100, 100 - rem7)).toFixed(2)) : null,
          remainingPct7d: rem7,
          reset7dMs: typeof w7?.resetAtMs === 'number' && w7.resetAtMs > 0 ? w7.resetAtMs : null,
          runway7dSec:
            typeof w7?.runway?.exhaustInSec === 'number' && Number.isFinite(w7.runway.exhaustInSec)
              ? w7.runway.exhaustInSec
              : null,
        };
      })
    : [];

  const si = enrichedGraph.sessionInfo;
  const treeTotals =
    si?.treeTotals && si.treeTotals.descendantCount > 0
      ? {
          descendantCount: si.treeTotals.descendantCount,
          totalCostUSD:
            typeof si.treeTotals.costUSD === 'number'
              ? si.treeTotals.costUSD
              : (s.totalCostUSD || 0) + (si.treeTotals.childCostUSD || 0),
          totalCalls:
            typeof si.treeTotals.calls === 'number'
              ? si.treeTotals.calls
              : (s.count || 0) + (si.treeTotals.childCalls || 0),
          swarmWorkerCount: si.treeTotals.swarmWorkerCount || 0,
        }
      : null;

  const swarmSummary = si?.swarm
    ? {
        title: si.swarm.swarmTitle || '',
        memberCount: typeof si.swarm.memberCount === 'number' ? si.swarm.memberCount : 0,
        workingCount: typeof si.swarm.workingCount === 'number' ? si.swarm.workingCount : 0,
        waitingCount: typeof si.swarm.waitingCount === 'number' ? si.swarm.waitingCount : 0,
        boardSeq: si.swarm.boardSeq || 0,
      }
    : null;

  // Actionable 1-line diagnostic hints
  const hints: string[] = [];
  if (ctxPct >= 85) {
    hints.push(
      `Context window is at ${ctxPct.toFixed(1)}%${headroom ? ` (~${headroom.turns} turns remaining)` : ''}; consider running /compact soon.`,
    );
  } else if (headroom && headroom.turns <= 4) {
    hints.push(`Estimated context headroom is low (~${headroom.turns} turns before compaction).`);
  }
  if (ttlBlock) {
    if (ttlBlock.survivalProbPct < 50 && ttlBlock.missPenaltyUSD >= 0.01) {
      hints.push(
        `Prompt cache survival has dropped to ~${ttlBlock.survivalProbPct}% (estimated cold-miss penalty ${fmtUsd(ttlBlock.missPenaltyUSD)}).`,
      );
    } else if (ttlBlock.remSafeSec > 0 && ttlBlock.remSafeSec <= 180 && ttlBlock.missPenaltyUSD >= 0.01) {
      hints.push(
        `Prompt cache stays in P80 safe zone for ~${fmtDurationCompact(ttlBlock.remSafeSec)}; continuing now saves ~${fmtUsd(ttlBlock.missPenaltyUSD)}.`,
      );
    }
  }
  for (const p of pools) {
    if (p.remainingPct5h !== null && p.remainingPct5h <= 15) {
      hints.push(`${p.label} 5h quota is low (${p.remainingPct5h.toFixed(0)}% remaining).`);
    }
  }
  if (typeof latest?.ttftSec === 'number' && latest.ttftSec >= 4.0) {
    hints.push(`Latest turn TTFT was elevated (${latest.ttftSec.toFixed(2)}s).`);
  }
  if (!hints.length) {
    hints.push('Session telemetry looks healthy: context, cache survival, and latency are within normal bounds.');
  }

  return {
    found: true,
    generatedAtMs: nowMs,
    conversationId: target.id,
    title: si?.title || '',
    source: target.source || 'app',
    dbPath: target.dbPath,
    model: {
      display: decoratedTelemetry.currentModel?.modelDisplay || latest?.modelDisplay || latest?.model || 'Unknown',
      id: decoratedTelemetry.currentModel?.modelId || latest?.modelId || latest?.model || '',
      isActive: Boolean(decoratedTelemetry.currentModel?.isActive),
    },
    speed: {
      latestGenTps: typeof latest?.genTps === 'number' ? latest.genTps : null,
      avgGenTps: typeof s.avgGenTps === 'number' ? s.avgGenTps : null,
      peakGenTps: typeof s.peakGenTps === 'number' ? s.peakGenTps : null,
      latestE2eTps: typeof latest?.e2eTps === 'number' ? latest.e2eTps : null,
      latestTtftSec: typeof latest?.ttftSec === 'number' ? latest.ttftSec : null,
      avgTtftSec,
      p95TtftSec,
      isBuffered: Boolean(latest?.isBuffered),
    },
    context: {
      used: ctxUsed,
      limit: ctxLimit,
      usedPct: ctxPct,
      free: Math.max(0, ctxLimit - ctxUsed),
      headroomTurns: headroom ? headroom.turns : null,
      medianDeltaTokens: headroom ? headroom.medianDelta : null,
      compactCount: effCtx.compactCount,
      breakdown,
    },
    cache: {
      latestHitPct: typeof latest?.cacheHitPct === 'number' ? latest.cacheHitPct : null,
      sessionHitPct,
      savedUSD: s.totalSavedUSD || 0,
      ttl: ttlBlock,
    },
    session: {
      calls: s.count || invs.length,
      totalCostUSD: s.totalCostUSD || 0,
      totalSavedUSD: s.totalSavedUSD || 0,
      totalOutputTokens: s.totalOutput || 0,
      treeTotals,
      swarm: swarmSummary,
    },
    account: {
      tier: fittedQuota?.available
        ? fittedQuota.tierMeta?.displayLabel || fittedQuota.tierName || fittedQuota.planName || ''
        : '',
      tierId: fittedQuota?.available ? fittedQuota.tierMeta?.tierId || fittedQuota.tierId || '' : '',
      tierMultiplier: fittedQuota?.available ? fittedQuota.tierMeta?.multiplier ?? null : null,
      todayCostUSD: accountHistory.todayCostUSD || 0,
      monthCostUSD: accountHistory.monthCostUSD || 0,
      totalCostUSD: accountHistory.totalCostUSD || 0,
      totalCalls: accountHistory.totalCalls || 0,
      dbCount: accountHistory.dbCount || 0,
      quotaAvailable: Boolean(fittedQuota?.available),
      pools,
    },
    recentCalls,
    hints,
  };
}

export function formatInspectMarkdown(r: InspectTelemetryReport): string {
  if (!r.found) {
    return `# AGY-HUD Telemetry\n\n${r.hints.join('\n')}`;
  }

  const lines: string[] = [];
  lines.push(`# AGY-HUD Telemetry Snapshot`);
  lines.push(
    `- **Conversation**: \`${r.conversationId}\`${r.title ? ` — ${r.title}` : ''} (${r.source})`,
  );
  lines.push(
    `- **Model**: ${r.model.display}${r.model.id && r.model.id !== r.model.display ? ` (\`${r.model.id}\`)` : ''}`,
  );
  lines.push('');

  lines.push('## Speed & Latency');
  lines.push(
    `- **Latest**: GEN \`${r.speed.isBuffered ? 'BUF' : r.speed.latestGenTps !== null ? `${r.speed.latestGenTps.toFixed(1)} tok/s` : '--'}\` · E2E \`${r.speed.latestE2eTps !== null ? `${r.speed.latestE2eTps.toFixed(1)} tok/s` : '--'}\` · TTFT \`${r.speed.latestTtftSec !== null ? `${r.speed.latestTtftSec.toFixed(2)}s` : '--'}\``,
  );
  lines.push(
    `- **Session**: Avg GEN \`${r.speed.avgGenTps !== null ? `${r.speed.avgGenTps.toFixed(1)} tok/s` : '--'}\` · Peak \`${r.speed.peakGenTps !== null ? `${r.speed.peakGenTps.toFixed(1)} tok/s` : '--'}\` · Avg/P95 TTFT \`${r.speed.avgTtftSec !== null ? `${r.speed.avgTtftSec.toFixed(2)}s` : '--'}\` / \`${r.speed.p95TtftSec !== null ? `${r.speed.p95TtftSec.toFixed(2)}s` : '--'}\``,
  );
  lines.push('');

  lines.push('## Context Window & Prompt Cache');
  lines.push(
    `- **Context**: \`${fmtCompactNum(r.context.used)}\` / \`${fmtCompactNum(r.context.limit)}\` (${r.context.usedPct.toFixed(1)}%) · Free \`${fmtCompactNum(r.context.free)}\`${r.context.headroomTurns !== null ? ` · Headroom \`~${r.context.headroomTurns} turns\`` : ''}${r.context.compactCount > 0 ? ` · Compactions: ${r.context.compactCount}` : ''}`,
  );
  if (r.context.breakdown) {
    const b = r.context.breakdown;
    lines.push(
      `- **Breakdown**: System \`${fmtCompactNum(b.systemPrompt)}\` · Tool Defs \`${fmtCompactNum(b.toolsSchema)}\` · Tool Results \`${fmtCompactNum(b.toolResults)}\` · Replies \`${fmtCompactNum(b.assistant)}\` · User/Ckpt \`${fmtCompactNum(b.userAndOther)}\``,
    );
    if (b.topTools.length) {
      lines.push(
        `- **Top Tools**: ${b.topTools.map((t) => `\`${t.name}\` (${fmtCompactNum(t.tokens)})`).join(', ')}`,
      );
    }
  }
  lines.push(
    `- **Prompt Cache**: Latest \`${r.cache.latestHitPct !== null ? `${r.cache.latestHitPct.toFixed(1)}%` : '--'}\` · Session \`${r.cache.sessionHitPct !== null ? `${r.cache.sessionHitPct.toFixed(1)}%` : '--'}\` · Saved \`${fmtUsd(r.cache.savedUSD)}\``,
  );
  if (r.cache.ttl) {
    const t = r.cache.ttl;
    lines.push(
      `- **Cache TTL (${t.family}, ${t.confidence})**: Survival \`~${t.survivalProbPct}%\` (idle ${fmtDurationCompact(t.idleSec)}) · P80/P50 \`${fmtDurationCompact(t.p80Sec)} / ${fmtDurationCompact(t.p50Sec)}\`${t.remSafeSec > 0 ? ` · Safe window left \`${fmtDurationCompact(t.remSafeSec)}\`` : ''} · Miss penalty \`${fmtUsd(t.missPenaltyUSD)}\`${t.missPenaltyQuota5hPct !== null ? ` (${t.missPenaltyQuota5hPct.toFixed(2)}% 5h)` : ''}`,
    );
  }
  lines.push('');

  lines.push('## Session Spend, Swarm & Account');
  lines.push(
    `- **Session**: ${r.session.calls} calls · Cost \`${fmtUsd(r.session.totalCostUSD)}\` (saved \`${fmtUsd(r.session.totalSavedUSD)}\`) · Output \`${fmtCompactNum(r.session.totalOutputTokens)}\` tok`,
  );
  if (r.session.treeTotals) {
    lines.push(
      `- **Recursive Tree Rollup**: +${r.session.treeTotals.descendantCount} subagents · Total \`${fmtUsd(r.session.treeTotals.totalCostUSD)}\` (${r.session.treeTotals.totalCalls} calls)`,
    );
  }
  if (r.session.swarm) {
    lines.push(
      `- **Swarm**: ${r.session.swarm.title || 'Active Swarm'} · ${r.session.swarm.memberCount} workers (${r.session.swarm.workingCount} working, ${r.session.swarm.waitingCount} waiting) · Board #${r.session.swarm.boardSeq}`,
    );
  }
  lines.push(
    `- **Local Account History**: Today \`${fmtUsd(r.account.todayCostUSD)}\` · Month \`${fmtUsd(r.account.monthCostUSD)}\` · All-time \`${fmtUsd(r.account.totalCostUSD)}\` (${r.account.totalCalls} calls across ${r.account.dbCount} sessions)${r.account.tier ? ` · Tier: ${r.account.tier}` : ''}`,
  );
  if (r.account.quotaAvailable && r.account.pools.length) {
    for (const p of r.account.pools) {
      const p5 = p.remainingPct5h !== null ? `5h ${p.remainingPct5h.toFixed(0)}% left` : '';
      const p7 = p.remainingPct7d !== null ? `7d ${p.remainingPct7d.toFixed(0)}% left` : '';
      const rw = p.runway5hSec !== null ? ` · 5h runway ${fmtDurationCompact(p.runway5hSec)}` : '';
      const summaryParts = [p5, p7].filter(Boolean).join(' · ');
      if (summaryParts) {
        lines.push(`  - **Quota [${p.label}]**: ${summaryParts}${rw}`);
      }
    }
  }
  lines.push('');

  if (r.recentCalls.length) {
    lines.push(`## Recent Calls (latest ${r.recentCalls.length})`);
    lines.push('| # | Model | TTFT | GEN TPS | Out | Cache | Cost | Flags |');
    lines.push('| ---: | :--- | ---: | ---: | ---: | ---: | ---: | :--- |');
    for (const c of r.recentCalls) {
      const safeModel = String(c.model || 'Unknown').replace(/\|/g, '\\|');
      lines.push(
        `| ${c.seq} | ${safeModel} | ${c.ttftSec !== null ? `${c.ttftSec.toFixed(2)}s` : '--'} | ${c.flags.includes('BUF') ? 'BUF' : c.genTps !== null ? `${c.genTps.toFixed(0)}` : '--'} | ${fmtCompactNum(c.outputTokens)} | ${c.cacheHitPct !== null ? `${c.cacheHitPct.toFixed(0)}%` : '--'} | ${fmtUsd(c.costUSD)} | ${c.flags.join(', ') || '—'} |`,
      );
    }
    lines.push('');
  }

  if (r.hints.length) {
    lines.push('## Diagnostic Notes');
    for (const h of r.hints) {
      lines.push(`- ${h}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Antigravity CLI `~/.gemini/antigravity-cli/settings.json` setup helpers
// ---------------------------------------------------------------------------

export function getDefaultCliSettingsPath(home = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'settings.json');
}

export function buildStatuslineCommand(options: {
  scriptPath: string;
  homeDir?: string;
  twoLine?: boolean;
  noColor?: boolean;
}): string {
  const absScript = resolve(options.scriptPath);
  const home = resolve(options.homeDir || homedir());
  let formattedPath = absScript;
  if (process.platform !== 'win32' && absScript.startsWith(`${home}/`)) {
    formattedPath = `~/${absScript.slice(home.length + 1)}`;
  }
  const needsQuotes = /\s/.test(formattedPath);
  const quotedPath = needsQuotes ? `"${formattedPath}"` : formattedPath;
  const flags: string[] = [];
  if (options.twoLine) flags.push('--two-line');
  if (options.noColor) flags.push('--no-color');
  return ['node', quotedPath, ...flags].join(' ');
}

function readSettingsJsonSafe(settingsPath: string): Record<string, any> {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, 'utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${settingsPath}`);
  }
  return parsed as Record<string, any>;
}

function writeSettingsJsonAtomically(settingsPath: string, obj: Record<string, any>): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(obj, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      /* ignore chmod errors on restricted FS */
    }
  }
  renameSync(tmpPath, settingsPath);
}

export function isAgyHudStatuslineCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  return /agy-hud/i.test(cmd) && /statusline\.ts/i.test(cmd);
}

export function inspectCliStatusline(options: {
  settingsPath?: string;
  homeDir?: string;
} = {}): {
  settingsPath: string;
  exists: boolean;
  configured: boolean;
  isAgyHud: boolean;
  enabled: boolean;
  command: string | null;
} {
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(options.homeDir));
  if (!existsSync(settingsPath)) {
    return { settingsPath, exists: false, configured: false, isAgyHud: false, enabled: false, command: null };
  }
  try {
    const obj = readSettingsJsonSafe(settingsPath);
    const sl = obj.statusLine;
    if (!sl || typeof sl !== 'object') {
      return { settingsPath, exists: true, configured: false, isAgyHud: false, enabled: false, command: null };
    }
    const cmd = typeof sl.command === 'string' ? sl.command : null;
    const enabled = sl.enabled !== false && Boolean(cmd);
    return {
      settingsPath,
      exists: true,
      configured: Boolean(cmd),
      isAgyHud: isAgyHudStatuslineCommand(cmd),
      enabled,
      command: cmd,
    };
  } catch {
    return { settingsPath, exists: true, configured: false, isAgyHud: false, enabled: false, command: null };
  }
}

export function configureCliStatusline(
  options: ConfigureStatuslineOptions,
): ConfigureStatuslineResult {
  const home = options.homeDir || homedir();
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(home));
  const command = buildStatuslineCommand({
    scriptPath: options.scriptPath,
    homeDir: home,
    twoLine: options.twoLine,
    noColor: options.noColor,
  });

  const existing = readSettingsJsonSafe(settingsPath);
  const prevCmd =
    existing.statusLine && typeof existing.statusLine === 'object' && typeof existing.statusLine.command === 'string'
      ? existing.statusLine.command
      : null;

  const nextStatusLine: Record<string, any> = {
    type: 'command',
    command,
    enabled: true,
  };
  if (options.stackWithDefault) {
    nextStatusLine.stack_with_default = true;
  }

  existing.statusLine = nextStatusLine;
  writeSettingsJsonAtomically(settingsPath, existing);

  return {
    ok: true,
    action: 'configured',
    settingsPath,
    command,
    previousCommand: prevCmd,
    message: `Configured Antigravity CLI statusLine in ${settingsPath} -> ${command}`,
  };
}

export function removeCliStatusline(options: {
  settingsPath?: string;
  homeDir?: string;
  force?: boolean;
} = {}): ConfigureStatuslineResult {
  const home = options.homeDir || homedir();
  const settingsPath = resolve(options.settingsPath || getDefaultCliSettingsPath(home));

  if (!existsSync(settingsPath)) {
    return {
      ok: true,
      action: 'noop',
      settingsPath,
      command: null,
      previousCommand: null,
      message: `No Antigravity CLI settings file found at ${settingsPath}; nothing to remove.`,
    };
  }

  const existing = readSettingsJsonSafe(settingsPath);
  const prevCmd =
    existing.statusLine && typeof existing.statusLine === 'object' && typeof existing.statusLine.command === 'string'
      ? existing.statusLine.command
      : null;

  if (!prevCmd) {
    return {
      ok: true,
      action: 'noop',
      settingsPath,
      command: null,
      previousCommand: null,
      message: `No custom statusLine configured in ${settingsPath}.`,
    };
  }

  if (!options.force && !isAgyHudStatuslineCommand(prevCmd)) {
    return {
      ok: false,
      action: 'blocked',
      settingsPath,
      command: prevCmd,
      previousCommand: prevCmd,
      message: `Existing statusLine is managed by another script (${prevCmd}). Re-run with --force to remove it.`,
    };
  }

  delete existing.statusLine;
  writeSettingsJsonAtomically(settingsPath, existing);

  return {
    ok: true,
    action: 'removed',
    settingsPath,
    command: null,
    previousCommand: prevCmd,
    message: `Removed AGY-HUD statusLine from ${settingsPath}.`,
  };
}
