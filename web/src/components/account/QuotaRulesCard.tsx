import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import type { AccountQuota, QuotaPool } from '../../types/telemetry';
import { fmtNum, fmtUsd, friendlyFamilyName } from '../../utils/format';
import { IconAlert, IconCheck, IconChevronDown, IconChevronRight } from '../common/Icons';

interface QuotaRulesCardProps {
  quota: AccountQuota | undefined;
  t: Translations;
}

function formatErrPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return '--';
  if (v < 0.001) return '<0.001%';
  if (v < 0.05) return `${v.toFixed(3)}%`;
  if (v < 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(1)}%`;
}

function fmtPctClean(v: number): string {
  if (v < 0.1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return v.toFixed(0);
}

export function QuotaRulesCard({ quota, t }: QuotaRulesCardProps) {
  const [open, toggleOpen] = usePersistedOpen('quota-rules', true);

  if (!quota?.available || !Array.isArray(quota.pools)) {
    return null;
  }

  const fittedPools: QuotaPool[] = quota.pools.filter(
    (p) => p.fitSummary && Array.isArray(p.fitSummary.models) && p.fitSummary.models.length > 0,
  );
  if (!fittedPools.length) {
    return null;
  }

  return (
    <section className="hud-card">
      <div
        className="card-head flex items-center justify-between gap-2 cursor-pointer select-none"
        onClick={toggleOpen}
      >
        <span className="card-k">{t.rulesTitle}</span>
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
          {fittedPools.map((p, idx) => {
            const fs = p.fitSummary!;
            const gamma = fs.gamma && fs.gamma > 0 ? fs.gamma : null;
            const gammaStr = gamma
              ? Math.abs(gamma - Math.round(gamma)) < 0.04
                ? String(Math.round(gamma))
                : gamma.toFixed(1)
              : '';
            const full5h = fs.full5hUSD && fs.full5hUSD > 0 ? fs.full5hUSD : 0;
            const full7d = fs.full7dUSD && fs.full7dUSD > 0 ? fs.full7dUSD : 0;
            const cap5hStr = full5h > 0 ? fmtUsd(full5h) : '';
            const cap7dStr = full7d > 0 ? fmtUsd(full7d) : '';

            const w5 = (p.windows || []).find((w) => w.spanKey === '5h');
            const w7 = (p.windows || []).find((w) => w.spanKey === '7d');
            const rem5Pct = Math.max(0, Math.min(100, w5 ? w5.remainingPct : p.remainingPct || 0));
            const rem7Pct = w7 ? Math.max(0, Math.min(100, w7.remainingPct || 0)) : null;
            const rem5UsdStr = full5h > 0 ? fmtUsd((rem5Pct / 100) * full5h) : '';
            const rem7UsdStr = full7d > 0 && rem7Pct !== null ? fmtUsd((rem7Pct / 100) * full7d) : '';

            const errNum = fs.oosRelErrPct !== null && fs.holdoutCount > 0 ? fs.oosRelErrPct : fs.relErrPct;
            const errStr = formatErrPct(errNum);

            const sortedModels = fs.models
              .slice()
              .sort((a, b) => (b.obsCalls || 0) - (a.obsCalls || 0));

            return (
              <div
                key={`${p.label}:${idx}`}
                className={`${idx > 0 ? 'pt-2.5 border-t border-hud-hairline ' : ''}flex flex-col gap-2 min-w-0`}
              >
                {/* Pool Header */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                  <span className="font-hud text-[11.5px] font-semibold text-hud-fg">{p.label}</span>

                  {fs.driftWarning ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] font-semibold text-hud-warn bg-tint-warn whitespace-nowrap">
                      <IconAlert size={10} />
                      <span>{t.rulesDriftBadge}</span>
                    </span>
                  ) : fs.quality === 'high' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] font-medium text-hud-fg-2 bg-hud-fill whitespace-nowrap tabular-nums">
                      <IconCheck size={10} className="text-hud-ok" />
                      <span>{t.rulesAccHigh(errStr, fs.shortCleanCount)}</span>
                    </span>
                  ) : (
                    <span className="px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] text-hud-muted bg-hud-fill whitespace-nowrap">
                      {t.rulesAccProv(fs.shortCleanCount)}
                    </span>
                  )}
                </div>

                {/* Pool Credit Tank Boxes (5h vs 7d) - Borderless Recessed Wells */}
                {full5h > 0 && (
                  <div
                    className={`grid ${full7d > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5 cursor-help`}
                    data-tip={t.rulesTankTip(cap5hStr, cap7dStr)}
                  >
                    <div className="l2-well px-2.5 py-1.5 flex flex-col gap-[2px] min-w-0">
                      <div className="flex items-baseline justify-between gap-1 min-w-0">
                        <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">
                          {t.rules5hTankLabel}
                        </span>
                        <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums shrink-0">
                          ~{cap5hStr}
                        </span>
                      </div>
                      {rem5UsdStr && (
                        <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
                          {t.rulesTankRemSub(`${rem5Pct.toFixed(1)}%`, rem5UsdStr)}
                        </span>
                      )}
                    </div>

                    {full7d > 0 && (
                      <div className="l2-well px-2.5 py-1.5 flex flex-col gap-[2px] min-w-0">
                        <div className="flex items-baseline justify-between gap-1 min-w-0">
                          <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">
                            {t.rules7dTankLabel(gammaStr)}
                          </span>
                          <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums shrink-0">
                            ~{cap7dStr}
                          </span>
                        </div>
                        {rem7UsdStr && rem7Pct !== null && (
                          <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
                            {t.rulesTankRemSub(`${rem7Pct.toFixed(1)}%`, rem7UsdStr)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Per-Model Deduction Rules */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  {sortedModels.map((m) => {
                    const name = friendlyFamilyName(m.family);
                    const isFitted = m.source === 'fitted';
                    const isPerTok =
                      m.mode === 'per_token' && Array.isArray(m.tokenWeights) && m.tokenWeights.length === 3;

                    if (isPerTok && m.tokenWeights) {
                      const [wIn, wCa, wOut] = m.tokenWeights;
                      const capInTok = wIn > 0 ? fmtNum((100 / wIn) * 1_000_000) : '--';
                      const capCaTok = wCa > 0 ? fmtNum((100 / wCa) * 1_000_000) : '--';
                      const capOutTok = wOut > 0 ? fmtNum((100 / wOut) * 1_000_000) : '--';

                      return (
                        <div
                          key={m.family}
                          className="l2-well px-2.5 py-2 flex flex-col gap-1.5 min-w-0"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
                            <span className="font-hud-mono text-[10.5px] font-semibold text-hud-fg truncate">
                              {name}
                            </span>
                            <span className="px-1.5 py-[0.5px] rounded font-hud-mono text-[9.5px] font-semibold text-seg-think bg-tint-think whitespace-nowrap">
                              {t.rulesPerTokCapBadge(capOutTok)}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 min-w-0">
                            <div className="px-2 py-1 rounded-md bg-hud-card flex flex-col gap-[1px] min-w-0">
                              <span className="font-hud text-[9px] text-hud-muted truncate">{t.rulesTokInLabel}</span>
                              <span className="font-hud-mono text-[10.5px] font-bold text-hud-fg tabular-nums">
                                -{fmtPctClean(wIn)}%/M
                              </span>
                              <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
                                {t.rulesTokCapSub(capInTok)}
                              </span>
                            </div>

                            <div className="px-2 py-1 rounded-md bg-hud-card flex flex-col gap-[1px] min-w-0">
                              <span className="font-hud text-[9px] text-hud-muted truncate">{t.rulesTokCacheLabel}</span>
                              <span className="font-hud-mono text-[10.5px] font-bold text-hud-ok tabular-nums">
                                -{fmtPctClean(wCa)}%/M
                              </span>
                              <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
                                {t.rulesTokCapSub(capCaTok)}
                              </span>
                            </div>

                            <div className="px-2 py-1 rounded-md bg-hud-card flex flex-col gap-[1px] min-w-0">
                              <span className="font-hud text-[9px] text-hud-muted truncate">{t.rulesTokOutLabel}</span>
                              <span className="font-hud-mono text-[10.5px] font-bold text-seg-out tabular-nums">
                                -{fmtPctClean(wOut)}%/M
                              </span>
                              <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
                                {t.rulesTokCapSub(capOutTok)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const kVal = m.k || 1;
                    const kClean =
                      Math.abs(kVal - Math.round(kVal)) < 0.04 ? String(Math.round(kVal)) : kVal.toFixed(2);
                    const isHighMult = kVal >= 1.5;
                    const deductUsdStr = `$${kVal.toFixed(2)}`;
                    const usableApiUsd = m.beta > 0 ? 100 / m.beta : full5h / kVal;
                    const usableApiStr = fmtUsd(usableApiUsd);
                    const usablePctOfTank = Math.max(8, Math.min(100, (1 / Math.max(1, kVal)) * 100));

                    const rates = Array.isArray(m.baseRates) && m.baseRates.length === 3 ? m.baseRates : null;
                    const inPctM = rates ? m.beta * rates[0] : 0;
                    const caPctM = rates ? m.beta * rates[1] : 0;
                    const outPctM = rates ? m.beta * rates[2] : 0;
                    const fullOutTok = outPctM > 0 ? fmtNum((100 / outPctM) * 1_000_000) : '';

                    return (
                      <div
                        key={m.family}
                        className="l2-well px-2.5 py-2 flex flex-col gap-1.5 min-w-0 cursor-help"
                        data-tip={t.rulesModelTip(
                          name,
                          kClean,
                          deductUsdStr,
                          usableApiStr,
                          m.obsCalls || 0,
                          isFitted,
                        )}
                      >
                        {/* Row 1: Model Name + Formula Pill */}
                        <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="font-hud-mono text-[10.5px] font-semibold text-hud-fg truncate">
                              {name}
                            </span>
                            <span className="font-hud text-[9.5px] text-hud-muted shrink-0">
                              · {t.rulesSourceTag(isFitted)}
                            </span>
                          </div>

                          <span
                            className={`px-1.5 py-[1px] rounded font-hud-mono text-[9.5px] font-semibold tabular-nums whitespace-nowrap ${
                              isHighMult ? 'text-seg-out bg-tint-out' : 'text-hud-fg-2 bg-hud-card'
                            }`}
                          >
                            {t.rulesFormulaPill(kClean, deductUsdStr)}
                          </span>
                        </div>

                        {/* Row 2: Usable API Capacity Gauge */}
                        <div className="flex flex-col gap-[3px] min-w-0">
                          <div className="flex items-center justify-between gap-1 font-hud-mono text-[9.5px] text-hud-fg/90 tabular-nums">
                            <span className="truncate">
                              {t.rulesEffectiveApiCap(usableApiStr, cap5hStr, isHighMult)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden bg-hud-fill">
                            <div
                              className="h-full rounded-full transition-[width] duration-200"
                              style={{
                                width: `${usablePctOfTank.toFixed(1)}%`,
                                background: isHighMult ? 'var(--seg-out)' : 'var(--hud-ok)',
                              }}
                            />
                          </div>
                        </div>

                        {/* Row 3: Per-1M Token Burn */}
                        {rates && fullOutTok && (
                          <div className="font-hud-mono text-[9px] text-hud-muted tabular-nums leading-[1.35] break-words">
                            {t.rulesTokBurnStrip(
                              fmtPctClean(inPctM),
                              fmtPctClean(caPctM),
                              fmtPctClean(outPctM),
                              fullOutTok,
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
