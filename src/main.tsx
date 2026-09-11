import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installErrorBanner } from './lib/errorBanner';
import './styles/zou.css';

// 開発中の診断用: どこかのJSでエラーが起きたら画面上部に赤帯で表示する
// (旧index.htmlのwindow.onerror診断帯の移植。全スクリプトより先に効かせたいのでmain.tsxの先頭で)
installErrorBanner();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
