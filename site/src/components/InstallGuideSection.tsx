import type { SiteCopy } from '../i18n/content';
import { InstallSwitcher } from './InstallSwitcher';

interface InstallGuideSectionProps {
  copy: SiteCopy;
}

export function InstallGuideSection({ copy }: InstallGuideSectionProps) {
  const g = copy.installGuide;

  return (
    <section id="install" class="scroll-mt-16 border-y border-[var(--border)] bg-[var(--surface)]/40 py-16 sm:py-22">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="font-mono text-[11.5px] font-semibold uppercase tracking-widest" style={{ color: 'var(--seg-cache)' }}>
            {g.kicker}
          </div>
          <h2 class="display-heading mt-2 text-2xl font-bold text-[var(--fg)] sm:text-4xl">
            {g.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{g.subtitle}</p>
        </div>

        <div class="mt-8 max-w-3xl">
          <InstallSwitcher copy={copy} />
        </div>

        {/* 3-Step Walkthrough Cards */}
        <div class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {g.steps.map((s) => (
            <div key={s.num} class="etched-card flex flex-col justify-between rounded-xl p-5">
              <div>
                <div class="font-mono text-[11px] font-bold" style={{ color: 'var(--accent-ink)' }}>
                  STEP {s.num}
                </div>
                <h3 class="mt-1.5 text-[15.5px] font-bold text-[var(--fg)]">{s.title}</h3>
                <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{s.desc}</p>
              </div>
              <div class="hud-scroll mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px] text-[var(--fg-2)]">
                <span class="select-none text-[var(--seg-cache)]">$ </span>
                <span class="whitespace-nowrap">{s.cmd}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Realistic Terminal Output Preview (--doctor + --check-update) */}
        <div class="etched-card mt-6 overflow-hidden rounded-2xl">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1.5" aria-hidden="true">
                <span class="h-2.5 w-2.5 rounded-full bg-[#ef4444]/75" />
                <span class="h-2.5 w-2.5 rounded-full bg-[#f59e0b]/75" />
                <span class="h-2.5 w-2.5 rounded-full bg-[#22c55e]/75" />
              </div>
              <span class="font-mono text-[11.5px] font-semibold text-[var(--fg-2)]">{g.doctorTitle}</span>
            </div>
            <span class="font-mono text-[10.5px] text-[var(--faint)]">{g.doctorSubtitle}</span>
          </div>

          <pre class="hud-scroll overflow-x-auto bg-[var(--surface)] p-4 font-mono text-[12px] leading-relaxed text-[var(--fg-2)] sm:p-5">
            <code>
              <span class="text-[var(--faint)]">$</span>{' '}
              <span class="text-[var(--fg)]">node plugin/install.mjs --doctor</span>
              {'\n'}
              <span class="text-[var(--muted)]">AGY-HUD Doctor (~/.gemini/config/plugins/agy-hud)</span>
              {'\n\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> platform: darwin (arm64, 24.4.0)
              {'\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> node: Node.js v22.18.0 (&gt;= 22.18 required) with built-in node:sqlite
              {'\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> antigravity_data: Detected ~/.gemini/antigravity/conversations (read-only OK)
              {'\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> agy_cli: Found agy CLI at /usr/local/bin/agy
              {'\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> plugin_install: Installed v1.2.0 (copy mode) with valid plugin.json &amp; sidecar
              {'\n'}
              {'  '}
              <span style={{ color: 'var(--seg-cache)' }}>[PASS]</span> ui_bundle: Pre-built UI bundle verified (index.html, app.js, styles.css)
              {'\n\n'}
              <span style={{ color: 'var(--seg-cache)' }} class="font-bold">
                Overall: HEALTHY (ready for Antigravity)
              </span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}
