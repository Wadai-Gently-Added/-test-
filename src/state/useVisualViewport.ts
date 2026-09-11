// iPhoneでiframe内の入力欄にキーボードが出た時、外側のツール全体(#app)の「高さ」だけでなく
// 「上下の位置」自体もズレていく現象への対策(旧js/viewer.js冒頭をフック化)。
// visualViewport(ブラウザが「実際に見えている範囲」を教えてくれる仕組み)を使って
// 高さと上端位置の両方をその都度ピタッと同期し直す。
// ---- TODO改善#5: visualViewport同期のループ対策 ----
// 旧実装はresize/scrollイベントで直接styleを書くため、同期書き換えがレイアウト変化を
// 連鎖的に誘発してresizeが無限に飛ぶ(ループ)ことがあった。改善版は
// ①前回値と同一なら書き込まない(変化なしの再書き込みを断つ)
// ②同フレーム内の複数イベントをrAFで合流させる
// の2点でループを構造的に遮断する。
import { useEffect } from 'react';

export function useVisualViewportSync(appEl: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = appEl.current;
    if (!el || !window.visualViewport) return;
    const vv = window.visualViewport;

    let lastH = -1;
    let lastTop = -1;
    let rafId: number | null = null;

    const apply = () => {
      rafId = null;
      const h = Math.round(vv.height);
      const top = Math.round(vv.offsetTop);
      if (h === lastH && top === lastTop) return; // 変化なりの再適用を断つ(ループ対策)
      lastH = h; lastTop = top;
      el.style.height = h + 'px';
      el.style.top = top + 'px';
    };
    const sync = () => {
      if (rafId !== null) return; // 同フレームの多重イベントを合流
      rafId = requestAnimationFrame(apply);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [appEl]);
}
