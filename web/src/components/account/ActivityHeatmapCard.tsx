import { useMemo } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { AccountHistory, DailyHeatmapDay } from '../../types/telemetry';
import { fmtNum, fmtUsd } from '../../utils/format';

interface ActivityHeatmapCardProps {
  history: AccountHistory | undefined;
  t: Translations;
}

export function ActivityHeatmapCard({ history, t }: ActivityHeatmapCardProps) {
  const hm = history?.dailyHeatmap;

  const gridData = useMemo(() => {
    if (!hm || !Array.isArray(hm.days) || hm.days.length === 0) return null;
    const weeks = hm.weeks || Math.ceil(hm.days.length / 7);
    const cols: Array<Array<DailyHeatmapDay | null>> = [];
    for (let c = 0; c < weeks; c++) {
      const col: Array<DailyHeatmapDay | null> = [];
      for (let r = 0; r < 7; r++) {
        const idx = c * 7 + r;
        col.push(idx < hm.days.length ? hm.days[idx] : null);
      }
      cols.push(col);
    }

    const activeCosts = hm.days
      .map((d) => d.costUSD || 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const refMax = activeCosts.length
      ? Math.max(0.05, activeCosts[Math.min(activeCosts.length - 1, Math.floor(activeCosts.length * 0.88))])
      : 1;

    const monthMarks: Array<{ col: number; label: string }> = [];
    let lastMo = -1;
    for (let c = 0; c < cols.length; c++) {
      const firstDay = cols[c].find((d) => d !== null);
      if (!firstDay) continue;
      const mo = Number(firstDay.date.slice(5, 7)) - 1;
      if (mo !== lastMo) {
        if (monthMarks.length > 0 && c - monthMarks[monthMarks.length - 1].col < 2) {
          monthMarks[monthMarks.length - 1] = { col: c, label: t.heatmapMonths[mo] || '' };
        } else if (c <= cols.length - 2) {
          monthMarks.push({ col: c, label: t.heatmapMonths[mo] || '' });
        }
        lastMo = mo;
      }
    }

    return { weeks, cols, refMax, monthMarks };
  }, [hm, t.heatmapMonths]);

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

  const peakStr = hm.peakCostUSD > 0 ? fmtUsd(hm.peakCostUSD) : '';
  const summaryStr = t.heatmapSummary(hm.activeDays || 0, hm.streakDays || 0, peakStr);

  return (
    <section className="hud-card">
      <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="card-k">{t.heatmapTitle}</span>
        <span className="card-sub !mt-0 text-[10px]">{summaryStr}</span>
      </div>

      <div className="mt-2 flex flex-col gap-1 min-w-0 select-none">
        {/* Month headers */}
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-1 items-end">
          <span />
          <div
            className="grid gap-[3px] min-w-0 font-hud-mono text-[9px] text-hud-muted leading-none h-[11px] relative"
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

        {/* 7-row x 16-week square matrix */}
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-1 items-stretch min-w-0">
          <div className="grid grid-rows-7 gap-[3px] font-hud-mono text-[9px] text-hud-muted leading-none">
            <span className="flex items-center">{t.heatmapWeekdays[0]}</span>
            <span />
            <span className="flex items-center">{t.heatmapWeekdays[1]}</span>
            <span />
            <span className="flex items-center">{t.heatmapWeekdays[2]}</span>
            <span />
            <span />
          </div>

          <div
            className="grid gap-[3px] min-w-0"
            style={{ gridTemplateColumns: `repeat(${gridData.weeks}, minmax(0, 1fr))` }}
          >
            {gridData.cols.map((col, cIdx) => (
              <div key={`wk-${cIdx}`} className="grid grid-rows-7 gap-[3px] min-w-0">
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
                      className={`heatmap-cell lvl-${lvl} cursor-help`}
                      data-tip={tip}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-0.5 flex items-center justify-end gap-1 font-hud-mono text-[9px] text-hud-muted">
          <span>{t.heatmapLess}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className={`heatmap-cell lvl-${lvl} !w-[9px] !h-[9px] inline-block pointer-events-none`} />
          ))}
          <span>{t.heatmapMore}</span>
        </div>
      </div>
    </section>
  );
}
