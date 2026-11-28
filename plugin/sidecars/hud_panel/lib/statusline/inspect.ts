/**
 * Full read-only telemetry inspector (`--inspect`, `--json`) and Markdown formatter
 * for humans and the bundled `/agy-hud` skill.
 */
import { join, resolve } from 'node:path';

import {
  evalCacheSurvival,
  buildCacheTtlOverview,
} from '../cache-ttl.ts';
import {
  inferAppDataSource,
  resolveAllAppDataDirs,
  resolveAppDataDir,
  resolveQuotaCalibrationPath,
  resolveQuotaFitPath,
  UUID_RE,
} from '../constants.ts';
import {
  buildAccountHistory,
  buildSessionInfo,
  getConversationGraph,
  pickTargetConversation,
} from '../graph.ts';
import { getUserStatusCached } from '../ls-client.ts';
import {
  attachGraphQuotaSummaries,
  attachQuotaBudgetEstimates,
  attachTelemetryQuotaPredictions,
} from '../quota-budget.ts';
import { listConversations, readTelemetry } from '../telemetry.ts';
import {
  computeHeadroomFromInvocations,
  fmtCompactNum,
  fmtDurationCompact,
  fmtUsd,
  getInvocationContextTokens,
  percentile,
  resolveEffectiveContext,
  type InspectCallRow,
  type InspectTelemetryOptions,
  type InspectTelemetryReport,
} from './format.ts';

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
