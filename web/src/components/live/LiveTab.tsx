import type { RefObject } from 'preact';
import { useMemo } from 'preact/hooks';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import type { Translations } from '../../i18n';
import type { CallDetailPayload, Invocation, Lang, StatsSnapshot } from '../../types/telemetry';
import { fmtCachePct, fmtQuotaPct, fmtSec, fmtTps, fmtUsd, formatModelTag } from '../../utils/format';
import { IconChevronDown, IconChevronRight } from '../common/Icons';
import { ContextWindowCard } from './ContextWindowCard';
import { HeroSpeedCards } from './HeroSpeedCards';
import { KpiGrid } from './KpiGrid';
import { LiveQuotaCard } from './LiveQuotaCard';
import { RecentCallsCard } from './RecentCallsCard';
import { SubagentsCard } from './SubagentsCard';

interface LiveTabProps {
  snap: StatsSnapshot | null;
  lang?: Lang;
  recentOpen: boolean;
  expandedRows: Set<number>;
  expandedCompacts: Set<number>;
  collapsedTurns: Set<number>;
  compactOnly: boolean;
  detailCache: Map<string, CallDetailPayload>;
  detailLoading: Set<string>;
  t: Translations;
  heroSentinelRef?: RefObject<HTMLDivElement>;
  onToggleRecentOpen: () => void;
  onViewAll: () => void;
  onOpenAccount: () => void;
  onJumpConversation: (convId: string) => void;
  onToggleCompactOnly: () => void;
  onToggleFoldAllTurns: () => void;
  onToggleTurnCollapsed: (turnIdx: number) => void;
  onToggleInvocation: (idx: number, hasDetail: boolean) => void;
  onToggleCompact: (stepIdx: number, hasDetail: boolean) => void;
}

interface ModelMixRow {
  model: string;
  calls: number;
  avgGenTps: number;
  avgTtftSec: number;
  cachePct: number | null;
  costUSD: number;
  quotaPct5h: number;
  dotClass: string;
}

function modelDotClass(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('flash') || m.includes('hydrogen')) return 'bg-seg-cache';
  if (m.includes('neon') || m.includes('sonnet')) return 'bg-seg-input';
  if (m.includes('carbon') || m.includes('argon') || m.includes('opus') || m.includes('orchestrator')) {
    return 'bg-seg-think';
  }
  return 'bg-seg-out';
}

function buildModelMix(invocations: Invocation[]): ModelMixRow[] {
  const map = new Map<
    string,
    {
      calls: number;
      sustTok: number;
      sustSec: number;
      ttftSum: number;
      cached: number;
      newIn: number;
      costUSD: number;
      quotaPct5h: number;
    }
  >();

  for (const r of invocations) {
    const model = formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
    const cur = map.get(model) || {
      calls: 0,
      sustTok: 0,
      sustSec: 0,
      ttftSum: 0,
      cached: 0,
      newIn: 0,
      costUSD: 0,
      quotaPct5h: 0,
    };
    cur.calls += 1;
    if (!r.isBuffered && r.genSec > 0) {
      cur.sustTok += r.outputTokens;
      cur.sustSec += r.genSec;
    }
    cur.ttftSum += r.ttftSec || 0;
    cur.cached += r.cachedInput || 0;
    cur.newIn += r.newInput || 0;
    if (r.priced) cur.costUSD += r.costUSD || 0;
    cur.quotaPct5h += r.quotaPct5h || 0;
    map.set(model, cur);
  }

  return [...map.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([model, st]) => {
      const promptTot = st.cached + st.newIn;
      return {
        model,
        calls: st.calls,
        avgGenTps: st.sustSec > 0 ? st.sustTok / st.sustSec : 0,
        avgTtftSec: st.calls > 0 ? st.ttftSum / st.calls : 0,
        cachePct: promptTot > 0 ? (st.cached / promptTot) * 100 : null,
        costUSD: st.costUSD,
        quotaPct5h: st.quotaPct5h,
        dotClass: modelDotClass(model),
      };
    });
}

export function LiveTab({
  snap,
  lang,
  recentOpen,
  expandedRows,
  expandedCompacts,
  collapsedTurns,
  compactOnly,
  detailCache,
  detailLoading,
  t,
  heroSentinelRef,
  onToggleRecentOpen,
  onViewAll,
  onOpenAccount,
  onJumpConversation,
  onToggleCompactOnly,
  onToggleFoldAllTurns,
  onToggleTurnCollapsed,
  onToggleInvocation,
  onToggleCompact,
}: LiveTabProps) {
  const [mixOpen, toggleMixOpen] = usePersistedOpen('model-mix', false);

  const found = Boolean(snap?.found);
  const latest = found ? snap?.latest || null : null;
  const invocations = found ? snap?.invocations || [] : [];
  const compactions = found ? snap?.compactions || [] : [];
  const turns = found ? snap?.turns || [] : [];
  const children = found ? snap?.sessionInfo?.childSessions || [] : [];

  const modelMix = useMemo(() => buildModelMix(invocations), [invocations]);

  return (
    <section id="tab-live" className="flex flex-col gap-2.5 min-w-0">
      <HeroSpeedCards
        found={found}
        latest={latest}
        latestSustained={snap?.latestSustained}
        activeStep={found ? snap?.activeStep : null}
        serverTimeMs={snap?.serverTimeMs}
        invocations={invocations}
        avgGenTps={found ? snap?.summary?.avgGenTps : undefined}
        avgTtftSec={found ? snap?.summary?.avgTtftSec : undefined}
        geminiPulse={snap?.geminiPulse}
        t={t}
      />

      {/* Sentinel right below HeroSpeedCards for smart scroll-aware PulseBar */}
      <div ref={heroSentinelRef} className="h-0 -my-[5px] pointer-events-none" aria-hidden="true" />

      <ContextWindowCard snap={snap} t={t} />

      <LiveQuotaCard
        quota={snap?.accountQuota}
        summary={found ? snap?.summary : undefined}
        sessionInfo={found ? snap?.sessionInfo || null : null}
        t={t}
        onOpenAccount={onOpenAccount}
      />

      <KpiGrid
        found={found}
        hasLatest={Boolean(latest)}
        summary={found ? snap?.summary : undefined}
        sessionInfo={found ? snap?.sessionInfo || null : null}
        t={t}
      />

      {/* Conditional Compact Collapsible Session Model Mix (>= 2 routed models) */}
      {found && modelMix.length >= 2 && (
        <section className="hud-card">
          <div
            className="flex flex-nowrap items-center justify-between gap-2 cursor-pointer select-none min-w-0"
            onClick={toggleMixOpen}
          >
            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
              <span className="card-k">{t.modelMixTitle}</span>
              <span className="micro-badge">{modelMix.length}</span>
              {!mixOpen && (
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {modelMix.slice(0, 3).map((row) => (
                    <span
                      key={row.model}
                      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md bg-hud-surface-2 font-hud-mono text-[9.5px] text-hud-muted tabular-nums max-w-[140px] truncate"
                    >
                      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${row.dotClass}`} />
                      <span className="truncate text-hud-fg">{row.model}</span>
                      <span>{t.modelMixCalls(row.calls)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="collapse-btn shrink-0"
              aria-expanded={mixOpen}
              onClick={(e) => {
                e.stopPropagation();
                toggleMixOpen();
              }}
            >
              {mixOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            </button>
          </div>

          {mixOpen && (
            <div className="hud-expand-anim l2-well mt-2 px-2.5 py-2 flex flex-col gap-1 min-w-0">
              <div className="model-mix-grid text-[9px] font-hud font-semibold uppercase tracking-[0.04em] text-hud-muted pb-1 border-b border-hud-hairline">
                <span>{t.modelMixColModel}</span>
                <span className="text-right">{t.modelMixColCalls}</span>
                <span className="text-right">{t.modelMixColGen}</span>
                <span className="text-right model-mix-hide-xs">{t.modelMixColTtft}</span>
                <span className="text-right model-mix-hide-xs">{t.modelMixColCache}</span>
                <span className="text-right">{t.modelMixColCost}</span>
              </div>
              {modelMix.map((row) => {
                const qStr = fmtQuotaPct(row.quotaPct5h);
                return (
                  <div key={row.model} className="model-mix-grid text-hud-fg py-[1.5px]">
                    <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${row.dotClass}`} />
                      <span className="truncate font-medium">{row.model}</span>
                    </span>
                    <span className="text-right text-hud-muted">{row.calls}</span>
                    <span className="text-right font-semibold">{fmtTps(row.avgGenTps)}</span>
                    <span className="text-right text-hud-muted model-mix-hide-xs">{fmtSec(row.avgTtftSec)}</span>
                    <span className="text-right text-hud-muted model-mix-hide-xs">{fmtCachePct(row.cachePct)}</span>
                    <span className="text-right text-hud-muted whitespace-nowrap">
                      {fmtUsd(row.costUSD)}
                      {qStr ? ` · -${qStr}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <RecentCallsCard
        invocations={invocations}
        compactions={compactions}
        turns={turns}
        activeStep={found ? snap?.activeStep : null}
        serverTimeMs={snap?.serverTimeMs}
        latestContext={latest?.totalContext || 0}
        convId={snap?.conversationId || ''}
        recentOpen={recentOpen}
        expandedRows={expandedRows}
        expandedCompacts={expandedCompacts}
        collapsedTurns={collapsedTurns}
        compactOnly={compactOnly}
        detailCache={detailCache}
        detailLoading={detailLoading}
        t={t}
        onToggleRecentOpen={onToggleRecentOpen}
        onViewAll={onViewAll}
        onToggleCompactOnly={onToggleCompactOnly}
        onToggleFoldAllTurns={onToggleFoldAllTurns}
        onToggleTurnCollapsed={onToggleTurnCollapsed}
        onToggleInvocation={onToggleInvocation}
        onToggleCompact={onToggleCompact}
      />

      <SubagentsCard
        found={found}
        children={children}
        sessionInfo={found ? snap?.sessionInfo || null : null}
        summary={found ? snap?.summary || null : null}
        lang={lang}
        t={t}
        onJumpConversation={onJumpConversation}
      />
    </section>
  );
}
