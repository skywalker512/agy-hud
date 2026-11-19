import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PRICING_CONFIG, MODEL_LIMIT_FALLBACKS } from './constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL_ROOT = dirname(__dirname);

export function loadPricingConfig(pricingJsonPath = join(PANEL_ROOT, 'pricing.json')) {
  try {
    const raw = JSON.parse(readFileSync(pricingJsonPath, 'utf8'));
    if (Array.isArray(raw?.rules) && raw.rules.length) {
      return {
        unpricedSubstrings: Array.isArray(raw.unpricedSubstrings)
          ? raw.unpricedSubstrings.map((s) => String(s).toLowerCase())
          : DEFAULT_PRICING_CONFIG.unpricedSubstrings,
        rules: raw.rules.map((r) => ({
          ...r,
          match: (r.match || []).map((m) => String(m).toLowerCase()),
          gaCutoffMs: r.gaCutoffIso ? (Date.parse(r.gaCutoffIso) || 0) : 0,
        })),
      };
    }
  } catch {
    /* fall back to built-in defaults */
  }
  return {
    unpricedSubstrings: DEFAULT_PRICING_CONFIG.unpricedSubstrings,
    rules: DEFAULT_PRICING_CONFIG.rules.map((r) => ({
      ...r,
      gaCutoffMs: r.gaCutoffIso ? (Date.parse(r.gaCutoffIso) || 0) : 0,
    })),
  };
}

const PRICING_CONFIG = loadPricingConfig();

export function getPricingVectorSig(config = PRICING_CONFIG) {
  const canonical = {
    unpriced: config.unpricedSubstrings || [],
    baseRules: (config.rules || []).map((r) => {
      const base = r.preview || { key: r.key, input: r.input, cached: r.cached, output: r.output };
      return {
        match: r.match || [],
        key: base.key || '',
        input: base.input,
        cached: base.cached,
        output: base.output,
      };
    }),
  };
  return createHash('sha1').update(JSON.stringify(canonical)).digest('hex').slice(0, 12);
}

const PRICING_VECTOR_SIG = getPricingVectorSig(PRICING_CONFIG);

export function getCurrentPricingSig() {
  return PRICING_VECTOR_SIG;
}

export function resolveModelPricing(modelId, modelDisplay, model, timestampMs = 0) {
  const probe = `${modelId || ''} ${modelDisplay || ''} ${model || ''}`.toLowerCase();
  if (!probe.trim()) return null;
  for (const skip of PRICING_CONFIG.unpricedSubstrings) {
    if (skip && probe.includes(skip)) return null;
  }
  for (const rule of PRICING_CONFIG.rules) {
    if (!rule.match?.some((m) => m && probe.includes(m))) continue;
    if (rule.ga && rule.preview) {
      const useGa = rule.gaCutoffMs > 0 && timestampMs >= rule.gaCutoffMs;
      return useGa ? rule.ga : rule.preview;
    }
    return { key: rule.key, input: rule.input, output: rule.output, cached: rule.cached };
  }
  return null;
}

export function computeCallCost(modelId, modelDisplay, model, newInput, cachedInput, outputTokens, timestampMs = 0) {
  const rates = resolveModelPricing(modelId, modelDisplay, model, timestampMs);
  if (!rates) return { priced: false, pricingKey: '', costUSD: 0, cacheSavedUSD: 0 };
  const costUSD = (newInput * rates.input + cachedInput * rates.cached + outputTokens * rates.output) / 1e6;
  const cacheSavedUSD = (cachedInput * Math.max(0, rates.input - rates.cached)) / 1e6;
  return { priced: true, pricingKey: rates.key, costUSD, cacheSavedUSD };
}

export function resolveLimitFallback(model) {
  for (const [re, limit] of MODEL_LIMIT_FALLBACKS) {
    if (re.test(model || '')) return limit;
  }
  return 256_000;
}

export function poolKeyForModel(modelId, modelDisplay, model) {
  const s = `${modelId || ''} ${modelDisplay || ''} ${model || ''}`.toLowerCase();
  if (s.includes('claude') || s.includes('gpt')) return 'claude_gpt';
  if (
    s.includes('gemini')
    || s.includes('neon')
    || s.includes('carbon')
    || s.includes('argon')
    || s.includes('hydrogen')
    || s.includes('orchestrator')
  ) return 'gemini';
  return 'other';
}

export function poolKeyForGroupLabel(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('argon')) return 'argon';
  if (s.includes('claude') || s.includes('gpt')) return 'claude_gpt';
  if (s.includes('gemini')) return 'gemini';
  return 'other';
}
