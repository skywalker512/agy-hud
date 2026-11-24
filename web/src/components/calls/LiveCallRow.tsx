import { useNowMs } from '../../hooks/useNow';
import type { Translations } from '../../i18n';
import type { ActiveStep } from '../../types/telemetry';
import { fmtSec, formatLiveStage, formatModelTag, ttftTier } from '../../utils/format';
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

  const startMs = activeStep.createdAtMs || serverTimeMs || nowMs;
  const liveTtftSec = !isCompact
    ? st.isStreaming && activeStep.createdAtMs > 0 && activeStep.streamStartMs >= activeStep.createdAtMs
      ? (activeStep.streamStartMs - activeStep.createdAtMs) / 1000
      : Math.max(0, (nowMs - startMs) / 1000)
    : null;
  const liveGenSec = !isCompact && st.isStreaming && activeStep.streamStartMs > 0
    ? Math.max(0, (nowMs - activeStep.streamStartMs) / 1000)
    : null;
  const liveTtftTier = liveTtftSec !== null ? ttftTier(liveTtftSec) : 'fast';

  const hasLiveBody =
    !isCompact &&
    Boolean(
      activeStep.thinkingPreview ||
        activeStep.replyPreview ||
        (activeStep.toolCalls && activeStep.toolCalls.length > 0),
    );

  const liveWaitCls =
    !isCompact && !st.isStreaming && liveTtftSec !== null
      ? liveTtftTier === 'slow'
        ? ' is-waiting-stalled'
        : ' is-waiting-ttft'
      : '';

  return (
    <div className={`history-row is-live-call relative${isCompact ? ' is-compact' : ''}${liveWaitCls}`}>
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
        <div className="flex items-center gap-1.5 shrink-0">
          {!isCompact && liveTtftSec !== null ? (
            <>
              <span className={`ttft-pill ${liveTtftTier}`}>
                {!st.isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                <span>TTFT {st.isStreaming ? fmtSec(liveTtftSec) : `${liveTtftSec.toFixed(1)}s…`}</span>
              </span>
              {liveGenSec !== null && (
                <span className="font-hud-mono text-[11px] font-semibold text-hud-ok tabular-nums whitespace-nowrap">
                  +{liveGenSec.toFixed(1)}s
                </span>
              )}
            </>
          ) : (
            <span className="font-hud-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
              {st.rightText}
            </span>
          )}
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
