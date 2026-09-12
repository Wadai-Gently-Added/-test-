// SVG/HTML表示コア(ズーム/パン/fitToView) (旧js/viewer.jsの変換・入力部分を分離)
import type { Mode } from '../types/zou';
import { HTML_FRAME_WIDTH, HTML_FRAME_HEIGHT } from './constants';
import { extractSvgElement } from './svgUtils';

export interface ViewerTransform {
  scale: number;
  tx: number;
  ty: number;
}

export function applyTransformTo(stage: HTMLElement | null | undefined, t: ViewerTransform): void {
  if (!stage) return;
  stage.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;
}

/** SVGモードはgetBBox(SVG自身の座標系)、HTMLモードはiframeのCSSサイズを使って、
 * 内容が枠の86%に収まるよう自動でスケール・中央寄せする */
export function fitToViewOf(stage: HTMLElement | null, wrap: HTMLElement | null, mode: Mode): ViewerTransform {
  if (!stage || !wrap) return { scale: 1, tx: 0, ty: 0 };
  const isHtml = mode === 'html';
  const targetEl = isHtml ? stage.querySelector('.html-content-wrap') : stage.querySelector('svg');
  if (!targetEl) return { scale: 1, tx: 0, ty: 0 };

  let box: { x: number; y: number; width: number; height: number } | null = null;
  if (isHtml) {
    // iframeはstyleに固定pxを焼き込んであるので、実測せずその値をそのまま使う
    // (transformの影響を受けないCSS上のサイズ。TODO改善#2の応伝化サイズもここで拾える)
    const f = targetEl as HTMLElement;
    const w = parseFloat(f.style.width) || HTML_FRAME_WIDTH;
    const h = parseFloat(f.style.height) || HTML_FRAME_HEIGHT;
    box = { x: 0, y: 0, width: w, height: h };
  } else {
    try { box = (targetEl as SVGSVGElement).getBBox(); } catch { box = null; }
  }
  if (!box || !box.width || !box.height) return { scale: 1, tx: 0, ty: 0 };

  const rect = wrap.getBoundingClientRect();
  const availW = rect.width * 0.86;
  const availH = rect.height * 0.86;
  let s = Math.min(availW / box.width, availH / box.height);
  if (!isFinite(s) || s <= 0) s = 1;
  const scale = Math.min(s, 10);
  // center the content's actual box (not just its 0,0 origin)
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return { scale, tx: -cx * scale, ty: -cy * scale };
}

/** wheelズーム(PC向け。カーソル位置を中心に拡大縮小)の計算部分 */
export function wheelZoom(
  t: ViewerTransform,
  e: { deltaY: number; clientX: number; clientY: number },
  wrap: HTMLElement | null,
): ViewerTransform {
  if (!wrap) return t;
  const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
  const newScale = Math.min(20, Math.max(0.05, t.scale * factor));
  const rect = wrap.getBoundingClientRect();
  const cx = e.clientX - rect.left - rect.width / 2;
  const cy = e.clientY - rect.top - rect.height / 2;
  return {
    scale: newScale,
    tx: cx - (cx - t.tx) * (newScale / t.scale),
    ty: cy - (cy - t.ty) * (newScale / t.scale),
  };
}

/** ピンチズームの計算部分(2ポインターの中点を中心に拡大縮小) */
export function pinchZoom(
  t: ViewerTransform,
  lastDist: number,
  dist: number,
  mid: { x: number; y: number },
  wrap: HTMLElement | null,
): ViewerTransform {
  if (!wrap) return t;
  const factor = lastDist === 0 ? 1 : dist / lastDist;
  const newScale = Math.min(20, Math.max(0.05, t.scale * factor));
  const rect = wrap.getBoundingClientRect();
  const cx = mid.x - rect.left - rect.width / 2;
  const cy = mid.y - rect.top - rect.height / 2;
  return {
    scale: newScale,
    tx: cx - (cx - t.tx) * (newScale / t.scale),
    ty: cy - (cy - t.ty) * (newScale / t.scale),
  };
}

/** 表示用ノードを構築する(SVG厳密パース→HTMLはsandbox化iframe)。失敗時はnull */
export function buildViewerNode(text: string, mode: Mode, wrapWidth: number | null): HTMLElement | SVGSVGElement | null {
  if (mode === 'svg') {
    const svgSource = extractSvgElement(text);
    if (!svgSource) return null;
    const svgEl = document.importNode(svgSource, true) as SVGSVGElement;
    svgEl.style.overflow = 'visible';
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    if (vb && vb.width && vb.height) {
      svgEl.style.width = vb.width + 'px';
      svgEl.style.height = vb.height + 'px';
    }
    return svgEl;
  }
  if (!text || !text.trim()) return null;
  const frame = document.createElement('iframe');
  frame.className = 'html-content-wrap';
  // 読み込んだHTML側のCSS/JSがアプリ本体に一切影響しないよう、sandbox="allow-scripts"のみで
  // allow-same-originを付けず完全隔離する(中身をJSから直接読み返せない設計)
  frame.setAttribute('sandbox', 'allow-scripts');
  const size = htmlFrameSize(wrapWidth);
  frame.style.width = size.width + 'px';
  frame.style.height = size.height + 'px';
  frame.style.border = 'none';
  frame.style.display = 'block';
  frame.srcdoc = text;
  return frame;
}

// ---- TODO改善#2: HTML操作モードの1280px固定問題 ----
// 旧実装はHTML_FRAME_WIDTH/HEIGHT(1280×800)固定のため、画面の小さいスマホだと操作モード中に
// 一部しか見えなかった(操作モード中はドラッグ移動が効かない仕様のため)。改善版では
// フレーム幅を「min(1280px, ビューア幅 - 16px)」に応伝化し、小さい画面でも等倍で
// 全体が見えるようにする(全体への収まりはfitToViewOfが面倒を見るので表示は崩れない)。
// 操作モード中は#interactStageがoverflow:autoでスクロール可能なままなので、
// フレームの外周からでも画面をスクロールして届く範囲が広がる。
export function htmlFrameSize(wrapWidth: number | null): { width: number; height: number } {
  const w = wrapWidth && wrapWidth > 32 ? Math.min(HTML_FRAME_WIDTH, Math.floor(wrapWidth - 16)) : HTML_FRAME_WIDTH;
  // 高さはアスペクト比1280:800を維持
  return { width: w, height: Math.round(w * (HTML_FRAME_HEIGHT / HTML_FRAME_WIDTH)) };
}
