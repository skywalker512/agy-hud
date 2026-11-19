import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveQuotaFitPath } from './constants.mjs';
import { getCurrentPricingSig, poolKeyForGroupLabel, poolKeyForModel, resolveModelPricing } from './pricing.mjs';

const FIT_STORE_VERSION = 1;
const FIT_SCHEMA_VERSION = 3;
export const FAMILY_CLASSIFIER_VERSION = 2;
const MAX_SAMPLES_PER_POOL = 200;
const SHORT_WINDOW_MAX_SEC = 900; // <= 15m short windows train model parameters; long windows only evaluate external burn
const MIN_SHORT_WINS_FOR_SCALAR = 2;
const MIN_SHORT_WINS_FOR_TOKEN_VEC = 5;
const BOUNDARY_GEN_PAD_MS = 1500;
const GEMINI_OOS_MAX_PCT = 0.5;
const DRIFT_Z_THRESHOLD = 3.0;

const GPT_OSS_NOMINAL_RATES = { key: 'gpt-oss-nominal', input: 1.0, cached: 0.1, output: 5.0, nominalOnly: true };
const FALLBACK_NOMINAL_RATES = { key: 'fallback-nominal', input: 1.5, cached: 0.1, output: 7.5, nominalOnly: true };

// Known structural priors (k_m relative to 1x pool reference rate).
// Unified F definition: F = 100 / beta_ref, where beta_ref is projected onto pricing.json
// reference list-price vectors (timestampMs = 0), representing list-price equivalent capacity.
const FAMILY_K_PRIORS = {
  'gemini-4-hydrogen': 1.0,
  'gemini-3.8-flash': 1.0,
  'gemini-4-neon': 1.0,
  'gemini-4-carbon': 3.0,
  'gemini-4-argon': 3.0,
  'claude-opus-5-5': 1.0,
  'claude-sonnet-5-5': 1.0,
  'gpt-oss': 1.0,
};

// gen_metadata usage submessage (f4) only exposes [newInput, cachedInput, outputTokens] without a
// separate cache_creation field; Claude families fit an empirical 3-parameter [w_in, w_cache, w_out]
// vector regularized toward pricing.json ratios (cache-write pricing differential remains a hypothesis).
const PER_TOKEN_FAMILIES = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const POOL_FULL5H_PRIORS = {
  gemini: 150.0,
  claude_gpt: 11.35,
};

const fitStoreMemCache = new Map();

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

export function getFamilyBaseRates(family) {
  const priced = resolveModelPricing(family, family, family, 0);
  if (priced) return [priced.input, priced.cached, priced.output];
  if (family === 'gpt-oss') return [GPT_OSS_NOMINAL_RATES.input, GPT_OSS_NOMINAL_RATES.cached, GPT_OSS_NOMINAL_RATES.output];
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

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function weightedQuantile(pairs, q = 0.5) {
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

function solve3x3WithInverse(mat, rhs) {
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

export function loadQuotaFitStore(fitPath = resolveQuotaFitPath()) {
  if (!fitPath) return { version: FIT_STORE_VERSION, pools: {} };
  const cached = fitStoreMemCache.get(fitPath);
  if (cached) return cached;
  let store = null;
  try {
    if (existsSync(fitPath)) {
      const raw = JSON.parse(readFileSync(fitPath, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.version === FIT_STORE_VERSION && raw.pools && typeof raw.pools === 'object') {
        store = { version: FIT_STORE_VERSION, pools: { ...raw.pools } };
      }
    }
  } catch {
    /* ignore corrupt fit file and start fresh */
  }
  if (!store) {
    store = { version: FIT_STORE_VERSION, pools: {} };
  } else {
    const currentSig = getCurrentPricingSig();
    let reconciledOnLoad = false;
    for (const [poolKey, ps] of Object.entries(store.pools)) {
      if (!ps || !Array.isArray(ps.samples) || !ps.samples.length) continue;
      if (ps.pricingSig === currentSig && ps.samples.every((s) => s.pricingSig === currentSig)) continue;
      const allHaveTokens = ps.samples.every(
        (s) => s.tsMode === 'completed_v2' && s.byModelTokens && typeof s.byModelTokens === 'object',
      );
      if (!allHaveTokens) continue;
      const explicitPk = poolKey.endsWith('|claude_gpt')
        ? 'claude_gpt'
        : poolKey.endsWith('|gemini')
          ? 'gemini'
          : '';
      const pk = inferPoolKindFromState(ps, explicitPk);
      reconcilePoolSamplesPricing(ps, {
        currentSig,
        rateFn: getFamilyBaseRates,
        poolKey: pk,
      });
      solvePoolFitModel(ps, pk);
      reconciledOnLoad = true;
    }
    if (reconciledOnLoad) {
      saveQuotaFitStore(fitPath, store);
    }
  }
  fitStoreMemCache.set(fitPath, store);
  return store;
}

function saveQuotaFitStore(fitPath, store) {
  if (!fitPath) return;
  try {
    mkdirSync(dirname(fitPath), { recursive: true });
    writeFileSync(fitPath, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    /* ignore non-fatal write errors */
  }
}

/**
 * Guard against snapshot boundary ambiguity:
 * - c.ts is generation completion (before any #8 tool-call stall); c.endTs is step completedAtMs.
 * - Any snapshot RPC overlapping [genEnd - 1.5s, stepEnd + 1.5s] is uncertain as to whether
 *   the backend already deducted that call before or after GetUserStatus executed.
 */
function isSnapshotBoundaryClean(calls, poolKey, reqStartedAtMs, fetchedAtMs) {
  const reqLo = reqStartedAtMs > 0 ? Math.min(reqStartedAtMs, fetchedAtMs) : fetchedAtMs - 300;
  const reqHi = fetchedAtMs;
  for (const c of calls) {
    if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
    const stepEnd = c.ts;
    const uncStart = c.genUncertainStartTs && c.genUncertainStartTs <= stepEnd ? c.genUncertainStartTs : stepEnd;
    if (uncStart - BOUNDARY_GEN_PAD_MS <= reqHi && stepEnd + BOUNDARY_GEN_PAD_MS >= reqLo) {
      return false;
    }
  }
  return true;
}

function aggregateCallsInInterval(calls, poolKey, t0, t1) {
  const byModel = Object.create(null);
  const byModelTokens = Object.create(null);
  const nominalFamilies = new Set();
  let callCount = 0;
  let totalBaseUSD = 0;
  for (const c of calls) {
    if (c.ts <= t0 || c.ts > t1) continue;
    if (poolKey !== 'other' && c.poolKey !== poolKey) continue;
    const family = c.family || resolveModelFamily(c.modelId, c.modelDisplay, c.model);
    const baseUSD = typeof c.baseUSD === 'number'
      ? c.baseUSD
      : computeBaseReferenceUSD(c.modelId, c.modelDisplay, c.model, c.newInput, c.cachedInput, c.outputTokens).baseUSD;
    if (!(baseUSD > 0)) continue;
    byModel[family] = (byModel[family] || 0) + baseUSD;
    if ((c.newInput || 0) > 0 || (c.cachedInput || 0) > 0 || (c.outputTokens || 0) > 0) {
      if (!byModelTokens[family]) byModelTokens[family] = [0, 0, 0];
      byModelTokens[family][0] += (c.newInput || 0) / 1e6;
      byModelTokens[family][1] += (c.cachedInput || 0) / 1e6;
      byModelTokens[family][2] += (c.outputTokens || 0) / 1e6;
    }
    if (!c.priced) nominalFamilies.add(family);
    totalBaseUSD += baseUSD;
    callCount += 1;
  }
  return { byModel, byModelTokens, callCount, totalBaseUSD, nominalFamilies: [...nominalFamilies] };
}

function inferPoolKindFromState(poolState, explicitPoolKind = '') {
  if (explicitPoolKind === 'gemini' || explicitPoolKind === 'claude_gpt') return explicitPoolKind;
  for (const s of poolState?.samples || []) {
    for (const fam of Object.keys(s.byModel || {})) {
      if (fam.startsWith('claude') || fam.startsWith('gpt')) return 'claude_gpt';
      if (fam.startsWith('gemini')) return 'gemini';
    }
  }
  return 'gemini';
}

function predictSamplePct(sample, models, refBeta) {
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

/**
 * Fit quota burn model from short, boundary-clean micro-windows:
 * - P0: Known priors (k_H=1, k_C=3, F=$150/$12.5); families with <2 short windows use prior
 *   (long windows NEVER determine beta or F); refBeta anchors on the lowest-uncertainty fitted family.
 * - P1: Claude families fit regularized 3-parameter per-token-type weights [w_in, w_cache, w_out] (%/M)
 *   around pricing.json priors, gated to 'provisional' until >=12 short windows & OOS <=2.5%.
 * - P2: Symmetric Huber-style IRLS damping prevents +/- boundary jitter pairs from biasing beta downward.
 */
function coalesceZeroDeltaSamples(rawSamples) {
  const out = [];
  for (let i = 0; i < rawSamples.length; i++) {
    const cur = rawSamples[i];
    if (
      cur.du5 < 0.0003
      && cur.totalBaseUSD > 0.002
      && i + 1 < rawSamples.length
      && Math.abs(rawSamples[i + 1].t0 - cur.t1) <= 2000
    ) {
      const nxt = rawSamples[i + 1];
      const mergedByModel = { ...(cur.byModel || {}) };
      for (const [f, v] of Object.entries(nxt.byModel || {})) {
        mergedByModel[f] = (mergedByModel[f] || 0) + v;
      }
      const mergedTokens = {};
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
        du7: cur.du7 !== null && nxt.du7 !== null ? cur.du7 + nxt.du7 : nxt.du7,
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

export function solvePoolFitModel(poolState, explicitPoolKind = '') {
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
  const primarySet = shortClean.length > 0 ? shortClean : shortAny;

  // Collect all observed families across all samples (for complete reporting),
  // while ONLY short windows in trainSet are allowed to fit parameters!
  const allFamiliesSet = new Set();
  const famTotalCallsAll = new Map();
  const famTotalBaseAll = new Map();
  const nominalSet = new Set();
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

  // If zero short windows exist so far, emit a pure prior model (never fit on long windows!)
  if (!primarySet.length) {
    if (!allFamiliesSet.size) {
      poolState.fit = null;
      return null;
    }
    const refBeta = priorRefBeta;
    const full5hUSD = 100 / refBeta;
    const gamma = poolState.gamma > 0 ? poolState.gamma : null;
    const models = Object.create(null);
    for (const fam of allFamiliesSet) {
      const kP = getFamilyPriorK(fam);
      const b = kP * refBeta;
      models[fam] = {
        beta: b,
        betaPlusMinus: b * 0.15,
        k: kP,
        source: 'prior',
        mode: 'scalar',
        obsCalls: famTotalCallsAll.get(fam) || 1,
        obsWindows: 0,
        obsBaseUSD: famTotalBaseAll.get(fam) || 0,
      };
    }
    const fit = {
      schemaVersion: FIT_SCHEMA_VERSION,
      quality: 'provisional',
      refBeta,
      full5hUSD,
      full7dUSD: gamma > 0 ? full5hUSD * gamma : null,
      gamma,
      sampleCount: allSamples.length,
      shortCleanCount: 0,
      inlierCount: 0,
      holdoutCount: 0,
      oosRelErrPct: null,
      relErrPct: 15.0,
      models,
      updatedAtMs: Date.now(),
    };
    poolState.fit = fit;
    return fit;
  }

  // Deterministic 25% out-of-sample holdout when >= 6 short windows exist
  const useHoldout = primarySet.length >= 6;
  const trainSet = [];
  const holdoutSet = [];
  for (let i = 0; i < primarySet.length; i++) {
    if (useHoldout && i % 4 === 3) holdoutSet.push(primarySet[i]);
    else trainSet.push(primarySet[i]);
  }

  // Count short training windows per family
  const famShortTrainWins = new Map();
  const famShortTrainUSD = new Map();
  for (const s of trainSet) {
    for (const [fam, usd] of Object.entries(s.byModel || {})) {
      if (!(usd > 0)) continue;
      famShortTrainWins.set(fam, (famShortTrainWins.get(fam) || 0) + 1);
      famShortTrainUSD.set(fam, (famShortTrainUSD.get(fam) || 0) + usd);
    }
  }

  // Estimate initial 1x pool reference rate (refBetaCurr) by normalizing each short window with kPrior
  const refRatePairs = [];
  for (const s of trainSet) {
    let priorWeightedUSD = 0;
    for (const [fam, usd] of Object.entries(s.byModel || {})) {
      if (usd > 0) priorWeightedUSD += getFamilyPriorK(fam) * usd;
    }
    if (priorWeightedUSD > 0) {
      const val = s.du5 / priorWeightedUSD;
      if (Number.isFinite(val) && val > 0.01 && val < 200) {
        refRatePairs.push({ val, weight: 1 / Math.sqrt(Math.max(1, s.callCount || 1)) });
      }
    }
  }
  const empRefBeta = refRatePairs.length ? weightedQuantile(refRatePairs, 0.5) : priorRefBeta;
  let refBetaCurr = trainSet.length >= 3
    ? empRefBeta
    : (empRefBeta * trainSet.length + priorRefBeta * 1.5) / (trainSet.length + 1.5);

  // Only families with >= MIN_SHORT_WINS_FOR_SCALAR short windows are solved from data;
  // families with < 2 short windows stay anchored to kPrior * refBetaCurr.
  const fittedFamilies = [...famShortTrainWins.entries()]
    .filter(([, wins]) => wins >= MIN_SHORT_WINS_FOR_SCALAR)
    .map(([fam]) => fam);
  const M = fittedFamilies.length;
  const hasPerTokenInTrain = fittedFamilies.some((f) => PER_TOKEN_FAMILIES.has(f));

  // Initialize each fitted family's beta directly from weighted median of pure single-family short windows
  // (up to 50% breakdown point!) before coordinate descent.
  const beta = fittedFamilies.map((fam) => {
    const purePairs = [];
    for (const s of trainSet) {
      const keys = Object.keys(s.byModel || {}).filter((k) => (s.byModel[k] || 0) > 0);
      if (keys.length === 1 && keys[0] === fam) {
        const val = s.du5 / s.byModel[fam];
        if (Number.isFinite(val) && val > 0.01 && val < 200) {
          purePairs.push({ val, weight: 1 / Math.sqrt(Math.max(1, s.callCount || 1)) });
        }
      }
    }
    return purePairs.length >= 2 ? weightedQuantile(purePairs, 0.5) : getFamilyPriorK(fam) * refBetaCurr;
  });
  const omegas = new Array(trainSet.length).fill(1);

  for (let round = 0; round < 4; round++) {
    let hardCut = 0.5;
    let softCut = 0.15;
    const preds = new Array(trainSet.length).fill(0);
    const relResids = [];
    for (let i = 0; i < trainSet.length; i++) {
      const s = trainSet[i];
      let pred = 0;
      for (const [fam, usd] of Object.entries(s.byModel || {})) {
        if (!(usd > 0)) continue;
        const fIdx = fittedFamilies.indexOf(fam);
        pred += (fIdx >= 0 ? beta[fIdx] : getFamilyPriorK(fam) * refBetaCurr) * usd;
      }
      preds[i] = pred;
      if (pred > 0) {
        relResids.push((s.du5 - pred) / pred);
      }
    }
    if (relResids.length >= 4) {
      const medRel = median(relResids);
      const mad = median(relResids.map((r) => Math.abs(r - medRel)));
      const robustSigma = 1.4826 * mad;
      // Scale threshold with empirical precision: on ppm-accurate scalar pools (Gemini),
      // |rel| > max(0.5%, 6*robustSigma) receives exact zero weight (w = 0)!
      const minHard = hasPerTokenInTrain ? 0.25 : (trainSet.length >= 5 ? 0.005 : 0.02);
      hardCut = Math.max(minHard, 6 * robustSigma);
      softCut = Math.max(minHard * 0.5, 3 * robustSigma);
    }

    for (let i = 0; i < trainSet.length; i++) {
      const s = trainSet[i];
      const scale = Math.max(0.02, s.du5);
      let w = (1 / Math.sqrt(Math.max(1, s.callCount || 1))) / (scale * scale);
      if (!s.boundaryClean) w *= 0.4;

      if (preds[i] > 0) {
        const absRel = Math.abs(s.du5 - preds[i]) / preds[i];
        if (absRel > hardCut) {
          w = 0;
        } else if (absRel > softCut) {
          const ratio = absRel / Math.max(1e-6, softCut);
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

      // Refresh refBetaCurr from fitted families normalized by kPrior
      let refNum = 0;
      let refDen = 0;
      for (let m = 0; m < M; m++) {
        const fam = fittedFamilies[m];
        const kP = getFamilyPriorK(fam);
        const wFam = famShortTrainWins.get(fam) || 1;
        refNum += wFam * (beta[m] / kP);
        refDen += wFam;
      }
      if (refDen > 0) refBetaCurr = refNum / refDen;
    }
  }

  // Optional Phase 2 (P1): Empirical 3-parameter [w_in, w_cache, w_out] ridge fit for Claude families.
  // Scalar beta[m] is explicitly defined as the WLS projection onto pricing.json base list-price USD,
  // keeping F = 100 / refBeta strictly unified as "list-price equivalent pool capacity".
  const tokenModels = new Map();
  let usesPerTokenFit = false;
  for (let m = 0; m < M; m++) {
    const fam = fittedFamilies[m];
    if (!PER_TOKEN_FAMILIES.has(fam)) continue;
    const wins = famShortTrainWins.get(fam) || 0;
    if (wins < MIN_SHORT_WINS_FOR_TOKEN_VEC) continue;
    const tokSamples = [];
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
      // Project X @ wVec onto pricing.json list-price vector u = X @ baseRates in WLS metric
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

  // Build provisional model table to evaluate inlier & OOS residuals accurately
  const tempModels = Object.create(null);
  for (let m = 0; m < M; m++) {
    const fam = fittedFamilies[m];
    const tm = tokenModels.get(fam);
    tempModels[fam] = {
      beta: beta[m],
      ...(tm ? { tokenWeights: tm.wVec } : {}),
    };
  }

  let totalParams = 0;
  for (const fam of fittedFamilies) {
    totalParams += tokenModels.has(fam) ? 3 : 1;
  }

  let weightedSqSum = 0;
  let inlierCount = 0;
  const inlierRelErrors = [];
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

  const oosRelErrors = [];
  for (const s of holdoutSet) {
    const pred = predictSamplePct(s, tempModels, refBetaCurr);
    if (pred > 0 && s.du5 <= pred * 1.8) {
      oosRelErrors.push(Math.abs(s.du5 - pred) / s.du5);
    }
  }

  const empiricalRelErr = oosRelErrors.length > 0
    ? median(oosRelErrors)
    : (rawDof > 0 && inlierRelErrors.length > 0
      ? median(inlierRelErrors) * Math.sqrt(inlierCount / dof)
      : 0.08);
  const relErrFloor = Math.max(0.005, empiricalRelErr);

  // Compute per-fitted-family SE and select refBeta from the family with MINIMUM relative uncertainty (P0(c))
  const fittedStats = [];
  for (let m = 0; m < M; m++) {
    const fam = fittedFamilies[m];
    const wins = famShortTrainWins.get(fam) || 2;
    const anchor = getFamilyPriorK(fam) * refBetaCurr;
    let hDiag = (wins >= 4 ? 0.001 : 0.015) / Math.max(1e-4, anchor * anchor);
    for (let i = 0; i < trainSet.length; i++) {
      if (!(omegas[i] > 0)) continue;
      const xim = trainSet[i].byModel[fam] || 0;
      hDiag += omegas[i] * xim * xim;
    }
    const famFloor = wins >= 3 && (rawDof > 0 || oosRelErrors.length > 0) ? relErrFloor : Math.max(0.04, relErrFloor);
    const se = Math.max(beta[m] * famFloor, rawDof > 0 ? Math.sqrt(s2 / Math.max(1e-9, hDiag)) : 0);
    const relSE = se / Math.max(1e-6, beta[m]);
    fittedStats.push({ fam, m, wins, beta: beta[m], se, relSE, kPrior: getFamilyPriorK(fam) });
  }

  let refBeta = refBetaCurr;
  if (fittedStats.length > 0) {
    const nonNominal = fittedStats.filter((st) => !nominalSet.has(st.fam));
    const pool = nonNominal.length > 0 ? nonNominal : fittedStats;
    pool.sort((a, b) => a.relSE - b.relSE || b.wins - a.wins);
    const best = pool[0];
    // If a well-sampled 1x baseline family (e.g. Hydrogen/Flash with >=3 short windows) is nearly as tight,
    // anchor directly on it so k_C is completely free of prior assumptions; otherwise anchor on best.beta / best.kPrior!
    const direct1x = pool.find((st) => st.kPrior === 1.0 && st.wins >= 3 && st.relSE <= Math.max(0.03, best.relSE * 2.0));
    refBeta = direct1x ? direct1x.beta : (best.beta / best.kPrior);
  }

  // Strict quality gate + Regression/Drift Guardrail (Item 3):
  // - Per-token 3-param models (Claude) require >=12 short clean windows, >=3 holdout windows, and OOS <= 2.5% for 'high'.
  // - Scalar k models (Gemini) require >=4 short clean windows, rawDof >= 2, and empiricalRelErr <= 3% for 'high'.
  // - Guardrail: if any Gemini fitted family deviates >3σ from its prior beta (e.g. Hydrogen 0.6667, Carbon 2.000),
  //   if multi-family relative k deviates >3σ from kPrior, or if Gemini rolling OOS median error > 0.5%,
  //   automatically downgrade quality to 'provisional' and flag driftWarning = true!
  let quality = 'provisional';
  if (usesPerTokenFit) {
    if (shortClean.length >= 20 && oosRelErrors.length >= 5 && median(oosRelErrors) <= 0.02) {
      quality = 'high';
    }
  } else if (M > 0 && shortClean.length >= 4 && rawDof >= 2 && empiricalRelErr <= 0.03) {
    quality = 'high';
  }

  const oosMedianPct = oosRelErrors.length > 0 ? median(oosRelErrors) * 100 : null;
  const driftReasons = [];
  if (poolKind === 'gemini' && oosMedianPct !== null && oosMedianPct > GEMINI_OOS_MAX_PCT) {
    driftReasons.push(`oos_exceeded(${oosMedianPct.toFixed(2)}%>${GEMINI_OOS_MAX_PCT}%)`);
  }

  for (const st of fittedStats) {
    if (nominalSet.has(st.fam)) continue;
    const priorBetaAbs = st.kPrior * priorRefBeta;
    const priorRelDiffPct = ((st.beta - priorBetaAbs) / priorBetaAbs) * 100;
    const priorZScore = Math.abs(st.beta - priorBetaAbs) / Math.max(1e-9, st.se);
    st.priorBeta = priorBetaAbs;
    st.priorRelDiffPct = priorRelDiffPct;
    st.priorZScore = priorZScore;

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
  if (driftWarning) {
    quality = 'provisional';
  }

  const full5hUSD = refBeta > 0 ? 100 / refBeta : null;
  const gamma = poolState.gamma > 0 ? poolState.gamma : null;
  const full7dUSD = full5hUSD > 0 && gamma > 0 ? full5hUSD * gamma : null;

  const models = Object.create(null);
  for (const st of fittedStats) {
    const tm = tokenModels.get(st.fam);
    const ci90 = 1.645 * st.se;
    const entry = {
      beta: st.beta,
      betaPlusMinus: ci90,
      k: refBeta > 0 ? st.beta / refBeta : st.kPrior,
      source: quality === 'high' ? 'fitted' : 'provisional',
      mode: tm ? 'per_token' : 'scalar',
      ...(st.priorBeta !== undefined ? {
        priorBeta: st.priorBeta,
        priorRelDiffPct: st.priorRelDiffPct,
        priorZScore: st.priorZScore,
      } : {}),
      obsCalls: famTotalCallsAll.get(st.fam) || 1,
      obsWindows: st.wins,
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

  // Populate families with < 2 short clean windows using known structural priors (P0(b))
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
        b = 0.5 * bPrior + 0.5 * (s1.du5 / s1.byModel[fam]);
      }
      source = 'provisional';
      relUnc = 0.08;
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

  let anomalySpikeCount = 0;
  let anomalySpikeExcessPct = 0;
  for (const s of primarySet) {
    const pred = predictSamplePct(s, models, refBeta);
    if (pred > 0 && s.du5 > pred * 3.0) {
      anomalySpikeCount += 1;
      anomalySpikeExcessPct += (s.du5 - pred);
    }
  }

  const fit = {
    schemaVersion: FIT_SCHEMA_VERSION,
    pricingSig: poolState.pricingSig || getCurrentPricingSig(),
    quality,
    driftWarning,
    ...(driftReasons.length ? { driftReasons } : {}),
    refBeta,
    full5hUSD,
    full7dUSD,
    gamma,
    sampleCount: allSamples.length,
    shortCleanCount: shortClean.length,
    inlierCount,
    holdoutCount: oosRelErrors.length,
    oosRelErrPct: oosMedianPct,
    relErrPct: empiricalRelErr * 100,
    anomalySpikeCount,
    anomalySpikeExcessPct,
    models,
    updatedAtMs: Date.now(),
  };
  poolState.fit = fit;
  return fit;
}

export function reconcilePoolSamplesPricing(ps, {
  currentSig = getCurrentPricingSig(),
  rateFn = getFamilyBaseRates,
  allCalls = [],
  earliestCallTs = Infinity,
  poolKey = 'gemini',
} = {}) {
  if (!Array.isArray(ps?.samples)) return false;
  let changed = false;
  const nextSamples = [];

  for (const s of ps.samples) {
    const needsUpgrade = !s.byModelTokens || s.tsMode !== 'completed_v2';
    const sigMismatch = s.pricingSig !== currentSig;
    const needsFamilyReagg = (s.familyVersion || 1) < FAMILY_CLASSIFIER_VERSION;

    if (!needsUpgrade && !sigMismatch && !needsFamilyReagg) {
      nextSamples.push(s);
      continue;
    }

    // 1) If raw DB retention covers [t0, t1], re-aggregate from raw calls first so family reclassifications
    //    (e.g. Orchestrator (Neon) -> gemini-4-neon) and nominalFlags are healed identically to live samples.
    if (allCalls.length > 0 && s.t0 >= earliestCallTs - 60_000) {
      const reAgg = aggregateCallsInInterval(allCalls, poolKey, s.t0, s.t1);
      if (reAgg.callCount > 0) {
        nextSamples.push({
          ...s,
          byModel: reAgg.byModel,
          byModelTokens: reAgg.byModelTokens,
          callCount: reAgg.callCount,
          totalBaseUSD: reAgg.totalBaseUSD,
          nominalFamilies: reAgg.nominalFamilies,
          boundaryClean: isSnapshotBoundaryClean(allCalls, poolKey, 0, s.t0)
            && isSnapshotBoundaryClean(allCalls, poolKey, 0, s.t1),
          tsMode: 'completed_v2',
          pricingSig: currentSig,
          familyVersion: FAMILY_CLASSIFIER_VERSION,
        });
        changed = true;
        continue;
      }
      if (s.byModelTokens && Object.keys(s.byModelTokens).length === 0) {
        nextSamples.push({
          ...s,
          tsMode: 'completed_v2',
          pricingSig: currentSig,
          familyVersion: FAMILY_CLASSIFIER_VERSION,
        });
        changed = true;
        continue;
      }
    }

    // 2) Otherwise if token breakdown is already stored and timestamp alignment is v2, recompute baseUSD from tokens!
    if (!needsUpgrade && s.byModelTokens) {
      const checkedDb = allCalls.length > 0;
      const didUpdate = sigMismatch || checkedDb;
      if (!didUpdate) {
        nextSamples.push(s);
        continue;
      }
      const nextByModel = Object.create(null);
      let nextTotalUSD = 0;
      if (Object.keys(s.byModelTokens).length > 0) {
        for (const [fam, tok] of Object.entries(s.byModelTokens)) {
          const rates = rateFn(fam);
          const usd = (tok[0] || 0) * rates[0] + (tok[1] || 0) * rates[1] + (tok[2] || 0) * rates[2];
          if (usd > 0) {
            nextByModel[fam] = usd;
            nextTotalUSD += usd;
          }
        }
      }
      const nextNominalFamilies = rateFn === getFamilyBaseRates
        ? Object.keys(nextByModel).filter((fam) => !resolveModelPricing(fam, fam, fam, 0))
        : (s.nominalFamilies || []);
      nextSamples.push({
        ...s,
        byModel: nextByModel,
        totalBaseUSD: nextTotalUSD,
        nominalFamilies: nextNominalFamilies,
        pricingSig: currentSig,
        ...(checkedDb ? { familyVersion: FAMILY_CLASSIFIER_VERSION } : {}),
      });
      changed = true;
      continue;
    }

    // 3) If sample has an explicit OLD pricingSig and lacks token breakdown / DB coverage, discard it
    //    so stale baked baseUSD from an outdated pricing.json can never corrupt beta or F!
    if (s.pricingSig && s.pricingSig !== currentSig) {
      changed = true;
      continue;
    }

    // Legacy sample without pricingSig (first upgrade without DB coverage): stamp currentSig if tokens absent
    nextSamples.push({ ...s, pricingSig: currentSig });
    changed = true;
  }

  // Structural cleanup of historical GetUserStatus ('user_status') fallback samples:
  // On 2-window (5h + 7d) pools, RetrieveUserQuotaSummary always populates du7, whereas any '5h_delta'
  // sample with du7 === null had at least one endpoint from the stale 5h-only GetUserStatus cache!
  const hasWeeklyWindow = Boolean((ps.gamma && ps.gamma > 0) || (ps.lastSnap?.w7ResetAtMs > 0));
  if (hasWeeklyWindow && nextSamples.some((s) => s.source === '5h_delta' && (s.du7 === null || s.du7 === undefined))) {
    const filtered = nextSamples.filter((s) => !(s.source === '5h_delta' && (s.du7 === null || s.du7 === undefined)));
    ps.samples = filtered;
    if (ps.pricingSig !== currentSig) ps.pricingSig = currentSig;
    return true;
  }

  if (changed) {
    ps.samples = nextSamples;
  }
  if (ps.pricingSig !== currentSig) {
    ps.pricingSig = currentSig;
    changed = true;
  }
  return changed;
}

export function ingestQuotaObservation(accountQuota, graph, opts = {}) {
  const fitPath = opts.fitPath ?? resolveQuotaFitPath();
  const currentSig = opts.pricingSig || getCurrentPricingSig();
  const rateFn = opts.rateFn || getFamilyBaseRates;
  const store = loadQuotaFitStore(fitPath);
  if (!accountQuota?.available || accountQuota.stale || !Array.isArray(accountQuota.pools) || !accountQuota.pools.length) {
    return store;
  }
  if (graph?.indexing) {
    return store;
  }

  const fetchedAtMs = accountQuota.fetchedAtMs || opts.nowMs || Date.now();
  const reqStartedAtMs = accountQuota.reqStartedAtMs || 0;
  const tierKey = [accountQuota.planName, accountQuota.tierName, accountQuota.teamsTier]
    .filter(Boolean)
    .join(':')
    .toLowerCase() || 'default';

  const allCalls = [];
  let earliestCallTs = Infinity;
  for (const s of graph?.summaries || []) {
    for (const c of s.recentCalls || []) {
      allCalls.push(c);
      if (c.ts > 0 && c.ts < earliestCallTs) earliestCallTs = c.ts;
    }
  }

  let dirty = false;
  for (const p of accountQuota.pools) {
    const pk = poolKeyForGroupLabel(p.label);
    const calPoolKey = pk === 'other' ? `other:${String(p.label || '').toLowerCase()}` : pk;
    const poolKey = `${tierKey}|${calPoolKey}`;
    if (!store.pools[poolKey]) {
      store.pools[poolKey] = { gamma: null, gammaHistory: [], lastSnap: null, samples: [], fit: null, pricingSig: currentSig };
    }
    const ps = store.pools[poolKey];

    const upgradedSamples = reconcilePoolSamplesPricing(ps, {
      currentSig,
      rateFn,
      allCalls,
      earliestCallTs,
      poolKey: pk,
    });
    if (upgradedSamples) dirty = true;

    const w5 = (p.windows || []).find((w) => w.spanKey === '5h' && w.resetAtMs > fetchedAtMs);
    const w7 = (p.windows || []).find((w) => w.spanKey === '7d' && w.resetAtMs > fetchedAtMs);
    if (!w5 && !w7) continue;
    // Never let a degraded 1-window user_status fallback overwrite a 2-window summary baseline
    if (ps.lastSnap?.w7ResetAtMs > 0 && !w7 && accountQuota.source === 'user_status') {
      continue;
    }

    const u5 = w5 ? Math.max(0, 100 - (w5.remainingPct || 0)) : null;
    const u7 = w7 ? Math.max(0, 100 - (w7.remainingPct || 0)) : null;
    const w5StartMs = w5 ? w5.resetAtMs - 5 * 3_600_000 : 0;
    const w5CumAgg = w5 ? aggregateCallsInInterval(allCalls, pk, w5StartMs, fetchedAtMs) : null;
    const currClean = isSnapshotBoundaryClean(allCalls, pk, reqStartedAtMs, fetchedAtMs);
    const prev = ps.lastSnap;

    let addedSample = false;
    let deferSnapAdvance = false;
    const pushSample = (sample) => {
      ps.samples.push({ ...sample, tsMode: 'completed_v2', pricingSig: currentSig, familyVersion: FAMILY_CLASSIFIER_VERSION });
      if (ps.samples.length > MAX_SAMPLES_PER_POOL) {
        ps.samples.splice(0, ps.samples.length - MAX_SAMPLES_PER_POOL);
      }
      addedSample = true;
      dirty = true;
    };

    if (prev && fetchedAtMs > prev.fetchedAtMs + 1000) {
      const dtSec = (fetchedAtMs - prev.fetchedAtMs) / 1000;
      const same5h = Boolean(w5 && prev.w5ResetAtMs && Math.abs(w5.resetAtMs - prev.w5ResetAtMs) < 60_000);
      const same7d = Boolean(w7 && prev.w7ResetAtMs && Math.abs(w7.resetAtMs - prev.w7ResetAtMs) < 60_000);
      const du5 = same5h && u5 !== null && prev.w5UsedPct !== null ? u5 - prev.w5UsedPct : null;
      const du7 = same7d && u7 !== null && prev.w7UsedPct !== null ? u7 - prev.w7UsedPct : null;

      if (du5 !== null && du7 !== null && du5 >= 0.015 && du7 >= 0.003) {
        const obsGamma = du5 / du7;
        if (obsGamma >= 1.1 && obsGamma <= 20) {
          ps.gammaHistory = [...(ps.gammaHistory || []).slice(-31), obsGamma];
          ps.gamma = median(ps.gammaHistory);
          dirty = true;
        }
      }

      if (same5h && du5 !== null && du5 < -0.0005) {
        // Quota usage within an active 5h window is strictly non-decreasing; a backward jump is always
        // a stale cache read — ignore it and do NOT rewind ps.lastSnap!
        deferSnapAdvance = true;
      } else if (same5h && du5 !== null && du5 >= -0.0005) {
        const agg = aggregateCallsInInterval(allCalls, pk, prev.fetchedAtMs, fetchedAtMs);
        // If local calls completed in this interval but server remainingPct hasn't settled yet (du5 ~ 0),
        // hold prev.lastSnap open so the next snapshot captures both the calls and their delayed deduction together!
        if (agg.totalBaseUSD > 0.002 && du5 < 0.0003 && dtSec < 300) {
          deferSnapAdvance = true;
        } else {
          const historyConsistent = prev.w5CumBaseUSD === undefined
            || !w5CumAgg
            || Math.abs((w5CumAgg.totalBaseUSD - agg.totalBaseUSD) - prev.w5CumBaseUSD) <= 0.005;
          if (historyConsistent && du5 >= 0.0003 && agg.callCount > 0) {
            pushSample({
              t0: prev.fetchedAtMs,
              t1: fetchedAtMs,
              dtSec,
              du5: Math.max(0, du5),
              du7: du7 !== null ? Math.max(0, du7) : null,
              source: '5h_delta',
              boundaryClean: Boolean(prev.boundaryClean && currClean),
              isShort: dtSec <= SHORT_WINDOW_MAX_SEC,
              tsMode: 'completed_v2',
              ...agg,
            });
          }
        }
      } else {
        if (!same5h && same7d && du7 !== null && du7 >= 0.0002 && ps.gamma > 0) {
          const agg = aggregateCallsInInterval(allCalls, pk, prev.fetchedAtMs, fetchedAtMs);
          pushSample({
            t0: prev.fetchedAtMs,
            t1: fetchedAtMs,
            dtSec,
            du5: Math.max(0, du7) * ps.gamma,
            du7: Math.max(0, du7),
            source: '7d_scaled',
            boundaryClean: Boolean(prev.boundaryClean && currClean),
            isShort: dtSec <= SHORT_WINDOW_MAX_SEC,
            ...agg,
          });
        }
        if (w5 && u5 !== null && u5 >= 0.0005) {
          const w5Start = w5.resetAtMs - 5 * 3_600_000;
          if (w5Start >= prev.fetchedAtMs - 60_000) {
            const anchorSec = Math.max(1, (fetchedAtMs - w5Start) / 1000);
            const agg = aggregateCallsInInterval(allCalls, pk, w5Start, fetchedAtMs);
            pushSample({
              t0: w5Start,
              t1: fetchedAtMs,
              dtSec: anchorSec,
              du5: u5,
              du7: null,
              source: '5h_anchor',
              boundaryClean: currClean,
              isShort: anchorSec <= SHORT_WINDOW_MAX_SEC,
              ...agg,
            });
          }
        }
      }
    } else if (!prev && w5 && u5 !== null && u5 >= 0.002) {
      const w5Start = w5.resetAtMs - 5 * 3_600_000;
      const anchorSec = Math.max(1, (fetchedAtMs - w5Start) / 1000);
      const agg = aggregateCallsInInterval(allCalls, pk, w5Start, fetchedAtMs);
      if (agg.callCount > 0) {
        pushSample({
          t0: w5Start,
          t1: fetchedAtMs,
          dtSec: anchorSec,
          du5: u5,
          du7: null,
          source: '5h_boot',
          boundaryClean: currClean,
          isShort: anchorSec <= SHORT_WINDOW_MAX_SEC,
          ...agg,
        });
      }
    }

    if (!deferSnapAdvance && (!prev || fetchedAtMs > prev.fetchedAtMs)) {
      ps.lastSnap = {
        fetchedAtMs,
        boundaryClean: currClean,
        w5ResetAtMs: w5?.resetAtMs || 0,
        w5UsedPct: u5,
        w5CumBaseUSD: w5CumAgg ? w5CumAgg.totalBaseUSD : undefined,
        w7ResetAtMs: w7?.resetAtMs || 0,
        w7UsedPct: u7,
      };
      dirty = true;
    }

    const schemaStale = ps.fit && ps.fit.schemaVersion !== FIT_SCHEMA_VERSION;
    if (addedSample || upgradedSamples || schemaStale || (!ps.fit && ps.samples.length > 0)) {
      solvePoolFitModel(ps, pk);
      dirty = true;
    }
  }

  if (dirty) {
    saveQuotaFitStore(fitPath, store);
  }
  return store;
}

export function resolveActiveTierPrefix(accountQuota, fitStore) {
  if (accountQuota?.available) {
    const tk = [accountQuota.planName, accountQuota.tierName, accountQuota.teamsTier]
      .filter(Boolean)
      .join(':')
      .toLowerCase();
    if (tk) return `${tk}|`;
  }
  const keys = Object.keys(fitStore?.pools || {});
  if (!keys.length) return 'default|';
  let bestKey = keys[0];
  let bestTs = 0;
  for (const k of keys) {
    const ts = fitStore.pools[k]?.lastSnap?.fetchedAtMs || 0;
    if (ts > bestTs) {
      bestTs = ts;
      bestKey = k;
    }
  }
  const sep = bestKey.lastIndexOf('|');
  return sep > 0 ? bestKey.slice(0, sep + 1) : 'default|';
}

const POOL_GAMMA_PRIORS = {
  gemini: 4.0,
  claude_gpt: 2.0,
};

export function predictFamilyAggregateQuota(
  { poolKey, family, baseUSD, inM = 0, caM = 0, outM = 0 },
  fitStore,
  tierPrefix = 'default|',
) {
  if (!(baseUSD > 0) || !poolKey || poolKey === 'other') return null;

  const ps = fitStore?.pools?.[`${tierPrefix}${poolKey}`];
  const fit = ps?.fit;

  if (!fit || !(fit.refBeta > 0)) {
    if (!POOL_FULL5H_PRIORS[poolKey]) return null;
    const refBeta = getPoolPriorRefBeta(poolKey);
    const kPrior = getFamilyPriorK(family);
    const beta = kPrior * refBeta;
    const pct5h = beta * baseUSD;
    const pct5hErr = 1.645 * pct5h * 0.15;
    const gamma = POOL_GAMMA_PRIORS[poolKey] || null;
    return {
      quotaPool: poolKey,
      quotaPct5h: pct5h,
      quotaPct5hErr: pct5hErr,
      quotaPct7d: gamma > 0 ? pct5h / gamma : null,
      quotaMultiplierK: kPrior,
      quotaFitSource: 'prior',
    };
  }

  const mFit = fit.models?.[family];
  let pct5h;
  let pct5hErr;
  let kMult;
  let source = 'prior';

  if (mFit?.tokenWeights && mFit.tokenWeights.length === 3 && (inM + caM + outM) > 0) {
    const w = mFit.tokenWeights;
    const wErr = mFit.tokenWeightsPlusMinus || w.map((x) => x * 0.15);
    pct5h = inM * w[0] + caM * w[1] + outM * w[2];
    pct5hErr = Math.hypot(inM * wErr[0], caM * wErr[1], outM * wErr[2]);
    kMult = (pct5h / baseUSD) / fit.refBeta;
    source = mFit.source || (fit.quality === 'high' ? 'fitted' : 'provisional');
  } else {
    const kPrior = getFamilyPriorK(family);
    const beta = mFit ? mFit.beta : kPrior * fit.refBeta;
    const betaErr = mFit ? mFit.betaPlusMinus : 1.645 * beta * 0.12;
    pct5h = beta * baseUSD;
    pct5hErr = betaErr * baseUSD;
    kMult = mFit ? mFit.k : kPrior;
    source = mFit?.source || 'prior';
  }

  const gamma = fit.gamma || ps?.gamma || POOL_GAMMA_PRIORS[poolKey] || null;
  const pct7d = gamma > 0 ? pct5h / gamma : null;

  return {
    quotaPool: poolKey,
    quotaPct5h: pct5h,
    quotaPct5hErr: pct5hErr,
    quotaPct7d: pct7d,
    quotaMultiplierK: kMult,
    quotaFitSource: source,
  };
}

export function predictCallQuota(call, fitStore, tierPrefix = 'default|') {
  const { family, poolKey, baseUSD } = computeBaseReferenceUSD(
    call.modelId,
    call.modelDisplay,
    call.model,
    call.newInput,
    call.cachedInput,
    call.outputTokens,
  );
  if (!(baseUSD > 0) || poolKey === 'other') return null;

  return predictFamilyAggregateQuota(
    {
      poolKey,
      family,
      baseUSD,
      inM: (call.newInput || 0) / 1e6,
      caM: (call.cachedInput || 0) / 1e6,
      outM: (call.outputTokens || 0) / 1e6,
    },
    fitStore,
    tierPrefix,
  );
}

export function evaluatePoolWindowResidual({
  poolState,
  spanKey,
  usedPct,
  callsInSnap,
  callsInNow = callsInSnap,
}) {
  const fit = poolState?.fit;
  if (!fit || !(fit.refBeta > 0)) return null;
  const gamma = spanKey === '7d' ? (fit.gamma || poolState?.gamma || null) : 1;
  if (spanKey === '7d' && !(gamma > 0)) return null;

  const usdByFam = Object.create(null);
  const tokByFam = Object.create(null);
  let callCount = 0;
  let totalSnapUSD = 0;
  let unmodeledNominalUSD = 0;

  for (const c of callsInSnap) {
    const fam = c.family || resolveModelFamily(c.modelId, c.modelDisplay, c.model);
    const baseUSD = typeof c.baseUSD === 'number'
      ? c.baseUSD
      : computeBaseReferenceUSD(c.modelId, c.modelDisplay, c.model, c.newInput, c.cachedInput, c.outputTokens).baseUSD;
    if (!(baseUSD > 0)) continue;
    usdByFam[fam] = (usdByFam[fam] || 0) + baseUSD;
    if ((c.newInput || 0) > 0 || (c.cachedInput || 0) > 0 || (c.outputTokens || 0) > 0) {
      if (!tokByFam[fam]) tokByFam[fam] = [0, 0, 0];
      tokByFam[fam][0] += (c.newInput || 0) / 1e6;
      tokByFam[fam][1] += (c.cachedInput || 0) / 1e6;
      tokByFam[fam][2] += (c.outputTokens || 0) / 1e6;
    }
    totalSnapUSD += baseUSD;
    if (!c.priced && !fit.models?.[fam]) {
      unmodeledNominalUSD += baseUSD;
    }
    callCount += 1;
  }

  let pred5hPct = 0;
  let var5h = 0;

  for (const [fam, usd] of Object.entries(usdByFam)) {
    const mf = fit.models?.[fam];
    const tok = tokByFam[fam];
    if (mf?.tokenWeights && tok && (tok[0] + tok[1] + tok[2]) > 0) {
      const w = mf.tokenWeights;
      const wErr = mf.tokenWeightsPlusMinus || w.map((x) => x * 0.15);
      pred5hPct += tok[0] * w[0] + tok[1] * w[1] + tok[2] * w[2];
      var5h += (tok[0] * wErr[0]) ** 2 + (tok[1] * wErr[1]) ** 2 + (tok[2] * wErr[2]) ** 2;
    } else {
      // P3: Unmodeled priced families in 7d/5h windows fall back to structural kPrior * refBeta with 20% uncertainty
      const kP = getFamilyPriorK(fam);
      const b = mf ? mf.beta : kP * fit.refBeta;
      const bErr = mf ? mf.betaPlusMinus : b * 0.20;
      pred5hPct += b * usd;
      var5h += (bErr * usd) * (bErr * usd);
    }
  }

  let effectiveLocalUSD = 0;
  for (const c of callsInNow) {
    const fam = c.family || resolveModelFamily(c.modelId, c.modelDisplay, c.model);
    const baseUSD = typeof c.baseUSD === 'number'
      ? c.baseUSD
      : computeBaseReferenceUSD(c.modelId, c.modelDisplay, c.model, c.newInput, c.cachedInput, c.outputTokens).baseUSD;
    if (!(baseUSD > 0)) continue;
    const mf = fit.models?.[fam];
    if (mf?.tokenWeights && ((c.newInput || 0) + (c.cachedInput || 0) + (c.outputTokens || 0)) > 0) {
      const w = mf.tokenWeights;
      const callPct = ((c.newInput || 0) * w[0] + (c.cachedInput || 0) * w[1] + (c.outputTokens || 0) * w[2]) / 1e6;
      effectiveLocalUSD += callPct / fit.refBeta;
    } else {
      const k = mf ? mf.k : getFamilyPriorK(fam);
      effectiveLocalUSD += k * baseUSD;
    }
  }

  const predPct = pred5hPct / gamma;
  const paramBandPct = Math.sqrt(var5h) / gamma;
  const auxFloorPct = (0.03 + 0.0015 * callCount) / gamma;
  const bandPct = Math.hypot(paramBandPct, auxFloorPct) + 0.03 / gamma;

  // Signed net residual across the entire window (zero positive-clipping bias!)
  const signedResidualPct = usedPct - predPct;
  const nominalDominated = totalSnapUSD > 0 && (unmodeledNominalUSD / totalSnapUSD) > 0.2;
  const hasEnoughAnchor = fit.quality === 'high' || fit.shortCleanCount >= 4;
  const hasSignificantExternal = hasEnoughAnchor && !nominalDominated && usedPct >= 0.2 && signedResidualPct > bandPct;
  const extPct = hasSignificantExternal ? signedResidualPct : 0;
  const fullUSD = spanKey === '7d' ? fit.full7dUSD : fit.full5hUSD;
  const extUSD = extPct > 0 && fullUSD > 0 ? (extPct / 100) * fullUSD : 0;
  const extUSDPlusMinus = extPct > 0 && fullUSD > 0 ? (bandPct / 100) * fullUSD : 0;

  return {
    predLocalPct: predPct,
    signedResidualPct,
    bandPct,
    extPct,
    extPctPlusMinus: extPct > 0 ? bandPct : 0,
    extUSD,
    extUSDPlusMinus,
    effectiveLocalUSD,
    fullUSD,
  };
}
