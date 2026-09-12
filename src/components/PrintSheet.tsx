// 印刷シート(プレビュー表示+印刷実行)。旧js/print.jsのシート操作部を移植。
import { useEffect, useRef } from 'react';
import { STR } from '../lib/i18n';
import { useZou } from '../state/ZouContext';

interface Props {
  open: boolean;
  onClose: () => void;
  /** openPrintSheet()で積んだプレビューHTML */
  html: string;
  title: string;
}

export default function PrintSheet({ open, onClose, html, title }: Props): JSX.Element | null {
  const zou = useZou();
  const areaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && areaRef.current) areaRef.current.scrollTop = 0;
    if (open) window.scrollTo(0, 0);
  }, [open, html]);

  if (!open) return null;
  const S = zou.t;

  function doPrint(): void {
    const area = areaRef.current;
    if (area) area.scrollTop = 0;
    window.scrollTo(0, 0);
    // iOSは window.print() を連続で呼ぶと2回目以降無反応になることがあるため、
    // 直前に描画を確定させてから呼ぶ(requestAnimationFrameで1フレーム待つ)
    requestAnimationFrame(() => {
      setTimeout(() => {
        try { window.print(); }
        catch { alert(STR.common.printStartFailed); }
      }, 50);
    });
  }

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' open' : ''}`} id="printSheet" style={{ maxHeight: '92vh' }}>
        <h2 id="printSheetTitle">{title || STR.common.printSheetTitleDefault}</h2>
        <div className="print-hint" id="printHint">{STR.common.printHint}</div>
        <div id="printArea" ref={areaRef}
          style={{ background: '#fff', borderRadius: 10, overflow: 'auto', maxHeight: '74vh', padding: 4 }}
          dangerouslySetInnerHTML={{ __html: html }} />
        <div className="row">
          <button className="btn accent" id="btnDoPrint" onClick={doPrint}>{STR.common.btnDoPrint}</button>
        </div>
        <div className="sheet-close" id="printCancel" onClick={onClose}>{STR.common.sheetClose}</div>
      </div>
    </>
  );
}
