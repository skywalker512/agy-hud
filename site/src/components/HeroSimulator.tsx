import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  SIM_CALLS,
  SIM_CONTEXT_SEGMENTS,
  SIM_HEATMAP,
  SIM_LIVE_SPARKLINE_BASE,
  SIM_SWARM_WORKERS,
  type HeatmapDay,
  type SimCallPoint,
  type SimChartMetric,
  type SimRangePreset,
  type SimTab,
} from '../data/simulatorData';
import type { Locale, SiteCopy } from '../i18n/content';
import { BrandLogo } from './Navbar';

interface HeroSimulatorProps {
  locale: Locale;
  copy: SiteCopy;
}

type InspectorTab = 'overview' | 'tools' | 'raw';

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

export function HeroSimulator({ locale, copy }: HeroSimulatorProps) {
  const [tab, setTab] = useState<SimTab>('live');

  // Live tab state: gentle ticking live throughput
  const [sparkSeries, setSparkSeries] = useState<number[]>(SIM_LIVE_SPARKLINE_BASE);
  const [hoveredCtxId, setHoveredCtxId] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<string>('trend-viz');

  // Calls tab state: metric, range, brush window, crosshair hover, selected call, inspector tab
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
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [updateState, setUpdateState] = useState<'available' | 'checking' | 'updating' | 'applied'>('available');

  useEffect(() => {
    const offsets = [94.6, 96.2, 93.1, 97.4, 95.3, 91.8, 95.9, 94.6];
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % offsets.length;
      setSparkSeries((prev) => [...prev.slice(1), offsets[step]]);
    }, 2400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!copiedMd) return;
    const id = window.setTimeout(() => setCopiedMd(false), 1600);
    return () => window.clearTimeout(id);
  }, [copiedMd]);

  const currentGen = sparkSeries[sparkSeries.length - 1];
  const currentE2e = Number((currentGen * 0.72).toFixed(1));
  const avgGen = 82.8;
  const genDeltaPct = Math.round(((currentGen - avgGen) / avgGen) * 100);

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
    if (updateState === 'applied' || updateState === 'updating') return;
    setUpdateState('updating');
    window.setTimeout(() => setUpdateState('applied'), 1100);
  };

  const handleCheckUpdate = () => {
    setUpdateState('checking');
    window.setTimeout(() => setUpdateState('available'), 600);
  };

  const activeCtxSeg = SIM_CONTEXT_SEGMENTS.find((s) => s.id === hoveredCtxId);
  const activeWorkerObj = SIM_SWARM_WORKERS.find((w) => w.rosterName === selectedWorker) ?? SIM_SWARM_WORKERS[0];

  // Build SVG path for main plot in Calls tab
  const plotW = 328;
  const plotH = 92;
  const padL = 28;
  const padR = 6;
  const padT = 8;
  const padB = 14;
  const innerW = plotW - padL - padR;
  const innerH = plotH - padT - padB;

  const yMax = useMemo(() => {
    if (metric === 'cache' || metric === 'ctx') return 100;
    const maxV = Math.max(...visibleCalls.map((c) => metricValue(c, metric)), 1);
    if (metric === 'ttft') return Math.ceil((maxV * 1.15) * 2) / 2;
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

  // Minimap sparkline path across all 60 calls
  const miniW = 328;
  const miniH = 22;
  const miniPath = useMemo(() => {
    const maxAll = metric === 'cache' || metric === 'ctx'
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

  // Waterfall proportions for selectedCall
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

  return (
    <div
      class="hud-frame mx-auto w-full max-w-[392px] overflow-hidden rounded-2xl text-[11.5px] select-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === '1') setTab('live');
        else if (e.key === '2') setTab('calls');
        else if (e.key === '3') setTab('account');
      }}
      aria-label="Interactive AGY-HUD side-pane simulator"
    >
      {/* Simulated Antigravity Side-Pane TopBar */}
      <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <BrandLogo size={16} />
          <span class="font-mono text-[11px] font-bold tracking-tight text-[var(--fg)]">
            {copy.sim.paneTitle}
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9.5px] font-bold"
            style={{
              backgroundColor: 'var(--tint-ok)',
              borderColor: 'var(--tint-ok-border)',
              color: 'var(--seg-cache)',
            }}
          >
            <span class="animate-hud-pulse h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-cache)' }} />
            {copy.sim.statusGen}
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <span class="max-w-[130px] truncate rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-2)]">
            {copy.sim.sessionName}
          </span>
        </div>
      </div>

      {/* Routed Model Strip */}
      <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10.5px]">
        <div class="flex items-center gap-1.5">
          <span class="font-mono text-[9.5px] uppercase tracking-wider text-[var(--faint)]">f19</span>
          <span class="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[10.5px] font-semibold text-[var(--fg)]">
            gemini-4-carbon
          </span>
          <span class="font-mono text-[10px] text-[var(--muted)] tabular-nums">256k ctx</span>
        </div>
        <span class="font-mono text-[9.5px] text-[var(--faint)]">{copy.sim.shortcutHint}</span>
      </div>

      {/* 3-Tab Switcher */}
      <div class="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <div class="grid grid-cols-3 gap-1 rounded-lg bg-[var(--surface-2)] p-0.5" role="tablist">
          {(
            [
              { id: 'live', label: copy.sim.tabLive, badge: '●' },
              { id: 'calls', label: copy.sim.tabCalls, badge: '60' },
              { id: 'account', label: copy.sim.tabAccount, badge: '↑' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                class={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1 text-[11.5px] font-semibold transition-all ${
                  active
                    ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs ring-1 ring-[var(--border-strong)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <span>{item.label}</span>
                <span
                  class="font-mono text-[9.5px] tabular-nums"
                  style={{
                    color:
                      item.id === 'live'
                        ? 'var(--seg-cache)'
                        : item.id === 'account'
                          ? 'var(--accent-ink)'
                          : 'var(--faint)',
                  }}
                >
                  {item.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Body */}
      <div class="hud-scroll h-[438px] overflow-y-auto bg-[var(--bg)]/40 p-3">
        {/* ================= LIVE TAB ================= */}
        {tab === 'live' && (
          <div class="space-y-2.5">
            {/* Hero Speed Cards */}
            <div class="grid grid-cols-2 gap-2">
              {/* GEN Card */}
              <div class="inset-well rounded-lg p-2.5">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                    {copy.sim.live.genLabel}
                  </span>
                  <span
                    class="rounded px-1 py-px font-mono text-[9.5px] font-semibold tabular-nums"
                    style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                  >
                    +{genDeltaPct}%
                  </span>
                </div>
                <div class="mt-1 flex items-end justify-between gap-1">
                  <div class="flex items-baseline gap-1">
                    <span class="font-mono text-[20px] font-bold leading-none text-[var(--fg)] tabular-nums">
                      {currentGen.toFixed(1)}
                    </span>
                    <span class="font-mono text-[10px] text-[var(--muted)]">tok/s</span>
                  </div>
                  {/* Inline sparkline */}
                  <svg width="52" height="18" viewBox="0 0 52 18" class="shrink-0" aria-hidden="true">
                    <polyline
                      fill="none"
                      stroke="var(--seg-cache)"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      points={sparkSeries
                        .map((v, i) => {
                          const x = (i / (sparkSeries.length - 1)) * 50 + 1;
                          const y = 16 - ((v - 74) / 28) * 14;
                          return `${x.toFixed(1)},${Math.max(2, Math.min(16, y)).toFixed(1)}`;
                        })
                        .join(' ')}
                    />
                  </svg>
                </div>
                <div class="mt-1 font-mono text-[9.5px] text-[var(--faint)]">
                  {copy.sim.live.sustained}
                </div>
              </div>

              {/* E2E Card */}
              <div class="inset-well rounded-lg p-2.5">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                    {copy.sim.live.e2eLabel}
                  </span>
                  <span class="font-mono text-[9.5px] text-[var(--faint)] tabular-nums">94.8% cache</span>
                </div>
                <div class="mt-1 flex items-baseline gap-1">
                  <span class="font-mono text-[20px] font-bold leading-none text-[var(--fg)] tabular-nums">
                    {currentE2e.toFixed(1)}
                  </span>
                  <span class="font-mono text-[10px] text-[var(--muted)]">tok/s</span>
                </div>
                <div class="mt-1.5 font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                  {copy.sim.live.inclTtft}
                </div>
              </div>
            </div>

            {/* Context Window X-Ray */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                  {copy.sim.live.ctxTitle}
                </span>
                <span class="font-mono text-[10.5px] font-semibold text-[var(--fg)] tabular-nums">
                  142.4k / 256k <span class="text-[var(--muted)]">(55.6%)</span>
                </span>
              </div>

              {/* Interactive segmented bar */}
              <div class="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
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
                        opacity: hoveredCtxId && !isHovered ? 0.45 : 1,
                      }}
                      class="h-full cursor-pointer border-r border-[var(--bg)]/50 transition-opacity last:border-r-0"
                      aria-label={locale === 'zh' ? seg.labelZh : seg.labelEn}
                    />
                  );
                })}
              </div>

              {/* Dynamic hover readout */}
              <div class="mt-2 flex items-center justify-between gap-2 rounded bg-[var(--surface)] px-2 py-1 font-mono text-[10px]">
                {activeCtxSeg ? (
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: activeCtxSeg.colorVar }}
                    />
                    <span class="font-semibold text-[var(--fg)]">
                      {locale === 'zh' ? activeCtxSeg.labelZh : activeCtxSeg.labelEn}:
                    </span>
                    <span class="truncate text-[var(--muted)]">
                      {locale === 'zh' ? activeCtxSeg.detailZh : activeCtxSeg.detailEn}
                    </span>
                  </div>
                ) : (
                  <>
                    <span class="text-[var(--muted)]">{copy.sim.live.hoverSegment}</span>
                    <span class="shrink-0 text-[var(--seg-cache)]">{copy.sim.live.ctxHeadroom}</span>
                  </>
                )}
              </div>

              <div class="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-[var(--faint)]">
                <span>read_file 41.2k · run_command 19.6k</span>
                <span style={{ color: 'var(--seg-cache)' }}>{copy.sim.live.ctxCacheAge}</span>
              </div>
            </div>

            {/* Native AGY Swarm Cockpit */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                    {copy.sim.live.swarmTitle}
                  </span>
                  <span
                    class="rounded px-1.5 py-px font-mono text-[9.5px] font-semibold"
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
                    class="inline-flex items-center gap-1 rounded px-1.5 py-px font-semibold"
                    style={{ backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }}
                  >
                    <span class="animate-hud-pulse h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--seg-cache)' }} />
                    {copy.sim.live.swarmWorking}
                  </span>
                  <span class="rounded bg-[var(--surface-3)] px-1.5 py-px text-[var(--muted)]">
                    {copy.sim.live.swarmWaiting}
                  </span>
                </div>
              </div>

              <div class="mt-1 font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                {copy.sim.live.swarmRollup}
              </div>

              {/* Clickable Workers */}
              <div class="mt-2 space-y-1.5">
                {SIM_SWARM_WORKERS.map((w) => {
                  const isSel = w.rosterName === selectedWorker;
                  const isWorking = w.state === 'working';
                  return (
                    <button
                      key={w.rosterName}
                      type="button"
                      onClick={() => setSelectedWorker(w.rosterName)}
                      class={`w-full cursor-pointer rounded-md border px-2 py-1.5 text-left transition-colors ${
                        isSel
                          ? 'border-[var(--border-strong)] bg-[var(--surface)]'
                          : 'border-[var(--border)] bg-[var(--surface)]/55 hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div class="flex items-center justify-between gap-1.5">
                        <div class="flex min-w-0 items-center gap-1.5">
                          <span
                            class={`h-1.5 w-1.5 shrink-0 rounded-full ${isWorking ? 'animate-hud-pulse' : ''}`}
                            style={{ backgroundColor: isWorking ? 'var(--seg-cache)' : 'var(--faint)' }}
                          />
                          <span class="font-mono text-[11px] font-bold text-[var(--fg)]">
                            @{w.rosterName}
                          </span>
                          <span
                            class="rounded px-1 py-px font-mono text-[9px] font-semibold"
                            style={
                              isWorking
                                ? { backgroundColor: 'var(--tint-ok)', color: 'var(--seg-cache)' }
                                : { backgroundColor: 'var(--surface-3)', color: 'var(--muted)' }
                            }
                          >
                            {w.state}
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

              {/* Selected Worker Board Post Preview */}
              <div class="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[9.5px]">
                <div class="flex items-center justify-between text-[var(--faint)]">
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
            <div class="inset-well rounded-lg p-2.5">
              {/* Row 1: Title + Metric Tabs */}
              <div class="flex items-center justify-between gap-1">
                <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                  {copy.sim.calls.trendTitle} <span class="text-[var(--faint)] tabular-nums">60</span>
                </span>
                <div class="flex items-center gap-0.5 rounded bg-[var(--surface-3)] p-0.5">
                  {(['tps', 'ttft', 'cache', 'ctx'] as SimChartMetric[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      class={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase transition-colors ${
                        metric === m
                          ? 'bg-[var(--surface)] text-[var(--fg)] shadow-2xs'
                          : 'text-[var(--muted)] hover:text-[var(--fg)]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Range Presets + Follow Live */}
              <div class="mt-1.5 flex items-center justify-between gap-1">
                <div class="flex items-center gap-1">
                  {(['20', '50', 'all'] as SimRangePreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => applyPreset(p)}
                      class={`cursor-pointer rounded border px-1.5 py-px font-mono text-[9.5px] font-medium transition-colors ${
                        preset === p && followLive
                          ? 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg)]'
                          : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
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
                    class="cursor-pointer rounded border px-1.5 py-px font-mono text-[9.5px] font-semibold"
                    style={{
                      backgroundColor: 'var(--tint-accent)',
                      borderColor: 'var(--tint-accent-border)',
                      color: 'var(--accent-ink)',
                    }}
                  >
                    #{range.start + 1}–#{range.end + 1} · {copy.sim.calls.followLive} ⏭
                  </button>
                ) : (
                  <span class="font-mono text-[9.5px] text-[var(--faint)] tabular-nums">
                    #{range.start + 1}–#{range.end + 1} / 60
                  </span>
                )}
              </div>

              {/* 4-Cell Viewport Stat Strip */}
              <div class="mt-1.5 grid grid-cols-4 gap-1 rounded border border-[var(--border)] bg-[var(--surface)] p-1.5 font-mono tabular-nums">
                {[
                  { k: copy.sim.calls.latest, v: formatMetricVal(chartStats.latest, metric) },
                  { k: copy.sim.calls.avg, v: formatMetricVal(chartStats.avg, metric) },
                  { k: copy.sim.calls.p95, v: formatMetricVal(chartStats.p95, metric) },
                  { k: copy.sim.calls.peak, v: formatMetricVal(chartStats.peak, metric) },
                ].map((cell) => (
                  <div key={cell.k}>
                    <div class="text-[8.5px] text-[var(--faint)]">{cell.k}</div>
                    <div class="text-[11px] font-bold text-[var(--fg)]">{cell.v}</div>
                  </div>
                ))}
              </div>

              {/* Main SVG Plot with 0ms Crosshair + Click-to-Inspect */}
              <div class="relative mt-1.5">
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
                    if (hoveredPoint) {
                      setSelectedCallIdx(hoveredPoint.call.idx);
                    }
                  }}
                >
                  <defs>
                    <linearGradient id="simAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color={metricColor(metric)} stop-opacity="0.28" />
                      <stop offset="100%" stop-color={metricColor(metric)} stop-opacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Y-axis ticks & gridlines */}
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

                  {/* Compaction vertical markers */}
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
                        opacity="0.7"
                      />
                    ) : null,
                  )}

                  {/* Area + Line */}
                  <path d={areaPath} fill="url(#simAreaGrad)" />
                  <path
                    d={linePath}
                    fill="none"
                    stroke={metricColor(metric)}
                    stroke-width="1.7"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />

                  {/* Selected Call Dot */}
                  {plotPoints.map((p) =>
                    p.call.idx === selectedCall.idx ? (
                      <circle
                        key="sel"
                        cx={p.x}
                        cy={p.y}
                        r="3.2"
                        fill="var(--surface)"
                        stroke="var(--seg-out)"
                        stroke-width="1.8"
                      />
                    ) : null,
                  )}

                  {/* 0ms Crosshair */}
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
                        opacity="0.65"
                      />
                      <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5.5" fill={metricColor(metric)} opacity="0.22" />
                      <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3" fill={metricColor(metric)} />
                    </g>
                  )}

                  {/* X-axis bounds */}
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

                {/* Hover floating pill */}
                {hoveredPoint && (
                  <div class="pointer-events-none absolute top-0.5 right-1 rounded border border-[var(--border-strong)] bg-[var(--surface)]/95 px-2 py-1 font-mono text-[9.5px] shadow-md tabular-nums">
                    <span class="font-bold text-[var(--fg)]">#{hoveredPoint.call.idx}</span>{' '}
                    <span class="text-[var(--muted)]">{hoveredPoint.call.shortModel}</span> ·{' '}
                    <span style={{ color: metricColor(metric) }} class="font-bold">
                      {formatMetricVal(hoveredPoint.val, metric)}
                    </span>
                  </div>
                )}
              </div>

              {/* Interactive Minimap Brush */}
              <div class="mt-1">
                <svg
                  viewBox={`0 0 ${miniW} ${miniH}`}
                  class="block w-full cursor-ew-resize rounded border border-[var(--border)] bg-[var(--surface)] touch-none"
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
                    rx="2"
                    fill="var(--tint-accent)"
                    stroke="var(--accent)"
                    stroke-width="1"
                  />
                </svg>
                <div class="mt-0.5 text-center font-mono text-[9px] text-[var(--faint)]">
                  {copy.sim.calls.brushHint}
                </div>
              </div>
            </div>

            {/* OpenRouter-Style Call Detail Inspector */}
            <div class="inset-well rounded-lg p-2.5">
              {/* Row Header */}
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px]">
                  <span class="font-bold text-[var(--fg)] tabular-nums">#{selectedCall.idx}</span>
                  <span class="truncate text-[var(--fg-2)]">{selectedCall.model}</span>
                  {selectedCall.isToolStall && (
                    <span
                      class="rounded px-1 py-px text-[9px] font-bold"
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

              {/* Inspector Tabs + Quick Copy */}
              <div class="mt-1.5 flex items-center justify-between border-b border-[var(--border)] pb-1.5">
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
                      class={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                        inspectorTab === t.id
                          ? 'bg-[var(--surface)] text-[var(--fg)] ring-1 ring-[var(--border-strong)]'
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
                  class="cursor-pointer rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-[var(--fg-2)] hover:text-[var(--fg)]"
                >
                  {copiedMd ? copy.sim.calls.copiedMd : copy.sim.calls.copyMd}
                </button>
              </div>

              {inspectorTab === 'overview' && (
                <div class="mt-2 space-y-2">
                  {/* Timing Waterfall */}
                  <div>
                    <div class="flex items-center justify-between font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                      <span>{copy.sim.calls.waterfallTitle}</span>
                      <span class="text-[var(--fg)]">{totalPhaseSec.toFixed(2)}s</span>
                    </div>
                    <div class="mt-1 flex h-2.5 w-full overflow-hidden rounded bg-[var(--surface-3)]">
                      {wfPhases.map((p) => {
                        const pct = Math.max(4, (p.sec / totalPhaseSec) * 100);
                        return (
                          <div
                            key={p.key}
                            style={{ width: `${pct}%`, backgroundColor: p.color }}
                            class="h-full border-r border-[var(--bg)]/50 last:border-r-0"
                            title={`${p.label}: ${p.sec.toFixed(2)}s`}
                          />
                        );
                      })}
                    </div>
                    <div class="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[9px] text-[var(--muted)] tabular-nums">
                      {wfPhases.map((p) => (
                        <span key={p.key} class="inline-flex items-center gap-1">
                          <span class="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                          {p.label} {p.sec.toFixed(1)}s
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Token & Cost Composition Bar */}
                  <div class="border-t border-[var(--border)] pt-2">
                    <div class="flex items-center justify-between font-mono text-[9.5px] text-[var(--muted)] tabular-nums">
                      <span>{copy.sim.calls.tokenCompTitle}</span>
                      <span style={{ color: 'var(--seg-cache)' }}>
                        {copy.sim.calls.saved} ${selectedCall.savedUsd.toFixed(2)}
                      </span>
                    </div>
                    <div class="mt-1 grid grid-cols-[3fr_1fr] gap-1.5">
                      <div class="flex h-2 overflow-hidden rounded bg-[var(--surface-3)]">
                        <div style={{ width: `${cachedShare}%`, backgroundColor: 'var(--seg-cache)' }} />
                        <div style={{ width: `${100 - cachedShare}%`, backgroundColor: 'var(--seg-input)' }} />
                      </div>
                      <div class="flex h-2 overflow-hidden rounded bg-[var(--surface-3)]">
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
                    <div key={`${tool.name}-${i}`} class="rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px]">
                      <div class="flex items-center justify-between">
                        <span
                          class="rounded px-1.5 py-px text-[9.5px] font-bold"
                          style={{ backgroundColor: 'var(--tint-out)', color: 'var(--seg-out)' }}
                        >
                          {tool.name}
                        </span>
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
                <pre class="hud-scroll mt-2 max-h-[112px] overflow-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[9.5px] leading-relaxed text-[var(--fg-2)]">
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
            {/* Dual 5h / 7d Quota Runway */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                {copy.sim.account.quotaTitle}
              </div>

              <div class="mt-2 space-y-2.5">
                {[
                  {
                    label: copy.sim.account.win5h,
                    remPct: 68,
                    reset: '2h 41m',
                    eta: '~3h 20m',
                    color: 'var(--seg-cache)',
                  },
                  {
                    label: copy.sim.account.win7d,
                    remPct: 81,
                    reset: '4d 11h',
                    eta: '~5d 06h',
                    color: 'var(--seg-input)',
                  },
                ].map((pool) => (
                  <div key={pool.label}>
                    <div class="flex items-center justify-between font-mono text-[10px] tabular-nums">
                      <span class="font-semibold text-[var(--fg)]">{pool.label}</span>
                      <span class="text-[var(--fg-2)]">
                        <strong style={{ color: pool.color }}>{pool.remPct}%</strong> left
                      </span>
                    </div>
                    <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div
                        class="h-full rounded-full"
                        style={{ width: `${pool.remPct}%`, backgroundColor: pool.color }}
                      />
                    </div>
                    <div class="mt-0.5 flex items-center justify-between font-mono text-[9px] text-[var(--faint)] tabular-nums">
                      <span>
                        {copy.sim.account.resetsIn} {pool.reset}
                      </span>
                      <span>
                        {copy.sim.account.runwayEta} {pool.eta}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calibrated k-Multiplier Card */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="flex items-center justify-between">
                <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                  {copy.sim.account.rulesTitle}
                </span>
                <span class="font-mono text-[9px] text-[var(--seg-cache)] tabular-nums">
                  {copy.sim.account.oosErr}
                </span>
              </div>
              <div class="mt-2 grid grid-cols-3 gap-1.5 font-mono tabular-nums">
                {[
                  { name: 'Carbon', k: '3.0×', badge: 'fitted', color: 'var(--seg-out)' },
                  { name: 'Hydrogen', k: '1.0×', badge: 'fitted', color: 'var(--seg-input)' },
                  { name: 'Flash-K', k: '0.4×', badge: 'fitted', color: 'var(--seg-cache)' },
                ].map((m) => (
                  <div key={m.name} class="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
                    <div class="text-[9.5px] text-[var(--muted)]">{m.name}</div>
                    <div class="text-[13px] font-bold" style={{ color: m.color }}>
                      {m.k}
                    </div>
                    <div class="text-[8.5px] text-[var(--faint)]">{m.badge}</div>
                  </div>
                ))}
              </div>
              <div class="mt-1.5 font-mono text-[9px] text-[var(--faint)] tabular-nums">
                {copy.sim.account.remoteGap} · App + CLI unified credit tank
              </div>
            </div>

            {/* 16-Week Activity Heatmap */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="flex items-center justify-between gap-1">
                <span class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                  {copy.sim.account.heatmapTitle}
                </span>
              </div>
              <div class="mt-1.5 grid grid-cols-16 gap-[3px]">
                {Array.from({ length: 16 }).map((_, weekIdx) => (
                  <div key={weekIdx} class="grid grid-rows-7 gap-[3px]">
                    {SIM_HEATMAP.filter((d) => d.week === weekIdx).map((day) => {
                      const bg =
                        day.level === 0
                          ? 'var(--surface-3)'
                          : day.level === 1
                            ? 'color-mix(in srgb, var(--seg-cache) 28%, var(--surface-3))'
                            : day.level === 2
                              ? 'color-mix(in srgb, var(--seg-cache) 52%, var(--surface-3))'
                              : day.level === 3
                                ? 'color-mix(in srgb, var(--seg-cache) 76%, var(--surface-3))'
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
              <div class="mt-1.5 flex items-center justify-between font-mono text-[9px] text-[var(--faint)] tabular-nums">
                {hoveredDay ? (
                  <span class="text-[var(--fg-2)]">
                    {hoveredDay.date} · {hoveredDay.tokensM}M tok · ${hoveredDay.costUsd}
                  </span>
                ) : (
                  <span class="truncate">{copy.sim.account.heatmapSub}</span>
                )}
              </div>
            </div>

            {/* Interactive 1-Click Self-Update Card */}
            <div class="inset-well rounded-lg p-2.5">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <div class="font-mono text-[9.5px] font-semibold tracking-wider text-[var(--muted)]">
                    {copy.sim.account.updateTitle}
                  </div>
                  <div class="mt-0.5 font-mono text-[10.5px] font-semibold text-[var(--fg)] tabular-nums">
                    {updateState === 'applied'
                      ? copy.sim.account.updatedOk
                      : `${copy.sim.account.updateInstalled} → ${copy.sim.account.updateAvail}`}
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  {updateState !== 'applied' && (
                    <button
                      type="button"
                      onClick={handleCheckUpdate}
                      class="cursor-pointer rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[9.5px] font-medium text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      {updateState === 'checking' ? '…' : copy.sim.account.checkBtn}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSimulateUpdate}
                    disabled={updateState === 'updating' || updateState === 'applied'}
                    class="cursor-pointer rounded border px-2 py-1 font-mono text-[9.5px] font-semibold transition-colors disabled:cursor-default"
                    style={
                      updateState === 'applied'
                        ? {
                            backgroundColor: 'var(--tint-ok)',
                            borderColor: 'var(--tint-ok-border)',
                            color: 'var(--seg-cache)',
                          }
                        : {
                            backgroundColor: 'var(--tint-accent)',
                            borderColor: 'var(--tint-accent-border)',
                            color: 'var(--accent-ink)',
                          }
                    }
                  >
                    {updateState === 'updating'
                      ? copy.sim.account.updating
                      : updateState === 'applied'
                        ? '✓ v1.2.1'
                        : copy.sim.account.updateBtn}
                  </button>
                </div>
              </div>
              <div class="mt-1 font-mono text-[9px] text-[var(--faint)]">
                {copy.sim.account.reloadNote}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
