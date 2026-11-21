import type { Translations } from '../../i18n';
import { getSwarmStrings } from '../../i18n/swarm';
import type { Lang, StatsSnapshot, SwarmMemberState } from '../../types/telemetry';
import {
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  kindBadgeClass,
  kindBadgeText,
  shortTitleLabel,
} from '../../utils/format';

export interface SessionRelBarProps {
  snap: StatsSnapshot | null;
  lang?: Lang;
  t: Translations;
  onJumpConversation: (convId: string) => void;
  onInspectChildren: () => void;
}

function WorkerStateDot({ state }: { state: SwarmMemberState }) {
  if (state === 'working') {
    return <span className="swarm-dot-working w-[6px] h-[6px] rounded-full shrink-0" aria-hidden="true" />;
  }
  if (state === 'waiting') {
    return <span className="w-[6px] h-[6px] rounded-full border-[1.5px] border-hud-muted shrink-0" aria-hidden="true" />;
  }
  if (state === 'stopped') {
    return <span className="w-[5.5px] h-[5.5px] rounded-[1px] bg-hud-warn shrink-0" aria-hidden="true" />;
  }
  return <span className="font-hud-mono text-[9.5px] leading-none text-hud-muted shrink-0" aria-hidden="true">×</span>;
}

export function SessionRelBar({
  snap,
  lang = 'en',
  t,
  onJumpConversation,
  onInspectChildren,
}: SessionRelBarProps) {
  const info = snap?.sessionInfo;
  const parent = info?.parentSession || null;
  const children = info?.childSessions || [];
  const kind = info?.kind || 'main';
  const swarm = info?.swarm || null;

  if (!snap?.found || (!parent && children.length === 0 && !swarm)) {
    return null;
  }

  const sw = getSwarmStrings(lang);
  const parentQuotaStr = parent?.quotaUsage ? formatSessionQuotaCompact(parent.quotaUsage, true) : '';
  const parentQuotaTip = parent?.quotaUsage ? formatSessionQuotaTip(parent.quotaUsage, t) : undefined;

  // Swarm Worker Breadcrumb View
  if (swarm && !swarm.isCoordinatorView) {
    const self = swarm.selfMember;
    const selfState: SwarmMemberState = self?.swarmState || 'waiting';
    const coordLabel = shortTitleLabel(swarm.swarmTitle, swarm.coordinatorConvId);
    const coordTip = sw.backCoordinatorTip(swarm.swarmTitle, swarm.coordinatorConvId, parentQuotaTip);
    const selfTip = self
      ? sw.workerBadgeTip(
          self.rosterName,
          sw.stateLabel(selfState),
          self.taskTitle,
          self.threadTitle,
          self.workspaceMode,
          self.model,
        )
      : undefined;

    return (
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
        <button
          type="button"
          onClick={() => onJumpConversation(swarm.coordinatorConvId)}
          data-tip={coordTip}
          className="swarm-interactive-pill swarm-pill-share inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-[5px] border font-hud-mono text-[10.5px] font-semibold cursor-pointer truncate transition-colors"
        >
          <span className="truncate">
            {sw.backCoordinator(coordLabel)}
            {parentQuotaStr ? ` (${parentQuotaStr})` : ''}
          </span>
        </button>

        {self && (
          <span
            data-tip={selfTip}
            className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold shrink-0 cursor-help ${
              selfState === 'working'
                ? 'swarm-pill-working'
                : selfState === 'stopped'
                  ? 'swarm-pill-stopped'
                  : 'border-hud-border bg-hud-fill text-hud-fg'
            }`}
          >
            <WorkerStateDot state={selfState} />
            <span>@{self.rosterName}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {swarm.boardSeq > 0 && (
            <span className="px-1.5 py-[1px] rounded-full border border-hud-border bg-hud-fill font-hud-mono text-[9.5px] font-semibold text-hud-muted tabular-nums">
              {sw.boardBadge(swarm.boardSeq)}
            </span>
          )}
          {children.length > 0 && (
            <button
              type="button"
              onClick={onInspectChildren}
              className="swarm-interactive-pill swarm-pill-branch px-[7px] py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              {t.linkedCount(children.length)}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Swarm Coordinator View
  if (swarm && swarm.isCoordinatorView) {
    const pillTip = sw.coordSwarmPillTip(
      swarm.swarmTitle,
      swarm.workingCount,
      swarm.waitingCount,
      swarm.stoppedCount,
      swarm.killedCount,
      swarm.boardSeq,
      swarm.goalTitle || swarm.goalLine,
    );
    const hasWorking = swarm.workingCount > 0;
    const totalCount = swarm.memberCount || children.length;

    return (
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
        {parent && (
          <button
            type="button"
            onClick={() => onJumpConversation(parent.id)}
            data-tip={parentQuotaTip}
            className="swarm-interactive-pill swarm-pill-share inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-[5px] border font-hud-mono text-[10.5px] font-semibold cursor-pointer truncate transition-colors"
          >
            {t.backParent(`${shortTitleLabel(parent.title, parent.id)}${parentQuotaStr ? ` (${parentQuotaStr})` : ''}`)}
          </button>
        )}
        <span className={`rel-kind-pill ${kindBadgeClass(kind)}`}>
          {kindBadgeText(kind, t)}
        </span>
        <span className="swarm-pill-branch inline-flex items-center px-1.5 py-[1px] rounded-full border font-hud-mono text-[9.5px] font-bold tracking-[0.03em] shrink-0">
          {sw.swarmRoleBadge}
        </span>
        <button
          type="button"
          onClick={onInspectChildren}
          data-tip={pillTip}
          className={`swarm-interactive-pill ml-auto inline-flex items-center gap-1.5 px-2 py-[1.5px] rounded-full border font-hud-mono text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 tabular-nums transition-colors ${
            hasWorking ? 'swarm-pill-working' : 'swarm-pill-branch'
          }`}
        >
          {hasWorking && <span className="swarm-dot-working w-[6px] h-[6px] rounded-full shrink-0" aria-hidden="true" />}
          <span>
            {hasWorking
              ? sw.coordSwarmPillWorking(swarm.workingCount, totalCount)
              : sw.coordSwarmPillIdle(totalCount)}
          </span>
        </button>
      </div>
    );
  }

  // Standard Non-Swarm Parent / Subagent / Side-Q Bar
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
      {parent && (
        <button
          type="button"
          onClick={() => onJumpConversation(parent.id)}
          data-tip={parentQuotaTip}
          className="swarm-interactive-pill swarm-pill-share inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-[5px] border font-hud-mono text-[10.5px] font-semibold cursor-pointer truncate transition-colors"
        >
          {t.backParent(`${shortTitleLabel(parent.title, parent.id)}${parentQuotaStr ? ` (${parentQuotaStr})` : ''}`)}
        </button>
      )}
      <span className={`rel-kind-pill ${kindBadgeClass(kind)}`}>
        {kindBadgeText(kind, t)}
      </span>
      {children.length > 0 && (
        <button
          type="button"
          onClick={onInspectChildren}
          className="swarm-interactive-pill swarm-pill-branch ml-auto px-[7px] py-[1px] rounded-full border font-hud-mono text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors"
        >
          {t.linkedCount(children.length)}
        </button>
      )}
    </div>
  );
}
