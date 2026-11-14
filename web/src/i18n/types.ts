export interface Translations {
  title: string;
  connecting: string;
  waitingModel: string;
  optAuto: string;
  optLatest: string;
  tabLive: string;
  tabCalls: string;
  tabAccount: string;
  genLabel: string;
  livePill: string;
  e2eLabel: string;
  ctxLabel: string;
  kCache: string;
  kIn: string;
  kThk: string;
  kOut: string;
  kSys: string;
  kFree: string;
  kSysPrompt: string;
  kToolsDef: string;
  kToolRes: string;
  kModel: string;
  kUserOther: string;
  ctxToolsLabel: string;
  ctxToolDefsLabel: string;
  ctxTurnLabel: string;
  ctxMoreTools: (n: number) => string;
  ctxToolChipTip: (name: string, tok: number, usedPct: number, winPct: number) => string;
  ctxSysSecTitle: string;
  ctxTdefTitle: (n: number) => string;
  ctxUserSplit: (u: number, c: number, s: number) => string;
  avgGen: string;
  peakTps: string;
  avgCache: string;
  modelTime: string;
  toolTime: string;
  avgTtft: string;
  totOut: string;
  recentTitle: string;
  viewAll: string;
  chartTitle: string;
  tabTps: string;
  tabTtft: string;
  tabOut: string;
  tabCache: string;
  tabCtx: string;
  noCalls: string;
  histTitle: string;
  histHint: string;
  waitStep: string;
  badgeWait: (s: string) => string;
  badgeGen: (s: string) => string;
  badgeCompact: (s: string) => string;
  badgeTool: (tool: string, s: string) => string;
  badgeToolWait: (tool: string, s: string) => string;
  badgeStandby: string;
  badgeStandbyTip: string;
  badgeWaitTip: string;
  badgeGenTip: string;
  badgeCompactTip: string;
  badgeIdle: string;
  badgeRetry: string;
  noDb: string;
  readErr: (e: string) => string;
  waitFirstCall: (id: string) => string;
  sessionMeta: (turns: number, steps: number, calls: number) => string;
  modelWaiting: (m: string) => string;
  modelRunning: (m: string) => string;
  modelCompact: (m: string) => string;
  modelTool: (m: string, tool: string) => string;
  chartMeta: (n: number) => string;
  genSubSust: (sust: string, ms: string, tok: number) => string;
  genSubBuf: (ms: string, tok: string) => string;
  genSubOk: (tok: string, sec: string) => string;
  e2eSub: (ttft: string, tot: string) => string;
  cacheBadge: (pct: number | null) => string;
  headroomLabel: (n: number) => string;
  headroomTip: (n: number, avgDelta: number) => string;
  segTip: (name: string, tok: number, winPct: number, usedPct: number) => string;
  tipBuf: (idx: number, m: string, ms: string, e2e: string, tok: number, cache: string, ttft: string) => string;
  tipOk: (idx: number, m: string, gen: string, e2e: string, tok: number, cache: string, ttft: string) => string;
  tipTtft: (idx: number, m: string, ttft: string, gen: string, tot: string) => string;
  tipOut: (idx: number, m: string, out: string, thk: string, vis: string, gen: string) => string;
  tipCache: (idx: number, m: string, cachePct: string, cached: string, newIn: string) => string;
  tipCtx: (idx: number, m: string, used: string, lim: string, pct: number) => string;
  chartSubTps: (n: number, avg: string, max: string, last: string) => string;
  chartSubTtft: (n: number, avg: string, max: string, last: string) => string;
  chartSubOut: (n: number, avg: string, max: string, last: string) => string;
  chartSubCache: (n: number, avg: string, min: string, last: string) => string;
  chartSubCtx: (n: number, last: string, max: string) => string;
  chartAllModels: (n: number) => string;
  chartModelFilterTip: (name: string, count: number, avgStr: string, active: boolean) => string;
  histDetail: (
    tm: string,
    cached: string,
    newIn: string,
    out: number,
    thk: number,
    ttft: string,
    gen: string,
    stallNote?: string,
  ) => string;
  histStallNote: (sec: string) => string;
  histPhaseLine: (thkSec: string, tcSec: string, n: number) => string;
  histFull: (
    idx: number,
    model: string,
    tm: string,
    cPct: string,
    cached: string,
    newIn: string,
    out: string,
    thk: string,
    vis: string,
    ttft: string,
    gen: string,
    e2e: string,
    ctxUsed: string,
    ctxLim: string,
    ctxPct: number,
  ) => string;
  histBuf: (ms: string) => string;
  loadingDetail: string;
  noDetailBody: string;
  waitOut: string;
  liveWaitBadge: string;
  liveStreamBadge: string;
  liveRowTagWait: string;
  liveRowTagStream: string;
  liveWaitDetail: (sec: string, startTm: string) => string;
  liveStreamDetail: (ttftStr: string, genSec: string) => string;
  lblThinking: string;
  lblReply: string;
  lblChars: (c: string, trunc: boolean) => string;
  lblToolCalls: string;
  lblSummary: string;
  compactFilterBtn: (n: number, on: boolean) => string;
  compactBadge: string;
  compactLiveBadge: string;
  compactLiveDetail: (sec: string, startTm: string, ctxStr?: string) => string;
  compactDetail: (tm: string, cached: string, newIn: string, out: string, sec: string, dropStr: string) => string;
  compactFull: (
    stepIdx: number,
    model: string,
    tm: string,
    dropStr: string,
    cached: string,
    newIn: string,
    out: string,
    thk: string,
    vis: string,
    sec: string,
  ) => string;
  noCompactions: string;
  foldAllTurns: string;
  unfoldAllTurns: string;
  showAllHistoryBtn: (shown: number, total: number) => string;
  collapseHistoryBtn: (limit: number) => string;
  turnDividerBadge: (n: number) => string;
  turnDividerStats: (calls: number, outStr: string, secStr: string, compacts?: number) => string;
  turnDividerTip: (n: number, tm: string, calls: number, outTok: number, secStr: string, prompt: string, compacts?: number) => string;
  btnCopyId: string;
  btnCopyJsonl: string;
  btnCopyJsonlFull: string;
  copied: string;
  tipCopyId: (id: string) => string;
  tipCopyJsonl: (p: string, exists: boolean) => string;
  tipCopyJsonlFull: (p: string, exists: boolean) => string;
  kindMain: string;
  kindSq: string;
  kindSub: string;
  backParent: (lbl: string) => string;
  linkedCount: (n: number) => string;
  linkedTitle: string;
  linkedHint: string;
  jumpAction: string;
  linkedMeta: (calls: number, outStr: string, costStr: string) => string;
  cacheAgeLabel: (ageStr: string) => string;
  cacheAgeTip: (ageStr: string, tm: string) => string;
  sessionCostPill: (costStr: string, savedStr: string) => string;
  sessionCostTip: (costStr: string, savedStr: string, priced: number, unpriced: number) => string;
  accountTitle: string;
  creditsRealMini: (c: string) => string;
  creditsRealTip: (c: string) => string;
  quotaRefreshTip: (tm: string) => string;
  quotaDeferred: string;
  quotaOffline: string;
  heldByWeeklyTag: string;
  winMeta: (pct: number, resetStr: string) => string;
  winBudgetEst: (spent: string, full: string, lowSample?: boolean) => string;
  winSpentOnly: (spent: string, minPct?: string) => string;
  poolTip: (label: string, winsText: string, held: boolean) => string;
  spendSession: string;
  spendToday: string;
  spendMonth: string;
  spendAll: string;
  spendSavedSub: (s: string) => string;
  spendCallsSub: (n: number, dbs?: number) => string;
  spendIndexingSub: (idx: number, tot: number) => string;
  unpricedNote: (n: number) => string;
  pricedAllNote: string;
  histCostTip: (costStr: string, savedStr: string) => string;
  histUnpricedTip: string;
  noDbEmpty: string;
}
