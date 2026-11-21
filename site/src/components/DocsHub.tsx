import { useState } from 'preact/hooks';
import type { SiteCopy } from '../i18n/content';

interface DocsHubProps {
  copy: SiteCopy;
}

export function DocsHub({ copy }: DocsHubProps) {
  const [activeId, setActiveId] = useState<string>(copy.docs.tabs[0].id);
  const current = copy.docs.tabs.find((t) => t.id === activeId) ?? copy.docs.tabs[0];

  return (
    <section id="docs" class="scroll-mt-16 py-16 sm:py-22">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="font-mono text-[11.5px] font-semibold uppercase tracking-widest" style={{ color: 'var(--seg-think)' }}>
            {copy.docs.kicker}
          </div>
          <h2 class="display-heading mt-2 text-2xl font-bold text-[var(--fg)] sm:text-4xl">
            {copy.docs.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{copy.docs.subtitle}</p>
        </div>

        <div class="etched-card mt-10 overflow-hidden rounded-2xl">
          <div class="grid md:grid-cols-[230px_minmax(0,1fr)]">
            {/* Sidebar / Mobile Horizontal Tab Rail */}
            <div
              class="hud-scroll flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-2)] p-2.5 md:flex-col md:border-r md:border-b-0"
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
                    class={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold transition-colors md:w-full ${
                      active
                        ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs ring-1 ring-[var(--border-strong)]'
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

            {/* Active Documentation Content Pane */}
            <div class="min-w-0 bg-[var(--surface)] p-5 sm:p-7" role="tabpanel">
              <h3 class="display-heading text-xl font-bold text-[var(--fg)] sm:text-2xl">
                {current.title}
              </h3>
              <p class="mt-2.5 text-[14px] leading-relaxed text-[var(--muted)]">
                {current.intro}
              </p>

              <div class="mt-6 space-y-6">
                {current.blocks.map((blk) => (
                  <div key={blk.heading}>
                    <h4 class="font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--fg-2)]">
                      {blk.heading}
                    </h4>

                    {blk.body && (
                      <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">{blk.body}</p>
                    )}

                    {blk.code && (
                      <pre class="hud-scroll mt-2.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[12px] text-[var(--fg)]">
                        <code>{blk.code}</code>
                      </pre>
                    )}

                    {blk.table && (
                      <div class="hud-scroll mt-2.5 overflow-x-auto rounded-xl border border-[var(--border)]">
                        <table class="w-full min-w-[480px] border-collapse text-left text-[12.5px]">
                          <thead>
                            <tr class="border-b border-[var(--border)] bg-[var(--surface-2)] font-mono text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
                              {blk.table.headers.map((h) => (
                                <th key={h} class="px-3.5 py-2.5 font-semibold">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-[var(--border)]">
                            {blk.table.rows.map((row, rIdx) => (
                              <tr key={rIdx} class="hover:bg-[var(--surface-2)]/40">
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    class={`px-3.5 py-2.5 align-top ${
                                      cIdx === 0
                                        ? 'font-mono text-[12px] font-semibold text-[var(--fg)]'
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
