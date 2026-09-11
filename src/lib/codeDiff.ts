// コード編集シートの差分ハイライト計算(旧js/viewer.jsのLCS差分部を純粋関数化)。
import { escHtml } from './svgUtils';

export type LineOp =
  | { type: 'same'; oldIdx: number; newIdx: number }
  | { type: 'del'; oldIdx: number }
  | { type: 'ins'; newIdx: number };

/** 行単位のLCS差分。巨大データ(n*m>200000)ではnullを返して重い計算を回避 */
export function diffLineOps(oldLines: string[], newLines: string[]): LineOp[] | null {
  const n = oldLines.length, m = newLines.length;
  if (n * m > 200000) return null;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: LineOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) { ops.push({ type: 'same', oldIdx: i, newIdx: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', oldIdx: i }); i++; }
    else { ops.push({ type: 'ins', newIdx: j }); j++; }
  }
  while (i < n) { ops.push({ type: 'del', oldIdx: i }); i++; }
  while (j < m) { ops.push({ type: 'ins', newIdx: j }); j++; }
  return ops;
}

/** 削除ブロックと挿入ブロックを1:1の「置換」ペアにし、余った挿入行はpureInsertへ */
export function pairSubstitutions(ops: LineOp[]): { subMap: Map<number, number>; pureInsert: Set<number> } {
  const subMap = new Map<number, number>(); // newIdx -> oldIdx (1:1置換ペア)
  const pureInsert = new Set<number>();     // 対応する旧行が無い、丸ごと新規の行
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.type === 'del') {
      let delStart = k;
      while (k < ops.length && ops[k].type === 'del') k++;
      const delCount = k - delStart;
      let insStart = k;
      while (k < ops.length && ops[k].type === 'ins') k++;
      const insCount = k - insStart;
      const pairCount = Math.min(delCount, insCount);
      for (let p = 0; p < pairCount; p++) {
        const ins = ops[insStart + p];
        const del = ops[delStart + p];
        if (ins.type === 'ins' && del.type === 'del') subMap.set(ins.newIdx, del.oldIdx);
      }
      for (let p = pairCount; p < insCount; p++) {
        const ins = ops[insStart + p];
        if (ins.type === 'ins') pureInsert.add(ins.newIdx);
      }
    } else if (op.type === 'ins') {
      pureInsert.add(op.newIdx);
      k++;
    } else k++;
  }
  return { subMap, pureInsert };
}

// 置換ペアの新旧2行から、実際に変わった箇所を「複数の断片(hunk)」として取り出す。
// 単純な共通接頭辞/接尾辞比較だと1行内の離れた2箇所の変更をまとめてしまうため、
// 英数字の連続(単語・数値のまとまり)を1トークンとしてトークン単位のLCSで分離する。
// これなら"150"と"300"は「別のトークン」として丸ごと1色でハイライトされる。
export function tokenize(line: string): string[] {
  return line.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/g) || [];
}

export function tokenDiffHunks(oldLine: string, newLine: string): [number, number][] {
  const oldTokens = tokenize(oldLine), newTokens = tokenize(newLine);
  const n = oldTokens.length, m = newTokens.length;
  if (n * m > 20000) return [[0, newLine.length]]; // 長すぎる行は丸ごとハイライトにフォールバック
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldTokens[i] === newTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const tokenStart = new Array<number>(m + 1);
  {
    let pos = 0;
    for (let t = 0; t < m; t++) { tokenStart[t] = pos; pos += newTokens[t].length; }
    tokenStart[m] = pos;
  }
  const hunks: [number, number][] = [];
  let i = 0, j = 0, curStart = -1;
  const closeHunk = (endTok: number): void => {
    if (curStart !== -1) {
      const endPos = tokenStart[endTok];
      if (endPos > curStart) hunks.push([curStart, endPos]);
    }
    curStart = -1;
  };
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) { closeHunk(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { if (curStart === -1) curStart = tokenStart[j]; i++; }
    else { if (curStart === -1) curStart = tokenStart[j]; j++; }
  }
  if (j < m) { if (curStart === -1) curStart = tokenStart[j]; j = m; closeHunk(j); }
  else closeHunk(j);
  return hunks;
}

/** baseline(編集シートを開いた時点)と現在値を比較し、変わった文字範囲だけを返す(ピンポイント) */
export function computeChangedCharRanges(baseline: string, current: string): [number, number][] {
  const oldLines = baseline.split('\n');
  const newLines = current.split('\n');
  const ops = diffLineOps(oldLines, newLines);
  if (!ops) return [];
  const { subMap, pureInsert } = pairSubstitutions(ops);
  const ranges: [number, number][] = [];
  let offset = 0;
  newLines.forEach((line, idx) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (pureInsert.has(idx)) {
      if (line.length) ranges.push([lineStart, lineStart + line.length]);
    } else if (subMap.has(idx)) {
      tokenDiffHunks(oldLines[subMap.get(idx)!], line).forEach(([s, e]) => ranges.push([lineStart + s, lineStart + e]));
    }
  });
  return ranges;
}

export function findCommentRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /<!--[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/** 1行分の範囲[lineStart,lineEnd)に、複数の色分けクラス(comment/search-match/code-changed等)を
 * 重なりも考慮して割り当ててHTMLを組み立てる(区間スイープ方式) */
export function buildStyledLineHtml(
  text: string, lineStart: number, lineEnd: number,
  rangeSets: Record<string, [number, number][]>,
): string {
  const points = new Set<number>([lineStart, lineEnd]);
  const clipped: Record<string, [number, number][]> = {};
  for (const cls in rangeSets) {
    clipped[cls] = [];
    for (const [rs, re] of rangeSets[cls]) {
      if (re <= lineStart || rs >= lineEnd) continue;
      const s = Math.max(rs, lineStart), e = Math.min(re, lineEnd);
      clipped[cls].push([s, e]);
      points.add(s); points.add(e);
    }
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    if (s >= e) continue;
    const classes: string[] = [];
    for (const cls in clipped) {
      if (clipped[cls].some(([rs, re]) => rs <= s && re >= e)) classes.push(cls);
    }
    const seg = escHtml(text.slice(s, e));
    html += classes.length ? `<span class="${classes.join(' ')}">${seg}</span>` : seg;
  }
  return html;
}
