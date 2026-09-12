// 右クリック(長押し)メニュー、色選択、各種モーダル(旧js/list.js の命令的UI部分を移植)。
// Reactの外にportal的なDOMとして描く(元実装と同じ挙動を1:1で保つため)。
import type { CtxOption } from '../types/zou';
import { STR } from '../lib/i18n';
import { GROUP_COLORS } from '../lib/constants';

let ctxOutsideClickHandler: ((e: MouseEvent) => void) | null = null;
let ctxTriggerEl: HTMLElement | null = null;

export function closeContextMenu(): void {
  const el = document.getElementById('ctxMenu');
  if (el) el.remove();
  document.querySelectorAll('.ctx-submenu').forEach(el2 => el2.remove());
  if (ctxOutsideClickHandler) {
    document.removeEventListener('click', ctxOutsideClickHandler);
    ctxOutsideClickHandler = null;
  }
  if (ctxTriggerEl) { ctxTriggerEl.classList.remove('ctx-active'); ctxTriggerEl = null; }
  // 右クリック後の sticky :hover / 二重ハイライトを防ぐため、
  // すべての .hovered を一旦消し、次の pointermove まで新規付与を抑止する
  document.querySelectorAll('.hovered').forEach(n => n.classList.remove('hovered'));
  document.body.classList.add('suppress-hover');
  const clearSuppress = () => {
    document.body.classList.remove('suppress-hover');
    document.removeEventListener('pointermove', clearSuppress);
  };
  document.addEventListener('pointermove', clearSuppress, { once: true });
}

function positionFlyout(el: HTMLElement, anchorRect: DOMRect): void {
  const fw = el.offsetWidth, fh = el.offsetHeight;
  let left = anchorRect.right + 2;
  if (left + fw > window.innerWidth) left = anchorRect.left - fw - 2;
  let top = anchorRect.top;
  if (top + fh > window.innerHeight) top = window.innerHeight - fh - 8;
  if (top < 8) top = 8;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export function showContextMenu(x: number, y: number, options: CtxOption[], triggerEl?: HTMLElement | null): void {
  closeContextMenu();
  if (triggerEl) { triggerEl.classList.add('ctx-active'); ctxTriggerEl = triggerEl; }
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'ctxMenu';

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-item';

    if (opt.submenu) {
      btn.innerHTML = `<span>${opt.label}</span><span class="ctx-arrow">▶</span>`;
      let flyout: HTMLDivElement | null = null;
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      function buildFlyout(): HTMLDivElement {
        const f = document.createElement('div');
        f.className = 'ctx-menu ctx-submenu';
        opt.submenu!.forEach(sub => {
          const sbtn = document.createElement('button');
          sbtn.className = 'ctx-menu-item';
          sbtn.textContent = sub.label;
          sbtn.onclick = (e) => {
            e.stopPropagation();
            sub.onClick?.();
            closeContextMenu();
          };
          f.appendChild(sbtn);
        });
        document.body.appendChild(f);
        positionFlyout(f, btn.getBoundingClientRect());
        f.addEventListener('mouseenter', () => { if (hideTimer) clearTimeout(hideTimer); });
        f.addEventListener('mouseleave', scheduleHide);
        return f;
      }
      function scheduleHide(): void {
        hideTimer = setTimeout(() => {
          if (flyout) { flyout.remove(); flyout = null; }
        }, 220);
      }
      btn.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
        if (!flyout) flyout = buildFlyout();
      });
      btn.addEventListener('mouseleave', scheduleHide);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (flyout) { flyout.remove(); flyout = null; }
        else flyout = buildFlyout();
      });
    } else {
      btn.textContent = opt.label;
      btn.onclick = (e) => {
        e.stopPropagation();
        opt.onClick?.();
        closeContextMenu();
      };
    }
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = x, top = y;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight) top = window.innerHeight - mh - 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  setTimeout(() => {
    ctxOutsideClickHandler = closeContextMenu;
    document.addEventListener('click', ctxOutsideClickHandler, { once: true });
  }, 0);
}

/** グループの色を選ぶモーダル */
export function pickGroupColor(callback: (color: string) => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'color-pick-backdrop';
  const panel = document.createElement('div');
  panel.className = 'color-pick-panel';
  const title = document.createElement('div');
  title.className = 'color-pick-title';
  title.textContent = STR.common.groupColorPickTitle;
  panel.appendChild(title);
  const swatchWrap = document.createElement('div');
  swatchWrap.className = 'color-swatch-wrap';
  GROUP_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch';
    sw.style.background = c;
    sw.onclick = (e) => {
      e.stopPropagation();
      document.body.removeChild(backdrop);
      callback(c);
    };
    swatchWrap.appendChild(sw);
  });
  panel.appendChild(swatchWrap);
  const cancel = document.createElement('button');
  cancel.className = 'color-pick-cancel';
  cancel.textContent = STR.common.cancel;
  cancel.onclick = () => document.body.removeChild(backdrop);
  panel.appendChild(cancel);
  backdrop.appendChild(panel);
  backdrop.onclick = (e) => { if (e.target === backdrop) document.body.removeChild(backdrop); };
  document.body.appendChild(backdrop);
}

/** 未保存の作業中データを守るための確認モーダル(saveCurrentは呼び出し側から受ける) */
export function showUnsavedPrompt(onProceed: () => void, save: () => boolean): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'color-pick-backdrop';
  const panel = document.createElement('div');
  panel.className = 'color-pick-panel';
  panel.innerHTML = `<div class="color-pick-title">${STR.common.unsavedPromptHtml}</div>`;
  const row1 = document.createElement('button');
  row1.className = 'btn accent';
  row1.style.width = '100%'; row1.style.marginBottom = '8px';
  row1.textContent = STR.common.unsavedSaveThenOpen;
  row1.onclick = () => {
    document.body.removeChild(backdrop);
    if (save()) onProceed();
  };
  const row2 = document.createElement('button');
  row2.className = 'btn';
  row2.style.width = '100%'; row2.style.marginBottom = '8px';
  row2.textContent = STR.common.unsavedOpenWithoutSave;
  row2.onclick = () => {
    document.body.removeChild(backdrop);
    onProceed();
  };
  const row3 = document.createElement('button');
  row3.className = 'color-pick-cancel';
  row3.textContent = STR.common.cancel;
  row3.onclick = () => document.body.removeChild(backdrop);
  panel.appendChild(row1);
  panel.appendChild(row2);
  panel.appendChild(row3);
  backdrop.appendChild(panel);
  backdrop.onclick = (e) => { if (e.target === backdrop) document.body.removeChild(backdrop); };
  document.body.appendChild(backdrop);
}

/** 同期(マージ)結果の表示 */
export function showMergeResult(added: number, updated: number): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'color-pick-backdrop';
  const panel = document.createElement('div');
  panel.className = 'color-pick-panel';
  panel.innerHTML = `
    <div class="color-pick-title">${STR.common.mergeResultTitle}</div>
    <div style="margin-bottom:14px; font-size:13px;">
      <div style="color:#7ed17e; font-weight:600;">➕ ${STR.common.mergeAddedLabel}: ${added}</div>
      <div style="color:#e0c85c; font-weight:600; margin-top:4px;">🔄 ${STR.common.mergeUpdatedLabel}: ${updated}</div>
    </div>
    <button class="btn accent" id="mergeResultClose" style="width:100%;">OK</button>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  document.getElementById('mergeResultClose')!.onclick = () => backdrop.remove();
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
}
