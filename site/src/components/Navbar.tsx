import { useState } from 'preact/hooks';
import type { Locale, SiteCopy } from '../i18n/content';
import { IconGitHub } from './Icons';

interface NavbarProps {
  locale: Locale;
  theme: 'dark' | 'light';
  copy: SiteCopy;
  onToggleLocale: () => void;
  onToggleTheme: () => void;
}

export function BrandLogo({ size = 20 }: { size?: number }) {
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

export function Navbar({ locale, theme, copy, onToggleLocale, onToggleTheme }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { href: '#tour', label: copy.nav.tour },
    { href: '#craft', label: copy.nav.craft },
    { href: '#install', label: copy.nav.install },
    { href: '#docs', label: copy.nav.docs },
  ];

  return (
    <header class="glass-nav sticky top-0 z-50">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <a
          href="#top"
          class="group flex items-center gap-2.5 text-[var(--fg)] no-underline"
          onClick={() => setMobileOpen(false)}
        >
          <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-colors group-hover:border-[var(--border-strong)]">
            <BrandLogo size={17} />
          </span>
          <span class="text-[14px] font-semibold tracking-tight">AGY-HUD</span>
          <span class="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[10px] font-medium text-[var(--muted)] tabular-nums">
            v1.2
          </span>
        </a>

        {/* Desktop anchors: clean, minimal, 4 clear stops */}
        <nav aria-label="Primary" class="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              class="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Controls */}
        <div class="flex items-center gap-1.5">
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

          <button
            type="button"
            onClick={onToggleTheme}
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            aria-label={theme === 'dark' ? copy.nav.themeLight : copy.nav.themeDark}
            title={theme === 'dark' ? copy.nav.themeLight : copy.nav.themeDark}
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
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

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              {mobileOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div class="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:hidden">
          <div class="grid grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                class="rounded-md bg-[var(--surface-2)] px-3 py-2 text-[13px] font-medium text-[var(--fg-2)] hover:text-[var(--fg)]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
