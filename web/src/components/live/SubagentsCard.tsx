import { useMemo, useState } from 'preact/hooks';
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
  fmtClock,
  fmtNum,
  fmtUsd,
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  kindBadgeClass,
  kindBadgeText,
} from '../../utils/format';

export interface SubagentsCardProps {
  found: boolean;
  children: ChildSessionItem[];
  sessionInfo?: SessionInfo | null;
  summary?: TelemetrySummary | null;
  lang?: Lang;
  t: Translations;
  onJumpConversation: (convId: string) => void;
}

const STATE_RANK: Record<SwarmMemberState, number> = {
  working: 0,
  waiting: 1,
  stopped: 2,
  killed: 3,
};

const REAL_UUID_RE = /^[0-9a-f-]{8,}$/i;

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
        className="w-[7px] h-[7px] rounded-full border-[1.5px] border-hud-muted shrink-0"
        aria-hidden="true"
      />
    );
  }
  if (state === 'stopped') {
    return <span className="w-[6px] h-[6px] rounded-[1.5px] bg-hud-warn shrink-0" aria-hidden="true" />;
  }
  return (
    <span className="font-hud-mono text-[10px] leading-none text-hud-muted shrink-0" aria-hidden="true">
      ×
    </span>
  );
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

function SwarmMemberCard({ item: c, boardSeq, sw, t, onJumpConversation }: MemberRowProps) {
  const m = c.swarm;
  const isRealConv = REAL_UUID_RE.test(c.id);
  const state: SwarmMemberState = m?.swarmState || 'waiting';
  const isKilled = state === 'killed';
  const costStr = c.pricedCount > 0 ? fmtUsd(c.costUSD) : '';
  const qStr = c.quotaUsage ? formatSessionQuotaCompact(c.quotaUsage, true) : '';
  const actMs = memberActivityMs(c);
  const clockStr = actMs > 0 ? fmtClock(actMs) : '';
  const tip = buildMemberTooltip(c, boardSeq, sw, t);

  if (!m) {
    const badge = kindBadgeText(c.kind, t);
    const cls = kindBadgeClass(c.kind);
    const lbl = c.title || sw.subagentRoleFallback(c.subagentType, c.id.slice(0, 8));
    const fullMeta = t.linkedMeta(c.calls || 0, fmtNum(c.outputTokens || 0), costStr, qStr);
    return (
      <button
        type="button"
        onClick={() => onJumpConversation(c.id)}
        data-tip={tip}
        className="swarm-member-card w-full text-left px-2.5 py-2 rounded-md border border-hud-border text-inherit cursor-pointer flex flex-col gap-1 transition-colors"
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className={`rel-kind-pill ${cls}`}>{badge}</span>
            {c.subagentType && c.subagentType !== 'worker' && (
              <span className="px-1.5 py-[0.5px] rounded border border-hud-border bg-hud-card font-hud-mono text-[9.5px] text-hud-muted shrink-0">
                {c.subagentType}
              </span>
            )}
            <span className="text-[11.5px] font-semibold text-hud-fg truncate">{lbl}</span>
          </div>
          <span className="font-hud-mono text-[10.5px] font-semibold text-hud-accent shrink-0">
            {t.jumpAction}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 font-hud-mono text-[10.5px] text-hud-muted tabular-nums">
          <span className="truncate">{fullMeta}</span>
          {clockStr && <span className="shrink-0 text-hud-faint">{clockStr}</span>}
        </div>
      </button>
    );
  }

  const showWorkspacePill = m.workspaceMode === 'share' || m.workspaceMode === 'branch';
  const taskLine = m.taskTitle || (c.title && c.title !== `@${m.rosterName}` ? c.title : '');
  const metricsText = c.calls > 0
    ? sw.memberMeta(c.calls, fmtNum(c.outputTokens || 0), costStr)
    : sw.memberCallsZero;

  return (
    <button
      type="button"
      disabled={!isRealConv}
      onClick={() => {
        if (isRealConv) onJumpConversation(c.id);
      }}
      data-tip={tip}
      className={`swarm-member-card w-full text-left px-2.5 py-2 rounded-md border border-hud-border text-inherit flex flex-col gap-1 transition-colors ${
        isRealConv ? 'cursor-pointer' : 'cursor-default opacity-80'
      } ${isKilled ? 'opacity-65' : ''}`}
    >
      {/* Row 1: State dot + @rosterName + workspace + model + Jump */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
          <StateIndicator state={state} />
          <span
            className={`font-hud-mono text-[11.5px] font-bold tracking-[-0.01em] truncate ${
              isKilled ? 'text-hud-muted line-through' : 'text-hud-fg'
            }`}
          >
            @{m.rosterName}
          </span>
          {showWorkspacePill && m.workspaceMode && (
            <span
              className={`px-1.5 py-[0.5px] rounded-full border font-hud-mono text-[9.5px] font-semibold leading-[1.35] shrink-0 ${
                m.workspaceMode === 'share' ? 'swarm-pill-share' : 'swarm-pill-branch'
              }`}
            >
              {sw.workspaceLabel(m.workspaceMode)}
            </span>
          )}
          {m.model && (
            <span className="px-1.5 py-[0.5px] rounded border border-hud-border bg-hud-card font-hud-mono text-[9.5px] text-hud-muted truncate max-w-[136px]">
              {m.model}
            </span>
          )}
        </div>
        <span
          className={`font-hud-mono text-[10.5px] font-semibold shrink-0 ${
            isRealConv ? 'text-hud-accent' : 'text-hud-muted'
          }`}
        >
          {isRealConv ? t.jumpAction : sw.pendingConv}
        </span>
      </div>

      {/* Row 2: Clamped taskTitle from plan.json or brief fallback */}
      {taskLine && (
        <div className="text-[11px] leading-[1.38] text-hud-fg-2 line-clamp-2 break-words">
          {taskLine}
        </div>
      )}

      {/* Row 3: Aligned tabular metrics + quota + last post #seq / clock */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
          <span>{metricsText}</span>
          {qStr && (
            <span className="text-hud-accent-ink font-semibold">
              {qStr}
            </span>
          )}
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

export function SubagentsCard({
  found,
  children,
  sessionInfo,
  summary,
  lang = 'en',
  t,
  onJumpConversation,
}: SubagentsCardProps) {
  const [groupMode, setGroupMode] = useState<'flat' | 'thread'>('flat');
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(() => new Set());

  const sw = getSwarmStrings(lang);
  const swarm = sessionInfo?.swarm || null;
  const isSwarmCockpit = Boolean(swarm?.isCoordinatorView);

  const sortedChildren = useMemo(() => {
    return [...children].sort((a, b) => {
      const rankA = a.swarm ? STATE_RANK[a.swarm.swarmState] : 4;
      const rankB = b.swarm ? STATE_RANK[b.swarm.swarmState] : 4;
      if (rankA !== rankB) return rankA - rankB;
      const timeDiff = memberActivityMs(b) - memberActivityMs(a);
      if (timeDiff !== 0) return timeDiff;
      return String(a.swarm?.rosterName || a.id).localeCompare(String(b.swarm?.rosterName || b.id));
    });
  }, [children]);

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

  // Non-coordinator views (including Swarm workers) only show this card when they have their own child subagents.
  if (!isSwarmCockpit && children.length === 0) {
    return null;
  }

  // Non-Swarm Subagents / Side-Q mode (or worker with helper subagents)
  if (!isSwarmCockpit || !swarm) {
    const totalChildQuota = mergeSessionQuotas(children.map((c) => c.quotaUsage));
    const totalChildQuotaStr = formatSessionQuotaCompact(totalChildQuota);
    const totalChildQuotaTip = totalChildQuotaStr ? formatSessionQuotaTip(totalChildQuota, t) : undefined;

    return (
      <section id="child-sessions-card" className="hud-card">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
            <span className="card-k">{t.linkedTitle}</span>
            <span className="micro-badge">{children.length}</span>
            {totalChildQuotaStr && (
              <span className="quota-pill cursor-help" data-tip={totalChildQuotaTip}>
                {t.sessionQuotaPill(totalChildQuotaStr)}
              </span>
            )}
          </div>
          <span className="card-sub !mt-0">{t.linkedHint}</span>
        </div>

        <div className="mt-2 flex flex-col gap-1.5">
          {sortedChildren.map((c) => (
            <SwarmMemberCard
              key={c.id}
              item={c}
              boardSeq={swarm?.boardSeq || 0}
              sw={sw}
              t={t}
              onJumpConversation={onJumpConversation}
            />
          ))}
        </div>
      </section>
    );
  }

  // Swarm Cockpit Mode (coordinator view)
  let totalCalls = summary?.count || 0;
  let totalOutput = summary?.totalOutput || 0;
  let totalCostUSD = summary?.totalCostUSD || 0;
  let totalPriced = summary?.pricedCount || 0;
  for (const c of children) {
    totalCalls += c.calls || 0;
    totalOutput += c.outputTokens || 0;
    totalCostUSD += c.costUSD || 0;
    totalPriced += c.pricedCount || 0;
  }

  const swarmQuota = mergeSessionQuotas([
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

  return (
    <section id="child-sessions-card" className="hud-card flex flex-col gap-2">
      {/* Swarm Header Strip */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="card-k uppercase">{sw.cockpitTitle}</span>
              <span className="text-[12.5px] font-bold text-hud-fg truncate">
                {swarm.swarmTitle}
              </span>
            </div>
            {(swarm.goalTitle || swarm.goalLine) && (
              <div
                className="text-[11px] text-hud-muted truncate"
                data-tip={swarm.goalTitle && swarm.goalLine ? `${swarm.goalTitle}\n${swarm.goalLine}` : undefined}
              >
                {swarm.goalTitle || swarm.goalLine}
              </div>
            )}
          </div>
          {swarm.boardSeq > 0 && (
            <span className="px-1.5 py-[1px] rounded-full border border-hud-border bg-hud-fill font-hud-mono text-[10px] font-semibold text-hud-muted tabular-nums shrink-0">
              {sw.boardBadge(swarm.boardSeq)}
            </span>
          )}
        </div>

        {/* Live state pills + optional [Flat | By Thread] toggle */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {swarm.workingCount > 0 && (
              <span className="swarm-pill-working inline-flex items-center gap-1.5 px-2 py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold tabular-nums">
                <span className="swarm-dot-working w-[6px] h-[6px] rounded-full shrink-0" />
                {sw.workingPill(swarm.workingCount)}
              </span>
            )}
            {swarm.waitingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-[1px] rounded-full border border-hud-border bg-hud-fill font-hud-mono text-[10px] font-medium text-hud-muted tabular-nums">
                <span className="w-[6px] h-[6px] rounded-full border border-hud-muted shrink-0" />
                {sw.waitingPill(swarm.waitingCount)}
              </span>
            )}
            {swarm.stoppedCount > 0 && (
              <span className="swarm-pill-stopped inline-flex items-center gap-1 px-2 py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold tabular-nums">
                {sw.stoppedPill(swarm.stoppedCount)}
              </span>
            )}
            {swarm.killedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-hud-border bg-hud-fill font-hud-mono text-[10px] text-hud-faint tabular-nums opacity-80">
                × {sw.killedPill(swarm.killedCount)}
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

        {/* Rolled-up Swarm Total strip */}
        <div className="swarm-surface-well flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-1.5 rounded-md border border-hud-border font-hud-mono text-[10.5px] tabular-nums">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
            <span className="font-semibold text-hud-fg">{sw.swarmTotalLabel}</span>
            <span className="text-hud-muted">
              {sw.swarmTotalMeta(totalCalls, fmtNum(totalOutput), totalCostStr)}
            </span>
          </div>
          {swarmQuotaStr && (
            <span className="quota-pill cursor-help" data-tip={swarmQuotaTip}>
              {t.sessionQuotaPill(swarmQuotaStr)}
            </span>
          )}
        </div>
      </div>

      {/* Member Cards: Flat or Grouped by Thread */}
      {effectiveGroupMode === 'thread' && threadGroups ? (
        <div className="flex flex-col gap-2">
          {threadGroups.map((group) => {
            const isCollapsed = collapsedThreads.has(group.id);
            const activeInGroup = group.items.filter((i) => i.swarm?.swarmState === 'working').length;
            return (
              <div key={group.id} className="flex flex-col gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => toggleThread(group.id)}
                  data-tip={group.goal}
                  aria-expanded={!isCollapsed}
                  className="swarm-interactive-pill flex items-center justify-between gap-2 px-1.5 py-1 rounded bg-hud-fill border border-hud-border/70 text-left cursor-pointer hover:border-hud-accent transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-hud-mono text-[10px] text-hud-muted shrink-0">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="text-[11px] font-semibold text-hud-fg truncate">
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
                  <div className="flex flex-col gap-1.5 pl-1.5 border-l border-hud-border/80">
                    {group.items.map((c) => (
                      <SwarmMemberCard
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
        <div className="flex flex-col gap-1.5">
          {sortedChildren.map((c) => (
            <SwarmMemberCard
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
    </section>
  );
}
