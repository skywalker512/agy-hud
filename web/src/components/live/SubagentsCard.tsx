import { memo } from 'preact/compat';
import { useMemo, useState } from 'preact/hooks';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import { getSwarmStrings, type SwarmStrings } from '../../i18n/swarm';
import type {
  ChildSessionItem,
  Lang,
  PoolQuotaUsageItem,
  SessionInfo,
  SessionQuotaUsage,
  SwarmMemberState,
  TelemetrySummary,
} from '../../types/telemetry';
import {
  fmtCachePct,
  fmtClock,
  fmtNum,
  fmtUsd,
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  kindBadgeClass,
  kindBadgeText,
} from '../../utils/format';
import { IconArrowRight, IconChevronDown, IconChevronRight, IconX } from '../common/Icons';

export interface SubagentsCardProps {
  found: boolean;
  children: ChildSessionItem[];
  sessionInfo?: SessionInfo | null;
  summary?: TelemetrySummary | null;
  lang?: Lang;
  t: Translations;
  onJumpConversation: (convId: string) => void;
}

const REAL_UUID_RE = /^[0-9a-f-]{8,}$/i;
const INFRA_ROLE_RE = /^(?:monitor|narrator)(?:-|$)/i;
const SWARM_GROUP_MODE_KEY = 'agy-hud:swarm-group-mode';

function readPersistedGroupMode(): 'flat' | 'thread' {
  try {
    return localStorage.getItem(SWARM_GROUP_MODE_KEY) === 'thread' ? 'thread' : 'flat';
  } catch {
    return 'flat';
  }
}

function isInfraRoster(rosterName: string | undefined): boolean {
  return Boolean(rosterName && INFRA_ROLE_RE.test(rosterName.trim()));
}

function parseTimeMs(raw: string | undefined): number {
  if (!raw) return 0;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const isoLike = Date.parse(raw.replace(' ', 'T'));
  return Number.isFinite(isoLike) ? isoLike : 0;
}

function mergePoolItems(items: Array<PoolQuotaUsageItem | undefined>): PoolQuotaUsageItem | undefined {
  let pct5h = 0;
  let pct7d = 0;
  let has7d = false;
  let active5h = 0;
  let hasActive5h = false;
  let active7d = 0;
  let hasActive7d = false;
  let fittedWeight = 0;

  for (const p of items) {
    if (!p || !(p.pct5h > 0)) continue;
    pct5h += p.pct5h;
    if (p.isFitted !== false) fittedWeight += p.pct5h;
    if (typeof p.pct7d === 'number' && p.pct7d > 0) {
      pct7d += p.pct7d;
      has7d = true;
    }
    if (typeof p.active5hPct === 'number') {
      active5h += p.active5hPct;
      hasActive5h = true;
    }
    if (typeof p.active7dPct === 'number') {
      active7d += p.active7dPct;
      hasActive7d = true;
    }
  }

  if (!(pct5h > 0)) return undefined;
  return {
    pct5h,
    pct7d: has7d ? pct7d : null,
    ...(hasActive5h ? { active5hPct: active5h } : {}),
    ...(hasActive7d ? { active7dPct: active7d } : {}),
    isFitted: fittedWeight / pct5h >= 0.75,
  };
}

function mergeSessionQuotas(sources: Array<SessionQuotaUsage | null | undefined>): SessionQuotaUsage | null {
  const gemini = mergePoolItems(sources.map((s) => s?.gemini));
  const claudeGpt = mergePoolItems(sources.map((s) => s?.claude_gpt));
  if (!gemini && !claudeGpt) return null;
  return {
    ...(gemini ? { gemini } : {}),
    ...(claudeGpt ? { claude_gpt: claudeGpt } : {}),
  };
}

function memberActivityMs(c: ChildSessionItem): number {
  return Math.max(c.latestTsMs || 0, c.updatedMs || 0, parseTimeMs(c.swarm?.lastPostTime));
}

function StateIndicator({ state }: { state: SwarmMemberState }) {
  if (state === 'working') {
    return <span className="swarm-dot-working w-[7px] h-[7px] rounded-full shrink-0" aria-hidden="true" />;
  }
  if (state === 'waiting') {
    return (
      <span
        className="w-[7px] h-[7px] rounded-full border-[1.5px] border-hud-muted shrink-0 opacity-75"
        aria-hidden="true"
      />
    );
  }
  if (state === 'stopped') {
    return <span className="w-[6px] h-[6px] rounded-[1.5px] bg-hud-warn shrink-0" aria-hidden="true" />;
  }
  return <IconX size={10} className="text-hud-muted" />;
}

function buildMemberTooltip(
  c: ChildSessionItem,
  boardSeq: number,
  sw: SwarmStrings,
  t: Translations,
): string | undefined {
  const m = c.swarm;
  const lines: string[] = [];
  if (m) {
    const headerParts = [
      `@${m.rosterName}`,
      sw.stateLabel(m.swarmState),
      m.model || '',
      m.workspaceMode || '',
    ].filter(Boolean);
    lines.push(headerParts.join(' · '));
    if (m.threadTitle) lines.push(sw.memberTipThread(m.threadTitle));
    if (m.taskTitle) lines.push(sw.memberTipTask(m.taskTitle));
    const boardLine = sw.memberTipBoard(m.lastReadSeq, boardSeq, m.lastPostSeq, m.lastPostTime);
    if (boardLine) lines.push(boardLine);
    if (m.lastPostSnippet) lines.push(sw.memberTipLatest(m.lastPostSnippet));
  }
  const qStr = c.quotaUsage ? formatSessionQuotaCompact(c.quotaUsage) : '';
  const qTip = c.quotaUsage && qStr ? formatSessionQuotaTip(c.quotaUsage, t) : '';
  if (qTip) {
    if (lines.length > 0) lines.push('');
    lines.push(qTip);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

interface MemberRowProps {
  item: ChildSessionItem;
  boardSeq: number;
  sw: SwarmStrings;
  t: Translations;
  onJumpConversation: (convId: string) => void;
}

function SwarmMemberRow({ item: c, boardSeq, sw, t, onJumpConversation }: MemberRowProps) {
  const m = c.swarm;
  const isRealConv = REAL_UUID_RE.test(c.id);
  const rawState: SwarmMemberState = m?.swarmState || 'waiting';
  const state: SwarmMemberState =
    rawState === 'working' && c.isActive === false
      ? 'waiting'
      : rawState === 'waiting' && c.isActive === true
        ? 'working'
        : rawState;
  const isKilled = state === 'killed';
  const costStr = c.pricedCount > 0 ? fmtUsd(c.costUSD) : '';
  const qStr = c.quotaUsage ? formatSessionQuotaCompact(c.quotaUsage, true) : '';
  const actMs = memberActivityMs(c);
  const clockStr = actMs > 0 ? fmtClock(actMs) : '';
  const tip = buildMemberTooltip(c, boardSeq, sw, t);

  if (!m) {
    const isRunning = Boolean(c.isActive);
    const badge = kindBadgeText(c.kind, t);
    const cls = isRunning ? kindBadgeClass(c.kind) : 'kind-main';
    const lbl = c.title || sw.subagentRoleFallback(c.subagentType, c.id.slice(0, 8));
    const fullMeta = t.linkedMeta(c.calls || 0, fmtNum(c.outputTokens || 0), costStr, qStr);
    const statusLabel = isRunning ? t.childRunningBadge(c.activeKind) : t.childFinishedBadge;
    const isSide = c.kind === 'side_question';
    const hasSideCold = isSide && (
      (typeof c.firstOwnCacheHitPct === 'number' && c.firstOwnCacheHitPct < 50)
      || (typeof c.sideColdCostUSD === 'number' && c.sideColdCostUSD >= 0.005)
    );
    const coldCostStr = c.sideColdCostUSD && c.sideColdCostUSD >= 0.005 ? fmtUsd(c.sideColdCostUSD) : '';
    const firstHitStr = fmtCachePct(c.firstOwnCacheHitPct ?? null);
    const sideTipLine = isSide && (c.ownCacheHitPct != null || c.inheritedCalls)
      ? t.sideChildTipLine(
          fmtCachePct(c.ownCacheHitPct ?? null),
          firstHitStr,
          coldCostStr,
          c.inheritedCalls || 0,
        )
      : '';
    const rowTip = [`${lbl} · ${statusLabel}`, sideTipLine, tip].filter(Boolean).join('\n\n');
    return (
      <button
        type="button"
        onClick={() => onJumpConversation(c.id)}
        data-tip={rowTip}
        className="swarm-member-card w-full text-left px-2.5 py-2 text-inherit cursor-pointer flex flex-col gap-1"
        style={
          isRunning
            ? { background: 'color-mix(in srgb, var(--hud-ok) 5%, transparent)' }
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {isRunning ? (
              <span className="swarm-dot-working w-[7px] h-[7px] rounded-full shrink-0" aria-hidden="true" />
            ) : (
              <span className="w-[6px] h-[6px] rounded-full bg-hud-muted/45 shrink-0" aria-hidden="true" />
            )}
            <span className={`rel-kind-pill ${cls}`}>{badge}</span>
            {isRunning && (
              <span className="px-1.5 py-[0.5px] rounded-full font-hud text-[9px] font-semibold text-hud-ok bg-tint-ok shrink-0">
                {statusLabel}
              </span>
            )}
            {c.subagentType && c.subagentType !== 'worker' && (
              <span className="px-1.5 py-[0.5px] rounded bg-hud-card font-hud-mono text-[9.5px] text-hud-muted shrink-0">
                {c.subagentType}
              </span>
            )}
            <span
              className={`text-[11.5px] truncate ${
                isRunning ? 'font-semibold text-hud-fg' : 'font-medium text-hud-fg-2'
              }`}
            >
              {lbl}
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-0.5 font-hud text-[10.5px] font-medium shrink-0 ${
              isRunning ? 'text-hud-accent-ink' : 'text-hud-muted'
            }`}
          >
            <span>{t.jumpAction}</span>
            <IconArrowRight size={11} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 font-hud-mono text-[10px] text-hud-muted tabular-nums pl-[13px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{fullMeta}</span>
            {hasSideCold && (
              <span className="px-1 py-[0.5px] rounded font-hud-mono text-[9px] font-semibold text-hud-warn bg-tint-warn shrink-0 whitespace-nowrap">
                {t.sideChildColdBadge(firstHitStr, coldCostStr)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 text-hud-faint">
            {!isRunning && <span className="font-hud text-[9.5px] text-hud-muted/80">{t.childFinishedBadge}</span>}
            {clockStr && <span>{clockStr}</span>}
          </div>
        </div>
      </button>
    );
  }

  const showWorkspacePill = m.workspaceMode === 'share' || m.workspaceMode === 'branch';
  const taskLine = m.taskTitle || (c.title && c.title !== `@${m.rosterName}` ? c.title : '');
  const metricsText =
    c.calls > 0 ? sw.memberMeta(c.calls, fmtNum(c.outputTokens || 0), costStr) : sw.memberCallsZero;

  return (
    <button
      type="button"
      aria-disabled={!isRealConv}
      onClick={() => {
        if (isRealConv) onJumpConversation(c.id);
      }}
      data-tip={tip}
      className={`swarm-member-card w-full text-left px-2.5 py-2 text-inherit flex flex-col gap-1 ${
        isRealConv ? 'cursor-pointer' : 'cursor-default opacity-80'
      } ${isKilled ? 'opacity-55' : ''}`}
      style={
        state === 'working'
          ? { background: 'color-mix(in srgb, var(--hud-ok) 5%, transparent)' }
          : undefined
      }
    >
      {/* Row 1: State dot + @rosterName + workspace + model + Jump */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
          <StateIndicator state={state} />
          <span className="sr-only">{sw.stateLabel(state)}</span>
          <span
            className={`font-hud-mono text-[11.5px] font-semibold tracking-[-0.01em] truncate ${
              isKilled ? 'text-hud-muted line-through' : 'text-hud-fg'
            }`}
          >
            @{m.rosterName}
          </span>
          {showWorkspacePill && m.workspaceMode && (
            <span
              className={`px-1.5 py-[0.5px] rounded font-hud-mono text-[9px] font-semibold leading-[1.35] shrink-0 border ${
                m.workspaceMode === 'share' ? 'swarm-pill-share' : 'swarm-pill-branch'
              }`}
            >
              {sw.workspaceLabel(m.workspaceMode)}
            </span>
          )}
          {m.model && (
            <span className="px-1.5 py-[0.5px] rounded bg-hud-card font-hud-mono text-[9.5px] text-hud-muted truncate max-w-[136px]">
              {m.model}
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-0.5 font-hud text-[10.5px] font-medium shrink-0 ${
            isRealConv ? 'text-hud-accent-ink' : 'text-hud-muted'
          }`}
        >
          <span>{isRealConv ? t.jumpAction : sw.pendingConv}</span>
          {isRealConv && <IconArrowRight size={11} />}
        </span>
      </div>

      {/* Row 2: Clamped taskTitle */}
      {taskLine && (
        <div className="text-[11px] font-hud leading-[1.4] text-hud-fg-2 line-clamp-2 break-words pl-[13px]">
          {taskLine}
        </div>
      )}

      {/* Row 3: Aligned tabular metrics + quota + last post #seq / clock */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums pl-[13px]">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
          <span>{metricsText}</span>
          {qStr && <span className="text-hud-accent-ink font-semibold">{qStr}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-hud-faint">
          {m.lastPostSeq !== undefined && m.lastPostSeq > 0 && (
            <span className="text-hud-muted">{sw.lastPostTag(m.lastPostSeq)}</span>
          )}
          {clockStr && <span>{clockStr}</span>}
        </div>
      </div>
    </button>
  );
}

function SubagentsCardImpl({
  found,
  children,
  sessionInfo,
  summary,
  lang = 'en',
  t,
  onJumpConversation,
}: SubagentsCardProps) {
  const [cardOpen, toggleCardOpen] = usePersistedOpen('subagents', true);
  const [groupMode, setGroupModeState] = useState<'flat' | 'thread'>(() => readPersistedGroupMode());
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(() => new Set());

  const setGroupMode = (next: 'flat' | 'thread') => {
    setGroupModeState(next);
    try {
      localStorage.setItem(SWARM_GROUP_MODE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const sw = getSwarmStrings(lang);
  const swarm = sessionInfo?.swarm || null;
  const isSwarmCockpit = Boolean(swarm?.isCoordinatorView);

  // 100% stable, non-jumping sort order:
  // 1) Regular workers (in deterministic plan/thread order, then alphabetical rosterName)
  // 2) Infrastructure roles (monitor / narrator) pinned below regular workers
  // 3) Killed members pinned last
  // Never sorts by working/waiting or live updatedMs so rows never jump under the cursor.
  const sortedChildren = useMemo(() => {
    const planOrder = new Map<string, number>();
    let orderIdx = 0;
    for (const th of swarm?.threads || []) {
      for (const memberName of th.members || []) {
        const key = String(memberName).toLowerCase();
        if (!planOrder.has(key)) {
          planOrder.set(key, orderIdx++);
        }
      }
    }

    const bucketRank = (c: ChildSessionItem): number => {
      const st = c.swarm?.swarmState;
      if (st === 'killed') return 2;
      if (isInfraRoster(c.swarm?.rosterName)) return 1;
      return 0;
    };

    return [...children].sort((a, b) => {
      const bA = bucketRank(a);
      const bB = bucketRank(b);
      if (bA !== bB) return bA - bB;

      const nameA = String(a.swarm?.rosterName || a.title || a.id).toLowerCase();
      const nameB = String(b.swarm?.rosterName || b.title || b.id).toLowerCase();
      const idxA = planOrder.has(nameA) ? planOrder.get(nameA)! : Number.MAX_SAFE_INTEGER;
      const idxB = planOrder.has(nameB) ? planOrder.get(nameB)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;

      const cmp = nameA.localeCompare(nameB);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });
  }, [children, swarm?.threads]);

  const canGroupByThread = Boolean(
    isSwarmCockpit && swarm && (swarm.threads?.length || 0) >= 2 && sortedChildren.length >= 3,
  );
  const effectiveGroupMode = canGroupByThread ? groupMode : 'flat';

  const threadGroups = useMemo(() => {
    if (effectiveGroupMode !== 'thread' || !swarm?.threads?.length) return null;
    const assigned = new Set<string>();
    const groups: Array<{ id: string; title: string; goal?: string; items: ChildSessionItem[] }> = [];

    for (const th of swarm.threads) {
      const memberSet = new Set(th.members);
      const items = sortedChildren.filter((c) => {
        const hit = c.swarm?.threadId === th.id || (c.swarm?.rosterName && memberSet.has(c.swarm.rosterName));
        if (hit) assigned.add(c.id);
        return Boolean(hit);
      });
      if (items.length > 0) {
        groups.push({ id: th.id, title: th.title, goal: th.goal, items });
      }
    }

    const leftovers = sortedChildren.filter((c) => !assigned.has(c.id));
    if (leftovers.length > 0) {
      groups.push({ id: '__unassigned__', title: sw.unassignedThread, items: leftovers });
    }
    return groups;
  }, [effectiveGroupMode, swarm?.threads, sortedChildren, sw.unassignedThread]);

  if (!found) {
    return null;
  }

  if (!isSwarmCockpit && children.length === 0) {
    return null;
  }

  // Non-Swarm Subagents / Side-Q mode
  if (!isSwarmCockpit || !swarm) {
    const tree = sessionInfo?.treeTotals;
    const totalChildQuota = tree?.childQuotaUsage || mergeSessionQuotas(children.map((c) => c.quotaUsage));
    const totalChildQuotaStr = formatSessionQuotaCompact(totalChildQuota);
    const totalChildQuotaTip = totalChildQuotaStr ? formatSessionQuotaTip(totalChildQuota, t) : undefined;
    const childCostUSD = tree ? tree.childCostUSD : children.reduce((acc, c) => acc + (c.costUSD || 0), 0);
    const childCountLabel = tree && tree.descendantCount > children.length ? `${children.length}/${tree.descendantCount}` : `${children.length}`;
    const activeCount = sortedChildren.filter((c) =>
      c.isActive !== undefined ? Boolean(c.isActive) : c.swarm?.swarmState === 'working',
    ).length;

    return (
      <section id="child-sessions-card" className="hud-card flex flex-col gap-2">
        <div
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 cursor-pointer select-none"
          onClick={toggleCardOpen}
        >
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
            <span className="card-k">{t.linkedTitle}</span>
            <span className="micro-badge">{childCountLabel}</span>
            {activeCount > 0 ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] font-semibold text-hud-ok bg-tint-ok tabular-nums">
                <span className="swarm-dot-working w-[5px] h-[5px] rounded-full shrink-0" aria-hidden="true" />
                <span>{t.childHeaderRunning(activeCount)}</span>
              </span>
            ) : (
              <span className="px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] font-medium text-hud-muted bg-hud-fill">
                {t.childFinishedBadge}
              </span>
            )}
            {childCostUSD > 0 && (
              <span className="font-hud-mono text-[10px] font-semibold text-hud-fg-2 tabular-nums">
                +{fmtUsd(childCostUSD)}
              </span>
            )}
            {totalChildQuotaStr && (
              <span className="quota-pill cursor-help" data-tip={totalChildQuotaTip}>
                {t.sessionQuotaPill(totalChildQuotaStr)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10.5px] font-hud text-hud-muted">{t.linkedHint}</span>
            <button
              type="button"
              className="collapse-btn"
              aria-expanded={cardOpen}
              onClick={(e) => {
                e.stopPropagation();
                toggleCardOpen();
              }}
            >
              {cardOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            </button>
          </div>
        </div>

        {cardOpen && (
          <div className="hud-expand-anim swarm-member-list flex flex-col">
            {sortedChildren.map((c) => (
              <SwarmMemberRow
                key={c.id}
                item={c}
                boardSeq={swarm?.boardSeq || 0}
                sw={sw}
                t={t}
                onJumpConversation={onJumpConversation}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  // Swarm Cockpit Mode (coordinator view) — includes recursive descendants via treeTotals
  const tree = sessionInfo?.treeTotals;
  let totalCalls = summary?.count || 0;
  let totalOutput = summary?.totalOutput || 0;
  let totalCostUSD = summary?.totalCostUSD || 0;
  let totalPriced = summary?.pricedCount || 0;
  if (tree) {
    totalCalls += tree.childCalls || 0;
    totalOutput += tree.childOutputTokens || 0;
    totalCostUSD += tree.childCostUSD || 0;
    totalPriced += tree.childPricedCount || 0;
  } else {
    for (const c of children) {
      totalCalls += c.calls || 0;
      totalOutput += c.outputTokens || 0;
      totalCostUSD += c.costUSD || 0;
      totalPriced += c.pricedCount || 0;
    }
  }

  const swarmQuota =
    tree?.quotaUsage ||
    mergeSessionQuotas([
      summary?.sessionQuota || sessionInfo?.quotaUsage,
      ...children.map((c) => c.quotaUsage),
    ]);
  const swarmQuotaStr = formatSessionQuotaCompact(swarmQuota);
  const swarmQuotaTip = swarmQuotaStr ? formatSessionQuotaTip(swarmQuota, t) : undefined;
  const totalCostStr = totalPriced > 0 || totalCostUSD > 0 ? fmtUsd(totalCostUSD) : '';

  const toggleThread = (threadId: string) => {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const normTitle = (swarm.swarmTitle || '').trim().toLowerCase();
  const candGoalTitle = (swarm.goalTitle || '').trim();
  const candGoalLine = (swarm.goalLine || '').trim();
  const subtitle =
    candGoalTitle && candGoalTitle.toLowerCase() !== normTitle
      ? candGoalTitle
      : candGoalLine && candGoalLine.toLowerCase() !== normTitle
        ? candGoalLine
        : '';
  const subtitleTip =
    candGoalTitle && candGoalLine && candGoalTitle.toLowerCase() !== candGoalLine.toLowerCase()
      ? `${candGoalTitle}\n${candGoalLine}`
      : subtitle || undefined;

  const effectiveWorkingCount = children.length > 0
    ? children.filter((c) =>
        c.isActive !== undefined ? Boolean(c.isActive) : c.swarm?.swarmState === 'working',
      ).length
    : swarm.workingCount;
  const effectiveWaitingCount =
    children.length > 0
      ? Math.max(0, swarm.waitingCount + (swarm.workingCount - effectiveWorkingCount))
      : swarm.waitingCount;

  return (
    <section id="child-sessions-card" className="hud-card flex flex-col gap-2">
      {/* Swarm Header Strip */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div
          className="flex items-start justify-between gap-2 min-w-0 cursor-pointer select-none"
          onClick={toggleCardOpen}
        >
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="card-k shrink-0">{sw.cockpitTitle}</span>
              <span className="text-[12px] font-hud font-semibold text-hud-fg truncate">
                {swarm.swarmTitle}
              </span>
            </div>
            {subtitle && (
              <div
                className="text-[11px] font-hud text-hud-muted truncate"
                data-tip={subtitleTip}
              >
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {swarm.boardSeq > 0 && (
              <span
                className="font-hud-mono text-[10px] text-hud-muted tabular-nums cursor-help"
                data-tip={sw.boardBadge(swarm.boardSeq)}
                onClick={(e) => e.stopPropagation()}
              >
                #{swarm.boardSeq}
              </span>
            )}
            <button
              type="button"
              className="collapse-btn"
              aria-expanded={cardOpen}
              onClick={(e) => {
                e.stopPropagation();
                toggleCardOpen();
              }}
            >
              {cardOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            </button>
          </div>
        </div>

        {/* Calm borderless state summary + optional [Flat | By Thread] toggle */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-hud text-[10.5px] tabular-nums">
            {effectiveWorkingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-1.5 py-[1px] rounded-full font-semibold text-hud-ok bg-tint-ok">
                <span className="swarm-dot-working w-[5.5px] h-[5.5px] rounded-full shrink-0" />
                <span>{sw.workingPill(effectiveWorkingCount)}</span>
              </span>
            )}
            {effectiveWaitingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-hud-muted">
                <span className="w-[5.5px] h-[5.5px] rounded-full border border-hud-muted opacity-75 shrink-0" />
                <span>{sw.waitingPill(effectiveWaitingCount)}</span>
              </span>
            )}
            {swarm.stoppedCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-hud-warn">
                <span className="w-[5px] h-[5px] rounded-[1px] bg-hud-warn shrink-0" />
                <span>{sw.stoppedPill(swarm.stoppedCount)}</span>
              </span>
            )}
            {swarm.killedCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-hud-faint">
                <IconX size={9} />
                <span>{sw.killedPill(swarm.killedCount)}</span>
              </span>
            )}
          </div>

          {canGroupByThread && (
            <div className="metric-tabs shrink-0" role="group" aria-label="View mode">
              <button
                type="button"
                onClick={() => setGroupMode('flat')}
                className={`metric-tab ${effectiveGroupMode === 'flat' ? 'is-active' : ''}`}
              >
                {sw.viewFlat}
              </button>
              <button
                type="button"
                onClick={() => setGroupMode('thread')}
                className={`metric-tab ${effectiveGroupMode === 'thread' ? 'is-active' : ''}`}
              >
                {sw.viewThread}
              </button>
            </div>
          )}
        </div>

        {/* Rolled-up Swarm Total strip (borderless recessed well, calm inline quota delta) */}
        <div className="swarm-surface-well flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-1.5 rounded-lg font-hud-mono text-[10.5px] tabular-nums">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
            <span className="font-hud font-semibold text-hud-fg">{sw.swarmTotalLabel}</span>
            <span className="text-hud-muted">
              {sw.swarmTotalMeta(totalCalls, fmtNum(totalOutput), totalCostStr)}
            </span>
          </div>
          {swarmQuotaStr && (
            <span
              className="font-hud-mono text-[10px] font-semibold text-hud-accent-ink cursor-help whitespace-nowrap"
              data-tip={swarmQuotaTip}
            >
              {swarmQuotaStr}
            </span>
          )}
        </div>
      </div>

      {/* Member Rows: Flat or Grouped by Thread */}
      {cardOpen && (effectiveGroupMode === 'thread' && threadGroups ? (
        <div className="hud-expand-anim flex flex-col gap-2">
          {threadGroups.map((group) => {
            const isCollapsed = collapsedThreads.has(group.id);
            const activeInGroup = group.items.filter((i) =>
              i.isActive !== undefined ? Boolean(i.isActive) : i.swarm?.swarmState === 'working',
            ).length;
            return (
              <div key={group.id} className="flex flex-col gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => toggleThread(group.id)}
                  data-tip={group.goal}
                  aria-expanded={!isCollapsed}
                  className="swarm-interactive-pill flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-hud-fill border-0 text-left cursor-pointer hover:text-hud-fg transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-hud-muted shrink-0">
                      {isCollapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
                    </span>
                    <span className="text-[11px] font-hud font-semibold text-hud-fg truncate">
                      {group.title}
                    </span>
                    <span className="font-hud-mono text-[10px] text-hud-muted shrink-0">
                      ({group.items.length})
                    </span>
                  </div>
                  {activeInGroup > 0 && (
                    <span className="inline-flex items-center gap-1 font-hud-mono text-[9.5px] font-semibold text-hud-ok shrink-0">
                      <span className="swarm-dot-working w-[5px] h-[5px] rounded-full" />
                      {activeInGroup}
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div className="swarm-member-list flex flex-col">
                    {group.items.map((c) => (
                      <SwarmMemberRow
                        key={c.id}
                        item={c}
                        boardSeq={swarm.boardSeq}
                        sw={sw}
                        t={t}
                        onJumpConversation={onJumpConversation}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="hud-expand-anim swarm-member-list flex flex-col">
          {sortedChildren.map((c) => (
            <SwarmMemberRow
              key={c.id}
              item={c}
              boardSeq={swarm.boardSeq}
              sw={sw}
              t={t}
              onJumpConversation={onJumpConversation}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

export const SubagentsCard = memo(SubagentsCardImpl);
