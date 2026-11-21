import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { ChartMetric, Compaction, Invocation, Lang } from '../../types/telemetry';
import {
  cacheTier,
  fmtCachePct,
  fmtNum,
  fmtQuotaPct,
  fmtSec,
  fmtTps,
  fmtUsd,
  formatModelTag,
  ttftTier,
} from '../../utils/format';

export interface TrendChartCardProps {
  invocations: Invocation[];
  compactions?: Compaction[];
  convId: string;
  metric: ChartMetric;
  lang?: Lang;
  t: Translations;
  onSelectMetric: (m: ChartMetric) => void;
  onInspectCall?: (invIdx: number) => void;
  selectedModel?: string;
  onSelectModel?: (modelKey: string) => void;
}

interface Pt {
  x: number;
  y: number;
  val: number;
  inv: Invocation;
  slotIdx: number;
}

interface ModelMeta {
  key: string;
  label: string;
  color: string;
  count: number;
  avgBadge: string;
}

const METRICS: ChartMetric[] = ['tps', 'ttft', 'out', 'cache', 'ctx', 'quota'];
const MODEL_PALETTE = ['var(--seg-think)', 'var(--seg-cache)', 'var(--seg-input)', 'var(--seg-out)'];

function getModelKey(r: Invocation): string {
  return formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
}

function shortTierSuffix(probe: string): string {
  const m = /(?:\(|-)(xhigh|high|medium|low|minimal)\)?\s*$/i.exec(probe.trim());
  if (!m) return '';
  const t = m[1].toLowerCase();
  if (t === 'xhigh') return '·XH';
  if (t === 'low') return '·L';
  if (t === 'medium') return '·M';
  if (t === 'minimal') return '·Min';
  return '';
}

function shortModelName(r: Invocation): string {
  const fullTag = formatModelTag(r.modelId, r.modelDisplay, r.model);
  const probe = `${r.modelDisplay || ''} ${fullTag} ${r.model || ''}`.toLowerCase();
  const tier = shortTierSuffix(fullTag || r.modelDisplay || '');
  if (probe.includes('orchestrator')) {
    if (probe.includes('carbon')) return 'Orch·Carbon';
    if (probe.includes('neon')) return 'Orch·Neon';
    if (probe.includes('argon')) return 'Orch·Argon';
    if (probe.includes('hydrogen')) return 'Orch·Hydro';
    return 'Orchestrator';
  }
  if (probe.includes('flash-worker')) return 'Flash·Worker';
  if (probe.includes('3.8-flash') || probe.includes('3.8 flash')) return `3.8 Flash${tier}`;
  if (probe.includes('carbon')) return `Carbon${tier}`;
  if (probe.includes('argon')) return `Argon${tier}`;
  if (probe.includes('hydrogen')) return `Hydrogen${tier}`;
  if (probe.includes('neon')) return `Neon${tier}`;
  if (probe.includes('opus')) return `Opus${tier}`;
  if (probe.includes('sonnet')) return `Sonnet${tier}`;
  const raw = r.modelDisplay || fullTag || r.model || 'Model';
  return raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
}

function preferredModelColor(r: Invocation): string {
  const probe = `${r.modelDisplay || ''} ${r.modelId || ''} ${r.model || ''}`.toLowerCase();
  if (probe.includes('flash') || probe.includes('hydrogen')) {
    return 'var(--seg-cache)';
  }
  if (probe.includes('neon') || probe.includes('sonnet')) {
    return 'var(--seg-input)';
  }
  if (probe.includes('orchestrator') || probe.includes('carbon') || probe.includes('argon') || probe.includes('opus')) {
    return 'var(--seg-think)';
  }
  return 'var(--seg-out)';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildMonotonePath(pts: Array<{ x: number; y: number }>, minY: number, maxY: number): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-3, pts[i + 1].x - pts[i].x);
    h.push(dx);
    d.push((pts[i + 1].y - pts[i].y) / dx);
  }

  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const step = h[i] / 3;
    const cp1x = pts[i].x + step;
    const cp1y = clamp(pts[i].y + m[i] * step, minY, maxY);
    const cp2x = pts[i + 1].x - step;
    const cp2y = clamp(pts[i + 1].y - m[i + 1] * step, minY, maxY);
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
  }
  return path;
}

function buildTip(r: Invocation, metric: ChartMetric, t: Translations): string {
  const modelTag = formatModelTag(r.modelId, r.modelDisplay, r.model);
  if (metric === 'ttft') {
    return t.tipTtft(r.idx + 1, modelTag, fmtSec(r.ttftSec), fmtSec(r.genSec), fmtSec(r.totalSec));
  }
  if (metric === 'out') {
    const tot = Math.max(0, r.outputTokens || 0);
    const thk = Math.max(0, r.thinkingTokens || 0);
    const vis = Math.max(0, r.candidateTokens || tot - thk);
    return t.tipOut(r.idx + 1, modelTag, tot.toLocaleString(), thk.toLocaleString(), vis.toLocaleString(), fmtSec(r.genSec));
  }
  if (metric === 'cache') {
    return t.tipCache(r.idx + 1, modelTag, fmtCachePct(r.cacheHitPct), fmtNum(r.cachedInput), fmtNum(r.newInput));
  }
  if (metric === 'ctx') {
    return t.tipCtx(r.idx + 1, modelTag, fmtNum(r.totalContext), fmtNum(r.contextLimit), r.contextPct);
  }
  if (metric === 'quota') {
    const p5 = fmtQuotaPct(r.quotaPct5h) || '0%';
    const p7 = r.quotaPct7d ? fmtQuotaPct(r.quotaPct7d) : '';
    const kStr = (r.quotaMultiplierK || 1).toFixed(2);
    const cUsd = r.priced ? fmtUsd(r.costUSD) : '';
    return t.tipQuota(r.idx + 1, modelTag, p5, p7, kStr, cUsd);
  }
  const cStr = fmtCachePct(r.cacheHitPct);
  return r.isBuffered
    ? t.tipBuf(r.idx + 1, modelTag, (r.genSec * 1000).toFixed(0), fmtTps(r.e2eTps), r.outputTokens, cStr, fmtSec(r.ttftSec))
    : t.tipOk(r.idx + 1, modelTag, fmtTps(r.genTps), fmtTps(r.e2eTps), r.outputTokens, cStr, fmtSec(r.ttftSec));
}

function formatModelMetricAvg(items: Invocation[], metric: ChartMetric): string {
  if (!items.length) return '';
  if (metric === 'ttft') {
    const avg = items.reduce((s, r) => s + (r.ttftSec || 0), 0) / items.length;
    return fmtSec(avg);
  }
  if (metric === 'out') {
    const avg = items.reduce((s, r) => s + (r.outputTokens || 0), 0) / items.length;
    return fmtNum(avg);
  }
  if (metric === 'cache') {
    const valid = items.map((r) => r.cacheHitPct).filter((v): v is number => v !== null && Number.isFinite(v));
    const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    return fmtCachePct(avg);
  }
  if (metric === 'ctx') {
    return `${items.length}`;
  }
  if (metric === 'quota') {
    const avg = items.reduce((s, r) => s + (r.quotaPct5h || 0), 0) / items.length;
    const f = fmtQuotaPct(avg);
    return f ? `-${f}` : '';
  }
  const avg = items.reduce((s, r) => s + (r.isBuffered ? r.e2eTps : r.genTps), 0) / items.length;
  return `${fmtTps(avg)} t/s`;
}

export function TrendChartCard({
  invocations,
  compactions = [],
  convId,
  metric,
  t,
  onSelectMetric,
}: TrendChartCardProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [svgW, setSvgW] = useState(360);
  const [selectedModel, setSelectedModel] = useState<string>('all');

  useEffect(() => {
    setSelectedModel('all');
  }, [convId]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setSvgW(Math.max(200, Math.round(el.clientWidth)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || el.clientWidth;
      if (width > 0) setSvgW(Math.max(200, Math.round(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const windowSlice = useMemo(() => invocations.slice(-36), [invocations]);

  const { windowModels, modelColorMap } = useMemo(() => {
    const grouped = new Map<string, { items: Invocation[]; label: string }>();
    for (const r of windowSlice) {
      const key = getModelKey(r);
      const entry = grouped.get(key);
      if (entry) {
        entry.items.push(r);
      } else {
        grouped.set(key, { items: [r], label: shortModelName(r) });
      }
    }

    const usedColors = new Set<string>();
    const colorMap = new Map<string, string>();
    const metas: ModelMeta[] = [];
    let fallbackIdx = 0;

    for (const [key, { items, label }] of grouped.entries()) {
      let color = preferredModelColor(items[0]);
      if (usedColors.has(color)) {
        const free = MODEL_PALETTE.find((c) => !usedColors.has(c));
        color = free || MODEL_PALETTE[fallbackIdx % MODEL_PALETTE.length];
      }
      usedColors.add(color);
      colorMap.set(key, color);
      fallbackIdx += 1;
      metas.push({
        key,
        label,
        color,
        count: items.length,
        avgBadge: formatModelMetricAvg(items, metric),
      });
    }
    return { windowModels: metas, modelColorMap: colorMap };
  }, [windowSlice, metric]);

  useEffect(() => {
    if (selectedModel !== 'all' && !invocations.some((r) => getModelKey(r) === selectedModel)) {
      setSelectedModel('all');
    }
  }, [invocations, selectedModel]);

  const recent = useMemo(() => {
    if (selectedModel === 'all') return invocations.slice(-32);
    return invocations.filter((r) => getModelKey(r) === selectedModel).slice(-28);
  }, [invocations, selectedModel]);

  const metricLabel = (m: ChartMetric): string => {
    if (m === 'tps') return t.tabTps;
    if (m === 'ttft') return t.tabTtft;
    if (m === 'out') return t.tabOut;
    if (m === 'cache') return t.tabCache;
    if (m === 'quota') return t.tabQuota;
    return t.tabCtx;
  };

  let subText = '';
  let maxVal = 100;
  if (recent.length > 0) {
    const last = recent[recent.length - 1];
    if (metric === 'ttft') {
      maxVal = Math.max(0.5, ...recent.map((r) => r.ttftSec || 0));
      const avg = recent.reduce((s, r) => s + (r.ttftSec || 0), 0) / recent.length;
      const mx = Math.max(...recent.map((r) => r.ttftSec || 0));
      subText = t.chartSubTtft(recent.length, fmtSec(avg), fmtSec(mx), fmtSec(last.ttftSec));
    } else if (metric === 'out') {
      maxVal = Math.max(10, ...recent.map((r) => r.outputTokens || 0));
      const avg = recent.reduce((s, r) => s + (r.outputTokens || 0), 0) / recent.length;
      const mx = Math.max(...recent.map((r) => r.outputTokens || 0));
      subText = t.chartSubOut(recent.length, fmtNum(avg), fmtNum(mx), fmtNum(last.outputTokens));
    } else if (metric === 'cache') {
      maxVal = 100;
      const valid = recent
        .map((r) => r.cacheHitPct)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
      const mn = valid.length ? Math.min(...valid) : null;
      subText = t.chartSubCache(recent.length, fmtCachePct(avg), fmtCachePct(mn), fmtCachePct(last.cacheHitPct));
    } else if (metric === 'ctx') {
      maxVal = 100;
      const mx = Math.max(...recent.map((r) => r.contextPct || 0));
      subText = t.chartSubCtx(recent.length, `${last.contextPct.toFixed(1)}%`, `${mx.toFixed(1)}%`);
    } else if (metric === 'quota') {
      const vals = recent.map((r) => r.quotaPct5h || 0);
      const mx = Math.max(0, ...vals);
      maxVal = Math.max(0.02, mx);
      const sum = vals.reduce((s, v) => s + v, 0);
      const avg = sum / recent.length;
      subText = t.chartSubQuota(
        recent.length,
        fmtQuotaPct(sum) || '0%',
        fmtQuotaPct(avg) || '0%',
        fmtQuotaPct(mx) || '0%',
      );
    } else {
      const vals = recent.map((r) => (r.isBuffered ? r.e2eTps : r.genTps));
      maxVal = Math.max(10, ...vals);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const mx = Math.max(...vals);
      const lastV = last.isBuffered ? last.e2eTps : last.genTps;
      subText = t.chartSubTps(recent.length, fmtTps(avg), fmtTps(mx), fmtTps(lastV));
    }
  }

  const showModelPills = windowModels.length >= 2 || selectedModel !== 'all';
  const isMultiInView = useMemo(() => {
    if (recent.length < 2) return false;
    const keys = new Set(recent.map(getModelKey));
    return keys.size >= 2;
  }, [recent]);

  const h = 104;
  const padX = 8;
  const padTop = 10;
  const padBottom = isMultiInView ? 14 : 10;
  const chartH = h - padTop - padBottom;
  const yBase = padTop + chartH;
  const plotW = Math.max(40, svgW - padX * 2);
  const slotW = recent.length > 0 ? plotW / recent.length : plotW;
  const barW = Math.max(3, Math.min(18, slotW * 0.7));
  const slotX = (i: number) => padX + (i + 0.5) * slotW;
  const valY = (val: number) => padTop + chartH - clamp(val / maxVal, 0, 1) * chartH;

  const seriesList = useMemo(() => {
    const byKey = new Map<string, { key: string; color: string; points: Pt[] }>();
    recent.forEach((r, i) => {
      const key = getModelKey(r);
      const color = modelColorMap.get(key) || 'var(--hud-accent)';
      const val = metric === 'ttft'
        ? (r.ttftSec || 0)
        : metric === 'cache'
          ? (r.cacheHitPct ?? 0)
          : metric === 'ctx'
            ? (r.contextPct || 0)
            : metric === 'quota'
              ? (r.quotaPct5h || 0)
              : (r.isBuffered ? r.e2eTps : r.genTps);
      const pt: Pt = { x: slotX(i), y: valY(val), val, inv: r, slotIdx: i };
      const existing = byKey.get(key);
      if (existing) {
        existing.points.push(pt);
      } else {
        byKey.set(key, { key, color, points: [pt] });
      }
    });
    return [...byKey.values()];
  }, [recent, modelColorMap, metric, slotW, maxVal]);

  const ctxAllPoints = useMemo(() => {
    if (metric !== 'ctx') return [];
    return recent.map((r, i) => ({
      x: slotX(i),
      y: valY(r.contextPct || 0),
      val: r.contextPct || 0,
      inv: r,
      slotIdx: i,
    }));
  }, [metric, recent, slotW]);

  const compactMarkerXs = useMemo(() => {
    if (metric !== 'ctx' || recent.length < 2 || !compactions.length) return [];
    const xs: number[] = [];
    for (const c of compactions) {
      if (c.afterGmIdx === null || c.afterGmIdx === undefined) continue;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i - 1].idx < c.afterGmIdx && recent[i].idx >= c.afterGmIdx) {
          xs.push((slotX(i - 1) + slotX(i)) / 2);
          break;
        }
      }
    }
    return xs;
  }, [metric, recent, compactions, slotW]);

  const singleCurveSeries = seriesList.length === 1 ? seriesList[0] : null;
  const ctxCurvePath = ctxAllPoints.length >= 2 ? buildMonotonePath(ctxAllPoints, padTop, yBase) : '';
  const gridYs = [valY(maxVal), valY(maxVal * 0.5), yBase];

  return (
    <section className="hud-card">
      <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span className="card-k">{t.chartTitle}</span>
          <span className="card-sub !mt-0">{t.chartMeta(invocations.length)}</span>
        </div>

        <div className="metric-tabs">
          {METRICS.map((m) => (
            <button
              key={m}
              type="button"
              className={`metric-tab${metric === m ? ' is-active' : ''}`}
              onClick={() => onSelectMetric(m)}
            >
              {metricLabel(m)}
            </button>
          ))}
        </div>
      </div>

      {showModelPills && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 min-w-0">
          <button
            type="button"
            className={`trend-model-pill${selectedModel === 'all' ? ' is-active' : ''}`}
            onClick={() => setSelectedModel('all')}
          >
            {t.chartAllModels(windowSlice.length)}
          </button>
          {windowModels.map((m) => {
            const active = selectedModel === m.key;
            return (
              <button
                key={m.key}
                type="button"
                className={`trend-model-pill${active ? ' is-active' : ''}`}
                data-tip={t.chartModelFilterTip(m.label, m.count, m.avgBadge, active)}
                onClick={() => setSelectedModel(active ? 'all' : m.key)}
              >
                <span
                  className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                  style={{ backgroundColor: m.color }}
                />
                <span>{m.label}</span>
                {m.avgBadge && <span className="text-hud-fg/75">{m.avgBadge}</span>}
              </button>
            );
          })}
        </div>
      )}

      {subText && (
        <div className="mt-[5px] text-[11px] text-hud-muted font-hud-mono tabular-nums">
          {subText}
        </div>
      )}

      <div ref={boxRef} className="mt-1.5 min-h-[104px]">
        {recent.length === 0 ? (
          <div className="py-[18px] px-2 text-center text-[12px] text-hud-muted">{t.noCalls}</div>
        ) : (
          <svg className="w-full h-[104px] block overflow-visible" viewBox={`0 0 ${svgW} ${h}`}>
            <defs>
              <linearGradient id="trend-ctx-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--seg-input)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--seg-input)" stopOpacity="0.02" />
              </linearGradient>
              {singleCurveSeries && (
                <linearGradient id={`trend-area-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={singleCurveSeries.color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={singleCurveSeries.color} stopOpacity="0.02" />
                </linearGradient>
              )}
            </defs>

            {gridYs.map((gy, gi) => (
              <line
                key={gi}
                x1={padX}
                y1={gy.toFixed(1)}
                x2={(padX + plotW).toFixed(1)}
                y2={gy.toFixed(1)}
                stroke="var(--hud-border)"
                strokeWidth="1"
                strokeDasharray={gi === 2 ? undefined : '2 3'}
                opacity={gi === 2 ? 0.7 : 0.65}
              />
            ))}

            {metric === 'out' &&
              recent.map((r, i) => {
                const x = slotX(i) - barW / 2;
                const tot = Math.max(0, r.outputTokens || 0);
                const thk = Math.max(0, r.thinkingTokens || 0);
                const vis = Math.max(0, r.candidateTokens || tot - thk);
                const totH = Math.max(3, (tot / maxVal) * chartH);

                if (tot > 0 && thk > 0 && vis > 0) {
                  const thkH = Math.max(1.5, (thk / tot) * totH);
                  const visH = Math.max(1.5, totH - thkH);
                  const yThk = yBase - totH;
                  const yVis = yBase - visH;
                  return (
                    <g key={`out-${r.idx}`}>
                      <rect
                        className="chart-bar out-thk"
                        x={x.toFixed(1)}
                        y={yThk.toFixed(1)}
                        width={barW.toFixed(1)}
                        height={thkH.toFixed(1)}
                        rx="1.5"
                      />
                      <rect
                        className="chart-bar out-vis"
                        x={x.toFixed(1)}
                        y={yVis.toFixed(1)}
                        width={barW.toFixed(1)}
                        height={visH.toFixed(1)}
                        rx="1.5"
                      />
                    </g>
                  );
                }
                const cls = thk > vis ? 'chart-bar out-thk' : 'chart-bar out-vis';
                return (
                  <rect
                    key={`out-${r.idx}`}
                    className={cls}
                    x={x.toFixed(1)}
                    y={(yBase - totH).toFixed(1)}
                    width={barW.toFixed(1)}
                    height={totH.toFixed(1)}
                    rx="2"
                  />
                );
              })}

            {metric === 'ctx' && (
              <g>
                {ctxCurvePath && (
                  <>
                    <path
                      d={`${ctxCurvePath} L ${ctxAllPoints[ctxAllPoints.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${ctxAllPoints[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`}
                      fill="url(#trend-ctx-grad)"
                    />
                    <path
                      d={ctxCurvePath}
                      fill="none"
                      stroke="var(--seg-input)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
                {compactMarkerXs.map((cx, ci) => (
                  <line
                    key={`cmp-${ci}`}
                    x1={cx.toFixed(1)}
                    y1={padTop}
                    x2={cx.toFixed(1)}
                    y2={yBase.toFixed(1)}
                    stroke="var(--seg-think)"
                    strokeWidth="1.2"
                    strokeDasharray="2.5 2.5"
                    opacity="0.75"
                  />
                ))}
                {ctxAllPoints.map((pt, i) => {
                  const color = modelColorMap.get(getModelKey(pt.inv)) || 'var(--seg-input)';
                  const isLast = i === ctxAllPoints.length - 1;
                  return (
                    <circle
                      key={`ctx-pt-${pt.inv.idx}`}
                      cx={pt.x.toFixed(1)}
                      cy={pt.y.toFixed(1)}
                      r={isLast ? 3.5 : 2.3}
                      fill={color}
                      stroke="var(--hud-card)"
                      strokeWidth="1.1"
                    />
                  );
                })}
              </g>
            )}

            {metric === 'quota' &&
              recent.map((r, i) => {
                const x = slotX(i) - barW / 2;
                const val = Math.max(0, r.quotaPct5h || 0);
                const barH = val > 0 ? Math.max(3, (val / maxVal) * chartH) : 1.5;
                const isHighMult = (r.quotaMultiplierK || 1) >= 1.8;
                const fill = isMultiInView
                  ? modelColorMap.get(getModelKey(r)) || 'var(--hud-accent)'
                  : isHighMult
                    ? 'var(--seg-out)'
                    : 'var(--hud-accent)';
                return (
                  <rect
                    key={`quota-${r.idx}`}
                    x={x.toFixed(1)}
                    y={(yBase - barH).toFixed(1)}
                    width={barW.toFixed(1)}
                    height={barH.toFixed(1)}
                    rx="2"
                    fill={fill}
                    opacity={i === recent.length - 1 ? 1 : 0.84}
                  />
                );
              })}

            {metric !== 'out' &&
              metric !== 'ctx' &&
              metric !== 'quota' &&
              seriesList.map((s) => {
                const curve = s.points.length >= 2 ? buildMonotonePath(s.points, padTop, yBase) : '';
                const meanVal = s.points.reduce((acc, p) => acc + p.val, 0) / Math.max(1, s.points.length);
                const meanY = valY(meanVal);

                return (
                  <g key={`series-${s.key}`}>
                    {s.points.length >= 2 && (
                      <line
                        x1={padX}
                        y1={meanY.toFixed(1)}
                        x2={(padX + plotW).toFixed(1)}
                        y2={meanY.toFixed(1)}
                        stroke={s.color}
                        strokeWidth="1"
                        strokeDasharray="3 3"
                        opacity="0.34"
                      />
                    )}
                    {curve && singleCurveSeries?.key === s.key && (
                      <path
                        d={`${curve} L ${s.points[s.points.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${s.points[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`}
                        fill={`url(#trend-area-${metric})`}
                      />
                    )}
                    {curve && (
                      <path
                        d={curve}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    {s.points.map((pt) => {
                      const isLast = pt.slotIdx === recent.length - 1;
                      const isBufNode = metric === 'tps' && pt.inv.isBuffered;
                      let dotFill = isBufNode ? 'var(--hud-card)' : s.color;
                      if (!isMultiInView && !isBufNode) {
                        if (metric === 'ttft') {
                          const tier = ttftTier(pt.inv.ttftSec || 0);
                          dotFill = tier === 'slow' ? 'var(--hud-bad)' : tier === 'mid' ? 'var(--hud-warn)' : s.color;
                        } else if (metric === 'cache') {
                          const tier = cacheTier(pt.inv.cacheHitPct);
                          dotFill = tier === 'low' ? 'var(--hud-bad)' : tier === 'mid' ? 'var(--hud-warn)' : s.color;
                        }
                      }
                      return (
                        <circle
                          key={`pt-${pt.inv.idx}`}
                          cx={pt.x.toFixed(1)}
                          cy={pt.y.toFixed(1)}
                          r={isLast ? 3.6 : 2.5}
                          fill={dotFill}
                          stroke={isBufNode ? s.color : 'var(--hud-card)'}
                          strokeWidth={isBufNode ? '1.5' : '1.1'}
                        />
                      );
                    })}
                  </g>
                );
              })}

            {isMultiInView &&
              recent.map((r, i) => {
                const color = modelColorMap.get(getModelKey(r)) || 'var(--hud-accent)';
                const x = slotX(i) - Math.max(2, slotW * 0.72) / 2;
                const wTick = Math.max(2, slotW * 0.72);
                return (
                  <rect
                    key={`phase-${r.idx}`}
                    x={x.toFixed(1)}
                    y={(h - 4).toFixed(1)}
                    width={wTick.toFixed(1)}
                    height="2.5"
                    rx="1"
                    fill={color}
                    opacity="0.85"
                  />
                );
              })}

            {recent.map((r, i) => {
              const x = padX + i * slotW;
              return (
                <rect
                  key={`hit-${r.idx}`}
                  className="chart-hit-col"
                  x={x.toFixed(1)}
                  y="0"
                  width={slotW.toFixed(1)}
                  height={h}
                  data-tip={buildTip(r, metric, t)}
                />
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}
