import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { Translations } from '../../i18n';
import type { ToolCallItem } from '../../types/telemetry';
import { fmtNum } from '../../utils/format';

export interface ContentSource {
  thinkingPreview?: string;
  thinkingChars?: number;
  thinkingTruncated?: boolean;
  replyPreview?: string;
  replyChars?: number;
  replyTruncated?: boolean;
  toolCalls?: ToolCallItem[];
}

interface ContentBlocksProps {
  item: ContentSource;
  isLive?: boolean;
  t: Translations;
}

export function ContentBlocks({ item, isLive = false, t }: ContentBlocksProps) {
  const thinkText = item.thinkingPreview || '';
  const replyText = item.replyPreview || '';
  const toolCalls = item.toolCalls || [];

  const thinkRef = useAutoScroll<HTMLDivElement>(isLive && thinkText.length > 0, thinkText.length);
  const replyRef = useAutoScroll<HTMLDivElement>(isLive && replyText.length > 0, replyText.length);

  if (!thinkText && !replyText && toolCalls.length === 0) {
    return null;
  }

  const thinkMeta =
    isLive && (item.thinkingChars || 0) > 0
      ? t.lblChars(fmtNum(item.thinkingChars), Boolean(item.thinkingTruncated))
      : '';

  const replyMeta =
    isLive && (item.replyChars || 0) > 0
      ? t.lblChars(fmtNum(item.replyChars), Boolean(item.replyTruncated))
      : '';

  return (
    <div className="flex flex-col gap-[5px]">
      {thinkText && (
        <div className="history-content-block">
          <span className="history-content-label think">{t.lblThinking + thinkMeta}</span>
          <div ref={thinkRef} className="history-content-text">
            {thinkText}
          </div>
        </div>
      )}

      {replyText && (
        <div className="history-content-block">
          <span className="history-content-label reply">{t.lblReply + replyMeta}</span>
          <div ref={replyRef} className="history-content-text">
            {replyText}
          </div>
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="history-content-block">
          <span className="history-content-label tool">
            {t.lblToolCalls} ({toolCalls.length})
          </span>
          <div className="flex flex-col gap-1">
            {toolCalls.map((tc, i) => (
              <div
                key={`${tc.name}:${i}`}
                className="font-hud-mono text-[10.5px] leading-[1.4] text-hud-fg whitespace-pre-wrap break-words max-h-[110px] overflow-y-auto"
              >
                <span
                  className="inline-block px-1 rounded-[3px] text-hud-fg font-semibold mr-1"
                  style={{ background: 'color-mix(in srgb, var(--seg-out) 16%, transparent)' }}
                >
                  {tc.name}
                </span>
                {tc.args || ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
