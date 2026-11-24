import type { Locale, SiteCopy } from '../i18n/content';
import { AGY_DARK_THEMES, AGY_LIGHT_THEMES, type AgyTheme, type ContrastMode } from '../themes/agyThemes';
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
  onPreviewTheme: (themeId: string | null) => void;
  onJumpDemo: (req: DemoJumpRequest) => void;
}

export function HeroSection({
  locale,
  theme,
  activeThemeId,
  contrast,
  copy,
  demoJump,
  onCycleTheme,
  onSelectTheme,
  onPreviewTheme,
  onJumpDemo,
}: HeroSectionProps) {
  const isZh = locale === 'zh';

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

            {/* Sleek 1-Row 16-Theme Interactive Swatch Dock (12 Dark | 4 Light, hover-to-preview) */}
            <div class="mt-6 max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)]/75 px-3.5 py-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2 text-[11.5px]">
                  <span class="font-medium text-[var(--muted)]">
                    {isZh ? '16 套官方主题' : '16 Official Themes'}
                  </span>
                  <span class="text-[var(--faint)]">·</span>
                  <span class="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[var(--fg)]">
                    <span
                      class="h-2 w-2 rounded-full"
                      style={{ backgroundColor: theme.swatches[2] }}
                    />
                    <span>{theme.name}</span>
                    <span class="font-normal text-[var(--faint)]">
                      {theme.mode === 'dark' ? (isZh ? '深色' : 'Dark') : (isZh ? '浅色' : 'Light')}
                    </span>
                  </span>
                </div>
                <span class="font-mono text-[10px] text-[var(--faint)]">
                  {isZh ? '滑过预览 · 点击锁定' : 'Hover · Click'}
                </span>
              </div>

              <div
                class="mt-2.5 flex flex-wrap items-center gap-1.5"
                role="radiogroup"
                aria-label={copy.hero.themeStripLabel}
                onMouseLeave={() => onPreviewTheme(null)}
              >
                {AGY_DARK_THEMES.map((th) => {
                  const isActive = activeThemeId === th.id;
                  const isPreviewed = theme.id === th.id;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={`${th.name} (${isZh ? '深色' : 'Dark'})`}
                      title={th.name}
                      onClick={() => onSelectTheme(th.id)}
                      onMouseEnter={() => onPreviewTheme(th.id)}
                      onFocus={() => onPreviewTheme(th.id)}
                      onBlur={() => onPreviewTheme(null)}
                      class={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        isActive
                          ? 'scale-110 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]'
                          : isPreviewed
                            ? 'scale-120 ring-1 ring-[var(--border-strong)]'
                            : 'hover:scale-120'
                      }`}
                    >
                      <span
                        class="h-[18px] w-[18px] rounded-full border border-white/20 shadow-xs"
                        style={{
                          background: `linear-gradient(135deg, ${th.swatches[0]} 48%, ${th.swatches[2]} 52%)`,
                        }}
                      />
                    </button>
                  );
                })}

                <span
                  class="mx-1 h-4 w-px shrink-0 bg-[var(--border-strong)]"
                  aria-hidden="true"
                />

                {AGY_LIGHT_THEMES.map((th) => {
                  const isActive = activeThemeId === th.id;
                  const isPreviewed = theme.id === th.id;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={`${th.name} (${isZh ? '浅色' : 'Light'})`}
                      title={th.name}
                      onClick={() => onSelectTheme(th.id)}
                      onMouseEnter={() => onPreviewTheme(th.id)}
                      onFocus={() => onPreviewTheme(th.id)}
                      onBlur={() => onPreviewTheme(null)}
                      class={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        isActive
                          ? 'scale-110 ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]'
                          : isPreviewed
                            ? 'scale-120 ring-1 ring-[var(--border-strong)]'
                            : 'hover:scale-120'
                      }`}
                    >
                      <span
                        class="h-[18px] w-[18px] rounded-full border border-black/20 shadow-xs"
                        style={{
                          background: `linear-gradient(135deg, ${th.swatches[0]} 48%, ${th.swatches[2]} 52%)`,
                        }}
                      />
                    </button>
                  );
                })}
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
