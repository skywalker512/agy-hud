import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Locale } from '../i18n/content';
import type { PulseModelData } from './pulseApi';

export type PulseChartMetric = 'ttft' | 'e2e' | 'tps' | 'cache' | 'uptime';

interface PulseChartProps {
  models: PulseModelData[];
  selectedFamilies: string[];
  metric: PulseChartMetric;
  granularity: '7d' | '5m';
  intradayHours: 2 | 6 | 24;
  splitProviders: boolean;
  locale: Locale;
}

interface PlottedLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: Array<{ xIdx: number; xLabel: string; val: number }>;
  latestVal: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 10;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const step = f <= 1.2 ? 1.2 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
  return step * base;
}

function buildMonotonePath(pts: Array<{ x: number; y: number }>, yTop: number, yBottom: number): string {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    d.push(dx !== 0 ? (pts[i + 1].y - pts[i].y) / dx : 0);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const s = 3 / h;
        m[i] = s * a * d[i];
        m[i + 1] = s * b * d[i];
      }
    }
  }
  let path = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    const c1x = pts[i].x + dx;
    const c1y = clamp(pts[i].y + m[i] * dx, yTop, yBottom);
    const c2x = pts[i + 1].x - dx;
    const c2y = clamp(pts[i + 1].y - m[i + 1] * dx, yTop, yBottom);
    path += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return path;
}

function fmtMetricVal(val: number, metric: PulseChartMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return `${val.toFixed(val >= 10 ? 1 : 2)}s`;
  if (metric === 'tps') return `${Math.round(val)} t/s`;
  if (metric === 'uptime') return `${val.toFixed(2)}%`;
  return `${val.toFixed(1)}%`;
}

function fmtTickVal(val: number, metric: PulseChartMetric): string {
  if (metric === 'ttft' || metric === 'e2e') return val >= 10 ? `${Math.round(val)}s` : `${val.toFixed(1)}s`;
  if (metric === 'tps') return `${Math.round(val)}`;
  return `${Math.round(val)}%`;
}

function fmtX(label: string, isIntraday: boolean): string {
  if (!isIntraday) return label.slice(5, 10);
  const ms = Date.parse(`${label.replace(' ', 'T')}:00Z`);
  if (Number.isFinite(ms)) {
    const d = new Date(ms);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return label.slice(5, 16);
}

function providerColor(name: string, idx: number): string {
  if (/vertex/i.test(name)) return '#4f86f7';
  if (/ai\s*studio/i.test(name)) return '#fbbf24';
  const fallback = ['#34d399', '#a78bfa', '#f87171'];
  return fallback[idx % fallback.length];
}

export function PulseChart({
  models,
  selectedFamilies,
  metric,
  granularity,
  intradayHours,
  splitProviders,
  locale,
}: PulseChartProps) {
  const isZh = locale === 'zh';
  const boxRef = useRef<HTMLDivElement>(null);
  const [svgW, setSvgW] = useState(760);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setSvgW(Math.max(300, Math.round(el.clientWidth)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth;
      if (w > 0) setSvgW(Math.max(300, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const targetModels = useMemo(
    () =>
      selectedFamilies
        .map((f) => models.find((m) => m.family === f))
        .filter((m): m is PulseModelData => Boolean(m)),
    [models, selectedFamilies],
  );

  const isIntraday = granularity === '5m' && metric !== 'e2e';
  const singleModel = targetModels.length === 1 ? targetModels[0] : null;

  const { xLabels, lines } = useMemo(() => {
    if (!targetModels.length) return { xLabels: [] as string[], lines: [] as PlottedLine[] };

    if (isIntraday) {
      let latestMs = 0;
      for (const m of targetModels) {
        for (const pt of m.series.intraday30m) {
          if (pt.bucketMs > latestMs) latestMs = pt.bucketMs;
        }
      }
      const windowCutoff = latestMs > 0 ? latestMs - intradayHours * 3_600_000 : 0;
      const filterPts = (pts: PulseModelData['series']['intraday30m']) =>
        windowCutoff > 0 ? pts.filter((pt) => pt.bucketMs >= windowCutoff) : pts;

      const labelSet = new Set<string>();
      for (const m of targetModels) {
        for (const pt of filterPts(m.series.intraday30m)) labelSet.add(pt.x);
      }
      const sortedX = [...labelSet].sort();
      const idxMap = new Map(sortedX.map((x, i) => [x, i]));

      const pickVal = (pt: PulseModelData['series']['intraday30m'][number]) =>
        metric === 'ttft'
          ? pt.p50TtftSec
          : metric === 'tps'
            ? pt.p50Tps
            : metric === 'cache'
              ? pt.cacheHitPct
              : pt.uptime5mPct ?? pt.uptime30mPct;

      if (splitProviders && singleModel && metric !== 'uptime') {
        const filtered = filterPts(singleModel.series.intraday30m);
        const provs = new Set<string>();
        for (const pt of filtered) {
          for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
        }
        if (provs.size >= 2) {
          const out: PlottedLine[] = [];
          let ci = 0;
          for (const prov of provs) {
            const pts: PlottedLine['points'] = [];
            for (const b of filtered) {
              const pObj = b.byProvider?.[prov];
              const v = metric === 'ttft' ? pObj?.ttft : metric === 'tps' ? pObj?.tps : pObj?.cache;
              if (typeof v === 'number' && v > 0 && idxMap.has(b.x)) {
                pts.push({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: v });
              }
            }
            if (pts.length) {
              out.push({
                id: prov,
                label: prov,
                color: providerColor(prov, ci++),
                points: pts,
                latestVal: pts[pts.length - 1].val,
              });
            }
          }
          return { xLabels: sortedX, lines: out };
        }
      }

      const out: PlottedLine[] = [];
      for (const m of targetModels) {
        const pts: PlottedLine['points'] = [];
        for (const b of filterPts(m.series.intraday30m)) {
          const v = pickVal(b);
          if (typeof v === 'number' && v > 0 && idxMap.has(b.x)) {
            pts.push({ xIdx: idxMap.get(b.x)!, xLabel: b.x, val: v });
          }
        }
        if (pts.length) {
          out.push({
            id: m.family,
            label: m.shortLabel,
            color: m.color,
            points: pts,
            latestVal: pts[pts.length - 1].val,
          });
        }
      }
      return { xLabels: sortedX, lines: out };
    }

    const pickArr = (m: PulseModelData) =>
      metric === 'ttft'
        ? m.series.ttft7d
        : metric === 'e2e'
          ? m.series.e2e7d
          : metric === 'tps'
            ? m.series.tps7d
            : metric === 'cache'
              ? m.series.cache7d
              : m.series.uptime7d;

    const dateSet = new Set<string>();
    for (const m of targetModels) {
      for (const pt of pickArr(m)) dateSet.add(pt.x);
    }
    const sortedX = [...dateSet].sort();
    const idxMap = new Map(sortedX.map((x, i) => [x, i]));

    if (splitProviders && singleModel) {
      const arr = pickArr(singleModel);
      const provs = new Set<string>();
      for (const pt of arr) {
        for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
      }
      if (provs.size >= 2) {
        const out: PlottedLine[] = [];
        let ci = 0;
        for (const prov of provs) {
          const pts: PlottedLine['points'] = [];
          for (const pt of arr) {
            const v = pt.byProvider?.[prov];
            if (typeof v === 'number' && v > 0 && idxMap.has(pt.x)) {
              pts.push({ xIdx: idxMap.get(pt.x)!, xLabel: pt.x, val: v });
            }
          }
          if (pts.length) {
            out.push({
              id: prov,
              label: prov,
              color: providerColor(prov, ci++),
              points: pts,
              latestVal: pts[pts.length - 1].val,
            });
          }
        }
        return { xLabels: sortedX, lines: out };
      }
    }

    const out: PlottedLine[] = [];
    for (const m of targetModels) {
      const pts = pickArr(m)
        .filter((pt) => idxMap.has(pt.x))
        .map((pt) => ({ xIdx: idxMap.get(pt.x)!, xLabel: pt.x, val: pt.value }));
      if (pts.length) {
        out.push({
          id: m.family,
          label: m.shortLabel,
          color: m.color,
          points: pts,
          latestVal: pts[pts.length - 1].val,
        });
      }
    }
    return { xLabels: sortedX, lines: out };
  }, [targetModels, metric, isIntraday, intradayHours, splitProviders, singleModel]);

  const svgH = 264;
  const padTop = 18;
  const padBottom = 30;
  const padLeft = 48;
  const padRight = 22;
  const plotW = Math.max(120, svgW - padLeft - padRight);
  const chartH = svgH - padTop - padBottom;
  const yBase = padTop + chartH;

  const { yMin, yMax } = useMemo(() => {
    const vals = lines.flatMap((l) => l.points.map((p) => p.val));
    if (!vals.length) return { yMin: 0, yMax: 100 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (metric === 'uptime') {
      if (lo >= 97) return { yMin: 95, yMax: 100 };
      if (lo >= 90) return { yMin: 85, yMax: 100 };
      return { yMin: Math.max(0, Math.floor((lo - 5) / 10) * 10), yMax: 100 };
    }
    if (metric === 'cache') return { yMin: 0, yMax: 100 };
    return { yMin: 0, yMax: niceMax(hi * 1.12) };
  }, [lines, metric]);

  const yTicks = [yMax, yMin + (yMax - yMin) * 0.67, yMin + (yMax - yMin) * 0.33, yMin];
  const valY = (v: number) => padTop + chartH - clamp((v - yMin) / Math.max(0.001, yMax - yMin), 0, 1) * chartH;
  const slotX = (idx: number) =>
    xLabels.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (xLabels.length - 1)) * plotW;

  const safeHover = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < xLabels.length ? hoveredIdx : null;
  const hoverRows = useMemo(() => {
    if (safeHover === null) return [];
    const lowerBetter = metric === 'ttft' || metric === 'e2e';
    return lines
      .map((l) => {
        const pt = l.points.find((p) => p.xIdx === safeHover);
        return pt ? { label: l.label, color: l.color, val: pt.val } : null;
      })
      .filter((r): r is { label: string; color: string; val: number } => Boolean(r))
      .sort((a, b) => (lowerBetter ? a.val - b.val : b.val - a.val));
  }, [safeHover, lines, metric]);

  const hoverX = safeHover !== null ? slotX(safeHover) : 0;
  const popLeft = useMemo(() => {
    if (safeHover === null) return 8;
    const popW = 210;
    const raw = hoverX > svgW * 0.56 ? hoverX - popW - 14 : hoverX + 14;
    return clamp(Math.round(raw), 8, Math.max(8, svgW - popW - 8));
  }, [safeHover, hoverX, svgW]);

  const xTickIdxs = useMemo(() => {
    const n = xLabels.length;
    if (n <= 5) return xLabels.map((_, i) => i);
    const out = [0, Math.floor((n - 1) * 0.25), Math.floor((n - 1) * 0.5), Math.floor((n - 1) * 0.75), n - 1];
    return [...new Set(out)];
  }, [xLabels]);

  if (xLabels.length < 2 || lines.length === 0) {
    return (
      <div class="flex h-[264px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 text-center text-[13px] text-[var(--muted)]">
        {isIntraday
          ? isZh
            ? '5 分钟实时采集刚启动，每 5 分钟自动新增一个高精度采样点（当前至少需要 2 个点即可绘制曲线，约 5 分钟后自动出现）。'
            : '5-minute high-resolution collection is active — a new point is recorded every 5 minutes (curve appears once ≥2 points are collected).'
          : isZh
            ? '正在加载 OpenRouter Gemini 历史折线数据…'
            : 'Loading OpenRouter Gemini historical curves…'}
      </div>
    );
  }

  return (
    <div ref={boxRef} class="relative w-full select-none">
      <svg
        class="block w-full overflow-visible"
        style={{ height: `${svgH}px` }}
        viewBox={`0 0 ${svgW} ${svgH}`}
        onPointerMove={(e: PointerEvent) => {
          const el = boxRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const frac = clamp((e.clientX - rect.left - padLeft) / Math.max(1, plotW), 0, 1);
          setHoveredIdx(Math.round(frac * (xLabels.length - 1)));
        }}
        onPointerLeave={() => setHoveredIdx(null)}
      >
        {yTicks.map((tv, i) => {
          const gy = valY(tv);
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padLeft}
                y1={gy.toFixed(1)}
                x2={(padLeft + plotW).toFixed(1)}
                y2={gy.toFixed(1)}
                stroke="var(--fg)"
                stroke-width="1"
                stroke-dasharray={i === yTicks.length - 1 ? undefined : '2 4'}
                opacity={i === yTicks.length - 1 ? 0.16 : 0.08}
              />
              <text
                x={(padLeft - 8).toFixed(1)}
                y={(gy + 3.5).toFixed(1)}
                text-anchor="end"
                fill="var(--faint)"
                font-size="11"
                font-family="var(--font-mono)"
              >
                {fmtTickVal(tv, metric)}
              </text>
            </g>
          );
        })}

        {lines.map((line) => {
          const coords = line.points.map((p) => ({ x: slotX(p.xIdx), y: valY(p.val) }));
          const d = buildMonotonePath(coords, padTop, yBase);
          return (
            <g key={line.id}>
              {d && (
                <path
                  d={d}
                  fill="none"
                  stroke={line.color}
                  stroke-width="2.3"
                  stroke-dasharray={line.dashed ? '5 3' : undefined}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  opacity="0.92"
                />
              )}
              {line.points.map((p, pi) => {
                const isHov = safeHover === p.xIdx;
                const isLast = pi === line.points.length - 1;
                if (isIntraday && line.points.length > 24 && !isHov && !isLast) return null;
                return (
                  <circle
                    key={`${line.id}-${p.xIdx}`}
                    cx={slotX(p.xIdx).toFixed(1)}
                    cy={valY(p.val).toFixed(1)}
                    r={isHov ? 5 : isLast ? 4 : 2.8}
                    fill={line.color}
                    stroke="var(--surface)"
                    stroke-width="1.5"
                  />
                );
              })}
            </g>
          );
        })}

        {xTickIdxs.map((idx) => (
          <text
            key={`xt-${idx}`}
            x={slotX(idx).toFixed(1)}
            y={(svgH - 6).toFixed(1)}
            text-anchor={idx === 0 ? 'start' : idx === xLabels.length - 1 ? 'end' : 'middle'}
            fill="var(--faint)"
            font-size="11"
            font-family="var(--font-mono)"
          >
            {fmtX(xLabels[idx], isIntraday)}
          </text>
        ))}

        {safeHover !== null && (
          <line
            x1={hoverX.toFixed(1)}
            y1={padTop}
            x2={hoverX.toFixed(1)}
            y2={yBase.toFixed(1)}
            stroke="var(--accent)"
            stroke-width="1.2"
            stroke-dasharray="3 3"
            opacity="0.65"
          />
        )}
      </svg>

      {safeHover !== null && hoverRows.length > 0 && (
        <div
          class="pointer-events-none absolute top-2 z-20 w-[210px] rounded-xl border border-[var(--border-strong)] bg-[var(--surface)]/95 p-3 shadow-lg backdrop-blur-md"
          style={{ left: `${popLeft}px` }}
        >
          <div class="mb-1.5 flex items-center justify-between border-b border-[var(--border)] pb-1 font-mono text-[11px] font-semibold text-[var(--muted)]">
            <span>{fmtX(xLabels[safeHover], isIntraday)}</span>
            <span>{isIntraday ? '5m' : isZh ? '日均 P50' : 'Daily P50'}</span>
          </div>
          <div class="flex flex-col gap-1">
            {hoverRows.map((row, ri) => (
              <div key={row.label} class="flex items-center justify-between gap-2 text-[12px] tabular-nums">
                <span class="flex min-w-0 items-center gap-1.5 text-[var(--fg)]">
                  <span class="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span class="truncate">{row.label}</span>
                </span>
                <span
                  class={`shrink-0 font-mono font-semibold ${
                    ri === 0 && hoverRows.length > 1 ? 'text-[var(--seg-cache)]' : 'text-[var(--fg)]'
                  }`}
                >
                  {fmtMetricVal(row.val, metric)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
