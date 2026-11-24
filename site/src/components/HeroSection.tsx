import type { Locale, SiteCopy } from '../i18n/content';
import type { AgyTheme, ContrastMode } from '../themes/agyThemes';
import { InstallSwitcher } from './InstallSwitcher';
import { LiveHudFrame } from './LiveHudFrame';

interface HeroSectionProps {
  locale: Locale;
  theme: AgyTheme;
  contrast: ContrastMode;
  copy: SiteCopy;
  onCycleTheme: () => void;
}

export function HeroSection({ locale, theme, contrast, copy, onCycleTheme }: HeroSectionProps) {
  return (
    <section id="top" class="relative pt-10 pb-16 sm:pt-14 sm:pb-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-12 lg:grid-cols-[minmax(0,1.06fr)_minmax(380px,426px)] lg:gap-14">
          {/* Left column: Quiet, confident product pitch + immediate install */}
          <div class="min-w-0">
            <h1 class="display-heading text-[36px] leading-[1.08] font-bold text-[var(--fg)] sm:text-[48px] lg:text-[54px] lg:leading-[1.05]">
              {copy.hero.headline}
            </h1>

            <p class="mt-5 max-w-xl text-[15.5px] leading-[1.7] text-[var(--muted)] sm:text-[17px]">
              {copy.hero.subhead}
            </p>

            {/* Immediate 1-line install right in the Hero */}
            <div id="install" class="mt-8 max-w-xl scroll-mt-24">
              <InstallSwitcher locale={locale} copy={copy} />
            </div>

            <p class="mt-4 font-mono text-[11.5px] text-[var(--faint)]">
              {copy.hero.meta}
            </p>
          </div>

          {/* Right column: 100% Real Embedded AGY-HUD Sidecar UI */}
          <div class="relative">
            <LiveHudFrame
              locale={locale}
              theme={theme}
              contrast={contrast}
              onCycleTheme={onCycleTheme}
            />
            <p class="mt-3 text-center text-[12px] text-[var(--faint)]">
              {copy.hero.interactiveHint}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
