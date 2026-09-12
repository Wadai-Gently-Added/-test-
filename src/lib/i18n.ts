// 11言語の文言データを束ねる(ja.ts … el.ts)。翻訳データは元リポジトリのlanguage/*.jsを
// そのまま移植。STR.common / STR.svg / STR.html / STR.mode() の呼び出し方も互換維持。
import { LANG_JA } from '../locales/ja';
import { LANG_EN } from '../locales/en';
import { LANG_ES } from '../locales/es';
import { LANG_FR } from '../locales/fr';
import { LANG_KO } from '../locales/ko';
import { LANG_ZH } from '../locales/zh';
import { LANG_DE } from '../locales/de';
import { LANG_IT } from '../locales/it';
import { LANG_PT } from '../locales/pt';
import { LANG_RU } from '../locales/ru';
import { LANG_EL } from '../locales/el';
import type { Mode, LangKey } from '../types/zou';
import type { LanguageData } from '../locales/types';

export const LANGUAGES: Record<LangKey, LanguageData> = {
  ja: LANG_JA, en: LANG_EN, es: LANG_ES, fr: LANG_FR, ko: LANG_KO,
  zh: LANG_ZH, de: LANG_DE, it: LANG_IT, pt: LANG_PT, ru: LANG_RU, el: LANG_EL,
};

// ---- TODO改善#1: currentLanguageのlocalStorage永続化 ----
// 旧実装はcurrentLanguageが必ず'ja'で開き、切り替えても次回起動時に戻されていた。
// 'zouLanguage'キーに保存し、起動時に復元する(不明な値はjaへフォールバック)。
const LANGUAGE_STORAGE_KEY = 'zouLanguage';

function loadInitialLanguage(): LangKey {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) as LangKey | null;
    if (saved && saved in LANGUAGES) return saved;
  } catch { /* ignore */ }
  return 'ja';
}

export let currentLanguage: LangKey = loadInitialLanguage();

export function setLanguage(lang: LangKey): boolean {
  if (!LANGUAGES[lang]) return false;
  currentLanguage = lang;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, lang); } catch { /* ignore */ }
  return true;
}

export interface STRFor {
  common: typeof LANG_JA.common;
  svg: typeof LANG_JA.svg;
  html: typeof LANG_JA.html;
  mode(m: Mode): typeof LANG_JA.svg | typeof LANG_JA.html;
}

// STR.common.xxx / STR.svg.xxx / STR.mode(mode) という旧来の呼び出し方をそのまま維持するため、
// 常に「今選ばれている言語」を指すgetterとして定義する
export const STR: STRFor = {
  get common() { return LANGUAGES[currentLanguage].common; },
  get svg() { return LANGUAGES[currentLanguage].svg; },
  get html() { return LANGUAGES[currentLanguage].html; },
  mode(m: Mode) { return LANGUAGES[currentLanguage][m]; },
};
