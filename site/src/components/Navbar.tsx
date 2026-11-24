import type { Locale, SiteCopy } from '../i18n/content';
import type { AgyTheme, ContrastMode } from '../themes/agyThemes';
import { IconArrowUpRight, IconGitHub } from './Icons';
import { ThemePicker } from './ThemePicker';

interface NavbarProps {
  locale: Locale;
  activeTheme: AgyTheme;
  contrast: ContrastMode;
  copy: SiteCopy;
  onToggleLocale: () => void;
  onSelectTheme: (themeId: string) => void;
  onPreviewTheme: (themeId: string | null) => void;
  onSelectContrast: (contrast: ContrastMode) => void;
}

export function BrandLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 17a9 9 0 1 1 16 0" stroke="var(--seg-cache)" />
      <path d="M7.5 14.5A5.5 5.5 0 0 1 16.5 14.5" stroke="var(--accent)" stroke-dasharray="2 2" />
      <path d="M12 15l3.8-4.2" stroke="var(--accent-ink)" />
      <circle cx="12" cy="15" r="1.4" fill="var(--accent-ink)" stroke="none" />
      <path d="M8 19h8" stroke="var(--faint)" />
    </svg>
  );
}

export function Navbar({
  locale,
  activeTheme,
  contrast,
  copy,
  onToggleLocale,
  onSelectTheme,
  onPreviewTheme,
  onSelectContrast,
}: NavbarProps) {
  const guideHref =
    locale === 'zh'
      ? 'https://github.com/skywalker512/agy-hud/blob/main/docs/GUIDE.zh-CN.md'
      : 'https://github.com/skywalker512/agy-hud/blob/main/docs/GUIDE.md';

  return (
    <header class="glass-nav sticky top-0 z-50">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div class="flex items-center gap-6">
          <a href="#top" class="flex items-center gap-2 text-[var(--fg)] no-underline">
            <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <BrandLogo size={16} />
            </span>
            <span class="text-[14px] font-semibold tracking-tight">AGY-HUD</span>
          </a>

          <nav aria-label="Primary" class="hidden items-center gap-1 md:flex">
            <a
              href="#overview"
              class="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            >
              {copy.nav.overview}
            </a>
            <a
              href="#credits"
              class="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            >
              {copy.nav.credits}
            </a>
            <a
              href={guideHref}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            >
              <span>{copy.nav.docs}</span>
              <IconArrowUpRight size={12} class="text-[var(--faint)]" />
            </a>
          </nav>
        </div>

        <div class="flex items-center gap-1.5">
          <ThemePicker
            locale={locale}
            activeTheme={activeTheme}
            contrast={contrast}
            onSelectTheme={onSelectTheme}
            onPreviewTheme={onPreviewTheme}
            onSelectContrast={onSelectContrast}
          />

          <button
            type="button"
            onClick={onToggleLocale}
            class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            title={locale === 'en' ? '切换为简体中文' : 'Switch to English'}
          >
            <span class={locale === 'en' ? 'font-semibold text-[var(--fg)]' : ''}>EN</span>
            <span class="text-[var(--faint)]">/</span>
            <span class={locale === 'zh' ? 'font-semibold text-[var(--fg)]' : ''}>中文</span>
          </button>

          <a
            href="https://github.com/skywalker512/agy-hud"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12.5px] font-medium text-[var(--fg)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
          >
            <IconGitHub size={14} />
            <span class="hidden sm:inline">{copy.nav.github}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
