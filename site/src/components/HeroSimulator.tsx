import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  SIM_CACHE_TTL_MODELS,
  SIM_CALLS,
  SIM_CONTEXT_SEGMENTS,
  SIM_HEATMAP,
  SIM_LIVE_SPARKLINE_BASE,
  SIM_LIVE_TICK_STREAM,
  SIM_SWARM_WORKERS,
  type HeatmapDay,
  type SimCallPoint,
  type SimChartMetric,
  type SimRangePreset,
  type SimTab,
} from '../data/simulatorData';
import type { Locale, SiteCopy } from '../i18n/content';
import {
  IconActivity,
  IconCheck,
  IconClock,
  IconCopy,
  IconDownload,
  IconGauge,
  IconLayers,
  IconSkipForward,
} from './Icons';
import { BrandLogo } from './Navbar';

interface HeroSimulatorProps {
  locale: Locale;
  copy: SiteCopy;
}

type InspectorTab = 'overview' | 'tools' | 'raw';
type ActivityMode = 'heatmap' | 'iceberg';

function metricValue(c: SimCallPoint, metric: SimChartMetric): number {
  switch (metric) {
    case 'tps':
      return c.genTps;
    case 'ttft':
      return c.ttftSec;
    case 'cache':
      return c.cachePct;
    case 'ctx':
      return c.ctxPct;
  }
}

function formatMetricVal(val: number, metric: SimChartMetric): string {
  switch (metric) {
    case 'tps':
      return `${val.toFixed(1)}`;
    case 'ttft':
      return `${val.toFixed(2)}s`;
    case 'cache':
    case 'ctx':
      return `${val.toFixed(1)}%`;
  }
}

function metricColor(metric: SimChartMetric): string {
  switch (metric) {
    case 'tps':
      return 'var(--seg-cache)';
    case 'ttft':
      return 'var(--seg-input)';
    case 'cache':
      return 'var(--seg-cache)';
    case 'ctx':
      return 'var(--seg-think)';
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Smooth cubic Catmull-Rom -> Bezier path for organic bottom-anchored sparkline
function buildSmoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function HeroSimulator({ locale, copy }: HeroSimulatorProps) {
  const [tab, setTab] = useState<SimTab>('live');

  // Live tab state
  const [sparkSeries, setSparkSeries] = useState<number[]>(SIM_LIVE_SPARKLINE_BASE);
  const [hoveredCtxId, setHoveredCtxId] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string>('hud-ui');

  // Calls tab state
  const [metric, setMetric] = useState<SimChartMetric>('tps');
  const [preset, setPreset] = useState<SimRangePreset>('20');
  const [range, setRange] = useState<{ start: number; end: number }>({
    start: SIM_CALLS.length - 20,
    end: SIM_CALLS.length - 1,
  });
  const [followLive, setFollowLive] = useState(true);
  const [brushing, setBrushing] = useState(false);
  const [hoverPlotIdx, setHoverPlotIdx] = useState<number | null>(null);
  const [selectedCallIdx, setSelectedCallIdx] = useState<number>(54);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [copiedMd, setCopiedMd] = useState(false);

  // Account tab state
  const [ttlModelIdx, setTtlModelIdx] = useState<number>(0);
  const [activityMode, setActivityMode] = useState<ActivityMode>('iceberg');
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [updateState, setUpdateState] = useState<'available' | 'updating' | 'applied'>('available');

  useEffect(() => {
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % SIM_LIVE_TICK_STREAM.length;
      setSparkSeries((prev) => [...prev.slice(1), SIM_LIVE_TICK_STREAM[step]]);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!copiedMd) return;
    const id = window.setTimeout(() => setCopiedMd(false), 1600);
    return () => window.clearTimeout(id);
  }, [copiedMd]);

  const currentGen = sparkSeries[sparkSeries.length - 1];
  const currentE2e = Number((currentGen * 0.74).toFixed(1));
  const avgGen = 86.2;
  const genDeltaPct = Math.round(((currentGen - avgGen) / avgGen) * 100);

  // Smooth bottom-anchored area sparkline inside Hero GEN card
  const sparkSvg = useMemo(() => {
    const w = 168;
    const h = 28;
    const minV = Math.min(...sparkSeries) - 6;
    const maxV = Math.max(...sparkSeries) + 5;
    const span = Math.max(1, maxV - minV);
    const pts = sparkSeries.map((v, i) => ({
      x: (i / Math.max(1, sparkSeries.length - 1)) * w,
      y: h - 3 - ((v - minV) / span) * (h - 7),
    }));
    const line = buildSmoothPath(pts);
    const area = `${line} L${w},${h} L0,${h} Z`;
    return { w, h, line, area };
  }, [sparkSeries]);

  const visibleCalls = useMemo(
    () => SIM_CALLS.slice(range.start, range.end + 1),
    [range.start, range.end],
  );

  const chartStats = useMemo(() => {
    const vals = visibleCalls.map((c) => metricValue(c, metric));
    const sorted = [...vals].sort((a, b) => a - b);
    const latest = vals[vals.length - 1] ?? 0;
    const avg = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    const peak = sorted[sorted.length - 1] ?? 0;
    return { latest, avg, p95, peak };
  }, [visibleCalls, metric]);

  const selectedCall = useMemo(
    () => SIM_CALLS.find((c) => c.idx === selectedCallIdx) ?? SIM_CALLS[SIM_CALLS.length - 1],
    [selectedCallIdx],
  );

  const applyPreset = (p: SimRangePreset) => {
    setPreset(p);
    setFollowLive(true);
    const n = SIM_CALLS.length;
    if (p === 'all') setRange({ start: 0, end: n - 1 });
    else {
      const w = Number(p);
      setRange({ start: Math.max(0, n - w), end: n - 1 });
    }
  };

  const scrubMinimapAtClientX = (el: SVGSVGElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const n = SIM_CALLS.length;
    const span = Math.max(8, range.end - range.start + 1);
    const center = Math.round(frac * (n - 1));
    let start = Math.max(0, center - Math.floor(span / 2));
    let end = start + span - 1;
    if (end >= n) {
      end = n - 1;
      start = Math.max(0, end - span + 1);
    }
    setRange({ start, end });
    setFollowLive(end === n - 1);
  };

  const handleCopyCallMd = () => {
    const c = selectedCall;
    const md = `### Call #${c.idx} (${c.model})\n- GEN: ${c.genTps} tok/s · E2E: ${c.e2eTps} tok/s\n- Waterfall: TTFT ${c.ttftSec}s · Think ${c.thinkSec}s · Tool Gen ${c.toolGenSec}s · Stream ${c.streamSec}s\n- Cache: ${c.cachePct}% (saved $${c.savedUsd}) · Cost $${c.costUsd} · 5h -${c.quota5h}%`;
    navigator.clipboard?.writeText(md).catch(() => {});
    setCopiedMd(true);
  };

  const handleSimulateUpdate = () => {
    if (updateState !== 'available') return;
    setUpdateState('updating');
    window.setTimeout(() => setUpdateState('applied'), 950);
  };

  const activeWorkerObj = SIM_SWARM_WORKERS.find((w) => w.rosterName === selectedWorker) ?? SIM_SWARM_WORKERS[0];
  const activeTtlModel = SIM_CACHE_TTL_MODELS[ttlModelIdx] ?? SIM_CACHE_TTL_MODELS[0];

  // Calls tab main SVG plot geometry
  const plotW = 336;
  const plotH = 96;
  const padL = 28;
  const padR = 6;
  const padT = 8;
  const padB = 14;
  const innerW = plotW - padL - padR;
  const innerH = plotH - padT - padB;

  const yMax = useMemo(() => {
    if (metric === 'cache' || metric === 'ctx') return 100;
    const maxV = Math.max(...visibleCalls.map((c) => metricValue(c, metric)), 1);
    if (metric === 'ttft') return Math.ceil(maxV * 1.15 * 2) / 2;
    return Math.ceil((maxV * 1.12) / 20) * 20;
  }, [visibleCalls, metric]);

  const plotPoints = useMemo(() => {
    const count = Math.max(1, visibleCalls.length - 1);
    return visibleCalls.map((c, i) => {
      const val = metricValue(c, metric);
      const x = padL + (i / count) * innerW;
      const y = padT + innerH - (Math.min(yMax, val) / yMax) * innerH;
      return { x, y, val, call: c };
    });
  }, [visibleCalls, metric, innerW, innerH, yMax]);

  const linePath = useMemo(() => {
    if (plotPoints.length === 0) return '';
    return plotPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }, [plotPoints]);

  const areaPath = useMemo(() => {
    if (plotPoints.length === 0) return '';
    const first = plotPoints[0];
    const last = plotPoints[plotPoints.length - 1];
    return `${linePath} L${last.x.toFixed(1)},${(padT + innerH).toFixed(1)} L${first.x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  }, [linePath, plotPoints, innerH]);

  const miniW = 336;
  const miniH = 22;
  const miniPath = useMemo(() => {
    const maxAll =
      metric === 'cache' || metric === 'ctx'
        ? 100
        : Math.max(...SIM_CALLS.map((c) => metricValue(c, metric)), 1) * 1.1;
    return SIM_CALLS.map((c, i) => {
      const x = (i / (SIM_CALLS.length - 1)) * miniW;
      const y = miniH - 2 - (Math.min(maxAll, metricValue(c, metric)) / maxAll) * (miniH - 5);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [metric]);

  const hoveredPoint = hoverPlotIdx !== null ? plotPoints[hoverPlotIdx] ?? null : null;
  const brushLeftPct = (range.start / (SIM_CALLS.length - 1)) * 100;
  const brushWidthPct = Math.max(8, ((range.end - range.start) / (SIM_CALLS.length - 1)) * 100);

  const totalPhaseSec = Math.max(
    0.1,
    selectedCall.ttftSec + selectedCall.thinkSec + selectedCall.toolGenSec + selectedCall.streamSec,
  );
  const wfPhases = [
    { key: 'ttft', label: copy.sim.calls.ttft, sec: selectedCall.ttftSec, color: 'var(--seg-input)' },
    { key: 'think', label: copy.sim.calls.think, sec: selectedCall.thinkSec, color: 'var(--seg-think)' },
    { key: 'tool', label: copy.sim.calls.toolGen, sec: selectedCall.toolGenSec, color: 'var(--seg-out)' },
    { key: 'stream', label: copy.sim.calls.stream, sec: selectedCall.streamSec, color: 'var(--seg-cache)' },
  ];

  const totalPromptTok = selectedCall.cachedTok + selectedCall.newInputTok;
  const cachedShare = (selectedCall.cachedTok / Math.max(1, totalPromptTok)) * 100;
  const totalOutTok = selectedCall.thinkTok + selectedCall.visTok;
  const thinkShare = (selectedCall.thinkTok / Math.max(1, totalOutTok)) * 100;

  // Last 28 days for the crisp Monochrome Token Iceberg view in Account tab
  const icebergDays = useMemo(() => SIM_HEATMAP.slice(-28), []);
  const icebergMaxNew = useMemo(
    () => Math.max(...icebergDays.map((d) => d.newTokensM), 1),
    [icebergDays],
  );
  const icebergMaxCached = useMemo(
    () => Math.max(...icebergDays.map((d) => d.cachedTokensM), 1),
    [icebergDays],
  );

  return (
    <div
      class="hud-frame mx-auto w-full max-w-[404px] overflow-hidden rounded-2xl text-[11.5px] select-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === '1') setTab('live');
        else if (e.key === '2') setTab('calls');
        else if (e.key === '3') setTab('account');
      }}
      aria-label="Interactive AGY-HUD side-pane simulator"
    >
      {/* Slim 2.5-row Header matching real AGY-HUD side pane */}
      <div class="border-b border-[var(--border)] bg-[var(--sim-card)] px-3 pt-2.5 pb-2">
        {/* Row 1: Brand + Live Pill + Session Selector */}
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <BrandLogo size={15} />
            <span class="text-[12px] font-semibold tracking-tight text-[var(--fg)]">
              {copy.sim.paneTitle}
            </span>
            <span
              class="inline-flex items-center gap-1 rounded-full px-1.5 py-px font-mono text-[9.5px] font-semibold tabular-nums"
              style={{
                backgroundColor: 'var(--tint-ok)',
                color: 'var(--seg-cache)',
              }}
            >
              <span
                class="animate-hud-pulse h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--seg-cache)' }}
              />
              {copy.sim.statusGen}
            </span>
          </div>

          <span class="max-w-[140px] truncate rounded-md bg-[var(--sim-well)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--fg-2)]">
            {copy.sim.sessionName}
          </span>
        </div>

        {/* Row 2: Compact routed model & shortcut cue */}
        <div class="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="font-mono text-[9.5px] font-medium text-[var(--faint)]">f19</span>
            <span class="truncate font-mono text-[10.5px] font-semibold text-[var(--fg)]">
              gemini-4-carbon
            </span>
            <span class="font-mono text-[10px] text-[var(--faint)] tabular-nums">· 256k</span>
          </div>
          <span class="shrink-0 font-mono text-[9.5px] text-[var(--faint)]">{copy.sim.shortcutHint}</span>
        </div>

        {/* Row 2.5: Borderless segmented 3-tab rail */}
        <div class="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-[var(--sim-well)] p-0.5" role="tablist">
          {(
            [
              { id: 'live', label: copy.sim.tabLive, icon: IconActivity, meta: null },
              { id: 'calls', label: copy.sim.tabCalls, icon: IconLayers, meta: '60' },
              { id: 'account', label: copy.sim.tabAccount, icon: IconGauge, meta: null },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                class={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1 text-[11.5px] font-medium transition-all ${
                  active
                    ? 'bg-[var(--sim-card)] text-[var(--fg)] shadow-2xs'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <Icon size={11} class={active ? 'text-[var(--fg)]' : 'text-[var(--faint)]'} />
                <span>{item.label}</span>
                {item.meta && (
                  <span class="font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                    {item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Pane Body */}
      <div class="hud-scroll h-[452px] overflow-y-auto p-2.5">
        {/* ================= LIVE TAB ================= */}
        {tab === 'live' && (
          <div class="space-y-2.5">
            {/* Hero Speed Cards: GEN with bottom-anchored smooth area sparkline + E2E */}
            <div class="grid grid-cols-2 gap-2">
              <div class="sim-card relative overflow-hidden p-2.5 pb-6">
                <div class="flex items-center justify-between">
                  <span class="text-[10.5px] font-medium text-[var(--muted)]">
                    {copy.sim.live.genLabel}
                  </span>
                  <span
                    class="rounded px-1 py-px font-mono text-[9.5px] font-semibold tabular-nums"
                    style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                  >
                    +{genDeltaPct}%
                  </span>
                </div>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="hero-figure font-mono text-[22px] leading-none font-bold text-[var(--fg)] tabular-nums">
                    {currentGen.toFixed(1)}
                  </span>
                  <span class="font-mono text-[10px] font-normal text-[var(--faint)]">tok/s</span>
                </div>
                <div class="mt-1 text-[10px] text-[var(--faint)]">{copy.sim.live.sustained}</div>

                {/* Bottom-anchored smooth area sparkline */}
                <svg
                  viewBox={`0 0 ${sparkSvg.w} ${sparkSvg.h}`}
                  preserveAspectRatio="none"
                  class="pointer-events-none absolute right-0 bottom-0 left-0 h-[24px] w-full"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="heroSparkFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="var(--seg-cache)" stop-opacity="0.24" />
                      <stop offset="100%" stop-color="var(--seg-cache)" stop-opacity="0.01" />
                    </linearGradient>
                  </defs>
                  <path d={sparkSvg.area} fill="url(#heroSparkFill)" />
                  <path
                    d={sparkSvg.line}
                    fill="none"
                    stroke="var(--seg-cache)"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
              </div>

              <div class="sim-card flex flex-col justify-between p-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10.5px] font-medium text-[var(--muted)]">
                    {copy.sim.live.e2eLabel}
                  </span>
                  <span class="font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                    94.8% hit
                  </span>
                </div>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="hero-figure font-mono text-[22px] leading-none font-bold text-[var(--fg)] tabular-nums">
                    {currentE2e.toFixed(1)}
                  </span>
                  <span class="font-mono text-[10px] font-normal text-[var(--faint)]">tok/s</span>
                </div>
                <div class="mt-2 font-mono text-[10px] text-[var(--faint)] tabular-nums">
                  {copy.sim.live.inclTtft}
                </div>
              </div>
            </div>

            {/* Context Window X-Ray: Segmented Bar + 2-Column Aligned Table + Live Cache TTL Pill */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.live.ctxTitle}
                </span>
                <span class="font-mono text-[10.5px] font-semibold text-[var(--fg)] tabular-nums">
                  141.7k <span class="font-normal text-[var(--faint)]">/ 256k · 55.4%</span>
                </span>
              </div>

              {/* Segmented proportion bar */}
              <div class="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-[var(--sim-well-2)]">
                {SIM_CONTEXT_SEGMENTS.map((seg) => {
                  const isHovered = hoveredCtxId === seg.id;
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onMouseEnter={() => setHoveredCtxId(seg.id)}
                      onMouseLeave={() => setHoveredCtxId(null)}
                      onFocus={() => setHoveredCtxId(seg.id)}
                      onBlur={() => setHoveredCtxId(null)}
                      style={{
                        width: `${seg.pct}%`,
                        backgroundColor: seg.colorVar,
                        opacity: hoveredCtxId && !isHovered ? 0.38 : 1,
                      }}
                      class="h-full cursor-pointer border-r border-[var(--sim-card)]/60 transition-opacity last:border-r-0"
                      aria-label={locale === 'zh' ? seg.labelZh : seg.labelEn}
                    />
                  );
                })}
              </div>

              {/* 2-Column Aligned Context Breakdown Table */}
              <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
                {SIM_CONTEXT_SEGMENTS.map((seg) => {
                  const isHovered = hoveredCtxId === seg.id;
                  return (
                    <div
                      key={seg.id}
                      onMouseEnter={() => setHoveredCtxId(seg.id)}
                      onMouseLeave={() => setHoveredCtxId(null)}
                      class={`flex cursor-default items-center justify-between rounded px-1 py-0.5 transition-colors ${
                        isHovered ? 'bg-[var(--sim-well)]' : ''
                      }`}
                    >
                      <span class="flex min-w-0 items-center gap-1.5 text-[10.5px] text-[var(--fg-2)]">
                        <span
                          class="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: seg.colorVar }}
                        />
                        <span class="truncate">
                          {locale === 'zh' ? seg.labelZh : seg.labelEn}
                        </span>
                      </span>
                      <span class="shrink-0 font-mono text-[10px] text-[var(--muted)] tabular-nums">
                        {formatTokens(seg.tokens)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Live Prompt Cache TTL Survival Strip */}
              <div
                class="sim-well mt-2 flex items-center justify-between gap-2 px-2 py-1.5"
                title={copy.sim.live.cachePenaltyTip}
              >
                <span class="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                  <IconClock size={11} />
                  <span class="truncate">{copy.sim.live.cacheSafeLabel}</span>
                </span>
                <span class="shrink-0 font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                  {copy.sim.live.ctxHeadroom}
                </span>
              </div>
            </div>

            {/* Native AGY Swarm Cockpit */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] font-semibold text-[var(--fg)]">
                    {copy.sim.live.swarmTitle}
                  </span>
                  <span
                    class="rounded px-1.5 py-px font-mono text-[9.5px] font-medium"
                    style={{
                      backgroundColor: 'var(--tint-think)',
                      color: 'var(--seg-think)',
                    }}
                  >
                    {copy.sim.live.swarmBoard}
                  </span>
                </div>
                <div class="flex items-center gap-1 font-mono text-[9.5px] tabular-nums">
                  <span
                    class="inline-flex items-center gap-1 rounded px-1.5 py-px font-medium"
                    style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                  >
                    <span
                      class="animate-hud-pulse h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: 'var(--seg-cache)' }}
                    />
                    {copy.sim.live.swarmWorking}
                  </span>
                  <span class="rounded bg-[var(--sim-well)] px-1.5 py-px text-[var(--muted)]">
                    {copy.sim.live.swarmWaiting}
                  </span>
                </div>
              </div>

              <div class="mt-1 font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                {copy.sim.live.swarmRollup}
              </div>

              <div class="mt-2 space-y-1.5">
                {SIM_SWARM_WORKERS.map((w) => {
                  const isSel = w.rosterName === selectedWorker;
                  const isWorking = w.state === 'working';
                  return (
                    <button
                      key={w.rosterName}
                      type="button"
                      onClick={() => setSelectedWorker(w.rosterName)}
                      class={`w-full cursor-pointer rounded-lg px-2 py-1.5 text-left transition-colors ${
                        isSel
                          ? 'bg-[var(--sim-well-2)]'
                          : 'bg-[var(--sim-well)]/75 hover:bg-[var(--sim-well)]'
                      }`}
                    >
                      <div class="flex items-center justify-between gap-1.5">
                        <div class="flex min-w-0 items-center gap-1.5">
                          <span
                            class={`h-1.5 w-1.5 shrink-0 rounded-full ${isWorking ? 'animate-hud-pulse' : ''}`}
                            style={{ backgroundColor: isWorking ? 'var(--seg-cache)' : 'var(--faint)' }}
                          />
                          <span class="font-mono text-[10.5px] font-semibold text-[var(--fg)]">
                            @{w.rosterName}
                          </span>
                          {w.workspace !== 'inherit' && (
                            <span
                              class="rounded px-1 py-px font-mono text-[9px]"
                              style={{ backgroundColor: 'var(--tint-accent)', color: 'var(--accent-ink)' }}
                            >
                              {w.workspace}
                            </span>
                          )}
                        </div>
                        <span class="shrink-0 font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                          {w.costUsd} · {w.quota5h}
                        </span>
                      </div>
                      <p class="mt-0.5 truncate text-[10.5px] text-[var(--muted)]">
                        {locale === 'zh' ? w.taskZh : w.taskEn}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div class="mt-2 border-t border-[var(--border)] pt-1.5 text-[10px]">
                <div class="flex items-center justify-between font-mono text-[9.5px] text-[var(--faint)]">
                  <span>
                    {copy.sim.live.lastPost} · @{activeWorkerObj.rosterName} #{activeWorkerObj.lastPostSeq}
                  </span>
                  <span class="tabular-nums">{activeWorkerObj.model}</span>
                </div>
                <div class="mt-0.5 truncate text-[var(--fg-2)]">
                  {locale === 'zh' ? activeWorkerObj.lastPostZh : activeWorkerObj.lastPostEn}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= CALLS TAB ================= */}
        {tab === 'calls' && (
          <div class="space-y-2.5">
            {/* Trend Chart Card */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.calls.trendTitle}{' '}
                  <span class="font-mono font-normal text-[var(--faint)] tabular-nums">60</span>
                </span>
                <div class="flex items-center gap-0.5 rounded-md bg-[var(--sim-well)] p-0.5">
                  {(['tps', 'ttft', 'cache', 'ctx'] as SimChartMetric[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      class={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase transition-colors ${
                        metric === m
                          ? 'bg-[var(--sim-card)] text-[var(--fg)] shadow-2xs'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div class="mt-1.5 flex items-center justify-between gap-1">
                <div class="flex items-center gap-1">
                  {(['20', '50', 'all'] as SimRangePreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      class={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium transition-colors ${
                        preset === p && followLive
                          ? 'bg-[var(--sim-well-2)] text-[var(--fg)]'
                          : 'text-[var(--muted)] hover:bg-[var(--sim-well)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {p === 'all' ? 'All' : p}
                    </button>
                  ))}
                </div>
                {!followLive ? (
                  <button
                    type="button"
                    onClick={() => applyPreset(preset)}
                    class="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
                    style={{
                      backgroundColor: 'var(--tint-accent)',
                      color: 'var(--accent-ink)',
                    }}
                  >
                    <span>
                      #{range.start + 1}–#{range.end + 1} · {copy.sim.calls.followLive}
                    </span>
                    <IconSkipForward size={9} />
                  </button>
                ) : (
                  <span class="font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                    #{range.start + 1}–#{range.end + 1} / 60
                  </span>
                )}
              </div>

              {/* Recessed 4-cell viewport stat strip */}
              <div class="sim-well mt-2 grid grid-cols-4 gap-1 px-2 py-1.5 tabular-nums">
                {[
                  { k: copy.sim.calls.latest, v: formatMetricVal(chartStats.latest, metric) },
                  { k: copy.sim.calls.avg, v: formatMetricVal(chartStats.avg, metric) },
                  { k: copy.sim.calls.p95, v: formatMetricVal(chartStats.p95, metric) },
                  { k: copy.sim.calls.peak, v: formatMetricVal(chartStats.peak, metric) },
                ].map((cell) => (
                  <div key={cell.k}>
                    <div class="text-[9px] text-[var(--faint)]">{cell.k}</div>
                    <div class="font-mono text-[11px] font-semibold text-[var(--fg)]">{cell.v}</div>
                  </div>
                ))}
              </div>

              {/* Organic Telemetry SVG Plot */}
              <div class="relative mt-2">
                <svg
                  viewBox={`0 0 ${plotW} ${plotH}`}
                  class="block w-full cursor-crosshair overflow-visible"
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const xSvg = ((e.clientX - rect.left) / rect.width) * plotW;
                    const frac = Math.max(0, Math.min(1, (xSvg - padL) / innerW));
                    const idx = Math.round(frac * (plotPoints.length - 1));
                    setHoverPlotIdx(idx);
                  }}
                  onPointerLeave={() => setHoverPlotIdx(null)}
                  onClick={() => {
                    if (hoveredPoint) setSelectedCallIdx(hoveredPoint.call.idx);
                  }}
                >
                  <defs>
                    <linearGradient id="simAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color={metricColor(metric)} stop-opacity="0.22" />
                      <stop offset="100%" stop-color={metricColor(metric)} stop-opacity="0.0" />
                    </linearGradient>
                  </defs>

                  {[0, 0.5, 1].map((t) => {
                    const y = padT + innerH * (1 - t);
                    const tickVal = yMax * t;
                    return (
                      <g key={t}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={plotW - padR}
                          y2={y}
                          stroke="var(--border)"
                          stroke-dasharray={t === 0 ? undefined : '2 2'}
                        />
                        <text
                          x={padL - 4}
                          y={y + 3}
                          text-anchor="end"
                          fill="var(--faint)"
                          font-size="8"
                          font-family="var(--font-mono)"
                        >
                          {metric === 'ttft' ? tickVal.toFixed(1) : Math.round(tickVal)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Compaction marker */}
                  {plotPoints.map((p) =>
                    p.call.isCompactAfter ? (
                      <line
                        key={`cmp-${p.call.idx}`}
                        x1={p.x}
                        y1={padT}
                        x2={p.x}
                        y2={padT + innerH}
                        stroke="var(--seg-think)"
                        stroke-width="1"
                        stroke-dasharray="2 2"
                        opacity="0.75"
                      />
                    ) : null,
                  )}

                  <path d={areaPath} fill="url(#simAreaGrad)" />
                  <path
                    d={linePath}
                    fill="none"
                    stroke={metricColor(metric)}
                    stroke-width="1.6"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />

                  {plotPoints.map((p) =>
                    p.call.idx === selectedCall.idx ? (
                      <circle
                        key="sel"
                        cx={p.x}
                        cy={p.y}
                        r="3.2"
                        fill="var(--sim-card)"
                        stroke="var(--seg-out)"
                        stroke-width="1.8"
                      />
                    ) : null,
                  )}

                  {hoveredPoint && (
                    <g>
                      <line
                        x1={hoveredPoint.x}
                        y1={padT}
                        x2={hoveredPoint.x}
                        y2={padT + innerH}
                        stroke="var(--fg-2)"
                        stroke-width="1"
                        stroke-dasharray="2 2"
                        opacity="0.55"
                      />
                      <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" fill={metricColor(metric)} opacity="0.2" />
                      <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="2.8" fill={metricColor(metric)} />
                    </g>
                  )}

                  {plotPoints.length > 0 && (
                    <>
                      <text x={padL} y={plotH - 2} fill="var(--faint)" font-size="8" font-family="var(--font-mono)">
                        #{plotPoints[0].call.idx}
                      </text>
                      <text
                        x={plotW - padR}
                        y={plotH - 2}
                        text-anchor="end"
                        fill="var(--faint)"
                        font-size="8"
                        font-family="var(--font-mono)"
                      >
                        #{plotPoints[plotPoints.length - 1].call.idx}
                      </text>
                    </>
                  )}
                </svg>

                {hoveredPoint && (
                  <div class="pointer-events-none absolute top-0.5 right-1 rounded-md border border-[var(--border-strong)] bg-[var(--sim-card)]/95 px-2 py-0.5 font-mono text-[9.5px] shadow-sm tabular-nums">
                    <span class="font-semibold text-[var(--fg)]">#{hoveredPoint.call.idx}</span>{' '}
                    <span class="text-[var(--muted)]">{hoveredPoint.call.shortModel}</span> ·{' '}
                    <span style={{ color: metricColor(metric) }} class="font-semibold">
                      {formatMetricVal(hoveredPoint.val, metric)}
                    </span>
                  </div>
                )}
              </div>

              {/* Minimap Brush */}
              <div class="mt-1">
                <svg
                  viewBox={`0 0 ${miniW} ${miniH}`}
                  class="block w-full cursor-ew-resize rounded-md bg-[var(--sim-well)] touch-none"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setBrushing(true);
                    scrubMinimapAtClientX(e.currentTarget, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!brushing) return;
                    scrubMinimapAtClientX(e.currentTarget, e.clientX);
                  }}
                  onPointerUp={() => setBrushing(false)}
                  onPointerCancel={() => setBrushing(false)}
                  onDblClick={() => applyPreset('all')}
                  role="slider"
                  aria-label="Historical minimap brush"
                  aria-valuemin={1}
                  aria-valuemax={60}
                  aria-valuenow={range.end + 1}
                >
                  <path d={miniPath} fill="none" stroke="var(--muted)" stroke-width="1.1" opacity="0.55" />
                  <rect
                    x={(brushLeftPct / 100) * miniW}
                    y="1"
                    width={(brushWidthPct / 100) * miniW}
                    height={miniH - 2}
                    rx="3"
                    fill="var(--tint-accent)"
                    stroke="var(--accent)"
                    stroke-width="1"
                  />
                </svg>
                <div class="mt-1 text-center text-[9.5px] text-[var(--faint)]">
                  {copy.sim.calls.brushHint}
                </div>
              </div>
            </div>

            {/* Call Detail Inspector */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px]">
                  <span class="font-semibold text-[var(--fg)] tabular-nums">#{selectedCall.idx}</span>
                  <span class="truncate text-[var(--fg-2)]">{selectedCall.model}</span>
                  {selectedCall.isToolStall && (
                    <span
                      class="rounded px-1 py-px text-[9px] font-semibold"
                      style={{ backgroundColor: 'var(--tint-out)', color: 'var(--seg-out)' }}
                    >
                      TC-WAIT
                    </span>
                  )}
                </div>
                <span class="shrink-0 font-mono text-[10px] font-semibold tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                  {selectedCall.genTps} t/s
                </span>
              </div>

              <div class="mt-2 flex items-center justify-between border-b border-[var(--border)] pb-1.5">
                <div class="flex items-center gap-1">
                  {(
                    [
                      { id: 'overview', label: copy.sim.calls.tabOverview },
                      { id: 'tools', label: `${copy.sim.calls.tabTools} (${selectedCall.tools.length})` },
                      { id: 'raw', label: copy.sim.calls.tabRaw },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectorTab(t.id)}
                      class={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        inspectorTab === t.id
                          ? 'bg-[var(--sim-well-2)] text-[var(--fg)]'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleCopyCallMd}
                  class="inline-flex cursor-pointer items-center gap-1 rounded bg-[var(--sim-well)] px-2 py-0.5 text-[9.5px] font-medium text-[var(--fg-2)] hover:text-[var(--fg)]"
                >
                  {copiedMd ? <IconCheck size={10} /> : <IconCopy size={10} />}
                  <span>{copiedMd ? copy.sim.calls.copiedMd : copy.sim.calls.copyMd}</span>
                </button>
              </div>

              {inspectorTab === 'overview' && (
                <div class="mt-2 space-y-2">
                  <div>
                    <div class="flex items-center justify-between text-[10px] text-[var(--muted)] tabular-nums">
                      <span>{copy.sim.calls.waterfallTitle}</span>
                      <span class="font-mono font-medium text-[var(--fg)]">{totalPhaseSec.toFixed(2)}s</span>
                    </div>
                    <div class="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-[var(--sim-well-2)]">
                      {wfPhases.map((p) => (
                        <div
                          key={p.key}
                          style={{
                            width: `${Math.max(4, (p.sec / totalPhaseSec) * 100)}%`,
                            backgroundColor: p.color,
                          }}
                          class="h-full border-r border-[var(--sim-card)]/60 last:border-r-0"
                          title={`${p.label}: ${p.sec.toFixed(2)}s`}
                        />
                      ))}
                    </div>
                    <div class="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[9px] text-[var(--muted)] tabular-nums">
                      {wfPhases.map((p) => (
                        <span key={p.key} class="inline-flex items-center gap-1">
                          <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                          {p.label} {p.sec.toFixed(1)}s
                        </span>
                      ))}
                    </div>
                  </div>

                  <div class="border-t border-[var(--border)] pt-2">
                    <div class="flex items-center justify-between text-[10px] text-[var(--muted)] tabular-nums">
                      <span>{copy.sim.calls.tokenCompTitle}</span>
                      <span class="font-mono font-medium" style={{ color: 'var(--seg-cache)' }}>
                        {copy.sim.calls.saved} ${selectedCall.savedUsd.toFixed(2)}
                      </span>
                    </div>
                    <div class="mt-1 grid grid-cols-[3fr_1fr] gap-1.5">
                      <div class="flex h-1.5 overflow-hidden rounded-full bg-[var(--sim-well-2)]">
                        <div style={{ width: `${cachedShare}%`, backgroundColor: 'var(--seg-cache)' }} />
                        <div style={{ width: `${100 - cachedShare}%`, backgroundColor: 'var(--seg-input)' }} />
                      </div>
                      <div class="flex h-1.5 overflow-hidden rounded-full bg-[var(--sim-well-2)]">
                        <div style={{ width: `${thinkShare}%`, backgroundColor: 'var(--seg-think)' }} />
                        <div style={{ width: `${100 - thinkShare}%`, backgroundColor: 'var(--seg-cache)' }} />
                      </div>
                    </div>
                    <div class="mt-1 flex items-center justify-between font-mono text-[9px] text-[var(--faint)] tabular-nums">
                      <span>
                        {copy.sim.calls.cached} {formatTokens(selectedCall.cachedTok)} · {copy.sim.calls.newInput}{' '}
                        {formatTokens(selectedCall.newInputTok)}
                      </span>
                      <span>
                        {copy.sim.calls.thinking} {formatTokens(selectedCall.thinkTok)} · {copy.sim.calls.visible}{' '}
                        {formatTokens(selectedCall.visTok)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {inspectorTab === 'tools' && (
                <div class="mt-2 space-y-1.5">
                  {selectedCall.tools.map((tool, i) => (
                    <div key={`${tool.name}-${i}`} class="sim-well p-2 font-mono text-[10px]">
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-[var(--fg)]">{tool.name}</span>
                        <span class="text-[9.5px] text-[var(--faint)] tabular-nums">{tool.ms}ms</span>
                      </div>
                      <pre class="mt-1 overflow-x-auto text-[9.5px] leading-snug text-[var(--muted)]">
                        {JSON.stringify(tool.args)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {inspectorTab === 'raw' && (
                <pre class="hud-scroll sim-well mt-2 max-h-[112px] overflow-auto p-2 font-mono text-[9.5px] leading-relaxed text-[var(--fg-2)]">
                  {JSON.stringify(
                    {
                      idx: selectedCall.idx,
                      routedModel_f19: selectedCall.model,
                      genTps: selectedCall.genTps,
                      e2eTps: selectedCall.e2eTps,
                      ttftSec: selectedCall.ttftSec,
                      cacheHitPct: selectedCall.cachePct,
                      costUsd: selectedCall.costUsd,
                      quota5hPct: -selectedCall.quota5h,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* ================= ACCOUNT TAB ================= */}
        {tab === 'account' && (
          <div class="space-y-2.5">
            {/* Hatched Diagonal Runway Quota Bar */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.account.quotaTitle}
                </span>
                <span class="text-[9.5px] text-[var(--faint)]">
                  {copy.sim.account.projectedBurn}
                </span>
              </div>

              <div class="mt-2 space-y-2.5">
                {[
                  {
                    label: copy.sim.account.win5h,
                    remPct: 68,
                    projBurnPct: 24,
                    reset: '2h 41m',
                    eta: '~3h 20m',
                    color: 'var(--seg-cache)',
                  },
                  {
                    label: copy.sim.account.win7d,
                    remPct: 81,
                    projBurnPct: 18,
                    reset: '4d 11h',
                    eta: '~5d 06h',
                    color: 'var(--seg-input)',
                  },
                ].map((pool) => {
                  const safePct = Math.max(0, pool.remPct - pool.projBurnPct);
                  return (
                    <div key={pool.label}>
                      <div class="flex items-center justify-between text-[10.5px] tabular-nums">
                        <span class="font-medium text-[var(--fg-2)]">{pool.label}</span>
                        <span class="font-mono text-[10.5px] text-[var(--muted)]">
                          <strong class="font-semibold text-[var(--fg)]">{pool.remPct}%</strong>{' '}
                          {copy.sim.account.left}
                        </span>
                      </div>
                      {/* Solid safe remaining + diagonal hatched projected burn */}
                      <div class="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--sim-well-2)]">
                        <div
                          class="h-full"
                          style={{ width: `${safePct}%`, backgroundColor: pool.color }}
                        />
                        <div
                          class="runway-hatch h-full"
                          style={{
                            width: `${pool.projBurnPct}%`,
                            backgroundColor: `color-mix(in srgb, ${pool.color} 38%, transparent)`,
                          }}
                          title={`${pool.projBurnPct}% ${copy.sim.account.projectedBurn}`}
                        />
                      </div>
                      <div class="mt-1 flex items-center justify-between font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                        <span>
                          {copy.sim.account.resetsIn} {pool.reset}
                        </span>
                        <span>
                          {copy.sim.account.runwayEta} {pool.eta}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Prompt Cache Survival (TTL) Mini-Card */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.account.ttlTitle}
                </span>
                <div class="flex items-center gap-0.5 rounded-md bg-[var(--sim-well)] p-0.5">
                  {SIM_CACHE_TTL_MODELS.map((m, i) => (
                    <button
                      key={m.family}
                      type="button"
                      onClick={() => setTtlModelIdx(i)}
                      class={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9px] font-medium transition-colors ${
                        ttlModelIdx === i
                          ? 'bg-[var(--sim-card)] text-[var(--fg)] shadow-2xs'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {i === 0 ? 'Carbon' : 'Claude'}
                    </button>
                  ))}
                </div>
              </div>

              <div class="mt-2 grid grid-cols-3 gap-1.5 tabular-nums">
                <div class="sim-well px-2 py-1">
                  <div class="text-[9px] text-[var(--faint)]">{copy.sim.account.ttlSafe}</div>
                  <div class="font-mono text-[11px] font-semibold" style={{ color: 'var(--seg-cache)' }}>
                    {activeTtlModel.p80Label}
                  </div>
                </div>
                <div class="sim-well px-2 py-1">
                  <div class="text-[9px] text-[var(--faint)]">{copy.sim.account.ttlHalf}</div>
                  <div class="font-mono text-[11px] font-semibold text-[var(--fg)]">
                    {activeTtlModel.p50Label}
                  </div>
                </div>
                <div class="sim-well px-2 py-1">
                  <div class="text-[9px] text-[var(--faint)]">{copy.sim.account.ttlBg}</div>
                  <div class="font-mono text-[11px] font-semibold text-[var(--fg)]">
                    {activeTtlModel.bgMissPct}
                  </div>
                </div>
              </div>

              {/* 7-Bucket empirical bars + fitted Log-Logistic survival curve */}
              <div class="sim-well mt-2 px-2 pt-2 pb-1.5">
                <div class="relative h-9">
                  <div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--border-strong)]" />
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                    aria-hidden="true"
                  >
                    <polyline
                      fill="none"
                      stroke="var(--accent-ink)"
                      stroke-width="1.8"
                      vector-effect="non-scaling-stroke"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      points={activeTtlModel.buckets
                        .map((b, i) => {
                          const x = ((i + 0.5) / activeTtlModel.buckets.length) * 100;
                          const y = (1 - b.pred) * 100;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(' ')}
                    />
                  </svg>
                  <div class="relative z-10 grid h-full grid-cols-7 items-end gap-1">
                    {activeTtlModel.buckets.map((b) => {
                      const val = b.obs ?? 0;
                      const barColor =
                        val >= 0.75
                          ? 'var(--seg-cache)'
                          : val >= 0.4
                            ? 'var(--seg-out)'
                            : 'var(--seg-bad)';
                      return (
                        <div key={b.label} class="flex h-full items-end justify-center">
                          {b.obs !== null && (
                            <div
                              class="w-full rounded-t-[2px] opacity-55"
                              style={{ height: `${Math.max(4, val * 100)}%`, backgroundColor: barColor }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div class="mt-1 grid grid-cols-7 text-center font-mono text-[8.5px] text-[var(--faint)]">
                  {activeTtlModel.buckets.map((b) => (
                    <span key={b.label}>{b.label}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* IRLS k-Multipliers */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.account.rulesTitle}
                </span>
                <span class="font-mono text-[9.5px] font-medium tabular-nums" style={{ color: 'var(--seg-cache)' }}>
                  {copy.sim.account.oosErr}
                </span>
              </div>
              <div class="mt-2 grid grid-cols-3 gap-1.5 font-mono tabular-nums">
                {[
                  { name: 'Carbon', k: '3.0×', color: 'var(--seg-out)' },
                  { name: 'Hydrogen', k: '1.0×', color: 'var(--seg-input)' },
                  { name: 'Flash-K', k: '0.4×', color: 'var(--seg-cache)' },
                ].map((m) => (
                  <div key={m.name} class="sim-well px-2 py-1.5">
                    <div class="text-[9.5px] text-[var(--muted)]">{m.name}</div>
                    <div class="text-[12.5px] font-bold" style={{ color: m.color }}>
                      {m.k}
                    </div>
                  </div>
                ))}
              </div>
              <div class="mt-1.5 font-mono text-[9px] text-[var(--faint)]">
                {copy.sim.account.remoteGap}
              </div>
            </div>

            {/* Activity: 16w Heatmap / Monochrome Token Iceberg toggle */}
            <div class="sim-card p-2.5">
              <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-semibold text-[var(--fg)]">
                  {copy.sim.account.activityTitle}
                </span>
                <div class="flex items-center gap-0.5 rounded-md bg-[var(--sim-well)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setActivityMode('iceberg')}
                    class={`cursor-pointer rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors ${
                      activityMode === 'iceberg'
                        ? 'bg-[var(--sim-card)] text-[var(--fg)] shadow-2xs'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {copy.sim.account.modeIceberg}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityMode('heatmap')}
                    class={`cursor-pointer rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors ${
                      activityMode === 'heatmap'
                        ? 'bg-[var(--sim-card)] text-[var(--fg)] shadow-2xs'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {copy.sim.account.modeHeatmap}
                  </button>
                </div>
              </div>

              {activityMode === 'iceberg' ? (
                <div class="mt-2">
                  <div class="sim-well px-2 py-2">
                    <div class="relative flex h-12 items-center gap-[3px]">
                      <div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-[var(--border-strong)]" />
                      {icebergDays.map((d) => {
                        const topH = d.newTokensM > 0 ? Math.max(8, (d.newTokensM / icebergMaxNew) * 100) : 0;
                        const botH = d.cachedTokensM > 0 ? Math.max(8, (d.cachedTokensM / icebergMaxCached) * 100) : 0;
                        return (
                          <button
                            key={d.date}
                            type="button"
                            onMouseEnter={() => setHoveredDay(d)}
                            onMouseLeave={() => setHoveredDay(null)}
                            class="flex h-full flex-1 cursor-pointer flex-col items-center justify-center"
                            aria-label={`${d.date}: ${d.newTokensM}M new, ${d.cachedTokensM}M cached`}
                          >
                            <div class="flex h-1/2 w-full items-end pb-[1px]">
                              {topH > 0 && (
                                <div
                                  class="w-full rounded-t-[1.5px] bg-[var(--fg)]/80 transition-opacity hover:opacity-100"
                                  style={{ height: `${topH}%` }}
                                />
                              )}
                            </div>
                            <div class="flex h-1/2 w-full items-start pt-[1px]">
                              {botH > 0 && (
                                <div
                                  class="w-full rounded-b-[1.5px] bg-[var(--muted)]/40"
                                  style={{ height: `${botH}%` }}
                                />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div class="mt-1.5 flex items-center justify-between font-mono text-[9px] text-[var(--faint)] tabular-nums">
                    {hoveredDay ? (
                      <span class="text-[var(--fg-2)]">
                        {hoveredDay.date} · +{hoveredDay.newTokensM}M / {hoveredDay.cachedTokensM}M cached
                      </span>
                    ) : (
                      <>
                        <span class="inline-flex items-center gap-1">
                          <span class="h-1.5 w-1.5 rounded-[1px] bg-[var(--fg)]/80" />
                          {copy.sim.account.icebergLegendNew}
                        </span>
                        <span class="inline-flex items-center gap-1">
                          <span class="h-1.5 w-1.5 rounded-[1px] bg-[var(--muted)]/45" />
                          {copy.sim.account.icebergLegendCached}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div class="mt-2">
                  <div class="grid grid-cols-16 gap-[3px]">
                    {Array.from({ length: 16 }).map((_, weekIdx) => (
                      <div key={weekIdx} class="grid grid-rows-7 gap-[3px]">
                        {SIM_HEATMAP.filter((d) => d.week === weekIdx).map((day) => {
                          const bg =
                            day.level === 0
                              ? 'var(--sim-well-2)'
                              : day.level === 1
                                ? 'color-mix(in srgb, var(--seg-cache) 28%, var(--sim-well-2))'
                                : day.level === 2
                                  ? 'color-mix(in srgb, var(--seg-cache) 54%, var(--sim-well-2))'
                                  : day.level === 3
                                    ? 'color-mix(in srgb, var(--seg-cache) 78%, var(--sim-well-2))'
                                    : 'var(--seg-cache)';
                          return (
                            <button
                              key={day.date}
                              type="button"
                              onMouseEnter={() => setHoveredDay(day)}
                              onMouseLeave={() => setHoveredDay(null)}
                              class="aspect-square w-full cursor-pointer rounded-[2px] transition-transform hover:scale-125"
                              style={{ backgroundColor: bg }}
                              aria-label={`${day.date}: ${day.tokensM}M tokens`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div class="mt-1.5 font-mono text-[9px] text-[var(--faint)] tabular-nums">
                    {hoveredDay ? (
                      <span class="text-[var(--fg-2)]">
                        {hoveredDay.date} · {hoveredDay.tokensM}M tok · ${hoveredDay.costUsd}
                      </span>
                    ) : (
                      <span class="truncate">{copy.sim.account.heatmapSub}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Compact 1-Click Self-Update Bar */}
            <div class="sim-card flex items-center justify-between gap-2 p-2.5">
              <div class="min-w-0">
                <div class="text-[10.5px] font-semibold text-[var(--fg)]">
                  {copy.sim.account.updateTitle}
                </div>
                <div class="font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                  {updateState === 'applied'
                    ? copy.sim.account.updatedOk
                    : `${copy.sim.account.updateInstalled} · ${copy.sim.account.updateAvail}`}
                </div>
              </div>
              <button
                type="button"
                onClick={handleSimulateUpdate}
                disabled={updateState !== 'available'}
                class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:cursor-default"
                style={
                  updateState === 'applied'
                    ? { backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }
                    : { backgroundColor: 'var(--tint-accent)', color: 'var(--accent-ink)' }
                }
              >
                {updateState === 'applied' ? <IconCheck size={10} /> : <IconDownload size={10} />}
                <span>
                  {updateState === 'updating'
                    ? copy.sim.account.updating
                    : updateState === 'applied'
                      ? 'v1.2.1'
                      : copy.sim.account.updateBtn}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
