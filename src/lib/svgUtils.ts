// SVG/HTMLコンテンツの解析系ヘルパー(viewer.js/list.js/print.jsから分離)
import type { Mode } from '../types/zou';

/** SVGソース文字列から<svg>要素を取り出す。まずXMLとして厳密に、失敗ならHTMLフラグメントとして拾う */
export function extractSvgElement(text: string | null | undefined): SVGSVGElement | null {
  if (!text || !text.trim()) return null;
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (!doc.querySelector('parsererror')) {
      const root = doc.documentElement;
      if (root && root.tagName && root.tagName.toLowerCase() === 'svg') return root as unknown as SVGSVGElement;
    }
  } catch { /* fallthrough */ }
  try {
    const doc2 = new DOMParser().parseFromString(text, 'text/html');
    return doc2.querySelector('svg');
  } catch {
    return null;
  }
}

/**
 * ビューア表示用に固定px幅/高さが焼き付いたSVGコードを、印刷の枠にきれいに収まるよう
 * 「実際の描画範囲(getBBox)」を測ってviewBoxを引き直す。
 * viewBoxが無い/ズレているSVGでもこれで正しく縮小される(旧print.js svgForThumbnail)。
 */
export function svgForThumbnail(code: string): string {
  let tmp: HTMLDivElement | null = null;
  try {
    tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:200px;height:200px;overflow:hidden;';
    tmp.textContent = ''; tmp.innerHTML = code.replace(/<script[\s\S]*?<\/script>/gi, ''); // FIX: strip script to avoid white screen
    document.body.appendChild(tmp);
    const svgEl = tmp.querySelector('svg');
    if (svgEl) {
      svgEl.style.overflow = 'visible';
      let bbox: DOMRect | null = null;
      try { bbox = svgEl.getBBox(); } catch { bbox = null; }
      // レイアウトを強制してから計測(旧list.js normalizeThumbSvgと同じ配慮)
      void tmp.offsetHeight;
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        const pad = Math.max(bbox.width, bbox.height) * 0.03;
        svgEl.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
      } else if (!svgEl.getAttribute('viewBox')) {
        const num = (v: string | null) => (v ? parseFloat(String(v).replace(/[^0-9.]/g, '')) : NaN);
        const w = num(svgEl.getAttribute('width'));
        const h = num(svgEl.getAttribute('height'));
        if (w > 0 && h > 0) svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.style.maxWidth = '100%';
      svgEl.style.maxHeight = '100%';
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const result = tmp.innerHTML;
      document.body.removeChild(tmp);
      return result;
    }
  } catch { /* fallthrough */ }
  if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
  return code;
}

/**
 * マイ一覧サムネイル用の正規化(旧list.js normalizeThumbSvg後継)。
 * width/height属性だけでなくインラインstyleのwidth/heightも取り除く
 * (style属性の直接寸法はCSSのwidth:100%より優先され、44×44枠に対し等倍描画で
 *  大部分が切れて見えなくなるバグの対策)。
 */
export function normalizeThumbSvg(svgString: string): string {
  return svgForThumbnail(svgString);
}

/** 印刷の枠に埋め込む内容を用意する。SVGはviewBox引き直し、HTMLはsandbox化iframeで隔離 */
export function contentForThumbnail(code: string, mode: Mode): string {
  if (mode === 'html') {
    const escaped = escHtml(code).replace(/"/g, '&quot;');
    return `<iframe class="html-print-frame" sandbox="allow-scripts" srcdoc="${escaped}" style="width:100%;height:100%;border:none;"></iframe>`;
  }
  return svgForThumbnail(code);
}

export function escHtml(s: string | null | undefined): string {
  return (s == null ? '' : String(s)).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** SVGコードから「サイズ」「ViewBox」の表示用テキストを取り出す(旧print.js getSvgMeta) */
export function getSvgMeta(code: string): { size: string; viewBox: string } {
  try {
    const tmp = document.createElement('div');
    tmp.textContent = ''; tmp.innerHTML = code.replace(/<script[\s\S]*?<\/script>/gi, ''); // FIX: strip script to avoid white screen
    const svgEl = tmp.querySelector('svg');
    if (!svgEl) return { size: '-', viewBox: '-' };
    const vb = svgEl.getAttribute('viewBox');
    const vbParts = vb ? vb.trim().split(/\s+/) : null;
    const w = svgEl.getAttribute('width') || (vbParts ? vbParts[2] : '-');
    const h = svgEl.getAttribute('height') || (vbParts ? vbParts[3] : '-');
    return { size: `${w} × ${h}`, viewBox: vb || '-' };
  } catch {
    return { size: '-', viewBox: '-' };
  }
}
