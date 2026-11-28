/**
 * Session tree metrics, Swarm roster metadata, child active-state resolution,
 * and `buildSessionInfo` assembly for the conversation graph.
 */
import { UUID_RE } from '../constants.ts';
import { isCascadeStatusActive } from '../ls-client.ts';
import { buildSwarmOverview } from '../swarm.ts';
import type { SwarmMemberState } from '../swarm.ts';

export function getConversationSwarmMeta(
  convId: string,
  graph: any,
): { swarmRosterName: string; swarmState: SwarmMemberState } | null {
  const swarmIndex = graph?.swarmIndex;
  if (!swarmIndex || !convId) return null;
  const workerHit = swarmIndex.memberLookup?.get(convId);
  if (workerHit) {
    return {
      swarmRosterName: workerHit.rosterName,
      swarmState: workerHit.member.state,
    };
  }
  const coordSwarm = swarmIndex.swarmsByCoordinator?.get(convId);
  if (coordSwarm) {
    const coordMember = coordSwarm.members.get('coordinator') || coordSwarm.memberByConvId.get(convId);
    return {
      swarmRosterName: 'coordinator',
      swarmState: coordMember?.state || (coordSwarm.workingCount > 0 ? 'working' : 'waiting'),
    };
  }
  return null;
}

function collectDescendantSessions(rootId: string, graph: any) {
  const visited = new Set<string>([rootId]);
  const queue = [...(graph?.childrenByParent?.get(rootId) || [])];
  const descendants: any[] = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || !item.id || visited.has(item.id)) continue;
    visited.add(item.id);
    descendants.push(item);
    const sub = graph?.childrenByParent?.get(item.id);
    if (Array.isArray(sub) && sub.length > 0) {
      for (const ch of sub) {
        if (ch && ch.id && !visited.has(ch.id)) queue.push(ch);
      }
    }
  }
  return descendants;
}

function resolveRootAncestorId(startId: string, graph: any, fallbackParentId = ''): string {
  const visited = new Set<string>([startId]);
  let cur = startId;
  while (true) {
    const link = graph?.parentLinks?.get(cur);
    const workerLookup = graph?.swarmIndex?.memberLookup?.get(cur);
    const nextParent = link?.parentId
      || workerLookup?.coordinatorConvId
      || (cur === startId ? fallbackParentId : '');
    if (!nextParent || visited.has(nextParent)) break;
    visited.add(nextParent);
    cur = nextParent;
  }
  return cur;
}

function computeSessionTreeMetrics(rootId: string, graph: any) {
  const s = graph?.byId?.get(rootId);
  const descendants = collectDescendantSessions(rootId, graph);
  let childCalls = 0;
  let childOutputTokens = 0;
  let childCostUSD = 0;
  let childSavedUSD = 0;
  let childPricedCount = 0;
  let childUnpricedCount = 0;
  let swarmWorkerCount = 0;
  for (const d of descendants) {
    childCalls += d.calls || 0;
    childOutputTokens += d.outputTokens || 0;
    childCostUSD += d.costUSD || 0;
    childSavedUSD += d.savedUSD || 0;
    childPricedCount += d.pricedCount || 0;
    childUnpricedCount += d.unpricedCount || 0;
    if (d.swarm) swarmWorkerCount += 1;
  }

  const rootCalls = s?.calls || 0;
  const rootOutputTokens = s?.outputTokens || 0;
  const rootCostUSD = s?.costUSD || 0;
  const rootSavedUSD = s?.savedUSD || 0;
  const rootPricedCount = s?.pricedCount || 0;
  const rootUnpricedCount = s?.unpricedCount || 0;

  return {
    descendants,
    totals: {
      descendantCount: descendants.length,
      swarmWorkerCount,
      calls: rootCalls + childCalls,
      outputTokens: rootOutputTokens + childOutputTokens,
      costUSD: rootCostUSD + childCostUSD,
      savedUSD: rootSavedUSD + childSavedUSD,
      pricedCount: rootPricedCount + childPricedCount,
      unpricedCount: rootUnpricedCount + childUnpricedCount,
      childCalls,
      childOutputTokens,
      childCostUSD,
      childSavedUSD,
      childPricedCount,
      childUnpricedCount,
    },
  };
}

const CHILD_SQLITE_ACTIVE_MAX_AGE_MS = 300_000;

function resolveChildActiveState(
  child: any,
  sum: any,
  lsSummaries: Record<string, any> | null | undefined,
  nowMs: number,
): { isActive: boolean; activeKind: '' | 'gen' | 'compact' | 'tool' | 'running' } {
  const hasLsMap = Boolean(lsSummaries && typeof lsSummaries === 'object' && Object.keys(lsSummaries).length > 0);
  const lsSum = hasLsMap && child?.id && UUID_RE.test(child.id) ? lsSummaries![child.id] : null;

  if (child?.swarm) {
    const st = child.swarm.swarmState;
    if (st === 'killed' || st === 'stopped') {
      return { isActive: false, activeKind: '' };
    }
    if (lsSum) {
      const lsActive = isCascadeStatusActive(lsSum.status);
      if (lsActive) {
        return { isActive: true, activeKind: sum?.activeStepKind || 'running' };
      }
      if (st === 'working') {
        return { isActive: false, activeKind: '' };
      }
    }
    return st === 'working'
      ? { isActive: true, activeKind: sum?.activeStepKind || 'running' }
      : { isActive: false, activeKind: '' };
  }

  if (hasLsMap) {
    if (lsSum) {
      if (isCascadeStatusActive(lsSum.status)) {
        return { isActive: true, activeKind: sum?.activeStepKind || 'running' };
      }
      return { isActive: false, activeKind: '' };
    }
    // Desktop LS does not track separate CLI cascades; allow SQLite fallback only for CLI children.
    if (sum?.source !== 'cli') {
      return { isActive: false, activeKind: '' };
    }
  }

  const sqliteActive = Boolean(
    sum?.hasActiveStep
    && sum.activeStepStartMs > 0
    && nowMs - sum.activeStepStartMs < CHILD_SQLITE_ACTIVE_MAX_AGE_MS,
  );
  if (sqliteActive) {
    return { isActive: true, activeKind: sum.activeStepKind || 'running' };
  }
  return { isActive: false, activeKind: '' };
}

export function buildSessionInfo(
  targetId,
  graph,
  lsSummaries: Record<string, any> | null | undefined = null,
  nowMs = Date.now(),
) {
  const s = graph.byId.get(targetId);
  const link = graph.parentLinks.get(targetId);
  const swarmIndex = graph.swarmIndex;
  const coordSwarm = swarmIndex?.swarmsByCoordinator?.get(targetId) || null;
  const workerLookup = !coordSwarm ? (swarmIndex?.memberLookup?.get(targetId) || null) : null;

  const effectiveParentId = link?.parentId || workerLookup?.coordinatorConvId || '';
  const parentSum = effectiveParentId ? graph.byId.get(effectiveParentId) : null;
  const kind = link
    ? link.kind
    : (workerLookup ? 'subagent' : (s?.trajectoryType === 22 ? 'side_question' : 'main'));
  const title = graph.sqTitleOverrides.get(targetId)
    || s?.title
    || (coordSwarm?.swarmTitle || workerLookup?.member.meta.taskTitle || '');
  const rawChildren = graph.childrenByParent.get(targetId) || [];
  let activeChildCount = 0;
  const childSessions = rawChildren.map(({ key: _key, ...rest }) => {
    const childSum = graph.byId.get(rest.id);
    const activeState = resolveChildActiveState(rest, childSum, lsSummaries, nowMs);
    if (activeState.isActive) activeChildCount += 1;
    return {
      ...rest,
      isActive: activeState.isActive,
      ...(activeState.activeKind ? { activeKind: activeState.activeKind } : {}),
    };
  });

  // Recursive rollup across ALL Swarm workers + subagents + workflow children + Side-Q descendants (cycle-safe)
  const { descendants, totals: treeTotals } = computeSessionTreeMetrics(targetId, graph);

  // When viewing a child / Swarm worker session, also expose the top-most ancestor tree totals
  // so users never mistake a single worker's spend for the entire Swarm / parent task.
  const rootAncestorId = effectiveParentId ? resolveRootAncestorId(targetId, graph, effectiveParentId) : '';
  let rootTreeTotals: any = null;
  let rootTreeSig = '';
  if (rootAncestorId && rootAncestorId !== targetId) {
    const rootSum = graph.byId.get(rootAncestorId);
    const rootSwarm = swarmIndex?.swarmsByCoordinator?.get(rootAncestorId) || null;
    const { totals: rt } = computeSessionTreeMetrics(rootAncestorId, graph);
    rootTreeTotals = {
      rootId: rootAncestorId,
      rootTitle: graph.sqTitleOverrides.get(rootAncestorId)
        || rootSwarm?.swarmTitle
        || rootSum?.title
        || workerLookup?.swarm?.swarmTitle
        || '',
      isSwarm: Boolean(rootSwarm || workerLookup?.coordinatorConvId === rootAncestorId),
      descendantCount: rt.descendantCount,
      swarmWorkerCount: rt.swarmWorkerCount,
      calls: rt.calls,
      outputTokens: rt.outputTokens,
      costUSD: rt.costUSD,
      savedUSD: rt.savedUSD,
      pricedCount: rt.pricedCount,
      unpricedCount: rt.unpricedCount,
    };
    rootTreeSig = `rt:${rootAncestorId}:${rt.descendantCount}:${rt.calls}:${rt.costUSD.toFixed(4)}`;
  }

  const swarmOverview = coordSwarm
    ? buildSwarmOverview(coordSwarm, true)
    : (workerLookup ? buildSwarmOverview(workerLookup.swarm, false, workerLookup.member.meta) : null);
  const swarmSig = (coordSwarm || workerLookup?.swarm)?.sig || '';

  const parentSession = parentSum
    ? {
        id: parentSum.id,
        title: graph.sqTitleOverrides.get(parentSum.id) || parentSum.title || workerLookup?.swarm.swarmTitle || '',
        calls: parentSum.calls,
        outputTokens: parentSum.outputTokens,
        costUSD: parentSum.costUSD,
      }
    : (workerLookup
        ? {
            id: workerLookup.coordinatorConvId,
            title: workerLookup.swarm.swarmTitle || '',
            calls: 0,
            outputTokens: 0,
            costUSD: 0,
          }
        : null);

  const activeSigById = new Map(childSessions.map((c) => [c.id, `${c.isActive ? '1' : '0'}:${c.activeKind || ''}`]));
  const descendantKeys = descendants.map((c) => `${c.id}:${c.key}:${activeSigById.get(c.id) || ''}`).join(',');
  return {
    id: targetId,
    title,
    kind,
    subagentType: s?.subagentType || (workerLookup ? 'worker' : ''),
    parentSession,
    childSessions,
    activeChildCount,
    treeTotals,
    ...(rootTreeTotals ? { rootTreeTotals } : {}),
    ...(swarmOverview ? { swarm: swarmOverview } : {}),
    childKeys: rootTreeSig ? `${descendantKeys}|${rootTreeSig}` : descendantKeys,
    swarmSig,
  };
}
