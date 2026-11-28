import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_LOCALE_CACHE_TTL_MS,
  detectClientLocale,
  readAutoLocaleCache,
  refineLocaleFromServer,
  resolveInitialLang,
  saveUserLangPreference,
  shouldRefineLocaleFromServer,
} from '../src/i18n/detectLocale.ts';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

test('frontend detectLocale priority: manual toggle & legacy key > cache > client heuristic > async /api/locale', async () => {
  // 1. Legacy user preference (agy_hud_lang='en' without agy_hud_lang_source) MUST win over zh browser
  const legacyStore = createMemoryStorage({ agy_hud_lang: 'en' });
  const zhEnv = {
    languages: ['zh-CN', 'en-US'],
    intlLocale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    platform: 'MacIntel',
    probeFonts: () => ({ thirdParty: ['LXGW WenKai'], system: ['PingFang SC'] }),
  };
  assert.equal(resolveInitialLang(legacyStore, zhEnv), 'en');
  assert.equal(shouldRefineLocaleFromServer(legacyStore, zhEnv), false);

  // 2. US English macOS browser with PingFang SC must NOT false-positive as zh
  const usMacStore = createMemoryStorage();
  let clock = 1_750_000_000_000;
  const usMacEnv = {
    languages: ['en-US'],
    intlLocale: 'en-US',
    timeZone: 'America/Los_Angeles',
    platform: 'MacIntel',
    now: () => clock,
    probeFonts: () => ({ thirdParty: [], system: ['PingFang SC', 'Hiragino Sans GB'] }),
  };
  const usDetected = detectClientLocale(usMacEnv);
  assert.equal(usDetected.lang, 'en');
  assert.equal(usDetected.score, 0);
  assert.equal(resolveInitialLang(usMacStore, usMacEnv), 'en');
  // Client cache written, still eligible for one server refinement
  assert.equal(shouldRefineLocaleFromServer(usMacStore, usMacEnv), true);

  // 2b. English macOS user in Asia/Shanghai with third-party CJK font immediately detects zh synchronously
  const cnUserFontEnv = {
    languages: ['en-US'],
    intlLocale: 'en-US',
    timeZone: 'Asia/Shanghai',
    platform: 'MacIntel',
    probeFonts: () => ({ thirdParty: ['LXGW WenKai'], system: ['PingFang SC'] }),
  };
  const cnUserFontDetected = detectClientLocale(cnUserFontEnv);
  assert.equal(cnUserFontDetected.lang, 'zh');
  assert.equal(cnUserFontDetected.score, 0.65);

  // 3. Async /api/locale refinement updates cache to source='server' and prevents repeat fetches
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      json: async () => ({ lang: 'zh', confidence: 0.8, score: 0.8 }),
    } as unknown as Response;
  };
  const refined = await refineLocaleFromServer(mockFetch as typeof fetch, undefined, usMacStore, usMacEnv);
  assert.equal(refined, 'zh');
  assert.equal(fetchCalls, 1);
  assert.equal(resolveInitialLang(usMacStore, usMacEnv), 'zh');
  assert.equal(shouldRefineLocaleFromServer(usMacStore, usMacEnv), false);

  // 3b. Advancing clock past 7-day TTL invalidates auto-cache and allows re-refinement
  clock += AUTO_LOCALE_CACHE_TTL_MS + 1000;
  assert.equal(readAutoLocaleCache(usMacStore, usMacEnv), null);
  assert.equal(shouldRefineLocaleFromServer(usMacStore, usMacEnv), true);

  // 4. Race condition protection: if user toggles manually while /api/locale is in flight, manual choice wins
  const raceStore = createMemoryStorage();
  resolveInitialLang(raceStore, usMacEnv);
  const raceFetch = async () => {
    // User clicks manual toggle to 'en' before server responds with 'zh'
    saveUserLangPreference('en', raceStore);
    return {
      ok: true,
      json: async () => ({ lang: 'zh', confidence: 0.9, score: 0.9 }),
    } as unknown as Response;
  };
  const raceResult = await refineLocaleFromServer(raceFetch as typeof fetch, undefined, raceStore, usMacEnv);
  assert.equal(raceResult, null);
  assert.equal(resolveInitialLang(raceStore, usMacEnv), 'en');
  assert.equal(raceStore.getItem('agy_hud_lang_source'), 'user');
});
