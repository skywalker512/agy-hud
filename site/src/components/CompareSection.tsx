import type { SiteCopy } from '../i18n/content';
import { IconCheck } from './Icons';

interface CompareSectionProps {
  copy: SiteCopy;
}

export function CompareSection({ copy }: CompareSectionProps) {
  const cmp = copy.compare;

  return (
    <section id="compare" class="scroll-mt-16 border-t border-[var(--border)] bg-[var(--bg-subtle)]/50 py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="text-[12.5px] font-semibold tracking-wide text-[var(--muted)]">
            {cmp.kicker}
          </div>
          <h2 class="display-heading mt-2.5 text-[26px] leading-[1.18] font-bold text-[var(--fg)] sm:text-[34px]">
            {cmp.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{cmp.subtitle}</p>
        </div>

        <div class="surface-card mt-10 overflow-hidden rounded-2xl">
          <div class="hud-scroll overflow-x-auto">
            <table class="w-full min-w-[740px] border-collapse text-left text-[13px]">
              <thead>
                <tr class="border-b border-[var(--border)] bg-[var(--surface-2)]/70 text-[11.5px] font-semibold text-[var(--muted)]">
                  <th class="px-4 py-3.5">{cmp.cols[0]}</th>
                  <th
                    class="px-4 py-3.5 text-[var(--fg)]"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' }}
                  >
                    {cmp.cols[1]}
                  </th>
                  <th class="px-4 py-3.5">{cmp.cols[2]}</th>
                  <th class="px-4 py-3.5">{cmp.cols[3]}</th>
                  <th class="px-4 py-3.5">{cmp.cols[4]}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border)]">
                {cmp.rows.map((row) => (
                  <tr key={row.feature} class="transition-colors hover:bg-[var(--surface-2)]/40">
                    <td class="px-4 py-3.5 font-medium text-[var(--fg)]">{row.feature}</td>
                    <td
                      class="px-4 py-3.5 text-[12.5px] font-medium text-[var(--fg)]"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 4.5%, transparent)' }}
                    >
                      <span class="inline-flex items-start gap-2">
                        <span class="mt-0.5 shrink-0" style={{ color: 'var(--seg-cache)' }}>
                          <IconCheck size={13} />
                        </span>
                        <span>{row.agyHud}</span>
                      </span>
                    </td>
                    <td class="px-4 py-3.5 text-[12.5px] text-[var(--muted)]">{row.proxy}</td>
                    <td class="px-4 py-3.5 text-[12.5px] text-[var(--muted)]">{row.cliAgg}</td>
                    <td class="px-4 py-3.5 text-[12.5px] text-[var(--muted)]">{row.statusline}</td>
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
