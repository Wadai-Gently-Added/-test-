// src/lib/storage.ts — データ保存層 (localStorageの読み書き, グループ/並び順の管理)
// 旧 js/storage.js をtsx非依存の純粋モジュール化。currentMode はswitchMode()経由で書き替える。
import type { SavedItem, Group, TopOrderEntry, Draft, Mode } from '../types/zou';
import { STORAGE_KEYS } from './constants';

export const GROUP_COLORS = ['#e0625c', '#e0b85c', '#7ea6e0', '#b57ee0', '#e07eb8', '#8bd17e'];

let currentModeInternal: Mode = 'svg';
export function getCurrentMode(): Mode { return currentModeInternal; }
export function setCurrentMode(m: Mode): void { currentModeInternal = m; }

function savedKey(mode: Mode): string { return mode === 'html' ? STORAGE_KEYS.htmlSavedItems : STORAGE_KEYS.svgSavedItems; }
function groupsKey(mode: Mode): string { return mode === 'html' ? STORAGE_KEYS.htmlGroups : STORAGE_KEYS.svgGroups; }
function topOrderKey(mode: Mode): string { return mode === 'html' ? STORAGE_KEYS.htmlTopOrder : STORAGE_KEYS.svgTopOrder; }

// ---- TODO改善#3: localStorage容量超過対策 ----
// 旧実装はQuotaExceededErrorを握りつぶすだけだったため、容量オーバー時に
// 「保存したつもりで消えている」事故が起き得た。ここではQuotaExceededを検知したら
// ①下書き・古いスナップショットなど再生成可能なキーを順に掃除して1回だけ再試行し、
// ②それでも失敗したらコールバックでUIに通知する(呼び出し側でアラート表示)。
export type QuotaErrorCallback = () => void;
let quotaErrorCallback: QuotaErrorCallback | null = null;
export function setQuotaErrorCallback(cb: QuotaErrorCallback | null): void { quotaErrorCallback = cb; }

// 容量逼迫時に捨ててよい(再生成可能な)キー。マイSVG/マイHTML本体には触らない
const PRUNABLE_KEYS = [
  STORAGE_KEYS.preImportSnapshot,
  STORAGE_KEYS.preSortSnapshot('svg'),
  STORAGE_KEYS.preSortSnapshot('html'),
  STORAGE_KEYS.svgDraft,
  STORAGE_KEYS.htmlDraft,
];

function isQuotaError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (
    (e as DOMException).name === 'QuotaExceededError' ||
    (e as DOMException).name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (e as { code?: number }).code === 22
  );
}

function setItemSafe(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) return false;
    // 容量超過 → 再生成可能キーを掃除して1回だけ再試行
    for (const k of PRUNABLE_KEYS) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      quotaErrorCallback?.();
      return false;
    }
  }
}

export function getGroups(): Group[] {
  try { return JSON.parse(localStorage.getItem(groupsKey(currentModeInternal)) || '[]') as Group[]; }
  catch { return []; }
}
export function setGroups(arr: Group[]): void {
  setItemSafe(groupsKey(currentModeInternal), JSON.stringify(arr));
}
export function getTopOrder(): TopOrderEntry[] {
  try { return JSON.parse(localStorage.getItem(topOrderKey(currentModeInternal)) || '[]') as TopOrderEntry[]; }
  catch { return []; }
}
export function setTopOrder(arr: TopOrderEntry[]): void {
  setItemSafe(topOrderKey(currentModeInternal), JSON.stringify(arr));
}

// topOrderを存在しなくなったもの/未登録のものと自動で整合させる(手動同期不要にするため)
export function reconcileTopOrder(items: SavedItem[], groups: Group[]): TopOrderEntry[] {
  let order = getTopOrder();
  const groupIds = new Set(groups.map(g => g.id));
  const looseItemIds = new Set(items.filter(it => !it.group).map(it => it.id));
  order = order.filter(e => {
    if (e.type === 'group') return groupIds.has(e.id);
    if (e.type === 'item') return looseItemIds.has(e.id);
    return false;
  });
  groups.forEach(g => {
    if (!order.some(e => e.type === 'group' && e.id === g.id)) order.push({ type: 'group', id: g.id });
  });
  items.forEach(it => {
    if (!it.group && !order.some(e => e.type === 'item' && e.id === it.id)) order.push({ type: 'item', id: it.id });
  });
  setTopOrder(order);
  return order;
}

export function getSaved(): SavedItem[] {
  let arr: SavedItem[];
  try { arr = JSON.parse(localStorage.getItem(savedKey(currentModeInternal)) || '[]') as SavedItem[]; }
  catch { arr = []; }
  let changed = false;
  arr.forEach(it => {
    if (!it.id) { it.id = 's' + Date.now() + Math.random().toString(36).slice(2, 7); changed = true; }
    if (!it.modifiedAt) { it.modifiedAt = it.savedAt; changed = true; }
  });
  if (changed) setItemSafe(savedKey(currentModeInternal), JSON.stringify(arr));
  return arr;
}
export function setSaved(arr: SavedItem[]): void {
  if (!setItemSafe(savedKey(currentModeInternal), JSON.stringify(arr))) {
    // 容量超過の通知はquotaErrorCallback経由で行う(AppがSTR.common.saveFailedを表示)
  }
}

export function pruneEmptyGroups(): void {
  const items = getSaved();
  const groups = getGroups();
  const usedIds = new Set(items.map(it => it.group).filter(Boolean));
  const kept = groups.filter(g => usedIds.has(g.id));
  if (kept.length !== groups.length) setGroups(kept);
}

// ---- 下書き自動保存 ----
// 「マイSVG/マイHTMLへ登録」を明示的にしていなくても、画面に表示中の内容を常に別途保持しておく。
// 営業先などで急いで閉じてしまっても、次回開いた時に続きから編集できるようにするための仕組み。
// マイSVG/マイHTML一覧(storeKey)とは別のキーに保存し、一覧を汚さない。

// ---- TODO改善#3: saveDraftのdebounce(300ms) ----
// 旧実装はloadContent/コード反映のたびに即同期書き込みしていた。SVG長編集連打時の
// JSON.stringify+書き込みが毎回走ると体感が落ちるため、モード別に300msへdebounceする。
// (追い出し対策として、beforeunload/非表示化時にはフラッシュして確実に書き切る)
const draftTimers: Record<Mode, ReturnType<typeof setTimeout> | null> = { svg: null, html: null };
const pendingDrafts: Record<Mode, { name: string | null; content: string } | null> = { svg: null, html: null };

function writeDraftNow(mode: Mode): void {
  const pending = pendingDrafts[mode];
  pendingDrafts[mode] = null;
  if (!pending) return;
  try {
    localStorage.setItem(
      mode === 'html' ? STORAGE_KEYS.htmlDraft : STORAGE_KEYS.svgDraft,
      JSON.stringify({ name: pending.name || null, content: pending.content, dirty: true, savedAt: new Date().toISOString() })
    );
  } catch { /* 容量超過時は下書きを諦める(本体保存はsetSaved側で対処済み) */ }
}

export function saveDraft(mode: Mode, name: string | null, content: string): void {
  if (!content) {
    if (draftTimers[mode]) { clearTimeout(draftTimers[mode]!); draftTimers[mode] = null; }
    pendingDrafts[mode] = null;
    try { localStorage.removeItem(mode === 'html' ? STORAGE_KEYS.htmlDraft : STORAGE_KEYS.svgDraft); } catch { /* ignore */ }
    return;
  }
  pendingDrafts[mode] = { name, content };
  if (draftTimers[mode]) clearTimeout(draftTimers[mode]!);
  draftTimers[mode] = setTimeout(() => { draftTimers[mode] = null; writeDraftNow(mode); }, 300);
}

// debounce中の下書きを強制書き込み(タブ非表示/アンロード時に呼ぶ)
export function flushDrafts(): void {
  (['svg', 'html'] as Mode[]).forEach(m => {
    if (draftTimers[m]) { clearTimeout(draftTimers[m]!); draftTimers[m] = null; }
    writeDraftNow(m);
  });
}

export function getDraft(mode: Mode): Draft | null {
  try { return JSON.parse(localStorage.getItem(mode === 'html' ? STORAGE_KEYS.htmlDraft : STORAGE_KEYS.svgDraft) || 'null') as Draft | null; }
  catch { return null; }
}

// isDirtyの実際の値を下書きにも反映しておく。これをしないと、次回起動時に復元した下書きが
// 「登録済みで何も変わってないのに毎回“保存しますか？”と聞かれる」事故になる
export function setDraftDirty(mode: Mode, dirty: boolean): void {
  const draft = getDraft(mode);
  if (!draft) return;
  draft.dirty = dirty;
  try { localStorage.setItem(mode === 'html' ? STORAGE_KEYS.htmlDraft : STORAGE_KEYS.svgDraft, JSON.stringify(draft)); } catch { /* ignore */ }
}

// 閉じる直前にどちらのタブを見ていたかを覚えておき、次回そのタブから開けるようにする
export function getLastMode(): Mode {
  try { return (localStorage.getItem(STORAGE_KEYS.lastMode) as Mode) || 'svg'; } catch { return 'svg'; }
}
export function setLastMode(mode: Mode): void {
  try { localStorage.setItem(STORAGE_KEYS.lastMode, mode); } catch { /* ignore */ }
}

// 注: 旧実装にあったcloseAllSheets(DOMクラス直叩き)は、シートの開閉をReactのstateに
// 移したことで「同時に複数シートがopenになる構造」自体をApp側で排除したため不要になった。
// (選んで印刷が無反応になる不具合の対策は、openX()が必ず全シートを閉じてから自分だけ開く
//  というApp側の実装で同等に維持される)
