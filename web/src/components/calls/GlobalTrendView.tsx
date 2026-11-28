import { memo } from 'preact/compat';
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { GeminiModelGlobalPulse, GeminiPulseSnapshot, Lang } from '../../types/telemetry';
import { fmtClock } from '../../utils/format';
import {
  buildGlobalSeries,
  buildGlobalSummaryCells,
  fmtGlobalAxisTick,
  fmtGlobalShortX,
  fmtGlobalVal,
  GEMINI_FAMILY_COLORS,
  shortGlobalModelName,
  stableGeminiModelColor,
  type GlobalTrendMetric,
} from './trend/globalTrendData';
import { buildMonotonePath, clamp, niceMax } from './trendMath';

export { GEMINI_FAMILY_COLORS, stableGeminiModelColor };
export type { GlobalTrendMetric };

const EMPTY_MODELS: GeminiModelGlobalPulse[] = [];

interface GlobalTrendViewProps {
  geminiPulse?: GeminiPulseSnapshot;
  metric: GlobalTrendMetric;
  onSelectMetric: (m: GlobalTrendMetric) => void;
  lang: Lang;
}

function GlobalTrendViewImpl({
  geminiPulse,
  metric,
  onSelectMetric,
  lang,
}: GlobalTrendViewProps) {
  const isZh = lang === 'zh';
  const models = geminiPulse?.available ? geminiPulse.models : EMPTY_MODELS;
  const [svgW, setBoxWidthEl] = useElementWidth(380);
  const boxElRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useCallback(
    (node: HTMLDivElement | null) => {
      boxElRef.current = node;
      setBoxWidthEl(node);
    },
    [setBoxWidthEl],
  );
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [splitProviders, setSplitProviders] = useState<boolean>(false);
  const [showLocalOverlay, setShowLocalOverlay] = useState<boolean>(true);
  const [matchLocalCtx, setMatchLocalCtx] = useState<boolean>(false);
  const [granularity, setGranularity] = useState<'7d' | '5m'>('7d');
  const [selectedFamilies, setSelectedFamilies] = useState<string[] | null>(null);

  const modelIndexMap = useMemo(
    () => new Map(models.map((m, idx) => [m.family, idx])),
    [models],
  );

  const defaultFamilies = useMemo(() => {
    if (!models.length) return [];
    const active = geminiPulse?.activeFamily || '';
    const out: string[] = [];
    if (active && models.some((m) => m.family === active)) out.push(active);
    for (const m of models) {
      if (out.length >= 3) break;
      if (!out.includes(m.family)) out.push(m.family);
    }
    return out;
  }, [models, geminiPulse?.activeFamily]);

  const activeFamilies = useMemo(() => {
    if (!models.length) return [];
    if (selectedFamilies !== null) {
      const valid = selectedFamilies.filter((f) => models.some((m) => m.family === f));
      if (valid.length > 0) return valid;
    }
    return defaultFamilies;
  }, [models, selectedFamilies, defaultFamilies]);

  const toggleFamily = (fam: string) => {
    setSelectedFamilies((prev) => {
      const cur = prev !== null ? prev : defaultFamilies;
      if (cur.includes(fam)) {
        return cur.length > 1 ? cur.filter((x) => x !== fam) : cur;
      }
      return [...cur, fam];
    });
  };

  const focusSingleModel = (fam: string) => setSelectedFamilies([fam]);

  const singleSelectedModel: GeminiModelGlobalPulse | null =
    activeFamilies.length === 1 ? models.find((m) => m.family === activeFamilies[0]) || null : null;

  const maxIntradayPoints = useMemo(
    () => models.reduce((acc, m) => Math.max(acc, m.series?.intraday30m?.length || 0), 0),
    [models],
  );
  const canUseIntraday = metric !== 'e2e' && maxIntradayPoints >= 2;
  const effectiveIntraday = granularity === '5m' && canUseIntraday;

  const canSplitProviders = useMemo(() => {
    if (!singleSelectedModel?.series) return false;
    if (metric === 'uptime') {
      return singleSelectedModel.series.uptime24h.some((b) => b.rawAvailability !== null);
    }
    if (effectiveIntraday) {
      const provs = new Set<string>();
      for (const pt of singleSelectedModel.series.intraday30m || []) {
        for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
      }
      return provs.size >= 2;
    }
    const arr =
      metric === 'ttft'
        ? singleSelectedModel.series.ttft7d
        : metric === 'e2e'
          ? singleSelectedModel.series.e2e7d || []
          : metric === 'tps'
            ? singleSelectedModel.series.tps7d
            : singleSelectedModel.series.cache7d;
    const provs = new Set<string>();
    for (const pt of arr) {
      for (const k of Object.keys(pt.byProvider || {})) provs.add(k);
    }
    return provs.size >= 2;
  }, [singleSelectedModel, metric, effectiveIntraday]);

  const effectiveSplit = splitProviders && canSplitProviders && singleSelectedModel !== null;

  const hasAnyLocalCurve = useMemo(
    () => metric !== 'uptime' && metric !== 'e2e' && !effectiveIntraday && models.some((m) => (m.local?.calls7d || 0) > 0),
    [metric, effectiveIntraday, models],
  );
  const hasMatchedLocalCtx = useMemo(
    () => hasAnyLocalCurve && models.some((m) => (m.local?.matched100k?.calls || 0) >= 3),
    [hasAnyLocalCurve, models],
  );

  const { xLabels, seriesLines } = useMemo(
    () =>
      buildGlobalSeries({
        models,
        activeFamilies,
        metric,
        effectiveSplit,
        effectiveIntraday,
        singleSelectedModel,
        showLocalOverlay,
        matchLocalCtx,
        activeFamily: geminiPulse?.activeFamily,
        modelIndexMap,
        isZh,
      }),
    [
      models,
      activeFamilies,
      metric,
      effectiveSplit,
      effectiveIntraday,
      singleSelectedModel,
      showLocalOverlay,
      matchLocalCtx,
      geminiPulse?.activeFamily,
      modelIndexMap,
      isZh,
    ],
  );

  const hasTimeSeries = xLabels.length >= 2 && seriesLines.length > 0;
  const isNarrow = svgW < 340;
  const svgH = isNarrow ? 132 : 148;
  const padTop = 14;
  const padBottom = 22;
  const padRight = 14;

  const { yMin, yMax } = useMemo(() => {
    const allVals = seriesLines.flatMap((s) => s.points.map((p) => p.val));
    if (!allVals.length) return { yMin: 0, yMax: 100 };
    const lo = Math.min(...allVals);
    const hi = Math.max(...allVals);
    if (metric === 'uptime') {
      if (lo >= 95) return { yMin: 90, yMax: 100 };
      if (lo >= 80) return { yMin: 70, yMax: 100 };
      return { yMin: Math.max(0, Math.floor((lo - 5) / 10) * 10), yMax: 100 };
    }
    if (metric === 'cache') return { yMin: 0, yMax: 100 };
    return { yMin: 0, yMax: niceMax(hi * 1.12) };
  }, [seriesLines, metric]);

  const yTickVals = [yMax, (yMax + yMin) * 0.5, yMin];
  const yTickLabels = yTickVals.map((v) => fmtGlobalAxisTick(v, metric));
  const maxYChars = yTickLabels.reduce((a, b) => Math.max(a, b.length), 2);
  const padLeft = Math.max(isNarrow ? 30 : 36, Math.ceil(maxYChars * 5.8) + 10);
  const plotW = Math.max(60, svgW - padLeft - padRight);
  const chartH = Math.max(54, svgH - padTop - padBottom);
  const yBase = padTop + chartH;

  const valY = (v: number) => {
    const span = Math.max(0.001, yMax - yMin);
    return padTop + chartH - clamp((v - yMin) / span, 0, 1) * chartH;
  };
  const slotX = (idx: number) =>
    xLabels.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (xLabels.length - 1)) * plotW;

  const summaryCells = useMemo(
    () =>
      buildGlobalSummaryCells({
        seriesLines,
        metric,
        effectiveIntraday,
        xLabelCount: xLabels.length,
        activeFamily: geminiPulse?.activeFamily,
        models,
        singleSelectedModel,
        activeFamilies,
        isZh,
      }),
    [seriesLines, metric, effectiveIntraday, xLabels.length, geminiPulse?.activeFamily, models, singleSelectedModel, activeFamilies, isZh],
  );

  const safeHoverIdx = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < xLabels.length ? hoveredIdx : null;
  const hoverRows = useMemo(() => {
    if (safeHoverIdx === null) return [];
    const rows = seriesLines
      .map((s) => {
        const pt = s.points.find((p) => p.xIdx === safeHoverIdx);
        return pt ? { label: s.label, color: s.color, isLocal: s.isLocal, val: pt.val } : null;
      })
      .filter((r): r is { label: string; color: string; isLocal: boolean | undefined; val: number } => Boolean(r));
    rows.sort((a, b) => (metric === 'ttft' || metric === 'e2e' ? a.val - b.val : b.val - a.val));
    return rows;
  }, [safeHoverIdx, seriesLines, metric]);

  const hoverX = safeHoverIdx !== null ? slotX(safeHoverIdx) : 0;
  const popoverLeftPx = useMemo(() => {
    if (safeHoverIdx === null) return 8;
    const popW = isNarrow ? 182 : 204;
    const raw = hoverX > svgW * 0.54 ? hoverX - popW - 10 : hoverX + 10;
    return clamp(Math.round(raw), 4, Math.max(4, svgW - popW - 4));
  }, [safeHoverIdx, hoverX, svgW, isNarrow]);

  const xTicks = useMemo(() => {
    const n = xLabels.length;
    if (n === 0) return [];
    if (n === 1) return [{ idx: 0, label: fmtGlobalShortX(xLabels[0], metric, isZh, effectiveIntraday), anchor: 'middle' as const }];
    const mid = Math.floor((n - 1) / 2);
    return [
      { idx: 0, label: fmtGlobalShortX(xLabels[0], metric, isZh, effectiveIntraday), anchor: 'start' as const },
      { idx: mid, label: fmtGlobalShortX(xLabels[mid], metric, isZh, effectiveIntraday), anchor: 'middle' as const },
      { idx: n - 1, label: fmtGlobalShortX(xLabels[n - 1], metric, isZh, effectiveIntraday), anchor: 'end' as const },
    ];
  }, [xLabels, metric, isZh, effectiveIntraday]);

  const handlePointerMove = (e: PointerEvent) => {
    if (!boxElRef.current || xLabels.length === 0) return;
    const rect = boxElRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * svgW;
    const frac = clamp((svgX - padLeft) / Math.max(1, plotW), 0, 1);
    setHoveredIdx(Math.round(frac * (xLabels.length - 1)));
  };

  if (!geminiPulse?.enabled) {
    return (
      <div className="l2-well px-3 py-4 text-center font-hud text-[11px] text-hud-muted">
        {isZh ? '大盘已设为离线模式，请在「账号 → GEMINI 全局大盘」开启在线同步。' : 'Global Pulse is offline. Enable it in Account → Gemini Global Pulse.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
        <div className="metric-tabs" role="tablist" aria-label={isZh ? '全局指标' : 'Global metric'}>
          {(['ttft', 'e2e', 'tps', 'cache', 'uptime'] as const).map((gm) => (
            <button
              key={gm}
              type="button"
              role="tab"
              aria-selected={metric === gm}
              className={`metric-tab${metric === gm ? ' is-active' : ''}`}
              onClick={() => {
                onSelectMetric(gm);
                setHoveredIdx(null);
              }}
            >
              {gm === 'ttft'
                ? isZh ? '首字' : 'TTFT'
                : gm === 'e2e'
                  ? isZh ? '总耗' : 'E2E'
                  : gm === 'tps'
                    ? isZh ? '速度' : 'TPS'
                    : gm === 'cache'
                      ? isZh ? '缓存' : 'Cache'
                      : isZh ? '可用率' : 'Uptime'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {canUseIntraday && (
            <button
              type="button"
              onClick={() => {
                setGranularity((g) => (g === '5m' ? '7d' : '5m'));
                setHoveredIdx(null);
              }}
              className={`px-1.5 py-[2px] rounded-full border font-hud-mono text-[9px] cursor-pointer transition-colors ${
                effectiveIntraday
                  ? 'bg-tint-accent border-tint-accent-border text-hud-accent-ink font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? `切换 5 分钟高精度实时折线（已采集 ${maxIntradayPoints} 个 5m 节点，最多 24h）`
                  : `Toggle 5-minute high-res live curves (${maxIntradayPoints} buckets, up to 24h)`
              }
            >
              {effectiveIntraday ? `5m (${maxIntradayPoints})` : '5m'}
            </button>
          )}
          {hasAnyLocalCurve && (
            <button
              type="button"
              onClick={() => setShowLocalOverlay((v) => !v)}
              className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                showLocalOverlay
                  ? 'bg-hud-card border-hud-fg/45 text-hud-fg font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? '在同图叠加/隐藏你本机的 7 天每日实测 + 近 30m 曲线（虚线空心点）'
                  : 'Toggle your local 7d daily + live 30m curve (dashed hollow rings)'
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full border border-hud-fg shrink-0"
                style={{ background: showLocalOverlay ? 'var(--hud-card)' : 'transparent' }}
              />
              <span>{isZh ? '叠加本机' : 'Mine'}</span>
            </button>
          )}
          {showLocalOverlay && hasMatchedLocalCtx && (
            <button
              type="button"
              onClick={() => setMatchLocalCtx((v) => !v)}
              className={`px-1.5 py-[2px] rounded-full border font-hud-mono text-[9px] cursor-pointer transition-colors ${
                matchLocalCtx
                  ? 'bg-tint-think border-seg-think/50 text-seg-think font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? '仅筛选本机 <100k 上下文样本与 OpenRouter 大盘（均值 46k–80k）做同量级公平对比'
                  : 'Filter local curve to <100k prompt context for apples-to-apples comparison vs OpenRouter (avg 46k–80k)'
              }
            >
              {isZh ? '同量级' : '<100k'}
            </button>
          )}
          {singleSelectedModel && canSplitProviders && (
            <button
              type="button"
              onClick={() => setSplitProviders((v) => !v)}
              className={`px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                effectiveSplit
                  ? 'bg-tint-accent border-tint-accent-border text-hud-accent-ink font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
              data-tip={
                isZh
                  ? '将当前单模型拆分为各上游节点（Google Vertex vs AI Studio）折线对比'
                  : 'Split single model into upstream provider curves (Google Vertex vs AI Studio)'
              }
            >
              {isZh ? '节点拆解' : 'By Provider'}
            </button>
          )}
          <span className="font-hud-mono text-[9px] text-hud-muted">
            {effectiveIntraday ? '24h·5m' : metric === 'uptime' ? '24h' : metric === 'e2e' ? '7d' : '7d + 30m'}
          </span>
        </div>
      </div>

      {models.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {models.map((m, mi) => {
            const isSel = activeFamilies.includes(m.family);
            const color = stableGeminiModelColor(m.family, mi);
            return (
              <button
                key={m.family}
                type="button"
                onClick={() => toggleFamily(m.family)}
                onDblClick={() => focusSingleModel(m.family)}
                className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full border font-hud text-[9.5px] cursor-pointer transition-colors ${
                  isSel
                    ? 'bg-hud-card text-hud-fg font-semibold'
                    : 'bg-hud-fill/60 border-transparent text-hud-muted hover:text-hud-fg'
                }`}
                style={isSel ? { borderColor: `color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
                data-tip={
                  isZh
                    ? `单击叠加/取消 ${m.label} 折线；双击独显该模型（可开节点拆解）`
                    : `Click to toggle ${m.label}; double-click to solo (enables provider split)`
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: color, opacity: isSel ? 1 : 0.35 }}
                />
                <span>{shortGlobalModelName(m.label)}</span>
              </button>
            );
          })}
          {models.length > 1 && activeFamilies.length < models.length && (
            <button
              type="button"
              className="px-1.5 py-[1.5px] rounded font-hud text-[9px] text-hud-muted hover:text-hud-fg cursor-pointer"
              onClick={() => setSelectedFamilies(models.map((m) => m.family))}
            >
              {isZh ? '全选' : 'All'}
            </button>
          )}
        </div>
      )}

      {summaryCells.length > 0 && (
        <div className={`grid gap-1.5 ${isNarrow ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {summaryCells.map((c, idx) => (
            <div key={idx} className="trend-stat-cell flex flex-col gap-px min-w-0 px-2 py-[5px] rounded-lg tabular-nums">
              <span className="trend-stat-label font-hud font-semibold text-hud-muted truncate">{c.k}</span>
              <span className={`trend-stat-val font-hud-mono font-bold leading-tight truncate ${c.tone}`}>{c.v}</span>
              <span className="font-hud text-[8.5px] text-hud-muted truncate">{c.sub}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={boxRef} className="relative w-full min-w-0 select-none">
        {!hasTimeSeries ? (
          <div className="l2-well px-3 py-5 text-center font-hud text-[10.5px] text-hud-muted leading-[1.45]">
            {geminiPulse?.loading
              ? isZh ? '正在拉取 OpenRouter 历史折线数据…' : 'Loading OpenRouter historical curves…'
              : isZh
                ? '暂无历史折线缓存（请点击「账号 → GEMINI 全局大盘」右上角刷新，或 Reload 插件以同步最新 7d/24h 曲线）。'
                : 'No historical curves cached yet. Click Refresh in Account → Gemini Global Pulse or reload the plugin.'}
          </div>
        ) : (
          <svg
            className="trend-main-svg block w-full overflow-visible"
            style={{ height: `${svgH}px` }}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoveredIdx(null)}
          >
            {yTickVals.map((tv, gi) => {
              const gy = valY(tv);
              return (
                <g key={`g-grid-${gi}`}>
                  <line
                    x1={padLeft}
                    y1={gy.toFixed(1)}
                    x2={(padLeft + plotW).toFixed(1)}
                    y2={gy.toFixed(1)}
                    stroke="var(--hud-fg)"
                    stroke-width="1"
                    stroke-dasharray={gi === 2 ? undefined : '2 3'}
                    opacity={gi === 2 ? 0.14 : 0.07}
                  />
                  <text
                    x={(padLeft - 6).toFixed(1)}
                    y={(gy + 3).toFixed(1)}
                    text-anchor="end"
                    className="trend-axis-label"
                  >
                    {yTickLabels[gi]}
                  </text>
                </g>
              );
            })}

            {metric !== 'uptime' && xLabels[xLabels.length - 1] === '__live30m__' && xLabels.length >= 2 && (
              <line
                x1={slotX(xLabels.length - 1).toFixed(1)}
                y1={padTop}
                x2={slotX(xLabels.length - 1).toFixed(1)}
                y2={yBase.toFixed(1)}
                stroke="var(--hud-accent)"
                stroke-width="1"
                stroke-dasharray="2 3"
                opacity="0.35"
              />
            )}

            {seriesLines.map((s) => {
              const coords = s.points.map((pt) => ({ x: slotX(pt.xIdx), y: valY(pt.val) }));
              const pathD = coords.length >= 2 ? buildMonotonePath(coords, padTop, yBase) : '';
              return (
                <g key={`gline-${s.id}`}>
                  {pathD && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke={s.color}
                      stroke-width={s.isLocal ? '1.9' : '1.75'}
                      stroke-dasharray={s.isLocal ? '4.5 3' : s.dashed ? '4 2.5' : undefined}
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      opacity={s.isLocal ? '0.92' : '0.9'}
                    />
                  )}
                  {s.points.map((pt, pi) => {
                    const isLast = pi === s.points.length - 1;
                    const isHov = safeHoverIdx === pt.xIdx;
                    if ((metric === 'uptime' || (effectiveIntraday && s.points.length > 24)) && !isLast && !isHov) return null;
                    return (
                      <circle
                        key={`gpt-${s.id}-${pt.xIdx}`}
                        cx={slotX(pt.xIdx).toFixed(1)}
                        cy={valY(pt.val).toFixed(1)}
                        r={isHov ? 4.2 : isLast ? 3.4 : s.isLocal ? 2.6 : 2.1}
                        fill={s.isLocal ? 'var(--hud-card)' : s.color}
                        stroke={s.isLocal ? s.color : 'var(--hud-card)'}
                        stroke-width={s.isLocal ? '1.6' : '1.1'}
                      />
                    );
                  })}
                </g>
              );
            })}

            {xTicks.map((tk, ti) => (
              <text
                key={`gxt-${ti}`}
                x={slotX(tk.idx).toFixed(1)}
                y={(svgH - 4).toFixed(1)}
                text-anchor={tk.anchor}
                className="trend-axis-label"
              >
                {tk.label}
              </text>
            ))}

            {safeHoverIdx !== null && (
              <line
                className="trend-crosshair-line"
                x1={hoverX.toFixed(1)}
                y1={padTop}
                x2={hoverX.toFixed(1)}
                y2={yBase.toFixed(1)}
              />
            )}
          </svg>
        )}

        {hasTimeSeries && safeHoverIdx !== null && hoverRows.length > 0 && (
          <div
            className="trend-popover pointer-events-none absolute top-1 z-20 rounded-lg border px-2 py-1.5 flex flex-col gap-1"
            style={{ left: `${popoverLeftPx}px`, width: `${isNarrow ? 182 : 204}px` }}
          >
            <div className="flex items-center justify-between gap-2 font-hud-mono text-[9.5px] font-semibold text-hud-muted border-b border-hud-hairline pb-0.5">
              <span>{fmtGlobalShortX(xLabels[safeHoverIdx], metric, isZh, effectiveIntraday)}</span>
              <span>
                {effectiveIntraday
                  ? isZh ? '5m 快照' : '5m Bucket'
                  : xLabels[safeHoverIdx] === '__live30m__'
                    ? isZh ? '实时 30m' : 'Live 30m'
                    : metric === 'uptime'
                      ? '24h'
                      : isZh ? '日均 P50' : 'Daily P50'}
              </span>
            </div>
            {hoverRows.map((row, ri) => (
              <div key={row.label} className="flex items-center justify-between gap-2 font-hud-mono text-[10px] tabular-nums">
                <span className="inline-flex items-center gap-1.5 min-w-0 font-hud text-hud-fg/90">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={
                      row.isLocal
                        ? { background: 'var(--hud-card)', border: `1.5px solid ${row.color}` }
                        : { background: row.color }
                    }
                  />
                  <span className={`truncate ${row.isLocal ? 'font-semibold text-hud-fg' : ''}`}>{row.label}</span>
                </span>
                <span className={`font-semibold shrink-0 ${ri === 0 && hoverRows.length > 1 ? 'text-hud-ok' : 'text-hud-fg'}`}>
                  {fmtGlobalVal(row.val, metric)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 font-hud text-[9px] text-hud-muted">
        <span className="truncate">
          {(() => {
            const ctxModel =
              singleSelectedModel ||
              models.find((m) => m.family === geminiPulse?.activeFamily) ||
              models[0];
            const gCtx = ctxModel?.avgPromptTokens ? `${Math.round(ctxModel.avgPromptTokens / 1000)}k` : '';
            const lCtx = ctxModel?.local?.avgCtxTokens ? `${Math.round(ctxModel.local.avgCtxTokens / 1000)}k` : '';
            const ctxNote =
              gCtx && lCtx
                ? isZh
                  ? ` · 均ctx: 大盘 ${gCtx} vs 本机 ${lCtx}`
                  : ` · avg ctx: glb ${gCtx} vs mine ${lCtx}`
                : gCtx
                  ? isZh
                    ? ` · 大盘均ctx ${gCtx}`
                    : ` · glb avg ${gCtx}`
                  : '';
            const base = effectiveSplit
              ? isZh
                ? `${singleSelectedModel?.label} 上游节点${showLocalOverlay && hasAnyLocalCurve ? ' + 本机实测' : ''}折线对比`
                : `${singleSelectedModel?.label} provider${showLocalOverlay && hasAnyLocalCurve ? ' + local' : ''} curves`
              : isZh
                ? '实线：OpenRouter 大盘 · 虚线空心点：本机实测'
                : 'Solid: OpenRouter global · Dashed ring: your local';
            return `${base}${ctxNote}`;
          })()}
        </span>
        {geminiPulse?.fetchedAtMs ? (
          <span className="font-hud-mono shrink-0">{fmtClock(geminiPulse.fetchedAtMs)}</span>
        ) : null}
      </div>
    </div>
  );
}

export const GlobalTrendView = memo(GlobalTrendViewImpl);
