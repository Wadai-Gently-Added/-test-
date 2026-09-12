// 旧index.htmlの開発用診断帯の移植。
// どこかのJSでエラーが起きたら画面上部に赤帯で表示する(iPadなどF12が使えない端末でも
// 実際のエラー内容がその場で分かるようにするため)。
let installed = false;

export function installErrorBanner(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    try {
      const msg = `⚠️ JSエラー: ${e.message || '不明'}\n${e.filename || ''} 行:${e.lineno || '?'}:${e.colno || '?'}`;
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;font-size:12px;padding:10px;white-space:pre-wrap;word-break:break-all;font-family:monospace;';
      box.textContent = msg;
      document.body.appendChild(box);
    } catch { /* 診断帯自体の失敗は握りつぶす */ }
  });
}
