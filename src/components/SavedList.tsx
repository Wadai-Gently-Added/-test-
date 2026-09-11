// マイSVG/マイHTML一覧シート。旧js/list.js の描画・グループ管理・ドラッグ並べ替え・
// 右クリック(長押し)メニューをほぼ1:1で移植し、シートの開閉だけstate化したもの。
import { useEffect, useRef } from 'react';
import type { SavedItem, Group, TopOrderEntry, SortCriteria, CtxOption } from '../types/zou';
import { STR } from '../lib/i18n';
import {
  getSaved, setSaved, getGroups, setGroups, getTopOrder, setTopOrder,
  reconcileTopOrder, pruneEmptyGroups, getCurrentMode,
} from '../lib/storage';
import { normalizeThumbSvg } from '../lib/svgUtils';
import { fmtDateShort } from '../lib/date';
import { printSubmenuOptions } from '../lib/print';
import {
  sortGroupItems, sortGroupsOrder, sortUngroupedOrder,
  sortCriteriaSubmenuLabels, snapshotBeforeSort, restorePreSortSnapshot,
} from '../lib/sort';
import { closeContextMenu, showContextMenu, pickGroupColor } from './modals';
import { useZou } from '../state/ZouContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 直前に登録した「メニュー外クリックで閉じる」はmodals.tsxのcloseContextMenuが管理
let suppressClickUntil = 0;

export default function SavedList({ open, onClose }: Props): JSX.Element | null {
  const zou = useZou();
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchValueRef = useRef('');
  const mode = zou.mode;
  const lang = zou.lang;

  useEffect(() => {
    if (open) closeContextMenu();
  }, [open]);

  if (!open) return null;
  const S = zou.t;
  const M = S[zou.mode];

  function renderListInto(container: HTMLDivElement): void {
    pruneEmptyGroups();
    const items = getSaved();
    const groups = getGroups();
    container.innerHTML = '';
    const emptyEl = document.getElementById('savedEmpty');
    if (!emptyEl) return;

    // 全体件数と未グループの件数を検索欄の下に出す
    const summaryEl = document.getElementById('listCountSummary');
    if (summaryEl) {
      const ungroupedCount = items.filter(it => !it.group).length;
      summaryEl.textContent = STR.common.listCountSummary(items.length, ungroupedCount);
    }

    if (items.length === 0) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    const searchTerm = searchValueRef.current.trim().toLowerCase();
    if (searchTerm) {
      const matched = items.filter(it => (it.name || '').toLowerCase().includes(searchTerm));
      if (matched.length === 0) {
        const msg = document.createElement('div');
        msg.style.cssText = 'padding:24px 10px; text-align:center; color:var(--sub); font-size:13px;';
        msg.textContent = STR.common.searchListNoResult;
        container.appendChild(msg);
        return;
      }
      matched.forEach(item => {
        const idx = items.findIndex(it => it.id === item.id);
        const block = document.createElement('div');
        block.className = 'toplevel-block item-block';
        block.appendChild(buildItemRow(item, idx, groups, true));
        container.appendChild(block);
      });
      return; // 検索中はグループ構造やドラッグ並べ替えは表示しない
    }

    const order = reconcileTopOrder(items, groups);
    // 表示順のルール: 1.グループは常に未グループより上 2.未グループ同士はピン留めを先頭
    const pinnedLookup = new Map(items.map(it => [it.id, !!it.pinned]));
    order.sort((a, b) => {
      const aIsGroup = a.type === 'group' ? 1 : 0;
      const bIsGroup = b.type === 'group' ? 1 : 0;
      if (aIsGroup !== bIsGroup) return bIsGroup - aIsGroup;
      const aPinned = a.type === 'item' && pinnedLookup.get(a.id) ? 1 : 0;
      const bPinned = b.type === 'item' && pinnedLookup.get(b.id) ? 1 : 0;
      return bPinned - aPinned;
    });

    order.forEach(entry => {
      if (entry.type === 'group') {
        const g = groups.find(x => x.id === entry.id);
        if (!g) return;

        const block = document.createElement('div');
        block.className = 'toplevel-block group-block';
        block.dataset.entryType = 'group';
        block.dataset.entryId = g.id;
        block.style.borderLeftColor = g.color;
        block.style.background = g.color + '14';

        const header = document.createElement('div');
        header.className = 'group-header';
        header.dataset.groupId = g.id;
        header.innerHTML = `
          <span class="group-handle" title="${STR.common.dragHandleTitleGroup}">⠿</span>
          <button class="group-toggle">${g.collapsed ? '▶' : '▼'}</button>
          <span class="group-name"></span>
        `;
        block.appendChild(header);

        header.querySelector('.group-toggle')!.addEventListener('click', () => {
          g.collapsed = !g.collapsed;
          setGroups(groups);
          zou.refresh();
        });
        header.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          suppressClickUntil = Date.now() + 500;
          const opts: CtxOption[] = [
            { label: STR.common.itemMenuRename, onClick: () => {
              const newName = prompt(STR.common.groupRenamePrompt, g.name);
              if (newName && newName.trim()) { g.name = newName.trim(); setGroups(groups); zou.refresh(); }
            }},
            { label: STR.common.groupMenuColor, onClick: () => {
              pickGroupColor(color => { g.color = color; setGroups(groups); zou.refresh(); });
            }},
            { label: STR.common.sortGroupContentsMenu, submenu: buildSortSubmenu(criteria => sortGroupItems(g.id, criteria, zou.mode)) },
            { label: STR.common.sortUndoMenu, onClick: () => restorePreSortSnapshot(getCurrentMode(), () => alert(STR.common.sortNoSnapshot)) },
              { label: STR.common.itemMenuPrint, submenu: printSubmenuOptions(zou.mode).map(pm => ({
                label: pm.label,
                onClick: () => zou.openGroupPrint(g.id, g.name, pm.value),
              })) },
            { label: STR.common.groupMenuSelectPrint, onClick: () => zou.enterPrintSelectMode() },
            { label: STR.common.groupMenuDelete, onClick: () => {
              if (!confirm(STR.common.groupDeleteConfirm(g.name, STR.mode(zou.mode).groupItemsNoun))) return;
              const cur = getSaved();
              cur.forEach(it => { if (it.group === g.id) it.group = null; });
              setSaved(cur);
              setGroups(groups.filter(x => x.id !== g.id));
              zou.refresh();
            }},
          ];
          showContextMenu(ev.clientX, ev.clientY, opts, header);
        });
        header.addEventListener('pointerenter', () => {
          if (document.body.classList.contains('suppress-hover')) return;
          // 古い行の.hoveredが残って二重ハイライトになるのを防ぐため、
          // 付ける前に画面中の.hoveredを一度全部剥がしてから自分だけ付ける
          document.querySelectorAll('.hovered').forEach(n => n.classList.remove('hovered'));
          header.classList.add('hovered');
        });
        header.addEventListener('pointerleave', () => header.classList.remove('hovered'));

        const body = document.createElement('div');
        body.className = 'group-body';
        body.dataset.group = g.id;
        if (g.collapsed) body.style.display = 'none';
        block.appendChild(body);

        let groupItemCount = 0;
        try {
          const itemsWithIdx = items
            .map((item, i) => ({ item, i }))
            .filter(o => (o.item.group || null) === g.id)
            .sort((a, b) => ((b.item.pinned ? 1 : 0) - (a.item.pinned ? 1 : 0)));
          groupItemCount = itemsWithIdx.length;
          itemsWithIdx.forEach(({ item, i }) => { body.appendChild(buildItemRow(item, i, groups, false)); });
        } catch (err) {
          console.error('group item render failed', err);
        }
        (header.querySelector('.group-name') as HTMLElement).textContent = `${g.name} (${groupItemCount})`;

        attachTopLevelDrag(block, container);
        container.appendChild(block);
      } else {
        const idx = items.findIndex(it => it.id === entry.id);
        if (idx === -1) return;
        const item = items[idx];
        const block = document.createElement('div');
        block.className = 'toplevel-block item-block';
        block.dataset.entryType = 'item';
        block.dataset.entryId = item.id;
        block.appendChild(buildItemRow(item, idx, groups, true));
        attachTopLevelDrag(block, container);
        container.appendChild(block);
      }
    });
  }

  function buildSortSubmenu(onPick: (c: SortCriteria) => void): CtxOption[] {
    const labels = sortCriteriaSubmenuLabels();
    return labels.map(l => ({ label: l.label, onClick: () => onPick(l.value) }));
  }

  // 注: ピン留め中のアイテムもhandleからドラッグしてグループ移動できる
  // (並べ替え順はピンが常に先頭に来るよう毎回ソートされるので位置は動かないが、グループ間の移動は反映される)
  function buildItemRow(item: SavedItem, i: number, groups: Group[], isTopLevel: boolean): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'saved-item' + (item.pinned ? ' pinned' : '') + (item.locked ? ' locked' : '');
    row.dataset.origIdx = String(i);
    row.dataset.itemId = item.id;
    row.dataset.group = item.group || '';
    const d = new Date(item.savedAt);
    const inSelectMode = zou.printSelectActive;
    const handleHtml = inSelectMode
      ? `<input type="checkbox" class="print-select-box" id="printSelect-${item.id}" name="printSelect-${item.id}" ${zou.printSelectedIds.has(item.id) ? 'checked' : ''}>`
      : `<span class="handle" title="${STR.common.dragHandleTitle}">⠿</span>`;
    const options = [`<option value="">${STR.common.noGroupOption}</option>`]
      .concat(groups.map(g => `<option value="${g.id}" ${item.group === g.id ? 'selected' : ''}>${g.name}</option>`));
    const thumbHtml = zou.mode === 'html' ? '<span style="font-size:20px;">📄</span>' : normalizeThumbSvg(item.content);
    const lockBadge = item.locked ? `<span class="lock-badge" title="${STR.common.itemLockedTitle}">🔒</span>` : '';
    row.innerHTML = `
      ${handleHtml}
      <div class="thumb">${thumbHtml}${lockBadge}</div>
      <div class="meta">
        <div class="name">${item.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
        <div class="date">${fmtDateShort(d, lang)}</div>
      </div>
      <select class="group-select" id="groupSelect-${item.id}" name="groupSelect-${item.id}">${options.join('')}</select>
      <button class="pin" title="${STR.common.pinTitle}">${item.pinned ? '📌' : '📍'}</button>
    `;
    if (inSelectMode) {
      const box = row.querySelector('.print-select-box') as HTMLInputElement;
      box.addEventListener('click', ev => ev.stopPropagation());
      box.addEventListener('change', () => {
        zou.togglePrintSelected(item.id, box.checked);
      });
    } else {
      // ドラッグ用ハンドルのクリックは行全体の読込に伝播させない
      row.querySelector('.handle')!.addEventListener('click', ev => ev.stopPropagation());
    }
    // Edgeのタブのように行全体のどこをクリックしても読み込まれる
    row.addEventListener('click', () => {
      if (Date.now() < suppressClickUntil) return;
      if (inSelectMode) {
        const box = row.querySelector('.print-select-box') as HTMLInputElement;
        box.checked = !box.checked;
        zou.togglePrintSelected(item.id, box.checked);
        return;
      }
      zou.loadFromItem(item);
    });
    const groupSelect = row.querySelector('.group-select') as HTMLSelectElement;
    groupSelect.addEventListener('click', ev => ev.stopPropagation());
    groupSelect.addEventListener('change', ev => {
      const cur = getSaved();
      const it = cur.find(x => x.id === item.id);
      if (it) it.group = (ev.target as HTMLSelectElement).value || null;
      setSaved(cur);
      zou.refresh();
    });
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      suppressClickUntil = Date.now() + 500;
      const allGroups = getGroups();
      const opts: CtxOption[] = [];
      opts.push({ label: STR.common.itemMenuRename, onClick: () => {
        if (item.locked) { alert(STR.common.lockedEditBlocked); return; }
        const newName = prompt(STR.common.itemRenamePrompt, item.name);
        if (newName === null || !newName.trim()) return;
        const cur = getSaved();
        const it = cur.find(x => x.id === item.id);
        if (it) { it.name = newName.trim(); it.modifiedAt = new Date().toISOString(); }
        setSaved(cur);
        zou.refresh();
      }});
      opts.push({ label: STR.common.itemMenuDuplicate, onClick: () => {
        // Edgeのタブ複製のように、同じグループ内にそのままコピーを1件追加
        const cur = getSaved();
        const copy: SavedItem = {
          id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
          name: item.name + STR.common.itemDuplicateSuffix,
          content: item.content,
          savedAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          pinned: false,
          group: item.group || null,
        };
        const idx = cur.findIndex(x => x.id === item.id);
        cur.splice(idx + 1, 0, copy);
        setSaved(cur);
        const order = getTopOrder();
        if (!copy.group) {
          const pos = order.findIndex(e => e.type === 'item' && e.id === item.id);
          if (pos !== -1) { order.splice(pos + 1, 0, { type: 'item', id: copy.id }); setTopOrder(order); }
        }
        zou.refresh();
      }});
      opts.push({ label: STR.common.itemMenuPrint, submenu: printSubmenuOptions(zou.mode).map(pm => ({
        label: pm.label,
        onClick: () => zou.openSinglePrint(item.name, item.content, pm.value, { savedAt: item.savedAt, modifiedAt: item.modifiedAt }),
      })) });
      opts.push({ label: STR.common.groupMenuSelectPrint, onClick: () => zou.enterPrintSelectMode() });
      opts.push({ label: STR.common.itemMenuNewGroup, onClick: () => {
        const name = prompt(STR.common.groupNamePrompt, STR.common.newGroupDefaultName);
        if (!name || !name.trim()) return;
        pickGroupColor(color => {
          const gs = getGroups();
          const newGroup = { id: 'g' + Date.now(), name: name.trim(), color, collapsed: false };
          gs.push(newGroup);
          setGroups(gs);
          const cur = getSaved();
          const it = cur.find(x => x.id === item.id);
          if (it) it.group = newGroup.id;
          setSaved(cur);
          zou.refresh();
        });
      }});
      allGroups.forEach(g => {
        if ((item.group || null) !== g.id) {
          opts.push({ label: STR.common.itemMenuMoveToGroup(g.name), onClick: () => {
            const cur = getSaved(); const it = cur.find(x => x.id === item.id);
            if (it) it.group = g.id; setSaved(cur); zou.refresh();
          }});
        }
      });
      if (item.group) {
        opts.push({ label: STR.common.itemMenuUngroup, onClick: () => {
          const cur = getSaved(); const it = cur.find(x => x.id === item.id);
          if (it) it.group = null; setSaved(cur); zou.refresh();
        }});
      }
      opts.push({ label: STR.common.itemMenuDelete, onClick: () => {
        if (item.locked) { alert(STR.common.lockedEditBlocked); return; }
        if (!confirm(STR.common.itemDeleteConfirm(item.name))) return;
        const cur = getSaved().filter(x => x.id !== item.id);
        setSaved(cur);
        zou.refresh();
      }});
      // 🔗同期で取り込まれたアイテムは自動でロック。解除は必ずこのメニューから明示的に行う
      opts.push({ label: item.locked ? STR.common.itemMenuUnlock : STR.common.itemMenuLock, onClick: () => {
        const cur = getSaved();
        const it = cur.find(x => x.id === item.id);
        if (it) it.locked = !it.locked;
        setSaved(cur);
        zou.refresh();
      }});
      // 未グループのアイテムは「帯」が無く並び替えの入り口が無いため、個別メニューからも同じ操作に辿り着けるように
      if (!item.group) {
        opts.push({ label: STR.common.sortUngroupedMenu, submenu: buildSortSubmenu(c => { sortUngroupedOrder(c, zou.mode); zou.refresh(); }) });
        opts.push({ label: STR.common.sortUndoMenu, onClick: () => restorePreSortSnapshot(getCurrentMode(), () => alert(STR.common.sortNoSnapshot)) });
      }
      showContextMenu(ev.clientX, ev.clientY, opts, row);
    });
    (row.querySelector('.pin') as HTMLElement).addEventListener('click', ev => {
      ev.stopPropagation();
      const cur = getSaved();
      const it = cur.find(x => x.id === item.id);
      if (it) it.pinned = !it.pinned;
      setSaved(cur);
      zou.refresh();
    });
    // JS管理のホバー(sticky :hover 対策)。古い行の.hoveredが残って
    // 二重ハイライトになるのを防ぐため、付ける前に画面中の.hoveredを一度全部剥がす
    row.addEventListener('pointerenter', () => {
      if (document.body.classList.contains('suppress-hover')) return;
      document.querySelectorAll('.hovered').forEach(n => n.classList.remove('hovered'));
      row.classList.add('hovered');
    });
    row.addEventListener('pointerleave', () => row.classList.remove('hovered'));
    if (!isTopLevel && !inSelectMode) attachDrag(row);
    return row;
  }

  function commitOrder(container: HTMLElement): void {
    const rows = Array.from(container.children);
    const arr = getSaved();
    const groupId = (container.dataset.group as string | undefined) || null;
    const byId: Record<string, SavedItem> = {};
    arr.forEach(it => { byId[it.id] = it; });
    const thisGroupNew = rows.map(r => byId[(r as HTMLElement).dataset.itemId as string]).filter(Boolean);
    const others = arr.filter(it => (it.group || null) !== groupId);
    setSaved([...others, ...thisGroupNew]);
    zou.refresh();
  }

  function attachTopLevelDrag(block: HTMLDivElement, listEl: HTMLElement): void {
    const handle = block.querySelector('.group-handle') || block.querySelector('.handle');
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      pe.preventDefault();
      let startY = pe.clientY;
      block.classList.add('dragging-block');
      block.style.zIndex = '6';
      const isGroupBlock = block.classList.contains('group-block');
      let hoverGroupBlock: HTMLElement | null = null;

      const onMove = (ev: PointerEvent): void => {
        const dy = ev.clientY - startY;
        block.style.transform = `translateY(${dy}px)`;
        if (!isGroupBlock) {
          const groupBlocks = Array.from(listEl.querySelectorAll('.group-block')) as HTMLElement[];
          let matched: HTMLElement | null = null;
          for (const gb of groupBlocks) {
            const r = gb.getBoundingClientRect();
            if (ev.clientY >= r.top && ev.clientY <= r.bottom) { matched = gb; break; }
          }
          if (hoverGroupBlock && hoverGroupBlock !== matched) hoverGroupBlock.classList.remove('drop-target');
          if (matched) matched.classList.add('drop-target');
          hoverGroupBlock = matched;
          if (hoverGroupBlock) return;
        }
        const blocks = Array.from(listEl.children).filter(el => el.classList.contains('toplevel-block')) as HTMLElement[];
        const idx = blocks.indexOf(block);
        const rect = block.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        for (let k = 0; k < blocks.length; k++) {
          if (blocks[k] === block) continue;
          const r2 = blocks[k].getBoundingClientRect();
          const otherCenter = r2.top + r2.height / 2;
          if (k < idx && centerY < otherCenter) {
            listEl.insertBefore(block, blocks[k]);
            startY = ev.clientY; block.style.transform = 'translateY(0px)'; break;
          }
          if (k > idx && centerY > otherCenter) {
            listEl.insertBefore(block, blocks[k].nextSibling);
            startY = ev.clientY; block.style.transform = 'translateY(0px)'; break;
          }
        }
      };
      const onUp = (): void => {
        block.classList.remove('dragging-block');
        block.style.transform = '';
        block.style.zIndex = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (hoverGroupBlock) {
          hoverGroupBlock.classList.remove('drop-target');
          const targetGroupId = hoverGroupBlock.dataset.entryId;
          const itemId = block.dataset.entryId;
          const cur = getSaved();
          const it = cur.find(x => x.id === itemId);
          if (it && targetGroupId) { it.group = targetGroupId; setSaved(cur); }
          zou.refresh();
          return;
        }
        const blocks = Array.from(listEl.children).filter(el => el.classList.contains('toplevel-block')) as HTMLElement[];
        const newOrder: TopOrderEntry[] = blocks.map(b => ({
          type: b.dataset.entryType as 'group' | 'item',
          id: b.dataset.entryId as string,
        }));
        setTopOrder(newOrder);
        zou.refresh();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function attachDrag(row: HTMLDivElement): void {
    const handle = row.querySelector('.handle');
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      pe.preventDefault();
      const container = row.parentElement as HTMLElement;
      const ownBlock = container.parentElement as HTMLElement; // .group-block
      const ownGroupId = (container.dataset.group as string | undefined) || null;
      const listEl = document.getElementById('savedList') as HTMLElement;
      let startY = pe.clientY;
      let lastY = pe.clientY;
      row.classList.add('dragging');
      row.style.zIndex = '6';
      let hoverTarget: HTMLElement | null = null;

      const onMove = (ev: PointerEvent): void => {
        lastY = ev.clientY;
        const dy = ev.clientY - startY;
        row.style.transform = `translateY(${dy}px)`;
        // 別のグループの上まで来てたらそこにドロップできる状態にする
        const blocks = Array.from(listEl.querySelectorAll('.group-block')) as HTMLElement[];
        let matched: HTMLElement | null = null;
        for (const b of blocks) {
          if (b.dataset.entryId === ownGroupId) continue;
          const r = b.getBoundingClientRect();
          if (ev.clientY >= r.top && ev.clientY <= r.bottom) { matched = b; break; }
        }
        if (hoverTarget && hoverTarget !== matched) hoverTarget.classList.remove('drop-target');
        if (matched) matched.classList.add('drop-target');
        hoverTarget = matched;
        if (hoverTarget) return;
        const rows = Array.from(container.children);
        const idx = rows.indexOf(row);
        const rowRect = row.getBoundingClientRect();
        const centerY = rowRect.top + rowRect.height / 2;
        for (let k = 0; k < rows.length; k++) {
          if (rows[k] === row) continue;
          if (rows[k].classList.contains('pinned')) continue;
          const r2 = rows[k].getBoundingClientRect();
          const otherCenter = r2.top + r2.height / 2;
          if (k < idx && centerY < otherCenter) {
            container.insertBefore(row, rows[k]);
            startY = ev.clientY; row.style.transform = 'translateY(0px)'; break;
          }
          if (k > idx && centerY > otherCenter) {
            container.insertBefore(row, rows[k].nextSibling);
            startY = ev.clientY; row.style.transform = 'translateY(0px)'; break;
          }
        }
      };
      const onUp = (): void => {
        row.classList.remove('dragging');
        row.style.transform = '';
        row.style.zIndex = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (hoverTarget) {
          hoverTarget.classList.remove('drop-target');
          const groupId = (hoverTarget.dataset.entryId as string | undefined) || null;
          const cur = getSaved();
          const it = cur.find(x => x.id === row.dataset.itemId);
          if (it) it.group = groupId;
          setSaved(cur);
          zou.refresh();
          return;
        }
        // 自分のグループブロックの外まで持ち出したらグループ解除
        const ownRect = ownBlock.getBoundingClientRect();
        if (lastY < ownRect.top - 4 || lastY > ownRect.bottom + 4) {
          const cur = getSaved();
          const it = cur.find(x => x.id === row.dataset.itemId);
          if (it) it.group = null;
          setSaved(cur);
          zou.refresh();
          return;
        }
        commitOrder(container);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  return (
    <>
      <div className={`sheet-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' open' : ''}`} id="listSheet" style={{ maxHeight: '70vh' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span>{M.listSheetTitle}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button id="btnBackup" className="topbtn" style={{ padding: '4px 10px' }} onClick={(ev) => {
              if (document.getElementById('ctxMenu')) { closeContextMenu(); return; }
              const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              showContextMenu(rect.left, rect.bottom + 4, [
                { label: STR.common.backupExportMenu, onClick: () => zou.exportBackup() },
                { label: STR.common.backupSyncMenu, onClick: () => zou.openMergeBackup() },
                { label: STR.common.backupImportMenu, onClick: () => zou.openImportBackup() },
                { label: STR.common.backupRestoreMenu, onClick: () => zou.restorePreImportSnapshot() },
              ]);
            }}>🗄️</button>
            <button id="btnSortMenu" className="topbtn" style={{ padding: '4px 10px' }} onClick={(ev) => {
              if (document.getElementById('ctxMenu')) { closeContextMenu(); return; }
              const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              showContextMenu(rect.left, rect.bottom + 4, [
                { label: STR.common.sortGroupsMenu, submenu: buildSortSubmenu(c => { sortGroupsOrder(c, zou.mode); zou.refresh(); }) },
                { label: STR.common.sortUngroupedMenu, submenu: buildSortSubmenu(c => { sortUngroupedOrder(c, zou.mode); zou.refresh(); }) },
                { label: STR.common.sortUndoMenu, onClick: () => restorePreSortSnapshot(getCurrentMode(), () => alert(STR.common.sortNoSnapshot)) },
              ]);
            }}>🔀</button>
            <button id="btnNewGroup" className="topbtn" style={{ padding: '4px 10px' }} onClick={() => {
              const name = prompt(STR.common.groupNamePrompt, STR.common.newGroupDefaultName);
              if (!name || !name.trim()) return;
              pickGroupColor(color => {
                const gs = getGroups();
                gs.push({ id: 'g' + Date.now(), name: name.trim(), color, collapsed: false });
                setGroups(gs);
                zou.refresh();
              });
            }}>{STR.common.btnNewGroup}</button>
            <button id="btnStartSelectPrint" className={`topbtn${zou.printSelectActive ? ' active' : ''}`} style={{ padding: '4px 10px' }} onClick={() => {
              if (zou.printSelectActive) zou.exitPrintSelectMode();
              else zou.enterPrintSelectMode();
            }}>{zou.printSelectActive ? STR.common.btnStopSelectPrint : STR.common.btnStartSelectPrint}</button>
          </span>
        </h2>
        <div id="listSearchRow" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            id="listSearchInput"
            ref={searchRef}
            placeholder={STR.common.listSearchPlaceholder}
            onInput={() => {
              searchValueRef.current = searchRef.current?.value ?? '';
              if (listRef.current) renderListInto(listRef.current);
            }}
          />
        </div>
        <div id="listCountSummary" style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 6 }} />
        <div id="savedList" ref={(el) => {
          listRef.current = el;
          if (el) renderListInto(el);
        }} style={{ overflowY: 'auto', overflowX: 'hidden' }} />
        <div id="savedEmpty" style={{ display: 'none' }}>{M.savedEmpty}</div>
        <div id="printSelectBar" style={{ display: zou.printSelectActive ? 'flex' : 'none' }}>
          <span id="printSelectCount">{STR.common.printSelectCount(zou.printSelectCount)}</span>
          <button id="btnPrintSelectGo" className="btn accent" style={{ flex: '0 0 auto', padding: '6px 12px' }} onClick={(ev) => {
            try {
              if (zou.printSelectedIds.size === 0) { alert(STR.common.noSelection); return; }
              const byId: Record<string, SavedItem> = {};
              getSaved().forEach(it => { byId[it.id] = it; });
              // printSelectedIdsはSetなので挿入順=チェックした順を保っている。印刷順もチェックした順にする
              const items = Array.from(zou.printSelectedIds).map(id => byId[id]).filter(Boolean) as SavedItem[];
              const btnEl = ev.currentTarget as HTMLElement;
              closeContextMenu();
              const r = btnEl.getBoundingClientRect();
              showContextMenu(r.left, r.top - 8, printSubmenuOptions(zou.mode).map(pm => ({
                label: pm.label,
                onClick: () => {
                  zou.exitPrintSelectMode();
                  onClose();
                  zou.openMultiPrint(items, pm.value, STR.common.selectedItemsTitle);
                },
              })));
            } catch (err) {
              alert(STR.common.printMenuError(err && (err as Error).message ? (err as Error).message : String(err)));
              console.error('btnPrintSelectGo error', err);
            }
          }}>{STR.common.btnPrintSelectGo}</button>
          <button id="btnPrintSelectCancel" className="btn" style={{ flex: '0 0 auto', padding: '6px 12px' }} onClick={() => zou.exitPrintSelectMode()}>{STR.common.cancel}</button>
        </div>
        <div className="sheet-close" id="listCancel" onClick={onClose}>{STR.common.sheetClose}</div>
      </div>
    </>
  );
}
