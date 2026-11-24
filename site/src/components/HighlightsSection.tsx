import type { SiteCopy } from '../i18n/content';

interface HighlightsSectionProps {
  copy: SiteCopy;
}

export function HighlightsSection({ copy }: HighlightsSectionProps) {
  return (
    <section id="overview" class="scroll-mt-16 border-t border-[var(--border)] py-20 sm:py-28">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="grid grid-cols-1 gap-x-14 gap-y-12 md:grid-cols-2">
          {copy.highlights.items.map((item, idx) => (
            <div
              key={item.title}
              class={`min-w-0 ${idx >= 2 ? 'border-t border-[var(--border)] pt-10' : ''}`}
            >
              <h2 class="display-heading text-[20px] leading-snug font-semibold text-[var(--fg)] sm:text-[22px]">
                {item.title}
              </h2>
              <p class="mt-3 text-[14.5px] leading-[1.75] text-[var(--muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
