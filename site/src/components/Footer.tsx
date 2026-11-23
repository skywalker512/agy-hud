import type { SiteCopy } from '../i18n/content';
import { IconArrowUpRight } from './Icons';
import { BrandLogo } from './Navbar';

interface FooterProps {
  copy: SiteCopy;
}

export function Footer({ copy }: FooterProps) {
  return (
    <footer class="border-t border-[var(--border)] bg-[var(--bg-subtle)]/50 py-14">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <a href="#top" class="inline-flex items-center gap-2.5 text-[var(--fg)] no-underline">
              <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <BrandLogo size={16} />
              </span>
              <span class="text-[14px] font-semibold tracking-tight">AGY-HUD</span>
            </a>
            <p class="mt-3 max-w-sm text-[13.5px] leading-relaxed text-[var(--muted)]">
              {copy.footer.tagline}
            </p>
            <div class="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--faint)]">
              <span class="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
                {copy.footer.nodeReq}
              </span>
              <span class="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5">
                {copy.footer.license}
              </span>
            </div>
          </div>

          <div>
            <div class="text-[12px] font-semibold text-[var(--fg-2)]">
              {copy.footer.linksTitle}
            </div>
            <ul class="mt-3 space-y-2 text-[13px] text-[var(--muted)]">
              <li>
                <a href="#tour" class="transition-colors hover:text-[var(--fg)]">
                  {copy.nav.tour}
                </a>
              </li>
              <li>
                <a href="#craft" class="transition-colors hover:text-[var(--fg)]">
                  {copy.nav.craft}
                </a>
              </li>
              <li>
                <a href="#install" class="transition-colors hover:text-[var(--fg)]">
                  {copy.nav.install}
                </a>
              </li>
              <li>
                <a href="#docs" class="transition-colors hover:text-[var(--fg)]">
                  {copy.nav.docs}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div class="text-[12px] font-semibold text-[var(--fg-2)]">
              {copy.footer.resourcesTitle}
            </div>
            <ul class="mt-3 space-y-2 text-[13px] text-[var(--muted)]">
              {[
                { label: copy.footer.repoLink, href: 'https://github.com/skywalker512/agy-hud' },
                { label: copy.footer.releasesLink, href: 'https://github.com/skywalker512/agy-hud/releases' },
                { label: copy.footer.changelogLink, href: 'https://github.com/skywalker512/agy-hud/blob/main/CHANGELOG.md' },
                { label: copy.footer.issuesLink, href: 'https://github.com/skywalker512/agy-hud/issues' },
              ].map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 transition-colors hover:text-[var(--fg)]"
                  >
                    <span>{link.label}</span>
                    <IconArrowUpRight size={12} class="text-[var(--faint)]" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-6 text-[12px] text-[var(--faint)]">
          <span>© {new Date().getFullYear()} AGY-HUD Contributors · skywalker512/agy-hud</span>
          <span class="font-mono text-[11px]">Pure Official Sidecar · Zero Runtime Deps</span>
        </div>
      </div>
    </footer>
  );
}
