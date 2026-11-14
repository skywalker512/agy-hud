import type { Lang } from '../types/telemetry';
import { en } from './en';
import type { Translations } from './types';
import { zh } from './zh';

export const I18N: Record<Lang, Translations> = { en, zh };

export function getTranslations(lang: Lang): Translations {
  return I18N[lang] || en;
}

export type { Translations };
