/**
 * Account quota burn ledger aggregation, active pool window extraction, and
 * per-conversation / per-invocation quota usage decoration.
 */
import { localDayKey, resolveQuotaFitPath } from '../constants.ts';
import { poolKeyForGroupLabel, poolKeyForModel } from '../pricing.ts';
import {
  getPoolPriorFull5h,
  getPoolPriorGamma,
  hasTrustedPoolFit,
  loadQuotaFitStore,
  predictCallQuota,
  predictFamilyAggregateQuota,
  resolveActiveTierPrefix,
} from '../quota-fitter.ts';
import type { QuotaFitStore } from '../quota-fitter.ts';

export interface QuotaAttachOptions {
  fitPath?: string;
  nowMs?: number;
}

export interface ActivePoolWindowBounds {
  start5hMs: number | null;
  start7dMs: number | null;
}

export function buildAccountQuotaLedger({
  pools,
  fitStore,
  tierKey,
  poolCalKeyMap,
  nowMs,
}: {
  pools: any[];
  fitStore: QuotaFitStore | null | undefined;
  tierKey: string;
  poolCalKeyMap: WeakMap<object, string>;
  nowMs: number;
}) {
  const todayKey = localDayKey(nowMs);
  if (!todayKey || !fitStore?.pools) return null;
  const monthPrefix = todayKey.slice(0, 7);
  const weekStartKey = localDayKey(nowMs - 6 * 86_400_000) || todayKey;
  const resetCutoffMs = nowMs - 30 * 86_400_000;

  const emptyPeriod = () => ({
    usd: 0,
    pct5hSum: 0,
    pct7dSum: 0,
    resets: 0,
    reclaimedPct5h: 0,
    reclaimedPct7d: 0,
  });
  const today = emptyPeriod();
  const week7d = emptyPeriod();
  const month = emptyPeriod();
  const all = emptyPeriod();

  const allDays = new Set<string>();
  const poolRows: any[] = [];
  const recentResets: any[] = [];
  let hasProvisionalCap = false;

  for (const p of pools) {
    const calPoolKey = poolCalKeyMap.get(p) || '';
    if (!calPoolKey) continue;
    const ps = fitStore.pools[`${tierKey}|${calPoolKey}`];
    if (!ps) continue;

    const w5 = (p.windows || []).find((w) => w.spanKey === '5h');
    const w7 = (p.windows || []).find((w) => w.spanKey === '7d');
    const gamma = p.fitSummary?.gamma || ps.gamma || getPoolPriorGamma(calPoolKey) || 4;
    const full5h = p.fitSummary?.full5hUSD || w5?.estFullUSD || getPoolPriorFull5h(calPoolKey) || 0;
    const full7d = p.fitSummary?.full7dUSD || w7?.estFullUSD || (full5h > 0 && gamma > 0 ? full5h * gamma : 0);
    const estQuality: 'high' | 'provisional' = hasTrustedPoolFit(ps.fit, 2) && ps.fit?.quality === 'high' ? 'high' : 'provisional';

    const daily = ps.dailyBurn || {};
    const dayKeys = Object.keys(daily);
    const row = {
      poolKey: calPoolKey,
      label: p.label || calPoolKey,
      todayPct5h: 0,
      todayPct7d: 0,
      todayUsd: 0,
      weekPct7d: 0,
      weekUsd: 0,
      monthPct7d: 0,
      monthUsd: 0,
      allPct7d: 0,
      allUsd: 0,
      resets30d: 0,
      estQuality,
    };

    let poolHasBurn = false;
    for (const dk of dayKeys) {
      const entry = daily[dk];
      if (!entry) continue;
      const raw5 = entry.pct5h > 0 ? entry.pct5h : 0;
      const raw7 = entry.pct7d > 0 ? entry.pct7d : 0;
      const resets = entry.resets || 0;
      const rec5 = entry.reclaimedPct5h || 0;
      const rec7 = entry.reclaimedPct7d || 0;
      if (!(raw5 > 0) && !(raw7 > 0) && !(resets > 0)) continue;

      poolHasBurn = true;
      allDays.add(dk);

      const effPct7 = raw7 > 0 ? raw7 : (raw5 > 0 && gamma > 0 ? raw5 / gamma : 0);
      const effPct5 = raw5 > 0 ? raw5 : (raw7 > 0 && gamma > 0 ? raw7 * gamma : 0);
      const dayUsd = raw7 > 0 && full7d > 0
        ? (raw7 / 100) * full7d
        : (raw5 > 0 && full5h > 0 ? (raw5 / 100) * full5h : 0);

      const addTo = (bucket: ReturnType<typeof emptyPeriod>) => {
        bucket.usd += dayUsd;
        bucket.pct5hSum += effPct5;
        bucket.pct7dSum += effPct7;
        bucket.resets += resets;
        bucket.reclaimedPct5h += rec5;
        bucket.reclaimedPct7d += rec7;
      };

      addTo(all);
      row.allPct7d += effPct7;
      row.allUsd += dayUsd;
      if (dk === todayKey) {
        addTo(today);
        row.todayPct5h += effPct5;
        row.todayPct7d += effPct7;
        row.todayUsd += dayUsd;
      }
      if (dk >= weekStartKey && dk <= todayKey) {
        addTo(week7d);
        row.weekPct7d += effPct7;
        row.weekUsd += dayUsd;
      }
      if (dk.startsWith(monthPrefix)) {
        addTo(month);
        row.monthPct7d += effPct7;
        row.monthUsd += dayUsd;
      }
    }

    for (const ev of ps.resetEvents || []) {
      if (ev.ts >= resetCutoffMs) {
        row.resets30d++;
        recentResets.push({
          ts: ev.ts,
          poolKey: calPoolKey,
          poolLabel: p.label || calPoolKey,
          spanKey: ev.spanKey,
          kind: ev.kind,
          beforeUsedPct: ev.beforeUsedPct,
          afterUsedPct: ev.afterUsedPct,
          reclaimedPct: ev.reclaimedPct,
        });
      }
    }

    if (poolHasBurn || row.resets30d > 0) {
      if (estQuality !== 'high') hasProvisionalCap = true;
      poolRows.push(row);
    }
  }

  if (allDays.size === 0 && recentResets.length === 0) return null;
  recentResets.sort((a, b) => b.ts - a.ts);
  const sortedDays = [...allDays].sort();

  return {
    trackedDays: sortedDays.length,
    firstDay: sortedDays[0] || todayKey,
    hasProvisionalCap,
    today,
    week7d,
    month,
    all,
    pools: poolRows,
    recentResets: recentResets.slice(0, 8),
  };
}

export function extractActivePoolWindows(
  accountQuota: any,
  nowMs = Date.now(),
  fitStore: QuotaFitStore | null = null,
  tierPrefix = 'default|',
): Record<string, ActivePoolWindowBounds> | null {
  const out: Record<string, ActivePoolWindowBounds> = Object.create(null);
  let any = false;
  if (accountQuota?.available && Array.isArray(accountQuota.pools)) {
    for (const p of accountQuota.pools) {
      const pk = poolKeyForGroupLabel(p.label);
      if (pk !== 'gemini' && pk !== 'claude_gpt') continue;
      const w5 = (p.windows || []).find((w) => w.spanKey === '5h' && w.resetAtMs > nowMs);
      const w7 = (p.windows || []).find((w) => w.spanKey === '7d' && w.resetAtMs > nowMs);
      if (w5 || w7) {
        out[pk] = {
          start5hMs: w5 ? w5.resetAtMs - 5 * 3_600_000 : null,
          start7dMs: w7 ? w7.resetAtMs - 7 * 24 * 3_600_000 : null,
        };
        any = true;
      }
    }
  }
  if (!any && fitStore?.pools) {
    for (const pk of ['gemini', 'claude_gpt']) {
      const snap = fitStore.pools[`${tierPrefix}${pk}`]?.lastSnap;
      if (!snap) continue;
      const w5Ok = snap.w5ResetAtMs > nowMs;
      const w7Ok = snap.w7ResetAtMs > nowMs;
      if (w5Ok || w7Ok) {
        out[pk] = {
          start5hMs: w5Ok ? snap.w5ResetAtMs - 5 * 3_600_000 : null,
          start7dMs: w7Ok ? snap.w7ResetAtMs - 7 * 24 * 3_600_000 : null,
        };
        any = true;
      }
    }
  }
  return any ? out : null;
}

function createPoolQuotaAccumulator(activePoolWindows, pk) {
  return {
    pct5h: 0,
    fittedPct5h: 0,
    pct7d: 0,
    has7d: false,
    active5hPct: activePoolWindows?.[pk]?.start5hMs ? 0 : null,
    active7dPct: activePoolWindows?.[pk]?.start7dMs ? 0 : null,
  };
}

function finalizePoolQuotaMap(acc) {
  const out = {};
  let hasAny = false;
  for (const pk of ['gemini', 'claude_gpt']) {
    if (acc[pk] && acc[pk].pct5h > 0) {
      out[pk] = {
        pct5h: acc[pk].pct5h,
        pct7d: acc[pk].has7d ? acc[pk].pct7d : null,
        active5hPct: acc[pk].active5hPct,
        active7dPct: acc[pk].active7dPct,
        isFitted: acc[pk].fittedPct5h / acc[pk].pct5h >= 0.75,
      };
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

export function computeSummaryQuotaUsage(
  summary: any,
  fitStore: QuotaFitStore | null,
  tierPrefix = 'default|',
  activePoolWindows: Record<string, ActivePoolWindowBounds> | null = null,
) {
  if (!summary) return null;
  const acc: Record<string, any> = Object.create(null);
  const ensurePool = (pk: string) => {
    if (!acc[pk]) acc[pk] = createPoolQuotaAccumulator(activePoolWindows, pk);
    return acc[pk];
  };

  const addPred = (pred: any) => {
    if (!pred || !(pred.quotaPct5h > 0)) return;
    const b = ensurePool(pred.quotaPool);
    b.pct5h += pred.quotaPct5h;
    if (pred.quotaFitSource === 'fitted') b.fittedPct5h += pred.quotaPct5h;
    if (pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
      b.pct7d += pred.quotaPct7d;
      b.has7d = true;
    }
  };

  const famEntries = summary.familyUsage ? (Object.entries(summary.familyUsage) as [string, any][]) : [];
  if (famEntries.length > 0) {
    for (const [family, fu] of famEntries) {
      addPred(predictFamilyAggregateQuota(
        {
          poolKey: fu.poolKey,
          family,
          baseUSD: fu.baseUSD,
          inM: fu.inM || 0,
          caM: fu.caM || 0,
          outM: fu.outM || 0,
        },
        fitStore,
        tierPrefix,
      ));
    }
  } else if (Array.isArray(summary.recentCalls) && summary.recentCalls.length > 0) {
    for (const c of summary.recentCalls) {
      addPred(predictFamilyAggregateQuota(
        {
          poolKey: c.poolKey,
          family: c.family || '',
          baseUSD: c.baseUSD || 0,
          inM: (c.newInput || 0) / 1e6,
          caM: (c.cachedInput || 0) / 1e6,
          outM: (c.outputTokens || 0) / 1e6,
        },
        fitStore,
        tierPrefix,
      ));
    }
  }

  if (activePoolWindows && Array.isArray(summary.recentCalls)) {
    for (const c of summary.recentCalls) {
      const win = activePoolWindows[c.poolKey];
      if (!win) continue;
      const in5h = Boolean(win.start5hMs && c.ts >= win.start5hMs);
      const in7d = Boolean(win.start7dMs && c.ts >= win.start7dMs);
      if (!in5h && !in7d) continue;
      const pred = predictFamilyAggregateQuota(
        {
          poolKey: c.poolKey,
          family: c.family || '',
          baseUSD: c.baseUSD || 0,
          inM: (c.newInput || 0) / 1e6,
          caM: (c.cachedInput || 0) / 1e6,
          outM: (c.outputTokens || 0) / 1e6,
        },
        fitStore,
        tierPrefix,
      );
      if (!pred || !acc[pred.quotaPool]) continue;
      if (in5h && pred.quotaPct5h > 0) {
        acc[pred.quotaPool].active5hPct = (acc[pred.quotaPool].active5hPct || 0) + pred.quotaPct5h;
      }
      if (in7d && pred.quotaPct7d !== null && pred.quotaPct7d > 0) {
        acc[pred.quotaPool].active7dPct = (acc[pred.quotaPool].active7dPct || 0) + pred.quotaPct7d;
      }
    }
  }

  return finalizePoolQuotaMap(acc);
}

export function attachGraphQuotaSummaries({
  conversations = [],
  sessionInfo = null,
  graph = null,
  accountQuota = null,
  opts = {},
}: {
  conversations?: any[];
  sessionInfo?: any;
  graph?: any;
  accountQuota?: any;
  opts?: QuotaAttachOptions;
}) {
  const fitPath = opts.fitPath ?? resolveQuotaFitPath();
  const nowMs = opts.nowMs || Date.now();
  const fitStore = loadQuotaFitStore(fitPath);
  const tierPrefix = resolveActiveTierPrefix(accountQuota, fitStore);
  const activeWins = extractActivePoolWindows(accountQuota, nowMs, fitStore, tierPrefix);

  const lookup = (id) => {
    const s = graph?.byId?.get(id);
    return s ? computeSummaryQuotaUsage(s, fitStore, tierPrefix, activeWins) : null;
  };

  const mergeQuotaUsages = (items: any[]) => {
    const merged: Record<string, any> = Object.create(null);
    let hasAny = false;
    for (const q of items) {
      if (!q || typeof q !== 'object') continue;
      for (const pk of ['gemini', 'claude_gpt']) {
        const entry = q[pk];
        if (!entry || !(entry.pct5h > 0)) continue;
        if (!merged[pk]) {
          merged[pk] = {
            pct5h: 0,
            fittedPct5h: 0,
            pct7d: 0,
            has7d: false,
            active5hPct: null as number | null,
            active7dPct: null as number | null,
          };
        }
        merged[pk].pct5h += entry.pct5h;
        if (entry.isFitted) merged[pk].fittedPct5h += entry.pct5h;
        if (entry.pct7d !== null && entry.pct7d !== undefined && entry.pct7d > 0) {
          merged[pk].pct7d += entry.pct7d;
          merged[pk].has7d = true;
        }
        if (entry.active5hPct !== null && entry.active5hPct !== undefined) {
          merged[pk].active5hPct = (merged[pk].active5hPct || 0) + entry.active5hPct;
        }
        if (entry.active7dPct !== null && entry.active7dPct !== undefined) {
          merged[pk].active7dPct = (merged[pk].active7dPct || 0) + entry.active7dPct;
        }
        hasAny = true;
      }
    }
    return hasAny ? finalizePoolQuotaMap(merged) : null;
  };

  const computeTreeQuota = (rootId: string) => {
    const selfQ = lookup(rootId);
    const directChildren = graph?.childrenByParent?.get(rootId);
    if (!Array.isArray(directChildren) || directChildren.length === 0) {
      return { selfQ, childQ: null, treeQ: selfQ, hasDescendants: false };
    }
    const visited = new Set<string>([rootId]);
    const queue = [...directChildren];
    const childParts: any[] = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || !item.id || visited.has(item.id)) continue;
      visited.add(item.id);
      childParts.push(lookup(item.id));
      const sub = graph?.childrenByParent?.get(item.id);
      if (Array.isArray(sub)) {
        for (const ch of sub) {
          if (ch && ch.id && !visited.has(ch.id)) queue.push(ch);
        }
      }
    }
    const childQ = mergeQuotaUsages(childParts);
    const treeQ = mergeQuotaUsages([selfQ, ...childParts]);
    return { selfQ, childQ, treeQ, hasDescendants: visited.size > 1 };
  };

  const nextConversations = conversations.map((c) => {
    const { treeQ } = computeTreeQuota(c.id);
    return treeQ ? { ...c, quotaUsage: treeQ } : c;
  });

  let nextSessionInfo = sessionInfo;
  if (sessionInfo) {
    const { selfQ, childQ, treeQ, hasDescendants } = computeTreeQuota(sessionInfo.id);
    const nextParent = sessionInfo.parentSession
      ? (() => {
          const pq = lookup(sessionInfo.parentSession.id);
          return pq ? { ...sessionInfo.parentSession, quotaUsage: pq } : sessionInfo.parentSession;
        })()
      : null;
    const nextChildren = Array.isArray(sessionInfo.childSessions)
      ? sessionInfo.childSessions.map((ch) => {
          const cq = lookup(ch.id);
          return cq ? { ...ch, quotaUsage: cq } : ch;
        })
      : sessionInfo.childSessions;

    // Collect recursive descendant quota usages (Swarm workers + multi-level subagents + Side-Q)
    let nextTreeTotals = sessionInfo.treeTotals;
    if (nextTreeTotals && (nextTreeTotals.descendantCount > 0 || hasDescendants)) {
      nextTreeTotals = {
        ...nextTreeTotals,
        ...(treeQ ? { quotaUsage: treeQ } : {}),
        ...(childQ ? { childQuotaUsage: childQ } : {}),
      };
    } else if (nextTreeTotals && selfQ) {
      nextTreeTotals = { ...nextTreeTotals, quotaUsage: selfQ };
    }

    let nextRootTreeTotals = sessionInfo.rootTreeTotals;
    if (nextRootTreeTotals?.rootId) {
      const { treeQ: rootTreeQ } = computeTreeQuota(nextRootTreeTotals.rootId);
      if (rootTreeQ) {
        nextRootTreeTotals = { ...nextRootTreeTotals, quotaUsage: rootTreeQ };
      }
    }

    nextSessionInfo = {
      ...sessionInfo,
      ...(selfQ ? { quotaUsage: selfQ } : {}),
      ...(nextTreeTotals ? { treeTotals: nextTreeTotals } : {}),
      ...(nextRootTreeTotals ? { rootTreeTotals: nextRootTreeTotals } : {}),
      parentSession: nextParent,
      childSessions: nextChildren,
    };
  }

  return { conversations: nextConversations, sessionInfo: nextSessionInfo };
}

export function attachTelemetryQuotaPredictions(telemetry: any, accountQuota: any, opts: QuotaAttachOptions = {}) {
  if (!telemetry) return telemetry;
  const fitPath = opts.fitPath ?? resolveQuotaFitPath();
  const nowMs = opts.nowMs || Date.now();
  const fitStore = loadQuotaFitStore(fitPath);
  const tierPrefix = resolveActiveTierPrefix(accountQuota, fitStore);
  const activeWins = extractActivePoolWindows(accountQuota, nowMs, fitStore, tierPrefix);

  const decorate = (item) => {
    if (!item) return item;
    const pred = predictCallQuota(item, fitStore, tierPrefix);
    return pred ? { ...item, ...pred } : item;
  };

  const invocations = Array.isArray(telemetry.invocations) ? telemetry.invocations.map(decorate) : telemetry.invocations;
  const compactions = Array.isArray(telemetry.compactions) ? telemetry.compactions.map(decorate) : telemetry.compactions;

  const turnAgg = new Map();
  const poolAcc = Object.create(null);

  const recordItem = (item) => {
    if (!item || !(item.quotaPct5h > 0)) return;
    const pk = item.quotaPool || poolKeyForModel(item.modelId, item.modelDisplay, item.model);
    if (pk === 'gemini' || pk === 'claude_gpt') {
      if (!poolAcc[pk]) poolAcc[pk] = createPoolQuotaAccumulator(activeWins, pk);
      const b = poolAcc[pk];
      b.pct5h += item.quotaPct5h;
      if (item.quotaFitSource === 'fitted') b.fittedPct5h += item.quotaPct5h;
      if (item.quotaPct7d !== null && item.quotaPct7d !== undefined && item.quotaPct7d > 0) {
        b.pct7d += item.quotaPct7d;
        b.has7d = true;
      }
      const start5h = activeWins?.[pk]?.start5hMs;
      if (start5h && item.timestampMs >= start5h) {
        b.active5hPct = (b.active5hPct || 0) + item.quotaPct5h;
      }
      const start7d = activeWins?.[pk]?.start7dMs;
      if (start7d && item.timestampMs >= start7d && item.quotaPct7d > 0) {
        b.active7dPct = (b.active7dPct || 0) + item.quotaPct7d;
      }
    }

    if (item.turnIndex) {
      let ta = turnAgg.get(item.turnIndex);
      if (!ta) {
        ta = { pct5hByPool: Object.create(null), pct7dByPool: Object.create(null), fitted5h: 0, total5h: 0 };
        turnAgg.set(item.turnIndex, ta);
      }
      const key = pk === 'claude_gpt' ? 'claude_gpt' : 'gemini';
      ta.pct5hByPool[key] = (ta.pct5hByPool[key] || 0) + item.quotaPct5h;
      ta.total5h += item.quotaPct5h;
      if (item.quotaFitSource === 'fitted') ta.fitted5h += item.quotaPct5h;
      if (item.quotaPct7d > 0) {
        ta.pct7dByPool[key] = (ta.pct7dByPool[key] || 0) + item.quotaPct7d;
      }
    }
  };

  if (Array.isArray(invocations)) invocations.forEach(recordItem);
  if (Array.isArray(compactions)) compactions.forEach(recordItem);

  const turns = Array.isArray(telemetry.turns)
    ? telemetry.turns.map((u) => {
        const ta = turnAgg.get(u.turnIndex);
        if (!ta || !(ta.total5h > 0)) return u;
        const g5 = ta.pct5hByPool.gemini || 0;
        const c5 = ta.pct5hByPool.claude_gpt || 0;
        const domPool = c5 > g5 ? 'claude_gpt' : 'gemini';
        return {
          ...u,
          quotaPool: domPool,
          quotaPct5h: g5 + c5,
          quotaPct7d: (ta.pct7dByPool.gemini || 0) + (ta.pct7dByPool.claude_gpt || 0) || null,
          quotaFitSource: ta.fitted5h / ta.total5h >= 0.75 ? 'fitted' : 'prior',
        };
      })
    : telemetry.turns;

  const sessionQuota = finalizePoolQuotaMap(poolAcc);
  const summary = telemetry.summary && sessionQuota
    ? { ...telemetry.summary, sessionQuota }
    : telemetry.summary;

  return {
    ...telemetry,
    ...(summary ? { summary } : {}),
    ...(turns ? { turns } : {}),
    invocations,
    latest: decorate(telemetry.latest),
    latestSustained: decorate(telemetry.latestSustained),
    compactions,
  };
}
