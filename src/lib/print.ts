// 印刷プレビュー構築(旧js/print.jsのHTML生成部をtsx非依存化)。
// 【設計】
// - グループ一括印刷 → 5択メニューから選択(チェックリスト含む)
// - 選んで印刷(複数選択) → グループを跨いで好きな項目にチェックを付けられる「全体選択モード」。
//   画像は折り紙の手順書のような番号+矢印でつなぐフロー形式(buildFlowSection、以前廃止したが復活)
// - 単品印刷(1件) → 大きいSVGプレビュー + サイズ/ViewBox表 + メモ欄(buildSingleImageSection)
// 画像レイアウトは「1件だけなら個別表示、複数件ならフロー形式」で自動的に出し分ける。
import type { PrintItem, PrintMode, Mode, Group, LangKey } from '../types/zou';
import { STR, currentLanguage } from './i18n';
import { fmtDate } from './date';
import { contentForThumbnail, escHtml, getSvgMeta } from './svgUtils';

/** 複数グループから抜粋した時に「どのグループの項目か」が分かるよう名前を引く */
export function getGroupNameOf(item: PrintItem & { group?: string | null }, groups: Group[]): string | null {
  if (!item.group) return null;
  const g = groups.find(x => x.id === item.group);
  return g ? g.name : null;
}

/** 複数件用: 折り紙の手順書のように「①SVG+ファイル名」を→でつないで並べる。
 * withArrows=false にすると矢印を挟まない、ただの一覧(グリッド)として出力できる */
export function buildFlowSection(items: PrintItem[], withArrows: boolean, groups: Group[], mode: Mode): string {
  const cells = items.map((it, i) => {
    const nameEsc = escHtml(it.name || STR.common.untitled);
    const groupName = getGroupNameOf(it, groups);
    const groupLine = groupName ? `<div class="flow-group">${escHtml(groupName)}</div>` : '';
    return `
      <div class="flow-step">
        <div class="flow-num">${i + 1}</div>
        <div class="flow-svg">${contentForThumbnail(it.content, mode)}</div>
        <div class="flow-name">${nameEsc}</div>
        ${groupLine}
      </div>`;
  });
  const parts: string[] = [];
  cells.forEach((c, i) => {
    parts.push(c);
    if (withArrows && i < cells.length - 1) parts.push('<div class="flow-arrow">→</div>');
  });
  const noun = STR.mode(mode).groupItemsNoun;
  const titleText = STR.common.flowTitle(noun, withArrows);
  return `
    <div class="print-page flow-page">
      <div class="print-title">${titleText}</div>
      <div class="flow-grid${withArrows ? '' : ' flow-grid-noarrow'}">${parts.join('')}</div>
      <div class="print-note-label">${STR.common.noteLabel}</div>
      <div class="print-note-box" contenteditable="true"></div>
    </div>
  `;
}

/** 単品印刷用: 大きいプレビュー + メモ欄(SVGモードはサイズ/ViewBox表も付く) */
export function buildSingleImageSection(item: PrintItem, groups: Group[], mode: Mode): string {
  const nameEsc = escHtml(item.name || STR.common.untitled);
  const isHtml = mode === 'html';
  const groupName = getGroupNameOf(item, groups);
  const metaTable = isHtml ? '' : (() => {
    const meta = getSvgMeta(item.content);
    return `
      <table class="code-list-table single-meta-table">
        <tr><th>${STR.common.sizeLabel}</th><td>${escHtml(meta.size)}</td></tr>
        <tr><th>${STR.common.viewBoxLabel}</th><td>${escHtml(meta.viewBox)}</td></tr>
      </table>`;
  })();
  return `
    <div class="print-page single-page">
      <div class="print-title">${nameEsc}</div>
      ${groupName ? `<div class="print-meta">${STR.common.groupPrintLabel(escHtml(groupName))}</div>` : ''}
      <div class="print-meta">${STR.common.createdAtLabel(fmtDate(item.savedAt, currentLanguage as LangKey))}</div>
      <div class="single-svg-frame">${contentForThumbnail(item.content, mode)}</div>
      ${metaTable}
      <div class="print-note-label">${STR.common.noteLabel}</div>
      <div class="print-note-box" contenteditable="true"></div>
    </div>
  `;
}

/** コードモード: ファイル名+グループ+作成日時+修正日時の一覧表 → その下に各コード */
export function buildCodeListSection(items: PrintItem[], groups: Group[], mode: Mode): string {
  const lang = currentLanguage as LangKey;
  const rows = items.map((it, i) => {
    const nameEsc = escHtml(it.name || STR.common.untitled);
    const groupName = getGroupNameOf(it, groups);
    return `<tr><td>${i + 1}</td><td>${nameEsc}</td><td>${groupName ? escHtml(groupName) : '-'}</td><td>${fmtDate(it.savedAt, lang)}</td><td>${fmtDate(it.modifiedAt || it.savedAt, lang)}</td></tr>`;
  }).join('');
  const entries = items.map((it, i) => {
    const nameEsc = escHtml(it.name || STR.common.untitled);
    const codeEsc = escHtml(it.content);
    return `
      <div class="code-entry">
        <div class="code-entry-title">${i + 1}. ${nameEsc}</div>
        <pre class="print-code">${codeEsc}</pre>
      </div>`;
  }).join('');
  return `
    <div class="print-page">
      <div class="print-title">${STR.common.codeListTitle(STR.mode(mode).groupItemsNoun)}</div>
      <table class="code-list-table">
        <thead><tr><th>#</th><th>${STR.common.fileNameHeader}</th><th>${STR.common.groupHeader}</th><th>${STR.common.createdHeader}</th><th>${STR.common.modifiedHeader}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${entries}
    </div>
  `;
}

/** mode: 'image'(矢印あり手順) | 'image-grid'(矢印なし一覧) | 'code' | 'both'
 * 画像は「1件だけなら個別表示、複数件ならフロー形式(矢印の有無はmodeで指定)」で自動的に出し分ける */
export function buildPrintOutput(items: PrintItem[], printMode: PrintMode, groups: Group[], mode: Mode): string {
  let html = '';
  if (printMode === 'image' || printMode === 'image-grid' || printMode === 'both') {
    html += (items.length === 1) ? buildSingleImageSection(items[0], groups, mode) : buildFlowSection(items, printMode !== 'image-grid', groups, mode);
  }
  if (printMode === 'code' || printMode === 'both') html += buildCodeListSection(items, groups, mode);
  return html;
}

export function printModeLabel(printMode: PrintMode, mode: Mode): string {
  const noun = STR.mode(mode).groupItemsNoun;
  if (printMode === 'image') return STR.common.modeLabelImage(noun);
  if (printMode === 'image-grid') return STR.common.modeLabelImageGrid(noun);
  if (printMode === 'code') return STR.common.modeLabelCode;
  return STR.common.modeLabelBoth(noun);
}

/** 単品印刷・選んで印刷・グループ一括印刷で共通の5択(チェックリストも含めて1つのメニューに統合) */
export function printSubmenuOptions(mode: Mode): { label: string; value: PrintMode }[] {
  const noun = STR.mode(mode).groupItemsNoun;
  return [
    { label: STR.common.printOptChecklist, value: 'checklist' },
    { label: STR.common.printOptImage(noun), value: 'image' },
    { label: STR.common.printOptImageGrid(noun), value: 'image-grid' },
    { label: STR.common.printOptCode, value: 'code' },
    { label: STR.common.printOptBoth(noun), value: 'both' },
  ];
}

export function buildChecklistHTML(groupName: string, items: PrintItem[], lang: LangKey): string {
  const dateText = fmtDate(new Date().toISOString(), lang);
  const rows = items.map((it, i) => {
    const nameEsc = escHtml(it.name || STR.common.untitled);
    return `
      <div class="checklist-row">
        <span class="checklist-box">☐</span>
        <span class="checklist-num">${i + 1}.</span>
        <span class="checklist-name">${nameEsc}</span>
      </div>`;
  }).join('');
  const nameEsc = escHtml(groupName || STR.common.checklistTitle(''));
  return `
    <div class="print-page checklist-page">
      <div class="print-title">${nameEsc}</div>
      <div class="print-meta">${STR.common.createdAtLabel(dateText)}</div>
      <div class="print-meta">${STR.common.itemCountLabel(items.length)}</div>
      <div class="checklist-list">${rows}</div>
    </div>`;
}
