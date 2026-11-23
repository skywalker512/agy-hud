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
  tabQuota: string;
  noCalls: string;
  histTitle: string;
  histHint: string;
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
  tipQuota: (idx: number, m: string, pct5h: string, pct7d: string, kStr: string, costStr: string) => string;
  chartSubTps: (n: number, avg: string, max: string, last: string) => string;
  chartSubTtft: (n: number, avg: string, max: string, last: string) => string;
  chartSubOut: (n: number, avg: string, max: string, last: string) => string;
  chartSubCache: (n: number, avg: string, min: string, last: string) => string;
  chartSubCtx: (n: number, last: string, max: string) => string;
  chartSubQuota: (n: number, sum: string, avg: string, max: string) => string;
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
  turnDividerStats: (calls: number, outStr: string, secStr: string, compacts?: number, quotaStr?: string) => string;
  turnDividerTip: (n: number, tm: string, calls: number, outTok: number, secStr: string, prompt: string, compacts?: number, quotaStr?: string) => string;
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
  linkedMeta: (calls: number, outStr: string, costStr: string, quotaStr?: string) => string;
  cacheAgeLabel: (ageStr: string) => string;
  cacheAgeTip: (ageStr: string, tm: string) => string;
  sessionCostPill: (costStr: string, savedStr: string) => string;
  sessionCostTip: (costStr: string, savedStr: string, priced: number, unpriced: number) => string;
  sessionQuotaPill: (val: string) => string;
  sessionQuotaPoolLine: (
    poolName: string,
    active5h: string,
    active7d: string,
    expired5h: string,
    fallback5h: string,
    isFitted: boolean,
  ) => string;
  sessionQuotaTip: (lines: string) => string;
  accountTitle: string;
  creditsRealMini: (c: string) => string;
  creditsRealTip: (c: string) => string;
  quotaRefreshTip: (tm: string) => string;
  quotaDeferred: string;
  quotaOffline: string;
  heldByWeeklyTag: string;
  winMeta: (pct: number, resetStr: string) => string;
  winBudgetEst: (spent: string, full: string, lowSample?: boolean, remote?: string, effSpent?: string) => string;
  winSpentOnly: (spent: string, minPct?: string) => string;
  winRunwayWarn: (dur: string, clock: string) => string;
  winRunwaySafe: (remAtReset: string) => string;
  winRunwayExhausted: string;
  winRunwayTip: (
    burnPerHr: string,
    exhaustDur: string,
    exhaustClock: string,
    remAtReset: string,
    willExhaust: boolean,
    isRecent: boolean,
    habitBlended?: boolean,
    activeHoursPerDay?: number,
  ) => string;
  rulesTitle: string;
  rulesAccHigh: (errStr: string, wins: number) => string;
  rulesAccProv: (wins: number) => string;
  rulesDriftBadge: string;
  rules5hTankLabel: string;
  rules7dTankLabel: (ratioStr: string) => string;
  rulesTankRemSub: (remPct: string, remUsd: string) => string;
  rulesTankTip: (cap5h: string, cap7d: string) => string;
  rulesFormulaPill: (kStr: string, deductUsd: string) => string;
  rulesEffectiveApiCap: (usableApiUsd: string, poolFullUsd: string, isShrink: boolean) => string;
  rulesSourceTag: (isFitted: boolean) => string;
  rulesTokBurnStrip: (inPct: string, caPct: string, outPct: string, fullOutTok: string) => string;
  rulesPerTokCapBadge: (fullOutTok: string) => string;
  rulesTokInLabel: string;
  rulesTokCacheLabel: string;
  rulesTokOutLabel: string;
  rulesTokCapSub: (tok: string) => string;
  rulesModelTip: (family: string, kStr: string, deductUsd: string, usableApiUsd: string, obsCalls: number, isFitted: boolean) => string;
  heatmapTitle: string;
  heatmapSummary: (activeDays: number, streakDays: number, peakUsd: string) => string;
  heatmapLess: string;
  heatmapMore: string;
  heatmapMonths: string[];
  heatmapWeekdays: [string, string, string];
  heatmapDayTip: (
    dateStr: string,
    costStr: string,
    calls: number,
    appCalls: number,
    cliCalls: number,
    outStr: string,
  ) => string;
  heatmapEmptyTip: (dateStr: string) => string;
  poolTip: (label: string, winsText: string, held: boolean, fitNotes?: string, driftWarn?: boolean) => string;
  poolFitTipLine: (modelsStr: string, gammaStr: string, shortCount: number, errLabel: string) => string;
  remoteWinBanner: (remoteUsd: string) => string;
  remoteWinBannerTip: string;
  spendSession: string;
  spendToday: string;
  spendMonth: string;
  spendAll: string;
  spendAllSourceTip: (appCost: string, appCalls: number, appDbs: number, cliCost: string, cliCalls: number, cliDbs: number) => string;
  spendSavedSub: (s: string) => string;
  spendCallsSub: (n: number, dbs?: number) => string;
  spendIndexingSub: (idx: number, tot: number) => string;
  unpricedNote: (n: number) => string;
  pricedAllNote: string;
  histCostTip: (costStr: string, savedStr: string) => string;
  histUnpricedTip: string;
  histQuotaPillTip: (pct5h: string, err5h: string, pct7d: string, kStr: string, isFitted: boolean) => string;
  histQuotaLine: (pct5h: string, err5h: string, pct7d: string, kStr: string, isFitted: boolean) => string;
  noDbEmpty: string;

  // OpenRouter-style Call Detail Inspector
  inspTabOverview: string;
  inspTabThinking: string;
  inspTabTools: string;
  inspTabReply: string;
  inspTabRaw: string;
  inspCopyMd: string;
  inspCopyJson: string;
  inspCopy: string;
  inspCopyArgs: string;
  inspCopyMdReport: string;
  inspCopyFullJson: string;
  inspGenE2e: string;
  inspTtftTotal: string;
  inspCacheHit: string;
  inspCostQuota: string;
  inspTtftFast: string;
  inspTtftMid: string;
  inspTtftSlow: string;
  inspSaved: (s: string) => string;
  inspCachedTok: (tok: string) => string;
  inspUnpriced: string;
  inspFitFitted: string;
  inspFitProv: string;
  inspWaterfallTitle: string;
  inspPhaseTtft: string;
  inspPhaseThink: string;
  inspPhaseTool: string;
  inspPhaseToolStall: string;
  inspPhaseStream: string;
  inspPhaseGen: string;
  inspTokenCompTitle: string;
  inspPromptLbl: (total: string, pct: string) => string;
  inspOutputLbl: (total: string, thkPct: number) => string;
  inspCachedSeg: string;
  inspNewInSeg: string;
  inspThinkSeg: string;
  inspVisibleSeg: string;
  inspMetaRouted: string;
  inspMetaCtx: string;
  inspMetaPricing: string;
  inspTruncated: string;
  inspChars: (n: string) => string;
  inspNoArgs: string;
  inspBufTag: string;
  inspStallTag: string;

  // Call Explorer Toolbar & Export
  searchPlaceholder: string;
  sortTimeline: string;
  sortSlowest: string;
  sortTtft: string;
  sortLowTps: string;
  sortCost: string;
  chipSlowTtft: (n: number) => string;
  chipLowCache: (n: number) => string;
  chipStallBuf: (n: number) => string;
  chipModelFilter: (m: string) => string;
  filterBanner: (shown: number, total: number) => string;
  filterClear: string;
  filterNoMatches: string;
  btnExport: string;
  btnCopyReportMd: string;
  btnExportJson: string;
  exportedJsonCopied: string;
  exportedJsonSaved: string;

  // Self-Update UI (TopBar & AccountTab)
  updatePillTip: (cur: string, next: string) => string;
  menuCheckUpdates: string;
  menuCheckingUpdates: string;
  menuDevTag: string;
  updateCardTitle: string;
  updateModeInstalled: string;
  updateModeDev: string;
  updateBtnCheck: string;
  updateBtnChecking: string;
  updateBtnNow: string;
  updateBtnUpdating: string;
  updateBtnReload: string;
  updateReleaseNotes: string;
  updateStatusUpToDate: string;
  updateStatusAhead: string;
  updateStatusAvailable: (cur: string, next: string) => string;
  updateStatusOffline: string;
  updateStatusRateLimited: string;
  updateStatusError: (msg: string) => string;
  updateDevHint: string;
  updateAppliedMsg: (ver: string) => string;
  updateApplyFailed: (msg: string) => string;
  updateCliFallback: string;
  updateLastChecked: (tm: string) => string;

  // HeroSpeedCards & LiveTab Model Mix
  heroDeltaTip: (deltaPct: number, avgTps: string) => string;
  heroSparkTip: (n: number) => string;
  e2eSplitTtftLabel: string;
  e2eSplitGenLabel: string;
  e2eSplitTip: (
    ttftSec: string,
    ttftPct: number,
    genSec: string,
    genPct: number,
    genTps: string,
    e2eTps: string,
  ) => string;
  modelMixTitle: string;
  modelMixCalls: (n: number) => string;
  modelMixColModel: string;
  modelMixColCalls: string;
  modelMixColGen: string;
  modelMixColTtft: string;
  modelMixColCache: string;
  modelMixColCost: string;

  // Cache Survival & Expiration (Live Prediction & Account Stats)
  cacheSurvPill: (probPct: number, ageStr: string) => string;
  cacheSurvTip: (args: {
    ageStr: string;
    lastClock: string;
    probPct: number;
    familyName: string;
    p80Str: string;
    p50Str: string;
    remSafeStr: string;
    remHalfStr: string;
    pastHalf: boolean;
    sourceLabel: string;
    ctxTokStr: string;
    missUsdStr: string;
    missQuotaStr: string;
  }) => string;
  cacheTtlCardTitle: string;
  cacheTtlHeaderSummary: (pairs: number, missUsdStr: string) => string;
  cacheTtlEmpty: string;
  cacheTtlKindLru: string;
  cacheTtlKindHard: string;
  cacheTtlKindMixed: string;
  cacheTtlConfFitted: (longN: number) => string;
  cacheTtlConfProv: (longN: number) => string;
  cacheTtlConfPrior: string;
  cacheTtlP80Label: string;
  cacheTtlP50Label: string;
  cacheTtlBgMissLabel: string;
  cacheTtlExpiredMissSub: (count: number, costStr: string) => string;
  cacheTtlBucketTip: (args: {
    label: string;
    hits: number;
    count: number;
    empPct: string;
    predPct: string;
  }) => string;
  cacheTtlFootnote: string;
  cacheTtlHeaderSummaryTip: (pairs: number, missUsdStr: string) => string;
  cacheTtlP80Tip: (dur: string) => string;
  cacheTtlP50Tip: (dur: string) => string;
  cacheTtlBgMissTip: (pct: string) => string;
  cacheTtlLegendObserved: string;
  cacheTtlLegendFitted: string;

  // Context X-Ray micro-strip, Hero Cache%, KPI tooltips, Local Spend Scope & Iceberg
  ctxMicroHeadroom: string;
  ctxMicroCacheHit: string;
  ctxMicroCacheTtl: string;
  ctxMicroSpendQuota: string;
  heroCachePill: (pct: string) => string;
  heroCacheTip: (pct: string, cached: string, newIn: string) => string;
  kpiAvgGenTip: (avgGen: string, avgE2e: string) => string;
  kpiPeakCacheTip: (peak: string, avgCache: string) => string;
  kpiTtftOutTip: (avgTtft: string, totalOut: string) => string;
  kpiTimeTip: (modelSec: string, toolSec: string, toolSteps: number) => string;
  spendScopeLabel: string;
  spendSessionTip: string;
  spendLocalScopeTip: string;
  activityViewHeatmap: string;
  activityViewIceberg: string;
  icebergNewLabel: string;
  icebergCachedLabel: string;
  icebergHint: string;
  icebergBarTip: (
    dateStr: string,
    newStr: string,
    cachedStr: string,
    hitPct: string,
    calls: number,
    costStr: string,
  ) => string;
}
