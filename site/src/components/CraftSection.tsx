import type { SiteCopy } from '../i18n/content';
import {
  IconClock,
  IconCpu,
  IconGauge,
  IconPalette,
  IconShield,
  IconSwarm,
} from './Icons';

interface CraftSectionProps {
  copy: SiteCopy;
}

function CraftIcon({ id }: { id: string }) {
  switch (id) {
    case 'theme-sync':
      return <IconPalette size={16} />;
    case 'zero-cdp':
      return <IconShield size={16} />;
    case 'cache-ttl':
      return <IconClock size={16} />;
    case 'quota-irls':
      return <IconGauge size={16} />;
    case 'routed-f19':
      return <IconCpu size={16} />;
    case 'swarm-ledger':
    default:
      return <IconSwarm size={16} />;
  }
}

export function CraftSection({ copy }: CraftSectionProps) {
  const craft = copy.craft;

  return (
    <section id="craft" class="scroll-mt-16 border-y border-[var(--border)] bg-[var(--bg-subtle)]/65 py-20 sm:py-28">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="text-[12.5px] font-semibold tracking-wide text-[var(--accent-ink)]">
            {craft.kicker}
          </div>
          <h2 class="display-heading mt-2.5 text-[28px] leading-[1.15] font-bold text-[var(--fg)] sm:text-[38px]">
            {craft.title}
          </h2>
          <p class="mt-3.5 text-[15.5px] leading-relaxed text-[var(--muted)]">
            {craft.subtitle}
          </p>
        </div>

        <div class="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {craft.items.map((item) => (
            <article
              key={item.id}
              class="surface-card surface-card-hover flex flex-col justify-between rounded-2xl p-6"
            >
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--fg-2)]">
                    <CraftIcon id={item.id} />
                  </span>
                  <span class="text-[11px] font-medium text-[var(--faint)]">
                    {item.tag}
                  </span>
                </div>

                <h3 class="display-heading mt-4 text-[17px] leading-snug font-semibold text-[var(--fg)]">
                  {item.title}
                </h3>

                <p class="mt-2.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {item.desc}
                </p>
              </div>

              <div class="mt-5 border-t border-[var(--border)] pt-3 font-mono text-[11px] text-[var(--faint)]">
                {item.detail}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
