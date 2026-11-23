import type { Translations } from './types';

export const en: Translations = {
  title: 'AGY HUD',
  connecting: 'SYNC...',
  waitingModel: 'Waiting for telemetry...',
  optAuto: 'Auto Pane',
  optLatest: 'Latest DB',
  tabLive: 'Live',
  tabCalls: 'Calls',
  tabAccount: 'Account',
  genLabel: 'GEN SPEED',
  livePill: 'GEN',
  e2eLabel: 'E2E SPEED',
  ctxLabel: 'CONTEXT WINDOW',
  kCache: 'CACHE',
  kIn: 'IN',
  kThk: 'THK',
  kOut: 'OUT',
  kSys: 'SYS',
  kFree: 'FREE',
  kSysPrompt: 'SYS PROMPT',
  kToolsDef: 'TOOL DEF',
  kToolRes: 'TOOL OUT',
  kModel: 'MODEL',
  kUserOther: 'USER/CKPT',
  ctxToolsLabel: 'TOOL OUT',
  ctxToolDefsLabel: 'TOOL DEF',
  ctxTurnLabel: 'TURN',
  ctxMoreTools: (n) => `+${n} more`,
  ctxToolChipTip: (name, tok, usedPct, winPct) =>
    `${name}: ${tok.toLocaleString()} tok (${usedPct.toFixed(1)}% used · ${winPct.toFixed(1)}% window)`,
  ctxSysSecTitle: 'System Prompt sections:',
  ctxTdefTitle: (n) => `Tool definitions (${n}):`,
  ctxUserSplit: (u, c, s) =>
    `USER ${u.toLocaleString()} · CHECKPOINT ${c.toLocaleString()}${s > 0 ? ` · SYS_MSG ${s.toLocaleString()}` : ''}`,
  avgGen: 'AVG GEN',
  peakTps: 'PEAK TPS',
  avgCache: 'CACHE ',
  modelTime: 'MODEL TIME',
  toolTime: 'TOOL ',
  avgTtft: 'AVG TTFT',
  totOut: 'OUT ',
  recentTitle: 'RECENT CALLS',
  viewAll: 'View all',
  chartTitle: 'TREND',
  tabTps: 'TPS',
  tabTtft: 'TTFT',
  tabOut: 'OUT',
  tabCache: 'CACHE%',
  tabCtx: 'CTX%',
  tabQuota: 'QUOTA%',
  noCalls: 'No calls yet',
  histTitle: 'CALL LOG',
  histHint: 'Click row to expand',
  badgeWait: (s) => `WAIT TTFT ${s}s`,
  badgeGen: (s) => `STREAM ${s}s`,
  badgeCompact: (s) => `COMPACT ${s}s`,
  badgeTool: (tool, s) => (tool ? `TOOL · ${tool}${s ? ` ${s}s` : ''}` : `TOOL${s ? ` ${s}s` : ''}`),
  badgeToolWait: (tool, s) => (tool ? `APPROVAL · ${tool}${s ? ` ${s}s` : ''}` : `WAITING${s ? ` ${s}s` : ''}`),
  badgeStandby: 'IDLE',
  badgeStandbyTip: 'Connected & watching session DB; no active call right now',
  badgeWaitTip: 'Request sent; waiting for first token (TTFT)',
  badgeGenTip: 'First token received; streaming response',
  badgeCompactTip: 'Compacting context window into a summary checkpoint',
  badgeIdle: 'NO DB',
  badgeRetry: 'RETRY...',
  noDb: 'No session DB found',
  readErr: (e) => `Read err: ${e}`,
  waitFirstCall: (id) => `Conv ${id}… · waiting for call`,
  sessionMeta: (turns, steps, calls) => `${turns} turns · ${steps} steps · ${calls} calls`,
  modelWaiting: (m) => `Waiting TTFT · ${m}`,
  modelRunning: (m) => `Streaming · ${m}`,
  modelCompact: (m) => `Compacting · ${m}`,
  modelTool: (m, tool) => (tool ? `${m} · ${tool}` : `${m} · tool`),
  chartMeta: (n) => `${n} calls`,
  genSubSust: (sust, ms, tok) => `LAST STR ${sust} · BUF ${ms}ms (${tok} tok)`,
  genSubBuf: (ms, tok) => `BUF ${ms}ms · OUT ${tok} tok`,
  genSubOk: (tok, sec) => `${tok} tok · ${sec}`,
  e2eSub: (ttft, tot) => `TTFT ${ttft} · ${tot}`,
  cacheBadge: (pct) => (pct === null ? 'CACHE --' : `CACHE ${pct.toFixed(1)}%`),
  headroomLabel: (n) => `~${n}t left`,
  headroomTip: (n, avgDelta) =>
    `Estimated context headroom: ~${n} turns remaining\nBased on median growth ~${avgDelta.toLocaleString()} tok/turn`,
  segTip: (name, tok, winPct, usedPct) =>
    `${name}: ${tok.toLocaleString()} tok (${winPct.toFixed(1)}% window · ${usedPct.toFixed(1)}% used)`,
  tipBuf: (idx, m, ms, e2e, tok, cache, ttft) =>
    `#${idx} [${m}] · BUF (${ms}ms) · E2E ${e2e} tok/s · TTFT ${ttft} · ${tok} tok · Cache ${cache}`,
  tipOk: (idx, m, gen, e2e, tok, cache, ttft) =>
    `#${idx} [${m}] · GEN ${gen} tok/s (E2E ${e2e}) · TTFT ${ttft} · ${tok} tok · Cache ${cache}`,
  tipTtft: (idx, m, ttft, gen, tot) => `#${idx} [${m}] · TTFT ${ttft} · GEN ${gen} · TOT ${tot}`,
  tipOut: (idx, m, out, thk, vis, gen) => `#${idx} [${m}] · OUT ${out} tok (THK ${thk} / VIS ${vis}) · GEN ${gen}`,
  tipCache: (idx, m, cachePct, cached, newIn) => `#${idx} [${m}] · Cache ${cachePct} (${cached} cached / ${newIn} new)`,
  tipCtx: (idx, m, used, lim, pct) => `#${idx} [${m}] · Context ${used}/${lim} (${pct.toFixed(1)}%)`,
  tipQuota: (idx, m, pct5h, pct7d, kStr, costStr) =>
    `#${idx} [${m}] · 5h quota -${pct5h}${pct7d ? ` (7d -${pct7d})` : ''} · ${kStr}× rate${costStr ? ` · list ${costStr}` : ''}`,
  chartSubTps: (n, avg, max, last) => `Last ${n}: AVG ${avg} · MAX ${max} · Latest ${last} tok/s`,
  chartSubTtft: (n, avg, max, last) => `Last ${n}: AVG ${avg} · MAX ${max} · Latest ${last}`,
  chartSubOut: (n, avg, max, last) => `Last ${n}: AVG ${avg} · MAX ${max} · Latest ${last} tok`,
  chartSubCache: (n, avg, min, last) => `Last ${n}: AVG ${avg} · MIN ${min} · Latest ${last}`,
  chartSubCtx: (n, last, max) => `Last ${n}: MAX ${max} · Latest ${last}`,
  chartSubQuota: (n, sum, avg, max) => `Last ${n}: SUM -${sum} · AVG -${avg} · MAX -${max} (5h)`,
  chartAllModels: (n) => `All ${n}`,
  chartModelFilterTip: (name, count, avgStr, active) =>
    `${name} · ${count} calls${avgStr ? ` · avg ${avgStr}` : ''}\n${active ? 'Click to show all models' : 'Click to isolate this model'}`,
  histDetail: (tm, cached, newIn, out, thk, ttft, gen, stallNote = '') =>
    `${tm ? tm + ' · ' : ''}TTFT ${ttft} · GEN ${gen}${stallNote} · IN ${cached}+${newIn} · OUT ${out} (THK ${thk})`,
  histStallNote: (sec) => ` · TC-WAIT ${sec}`,
  histPhaseLine: (thkSec, tcSec, n) => `\nPHASE: THK ${thkSec} · TOOL GEN ${tcSec}${n ? ` (${n} tool${n > 1 ? 's' : ''})` : ''}`,
  histFull: (idx, model, tm, cPct, cached, newIn, out, thk, vis, ttft, gen, e2e, ctxUsed, ctxLim, ctxPct) =>
    `#${idx} · ${model}${tm ? ' · ' + tm : ''}\nIN: ${cached} cached + ${newIn} new (${cPct} hit)\nOUT: ${out} tok (THK ${thk} / VIS ${vis})\nTIME: TTFT ${ttft} · GEN ${gen} · E2E ${e2e} tok/s\nCTX: ${ctxUsed} / ${ctxLim} (${ctxPct.toFixed(1)}%)`,
  histBuf: (ms) => `BUF ${ms}ms`,
  loadingDetail: 'Loading content details...',
  noDetailBody: 'No thinking / reply / tool body captured for this step.',
  waitOut: 'Waiting for output...',
  liveWaitBadge: 'WAIT TTFT',
  liveStreamBadge: 'STREAMING',
  liveRowTagWait: 'WAIT',
  liveRowTagStream: 'ACTIVE',
  liveWaitDetail: (sec, startTm) => `Waiting for TTFT ${sec}s…${startTm ? ` (sent ${startTm})` : ''}`,
  liveStreamDetail: (ttftStr, genSec) => `TTFT ${ttftStr} received · streaming ${genSec}s…`,
  lblThinking: 'THINKING',
  lblReply: 'REPLY',
  lblChars: (c, trunc) => (trunc ? ` · latest · ${c} chars` : ` · ${c} chars`),
  lblToolCalls: 'TOOL CALLS',
  lblSummary: 'COMPACTED SUMMARY',
  compactFilterBtn: (n, on) => (on ? `Compacts (${n})` : `Compacts (${n})`),
  compactBadge: 'COMPACT',
  compactLiveBadge: 'COMPACTING',
  compactLiveDetail: (sec, startTm, ctxStr) =>
    `Compacting ${ctxStr ? `${ctxStr} context · ` : 'context '}${sec}s…${startTm ? ` (started ${startTm})` : ''}`,
  compactDetail: (tm, cached, newIn, out, sec, dropStr) =>
    `${tm ? tm + ' · ' : ''}${sec} · ${dropStr ? dropStr + ' · ' : ''}IN ${cached}+${newIn} · SUM ${out}`,
  compactFull: (stepIdx, model, tm, dropStr, cached, newIn, out, thk, vis, sec) =>
    `COMPACT step #${stepIdx} · ${model}${tm ? ' · ' + tm : ''}${dropStr ? `\nCTX: ${dropStr}` : ''}\nIN: ${cached} cached + ${newIn} new\nSUMMARY OUT: ${out} tok (THK ${thk} / SUM ${vis})\nDURATION: ${sec}`,
  noCompactions: 'No compaction events',
  foldAllTurns: 'Fold turns',
  unfoldAllTurns: 'Unfold turns',
  showAllHistoryBtn: (shown, total) => `Show all ${total} calls (showing latest ${shown})`,
  collapseHistoryBtn: (limit) => `Show latest ${limit} only`,
  turnDividerBadge: (n) => `TURN #${n}`,
  turnDividerStats: (calls, outStr, secStr, compacts = 0, quotaStr = '') => {
    const parts: string[] = [];
    if (calls > 0) parts.push(`${calls}c`);
    if (compacts > 0) parts.push(calls > 0 ? `+${compacts}cmp` : 'COMPACT');
    if (outStr) parts.push(outStr);
    if (secStr) parts.push(secStr);
    if (quotaStr) parts.push(`-${quotaStr}`);
    return parts.join(' · ');
  },
  turnDividerTip: (n, tm, calls, outTok, secStr, prompt, compacts = 0, quotaStr = '') =>
    `Turn #${n}${tm ? ' · ' + tm : ''}\nCalls: ${calls}${compacts > 0 ? ` · Compactions: ${compacts}` : ''} · Output: ${outTok.toLocaleString()} tok${secStr ? ' · Time: ' + secStr : ''}${quotaStr ? ` · 5h quota: -${quotaStr}` : ''}${prompt ? `\n\n${prompt}` : ''}`,
  btnCopyId: 'Copy ID',
  btnCopyJsonl: 'Copy JSONL',
  btnCopyJsonlFull: 'Full JSONL',
  copied: 'Copied!',
  tipCopyId: (id) => `Copy Conversation ID:\n${id}`,
  tipCopyJsonl: (p, exists) => `Copy transcript.jsonl path${exists ? '' : ' (not generated yet)'}:\n${p}`,
  tipCopyJsonlFull: (p, exists) => `Copy transcript_full.jsonl path${exists ? '' : ' (not generated yet)'}:\n${p}`,
  kindMain: 'MAIN',
  kindSq: 'SIDE Q',
  kindSub: 'SUBAGENT',
  backParent: (lbl) => `Parent · ${lbl}`,
  linkedCount: (n) => `${n} Linked`,
  linkedTitle: 'SUBAGENTS / SIDE Q',
  linkedHint: 'Click to inspect',
  jumpAction: 'Open',
  linkedMeta: (calls, outStr, costStr, quotaStr = '') =>
    `${calls} calls · ${outStr} out${costStr ? ` · ${costStr}` : ''}${quotaStr ? ` · quota ${quotaStr}` : ''}`,
  cacheAgeLabel: (ageStr) => `AGE ${ageStr}`,
  cacheAgeTip: (ageStr, tm) =>
    `Idle since last call: ${ageStr} (at ${tm})\nAnthropic 5m cache / Gemini dynamic prefix warm window`,
  sessionCostPill: (costStr, savedStr) => `${costStr}${savedStr ? ` · saved ${savedStr}` : ''}`,
  sessionCostTip: (costStr, savedStr, priced, unpriced) =>
    `API-equivalent spend: ${costStr}\nCache saved: ${savedStr}\nPriced calls: ${priced}${unpriced ? ` · Unpriced (GPT-OSS): ${unpriced}` : ''}`,
  sessionQuotaPill: (val) => `Quota ${val}`,
  sessionQuotaPoolLine: (poolName, active5h, active7d, expired5h, fallback5h, isFitted) => {
    if (!active5h && !active7d && fallback5h) {
      return `${poolName} pool: ~-${fallback5h} (5h scale)`;
    }
    const tag = isFitted ? '' : ' [est.]';
    const cur5 = active5h ? `-${active5h}` : '0% (already reset)';
    const cur7 = active7d ? `\n  • Current 7d window: -${active7d}` : '';
    const exp = expired5h ? `\n  (Earlier -${expired5h} from past 5h windows already reset)` : '';
    return `${poolName} pool${tag}:\n  • Current 5h window: ${cur5}${cur7}${exp}`;
  },
  sessionQuotaTip: (lines) => `Current quota occupied by this conversation:\n${lines}`,
  accountTitle: 'QUOTA & SPEND',
  creditsRealMini: (c) => `Credits: ${c}`,
  creditsRealTip: (c) => `Available extra credits: ${c}`,
  quotaRefreshTip: (tm) => `Force refresh quota now (auto-cached 5m; only fetched when viewing Account)${tm ? `\nLast synced: ${tm}` : ''}`,
  quotaDeferred: 'Fetching latest quota windows...',
  quotaOffline: 'LS quota RPC unavailable outside IDE host (local DB spend active)',
  heldByWeeklyTag: 'WEEKLY CAP',
  winMeta: (pct, resetStr) => `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%${resetStr ? ` · ${resetStr}` : ''}`,
  winBudgetEst: (spent, full, lowSample, remote, effSpent) =>
    `Pool ~${full}${lowSample ? ' (prov.)' : ''} · local ${spent}${effSpent ? ` (eq ${effSpent})` : ''}${remote ? ` + ~${remote} other` : ''}`,
  winSpentOnly: (spent, minPct = '0.5%') => `Win spent ${spent} (<${minPct} sample)`,
  winRunwayWarn: (dur, clock) => `Est. cap in ~${dur} (${clock})`,
  winRunwaySafe: (remAtReset) => `~${remAtReset} left at reset`,
  winRunwayExhausted: 'Cap reached · waiting for reset',
  winRunwayTip: (burnPerHr, exhaustDur, exhaustClock, remAtReset, willExhaust, isRecent, habitBlended, activeHoursPerDay) => {
    const basisNote = habitBlended
      ? `blended with your learned historical rhythm${activeHoursPerDay ? ` (~${activeHoursPerDay.toFixed(1)}h active/day)` : ''} so early-cycle projections stay steady`
      : isRecent
        ? 'recent active + window blend'
        : 'window average';
    return `Burn pace: -${burnPerHr}/hr (${basisNote})\n${
      willExhaust
        ? `Projected to hit 0% in ~${exhaustDur} (around ${exhaustClock}) before reset`
        : `Projected ~${remAtReset} remaining when window resets (at current pace)`
    }`;
  },
  rulesTitle: 'QUOTA MECHANICS',
  rulesAccHigh: (errStr, wins) => `${wins}w verified · ${errStr} err`,
  rulesAccProv: (wins) => `Calibrating (${wins}w)`,
  rulesDriftBadge: 'Rule shift',
  rules5hTankLabel: '5h Pool Tank',
  rules7dTankLabel: (ratioStr) => `7d Weekly (${ratioStr ? `${ratioStr}× 5h` : '7d'})`,
  rulesTankRemSub: (remPct, remUsd) => `${remPct} left (~${remUsd})`,
  rulesTankTip: (cap5h, cap7d) =>
    `Think of this pool as a ~${cap5h} credit tank that refills every 5 hours${cap7d ? ` (~${cap7d} per 7d week)` : ''}.\n• A 1× model deducts $1 of pool credit per $1 of published API list price (full ${cap5h} usable).\n• A 3× model deducts $3 of pool credit per $1 of API list price (so a full pool buys 1/3 as much).\nNot an actual dollar bill charged to your card.`,
  rulesFormulaPill: (kStr, deductUsd) => `API $1 → -${deductUsd} pool (${kStr}×)`,
  rulesEffectiveApiCap: (usableApiUsd, poolFullUsd, isShrink) =>
    `5h full pool buys ~${usableApiUsd} API usage${isShrink ? ` (${poolFullUsd} ÷ mult)` : ' (1:1 full value)'}`,
  rulesSourceTag: (isFitted) => (isFitted ? 'verified' : '1× baseline'),
  rulesTokBurnStrip: (inPct, caPct, outPct, fullOutTok) =>
    `Per 1M tok (5h): In -${inPct}% · Cache -${caPct}% · Out -${outPct}% (~${fullOutTok} out = 100%)`,
  rulesPerTokCapBadge: (fullOutTok) => `~${fullOutTok} out tok = 100% 5h`,
  rulesTokInLabel: 'New Input',
  rulesTokCacheLabel: 'Cache Hit',
  rulesTokOutLabel: 'Out + Think',
  rulesTokCapSub: (tok) => `~${tok} fills 5h`,
  rulesModelTip: (family, kStr, deductUsd, usableApiUsd, obsCalls, isFitted) =>
    `${family}\nEvery $1 of published API price deducts ${deductUsd} from the pool (${kStr}× rate).\nUsing only this model, a full 5h pool equals ~${usableApiUsd} of API list usage.\nSource: ${isFitted ? `verified across ${obsCalls} local calls` : 'published 1:1 API list price baseline'}`,
  heatmapTitle: 'ACTIVITY',
  heatmapSummary: (activeDays, streakDays, peakUsd) =>
    `${activeDays}d active${streakDays > 1 ? ` · ${streakDays}d streak` : ''}${peakUsd ? ` · peak ${peakUsd}` : ''}`,
  heatmapLess: 'Less',
  heatmapMore: 'More',
  heatmapMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  heatmapWeekdays: ['Mon', 'Wed', 'Fri'],
  heatmapDayTip: (dateStr, costStr, calls, appCalls, cliCalls, outStr) =>
    `${dateStr}\nAPI-eq spend: ${costStr} · ${calls} calls${cliCalls > 0 ? ` (App ${appCalls} / CLI ${cliCalls})` : ''}\nOutput: ${outStr} tok`,
  heatmapEmptyTip: (dateStr) => `${dateStr}\nNo local calls recorded`,
  poolTip: (label, winsText, held, fitNotes, driftWarn) =>
    `${label}\n${winsText}${held ? '\nHeld at weekly cap until weekly window resets' : ''}${fitNotes ? `\n${fitNotes}` : ''}${driftWarn ? `\nPlatform billing weights may have changed (>3σ from prior or OOS >0.5%; downgraded to provisional)` : ''}\nRead-only local telemetry: cap F = 100 / beta_ref is projected onto published API reference prices (not an actual card charge).`,
  poolFitTipLine: (modelsStr, gammaStr, shortCount, errLabel) =>
    `Fit: ${modelsStr}${gammaStr ? ` · 7d/5h=${gammaStr}` : ''} (${shortCount} short win · ${errLabel})`,
  remoteWinBanner: (remoteUsd) => `Other devices / cloud (not in local totals): ~+${remoteUsd}`,
  remoteWinBannerTip:
    'Estimated active-window quota usage outside this machine (e.g. another laptop, cloud/web sessions, or unlogged calls). Local totals above only count App + CLI DBs stored on this computer.',
  spendSession: 'SESSION',
  spendToday: 'TODAY',
  spendMonth: 'MONTH',
  spendAll: 'ALL LOCAL',
  spendAllSourceTip: (appCost, appCalls, appDbs, cliCost, cliCalls, cliDbs) =>
    `Local DB breakdown:\nApp: ${appCost} (${appCalls} calls · ${appDbs} DBs)\nCLI (agy): ${cliCost} (${cliCalls} calls · ${cliDbs} DBs)`,
  spendSavedSub: (s) => `saved ${s}`,
  spendCallsSub: (n, dbs) => `${n} calls${dbs ? ` · ${dbs} DBs` : ''}`,
  spendIndexingSub: (idx, tot) => `indexing ${idx}/${tot} DBs…`,
  unpricedNote: (n) => `Local App+CLI API-equivalent estimate · excludes ${n} unpriced call(s) (GPT-OSS) & cache-write premiums`,
  pricedAllNote: 'Local App+CLI API-equivalent estimate from published token rates (excludes cache-write premiums)',
  histCostTip: (costStr, savedStr) => `\nEST COST: ${costStr}${savedStr ? ` (cache saved ${savedStr})` : ''}`,
  histUnpricedTip: '\nEST COST: unpriced model (GPT-OSS)',
  histQuotaPillTip: (pct5h, err5h, pct7d, kStr, isFitted) =>
    `Est. 5h quota burn: -${pct5h}${err5h ? ` ± ${err5h}` : ''}${pct7d ? ` · 7d: -${pct7d}` : ''} · ${kStr}× rate (${isFitted ? 'fitted' : 'prior'})`,
  histQuotaLine: (pct5h, err5h, pct7d, kStr, isFitted) =>
    `\nEST QUOTA: -${pct5h}${err5h ? ` ± ${err5h}` : ''} (5h)${pct7d ? ` · -${pct7d} (7d)` : ''} · ${kStr}× rate${isFitted ? '' : ' (prior)'}`,
  noDbEmpty: 'No active session DB detected yet.',

  // OpenRouter-style Call Detail Inspector
  inspTabOverview: 'Overview',
  inspTabThinking: 'Thinking',
  inspTabTools: 'Tools',
  inspTabReply: 'Reply',
  inspTabRaw: 'Raw',
  inspCopyMd: 'MD',
  inspCopyJson: 'JSON',
  inspCopy: 'Copy',
  inspCopyArgs: 'Copy Args',
  inspCopyMdReport: 'Copy Markdown Report',
  inspCopyFullJson: 'Copy Full JSON',
  inspGenE2e: 'GEN / E2E',
  inspTtftTotal: 'TTFT / TOTAL',
  inspCacheHit: 'CACHE HIT',
  inspCostQuota: 'COST / 5H',
  inspTtftFast: 'Fast',
  inspTtftMid: 'Moderate',
  inspTtftSlow: 'Slow',
  inspSaved: (s) => `Saved ${s}`,
  inspCachedTok: (tok) => `${tok} cached`,
  inspUnpriced: 'Unpriced',
  inspFitFitted: 'fitted',
  inspFitProv: 'est.',
  inspWaterfallTitle: 'TIMING WATERFALL',
  inspPhaseTtft: 'TTFT',
  inspPhaseThink: 'Think',
  inspPhaseTool: 'Tool Gen',
  inspPhaseToolStall: 'TC-WAIT',
  inspPhaseStream: 'Stream',
  inspPhaseGen: 'Generation',
  inspTokenCompTitle: 'TOKEN COMPOSITION',
  inspPromptLbl: (total, pct) => `Prompt ${total} (${pct} cached)`,
  inspOutputLbl: (total, thkPct) => `Output ${total}${thkPct > 0 ? ` (${thkPct}% thinking)` : ''}`,
  inspCachedSeg: 'Cached',
  inspNewInSeg: 'New In',
  inspThinkSeg: 'Think',
  inspVisibleSeg: 'Visible',
  inspMetaRouted: 'Routed',
  inspMetaCtx: 'Context',
  inspMetaPricing: 'Pricing',
  inspTruncated: 'truncated',
  inspChars: (n) => `${n} chars`,
  inspNoArgs: '(no arguments)',
  inspBufTag: 'BUF',
  inspStallTag: 'TC-WAIT',

  // Call Explorer Toolbar & Export
  searchPlaceholder: 'Search #id, model, tool, prompt… (/)',
  sortTimeline: 'Timeline (Newest)',
  sortSlowest: 'Slowest Total',
  sortTtft: 'Highest TTFT',
  sortLowTps: 'Lowest GEN TPS',
  sortCost: 'Highest Cost / Quota',
  chipSlowTtft: (n) => `Slow TTFT (${n})`,
  chipLowCache: (n) => `Low Cache (${n})`,
  chipStallBuf: (n) => `Stall / Buf (${n})`,
  chipModelFilter: (m) => `Model: ${m}`,
  filterBanner: (shown, total) => `Showing ${shown} of ${total} calls`,
  filterClear: 'Clear',
  filterNoMatches: 'No calls match the active filters.',
  btnExport: 'Export',
  btnCopyReportMd: 'Copy Session Report (MD)',
  btnExportJson: 'Export Telemetry (JSON)',
  exportedJsonCopied: 'Copied JSON!',
  exportedJsonSaved: 'Saved JSON!',

  // Self-Update UI (TopBar & AccountTab)
  updatePillTip: (cur, next) => `Update available: v${cur} → v${next} (click to view)`,
  menuCheckUpdates: 'Check for updates',
  menuCheckingUpdates: 'Checking…',
  menuDevTag: 'DEV',
  updateCardTitle: 'PLUGIN & UPDATES',
  updateModeInstalled: 'Installed',
  updateModeDev: 'Dev Symlink',
  updateBtnCheck: 'Check',
  updateBtnChecking: 'Checking…',
  updateBtnNow: 'Update Now',
  updateBtnUpdating: 'Updating…',
  updateBtnReload: 'Reload Now',
  updateReleaseNotes: 'Release Notes',
  updateStatusUpToDate: 'Up to date',
  updateStatusAhead: 'Ahead of latest release',
  updateStatusAvailable: (cur, next) => `Update available: v${cur} → v${next}`,
  updateStatusOffline: 'Unable to reach GitHub Releases (offline)',
  updateStatusRateLimited: 'GitHub API rate limit reached; try again later',
  updateStatusError: (msg) => `Update check failed: ${msg}`,
  updateDevHint: 'Dev symlink active — pull from git or run node plugin/install.mjs --update.',
  updateAppliedMsg: (ver) => `Updated to v${ver}. Reload the HUD pane to apply.`,
  updateApplyFailed: (msg) => `Update failed: ${msg}`,
  updateCliFallback: 'Manual CLI:',
  updateLastChecked: (tm) => `Checked ${tm}`,

  // HeroSpeedCards & LiveTab Model Mix
  heroDeltaTip: (deltaPct, avgTps) => `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}% vs session avg (${avgTps} tok/s)`,
  heroSparkTip: (n) => `Recent ${n} sustained calls GEN TPS trend`,
  modelMixTitle: 'SESSION MODEL MIX',
  modelMixCalls: (n) => `${n}c`,
  modelMixColModel: 'Model',
  modelMixColCalls: 'Calls',
  modelMixColGen: 'GEN',
  modelMixColTtft: 'TTFT',
  modelMixColCache: 'Cache',
  modelMixColCost: 'Cost / 5h',

  // Cache Survival & Expiration (Live Prediction & Account Stats)
  cacheSurvPill: (probPct, ageStr) => `Cache ~${probPct}% · ${ageStr}`,
  cacheSurvTip: ({
    ageStr,
    lastClock,
    probPct,
    familyName,
    p80Str,
    p50Str,
    remSafeStr,
    remHalfStr,
    pastHalf,
    sourceLabel,
    ctxTokStr,
    missUsdStr,
    missQuotaStr,
  }) => {
    const lines = [
      `Idle ${ageStr} since last call (${lastClock}) · Est. cache survival ~${probPct}%`,
      `${familyName} · Safe (P80) ~${p80Str} · Half-life (P50) ~${p50Str} (${sourceLabel})`,
    ];
    if (pastHalf) {
      lines.push('Past half-life — next turn has high chance of full prompt re-prefill');
    } else if (remSafeStr) {
      lines.push(`~${remSafeStr} left in P80 safe window · ~${remHalfStr} to half-life`);
    } else if (remHalfStr) {
      lines.push(`Past P80 safe window · ~${remHalfStr} left to half-life`);
    }
    if (missUsdStr) {
      lines.push(
        `Miss penalty (${ctxTokStr} ctx): +~${missUsdStr}${missQuotaStr ? ` (~-${missQuotaStr} 5h quota)` : ''}`,
      );
    }
    return lines.join('\n');
  },
  cacheTtlCardTitle: 'CACHE SURVIVAL',
  cacheTtlHeaderSummary: (pairs, missUsdStr) =>
    `${pairs.toLocaleString()} pairs${missUsdStr ? ` · +${missUsdStr}` : ''}`,
  cacheTtlEmpty: 'Collecting consecutive same-model call intervals…',
  cacheTtlKindLru: 'LRU decay',
  cacheTtlKindHard: 'Hard TTL',
  cacheTtlKindMixed: 'Empirical',
  cacheTtlConfFitted: (longN) => `Fitted (${longN} ≥3m)`,
  cacheTtlConfProv: (longN) => `Calibrating (${longN} ≥3m)`,
  cacheTtlConfPrior: 'Prior est.',
  cacheTtlP80Label: 'Safe (P80)',
  cacheTtlP50Label: 'Half-life (P50)',
  cacheTtlBgMissLabel: 'Noise miss',
  cacheTtlExpiredMissSub: (count, costStr) =>
    `${count} expired miss${count === 1 ? '' : 'es'}${costStr ? ` (+${costStr})` : ''}`,
  cacheTtlBucketTip: ({ label, hits, count, empPct, predPct }) =>
    count > 0
      ? `Idle ${label}\nObserved: ${hits}/${count} hits (${empPct})\nModel curve: ${predPct}`
      : `Idle ${label}\nNo observed samples yet\nModel curve: ${predPct}`,
  cacheTtlFootnote:
    'Log-logistic survival fit across deduplicated local same-model intervals (excluding /compact & rewinds).',
  cacheTtlHeaderSummaryTip: (pairs, missUsdStr) =>
    `${pairs.toLocaleString()} consecutive same-model intervals observed across local history${
      missUsdStr ? `\nExtra re-prefill API-eq cost from expired cache misses: +${missUsdStr}` : ''
    }`,
  cacheTtlP80Tip: (dur) =>
    `P80 Safe Window (~${dur}):\nIdle duration where prompt cache hit probability stays at or above 80%. Sending your next turn within this window usually avoids full re-prefill.`,
  cacheTtlP50Tip: (dur) =>
    `P50 Half-Life (~${dur}):\nIdle duration where cache hit probability drops to ~50%. Past this point, the prefix is likely evicted or expired.`,
  cacheTtlBgMissTip: (pct) =>
    `Short-Gap Noise (${pct}):\nBaseline cache miss rate even within <1m idle gaps, caused by backend replica switches or system-prompt prefix changes.`,
  cacheTtlLegendObserved: 'Observed',
  cacheTtlLegendFitted: 'Fitted curve',

  ctxMicroHeadroom: 'Headroom',
  ctxMicroCacheHit: 'Cache Hit',
  ctxMicroCacheTtl: 'Cache TTL',
  ctxMicroSpendQuota: 'Spend / 5h',
  heroCachePill: (pct) => `Cache ${pct}`,
  heroCacheTip: (pct, cached, newIn) =>
    `Latest call prompt cache hit: ${pct}\nCached: ${cached} tok · New input: ${newIn} tok\nHigher cache hit reduces prefill work and speeds up TTFT.`,
  kpiAvgGenTip: (avgGen, avgE2e) =>
    `Output-token-weighted average generation speed: ${avgGen} tok/s\nComputed as Σ outputTokens / Σ genSec across sustained (non-buffered) calls, so tiny 20-token replies don't distort sustained throughput.\nWeighted E2E (including TTFT): ${avgE2e} tok/s.`,
  kpiPeakCacheTip: (peak, avgCache) =>
    `Peak sustained generation speed: ${peak} tok/s\nSession average prompt cache hit rate: ${avgCache}`,
  kpiTtftOutTip: (avgTtft, totalOut) =>
    `Average Time-To-First-Token (TTFT): ${avgTtft}\nTotal generated output tokens (thinking + visible): ${totalOut} tok`,
  kpiTimeTip: (modelSec, toolSec, toolSteps) =>
    `Cumulative model time (TTFT + generation): ${modelSec}\nCumulative tool execution wall time: ${toolSec}${toolSteps > 0 ? ` (${toolSteps} tool steps)` : ''}`,
  spendScopeLabel: 'LOCAL (APP + CLI)',
  spendSessionTip:
    'API-equivalent list-price estimate for this active conversation only (100% local read-only telemetry; not billed to your card).',
  spendLocalScopeTip:
    'Local-only telemetry (Antigravity App + CLI + IDE on this machine). Usage on other devices is not stored in local DBs — active-window cross-device usage is estimated separately via the account quota delta.',
  activityViewHeatmap: 'Heatmap',
  activityViewIceberg: 'Iceberg',
  icebergNewLabel: 'New',
  icebergCachedLabel: 'Cached',
  icebergHint: 'New above · Cached below',
  icebergBarTip: (dateStr, newStr, cachedStr, hitPct, calls, costStr) =>
    `${dateStr}\nNew tokens (in+out): ${newStr}\nCached read: ${cachedStr} (Cache ${hitPct})\n${calls} calls · API-eq ${costStr}`,
};
