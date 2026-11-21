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
import { getCurrentPricingSig, poolKeyForModel, resolveModelPricing } from './pricing.mjs';

export const FIT_STORE_VERSION = 1;
export const FIT_SCHEMA_VERSION = 3;
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

export const POOL_GAMMA_PRIORS = Object.freeze({
  gemini: 4.0,
  claude_gpt: 2.0,
});

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

export function getFamilyBaseRates(family) {
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

export function predictSamplePct(sample, models, refBeta) {
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

export function coalesceZeroDeltaSamples(rawSamples) {
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

function collectFamilyInventory(allSamples) {
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

  return { allFamiliesSet, famTotalCallsAll, famTotalBaseAll, nominalSet };
}

function buildColdStartPriorFit(poolState, poolKind, priorRefBeta, allSamples, inventory) {
  const { allFamiliesSet, famTotalCallsAll, famTotalBaseAll } = inventory;
  if (!allFamiliesSet.size) return null;

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
    full7dUSD: gamma > 0 ? full5hUSD * gamma : null,
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

function splitTrainHoldout(primarySet) {
  const useHoldout = primarySet.length >= 6;
  const trainSet = [];
  const holdoutSet = [];
  for (let i = 0; i < primarySet.length; i++) {
    if (useHoldout && i % 4 === 3) holdoutSet.push(primarySet[i]);
    else trainSet.push(primarySet[i]);
  }
  return { trainSet, holdoutSet };
}

function isWithinSingleSamplePriorBand(val, priorBeta) {
  return val >= priorBeta * SINGLE_SAMPLE_PRIOR_LO && val <= priorBeta * SINGLE_SAMPLE_PRIOR_HI;
}

/**
 * Estimate initial 1x pool reference rate (refBeta) from short training windows.
 * Guards 1-sample and discordant 2-sample cold starts against external-burn / cache-flush spikes.
 */
function estimateInitialRefBeta(trainSet, priorRefBeta, poolKind) {
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

  return weightedQuantile(refRatePairs, 0.5);
}

function initializeFamilyBetas(fittedFamilies, trainSet, refBetaCurr) {
  return fittedFamilies.map((fam) => {
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
    if (purePairs.length === 2) {
      const lo = Math.min(purePairs[0].val, purePairs[1].val);
      const hi = Math.max(purePairs[0].val, purePairs[1].val);
      if (hi / Math.max(1e-9, lo) > TWO_SAMPLE_DISCORD_RATIO) {
        return getFamilyPriorK(fam) * refBetaCurr;
      }
    }
    return purePairs.length >= 2 ? weightedQuantile(purePairs, 0.5) : getFamilyPriorK(fam) * refBetaCurr;
  });
}

function runScalarIrls(fittedFamilies, trainSet, famShortTrainWins, initialBeta, initialRefBeta, hasPerTokenInTrain) {
  const M = fittedFamilies.length;
  const beta = [...initialBeta];
  const omegas = new Array(trainSet.length).fill(1);
  let refBetaCurr = initialRefBeta;

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
      if (pred > 0) relResids.push((s.du5 - pred) / pred);
    }

    if (relResids.length >= 4) {
      const medRel = median(relResids);
      const mad = median(relResids.map((r) => Math.abs(r - medRel)));
      const robustSigma = 1.4826 * mad;
      // Scale threshold with empirical precision: on ppm-accurate scalar pools (Gemini),
      // |rel| > max(0.5%, 6*robustSigma) receives exact zero weight (w = 0).
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

  return { beta, omegas, refBetaCurr };
}

/**
 * Phase 2 (P1): Empirical 3-parameter [w_in, w_cache, w_out] ridge fit for Claude families.
 * Scalar beta[m] stays defined as the WLS projection onto pricing.json list-price USD so
 * F = 100 / refBeta remains strictly unified as "list-price equivalent pool capacity".
 */
function fitPerTokenModels(fittedFamilies, trainSet, famShortTrainWins, omegas, beta, refBetaCurr) {
  const tokenModels = new Map();
  let usesPerTokenFit = false;

  for (let m = 0; m < fittedFamilies.length; m++) {
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

  const fittedStats = [];
  for (let m = 0; m < fittedFamilies.length; m++) {
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
    const direct1x = pool.find((st) => st.kPrior === 1.0 && st.wins >= 3 && st.relSE <= Math.max(0.03, best.relSE * 2.0));
    refBeta = direct1x ? direct1x.beta : (best.beta / best.kPrior);
  }

  let quality = 'provisional';
  if (usesPerTokenFit) {
    if (shortCleanCount >= 20 && oosRelErrors.length >= 5 && median(oosRelErrors) <= 0.02) {
      quality = 'high';
    }
  } else if (fittedFamilies.length > 0 && shortCleanCount >= 4 && rawDof >= 2 && empiricalRelErr <= 0.03) {
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

export function solvePoolFitModel(poolState, explicitPoolKind = '') {
  const rawSamples = Array.isArray(poolState?.samples) ? poolState.samples : [];
  if (!rawSamples.length) {
    poolState.fit = null;
    return null;
  }

  const allSamples = coalesceZeroDeltaSamples(rawSamples);
  const poolKind = inferPoolKindFromState(poolState, explicitPoolKind);
  const priorRefBeta = getPoolPriorRefBeta(poolKind);
  const inventory = collectFamilyInventory(allSamples);

  const shortClean = allSamples.filter((s) => s.isShort && s.boundaryClean && s.totalBaseUSD > 0 && s.du5 > 0);
  const shortAny = allSamples.filter((s) => s.isShort && s.totalBaseUSD > 0 && s.du5 > 0);
  const primarySet = shortClean.length > 0 ? shortClean : shortAny;

  if (!primarySet.length) {
    const priorFit = buildColdStartPriorFit(poolState, poolKind, priorRefBeta, allSamples, inventory);
    poolState.fit = priorFit;
    return priorFit;
  }

  const { trainSet, holdoutSet } = splitTrainHoldout(primarySet);
  const famShortTrainWins = new Map();
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
  const { tokenModels, usesPerTokenFit } = fitPerTokenModels(
    fittedFamilies,
    trainSet,
    famShortTrainWins,
    omegas,
    beta,
    refBetaCurr,
  );

  const stats = evaluateResidualsAndQuality({
    poolKind,
    fittedFamilies,
    famShortTrainWins,
    trainSet,
    holdoutSet,
    shortCleanCount: shortClean.length,
    omegas,
    beta,
    refBetaCurr,
    priorRefBeta,
    tokenModels,
    usesPerTokenFit,
    nominalSet: inventory.nominalSet,
  });

  const models = buildModelsMap({
    fittedStats: stats.fittedStats,
    tokenModels,
    quality: stats.quality,
    refBeta: stats.refBeta,
    priorRefBeta,
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
  const gamma = poolState.gamma > 0 ? poolState.gamma : null;
  const full7dUSD = full5hUSD > 0 && gamma > 0 ? full5hUSD * gamma : null;

  const fit = {
    schemaVersion: FIT_SCHEMA_VERSION,
    pricingSig: poolState.pricingSig || getCurrentPricingSig(),
    quality: stats.quality,
    driftWarning: stats.driftWarning,
    ...(stats.driftReasons.length ? { driftReasons: stats.driftReasons } : {}),
    refBeta: stats.refBeta,
    full5hUSD,
    full7dUSD,
    gamma,
    sampleCount: allSamples.length,
    shortCleanCount: shortClean.length,
    inlierCount: stats.inlierCount,
    holdoutCount: stats.oosRelErrors.length,
    oosRelErrPct: stats.oosMedianPct,
    relErrPct: stats.empiricalRelErr * 100,
    anomalySpikeCount,
    anomalySpikeExcessPct,
    models,
    updatedAtMs: Date.now(),
  };
  poolState.fit = fit;
  return fit;
}
