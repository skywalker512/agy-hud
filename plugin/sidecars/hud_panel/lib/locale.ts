/**
 * Multi-signal heuristic Chinese-user language detection + persistent disk/memory caching.
 *
 * Probes OS/environment locales, regional preferences, Chinese input methods,
 * timezone, and CJK fonts (carefully separating user-installed Chinese fonts
 * from OS-bundled fonts like macOS PingFang.ttc) using safe, timeout-bounded
 * execFileSync calls (no shell invocation).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resolveAppDataDir } from './constants.ts';

export type DetectedLang = 'zh' | 'en';

export const LOCALE_CACHE_VERSION = 1;
export const LOCALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const LOCALE_SCORE_THRESHOLD = 0.6;

export const SCORE_WEIGHTS = {
  PRIMARY_LOCALE: 1.0,
  SECONDARY_LOCALE: 0.45,
  REGION_LOCALE: 0.35,
  TIMEZONE: 0.35,
  INPUT_METHOD: 0.3,
  USER_CHINESE_FONTS: 0.3,
  LINUX_SYSTEM_CHINESE_FONTS: 0.25,
  WINDOWS_SYSTEM_CHINESE_FONTS: 0.15,
  DARWIN_SYSTEM_CHINESE_FONTS: 0,
} as const;

export const CHINESE_TIMEZONES = new Set([
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

const CHINESE_LOCALE_RE = /^(?:zh|cmn|yue)(?:$|[-_.@])/i;
const CHINESE_REGION_SUBTAG_RE = /(?:^|[-_])(?:cn|tw|hk|mo)(?:$|[-_.@])/i;
const CHINESE_RG_EXT_RE = /@rg=(?:cn|tw|hk|mo)[a-z0-9]*/i;

const CJK_IDEOGRAPH_RE = /[\u4e00-\u9fff]/;
const JAPANESE_KOREAN_SCRIPT_RE = /[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff]/;
const NON_CHINESE_CJK_SUFFIX_RE = /(?:cjk[\s_-]*(?:jp|kr)|source[\s_-]*han[\s_-]*(?:sans|serif)[\s_-]*(?:jp|kr|[jk]\b)|noto[\s_-]*(?:sans|serif)[\s_-]*(?:jp|kr|cjk[\s_-]*(?:jp|kr))\b)/i;

const CHINESE_FONT_PATTERNS: readonly RegExp[] = [
  /pingfang/i,
  /stheiti|stsong|stkaiti|stfangsong|stxingka|stxinwei|stzhongsong|stcaiyun|sthupo|stliti/i,
  /\b(?:songti|kaiti|heiti|fangsong|simsun|nsimsun|simsunb|simhei|simkai|simfang)\b/i,
  /hiragino[\s_-]*sans[\s_-]*gb/i,
  /\b(?:msyh|msyhl|msyhbd|msjh|msjhl|msjhbd|mingliu|pmingliu|dengxian|youyuan|lisu)\b/i,
  /microsoft[\s_-]*(?:yahei|jhenghei)/i,
  /noto[\s_-]*(?:sans|serif)[\s_-]*(?:sc|tc|hk|cjk(?:[\s_-]*(?:sc|tc|hk))?)\b/i,
  /source[\s_-]*han[\s_-]*(?:sans|serif)(?:[\s_-]*(?:sc|tc|cn|tw|hk|hc))?\b/i,
  /lxgw|wenkai/i,
  /sarasa[\s_-]*(?:(?:mono|gothic|ui|term|fixed)[\s_-]*)?(?:sc|tc|hc|cl|cn)\b/i,
  /wenquanyi|\bwqy\b/i,
  /ar[\s_-]*pl[\s_-]*(?:ukai|uming|sungtil|kaitim)/i,
  /alibaba[\s_-]*puhui|puhuiti/i,
  /harmonyos[\s_-]*sans[\s_-]*(?:sc|tc|cn)/i,
  /misans|smileysans|opposans|tsanger|zcool|mashanzheng|zhimangxing|hyqihei/i,
  /\bfz(?:fangsong|kai|shusong|hei|stk|ytk)/i,
  /maple[\s_-]*mono.*cn/i,
  /lantinghei|hannotate|hanzipen|wawati|weibei|xingkai|yuanti|libian|lingwai|baoli/i,
];

const MACOS_CHINESE_IM_PATTERNS: readonly [string, RegExp][] = [
  ['SCIM', /com\.apple\.inputmethod\.SCIM/i],
  ['TCIM', /com\.apple\.inputmethod\.TCIM/i],
  ['TYIM', /com\.apple\.inputmethod\.TYIM/i],
  ['Sogou', /com\.sogou\.inputmethod/i],
  ['Baidu', /com\.baidu\.inputmethod/i],
  ['Rime', /(?:im|org)\.rime\.inputmethod|squirrel/i],
  ['WeType', /com\.(?:tencent|wetype)\.inputmethod/i],
  ['iFlytek', /com\.iflytek\.inputmethod/i],
  ['ByteDance', /com\.bytedance\.inputmethod/i],
  ['PinyinMode', /"Input Mode"\s*=\s*"[^"]*(?:Pinyin|Shuangpin|Wubi|Zhuyin|Cangjie|Sucheng|ITABC)/i],
];

const LINUX_CHINESE_IM_RE = /(?:rime|sunpinyin|libpinyin|googlepinyin|chewing|wubi|pinyin|zhuyin|cangjie)/i;

const FONT_EXT_RE = /\.(?:ttf|otf|ttc|otc|woff2?)$/i;

export interface FontProbeResult {
  userChineseFonts: string[];
  systemChineseFonts: string[];
  fcListChineseFonts: string[];
  systemOnly: boolean;
}

export interface ScoreBreakdown {
  primaryLocale: number;
  secondaryLocale: number;
  regionLocale: number;
  timezone: number;
  inputMethod: number;
  fonts: number;
}

export interface LocaleSignals {
  platform: NodeJS.Platform;
  envLocales: {
    LC_ALL: string;
    LC_MESSAGES: string;
    LANG: string;
    LANGUAGE: string;
  };
  intlLocale: string;
  osPrimaryLocale: string;
  osSecondaryLocales: string[];
  osRegionLocale: string;
  timezone: string;
  isChineseTimezone: boolean;
  chineseInputMethod: boolean;
  inputMethodMatches: string[];
  fonts: FontProbeResult;
  scoreBreakdown: ScoreBreakdown;
}

export interface LocaleDetectionResult {
  lang: DetectedLang;
  confidence: number;
  score: number;
  signals: LocaleSignals;
  cached: boolean;
  detectedAt: number;
}

export interface LocaleProbeDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  intlLocale: string;
  intlTimeZone: string;
  homeDir: string;
  now: () => number;
  execFile: (file: string, args: string[], timeoutMs: number) => string;
  readTextFile: (filePath: string) => string;
  listDirEntries: (dirPath: string) => { name: string; isDir: boolean }[];
  dirExists: (dirPath: string) => boolean;
}

export interface DetectLocaleOptions {
  appDataDir?: string;
  cachePath?: string | null;
  ttlMs?: number;
  forceRefresh?: boolean;
  deps?: Partial<LocaleProbeDeps>;
}

interface PersistedLocaleCache {
  version: number;
  fingerprint: string;
  expiresAt: number;
  result: Omit<LocaleDetectionResult, 'cached'>;
}

interface MemoryCacheEntry {
  cacheKey: string;
  fingerprint: string;
  expiresAt: number;
  result: Omit<LocaleDetectionResult, 'cached'>;
}

let memoryCache: MemoryCacheEntry | null = null;

export function resetLocaleMemoryCache(): void {
  memoryCache = null;
}

function defaultExecFile(file: string, args: string[], timeoutMs: number): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function defaultReadTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function defaultListDirEntries(dirPath: string): { name: string; isDir: boolean }[] {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

function defaultDirExists(dirPath: string): boolean {
  try {
    return existsSync(dirPath);
  } catch {
    return false;
  }
}

function getDefaultIntlOptions(): { locale: string; timeZone: string } {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    return {
      locale: String(resolved.locale || ''),
      timeZone: String(resolved.timeZone || ''),
    };
  } catch {
    return { locale: '', timeZone: '' };
  }
}

function buildDeps(partial?: Partial<LocaleProbeDeps>): LocaleProbeDeps {
  const intl = getDefaultIntlOptions();
  return {
    platform: partial?.platform ?? process.platform,
    env: partial?.env ?? process.env,
    intlLocale: partial?.intlLocale ?? intl.locale,
    intlTimeZone: partial?.intlTimeZone ?? intl.timeZone,
    homeDir: partial?.homeDir ?? homedir(),
    now: partial?.now ?? (() => Date.now()),
    execFile: partial?.execFile ?? defaultExecFile,
    readTextFile: partial?.readTextFile ?? defaultReadTextFile,
    listDirEntries: partial?.listDirEntries ?? defaultListDirEntries,
    dirExists: partial?.dirExists ?? defaultDirExists,
  };
}

export function cleanLocaleTag(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (upper === 'C' || upper === 'POSIX' || upper === 'C.UTF-8' || upper === 'C.UTF8') {
    return '';
  }
  return trimmed;
}

export function isChineseLocaleTag(raw: string): boolean {
  const cleaned = cleanLocaleTag(raw);
  if (!cleaned) return false;
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('chinese')) return true;
  return CHINESE_LOCALE_RE.test(cleaned);
}

export function hasChineseRegionTag(raw: string): boolean {
  const cleaned = cleanLocaleTag(raw);
  if (!cleaned) return false;
  if (CHINESE_RG_EXT_RE.test(cleaned)) return true;
  const withoutEncoding = cleaned.split('.')[0].split('@')[0];
  const parts = withoutEncoding.split(/[-_]/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.slice(1).some((p) => CHINESE_REGION_SUBTAG_RE.test(p));
}

export function isChineseTimezone(tz: string): boolean {
  const normalized = String(tz || '').trim().toLowerCase();
  if (!normalized) return false;
  return CHINESE_TIMEZONES.has(normalized);
}

export function matchesChineseFontName(name: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (JAPANESE_KOREAN_SCRIPT_RE.test(trimmed)) return false;
  if (NON_CHINESE_CJK_SUFFIX_RE.test(trimmed)) return false;
  if (CJK_IDEOGRAPH_RE.test(trimmed)) return true;
  return CHINESE_FONT_PATTERNS.some((re) => re.test(trimmed));
}

export function parseAppleLanguages(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const inner = text.replace(/^\(/, '').replace(/\)\s*$/, '');
  const out: string[] = [];
  for (const part of inner.split(/[,\r\n]+/)) {
    const cleaned = cleanLocaleTag(part);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

export function parseLocaleConf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val) out[key] = val;
  }
  return out;
}

export function parseMacOsInputSources(raw: string): string[] {
  const text = String(raw || '');
  if (!text) return [];
  const matches: string[] = [];
  for (const [label, re] of MACOS_CHINESE_IM_PATTERNS) {
    if (re.test(text)) matches.push(label);
  }
  return matches;
}

export function parseWindowsPowerShellLocale(raw: string): {
  uiCulture: string;
  culture: string;
  languageList: string[];
} {
  let uiCulture = '';
  let culture = '';
  let languageList: string[] = [];
  for (const rawLine of String(raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('UI=')) {
      uiCulture = cleanLocaleTag(line.slice(3));
    } else if (line.startsWith('CULTURE=')) {
      culture = cleanLocaleTag(line.slice(8));
    } else if (line.startsWith('LIST=')) {
      languageList = line
        .slice(5)
        .split(',')
        .map((s) => cleanLocaleTag(s))
        .filter(Boolean);
    }
  }
  return { uiCulture, culture, languageList };
}

export function parseWindowsRegLocale(raw: string): string {
  const m = /LocaleName\s+REG_\w+\s+(\S+)/i.exec(String(raw || ''));
  return m ? cleanLocaleTag(m[1]) : '';
}

function scanFontDirs(
  dirs: string[],
  deps: LocaleProbeDeps,
  maxDepth = 2,
  maxMatches = 12,
  maxEntriesScanned = 2000,
): string[] {
  const matched: string[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || matched.length >= maxMatches || scanned >= maxEntriesScanned) return;
    if (!deps.dirExists(dir)) return;
    const entries = deps.listDirEntries(dir);
    for (const entry of entries) {
      scanned++;
      if (scanned > maxEntriesScanned || matched.length >= maxMatches) break;
      if (entry.isDir) {
        if (depth < maxDepth) {
          walk(join(dir, entry.name), depth + 1);
        }
      } else if (FONT_EXT_RE.test(entry.name) || !entry.name.includes('.')) {
        if (matchesChineseFontName(entry.name)) {
          const key = entry.name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            matched.push(entry.name);
          }
        }
      }
    }
  };

  for (const d of dirs) {
    if (matched.length >= maxMatches || scanned >= maxEntriesScanned) break;
    walk(d, 0);
  }
  return matched;
}

function probeFonts(deps: LocaleProbeDeps): FontProbeResult {
  let userDirs: string[] = [];
  let systemDirs: string[] = [];

  if (deps.platform === 'darwin') {
    userDirs = [join(deps.homeDir, 'Library', 'Fonts'), '/Library/Fonts'];
    systemDirs = ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental'];
  } else if (deps.platform === 'win32') {
    const localAppData = deps.env.LOCALAPPDATA || join(deps.homeDir, 'AppData', 'Local');
    const winDir = deps.env.WINDIR || 'C:\\Windows';
    userDirs = [join(localAppData, 'Microsoft', 'Windows', 'Fonts')];
    systemDirs = [join(winDir, 'Fonts')];
  } else {
    userDirs = [
      join(deps.homeDir, '.local', 'share', 'fonts'),
      join(deps.homeDir, '.fonts'),
      '/usr/local/share/fonts',
    ];
    systemDirs = ['/usr/share/fonts'];
  }

  const userChineseFonts = scanFontDirs(userDirs, deps, 2, 12);
  const systemChineseFonts = scanFontDirs(systemDirs, deps, 2, 12);
  const fcListChineseFonts: string[] = [];

  if (deps.platform === 'linux' && userChineseFonts.length === 0 && systemChineseFonts.length === 0) {
    const fcRaw = deps.execFile('fc-list', [':lang=zh', 'family'], 800);
    if (fcRaw) {
      const seen = new Set<string>();
      for (const line of fcRaw.split(/\r?\n/)) {
        for (const fam of line.split(',')) {
          const trimmed = fam.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            fcListChineseFonts.push(trimmed);
            if (fcListChineseFonts.length >= 12) break;
          }
        }
        if (fcListChineseFonts.length >= 12) break;
      }
    }
  }

  const systemOnly =
    userChineseFonts.length === 0 &&
    (systemChineseFonts.length > 0 || fcListChineseFonts.length > 0);

  return {
    userChineseFonts,
    systemChineseFonts,
    fcListChineseFonts,
    systemOnly,
  };
}

export function collectLocaleSignals(partialDeps?: Partial<LocaleProbeDeps>): Omit<LocaleSignals, 'scoreBreakdown'> {
  const deps = buildDeps(partialDeps);
  const envLocales = {
    LC_ALL: cleanLocaleTag(deps.env.LC_ALL || ''),
    LC_MESSAGES: cleanLocaleTag(deps.env.LC_MESSAGES || ''),
    LANG: cleanLocaleTag(deps.env.LANG || ''),
    LANGUAGE: String(deps.env.LANGUAGE || '').trim(),
  };

  let osPrimaryLocale = '';
  const osSecondaryLocales: string[] = [];
  let osRegionLocale = '';
  let inputMethodMatches: string[] = [];

  if (deps.platform === 'darwin') {
    const appleLangs = parseAppleLanguages(
      deps.execFile('defaults', ['read', '-g', 'AppleLanguages'], 600),
    );
    if (appleLangs.length > 0) {
      osPrimaryLocale = appleLangs[0];
      for (const sec of appleLangs.slice(1)) {
        osSecondaryLocales.push(sec);
      }
    }
    const appleLocale = cleanLocaleTag(
      deps.execFile('defaults', ['read', '-g', 'AppleLocale'], 600),
    );
    if (appleLocale) {
      osRegionLocale = appleLocale;
      if (!osPrimaryLocale) osPrimaryLocale = appleLocale;
    }
    const hitoolbox = deps.execFile(
      'defaults',
      ['read', 'com.apple.HIToolbox', 'AppleEnabledInputSources'],
      600,
    );
    inputMethodMatches = parseMacOsInputSources(hitoolbox);
  } else if (deps.platform === 'win32') {
    const psOut = deps.execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $u=[System.Globalization.CultureInfo]::CurrentUICulture.Name; $c=[System.Globalization.CultureInfo]::CurrentCulture.Name; $l=(Get-WinUserLanguageList | Select-Object -ExpandProperty LanguageTag) -join ","; Write-Output ("UI="+$u); Write-Output ("CULTURE="+$c); Write-Output ("LIST="+$l)',
      ],
      1200,
    );
    const parsed = parseWindowsPowerShellLocale(psOut);
    if (parsed.uiCulture) osPrimaryLocale = parsed.uiCulture;
    if (parsed.culture) osRegionLocale = parsed.culture;
    if (parsed.languageList.length > 0) {
      if (!osPrimaryLocale) osPrimaryLocale = parsed.languageList[0];
      for (const tag of parsed.languageList.slice(1)) {
        osSecondaryLocales.push(tag);
      }
    }
    if (!osPrimaryLocale && !osRegionLocale) {
      const regOut = deps.execFile(
        'reg',
        ['query', 'HKCU\\Control Panel\\International', '/v', 'LocaleName'],
        800,
      );
      const regLocale = parseWindowsRegLocale(regOut);
      if (regLocale) {
        osPrimaryLocale = regLocale;
        osRegionLocale = regLocale;
      }
    }
  } else {
    const confRaw =
      deps.readTextFile('/etc/locale.conf') || deps.readTextFile('/etc/default/locale');
    const conf = parseLocaleConf(confRaw);
    const confPrimary = cleanLocaleTag(conf.LC_ALL || conf.LC_MESSAGES || conf.LANG || '');
    if (confPrimary) {
      osPrimaryLocale = confPrimary;
      osRegionLocale = confPrimary;
    }
    if (conf.LANGUAGE) {
      const parts = conf.LANGUAGE.split(':').map(cleanLocaleTag).filter(Boolean);
      if (parts.length > 0 && !osPrimaryLocale) osPrimaryLocale = parts[0];
      for (const p of parts.slice(1)) {
        osSecondaryLocales.push(p);
      }
    }
    const linuxImEnv = [deps.env.XMODIFIERS, deps.env.IBUS_ENGINE, deps.env.FCITX_ADDON]
      .filter(Boolean)
      .join(' ');
    if (LINUX_CHINESE_IM_RE.test(linuxImEnv)) {
      inputMethodMatches.push('linux-im-env');
    }
  }

  const rawTz = String(deps.env.TZ || '').trim() || String(deps.intlTimeZone || '').trim();
  const timezone = rawTz.replace(/^:/, '');
  const fonts = probeFonts(deps);

  return {
    platform: deps.platform,
    envLocales,
    intlLocale: cleanLocaleTag(deps.intlLocale),
    osPrimaryLocale,
    osSecondaryLocales,
    osRegionLocale,
    timezone,
    isChineseTimezone: isChineseTimezone(timezone),
    chineseInputMethod: inputMethodMatches.length > 0,
    inputMethodMatches,
    fonts,
  };
}

export function evaluateLocaleSignals(
  input: Omit<LocaleSignals, 'scoreBreakdown'>,
): { lang: DetectedLang; confidence: number; score: number; signals: LocaleSignals } {
  const languageEnvList = input.envLocales.LANGUAGE
    ? input.envLocales.LANGUAGE.split(':').map(cleanLocaleTag).filter(Boolean)
    : [];

  const envPrimary =
    input.envLocales.LC_ALL ||
    input.envLocales.LC_MESSAGES ||
    input.envLocales.LANG ||
    languageEnvList[0] ||
    '';

  const primaryCandidates = [envPrimary, input.osPrimaryLocale, input.intlLocale].filter(Boolean);
  const secondaryCandidates = [...input.osSecondaryLocales, ...languageEnvList.slice(1)].filter(
    Boolean,
  );
  const regionCandidates = [
    input.osRegionLocale,
    input.osPrimaryLocale,
    envPrimary,
    input.intlLocale,
  ].filter(Boolean);

  const primaryLocale = primaryCandidates.some(isChineseLocaleTag)
    ? SCORE_WEIGHTS.PRIMARY_LOCALE
    : 0;

  const secondaryLocale =
    primaryLocale === 0 && secondaryCandidates.some(isChineseLocaleTag)
      ? SCORE_WEIGHTS.SECONDARY_LOCALE
      : 0;

  const regionLocale =
    primaryLocale === 0 && regionCandidates.some(hasChineseRegionTag)
      ? SCORE_WEIGHTS.REGION_LOCALE
      : 0;

  const timezone = input.isChineseTimezone ? SCORE_WEIGHTS.TIMEZONE : 0;
  const inputMethod = input.chineseInputMethod ? SCORE_WEIGHTS.INPUT_METHOD : 0;

  let fonts = 0;
  if (input.fonts.userChineseFonts.length > 0) {
    fonts = SCORE_WEIGHTS.USER_CHINESE_FONTS;
  } else if (
    input.fonts.systemChineseFonts.length > 0 ||
    input.fonts.fcListChineseFonts.length > 0
  ) {
    if (input.platform === 'darwin') {
      fonts = SCORE_WEIGHTS.DARWIN_SYSTEM_CHINESE_FONTS;
    } else if (input.platform === 'linux') {
      fonts = SCORE_WEIGHTS.LINUX_SYSTEM_CHINESE_FONTS;
    } else if (input.platform === 'win32') {
      fonts = SCORE_WEIGHTS.WINDOWS_SYSTEM_CHINESE_FONTS;
    }
  }

  const scoreBreakdown: ScoreBreakdown = {
    primaryLocale,
    secondaryLocale,
    regionLocale,
    timezone,
    inputMethod,
    fonts,
  };

  const rawScore =
    primaryLocale + secondaryLocale + regionLocale + timezone + inputMethod + fonts;
  const score = Number(Math.min(1, rawScore).toFixed(3));
  const lang: DetectedLang = score >= LOCALE_SCORE_THRESHOLD ? 'zh' : 'en';
  const confidence =
    lang === 'zh'
      ? Number(Math.min(1, Math.max(0.55, score)).toFixed(3))
      : Number(Math.min(1, Math.max(0.5, 1 - score)).toFixed(3));

  return {
    lang,
    confidence,
    score,
    signals: {
      ...input,
      scoreBreakdown,
    },
  };
}

export function computeLocaleFingerprint(deps: LocaleProbeDeps): string {
  return [
    deps.platform,
    deps.env.LC_ALL || '',
    deps.env.LC_MESSAGES || '',
    deps.env.LANG || '',
    deps.env.LANGUAGE || '',
    deps.env.TZ || '',
    deps.intlLocale || '',
    deps.intlTimeZone || '',
  ].join('|');
}

export function resolveLocaleCachePath(appDataDir = resolveAppDataDir()): string {
  const envPath = process.env.AGY_HUD_LOCALE_CACHE_PATH;
  if (envPath) return envPath;
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) return join(execData, 'locale-cache.json');
  return join(appDataDir, '.agy-hud-cache', 'locale.json');
}

function readDiskCache(
  filePath: string,
  fingerprint: string,
  nowMs: number,
): { result: Omit<LocaleDetectionResult, 'cached'>; expiresAt: number } | null {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PersistedLocaleCache>;
    if (
      !parsed ||
      parsed.version !== LOCALE_CACHE_VERSION ||
      parsed.fingerprint !== fingerprint ||
      typeof parsed.expiresAt !== 'number' ||
      nowMs >= parsed.expiresAt ||
      !parsed.result ||
      (parsed.result.lang !== 'zh' && parsed.result.lang !== 'en')
    ) {
      return null;
    }
    return { result: parsed.result, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeDiskCache(filePath: string, payload: PersistedLocaleCache): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
}

export function detectLocale(options: DetectLocaleOptions = {}): LocaleDetectionResult {
  const deps = buildDeps(options.deps);
  const nowMs = deps.now();
  const ttlMs = options.ttlMs ?? LOCALE_CACHE_TTL_MS;
  const fingerprint = computeLocaleFingerprint(deps);
  const explicitCachePath = options.cachePath !== undefined;
  const primaryCachePath =
    options.cachePath === null
      ? ''
      : options.cachePath || resolveLocaleCachePath(options.appDataDir);
  const fallbackCachePath =
    !explicitCachePath && primaryCachePath ? join(tmpdir(), 'agy-hud-locale-cache.json') : '';
  const cacheKey = primaryCachePath || '__memory_only__';

  if (!options.forceRefresh) {
    if (
      memoryCache &&
      memoryCache.cacheKey === cacheKey &&
      memoryCache.fingerprint === fingerprint &&
      nowMs < memoryCache.expiresAt
    ) {
      return { ...memoryCache.result, cached: true };
    }

    if (primaryCachePath) {
      const fromPrimary = readDiskCache(primaryCachePath, fingerprint, nowMs);
      if (fromPrimary) {
        memoryCache = {
          cacheKey,
          fingerprint,
          expiresAt: fromPrimary.expiresAt,
          result: fromPrimary.result,
        };
        return { ...fromPrimary.result, cached: true };
      }
      if (fallbackCachePath && fallbackCachePath !== primaryCachePath) {
        const fromFallback = readDiskCache(fallbackCachePath, fingerprint, nowMs);
        if (fromFallback) {
          memoryCache = {
            cacheKey,
            fingerprint,
            expiresAt: fromFallback.expiresAt,
            result: fromFallback.result,
          };
          return { ...fromFallback.result, cached: true };
        }
      }
    }
  }

  const rawSignals = collectLocaleSignals(deps);
  const evaluated = evaluateLocaleSignals(rawSignals);
  const baseResult: Omit<LocaleDetectionResult, 'cached'> = {
    ...evaluated,
    detectedAt: nowMs,
  };
  const expiresAt = nowMs + ttlMs;

  memoryCache = {
    cacheKey,
    fingerprint,
    expiresAt,
    result: baseResult,
  };

  if (primaryCachePath) {
    const persisted: PersistedLocaleCache = {
      version: LOCALE_CACHE_VERSION,
      fingerprint,
      expiresAt,
      result: baseResult,
    };
    const wrotePrimary = writeDiskCache(primaryCachePath, persisted);
    if (!wrotePrimary && fallbackCachePath && fallbackCachePath !== primaryCachePath) {
      writeDiskCache(fallbackCachePath, persisted);
    }
  }

  return { ...baseResult, cached: false };
}
