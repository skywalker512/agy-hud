import { useEffect, useRef } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { StatsSnapshot } from '../../types/telemetry';
import {
  computeHeadroomTurns,
  fmtClock,
  fmtDurationShort,
  fmtTps,
  fmtUsd,
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  getEffectiveContextState,
} from '../../utils/format';

interface PulseBarProps {
  snap: StatsSnapshot | null;
  nowMs: number;
  t: Translations;
}

export function PulseBar({ snap, nowMs, t }: PulseBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const syncHeight = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) {
        document.documentElement.style.setProperty('--hud-pulse-h', `${h}px`);
      }
    };
    syncHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const found = Boolean(snap?.found);
  const latest = snap?.latest || null;
  const active = snap?.activeStep || null;
  const s = snap?.summary;

  let genText = 'GEN --';
  let genCls = 'pulse-chip';

  if (found && active?.stepType === 23) {
    genText = t.compactLiveBadge;
    genCls = 'pulse-chip is-compact';
  } else if (found && active?.stepType === 15 && !latest) {
    genText = active.streamStartMs > 0 ? t.liveStreamBadge : t.liveWaitBadge;
    genCls = 'pulse-chip is-ok';
  } else if (found && latest) {
    const genVal = latest.isBuffered
      ? fmtTps(snap?.latestSustained?.genTps || latest.e2eTps)
      : fmtTps(latest.genTps);
    if (active?.stepType === 15) {
      genText = active.streamStartMs > 0 ? `LIVE ${genVal} tok/s` : t.liveWaitBadge;
      genCls = 'pulse-chip is-ok';
    } else {
      genText = `GEN ${genVal} tok/s`;
      genCls = 'pulse-chip';
    }
  }

  const effCtx = getEffectiveContextState(snap);
  let ctxText = 'CTX --';
  let ctxCls = 'pulse-chip';
  if (found && (latest || effCtx.isPostCompact)) {
    const pct = effCtx.pct;
    const prefix = effCtx.isEstimated ? '~' : '';
    const hr = computeHeadroomTurns(snap);
    ctxText = hr ? `CTX ${prefix}${pct.toFixed(0)}% · ~${hr.turns}t` : `CTX ${prefix}${pct.toFixed(1)}%`;
    ctxCls = `pulse-chip${pct >= 88 ? ' is-bad' : pct >= 70 ? ' is-warn' : ''}`;
  }

  const latestMs = s?.latestCallMs || latest?.timestampMs || 0;
  let ageChip: { text: string; cls: string; tip: string } | null = null;
  if (found && latestMs > 0) {
    const ageSec = Math.max(0, Math.floor((nowMs - latestMs) / 1000));
    const ageStr = fmtDurationShort(ageSec);
    const cls = ageSec >= 300 ? 'pulse-chip is-bad' : ageSec >= 120 ? 'pulse-chip is-warn' : 'pulse-chip is-ok';
    ageChip = {
      text: t.cacheAgeLabel(ageStr),
      cls,
      tip: t.cacheAgeTip(ageStr, fmtClock(latestMs)),
    };
  }

  const showCost = Boolean(found && s && s.pricedCount > 0);
  const sessionQuota = s?.sessionQuota || snap?.sessionInfo?.quotaUsage || null;
  const quotaStr = found ? formatSessionQuotaCompact(sessionQuota) : '';
  const quotaTip = quotaStr ? formatSessionQuotaTip(sessionQuota, t) : undefined;

  return (
    <div ref={barRef} className="pulse-bar tabular-nums">
      <span className={genCls}>{genText}</span>
      <span className="text-hud-muted opacity-55" aria-hidden="true">·</span>
      <span className={ctxCls}>{ctxText}</span>
      {ageChip && (
        <>
          <span className="text-hud-muted opacity-55" aria-hidden="true">·</span>
          <span className={ageChip.cls} data-tip={ageChip.tip}>
            {ageChip.text}
          </span>
        </>
      )}
      {showCost && (
        <>
          <span className="text-hud-muted opacity-55" aria-hidden="true">·</span>
          <span className="pulse-chip">{fmtUsd(s?.totalCostUSD || 0)}</span>
        </>
      )}
      {quotaStr && (
        <>
          <span className="text-hud-muted opacity-55" aria-hidden="true">·</span>
          <span className="pulse-chip text-hud-accent-ink font-semibold cursor-help" data-tip={quotaTip}>
            {t.sessionQuotaPill(quotaStr)}
          </span>
        </>
      )}
    </div>
  );
}
