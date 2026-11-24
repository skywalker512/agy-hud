import type { ChartMetric, Invocation } from '../../../types/telemetry';
import { fmtCachePct, fmtNum, fmtQuotaPct, fmtSec, fmtTps, formatModelTag } from '../../../utils/format';
import { TREND_RANGE_STORAGE_KEY, isSavedRangePreset, type RangePreset } from '../trendMath';

export function estimateSvgLabelWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x7f ? 9.4 : 5.4;
  }
  return Math.ceil(w) + 10;
}

export function shortArenaModelName(label: string): string {
  return label
    .replace(/^Gemini\s+/i, '')
    .replace(/^4\s+Hydrogen$/i, 'Hydro')
    .replace(/^4\s+Carbon$/i, 'Carbon')
    .replace(/^4\s+Neon$/i, 'Neon')
    .replace(/^4\s+Argon$/i, 'Argon');
}

export function readSavedPreset(): Exclude<RangePreset, 'custom'> | null {
  try {
    const raw = window.localStorage.getItem(TREND_RANGE_STORAGE_KEY);
    return isSavedRangePreset(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeSavedPreset(preset: Exclude<RangePreset, 'custom'>): void {
  try {
    window.localStorage.setItem(TREND_RANGE_STORAGE_KEY, preset);
  } catch {
    // Ignore storage errors in restricted webviews
  }
}

export function getModelKey(r: Invocation): string {
  return formatModelTag(r.modelId, r.modelDisplay, r.model) || 'unknown';
}

export function shortTierSuffix(probe: string): string {
  const m = /(?:\(|-)(xhigh|high|medium|low|minimal)\)?\s*$/i.exec(probe.trim());
  if (!m) return '';
  const tier = m[1].toLowerCase();
  if (tier === 'xhigh') return '·XH';
  if (tier === 'low') return '·L';
  if (tier === 'medium') return '·M';
  if (tier === 'minimal') return '·Min';
  return '';
}

export function shortModelName(r: Invocation): string {
  const fullTag = formatModelTag(r.modelId, r.modelDisplay, r.model);
  const probe = `${r.modelDisplay || ''} ${fullTag} ${r.model || ''}`.toLowerCase();
  const tier = shortTierSuffix(fullTag || r.modelDisplay || '');
  if (probe.includes('orchestrator')) {
    if (probe.includes('carbon')) return 'Orch·Carbon';
    if (probe.includes('neon')) return 'Orch·Neon';
    if (probe.includes('argon')) return 'Orch·Argon';
    if (probe.includes('hydrogen')) return 'Orch·Hydro';
    return 'Orchestrator';
  }
  if (probe.includes('flash-worker')) return 'Flash·Worker';
  if (probe.includes('3.8-flash') || probe.includes('3.8 flash')) return `3.8 Flash${tier}`;
  if (probe.includes('carbon')) return `Carbon${tier}`;
  if (probe.includes('argon')) return `Argon${tier}`;
  if (probe.includes('hydrogen')) return `Hydrogen${tier}`;
  if (probe.includes('neon')) return `Neon${tier}`;
  if (probe.includes('opus')) return `Opus${tier}`;
  if (probe.includes('sonnet')) return `Sonnet${tier}`;
  const raw = r.modelDisplay || fullTag || r.model || 'Model';
  return raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
}

export function preferredModelColor(r: Invocation): string {
  const probe = `${r.modelDisplay || ''} ${r.modelId || ''} ${r.model || ''}`.toLowerCase();
  if (probe.includes('flash') || probe.includes('hydrogen')) {
    return 'var(--seg-cache)';
  }
  if (probe.includes('neon') || probe.includes('sonnet')) {
    return 'var(--seg-input)';
  }
  if (probe.includes('orchestrator') || probe.includes('carbon') || probe.includes('argon') || probe.includes('opus')) {
    return 'var(--seg-think)';
  }
  return 'var(--seg-out)';
}

export function formatModelMetricAvg(items: Invocation[], metric: ChartMetric): string {
  if (!items.length) return '';
  if (metric === 'ttft') {
    const avg = items.reduce((s, r) => s + (r.ttftSec || 0), 0) / items.length;
    return fmtSec(avg);
  }
  if (metric === 'out') {
    const avg = items.reduce((s, r) => s + (r.outputTokens || 0), 0) / items.length;
    return fmtNum(avg);
  }
  if (metric === 'cache') {
    const valid = items.map((r) => r.cacheHitPct).filter((v): v is number => v !== null && Number.isFinite(v));
    const avg = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    return fmtCachePct(avg);
  }
  if (metric === 'ctx') {
    return `${items.length}`;
  }
  if (metric === 'quota') {
    const avg = items.reduce((s, r) => s + (r.quotaPct5h || 0), 0) / items.length;
    const f = fmtQuotaPct(avg);
    return f ? `-${f}` : '';
  }
  const sustained = items.filter((r) => !r.isBuffered && r.genTps > 0);
  const pool = sustained.length ? sustained : items;
  const avg = pool.reduce((s, r) => s + (r.isBuffered ? r.e2eTps : r.genTps), 0) / pool.length;
  return `${fmtTps(avg)} t/s`;
}

export function fmtSignedPct(deltaPct: number): string {
  const rounded = Math.round(deltaPct);
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

export function fmtSignedPp(deltaPp: number): string {
  const rounded = Number(deltaPp.toFixed(1));
  if (Math.abs(rounded) < 0.05) return '0pp';
  return rounded > 0 ? `+${rounded.toFixed(1)}pp` : `${rounded.toFixed(1)}pp`;
}

export function formatPrimaryMetricValue(inv: Invocation, metric: ChartMetric): string {
  if (metric === 'ttft') return fmtSec(inv.ttftSec);
  if (metric === 'out') return `${fmtNum(inv.outputTokens)} tok`;
  if (metric === 'cache') return fmtCachePct(inv.cacheHitPct);
  if (metric === 'ctx') return `${(inv.contextPct || 0).toFixed(1)}%`;
  if (metric === 'quota') {
    const q = fmtQuotaPct(inv.quotaPct5h);
    return q ? `-${q}` : '0%';
  }
  const v = inv.isBuffered ? inv.e2eTps : inv.genTps;
  return `${fmtTps(v)} t/s`;
}
