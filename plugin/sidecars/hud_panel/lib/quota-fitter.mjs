/**
 * Quota observation store, pricing/family reconciliation, live sample ingestion,
 * and per-call / per-window quota prediction & residual evaluation.
 *
 * Delegates structural priors, math & statistical fitting to ./quota-solver.mjs,
 * re-exporting its public symbols for backwards compatibility.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveQuotaFitPath } from './constants.mjs';
import { getCurrentPricingSig, poolKeyForGroupLabel, resolveModelPricing } from './pricing.mjs';
import {
  FAMILY_CLASSIFIER_VERSION,
  FIT_SCHEMA_VERSION,
  FIT_STORE_VERSION,
  POOL_FULL5H_PRIORS,
  POOL_GAMMA_PRIORS,
  SHORT_WINDOW_MAX_SEC,
  computeBaseReferenceUSD,
  getFamilyBaseRates,
  getFamilyPriorK,
  getPoolPriorGamma,
  getPoolPriorRefBeta,
  inferPoolKindFromState,
  median,
  resolveModelFamily,
  solvePoolFitModel,
} from './quota-solver.mjs';

export {
  FAMILY_CLASSIFIER_VERSION,
  computeBaseReferenceUSD,
  getFamilyBaseRates,
  getFamilyPriorK,
  getPoolPriorGamma,
  getPoolPriorRefBeta,
  hasPoolPrior,
  resolveModelFamily,
  solvePoolFitModel,
} from './quota-solver.mjs';

const MAX_SAMPLES_PER_POOL = 200;
const BOUNDARY_GEN_PAD_MS = 1500;
const fitStoreMemCache = new Map();

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
    reconcileStoreOnLoad(fitPath, store);
  }
  fitStoreMemCache.set(fitPath, store);
  return store;
}

function reconcileStoreOnLoad(fitPath, store) {
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
 * - c.ts is generation completion (before any #8 tool-call stall); c.genUncertainStartTs marks earliest uncertain boundary.
 * - Any snapshot RPC overlapping [uncStart - 1.5s, stepEnd + 1.5s] is uncertain as to whether
 *   the backend already deducted that call before or after the quota query executed.
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

    // 1) If raw DB retention covers [t0, t1], re-aggregate from raw calls so family reclassifications
    //    (e.g. Orchestrator (Neon) -> gemini-4-neon) and nominalFlags heal identically to live samples.
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

    // 2) Otherwise if token breakdown is stored and timestamp alignment is v2, recompute baseUSD from tokens.
    if (!needsUpgrade && s.byModelTokens) {
      const checkedDb = allCalls.length > 0;
      if (!sigMismatch && !checkedDb) {
        nextSamples.push(s);
        continue;
      }
      const nextByModel = Object.create(null);
      let nextTotalUSD = 0;
      for (const [fam, tok] of Object.entries(s.byModelTokens)) {
        const rates = rateFn(fam);
        const usd = (tok[0] || 0) * rates[0] + (tok[1] || 0) * rates[1] + (tok[2] || 0) * rates[2];
        if (usd > 0) {
          nextByModel[fam] = usd;
          nextTotalUSD += usd;
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

    // 3) Discard stale token-less samples whose pricingSig no longer matches.
    if (s.pricingSig && s.pricingSig !== currentSig) {
      changed = true;
      continue;
    }

    nextSamples.push({ ...s, pricingSig: currentSig });
    changed = true;
  }

  // Structural cleanup of degraded 1-window GetUserStatus ('user_status') samples on 2-window pools.
  const hasWeeklyWindow = Boolean((ps.gamma && ps.gamma > 0) || (ps.lastSnap?.w7ResetAtMs > 0));
  if (hasWeeklyWindow && nextSamples.some((s) => s.source === '5h_delta' && (s.du7 === null || s.du7 === undefined))) {
    ps.samples = nextSamples.filter((s) => !(s.source === '5h_delta' && (s.du7 === null || s.du7 === undefined)));
    if (ps.pricingSig !== currentSig) ps.pricingSig = currentSig;
    return true;
  }

  if (changed) ps.samples = nextSamples;
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
    // Never let a degraded 1-window user_status fallback overwrite a 2-window summary baseline.
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
        // Quota usage within an active 5h window is strictly non-decreasing; ignore stale rewind reads.
        deferSnapAdvance = true;
      } else if (same5h && du5 !== null && du5 >= -0.0005) {
        const agg = aggregateCallsInInterval(allCalls, pk, prev.fetchedAtMs, fetchedAtMs);
        // Hold prev.lastSnap open if local calls landed but server remainingPct has not settled yet.
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

function sumEffectiveLocalUSD(calls, fit) {
  let effectiveUSD = 0;
  for (const c of calls) {
    const fam = c.family || resolveModelFamily(c.modelId, c.modelDisplay, c.model);
    const baseUSD = typeof c.baseUSD === 'number'
      ? c.baseUSD
      : computeBaseReferenceUSD(c.modelId, c.modelDisplay, c.model, c.newInput, c.cachedInput, c.outputTokens).baseUSD;
    if (!(baseUSD > 0)) continue;
    const mf = fit.models?.[fam];
    if (mf?.tokenWeights && ((c.newInput || 0) + (c.cachedInput || 0) + (c.outputTokens || 0)) > 0) {
      const w = mf.tokenWeights;
      const callPct = ((c.newInput || 0) * w[0] + (c.cachedInput || 0) * w[1] + (c.outputTokens || 0) * w[2]) / 1e6;
      effectiveUSD += callPct / fit.refBeta;
    } else {
      const k = mf ? mf.k : getFamilyPriorK(fam);
      effectiveUSD += k * baseUSD;
    }
  }
  return effectiveUSD;
}

export function evaluatePoolWindowResidual({
  poolState,
  spanKey,
  usedPct,
  callsInSnap,
  callsInNow = callsInSnap,
  poolKind: explicitPoolKind = '',
}) {
  const fit = poolState?.fit;
  if (!fit || !(fit.refBeta > 0)) return null;
  const poolKind = inferPoolKindFromState(poolState, explicitPoolKind);
  const gamma = spanKey === '7d' ? (fit.gamma || poolState?.gamma || getPoolPriorGamma(poolKind) || null) : 1;
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
      // P3: Unmodeled priced families in 7d/5h windows fall back to structural kPrior * refBeta with 20% uncertainty.
      const kP = getFamilyPriorK(fam);
      const b = mf ? mf.beta : kP * fit.refBeta;
      const bErr = mf ? mf.betaPlusMinus : b * 0.20;
      pred5hPct += b * usd;
      var5h += (bErr * usd) * (bErr * usd);
    }
  }

  const effectiveSnapUSD = sumEffectiveLocalUSD(callsInSnap, fit);
  const effectiveLocalUSD = callsInNow === callsInSnap
    ? effectiveSnapUSD
    : sumEffectiveLocalUSD(callsInNow, fit);

  const predPct = pred5hPct / gamma;
  const paramBandPct = Math.sqrt(var5h) / gamma;
  const auxFloorPct = (0.03 + 0.0015 * callCount) / gamma;
  const bandPct = Math.hypot(paramBandPct, auxFloorPct) + 0.03 / gamma;

  // Signed net residual across the entire window (zero positive-clipping bias).
  const signedResidualPct = usedPct - predPct;
  const nominalDominated = totalSnapUSD > 0 && (unmodeledNominalUSD / totalSnapUSD) > 0.2;
  const hasEnoughAnchor = fit.quality === 'high' || fit.shortCleanCount >= 4;
  const hasSignificantExternal = hasEnoughAnchor && !nominalDominated && usedPct >= 0.2 && signedResidualPct > bandPct;
  const extPct = hasSignificantExternal ? signedResidualPct : 0;
  const fullUSD = spanKey === '7d'
    ? (fit.full7dUSD || (fit.full5hUSD > 0 && gamma > 0 ? fit.full5hUSD * gamma : null))
    : fit.full5hUSD;
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
    effectiveSnapUSD,
    effectiveLocalUSD,
    fullUSD,
  };
}
