import type { Locale, SiteCopy } from '../i18n/content';
import { HeroSimulator } from './HeroSimulator';
import { IconArrowRight, IconCheck } from './Icons';

interface HeroSectionProps {
  locale: Locale;
  copy: SiteCopy;
}

export function HeroSection({ locale, copy }: HeroSectionProps) {
  return (
    <section id="top" class="relative overflow-hidden pt-12 pb-16 sm:pt-18 sm:pb-24">
      <div class="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(352px,404px)] lg:gap-14">
          {/* Left column: Editorial product pitch */}
          <div class="min-w-0">
            <div class="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12px] font-medium text-[var(--fg-2)]">
              <span
                class="animate-hud-pulse h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--seg-cache)' }}
              />
              <span>{copy.hero.badge}</span>
            </div>

            <h1 class="display-heading mt-6 text-[36px] leading-[1.08] font-bold text-[var(--fg)] sm:text-[48px] lg:text-[54px] lg:leading-[1.05]">
              {copy.hero.headline}
            </h1>

            <p class="mt-5 max-w-xl text-[15.5px] leading-[1.65] text-[var(--muted)] sm:text-[17px]">
              {copy.hero.subhead}
            </p>

            {/* Primary & Secondary CTAs */}
            <div class="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#install"
                class="inline-flex h-10 items-center gap-2 rounded-lg px-5 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-92"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <span>{copy.hero.primaryCta}</span>
                <IconArrowRight size={14} />
              </a>
              <a
                href="#craft"
                class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[13.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <span>{copy.hero.secondaryCta}</span>
              </a>
            </div>

            {/* Calm Trust Strip */}
            <div class="mt-9 border-t border-[var(--border)] pt-6">
              <ul class="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {copy.hero.trustItems.map((item) => (
                  <li key={item} class="flex items-center gap-2 text-[13px] text-[var(--fg-2)]">
                    <span
                      class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                    >
                      <IconCheck size={10} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right column: Upgraded Interactive HUD Simulator */}
          <div class="relative">
            <HeroSimulator locale={locale} copy={copy} />
            <p class="mt-3.5 text-center text-[12px] text-[var(--faint)]">
              {copy.hero.interactiveHint}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
