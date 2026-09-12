export type Mode = 'svg' | 'html';
export type LangKey = 'ja' | 'en' | 'es' | 'fr' | 'ko' | 'zh' | 'de' | 'it' | 'pt' | 'ru' | 'el';

export interface SavedItem {
  id: string;
  name: string;
  content: string;
  savedAt: string;    // ISO
  modifiedAt: string; // ISO
  pinned: boolean;
  group: string | null;
  locked?: boolean;   // 🔗同期で取り込んだアイテムは自動ロック(誤上書き/削除防止)
}

export interface Group {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

/** topOrder = グループ化タブ(グループ本体)と未グループ個別アイテムが混ざる「Edgeのタブバー」的な並び順 */
export interface TopOrderEntry {
  type: 'group' | 'item';
  id: string;
}

/** タブ切替時に表示内容を消さずに退避しておく置き場(旧mode.jsのmodeState) */
export interface ModeState {
  node: HTMLElement | SVGSVGElement | null;
  name: string | null;
  htmlSource: string | null;
  scale: number;
  tx: number;
  ty: number;
  dirty: boolean;
}

export interface Draft {
  name: string | null;
  content: string;
  dirty: boolean;
  savedAt: string;
}

export interface SortSnapshot {
  savedAt: string;
  itemIdOrder: string[];   // items配列の並び順(idの列)だけ覚えておく
  topOrder: TopOrderEntry[] | null;
}

export type PrintMode = 'checklist' | 'image' | 'image-grid' | 'code' | 'both';
export type SortCriteria = 'name-asc' | 'name-desc' | 'newest' | 'oldest';

/** 印刷用に正規化した1件分のデータ(buildPrintOutputへの入力) */
export interface PrintItem {
  name: string;
  content: string;
  savedAt: string;
  modifiedAt?: string;
}

/** 右クリック(長押し)メニューの選択肢。submenuがある場合はホバー/クリックで子メニューを開く */
export interface CtxOption {
  label: string;
  onClick?: () => void;
  submenu?: CtxOption[];
}
