// 並べ替え(名前順/新しい順など) (旧js/list.jsの並べ替えセクションを分離)
// 「まとめて全部」だと影響範囲が大きすぎて分かりにくいという指摘を受けて、
// 「グループの中身だけ」「グループ自体の並び順だけ」「未グループの項目だけ」を
// それぞれ独立して並べ替えられるようにした(お互いに影響しない)。
// 並べ替える直前の状態は必ず退避しておき、「↩️元に戻す」で1回分だけ復元できる。
import type { SavedItem, TopOrderEntry, SortCriteria, Mode } from '../types/zou';
import { STR } from './i18n';
import { STORAGE_KEYS } from './constants';
import { getSaved, setSaved, getGroups, getTopOrder, setTopOrder } from './storage';

export function cmpItemsByCriteria(a: SavedItem, b: SavedItem, criteria: SortCriteria): number {
  if (criteria === 'name-asc') return (a.name || '').localeCompare(b.name || '', 'ja');
  if (criteria === 'name-desc') return (b.name || '').localeCompare(a.name || '', 'ja');
  if (criteria === 'newest') return new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime();
  if (criteria === 'oldest') return new Date(a.savedAt || 0).getTime() - new Date(b.savedAt || 0).getTime();
  return 0;
}

/** 右クリック/メニュー用の並べ替え基準4択(文言はSTRから) */
export function sortCriteriaSubmenuLabels(): { label: string; value: SortCriteria }[] {
  return [
    { label: STR.common.sortNameAsc, value: 'name-asc' },
    { label: STR.common.sortNameDesc, value: 'name-desc' },
    { label: STR.common.sortNewest, value: 'newest' },
    { label: STR.common.sortOldest, value: 'oldest' },
  ];
}

/** 「元に戻す」は並び順だけを覚えておき、ピン留め・ロック・名前などの中身は「今の状態」を
 * そのまま活かす作り。丸ごとのスナップショットにしてしまうと、並べ替えた後に
 * ピン留めなどの別の変更をしてから元に戻した時、その別の変更まで巻き戻ってしまうため */
export function snapshotBeforeSort(mode: Mode): void {
  const snap = {
    savedAt: new Date().toISOString(),
    itemIdOrder: getSaved().map(it => it.id), // items配列の並び順(idの列)だけ覚えておく
    topOrder: getTopOrder(),                  // group/itemの並び順(オブジェクトごと)
  };
  try { localStorage.setItem(STORAGE_KEYS.preSortSnapshot(mode), JSON.stringify(snap)); } catch { /* ignore */ }
}

export function restorePreSortSnapshot(
  mode: Mode,
  onNoSnapshot: () => void,
): void {
  let snap: { itemIdOrder?: string[]; topOrder?: TopOrderEntry[] | null } | null = null;
  try { snap = JSON.parse(localStorage.getItem(STORAGE_KEYS.preSortSnapshot(mode)) || 'null'); }
  catch { snap = null; }
  if (!snap || !snap.itemIdOrder) { onNoSnapshot(); return; }
  // 並び順の記録をもとに、今のアイテムの中身(ピン留め・ロック・名前など)はそのまま活かしつつ並べ直す
  const current = getSaved();
  const byId = new Map(current.map(it => [it.id, it]));
  const restored = snap.itemIdOrder.map(id => byId.get(id)).filter((x): x is SavedItem => !!x);
  // 並べ替え後に新しく増えたアイテム(スナップショットに無いもの)は末尾に足して取りこぼしを防ぐ
  const restoredIds = new Set(restored.map(it => it.id));
  current.forEach(it => { if (!restoredIds.has(it.id)) restored.push(it); });
  setSaved(restored);
  if (snap.topOrder) setTopOrder(snap.topOrder);
}

/** グループ「の中身」だけを並べ替える。他のグループ・未グループ・グループの並び順には触らない。
 * ピン留めしたアイテムは、並び替えの影響を受けず今の位置のまま動かさない
 * (「ピンが刺さってるのに勝手に動く」という報告への対応。並び替えの対象は未ピンのものだけ) */
export function sortGroupItems(groupId: string, criteria: SortCriteria, mode: Mode): void {
  snapshotBeforeSort(mode);
  const items = getSaved();
  const inGroup = items.filter(it => (it.group || null) === groupId);
  const rest = items.filter(it => (it.group || null) !== groupId);
  const pinned = inGroup.filter(it => it.pinned);
  const unpinned = inGroup.filter(it => !it.pinned);
  unpinned.sort((a, b) => cmpItemsByCriteria(a, b, criteria));
  setSaved([...rest, ...pinned, ...unpinned]);
}

/** グループ「自体」の並び順だけを並べ替える。各グループの中身・未グループの並びには触らない。
 * グループには日付情報が無いため、新しい順/古い順の代わりにグループ作成順を使う */
export function sortGroupsOrder(criteria: SortCriteria, mode: Mode): void {
  snapshotBeforeSort(mode);
  const groups = getGroups();
  const order = getTopOrder();
  const groupSlots: number[] = [], groupEntries: TopOrderEntry[] = [];
  order.forEach((e, i) => { if (e.type === 'group') { groupSlots.push(i); groupEntries.push(e); } });
  const groupById = new Map(groups.map(g => [g.id, g]));
  groupEntries.sort((ea, eb) => {
    const ga = groupById.get(ea.id), gb = groupById.get(eb.id);
    if (!ga || !gb) return 0;
    if (criteria === 'name-asc') return (ga.name || '').localeCompare(gb.name || '', 'ja');
    if (criteria === 'name-desc') return (gb.name || '').localeCompare(ga.name || '', 'ja');
    const ia = groups.indexOf(ga), ib = groups.indexOf(gb);
    return criteria === 'newest' ? ib - ia : ia - ib;
  });
  const newOrder = order.slice();
  groupSlots.forEach((slot, i) => { newOrder[slot] = groupEntries[i]; });
  setTopOrder(newOrder);
}

/** 未グループの項目「だけ」を並べ替える。グループの中身・グループ自体の並びには触らない。
 * ピン留めしたアイテムは並び替えの対象から外し、今のスロット位置のまま動かさない */
export function sortUngroupedOrder(criteria: SortCriteria, mode: Mode): void {
  snapshotBeforeSort(mode);
  const items = getSaved();
  const order = getTopOrder();
  const itemById = new Map(items.map(it => [it.id, it]));
  const unpinnedSlots: number[] = [], unpinnedEntries: TopOrderEntry[] = [];
  order.forEach((e, i) => {
    if (e.type !== 'item') return;
    const it = itemById.get(e.id);
    if (it && it.pinned) return; // ピン留め分はスロットごと触らずスキップ
    unpinnedSlots.push(i);
    unpinnedEntries.push(e);
  });
  unpinnedEntries.sort((ea, eb) => {
    const ia = itemById.get(ea.id), ib = itemById.get(eb.id);
    if (!ia || !ib) return 0;
    return cmpItemsByCriteria(ia, ib, criteria);
  });
  const newOrder = order.slice();
  unpinnedSlots.forEach((slot, i) => { newOrder[slot] = unpinnedEntries[i]; });
  setTopOrder(newOrder);
}
