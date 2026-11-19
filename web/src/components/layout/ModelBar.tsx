import type { Translations } from '../../i18n';
import type { StatsSnapshot } from '../../types/telemetry';
import { formatModelTag } from '../../utils/format';

interface ModelBarProps {
  snap: StatsSnapshot | null;
  t: Translations;
}

export function ModelBar({ snap, t }: ModelBarProps) {
  if (!snap) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
        <div className="model-pill">
          <span className="model-dot" />
          <span className="font-semibold text-hud-fg truncate">{t.waitingModel}</span>
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
          <span className="font-semibold text-hud-fg truncate">
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

  if (!cm) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
        <div className="model-pill">
          <span className="model-dot" />
          <span className="font-semibold text-hud-fg truncate">
            {t.waitFirstCall((snap.conversationId || '').slice(0, 8))}
          </span>
        </div>
        <span className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums max-w-full break-words">
          {metaText}
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
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
      <div className={pillCls}>
        <span className="model-dot" />
        <span className="font-semibold text-hud-fg truncate">{primaryText}</span>
        {rawId && (
          <span className="model-id-tag font-hud-mono text-[10px] text-hud-muted px-1.5 py-[0.5px] rounded bg-hud-fill border border-hud-border truncate">
            {rawId}
          </span>
        )}
      </div>
      <span className="font-hud-mono text-[10.5px] text-hud-muted tabular-nums max-w-full break-words">
        {metaText}
      </span>
    </div>
  );
}
