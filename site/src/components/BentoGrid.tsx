import { SIM_HEATMAP } from '../data/simulatorData';
import type { SiteCopy } from '../i18n/content';
import { IconClock, IconSkipForward } from './Icons';

interface BentoGridProps {
  copy: SiteCopy;
}

export function BentoGrid({ copy }: BentoGridProps) {
  const c = copy.tour.cards;
  const icebergSample = SIM_HEATMAP.slice(-24);
  const maxNew = Math.max(...icebergSample.map((d) => d.newTokensM), 1);
  const maxCached = Math.max(...icebergSample.map((d) => d.cachedTokensM), 1);

  return (
    <section id="tour" class="scroll-mt-16 py-20 sm:py-28">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section header */}
        <div class="max-w-2xl">
          <div class="text-[12.5px] font-semibold tracking-wide text-[var(--accent-ink)]">
            {copy.tour.kicker}
          </div>
          <h2 class="display-heading mt-2.5 text-[28px] leading-[1.15] font-bold text-[var(--fg)] sm:text-[38px]">
            {copy.tour.title}
          </h2>
          <p class="mt-3.5 text-[15.5px] leading-relaxed text-[var(--muted)]">
            {copy.tour.subtitle}
          </p>
        </div>

        {/* Balanced 6-Card Asymmetric Bento Grid */}
        <div class="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-6">
          {/* CARD 1 (4 cols): Context & Prompt Cache TTL */}
          <article class="surface-card surface-card-hover rounded-2xl p-6 lg:col-span-4">
            <div class="grid h-full gap-6 md:grid-cols-[1.05fr_1fr] md:items-center">
              <div>
                <div class="text-[11.5px] font-medium text-[var(--faint)]">
                  {c.contextCache.eyebrow}
                </div>
                <h3 class="display-heading mt-1.5 text-[20px] leading-snug font-semibold text-[var(--fg)] sm:text-[22px]">
                  {c.contextCache.title}
                </h3>
                <p class="mt-2.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {c.contextCache.desc}
                </p>
              </div>

              {/* Clean Context X-Ray + Cache TTL micro-visual */}
              <div class="recessed-well rounded-xl p-4">
                <div class="flex items-center justify-between font-mono text-[11px] tabular-nums">
                  <span class="font-semibold text-[var(--fg)]">141.7k / 256k</span>
                  <span class="text-[var(--muted)]">55.4%</span>
                </div>
                <div class="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div style={{ width: '10%', backgroundColor: 'var(--seg-input)' }} />
                  <div style={{ width: '16%', backgroundColor: 'var(--seg-think)' }} />
                  <div style={{ width: '51%', backgroundColor: 'var(--seg-out)' }} />
                  <div style={{ width: '17%', backgroundColor: 'var(--seg-cache)' }} />
                  <div style={{ width: '6%', backgroundColor: 'var(--muted)' }} />
                </div>

                {/* 2-col aligned breakdown */}
                <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  {[
                    { dot: 'var(--seg-input)', label: 'Sys Prompt', val: '14.6k' },
                    { dot: 'var(--seg-think)', label: 'Tool Defs', val: '22.1k' },
                    { dot: 'var(--seg-out)', label: 'Tool Results', val: '71.8k' },
                    { dot: 'var(--seg-cache)', label: 'Model Replies', val: '24.3k' },
                  ].map((row) => (
                    <div key={row.label} class="flex items-center justify-between">
                      <span class="flex items-center gap-1.5 text-[var(--fg-2)]">
                        <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: row.dot }} />
                        <span>{row.label}</span>
                      </span>
                      <span class="font-mono text-[10.5px] text-[var(--muted)] tabular-nums">{row.val}</span>
                    </div>
                  ))}
                </div>

                <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 font-mono text-[10.5px] tabular-nums">
                  <span class="inline-flex items-center gap-1.5 font-medium" style={{ color: 'var(--seg-cache)' }}>
                    <IconClock size={11} />
                    {c.contextCache.cacheSafe}
                  </span>
                  <span class="text-[var(--muted)]">{c.contextCache.headroom}</span>
                </div>
                <div class="mt-1 font-mono text-[10px] text-[var(--faint)] tabular-nums">
                  {c.contextCache.missPenalty}
                </div>
              </div>
            </div>
          </article>

          {/* CARD 2 (2 cols): Routed Model f19 & GEN vs E2E */}
          <article class="surface-card surface-card-hover flex flex-col justify-between rounded-2xl p-6 lg:col-span-2">
            <div>
              <div class="text-[11.5px] font-medium text-[var(--faint)]">
                {c.routedModel.eyebrow}
              </div>
              <h3 class="display-heading mt-1.5 text-[19px] leading-snug font-semibold text-[var(--fg)]">
                {c.routedModel.title}
              </h3>
              <p class="mt-2 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {c.routedModel.desc}
              </p>
            </div>

            <div class="recessed-well mt-5 space-y-2 rounded-xl p-3.5 font-mono text-[11px]">
              <div class="flex items-center justify-between rounded-lg bg-[var(--surface)] px-2.5 py-1.5">
                <span class="text-[10px] text-[var(--faint)]">{c.routedModel.uiAlias}</span>
                <span class="text-[var(--muted)] line-through decoration-[var(--faint)]">Auto / Pro</span>
              </div>
              <div
                class="flex items-center justify-between rounded-lg px-2.5 py-1.5"
                style={{ backgroundColor: 'var(--tint-accent)' }}
              >
                <span class="text-[10px] font-medium" style={{ color: 'var(--accent-ink)' }}>
                  {c.routedModel.actualRouted}
                </span>
                <span class="font-semibold text-[var(--fg)]">gemini-4-carbon</span>
              </div>
              <div class="grid grid-cols-2 gap-2 pt-0.5 tabular-nums">
                <div class="rounded-lg bg-[var(--surface)] p-2">
                  <div class="text-[9.5px] text-[var(--faint)]">GEN TPS</div>
                  <div class="mt-0.5 text-[15px] font-bold" style={{ color: 'var(--seg-cache)' }}>
                    96.2
                  </div>
                </div>
                <div class="rounded-lg bg-[var(--surface)] p-2">
                  <div class="text-[9.5px] text-[var(--faint)]">E2E TPS</div>
                  <div class="mt-0.5 text-[15px] font-bold text-[var(--fg)]">71.2</div>
                </div>
              </div>
            </div>
          </article>

          {/* CARD 3 (2 cols): Hatched Runway Bar & Quota Calibration */}
          <article class="surface-card surface-card-hover flex flex-col justify-between rounded-2xl p-6 lg:col-span-2">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-[11.5px] font-medium text-[var(--faint)]">
                  {c.runway.eyebrow}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums"
                  style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                >
                  {c.runway.oosBadge}
                </span>
              </div>
              <h3 class="display-heading mt-1.5 text-[19px] leading-snug font-semibold text-[var(--fg)]">
                {c.runway.title}
              </h3>
              <p class="mt-2 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {c.runway.desc}
              </p>
            </div>

            <div class="recessed-well mt-5 space-y-3 rounded-xl p-3.5">
              <div>
                <div class="flex items-center justify-between font-mono text-[10.5px] tabular-nums">
                  <span class="font-medium text-[var(--fg-2)]">5h Rolling</span>
                  <span class="font-semibold text-[var(--fg)]">68% left</span>
                </div>
                <div class="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div class="h-full" style={{ width: '44%', backgroundColor: 'var(--seg-cache)' }} />
                  <div
                    class="runway-hatch h-full"
                    style={{
                      width: '24%',
                      backgroundColor: 'color-mix(in srgb, var(--seg-cache) 38%, transparent)',
                    }}
                  />
                </div>
              </div>

              <div class="grid grid-cols-3 gap-1.5 font-mono tabular-nums">
                {[
                  { model: 'Carbon', k: '3.0×', color: 'var(--seg-out)' },
                  { model: 'Hydro', k: '1.0×', color: 'var(--seg-input)' },
                  { model: 'Flash-K', k: '0.4×', color: 'var(--seg-cache)' },
                ].map((m) => (
                  <div key={m.model} class="rounded-lg bg-[var(--surface)] px-2 py-1.5">
                    <div class="text-[9.5px] text-[var(--faint)]">{m.model}</div>
                    <div class="text-[12.5px] font-bold" style={{ color: m.color }}>
                      {m.k}
                    </div>
                  </div>
                ))}
              </div>
              <div class="text-[10.5px] text-[var(--faint)]">{c.runway.projectedLabel}</div>
            </div>
          </article>

          {/* CARD 4 (4 cols): Call Explorer Waterfall & Minimap Brush */}
          <article class="surface-card surface-card-hover rounded-2xl p-6 lg:col-span-4">
            <div class="grid h-full gap-6 md:grid-cols-[1fr_1.08fr] md:items-center">
              <div>
                <div class="text-[11.5px] font-medium text-[var(--faint)]">
                  {c.waterfall.eyebrow}
                </div>
                <h3 class="display-heading mt-1.5 text-[20px] leading-snug font-semibold text-[var(--fg)] sm:text-[22px]">
                  {c.waterfall.title}
                </h3>
                <p class="mt-2.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                  {c.waterfall.desc}
                </p>
                <ul class="mt-4 space-y-1.5 text-[12.5px] text-[var(--fg-2)]">
                  {c.waterfall.bullets.map((b) => (
                    <li key={b} class="flex items-start gap-2">
                      <span
                        class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: 'var(--accent-ink)' }}
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div class="recessed-well space-y-3 rounded-xl p-4 font-mono text-[10.5px]">
                <div>
                  <div class="flex items-center justify-between text-[10px] text-[var(--faint)]">
                    <span>MINIMAP · #18–#48 / 114</span>
                    <span class="inline-flex items-center gap-1" style={{ color: 'var(--accent-ink)' }}>
                      Follow Live
                      <IconSkipForward size={9} />
                    </span>
                  </div>
                  <svg viewBox="0 0 260 32" class="mt-1.5 block w-full rounded-lg bg-[var(--surface)]">
                    <path
                      d="M4,22 L19,17 L34,25 L50,14 L67,19 L84,11 L101,15 L118,23 L134,12 L152,16 L169,9 L186,18 L205,13 L224,20 L242,11 L256,14"
                      fill="none"
                      stroke="var(--seg-cache)"
                      stroke-width="1.5"
                      stroke-linejoin="round"
                    />
                    <rect
                      x="64"
                      y="2"
                      width="112"
                      height="28"
                      rx="4"
                      fill="var(--tint-accent)"
                      stroke="var(--accent)"
                      stroke-width="1"
                    />
                  </svg>
                </div>

                <div class="rounded-lg bg-[var(--surface)] p-3">
                  <div class="flex items-center justify-between text-[10px] text-[var(--muted)] tabular-nums">
                    <span>CALL #54 · WATERFALL</span>
                    <span class="font-semibold text-[var(--fg)]">9.40s</span>
                  </div>
                  <div class="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div style={{ width: '16%', backgroundColor: 'var(--seg-input)' }} />
                    <div style={{ width: '44%', backgroundColor: 'var(--seg-think)' }} />
                    <div style={{ width: '27%', backgroundColor: 'var(--seg-out)' }} />
                    <div style={{ width: '13%', backgroundColor: 'var(--seg-cache)' }} />
                  </div>
                  <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-[var(--muted)] tabular-nums">
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-input)' }} />
                      TTFT 1.5s
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-think)' }} />
                      Think 4.1s
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-out)' }} />
                      TC-WAIT 2.5s
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

          {/* CARD 5 (3 cols): Native AGY Swarm Cockpit */}
          <article class="surface-card surface-card-hover flex flex-col justify-between rounded-2xl p-6 lg:col-span-3">
            <div>
              <div class="text-[11.5px] font-medium text-[var(--faint)]">
                {c.swarm.eyebrow}
              </div>
              <h3 class="display-heading mt-1.5 text-[20px] leading-snug font-semibold text-[var(--fg)]">
                {c.swarm.title}
              </h3>
              <p class="mt-2.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {c.swarm.desc}
              </p>
              <ul class="mt-4 space-y-1.5 text-[12.5px] text-[var(--fg-2)]">
                {c.swarm.bullets.map((b) => (
                  <li key={b} class="flex items-start gap-2">
                    <span
                      class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: 'var(--seg-cache)' }}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div class="recessed-well mt-5 space-y-1.5 rounded-xl p-3.5 font-mono text-[10.5px]">
              {[
                { name: '@hud-ui', ws: 'share', model: 'carbon', cost: '$0.64', active: true },
                { name: '@hud-backend', ws: 'share', model: 'carbon', cost: '$0.51', active: true },
                { name: '@verifier', ws: 'inherit', model: 'flash-k', cost: '$0.09', active: false },
              ].map((w) => (
                <div
                  key={w.name}
                  class="flex items-center justify-between rounded-lg bg-[var(--surface)] px-2.5 py-2"
                >
                  <div class="flex items-center gap-1.5">
                    <span
                      class={`h-1.5 w-1.5 rounded-full ${w.active ? 'animate-hud-pulse' : ''}`}
                      style={{ backgroundColor: w.active ? 'var(--seg-cache)' : 'var(--faint)' }}
                    />
                    <span class="font-semibold text-[var(--fg)]">{w.name}</span>
                    {w.ws !== 'inherit' && (
                      <span
                        class="rounded px-1 py-px text-[9px]"
                        style={{ backgroundColor: 'var(--tint-accent)', color: 'var(--accent-ink)' }}
                      >
                        {w.ws}
                      </span>
                    )}
                  </div>
                  <span class="text-[10px] text-[var(--muted)] tabular-nums">
                    {w.model} · {w.cost}
                  </span>
                </div>
              ))}
            </div>
          </article>

          {/* CARD 6 (3 cols): Unified Multi-Store Ledger & Token Iceberg */}
          <article class="surface-card surface-card-hover flex flex-col justify-between rounded-2xl p-6 lg:col-span-3">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-[11.5px] font-medium text-[var(--faint)]">
                  {c.ledger.eyebrow}
                </span>
                <span class="font-mono text-[11px] font-semibold tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                  {c.ledger.cacheSaved} $18.40
                </span>
              </div>
              <h3 class="display-heading mt-1.5 text-[20px] leading-snug font-semibold text-[var(--fg)]">
                {c.ledger.title}
              </h3>
              <p class="mt-2.5 text-[13.5px] leading-[1.65] text-[var(--muted)]">
                {c.ledger.desc}
              </p>
            </div>

            <div class="recessed-well mt-5 rounded-xl p-3.5">
              <div class="mb-2.5 flex items-center justify-between font-mono text-[10px] text-[var(--muted)]">
                <div class="flex items-center gap-1.5">
                  {['App', 'CLI', 'ACP', 'IDE'].map((store) => (
                    <span key={store} class="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[9.5px] text-[var(--fg-2)]">
                      {store}
                    </span>
                  ))}
                </div>
                <span class="tabular-nums">16w · 52w</span>
              </div>

              {/* Monochrome Token Iceberg Preview */}
              <div class="rounded-lg bg-[var(--surface)] px-2.5 py-2.5">
                <div class="relative flex h-16 items-center gap-1">
                  <div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-[var(--border-strong)]" />
                  {icebergSample.map((d) => {
                    const topH = d.newTokensM > 0 ? Math.max(10, (d.newTokensM / maxNew) * 100) : 0;
                    const botH = d.cachedTokensM > 0 ? Math.max(10, (d.cachedTokensM / maxCached) * 100) : 0;
                    return (
                      <div key={d.date} class="flex h-full flex-1 flex-col">
                        <div class="flex h-1/2 items-end pb-[1.5px]">
                          {topH > 0 && (
                            <div
                              class="w-full rounded-t-[2px] bg-[var(--fg)]/80"
                              style={{ height: `${topH}%` }}
                            />
                          )}
                        </div>
                        <div class="flex h-1/2 items-start pt-[1.5px]">
                          {botH > 0 && (
                            <div
                              class="w-full rounded-b-[2px] bg-[var(--muted)]/38"
                              style={{ height: `${botH}%` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div class="mt-2 flex items-center justify-between font-mono text-[9.5px] text-[var(--faint)]">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-1.5 w-1.5 rounded-[1px] bg-[var(--fg)]/80" />
                    {c.ledger.newLabel}
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <span class="h-1.5 w-1.5 rounded-[1px] bg-[var(--muted)]/45" />
                    {c.ledger.cachedLabel}
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
