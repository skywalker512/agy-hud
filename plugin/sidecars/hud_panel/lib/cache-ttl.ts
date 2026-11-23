/**
 * Empirical prompt-cache survival statistics & TTL prediction.
 *
 * Fits a regularized Log-Logistic survival curve per model family:
 *   S(t) = (1 - p0) / (1 + (t / t50)^k)
 * where:
 *   - p0:  short-gap background miss rate (replica switch / prefix mutation)
 *   - t50: median survival scale (half-life when p0 -> 0)
 *   - k:   steepness (gentle LRU decay for Gemini; sharp TTL cliff for Claude)
 *
 * Uses weak MAP priors per provider family so low-sample / cold-start models
 * still produce calibrated estimates while gracefully converging to local
 * observations as long-gap samples accumulate.
 */
import { resolveModelPricing } from './pricing.ts';
import { computeBaseReferenceUSD, resolveModelFamily } from './quota-solver.ts';

export type CacheProviderKind = 'claude' | 'gemini' | 'other';
export type CacheConfidence = 'fitted' | 'provisional' | 'prior';

export interface CacheGapSample {
  key: string;
  family: string;
  idleGapSec: number;
  prevPromptTokens: number;
  cachedInput: number;
  retention: number;
  hit: boolean;
  missCostUSD: number;
  ts: number;
}

export interface CacheSurvivalParams {
  bgMissRate: number;
  t50Sec: number;
  shapeK: number;
}

export interface CacheTtlPrior extends CacheSurvivalParams {
  providerKind: CacheProviderKind;
  priorWeight: number;
}

export interface CacheTtlBucket {
  key: string;
  label: string;
  minSec: number;
  maxSec: number | null;
  midSec: number;
  count: number;
  hits: number;
  hitRate: number | null;
  predictedRate: number;
}

export interface CacheTtlModelSummary extends CacheSurvivalParams {
  family: string;
  providerKind: CacheProviderKind;
  confidence: CacheConfidence;
  sampleCount: number;
  longGapCount: number;
  hitCount: number;
  missCount: number;
  expiredMissCount: number;
  missCostUSD: number;
  p80Sec: number;
  p50Sec: number;
  p20Sec: number;
  buckets: CacheTtlBucket[];
}

export interface CurrentSessionCachePrediction extends CacheSurvivalParams {
  family: string;
  providerKind: CacheProviderKind;
  confidence: CacheConfidence;
  sampleCount: number;
  longGapCount: number;
  p80Sec: number;
  p50Sec: number;
  p20Sec: number;
  lastCallMs: number;
  cachedContextTokens: number;
  missPenaltyUSD: number;
  missPenaltyQuota5hPct: number | null;
}

export interface CacheTtlOverview {
  totalPairs: number;
  totalLongGapPairs: number;
  totalExpiredMisses: number;
  totalMissCostUSD: number;
  models: CacheTtlModelSummary[];
  currentSession: CurrentSessionCachePrediction | null;
}

export const CACHE_TTL_BUCKETS: readonly {
  key: string;
  label: string;
  minSec: number;
  maxSec: number | null;
  midSec: number;
}[] = [
  { key: '0-1m', label: '<1m', minSec: 0, maxSec: 60, midSec: 20 },
  { key: '1-5m', label: '1-5m', minSec: 60, maxSec: 300, midSec: 150 },
  { key: '5-10m', label: '5-10m', minSec: 300, maxSec: 600, midSec: 420 },
  { key: '10-20m', label: '10-20m', minSec: 600, maxSec: 1200, midSec: 840 },
  { key: '20-60m', label: '20-60m', minSec: 1200, maxSec: 3600, midSec: 2100 },
  { key: '1-2h', label: '1-2h', minSec: 3600, maxSec: 7200, midSec: 5100 },
  { key: '2h+', label: '2h+', minSec: 7200, maxSec: null, midSec: 10800 },
];

export const CACHE_MIN_PREV_PROMPT_TOKENS = 2_000;
export const CACHE_HIT_RETENTION_THRESHOLD = 0.5;
export const CACHE_LONG_GAP_SEC = 180;
export const CACHE_EXPIRED_MISS_MIN_GAP_SEC = 60;

export function getCacheTtlPrior(family: string): CacheTtlPrior {
  const f = String(family || '').toLowerCase();
  if (f.includes('claude')) {
    return {
      providerKind: 'claude',
      t50Sec: 300,
      shapeK: 10.0,
      bgMissRate: 0.01,
      priorWeight: 3.0,
    };
  }
  if (f.includes('neon') || f.includes('carbon') || f.includes('argon')) {
    return {
      providerKind: 'gemini',
      t50Sec: 1500,
      shapeK: 1.6,
      bgMissRate: 0.01,
      priorWeight: 2.0,
    };
  }
  if (f.includes('gemini') || f.includes('hydrogen') || f.includes('flash')) {
    return {
      providerKind: 'gemini',
      t50Sec: 1080,
      shapeK: 1.8,
      bgMissRate: 0.012,
      priorWeight: 2.0,
    };
  }
  return {
    providerKind: 'other',
    t50Sec: 600,
    shapeK: 2.0,
    bgMissRate: 0.015,
    priorWeight: 2.0,
  };
}

export function evalCacheSurvival(params: CacheSurvivalParams, ageSec: number): number {
  const p0 = Math.min(0.5, Math.max(0, Number.isFinite(params.bgMissRate) ? params.bgMissRate : 0.01));
  const t50 = Math.max(1, Number.isFinite(params.t50Sec) ? params.t50Sec : 600);
  const k = Math.max(0.2, Number.isFinite(params.shapeK) ? params.shapeK : 2.0);
  const t = Math.max(0, Number.isFinite(ageSec) ? ageSec : 0);
  if (t <= 0) return 1 - p0;
  const val = (1 - p0) / (1 + Math.pow(t / t50, k));
  return Math.min(1, Math.max(0, val));
}

export function solveTimeForSurvival(params: CacheSurvivalParams, targetProb: number): number {
  const p0 = Math.min(0.5, Math.max(0, Number.isFinite(params.bgMissRate) ? params.bgMissRate : 0.01));
  const t50 = Math.max(1, Number.isFinite(params.t50Sec) ? params.t50Sec : 600);
  const k = Math.max(0.2, Number.isFinite(params.shapeK) ? params.shapeK : 2.0);
  const q = Math.min(0.999, Math.max(0.001, targetProb));
  const maxS = 1 - p0;
  if (q >= maxS) return 0;
  const ratio = maxS / q - 1;
  if (!(ratio > 0)) return 0;
  return t50 * Math.pow(ratio, 1 / k);
}

interface CompressedBin {
  t: number;
  hits: number;
  misses: number;
}

function compressSamplesForFit(samples: CacheGapSample[]): CompressedBin[] {
  // Bin <60s into 3 representative anchors; keep >=60s exact (rounded to nearest 5s if dense)
  const shortHits = [0, 0, 0];
  const shortMiss = [0, 0, 0];
  const shortAnchors = [8, 22, 45];
  const longBins = new Map<number, { hits: number; misses: number }>();

  for (const s of samples) {
    const t = Math.max(1, s.idleGapSec);
    if (t < 60) {
      const bi = t < 15 ? 0 : t < 35 ? 1 : 2;
      if (s.hit) shortHits[bi] += 1;
      else shortMiss[bi] += 1;
    } else {
      const bucketT = t < 1800 ? Math.round(t / 5) * 5 : Math.round(t / 30) * 30;
      const key = Math.max(60, bucketT);
      let entry = longBins.get(key);
      if (!entry) {
        entry = { hits: 0, misses: 0 };
        longBins.set(key, entry);
      }
      if (s.hit) entry.hits += 1;
      else entry.misses += 1;
    }
  }

  const out: CompressedBin[] = [];
  for (let i = 0; i < 3; i++) {
    if (shortHits[i] + shortMiss[i] > 0) {
      out.push({ t: shortAnchors[i], hits: shortHits[i], misses: shortMiss[i] });
    }
  }
  for (const [t, c] of longBins) {
    out.push({ t, hits: c.hits, misses: c.misses });
  }
  return out;
}

export function fitCacheSurvivalModel(family: string, rawSamples: CacheGapSample[]): CacheTtlModelSummary {
  const prior = getCacheTtlPrior(family);

  // Deduplicate defensively in case caller didn't pre-deduplicate
  const dedup = new Map<string, CacheGapSample>();
  for (const s of rawSamples || []) {
    if (!s || !Number.isFinite(s.idleGapSec) || s.idleGapSec < 0) continue;
    const k = s.key || `${s.ts}:${s.idleGapSec}:${s.prevPromptTokens}`;
    if (!dedup.has(k)) dedup.set(k, s);
  }
  const samples = [...dedup.values()];

  let hitCount = 0;
  let missCount = 0;
  let expiredMissCount = 0;
  let missCostUSD = 0;
  let shortTotal = 0;
  let shortMisses = 0;
  let midGapCount = 0;
  let midGapHits = 0;
  let longGapCount = 0;
  let longGapHits = 0;
  let longGapMisses = 0;

  const bucketCounts = CACHE_TTL_BUCKETS.map(() => ({ count: 0, hits: 0 }));

  for (const s of samples) {
    const gap = Math.max(0, s.idleGapSec);
    if (s.hit) hitCount += 1;
    else missCount += 1;

    if (gap < 60) {
      shortTotal += 1;
      if (!s.hit) shortMisses += 1;
    } else {
      midGapCount += 1;
      if (s.hit) midGapHits += 1;
      else {
        expiredMissCount += 1;
        if (Number.isFinite(s.missCostUSD) && s.missCostUSD > 0) {
          missCostUSD += s.missCostUSD;
        }
      }
    }
    if (gap >= CACHE_LONG_GAP_SEC) {
      longGapCount += 1;
      if (s.hit) longGapHits += 1;
      else longGapMisses += 1;
    }

    for (let bi = 0; bi < CACHE_TTL_BUCKETS.length; bi++) {
      const b = CACHE_TTL_BUCKETS[bi];
      if (gap >= b.minSec && (b.maxSec === null || gap < b.maxSec)) {
        bucketCounts[bi].count += 1;
        if (s.hit) bucketCounts[bi].hits += 1;
        break;
      }
    }
  }

  // Empirical Bayes background miss rate p0 from <60s pairs
  const pseudoN = 40;
  const bgMissRate = Math.min(
    0.12,
    Math.max(0.004, (shortMisses + prior.bgMissRate * pseudoN) / (shortTotal + pseudoN)),
  );

  let bestT50 = prior.t50Sec;
  let bestK = prior.shapeK;

  if (midGapCount > 0) {
    const bins = compressSamplesForFit(samples);
    const logPriorT50 = Math.log(prior.t50Sec);
    const logPriorK = Math.log(prior.shapeK);
    const sigmaT = 1.05;
    const sigmaK = 0.75;
    const wPrior = prior.priorWeight;

    const evalPosterior = (logT50: number, logK: number): number => {
      const t50 = Math.exp(logT50);
      const k = Math.exp(logK);
      const oneMinusP0 = 1 - bgMissRate;
      let ll = 0;
      for (const bin of bins) {
        const s = oneMinusP0 / (1 + Math.pow(bin.t / t50, k));
        const p = Math.min(0.9999, Math.max(0.0001, s));
        if (bin.hits > 0) ll += bin.hits * Math.log(p);
        if (bin.misses > 0) ll += bin.misses * Math.log(1 - p);
      }
      const penT = (logT50 - logPriorT50) / sigmaT;
      const penK = (logK - logPriorK) / sigmaK;
      return ll - 0.5 * wPrior * (penT * penT + penK * penK);
    };

    const minLogT = Math.log(60);
    const maxLogT = Math.log(14_400);
    const minLogK = Math.log(0.75);
    const maxLogK = Math.log(14.0);
    const nT = 48;
    const nK = 28;
    const stepT = (maxLogT - minLogT) / nT;
    const stepK = (maxLogK - minLogK) / nK;

    let bestScore = -Infinity;
    let bestLogT = logPriorT50;
    let bestLogK = logPriorK;

    for (let i = 0; i <= nT; i++) {
      const lt = minLogT + i * stepT;
      for (let j = 0; j <= nK; j++) {
        const lk = minLogK + j * stepK;
        const sc = evalPosterior(lt, lk);
        if (sc > bestScore) {
          bestScore = sc;
          bestLogT = lt;
          bestLogK = lk;
        }
      }
    }

    // Stage 2: refine locally around coarse optimum
    const refMinT = Math.max(minLogT, bestLogT - stepT * 1.5);
    const refMaxT = Math.min(maxLogT, bestLogT + stepT * 1.5);
    const refMinK = Math.max(minLogK, bestLogK - stepK * 1.5);
    const refMaxK = Math.min(maxLogK, bestLogK + stepK * 1.5);
    const fineSteps = 14;
    for (let i = 0; i <= fineSteps; i++) {
      const lt = refMinT + ((refMaxT - refMinT) * i) / fineSteps;
      for (let j = 0; j <= fineSteps; j++) {
        const lk = refMinK + ((refMaxK - refMinK) * j) / fineSteps;
        const sc = evalPosterior(lt, lk);
        if (sc > bestScore) {
          bestScore = sc;
          bestLogT = lt;
          bestLogK = lk;
        }
      }
    }

    bestT50 = Math.exp(bestLogT);
    bestK = Math.exp(bestLogK);
  }

  const params: CacheSurvivalParams = {
    bgMissRate: Number(bgMissRate.toFixed(4)),
    t50Sec: Math.round(bestT50),
    shapeK: Number(bestK.toFixed(2)),
  };

  let confidence: CacheConfidence = 'prior';
  if (longGapCount >= 10 && longGapMisses >= 2 && (longGapHits >= 2 || midGapHits >= 5)) {
    confidence = 'fitted';
  } else if (longGapCount >= 3 || (midGapCount >= 8 && expiredMissCount >= 1)) {
    confidence = 'provisional';
  }

  const p80Sec = Math.round(solveTimeForSurvival(params, 0.8));
  const p50Sec = Math.round(solveTimeForSurvival(params, 0.5));
  const p20Sec = Math.round(solveTimeForSurvival(params, 0.2));

  const buckets: CacheTtlBucket[] = CACHE_TTL_BUCKETS.map((b, idx) => {
    const c = bucketCounts[idx];
    return {
      key: b.key,
      label: b.label,
      minSec: b.minSec,
      maxSec: b.maxSec,
      midSec: b.midSec,
      count: c.count,
      hits: c.hits,
      hitRate: c.count > 0 ? c.hits / c.count : null,
      predictedRate: evalCacheSurvival(params, b.midSec),
    };
  });

  return {
    family,
    providerKind: prior.providerKind,
    confidence,
    sampleCount: samples.length,
    longGapCount,
    hitCount,
    missCount,
    expiredMissCount,
    missCostUSD: Number(missCostUSD.toFixed(4)),
    ...params,
    p80Sec,
    p50Sec,
    p20Sec,
    buckets,
  };
}

let cachedOverviewSig = '';
let cachedOverviewBase: Omit<CacheTtlOverview, 'currentSession'> | null = null;

export function buildCacheTtlStats(summaries: any[]): Omit<CacheTtlOverview, 'currentSession'> {
  let rawCount = 0;
  let tsChecksum = 0;
  for (const s of summaries || []) {
    const arr = s?.cachePairs;
    if (Array.isArray(arr) && arr.length) {
      rawCount += arr.length;
      tsChecksum += Number(s.latestTsMs || 0);
    }
  }
  const sig = `${(summaries || []).length}:${rawCount}:${tsChecksum}`;
  if (cachedOverviewBase && cachedOverviewSig === sig) {
    return cachedOverviewBase;
  }

  const dedupByKey = new Map<string, CacheGapSample>();
  for (const s of summaries || []) {
    const arr = s?.cachePairs;
    if (!Array.isArray(arr)) continue;
    for (const pair of arr) {
      if (!pair || !pair.family || pair.family === 'unknown') continue;
      const k = pair.key || `${pair.family}:${pair.ts}:${pair.idleGapSec}:${pair.prevPromptTokens}`;
      if (!dedupByKey.has(k)) {
        dedupByKey.set(k, pair);
      }
    }
  }

  const byFamily = new Map<string, CacheGapSample[]>();
  for (const pair of dedupByKey.values()) {
    let list = byFamily.get(pair.family);
    if (!list) {
      list = [];
      byFamily.set(pair.family, list);
    }
    list.push(pair);
  }

  const models: CacheTtlModelSummary[] = [];
  let totalPairs = 0;
  let totalLongGapPairs = 0;
  let totalExpiredMisses = 0;
  let totalMissCostUSD = 0;

  for (const [family, list] of byFamily) {
    if (list.length < 2) continue;
    const m = fitCacheSurvivalModel(family, list);
    models.push(m);
    totalPairs += m.sampleCount;
    totalLongGapPairs += m.longGapCount;
    totalExpiredMisses += m.expiredMissCount;
    totalMissCostUSD += m.missCostUSD;
  }

  models.sort((a, b) => (b.sampleCount - a.sampleCount) || (b.longGapCount - a.longGapCount));

  const result: Omit<CacheTtlOverview, 'currentSession'> = {
    totalPairs,
    totalLongGapPairs,
    totalExpiredMisses,
    totalMissCostUSD: Number(totalMissCostUSD.toFixed(4)),
    models,
  };
  cachedOverviewSig = sig;
  cachedOverviewBase = result;
  return result;
}

function estimateMissQuotaPenalty5h(
  family: string,
  modelId: string,
  modelDisplay: string,
  model: string,
  cachedContextTokens: number,
  fittedQuota: any,
): number | null {
  if (!(cachedContextTokens > 0) || !fittedQuota?.available || !Array.isArray(fittedQuota.pools)) {
    return null;
  }
  for (const pool of fittedQuota.pools) {
    const models = pool?.fitSummary?.models;
    if (!Array.isArray(models)) continue;
    const mf = models.find((m: any) => m?.family === family);
    if (!mf) continue;
    if (Array.isArray(mf.tokenWeights) && mf.tokenWeights.length >= 2) {
      const diffPerM = Math.max(0, Number(mf.tokenWeights[0] || 0) - Number(mf.tokenWeights[1] || 0));
      const pct = (diffPerM * cachedContextTokens) / 1e6;
      return pct > 0 ? Number(pct.toFixed(3)) : null;
    }
    if (Number.isFinite(mf.beta) && mf.beta > 0) {
      const uncached = computeBaseReferenceUSD(modelId, modelDisplay, model, cachedContextTokens, 0, 0).baseUSD;
      const cached = computeBaseReferenceUSD(modelId, modelDisplay, model, 0, cachedContextTokens, 0).baseUSD;
      const deltaBase = Math.max(0, uncached - cached);
      const pct = mf.beta * deltaBase;
      return pct > 0 ? Number(pct.toFixed(3)) : null;
    }
  }
  return null;
}

export function buildCacheTtlOverview(
  graphSummaries: any[],
  telemetry: any,
  fittedQuota: any = null,
): CacheTtlOverview {
  const base = buildCacheTtlStats(graphSummaries);
  const latest = telemetry?.latest || null;
  const srcModel = latest || telemetry?.currentModel || null;
  const lastCallMs = Number(telemetry?.summary?.latestCallMs || latest?.timestampMs || 0);

  let currentSession: CurrentSessionCachePrediction | null = null;
  if (srcModel && lastCallMs > 0) {
    const modelId = srcModel.modelId || '';
    const modelDisplay = srcModel.modelDisplay || '';
    const modelName = srcModel.model || '';
    const family = resolveModelFamily(modelId, modelDisplay, modelName);
    if (family && family !== 'unknown') {
      const fitted = base.models.find((m) => m.family === family) || fitCacheSurvivalModel(family, []);
      const cachedContextTokens = Math.max(
        0,
        Number(latest?.totalPromptTokens || latest?.totalContext || 0),
      );
      const rates = resolveModelPricing(modelId, modelDisplay, modelName, lastCallMs);
      const missPenaltyUSD = rates && cachedContextTokens > 0
        ? Number(((cachedContextTokens * Math.max(0, rates.input - rates.cached)) / 1e6).toFixed(4))
        : 0;
      const missPenaltyQuota5hPct = estimateMissQuotaPenalty5h(
        family,
        modelId,
        modelDisplay,
        modelName,
        cachedContextTokens,
        fittedQuota,
      );

      currentSession = {
        family: fitted.family,
        providerKind: fitted.providerKind,
        confidence: fitted.confidence,
        sampleCount: fitted.sampleCount,
        longGapCount: fitted.longGapCount,
        bgMissRate: fitted.bgMissRate,
        t50Sec: fitted.t50Sec,
        shapeK: fitted.shapeK,
        p80Sec: fitted.p80Sec,
        p50Sec: fitted.p50Sec,
        p20Sec: fitted.p20Sec,
        lastCallMs,
        cachedContextTokens,
        missPenaltyUSD,
        missPenaltyQuota5hPct,
      };
    }
  }

  return {
    ...base,
    currentSession,
  };
}
