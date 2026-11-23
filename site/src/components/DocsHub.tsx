import { useState } from 'preact/hooks';
import type { SiteCopy } from '../i18n/content';

interface DocsHubProps {
  copy: SiteCopy;
}

export function DocsHub({ copy }: DocsHubProps) {
  const [activeId, setActiveId] = useState<string>(copy.docs.tabs[0].id);
  const current = copy.docs.tabs.find((t) => t.id === activeId) ?? copy.docs.tabs[0];

  return (
    <section id="docs" class="scroll-mt-16 border-t border-[var(--border)] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="text-[12.5px] font-semibold tracking-wide text-[var(--muted)]">
            {copy.docs.kicker}
          </div>
          <h2 class="display-heading mt-2.5 text-[26px] leading-[1.18] font-bold text-[var(--fg)] sm:text-[34px]">
            {copy.docs.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{copy.docs.subtitle}</p>
        </div>

        <div class="surface-card mt-10 overflow-hidden rounded-2xl">
          <div class="grid md:grid-cols-[224px_minmax(0,1fr)]">
            {/* Sidebar / Mobile Horizontal Rail */}
            <div
              class="hud-scroll flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-2)]/65 p-2.5 md:flex-col md:border-r md:border-b-0"
              role="tablist"
              aria-label="Documentation topics"
            >
              {copy.docs.tabs.map((tab, idx) => {
                const active = tab.id === current.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveId(tab.id)}
                    class={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors md:w-full ${
                      active
                        ? 'bg-[var(--surface)] text-[var(--fg)] shadow-2xs ring-1 ring-[var(--border-strong)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface)]/50 hover:text-[var(--fg)]'
                    }`}
                  >
                    <span class="font-mono text-[10.5px] text-[var(--faint)] tabular-nums">
                      0{idx + 1}
                    </span>
                    <span class="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Documentation Pane */}
            <div class="min-w-0 bg-[var(--surface)] p-5 sm:p-7" role="tabpanel">
              <h3 class="display-heading text-[20px] font-semibold text-[var(--fg)] sm:text-[22px]">
                {current.title}
              </h3>
              <p class="mt-2.5 text-[14px] leading-relaxed text-[var(--muted)]">
                {current.intro}
              </p>

              <div class="mt-6 space-y-6">
                {current.blocks.map((blk) => (
                  <div key={blk.heading}>
                    <h4 class="text-[12.5px] font-semibold text-[var(--fg-2)]">
                      {blk.heading}
                    </h4>

                    {blk.body && (
                      <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">{blk.body}</p>
                    )}

                    {blk.code && (
                      <pre class="hud-scroll mt-2.5 overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3.5 font-mono text-[12px] leading-relaxed text-[var(--fg)]">
                        <code>{blk.code}</code>
                      </pre>
                    )}

                    {blk.table && (
                      <div class="hud-scroll mt-2.5 overflow-x-auto rounded-xl border border-[var(--border)]">
                        <table class="w-full min-w-[480px] border-collapse text-left text-[12.5px]">
                          <thead>
                            <tr class="border-b border-[var(--border)] bg-[var(--surface-2)]/70 text-[11px] font-semibold text-[var(--muted)]">
                              {blk.table.headers.map((h) => (
                                <th key={h} class="px-3.5 py-2.5">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-[var(--border)]">
                            {blk.table.rows.map((row, rIdx) => (
                              <tr key={rIdx} class="hover:bg-[var(--surface-2)]/35">
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    class={`px-3.5 py-2.5 align-top ${
                                      cIdx === 0
                                        ? 'font-mono text-[12px] font-medium text-[var(--fg)]'
                                        : 'text-[var(--muted)]'
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {blk.bullets && (
                      <ul class="mt-2.5 space-y-2 text-[13.5px] leading-relaxed text-[var(--fg-2)]">
                        {blk.bullets.map((item) => (
                          <li key={item} class="flex items-start gap-2.5">
                            <span
                              class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: 'var(--accent-ink)' }}
                            />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
