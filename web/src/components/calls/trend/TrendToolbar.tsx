import type { Translations } from '../../../i18n';
import type { TrendTranslations } from '../../../i18n/trend';
import type { ChartMetric, GeminiModelGlobalPulse, Invocation } from '../../../types/telemetry';
import { fmtSec, fmtTps } from '../../../utils/format';
import { IconClock, IconFastForward, IconMinus, IconPlus } from '../../common/Icons';
import { stableGeminiModelColor } from '../GlobalTrendView';
import type { AxisMode, RangePreset } from '../trendMath';
import { shortArenaModelName } from './modelLabels';
import { getPulseMetricVal, type ModelMeta, type StatCellModel } from './trendBuilders';

const METRICS: ChartMetric[] = ['ttft', 'tps', 'out', 'cache', 'ctx', 'quota'];

export interface TrendHeaderProps {
  t: Translations;
  tt: TrendTranslations;
  showGlobalToggle: boolean;
  isGlobalSource: boolean;
  onSwitchChartSource: (next: 'session' | 'global') => void;
  totalInvocations: number;
  metric: ChartMetric;
  onSelectMetric: (m: ChartMetric) => void;
  showModelPills: boolean;
  sessionModels: ModelMeta[];
  activeModel: string;
  onSelectModel: (key: string) => void;
  isNarrow: boolean;
  totalCount: number;
  visiblePresets: ReadonlyArray<Exclude<RangePreset, 'custom'>>;
  followLive: boolean;
  rangePreset: RangePreset;
  onSelectPreset: (p: Exclude<RangePreset, 'custom'>) => void;
  minSpan: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomButton: (direction: 'in' | 'out') => void;
  axisMode: AxisMode;
  onSelectAxisMode: (mode: AxisMode) => void;
}

function metricLabel(m: ChartMetric, t: Translations): string {
  if (m === 'tps') return t.tabTps;
  if (m === 'ttft') return t.tabTtft;
  if (m === 'out') return t.tabOut;
  if (m === 'cache') return t.tabCache;
  if (m === 'quota') return t.tabQuota;
  return t.tabCtx;
}

export function TrendHeader({
  t,
  tt,
  showGlobalToggle,
  isGlobalSource,
  onSwitchChartSource,
  totalInvocations,
  metric,
  onSelectMetric,
  showModelPills,
  sessionModels,
  activeModel,
  onSelectModel,
  isNarrow,
  totalCount,
  visiblePresets,
  followLive,
  rangePreset,
  onSelectPreset,
  minSpan,
  canZoomOut,
  canZoomIn,
  onZoomButton,
  axisMode,
  onSelectAxisMode,
}: TrendHeaderProps) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {/* Row 1: Title + Source Switch (Session vs Global Curves) + Metric Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="card-k">{t.chartTitle}</span>
          {showGlobalToggle ? (
            <div className="metric-tabs" role="tablist" aria-label={tt.sourceAria}>
              <button
                type="button"
                role="tab"
                aria-selected={!isGlobalSource}
                className={`metric-tab${!isGlobalSource ? ' is-active' : ''}`}
                onClick={() => onSwitchChartSource('session')}
              >
                {tt.sourceSession}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isGlobalSource}
                className={`metric-tab${isGlobalSource ? ' is-active' : ''}`}
                onClick={() => onSwitchChartSource('global')}
              >
                {tt.sourceGlobal}
              </button>
            </div>
          ) : null}
          {!isGlobalSource && (
            <span className="trend-count-badge inline-flex items-center px-1.5 py-px rounded-full font-hud-mono tabular-nums font-medium text-hud-muted bg-hud-fill">
              {t.chartMeta(totalInvocations)}
            </span>
          )}
        </div>

        {!isGlobalSource && (
          <div className="metric-tabs" role="tablist" aria-label={t.chartTitle}>
            {METRICS.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={metric === m}
                className={`metric-tab${metric === m ? ' is-active' : ''}`}
                onClick={() => onSelectMetric(m)}
              >
                {metricLabel(m, t)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Row 2: Model Pills + Unified Range / Zoom / Axis Strip (Session mode only) */}
      {!isGlobalSource && (showModelPills || totalCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
          {showModelPills && (
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <button
                type="button"
                className={`trend-model-pill${activeModel === 'all' ? ' is-active' : ''}`}
                onClick={() => onSelectModel('all')}
              >
                {t.chartAllModels(totalInvocations)}
              </button>
              {sessionModels.map((m) => {
                const active = activeModel === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`trend-model-pill${active ? ' is-active' : ''}`}
                    data-tip={t.chartModelFilterTip(m.label, m.count, m.avgBadge, active)}
                    onClick={() => onSelectModel(active ? 'all' : m.key)}
                  >
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                      style={{ backgroundColor: m.color }}
                    />
                    <span>{m.label}</span>
                    {!isNarrow && m.avgBadge && (
                      <span className="font-hud-mono text-hud-muted">{m.avgBadge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {totalCount > 0 && (
            <div className="inline-flex flex-wrap items-center gap-1 ml-auto min-w-0">
              <div
                className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track"
                role="group"
              >
                {visiblePresets.map((p) => {
                  const isAll = p === 'all';
                  const num = isAll ? 0 : Number(p);
                  const available = isAll || totalCount > num;
                  const active = followLive && rangePreset === p;
                  const label = isAll ? tt.rangeAll : p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!available}
                      className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg font-hud-mono tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors${active ? ' is-active' : ''}`}
                      title={isAll ? tt.rangeAll : tt.rangePresetTip(p, available)}
                      onClick={() => onSelectPreset(p)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {totalCount > minSpan && (
                <div
                  className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track"
                  role="group"
                >
                  <button
                    type="button"
                    className="trend-seg-btn trend-icon-btn w-[20px] h-[18px] inline-flex items-center justify-center border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg rounded cursor-pointer transition-colors"
                    disabled={!canZoomOut}
                    title={tt.zoomOutTip}
                    aria-label={tt.zoomOutTip}
                    onClick={() => onZoomButton('out')}
                  >
                    <IconMinus size={10} />
                  </button>
                  <button
                    type="button"
                    className="trend-seg-btn trend-icon-btn w-[20px] h-[18px] inline-flex items-center justify-center border-0 bg-transparent text-hud-muted hover:enabled:text-hud-fg rounded cursor-pointer transition-colors"
                    disabled={!canZoomIn}
                    title={tt.zoomInTip}
                    aria-label={tt.zoomInTip}
                    onClick={() => onZoomButton('in')}
                  >
                    <IconPlus size={10} />
                  </button>
                </div>
              )}

              <div
                className="trend-seg-group inline-flex items-center p-[1.5px] gap-px rounded-md bg-hud-tab-track"
                role="group"
              >
                <button
                  type="button"
                  className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:text-hud-fg font-hud-mono tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors${axisMode === 'seq' ? ' is-active' : ''}`}
                  title={tt.axisSeqTip}
                  onClick={() => onSelectAxisMode('seq')}
                >
                  {isNarrow ? tt.axisSeqShort : tt.axisSeq}
                </button>
                <button
                  type="button"
                  className={`trend-seg-btn border-0 bg-transparent text-hud-muted hover:text-hud-fg font-hud tabular-nums font-semibold leading-tight px-[5px] py-0.5 rounded cursor-pointer whitespace-nowrap inline-flex items-center justify-center transition-colors${axisMode === 'time' ? ' is-active' : ''}`}
                  title={tt.axisTimeTip}
                  onClick={() => onSelectAxisMode('time')}
                >
                  {isNarrow ? <IconClock size={10} /> : tt.axisTime}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TrendSessionStrips({
  tt,
  isZoomedOrHistorical,
  visible,
  totalCount,
  visibleSpan,
  onFollowLive,
  statCells,
  isNarrow,
  pulseModels,
  metric,
  activeArenaFamilies,
  onToggleArenaFamily,
  onClearArenaFamilies,
}: {
  tt: TrendTranslations;
  isZoomedOrHistorical: boolean;
  visible: Invocation[];
  totalCount: number;
  visibleSpan: number;
  onFollowLive: () => void;
  statCells: StatCellModel[];
  isNarrow: boolean;
  pulseModels: GeminiModelGlobalPulse[];
  metric: ChartMetric;
  activeArenaFamilies: string[];
  onToggleArenaFamily: (family: string) => void;
  onClearArenaFamilies: () => void;
}) {
  const statToneClass = (tone?: 'ok' | 'warn' | 'bad'): string => {
    if (tone === 'ok') return 'text-hud-ok';
    if (tone === 'warn') return 'text-hud-warn';
    if (tone === 'bad') return 'text-hud-bad';
    return 'text-hud-fg';
  };

  return (
    <>
      {isZoomedOrHistorical && (
        <div className="trend-live-banner flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 py-1 rounded-md border font-hud-mono tabular-nums text-hud-fg">
          <span className="inline-flex items-center gap-1.5 min-w-0 text-hud-fg-2">
            <span className="w-1.5 h-1.5 rounded-full bg-hud-warn shrink-0" />
            <span>
              {tt.viewingRange(
                visible[0].idx + 1,
                visible[visible.length - 1].idx + 1,
                totalCount,
                visibleSpan < totalCount,
              )}
            </span>
          </span>
          <button
            type="button"
            className="trend-follow-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] border font-hud font-semibold text-hud-accent-ink cursor-pointer whitespace-nowrap transition-colors"
            title={tt.followLiveTip}
            onClick={onFollowLive}
          >
            <span>{tt.followLiveBtn}</span>
            <IconFastForward size={10} />
          </button>
        </div>
      )}

      {statCells.length > 0 && (
        <div className={`grid gap-1.5 ${isNarrow ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {statCells.map((cell, ci) => (
            <div
              key={ci}
              className="trend-stat-cell flex flex-col gap-px min-w-0 px-2 py-[5px] rounded-lg tabular-nums"
            >
              <div className="trend-stat-label flex items-center justify-between gap-1 font-hud font-semibold tracking-[0.04em] text-hud-muted whitespace-nowrap overflow-hidden text-ellipsis">
                <span>{cell.label}</span>
                {cell.badge && (
                  <span className="trend-stat-buf-tag inline-flex items-center px-1 rounded-[3px] font-hud-mono font-bold text-hud-muted bg-hud-card">
                    {cell.badge}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 min-w-0 flex-wrap">
                <span className={`trend-stat-val font-hud-mono font-bold leading-tight whitespace-nowrap ${statToneClass(cell.tone)}`}>
                  {cell.value}
                </span>
                {cell.deltaText && (
                  <span className={`trend-stat-delta inline-flex items-center px-1 rounded font-hud-mono font-bold leading-[1.35] whitespace-nowrap is-${cell.deltaTone || 'neutral'}`}>
                    {cell.deltaText}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pulseModels.length > 0 && (metric === 'ttft' || metric === 'tps' || metric === 'cache') && (
        <div className="flex flex-wrap items-center gap-1 min-w-0 px-0.5">
          <span className="font-hud text-[9px] font-semibold uppercase tracking-[0.03em] text-hud-muted mr-0.5 whitespace-nowrap">
            {tt.globalRefLabel}
          </span>
          {pulseModels.map((m, mi) => {
            const val = getPulseMetricVal(m, metric);
            if (val === null) return null;
            const isSelected = activeArenaFamilies.includes(m.family);
            const lineColor = stableGeminiModelColor(m.family, mi);
            const valStr = metric === 'ttft' ? fmtSec(val) : metric === 'tps' ? fmtTps(val) : `${Math.round(val)}%`;
            return (
              <button
                key={m.family}
                type="button"
                onClick={() => onToggleArenaFamily(m.family)}
                className={`inline-flex items-center gap-1 px-1.5 py-[1.5px] rounded-full border font-hud-mono text-[9px] tabular-nums cursor-pointer transition-colors ${
                  isSelected
                    ? 'text-hud-fg bg-hud-card font-semibold'
                    : 'text-hud-muted bg-hud-fill/60 border-transparent hover:text-hud-fg hover:bg-hud-fill'
                }`}
                style={isSelected ? { borderColor: `color-mix(in srgb, ${lineColor} 58%, transparent)` } : undefined}
                data-tip={tt.globalRefTip(m.label)}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: lineColor, opacity: isSelected ? 1 : 0.35 }}
                />
                <span>{shortArenaModelName(m.label)}</span>
                <span className="opacity-75">{valStr}</span>
              </button>
            );
          })}
          {activeArenaFamilies.length > 0 && (
            <button
              type="button"
              onClick={onClearArenaFamilies}
              className="px-1 py-[1px] rounded font-hud text-[9px] text-hud-muted hover:text-hud-fg cursor-pointer transition-colors"
              title={tt.globalRefHide}
              aria-label={tt.globalRefHide}
            >
              ×
            </button>
          )}
        </div>
      )}
    </>
  );
}
