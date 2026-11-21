import type { Lang } from '../types/telemetry';

export const LANG_STORAGE_KEY = 'agy_hud_lang';
export const LANG_SOURCE_KEY = 'agy_hud_lang_source';
export const AUTO_LOCALE_CACHE_KEY = 'agy_hud_lang_auto_cache';
export const AUTO_LOCALE_CACHE_VERSION = 1;
export const AUTO_LOCALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CLIENT_LOCALE_SCORE_THRESHOLD = 0.6;

const CHINESE_LOCALE_RE = /^(?:zh|cmn|yue)(?:$|[-_.@])/i;
const CHINESE_REGION_SUBTAG_RE = /^(?:cn|tw|hk|mo)$/i;

const CHINESE_TIMEZONES = new Set([
  'asia/shanghai',
  'asia/chongqing',
  'asia/chungking',
  'asia/harbin',
  'asia/urumqi',
  'asia/kashgar',
  'asia/beijing',
  'asia/hong_kong',
  'asia/taipei',
  'asia/macau',
  'asia/macao',
  'prc',
  'hongkong',
  'roc',
]);

/** Fonts that are NOT bundled by default on English macOS/Windows and strongly indicate Chinese usage. */
const THIRD_PARTY_CJK_FONTS = [
  'LXGW WenKai',
  'Source Han Sans SC',
  'Source Han Serif SC',
  'Sarasa Gothic SC',
  'Sarasa Mono SC',
  'Alibaba PuHuiTi',
  'HarmonyOS Sans SC',
  'MiSans',
  'Smiley Sans',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
] as const;

/** OS-bundled CJK fonts (macOS ships PingFang/Hiragino globally so weight is 0 on macOS). */
const SYSTEM_CJK_FONTS = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'SimSun',
  'Noto Sans CJK SC',
] as const;

const CANVAS_PROBE_TEXT = '中文测测试永国漢字';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AutoLocaleCacheEntry {
  v: number;
  lang: Lang;
  confidence: number;
  score: number;
  source: 'client' | 'server';
  fingerprint: string;
  updatedAt: number;
  expiresAt: number;
}

export interface ClientLocaleEnv {
  languages?: readonly string[];
  language?: string;
  userAgent?: string;
  platform?: string;
  intlLocale?: string;
  timeZone?: string;
  probeFonts?: () => { thirdParty: string[]; system: string[] };
  now?: () => number;
}

export interface ClientLocaleHeuristicResult {
  lang: Lang;
  confidence: number;
  score: number;
  signals: {
    languages: string[];
    intlLocale: string;
    timeZone: string;
    isChineseTimezone: boolean;
    thirdPartyCjkFonts: string[];
    systemCjkFonts: string[];
  };
}

export interface ServerLocaleResponse {
  lang?: string;
  confidence?: number;
  score?: number;
  cached?: boolean;
  detectedAt?: number;
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isValidLang(v: unknown): v is Lang {
  return v === 'en' || v === 'zh';
}

function isChineseTag(tag: string): boolean {
  const cleaned = String(tag || '').trim();
  if (!cleaned) return false;
  return CHINESE_LOCALE_RE.test(cleaned);
}

function hasChineseRegion(tag: string): boolean {
  const cleaned = String(tag || '').trim().split('.')[0].split('@')[0];
  if (!cleaned) return false;
  const parts = cleaned.split(/[-_]/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.slice(1).some((p) => CHINESE_REGION_SUBTAG_RE.test(p));
}

function isChineseTz(tz: string): boolean {
  return CHINESE_TIMEZONES.has(String(tz || '').trim().toLowerCase());
}

function getBrowserLanguages(env?: ClientLocaleEnv): string[] {
  if (env?.languages) {
    return env.languages.map((s) => String(s || '').trim()).filter(Boolean);
  }
  const out: string[] = [];
  try {
    if (typeof navigator !== 'undefined') {
      if (Array.isArray(navigator.languages)) {
        for (const l of navigator.languages) {
          const t = String(l || '').trim();
          if (t && !out.includes(t)) out.push(t);
        }
      }
      const primary = String(env?.language ?? navigator.language ?? '').trim();
      if (primary && !out.includes(primary)) out.unshift(primary);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function getBrowserIntl(env?: ClientLocaleEnv): { intlLocale: string; timeZone: string } {
  if (env?.intlLocale !== undefined && env?.timeZone !== undefined) {
    return { intlLocale: env.intlLocale, timeZone: env.timeZone };
  }
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    return {
      intlLocale: env?.intlLocale ?? String(opts.locale || ''),
      timeZone: env?.timeZone ?? String(opts.timeZone || ''),
    };
  } catch {
    return {
      intlLocale: env?.intlLocale ?? '',
      timeZone: env?.timeZone ?? '',
    };
  }
}

function isMacBrowser(env?: ClientLocaleEnv): boolean {
  try {
    const plat = env?.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
    const ua = env?.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    return /mac/i.test(plat) || /mac os x|macintosh/i.test(ua);
  } catch {
    return false;
  }
}

/**
 * Canvas glyph width comparison for CJK font rendering availability.
 * Compares rendered width of Chinese sample text against monospace & serif baselines.
 */
export function probeCanvasCjkFonts(): { thirdParty: string[]; system: string[] } {
  const empty = { thirdParty: [] as string[], system: [] as string[] };
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return empty;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext?.('2d');
    if (!ctx || typeof ctx.measureText !== 'function') return empty;

    const baselines = ['monospace', 'serif'] as const;
    const baseWidths: Record<string, number> = {};
    for (const base of baselines) {
      ctx.font = `72px ${base}`;
      baseWidths[base] = ctx.measureText(CANVAS_PROBE_TEXT).width;
    }

    const isFontAvailable = (family: string): boolean => {
      for (const base of baselines) {
        ctx.font = `72px "${family}", ${base}`;
        const w = ctx.measureText(CANVAS_PROBE_TEXT).width;
        if (Math.abs(w - baseWidths[base]) > 0.5) {
          return true;
        }
      }
      return false;
    };

    const thirdParty = THIRD_PARTY_CJK_FONTS.filter(isFontAvailable);
    const system = SYSTEM_CJK_FONTS.filter(isFontAvailable);
    return { thirdParty, system };
  } catch {
    return empty;
  }
}

export function computeBrowserLocaleFingerprint(env?: ClientLocaleEnv): string {
  const langs = getBrowserLanguages(env);
  const { intlLocale, timeZone } = getBrowserIntl(env);
  return `${langs.join(',')}|${intlLocale}|${timeZone}`;
}

/**
 * Priority 1: Read explicit manual user language preference.
 * Preserves backward compatibility for existing users who clicked toggle before
 * `agy_hud_lang_source` existed (legacy `agy_hud_lang` was only ever written on toggle).
 */
export function getUserLangPreference(storage: StorageLike | null = getDefaultStorage()): Lang | null {
  if (!storage) return null;
  try {
    const savedLang = storage.getItem(LANG_STORAGE_KEY);
    if (!isValidLang(savedLang)) return null;
    const source = storage.getItem(LANG_SOURCE_KEY);
    if (source === 'user' || source === null || source === '') {
      return savedLang;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasUserLangPreference(storage: StorageLike | null = getDefaultStorage()): boolean {
  return getUserLangPreference(storage) !== null;
}

export function saveUserLangPreference(
  lang: Lang,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LANG_STORAGE_KEY, lang);
    storage.setItem(LANG_SOURCE_KEY, 'user');
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Priority 2: Read cached heuristic result from localStorage (schema version + TTL + fingerprint).
 */
export function readAutoLocaleCache(
  storage: StorageLike | null = getDefaultStorage(),
  env?: ClientLocaleEnv,
): AutoLocaleCacheEntry | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTO_LOCALE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutoLocaleCacheEntry>;
    const nowMs = env?.now ? env.now() : Date.now();
    const expectedFp = computeBrowserLocaleFingerprint(env);
    if (
      !parsed ||
      parsed.v !== AUTO_LOCALE_CACHE_VERSION ||
      !isValidLang(parsed.lang) ||
      (parsed.source !== 'client' && parsed.source !== 'server') ||
      typeof parsed.expiresAt !== 'number' ||
      nowMs >= parsed.expiresAt ||
      parsed.fingerprint !== expectedFp
    ) {
      return null;
    }
    return {
      v: AUTO_LOCALE_CACHE_VERSION,
      lang: parsed.lang,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      score: typeof parsed.score === 'number' ? parsed.score : 0.7,
      source: parsed.source,
      fingerprint: parsed.fingerprint,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : nowMs,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function writeAutoLocaleCache(
  entry: { lang: Lang; confidence: number; score: number; source: 'client' | 'server' },
  storage: StorageLike | null = getDefaultStorage(),
  env?: ClientLocaleEnv,
  ttlMs = AUTO_LOCALE_CACHE_TTL_MS,
): void {
  if (!storage) return;
  try {
    const nowMs = env?.now ? env.now() : Date.now();
    const payload: AutoLocaleCacheEntry = {
      v: AUTO_LOCALE_CACHE_VERSION,
      lang: entry.lang,
      confidence: entry.confidence,
      score: entry.score,
      source: entry.source,
      fingerprint: computeBrowserLocaleFingerprint(env),
      updatedAt: nowMs,
      expiresAt: nowMs + ttlMs,
    };
    storage.setItem(AUTO_LOCALE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Priority 3: Synchronous client-side heuristic scoring.
 */
export function detectClientLocale(env?: ClientLocaleEnv): ClientLocaleHeuristicResult {
  const languages = getBrowserLanguages(env);
  const { intlLocale, timeZone } = getBrowserIntl(env);
  const isChineseTimezone = isChineseTz(timeZone);
  const fontProbe = env?.probeFonts ? env.probeFonts() : probeCanvasCjkFonts();

  const primaryCandidates = [languages[0], intlLocale].filter(Boolean) as string[];
  const secondaryCandidates = languages.slice(1);

  const primaryScore = primaryCandidates.some(isChineseTag) ? 1.0 : 0;
  const secondaryScore =
    primaryScore === 0 && secondaryCandidates.some(isChineseTag) ? 0.45 : 0;
  const regionScore =
    primaryScore === 0 && primaryCandidates.some(hasChineseRegion) ? 0.35 : 0;
  const tzScore = isChineseTimezone ? 0.35 : 0;

  let fontScore = 0;
  if (fontProbe.thirdParty.length > 0) {
    fontScore = 0.3;
  } else if (fontProbe.system.length > 0 && !isMacBrowser(env)) {
    fontScore = 0.15;
  }

  const rawScore = primaryScore + secondaryScore + regionScore + tzScore + fontScore;
  const score = Number(Math.min(1, rawScore).toFixed(3));
  const lang: Lang = score >= CLIENT_LOCALE_SCORE_THRESHOLD ? 'zh' : 'en';
  const confidence =
    lang === 'zh'
      ? Number(Math.min(1, Math.max(0.55, score)).toFixed(3))
      : Number(Math.min(1, Math.max(0.5, 1 - score)).toFixed(3));

  return {
    lang,
    confidence,
    score,
    signals: {
      languages,
      intlLocale,
      timeZone,
      isChineseTimezone,
      thirdPartyCjkFonts: fontProbe.thirdParty,
      systemCjkFonts: fontProbe.system,
    },
  };
}

/**
 * Synchronous initial language resolution (zero-flicker):
 * 1. Explicit manual user preference
 * 2. Valid cached heuristic result in localStorage
 * 3. Live synchronous client-side heuristic (cached as source='client')
 */
export function resolveInitialLang(
  storage: StorageLike | null = getDefaultStorage(),
  env?: ClientLocaleEnv,
): Lang {
  const manual = getUserLangPreference(storage);
  if (manual) return manual;

  const cached = readAutoLocaleCache(storage, env);
  if (cached) return cached.lang;

  const detected = detectClientLocale(env);
  writeAutoLocaleCache(
    {
      lang: detected.lang,
      confidence: detected.confidence,
      score: detected.score,
      source: 'client',
    },
    storage,
    env,
  );
  return detected.lang;
}

/**
 * Returns true only when no manual user preference exists AND no fresh server-refined cache exists.
 */
export function shouldRefineLocaleFromServer(
  storage: StorageLike | null = getDefaultStorage(),
  env?: ClientLocaleEnv,
): boolean {
  if (hasUserLangPreference(storage)) return false;
  const cached = readAutoLocaleCache(storage, env);
  if (cached && cached.source === 'server') return false;
  return true;
}

/**
 * Priority 4: Async refinement from sidecar GET /api/locale.
 * Never overwrites an explicit manual user preference (re-checked both before and after await).
 */
export async function refineLocaleFromServer(
  fetcher: typeof fetch,
  signal?: AbortSignal,
  storage: StorageLike | null = getDefaultStorage(),
  env?: ClientLocaleEnv,
): Promise<Lang | null> {
  if (!shouldRefineLocaleFromServer(storage, env)) return null;
  try {
    const res = await fetcher('/api/locale', signal ? { method: 'GET', signal } : { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerLocaleResponse;
    if (!isValidLang(data?.lang)) return null;
    if (hasUserLangPreference(storage)) return null;
    writeAutoLocaleCache(
      {
        lang: data.lang,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.8,
        score: typeof data.score === 'number' ? data.score : data.lang === 'zh' ? 0.8 : 0.2,
        source: 'server',
      },
      storage,
      env,
    );
    return data.lang;
  } catch {
    return null;
  }
}
