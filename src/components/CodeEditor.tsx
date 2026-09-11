// コード編集シート。旧js/viewer.jsのコード編集部(差分ハイライト+検索/置換)を移植。
// comment色分け/変更行ハイライト: textareaを文字透明にしてキャレットのみ表示し、
// 裏に重ねたpre(codeHighlight)が色付き表示を担当する。
import { useEffect, useMemo, useRef, useState } from 'react';
import { STR } from '../lib/i18n';
import {
  computeChangedCharRanges, findCommentRanges, buildStyledLineHtml,
} from '../lib/codeDiff';
import { useZou } from '../state/ZouContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CodeEditor({ open, onClose }: Props): JSX.Element | null {
  const zou = useZou();
  const codeBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [value, setValue] = useState('');
  const baselineRef = useRef(''); // 編集シートを開いた時点の内容。ここからの変更行をハイライトする基準
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchIdx, setMatchIdx] = useState(-1);
  const matches = useMemo<[number, number][]>(() => {
    if (!searchTerm) return [];
    const text = value;
    const hay = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? searchTerm : searchTerm.toLowerCase();
    const out: [number, number][] = [];
    let idx = 0;
    for (;;) {
      const found = hay.indexOf(needle, idx);
      if (found === -1) break;
      out.push([found, found + needle.length]);
      idx = found + needle.length;
    }
    return out;
  }, [searchTerm, caseSensitive, value]);

  // シートを開いた瞬間だけ現在表示中の内容を取り込む(旧openCodeの初期化)。
  // zouを依存に入れるとApp再描画のたびに編集中のテキストが巻き戻るため open 変化のみに反応させる
  useEffect(() => {
    if (!open) return;
    const initial = zou.currentContentString() || '';
    setValue(initial);
    baselineRef.current = initial;
    setSearchTerm(''); setReplaceTerm(''); setMatchIdx(-1); setSearchPanelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && searchPanelOpen) codeBoxRef.current?.focus();
  }, [open, searchPanelOpen]);

  if (!open) return null;
  const M = zou.t[zou.mode];

  function renderHighlight(text: string): string {
    const lines = text.split('\n');
    const changedRanges = computeChangedCharRanges(baselineRef.current, text);
    const commentRanges = findCommentRanges(text);
    const currentRanges = (matchIdx >= 0 && matches[matchIdx]) ? [matches[matchIdx]] : [];
    let offset = 0;
    return lines.map(line => {
      const lineStart = offset, lineEnd = offset + line.length;
      offset = lineEnd + 1;
      const segHtml = buildStyledLineHtml(text, lineStart, lineEnd, {
        'code-comment': commentRanges,
        'code-changed': changedRanges,
        'search-match': matches,
        'search-current': currentRanges,
      });
      return `<span class="code-line">${segHtml || ' '}</span>`;
    }).join('');
  }

  function gotoMatch(delta: number): void {
    if (!matches.length) return;
    const next = (matchIdx + delta + matches.length) % matches.length;
    setMatchIdx(next);
    const [s, e] = matches[next];
    const box = codeBoxRef.current;
    if (box) { box.focus(); box.setSelectionRange(s, e); }
  }

  function replaceCurrentMatch(): void {
    if (!matches.length || matchIdx < 0) return;
    const [s, e] = matches[matchIdx];
    const next = value.slice(0, s) + replaceTerm + value.slice(e);
    setValue(next);
  }

  function replaceAllMatches(): void {
    if (!searchTerm) return;
    const text = value;
    const hay = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? searchTerm : searchTerm.toLowerCase();
    let out = '', pos = 0;
    for (;;) {
      const found = hay.indexOf(needle, pos);
      if (found === -1) { out += text.slice(pos); break; }
      out += text.slice(pos, found) + replaceTerm;
      pos = found + needle.length;
    }
    setValue(out);
  }

  function syncScroll(): void {
    if (highlightRef.current && codeBoxRef.current) {
      highlightRef.current.scrollTop = codeBoxRef.current.scrollTop;
      highlightRef.current.scrollLeft = codeBoxRef.current.scrollLeft;
    }
  }

  function apply(): void {
    if (!value.trim()) { alert(STR.common.codeEmpty); return; }
    let ok = false;
    try {
      ok = zou.loadContentFromString(value, zou.currentName);
    } catch {
      alert(STR.common.codeApplyError);
      return;
    }
    // 解析失敗時はloadContent内で既にエラーを表示済み。成功した時だけ閉じる
    if (!ok) return;
    zou.markDirty();
    onClose();
  }

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' open' : ''}`} id="codeSheet" style={{ maxHeight: '85vh' }}>
        <h2>{M.codeSheetTitle}</h2>
        <button
          id="btnCodeSearchToggle"
          className="topbtn"
          style={{ padding: '4px 10px', float: 'right', marginTop: -34, position: 'relative' }}
          onClick={() => setSearchPanelOpen(o => !o)}
        >🔍 {STR.common.searchToggle.replace('🔍 ', '')}</button>
        {searchPanelOpen && (
          <div id="codeSearchPanel">
            <div className="code-search-row">
              <input type="text" id="codeSearchInput" placeholder={STR.common.searchPlaceholder}
                value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setMatchIdx(matches.length ? 0 : -1); }} />
              <label className="code-search-case">
                <input type="checkbox" id="codeSearchCase" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
                <span>Aa</span>
              </label>
              <span id="codeSearchStatus" className="code-search-status">
                {matches.length ? `${matchIdx + 1}/${matches.length}` : (searchTerm ? STR.common.searchNoMatch : '')}
              </span>
              <button id="codeSearchPrev" className="topbtn" style={{ padding: '4px 8px' }} onClick={() => gotoMatch(-1)}>◀</button>
              <button id="codeSearchNext" className="topbtn" style={{ padding: '4px 8px' }} onClick={() => gotoMatch(1)}>▶</button>
            </div>
            <div className="code-search-row">
              <input type="text" id="codeReplaceInput" placeholder={STR.common.replacePlaceholder}
                value={replaceTerm} onChange={e => setReplaceTerm(e.target.value)} />
              <button id="codeReplaceOne" className="topbtn" style={{ padding: '4px 8px' }} onClick={replaceCurrentMatch}>{STR.common.replaceOneBtn}</button>
              <button id="codeReplaceAll" className="topbtn" style={{ padding: '4px 8px' }} onClick={replaceAllMatches}>{STR.common.replaceAllBtn}</button>
            </div>
          </div>
        )}
        <div className="code-editor-wrap">
          <pre id="codeHighlight" ref={highlightRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderHighlight(value) }} />
          <textarea
            id="codeBox"
            ref={codeBoxRef}
            placeholder={M.codeBoxPlaceholder}
            spellCheck={false}
            value={value}
            onChange={e => setValue(e.target.value)}
            onScroll={syncScroll}
          />
        </div>
        <div className="row">
          <button className="btn accent" id="btnCodeApply" onClick={apply}>{STR.common.btnCodeApply}</button>
        </div>
        <div className="sheet-close" id="codeCancel" onClick={onClose}>{STR.common.sheetClose}</div>
      </div>
    </>
  );
}
