import type { Translations } from '../../i18n';
import type { ActiveStep, Invocation } from '../../types/telemetry';
import { fmtSec, fmtTps } from '../../utils/format';

interface HeroSpeedCardsProps {
  found: boolean;
  latest: Invocation | null | undefined;
  latestSustained: Invocation | null | undefined;
  activeStep: ActiveStep | null | undefined;
  t: Translations;
}

export function HeroSpeedCards({
  found,
  latest,
  latestSustained,
  activeStep,
  t,
}: HeroSpeedCardsProps) {
  let genValue = '--';
  let genSub = 'OUT -- · GEN --';
  let e2eValue = '--';
  let e2eSub = 'TTFT -- · TOT --';

  if (found && latest) {
    if (latest.isBuffered) {
      genValue = latestSustained ? fmtTps(latestSustained.genTps) : fmtTps(latest.e2eTps);
      const ms = (latest.genSec * 1000).toFixed(0);
      genSub = latestSustained
        ? t.genSubSust(fmtTps(latestSustained.genTps), ms, latest.outputTokens)
        : t.genSubBuf(ms, latest.outputTokens.toLocaleString());
    } else {
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

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="hud-card min-w-0 max-w-full">
        <div className="flex items-center justify-between gap-1.5">
          <span className="card-k">{t.genLabel}</span>
          {livePill && <span className={livePill.cls}>{livePill.text}</span>}
        </div>
        <div className="hero-v mt-1 flex items-baseline gap-[5px] font-hud-mono text-[25px] font-bold leading-[1.1] tabular-nums">
          <span>{genValue}</span>
          <span className="text-[12px] font-medium text-hud-muted">tok/s</span>
        </div>
        <div className="card-sub">{genSub}</div>
      </div>

      <div className="hud-card min-w-0 max-w-full">
        <div className="flex items-center justify-between gap-1.5">
          <span className="card-k">{t.e2eLabel}</span>
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
