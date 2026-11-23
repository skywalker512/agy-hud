import type { Translations } from '../../i18n';
import type { TelemetrySummary } from '../../types/telemetry';
import { fmtCachePct, fmtNum, fmtSec, fmtTps } from '../../utils/format';

interface KpiGridProps {
  found: boolean;
  hasLatest: boolean;
  summary: TelemetrySummary | undefined;
  t: Translations;
}

export function KpiGrid({ found, hasLatest, summary, t }: KpiGridProps) {
  const active = Boolean(found && hasLatest && summary);
  const avgGenNum = active ? fmtTps(summary?.avgGenTps) : '--';
  const avgE2eNum = active ? fmtTps(summary?.avgE2eTps) : '--';
  const peakNum = active ? fmtTps(summary?.peakGenTps) : '--';
  const avgCache = active ? fmtCachePct(summary?.avgCacheHitPct) : '--';
  const avgTtft = active ? fmtSec(summary?.avgTtftSec) : '--';
  const totalOutNum = active ? fmtNum(summary?.totalOutput) : '--';
  const modelTime = active ? fmtSec(summary?.totalModelSec) : '--';
  const toolTime = active ? fmtSec(summary?.totalToolSec) : '--';

  return (
    <section className="kpi-strip">
      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiAvgGenTip(avgGenNum, avgE2eNum)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.avgGen}</div>
        <div className="mt-0.5 flex items-baseline gap-1 font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums min-w-0">
          <span className="truncate">{avgGenNum}</span>
          {active && <span className="hud-unit text-[9.5px] shrink-0">tok/s</span>}
        </div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span className="font-hud">E2E </span>
          <span className="text-hud-fg-2 font-semibold">{avgE2eNum}</span>
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiPeakCacheTip(peakNum, avgCache)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.peakTps}</div>
        <div className="mt-0.5 flex items-baseline gap-1 font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums min-w-0">
          <span className="truncate">{peakNum}</span>
          {active && <span className="hud-unit text-[9.5px] shrink-0">tok/s</span>}
        </div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span className="font-hud">{t.avgCache}</span>
          <span className="text-hud-fg-2 font-semibold">{avgCache}</span>
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiTtftOutTip(avgTtft, active ? (summary?.totalOutput || 0).toLocaleString() : '--')}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.avgTtft}</div>
        <div className="mt-0.5 font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums truncate">
          {avgTtft}
        </div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span className="font-hud">{t.totOut}</span>
          <span className="text-hud-fg-2 font-semibold">{totalOutNum}</span>
          {active && <span className="hud-unit text-[9px] ml-0.5">tok</span>}
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiTimeTip(modelTime, toolTime, summary?.toolStepCount || 0)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.modelTime}</div>
        <div className="mt-0.5 font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums truncate">
          {modelTime}
        </div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span className="font-hud">{t.toolTime}</span>
          <span className="text-hud-fg-2 font-semibold">{toolTime}</span>
        </div>
      </div>
    </section>
  );
}
