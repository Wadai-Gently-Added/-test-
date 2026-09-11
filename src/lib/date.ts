// ---- TODO改善#4: 日付フォーマットの多言語化 ----
// 旧実装は fmtDate / buildChecklistHTML / list.js の日付表示が 'ja-JP' 固定だったため、
// 言語をEN等に切り替えても日付だけ日本語表記になっていた。
// 現在の言語に対応するBCP47ロケールを引いて toLocaleString に渡す。
import type { LangKey } from '../types/zou';

const BCP47: Record<LangKey, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ko: 'ko-KR',
  zh: 'zh-CN',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ru: 'ru-RU',
  el: 'el-GR',
};

export function localeFor(lang: LangKey): string {
  return BCP47[lang] ?? 'ja-JP';
}

/** ISO文字列を現在言語の「日時」表記へ(旧print.jsのfmtDate後継)。無効値は'-' */
export function fmtDate(iso: string | undefined | null, lang: LangKey): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString(localeFor(lang));
  } catch {
    return '-';
  }
}

/** 旧list.jsの行の日付部(日付+時分)後継 */
export function fmtDateShort(d: Date, lang: LangKey): string {
  const loc = localeFor(lang);
  return `${d.toLocaleDateString(loc)} ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}
