import type { SiteCopy } from '../i18n/content';

interface CompareSectionProps {
  copy: SiteCopy;
}

export function CompareSection({ copy }: CompareSectionProps) {
  const cmp = copy.compare;

  return (
    <section id="compare" class="scroll-mt-16 py-16 sm:py-22">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="font-mono text-[11.5px] font-semibold uppercase tracking-widest" style={{ color: 'var(--seg-out)' }}>
            {cmp.kicker}
          </div>
          <h2 class="display-heading mt-2 text-2xl font-bold text-[var(--fg)] sm:text-4xl">
            {cmp.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{cmp.subtitle}</p>
        </div>

        <div class="etched-card mt-10 overflow-hidden rounded-2xl">
          <div class="hud-scroll overflow-x-auto">
            <table class="w-full min-w-[740px] border-collapse text-left text-[13px]">
              <thead>
                <tr class="border-b border-[var(--border)] bg-[var(--surface-2)] font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <th class="px-4 py-3.5 font-semibold">{cmp.cols[0]}</th>
                  <th
                    class="px-4 py-3.5 font-bold"
                    style={{
                      backgroundColor: 'var(--tint-accent)',
                      color: 'var(--accent-ink)',
                    }}
                  >
                    ★ {cmp.cols[1]}
                  </th>
                  <th class="px-4 py-3.5 font-semibold">{cmp.cols[2]}</th>
                  <th class="px-4 py-3.5 font-semibold">{cmp.cols[3]}</th>
                  <th class="px-4 py-3.5 font-semibold">{cmp.cols[4]}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border)]">
                {cmp.rows.map((row) => (
                  <tr key={row.feature} class="transition-colors hover:bg-[var(--surface-2)]/50">
                    <td class="px-4 py-3.5 font-semibold text-[var(--fg)]">{row.feature}</td>
                    <td
                      class="px-4 py-3.5 font-mono text-[12px] font-semibold text-[var(--fg)]"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 5.5%, transparent)' }}
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <span style={{ color: 'var(--seg-cache)' }}>✓</span>
                        <span>{row.agyHud}</span>
                      </span>
                    </td>
                    <td class="px-4 py-3.5 font-mono text-[12px] text-[var(--muted)]">{row.proxy}</td>
                    <td class="px-4 py-3.5 font-mono text-[12px] text-[var(--muted)]">{row.cliAgg}</td>
                    <td class="px-4 py-3.5 font-mono text-[12px] text-[var(--muted)]">{row.statusline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
