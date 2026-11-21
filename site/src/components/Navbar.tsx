import { useState } from 'preact/hooks';
import type { Locale, SiteCopy } from '../i18n/content';

interface NavbarProps {
  locale: Locale;
  theme: 'dark' | 'light';
  copy: SiteCopy;
  onToggleLocale: () => void;
  onToggleTheme: () => void;
}

export function BrandLogo({ size = 24 }: { size?: number }) {
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
      <path d="M4 17a9 9 0 1 1 16 0" stroke="#22c55e" />
      <path d="M7.5 14.5A5.5 5.5 0 0 1 16.5 14.5" stroke="#3b82f6" stroke-dasharray="2 2" />
      <path d="M12 15l3.8-4.2" stroke="#38bdf8" />
      <circle cx="12" cy="15" r="1.4" fill="#38bdf8" stroke="none" />
      <path d="M8 19h8" stroke="#64748b" />
    </svg>
  );
}

export function Navbar({ locale, theme, copy, onToggleLocale, onToggleTheme }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { href: '#features', label: copy.nav.features },
    { href: '#swarm', label: copy.nav.swarm },
    { href: '#inspector', label: copy.nav.inspector },
    { href: '#compare', label: copy.nav.compare },
    { href: '#install', label: copy.nav.install },
    { href: '#docs', label: copy.nav.docs },
  ];

  return (
    <header class="glass-nav sticky top-0 z-50">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Left: Brand */}
        <a
          href="#top"
          class="group flex items-center gap-2.5 text-[var(--fg)] no-underline"
          onClick={() => setMobileOpen(false)}
        >
          <span class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] transition-colors group-hover:border-[var(--border-strong)]">
            <BrandLogo size={20} />
          </span>
          <span class="font-mono text-sm font-bold tracking-tight">AGY-HUD</span>
          <span
            class="rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
            style={{
              backgroundColor: 'var(--tint-accent)',
              borderColor: 'var(--tint-accent-border)',
              color: 'var(--accent-ink)',
            }}
          >
            v1.2
          </span>
        </a>

        {/* Center: Desktop nav */}
        <nav aria-label="Primary" class="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              class="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Right: Controls */}
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleLocale}
            class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 font-mono text-[11px] font-medium text-[var(--fg-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            title={locale === 'en' ? '切换为简体中文' : 'Switch to English'}
          >
            <span class={locale === 'en' ? 'font-bold text-[var(--fg)]' : 'text-[var(--faint)]'}>EN</span>
            <span class="text-[var(--faint)]">/</span>
            <span class={locale === 'zh' ? 'font-bold text-[var(--fg)]' : 'text-[var(--faint)]'}>中文</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            aria-label={theme === 'dark' ? copy.nav.themeLight : copy.nav.themeDark}
            title={theme === 'dark' ? copy.nav.themeLight : copy.nav.themeDark}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </button>

          <a
            href="https://github.com/skywalker512/agy-hud"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[12px] font-semibold text-[var(--fg)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.07.78 2.16v3.2c0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
            <span class="hidden sm:inline">{copy.nav.github}</span>
            <span class="text-[11px]" style={{ color: 'var(--seg-out)' }}>★</span>
          </a>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-2)] md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              {mobileOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      {mobileOpen && (
        <div class="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:hidden">
          <div class="grid grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                class="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-medium text-[var(--fg-2)] hover:text-[var(--fg)]"
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
