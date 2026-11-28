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
import { basename, join, resolve } from 'node:path';

import {
  evalCacheSurvival,
  getCacheTtlPrior,
  solveTimeForSurvival,
} from './cache-ttl.ts';
import {
  inferAppDataSource,
  resolveAllAppDataDirs,
  resolveAppDataDir,
  statSafe,
  UUID_RE,
} from './constants.ts';
import { resolveModelPricing } from './pricing.ts';
import { resolveModelFamily } from './quota-solver.ts';
import { listConversations, readTelemetry } from './telemetry.ts';
import {
  computeHeadroomFromInvocations,
  fmtCompactNum,
  fmtDurationCompact,
  fmtUsd,
  paint,
  parseStatuslineStdin,
  resolveEffectiveContext,
  shortenModelLabel,
  stripAnsi,
  visibleLength,
  type CliQuotaBucket,
  type CliStatuslinePayload,
  type ConfigureStatuslineOptions,
  type ConfigureStatuslineResult,
  type FastDbSnapshot,
  type InspectCallRow,
  type InspectTelemetryOptions,
  type InspectTelemetryReport,
  type RenderStatuslineOptions,
} from './statusline/format.ts';

export {
  computeHeadroomFromInvocations,
  fmtCompactNum,
  fmtDurationCompact,
  fmtUsd,
  parseStatuslineStdin,
  shortenModelLabel,
  stripAnsi,
  visibleLength,
  type CliQuotaBucket,
  type CliStatuslinePayload,
  type ConfigureStatuslineOptions,
  type ConfigureStatuslineResult,
  type FastDbSnapshot,
  type InspectCallRow,
  type InspectTelemetryOptions,
  type InspectTelemetryReport,
  type RenderStatuslineOptions,
};
export { buildInspectReport, formatInspectMarkdown } from './statusline/inspect.ts';
export {
  buildStatuslineCommand,
  configureCliStatusline,
  getDefaultCliSettingsPath,
  inspectCliStatusline,
  isAgyHudStatuslineCommand,
  removeCliStatusline,
} from './statusline/settings.ts';

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
