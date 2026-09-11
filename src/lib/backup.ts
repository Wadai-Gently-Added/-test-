// バックアップ書き出し/読み込み、端末間の手動同期(マージ) (旧js/list.js後半を分離)
import type { SavedItem, Group, TopOrderEntry } from '../types/zou';
import { BACKUP_KEYS, STORAGE_KEYS } from './constants';
import { getSaved, setSaved, getTopOrder, setTopOrder, reconcileTopOrder, getCurrentMode, setCurrentMode } from './storage';

export interface MergeResult { added: number; updated: number }

/** マイSVG・マイHTML両方の登録データ・グループ・並び順を丸ごと1つのJSONに書き出す。
 * Chrome/EdgeはshowSaveFilePickerで保存先を選ばせ、未対応ブラウザ(Safari等)は
 * ダウンロードフォルダへの保存にフォールバックする。 */
export async function exportBackup(): Promise<void> {
  const data: Record<string, string | null> = { appName: '造 -ZOU-', exportedAt: new Date().toISOString() };
  BACKUP_KEYS.forEach(k => { data[k] = localStorage.getItem(k); });
  const json = JSON.stringify(data, null, 2);
  const filename = `zou-backup-${new Date().toISOString().slice(0, 10)}.json`;

  interface SavePicker { suggestedName?: string; types?: unknown }
  type SaveFilePicker = (o: SavePicker) => Promise<{
    createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  }>;

  const w = window as unknown as { showSaveFilePicker?: SaveFilePicker };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (e) {
      if (e && typeof e === 'object' && (e as DOMException).name === 'AbortError') return; // ユーザーキャンセル
      // それ以外のエラーは下のフォールバックへ
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 読み込み(上書き)の前に必ず今のデータを退避スナップショットへ保存しておき、
 * 「復元したら別のデータが消えた」という二次事故を防ぐ */
export function snapshotBeforeImport(): void {
  const snap: Record<string, string | null> = { savedAt: new Date().toISOString() };
  BACKUP_KEYS.forEach(k => { snap[k] = localStorage.getItem(k); });
  try { localStorage.setItem(STORAGE_KEYS.preImportSnapshot, JSON.stringify(snap)); } catch { /* ignore */ }
}

function parseJsonArray(str: unknown): unknown[] {
  try { const v = JSON.parse((str as string) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

function itemTimestamp(it: SavedItem): number {
  const t = new Date(it.modifiedAt || it.savedAt || 0).getTime();
  return isNaN(t) ? 0 : t;
}

function readBackupFile(file: File, cb: (data: Record<string, unknown>) => void, onError: () => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    try { cb(JSON.parse(String(reader.result)) as Record<string, unknown>); }
    catch { onError(); }
  };
  reader.readAsText(file);
}

/** バックアップJSONで丸ごと上書きする。parse→形式チェック→confirm→退避→書き込みの順
 * (旧実装と同じ順序。壊れているファイルではconfirmを出さずにエラーのみ) */
export function importBackup(
  file: File,
  opts: { confirm: () => boolean; onDone: () => void; onError: () => void },
): void {
  readBackupFile(file, data => {
    const hasAny = data && BACKUP_KEYS.some(k => k in data);
    if (!hasAny) { opts.onError(); return; }
    if (!opts.confirm()) return;
    snapshotBeforeImport();
    BACKUP_KEYS.forEach(k => {
      if (data[k] != null) localStorage.setItem(k, data[k] as string);
      else localStorage.removeItem(k);
    });
    // 整合性のため、取り込んだ内容でtopOrderを再同期しておく
    (['svg', 'html'] as const).forEach(mode => syncTopOrderFor(mode));
    opts.onDone();
  }, opts.onError);
}

/** 端末間の手動同期(マージ)。importBackupと違って「丸ごと上書き」はせず、
 * IDが無ければ新規追加・IDがあってもmodifiedAtが新しい方だけ採用、というマージを行い、
 * 結果を追加/更新件数で返す。ファイルへの書き込みは行わず、選んだファイルを読むだけなので、
 * どの端末・どのブラウザ(iPhoneのSafariも含む)でも同じ手順で使える。
 * 🔗同期で取り込んだアイテムは自動でロックされ、誤って上書き/削除できないようにする。 */
export function mergeBackup(
  file: File,
  opts: { onDone: (result: MergeResult) => void; onError: () => void },
): void {
  readBackupFile(file, data => {
    const hasAny = data && BACKUP_KEYS.some(k => k in data);
    if (!hasAny) { opts.onError(); return; }
    snapshotBeforeImport(); // マージでも、万一のために直前の状態は退避しておく

    let addedCount = 0, updatedCount = 0;
    (['svg', 'html'] as const).forEach(mode => {
      const itemsKey = mode === 'html' ? STORAGE_KEYS.htmlSavedItems : STORAGE_KEYS.svgSavedItems;
      const groupsKeyName = mode === 'html' ? STORAGE_KEYS.htmlGroups : STORAGE_KEYS.svgGroups;
      const currentItems = parseJsonArray(localStorage.getItem(itemsKey)) as SavedItem[];
      const incomingItems = parseJsonArray(data[itemsKey]) as SavedItem[];
      const byId = new Map(currentItems.map(it => [it.id, it]));
      incomingItems.forEach(inItem => {
        const cur = byId.get(inItem.id);
        if (!cur) {
          inItem.locked = true; // 🔗同期で取り込んだものは自動でロック(かけ忘れによる誤編集を防ぐ)
          currentItems.push(inItem);
          byId.set(inItem.id, inItem);
          addedCount++;
        } else if (itemTimestamp(inItem) > itemTimestamp(cur)) {
          Object.assign(cur, inItem);
          cur.locked = true; // 共有元の方が新しい=向こうが正、という更新なのでこちらもロックする
          updatedCount++;
        }
      });
      localStorage.setItem(itemsKey, JSON.stringify(currentItems));

      // グループはID単位で無ければ追加するだけ(名前や色の食い違いは触らない)
      const currentGroups = parseJsonArray(localStorage.getItem(groupsKeyName)) as Group[];
      const incomingGroups = parseJsonArray(data[groupsKeyName]) as Group[];
      const groupIds = new Set(currentGroups.map(g => g.id));
      incomingGroups.forEach(g => { if (!groupIds.has(g.id)) { currentGroups.push(g); groupIds.add(g.id); } });
      localStorage.setItem(groupsKeyName, JSON.stringify(currentGroups));
    });
    opts.onDone({ added: addedCount, updated: updatedCount });
  }, opts.onError);
}

/** 直前のインポート前の状態に戻す */
export function restorePreImportSnapshot(
  opts: { confirm: () => boolean; onDone: () => void; onNoSnapshot: () => void },
): void {
  let snap: Record<string, string | null> | null = null;
  try { snap = JSON.parse(localStorage.getItem(STORAGE_KEYS.preImportSnapshot) || 'null') as Record<string, string | null>; }
  catch { snap = null; }
  if (!snap) { opts.onNoSnapshot(); return; }
  if (!opts.confirm()) return;
  BACKUP_KEYS.forEach(k => {
    if (snap![k] != null) localStorage.setItem(k, snap![k] as string);
    else localStorage.removeItem(k);
  });
  (['svg', 'html'] as const).forEach(mode => syncTopOrderFor(mode));
  opts.onDone();
}

// reconcileTopOrderはcurrentModeに依存して書き先を変えるため、モードを一時的に差し替えて呼ぶヘルパー
function syncTopOrderFor(mode: 'svg' | 'html'): void {
  try {
    const prev = getCurrentMode();
    setCurrentMode(mode);
    const items = getSaved();
    const groups = JSON.parse(localStorage.getItem(mode === 'html' ? STORAGE_KEYS.htmlGroups : STORAGE_KEYS.svgGroups) || '[]') as Group[];
    const order: TopOrderEntry[] = reconcileTopOrder(items, groups);
    setTopOrder(order);
    setCurrentMode(prev);
  } catch { /* ignore */ }
}
