export type Lang = 'en' | 'zh';
export type HudTab = 'live' | 'calls' | 'account';
export type ChartMetric = 'tps' | 'ttft' | 'out' | 'cache' | 'ctx' | 'quota';
export type ConvMode = 'auto' | 'latest' | 'custom';
export type SessionKind = 'main' | 'side_question' | 'subagent';

export interface PoolQuotaUsageItem {
  pct5h: number;
  pct7d: number | null;
  active5hPct?: number | null;
  active7dPct?: number | null;
  isFitted?: boolean;
}

export interface SessionQuotaUsage {
  gemini?: PoolQuotaUsageItem;
  claude_gpt?: PoolQuotaUsageItem;
}

export interface ToolCallItem {
  name: string;
  args: string;
}

export type QuotaFitSource = 'fitted' | 'provisional' | 'prior';

export interface Invocation {
  idx: number;
  stepIdx: number | null;
  turnIndex: number | null;
  lastStepIndex: number | null;
  botId: string;
  modelEnum: number | null;
  model: string;
  modelId: string;
  modelDisplay: string;
  parentCascadeId: string;
  subagentType: string;
  newInput: number;
  cachedInput: number;
  totalPromptTokens: number;
  cacheHitPct: number | null;
  outputTokens: number;
  thinkingTokens: number;
  candidateTokens: number;
  ttftSec: number;
  genSec: number;
  totalSec: number;
  isBuffered: boolean;
  genTps: number;
  e2eTps: number;
  totalContext: number;
  contextLimit: number;
  contextPct: number;
  timestampMs: number;
  priced: boolean;
  pricingKey: string;
  costUSD: number;
  cacheSavedUSD: number;
  quotaPool?: string;
  quotaPct5h?: number;
  quotaPct5hErr?: number;
  quotaPct7d?: number | null;
  quotaMultiplierK?: number;
  quotaFitSource?: QuotaFitSource;
  thinkSec: number;
  toolGenSec: number;
  stepToolCount: number;
  isToolStall: boolean;
  hasThinking?: boolean;
  hasReply?: boolean;
  toolCount?: number;
  thinkingChars?: number;
  replyChars?: number;
  thinkingPreview?: string;
  replyPreview?: string;
  toolCalls?: ToolCallItem[];
}

export interface Compaction {
  stepIdx: number;
  turnIndex: number | null;
  afterGmIdx: number | null;
  timestampMs: number;
  durationSec: number;
  model: string;
  modelId: string;
  modelDisplay: string;
  cachedInput: number;
  newInput: number;
  outputTokens: number;
  thinkingTokens: number;
  candidateTokens: number;
  beforeCtx: number;
  afterCtx: number;
  afterCtxEstimated?: boolean;
  priced?: boolean;
  pricingKey?: string;
  costUSD?: number;
  cacheSavedUSD?: number;
  quotaPool?: string;
  quotaPct5h?: number;
  quotaPct5hErr?: number;
  quotaPct7d?: number | null;
  quotaMultiplierK?: number;
  quotaFitSource?: QuotaFitSource;
  hasSummary?: boolean;
  summaryPreview?: string;
}

export interface TurnSummary {
  turnIndex: number;
  stepIdx: number;
  timestampMs: number;
  promptPreview: string;
  promptFull?: string;
  hasFullPrompt?: boolean;
  isCompact?: boolean;
  compactCount?: number;
  callCount: number;
  outputTokens: number;
  totalSec: number;
  quotaPool?: string;
  quotaPct5h?: number;
  quotaPct7d?: number | null;
  quotaFitSource?: QuotaFitSource;
}

export interface ActiveStep {
  idx: number;
  stepType: number;
  status: number;
  statusName: string;
  turnIndex?: number | null;
  createdAtMs: number;
  streamStartMs: number;
  modelEnum: number | null;
  model: string;
  modelId: string;
  modelDisplay: string;
  toolName: string;
  thinkingPreview: string;
  thinkingChars: number;
  thinkingTruncated?: boolean;
  replyPreview: string;
  replyChars: number;
  replyTruncated?: boolean;
  toolCalls: ToolCallItem[];
}

export interface PendingCompact {
  stepIdx: number;
  createdAtMs: number;
}

export interface TokenBreakdownItem {
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  reportedTotal: number;
  contextLimit: number;
  systemPrompt: number;
  toolsSchema: number;
  chatMessages: number;
  userInput: number;
  assistant: number;
  toolResults: number;
  checkpoint: number;
  sysMsg: number;
  otherChat: number;
  userAndOther: number;
  systemPromptItems: TokenBreakdownItem[];
  toolSchemaItems: TokenBreakdownItem[];
  toolResultsByTool: TokenBreakdownItem[];
}

export interface CurrentModelInfo {
  model: string;
  modelId: string;
  modelDisplay: string;
  isActive: boolean;
  stepType: number | null;
  toolName: string;
  statusName?: string;
}

export interface TelemetrySummary {
  count: number;
  userTurns: number;
  totalSteps: number;
  toolStepCount: number;
  totalOutput: number;
  totalThinking: number;
  totalCandidate: number;
  totalCachedInput: number;
  totalNewInput: number;
  avgCacheHitPct: number | null;
  avgTtftSec: number;
  totalModelSec: number;
  totalToolSec: number;
  avgGenTps: number;
  avgE2eTps: number;
  peakGenTps: number;
  totalCostUSD: number;
  totalSavedUSD: number;
  pricedCount: number;
  unpricedCount: number;
  latestCallMs: number;
  sessionQuota?: SessionQuotaUsage | null;
}

export interface ConversationItem {
  id: string;
  updatedMs: number;
  title: string;
  kind: SessionKind;
  source?: string;
  parentId?: string;
  childCount?: number;
  costUSD?: number;
  quotaUsage?: SessionQuotaUsage | null;
}

export interface ChildSessionItem {
  id: string;
  kind: SessionKind;
  subagentType: string;
  title: string;
  calls: number;
  outputTokens: number;
  costUSD: number;
  savedUSD: number;
  pricedCount: number;
  unpricedCount: number;
  updatedMs: number;
  latestTsMs: number;
  quotaUsage?: SessionQuotaUsage | null;
}

export interface ParentSessionItem {
  id: string;
  title: string;
  calls: number;
  outputTokens: number;
  costUSD: number;
  quotaUsage?: SessionQuotaUsage | null;
}

export interface SessionInfo {
  id: string;
  title: string;
  kind: SessionKind;
  subagentType: string;
  quotaUsage?: SessionQuotaUsage | null;
  parentSession: ParentSessionItem | null;
  childSessions: ChildSessionItem[];
}

export interface QuotaWindowRunway {
  status: 'exhausted' | 'warning' | 'safe';
  burnPctPerHour: number;
  exhaustInSec: number;
  exhaustAtMs: number;
  willExhaustBeforeReset: boolean;
  projectedRemAtResetPct: number;
  basis?: string;
}

export interface QuotaWindow {
  spanKey: string;
  label: string;
  displayName?: string;
  description?: string;
  remainingPct: number;
  resetTime: string;
  resetAtMs: number;
  disabled?: boolean;
  estSpentUSD?: number;
  estEffectiveSpentUSD?: number;
  estRemoteUSD?: number;
  estRemoteUSDPlusMinus?: number;
  estRemotePct?: number;
  estRemotePctPlusMinus?: number;
  estPredLocalPct?: number;
  estResidualPct?: number;
  estBandPct?: number;
  estTotalUSD?: number;
  estFullUSD?: number | null;
  estConfidence?: 'high' | 'prior' | 'low' | null;
  estMinSamplePct?: number;
  estPricedCalls?: number;
  estUnpricedCalls?: number;
  runway?: QuotaWindowRunway | null;
}

export interface QuotaPoolFitModel {
  family: string;
  k: number;
  beta: number;
  betaPlusMinus: number;
  source?: string;
  mode?: string;
  baseRates?: number[];
  priorBeta?: number;
  priorRelDiffPct?: number;
  priorZScore?: number;
  tokenWeights?: number[];
  obsCalls: number;
}

export interface QuotaPoolFitSummary {
  quality: string;
  driftWarning?: boolean;
  driftReasons?: string[];
  full5hUSD: number | null;
  full7dUSD: number | null;
  gamma: number | null;
  sampleCount: number;
  shortCleanCount: number;
  holdoutCount: number;
  oosRelErrPct: number | null;
  relErrPct: number;
  models: QuotaPoolFitModel[];
}

export interface QuotaPool {
  label: string;
  description?: string;
  remainingPct: number;
  resetTime: string;
  resetAtMs: number;
  modelCount?: number;
  heldByWeekly: boolean;
  windows: QuotaWindow[];
  fitSummary?: QuotaPoolFitSummary | null;
}

export interface RemoteQuotaEstimate {
  activeWindowUSD: number;
  activeWindowPlusMinusUSD?: number;
  window5hUSD: number;
  window7dUSD: number;
  snapshotAtMs: number;
}

export interface AccountQuota {
  available: boolean;
  deferred?: boolean;
  stale?: boolean;
  reason?: string;
  name?: string;
  tierName?: string;
  planName?: string;
  teamsTier?: string;
  availableCredits?: number | null;
  pools?: QuotaPool[];
  remoteEstimate?: RemoteQuotaEstimate;
  source?: string;
  ttlMs?: number;
  fetchedAtMs?: number;
}

export interface DailyHeatmapDay {
  date: string;
  calls: number;
  appCalls: number;
  cliCalls: number;
  costUSD: number;
  outputTokens: number;
}

export interface DailyHeatmapSummary {
  weeks: number;
  activeDays: number;
  streakDays: number;
  peakCostUSD: number;
  peakDate: string;
  days: DailyHeatmapDay[];
}

export interface AccountHistory {
  dbCount: number;
  dbCountBySource?: Record<string, number>;
  indexedCount: number;
  indexing: boolean;
  callsBySource?: Record<string, number>;
  costBySource?: Record<string, number>;
  totalCalls: number;
  totalOutput: number;
  totalCostUSD: number;
  totalSavedUSD: number;
  pricedCount: number;
  unpricedCount: number;
  todayCalls: number;
  todayCostUSD: number;
  todaySavedUSD: number;
  monthCalls: number;
  monthCostUSD: number;
  monthSavedUSD: number;
  dailyHeatmap?: DailyHeatmapSummary;
}

export interface StatsSnapshot {
  unchanged?: boolean;
  found?: boolean;
  error?: string;
  etag?: string;
  bootId?: string;
  assetKey?: string;
  mode?: string;
  conversationId?: string;
  dbPath?: string;
  jsonlPath?: string;
  jsonlFullPath?: string;
  jsonlExists?: boolean;
  jsonlFullExists?: boolean;
  serverTimeMs?: number;
  conversations?: ConversationItem[];
  sessionInfo?: SessionInfo;
  accountHistory?: AccountHistory;
  accountQuota?: AccountQuota;
  invocations?: Invocation[];
  latest?: Invocation | null;
  latestSustained?: Invocation | null;
  currentModel?: CurrentModelInfo | null;
  summary?: TelemetrySummary;
  activeStep?: ActiveStep | null;
  pendingCompact?: PendingCompact | null;
  compactions?: Compaction[];
  turns?: TurnSummary[];
  contextBreakdown?: ContextBreakdown | null;
}

export interface CallDetailPayload {
  thinkingPreview?: string;
  thinkingChars?: number;
  replyPreview?: string;
  replyChars?: number;
  toolCalls?: ToolCallItem[];
  summaryPreview?: string;
  promptFull?: string;
}

export interface CallDetailResponse {
  found: boolean;
  conversationId?: string;
  kind?: 'inv' | 'compact' | 'turn';
  id?: number;
  detail?: CallDetailPayload;
  reason?: string;
}

export interface SidecarBridge {
  conversationId?: string;
  fetch?: typeof fetch;
}

declare global {
  interface Window {
    sidecar?: SidecarBridge;
  }
}
