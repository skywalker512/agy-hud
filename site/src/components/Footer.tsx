import type { SiteCopy } from '../i18n/content';
import { BrandLogo } from './Navbar';

interface FooterProps {
  copy: SiteCopy;
}

export function Footer({ copy }: FooterProps) {
  return (
    <footer class="border-t border-[var(--border)] bg-[var(--surface)]/50 py-12">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr]">
          {/* Brand & Meta */}
          <div>
            <a href="#top" class="inline-flex items-center gap-2.5 text-[var(--fg)] no-underline">
              <span class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
                <BrandLogo size={18} />
              </span>
              <span class="font-mono text-sm font-bold">AGY-HUD</span>
            </a>
            <p class="mt-3 max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
              {copy.footer.tagline}
            </p>
            <div class="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--faint)]">
              <span class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5">
                {copy.footer.nodeReq}
              </span>
              <span class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5">
                {copy.footer.license}
              </span>
            </div>
          </div>

          {/* Section Links */}
          <div>
            <div class="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {copy.footer.linksTitle}
            </div>
            <ul class="mt-3 space-y-2 text-[13px] text-[var(--fg-2)]">
              <li>
                <a href="#features" class="hover:text-[var(--fg)]">
                  {copy.nav.features}
                </a>
              </li>
              <li>
                <a href="#swarm" class="hover:text-[var(--fg)]">
                  {copy.nav.swarm}
                </a>
              </li>
              <li>
                <a href="#inspector" class="hover:text-[var(--fg)]">
                  {copy.nav.inspector}
                </a>
              </li>
              <li>
                <a href="#compare" class="hover:text-[var(--fg)]">
                  {copy.nav.compare}
                </a>
              </li>
              <li>
                <a href="#install" class="hover:text-[var(--fg)]">
                  {copy.nav.install}
                </a>
              </li>
              <li>
                <a href="#docs" class="hover:text-[var(--fg)]">
                  {copy.nav.docs}
                </a>
              </li>
            </ul>
          </div>

          {/* GitHub & Resources */}
          <div>
            <div class="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {copy.footer.resourcesTitle}
            </div>
            <ul class="mt-3 space-y-2 text-[13px] text-[var(--fg-2)]">
              <li>
                <a
                  href="https://github.com/skywalker512/agy-hud"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-[var(--fg)]"
                >
                  {copy.footer.repoLink} ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/skywalker512/agy-hud/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-[var(--fg)]"
                >
                  {copy.footer.releasesLink} ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/skywalker512/agy-hud/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-[var(--fg)]"
                >
                  {copy.footer.issuesLink} ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-6 font-mono text-[11px] text-[var(--faint)]">
          <span>© {new Date().getFullYear()} AGY-HUD Contributors · skywalker512/agy-hud</span>
          <span>Built with Preact + Tailwind CSS v4 · Zero Runtime Deps</span>
        </div>
      </div>
    </footer>
  );
}
