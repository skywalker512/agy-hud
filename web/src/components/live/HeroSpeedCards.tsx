import { useId, useMemo } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { ActiveStep, Invocation } from '../../types/telemetry';
import { cacheTier, fmtCachePct, fmtSec, fmtTps } from '../../utils/format';

interface HeroSpeedCardsProps {
  found: boolean;
  latest: Invocation | null | undefined;
  latestSustained: Invocation | null | undefined;
  activeStep: ActiveStep | null | undefined;
  invocations?: Invocation[];
  avgGenTps?: number;
  t: Translations;
}

/** Build a smooth monotone cubic Bezier SVG path through points (optional skipMove to continue a closed polygon) */
function buildSmoothBezier(
  pts: Array<{ x: number; y: number }>,
  minY: number,
  maxY: number,
  skipMove = false,
): string {
  const n = pts.length;
  if (n === 0) return '';
  const lead = skipMove ? `L${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` : `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (n === 1) return lead;
  if (n === 2) return `${lead} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const rawDx = pts[i + 1].x - pts[i].x;
    dx.push(Math.abs(rawDx) < 1e-3 ? (rawDx < 0 ? -1e-3 : 1e-3) : rawDx);
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
  let d = lead;
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

export function HeroSpeedCards({
  found,
  latest,
  latestSustained,
  activeStep,
  invocations = [],
  avgGenTps = 0,
  t,
}: HeroSpeedCardsProps) {
  const gradId = useId();

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

  const isStreaming = Boolean(found && activeStep?.stepType === 15);
  const isActivelyGenerating = Boolean(isStreaming && activeStep && activeStep.streamStartMs > 0);

  let livePill: { cls: string; text: string } | null = null;
  if (isStreaming) {
    livePill = isActivelyGenerating
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

  // Dual-Curve "TTFT Drag" Sparkline for E2E card (shared Y-scale across genTps ceiling & e2eTps actual)
  const e2eSparkline = useMemo(() => {
    if (!found || invocations.length < 3) return null;
    const sustained = invocations.filter((r) => !r.isBuffered && r.genTps > 0 && r.e2eTps > 0).slice(-10);
    const pool =
      sustained.length >= 3
        ? sustained
        : invocations.filter((r) => r.e2eTps > 0).slice(-10);
    if (pool.length < 3) return null;

    const w = 160;
    const h = 24;
    const padX = 2;
    const padTop = 3.5;
    const padBottom = 3;
    const maxV = Math.max(
      1,
      ...pool.map((r) => Math.max(r.isBuffered ? r.e2eTps : r.genTps, r.e2eTps)),
    );

    const toY = (val: number) => {
      const norm = Math.max(0, Math.min(1, val / maxV));
      return h - padBottom - norm * (h - padTop - padBottom);
    };

    const genPts = pool.map((r, i) => {
      const x = padX + (i / (pool.length - 1)) * (w - padX * 2 - 3);
      const ceilVal = Math.max(r.isBuffered ? r.e2eTps : r.genTps, r.e2eTps);
      return { x, y: toY(ceilVal) };
    });
    const e2ePts = pool.map((r, i) => {
      const x = padX + (i / (pool.length - 1)) * (w - padX * 2 - 3);
      return { x, y: toY(r.e2eTps) };
    });

    const minY = padTop - 0.5;
    const maxY = h - padBottom + 0.5;
    const genPath = buildSmoothBezier(genPts, minY, maxY);
    const e2ePath = buildSmoothBezier(e2ePts, minY, maxY);
    const revE2ePath = buildSmoothBezier([...e2ePts].reverse(), minY, maxY, true);
    const dragBandPath = `${genPath} ${revE2ePath} Z`;
    const lastPt = e2ePts[e2ePts.length - 1];

    const lastRec = latest || pool[pool.length - 1];
    const ttftSharePct =
      lastRec && lastRec.totalSec > 0
        ? Math.max(0, Math.min(100, Math.round((lastRec.ttftSec / lastRec.totalSec) * 100)))
        : 0;

    return {
      count: pool.length,
      w,
      h,
      genPath,
      e2ePath,
      dragBandPath,
      lastPt,
      ttftSharePct,
    };
  }, [found, invocations, latest]);

  return (
    <div className="hero-speed-grid grid grid-cols-2 gap-2">
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

      <div className="hud-card min-w-0 max-w-full flex flex-col justify-between overflow-hidden">
        <div>
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <span className="card-k truncate">{t.e2eLabel}</span>
            {found && latest && latest.cacheHitPct !== null && (
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
            )}
          </div>
          <div className="hero-v mt-1.5 flex items-baseline gap-1 font-hud-mono text-[24px] font-bold leading-[1.08] tabular-nums">
            <span className="truncate">{e2eValue}</span>
            <span className="hud-unit text-[11px] shrink-0">tok/s</span>
          </div>
          <div className="card-sub truncate whitespace-nowrap" data-tip={e2eSub}>{e2eSub}</div>
        </div>

        {e2eSparkline && (
          <div
            className="mt-1.5 -mx-1 -mb-1 cursor-help"
            data-tip={t.e2eSparkTip(e2eSparkline.count, e2eSparkline.ttftSharePct)}
          >
            <svg
              viewBox={`0 0 ${e2eSparkline.w} ${e2eSparkline.h}`}
              preserveAspectRatio="none"
              className="block w-full h-[24px] overflow-visible"
              aria-hidden="true"
            >
              <path
                d={e2eSparkline.dragBandPath}
                fill="var(--hud-warn)"
                fill-opacity="0.16"
              />
              <path
                d={e2eSparkline.genPath}
                fill="none"
                stroke="var(--seg-cache)"
                stroke-opacity="0.45"
                stroke-width="1.2"
                stroke-dasharray="2.5 2"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
              <path
                d={e2eSparkline.e2ePath}
                fill="none"
                stroke="var(--hud-accent-ink)"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
              <circle
                cx={e2eSparkline.lastPt.x}
                cy={e2eSparkline.lastPt.y}
                r="4.2"
                fill="var(--hud-accent-ink)"
                fill-opacity="0.2"
              />
              <circle
                cx={e2eSparkline.lastPt.x}
                cy={e2eSparkline.lastPt.y}
                r="2.1"
                fill="var(--hud-accent-ink)"
                stroke="var(--hud-card)"
                stroke-width="0.9"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
