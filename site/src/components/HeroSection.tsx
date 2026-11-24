import type { Locale, SiteCopy } from '../i18n/content';
import { AGY_THEMES, type AgyTheme, type ContrastMode } from '../themes/agyThemes';
import { InstallSwitcher } from './InstallSwitcher';
import { LiveHudFrame, type DemoJumpCmd, type DemoJumpRequest } from './LiveHudFrame';

interface HeroSectionProps {
  locale: Locale;
  theme: AgyTheme;
  activeThemeId: string;
  contrast: ContrastMode;
  copy: SiteCopy;
  demoJump: DemoJumpCmd | null;
  onCycleTheme: () => void;
  onSelectTheme: (themeId: string) => void;
  onJumpDemo: (req: DemoJumpRequest) => void;
}

const FEATURED_THEME_IDS = [
  'tokyo-night',
  'default-dark',
  'dracula',
  'catppuccin-mocha',
  'github-dark',
  'nord',
  'default-light',
  'solarized-light',
];

export function HeroSection({
  locale,
  theme,
  activeThemeId,
  contrast,
  copy,
  demoJump,
  onCycleTheme,
  onSelectTheme,
  onJumpDemo,
}: HeroSectionProps) {
  const isZh = locale === 'zh';
  const featuredThemes = FEATURED_THEME_IDS.map((id) => AGY_THEMES.find((t) => t.id === id)).filter(
    (t): t is AgyTheme => Boolean(t),
  );

  return (
    <section id="top" class="relative pt-8 pb-16 sm:pt-12 sm:pb-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid items-center gap-10 lg:grid-cols-[minmax(0,1.06fr)_minmax(380px,432px)] lg:gap-14">
          {/* Left column: Confident release pitch + immediate install + 16-theme quick swatch bar */}
          <div class="min-w-0">
            <div class="mb-5 flex flex-wrap items-center gap-2">
              <a
                href="#overview"
                class="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-[11.5px] font-medium text-[var(--fg-2)] no-underline transition-colors hover:border-[var(--accent)]"
              >
                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--seg-cache)]" />
                <span class="truncate font-mono">{copy.hero.badge}</span>
              </a>
              <a
                href="./pulse/"
                class="inline-flex items-center gap-1.5 rounded-full border border-[var(--seg-cache)]/45 bg-[var(--seg-cache)]/10 px-3 py-1 text-[11.5px] font-semibold text-[var(--fg)] no-underline transition-colors hover:border-[var(--seg-cache)]"
              >
                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--seg-cache)]" />
                <span>{copy.hero.pulseCta} →</span>
              </a>
            </div>

            <h1 class="display-heading text-[36px] leading-[1.08] font-bold text-[var(--fg)] sm:text-[48px] lg:text-[54px] lg:leading-[1.05]">
              {copy.hero.headline}
            </h1>

            <p class="mt-5 max-w-xl text-[15.5px] leading-[1.7] text-[var(--muted)] sm:text-[16.5px]">
              {copy.hero.subhead}
            </p>

            {/* Immediate 1-line install right in the Hero */}
            <div id="install" class="mt-7 max-w-xl scroll-mt-24">
              <InstallSwitcher locale={locale} copy={copy} />
            </div>

            <p class="mt-3.5 font-mono text-[11.5px] text-[var(--faint)]">
              {copy.hero.meta}
            </p>

            {/* Interactive 16-Theme Quick Swatch Strip */}
            <div class="mt-6 flex flex-wrap items-center gap-2">
              <span class="text-[11.5px] font-medium text-[var(--muted)]">
                {copy.hero.themeStripLabel}:
              </span>
              <div class="flex flex-wrap items-center gap-1.5">
                {featuredThemes.map((th) => {
                  const isActive = activeThemeId === th.id;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      onClick={() => onSelectTheme(th.id)}
                      title={th.name}
                      class={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-all ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--tint-accent)] text-[var(--fg)]'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'
                      }`}
                    >
                      <span
                        class="h-2.5 w-2.5 rounded-full border border-black/15"
                        style={{
                          background: `linear-gradient(135deg, ${th.swatches[0]} 45%, ${th.swatches[2]} 55%)`,
                        }}
                      />
                      <span class="hidden sm:inline">{th.name}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={onCycleTheme}
                  class="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                  title={isZh ? '随机切换更多官方主题' : 'Cycle all 16 Antigravity themes'}
                >
                  +{AGY_THEMES.length - featuredThemes.length} ↻
                </button>
              </div>
            </div>
          </div>

          {/* Right column: 100% Real Embedded AGY-HUD Sidecar UI with interactive feature tour */}
          <div class="relative">
            <LiveHudFrame
              locale={locale}
              theme={theme}
              contrast={contrast}
              jumpCmd={demoJump}
              onCycleTheme={onCycleTheme}
              onJumpDemo={onJumpDemo}
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
