import type { Locale, SiteCopy } from '../i18n/content';
import { IconArrowUpRight } from './Icons';
import { BrandLogo } from './Navbar';

interface FooterProps {
  locale: Locale;
  copy: SiteCopy;
}

export function Footer({ locale, copy }: FooterProps) {
  const isZh = locale === 'zh';
  const guideHref = isZh
    ? 'https://github.com/skywalker512/agy-hud/blob/main/docs/GUIDE.zh-CN.md'
    : 'https://github.com/skywalker512/agy-hud/blob/main/docs/GUIDE.md';
  const installHref = isZh
    ? 'https://github.com/skywalker512/agy-hud/blob/main/docs/INSTALLATION.zh-CN.md'
    : 'https://github.com/skywalker512/agy-hud/blob/main/docs/INSTALLATION.md';

  const links = [
    { label: copy.footer.guideLink, href: guideHref },
    { label: copy.footer.installGuideLink, href: installHref },
    { label: copy.footer.changelogLink, href: 'https://github.com/skywalker512/agy-hud/blob/main/CHANGELOG.md' },
    { label: copy.footer.releasesLink, href: 'https://github.com/skywalker512/agy-hud/releases' },
    { label: copy.footer.issuesLink, href: 'https://github.com/skywalker512/agy-hud/issues' },
  ];

  return (
    <footer class="border-t border-[var(--border)] bg-[var(--bg-subtle)]/45">
      {/* Credits & Inspirations */}
      <section id="credits" class="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div class="max-w-xl">
          <h2 class="display-heading text-[18px] font-semibold text-[var(--fg)] sm:text-[20px]">
            {copy.credits.heading}
          </h2>
          <p class="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
            {copy.credits.lead}
          </p>
        </div>

        <ul class="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {copy.credits.items.map((item) => (
            <li
              key={item.name}
              class="flex flex-col justify-between gap-1 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex shrink-0 items-center gap-1 font-mono text-[13px] font-medium text-[var(--fg)] no-underline transition-colors hover:text-[var(--accent-ink)]"
              >
                <span>{item.name}</span>
                <IconArrowUpRight size={12} class="text-[var(--faint)]" />
              </a>
              <span class="text-[13px] text-[var(--muted)] sm:text-right">{item.role}</span>
            </li>
          ))}
        </ul>

        {/* Minimal Footer Bar */}
        <div class="mt-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div class="flex items-center gap-2.5 text-[13px] text-[var(--muted)]">
            <span class="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)]">
              <BrandLogo size={14} />
            </span>
            <span class="font-semibold text-[var(--fg)]">AGY-HUD</span>
            <span class="text-[var(--faint)]">·</span>
            <span>{copy.footer.note}</span>
          </div>

          <nav aria-label="Footer" class="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--muted)]">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                class="transition-colors hover:text-[var(--fg)]"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </section>
    </footer>
  );
}
