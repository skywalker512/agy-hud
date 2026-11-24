import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import type { GeminiModelGlobalPulse, GeminiPulseSnapshot } from '../../types/telemetry';
import { fmtClock, fmtNum, fmtSec, fmtTps } from '../../utils/format';
import { IconAlert, IconChevronDown, IconChevronRight, IconRefresh } from '../common/Icons';

interface GeminiPulseCardProps {
  pulse: GeminiPulseSnapshot | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  t: Translations;
}

function statusDotClass(status: string): string {
  if (status === 'outage') return 'bg-hud-bad';
  if (status === 'degraded') return 'bg-hud-warn';
  if (status === 'ok') return 'bg-hud-ok';
  return 'bg-hud-muted/50';
}

function shortGeminiLabel(m: GeminiModelGlobalPulse): string {
  return m.label.replace(/^Gemini\s+/i, '');
}

export function GeminiPulseCard({
  pulse,
  refreshing,
  onRefresh,
  onToggleEnabled,
  t,
}: GeminiPulseCardProps) {
  const [open, toggleOpen] = usePersistedOpen('gemini-pulse', true);

  const enabled = pulse ? pulse.enabled : true;
  const models = pulse?.models || [];
  const incidents = pulse?.incidents || [];
  const overall = pulse?.overallStatus || 'unknown';
  const fetchedClock = pulse?.fetchedAtMs ? fmtClock(pulse.fetchedAtMs) : '';

  const statusBadge = !enabled
    ? { cls: 'text-hud-muted bg-hud-fill', text: t.pulseStatusOff }
    : overall === 'outage'
      ? { cls: 'text-hud-bad bg-tint-bad font-semibold', text: t.pulseStatusOutage }
      : overall === 'degraded'
        ? { cls: 'text-hud-warn bg-tint-warn font-semibold', text: t.pulseStatusDegraded }
        : overall === 'ok'
          ? { cls: 'text-hud-ok bg-hud-fill font-medium', text: t.pulseStatusOk }
          : { cls: 'text-hud-muted bg-hud-fill', text: pulse?.loading ? t.pulseLoading : t.pulseStatusUnknown };

  return (
    <section className="hud-card">
      <div
        className="card-head flex items-center justify-between gap-2 cursor-pointer select-none"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="card-k truncate">{t.pulseTitle}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-[0.5px] rounded-full font-hud text-[9.5px] whitespace-nowrap ${statusBadge.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? statusDotClass(overall) : 'bg-hud-muted/40'}`} />
            <span>{statusBadge.text}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {enabled && (
            <button
              type="button"
              className="collapse-btn"
              aria-label="Refresh Gemini Pulse"
              disabled={refreshing}
              data-tip={t.pulseRefreshTip(fetchedClock)}
              onClick={onRefresh}
            >
              <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            type="button"
            className="px-1.5 py-[1px] rounded font-hud text-[9.5px] text-hud-muted hover:text-hud-fg bg-hud-fill transition-colors cursor-pointer"
            data-tip={enabled ? t.pulseDisableTip : t.pulseEnableTip}
            onClick={() => onToggleEnabled(!enabled)}
          >
            {enabled ? t.pulseToggleOn : t.pulseToggleOff}
          </button>
          <button
            type="button"
            className="collapse-btn"
            aria-expanded={open}
            onClick={toggleOpen}
          >
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="hud-expand-anim mt-2.5 flex flex-col gap-2 min-w-0">
          {!enabled ? (
            <div className="l2-well px-2.5 py-2 text-[10.5px] font-hud text-hud-muted leading-[1.4]">
              {t.pulseDisabledNote}
            </div>
          ) : (
            <>
              {incidents.length > 0 && (
                <div className="l2-well px-2.5 py-1.5 flex items-start gap-1.5 text-[10px] font-hud text-hud-warn border border-hud-warn/25">
                  <IconAlert size={12} className="shrink-0 mt-[1px]" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-hud-fg truncate">
                      {incidents[0].service} · {incidents[0].severity.toUpperCase()}
                    </div>
                    <div className="text-hud-muted leading-[1.35] break-words">{incidents[0].summary}</div>
                  </div>
                </div>
              )}

              {models.length === 0 ? (
                <div className="l2-well px-2.5 py-2 text-[10.5px] font-hud text-hud-muted">
                  {pulse?.error ? t.pulseErrorNote(pulse.error) : t.pulseLoading}
                </div>
              ) : (
                <div className="l2-well px-2 py-1.5 flex flex-col gap-1 min-w-0">
                  {/* Column header */}
                  <div className="grid grid-cols-[minmax(0,1.4fr)_44px_42px_38px_36px] items-center gap-1 px-1 pb-1 border-b border-hud-hairline font-hud text-[9px] font-semibold uppercase tracking-[0.03em] text-hud-muted">
                    <span>{t.pulseColModel}</span>
                    <span className="text-right">TTFT</span>
                    <span className="text-right">TPS</span>
                    <span className="text-right">{t.pulseColCache}</span>
                    <span className="text-right">{t.pulseColUp}</span>
                  </div>

                  {models.map((m) => {
                    const isActive = pulse?.activeFamily === m.family;
                    const ttftStr = m.p50TtftSec !== null ? fmtSec(m.p50TtftSec) : '--';
                    const tpsStr = m.p50Tps !== null ? fmtTps(m.p50Tps) : '--';
                    const cacheStr = m.cacheHitPct !== null ? `${Math.round(m.cacheHitPct)}%` : '--';
                    const upStr = m.uptime30mPct !== null ? `${Math.round(m.uptime30mPct)}%` : '--';

                    const ttftCls =
                      m.p50TtftSec !== null && m.p50TtftSec >= 8
                        ? 'text-hud-bad font-semibold'
                        : m.p50TtftSec !== null && m.p50TtftSec >= 4
                          ? 'text-hud-warn font-medium'
                          : 'text-hud-fg';
                    const upCls =
                      m.uptime30mPct !== null && m.uptime30mPct < 90
                        ? 'text-hud-bad font-semibold'
                        : m.uptime30mPct !== null && m.uptime30mPct < 99
                          ? 'text-hud-warn font-medium'
                          : 'text-hud-ok';

                    const localLine = m.local && m.local.calls7d > 0
                      ? t.pulseRowLocalTip(
                          m.local.p50TtftSec !== null ? fmtSec(m.local.p50TtftSec) : '--',
                          m.local.p90TtftSec !== null ? fmtSec(m.local.p90TtftSec) : '--',
                          m.local.p50Tps !== null ? fmtTps(m.local.p50Tps) : '--',
                          m.local.cacheHitPct !== null ? `${m.local.cacheHitPct.toFixed(0)}%` : '--',
                          m.local.calls7d,
                        )
                      : t.pulseRowNoLocal;

                    const rowTip = t.pulseRowTip({
                      label: m.label,
                      provider: m.primaryProvider || 'Google',
                      req30m: m.requestCount30m > 0 ? fmtNum(m.requestCount30m) : '--',
                      p50Ttft: ttftStr,
                      p90Ttft: m.p90TtftSec !== null ? fmtSec(m.p90TtftSec) : '--',
                      p50Tps: tpsStr,
                      cachePct: m.cacheHitPct !== null ? `${m.cacheHitPct.toFixed(1)}%` : '--',
                      uptimePct: m.uptime30mPct !== null ? `${m.uptime30mPct.toFixed(1)}%` : '--',
                      degraded: m.degradedProviders.join(', '),
                      localLine,
                    });

                    return (
                      <div
                        key={m.family}
                        className={`grid grid-cols-[minmax(0,1.4fr)_44px_42px_38px_36px] items-center gap-1 px-1 py-[3px] rounded cursor-help font-hud-mono text-[10px] tabular-nums transition-colors hover:bg-hud-fill/60${
                          isActive ? ' bg-hud-fill/80' : ''
                        }`}
                        data-tip={rowTip}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 font-hud text-[10.5px]">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(m.status)}`} />
                          <span className={`truncate ${isActive ? 'font-semibold text-hud-fg' : 'text-hud-fg/90'}`}>
                            {shortGeminiLabel(m)}
                          </span>
                        </div>
                        <span className={`text-right ${ttftCls}`}>{ttftStr}</span>
                        <span className="text-right text-hud-fg/90">{tpsStr}</span>
                        <span className="text-right text-hud-muted">{cacheStr}</span>
                        <span className={`text-right ${upCls}`}>{upStr}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="text-[9.5px] font-hud text-hud-muted leading-[1.35]">
                {t.pulseFootnote(fetchedClock)}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
