// App.tsx — 造 -ZOU- 本体。旧js全体(viewer/print/list/mode)のオーケストレーションを担う。
// シートの開閉のみstate化し、ビューア実体(DOMノード)はmodeStateで退避/復元する旧方式を踏襲。
import { useEffect, useReducer, useRef, useState } from 'react';
import type { Mode, LangKey, SavedItem, PrintItem, PrintMode } from './types/zou';
import { ZouContext } from './state/ZouContext';
import type { ZouContextValue } from './state/ZouContext';
import { runtime, modeState } from './state/viewerState';
import * as store from './lib/storage';
import { getDraft, flushDrafts } from './lib/storage';
import { SAVED_ITEMS_LIMIT } from './lib/constants';
import { STR, LANGUAGES, setLanguage, currentLanguage } from './lib/i18n';
import {
  buildViewerNode, fitToViewOf, applyTransformTo, wheelZoom, pinchZoom, htmlFrameSize,
} from './lib/viewerCore';
import { extractSvgElement } from './lib/svgUtils';
import {
  printSubmenuOptions, buildPrintOutput, buildChecklistHTML, printModeLabel,
} from './lib/print';
import {
  exportBackup, importBackup, mergeBackup,
  restorePreImportSnapshot as restorePreImportSnapshotLib,
} from './lib/backup';
import { showContextMenu, showUnsavedPrompt, showMergeResult } from './components/modals';
import { useWakeLock } from './hooks/useWakeLock';
import { useVisualViewportSync } from './hooks/useVisualViewport';
import { useSheets } from './hooks/useSheets';
import { useUnloadFlush } from './hooks/useZou';
import PasteSheet from './components/PasteSheet';
import SavedList from './components/SavedList';
import CodeEditor from './components/CodeEditor';
import PrintSheet from './components/PrintSheet';

export default function App(): JSX.Element {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [mode, setMode] = useState<Mode>(store.getCurrentMode());
  const [lang, setLangState] = useState<LangKey>(currentLanguage);
  const { openSheet, openOne, closeAll } = useSheets();
  const [printHtml, setPrintHtml] = useState('');
  const [printTitle, setPrintTitle] = useState('');
  const [printSelectActive, setPrintSelectActive] = useState(false);
  const printSelectActiveRef = useRef(false);
  const printSelectedIds = useRef<Set<string>>(new Set());
  const [printSelectCount, setPrintSelectCount] = useState(0);
  const [hasContent, setHasContent] = useState(false);
  const [bg, setBg] = useState<'checker' | 'white' | 'black'>('white');
  const [focusModeOn, setFocusModeOn] = useState(false);
  const [interactOn, setInteractOn] = useState(false);

  const appRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const interactStageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const mergeFileRef = useRef<HTMLInputElement | null>(null);

  const wake = useWakeLock();
  useVisualViewportSync(appRef);
  useUnloadFlush(flushDrafts);

  useEffect(() => {
    document.body.classList.toggle('focus-mode', focusModeOn);
  }, [focusModeOn]);

  // 印刷ダイアログが閉じたあとに選んで印刷モードが残らないようにする(旧print.jsのafterprint保険)。
  // stateのstale closureを避けるためref経由で判定する
  useEffect(() => {
    printSelectActiveRef.current = printSelectActive;
  }, [printSelectActive]);
  useEffect(() => {
    const h = () => { if (printSelectActiveRef.current) exitPrintSelectMode(); };
    window.addEventListener('afterprint', h);
    return () => window.removeEventListener('afterprint', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- ヘルパー ----------
  function currentContentString(): string | null {
    const stage = stageRef.current;
    if (store.getCurrentMode() === 'html') return runtime.currentHtmlSource;
    const el = stage?.querySelector('svg');
    return el ? el.outerHTML : null;
  }
  function hasStageContent(): boolean {
    const stage = stageRef.current;
    const interactStage = interactStageRef.current;
    if (store.getCurrentMode() === 'html') {
      return !!(stage?.querySelector('.html-content-wrap') || interactStage?.querySelector('.html-content-wrap'));
    }
    return !!stage?.querySelector('svg');
  }
  function fitToView(): void {
    const t = fitToViewOf(stageRef.current, wrapRef.current, store.getCurrentMode());
    runtime.scale = t.scale; runtime.tx = t.tx; runtime.ty = t.ty;
    applyTransformTo(stageRef.current, t);
  }

  function loadIntoStage(text: string, name: string | null): boolean {
    const stage = stageRef.current;
    if (!stage) return false;
    const m = store.getCurrentMode();
    const wrapW = wrapRef.current?.getBoundingClientRect().width ?? null;
    const node = buildViewerNode(text, m, wrapW);
    if (!node) {
      alert(STR.mode(m).parseError);
      return false;
    }
    stage.replaceChildren(); // FIX: white screen - replaceChildren safer than innerHTML in StrictMode
    stage.appendChild(node);
    stage.style.display = 'block';
    setHasContent(true);
    runtime.currentName = name;
    if (m === 'html') {
      runtime.currentHtmlSource = text;
      // 新しく読み込んだら毎回、安全な閲覧モードから始める
      (node as HTMLElement).style.pointerEvents = 'none';
      runtime.htmlInteractMode = false;
      setInteractOn(false);
    }
    fitToView();
    store.saveDraft(m, name, text); // 下書き自動保存(未登録でも次回復元できるように)
    return true;
  }

  function guarded(fn: () => void): void {
    if (runtime.isDirty) showUnsavedPrompt(fn, () => saveCurrent());
    else fn();
  }

  function loadFresh(text: string, name: string | null): void {
    guarded(() => {
      if (loadIntoStage(text, name)) {
        runtime.isDirty = true;
        store.setDraftDirty(store.getCurrentMode(), true);
        runtime.currentSourceItemId = null;
        refresh();
      }
    });
  }
  function loadFromItem(item: SavedItem): void {
    guarded(() => {
      if (loadIntoStage(item.content, item.name)) {
        runtime.isDirty = false;
        store.setDraftDirty(store.getCurrentMode(), false); // マイ一覧と同じ内容なので「未登録」扱いを外す
        runtime.currentSourceItemId = item.id; // 「編集して新規保存」した時、このすぐ下に置くため
        refresh();
      }
    });
  }
  function loadContentFromString(text: string, name: string | null): boolean {
    return loadIntoStage(text, name);
  }
  function markDirty(): void {
    runtime.isDirty = true;
    store.setDraftDirty(store.getCurrentMode(), true);
    refresh();
  }

  function saveCurrent(): boolean {
    const m = store.getCurrentMode();
    if (!hasStageContent()) { alert(STR.mode(m).noSaveContent); return false; }
    const arr = store.getSaved();
    let suggested = runtime.currentName || ((m === 'html' ? 'HTML ' : 'SVG ') + new Date().toLocaleString('ja-JP'));
    const base = suggested.replace(/\s*\(\d+\)\s*$/, '');
    const existingNums = arr.map(it => it.name)
      .filter(n => n === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(\\d+\\)$').test(n))
      .map(n => { const mm = n.match(/\((\d+)\)$/); return mm ? parseInt(mm[1], 10) : 1; });
    if (existingNums.length) suggested = base + '(' + (Math.max(...existingNums) + 1) + ')';
    const name = prompt(STR.common.savePrompt, suggested);
    if (name === null) return false;
    const now = new Date().toISOString();
    const newId = 's' + Date.now() + Math.random().toString(36).slice(2, 7);
    // 元になったアイテムがあれば、そのグループを引き継いだ上で、一覧の並び順も元アイテムのすぐ下へ
    const sourceItem = runtime.currentSourceItemId ? arr.find(it => it.id === runtime.currentSourceItemId) : null;
    arr.unshift({
      id: newId, name, content: currentContentString() || '',
      savedAt: now, modifiedAt: now, pinned: false, group: sourceItem ? sourceItem.group : null,
    });
    store.setSaved(arr.slice(0, SAVED_ITEMS_LIMIT));
    if (sourceItem && !sourceItem.group) {
      const order = store.getTopOrder();
      const pos = order.findIndex(e => e.type === 'item' && e.id === sourceItem.id);
      if (pos !== -1) { order.splice(pos + 1, 0, { type: 'item', id: newId }); store.setTopOrder(order); }
    }
    runtime.currentSourceItemId = newId;
    runtime.isDirty = false;
    store.setDraftDirty(m, false);
    return true;
  }

  function downloadCurrentFile(): void {
    const m = store.getCurrentMode();
    const content = currentContentString();
    if (!content) { alert(STR.mode(m).noSaveContent); return; }
    const isHtml = m === 'html';
    const defaultName = (runtime.currentName || STR.mode(m).defaultExportName).replace(/\.[a-zA-Z0-9]+$/, '');
    const name = prompt(STR.common.downloadNamePrompt, defaultName);
    if (name === null) return;
    let outText = content;
    if (!isHtml && !outText.includes('xmlns=')) {
      outText = outText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const blob = new Blob([outText], { type: isHtml ? 'text/html' : 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name.trim() || STR.mode(m).defaultExportName) + (isHtml ? '.html' : '.svg');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function openCodeSheet(): void {
    const m = store.getCurrentMode();
    // ロック中のアイテムは開く前にコピーを作るか確認(「編集できてるように見えて保存は別物」を防ぐ)
    const sourceItem = runtime.currentSourceItemId ? store.getSaved().find(it => it.id === runtime.currentSourceItemId) : null;
    if (sourceItem && sourceItem.locked) {
      if (!confirm(STR.common.lockedOpenCodeConfirm)) return;
      const cur = store.getSaved();
      const copy: SavedItem = {
        id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
        name: sourceItem.name + STR.common.itemDuplicateSuffix,
        content: sourceItem.content,
        savedAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        pinned: false,
        group: sourceItem.group || null,
        locked: false,
      };
      const idx = cur.findIndex(x => x.id === sourceItem.id);
      cur.splice(idx + 1, 0, copy);
      store.setSaved(cur);
      const order = store.getTopOrder();
      if (!copy.group) {
        const pos = order.findIndex(e => e.type === 'item' && e.id === sourceItem.id);
        if (pos !== -1) { order.splice(pos + 1, 0, { type: 'item', id: copy.id }); store.setTopOrder(order); }
      }
      loadIntoStage(copy.content, copy.name);
      runtime.currentSourceItemId = copy.id;
      runtime.isDirty = false;
      store.setDraftDirty(m, false);
      refresh();
    }
    openOne('code');
  }

  // ---------- 印刷 ----------
  function openPrintSheet(html: string, title: string): void {
    setPrintHtml(html);
    setPrintTitle(title);
    openOne('print');
  }
  function openSinglePrint(name: string | null, code: string, pm: PrintMode, meta?: { savedAt: string; modifiedAt?: string }): void {
    const m = store.getCurrentMode();
    const now = new Date().toISOString();
    const item: PrintItem = {
      name: name || '',
      content: code,
      savedAt: meta?.savedAt || now,
      modifiedAt: meta?.modifiedAt || meta?.savedAt || now,
    };
    if (pm === 'checklist') {
      openPrintSheet(buildChecklistHTML(name || '', [item], lang), STR.common.checklistTitle(name || STR.common.untitled));
      return;
    }
    openPrintSheet(buildPrintOutput([item], pm, store.getGroups(), m), `${name || STR.common.untitled}　${printModeLabel(pm, m)}`);
  }
  function openGroupPrint(groupId: string, groupName: string, pm: PrintMode): void {
    const m = store.getCurrentMode();
    const items = store.getSaved().filter(it => (it.group || null) === groupId);
    if (items.length === 0) { alert(STR.mode(m).noGroupItems); return; }
    if (pm === 'checklist') {
      openPrintSheet(buildChecklistHTML(groupName, items, lang), STR.common.checklistTitle(groupName || STR.common.untitled));
      return;
    }
    openPrintSheet(buildPrintOutput(items, pm, store.getGroups(), m), `${groupName || STR.common.untitled}　${printModeLabel(pm, m)}・${STR.common.itemCountLabel(items.length)}`);
  }
  function openMultiPrint(items: PrintItem[], pm: PrintMode, title: string): void {
    const m = store.getCurrentMode();
    if (items.length === 0) { alert(STR.common.noSelection); return; }
    if (pm === 'checklist') {
      openPrintSheet(buildChecklistHTML(title, items, lang), STR.common.checklistTitle(title || STR.common.untitled));
      return;
    }
    openPrintSheet(buildPrintOutput(items, pm, store.getGroups(), m), `${title || STR.common.untitled}　${printModeLabel(pm, m)}・${STR.common.itemCountLabel(items.length)}`);
  }

  // ---------- 選んで印刷(グループ横断のグローバル選択モード) ----------
  function enterPrintSelectMode(): void {
    // 折りたたまれたグループの中身が見えないとチェックできないので、全グループを強制展開
    const groups = store.getGroups();
    let changed = false;
    groups.forEach(g => { if (g.collapsed) { g.collapsed = false; changed = true; } });
    if (changed) store.setGroups(groups);
    printSelectedIds.current.clear();
    setPrintSelectCount(0);
    setPrintSelectActive(true);
    refresh();
  }
  function exitPrintSelectMode(): void {
    printSelectedIds.current.clear();
    setPrintSelectCount(0);
    setPrintSelectActive(false);
    refresh();
  }
  function togglePrintSelected(id: string, checked: boolean): void {
    if (checked) printSelectedIds.current.add(id); else printSelectedIds.current.delete(id);
    setPrintSelectCount(printSelectedIds.current.size);
  }

  // ---------- 操作モード(HTML) ----------
  function setHtmlInteractMode(on: boolean): void {
    const stage = stageRef.current, interactStage = interactStageRef.current, wrap = wrapRef.current;
    if (!stage || !interactStage) return;
    if (on === runtime.htmlInteractMode) { setInteractOn(on); return; }
    // frameは「切り替え前の現在地」から探す
    const frame = (runtime.htmlInteractMode
      ? interactStage.querySelector('.html-content-wrap')
      : stage.querySelector('.html-content-wrap')) as HTMLElement | null;
    runtime.htmlInteractMode = on;
    if (!frame) { setInteractOn(on); return; }
    frame.style.pointerEvents = 'auto';
    if (on) {
      frame.style.width = '';
      frame.style.height = '';
      interactStage.appendChild(frame);
      interactStage.style.display = 'block';
      stage.style.display = 'none';
    } else {
      frame.style.pointerEvents = 'none';
      const size = htmlFrameSize(wrap?.getBoundingClientRect().width ?? null);
      frame.style.width = size.width + 'px';
      frame.style.height = size.height + 'px';
      stage.appendChild(frame);
      interactStage.style.display = 'none';
      stage.style.display = 'block';
    }
    setInteractOn(on);
  }

  // ---------- タブ切り替え ----------
  function switchMode(m: Mode): void {
    const cur = store.getCurrentMode();
    if (m === cur) return;
    // 操作モード中は退避前に閲覧モードへ戻し、フレームを#stageへ戻しておく
    if (cur === 'html' && runtime.htmlInteractMode) setHtmlInteractMode(false);

    const stage = stageRef.current;
    if (!stage) return;
    const fromState = modeState[cur];
    fromState.name = runtime.currentName;
    fromState.htmlSource = runtime.currentHtmlSource;
    fromState.scale = runtime.scale; fromState.tx = runtime.tx; fromState.ty = runtime.ty;
    fromState.dirty = runtime.isDirty;
    fromState.node = stage.firstElementChild as HTMLElement | SVGSVGElement | null;
    if (fromState.node) stage.removeChild(fromState.node);

    store.setCurrentMode(m);
    store.setLastMode(m); // 次回起動時にこのタブから再開
    setMode(m);
    if (printSelectActive) exitPrintSelectMode();
    closeAll();

    const toState = modeState[m];
    stage.replaceChildren(); // FIX: white screen - replaceChildren safer than innerHTML in StrictMode
    if (toState.node) {
      stage.appendChild(toState.node);
      stage.style.display = 'block';
      setHasContent(true);
    } else {
      stage.style.display = 'none';
      setHasContent(false);
    }
    runtime.currentName = toState.name;
    runtime.currentHtmlSource = toState.htmlSource;
    runtime.isDirty = toState.dirty;
    runtime.scale = toState.scale; runtime.tx = toState.tx; runtime.ty = toState.ty;
    applyTransformTo(stage, { scale: runtime.scale, tx: runtime.tx, ty: runtime.ty });

    // HTMLへの切替時は毎回、安全な閲覧モードから始める
    if (m === 'html') setHtmlInteractMode(false);
    refresh();
  }

  function changeLanguage(l: LangKey): void {
    if (setLanguage(l)) { setLangState(l); refresh(); }
  }

  // ---------- 起動時の下書き自動復元 ----------
  function restoreDraftIntoState(m: Mode): void {
    const draft = getDraft(m);
    if (!draft || !draft.content) return;
    const st = modeState[m];
    st.name = draft.name;
    st.dirty = draft.dirty === true; // 古い下書き(記録無し)はfalse扱いで毎回の「保存しますか」を防ぐ
    const wrapW = wrapRef.current?.getBoundingClientRect().width ?? null;
    const node = buildViewerNode(draft.content, m, wrapW);
    if (!node) return;
    if (m === 'html') {
      st.htmlSource = draft.content;
      (node as HTMLElement).style.pointerEvents = 'none';
      st.node = node;
    } else {
      st.node = node;
    }
  }

  useEffect(() => {
    store.setQuotaErrorCallback(() => alert(STR.common.saveFailed));
    restoreDraftIntoState('svg');
    restoreDraftIntoState('html');
    const stage = stageRef.current;
    if (stage && modeState.svg.node) {
      stage.replaceChildren(); // FIX: white screen - replaceChildren safer than innerHTML in StrictMode
      stage.appendChild(modeState.svg.node);
      stage.style.display = 'block';
      setHasContent(true);
      runtime.currentName = modeState.svg.name;
      runtime.isDirty = modeState.svg.dirty;
      fitToView();
    }
    // 閉じる直前がHTMLタブだった場合はそちらに切り替えて開く
    if (store.getLastMode() === 'html' && modeState.html.node) switchMode('html');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // wheelズームはpassive付きReactイベントではpreventDefaultできないためネイティブで登録
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const h = (e: WheelEvent): void => {
      e.preventDefault();
      const t = wheelZoom({ scale: runtime.scale, tx: runtime.tx, ty: runtime.ty }, e, wrap);
      runtime.scale = t.scale; runtime.tx = t.tx; runtime.ty = t.ty;
      applyTransformTo(stageRef.current, t);
    };
    wrap.addEventListener('wheel', h, { passive: false });
    return () => wrap.removeEventListener('wheel', h);
  }, []);

  // ---------- ピンチ/パン ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastDist = useRef<number | null>(null);
  const lastTap = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx: runtime.tx, ty: runtime.ty };
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      lastDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const wrap = wrapRef.current;
    if (pointers.current.size === 1 && panStart.current) {
      runtime.tx = panStart.current.tx + (e.clientX - panStart.current.x);
      runtime.ty = panStart.current.ty + (e.clientY - panStart.current.y);
      applyTransformTo(stageRef.current, { scale: runtime.scale, tx: runtime.tx, ty: runtime.ty });
    } else if (pointers.current.size === 2 && wrap) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (lastDist.current) {
        const t = pinchZoom({ scale: runtime.scale, tx: runtime.tx, ty: runtime.ty }, lastDist.current, dist, mid, wrap);
        runtime.scale = t.scale; runtime.tx = t.tx; runtime.ty = t.ty;
        applyTransformTo(stageRef.current, t);
      }
      lastDist.current = dist;
    }
  }
  function endPointer(e: React.PointerEvent<HTMLDivElement>): void {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastDist.current = null;
    if (pointers.current.size === 0) panStart.current = null;
    if (e.type === 'pointerup') {
      const now = Date.now();
      if (now - lastTap.current < 280 && pointers.current.size === 0) fitToView(); // ダブルタップで全体表示
      lastTap.current = now;
    }
  }

  // ---------- ファイル/バックアップ入力 ----------
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadFresh(String(reader.result), file.name);
    reader.readAsText(file);
    e.target.value = '';
  }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) {
      importBackup(file, {
        confirm: () => confirm(STR.common.backupImportConfirm),
        onDone: () => { refresh(); alert(STR.common.backupImportSuccess); },
        onError: () => alert(STR.common.backupParseError),
      });
    }
    e.target.value = '';
  }
  function onMergeFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) {
      mergeBackup(file, {
        onDone: (r) => { refresh(); showMergeResult(r.added, r.updated); },
        onError: () => alert(STR.common.backupParseError),
      });
    }
    e.target.value = '';
  }

  const M = STR.mode(mode);

  const ctx: ZouContextValue = {
    mode, lang, t: LANGUAGES[lang], currentName: runtime.currentName,
    hasContent, printSelectActive, printSelectCount, printSelectedIds: printSelectedIds.current,
    switchMode, changeLanguage, loadFresh, loadFromItem, loadContentFromString, markDirty,
    currentContentString: () => currentContentString(),
    saveCurrent, downloadCurrentFile, openCodeSheet, openPrintSheet,
    openMultiPrint, openGroupPrint,
    openSinglePrint: (name, code, pm, meta) => openSinglePrint(name, code, pm, meta),
    refresh,
    exportBackup: () => { void exportBackup(); },
    openImportBackup: () => importFileRef.current?.click(),
    openMergeBackup: () => mergeFileRef.current?.click(),
    restorePreImportSnapshot: () => restorePreImportSnapshotLib({
      confirm: () => confirm(STR.common.backupRestoreSnapshotConfirm),
      onDone: () => { refresh(); alert(STR.common.backupImportSuccess); },
      onNoSnapshot: () => alert(STR.common.backupNoSnapshot),
    }),
    enterPrintSelectMode, exitPrintSelectMode, togglePrintSelected,
  };

  return (
    <ZouContext.Provider value={ctx}>
      <div id="app" ref={appRef}>
        <div id="modeTabs">
          <button className={`mode-tab${mode === 'svg' ? ' active' : ''}`} id="tabSvg" data-mode="svg" onClick={() => switchMode('svg')}>{STR.common.tabSvg}</button>
          <button className={`mode-tab${mode === 'html' ? ' active' : ''}`} id="tabHtml" data-mode="html" onClick={() => switchMode('html')}>{STR.common.tabHtml}</button>
          <select id="langSelect" title="Language" value={lang} onChange={e => changeLanguage(e.target.value as LangKey)}>
            {(Object.keys(LANGUAGES) as LangKey[]).map(k => (
              <option key={k} value={k}>{k.toUpperCase()}</option>
            ))}
          </select>
        </div>

        <div id="topbar">
          <h1 id="appTitle">{M.appTitle}</h1>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0 }}>
            <button id="codeBtn" className="topbtn" onClick={() => openCodeSheet()}>{STR.common.codeBtn}</button>
            {mode === 'html' && (
              <button id="btnHtmlInteract" className={`topbtn${interactOn ? ' active' : ''}`} onClick={() => setHtmlInteractMode(!interactOn)}>
                {STR.common.htmlModeInteractLabel}
              </button>
            )}
            <div className="pillgroup">
              <button id="listBtn" onClick={() => openOne('list')}><span>{M.listBtn}</span></button>
              <button id="btnSave" onClick={() => { if (saveCurrent()) alert(STR.common.saveSuccess); }}>{STR.common.btnSaveLabel}</button>
            </div>
          </div>
        </div>

        <div
          id="viewerWrap"
          ref={wrapRef}
          className={`bg-${bg}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onContextMenu={(ev) => {
            if (!hasStageContent()) return;
            ev.preventDefault();
            const m = store.getCurrentMode();
            showContextMenu(ev.clientX, ev.clientY, [
              { label: STR.mode(m).registerMenu, onClick: () => { if (saveCurrent()) alert(STR.common.saveSuccess); } },
              { label: STR.mode(m).downloadMenu, onClick: () => downloadCurrentFile() },
              { label: STR.common.itemMenuPrint, submenu: printSubmenuOptions(m).map(pm => ({
                  label: pm.label,
                  onClick: () => {
                    const content = currentContentString();
                    if (!content) { alert(STR.mode(m).noStageContent); return; }
                    openSinglePrint(runtime.currentName, content, pm.value);
                  },
                })) },
            ]);
          }}
        >
          <div id="empty" style={{ display: hasContent ? 'none' : 'flex' }}>
            <div className="big">{M.emptyBig}</div>
            <div>{STR.common.emptySub}</div>
          </div>
          <div id="stage" ref={stageRef} style={{ display: hasContent ? 'block' : 'none' }} />
          <div id="interactStage" ref={interactStageRef} style={{ display: 'none' }} />
        </div>

        <button id="exitFocusBtn" onClick={() => setFocusModeOn(false)}>{STR.common.exitFocusBtn}</button>

        <div id="bottombar">
          <div className="row">
            <button className="btn" id="btnClipboard" onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                guarded(() => {
                  if (loadIntoStage(text, STR.common.fromClipboardName)) {
                    runtime.isDirty = true;
                    store.setDraftDirty(store.getCurrentMode(), true);
                    runtime.currentSourceItemId = null;
                    refresh();
                  }
                });
              } catch {
                alert(STR.common.clipboardReadFailed);
              }
            }}>{STR.common.btnClipboard}</button>
            <button className="btn" id="btnPaste" onClick={() => openOne('paste')}>{STR.common.btnPaste}</button>
            <button className="btn" id="btnFile" onClick={() => fileInputRef.current?.click()}>{STR.common.btnFile}</button>
          </div>
          <div className="row compact-row">
            <div className="bgtoggle">
              <button data-bg="checker" id="bgBtnChecker" className={bg === 'checker' ? 'active' : ''} onClick={() => setBg('checker')}>{STR.common.bgChecker}</button>
              <button data-bg="white" id="bgBtnWhite" className={bg === 'white' ? 'active' : ''} onClick={() => setBg('white')}>{STR.common.bgWhite}</button>
              <button data-bg="black" id="bgBtnBlack" className={bg === 'black' ? 'active' : ''} onClick={() => setBg('black')}>{STR.common.bgBlack}</button>
            </div>
            {wake.supported && (
              <button className={`btn${wake.active ? ' active' : ''}`} id="btnWake" title={STR.common.btnWake} onClick={() => { void wake.toggle(); }}>{STR.common.btnWake}</button>
            )}
            <button className="btn" id="btnFocus" onClick={() => setFocusModeOn(true)}>{STR.common.btnFocus}</button>
            <button className="btn accent" id="btnDownloadFile" title={M.downloadMenu} onClick={() => downloadCurrentFile()}>{M.downloadMenu}</button>
          </div>
        </div>
      </div>

      <input type="file" id="fileInput" ref={fileInputRef} accept={M.fileAccept} multiple style={{ display: 'none' }} onChange={onFileChange} />
      <input type="file" ref={importFileRef} accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
      <input type="file" ref={mergeFileRef} accept="application/json,.json" style={{ display: 'none' }} onChange={onMergeFile} />

      <PasteSheet open={openSheet === 'paste'} onClose={closeAll} />
      <SavedList open={openSheet === 'list'} onClose={closeAll} />
      <CodeEditor open={openSheet === 'code'} onClose={closeAll} />
      {/* 印刷シートを閉じる時は選んで印刷モードも必ずリセット(旧closePrintSheetの保険) */}
      <PrintSheet open={openSheet === 'print'} onClose={() => { closeAll(); if (printSelectActive) exitPrintSelectMode(); }} html={printHtml} title={printTitle} />
    </ZouContext.Provider>
  );
}
