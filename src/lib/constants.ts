// グローバル定数(storage.jsのGROUP_COLORS / viewer.jsのHTML_FRAME_WIDTH等)
export const GROUP_COLORS = ['#e0625c', '#e0b85c', '#7ea6e0', '#b57ee0', '#e07eb8', '#8bd17e'];

export const HTML_FRAME_WIDTH = 1280;
export const HTML_FRAME_HEIGHT = 800;

// localStorageキー(SVG/HTMLで完全に別のデータとして保存し、混ざらない)
export const STORAGE_KEYS = {
  svgSavedItems: 'svgViewerSavedItems',
  htmlSavedItems: 'htmlViewerSavedItems',
  svgGroups: 'svgViewerGroups',
  htmlGroups: 'htmlViewerGroups',
  svgTopOrder: 'svgViewerTopOrder',
  htmlTopOrder: 'htmlViewerTopOrder',
  svgDraft: 'svgViewerDraft',
  htmlDraft: 'htmlViewerDraft',
  lastMode: 'viewerLastMode',
  preSortSnapshot: (mode: 'svg' | 'html') => `zouPreSortSnapshot_${mode}`,
  preImportSnapshot: 'zouPreImportSnapshot',
} as const;

// バックアップ対象キー(マイSVG・マイHTML両方の登録データ・グループ・並び順)
export const BACKUP_KEYS = [
  STORAGE_KEYS.svgSavedItems,
  STORAGE_KEYS.svgGroups,
  STORAGE_KEYS.svgTopOrder,
  STORAGE_KEYS.htmlSavedItems,
  STORAGE_KEYS.htmlGroups,
  STORAGE_KEYS.htmlTopOrder,
] as const;

// 保存一覧は上限100件(list.js? → viewer.js saveCurrentのslice(0,100))
export const SAVED_ITEMS_LIMIT = 100;

// 手動並べ替え以外の表示順ルール(renderList):
//  1. グループ(フォルダ)は常に未グループのアイテムより上に固定表示
//  2. 未グループのアイテム同士はピン留めしたものを先頭にまとめる
// TODO(将来拡張): この2ルールを設定でオン/オフできるようにする余地(元コードにもコメントあり)
export const DISPLAY_ORDER_RULES = { groupFirst: true, pinnedFirst: true } as const;
