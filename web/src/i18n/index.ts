import type { Lang } from '../types/telemetry';
import {
  AUTO_LOCALE_CACHE_KEY,
  AUTO_LOCALE_CACHE_TTL_MS,
  AUTO_LOCALE_CACHE_VERSION,
  LANG_SOURCE_KEY,
  LANG_STORAGE_KEY,
  detectClientLocale,
  getUserLangPreference,
  hasUserLangPreference,
  readAutoLocaleCache,
  refineLocaleFromServer,
  resolveInitialLang,
  saveUserLangPreference,
  shouldRefineLocaleFromServer,
  writeAutoLocaleCache,
  type AutoLocaleCacheEntry,
  type ClientLocaleEnv,
  type ClientLocaleHeuristicResult,
  type ServerLocaleResponse,
  type StorageLike,
} from './detectLocale';
import { en } from './en';
import type { Translations } from './types';
import { zh } from './zh';

export const I18N: Record<Lang, Translations> = { en, zh };

export function getTranslations(lang: Lang): Translations {
  return I18N[lang] || en;
}

export {
  AUTO_LOCALE_CACHE_KEY,
  AUTO_LOCALE_CACHE_TTL_MS,
  AUTO_LOCALE_CACHE_VERSION,
  LANG_SOURCE_KEY,
  LANG_STORAGE_KEY,
  detectClientLocale,
  getUserLangPreference,
  hasUserLangPreference,
  readAutoLocaleCache,
  refineLocaleFromServer,
  resolveInitialLang,
  saveUserLangPreference,
  shouldRefineLocaleFromServer,
  writeAutoLocaleCache,
};

export type {
  AutoLocaleCacheEntry,
  ClientLocaleEnv,
  ClientLocaleHeuristicResult,
  ServerLocaleResponse,
  StorageLike,
  Translations,
};
