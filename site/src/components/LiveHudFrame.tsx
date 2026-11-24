import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { Locale } from '../i18n/content';
import {
  buildHostThemePayload,
  type AgyTheme,
  type ContrastMode,
} from '../themes/agyThemes';

interface LiveHudFrameProps {
  locale: Locale;
  theme: AgyTheme;
  contrast: ContrastMode;
  onCycleTheme: () => void;
}

export function LiveHudFrame({ locale, theme, contrast, onCycleTheme }: LiveHudFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initialLangRef = useRef<Locale>(locale);
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

  return (
    <div
      class="w-full overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]"
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
          <span class="truncate font-mono text-[10.5px] font-medium text-[var(--muted)]">
            {isZh ? '真实侧边栏组件 · 实时联动' : 'Live Sidecar Panel · Real UI'}
          </span>
        </div>

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

      {/* Real compiled `web/` HUD iframe driven by shared organic fixture + live host theme sync */}
      <iframe
        ref={iframeRef}
        src={`./hud-demo/index.html?lang=${initialLangRef.current}`}
        title={isZh ? 'AGY-HUD 真实交互面板预览' : 'AGY-HUD Real Interactive Panel Preview'}
        onLoad={syncFrame}
        class="block h-[690px] w-full border-0 bg-[var(--bg)]"
      />
    </div>
  );
}
