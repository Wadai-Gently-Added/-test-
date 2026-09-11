// 貼り付けシート。旧viewer.jsのpasteSheet操作を移植。
import { useEffect, useRef } from 'react';
import { useZou } from '../state/ZouContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PasteSheet({ open, onClose }: Props): JSX.Element | null {
  const zou = useZou();
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open && boxRef.current) boxRef.current.value = '';
  }, [open]);

  if (!open) return null;
  const M = zou.t[zou.mode];

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' open' : ''}`} id="pasteSheet">
        <h2 id="pasteSheetTitle">{M.pasteSheetTitle}</h2>
        <textarea id="pasteBox" ref={boxRef} placeholder={M.pasteBoxPlaceholder} />
        <div className="row">
          <button className="btn accent" id="btnPasteLoad" onClick={() => {
            const val = boxRef.current?.value ?? '';
            onClose();
            zou.loadFresh(val, zou.t.common.manualPasteName);
          }}>{zou.t.common.btnPasteLoad}</button>
        </div>
        <div className="sheet-close" id="pasteCancel" onClick={onClose}>{zou.t.common.sheetClose}</div>
      </div>
    </>
  );
}
