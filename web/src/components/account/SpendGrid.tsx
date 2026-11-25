import type { Translations } from '../../i18n';
import type {
  AccountHistory,
  AccountLedgerPoolRow,
  AccountQuotaLedger,
  SessionInfo,
  TelemetrySummary,
} from '../../types/telemetry';
import { fmtClock, fmtUsd } from '../../utils/format';

interface SpendGridProps {
  summary: TelemetrySummary | undefined;
  history: AccountHistory | undefined;
  sessionInfo?: SessionInfo | null;
  accountLedger?: AccountQuotaLedger | null;
  t: Translations;
}

function fmtPoolPctCompact(pct: number, spanLabel: string): string {
  if (!(pct > 0.05)) return `${spanLabel} 0%`;
  if (pct >= 100) return `${(pct / 100).toFixed(pct >= 1000 ? 0 : 1)}×${spanLabel}`;
  return `${spanLabel} ${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function fmtResetDateTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd} ${fmtClock(ts)}`;
}

function effCostOrZero(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function SpendGrid({ summary, history, sessionInfo, accountLedger, t }: SpendGridProps) {
  const s = summary;
  const h = history;
  const tree = sessionInfo?.treeTotals;
  const rootTree = sessionInfo?.rootTreeTotals || null;
  const isZh = t.lang === 'zh';

  const rootCost = s?.totalCostUSD || 0;
  const rootSaved = s?.totalSavedUSD || 0;
  const rootPriced = s?.pricedCount || 0;
  const rootCalls = s?.count || 0;

  const childCount = tree?.descendantCount || 0;
  const childCost = tree?.childCostUSD || 0;
  const childSaved = tree?.childSavedUSD || 0;
  const childPriced = tree?.childPricedCount || 0;
  const childCalls = tree?.childCalls || 0;
  const hasChildRollup = childCount > 0 && (childCost > 0 || childCalls > 0);
  const hasRootTree = Boolean(rootTree && rootTree.costUSD > effCostOrZero(rootCost + childCost));

  const effCost = rootCost + childCost;
  const effSaved = rootSaved + childSaved;
  const effPriced = rootPriced + childPriced;
  const effCalls = rootCalls + childCalls;

  const rosterName = sessionInfo?.swarm?.selfMember?.rosterName;
  const selfTag = rosterName ? `@${rosterName}` : (isZh ? '当前子会话' : 'Subsession');
  const rootTreeShortLabel = rootTree?.isSwarm ? (isZh ? '蜂群' : 'Swarm') : (isZh ? '主树' : 'Tree');

  const sessionCellLabel = hasRootTree
    ? (isZh ? '当前子会话' : 'SUBSESSION')
    : t.spendSession;

  const sessionSub = hasChildRollup
    ? isZh
      ? `含${childCount}子 · 省${fmtUsd(effSaved)}`
      : `+${childCount} sub · -${fmtUsd(effSaved)}`
    : hasRootTree && rootTree
      ? `${rootTreeShortLabel} ${fmtUsd(rootTree.costUSD)}`
      : effPriced
        ? t.spendSavedSub(fmtUsd(effSaved))
        : t.spendCallsSub(effCalls);

  const rootTreeTipSection = hasRootTree && rootTree
    ? isZh
      ? `• 所属${rootTree.isSwarm ? '蜂群' : '主会话树'}总计（含 ${rootTree.descendantCount} 个子会话）：${fmtUsd(rootTree.costUSD)}（省 ${fmtUsd(rootTree.savedUSD)}，${rootTree.calls} 次调用）\n` +
        `• 当前子会话（${selfTag}）：${fmtUsd(effCost)}（省 ${fmtUsd(effSaved)}，${effCalls} 次调用）\n` +
        `提示：顶部点击返回父会话可查看整棵任务树明细。\n\n`
      : `• Parent ${rootTree.isSwarm ? 'Swarm' : 'session tree'} total (${rootTree.descendantCount} subagents): ${fmtUsd(rootTree.costUSD)} (saved ${fmtUsd(rootTree.savedUSD)}, ${rootTree.calls} calls)\n` +
        `• This subsession (${selfTag}): ${fmtUsd(effCost)} (saved ${fmtUsd(effSaved)}, ${effCalls} calls)\n` +
        `Tip: click the parent breadcrumb at the top to view the full tree.\n\n`
    : '';

  const sessionBreakdownTip = hasChildRollup
    ? isZh
      ? `本会话总计（含 Swarm / 递归子会话）：${fmtUsd(effCost)}（省 ${fmtUsd(effSaved)}，${effCalls} 次调用）\n` +
        `• 主会话：${fmtUsd(rootCost)}（${rootCalls} 次）\n` +
        `• ${tree?.swarmWorkerCount ? `Swarm / 子会话` : '子会话'}（${childCount} 个）：${fmtUsd(childCost)}（${childCalls} 次）\n` +
        `${rootTreeTipSection ? `\n${rootTreeTipSection}` : '\n'}${t.spendSessionTip}`
      : `Session total (incl. Swarm / recursive subagents): ${fmtUsd(effCost)} (saved ${fmtUsd(effSaved)}, ${effCalls} calls)\n` +
        `• Main session: ${fmtUsd(rootCost)} (${rootCalls} calls)\n` +
        `• ${tree?.swarmWorkerCount ? 'Swarm / subagents' : 'Subagents'} (${childCount}): ${fmtUsd(childCost)} (${childCalls} calls)\n` +
        `${rootTreeTipSection ? `\n${rootTreeTipSection}` : '\n'}${t.spendSessionTip}`
    : `${rootTreeTipSection}${t.spendSessionTip}`;

  const cliDbs = h?.dbCountBySource?.cli || 0;
  const cliCalls = h?.callsBySource?.cli || 0;
  const allSourceDetail =
    cliDbs > 0 || cliCalls > 0
      ? t.spendAllSourceTip(
          fmtUsd(h?.costBySource?.app || 0),
          h?.callsBySource?.app || 0,
          h?.dbCountBySource?.app || 0,
          fmtUsd(h?.costBySource?.cli || 0),
          cliCalls,
          cliDbs,
        )
      : '';

  const cells = [
    {
      k: sessionCellLabel,
      v: effPriced > 0 || effCost > 0 ? fmtUsd(effCost) : '--',
      sub: sessionSub,
      tip: sessionBreakdownTip,
    },
    {
      k: t.spendToday,
      v: fmtUsd(h?.todayCostUSD || 0),
      sub: t.spendCallsSub(h?.todayCalls || 0),
      tip: t.spendLocalScopeTip,
    },
    {
      k: t.spendMonth,
      v: fmtUsd(h?.monthCostUSD || 0),
      sub: t.spendCallsSub(h?.monthCalls || 0),
      tip: t.spendLocalScopeTip,
    },
    {
      k: t.spendAll,
      v: fmtUsd(h?.totalCostUSD || 0),
      sub: h?.indexing
        ? t.spendIndexingSub(h.indexedCount || 0, h.dbCount || 0)
        : t.spendCallsSub(h?.totalCalls || 0, h?.dbCount || 0),
      tip: allSourceDetail ? `${allSourceDetail}\n\n${t.spendLocalScopeTip}` : t.spendLocalScopeTip,
    },
  ];

  const ledger = accountLedger && (
    accountLedger.all.pct5hSum > 0.05
    || accountLedger.all.pct7dSum > 0.05
    || accountLedger.recentResets.length > 0
  )
    ? accountLedger
    : null;

  const fmtLedgerUsd = (usd: number) => {
    if (!(usd > 0.005)) return '--';
    return `${ledger?.hasProvisionalCap ? '~' : ''}${fmtUsd(usd)}`;
  };

  const buildLedgerTip = (
    periodName: string,
    getRow: (r: AccountLedgerPoolRow) => { pct7d: number; pct5h?: number; usd: number },
  ) => {
    if (!ledger) return '';
    const lines = ledger.pools.map((r) => {
      const m = getRow(r);
      const qTag = r.estQuality === 'high' ? '' : isZh ? ' (初估)' : ' (est.)';
      const pctPart = m.pct5h !== undefined && m.pct5h > 0.05
        ? `${fmtPoolPctCompact(m.pct5h, '5h')} · ${fmtPoolPctCompact(m.pct7d, '7d')}`
        : fmtPoolPctCompact(m.pct7d, '7d');
      return `• ${r.label}: ${pctPart} (${m.usd > 0.005 ? fmtUsd(m.usd) : '--'}${qTag})`;
    });
    return `${periodName}\n${lines.join('\n')}\n\n${t.accountSpendScopeTip}`;
  };

  const ledgerCells = ledger
    ? [
        {
          k: t.spendToday,
          v: fmtLedgerUsd(ledger.today.usd),
          sub: ledger.today.pct5hSum > 0.05
            ? fmtPoolPctCompact(ledger.today.pct5hSum, '5h')
            : fmtPoolPctCompact(ledger.today.pct7dSum, '7d'),
          tip: buildLedgerTip(t.spendToday, (r) => ({ pct5h: r.todayPct5h, pct7d: r.todayPct7d, usd: r.todayUsd })),
        },
        {
          k: t.accountSpendWeek,
          v: fmtLedgerUsd(ledger.week7d.usd),
          sub: fmtPoolPctCompact(ledger.week7d.pct7dSum, '7d'),
          tip: buildLedgerTip(t.accountSpendWeek, (r) => ({ pct7d: r.weekPct7d, usd: r.weekUsd })),
        },
        {
          k: t.spendMonth,
          v: fmtLedgerUsd(ledger.month.usd),
          sub: fmtPoolPctCompact(ledger.month.pct7dSum, '7d'),
          tip: buildLedgerTip(t.spendMonth, (r) => ({ pct7d: r.monthPct7d, usd: r.monthUsd })),
        },
        {
          k: t.accountSpendTracked,
          v: fmtLedgerUsd(ledger.all.usd),
          sub: t.accountSpendDaysSub(ledger.trackedDays, ledger.all.resets),
          tip: buildLedgerTip(
            `${t.accountSpendTracked} (${ledger.firstDay} →)`,
            (r) => ({ pct7d: r.allPct7d, usd: r.allUsd }),
          ),
        },
      ]
    : null;

  const latestReset = ledger?.recentResets?.[0] || null;
  const resetBannerTip = ledger && ledger.recentResets.length > 0
    ? `${t.accountResetTipTitle}\n${ledger.recentResets
        .map((ev) => {
          const kindLbl = ev.kind === 'in_window_rewind' ? t.accountResetKindInWindow : t.accountResetKindEarlyShift;
          return `• ${fmtResetDateTime(ev.ts)} · ${ev.poolLabel} ${ev.spanKey} (${kindLbl}): ${ev.beforeUsedPct.toFixed(1)}% → ${ev.afterUsedPct.toFixed(1)}% (+${ev.reclaimedPct.toFixed(1)}%)`;
        })
        .join('\n')}`
    : '';

  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      {ledger && ledgerCells && (
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-hud text-[9.5px] font-semibold uppercase tracking-[0.04em] text-hud-muted">
              {t.accountSpendScopeLabel}
            </span>
            {ledger.hasProvisionalCap && (
              <span className="font-hud-mono text-[9px] text-hud-muted/80">
                {t.accountSpendProvTag}
              </span>
            )}
          </div>
          <div className="spend-grid grid grid-cols-4 gap-1.5">
            {ledgerCells.map((c) => (
              <div key={c.k} className="spend-cell cursor-help" data-tip={c.tip}>
                <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">
                  {c.k}
                </span>
                <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums">
                  {c.v}
                </span>
                <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
                  {c.sub}
                </span>
              </div>
            ))}
          </div>
          {latestReset && (
            <div
              className="l2-well flex items-center justify-between gap-2 px-2.5 py-1.5 font-hud text-[10px] text-hud-ok cursor-help"
              data-tip={resetBannerTip}
            >
              <span className="truncate">
                {t.accountResetBanner(
                  ledger.recentResets.length,
                  latestReset.poolLabel,
                  latestReset.spanKey,
                  `${latestReset.reclaimedPct.toFixed(1)}%`,
                  fmtResetDateTime(latestReset.ts),
                )}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-hud text-[9.5px] font-semibold uppercase tracking-[0.04em] text-hud-muted">
            {t.spendScopeLabel}
          </span>
        </div>
        <div className="spend-grid grid grid-cols-4 gap-1.5">
          {cells.map((c) => (
            <div key={c.k} className="spend-cell cursor-help" data-tip={c.tip}>
              <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">
                {c.k}
              </span>
              <span className="font-hud-mono text-[12px] font-bold text-hud-fg tabular-nums">
                {c.v}
              </span>
              <span className="font-hud-mono text-[9.5px] text-hud-muted tabular-nums truncate">
                {c.sub}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
