/**
 * Statistical quota burn-rate solver (IRLS scalar k-multiplier + regularized 3-param token ridge).
 *
 * Design invariants:
 * - P0: Known structural priors (k_H=1, k_C=3, F=$150/$11.35); families with <2 short windows stay
 *   anchored to prior (long windows NEVER train beta or F).
 * - P1: Claude families fit regularized 3-parameter per-token weights [w_in, w_cache, w_out] (%/M),
 *   gated to 'provisional' until >=20 short clean windows, >=5 holdouts, and OOS <= 2%.
 * - P2: Symmetric Huber/Tukey IRLS damping prevents +/- boundary jitter pairs from biasing beta
 *   and assigns exact zero weight to adaptive MAD 6σ outlier spikes.
 * - Cold-start guard: single-sample and discordant 2-sample startups are shielded against external
 *   burn / cache-flush spikes via a prior anchor, while 2+ agreeing samples on any tier adapt immediately.
 */
import { getCurrentPricingSig, poolKeyForModel, resolveModelPricing } from './pricing.ts';

export const FIT_STORE_VERSION = 1;
export const FIT_SCHEMA_VERSION = 7;
export const FAMILY_CLASSIFIER_VERSION = 2;
export const SHORT_WINDOW_MAX_SEC = 900; // <= 15m short windows train model parameters; long windows only evaluate external burn

export const GPT_OSS_NOMINAL_RATES = Object.freeze({
  key: 'gpt-oss-nominal',
  input: 1.0,
  cached: 0.1,
  output: 5.0,
  nominalOnly: true,
});

export const FALLBACK_NOMINAL_RATES = Object.freeze({
  key: 'fallback-nominal',
  input: 1.5,
  cached: 0.1,
  output: 7.5,
  nominalOnly: true,
});

// Known structural priors (k_m relative to 1x pool reference rate).
// Unified F definition: F = 100 / beta_ref, where beta_ref is projected onto pricing.json
// reference list-price vectors (timestampMs = 0), representing list-price equivalent capacity.
export const FAMILY_K_PRIORS = Object.freeze({
  'gemini-4-hydrogen': 1.0,
  'gemini-3.8-flash': 1.0,
  'gemini-4-neon': 1.0,
  'gemini-4-carbon': 3.0,
  'gemini-4-argon': 3.0,
  'claude-opus-5-5': 1.0,
  'claude-sonnet-5-5': 1.0,
  'gpt-oss': 1.0,
});

// gen_metadata usage submessage (f4) only exposes [newInput, cachedInput, outputTokens] without a
// separate cache_creation field; Claude families fit an empirical 3-parameter [w_in, w_cache, w_out]
// vector regularized toward pricing.json ratios (cache-write pricing differential remains a hypothesis).
export const PER_TOKEN_FAMILIES = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export const POOL_FULL5H_PRIORS = Object.freeze({
  gemini: 150.0,
  claude_gpt: 11.35,
});

// Legitimate discrete 5h list-price equivalent tier caps per pool (e.g., Pro $30, Ultra 5x $150, Ultra 20x $600).
// Used to distinguish valid multi-tier accounts from genuine model-rate drift (>3σ off every known tier).
export const POOL_KNOWN_FULL5H_CAPS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  gemini: [30.0, 150.0, 600.0],
  claude_gpt: [11.35, 20.0, 40.0],
});

export const POOL_GAMMA_PRIORS = Object.freeze({
  gemini: 4.0,
  claude_gpt: 2.0,
});

export function resolveMatchedPriorRefBeta(poolKind: string, refBeta: number): number {
  const defaultPrior = getPoolPriorRefBeta(poolKind);
  const knownCaps = POOL_KNOWN_FULL5H_CAPS[poolKind];
  if (!knownCaps?.length || !(refBeta > 0)) return defaultPrior;
  const estFull = 100 / refBeta;
  let bestCap: number | null = null;
  let bestRel = Infinity;
  for (const cap of knownCaps) {
    const rel = Math.abs(estFull - cap) / cap;
    if (rel < bestRel) {
      bestRel = rel;
      bestCap = cap;
    }
  }
  return bestCap !== null && bestRel <= 0.10 ? (100 / bestCap) : defaultPrior;
}

export function hasPoolPrior(poolKind) {
  return Boolean(POOL_FULL5H_PRIORS[poolKind] > 0);
}

export function getPoolPriorFull5h(poolKind) {
  return POOL_FULL5H_PRIORS[poolKind] || null;
}

export function getPoolPriorGamma(poolKind) {
  return POOL_GAMMA_PRIORS[poolKind] || null;
}

export function getFamilyPriorK(family) {
  return FAMILY_K_PRIORS[family] || 1.0;
}

export function getPoolPriorRefBeta(poolKind) {
  const full = POOL_FULL5H_PRIORS[poolKind] || 50.0;
  return 100 / full;
}

export function resolveModelFamily(modelId, modelDisplay, model) {
  const probe = `${modelId || ''} ${modelDisplay || ''} ${model || ''}`.toLowerCase().trim();
  if (!probe) return 'unknown';
  if (probe.includes('gpt-oss')) return 'gpt-oss';
  if (probe.includes('claude') && probe.includes('opus')) return 'claude-opus-5-5';
  if (probe.includes('claude') && probe.includes('sonnet')) return 'claude-sonnet-5-5';
  if (probe.includes('argon')) return 'gemini-4-argon';
  if (probe.includes('hydrogen')) return 'gemini-4-hydrogen';
  if (probe.includes('neon')) return 'gemini-4-neon';
  if (probe.includes('carbon') || probe.includes('orchestrator')) return 'gemini-4-carbon';
  if (probe.includes('flash')) return 'gemini-3.8-flash';
  const raw = String(modelId || model || modelDisplay).toLowerCase().trim();
  return raw.replace(/-(high|medium|low|minimal|xhigh|tiered-[a-z]+)$/i, '') || 'other';
}

export function getFamilyBaseRates(family: string): [number, number, number] {
  const priced = resolveModelPricing(family, family, family, 0);
  if (priced) return [priced.input, priced.cached, priced.output];
  if (family === 'gpt-oss') {
    return [GPT_OSS_NOMINAL_RATES.input, GPT_OSS_NOMINAL_RATES.cached, GPT_OSS_NOMINAL_RATES.output];
  }
  return [FALLBACK_NOMINAL_RATES.input, FALLBACK_NOMINAL_RATES.cached, FALLBACK_NOMINAL_RATES.output];
}

export function computeBaseReferenceUSD(modelId, modelDisplay, model, newInput, cachedInput, outputTokens) {
  // Pass timestampMs = 0 so preview/base rates remain a fixed, time-invariant reference vector.
  const priced = resolveModelPricing(modelId, modelDisplay, model, 0);
  const family = resolveModelFamily(modelId, modelDisplay, model);
  const rates = priced || (family === 'gpt-oss' ? GPT_OSS_NOMINAL_RATES : FALLBACK_NOMINAL_RATES);
  const baseUSD = ((newInput || 0) * rates.input + (cachedInput || 0) * rates.cached + (outputTokens || 0) * rates.output) / 1e6;
  return {
    family,
    poolKey: poolKeyForModel(modelId, modelDisplay, model),
    baseUSD,
    rates: [rates.input, rates.cached, rates.output],
    nominalOnly: Boolean(rates.nominalOnly),
  };
}

export function inferPoolKindFromState(poolState, explicitPoolKind = '') {
  if (explicitPoolKind === 'gemini' || explicitPoolKind === 'claude_gpt') return explicitPoolKind;
  for (const s of poolState?.samples || []) {
    for (const fam of Object.keys(s.byModel || {})) {
      if (fam.startsWith('claude') || fam.startsWith('gpt')) return 'claude_gpt';
      if (fam.startsWith('gemini')) return 'gemini';
    }
  }
  return 'gemini';
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function weightedQuantile(pairs, q = 0.5) {
  if (!pairs.length) return 0;
  const sorted = [...pairs].sort((a, b) => a.val - b.val);
  const totalW = sorted.reduce((acc, p) => acc + p.weight, 0);
  if (!(totalW > 0)) return sorted[0].val;
  let cum = 0;
  for (const p of sorted) {
    cum += p.weight;
    if (cum >= totalW * q) return p.val;
  }
  return sorted[sorted.length - 1].val;
}

/**
 * Consensus-clustered gamma estimator: recovers the dominant 5h/7d ratio cluster even when
 * up to ~40% of historical ratio samples are out-of-sync 5h/7d server reads.
 */
export function selectConsensusGamma(values: number[], tolRel = 0.08): number | null {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 1.1 && v <= 20);
  if (!valid.length) return null;
  if (valid.length < 4) return median(valid);

  let bestCluster: number[] = [];
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    const cluster = valid.filter((v) => Math.abs(v - c) / c <= tolRel);
    if (cluster.length >= bestCluster.length) {
      bestCluster = cluster;
    }
  }
  return bestCluster.length >= 2 ? median(bestCluster) : median(valid);
}

/**
 * Unified pool-fit trust gate shared by window residual estimation and budget attachment.
 */
export function hasTrustedPoolFit(fit: QuotaPoolFit | null | undefined, minShortClean = 2): boolean {
  if (!fit || !(fit.refBeta > 0)) return false;
  if (fit.quality === 'high') return true;
  if ((fit.shortCleanCount || 0) >= minShortClean && (fit.inlierCount || 0) >= minShortClean) return true;
  return !fit.driftWarning && (fit.inlierCount || 0) >= 6 && (fit.relErrPct ?? 100) <= 2.0;
}

export function solve3x3WithInverse(mat, rhs) {
  // Augmented 3x6 Gauss-Jordan elimination with partial pivoting
  const aug = [
    [mat[0][0], mat[0][1], mat[0][2], 1, 0, 0, rhs[0]],
    [mat[1][0], mat[1][1], mat[1][2], 0, 1, 0, rhs[1]],
    [mat[2][0], mat[2][1], mat[2][2], 0, 0, 1, rhs[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot];
      aug[pivot] = tmp;
    }
    const div = aug[col][col];
    for (let j = col; j < 7; j++) aug[col][j] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = col; j < 7; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return {
    sol: [aug[0][6], aug[1][6], aug[2][6]],
    invDiag: [Math.max(0, aug[0][3]), Math.max(0, aug[1][4]), Math.max(0, aug[2][5])],
  };
}

const MIN_SHORT_WINS_FOR_SCALAR = 2;
const MIN_SHORT_WINS_FOR_TOKEN_VEC = 5;
const GEMINI_OOS_MAX_PCT = 0.5;
const DRIFT_Z_THRESHOLD = 3.0;
const SINGLE_SAMPLE_PRIOR_LO = 0.5;
const SINGLE_SAMPLE_PRIOR_HI = 2.0;
const TWO_SAMPLE_DISCORD_RATIO = 1.8;

export interface QuotaSample {
  t0: number;
  t1: number;
  dtSec: number;
  du5: number;
  du7?: number | null;
  source?: string;
  boundaryClean: boolean;
  isShort: boolean;
  byModel: Record<string, number>;
  byModelTokens?: Record<string, number[]>;
  callCount: number;
  totalBaseUSD: number;
  nominalFamilies?: string[];
  tsMode?: string;
  pricingSig?: string;
  familyVersion?: number;
}

export interface QuotaModelFitEntry {
  beta: number;
  betaPlusMinus: number;
  k: number;
  source: string;
  mode: 'scalar' | 'per_token';
  priorBeta?: number;
  priorRelDiffPct?: number;
  priorZScore?: number;
  tokenWeights?: number[];
  tokenWeightsPlusMinus?: number[];
  obsCalls: number;
  obsWindows: number;
  obsBaseUSD: number;
}

export interface QuotaPoolFit {
  schemaVersion: number;
  pricingSig: string;
  quality: 'high' | 'provisional';
  driftWarning: boolean;
  driftReasons?: string[];
  refBeta: number;
  full5hUSD: number | null;
  full7dUSD: number | null;
  gamma: number | null;
  sampleCount: number;
  shortCleanCount: number;
  inlierCount: number;
  holdoutCount: number;
  oosRelErrPct: number | null;
  relErrPct: number;
  anomalySpikeCount: number;
  anomalySpikeExcessPct: number;
  regimeStartMs?: number;
  models: Record<string, QuotaModelFitEntry>;
  updatedAtMs: number;
}

export interface QuotaBurnInterval {
  t0: number;
  t1: number;
  du5: number;
  du7: number | null;
  w5ResetAtMs?: number;
  w7ResetAtMs?: number;
  remoteOnly?: boolean;
}

export interface QuotaWindowPeak {
  resetAtMs: number;
  maxUsedPct: number;
  firstSeenMs: number;
  lastSeenMs: number;
  peakReachedAtMs?: number;
}

export interface QuotaResetEvent {
  ts: number;
  spanKey: '5h' | '7d';
  kind: 'in_window_rewind' | 'early_window_shift';
  beforeUsedPct: number;
  afterUsedPct: number;
  reclaimedPct: number;
  prevResetAtMs?: number;
  nextResetAtMs?: number;
}

export interface QuotaRewindCandidate {
  w5UsedPct?: number;
  w7UsedPct?: number;
  firstSeenMs: number;
  count: number;
}

export interface QuotaDailyBurnEntry {
  pct5h: number;
  pct7d: number;
  resets?: number;
  reclaimedPct5h?: number;
  reclaimedPct7d?: number;
}

export interface QuotaPoolState {
  gamma?: number | null;
  gammaHistory?: number[];
  lastSnap?: {
    fetchedAtMs: number;
    reqStartedAtMs?: number;
    boundaryClean: boolean;
    w5ResetAtMs: number;
    w5UsedPct: number | null;
    w5CumBaseUSD?: number;
    w7ResetAtMs: number;
    w7UsedPct: number | null;
  } | null;
  samples: QuotaSample[];
  burnLog?: QuotaBurnInterval[];
  dailyBurn?: Record<string, QuotaDailyBurnEntry>;
  winPeaks5h?: QuotaWindowPeak[];
  winPeaks7d?: QuotaWindowPeak[];
  resetEvents?: QuotaResetEvent[];
  pendingRewind?: QuotaRewindCandidate | null;
  fit?: QuotaPoolFit | null;
  pricingSig?: string;
}

export interface AccountTimelineSpan {
  accountId: string;
  fromMs: number;
  toMs: number;
}

export interface QuotaFitStore {
  version: number;
  pools: Record<string, QuotaPoolState>;
  accountTimeline?: AccountTimelineSpan[];
}

interface WeightedPair {
  val: number;
  weight: number;
}

interface FittedFamilyStat {
  fam: string;
  m: number;
  wins: number;
  inlierWins: number;
  beta: number;
  se: number;
  relSE: number;
  kPrior: number;
  priorBeta?: number;
  priorRelDiffPct?: number;
  priorZScore?: number;
}

interface TokenModelFit {
  wVec: number[];
  invDiag: number[];
  paramCount: number;
}

export function predictSamplePct(
  sample: QuotaSample,
  models: Record<string, { beta: number; tokenWeights?: number[] }>,
  refBeta: number,
): number {
  let pred = 0;
  for (const [fam, usd] of Object.entries(sample.byModel || {})) {
    if (!(usd > 0)) continue;
    const m = models[fam];
    const tok = sample.byModelTokens?.[fam];
    if (m?.tokenWeights && tok && (tok[0] + tok[1] + tok[2]) > 0) {
      pred += tok[0] * m.tokenWeights[0] + tok[1] * m.tokenWeights[1] + tok[2] * m.tokenWeights[2];
    } else if (m) {
      pred += m.beta * usd;
    } else {
      pred += getFamilyPriorK(fam) * refBeta * usd;
    }
  }
  return pred;
}

export function coalesceZeroDeltaSamples(rawSamples: QuotaSample[]): QuotaSample[] {
  const out: QuotaSample[] = [];
  for (let i = 0; i < rawSamples.length; i++) {
    const cur = rawSamples[i];
    if (
      cur.du5 < 0.0003
      && cur.totalBaseUSD > 0.002
      && i + 1 < rawSamples.length
      && Math.abs(rawSamples[i + 1].t0 - cur.t1) <= 2000
    ) {
      const nxt = rawSamples[i + 1];
      const mergedByModel: Record<string, number> = { ...(cur.byModel || {}) };
      for (const [f, v] of Object.entries(nxt.byModel || {})) {
        mergedByModel[f] = (mergedByModel[f] || 0) + v;
      }
      const mergedTokens: Record<string, [number, number, number]> = {};
      for (const src of [cur.byModelTokens, nxt.byModelTokens]) {
        if (!src) continue;
        for (const [f, arr] of Object.entries(src)) {
          if (!mergedTokens[f]) mergedTokens[f] = [0, 0, 0];
          mergedTokens[f][0] += arr[0] || 0;
          mergedTokens[f][1] += arr[1] || 0;
          mergedTokens[f][2] += arr[2] || 0;
        }
      }
      const dtSec = (nxt.t1 - cur.t0) / 1000;
      i += 1;
      out.push({
        ...nxt,
        t0: cur.t0,
        dtSec,
        du5: (cur.du5 || 0) + (nxt.du5 || 0),
        du7: cur.du7 != null && nxt.du7 != null ? cur.du7 + nxt.du7 : (nxt.du7 ?? null),
        boundaryClean: Boolean(cur.boundaryClean && nxt.boundaryClean),
        isShort: dtSec <= SHORT_WINDOW_MAX_SEC,
        byModel: mergedByModel,
        byModelTokens: mergedTokens,
        callCount: (cur.callCount || 0) + (nxt.callCount || 0),
        totalBaseUSD: (cur.totalBaseUSD || 0) + (nxt.totalBaseUSD || 0),
        nominalFamilies: [...new Set([...(cur.nominalFamilies || []), ...(nxt.nominalFamilies || [])])],
      });
    } else {
      out.push(cur);
    }
  }
  return out;
}

function collectFamilyInventory(allSamples: QuotaSample[]) {
  const allFamiliesSet = new Set<string>();
  const famTotalCallsAll = new Map<string, number>();
  const famTotalBaseAll = new Map<string, number>();
  const nominalSet = new Set<string>();

  for (const s of allSamples) {
    for (const nf of s.nominalFamilies || []) nominalSet.add(nf);
    for (const [fam, usd] of Object.entries(s.byModel || {})) {
      if (!(usd > 0)) continue;
      allFamiliesSet.add(fam);
      const estCalls = s.totalBaseUSD > 0 ? Math.max(1, Math.round((usd / s.totalBaseUSD) * (s.callCount || 1))) : 1;
      famTotalCallsAll.set(fam, (famTotalCallsAll.get(fam) || 0) + estCalls);
      famTotalBaseAll.set(fam, (famTotalBaseAll.get(fam) || 0) + usd);
    }
  }

  return { allFamiliesSet, famTotalCallsAll, famTotalBaseAll, nominalSet };
}

function buildColdStartPriorFit(
  poolState: QuotaPoolState,
  poolKind: string,
  priorRefBeta: number,
  allSamples: QuotaSample[],
  inventory: ReturnType<typeof collectFamilyInventory>,
): QuotaPoolFit | null {
  const { allFamiliesSet, famTotalCallsAll, famTotalBaseAll } = inventory;
  if (!allFamiliesSet.size) return null;

  const refBeta = priorRefBeta;
  const full5hUSD = 100 / refBeta;
  const gamma = (poolState.gamma ?? 0) > 0 ? poolState.gamma! : null;
  const models: Record<string, QuotaModelFitEntry> = Object.create(null);

  for (const fam of allFamiliesSet) {
    const kP = getFamilyPriorK(fam);
    const b = kP * refBeta;
    models[fam] = {
      beta: b,
      betaPlusMinus: b * 0.15,
      k: kP,
      source: 'prior',
      mode: 'scalar',
      priorBeta: b,
      obsCalls: famTotalCallsAll.get(fam) || 1,
      obsWindows: 0,
      obsBaseUSD: famTotalBaseAll.get(fam) || 0,
    };
  }

  return {
    schemaVersion: FIT_SCHEMA_VERSION,
    pricingSig: poolState.pricingSig || getCurrentPricingSig(),
    quality: 'provisional',
    driftWarning: false,
    refBeta,
    full5hUSD,
    full7dUSD: gamma !== null && gamma > 0 ? full5hUSD * gamma : null,
    gamma,
    sampleCount: allSamples.length,
    shortCleanCount: 0,
    inlierCount: 0,
    holdoutCount: 0,
    oosRelErrPct: null,
    relErrPct: 15.0,
    anomalySpikeCount: 0,
    anomalySpikeExcessPct: 0,
    models,
    updatedAtMs: Date.now(),
  };
}

function splitTrainHoldout(primarySet: QuotaSample[]) {
  const useHoldout = primarySet.length >= 6;
  const trainSet: QuotaSample[] = [];
  const holdoutSet: QuotaSample[] = [];
  for (let i = 0; i < primarySet.length; i++) {
    if (useHoldout && i % 4 === 3) holdoutSet.push(primarySet[i]);
    else trainSet.push(primarySet[i]);
  }
  return { trainSet, holdoutSet };
}

function isWithinSingleSamplePriorBand(val: number, priorBeta: number) {
  return val >= priorBeta * SINGLE_SAMPLE_PRIOR_LO && val <= priorBeta * SINGLE_SAMPLE_PRIOR_HI;
}

/**
 * 1D consensus-cluster estimator (RANSAC mode): finds the highest-weight cluster of rates
 * agreeing within ±tolRel, preferring the most recent cluster on ties. Immune to heavy
 * asymmetric outlier contamination (both upward external-burn spikes and downward straddles).
 */
function findConsensusRate(pairs: WeightedPair[], tolRel = 0.06): number {
  if (!pairs.length) return 0;
  if (pairs.length < 4) return weightedQuantile(pairs, 0.5);

  let bestWeight = -1;
  let bestCount = 0;
  let bestCluster: WeightedPair[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const center = pairs[i].val;
    if (!(center > 0)) continue;
    let wSum = 0;
    const cluster: WeightedPair[] = [];
    for (let j = 0; j < pairs.length; j++) {
      if (Math.abs(pairs[j].val - center) / center <= tolRel) {
        wSum += pairs[j].weight;
        cluster.push(pairs[j]);
      }
    }
    if (
      cluster.length >= 2
      && (wSum > bestWeight + 1e-9 || (Math.abs(wSum - bestWeight) <= 1e-9 && cluster.length >= bestCount))
    ) {
      bestWeight = wSum;
      bestCount = cluster.length;
      bestCluster = cluster;
    }
  }

  return bestCluster.length >= 2 ? weightedQuantile(bestCluster, 0.5) : weightedQuantile(pairs, 0.5);
}

/**
 * Estimate initial 1x pool reference rate (refBeta) from short training windows.
 * Guards 1-sample and discordant 2-sample cold starts against external-burn / cache-flush spikes,
 * and uses consensus clustering for >=4 samples to reject asymmetric contamination.
 */
function estimateInitialRefBeta(trainSet: QuotaSample[], priorRefBeta: number, poolKind: string) {
  const refRatePairs: WeightedPair[] = [];
  for (const s of trainSet) {
    let priorWeightedUSD = 0;
    for (const [fam, usd] of Object.entries(s.byModel || {})) {
      if (usd > 0) priorWeightedUSD += getFamilyPriorK(fam) * usd;
    }
    if (priorWeightedUSD > 0) {
      const val = s.du5 / priorWeightedUSD;
      if (Number.isFinite(val) && val > 0.005 && val < 200) {
        refRatePairs.push({ val, weight: 1 / Math.sqrt(Math.max(1, s.callCount || 1)) });
      }
    }
  }

  if (!refRatePairs.length) return priorRefBeta;

  const knownPrior = hasPoolPrior(poolKind);

  if (refRatePairs.length === 1) {
    const val = refRatePairs[0].val;
    if (knownPrior && !isWithinSingleSamplePriorBand(val, priorRefBeta)) {
      return priorRefBeta;
    }
    return (val + priorRefBeta * 1.5) / 2.5;
  }

  if (refRatePairs.length === 2) {
    const lo = Math.min(refRatePairs[0].val, refRatePairs[1].val);
    const hi = Math.max(refRatePairs[0].val, refRatePairs[1].val);
    if (knownPrior && hi / Math.max(1e-9, lo) > TWO_SAMPLE_DISCORD_RATIO) {
      // 3-point median with virtual prior anchor: rejects 1 spike regardless of callCount weights,
      // while 2 agreeing samples on a non-prior tier still dominate.
      return median([refRatePairs[0].val, refRatePairs[1].val, priorRefBeta]);
    }
    const emp = weightedQuantile(refRatePairs, 0.5);
    // If both samples agree on a different tier (outside prior band), trust their consensus directly
    // so coordinate descent initializes in the true tier's basin rather than getting dragged back.
    if (knownPrior && !isWithinSingleSamplePriorBand(emp, priorRefBeta)) {
      return emp;
    }
    return (emp * 2 + priorRefBeta * 1.5) / 3.5;
  }

  return findConsensusRate(refRatePairs, poolKind === 'claude_gpt' ? 0.15 : 0.06);
}

function initializeFamilyBetas(fittedFamilies: string[], trainSet: QuotaSample[], refBetaCurr: number) {
  return fittedFamilies.map((fam) => {
    const cleanPurePairs: WeightedPair[] = [];
    const allPurePairs: WeightedPair[] = [];
    for (const s of trainSet) {
      const keys = Object.keys(s.byModel || {}).filter((k) => (s.byModel[k] || 0) > 0);
      if (keys.length === 1 && keys[0] === fam) {
        const val = s.du5 / s.byModel[fam];
        if (Number.isFinite(val) && val > 0.01 && val < 200) {
          const pair = { val, weight: 1 / Math.sqrt(Math.max(1, s.callCount || 1)) };
          allPurePairs.push(pair);
          if (s.boundaryClean) cleanPurePairs.push(pair);
        }
      }
    }
    let cleanMaxAgree = 0;
    for (let i = 0; i < cleanPurePairs.length; i++) {
      const c = cleanPurePairs[i].val;
      const cnt = cleanPurePairs.filter((p) => Math.abs(p.val - c) / c <= 0.08).length;
      if (cnt > cleanMaxAgree) cleanMaxAgree = cnt;
    }
    const useCleanPure = cleanPurePairs.length >= 2 && (
      cleanMaxAgree >= 4
      || allPurePairs.length < 6
      || cleanPurePairs.length * 2 >= allPurePairs.length
    );
    const purePairs = useCleanPure ? cleanPurePairs : allPurePairs;
    if (!useCleanPure) {
      // Without a substantial clean pure sample set, require a tight multi-window consensus cluster
      // (>=4 pure windows agreeing within ±2%) before overriding the family's structural kPrior.
      if (purePairs.length < 4) return getFamilyPriorK(fam) * refBetaCurr;
      let maxAgree = 0;
      for (let i = 0; i < purePairs.length; i++) {
        const c = purePairs[i].val;
        const cnt = purePairs.filter((p) => Math.abs(p.val - c) / c <= 0.02).length;
        if (cnt > maxAgree) maxAgree = cnt;
      }
      if (maxAgree < 4) return getFamilyPriorK(fam) * refBetaCurr;
      return findConsensusRate(purePairs, 0.02);
    }
    if (purePairs.length === 2) {
      const lo = Math.min(purePairs[0].val, purePairs[1].val);
      const hi = Math.max(purePairs[0].val, purePairs[1].val);
      if (hi / Math.max(1e-9, lo) > TWO_SAMPLE_DISCORD_RATIO) {
        return getFamilyPriorK(fam) * refBetaCurr;
      }
    }
    return findConsensusRate(purePairs, 0.08);
  });
}

/**
 * Compute breakdown-proof symmetric log-ratio cutoffs for IRLS.
 * Anchors robustSigma to the tight ±6% consensus core when >=4 samples agree so >50%
 * multi-agent straddle / external-burn contamination cannot blow open the rejection threshold.
 */
function computeRobustLogCutoffs(
  logResids: number[],
  hasPerTokenInTrain: boolean,
  trainLen: number,
  maxHard: number,
): { hardCut: number; softCut: number } {
  if (logResids.length < 4) {
    return { hardCut: maxHard, softCut: maxHard * 0.5 };
  }
  const absLogs = logResids.map((r) => Math.abs(r));
  const tightAbsLogs = absLogs.filter((a) => a <= 0.06);
  const coreAbsLogs = absLogs.filter((a) => a <= maxHard);
  let robustSigma: number;
  if (tightAbsLogs.length >= 4) {
    robustSigma = 1.4826 * median(tightAbsLogs);
  } else if (coreAbsLogs.length >= 4) {
    robustSigma = 1.4826 * median(coreAbsLogs);
  } else {
    const medLog = median(logResids);
    const mad = median(logResids.map((r) => Math.abs(r - medLog)));
    robustSigma = 1.4826 * mad;
  }
  const minHard = hasPerTokenInTrain ? 0.25 : (trainLen >= 5 ? 0.005 : 0.02);
  const hardCut = Math.min(maxHard, Math.max(minHard, 6 * robustSigma));
  const softCut = Math.min(hardCut * 0.6, Math.max(minHard * 0.5, 3 * robustSigma));
  return { hardCut, softCut };
}

function runScalarIrls(
  fittedFamilies: string[],
  trainSet: QuotaSample[],
  famShortTrainWins: Map<string, number>,
  initialBeta: number[],
  initialRefBeta: number,
  hasPerTokenInTrain: boolean,
) {
  const M = fittedFamilies.length;
  const beta = [...initialBeta];
  const omegas = new Array<number>(trainSet.length).fill(1);
  let refBetaCurr = initialRefBeta;

  const maxHard = hasPerTokenInTrain ? 0.55 : 0.35;

  for (let round = 0; round < 4; round++) {
    const preds = new Array<number>(trainSet.length).fill(0);
    const logResids: number[] = [];

    for (let i = 0; i < trainSet.length; i++) {
      const s = trainSet[i];
      let pred = 0;
      for (const [fam, usd] of Object.entries(s.byModel || {})) {
        if (!(usd > 0)) continue;
        const fIdx = fittedFamilies.indexOf(fam);
        pred += (fIdx >= 0 ? beta[fIdx] : getFamilyPriorK(fam) * refBetaCurr) * usd;
      }
      preds[i] = pred;
      if (pred > 0 && s.du5 > 0) logResids.push(Math.log(s.du5 / pred));
    }

    const { hardCut, softCut } = computeRobustLogCutoffs(logResids, hasPerTokenInTrain, trainSet.length, maxHard);

    for (let i = 0; i < trainSet.length; i++) {
      const s = trainSet[i];
      // Weight by predicted variance (1 / pred^2) rather than observed (1 / du5^2) so
      // downward-lagged snapshots with tiny du5 and large x cannot hijack WLS leverage.
      const scale = Math.max(0.02, preds[i] > 0 ? preds[i] : s.du5);
      let w = (1 / Math.sqrt(Math.max(1, s.callCount || 1))) / (scale * scale);
      if (!s.boundaryClean) w *= 0.4;

      if (preds[i] > 0 && s.du5 > 0) {
        const absLog = Math.abs(Math.log(s.du5 / preds[i]));
        if (absLog > hardCut) {
          w = 0;
        } else if (absLog > softCut) {
          const ratio = absLog / Math.max(1e-6, softCut);
          w /= (1 + ratio * ratio);
        }
      }
      omegas[i] = w;
    }

    if (M > 0) {
      for (let sweep = 0; sweep < 40; sweep++) {
        for (let m = 0; m < M; m++) {
          const fam = fittedFamilies[m];
          const wins = famShortTrainWins.get(fam) || 2;
          const anchor = getFamilyPriorK(fam) * refBetaCurr;
          const priorStrength = wins >= 4 ? 0.001 : 0.015;
          const lam = priorStrength / Math.max(1e-4, anchor * anchor);
          let num = lam * anchor;
          let den = lam;
          for (let i = 0; i < trainSet.length; i++) {
            const wi = omegas[i];
            if (!(wi > 0)) continue;
            const s = trainSet[i];
            const xim = s.byModel[fam] || 0;
            if (!(xim > 0)) continue;
            let other = 0;
            for (const [otherFam, usd] of Object.entries(s.byModel || {})) {
              if (otherFam === fam || !(usd > 0)) continue;
              const oIdx = fittedFamilies.indexOf(otherFam);
              other += (oIdx >= 0 ? beta[oIdx] : getFamilyPriorK(otherFam) * refBetaCurr) * usd;
            }
            num += wi * xim * (s.du5 - other);
            den += wi * xim * xim;
          }
          beta[m] = Math.max(0.01, Math.min(200, num / den));
        }
      }

      const famInlierWins = new Array<number>(M).fill(0);
      for (let i = 0; i < trainSet.length; i++) {
        if (!(omegas[i] > 0)) continue;
        const s = trainSet[i];
        for (let m = 0; m < M; m++) {
          if ((s.byModel[fittedFamilies[m]] || 0) > 0) famInlierWins[m] += 1;
        }
      }
      const totalInlierWins = famInlierWins.reduce((a, b) => a + b, 0);

      let refNum = 0;
      let refDen = 0;
      for (let m = 0; m < M; m++) {
        const fam = fittedFamilies[m];
        const kP = getFamilyPriorK(fam);
        const wFam = totalInlierWins > 0 ? famInlierWins[m] : (famShortTrainWins.get(fam) || 1);
        if (!(wFam > 0)) continue;
        refNum += wFam * (beta[m] / kP);
        refDen += wFam;
      }
      if (refDen > 0) refBetaCurr = refNum / refDen;
    }
  }

  return { beta, omegas, refBetaCurr };
}

/**
 * Phase 2 (P1): Empirical 3-parameter [w_in, w_cache, w_out] ridge fit for Claude families.
 * Scalar beta[m] stays defined as the WLS projection onto pricing.json list-price USD so
 * F = 100 / refBeta remains strictly unified as "list-price equivalent pool capacity".
 */
function fitPerTokenModels(
  fittedFamilies: string[],
  trainSet: QuotaSample[],
  famShortTrainWins: Map<string, number>,
  omegas: number[],
  beta: number[],
  refBetaCurr: number,
) {
  const tokenModels = new Map<string, TokenModelFit>();
  let usesPerTokenFit = false;

  for (let m = 0; m < fittedFamilies.length; m++) {
    const fam = fittedFamilies[m];
    if (!PER_TOKEN_FAMILIES.has(fam)) continue;
    const wins = famShortTrainWins.get(fam) || 0;
    if (wins < MIN_SHORT_WINS_FOR_TOKEN_VEC) continue;

    const tokSamples: { tok: number[]; usd: number; target: number; w: number }[] = [];
    for (let i = 0; i < trainSet.length; i++) {
      if (!(omegas[i] > 0)) continue;
      const s = trainSet[i];
      const tok = s.byModelTokens?.[fam];
      const usd = s.byModel?.[fam] || 0;
      if (!tok || !(usd > 0) || (tok[0] + tok[1] + tok[2]) <= 0) continue;
      let otherPct = 0;
      for (const [otherFam, oUsd] of Object.entries(s.byModel || {})) {
        if (otherFam === fam || !(oUsd > 0)) continue;
        const oIdx = fittedFamilies.indexOf(otherFam);
        otherPct += (oIdx >= 0 ? beta[oIdx] : getFamilyPriorK(otherFam) * refBetaCurr) * oUsd;
      }
      tokSamples.push({ tok, usd, target: Math.max(0, s.du5 - otherPct), w: omegas[i] });
    }
    if (tokSamples.length < MIN_SHORT_WINS_FOR_TOKEN_VEC) continue;

    const baseRates = getFamilyBaseRates(fam);
    const w0 = baseRates.map((r) => Math.max(1e-4, beta[m] * r));
    const tau = tokSamples.length >= 8 ? 0.04 : 0.08;
    const mat = [
      [tau / (w0[0] * w0[0]), 0, 0],
      [0, tau / (w0[1] * w0[1]), 0],
      [0, 0, tau / (w0[2] * w0[2])],
    ];
    const rhs = [
      (tau / (w0[0] * w0[0])) * w0[0],
      (tau / (w0[1] * w0[1])) * w0[1],
      (tau / (w0[2] * w0[2])) * w0[2],
    ];
    for (const ts of tokSamples) {
      for (let a = 0; a < 3; a++) {
        rhs[a] += ts.w * ts.tok[a] * ts.target;
        for (let b = 0; b < 3; b++) {
          mat[a][b] += ts.w * ts.tok[a] * ts.tok[b];
        }
      }
    }

    const solved = solve3x3WithInverse(mat, rhs);
    if (solved) {
      const wVec = solved.sol.map((v, j) => Math.max(w0[j] * 0.15, Math.min(w0[j] * 4.0, v)));
      let projNum = 0;
      let projDen = 0;
      for (const ts of tokSamples) {
        const predI = ts.tok[0] * wVec[0] + ts.tok[1] * wVec[1] + ts.tok[2] * wVec[2];
        projNum += ts.w * ts.usd * predI;
        projDen += ts.w * ts.usd * ts.usd;
      }
      if (projDen > 0) beta[m] = projNum / projDen;
      tokenModels.set(fam, { wVec, invDiag: solved.invDiag, paramCount: 3 });
      usesPerTokenFit = true;
    }
  }

  return { tokenModels, usesPerTokenFit };
}

function collectOosHoldoutErrors(
  holdoutSet: QuotaSample[],
  tempModels: Record<string, { beta: number; tokenWeights?: number[] }>,
  refBetaCurr: number,
  inlierCount: number,
): number[] {
  const cleanOos: number[] = [];
  const dirtyOos: number[] = [];
  for (const s of holdoutSet) {
    const pred = predictSamplePct(s, tempModels, refBetaCurr);
    if (!(pred > 0) || !(s.du5 > 0)) continue;
    const relErr = Math.abs(s.du5 - pred) / s.du5;
    if (s.boundaryClean) {
      if (s.du5 >= pred * 0.55 && s.du5 <= pred * 1.8) {
        cleanOos.push(relErr);
      }
    } else if (Math.abs(Math.log(s.du5 / pred)) <= 0.25) {
      dirtyOos.push(relErr);
    }
  }
  if (cleanOos.length > 0 && (dirtyOos.length === 0 || (cleanOos.length >= 2 && cleanOos.length >= dirtyOos.length))) {
    return cleanOos;
  }
  // When holdouts come predominantly from concurrent/dirty sessions (or only 1-2 stray clean holdouts
  // sit alongside a large dirty consensus set), tight out-of-sample matches (<=2% error) verify
  // generalization without letting scattered straddles or a lone stale clean read trigger false drift;
  // genuine >=3% drift yields 0 tight matches and remains fully visible.
  const combinedOos = cleanOos.length > 0 ? [...cleanOos, ...dirtyOos] : dirtyOos;
  const tightOos = combinedOos.filter((e) => e <= 0.02);
  const minTight = inlierCount >= 8 ? 2 : 3;
  return tightOos.length >= minTight ? tightOos : combinedOos;
}

function evaluateResidualsAndQuality({
  poolKind,
  fittedFamilies,
  famShortTrainWins,
  trainSet,
  holdoutSet,
  shortCleanCount,
  omegas,
  beta,
  refBetaCurr,
  priorRefBeta,
  tokenModels,
  usesPerTokenFit,
  nominalSet,
}) {
  const tempModels = Object.create(null);
  for (let m = 0; m < fittedFamilies.length; m++) {
    const fam = fittedFamilies[m];
    const tm = tokenModels.get(fam);
    tempModels[fam] = { beta: beta[m], ...(tm ? { tokenWeights: tm.wVec } : {}) };
  }

  let totalParams = 0;
  for (const fam of fittedFamilies) totalParams += tokenModels.has(fam) ? 3 : 1;

  let weightedSqSum = 0;
  let inlierCount = 0;
  const inlierRelErrors: number[] = [];
  for (let i = 0; i < trainSet.length; i++) {
    if (!(omegas[i] > 0)) continue;
    const s = trainSet[i];
    const pred = predictSamplePct(s, tempModels, refBetaCurr);
    const err = s.du5 - pred;
    weightedSqSum += omegas[i] * err * err;
    inlierCount += 1;
    if (s.du5 >= 0.01) inlierRelErrors.push(Math.abs(err) / s.du5);
  }
  const rawDof = inlierCount - totalParams;
  const dof = Math.max(1, rawDof);
  const s2 = rawDof > 0 ? weightedSqSum / dof : 0;

  const oosRelErrors = collectOosHoldoutErrors(holdoutSet, tempModels, refBetaCurr, inlierCount);

  const empiricalRelErr = oosRelErrors.length > 0
    ? median(oosRelErrors)
    : (rawDof > 0 && inlierRelErrors.length > 0
      ? median(inlierRelErrors) * Math.sqrt(inlierCount / dof)
      : 0.08);
  const relErrFloor = Math.max(0.005, empiricalRelErr);

  const fittedStats: FittedFamilyStat[] = [];
  for (let m = 0; m < fittedFamilies.length; m++) {
    const fam = fittedFamilies[m];
    const wins = famShortTrainWins.get(fam) || 2;
    const anchor = getFamilyPriorK(fam) * refBetaCurr;
    let hDiag = (wins >= 4 ? 0.001 : 0.015) / Math.max(1e-4, anchor * anchor);
    let inlierWins = 0;
    for (let i = 0; i < trainSet.length; i++) {
      if (!(omegas[i] > 0)) continue;
      const xim = trainSet[i].byModel[fam] || 0;
      if (xim > 0) {
        inlierWins += 1;
        hDiag += omegas[i] * xim * xim;
      }
    }
    const famFloor = wins >= 3 && (rawDof > 0 || oosRelErrors.length > 0) ? relErrFloor : Math.max(0.04, relErrFloor);
    const se = Math.max(beta[m] * famFloor, rawDof > 0 ? Math.sqrt(s2 / Math.max(1e-9, hDiag)) : 0);
    const relSE = se / Math.max(1e-6, beta[m]);
    fittedStats.push({ fam, m, wins, inlierWins, beta: beta[m], se, relSE, kPrior: getFamilyPriorK(fam) });
  }

  let refBeta = refBetaCurr;
  if (fittedStats.length > 0) {
    const withInliers = fittedStats.filter((st) => st.inlierWins > 0);
    const activeStats = withInliers.length > 0 ? withInliers : fittedStats;
    const nonNominal = activeStats.filter((st) => !nominalSet.has(st.fam));
    const pool = nonNominal.length > 0 ? nonNominal : activeStats;
    pool.sort((a, b) => a.relSE - b.relSE || b.inlierWins - a.inlierWins || b.wins - a.wins);
    const best = pool[0];
    const direct1x = pool.find((st) => st.kPrior === 1.0 && st.wins >= 3 && st.relSE <= Math.max(0.03, best.relSE * 2.0));
    refBeta = direct1x ? direct1x.beta : (best.beta / best.kPrior);
  }

  let quality: 'high' | 'provisional' = 'provisional';
  if (usesPerTokenFit) {
    if (shortCleanCount >= 20 && oosRelErrors.length >= 5 && median(oosRelErrors) <= 0.02) {
      quality = 'high';
    }
  } else if (fittedFamilies.length > 0 && rawDof >= 2) {
    const cleanEnough = shortCleanCount >= 4 && empiricalRelErr <= 0.03;
    const minConsensusOos = inlierCount >= 8 ? 2 : 3;
    const consensusEnough = inlierCount >= 6 && oosRelErrors.length >= minConsensusOos && empiricalRelErr <= 0.01;
    if (cleanEnough || consensusEnough) {
      quality = 'high';
    }
  }

  const oosMedianPct = oosRelErrors.length > 0 ? median(oosRelErrors) * 100 : null;
  const driftReasons: string[] = [];
  if (poolKind === 'gemini' && oosMedianPct !== null && oosMedianPct > GEMINI_OOS_MAX_PCT) {
    driftReasons.push(`oos_exceeded(${oosMedianPct.toFixed(2)}%>${GEMINI_OOS_MAX_PCT}%)`);
  }

  const effectivePriorRefBeta = resolveMatchedPriorRefBeta(poolKind, refBeta);
  for (const st of fittedStats) {
    if (nominalSet.has(st.fam)) continue;
    const priorBetaAbs = st.kPrior * effectivePriorRefBeta;
    const priorRelDiffPct = ((st.beta - priorBetaAbs) / priorBetaAbs) * 100;
    const priorZScore = Math.abs(st.beta - priorBetaAbs) / Math.max(1e-9, st.se);
    st.priorBeta = priorBetaAbs;
    st.priorRelDiffPct = priorRelDiffPct;
    st.priorZScore = priorZScore;
    if (st.inlierWins === 0) continue;

    if (poolKind === 'gemini' && priorZScore > DRIFT_Z_THRESHOLD) {
      const sign = priorRelDiffPct >= 0 ? '+' : '';
      driftReasons.push(`${st.fam}:prior_3sigma(${sign}${priorRelDiffPct.toFixed(1)}%,${priorZScore.toFixed(1)}sigma)`);
    } else if (fittedStats.length >= 2) {
      const relPriorBeta = st.kPrior * refBeta;
      const relZ = Math.abs(st.beta - relPriorBeta) / Math.max(1e-9, st.se);
      if (relZ > DRIFT_Z_THRESHOLD) {
        driftReasons.push(`${st.fam}:k_3sigma(${(st.beta / refBeta).toFixed(2)}vs${st.kPrior})`);
      }
    }
  }

  const driftWarning = driftReasons.length > 0;
  if (driftWarning) quality = 'provisional';

  return {
    refBeta,
    quality,
    driftWarning,
    driftReasons,
    fittedStats,
    inlierCount,
    rawDof,
    s2,
    relErrFloor,
    empiricalRelErr,
    oosRelErrors,
    oosMedianPct,
  };
}

function buildModelsMap({
  fittedStats,
  tokenModels,
  quality,
  refBeta,
  priorRefBeta,
  rawDof,
  s2,
  relErrFloor,
  allFamiliesSet,
  famShortTrainWins,
  famTotalCallsAll,
  famTotalBaseAll,
  trainSet,
}) {
  const models = Object.create(null);

  for (const st of fittedStats) {
    const tm = tokenModels.get(st.fam);
    const hasFittedInliers = st.inlierWins >= MIN_SHORT_WINS_FOR_SCALAR;
    const hasAnyInlier = st.inlierWins > 0;
    const ci90 = hasAnyInlier ? 1.645 * st.se : 1.645 * st.beta * 0.10;
    const entry: QuotaModelFitEntry = {
      beta: st.beta,
      betaPlusMinus: ci90,
      k: refBeta > 0 ? st.beta / refBeta : st.kPrior,
      source: hasFittedInliers ? (quality === 'high' ? 'fitted' : 'provisional') : (hasAnyInlier ? 'provisional' : 'prior'),
      mode: tm ? 'per_token' : 'scalar',
      ...(st.priorBeta !== undefined ? {
        priorBeta: st.priorBeta,
        priorRelDiffPct: st.priorRelDiffPct,
        priorZScore: st.priorZScore,
      } : {}),
      obsCalls: famTotalCallsAll.get(st.fam) || 1,
      obsWindows: hasAnyInlier ? st.inlierWins : 0,
      obsBaseUSD: famTotalBaseAll.get(st.fam) || 0,
    };
    if (tm) {
      entry.tokenWeights = tm.wVec;
      entry.tokenWeightsPlusMinus = tm.wVec.map((wv, j) => {
        const wSe = Math.max(wv * Math.max(0.02, relErrFloor), rawDof > 0 ? Math.sqrt(s2 * tm.invDiag[j]) : 0);
        return 1.645 * wSe;
      });
    }
    models[st.fam] = entry;
  }

  // Families with < 2 short clean windows remain anchored to structural priors (P0(b)),
  // with single-sample spike protection so a 1-window anomaly cannot pull k off prior.
  for (const fam of allFamiliesSet) {
    if (models[fam]) continue;
    const kP = getFamilyPriorK(fam);
    const shortWins = famShortTrainWins.get(fam) || 0;
    const bPrior = kP * refBeta;
    let b = bPrior;
    let source = 'prior';
    let relUnc = 0.10;

    if (shortWins === 1) {
      const s1 = trainSet.find((s) => (s.byModel[fam] || 0) > 0 && Object.keys(s.byModel).length === 1);
      if (s1 && s1.byModel[fam] > 0) {
        const s1Rate = s1.du5 / s1.byModel[fam];
        if (isWithinSingleSamplePriorBand(s1Rate, bPrior)) {
          b = 0.5 * bPrior + 0.5 * s1Rate;
          source = 'provisional';
          relUnc = 0.08;
        }
      }
    }

    models[fam] = {
      beta: b,
      betaPlusMinus: 1.645 * b * relUnc,
      k: refBeta > 0 ? b / refBeta : kP,
      source,
      mode: 'scalar',
      priorBeta: kP * priorRefBeta,
      obsCalls: famTotalCallsAll.get(fam) || 1,
      obsWindows: shortWins,
      obsBaseUSD: famTotalBaseAll.get(fam) || 0,
    };
  }

  return models;
}

const REGIME_MIN_OLD_SAMPLES = 3;
const REGIME_MIN_NEW_INLIERS = 3;
const REGIME_MIN_STEP_RATIO = 1.30;
const REGIME_OLD_BAND = 0.15;

function samplePriorNormalizedRate(s: QuotaSample): number | null {
  let priorWeightedUSD = 0;
  for (const [fam, usd] of Object.entries(s.byModel || {})) {
    if (usd > 0) priorWeightedUSD += getFamilyPriorK(fam) * usd;
  }
  if (!(priorWeightedUSD > 0) || !(s.du5 > 0)) return null;
  const val = s.du5 / priorWeightedUSD;
  return Number.isFinite(val) && val > 0.005 && val < 200 ? val : null;
}

/**
 * Detect an abrupt quota-cap regime shift (e.g., upgrading 5x Ultra $150 -> 20x Ultra $600
 * or switching accounts under the same tier label) where a tight recent tail of short windows
 * consistently clusters at a substantially different rate than the preceding history.
 * Tolerates isolated external-burn spikes inside the new tail while refusing to trigger on
 * noisy/reverting spikes.
 */
function detectRegimeShiftSlice(
  primarySet: QuotaSample[],
  poolKind: string,
): { activePrimary: QuotaSample[]; regimeStartMs: number | null; shifted: boolean } {
  if (primarySet.length < REGIME_MIN_OLD_SAMPLES + REGIME_MIN_NEW_INLIERS) {
    return { activePrimary: primarySet, regimeStartMs: null, shifted: false };
  }

  const rates = primarySet.map(samplePriorNormalizedRate);
  const coreTol = poolKind === 'claude_gpt' ? 0.15 : 0.10;
  const bandTol = 0.35;

  let bestSplitIdx = -1;
  let lockedTailMed: number | null = null;

  for (let splitIdx = primarySet.length - REGIME_MIN_NEW_INLIERS; splitIdx >= REGIME_MIN_OLD_SAMPLES; splitIdx--) {
    const boundaryRate = rates[splitIdx];
    if (boundaryRate === null || !primarySet[splitIdx]?.boundaryClean) continue;

    const tailRates: number[] = [];
    const tailCleanRates: number[] = [];
    for (let i = splitIdx; i < primarySet.length; i++) {
      if (rates[i] !== null) {
        tailRates.push(rates[i]!);
        if (primarySet[i]?.boundaryClean) tailCleanRates.push(rates[i]!);
      }
    }
    if (tailRates.length < REGIME_MIN_NEW_INLIERS || tailCleanRates.length < REGIME_MIN_NEW_INLIERS) continue;

    const tailMed = median(tailCleanRates);
    if (!(tailMed > 0)) continue;

    // Boundary sample itself must sit in the new regime band (preferring tight core).
    if (Math.abs(boundaryRate - tailMed) / tailMed > coreTol) continue;

    // If we already locked onto the most recent regime, only extend backwards within the same regime.
    if (lockedTailMed !== null && Math.abs(tailMed - lockedTailMed) / lockedTailMed > bandTol) {
      continue;
    }

    // Most recent clean samples at the very end of the series must still belong to the new regime band
    // (guards against multi-shift lock-on to an older intermediate regime).
    const recentTail = tailCleanRates.slice(-Math.min(3, tailCleanRates.length));
    const recentInBand = recentTail.filter((r) => Math.abs(r - tailMed) / tailMed <= bandTol).length;
    const minRecentAgree = recentTail.length <= 2 ? recentTail.length : 2;
    if (recentInBand < minRecentAgree) continue;

    // Require both a tight clean core (>=3 clean samples within coreTol) AND majority consistency (>=60% within bandTol).
    const tailCore = tailCleanRates.filter((r) => Math.abs(r - tailMed) / tailMed <= coreTol).length;
    const tailBand = tailCleanRates.filter((r) => Math.abs(r - tailMed) / tailMed <= bandTol).length;
    if (tailCore < REGIME_MIN_NEW_INLIERS || tailBand / tailCleanRates.length < 0.6) continue;

    const oldRates: number[] = [];
    for (let i = 0; i < splitIdx; i++) {
      if (rates[i] !== null) oldRates.push(rates[i]!);
    }
    if (oldRates.length < REGIME_MIN_OLD_SAMPLES) continue;

    const oldMed = median(oldRates);
    if (!(oldMed > 0)) continue;

    const ratio = Math.max(tailMed / oldMed, oldMed / tailMed);
    if (ratio < REGIME_MIN_STEP_RATIO) continue;

    // Zero samples in the new regime tail may revert back into the old regime band.
    const revertedToOld = tailRates.some((r) => Math.abs(r - oldMed) / oldMed <= REGIME_OLD_BAND);
    if (revertedToOld) continue;

    bestSplitIdx = splitIdx;
    if (lockedTailMed === null) lockedTailMed = tailMed;
  }

  if (bestSplitIdx < 0) {
    return { activePrimary: primarySet, regimeStartMs: null, shifted: false };
  }

  const activePrimary = primarySet.slice(bestSplitIdx);
  const regimeStartMs = activePrimary[0]?.t0 || activePrimary[0]?.t1 || null;
  return { activePrimary, regimeStartMs, shifted: true };
}

function solvePoolFitOnPrimary(
  poolState: QuotaPoolState,
  poolKind: string,
  priorRefBeta: number,
  allSamples: QuotaSample[],
  shortClean: QuotaSample[],
  rawPrimarySet: QuotaSample[],
): QuotaPoolFit {
  const { activePrimary: primarySet, regimeStartMs, shifted } = detectRegimeShiftSlice(rawPrimarySet, poolKind);
  const effectiveSamples = shifted && regimeStartMs !== null
    ? allSamples.filter((s) => (s.t1 || s.t0) >= regimeStartMs)
    : allSamples;
  const activeShortCleanCount = shifted
    ? primarySet.filter((s) => s.boundaryClean).length
    : shortClean.length;
  const inventory = collectFamilyInventory(effectiveSamples);

  const { trainSet, holdoutSet } = splitTrainHoldout(primarySet);
  const famShortTrainWins = new Map<string, number>();
  for (const s of trainSet) {
    for (const [fam, usd] of Object.entries(s.byModel || {})) {
      if (usd > 0) famShortTrainWins.set(fam, (famShortTrainWins.get(fam) || 0) + 1);
    }
  }

  const initialRefBeta = estimateInitialRefBeta(trainSet, priorRefBeta, poolKind);
  const fittedFamilies = [...famShortTrainWins.entries()]
    .filter(([, wins]) => wins >= MIN_SHORT_WINS_FOR_SCALAR)
    .map(([fam]) => fam);
  const hasPerTokenInTrain = fittedFamilies.some((f) => PER_TOKEN_FAMILIES.has(f));

  const initialBeta = initializeFamilyBetas(fittedFamilies, trainSet, initialRefBeta);
  const { beta, omegas, refBetaCurr } = runScalarIrls(
    fittedFamilies,
    trainSet,
    famShortTrainWins,
    initialBeta,
    initialRefBeta,
    hasPerTokenInTrain,
  );
  const { tokenModels, usesPerTokenFit } = activeShortCleanCount >= 2
    ? fitPerTokenModels(
        fittedFamilies,
        trainSet,
        famShortTrainWins,
        omegas,
        beta,
        refBetaCurr,
      )
    : { tokenModels: new Map<string, TokenModelFit>(), usesPerTokenFit: false };

  const stats = evaluateResidualsAndQuality({
    poolKind,
    fittedFamilies,
    famShortTrainWins,
    trainSet,
    holdoutSet,
    shortCleanCount: activeShortCleanCount,
    omegas,
    beta,
    refBetaCurr,
    priorRefBeta,
    tokenModels,
    usesPerTokenFit,
    nominalSet: inventory.nominalSet,
  });

  // Dirty-burst conservation guard: when ALL short windows had concurrent in-flight straddling
  // (activeShortCleanCount === 0) and no tight consensus cluster exists (provisional + relErr > 6%),
  // summing a contiguous chain of dirty windows cancels internal boundary straddling exactly.
  // Because external burn can only push the chain rate UP, capping downward to chainRate eliminates
  // small-call upward bias without ever allowing remote burn to inflate refBeta.
  if (
    activeShortCleanCount === 0 &&
    stats.quality === 'provisional' &&
    !usesPerTokenFit &&
    stats.empiricalRelErr > 0.06 &&
    primarySet.length >= 3
  ) {
    let totalPriorWeighted = 0;
    const samplePriorWeighted = primarySet.map((s) => {
      let pw = 0;
      for (const [fam, usd] of Object.entries(s.byModel || {})) {
        if (usd > 0) pw += getFamilyPriorK(fam) * usd;
      }
      totalPriorWeighted += pw;
      return pw;
    });

    let bestChainDu5 = 0;
    let bestChainPW = 0;
    let bestChainLen = 0;
    let curDu5 = 0;
    let curPW = 0;
    let curLen = 0;
    for (let i = 0; i < primarySet.length; i++) {
      const s = primarySet[i];
      const contiguous = i > 0 && Math.abs((s.t0 || 0) - (primarySet[i - 1].t1 || 0)) <= 2_000;
      if (!contiguous) {
        curDu5 = s.du5;
        curPW = samplePriorWeighted[i];
        curLen = 1;
      } else {
        curDu5 += s.du5;
        curPW += samplePriorWeighted[i];
        curLen += 1;
      }
      if (curLen >= 3 && curPW > bestChainPW) {
        bestChainDu5 = curDu5;
        bestChainPW = curPW;
        bestChainLen = curLen;
      }
    }

    if (bestChainLen >= 3 && totalPriorWeighted > 0 && bestChainPW / totalPriorWeighted >= 0.70) {
      const chainRate = bestChainDu5 / bestChainPW;
      if (Number.isFinite(chainRate) && chainRate > 0.01 && chainRate < stats.refBeta * 0.96) {
        const scale = stats.refBeta > 0 ? chainRate / stats.refBeta : 1;
        stats.refBeta = chainRate;
        const matchedPrior = resolveMatchedPriorRefBeta(poolKind, chainRate);
        for (const st of stats.fittedStats) {
          st.beta = Math.max(0.01, Math.min(200, st.beta * scale));
          st.se = st.se * scale;
          if (!inventory.nominalSet.has(st.fam)) {
            const priorBetaAbs = st.kPrior * matchedPrior;
            st.priorBeta = priorBetaAbs;
            st.priorRelDiffPct = ((st.beta - priorBetaAbs) / priorBetaAbs) * 100;
            st.priorZScore = Math.abs(st.beta - priorBetaAbs) / Math.max(1e-9, st.se);
          }
        }
      }
    }
  }

  const matchedPriorRefBeta = resolveMatchedPriorRefBeta(poolKind, stats.refBeta);
  const models = buildModelsMap({
    fittedStats: stats.fittedStats,
    tokenModels,
    quality: stats.quality,
    refBeta: stats.refBeta,
    priorRefBeta: matchedPriorRefBeta,
    rawDof: stats.rawDof,
    s2: stats.s2,
    relErrFloor: stats.relErrFloor,
    allFamiliesSet: inventory.allFamiliesSet,
    famShortTrainWins,
    famTotalCallsAll: inventory.famTotalCallsAll,
    famTotalBaseAll: inventory.famTotalBaseAll,
    trainSet,
  });

  let anomalySpikeCount = 0;
  let anomalySpikeExcessPct = 0;
  for (const s of primarySet) {
    const pred = predictSamplePct(s, models, stats.refBeta);
    if (pred > 0 && s.du5 > pred * 3.0) {
      anomalySpikeCount += 1;
      anomalySpikeExcessPct += (s.du5 - pred);
    }
  }

  const full5hUSD = stats.refBeta > 0 ? 100 / stats.refBeta : null;
  let gamma = (poolState.gamma ?? 0) > 0 ? poolState.gamma! : null;
  if (shifted) {
    const regimeGammas = effectiveSamples
      .filter((s) => s.du5 >= 0.015 && (s.du7 ?? 0) >= 0.003)
      .map((s) => s.du5 / s.du7!)
      .filter((g) => g >= 1.1 && g <= 20);
    if (regimeGammas.length >= 3) {
      gamma = selectConsensusGamma(regimeGammas) ?? median(regimeGammas);
    }
  }
  const full7dUSD = full5hUSD !== null && full5hUSD > 0 && gamma !== null && gamma > 0 ? full5hUSD * gamma : null;

  return {
    schemaVersion: FIT_SCHEMA_VERSION,
    pricingSig: poolState.pricingSig || getCurrentPricingSig(),
    quality: stats.quality,
    driftWarning: stats.driftWarning,
    ...(stats.driftReasons.length ? { driftReasons: stats.driftReasons } : {}),
    refBeta: stats.refBeta,
    full5hUSD,
    full7dUSD,
    gamma,
    sampleCount: effectiveSamples.length,
    shortCleanCount: activeShortCleanCount,
    inlierCount: stats.inlierCount,
    holdoutCount: stats.oosRelErrors.length,
    oosRelErrPct: stats.oosMedianPct,
    relErrPct: stats.empiricalRelErr * 100,
    anomalySpikeCount,
    anomalySpikeExcessPct,
    ...(shifted && regimeStartMs !== null ? { regimeStartMs } : {}),
    models,
    updatedAtMs: Date.now(),
  };
}

export function solvePoolFitModel(poolState: QuotaPoolState, explicitPoolKind = ''): QuotaPoolFit | null {
  const rawSamples = Array.isArray(poolState?.samples) ? poolState.samples : [];
  if (!rawSamples.length) {
    poolState.fit = null;
    return null;
  }

  const allSamples = coalesceZeroDeltaSamples(rawSamples);
  const poolKind = inferPoolKindFromState(poolState, explicitPoolKind);
  const priorRefBeta = getPoolPriorRefBeta(poolKind);

  const shortClean = allSamples.filter((s) => s.isShort && s.boundaryClean && s.totalBaseUSD > 0 && s.du5 > 0);
  const shortAny = allSamples.filter((s) => s.isShort && s.totalBaseUSD > 0 && s.du5 > 0);

  if (!shortAny.length) {
    const inventory = collectFamilyInventory(allSamples);
    const priorFit = buildColdStartPriorFit(poolState, poolKind, priorRefBeta, allSamples, inventory);
    poolState.fit = priorFit;
    return priorFit;
  }

  // Prefer clean-only training when clean samples are sufficient (>=6, or >=50% of short samples,
  // or small startup <6 total). Avoid discarding a large multi-agent consensus pool when only 1-5
  // stray/stale boundaryClean samples exist alongside dozens of dirty short windows.
  const useCleanOnly = shortClean.length > 0 && (
    shortClean.length === shortAny.length
    || shortClean.length >= 6
    || shortAny.length < 6
    || shortClean.length * 2 >= shortAny.length
  );

  let fit = solvePoolFitOnPrimary(
    poolState,
    poolKind,
    priorRefBeta,
    allSamples,
    shortClean,
    useCleanOnly ? shortClean : shortAny,
  );

  // Secondary safeguard: if a small minority of clean samples (<=1/3 of shortAny) fails to form
  // even a 4-inlier consensus (e.g. legacy stale non-forced TTL snapshots), fall back to shortAny
  // when shortAny reaches a verified high-quality consensus with zero drift.
  if (
    useCleanOnly
    && shortClean.length < shortAny.length
    && shortAny.length >= shortClean.length * 3
    && fit.quality !== 'high'
    && fit.inlierCount < 4
  ) {
    const anyFit = solvePoolFitOnPrimary(poolState, poolKind, priorRefBeta, allSamples, shortClean, shortAny);
    if (anyFit.quality === 'high' && !anyFit.driftWarning && anyFit.inlierCount >= 6) {
      fit = anyFit;
    }
  }

  poolState.fit = fit;
  return fit;
}
