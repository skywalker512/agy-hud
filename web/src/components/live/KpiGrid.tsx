import type { Translations } from '../../i18n';
import type { TelemetrySummary } from '../../types/telemetry';
import { fmtCachePct, fmtNum, fmtSec, fmtTps } from '../../utils/format';

interface KpiGridProps {
  found: boolean;
  hasLatest: boolean;
  summary: TelemetrySummary | undefined;
  t: Translations;
}

function fmtKpiDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '--';
  if (sec < 120) return fmtSec(sec);
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${String(remS).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${String(remM).padStart(2, '0')}m`;
}

export function KpiGrid({ found, hasLatest, summary, t }: KpiGridProps) {
  const active = Boolean(found && hasLatest && summary);
  const avgGenNum = active ? fmtTps(summary?.avgGenTps) : '--';
  const avgE2eNum = active ? fmtTps(summary?.avgE2eTps) : '--';
  const peakNum = active ? fmtTps(summary?.peakGenTps) : '--';
  const avgCache = active ? fmtCachePct(summary?.avgCacheHitPct) : '--';
  const avgTtft = active ? fmtSec(summary?.avgTtftSec) : '--';
  const totalOutNum = active ? fmtNum(summary?.totalOutput) : '--';
  const modelTimeDisp = active ? fmtKpiDuration(summary?.totalModelSec) : '--';
  const toolTimeDisp = active ? fmtKpiDuration(summary?.totalToolSec) : '--';
  const modelTimeTip = active
    ? (summary?.totalModelSec || 0) >= 120
      ? `${modelTimeDisp} (${fmtSec(summary?.totalModelSec)})`
      : fmtSec(summary?.totalModelSec)
    : '--';
  const toolTimeTip = active
    ? (summary?.totalToolSec || 0) >= 120
      ? `${toolTimeDisp} (${fmtSec(summary?.totalToolSec)})`
      : fmtSec(summary?.totalToolSec)
    : '--';

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
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0 truncate">
          <span className="font-hud shrink-0">E2E</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{avgE2eNum}</span>
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
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0 truncate">
          <span className="font-hud shrink-0">{t.avgCache.trim()}</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{avgCache}</span>
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
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0 truncate">
          <span className="font-hud shrink-0">{t.totOut.trim()}</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">
            {totalOutNum}
            {active && <span className="hud-unit text-[9px] font-normal"> tok</span>}
          </span>
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiTimeTip(modelTimeTip, toolTimeTip, summary?.toolStepCount || 0)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.modelTime}</div>
        <div className="mt-0.5 font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums truncate">
          {modelTimeDisp}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0 truncate">
          <span className="font-hud shrink-0">{t.toolTime.trim()}</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{toolTimeDisp}</span>
        </div>
      </div>
    </section>
  );
}
