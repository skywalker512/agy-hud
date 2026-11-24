import { useNowMs } from '../../hooks/useNow';
import type { Translations } from '../../i18n';
import type { ActiveStep } from '../../types/telemetry';
import { formatLiveStage, formatModelTag } from '../../utils/format';
import { ContentBlocks } from './ContentBlocks';

interface LiveCallRowProps {
  invCount: number;
  activeStep: ActiveStep | null | undefined;
  serverTimeMs: number | undefined;
  latestContext?: number;
  t: Translations;
}

export function LiveCallRow({
  invCount,
  activeStep,
  serverTimeMs,
  latestContext = 0,
  t,
}: LiveCallRowProps) {
  const nowMs = useNowMs();
  if (!activeStep || (activeStep.stepType !== 15 && activeStep.stepType !== 23)) {
    return null;
  }

  const isCompact = activeStep.stepType === 23;
  const idxLabel = isCompact ? t.compactBadge : `#${invCount + 1}`;
  const modelTag = formatModelTag(activeStep.modelId, activeStep.modelDisplay, activeStep.model) || 'Pending';
  const st = formatLiveStage(activeStep, serverTimeMs, nowMs, t, latestContext);
  const pillCls = st.isCompact ? 'compact' : st.isStreaming ? 'stream' : 'wait';

  const hasLiveBody =
    !isCompact &&
    Boolean(
      activeStep.thinkingPreview ||
        activeStep.replyPreview ||
        (activeStep.toolCalls && activeStep.toolCalls.length > 0),
    );

  return (
    <div className={`history-row is-live-call${isCompact ? ' is-compact' : ''}`}>
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-[5px] min-w-0 flex-1">
          {isCompact ? (
            <span className="compact-pill">{idxLabel}</span>
          ) : (
            <span className="font-hud-mono text-[11px] text-hud-muted shrink-0">{idxLabel}</span>
          )}
          <span className="history-model">{modelTag}</span>
          <span className={`live-stage-pill ${pillCls}`}>{st.badge}</span>
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-hud-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
            {st.rightText}
          </span>
        </div>
      </div>

      <div className="font-hud-mono text-[10.5px] leading-[1.4] text-hud-muted break-words">
        {st.detail}
      </div>

      {hasLiveBody && (
        <div className="mt-0.5 pt-[5px] border-t border-dashed border-hud-border">
          <ContentBlocks item={activeStep} isLive={true} t={t} />
        </div>
      )}
    </div>
  );
}
