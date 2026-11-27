import type { Translations } from '../../i18n';
import { getSwarmStrings } from '../../i18n/swarm';
import type { Lang, StatsSnapshot, SwarmMemberState } from '../../types/telemetry';
import {
  fmtUsd,
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  kindBadgeText,
  shortTitleLabel,
} from '../../utils/format';
import { IconArrowLeft, IconX } from '../common/Icons';

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
  return <IconX size={9} className="text-hud-muted" />;
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

  // Only show a dedicated breadcrumb row when inside a child / worker session!
  // Main & Coordinator relationship pills are folded cleanly into ModelBar.
  const isSwarmWorker = Boolean(swarm && !swarm.isCoordinatorView);
  if (!snap?.found || (!parent && !isSwarmWorker)) {
    return null;
  }

  const sw = getSwarmStrings(lang);
  const isZh = lang === 'zh';
  const rootTree = info?.rootTreeTotals || null;
  const effectiveParentQuota = rootTree?.quotaUsage || parent?.quotaUsage || null;
  const parentQuotaStr = effectiveParentQuota ? formatSessionQuotaCompact(effectiveParentQuota, true) : '';
  const parentQuotaTip = effectiveParentQuota ? formatSessionQuotaTip(effectiveParentQuota, t) : undefined;
  const rootTreeCostStr = rootTree && (rootTree.costUSD > 0 || rootTree.pricedCount > 0) ? fmtUsd(rootTree.costUSD) : '';
  const parentSummaryTag = [rootTreeCostStr, parentQuotaStr].filter(Boolean).join(' · ');
  const rootTreeTipLine = rootTree && rootTreeCostStr
    ? isZh
      ? `${rootTree.isSwarm ? '所属蜂群总计' : '所属会话树总计'}：${rootTreeCostStr}（${rootTree.calls} 次调用 · 含 ${rootTree.descendantCount} 个子会话）`
      : `${rootTree.isSwarm ? 'Swarm total' : 'Session tree total'}: ${rootTreeCostStr} (${rootTree.calls} calls · ${rootTree.descendantCount} subagents)`
    : '';
  const combinedParentTip = [rootTreeTipLine, parentQuotaTip].filter(Boolean).join('\n\n') || undefined;

  const activeChildrenCount = children.filter((c) =>
    c.isActive !== undefined ? Boolean(c.isActive) : c.swarm?.swarmState === 'working',
  ).length;
  const hasActiveChildren = activeChildrenCount > 0;
  const isSelfActive = Boolean(snap?.activeStep);
  const selfActiveKind = snap?.activeStep
    ? snap.activeStep.stepType === 15
      ? 'gen'
      : snap.activeStep.stepType === 23
        ? 'compact'
        : 'tool'
    : '';

  // Swarm Worker Breadcrumb View
  if (isSwarmWorker && swarm) {
    const self = swarm.selfMember;
    const rawSelfState: SwarmMemberState = self?.swarmState || 'waiting';
    const selfState: SwarmMemberState = rawSelfState === 'working' && !isSelfActive ? 'waiting' : rawSelfState;
    const coordLabel = shortTitleLabel(swarm.swarmTitle, swarm.coordinatorConvId);
    const coordTip = sw.backCoordinatorTip(swarm.swarmTitle, swarm.coordinatorConvId, combinedParentTip);
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
          className="swarm-interactive-pill swarm-pill-share inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-md border font-hud text-[10.5px] font-semibold cursor-pointer truncate transition-colors"
        >
          <IconArrowLeft size={11} />
          <span className="truncate">
            {sw.backCoordinator(coordLabel)}
            {parentSummaryTag ? ` (${parentSummaryTag})` : ''}
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
                  : 'border-transparent bg-hud-fill text-hud-muted'
            }`}
          >
            <WorkerStateDot state={selfState} />
            <span>@{self.rosterName}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {swarm.boardSeq > 0 && (
            <span className="px-1.5 py-[1px] rounded-full bg-hud-fill font-hud-mono text-[9.5px] font-medium text-hud-muted tabular-nums">
              {sw.boardBadge(swarm.boardSeq)}
            </span>
          )}
          {children.length > 0 && (
            <button
              type="button"
              onClick={onInspectChildren}
              className={`swarm-interactive-pill inline-flex items-center gap-1 px-[7px] py-[1px] rounded-full border font-hud text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 tabular-nums transition-colors ${
                hasActiveChildren ? 'swarm-pill-working' : 'swarm-pill-idle'
              }`}
            >
              {hasActiveChildren && <span className="swarm-dot-working w-[5px] h-[5px] rounded-full shrink-0" aria-hidden="true" />}
              <span>
                {hasActiveChildren
                  ? t.linkedRunningCount(activeChildrenCount, children.length)
                  : t.linkedCount(children.length)}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Standard Child / Subagent / Side-Q Breadcrumb View
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
      {parent && (
        <button
          type="button"
          onClick={() => onJumpConversation(parent.id)}
          data-tip={combinedParentTip}
          className="swarm-interactive-pill swarm-pill-share inline-flex items-center gap-1 max-w-full px-[7px] py-[2px] rounded-md border font-hud text-[10.5px] font-semibold cursor-pointer truncate transition-colors"
        >
          <IconArrowLeft size={11} />
          <span className="truncate">
            {t.backParent(`${shortTitleLabel(parent.title, parent.id)}${parentSummaryTag ? ` (${parentSummaryTag})` : ''}`)}
          </span>
        </button>
      )}
      {isSelfActive ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border font-hud text-[9.5px] font-semibold swarm-pill-working shrink-0">
          <span className="swarm-dot-working w-[5px] h-[5px] rounded-full shrink-0" aria-hidden="true" />
          <span>{kindBadgeText(kind, t)} · {t.childRunningBadge(selfActiveKind)}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded font-hud text-[9.5px] font-medium bg-hud-fill text-hud-muted shrink-0">
          <span className="w-[5px] h-[5px] rounded-full bg-hud-muted/50 shrink-0" aria-hidden="true" />
          <span>{kindBadgeText(kind, t)} · {t.childFinishedBadge}</span>
        </span>
      )}
      {children.length > 0 && (
        <button
          type="button"
          onClick={onInspectChildren}
          className={`swarm-interactive-pill ml-auto inline-flex items-center gap-1 px-[7px] py-[1px] rounded-full border font-hud text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 tabular-nums transition-colors ${
            hasActiveChildren ? 'swarm-pill-working' : 'swarm-pill-idle'
          }`}
        >
          {hasActiveChildren && <span className="swarm-dot-working w-[5px] h-[5px] rounded-full shrink-0" aria-hidden="true" />}
          <span>
            {hasActiveChildren
              ? t.linkedRunningCount(activeChildrenCount, children.length)
              : t.linkedCount(children.length)}
          </span>
        </button>
      )}
    </div>
  );
}
