/**
 * Account tier classification and Ultra 5x/20x multiplier detection.
 */
import { poolKeyForGroupLabel } from '../pricing.ts';

export interface AccountTierMeta {
  baseLabel: string;
  displayLabel: string;
  tierId: string;
  multiplier: '5x' | '20x' | null;
  multiplierSource: 'verified' | 'tier_id' | 'fitted' | 'none';
  fittedGemini5hUSD: number | null;
}

const ULTRA_5X_CAP_USD = 150.0;
const ULTRA_20X_CAP_USD = 600.0;
const ULTRA_CAP_MATCH_TOL = 0.10;

export function resolveAccountTierMeta(accountQuota: any, pools: any[] = []): AccountTierMeta {
  const baseLabel = String(accountQuota?.tierName || accountQuota?.planName || '').trim();
  const tierId = String(accountQuota?.tierId || '').trim();
  const idLower = tierId.toLowerCase();
  const isUltra = /\bultra\b/i.test(baseLabel) || idLower.includes('ultra');

  if (!isUltra) {
    return {
      baseLabel,
      displayLabel: baseLabel,
      tierId,
      multiplier: null,
      multiplierSource: 'none',
      fittedGemini5hUSD: null,
    };
  }

  let idMult: '5x' | '20x' | null = null;
  if (idLower === 'g1-ultra-lite-tier' || /ultra[-_]?lite|ultra[-_]?5x/i.test(idLower)) {
    idMult = '5x';
  } else if (idLower === 'g1-ultra-tier' || /ultra[-_]?20x/i.test(idLower)) {
    idMult = '20x';
  }

  const geminiPool = (Array.isArray(pools) ? pools : []).find(
    (p) => poolKeyForGroupLabel(p?.label) === 'gemini',
  );
  const fs = geminiPool?.fitSummary;
  const hasObservedModel = Array.isArray(fs?.models) && fs.models.some((m: any) => m?.source && m.source !== 'prior');
  const observedWins = Math.max(fs?.inlierCount || 0, fs?.shortCleanCount || 0);
  const hasEmpiricalFit = Boolean(
    fs
    && !fs.driftWarning
    && typeof fs.full5hUSD === 'number'
    && Number.isFinite(fs.full5hUSD)
    && fs.full5hUSD > 0
    && observedWins >= 2
    && hasObservedModel,
  );

  const fittedGemini5hUSD = hasEmpiricalFit ? fs.full5hUSD : null;
  let fitMult: '5x' | '20x' | null = null;
  if (fittedGemini5hUSD !== null) {
    if (Math.abs(fittedGemini5hUSD - ULTRA_5X_CAP_USD) / ULTRA_5X_CAP_USD <= ULTRA_CAP_MATCH_TOL) {
      fitMult = '5x';
    } else if (Math.abs(fittedGemini5hUSD - ULTRA_20X_CAP_USD) / ULTRA_20X_CAP_USD <= ULTRA_CAP_MATCH_TOL) {
      fitMult = '20x';
    }
  }

  let multiplier: '5x' | '20x' | null = null;
  let multiplierSource: AccountTierMeta['multiplierSource'] = 'none';
  if (idMult && fitMult && idMult === fitMult) {
    multiplier = idMult;
    multiplierSource = 'verified';
  } else if (fitMult) {
    multiplier = fitMult;
    multiplierSource = 'fitted';
  } else if (idMult) {
    // If a high-confidence empirical fit contradicts all known 5x/20x caps (e.g. a future tier resize),
    // avoid forcing a stale tierId label.
    if (hasEmpiricalFit && fs?.quality === 'high') {
      multiplier = null;
      multiplierSource = 'none';
    } else {
      multiplier = idMult;
      multiplierSource = 'tier_id';
    }
  }

  let displayLabel = baseLabel;
  if (baseLabel && multiplier && !new RegExp(`\\b${multiplier}\\b`, 'i').test(baseLabel)) {
    const multTag = multiplierSource === 'fitted' ? `~${multiplier}` : multiplier;
    displayLabel = `${baseLabel} · ${multTag}`;
  }

  return {
    baseLabel,
    displayLabel,
    tierId,
    multiplier,
    multiplierSource,
    fittedGemini5hUSD,
  };
}
