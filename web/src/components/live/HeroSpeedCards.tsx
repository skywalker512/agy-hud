import { useMemo } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { ActiveStep, Invocation } from '../../types/telemetry';
import { fmtSec, fmtTps } from '../../utils/format';

interface HeroSpeedCardsProps {
  found: boolean;
  latest: Invocation | null | undefined;
  latestSustained: Invocation | null | undefined;
  activeStep: ActiveStep | null | undefined;
  invocations?: Invocation[];
  avgGenTps?: number;
  t: Translations;
}

export function HeroSpeedCards({
  found,
  latest,
  latestSustained,
  activeStep,
  invocations = [],
  avgGenTps = 0,
  t,
}: HeroSpeedCardsProps) {
  let genValue = '--';
  let genSub = 'OUT -- · GEN --';
  let e2eValue = '--';
  let e2eSub = 'TTFT -- · TOT --';
  let currentGenNum = 0;

  if (found && latest) {
    if (latest.isBuffered) {
      currentGenNum = latestSustained ? latestSustained.genTps : latest.e2eTps;
      genValue = fmtTps(currentGenNum);
      const ms = (latest.genSec * 1000).toFixed(0);
      genSub = latestSustained
        ? t.genSubSust(fmtTps(latestSustained.genTps), ms, latest.outputTokens)
        : t.genSubBuf(ms, latest.outputTokens.toLocaleString());
    } else {
      currentGenNum = latest.genTps;
      genValue = fmtTps(latest.genTps);
      genSub = t.genSubOk(latest.outputTokens.toLocaleString(), fmtSec(latest.genSec));
    }
    e2eValue = fmtTps(latest.e2eTps);
    e2eSub = t.e2eSub(fmtSec(latest.ttftSec), fmtSec(latest.totalSec));
  }

  let livePill: { cls: string; text: string } | null = null;
  if (found && activeStep?.stepType === 15) {
    livePill =
      activeStep.streamStartMs > 0
        ? { cls: 'live-pill', text: t.liveRowTagStream }
        : { cls: 'live-pill is-wait', text: t.liveWaitBadge };
  } else if (found && activeStep?.stepType === 23) {
    livePill = { cls: 'live-pill is-compact', text: t.compactLiveBadge };
  }

  const deltaInfo = useMemo(() => {
    if (!found || !latest || invocations.length < 3 || !(avgGenTps > 0) || !(currentGenNum > 0)) {
      return null;
    }
    const pct = ((currentGenNum - avgGenTps) / avgGenTps) * 100;
    const rounded = Math.round(pct);
    const cls = rounded >= 3 ? 'is-up' : rounded <= -3 ? 'is-down' : 'is-flat';
    const label = `${rounded > 0 ? '+' : ''}${rounded}%`;
    return { pct, cls, label, tip: t.heroDeltaTip(pct, fmtTps(avgGenTps)) };
  }, [found, latest, invocations.length, avgGenTps, currentGenNum, t]);

  const sparkline = useMemo(() => {
    if (!found || invocations.length < 3) return null;
    const sustained = invocations
      .filter((r) => !r.isBuffered && r.genTps > 0)
      .slice(-8)
      .map((r) => r.genTps);
    const series =
      sustained.length >= 3
        ? sustained
        : invocations
            .filter((r) => r.e2eTps > 0)
            .slice(-8)
            .map((r) => r.e2eTps);
    if (series.length < 3) return null;

    const w = 48;
    const h = 16;
    const padX = 2;
    const padY = 2.5;
    const minV = Math.min(...series);
    const maxV = Math.max(...series);
    const span = maxV - minV;
    const pts = series.map((v, i) => {
      const x = padX + (i / (series.length - 1)) * (w - padX * 2);
      const norm = span > 0.01 ? (v - minV) / span : 0.5;
      const y = h - padY - norm * (h - padY * 2);
      return { x, y };
    });
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`;
    const lastPt = pts[pts.length - 1];
    return {
      count: series.length,
      linePath,
      areaPath,
      lastPt,
    };
  }, [found, invocations]);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="hud-card min-w-0 max-w-full">
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span className="card-k truncate">{t.genLabel}</span>
          <div className="flex items-center gap-1 shrink-0">
            {deltaInfo && (
              <span className={`hero-delta cursor-help ${deltaInfo.cls}`} data-tip={deltaInfo.tip}>
                {deltaInfo.label}
              </span>
            )}
            {livePill && <span className={livePill.cls}>{livePill.text}</span>}
          </div>
        </div>
        <div className="mt-1 flex items-end justify-between gap-1.5 min-w-0">
          <div className="hero-v flex items-baseline gap-[5px] font-hud-mono text-[25px] font-bold leading-[1.1] tabular-nums min-w-0">
            <span>{genValue}</span>
            <span className="text-[12px] font-medium text-hud-muted">tok/s</span>
          </div>
          {sparkline && (
            <svg
              width="48"
              height="16"
              viewBox="0 0 48 16"
              className="shrink-0 mb-[2px] overflow-visible cursor-help"
              data-tip={t.heroSparkTip(sparkline.count)}
              aria-hidden="true"
            >
              <path d={sparkline.areaPath} fill="var(--seg-cache)" opacity="0.16" />
              <path
                d={sparkline.linePath}
                fill="none"
                stroke="var(--seg-cache)"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={sparkline.lastPt.x} cy={sparkline.lastPt.y} r="2" fill="var(--seg-cache)" />
            </svg>
          )}
        </div>
        <div className="card-sub">{genSub}</div>
      </div>

      <div className="hud-card min-w-0 max-w-full">
        <div className="flex items-center justify-between gap-1.5">
          <span className="card-k truncate">{t.e2eLabel}</span>
        </div>
        <div className="hero-v mt-1 flex items-baseline gap-[5px] font-hud-mono text-[25px] font-bold leading-[1.1] tabular-nums">
          <span>{e2eValue}</span>
          <span className="text-[12px] font-medium text-hud-muted">tok/s</span>
        </div>
        <div className="card-sub">{e2eSub}</div>
      </div>
    </div>
  );
}
