import { useId, useMemo } from 'preact/hooks';
import { useNowMs } from '../../hooks/useNow';
import type { Translations } from '../../i18n';
import type { ActiveStep, GeminiPulseSnapshot, Invocation } from '../../types/telemetry';
import { cacheTier, fmtCachePct, fmtNum, fmtSec, fmtTps } from '../../utils/format';

interface HeroSpeedCardsProps {
  found: boolean;
  latest: Invocation | null | undefined;
  latestSustained: Invocation | null | undefined;
  activeStep: ActiveStep | null | undefined;
  serverTimeMs?: number;
  invocations?: Invocation[];
  avgGenTps?: number;
  avgTtftSec?: number;
  geminiPulse?: GeminiPulseSnapshot;
  t: Translations;
}

/** Build a smooth monotone cubic Bezier SVG path through points */
function buildSmoothBezier(pts: Array<{ x: number; y: number }>, minY: number, maxY: number): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (n === 2) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-3, pts[i + 1].x - pts[i].x));
    dy.push(pts[i + 1].y - pts[i].y);
    slope.push(dy[i] / dx[i]);
  }

  const m: number[] = new Array(n).fill(0);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }

  const clampY = (v: number) => Math.max(minY, Math.min(maxY, v));
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const c1x = pts[i].x + h;
    const c1y = clampY(pts[i].y + m[i] * h);
    const c2x = pts[i + 1].x - h;
    const c2y = clampY(pts[i + 1].y - m[i + 1] * h);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

function fmtTtftNum(sec: number): { num: string; unit: string } {
  if (!Number.isFinite(sec) || sec < 0) return { num: '--', unit: '' };
  if (sec < 1) return { num: Math.round(sec * 1000).toString(), unit: 'ms' };
  if (sec < 10) return { num: sec.toFixed(2), unit: 's' };
  return { num: sec.toFixed(1), unit: 's' };
}

function ttftBarColor(sec: number): string {
  if (sec <= 2.0) return 'var(--seg-cache)';
  if (sec <= 6.0) return 'var(--hud-warn)';
  return 'var(--hud-bad)';
}

export function HeroSpeedCards({
  found,
  latest,
  latestSustained,
  activeStep,
  serverTimeMs,
  invocations = [],
  avgGenTps = 0,
  avgTtftSec = 0,
  geminiPulse,
  t,
}: HeroSpeedCardsProps) {
  const gradId = useId();
  const nowMs = useNowMs();

  let genValue = '--';
  let genSub = 'OUT -- · GEN --';
  let currentGenNum = 0;
  let ttftDisp = { num: '--', unit: '' };
  let ttftSub = 'Avg -- · E2E --';

  const isStreaming = Boolean(found && activeStep?.stepType === 15);
  const isActivelyGenerating = Boolean(isStreaming && activeStep && activeStep.streamStartMs > 0);
  const isWaitingTtft = Boolean(isStreaming && activeStep && !(activeStep.streamStartMs > 0));

  const baselineTtft = avgTtftSec > 0 ? avgTtftSec : latest?.ttftSec || 1.8;
  const liveStartMs = activeStep?.createdAtMs || serverTimeMs || nowMs;
  const liveWaitSec = isWaitingTtft ? Math.max(0, (nowMs - liveStartMs) / 1000) : 0;
  const liveLockedTtftSec =
    isActivelyGenerating && activeStep && activeStep.createdAtMs > 0 && activeStep.streamStartMs >= activeStep.createdAtMs
      ? (activeStep.streamStartMs - activeStep.createdAtMs) / 1000
      : null;
  const liveGenElapsedSec =
    isActivelyGenerating && activeStep && activeStep.streamStartMs > 0
      ? Math.max(0, (nowMs - activeStep.streamStartMs) / 1000)
      : 0;

  const isTtftStalled = isWaitingTtft && (liveWaitSec >= 6.0 || (baselineTtft > 0 && liveWaitSec >= Math.max(3.5, baselineTtft * 2.5)));
  const isTtftSlow = isWaitingTtft && !isTtftStalled && (liveWaitSec >= 2.2 || (baselineTtft > 0 && liveWaitSec >= Math.max(1.8, baselineTtft * 1.5)));

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

    ttftDisp = fmtTtftNum(latest.ttftSec);
    const avgRef = avgTtftSec > 0 ? fmtSec(avgTtftSec) : fmtSec(latest.ttftSec);
    ttftSub = t.ttftHeroSub(avgRef, fmtTps(latest.e2eTps));
  }

  // Live in-flight First-Token Stopwatch overrides the TTFT Hero card in real time
  if (isWaitingTtft) {
    ttftDisp = { num: liveWaitSec < 10 ? liveWaitSec.toFixed(1) : liveWaitSec.toFixed(0), unit: 's' };
    const avgRef = fmtSec(baselineTtft);
    if (baselineTtft > 0 && liveWaitSec >= Math.max(1.8, baselineTtft * 1.5)) {
      ttftSub = t.ttftLiveSlowSub((liveWaitSec / baselineTtft).toFixed(1), avgRef);
    } else {
      ttftSub = t.ttftLiveWaitingSub(avgRef);
    }
  } else if (isActivelyGenerating && liveLockedTtftSec !== null) {
    ttftDisp = fmtTtftNum(liveLockedTtftSec);
    const avgRef = fmtSec(baselineTtft);
    ttftSub = t.ttftLiveStreamSub(liveGenElapsedSec.toFixed(1), avgRef);
  }

  let livePill: { cls: string; text: string } | null = null;
  if (isStreaming) {
    livePill = isActivelyGenerating
      ? { cls: 'live-pill', text: t.liveRowTagStream }
      : { cls: isTtftStalled ? 'live-pill is-bad' : 'live-pill is-wait', text: t.liveWaitBadge };
  } else if (found && activeStep?.stepType === 23) {
    livePill = { cls: 'live-pill is-compact', text: t.compactLiveBadge };
  }

  let ttftLivePill: { cls: string; text: string } | null = null;
  if (isWaitingTtft) {
    ttftLivePill = isTtftStalled
      ? { cls: 'live-pill is-bad', text: t.ttftLiveStallBadge }
      : { cls: 'live-pill is-wait', text: t.liveWaitBadge };
  } else if (isActivelyGenerating && liveLockedTtftSec !== null) {
    ttftLivePill = { cls: 'live-pill', text: t.ttftLiveLockedBadge };
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
      .slice(-10)
      .map((r) => r.genTps);
    const series =
      sustained.length >= 3
        ? sustained
        : invocations
            .filter((r) => r.e2eTps > 0)
            .slice(-10)
            .map((r) => r.e2eTps);
    if (series.length < 3) return null;

    const w = 160;
    const h = 24;
    const padX = 2;
    const padTop = 4;
    const padBottom = 3;
    const minV = Math.min(...series);
    const maxV = Math.max(...series);
    const span = maxV - minV;
    const pts = series.map((v, i) => {
      const x = padX + (i / (series.length - 1)) * (w - padX * 2 - 3);
      const norm = span > 0.01 ? (v - minV) / span : 0.5;
      const y = h - padBottom - norm * (h - padTop - padBottom);
      return { x, y };
    });
    const linePath = buildSmoothBezier(pts, padTop - 1, h - padBottom + 1);
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`;
    const lastPt = pts[pts.length - 1];
    return {
      count: series.length,
      w,
      h,
      linePath,
      areaPath,
      lastPt,
    };
  }, [found, invocations]);

  // Last 10 calls TTFT mini-bars (+ live growing in-flight bar when waiting/streaming)
  const liveBarSec = isWaitingTtft ? Math.max(0.15, liveWaitSec) : liveLockedTtftSec;
  const ttftBars = useMemo(() => {
    if (!found || (invocations.length < 2 && liveBarSec === null)) return null;
    const histLimit = liveBarSec !== null ? 9 : 10;
    const slice = invocations.filter((r) => r.ttftSec >= 0).slice(-histLimit);
    if (slice.length < 1 && liveBarSec === null) return null;

    const vals = slice.map((r) => Math.max(0.05, r.ttftSec));
    if (liveBarSec !== null) vals.push(Math.max(0.15, liveBarSec));
    if (vals.length < 2) return null;

    const maxVal = Math.max(...vals, avgTtftSec || 0, 1.5);
    const w = 160;
    const h = 24;
    const padTop = 2;
    const padBottom = 1;
    const plotH = h - padTop - padBottom;
    const gap = 3;
    const slotW = (w - gap * (vals.length - 1)) / vals.length;

    const bars = vals.map((v, i) => {
      const barH = Math.max(2.5, (v / maxVal) * plotH);
      const x = i * (slotW + gap);
      const y = h - padBottom - barH;
      const isLast = i === vals.length - 1;
      return {
        x,
        y,
        w: Math.max(3, slotW),
        h: barH,
        color: ttftBarColor(v),
        isLast,
        isLive: isLast && liveBarSec !== null,
      };
    });

    const avgY =
      avgTtftSec > 0 ? Math.max(padTop + 1, Math.min(h - padBottom - 1, h - padBottom - (avgTtftSec / maxVal) * plotH)) : null;

    const latestSec = liveBarSec !== null ? liveBarSec : latest?.ttftSec || vals[vals.length - 1];
    const totalSec = Math.max(latest?.totalSec || 0, latestSec + (latest?.genSec || 0));
    const sharePct = totalSec > 0 ? Math.round((latestSec / totalSec) * 100) : 0;
    const tip = t.ttftBarsTip(vals.length, fmtSec(latestSec), sharePct, fmtSec(avgTtftSec || latestSec));

    return { w, h, bars, avgY, tip };
  }, [found, invocations, avgTtftSec, latest, liveBarSec, t]);

  const pulseIndicator = useMemo(() => {
    const attr = geminiPulse?.attribution;
    if (!found || !attr) return null;
    const gP50 = attr.globalP50TtftSec !== null ? fmtSec(attr.globalP50TtftSec) : '';
    const gP90 = attr.globalP90TtftSec !== null ? fmtSec(attr.globalP90TtftSec) : '--';
    const tip = t.ttftAttributionTip({
      headline: t.ttftVerdictHeadline(attr.verdict),
      model: attr.label,
      curTtft: fmtSec(attr.currentTtftSec),
      curTps: attr.currentTps > 0 ? fmtTps(attr.currentTps) : '--',
      curCache: attr.currentCachePct !== null ? `${attr.currentCachePct.toFixed(0)}%` : '--',
      curNewIn: fmtNum(attr.currentNewInput),
      localP50: attr.localP50TtftSec !== null ? fmtSec(attr.localP50TtftSec) : '--',
      localP90: attr.localP90TtftSec !== null ? fmtSec(attr.localP90TtftSec) : '--',
      localBucketLabel: t.ttftBucketLabel(attr.localBucket),
      curCtx: attr.currentCtxTokens ? fmtNum(attr.currentCtxTokens) : undefined,
      globalAvgCtx: attr.globalAvgCtxTokens ? fmtNum(attr.globalAvgCtxTokens) : undefined,
      globalP50: gP50 || '--',
      globalP90: gP90,
      globalTps: attr.globalP50Tps !== null ? fmtTps(attr.globalP50Tps) : '--',
      globalCache: attr.globalCachePct !== null ? `${attr.globalCachePct.toFixed(0)}%` : '--',
      globalUptime: attr.globalUptime30mPct !== null ? `${attr.globalUptime30mPct.toFixed(0)}%` : '--',
      globalReq30m: attr.globalRequests30m > 0 ? fmtNum(attr.globalRequests30m) : '--',
      inFlight: attr.inFlightCount,
    });

    if (attr.verdict === 'upstream_degraded') {
      return { isAlert: true, dotCls: 'bg-hud-bad', pillCls: 'text-hud-bad bg-tint-bad', text: t.ttftVerdictUpstream(gP50), tip };
    }
    if (attr.verdict === 'cache_miss') {
      return { isAlert: true, dotCls: 'bg-seg-out', pillCls: 'text-seg-out bg-tint-out', text: t.ttftVerdictCacheMiss(fmtNum(attr.currentNewInput)), tip };
    }
    if (attr.verdict === 'large_context') {
      return { isAlert: true, dotCls: 'bg-seg-think', pillCls: 'text-seg-think bg-tint-think', text: t.ttftVerdictLargeCtx(fmtNum(attr.currentCtxTokens || attr.currentNewInput)), tip };
    }
    if (attr.verdict === 'local_concurrency') {
      return { isAlert: true, dotCls: 'bg-hud-warn', pillCls: 'text-hud-warn bg-tint-warn', text: t.ttftVerdictConcurrency(attr.inFlightCount), tip };
    }
    if (attr.verdict === 'account_or_network') {
      return { isAlert: true, dotCls: 'bg-seg-input', pillCls: 'text-seg-input bg-tint-input', text: t.ttftVerdictLocalSlow(gP50), tip };
    }
    if (!gP50) return null;
    const dotCls =
      attr.globalStatus === 'outage'
        ? 'bg-hud-bad'
        : attr.globalStatus === 'degraded'
          ? 'bg-hud-warn'
          : 'bg-hud-ok';
    return { isAlert: false, dotCls, pillCls: 'text-hud-muted', text: t.ttftGlobalInline(gP50), tip };
  }, [found, geminiPulse?.attribution, t]);

  return (
    <div className="hero-speed-grid grid grid-cols-2 gap-2">
      {/* Left Hero: Sustained Generation Speed (Gen TPS) */}
      <div
        className={`hud-card min-w-0 max-w-full flex flex-col justify-between overflow-hidden${
          isStreaming ? ' is-streaming' : ''
        }`}
      >
        <div>
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
          <div className="hero-v mt-1.5 flex items-baseline gap-1 font-hud-mono text-[24px] font-bold leading-[1.08] tabular-nums min-w-0">
            <span className="truncate">{genValue}</span>
            <span className="hud-unit text-[11px] shrink-0">tok/s</span>
          </div>
          <div className="card-sub truncate whitespace-nowrap" data-tip={genSub}>{genSub}</div>
        </div>

        {sparkline && (
          <div className="mt-1.5 -mx-1 -mb-1 cursor-help" data-tip={t.heroSparkTip(sparkline.count)}>
            <svg
              viewBox={`0 0 ${sparkline.w} ${sparkline.h}`}
              preserveAspectRatio="none"
              className="block w-full h-[24px] overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--seg-cache)" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="var(--seg-cache)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d={sparkline.areaPath} fill={`url(#${gradId})`} />
              <path
                d={sparkline.linePath}
                fill="none"
                stroke="var(--seg-cache)"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
              <circle
                cx={sparkline.lastPt.x}
                cy={sparkline.lastPt.y}
                r="4.2"
                fill="var(--seg-cache)"
                opacity="0.2"
              />
              <circle
                cx={sparkline.lastPt.x}
                cy={sparkline.lastPt.y}
                r="2.1"
                fill="var(--seg-cache)"
                stroke="var(--hud-card)"
                stroke-width="0.9"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Right Hero: First Token Wait (TTFT) + Live Stopwatch + Animated Scan & Bar Chart */}
      <div
        className={`hud-card min-w-0 max-w-full flex flex-col justify-between overflow-hidden${
          isTtftStalled
            ? ' is-waiting-stalled'
            : isWaitingTtft
              ? ' is-waiting-ttft'
              : isActivelyGenerating && liveLockedTtftSec !== null
                ? ' is-streaming is-ttft-locked'
                : ''
        }`}
      >
        <div>
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <span className="card-k truncate">{t.ttftHeroLabel}</span>
            {ttftLivePill ? (
              <span className={`${ttftLivePill.cls} shrink-0`}>
                {isWaitingTtft && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                <span>{ttftLivePill.text}</span>
              </span>
            ) : found && latest && latest.cacheHitPct !== null ? (
              <span
                className={`cache-pill cursor-help shrink-0 ${cacheTier(latest.cacheHitPct)}`}
                data-tip={t.heroCacheTip(
                  fmtCachePct(latest.cacheHitPct),
                  latest.cachedInput.toLocaleString(),
                  latest.newInput.toLocaleString(),
                )}
              >
                {t.heroCachePill(fmtCachePct(latest.cacheHitPct))}
              </span>
            ) : null}
          </div>
          <div
            className={`hero-v mt-1.5 flex items-baseline justify-between gap-1 font-hud-mono text-[24px] font-bold leading-[1.08] tabular-nums min-w-0 transition-colors duration-200${
              isTtftStalled ? ' text-hud-bad' : isTtftSlow ? ' text-hud-warn' : isActivelyGenerating && liveLockedTtftSec !== null ? ' text-hud-ok' : ''
            }`}
          >
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="truncate">{ttftDisp.num}</span>
              {ttftDisp.unit && <span className="hud-unit text-[11px] shrink-0">{ttftDisp.unit}</span>}
            </div>
            {pulseIndicator && (
              <span
                className={`inline-flex items-center gap-1 cursor-help font-hud text-[9.5px] leading-none shrink-0 max-w-[110px] truncate ${
                  pulseIndicator.isAlert
                    ? `px-1.5 py-[2.5px] rounded-full font-semibold ${pulseIndicator.pillCls}`
                    : `font-medium ${pulseIndicator.pillCls}`
                }`}
                data-tip={pulseIndicator.tip}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pulseIndicator.dotCls}`} />
                <span className="truncate">{pulseIndicator.text}</span>
              </span>
            )}
          </div>
          <div className="card-sub truncate whitespace-nowrap" data-tip={ttftSub}>{ttftSub}</div>

          {isWaitingTtft && (() => {
            const scaleMax = Math.max(8, baselineTtft * 3);
            const fillPct = Math.min(100, Math.max(6, (liveWaitSec / scaleMax) * 100));
            const avgTickPct = Math.min(88, Math.max(10, (baselineTtft / scaleMax) * 100));
            const fillColor = isTtftStalled ? 'var(--hud-bad)' : isTtftSlow ? 'var(--hud-warn)' : 'var(--seg-cache)';
            return (
              <div className="ttft-wait-track" aria-hidden="true">
                <div
                  className="ttft-wait-fill"
                  style={{ width: `${fillPct.toFixed(1)}%`, backgroundColor: fillColor }}
                />
                <span className="ttft-wait-avg-tick" style={{ left: `${avgTickPct.toFixed(1)}%` }} />
              </div>
            );
          })()}
        </div>

        {ttftBars && (
          <div className="mt-1.5 -mb-1 cursor-help" data-tip={ttftBars.tip}>
            <svg
              viewBox={`0 0 ${ttftBars.w} ${ttftBars.h}`}
              preserveAspectRatio="none"
              className="block w-full h-[24px]"
              aria-hidden="true"
            >
              {ttftBars.avgY !== null && (
                <line
                  x1="0"
                  y1={ttftBars.avgY.toFixed(1)}
                  x2={ttftBars.w}
                  y2={ttftBars.avgY.toFixed(1)}
                  stroke="var(--hud-muted)"
                  stroke-opacity="0.35"
                  stroke-width="0.8"
                  stroke-dasharray="2.5 2.5"
                  vector-effect="non-scaling-stroke"
                />
              )}
              {ttftBars.bars.map((b, i) => (
                <rect
                  key={i}
                  x={b.x.toFixed(1)}
                  y={b.y.toFixed(1)}
                  width={b.w.toFixed(1)}
                  height={b.h.toFixed(1)}
                  rx="2"
                  fill={b.color}
                  fill-opacity={b.isLast ? '0.95' : '0.48'}
                  className={b.isLive && isWaitingTtft ? 'ttft-bar-live' : undefined}
                />
              ))}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
