import type { Translations } from '../../i18n';
import type { StatsSnapshot, TokenBreakdownItem } from '../../types/telemetry';
import {
  cacheTier,
  computeHeadroomTurns,
  evalCacheSurvival,
  fmtClock,
  fmtDurationShort,
  fmtNum,
  fmtQuotaPct,
  fmtTtlDuration,
  fmtUsd,
  formatSessionQuotaCompact,
  formatSessionQuotaTip,
  friendlyFamilyName,
  getEffectiveContextState,
} from '../../utils/format';

interface ContextWindowCardProps {
  snap: StatsSnapshot | null;
  nowMs: number;
  t: Translations;
}

interface SegSpec {
  cls: string;
  name: string;
  tok: number;
  extra?: string;
  detail?: string;
  hideZero?: boolean;
}

function fmtItemTipList(title: string, items: TokenBreakdownItem[] | undefined, limit = 8): string {
  if (!items || !items.length) return '';
  const head = items.slice(0, limit).map((x) => `  ${x.name}: ${x.tokens.toLocaleString()}`);
  if (items.length > limit) {
    const restTok = items.slice(limit).reduce((s, x) => s + x.tokens, 0);
    head.push(`  +${items.length - limit} more: ${restTok.toLocaleString()}`);
  }
  return `\n${title}\n${head.join('\n')}`;
}

export function ContextWindowCard({ snap, nowMs, t }: ContextWindowCardProps) {
  const found = Boolean(snap?.found);
  const latest = found ? snap?.latest || null : null;
  const breakdown = found ? snap?.contextBreakdown || null : null;
  const s = found ? snap?.summary : undefined;

  const effCtx = getEffectiveContextState(snap);
  const limit = effCtx.limit;
  const totalUsed = effCtx.totalUsed;
  const pct = effCtx.pct;
  const hasContext = Boolean(latest || effCtx.isPostCompact);
  const approxPrefix = effCtx.isEstimated ? '~' : '';

  const headroom = found ? computeHeadroomTurns(snap) : null;

  const cachePred = found ? snap?.cacheTtl?.currentSession || null : null;
  const latestMs = cachePred?.lastCallMs || s?.latestCallMs || latest?.timestampMs || 0;
  let ageBadge: { text: string; tier: 'fresh' | 'warm' | 'stale'; tip: string } | null = null;
  if (found && latestMs > 0) {
    const ageSec = Math.max(0, Math.floor((nowMs - latestMs) / 1000));
    const ageStr = fmtDurationShort(ageSec);
    if (cachePred) {
      const prob = evalCacheSurvival(cachePred, ageSec);
      const probPct = Math.round(prob * 100);
      const tier: 'fresh' | 'warm' | 'stale' = prob >= 0.75 ? 'fresh' : prob >= 0.4 ? 'warm' : 'stale';
      const remSafeSec = Math.max(0, cachePred.p80Sec - ageSec);
      const remHalfSec = Math.max(0, cachePred.p50Sec - ageSec);
      const sourceLabel =
        cachePred.confidence === 'fitted'
          ? t.cacheTtlConfFitted(cachePred.longGapCount)
          : cachePred.confidence === 'provisional'
            ? t.cacheTtlConfProv(cachePred.longGapCount)
            : t.cacheTtlConfPrior;
      const missUsdStr = cachePred.missPenaltyUSD >= 0.001 ? fmtUsd(cachePred.missPenaltyUSD) : '';
      const missQuotaStr =
        cachePred.missPenaltyQuota5hPct && cachePred.missPenaltyQuota5hPct >= 0.01
          ? fmtQuotaPct(cachePred.missPenaltyQuota5hPct)
          : '';
      ageBadge = {
        text: t.cacheSurvPill(probPct, ageStr),
        tier,
        tip: t.cacheSurvTip({
          ageStr,
          lastClock: fmtClock(latestMs),
          probPct,
          familyName: friendlyFamilyName(cachePred.family),
          p80Str: fmtTtlDuration(cachePred.p80Sec),
          p50Str: fmtTtlDuration(cachePred.p50Sec),
          remSafeStr: remSafeSec >= 15 ? fmtTtlDuration(remSafeSec) : '',
          remHalfStr: remHalfSec >= 15 ? fmtTtlDuration(remHalfSec) : '',
          pastHalf: ageSec >= cachePred.p50Sec,
          sourceLabel,
          ctxTokStr: fmtNum(cachePred.cachedContextTokens),
          missUsdStr,
          missQuotaStr,
        }),
      };
    } else {
      const tier = ageSec >= 300 ? 'stale' : ageSec >= 120 ? 'warm' : 'fresh';
      ageBadge = {
        text: t.cacheAgeLabel(ageStr),
        tier,
        tip: t.cacheAgeTip(ageStr, fmtClock(latestMs)),
      };
    }
  }

  let sessionCost: { text: string; tip: string } | null = null;
  if (found && s && s.pricedCount > 0) {
    const costStr = fmtUsd(s.totalCostUSD);
    const savedStr = s.totalSavedUSD > 0 ? fmtUsd(s.totalSavedUSD) : '';
    sessionCost = {
      text: t.sessionCostPill(costStr, savedStr),
      tip: t.sessionCostTip(costStr, savedStr || '$0.00', s.pricedCount, s.unpricedCount || 0),
    };
  }

  const rawSessionQuota = found ? (s?.sessionQuota || snap?.sessionInfo?.quotaUsage || null) : null;
  const sessionQuotaStr = formatSessionQuotaCompact(rawSessionQuota);
  const sessionQuotaTip = sessionQuotaStr ? formatSessionQuotaTip(rawSessionQuota, t) : '';

  const hasBreakdown = Boolean(hasContext && breakdown && breakdown.reportedTotal > 0);
  let segs: SegSpec[];
  let scaleDenomUsed = totalUsed;

  if (!hasContext) {
    segs = [
      { cls: 'seg-sys', name: t.kSysPrompt, tok: 0 },
      { cls: 'seg-tdef', name: t.kToolsDef, tok: 0 },
      { cls: 'seg-tres', name: t.kToolRes, tok: 0 },
      { cls: 'seg-model', name: t.kModel, tok: 0 },
      { cls: 'seg-user', name: t.kUserOther, tok: 0 },
    ];
  } else if (hasBreakdown && breakdown) {
    const sysTok = breakdown.systemPrompt || 0;
    const toolsDefTok = breakdown.toolsSchema || 0;
    const postUserTok = effCtx.isPostCompact ? Math.max(0, totalUsed - sysTok - toolsDefTok) : 0;
    scaleDenomUsed = effCtx.isPostCompact ? totalUsed : breakdown.reportedTotal || totalUsed;
    segs = [
      {
        cls: 'seg-sys',
        name: t.kSysPrompt,
        tok: sysTok,
        detail: fmtItemTipList(t.ctxSysSecTitle, breakdown.systemPromptItems, 6),
      },
      {
        cls: 'seg-tdef',
        name: t.kToolsDef,
        tok: toolsDefTok,
        detail: fmtItemTipList(
          t.ctxTdefTitle((breakdown.toolSchemaItems || []).length),
          breakdown.toolSchemaItems,
          6,
        ),
      },
      {
        cls: 'seg-tres',
        name: t.kToolRes,
        tok: effCtx.isPostCompact ? 0 : breakdown.toolResults || 0,
        detail: effCtx.isPostCompact ? '' : fmtItemTipList(t.ctxToolsLabel, breakdown.toolResultsByTool, 8),
      },
      {
        cls: 'seg-model',
        name: t.kModel,
        tok: effCtx.isPostCompact ? 0 : breakdown.assistant || 0,
      },
      {
        cls: 'seg-user',
        name: t.kUserOther,
        tok: effCtx.isPostCompact ? postUserTok : breakdown.userAndOther || 0,
        detail: `\n${
          effCtx.isPostCompact
            ? t.ctxUserSplit(0, postUserTok, 0)
            : t.ctxUserSplit(
                breakdown.userInput || 0,
                breakdown.checkpoint || 0,
                breakdown.sysMsg || 0,
              )
        }`,
      },
    ];
  } else if (effCtx.isPostCompact) {
    const summaryTok = Math.min(
      totalUsed,
      effCtx.trailingCompact?.candidateTokens || effCtx.trailingCompact?.outputTokens || 0,
    );
    const sysTok = Math.max(0, totalUsed - summaryTok);
    segs = [
      { cls: 'seg-other', name: t.kSys, tok: sysTok },
      { cls: 'seg-out', name: t.kOut, tok: summaryTok },
    ];
  } else if (latest) {
    const cTok = latest.cachedInput || 0;
    const iTok = latest.newInput || 0;
    const tTok = latest.thinkingTokens || 0;
    const oTok = latest.candidateTokens || 0;
    const apiSum = cTok + iTok + tTok + oTok;
    const sysTok = Math.max(0, totalUsed - apiSum);
    segs = [
      {
        cls: 'seg-cache',
        name: t.kCache,
        tok: cTok,
        extra: latest.cacheHitPct !== null ? ` (${latest.cacheHitPct.toFixed(0)}%)` : '',
      },
      { cls: 'seg-input', name: t.kIn, tok: iTok },
      { cls: 'seg-think', name: t.kThk, tok: tTok },
      { cls: 'seg-out', name: t.kOut, tok: oTok },
      { cls: 'seg-other', name: t.kSys, tok: sysTok, hideZero: true },
    ];
  } else {
    segs = [];
  }

  const segSum = segs.reduce((acc, x) => acc + x.tok, 0);
  const scale = scaleDenomUsed > 0 && segSum > scaleDenomUsed ? scaleDenomUsed / segSum : 1;
  const denomUsed = Math.max(1, scaleDenomUsed);

  const toolList =
    hasBreakdown && breakdown
      ? !effCtx.isPostCompact && breakdown.toolResultsByTool?.length
        ? breakdown.toolResultsByTool
        : breakdown.toolSchemaItems || []
      : [];
  const toolRowLabel =
    hasBreakdown && !effCtx.isPostCompact && breakdown?.toolResultsByTool?.length
      ? t.ctxToolsLabel
      : t.ctxToolDefsLabel;
  const shownTools = toolList.slice(0, 5);
  const restTools = toolList.slice(5);
  const restSum = restTools.reduce((acc, x) => acc + x.tokens, 0);
  const restTip = restTools.map((x) => `${x.name}: ${x.tokens.toLocaleString()} tok`).join('\n');

  const freeStr = hasContext ? `${approxPrefix}${fmtNum(Math.max(0, limit - totalUsed))}` : '--';
  const cPctStr = latest && latest.cacheHitPct !== null ? ` (${latest.cacheHitPct.toFixed(0)}%)` : '';

  return (
    <section className="hud-card">
      <div className="card-head flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="card-k">{t.ctxLabel}</span>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
          {headroom && (
            <span
              className={`headroom-pill${
                headroom.turns <= 3 ? ' low' : headroom.turns <= 8 ? ' warn' : ''
              }`}
              data-tip={t.headroomTip(headroom.turns, headroom.medianDelta)}
            >
              {t.headroomLabel(headroom.turns)}
            </span>
          )}
          {ageBadge && (
            <span className={`cache-age-pill cursor-help ${ageBadge.tier}`} data-tip={ageBadge.tip}>
              {ageBadge.text}
            </span>
          )}
          <span className={`cache-pill ${latest ? cacheTier(latest.cacheHitPct) : 'muted'}`}>
            {latest ? t.cacheBadge(latest.cacheHitPct) : '--'}
          </span>
          {sessionCost && (
            <span className="cost-pill cursor-help" data-tip={sessionCost.tip}>
              {sessionCost.text}
            </span>
          )}
          {sessionQuotaStr && (
            <span className="quota-pill cursor-help" data-tip={sessionQuotaTip}>
              {t.sessionQuotaPill(sessionQuotaStr)}
            </span>
          )}
          <span className="font-hud-mono text-[11.5px] font-semibold text-hud-fg tabular-nums whitespace-nowrap">
            {hasContext ? `${approxPrefix}${fmtNum(totalUsed)} / ${fmtNum(limit)} (${pct.toFixed(1)}%)` : '-- / -- (0.0%)'}
          </span>
        </div>
      </div>

      <div className="relative h-2.5 rounded-full bg-hud-fill overflow-hidden flex my-2">
        {segs.map((seg, i) => {
          const widthPct = hasContext && limit > 0 ? Math.min(100, ((seg.tok * scale) / limit) * 100) : 0;
          const winPct = limit > 0 ? (seg.tok / limit) * 100 : 0;
          const usedPct = (seg.tok / denomUsed) * 100;
          const tip = hasContext
            ? `${t.segTip(seg.name, seg.tok, winPct, usedPct)}${seg.detail || ''}`
            : undefined;
          return (
            <div
              key={`${seg.cls}:${i}`}
              className={`h-full transition-[width] duration-200 ${seg.cls} hover:brightness-110`}
              style={{ width: `${widthPct.toFixed(3)}%` }}
              data-tip={tip}
            />
          );
        })}
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px"
          style={{ background: 'color-mix(in srgb, var(--hud-fg) 22%, transparent)' }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-[80%] w-px"
          style={{ background: 'color-mix(in srgb, var(--hud-fg) 22%, transparent)' }}
        />
      </div>

      {shownTools.length > 0 && (
        <div className="mt-2 pt-[7px] border-t border-dashed border-hud-border flex flex-wrap items-center gap-x-1.5 gap-y-[5px]">
          <span className="text-[10.5px] text-hud-muted font-medium mr-0.5">{toolRowLabel}</span>
          {shownTools.map((item, idx) => {
            const usedPct = (item.tokens / denomUsed) * 100;
            const winPct = limit > 0 ? (item.tokens / limit) * 100 : 0;
            return (
              <span
                key={item.name}
                className={`ctx-tool-chip${idx === 0 ? ' is-top' : ''}`}
                data-tip={t.ctxToolChipTip(item.name, item.tokens, usedPct, winPct)}
              >
                <span>{item.name}</span>
                <span className="text-hud-muted">{fmtNum(item.tokens)}</span>
              </span>
            );
          })}
          {restTools.length > 0 && (
            <span className="ctx-tool-chip" data-tip={restTip}>
              <span>{t.ctxMoreTools(restTools.length)}</span>
              <span className="text-hud-muted">{fmtNum(restSum)}</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-hud-muted">
        {segs.map((seg, i) => {
          if (seg.hideZero && seg.tok <= 0) return null;
          const valStr = hasContext ? `${fmtNum(seg.tok)}${seg.extra || ''}` : '--';
          return (
            <span key={`${seg.name}:${i}`} className="inline-flex items-center gap-1">
              <span className={`inline-block w-2 h-2 rounded-[2px] shrink-0 ${seg.cls}`} />
              <span>{seg.name}</span>
              <strong className="text-hud-fg font-semibold">{valStr}</strong>
            </span>
          );
        })}
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-[2px] shrink-0 seg-free" />
          <span>{t.kFree}</span>
          <strong className="text-hud-fg font-semibold">{freeStr}</strong>
        </span>
      </div>

      {hasBreakdown && latest && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-hud-muted font-hud-mono tabular-nums">
          <span>{t.ctxTurnLabel}:</span>
          <span>
            {t.kCache}{' '}
            <strong className="text-hud-fg font-semibold">
              {fmtNum(latest.cachedInput)}
              {cPctStr}
            </strong>
          </span>
          <span>
            {t.kIn} <strong className="text-hud-fg font-semibold">{fmtNum(latest.newInput)}</strong>
          </span>
          <span>
            {t.kThk}{' '}
            <strong className="text-hud-fg font-semibold">{fmtNum(latest.thinkingTokens)}</strong>
          </span>
          <span>
            {t.kOut}{' '}
            <strong className="text-hud-fg font-semibold">{fmtNum(latest.candidateTokens)}</strong>
          </span>
        </div>
      )}
    </section>
  );
}
