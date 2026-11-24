import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import type { CacheTtlModelSummary, CacheTtlOverview } from '../../types/telemetry';
import { fmtNum, fmtTtlDuration, fmtUsd, friendlyFamilyName } from '../../utils/format';
import { IconCheck, IconChevronDown, IconChevronRight } from '../common/Icons';

interface CacheTtlCardProps {
  cacheTtl: CacheTtlOverview | undefined;
  t: Translations;
}

function hitBarColor(hitRate: number): string {
  if (hitRate >= 0.75) return 'var(--hud-ok)';
  if (hitRate >= 0.4) return 'var(--hud-warn)';
  return 'var(--hud-bad)';
}

function providerKindLabel(kind: CacheTtlModelSummary['providerKind'], t: Translations): string {
  if (kind === 'claude') return t.cacheTtlKindHard;
  if (kind === 'gemini') return t.cacheTtlKindLru;
  return t.cacheTtlKindMixed;
}

export function CacheTtlCard({ cacheTtl, t }: CacheTtlCardProps) {
  const [open, toggleOpen] = usePersistedOpen('cache-ttl', true);

  if (!cacheTtl || !Array.isArray(cacheTtl.models) || cacheTtl.models.length === 0) {
    return null;
  }

  const visibleModels = cacheTtl.models.slice(0, 6);
  const totalMissUsdStr = cacheTtl.totalMissCostUSD >= 0.01 ? fmtUsd(cacheTtl.totalMissCostUSD) : '';

  return (
    <section className="hud-card">
      <div
        className="card-head flex items-center justify-between gap-2 cursor-pointer select-none"
        onClick={toggleOpen}
      >
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
          <span className="card-k">{t.cacheTtlCardTitle}</span>
          <span
            className="inline-flex items-center px-1.5 py-[0.5px] rounded-full font-hud-mono text-[9.5px] text-hud-muted bg-hud-fill tabular-nums whitespace-nowrap cursor-help"
            data-tip={t.cacheTtlHeaderSummaryTip(cacheTtl.totalPairs, totalMissUsdStr)}
            onClick={(e) => e.stopPropagation()}
          >
            {t.cacheTtlHeaderSummary(cacheTtl.totalPairs, totalMissUsdStr)}
          </span>
        </div>
        <button
          type="button"
          className="collapse-btn"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggleOpen();
          }}
        >
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      </div>

      {open && (
        <div className="hud-expand-anim mt-2.5 flex flex-col gap-3 min-w-0">
          {visibleModels.map((m, idx) => {
            const name = friendlyFamilyName(m.family);
            const missCostStr = m.missCostUSD >= 0.01 ? fmtUsd(m.missCostUSD) : '';
            const nBuckets = m.buckets.length || 1;
            const curvePoints = m.buckets
              .map((b, bi) => {
                const x = ((bi + 0.5) / nBuckets) * 100;
                const y = (1 - Math.min(1, Math.max(0, b.predictedRate))) * 100;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(' ');

            return (
              <div
                key={m.family}
                className={`${idx > 0 ? 'pt-2.5 border-t border-hud-hairline ' : ''}flex flex-col gap-2 min-w-0`}
              >
                {/* Model Header */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-hud-mono text-[11.5px] font-semibold text-hud-fg truncate">
                      {name}
                    </span>
                    <span className="px-1.5 py-[0.5px] rounded font-hud text-[9.5px] text-hud-muted bg-hud-fill whitespace-nowrap">
                      {providerKindLabel(m.providerKind, t)}
                    </span>
                  </div>

                  {m.confidence === 'fitted' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] font-medium text-hud-fg-2 bg-hud-fill whitespace-nowrap tabular-nums">
                      <IconCheck size={10} className="text-hud-ok" />
                      <span>{t.cacheTtlConfFitted(m.longGapCount)}</span>
                    </span>
                  ) : m.confidence === 'provisional' ? (
                    <span className="px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] text-hud-muted bg-hud-fill whitespace-nowrap tabular-nums">
                      {t.cacheTtlConfProv(m.longGapCount)}
                    </span>
                  ) : (
                    <span className="px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] text-hud-muted bg-hud-fill whitespace-nowrap">
                      {t.cacheTtlConfPrior}
                    </span>
                  )}
                </div>

                {/* Key Survival Metrics Strip: Borderless L2 Recessed Wells + Plain-Language Tooltips */}
                <div className="narrow-grid-2 grid grid-cols-3 gap-1.5">
                  <div
                    className="l2-well px-2.5 py-1.5 flex flex-col gap-[1px] min-w-0 cursor-help"
                    data-tip={t.cacheTtlP80Tip(fmtTtlDuration(m.p80Sec))}
                  >
                    <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.cacheTtlP80Label}</span>
                    <span className="font-hud-mono text-[12px] font-bold text-hud-ok tabular-nums">
                      ~{fmtTtlDuration(m.p80Sec)}
                    </span>
                  </div>
                  <div
                    className="l2-well px-2.5 py-1.5 flex flex-col gap-[1px] min-w-0 cursor-help"
                    data-tip={t.cacheTtlP50Tip(fmtTtlDuration(m.p50Sec))}
                  >
                    <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.cacheTtlP50Label}</span>
                    <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums">
                      ~{fmtTtlDuration(m.p50Sec)}
                    </span>
                  </div>
                  <div
                    className="l2-well px-2.5 py-1.5 flex flex-col gap-[1px] min-w-0 cursor-help"
                    data-tip={t.cacheTtlBgMissTip(`${(m.bgMissRate * 100).toFixed(1)}%`)}
                  >
                    <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.cacheTtlBgMissLabel}</span>
                    <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums">
                      {(m.bgMissRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* 7-Bucket Empirical Hit-Rate Bars + Fitted Survival Curve Overlay */}
                <div className="l2-well px-2.5 pt-2 pb-2 flex flex-col gap-1.5">
                  {/* Clean Inline Mini Legend */}
                  <div className="flex items-center justify-between gap-2 font-hud text-[9px] text-hud-muted">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-[2px] bg-hud-ok opacity-75" />
                        <span>{t.cacheTtlLegendObserved}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-hud-accent-ink" />
                        <span>{t.cacheTtlLegendFitted}</span>
                      </span>
                    </div>
                    <span className="font-hud-mono opacity-65">100%</span>
                  </div>

                  <div className="relative h-16">
                    {/* 50% dashed reference line + faint right label */}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed"
                      style={{ borderColor: 'color-mix(in srgb, var(--hud-fg) 14%, transparent)' }}
                    />
                    <span className="pointer-events-none absolute right-0 top-[calc(50%-10px)] font-hud-mono text-[8px] text-hud-muted opacity-60">
                      50%
                    </span>

                    {/* Fitted survival polyline */}
                    <svg
                      className="pointer-events-none absolute inset-0 w-full h-full overflow-visible"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        fill="none"
                        stroke="var(--hud-accent-ink, var(--hud-accent))"
                        stroke-width="1.8"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                        opacity="0.88"
                        points={curvePoints}
                      />
                    </svg>

                    {/* Observed bars + predicted dots */}
                    <div
                      className="relative z-10 grid h-full gap-1.5"
                      style={{ gridTemplateColumns: `repeat(${nBuckets}, minmax(0, 1fr))` }}
                    >
                      {m.buckets.map((b) => {
                        const empPct = b.hitRate !== null ? `${(b.hitRate * 100).toFixed(0)}%` : '--';
                        const predPct = `${(b.predictedRate * 100).toFixed(0)}%`;
                        const tip = t.cacheTtlBucketTip({
                          label: b.label,
                          hits: b.hits,
                          count: b.count,
                          empPct,
                          predPct,
                        });
                        const barH = b.hitRate !== null ? Math.max(4, Math.round(b.hitRate * 100)) : 0;
                        const dotBottom = Math.min(97, Math.max(3, b.predictedRate * 100));

                        return (
                          <div
                            key={b.key}
                            className="relative flex items-end justify-center h-full cursor-help group"
                            data-tip={tip}
                          >
                            {b.count > 0 ? (
                              <div
                                className="w-[58%] rounded-t-[3px] transition-opacity group-hover:opacity-100"
                                style={{
                                  height: `${barH}%`,
                                  background: hitBarColor(b.hitRate ?? 0),
                                  opacity: 0.72,
                                }}
                              />
                            ) : (
                              <div
                                className="w-[58%] h-[2px] rounded-full"
                                style={{ background: 'color-mix(in srgb, var(--hud-fg) 12%, transparent)' }}
                              />
                            )}
                            <span
                              className="pointer-events-none absolute w-[5.5px] h-[5.5px] rounded-full"
                              style={{
                                bottom: `calc(${dotBottom.toFixed(1)}% - 2.75px)`,
                                background: 'var(--hud-accent-ink, var(--hud-accent))',
                                boxShadow: '0 0 0 1.2px var(--hud-surface-2)',
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Clean X-axis bucket labels & compact sample counts */}
                  <div
                    className="grid gap-1 text-center font-hud-mono tabular-nums pt-0.5 border-t border-hud-hairline"
                    style={{ gridTemplateColumns: `repeat(${nBuckets}, minmax(0, 1fr))` }}
                  >
                    {m.buckets.map((b) => (
                      <div key={b.key} className="flex flex-col leading-[1.28] min-w-0">
                        <span className="text-[9px] font-medium text-hud-fg truncate">{b.label}</span>
                        <span className="text-[8.5px] text-hud-muted truncate">
                          {b.count > 0 && b.hitRate !== null ? `${Math.round(b.hitRate * 100)}%` : '—'}
                        </span>
                        <span className="text-[8px] text-hud-faint truncate">
                          {b.count > 0 ? fmtNum(b.count) : '0'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Optional Expired Miss Cost Footer */}
                {m.expiredMissCount > 0 && (
                  <div className="flex items-center justify-between gap-2 font-hud-mono text-[9.5px] text-hud-muted tabular-nums">
                    <span>{t.cacheTtlHeaderSummary(m.sampleCount, '')}</span>
                    <span className="text-hud-warn font-medium">
                      {t.cacheTtlExpiredMissSub(m.expiredMissCount, missCostStr)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          <div className="text-[9.5px] font-hud text-hud-muted leading-[1.4] break-words">
            {t.cacheTtlFootnote}
          </div>
        </div>
      )}
    </section>
  );
}
