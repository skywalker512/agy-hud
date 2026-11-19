import http from 'node:http';
import https from 'node:https';
import {
  clipLiveStreamText,
  clipText,
  DETAIL_TOOL_ARGS_MAX,
  KNOWN_LS_PLACEHOLDERS,
  LIVE_STREAM_PREVIEW_MAX,
  LS_ACTIVE_STEP_STATUSES,
  LS_TERMINAL_STEP_STATUSES,
  parseIsoMs,
  QUOTA_TTL_MS,
} from './constants.mjs';
import { isCompactPromptText } from './protobuf.mjs';

export const lsModelCatalog = new Map();
let lsModelCatalogVersion = 0;
let lsCatalogWarmInFlight = null;
let lsCatalogWarmAtMs = 0;
let workingLsBaseUrl = '';

export function getLsModelCatalogVersion() {
  return lsModelCatalogVersion;
}

export const quotaCache = {
  data: { available: false, reason: 'init' },
  fetchedAtMs: 0,
  updatedSeq: 0,
  inFlight: null,
  inFlightForce: false,
};

export function isLoopbackHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

export function normalizeLsBaseUrl(rawAddr) {
  if (!rawAddr) return '';
  let addr = String(rawAddr).trim();
  if (!addr) return '';
  if (addr.startsWith(':')) addr = `127.0.0.1${addr}`;
  if (!/^https?:\/\//i.test(addr)) addr = `https://${addr}`;
  return addr.replace(/\/+$/, '');
}

function postConnectJson(urlStr, headers, payload, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = url.protocol === 'https:';
    const isLocal = isLoopbackHost(url.hostname);
    const mod = isHttps ? https : http;
    const body = JSON.stringify(payload);
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      timeout: timeoutMs,
      rejectUnauthorized: !isLocal,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connect-Protocol-Version': '1',
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export async function postLsRpc(method, payload, timeoutMs = 1500) {
  const rawAddr = process.env.ANTIGRAVITY_LS_ADDRESS || '';
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  if (!rawAddr || !csrf) throw new Error('no_ls_env');
  const baseUrl = workingLsBaseUrl || normalizeLsBaseUrl(rawAddr);
  const path = `/exa.language_server_pb.LanguageServerService/${method}`;
  const headers = { 'x-codeium-csrf-token': csrf };

  let isLocal = false;
  try {
    isLocal = isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    isLocal = false;
  }

  const candidates = [baseUrl];
  if (isLocal && !workingLsBaseUrl && !/^https?:\/\//i.test(rawAddr.trim()) && baseUrl.startsWith('https://')) {
    candidates.push(baseUrl.replace(/^https:/, 'http:'));
  }

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const json = await postConnectJson(`${candidate}${path}`, headers, payload, timeoutMs);
      workingLsBaseUrl = candidate;
      return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('rpc_error');
}

function shortModelFamilyLabel(m) {
  const s = `${m.label || ''} ${m.modelId || ''}`.toLowerCase();
  if (s.includes('claude')) return 'Claude';
  if (s.includes('gpt-oss')) return 'GPT-OSS';
  if (s.includes('flash')) return 'Flash';
  if (s.includes('orchestrator')) return 'Orchestrator';
  if (s.includes('gemini')) return 'Gemini';
  return (m.label || m.modelId || 'Pool').split(/\s+/)[0];
}

function shortQuotaGroupLabel(rawName) {
  const s = String(rawName || '').trim();
  if (!s) return 'Pool';
  if (/^gemini\s+models$/i.test(s)) return 'Gemini';
  if (/^claude\s+and\s+gpt\s+models$/i.test(s)) return 'Claude & GPT';
  return s.replace(/\s+models$/i, '');
}

function classifyWindowSpan(bucket) {
  const raw = String(bucket?.window || bucket?.bucketId || bucket?.displayName || '').toLowerCase();
  if (/7\s*d|week/.test(raw)) return '7d';
  if (/5\s*h|hour/.test(raw)) return '5h';
  return bucket?.window || bucket?.displayName || '5h';
}

export function normalizeQuotaSummary(raw) {
  const summary = raw?.response || raw?.summary || raw?.quotaSummary || raw;
  const groups = Array.isArray(summary?.groups) ? summary.groups : [];
  if (!groups.length) return [];

  const pools = [];
  for (const g of groups) {
    const buckets = Array.isArray(g?.buckets) ? g.buckets : [];
    const bySpan = new Map();
    for (const b of buckets) {
      const hasFraction = typeof b?.remainingFraction === 'number';
      if (b?.disabled && !hasFraction && !b?.resetTime) continue;
      if (!hasFraction && !b?.resetTime) continue;
      const frac = hasFraction ? Math.max(0, Math.min(1, b.remainingFraction)) : 0;
      const spanKey = classifyWindowSpan(b);
      const resetTime = b?.resetTime || '';
      const resetAtMs = resetTime ? Date.parse(resetTime) || 0 : 0;
      const win = {
        spanKey,
        label: b?.window || spanKey,
        displayName: b?.displayName || '',
        description: b?.description || '',
        remainingPct: frac * 100,
        resetTime,
        resetAtMs,
        disabled: Boolean(b?.disabled),
      };
      const prev = bySpan.get(spanKey);
      if (!prev || win.remainingPct < prev.remainingPct) {
        bySpan.set(spanKey, win);
      }
    }
    if (!bySpan.size) continue;

    const orderWeight = (span) => (span === '5h' ? 0 : span === '7d' ? 1 : 2);
    const windows = [...bySpan.values()].sort((a, b) => orderWeight(a.spanKey) - orderWeight(b.spanKey));
    const fiveWin = windows.find((w) => w.spanKey === '5h') || null;
    const weeklyWin = windows.find((w) => w.spanKey === '7d') || null;
    const heldByWeekly = Boolean(weeklyWin && weeklyWin.remainingPct <= 0 && (!fiveWin || fiveWin.remainingPct > 0));

    let primaryWin = windows[0];
    if (heldByWeekly && weeklyWin) {
      primaryWin = weeklyWin;
    } else {
      for (const w of windows) {
        if (w.remainingPct < primaryWin.remainingPct) primaryWin = w;
      }
    }

    pools.push({
      label: shortQuotaGroupLabel(g?.displayName || g?.description || 'Pool'),
      description: g?.description || '',
      remainingPct: Math.min(...windows.map((w) => w.remainingPct)),
      resetTime: primaryWin?.resetTime || '',
      resetAtMs: primaryWin?.resetAtMs || 0,
      heldByWeekly,
      windows,
    });
  }
  return pools;
}

export function normalizeUserStatus(raw) {
  const us = raw?.userStatus;
  if (!us) return { available: false, reason: 'empty' };
  const ps = us.planStatus || {};
  const pi = ps.planInfo || {};
  const ut = us.userTier || {};
  const configs = us.cascadeModelConfigData?.clientModelConfigs || [];

  const poolMap = new Map();
  for (const cfg of configs) {
    const alias = cfg?.modelOrAlias?.model;
    if (alias && (cfg.modelId || cfg.label)) {
      const nextInfo = {
        model: cfg.modelId || cfg.label || alias,
        modelId: cfg.modelId || '',
        modelDisplay: cfg.label || cfg.modelId || alias,
      };
      const prevInfo = lsModelCatalog.get(alias);
      if (!prevInfo || prevInfo.modelDisplay !== nextInfo.modelDisplay || prevInfo.modelId !== nextInfo.modelId) {
        lsModelCatalog.set(alias, nextInfo);
        lsModelCatalogVersion += 1;
      }
    }
    const q = cfg?.quotaInfo;
    if (!q || typeof q.remainingFraction !== 'number') continue;
    const pctKey = q.remainingFraction.toFixed(6);
    const resetKey = q.resetTime || '';
    const key = `${resetKey}|${pctKey}`;
    if (!poolMap.has(key)) {
      poolMap.set(key, {
        remainingPct: Math.max(0, Math.min(100, q.remainingFraction * 100)),
        resetTime: resetKey,
        resetAtMs: resetKey ? Date.parse(resetKey) || 0 : 0,
        families: new Set(),
        modelCount: 0,
      });
    }
    const bucket = poolMap.get(key);
    bucket.families.add(shortModelFamilyLabel(cfg));
    bucket.modelCount += 1;
  }

  const pools = [...poolMap.values()].map((p) => ({
    label: [...p.families].join(' / '),
    remainingPct: p.remainingPct,
    resetTime: p.resetTime,
    resetAtMs: p.resetAtMs,
    modelCount: p.modelCount,
    heldByWeekly: false,
    windows: [
      {
        spanKey: '5h',
        label: '5h',
        remainingPct: p.remainingPct,
        resetTime: p.resetTime,
        resetAtMs: p.resetAtMs,
      },
    ],
  }));

  const availableCredits = typeof ut.availableCredits === 'number' && ut.availableCredits > 0
    ? ut.availableCredits
    : null;

  return {
    available: true,
    name: us.name || '',
    tierName: ut.name || ut.id || '',
    planName: pi.planName || '',
    teamsTier: pi.teamsTier || '',
    availableCredits,
    pools,
    source: 'user_status',
    fetchedAtMs: Date.now(),
  };
}

export function ensureLsModelCatalogWarm() {
  if (lsModelCatalog.size > 0 || lsCatalogWarmInFlight) return;
  if (!process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) return;
  const now = Date.now();
  if (now - lsCatalogWarmAtMs < 30_000) return;
  lsCatalogWarmAtMs = now;
  lsCatalogWarmInFlight = postLsRpc('GetUserStatus', { metadata: { ideName: 'antigravity' } }, 1500)
    .then((res) => { normalizeUserStatus(res); })
    .catch(() => {})
    .finally(() => { lsCatalogWarmInFlight = null; });
}

export function resolveLsGeneratorModel(genModel, fallbackModel = null) {
  if (genModel && lsModelCatalog.has(genModel)) return lsModelCatalog.get(genModel);
  if (genModel) {
    ensureLsModelCatalogWarm();
    const tierMatch = /^(.+)-(xhigh|high|medium|low|minimal)$/i.exec(genModel);
    if (tierMatch) {
      const baseId = tierMatch[1];
      const tierRaw = tierMatch[2].toLowerCase();
      const tierCap = tierRaw === 'xhigh'
        ? 'XHigh'
        : tierRaw[0].toUpperCase() + tierRaw.slice(1);
      const knownBase = lsModelCatalog.get(baseId) || KNOWN_LS_PLACEHOLDERS.get(baseId);
      if (knownBase) {
        return {
          model: knownBase.modelId || baseId,
          modelId: knownBase.modelId || baseId,
          modelDisplay: `${knownBase.modelDisplay || baseId} (${tierCap})`,
        };
      }
      if (!/^MODEL_PLACEHOLDER_/i.test(baseId)) {
        return {
          model: baseId,
          modelId: baseId,
          modelDisplay: `${baseId} (${tierCap})`,
        };
      }
    }
    if (KNOWN_LS_PLACEHOLDERS.has(genModel)) {
      return KNOWN_LS_PLACEHOLDERS.get(genModel);
    }
    if (/^MODEL_PLACEHOLDER_/i.test(genModel)) {
      return fallbackModel || { model: '', modelId: '', modelDisplay: '' };
    }
    return { model: genModel, modelId: genModel, modelDisplay: genModel };
  }
  if (fallbackModel) return fallbackModel;
  return { model: '', modelId: '', modelDisplay: '' };
}

export function isCascadeStatusActive(status) {
  const s = String(status || '');
  return Boolean(
    s
    && s !== 'CASCADE_RUN_STATUS_IDLE'
    && s !== 'CASCADE_RUN_STATUS_UNSPECIFIED'
    && !/IDLE|DONE|COMPLETED|CANCEL|FAIL|ERROR/i.test(s)
  );
}

export function isCompactUserInputLs(userInput) {
  if (!userInput || typeof userInput !== 'object') return false;
  const direct = userInput.userResponse || userInput.text || userInput.query || '';
  if (isCompactPromptText(direct)) return true;

  if (Array.isArray(userInput.items)) {
    const joinedText = userInput.items
      .map((it) => (typeof it?.text === 'string' ? it.text : ''))
      .filter(Boolean)
      .join(' ');
    if (isCompactPromptText(joinedText)) return true;

    for (const it of userInput.items) {
      if (!it || typeof it !== 'object') continue;
      const { text: _ignoreText, ...rest } = it;
      if (!Object.keys(rest).length) continue;
      const serialized = JSON.stringify(rest);
      if (/collapse_all/i.test(serialized) || /"compact"/i.test(serialized)) {
        return true;
      }
    }
  }
  return false;
}

export function extractLiveStepFromTrajectory({
  stepCount = 0,
  runStatus = '',
  lastModifiedTime = '',
  steps = [],
  offset = 0,
  nowMs = Date.now(),
}) {
  const isCascadeActive = isCascadeStatusActive(runStatus);
  if (!isCascadeActive) {
    return { available: true, sig: `idle:${stepCount}`, liveStep: null };
  }

  const tailSlice = steps.length > (stepCount - offset + 2) ? steps.slice(-8) : steps;
  const baseIdx = steps.length > tailSlice.length
    ? Math.max(0, stepCount - tailSlice.length)
    : offset;

  let sawUserInputBarrier = false;
  let lastKnownModel = null;

  for (let i = tailSlice.length - 1; i >= 0; i--) {
    const st = tailSlice[i];
    if (!st) continue;
    const meta = st.metadata || {};
    const idx = baseIdx + i;
    const createdAtMs = parseIsoMs(meta.createdAt);
    const startedAtMs = parseIsoMs(meta.startedAt);
    const mInfo = resolveLsGeneratorModel(meta.generatorModel);
    if (!lastKnownModel && (mInfo.modelDisplay || mInfo.model)) {
      lastKnownModel = mInfo;
    }

    const activeInfo = LS_ACTIVE_STEP_STATUSES.get(st.status)
      || (st.status && st.status !== 'CORTEX_STEP_STATUS_UNSPECIFIED' && !LS_TERMINAL_STEP_STATUSES.has(st.status)
        ? { code: 2, name: String(st.status).replace(/^CORTEX_STEP_STATUS_/, '') || 'RUNNING' }
        : null);

    if (st.type === 'CORTEX_STEP_TYPE_CHECKPOINT') {
      const isTerminalCheckpoint = Boolean(
        (st.status && st.status !== 'CORTEX_STEP_STATUS_UNSPECIFIED' && LS_TERMINAL_STEP_STATUSES.has(st.status))
        || parseIsoMs(meta.completedAt) > 0
        || parseIsoMs(meta.finishedAt) > 0
      );
      if (!isTerminalCheckpoint) {
        const code = activeInfo?.code || 2;
        const liveStep = {
          idx,
          stepType: 23,
          status: code,
          statusName: 'COMPACTING',
          createdAtMs: startedAtMs || createdAtMs || parseIsoMs(lastModifiedTime) || nowMs,
          streamStartMs: 0,
          modelEnum: null,
          model: mInfo.model,
          modelId: mInfo.modelId,
          modelDisplay: mInfo.modelDisplay,
          toolName: '',
          thinkingPreview: '',
          thinkingChars: 0,
          replyPreview: '',
          replyChars: 0,
          toolCalls: [],
        };
        return { available: true, sig: `${stepCount}:${idx}:23:${code}`, liveStep };
      }
      break;
    }

    if (activeInfo && !sawUserInputBarrier) {
      if (st.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
        const transitions = meta.internalMetadata?.statusTransitions || [];
        const genTrans = transitions.find((x) => x?.updatedStatus === 'CORTEX_STEP_STATUS_GENERATING');
        const streamStartMs = genTrans
          ? parseIsoMs(genTrans.timestamp)
          : (st.status === 'CORTEX_STEP_STATUS_GENERATING' ? (parseIsoMs(meta.viewableAt) || nowMs) : 0);
        const pr = st.plannerResponse || {};
        const rawThinking = pr.thinking || '';
        const rawReply = pr.modifiedResponse || pr.response || '';
        const tLive = clipLiveStreamText(rawThinking, LIVE_STREAM_PREVIEW_MAX);
        const rLive = clipLiveStreamText(rawReply, LIVE_STREAM_PREVIEW_MAX);
        const rawTcs = (pr.toolCalls || []).filter((tc) => tc?.name);
        let toolArgsChars = 0;
        const toolCalls = rawTcs.map((tc) => {
          const rawArgs = tc.argumentsJson || '';
          toolArgsChars += rawArgs.length;
          return { name: tc.name, args: clipText(rawArgs, DETAIL_TOOL_ARGS_MAX) };
        });

        const liveStep = {
          idx,
          stepType: 15,
          status: activeInfo.code,
          statusName: activeInfo.name,
          createdAtMs,
          streamStartMs,
          modelEnum: null,
          model: mInfo.model,
          modelId: mInfo.modelId,
          modelDisplay: mInfo.modelDisplay,
          toolName: '',
          thinkingPreview: tLive.text,
          thinkingChars: tLive.totalChars,
          thinkingTruncated: tLive.truncatedHead,
          replyPreview: rLive.text,
          replyChars: rLive.totalChars,
          replyTruncated: rLive.truncatedHead,
          toolCalls,
        };
        const sig = `${stepCount}:${idx}:15:${activeInfo.code}:${streamStartMs ? 1 : 0}:${tLive.totalChars}:${rLive.totalChars}:${toolCalls.length}:${toolArgsChars}`;
        return { available: true, sig, liveStep };
      }

      if (st.type !== 'CORTEX_STEP_TYPE_USER_INPUT') {
        const rawType = String(st.type || '').replace(/^CORTEX_STEP_TYPE_/, '').toLowerCase();
        const toolName = meta.toolCall?.name || rawType || 'tool';
        const liveStep = {
          idx,
          stepType: 132,
          status: activeInfo.code,
          statusName: activeInfo.name,
          createdAtMs: startedAtMs || createdAtMs,
          streamStartMs: 0,
          modelEnum: null,
          model: mInfo.model,
          modelId: mInfo.modelId,
          modelDisplay: mInfo.modelDisplay,
          toolName,
          thinkingPreview: '',
          thinkingChars: 0,
          replyPreview: '',
          replyChars: 0,
          toolCalls: [],
        };
        return { available: true, sig: `${stepCount}:${idx}:132:${activeInfo.code}:${toolName}`, liveStep };
      }
    }

    if (st.type === 'CORTEX_STEP_TYPE_USER_INPUT') {
      if (isCompactUserInputLs(st.userInput)) {
        const liveStep = {
          idx,
          stepType: 23,
          status: 2,
          statusName: 'COMPACTING',
          createdAtMs: startedAtMs || createdAtMs || parseIsoMs(lastModifiedTime) || nowMs,
          streamStartMs: 0,
          modelEnum: null,
          model: mInfo.model,
          modelId: mInfo.modelId,
          modelDisplay: mInfo.modelDisplay,
          toolName: '',
          thinkingPreview: '',
          thinkingChars: 0,
          replyPreview: '',
          replyChars: 0,
          toolCalls: [],
        };
        return { available: true, sig: `${stepCount}:${idx}:23:compact_cmd`, liveStep };
      }
      sawUserInputBarrier = true;
      continue;
    }

    if (st.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' || st.type === 'CORTEX_STEP_TYPE_FINISH') {
      break;
    }
  }

  const fallbackTs = parseIsoMs(lastModifiedTime) || nowMs;
  const isCompactRun = /COMPACT|CHECKPOINT/i.test(runStatus);
  const fbModel = lastKnownModel || { model: '', modelId: '', modelDisplay: '' };
  return {
    available: true,
    sig: `run:${runStatus}:${stepCount}:${fbModel.modelId || fbModel.model || ''}`,
    liveStep: {
      idx: Math.max(0, stepCount),
      stepType: isCompactRun ? 23 : 15,
      status: 2,
      statusName: isCompactRun ? 'COMPACTING' : 'RUNNING',
      createdAtMs: fallbackTs,
      streamStartMs: 0,
      modelEnum: null,
      model: fbModel.model,
      modelId: fbModel.modelId,
      modelDisplay: fbModel.modelDisplay,
      toolName: '',
      thinkingPreview: '',
      thinkingChars: 0,
      replyPreview: '',
      replyChars: 0,
      toolCalls: [],
      syntheticFallback: !isCompactRun,
    },
  };
}

const trajectoriesCache = {
  summaries: null,
  fetchedAtMs: 0,
  inFlight: null,
};

export async function getCascadeSummariesCached(ttlMs = 600) {
  if (!process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) {
    return null;
  }
  const now = Date.now();
  if (trajectoriesCache.summaries && now - trajectoriesCache.fetchedAtMs < ttlMs) {
    return trajectoriesCache.summaries;
  }
  if (trajectoriesCache.inFlight) {
    return trajectoriesCache.inFlight;
  }
  trajectoriesCache.inFlight = postLsRpc('GetAllCascadeTrajectories', {}, 1200)
    .then((all) => {
      const map = all?.trajectorySummaries || {};
      trajectoriesCache.summaries = map;
      trajectoriesCache.fetchedAtMs = Date.now();
      return map;
    })
    .catch(() => null)
    .finally(() => {
      trajectoriesCache.inFlight = null;
    });
  return trajectoriesCache.inFlight;
}

const liveStepCache = new Map();

export async function fetchLiveActiveStep(cascadeId, preloadedSummaries = undefined) {
  if (!cascadeId || !process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) {
    return null;
  }
  const now = Date.now();
  const cached = liveStepCache.get(cascadeId);
  if (cached) {
    if (cached.inFlight) return cached.inFlight;
    if (now - cached.atMs < 350) return cached.value;
  }

  const runFetch = async () => {
    try {
      const summaries = preloadedSummaries !== undefined
        ? preloadedSummaries
        : await getCascadeSummariesCached(600);
      if (!summaries) return null;
      const sum = summaries[cascadeId];
      if (!sum) return { available: true, sig: 'idle', liveStep: null };
      const stepCount = Number(sum.stepCount || 0);
      const runStatus = String(sum.status || '');
      if (!isCascadeStatusActive(runStatus)) {
        return { available: true, sig: `idle:${stepCount}`, liveStep: null };
      }

      const offset = Math.max(0, stepCount - 8);
      let steps = [];
      if (stepCount > 0) {
        try {
          const tail = await postLsRpc('GetCascadeTrajectorySteps', { cascadeId, stepOffset: offset }, 1200);
          steps = Array.isArray(tail?.steps) ? tail.steps : [];
        } catch {
          steps = [];
        }
      }

      return extractLiveStepFromTrajectory({
        stepCount,
        runStatus,
        lastModifiedTime: sum.lastModifiedTime || '',
        steps,
        offset,
      });
    } catch {
      return null;
    }
  };

  const p = runFetch().then((val) => {
    liveStepCache.set(cascadeId, { atMs: Date.now(), value: val, inFlight: null });
    if (liveStepCache.size > 24) {
      const oldest = liveStepCache.keys().next().value;
      if (oldest) liveStepCache.delete(oldest);
    }
    return val;
  });
  liveStepCache.set(cascadeId, { atMs: cached?.atMs || 0, value: cached?.value || null, inFlight: p });
  return p;
}

async function refreshUserStatus(forceRefresh = false) {
  if (!process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) {
    quotaCache.data = { available: false, reason: 'no_ls_env' };
    quotaCache.fetchedAtMs = Date.now();
    return quotaCache.data;
  }
  try {
    const reqStartedAtMs = Date.now();
    const summaryPayload = forceRefresh ? { forceRefresh: true } : {};
    const summaryTimeoutMs = forceRefresh ? 3500 : 2200;
    const [statusRes, summaryRes] = await Promise.allSettled([
      postLsRpc('GetUserStatus', { metadata: { ideName: 'antigravity' } }, 1500),
      postLsRpc('RetrieveUserQuotaSummary', summaryPayload, summaryTimeoutMs),
    ]);
    const fetchedAtMs = Date.now();

    const statusNorm = statusRes.status === 'fulfilled'
      ? normalizeUserStatus(statusRes.value)
      : { available: false, reason: statusRes.reason?.message || 'user_status_error' };
    const summaryPools = summaryRes.status === 'fulfilled'
      ? normalizeQuotaSummary(summaryRes.value)
      : [];
    const summaryReason = summaryPools.length
      ? ''
      : (summaryRes.status === 'rejected'
          ? (summaryRes.reason?.message || 'summary_rpc_error')
          : 'summary_empty');

    if (!statusNorm.available && !summaryPools.length) {
      const errMsg = (statusRes.status === 'rejected' && statusRes.reason?.message)
        || (summaryRes.status === 'rejected' && summaryRes.reason?.message)
        || statusNorm.reason
        || 'rpc_error';
      quotaCache.data = {
        ...(quotaCache.data?.available ? quotaCache.data : { available: false }),
        stale: !!quotaCache.data?.available,
        reason: errMsg,
        fetchedAtMs: Date.now(),
      };
      quotaCache.fetchedAtMs = Date.now();
      return quotaCache.data;
    }

    const base = statusNorm.available
      ? statusNorm
      : {
          available: true,
          name: quotaCache.data?.name || '',
          tierName: quotaCache.data?.tierName || '',
          planName: quotaCache.data?.planName || '',
          teamsTier: quotaCache.data?.teamsTier || '',
          availableCredits: quotaCache.data?.availableCredits ?? null,
          pools: [],
        };

    // Never downgrade a previously fetched 2-window 'summary' snapshot to GetUserStatus's stale
    // 5h-only cached quotaInfo when RetrieveUserQuotaSummary transiently times out!
    if (!summaryPools.length && quotaCache.data?.source === 'summary' && quotaCache.data?.pools?.length) {
      const preserved = {
        ...quotaCache.data,
        name: base.name || quotaCache.data.name,
        tierName: base.tierName || quotaCache.data.tierName,
        planName: base.planName || quotaCache.data.planName,
        teamsTier: base.teamsTier || quotaCache.data.teamsTier,
        availableCredits: base.availableCredits ?? quotaCache.data.availableCredits,
        stale: true,
        summaryReason,
      };
      quotaCache.data = preserved;
      return preserved;
    }

    const merged = {
      ...base,
      available: true,
      stale: false,
      deferred: false,
      pools: summaryPools.length ? summaryPools : base.pools,
      source: summaryPools.length ? 'summary' : (base.source || 'user_status'),
      summaryReason,
      ttlMs: QUOTA_TTL_MS,
      reqStartedAtMs,
      fetchedAtMs,
    };

    quotaCache.data = merged;
    quotaCache.fetchedAtMs = fetchedAtMs;
    quotaCache.updatedSeq += 1;
    return merged;
  } catch (err) {
    quotaCache.data = {
      ...(quotaCache.data?.available ? quotaCache.data : { available: false }),
      stale: !!quotaCache.data?.available,
      reason: err?.message || 'rpc_error',
      fetchedAtMs: Date.now(),
    };
    quotaCache.fetchedAtMs = Date.now();
    return quotaCache.data;
  }
}

export async function getUserStatusCached(waitIfCold = true, force = false) {
  const now = Date.now();
  if (!force && now - quotaCache.fetchedAtMs < QUOTA_TTL_MS && quotaCache.fetchedAtMs > 0) {
    return quotaCache.data;
  }
  if (!quotaCache.inFlight || (force && !quotaCache.inFlightForce)) {
    const isForced = Boolean(force);
    quotaCache.inFlightForce = isForced;
    quotaCache.inFlight = refreshUserStatus(isForced).finally(() => {
      quotaCache.inFlight = null;
      quotaCache.inFlightForce = false;
    });
  }
  if (force || waitIfCold || !quotaCache.fetchedAtMs) {
    await Promise.race([
      quotaCache.inFlight,
      new Promise((r) => setTimeout(r, force ? 1900 : 800)),
    ]);
  }
  return quotaCache.data;
}

let lastEventCallSig = '';
let lastEventSampleAtMs = 0;
let pendingEventSampleTimer = null;

export function schedulePostCallQuotaSample(callSig, delayMs = 4500, minCooldownMs = 15_000) {
  if (!callSig || callSig === lastEventCallSig) return;
  if (!process.env.ANTIGRAVITY_LS_ADDRESS || !process.env.ANTIGRAVITY_CSRF_TOKEN) return;
  const isFirstInit = lastEventCallSig === '';
  lastEventCallSig = callSig;
  if (isFirstInit && quotaCache.fetchedAtMs > 0) return;

  if (pendingEventSampleTimer) clearTimeout(pendingEventSampleTimer);
  pendingEventSampleTimer = setTimeout(() => {
    pendingEventSampleTimer = null;
    const now = Date.now();
    const sinceLast = now - Math.max(quotaCache.fetchedAtMs || 0, lastEventSampleAtMs);
    if (sinceLast < minCooldownMs || quotaCache.inFlight) return;
    lastEventSampleAtMs = now;
    void getUserStatusCached(false, true).catch(() => {});
  }, delayMs);
  pendingEventSampleTimer.unref?.();
}
