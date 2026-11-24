import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '../i18n/content';
import {
  buildHostThemePayload,
  type AgyTheme,
  type ContrastMode,
} from '../themes/agyThemes';

export interface DemoJumpRequest {
  id: string;
  tab: 'live' | 'calls' | 'account';
  action?: 'live-top' | 'swarm' | 'calls-top' | 'global-trend' | 'quota' | 'cache-ttl' | 'arena' | 'wrapped';
}

export interface DemoJumpCmd extends DemoJumpRequest {
  seq: number;
}

interface LiveHudFrameProps {
  locale: Locale;
  theme: AgyTheme;
  contrast: ContrastMode;
  jumpCmd?: DemoJumpCmd | null;
  canReturnToFeature?: boolean;
  onReturnToFeature?: () => void;
  onCycleTheme: () => void;
  onJumpDemo: (req: DemoJumpRequest) => void;
}

export function LiveHudFrame({
  locale,
  theme,
  contrast,
  jumpCmd,
  canReturnToFeature,
  onReturnToFeature,
  onCycleTheme,
  onJumpDemo,
}: LiveHudFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialLangRef = useRef<Locale>(locale);
  const [activeStop, setActiveStop] = useState<string>('live');
  const isZh = locale === 'zh';

  const syncFrame = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'theme-change',
        payload: buildHostThemePayload(theme, contrast),
      },
      '*',
    );
    win.postMessage({ type: 'agy-demo-locale', lang: locale }, '*');
  }, [theme, contrast, locale]);

  useEffect(() => {
    syncFrame();
  }, [syncFrame]);

  useEffect(() => {
    if (!jumpCmd) return;
    setActiveStop(jumpCmd.id);
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'agy-demo-navigate',
        tab: jumpCmd.tab,
        action: jumpCmd.action || '',
      },
      '*',
    );
  }, [jumpCmd]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === iframeRef.current?.contentWindow &&
        event.data &&
        event.data.type === 'agy-demo-ready'
      ) {
        syncFrame();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [syncFrame]);

  const tourStops: Array<DemoJumpRequest & { label: string }> = [
    { id: 'live', tab: 'live', action: 'live-top', label: isZh ? '⚡ 实时归因' : '⚡ Live & TTFT' },
    { id: 'global-trend', tab: 'calls', action: 'global-trend', label: isZh ? '🌐 大盘折线' : '🌐 7d Curves' },
    { id: 'arena', tab: 'account', action: 'arena', label: isZh ? '⚔ 斗蛐蛐 PK' : '⚔ Arena PK' },
    { id: 'wrapped', tab: 'account', action: 'wrapped', label: isZh ? '✨ 战报海报' : '✨ 2x Poster' },
  ];

  return (
    <div
      id="live-demo"
      class="w-full scroll-mt-20 overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]"
      style={{ boxShadow: 'var(--hud-frame-shadow)' }}
    >
      {/* Antigravity Auxiliary Side-Pane Chrome */}
      <div class="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="flex items-center gap-1" aria-hidden="true">
            <span class="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
            <span class="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
            <span class="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          </span>
          <span class="inline-flex items-center gap-1.5 truncate font-mono text-[10.5px] font-medium text-[var(--muted)]">
            <span class="h-1.5 w-1.5 rounded-full bg-[var(--seg-cache)]" />
            <span class="truncate">{isZh ? '真实侧边栏组件 · 可直接交互' : 'Live Sidecar Panel · Real UI'}</span>
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          {canReturnToFeature && onReturnToFeature && (
            <button
              type="button"
              onClick={onReturnToFeature}
              class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--tint-accent-border)] bg-[var(--tint-accent)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-85"
            >
              <span>↩ {isZh ? '返回刚才位置' : 'Back'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCycleTheme}
            title={isZh ? '点击切换下一套 Antigravity 主题' : 'Click to cycle Antigravity theme'}
            class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--fg-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          >
            <span
              class="h-2 w-2 rounded-full"
              style={{ backgroundColor: theme.swatches[2] }}
            />
            <span class="max-w-[116px] truncate">{theme.name}</span>
            {contrast === 'strong' && (
              <span class="text-[9px] text-[var(--muted)]">HC</span>
            )}
          </button>
        </div>
      </div>

      {/* Real compiled `web/` HUD iframe driven by shared organic fixture + live host theme sync */}
      <iframe
        ref={iframeRef}
        src={`./hud-demo/index.html?lang=${initialLangRef.current}`}
        title={isZh ? 'AGY-HUD 真实交互面板预览' : 'AGY-HUD Real Interactive Panel Preview'}
        onLoad={syncFrame}
        class="block h-[660px] w-full border-0 bg-[var(--bg)]"
      />

      {/* Interactive Feature Jump Tour Bar */}
      <div class="grid grid-cols-4 gap-1 border-t border-[var(--border)] bg-[var(--bg-subtle)] p-1.5">
        {tourStops.map((stop) => {
          const active = activeStop === stop.id;
          return (
            <button
              key={stop.id}
              type="button"
              onClick={() => onJumpDemo(stop)}
              class={`cursor-pointer rounded-lg px-1.5 py-1.5 text-center text-[10.5px] font-semibold transition-all truncate ${
                active
                  ? 'border border-[var(--tint-accent-border)] bg-[var(--tint-accent)] text-[var(--accent-ink)]'
                  : 'border border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]'
              }`}
            >
              {stop.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
