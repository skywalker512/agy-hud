import { useMemo, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { AccountHistory, DailyHeatmapDay } from '../../types/telemetry';
import { computeActivityInsights } from '../../utils/activityStats';
import { fmtNum, fmtUsd } from '../../utils/format';
import { IconFlame, IconShare } from '../common/Icons';
import { ActivityShareModal } from './ActivityShareModal';

interface ActivityHeatmapCardProps {
  history: AccountHistory | undefined;
  tierLabel?: string;
  t: Translations;
}

export function ActivityHeatmapCard({ history, tierLabel, t }: ActivityHeatmapCardProps) {
  const [spanMode, setSpanMode] = useState<'16w' | '52w'>('16w');
  const [chartMode, setChartMode] = useState<'heatmap' | 'iceberg'>('heatmap');
  const [shareOpen, setShareOpen] = useState(false);

  const hm = history?.dailyHeatmap;
  const isZh = t.heatmapTitle === '活跃趋势';
  const has52w = Boolean(hm?.days52 && hm.days52.length > (hm.days?.length || 0));
  const activeSpan = has52w ? spanMode : '16w';

  const activeDaysList = useMemo<DailyHeatmapDay[]>(() => {
    if (!hm) return [];
    if (activeSpan === '52w' && hm.days52 && hm.days52.length > 0) {
      return hm.days52;
    }
    return hm.days || [];
  }, [hm, activeSpan]);

  const hasIcebergData = useMemo(
    () => activeDaysList.some((d) => (d.newTokens || 0) > 0 || (d.cachedTokens || 0) > 0),
    [activeDaysList],
  );
  const effectiveChartMode = hasIcebergData ? chartMode : 'heatmap';

  const gridData = useMemo(() => {
    if (!hm || activeDaysList.length === 0) return null;
    const weeks =
      activeSpan === '52w'
        ? hm.weeks52 || Math.ceil(activeDaysList.length / 7)
        : hm.weeks || Math.ceil(activeDaysList.length / 7);
    const cols: Array<Array<DailyHeatmapDay | null>> = [];
    for (let c = 0; c < weeks; c++) {
      const col: Array<DailyHeatmapDay | null> = [];
      for (let r = 0; r < 7; r++) {
        const idx = c * 7 + r;
        col.push(idx < activeDaysList.length ? activeDaysList[idx] : null);
      }
      cols.push(col);
    }

    const activeCosts = activeDaysList
      .map((d) => d.costUSD || 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const refMax = activeCosts.length
      ? Math.max(0.05, activeCosts[Math.min(activeCosts.length - 1, Math.floor(activeCosts.length * 0.88))])
      : 1;

    const minColGap = activeSpan === '52w' ? 4 : 2;
    const monthMarks: Array<{ col: number; label: string }> = [];
    let lastMo = -1;
    for (let c = 0; c < cols.length; c++) {
      const firstDay = cols[c].find((d) => d !== null);
      if (!firstDay) continue;
      const mo = Number(firstDay.date.slice(5, 7)) - 1;
      if (mo !== lastMo) {
        if (monthMarks.length > 0 && c - monthMarks[monthMarks.length - 1].col < minColGap) {
          monthMarks[monthMarks.length - 1] = { col: c, label: t.heatmapMonths[mo] || '' };
        } else if (c <= cols.length - 2) {
          monthMarks.push({ col: c, label: t.heatmapMonths[mo] || '' });
        }
        lastMo = mo;
      }
    }

    return { weeks, cols, refMax, monthMarks };
  }, [hm, activeDaysList, activeSpan, t.heatmapMonths]);

  // Iceberg chart data (New Tokens above zero-line vs Cached Read below zero-line)
  const icebergData = useMemo(() => {
    if (!hasIcebergData || activeDaysList.length === 0) return null;
    // Show recent 42 days on 16w mode (or weekly buckets on 52w mode) for crisp bar readability
    if (activeSpan === '52w') {
      const weeks = Math.ceil(activeDaysList.length / 7);
      const buckets: Array<{
        key: string;
        label: string;
        newTok: number;
        cachedTok: number;
        calls: number;
        costUSD: number;
      }> = [];
      for (let w = 0; w < weeks; w++) {
        const slice = activeDaysList.slice(w * 7, w * 7 + 7);
        if (!slice.length) continue;
        let newTok = 0;
        let cachedTok = 0;
        let calls = 0;
        let costUSD = 0;
        for (const d of slice) {
          newTok += d.newTokens || 0;
          cachedTok += d.cachedTokens || 0;
          calls += d.calls || 0;
          costUSD += d.costUSD || 0;
        }
        const firstDate = slice[0].date;
        const lastDate = slice[slice.length - 1].date;
        buckets.push({
          key: firstDate,
          label: firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`,
          newTok,
          cachedTok,
          calls,
          costUSD,
        });
      }
      const maxNew = Math.max(1, ...buckets.map((b) => b.newTok));
      const maxCached = Math.max(1, ...buckets.map((b) => b.cachedTok));
      const sumNew = buckets.reduce((a, b) => a + b.newTok, 0);
      const sumCached = buckets.reduce((a, b) => a + b.cachedTok, 0);
      return { bars: buckets, maxNew, maxCached, sumNew, sumCached };
    }

    // 16w view: show last 56 days as individual daily bars (cleanly readable at ~360px width)
    const slice = activeDaysList.slice(-56);
    const bars = slice.map((d) => ({
      key: d.date,
      label: d.date,
      newTok: d.newTokens || 0,
      cachedTok: d.cachedTokens || 0,
      calls: d.calls || 0,
      costUSD: d.costUSD || 0,
    }));
    const maxNew = Math.max(1, ...bars.map((b) => b.newTok));
    const maxCached = Math.max(1, ...bars.map((b) => b.cachedTok));
    const sumNew = bars.reduce((a, b) => a + b.newTok, 0);
    const sumCached = bars.reduce((a, b) => a + b.cachedTok, 0);
    return { bars, maxNew, maxCached, sumNew, sumCached };
  }, [hasIcebergData, activeDaysList, activeSpan]);

  const insights = useMemo(
    () => computeActivityInsights(activeDaysList, history, hm?.streakDays),
    [activeDaysList, history, hm?.streakDays],
  );

  if (!hm || !gridData) {
    return null;
  }

  const getLevel = (d: DailyHeatmapDay): number => {
    if ((d.costUSD || 0) <= 0) {
      return (d.calls || 0) > 0 ? 1 : 0;
    }
    const r = d.costUSD / gridData.refMax;
    if (r <= 0.22) return 1;
    if (r <= 0.48) return 2;
    if (r <= 0.78) return 3;
    return 4;
  };

  const cellGapCls = activeSpan === '52w' ? 'gap-[1.5px]' : 'gap-[3px]';
  const personaTitle = `${insights.persona.emoji} ${isZh ? insights.persona.titleZh : insights.persona.titleEn}`;
  const personaTagline = isZh ? insights.persona.taglineZh : insights.persona.taglineEn;
  const personaBadgeCls =
    insights.persona.tier === 'mythic'
      ? 'text-hud-warn bg-tint-warn border-tint-warn-border'
      : insights.persona.tier === 'gold'
        ? 'text-hud-warn bg-tint-warn border-tint-warn-border'
        : insights.persona.tier === 'emerald'
          ? 'text-hud-ok bg-tint-ok border-tint-ok-border'
          : 'text-hud-accent-ink bg-tint-accent border-tint-accent-border';

  return (
    <section className="hud-card flex flex-col gap-2">
      <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="card-k">{t.heatmapTitle}</span>
          <span
            className={`inline-flex items-center px-1.5 py-[1px] rounded-full border font-hud text-[9.5px] font-semibold whitespace-nowrap cursor-help ${personaBadgeCls}`}
            data-tip={personaTagline}
          >
            {personaTitle}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasIcebergData && (
            <div className="metric-tabs" role="group" aria-label="Activity view">
              <button
                type="button"
                className={`metric-tab${effectiveChartMode === 'heatmap' ? ' is-active' : ''}`}
                onClick={() => setChartMode('heatmap')}
              >
                {t.activityViewHeatmap}
              </button>
              <button
                type="button"
                className={`metric-tab${effectiveChartMode === 'iceberg' ? ' is-active' : ''}`}
                onClick={() => setChartMode('iceberg')}
              >
                {t.activityViewIceberg}
              </button>
            </div>
          )}

          {has52w && (
            <div className="metric-tabs" role="group" aria-label="Activity span">
              <button
                type="button"
                className={`metric-tab font-hud-mono${activeSpan === '16w' ? ' is-active' : ''}`}
                onClick={() => setSpanMode('16w')}
              >
                16w
              </button>
              <button
                type="button"
                className={`metric-tab font-hud-mono${activeSpan === '52w' ? ' is-active' : ''}`}
                onClick={() => setSpanMode('52w')}
              >
                52w
              </button>
            </div>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1 px-1.5 py-[2.5px] rounded-md bg-tint-accent border border-tint-accent-border font-hud text-[9.5px] font-semibold text-hud-accent-ink hover:opacity-90 cursor-pointer transition-opacity whitespace-nowrap"
            data-tip={isZh ? '生成 2x 高清社交分享战报海报（PNG / 文案）' : 'Generate 2x PNG Wrapped share poster'}
            onClick={() => setShareOpen(true)}
          >
            <IconShare size={10} />
            <span>{isZh ? '战报' : 'Share'}</span>
          </button>
        </div>
      </div>

      {/* Viral Highlight Ribbon: Streak / Peak Day / Cache Iceberg / Total Tokens */}
      <div className="grid grid-cols-4 gap-1.5 min-w-0">
        <div
          className="l2-well px-2 py-1.5 flex flex-col gap-0.5 min-w-0 cursor-help"
          data-tip={
            isZh
              ? `当前连续活跃 ${insights.currentStreak} 天 · 区间最长连肝 ${insights.longestStreak} 天 · 共活跃 ${insights.activeDays}/${insights.spanDays} 天 (${insights.activeRatePct}%)`
              : `Current streak ${insights.currentStreak}d · Best ${insights.longestStreak}d · Active ${insights.activeDays}/${insights.spanDays}d (${insights.activeRatePct}%)`
          }
        >
          <span className="inline-flex items-center gap-0.5 font-hud text-[8.5px] font-semibold text-hud-muted truncate">
            <IconFlame size={9} className="text-hud-warn" />
            <span>{isZh ? '连肝' : 'Streak'}</span>
          </span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-fg tabular-nums truncate">
            {insights.currentStreak}{isZh ? '天' : 'd'}
          </span>
          <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
            {isZh ? `最${insights.longestStreak}天 · 活${insights.activeDays}天` : `best ${insights.longestStreak}d · ${insights.activeDays}d`}
          </span>
        </div>

        <div
          className="l2-well px-2 py-1.5 flex flex-col gap-0.5 min-w-0 cursor-help"
          data-tip={
            insights.peakDate
              ? isZh
                ? `巅峰单日 ${insights.peakDate}：等效 ${fmtUsd(insights.peakCostUSD)} · ${insights.peakCalls} 次调用 · ${fmtNum(insights.peakTokens)} tokens`
                : `Peak day ${insights.peakDate}: ${fmtUsd(insights.peakCostUSD)} · ${insights.peakCalls} calls · ${fmtNum(insights.peakTokens)} tokens`
              : ''
          }
        >
          <span className="font-hud text-[8.5px] font-semibold text-hud-muted truncate">
            {isZh ? '巅峰单日' : 'Peak Day'}
          </span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-fg tabular-nums truncate">
            {insights.peakCostUSD > 0 ? fmtUsd(insights.peakCostUSD) : '--'}
          </span>
          <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
            {insights.peakDate ? insights.peakDate.slice(5) : '--'}
          </span>
        </div>

        <div
          className="l2-well px-2 py-1.5 flex flex-col gap-0.5 min-w-0 cursor-help"
          data-tip={
            isZh
              ? `缓存读取 ${fmtNum(insights.totalCachedTokens)} / 新增 ${fmtNum(insights.totalNewTokens)} · 预估省下 ${fmtUsd(insights.totalSavedUSD)}`
              : `Cached ${fmtNum(insights.totalCachedTokens)} / New ${fmtNum(insights.totalNewTokens)} · Est. saved ${fmtUsd(insights.totalSavedUSD)}`
          }
        >
          <span className="font-hud text-[8.5px] font-semibold text-hud-muted truncate">
            {isZh ? '缓存率' : 'Cache'}
          </span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-ok tabular-nums truncate">
            {insights.cacheHitPct !== null ? `${Math.round(insights.cacheHitPct)}%` : '--'}
          </span>
          <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
            {insights.totalSavedUSD > 0 ? (isZh ? `省 ${fmtUsd(insights.totalSavedUSD)}` : `-${fmtUsd(insights.totalSavedUSD)}`) : '--'}
          </span>
        </div>

        <div
          className="l2-well px-2 py-1.5 flex flex-col gap-0.5 min-w-0 cursor-help"
          data-tip={
            isZh
              ? `区间累计吞吐 ${fmtNum(insights.totalAllTokens)} tok · ${fmtNum(insights.totalCalls)} 次调用（Desktop ${100 - insights.cliSharePct}% / CLI ${insights.cliSharePct}%）`
              : `Total ${fmtNum(insights.totalAllTokens)} tok · ${fmtNum(insights.totalCalls)} calls (Desktop ${100 - insights.cliSharePct}% / CLI ${insights.cliSharePct}%)`
          }
        >
          <span className="font-hud text-[8.5px] font-semibold text-hud-muted truncate">
            {isZh ? '总吞吐' : 'Tokens'}
          </span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-fg tabular-nums truncate">
            {fmtNum(insights.totalAllTokens)}
          </span>
          <span className="font-hud-mono text-[8.5px] text-hud-muted tabular-nums truncate">
            {fmtNum(insights.totalCalls)}{isZh ? '次' : ' calls'}
          </span>
        </div>
      </div>

      {effectiveChartMode === 'iceberg' && icebergData ? (
        <div className="flex flex-col gap-1.5 min-w-0 select-none">
          <div className="flex items-center justify-between gap-2 font-hud text-[9.5px] text-hud-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-[2px] bg-hud-fg opacity-80" />
              <span>{t.icebergNewLabel}</span>
              <span className="font-hud-mono font-semibold text-hud-fg tabular-nums">
                {fmtNum(icebergData.sumNew)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-[2px] bg-hud-fg opacity-25" />
              <span>{t.icebergCachedLabel}</span>
              <span className="font-hud-mono font-semibold text-hud-fg-2 tabular-nums">
                {fmtNum(icebergData.sumCached)}
              </span>
            </span>
          </div>

          <div className="l2-well px-2 py-2">
            <div className="relative h-[86px] flex flex-col justify-between">
              {/* Zero-line baseline */}
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 h-px"
                style={{ background: 'var(--hud-hairline)' }}
              />

              {/* Bars */}
              <div
                className="relative z-10 grid h-full items-stretch gap-[2px]"
                style={{ gridTemplateColumns: `repeat(${icebergData.bars.length}, minmax(0, 1fr))` }}
              >
                {icebergData.bars.map((b) => {
                  const newH = b.newTok > 0 ? Math.max(4, Math.round((b.newTok / icebergData.maxNew) * 100)) : 0;
                  const cachedH =
                    b.cachedTok > 0 ? Math.max(4, Math.round((b.cachedTok / icebergData.maxCached) * 100)) : 0;
                  const totalPrompt = b.newTok + b.cachedTok;
                  const cachePct = totalPrompt > 0 ? `${Math.round((b.cachedTok / totalPrompt) * 100)}%` : '--';
                  const tip =
                    b.calls > 0 || totalPrompt > 0
                      ? t.icebergBarTip(b.label, fmtNum(b.newTok), fmtNum(b.cachedTok), cachePct, b.calls, fmtUsd(b.costUSD))
                      : t.heatmapEmptyTip(b.label);

                  return (
                    <div
                      key={b.key}
                      className="flex flex-col h-full cursor-help group"
                      data-tip={tip}
                    >
                      {/* Upper half: New Tokens rising up */}
                      <div className="flex-1 flex items-end justify-center pb-[1px]">
                        {newH > 0 && (
                          <div
                            className="w-full rounded-t-[2px] bg-hud-fg opacity-75 group-hover:opacity-100 transition-opacity"
                            style={{ height: `${newH}%` }}
                          />
                        )}
                      </div>
                      {/* Lower half: Cached Read hanging down */}
                      <div className="flex-1 flex items-start justify-center pt-[1px]">
                        {cachedH > 0 && (
                          <div
                            className="w-full rounded-b-[2px] bg-hud-fg opacity-22 group-hover:opacity-45 transition-opacity"
                            style={{ height: `${cachedH}%` }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between font-hud-mono text-[9px] text-hud-muted tabular-nums">
            <span>{icebergData.bars[0]?.key}</span>
            <span>{t.icebergHint}</span>
            <span>{icebergData.bars[icebergData.bars.length - 1]?.key}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 min-w-0 select-none">
          {/* Month headers */}
          <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-1 items-end">
            <span />
            <div
              className={`grid ${cellGapCls} min-w-0 font-hud-mono text-[9px] text-hud-muted leading-none h-[11px] relative`}
              style={{ gridTemplateColumns: `repeat(${gridData.weeks}, minmax(0, 1fr))` }}
            >
              {gridData.monthMarks.map((m) => (
                <span
                  key={`mo-${m.col}`}
                  className="whitespace-nowrap overflow-visible"
                  style={{ gridColumn: `${m.col + 1} / span 1` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {/* 7-row x N-week borderless square matrix */}
          <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-1 items-stretch min-w-0">
            <div className={`grid grid-rows-7 ${cellGapCls} font-hud-mono text-[9px] text-hud-muted leading-none`}>
              <span className="flex items-center">{t.heatmapWeekdays[0]}</span>
              <span />
              <span className="flex items-center">{t.heatmapWeekdays[1]}</span>
              <span />
              <span className="flex items-center">{t.heatmapWeekdays[2]}</span>
              <span />
              <span />
            </div>

            <div
              className={`grid ${cellGapCls} min-w-0`}
              style={{ gridTemplateColumns: `repeat(${gridData.weeks}, minmax(0, 1fr))` }}
            >
              {gridData.cols.map((col, cIdx) => (
                <div key={`wk-${cIdx}`} className={`grid grid-rows-7 ${cellGapCls} min-w-0`}>
                  {col.map((day, rIdx) => {
                    if (!day) {
                      return <div key={`empty-${rIdx}`} className="aspect-square w-full opacity-0 pointer-events-none" />;
                    }
                    const lvl = getLevel(day);
                    const tip =
                      day.calls > 0 || day.costUSD > 0
                        ? t.heatmapDayTip(
                            day.date,
                            fmtUsd(day.costUSD),
                            day.calls,
                            day.appCalls || 0,
                            day.cliCalls || 0,
                            fmtNum(day.outputTokens || 0),
                          )
                        : t.heatmapEmptyTip(day.date);

                    return (
                      <div
                        key={day.date}
                        className={`heatmap-cell lvl-${lvl} cursor-help${activeSpan === '52w' ? ' !rounded-[1.5px]' : ''}`}
                        data-tip={tip}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-0.5 flex items-center justify-end gap-1 font-hud text-[9px] text-hud-muted">
            <span>{t.heatmapLess}</span>
            {[0, 1, 2, 3, 4].map((lvl) => (
              <span key={lvl} className={`heatmap-cell lvl-${lvl} !w-[9px] !h-[9px] inline-block pointer-events-none`} />
            ))}
            <span>{t.heatmapMore}</span>
          </div>
        </div>
      )}
      <ActivityShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        history={history}
        initialSpan={activeSpan}
        initialChartMode={effectiveChartMode}
        has52w={has52w}
        hasIceberg={hasIcebergData}
        isZh={isZh}
        tierLabel={tierLabel}
      />
    </section>
  );
}
