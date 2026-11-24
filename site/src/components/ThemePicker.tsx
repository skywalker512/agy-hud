import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from '../i18n/content';
import {
  AGY_DARK_THEMES,
  AGY_LIGHT_THEMES,
  AGY_THEMES,
  type AgyTheme,
  type ContrastMode,
} from '../themes/agyThemes';
import { IconCheck } from './Icons';

interface ThemePickerProps {
  locale: Locale;
  activeTheme: AgyTheme;
  contrast: ContrastMode;
  onSelectTheme: (themeId: string) => void;
  onPreviewTheme: (themeId: string | null) => void;
  onSelectContrast: (contrast: ContrastMode) => void;
}

function ThemeSwatch({ swatches, size = 'md' }: { swatches: [string, string, string, string]; size?: 'sm' | 'md' }) {
  const [bg, surface, accent, secondary] = swatches;
  const cls = size === 'sm' ? 'h-4 w-5 rounded-[4px]' : 'h-4.5 w-6 rounded-[5px]';
  return (
    <span
      class={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/15 ${cls}`}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      <span
        class="absolute inset-y-0 right-0 w-[56%]"
        style={{ backgroundColor: surface }}
      />
      <span
        class="relative z-10 flex items-center gap-[2px]"
      >
        <span class="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: accent }} />
        <span class="h-[4px] w-[4px] rounded-full opacity-90" style={{ backgroundColor: secondary }} />
      </span>
    </span>
  );
}

export function ThemePicker({
  locale,
  activeTheme,
  contrast,
  onSelectTheme,
  onPreviewTheme,
  onSelectContrast,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isZh = locale === 'zh';

  useEffect(() => {
    if (!open) {
      onPreviewTheme(null);
      setFocusedIdx(-1);
      return;
    }

    const activeIdx = AGY_THEMES.findIndex((t) => t.id === activeTheme.id);
    setFocusedIdx(activeIdx);

    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((prev) => {
          const next = (prev + 1 + AGY_THEMES.length) % AGY_THEMES.length;
          onPreviewTheme(AGY_THEMES[next].id);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((prev) => {
          const next = (prev - 1 + AGY_THEMES.length) % AGY_THEMES.length;
          onPreviewTheme(AGY_THEMES[next].id);
          return next;
        });
      } else if (e.key === 'Enter' && focusedIdx >= 0 && AGY_THEMES[focusedIdx]) {
        e.preventDefault();
        onSelectTheme(AGY_THEMES[focusedIdx].id);
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, activeTheme.id, focusedIdx, onPreviewTheme, onSelectTheme]);

  const handleChoose = (id: string) => {
    onSelectTheme(id);
    onPreviewTheme(null);
    setOpen(false);
  };

  const renderGroup = (title: string, items: readonly AgyTheme[], baseIndex: number) => (
    <div class="py-1">
      <div class="px-2.5 pt-1 pb-1 text-[10px] font-semibold tracking-[0.06em] text-[var(--faint)] uppercase">
        {title}
      </div>
      <div class="flex flex-col gap-px px-1">
        {items.map((item, idx) => {
          const globalIdx = baseIndex + idx;
          const isSelected = item.id === activeTheme.id;
          const isFocused = globalIdx === focusedIdx;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => {
                setFocusedIdx(globalIdx);
                onPreviewTheme(item.id);
              }}
              onClick={() => handleChoose(item.id)}
              class={`flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                isSelected
                  ? 'bg-[var(--surface-2)] font-medium text-[var(--fg)]'
                  : isFocused
                    ? 'bg-[var(--surface-2)]/75 text-[var(--fg)]'
                    : 'text-[var(--fg-2)] hover:bg-[var(--surface-2)]/75 hover:text-[var(--fg)]'
              }`}
            >
              <span class="flex min-w-0 items-center gap-2.5">
                <ThemeSwatch swatches={item.swatches} />
                <span class="truncate">{item.name}</span>
              </span>
              {isSelected && (
                <span class="shrink-0 text-[var(--accent-ink)]">
                  <IconCheck size={13} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} class="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isZh ? '切换 Antigravity 主题' : 'Switch Antigravity Theme'}
        class="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--fg-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
      >
        <ThemeSwatch swatches={activeTheme.swatches} size="sm" />
        <span class="hidden max-w-[116px] truncate sm:inline">{activeTheme.name}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={`shrink-0 text-[var(--muted)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={isZh ? 'Antigravity 主题选择' : 'Antigravity Theme Selector'}
          class="agy-theme-popover absolute right-0 top-[calc(100%+6px)] z-50 w-[238px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)]"
          onMouseLeave={() => onPreviewTheme(null)}
        >
          <div class="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span class="text-[11px] font-semibold text-[var(--fg)]">
              {isZh ? 'Antigravity 主题' : 'Antigravity Theme'}
            </span>
            <span class="font-mono text-[10px] text-[var(--muted)]">
              {isZh ? '悬停预览' : 'Hover preview'}
            </span>
          </div>

          <div ref={listRef} class="agy-theme-scroll max-h-[340px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
            {renderGroup(isZh ? `深色主题 (${AGY_DARK_THEMES.length})` : `Dark (${AGY_DARK_THEMES.length})`, AGY_DARK_THEMES, 0)}
            {renderGroup(
              isZh ? `浅色主题 (${AGY_LIGHT_THEMES.length})` : `Light (${AGY_LIGHT_THEMES.length})`,
              AGY_LIGHT_THEMES,
              AGY_DARK_THEMES.length,
            )}
          </div>

          <div class="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-2">
            <span class="text-[11px] font-medium text-[var(--muted)]">
              {isZh ? '对比度' : 'Contrast'}
            </span>
            <div class="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => onSelectContrast('default')}
                class={`cursor-pointer rounded px-2 py-0.5 font-medium transition-colors ${
                  contrast === 'default'
                    ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                {isZh ? '默认' : 'Default'}
              </button>
              <button
                type="button"
                onClick={() => onSelectContrast('strong')}
                class={`cursor-pointer rounded px-2 py-0.5 font-medium transition-colors ${
                  contrast === 'strong'
                    ? 'bg-[var(--surface-2)] text-[var(--fg)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                {isZh ? '强对比' : 'Strong'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
