import type { Locale, SiteCopy } from '../i18n/content';
import { IconShield, IconTerminal } from './Icons';
import { InstallSwitcher } from './InstallSwitcher';

interface InstallGuideSectionProps {
  locale: Locale;
  copy: SiteCopy;
}

export function InstallGuideSection({ locale, copy }: InstallGuideSectionProps) {
  const g = copy.installGuide;

  return (
    <section id="install" class="scroll-mt-16 py-20 sm:py-28">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="text-[12.5px] font-semibold tracking-wide text-[var(--seg-cache)]">
            {g.kicker}
          </div>
          <h2 class="display-heading mt-2.5 text-[28px] leading-[1.15] font-bold text-[var(--fg)] sm:text-[38px]">
            {g.title}
          </h2>
          <p class="mt-3.5 text-[15.5px] leading-relaxed text-[var(--muted)]">{g.subtitle}</p>
        </div>

        {/* Tabbed Install Switcher: macOS/Linux · Windows · AI Agent · Manual */}
        <div class="mt-10 max-w-3xl">
          <InstallSwitcher locale={locale} copy={copy} />
        </div>

        {/* Security & Privacy Reassurance */}
        <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {g.reassurance.map((r) => (
            <div key={r.title} class="surface-card rounded-xl p-5">
              <div class="flex items-center gap-2 text-[var(--fg)]">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-md"
                  style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                >
                  <IconShield size={13} />
                </span>
                <h3 class="text-[14px] font-semibold">{r.title}</h3>
              </div>
              <p class="mt-2.5 text-[13px] leading-relaxed text-[var(--muted)]">{r.desc}</p>
            </div>
          ))}
        </div>

        {/* 3-Step Walkthrough */}
        <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {g.steps.map((s) => (
            <div key={s.num} class="surface-card flex flex-col justify-between rounded-xl p-5">
              <div>
                <div class="font-mono text-[11px] font-semibold text-[var(--faint)]">
                  {s.num}
                </div>
                <h3 class="mt-1 text-[15px] font-semibold text-[var(--fg)]">{s.title}</h3>
                <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{s.desc}</p>
              </div>
              <div class="hud-scroll mt-4 overflow-x-auto rounded-lg bg-[var(--surface-2)] px-3 py-2 font-mono text-[11px] text-[var(--fg-2)]">
                <span class="select-none text-[var(--seg-cache)]">$ </span>
                <span class="whitespace-nowrap">{s.cmd}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Clean --doctor Output Preview */}
        <div class="surface-card mt-6 overflow-hidden rounded-2xl">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)]/70 px-4 py-2.5">
            <div class="flex items-center gap-2 text-[var(--fg-2)]">
              <IconTerminal size={13} />
              <span class="font-mono text-[11.5px] font-medium">{g.doctorTitle}</span>
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
              <span style={{ color: 'var(--seg-cache)' }} class="font-semibold">
                Overall: HEALTHY (ready for Antigravity)
              </span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}
