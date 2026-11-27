import type { Translations } from '../../i18n';
import { getSwarmStrings } from '../../i18n/swarm';
import type { Lang, StatsSnapshot } from '../../types/telemetry';
import { formatModelTag, kindBadgeClass, kindBadgeText } from '../../utils/format';

interface ModelBarProps {
  snap: StatsSnapshot | null;
  lang?: Lang;
  t: Translations;
  onInspectChildren?: () => void;
}

export function ModelBar({ snap, lang = 'en', t, onInspectChildren }: ModelBarProps) {
  if (!snap) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
        <div className="model-pill">
          <span className="model-dot" />
          <span className="font-medium text-hud-fg truncate">{t.waitingModel}</span>
        </div>
        <span className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums">--</span>
      </div>
    );
  }

  if (!snap.found) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
        <div className="model-pill">
          <span className="model-dot" />
          <span className="font-medium text-hud-fg truncate">
            {snap.error ? t.readErr(snap.error) : t.noDb}
          </span>
        </div>
        <span className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums">--</span>
      </div>
    );
  }

  const s = snap.summary;
  const metaText = t.sessionMeta(s?.userTurns || 0, s?.totalSteps || 0, s?.count || 0);
  const cm = snap.currentModel;
  const info = snap.sessionInfo;
  const children = info?.childSessions || [];
  const kind = info?.kind || 'main';
  const swarm = info?.swarm || null;
  const sw = getSwarmStrings(lang);

  // Folded relationship pill: shown directly inside ModelBar for main / coordinator sessions
  const isChildSession = Boolean(info?.parentSession || (swarm && !swarm.isCoordinatorView));
  const showFoldedSwarm = Boolean(swarm && swarm.isCoordinatorView);
  const showFoldedLinked = Boolean(!isChildSession && !showFoldedSwarm && children.length > 0);

  const renderModelPill = () => {
    if (!cm) {
      return (
        <div className="model-pill">
          <span className="model-dot" />
          <span className="font-medium text-hud-fg truncate">
            {t.waitFirstCall((snap.conversationId || '').slice(0, 8))}
          </span>
        </div>
      );
    }

    const disp = cm.modelDisplay || cm.model || 'Unknown Model';
    const fullId = formatModelTag(cm.modelId, cm.modelDisplay, cm.model);
    const rawId = fullId && fullId !== disp ? fullId : '';

    let pillCls = 'model-pill';
    let primaryText = disp;

    if (cm.isActive && cm.stepType === 15) {
      pillCls = 'model-pill is-running';
      primaryText = snap.activeStep?.streamStartMs ? t.modelRunning(disp) : t.modelWaiting(disp);
    } else if (cm.isActive && cm.stepType === 23) {
      pillCls = 'model-pill is-compact';
      primaryText = t.modelCompact(disp);
    } else if (cm.isActive) {
      pillCls = 'model-pill is-tool';
      primaryText = t.modelTool(disp, cm.toolName);
    }

    return (
      <div className={pillCls}>
        <span className="model-dot" />
        <span className="font-semibold text-hud-fg truncate">{primaryText}</span>
        {rawId && (
          <span className="model-id-tag font-hud-mono text-[9.5px] text-hud-muted px-1 py-[0.5px] rounded bg-hud-fill truncate">
            {rawId}
          </span>
        )}
      </div>
    );
  };

  let swarmActionNode = null;
  const activeChildrenCount = children.filter((c) =>
    c.isActive !== undefined ? Boolean(c.isActive) : c.swarm?.swarmState === 'working',
  ).length;
  if (showFoldedSwarm && swarm && onInspectChildren) {
    const workingCount = children.length > 0 ? activeChildrenCount : swarm.workingCount;
    const effectiveWaitingCount =
      children.length > 0
        ? Math.max(0, swarm.waitingCount + (swarm.workingCount - workingCount))
        : swarm.waitingCount;
    const hasWorking = workingCount > 0;
    const totalCount = swarm.memberCount || children.length;
    const pillTip = sw.coordSwarmPillTip(
      swarm.swarmTitle,
      workingCount,
      effectiveWaitingCount,
      swarm.stoppedCount,
      swarm.killedCount,
      swarm.boardSeq,
      swarm.goalTitle || swarm.goalLine,
    );
    swarmActionNode = (
      <button
        type="button"
        onClick={onInspectChildren}
        data-tip={pillTip}
        className={`swarm-interactive-pill inline-flex items-center gap-1.5 px-2 py-[1.5px] rounded-full border font-hud text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 tabular-nums transition-colors ${
          hasWorking ? 'swarm-pill-working' : 'swarm-pill-idle'
        }`}
      >
        {hasWorking && <span className="swarm-dot-working w-[5.5px] h-[5.5px] rounded-full shrink-0" aria-hidden="true" />}
        <span>
          {hasWorking
            ? sw.coordSwarmPillWorking(workingCount, totalCount)
            : sw.coordSwarmPillIdle(totalCount)}
        </span>
      </button>
    );
  } else if (showFoldedLinked && onInspectChildren) {
    const hasActiveChild = activeChildrenCount > 0;
    swarmActionNode = (
      <button
        type="button"
        onClick={onInspectChildren}
        className={`swarm-interactive-pill inline-flex items-center gap-1.5 px-2 py-[1.5px] rounded-full border font-hud text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 tabular-nums transition-colors ${
          hasActiveChild ? 'swarm-pill-working' : 'swarm-pill-idle'
        }`}
      >
        {hasActiveChild && <span className="swarm-dot-working w-[5.5px] h-[5.5px] rounded-full shrink-0" aria-hidden="true" />}
        <span>
          {hasActiveChild
            ? t.linkedRunningCount(activeChildrenCount, children.length)
            : t.linkedCount(children.length)}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {renderModelPill()}
        {!isChildSession && (showFoldedSwarm || showFoldedLinked || kind !== 'main') && (
          <span className={`rel-kind-pill ${kindBadgeClass(kind)}`}>
            {kindBadgeText(kind, t)}
          </span>
        )}
        {swarmActionNode}
      </div>
      <span className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums max-w-full break-words">
        {metaText}
      </span>
    </div>
  );
}
