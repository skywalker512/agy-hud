import { useEffect, useRef, useState } from 'preact/hooks';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { Translations } from '../../i18n';
import type { ToolCallItem } from '../../types/telemetry';
import { copyText } from '../../utils/clipboard';
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

function prettyToolArgs(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function useCopyFlash(ms = 1100): [string | null, (key: string, text: string) => Promise<void>] {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = async (key: string, text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopiedKey(key);
    timerRef.current = setTimeout(() => setCopiedKey(null), ms);
  };

  return [copiedKey, trigger];
}

export function InspectorShimmer({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-hud-border bg-hud-surface-2 p-2 flex flex-col gap-1.5">
      <div className="insp-shimmer" />
      <div className="font-hud-mono text-[10.5px] text-hud-muted">{label}</div>
    </div>
  );
}

export function ThinkingPane({
  text,
  totalChars,
  truncated,
  isLoading,
  t,
}: {
  text: string;
  totalChars?: number;
  truncated?: boolean;
  isLoading?: boolean;
  t: Translations;
}) {
  const [copiedKey, triggerCopy] = useCopyFlash();

  if (isLoading && !text) {
    return <InspectorShimmer label={t.loadingDetail} />;
  }
  if (!text) {
    return (
      <div className="rounded-md border border-hud-border bg-hud-surface-2 px-2.5 py-2 font-hud-mono text-[11px] text-hud-muted">
        {t.noDetailBody}
      </div>
    );
  }

  const charCount = Math.max(totalChars || 0, text.length);
  const isTrunc = Boolean(truncated || (totalChars && totalChars > text.length));

  return (
    <div className="rounded-md border border-hud-border bg-hud-surface-2 px-2 py-[7px] flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-hud-mono text-[10px] font-semibold tracking-[0.03em] uppercase text-seg-think">
            {t.lblThinking}
          </span>
          <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums">
            {t.inspChars(fmtNum(charCount))}
          </span>
          {isTrunc && (
            <span className="px-1 py-[0.5px] rounded font-hud-mono text-[9px] text-hud-warn border border-hud-border bg-hud-card">
              {t.inspTruncated}
            </span>
          )}
        </div>
        <button
          type="button"
          className={`insp-copy-btn${copiedKey === 'think' ? ' is-copied' : ''}`}
          onClick={() => void triggerCopy('think', text)}
        >
          {copiedKey === 'think' ? t.copied : t.inspCopy}
        </button>
      </div>
      <div className="font-hud-mono text-[11px] text-hud-fg leading-[1.5] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto">
        {text}
      </div>
    </div>
  );
}

export function ReplyPane({
  text,
  totalChars,
  truncated,
  isLoading,
  t,
}: {
  text: string;
  totalChars?: number;
  truncated?: boolean;
  isLoading?: boolean;
  t: Translations;
}) {
  const [copiedKey, triggerCopy] = useCopyFlash();

  if (isLoading && !text) {
    return <InspectorShimmer label={t.loadingDetail} />;
  }
  if (!text) {
    return (
      <div className="rounded-md border border-hud-border bg-hud-surface-2 px-2.5 py-2 font-hud-mono text-[11px] text-hud-muted">
        {t.noDetailBody}
      </div>
    );
  }

  const charCount = Math.max(totalChars || 0, text.length);
  const isTrunc = Boolean(truncated || (totalChars && totalChars > text.length));

  return (
    <div className="rounded-md border border-hud-border bg-hud-surface-2 px-2 py-[7px] flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-hud-mono text-[10px] font-semibold tracking-[0.03em] uppercase text-seg-cache">
            {t.lblReply}
          </span>
          <span className="font-hud-mono text-[10px] text-hud-muted tabular-nums">
            {t.inspChars(fmtNum(charCount))}
          </span>
          {isTrunc && (
            <span className="px-1 py-[0.5px] rounded font-hud-mono text-[9px] text-hud-warn border border-hud-border bg-hud-card">
              {t.inspTruncated}
            </span>
          )}
        </div>
        <button
          type="button"
          className={`insp-copy-btn${copiedKey === 'reply' ? ' is-copied' : ''}`}
          onClick={() => void triggerCopy('reply', text)}
        >
          {copiedKey === 'reply' ? t.copied : t.inspCopy}
        </button>
      </div>
      <div className="font-hud text-[11.5px] text-hud-fg leading-[1.5] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto">
        {text}
      </div>
    </div>
  );
}

export function ToolsPane({
  toolCalls,
  isLoading,
  t,
}: {
  toolCalls: ToolCallItem[];
  isLoading?: boolean;
  t: Translations;
}) {
  const [copiedKey, triggerCopy] = useCopyFlash();

  if (isLoading && toolCalls.length === 0) {
    return <InspectorShimmer label={t.loadingDetail} />;
  }
  if (toolCalls.length === 0) {
    return (
      <div className="rounded-md border border-hud-border bg-hud-surface-2 px-2.5 py-2 font-hud-mono text-[11px] text-hud-muted">
        {t.noDetailBody}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto pr-0.5">
      {toolCalls.map((tc, i) => {
        const formatted = prettyToolArgs(tc.args || '');
        const key = `tool:${i}`;
        return (
          <div
            key={`${tc.name}:${i}`}
            className="rounded-[5px] border border-hud-border bg-hud-card px-[7px] py-1.5 flex flex-col gap-1 min-w-0"
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums shrink-0">
                  #{i + 1}
                </span>
                <span className="insp-tool-pill truncate">{tc.name}</span>
              </div>
              {formatted && (
                <button
                  type="button"
                  className={`insp-copy-btn shrink-0${copiedKey === key ? ' is-copied' : ''}`}
                  onClick={() => void triggerCopy(key, formatted)}
                >
                  {copiedKey === key ? t.copied : t.inspCopyArgs}
                </button>
              )}
            </div>
            {formatted ? (
              <pre className="m-0 font-hud-mono text-[10.5px] leading-[1.4] text-hud-fg whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto rounded bg-hud-surface-2 px-2 py-1 border border-hud-border/70">
                {formatted}
              </pre>
            ) : (
              <div className="font-hud-mono text-[10px] text-hud-muted italic">{t.inspNoArgs}</div>
            )}
          </div>
        );
      })}
    </div>
  );
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
                <span className="insp-tool-pill mr-1 !py-0 !px-1 !text-[10px]">
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
