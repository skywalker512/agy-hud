import { useEffect, useRef, useState } from 'preact/hooks';
import type { Translations } from '../../i18n';
import type { StatsSnapshot, TokenBreakdownItem } from '../../types/telemetry';
import {
  cacheTier,
  computeHeadroomTurns,
  evalCacheSurvival,
  fmtCachePct,
  fmtClock,
  fmtDurationShort,
  fmtNum,
  fmtQuotaPct,
  fmtTtlDuration,
  fmtUsd,
  formatSessionQuotaTiny,
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
  const [hoveredSegIdx, setHoveredSegIdx] = useState<number | null>(null);
  const [cardWidth, setCardWidth] = useState(380);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setCardWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth;
      if (w > 0) setCardWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  let ageBadge: { text: string; sub?: string; tier: 'fresh' | 'warm' | 'stale'; tip: string } | null = null;
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
        text: `~${probPct}%`,
        sub: ageStr,
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
        text: ageStr,
        tier,
        tip: t.cacheAgeTip(ageStr, fmtClock(latestMs)),
      };
    }
  }

  const hasPricedCost = Boolean(found && s && s.pricedCount > 0);
  const costStr = hasPricedCost ? fmtUsd(s?.totalCostUSD || 0) : '';
  const savedStr = hasPricedCost && (s?.totalSavedUSD || 0) > 0 ? fmtUsd(s?.totalSavedUSD || 0) : '';
  const costTip = hasPricedCost
    ? t.sessionCostTip(costStr, savedStr || '$0.00', s?.pricedCount || 0, s?.unpricedCount || 0)
    : undefined;

  const rawSessionQuota = found ? (s?.sessionQuota || snap?.sessionInfo?.quotaUsage || null) : null;
  const sessionQuotaStr = formatSessionQuotaTiny(rawSessionQuota);
  const sessionQuotaTip = sessionQuotaStr ? formatSessionQuotaTip(rawSessionQuota, t) : '';
  const spendQuotaTip = [costTip, sessionQuotaTip].filter(Boolean).join('\n\n') || undefined;

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

    const sysSubParts: string[] = [];
    if (breakdown.skills && breakdown.skills > 0) sysSubParts.push(`Skills ${fmtNum(breakdown.skills)}`);
    if (breakdown.rules && breakdown.rules > 0) sysSubParts.push(`Rules ${fmtNum(breakdown.rules)}`);
    const sysSubLine = sysSubParts.length ? `\n${sysSubParts.join(' · ')}` : '';

    const tdefSubLine =
      breakdown.mcpTools && breakdown.mcpTools > 0 ? `\nMCP tools: ${breakdown.mcpTools.toLocaleString()} tok` : '';

    const ckptTok = breakdown.checkpointTokens ?? breakdown.checkpoint ?? 0;

    segs = [
      {
        cls: 'seg-sys',
        name: t.kSysPrompt,
        tok: sysTok,
        detail: `${sysSubLine}${fmtItemTipList(t.ctxSysSecTitle, breakdown.systemPromptItems, 6)}`,
      },
      {
        cls: 'seg-tdef',
        name: t.kToolsDef,
        tok: toolsDefTok,
        detail: `${tdefSubLine}${fmtItemTipList(
          t.ctxTdefTitle((breakdown.toolSchemaItems || []).length),
          breakdown.toolSchemaItems,
          6,
        )}`,
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
                ckptTok,
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
  const maxToolChips = cardWidth <= 320 ? 3 : 5;
  const shownTools = toolList.slice(0, maxToolChips);
  const restTools = toolList.slice(maxToolChips);
  const restSum = restTools.reduce((acc, x) => acc + x.tokens, 0);
  const restTip = restTools.map((x) => `${x.name}: ${x.tokens.toLocaleString()} tok`).join('\n');

  const freeStr = hasContext ? `${approxPrefix}${fmtNum(Math.max(0, limit - totalUsed))}` : '--';
  const cTier = latest ? cacheTier(latest.cacheHitPct) : 'muted';
  const cacheValColor =
    cTier === 'good'
      ? 'text-hud-ok'
      : cTier === 'mid'
        ? 'text-hud-warn'
        : cTier === 'low'
          ? 'text-hud-bad'
          : 'text-hud-fg';

  const headroomColor =
    headroom && headroom.turns <= 3
      ? 'text-hud-bad'
      : headroom && headroom.turns <= 8
        ? 'text-hud-warn'
        : 'text-hud-fg';

  const survColor =
    ageBadge?.tier === 'stale'
      ? 'text-hud-bad'
      : ageBadge?.tier === 'warm'
        ? 'text-hud-warn'
        : 'text-hud-fg';

  const pctStr = hasContext ? `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` : '0%';

  // Build visible breakdown rows (for 2-column aligned grid)
  const visibleSegEntries = segs
    .map((seg, i) => ({ seg, idx: i }))
    .filter(({ seg }) => !(seg.hideZero && seg.tok <= 0));

  return (
    <section ref={cardRef} className="hud-card flex flex-col gap-2.5">
      {/* Clean 2-Item Header: Title (left) + Bold Ratio · Pct (right) */}
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="card-k">{t.ctxLabel}</span>
        <span className="font-hud-mono text-[11.5px] font-semibold text-hud-fg tabular-nums whitespace-nowrap">
          {hasContext ? (
            <>
              <span>{approxPrefix}{fmtNum(totalUsed)}</span>
              <span className="text-hud-muted font-normal"> / {fmtNum(limit)} · </span>
              <span className={pct >= 88 ? 'text-hud-bad' : pct >= 75 ? 'text-hud-warn' : ''}>{pctStr}</span>
            </>
          ) : (
            <span className="text-hud-muted">-- / --</span>
          )}
        </span>
      </div>

      {/* Segmented Progress Bar with Crisp 1px Gaps & Cross-Highlight */}
      <div
        className="relative h-2.5 rounded-full bg-hud-fill overflow-hidden flex gap-[1.5px]"
        onMouseLeave={() => setHoveredSegIdx(null)}
      >
        {segs.map((seg, i) => {
          const widthPct = hasContext && limit > 0 ? Math.min(100, ((seg.tok * scale) / limit) * 100) : 0;
          if (widthPct <= 0) return null;
          const winPct = limit > 0 ? (seg.tok / limit) * 100 : 0;
          const usedPct = (seg.tok / denomUsed) * 100;
          const tip = hasContext
            ? `${t.segTip(seg.name, seg.tok, winPct, usedPct)}${seg.detail || ''}`
            : undefined;
          const isDimmed = hoveredSegIdx !== null && hoveredSegIdx !== i;
          return (
            <div
              key={`${seg.cls}:${i}`}
              className={`h-full transition-all duration-150 first:rounded-l-full last:rounded-r-full ${seg.cls} ${
                isDimmed ? 'opacity-30' : 'opacity-100'
              }`}
              style={{ width: `${widthPct.toFixed(3)}%` }}
              data-tip={tip}
              onMouseEnter={() => setHoveredSegIdx(i)}
            />
          );
        })}
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px"
          style={{ background: 'color-mix(in srgb, var(--hud-fg) 18%, transparent)' }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-[80%] w-px"
          style={{ background: 'color-mix(in srgb, var(--hud-fg) 18%, transparent)' }}
        />
      </div>

      {/* 2-Column Aligned Breakdown Table */}
      <div
        className="ctx-breakdown-grid grid grid-cols-2 gap-x-4 gap-y-1 min-w-0"
        onMouseLeave={() => setHoveredSegIdx(null)}
      >
        {visibleSegEntries.map(({ seg, idx }) => {
          const valStr = hasContext ? `${fmtNum(seg.tok)}${seg.extra || ''}` : '--';
          const isHighlighted = hoveredSegIdx === idx;
          const isDimmed = hoveredSegIdx !== null && !isHighlighted;
          const winPct = limit > 0 ? (seg.tok / limit) * 100 : 0;
          const usedPct = (seg.tok / denomUsed) * 100;
          const tip = hasContext
            ? `${t.segTip(seg.name, seg.tok, winPct, usedPct)}${seg.detail || ''}`
            : undefined;

          return (
            <div
              key={`${seg.name}:${idx}`}
              data-tip={tip}
              onMouseEnter={() => setHoveredSegIdx(idx)}
              className={`flex items-center justify-between gap-2 px-1 py-[1px] -mx-1 rounded transition-colors cursor-default min-w-0 ${
                isHighlighted ? 'bg-hud-surface-2' : ''
              } ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
            >
              <span className="inline-flex items-center gap-1.5 min-w-0 text-[11px] font-hud text-hud-muted">
                <span className={`inline-block w-[7px] h-[7px] rounded-[2px] shrink-0 ${seg.cls}`} />
                <span className="truncate">{seg.name}</span>
              </span>
              <span className="font-hud-mono text-[11px] font-semibold text-hud-fg tabular-nums shrink-0">
                {valStr}
              </span>
            </div>
          );
        })}

        {/* Free Space Row aligned cleanly in 2-col table */}
        <div
          className={`flex items-center justify-between gap-2 px-1 py-[1px] -mx-1 rounded min-w-0 transition-opacity ${
            hoveredSegIdx !== null ? 'opacity-45' : 'opacity-100'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0 text-[11px] font-hud text-hud-muted">
            <span className="inline-block w-[7px] h-[7px] rounded-[2px] shrink-0 seg-free" />
            <span className="truncate">{t.kFree}</span>
          </span>
          <span className="font-hud-mono text-[11px] font-semibold text-hud-muted tabular-nums shrink-0">
            {freeStr}
          </span>
        </div>
      </div>

      {/* Clean Borderless 4-Column Micro-Metric Strip */}
      <div className="ctx-micro-strip grid grid-cols-4 gap-1.5 min-w-0">
        <div
          className={`l2-well px-2 py-1.5 flex flex-col gap-[1px] min-w-0${headroom ? ' cursor-help' : ''}`}
          data-tip={headroom ? t.headroomTip(headroom.turns, headroom.medianDelta) : undefined}
        >
          <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.ctxMicroHeadroom}</span>
          <span className={`font-hud-mono text-[11.5px] font-bold tabular-nums truncate ${headroomColor}`}>
            {headroom ? `~${headroom.turns}t` : '--'}
          </span>
        </div>

        <div className="l2-well px-2 py-1.5 flex flex-col gap-[1px] min-w-0">
          <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.ctxMicroCacheHit}</span>
          <span className={`font-hud-mono text-[11.5px] font-bold tabular-nums truncate ${cacheValColor}`}>
            {latest ? fmtCachePct(latest.cacheHitPct) : '--'}
          </span>
        </div>

        <div
          className={`l2-well px-2 py-1.5 flex flex-col gap-[1px] min-w-0${ageBadge ? ' cursor-help' : ''}`}
          data-tip={ageBadge?.tip}
        >
          <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.ctxMicroCacheTtl}</span>
          <span className={`font-hud-mono text-[11.5px] font-bold tabular-nums truncate ${survColor}`}>
            {ageBadge ? (
              <>
                <span>{ageBadge.text}</span>
                {ageBadge.sub && <span className="font-normal text-[9.5px] text-hud-muted ml-1">{ageBadge.sub}</span>}
              </>
            ) : (
              '--'
            )}
          </span>
        </div>

        <div
          className={`l2-well px-2 py-1.5 flex flex-col gap-[1px] min-w-0${spendQuotaTip ? ' cursor-help' : ''}`}
          data-tip={spendQuotaTip}
        >
          <span className="font-hud text-[9.5px] font-medium text-hud-muted truncate">{t.ctxMicroSpendQuota}</span>
          <span className="font-hud-mono text-[11.5px] font-bold text-hud-fg tabular-nums truncate">
            {costStr || '--'}
          </span>
          {sessionQuotaStr && (
            <span className="font-hud-mono text-[9.5px] font-semibold text-hud-accent-ink tabular-nums leading-tight break-words">
              {sessionQuotaStr}
            </span>
          )}
        </div>
      </div>

      {/* Top Tool Footprint Chips (borderless recessed pills) */}
      {shownTools.length > 0 && (
        <div className="pt-2 border-t border-hud-hairline flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-hud text-hud-muted font-medium mr-0.5">{toolRowLabel}</span>
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
    </section>
  );
}
