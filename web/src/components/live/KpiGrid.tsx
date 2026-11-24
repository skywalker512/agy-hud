import type { Translations } from '../../i18n';
import type { SessionInfo, TelemetrySummary } from '../../types/telemetry';
import { fmtCachePct, fmtDurationShort, fmtNum, fmtSec, fmtTps } from '../../utils/format';

interface KpiGridProps {
  found: boolean;
  hasLatest: boolean;
  summary: TelemetrySummary | undefined;
  sessionInfo?: SessionInfo | null;
  t: Translations;
}

function fmtKpiDuration(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '--';
  if (sec >= 120) return fmtDurationShort(sec);
  return fmtSec(sec);
}

export function KpiGrid({ found, hasLatest, summary, sessionInfo, t }: KpiGridProps) {
  const active = Boolean(found && hasLatest && summary);
  const tree = found ? sessionInfo?.treeTotals : null;
  const childOut = tree?.childOutputTokens || 0;
  const childCount = tree?.descendantCount || 0;
  const hasChildOut = childCount > 0 && childOut > 0;
  const isZh = t.kpiOutputLabel === '累计输出';

  const avgGenNum = active ? fmtTps(summary?.avgGenTps) : '--';
  const avgE2eNum = active ? fmtTps(summary?.avgE2eTps) : '--';
  const peakNum = active ? fmtTps(summary?.peakGenTps) : '--';
  const avgCache = active ? fmtCachePct(summary?.avgCacheHitPct) : '--';
  const rootOut = summary?.totalOutput || 0;
  const effTotalOut = rootOut + childOut;
  const totalOutNum = active ? fmtNum(effTotalOut) : '--';
  const modelTimeDisp = active ? fmtKpiDuration(summary?.totalModelSec) : '--';
  const toolTimeDisp = active ? fmtKpiDuration(summary?.totalToolSec) : '--';
  const modelTimeExact = active ? fmtSec(summary?.totalModelSec) : '--';
  const toolTimeExact = active ? fmtSec(summary?.totalToolSec) : '--';

  const baseOutTip = t.kpiOutputCacheTip(active ? effTotalOut.toLocaleString() : '--', avgCache);
  const outTip =
    active && hasChildOut
      ? `${baseOutTip}\n${
          isZh
            ? `主会话 ${rootOut.toLocaleString()} tok + ${childCount} 个 Swarm/子会话 ${childOut.toLocaleString()} tok`
            : `Main ${rootOut.toLocaleString()} tok + ${childCount} Swarm/subagents ${childOut.toLocaleString()} tok`
        }`
      : baseOutTip;

  return (
    <section className="kpi-strip">
      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiAvgSpeedTip(avgGenNum, avgE2eNum, peakNum)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.kpiAvgSpeedLabel}</div>
        <div className="mt-0.5 flex items-baseline gap-1 font-hud-mono text-[13px] font-bold text-hud-fg tabular-nums min-w-0">
          <span className="truncate">{avgGenNum}</span>
          {active && <span className="hud-unit text-[9px] shrink-0">tok/s</span>}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0">
          <span className="font-hud shrink-0">E2E</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{avgE2eNum}</span>
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={outTip}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">
          {t.kpiOutputLabel}
          {active && hasChildOut ? ` · +${childCount}` : ''}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 font-hud-mono text-[13px] font-bold text-hud-fg tabular-nums min-w-0">
          <span className="truncate">{totalOutNum}</span>
          {active && <span className="hud-unit text-[9px] shrink-0">tok</span>}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0">
          <span className="font-hud shrink-0">{t.avgCache.trim()}</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{avgCache}</span>
        </div>
      </div>

      <div
        className="kpi-strip-cell cursor-help"
        data-tip={t.kpiTimeTip(modelTimeExact, toolTimeExact, summary?.toolStepCount || 0)}
      >
        <div className="text-[10px] font-hud font-medium text-hud-muted truncate">{t.kpiTimeLabel}</div>
        <div className="mt-0.5 font-hud-mono text-[13px] font-bold text-hud-fg tabular-nums truncate">
          {modelTimeDisp}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-hud-muted tabular-nums min-w-0">
          <span className="font-hud shrink-0">{t.toolTime.trim()}</span>
          <span className="font-hud-mono text-hud-fg-2 font-semibold truncate">{toolTimeDisp}</span>
        </div>
      </div>
    </section>
  );
}
