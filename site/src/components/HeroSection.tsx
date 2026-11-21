import type { Locale, SiteCopy } from '../i18n/content';
import { HeroSimulator } from './HeroSimulator';
import { InstallSwitcher } from './InstallSwitcher';

interface HeroSectionProps {
  locale: Locale;
  copy: SiteCopy;
}

export function HeroSection({ locale, copy }: HeroSectionProps) {
  return (
    <section id="top" class="relative overflow-hidden pt-10 pb-14 sm:pt-14 sm:pb-20">
      {/* Subtle architectural grid backdrop */}
      <div class="site-grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />

      <div class="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(350px,396px)] lg:gap-12">
          {/* Left column: Copy + OS Install Switcher */}
          <div class="min-w-0">
            <div
              class="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] font-medium"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border-strong)',
                color: 'var(--fg-2)',
              }}
            >
              <span class="animate-hud-pulse h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-cache)' }} />
              <span>{copy.hero.eyebrow}</span>
            </div>

            <h1 class="display-heading mt-5 text-4xl font-extrabold tracking-tight text-[var(--fg)] sm:text-5xl lg:text-[54px] lg:leading-[1.05]">
              {copy.hero.headline}
            </h1>

            <p class="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--muted)] sm:text-[16.5px]">
              {copy.hero.subhead}
            </p>

            {/* OS-auto-detected Install Switcher */}
            <div class="mt-7 max-w-xl">
              <InstallSwitcher copy={copy} />
            </div>

            {/* Secondary action links */}
            <div class="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="#install"
                class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <span>{copy.hero.primaryCta}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </a>
              <a
                href="#docs"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <span>{copy.hero.secondaryCta}</span>
              </a>
            </div>
          </div>

          {/* Right column: Interactive 3-Tab Live AGY-HUD Simulator */}
          <div class="relative">
            <div
              class="pointer-events-none absolute -inset-6 -z-10 rounded-3xl opacity-70 blur-3xl"
              style={{
                background:
                  'radial-gradient(circle at 30% 20%, var(--glow-blue), transparent 62%), radial-gradient(circle at 80% 75%, var(--glow-violet), transparent 60%)',
              }}
              aria-hidden="true"
            />
            <HeroSimulator locale={locale} copy={copy} />
            <p class="mt-3 text-center font-mono text-[11px] text-[var(--muted)]">
              {copy.hero.interactiveHint}
            </p>
          </div>
        </div>

        {/* 4-Column Metrics Proof Strip */}
        <div class="mt-14 grid grid-cols-2 gap-3 sm:mt-16 lg:grid-cols-4">
          {copy.proof.map((item, idx) => (
            <div key={item.label} class="etched-card rounded-xl p-4 sm:p-5">
              <div
                class="font-mono text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl"
                style={{
                  color:
                    idx === 0
                      ? 'var(--seg-cache)'
                      : idx === 1
                        ? 'var(--seg-input)'
                        : idx === 2
                          ? 'var(--fg)'
                          : 'var(--seg-think)',
                }}
              >
                {item.value}
              </div>
              <div class="mt-1 text-[13.5px] font-semibold text-[var(--fg)]">{item.label}</div>
              <div class="mt-1 text-[12px] leading-snug text-[var(--muted)]">{item.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
