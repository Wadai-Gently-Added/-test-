// ビューアの実行時状態(旧viewer.jsのモジュールレベル変数 + 旧mode.jsのmodeState)。
// Reactの外に置く単一のmutable状態。変更後はAppのbump()で再描画を促す。
import type { Mode, ModeState } from '../types/zou';

export interface Runtime {
  scale: number;
  tx: number;
  ty: number;
  currentName: string | null;
  // 今表示中の内容が、マイSVG/マイHTMLのどのアイテムから読み込まれたか
  // (「編集して新規保存」した時、その元アイテムのすぐ下に置くために使う)
  currentSourceItemId: string | null;
  isDirty: boolean;
  // HTMLモード: sandbox(allow-same-origin無し)iframeは中身を読み返せないため、
  // 読込時に保持しておいた元テキストを保存/ダウンロード/コード編集に使う
  currentHtmlSource: string | null;
  // false=閲覧モード(ズーム/ドラッグ優先、iframe内はクリック不可)
  // true=操作モード(iframe内のボタン/プルダウン等を直接操作できるが、その上でのズーム/ドラッグは効かない)
  htmlInteractMode: boolean;
  // 右クリック直後のクリック誤反応を防ぐ suppression (旧viewer.js suppressClickUntil)
  suppressClickUntil: number;
}

export const runtime: Runtime = {
  scale: 1, tx: 0, ty: 0,
  currentName: null,
  currentSourceItemId: null,
  isDirty: false,
  currentHtmlSource: null,
  htmlInteractMode: false,
  suppressClickUntil: 0,
};

/** モードごとの表示状態を退避しておく置き場。タブを切り替えても中身を消さず、
 * 元のモードに戻ってきた時にそのまま復元できるようにする(旧mode.js modeState) */
export const modeState: Record<Mode, ModeState> = {
  svg: { node: null, name: null, htmlSource: null, scale: 1, tx: 0, ty: 0, dirty: false },
  html: { node: null, name: null, htmlSource: null, scale: 1, tx: 0, ty: 0, dirty: false },
};

/** wake lock(常時点灯)の実行時状態 */
export const wakeRuntime = {
  wakeLock: null as unknown as null | { release: () => Promise<void>; addEventListener: (t: string, cb: () => void) => void },
  wanted: false,
};
