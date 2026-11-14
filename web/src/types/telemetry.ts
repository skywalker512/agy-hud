export type Lang = 'en' | 'zh';
export type HudTab = 'live' | 'calls' | 'account';
export type ChartMetric = 'tps' | 'ttft' | 'out' | 'cache' | 'ctx';
export type ConvMode = 'auto' | 'latest' | 'custom';
export type SessionKind = 'main' | 'side_question' | 'subagent';

export interface ToolCallItem {
  name: string;
  args: string;
}

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
}

export interface ConversationItem {
  id: string;
  updatedMs: number;
  title: string;
  kind: SessionKind;
  parentId?: string;
  childCount?: number;
  costUSD?: number;
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
}

export interface ParentSessionItem {
  id: string;
  title: string;
  calls: number;
  outputTokens: number;
  costUSD: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  kind: SessionKind;
  subagentType: string;
  parentSession: ParentSessionItem | null;
  childSessions: ChildSessionItem[];
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
  estFullUSD?: number | null;
  estConfidence?: 'high' | 'prior' | 'low' | null;
  estMinSamplePct?: number;
  estPricedCalls?: number;
  estUnpricedCalls?: number;
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
  source?: string;
  ttlMs?: number;
  fetchedAtMs?: number;
}

export interface AccountHistory {
  dbCount: number;
  indexedCount: number;
  indexing: boolean;
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
