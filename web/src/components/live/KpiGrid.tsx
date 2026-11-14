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
  const avgGen = active ? `${fmtTps(summary?.avgGenTps)} tok/s` : '--';
  const avgE2e = active ? `${fmtTps(summary?.avgE2eTps)} tok/s` : '--';
  const peakTps = active ? `${fmtTps(summary?.peakGenTps)} tok/s` : '--';
  const avgCache = active ? fmtCachePct(summary?.avgCacheHitPct) : '--';
  const avgTtft = active ? fmtSec(summary?.avgTtftSec) : '--';
  const totalOut = active ? `${fmtNum(summary?.totalOutput)} tok` : '--';
  const modelTime = active ? fmtSec(summary?.totalModelSec) : '--';
  const toolTime = active ? fmtSec(summary?.totalToolSec) : '--';

  return (
    <section className="kpi-grid-4 grid grid-cols-4 gap-1.5">
      <div className="stat-cell">
        <div className="text-[10.5px] text-hud-muted truncate">{t.avgGen}</div>
        <div className="font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums">{avgGen}</div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span>E2E </span>
          <strong className="text-hud-fg font-semibold">{avgE2e}</strong>
        </div>
      </div>

      <div className="stat-cell">
        <div className="text-[10.5px] text-hud-muted truncate">{t.peakTps}</div>
        <div className="font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums">{peakTps}</div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span>{t.avgCache}</span>
          <strong className="text-hud-fg font-semibold">{avgCache}</strong>
        </div>
      </div>

      <div className="stat-cell">
        <div className="text-[10.5px] text-hud-muted truncate">{t.avgTtft}</div>
        <div className="font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums">{avgTtft}</div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span>{t.totOut}</span>
          <strong className="text-hud-fg font-semibold">{totalOut}</strong>
        </div>
      </div>

      <div className="stat-cell">
        <div className="text-[10.5px] text-hud-muted truncate">{t.modelTime}</div>
        <div className="font-hud-mono text-[13.5px] font-bold text-hud-fg tabular-nums">{modelTime}</div>
        <div className="mt-0.5 font-hud-mono text-[10px] text-hud-muted tabular-nums truncate">
          <span>{t.toolTime}</span>
          <strong className="text-hud-fg font-semibold">{toolTime}</strong>
        </div>
      </div>
    </section>
  );
}
