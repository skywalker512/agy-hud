import { SIM_HEATMAP } from '../data/simulatorData';
import type { SiteCopy } from '../i18n/content';

interface BentoGridProps {
  copy: SiteCopy;
}

export function BentoGrid({ copy }: BentoGridProps) {
  const c = copy.bento.cards;

  return (
    <section id="features" class="py-16 sm:py-22">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section header */}
        <div class="max-w-2xl">
          <div class="font-mono text-[11.5px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-ink)' }}>
            {copy.bento.kicker}
          </div>
          <h2 class="display-heading mt-2 text-2xl font-bold text-[var(--fg)] sm:text-4xl">
            {copy.bento.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
            {copy.bento.subtitle}
          </p>
        </div>

        {/* 6-Card Asymmetric Bento Grid */}
        <div class="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* CARD 1 (2 cols — Flagship): Native AGY Swarm Cockpit */}
          <article id="swarm" class="etched-card etched-card-hover scroll-mt-20 rounded-2xl p-6 lg:col-span-2">
            <div class="grid gap-6 md:grid-cols-[1.05fr_1fr] md:items-center">
              <div>
                <span
                  class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold"
                  style={{
                    backgroundColor: 'var(--tint-think)',
                    borderColor: 'var(--tint-think-border)',
                    color: 'var(--seg-think)',
                  }}
                >
                  ★ {copy.bento.flagshipBadge}
                </span>
                <h3 class="display-heading mt-3 text-xl font-bold text-[var(--fg)] sm:text-2xl">
                  {c.swarm.title}
                </h3>
                <p class="mt-2.5 text-[13.5px] leading-relaxed text-[var(--muted)]">
                  {c.swarm.desc}
                </p>
                <ul class="mt-4 space-y-2 text-[12.5px] text-[var(--fg-2)]">
                  {c.swarm.bullets.map((b) => (
                    <li key={b} class="flex items-start gap-2">
                      <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--seg-cache)' }} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Mini Swarm Cockpit Illustration */}
              <div class="inset-well rounded-xl p-3.5 font-mono text-[11px]">
                <div class="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold text-[var(--fg)]">SWARM COCKPIT</span>
                    <span
                      class="rounded px-1.5 py-px text-[9.5px] font-semibold"
                      style={{ backgroundColor: 'var(--tint-think)', color: 'var(--seg-think)' }}
                    >
                      Board #24
                    </span>
                  </div>
                  <span class="text-[10px] tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                    ● 3 working · ○ 1 waiting
                  </span>
                </div>
                <div class="mt-2.5 space-y-2">
                  {[
                    { name: '@trend-viz', state: 'working', ws: 'share', model: 'carbon', cost: '$0.78', active: true },
                    { name: '@dashboard-ux', state: 'working', ws: 'share', model: 'carbon', cost: '$0.64', active: true },
                    { name: '@inspector', state: 'waiting', ws: 'inherit', model: 'flash-k', cost: '$0.09', active: false },
                  ].map((w) => (
                    <div
                      key={w.name}
                      class="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2"
                    >
                      <div class="flex items-center gap-1.5">
                        <span
                          class={`h-1.5 w-1.5 rounded-full ${w.active ? 'animate-hud-pulse' : ''}`}
                          style={{ backgroundColor: w.active ? 'var(--seg-cache)' : 'var(--faint)' }}
                        />
                        <span class="font-bold text-[var(--fg)]">{w.name}</span>
                        <span
                          class="rounded px-1 py-px text-[9px]"
                          style={
                            w.ws === 'share'
                              ? { backgroundColor: 'var(--tint-accent)', color: 'var(--accent-ink)' }
                              : { backgroundColor: 'var(--surface-3)', color: 'var(--muted)' }
                          }
                        >
                          {w.ws}
                        </span>
                      </div>
                      <span class="text-[10px] text-[var(--muted)] tabular-nums">
                        {w.model} · {w.cost} →
                      </span>
                    </div>
                  ))}
                </div>
                <div class="mt-2.5 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-[var(--faint)] tabular-nums">
                  <span>← @coordinator breadcrumb</span>
                  <span class="text-[var(--fg-2)]">Rollup: $1.84 · 5h -1.12%</span>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 2 (1 col): Routed Model f19 & GEN vs E2E */}
          <article class="etched-card etched-card-hover flex flex-col justify-between rounded-2xl p-6">
            <div>
              <h3 class="display-heading text-lg font-bold text-[var(--fg)]">{c.modelSpeed.title}</h3>
              <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{c.modelSpeed.desc}</p>
            </div>

            <div class="inset-well mt-5 space-y-2.5 rounded-xl p-3.5 font-mono text-[11px]">
              <div class="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
                <span class="text-[10px] text-[var(--faint)]">{c.modelSpeed.uiAlias}</span>
                <span class="text-[var(--muted)] line-through decoration-[var(--faint)]">Auto / Pro</span>
              </div>
              <div
                class="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                style={{ backgroundColor: 'var(--tint-accent)', borderColor: 'var(--tint-accent-border)' }}
              >
                <span class="text-[10px] font-semibold" style={{ color: 'var(--accent-ink)' }}>
                  {c.modelSpeed.actualRouted}
                </span>
                <span class="font-bold text-[var(--fg)]">gemini-4-carbon</span>
              </div>
              <div class="grid grid-cols-2 gap-2 pt-1 tabular-nums">
                <div class="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
                  <div class="text-[9.5px] text-[var(--faint)]">GEN TPS</div>
                  <div class="mt-0.5 text-base font-bold" style={{ color: 'var(--seg-cache)' }}>
                    94.6
                  </div>
                </div>
                <div class="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
                  <div class="flex items-center justify-between text-[9.5px] text-[var(--faint)]">
                    <span>E2E TPS</span>
                    <span class="rounded bg-[var(--surface-3)] px-1 text-[8.5px] text-[var(--muted)]">BUF excl.</span>
                  </div>
                  <div class="mt-0.5 text-base font-bold text-[var(--fg)]">68.2</div>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 3 (1 col): Context Window X-Ray */}
          <article class="etched-card etched-card-hover flex flex-col justify-between rounded-2xl p-6">
            <div>
              <h3 class="display-heading text-lg font-bold text-[var(--fg)]">{c.contextXray.title}</h3>
              <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{c.contextXray.desc}</p>
            </div>

            <div class="inset-well mt-5 rounded-xl p-3.5 font-mono text-[10.5px]">
              <div class="flex items-center justify-between tabular-nums">
                <span class="text-[var(--muted)]">142.4k / 256k</span>
                <span class="font-bold text-[var(--fg)]">55.6%</span>
              </div>
              <div class="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div style={{ width: '11%', backgroundColor: 'var(--seg-input)' }} />
                <div style={{ width: '15%', backgroundColor: 'var(--seg-think)' }} />
                <div style={{ width: '52%', backgroundColor: 'var(--seg-out)' }} />
                <div style={{ width: '16%', backgroundColor: 'var(--seg-cache)' }} />
                <div style={{ width: '6%', backgroundColor: 'var(--muted)' }} />
              </div>
              <div class="mt-3 space-y-1.5 text-[10px] tabular-nums">
                <div class="flex items-center justify-between">
                  <span class="text-[var(--fg-2)]">read_file</span>
                  <span class="text-[var(--muted)]">41.2k tok</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[var(--fg-2)]">run_command</span>
                  <span class="text-[var(--muted)]">19.6k tok</span>
                </div>
                <div class="flex items-center justify-between border-t border-[var(--border)] pt-1.5">
                  <span style={{ color: 'var(--seg-cache)' }}>{c.contextXray.headroom}</span>
                  <span style={{ color: 'var(--accent-ink)' }}>{c.contextXray.cacheFresh}</span>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 4 (2 cols): Historical Brush/Zoom & OpenRouter-Style Waterfall */}
          <article id="inspector" class="etched-card etched-card-hover scroll-mt-20 rounded-2xl p-6 lg:col-span-2">
            <div class="grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-center">
              <div>
                <h3 class="display-heading text-xl font-bold text-[var(--fg)] sm:text-2xl">
                  {c.waterfall.title}
                </h3>
                <p class="mt-2.5 text-[13.5px] leading-relaxed text-[var(--muted)]">
                  {c.waterfall.desc}
                </p>
                <ul class="mt-4 space-y-2 text-[12.5px] text-[var(--fg-2)]">
                  {c.waterfall.bullets.map((b) => (
                    <li key={b} class="flex items-start gap-2">
                      <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--seg-input)' }} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Mini Waterfall + Brush Graphic */}
              <div class="inset-well space-y-3 rounded-xl p-3.5 font-mono text-[10.5px]">
                {/* Minimap Brush visual */}
                <div>
                  <div class="flex items-center justify-between text-[9.5px] text-[var(--faint)]">
                    <span>MINIMAP BRUSH · #18–#48 of 114</span>
                    <span style={{ color: 'var(--accent-ink)' }}>Follow Live ⏭</span>
                  </div>
                  <svg viewBox="0 0 260 32" class="mt-1.5 block w-full rounded border border-[var(--border)] bg-[var(--surface)]">
                    <path
                      d="M4,24 L20,21 L38,16 L54,19 L72,11 L92,15 L110,9 L128,18 L146,12 L166,14 L184,8 L204,13 L224,10 L242,15 L256,11"
                      fill="none"
                      stroke="var(--seg-cache)"
                      stroke-width="1.5"
                    />
                    <rect
                      x="64"
                      y="2"
                      width="112"
                      height="28"
                      rx="3"
                      fill="var(--tint-accent)"
                      stroke="var(--accent)"
                      stroke-width="1.2"
                    />
                    <rect x="62" y="9" width="4" height="14" rx="1.5" fill="var(--accent)" />
                    <rect x="174" y="9" width="4" height="14" rx="1.5" fill="var(--accent)" />
                  </svg>
                </div>

                {/* Waterfall Bar */}
                <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                  <div class="flex items-center justify-between text-[9.5px] text-[var(--muted)] tabular-nums">
                    <span>CALL #54 · WATERFALL</span>
                    <span class="font-bold text-[var(--fg)]">9.60s</span>
                  </div>
                  <div class="mt-1.5 flex h-3 w-full overflow-hidden rounded bg-[var(--surface-3)]">
                    <div style={{ width: '16%', backgroundColor: 'var(--seg-input)' }} title="TTFT 1.4s" />
                    <div style={{ width: '48%', backgroundColor: 'var(--seg-think)' }} title="Think 4.6s" />
                    <div style={{ width: '24%', backgroundColor: 'var(--seg-out)' }} title="Tool Gen 2.3s" />
                    <div style={{ width: '12%', backgroundColor: 'var(--seg-cache)' }} title="Stream 1.3s" />
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2 text-[9px] text-[var(--muted)] tabular-nums">
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-input)' }} />
                      TTFT 1.4s
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-think)' }} />
                      Think 4.6s
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-out)' }} />
                      TC-WAIT 2.3s
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-cache)' }} />
                      Stream 1.3s
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 5 (1.5 cols -> spans 1 or 2? 6 cards: Row1: 2+1=3, Row2: 1+2=3, Row3: let's make Row3 two equal 1.5-wide or 2+1? Better: make grid lg:grid-cols-6 so Card1=4, Card2=2, Card3=2, Card4=4, Card5=3, Card6=3! That is a razor-clean balanced 6-card asymmetric bento grid!) */}
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-3">
            {/* CARD 5: Empirical k-Fitter & 5h/7d Runway */}
            <article class="etched-card etched-card-hover flex flex-col justify-between rounded-2xl p-6">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <h3 class="display-heading text-lg font-bold text-[var(--fg)]">{c.quotaFitter.title}</h3>
                  <span
                    class="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold"
                    style={{
                      backgroundColor: 'var(--tint-ok)',
                      borderColor: 'var(--tint-ok-border)',
                      color: 'var(--seg-cache)',
                    }}
                  >
                    {c.quotaFitter.oosBadge}
                  </span>
                </div>
                <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{c.quotaFitter.desc}</p>
              </div>

              <div class="inset-well mt-5 grid grid-cols-3 gap-2 rounded-xl p-3 font-mono tabular-nums">
                {[
                  { model: 'Carbon', k: '3.0×', bar: '88%', color: 'var(--seg-out)' },
                  { model: 'Hydrogen', k: '1.0×', bar: '44%', color: 'var(--seg-input)' },
                  { model: 'Flash-K', k: '0.4×', bar: '22%', color: 'var(--seg-cache)' },
                ].map((row) => (
                  <div key={row.model} class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                    <div class="text-[10px] text-[var(--muted)]">{row.model}</div>
                    <div class="mt-0.5 text-base font-bold" style={{ color: row.color }}>
                      {row.k}
                    </div>
                    <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div class="h-full rounded-full" style={{ width: row.bar, backgroundColor: row.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {/* CARD 6: Multi-Store App+CLI Accounting & 16-Week Heatmap */}
            <article class="etched-card etched-card-hover flex flex-col justify-between rounded-2xl p-6">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <h3 class="display-heading text-lg font-bold text-[var(--fg)]">{c.multiStore.title}</h3>
                  <span class="shrink-0 font-mono text-[11px] font-bold tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                    {c.multiStore.cacheSaved} $18.40
                  </span>
                </div>
                <p class="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{c.multiStore.desc}</p>
              </div>

              <div class="inset-well mt-5 rounded-xl p-3">
                <div class="mb-2 flex items-center justify-between font-mono text-[10px] text-[var(--muted)]">
                  <div class="flex items-center gap-1.5">
                    {['App', 'CLI', 'ACP', 'IDE'].map((s) => (
                      <span key={s} class="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-px text-[9.5px] text-[var(--fg-2)]">
                        {s}
                      </span>
                    ))}
                  </div>
                  <span class="tabular-nums">16w · 112d</span>
                </div>
                <div class="grid grid-cols-16 gap-1">
                  {Array.from({ length: 16 }).map((_, w) => (
                    <div key={w} class="grid grid-rows-7 gap-1">
                      {SIM_HEATMAP.filter((d) => d.week === w).map((d) => (
                        <span
                          key={d.date}
                          class="aspect-square w-full rounded-[2px]"
                          style={{
                            backgroundColor:
                              d.level === 0
                                ? 'var(--surface-3)'
                                : d.level === 1
                                  ? 'color-mix(in srgb, var(--seg-cache) 30%, var(--surface-3))'
                                  : d.level === 2
                                    ? 'color-mix(in srgb, var(--seg-cache) 55%, var(--surface-3))'
                                    : d.level === 3
                                      ? 'color-mix(in srgb, var(--seg-cache) 78%, var(--surface-3))'
                                      : 'var(--seg-cache)',
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
