import { createContext, useContext } from 'react';
import type { Mode, LangKey, SavedItem, PrintItem, PrintMode } from '../types/zou';
import type { LanguageData } from '../locales/types';

/** アプリ全体で共有する状態と操作(App が Provider となる) */
export interface ZouContextValue {
  // 状態
  mode: Mode;
  lang: LangKey;
  t: LanguageData;
  currentName: string | null;
  hasContent: boolean;
  // 選んで印刷(グループ横断のグローバル選択モード)
  printSelectActive: boolean;
  printSelectCount: number;
  printSelectedIds: Set<string>;
  // 操作
  switchMode: (m: Mode) => void;
  changeLanguage: (l: LangKey) => void;
  /** クリップボード/貼り付け/ファイルなど「新規に読み込む」系(dirty付与・元アイテム解除) */
  loadFresh: (text: string, name: string | null) => void;
  /** マイ一覧から読み込む系(dirty解除・元アイテム設定) */
  loadFromItem: (item: SavedItem) => void;
  /** コード編集の「反映する」から呼ぶ読み込み(dirtyは呼び出し側でmarkDirtyする) */
  loadContentFromString: (text: string, name: string | null) => boolean;
  markDirty: () => void;
  currentContentString: () => string | null;
  saveCurrent: () => boolean;
  downloadCurrentFile: () => void;
  /** コード編集シートを開く(ロック中アイテムのコピー確認を含む) */
  openCodeSheet: () => void;
  /** 印刷シートを開く(プレビューHTMLは事前構築) */
  openPrintSheet: (html: string, title: string) => void;
  openMultiPrint: (items: PrintItem[], mode: PrintMode, title: string) => void;
  openGroupPrint: (groupId: string, groupName: string, mode: PrintMode) => void;
  openSinglePrint: (name: string | null, code: string, mode: PrintMode, meta?: { savedAt: string; modifiedAt?: string }) => void;
  /** ストレージ変更後の強制再描画(renderList相当) */
  refresh: () => void;
  // バックアップ/同期
  exportBackup: () => void;
  openImportBackup: () => void;
  openMergeBackup: () => void;
  restorePreImportSnapshot: () => void;
  // 選んで印刷
  enterPrintSelectMode: () => void;
  exitPrintSelectMode: () => void;
  togglePrintSelected: (id: string, checked: boolean) => void;
}

export const ZouContext = createContext<ZouContextValue | null>(null);

export function useZou(): ZouContextValue {
  const v = useContext(ZouContext);
  if (!v) throw new Error('ZouContext not mounted');
  return v;
}
