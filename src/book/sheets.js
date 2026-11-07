/**
 * 纸页栈：书里真正在翻的是「纸」
 * ------------------------------------------------------------
 * 四个槽位，每个槽位都是一张有正反面的纸：
 *   A0 左页最上面那张（已翻过去，露出背面 = 左页）
 *   A1 左页第二张（被 A0 盖住，翻回上一页时才露出来）
 *   B  现在压在最上面的那张（正面 = 右页，背面 = 下一跨页左页）
 *   C  压在 B 下面的那张（B 翻走之后露出来的右页）
 *
 * 翻下一页：B 绕书脊从 0° 转到 -180°。正面（右页）在 0–90° 之间逐渐侧过去，
 *          90° 之后背面（下一跨页的左页）逐渐出现；而 C 的正面一直压在下面，
 *          B 一离开右侧就开始露出来 —— 不是等动画结束再换内容。
 * 翻上一页：A0 从 -180° 转回 0°，它的正面（上一页右页）转回来，
 *          A1 的背面（上一页左页）本来就压在它下面。
 *
 * 纸的正反面内容在动画开始之前就贴好；动画只改纸张的空间变换，中途不换内容。
 */
import { h } from '../lib/dom.js';

const TURN_MS = 640;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const BILINEAR = 'cubic-bezier(0.32, 0.05, 0.22, 1)';

function makeSheet(name) {
  const front = h('div', { class: 'bk-sheet__face bk-sheet__face--front' });
  const back = h('div', { class: 'bk-sheet__face bk-sheet__face--back' });
  const el = h(
    'div',
    { class: 'bk-sheet', 'data-sheet': name },
    front,
    back,
    h('span', { class: 'bk-sheet__spine', 'aria-hidden': 'true' }),
    h('span', { class: 'bk-sheet__edge', 'aria-hidden': 'true' })
  );
  return { el, front, back, name };
}

export function createSheets(host) {
  let A0 = makeSheet('a0');
  let A1 = makeSheet('a1');
  let B = makeSheet('b');
  let C = makeSheet('c');
  for (const s of [A1, A0, C, B]) host.append(s.el);

  let busy = false;

  const setTurned = (sheet, turned) => {
    sheet.turned = turned;
    sheet.el.classList.toggle('is-turned', turned);
    sheet.el.style.transform = turned ? 'rotateY(-180deg)' : 'rotateY(0deg)';
  };

  const setZ = () => {
    A1.el.style.zIndex = '340';
    A0.el.style.zIndex = '400';
    C.el.style.zIndex = '290';
    B.el.style.zIndex = '300';
  };

  const put = (faceEl, node) => {
    faceEl.replaceChildren();
    if (node) faceEl.append(node);
  };

  /** 一张纸的正反面：front 是奇数页，back 是偶数页 */
  function fill(sheet, frontPage, backPage) {
    put(sheet.front, frontPage);
    put(sheet.back, backPage);
  }

  /**
   * 把某一跨页摆到书桌上（不动画）。
   * 页码约定：跨页 s 的左页 = 2s+2，右页 = 2s+3。
   */
  async function settle({ resolve, spread, single }) {
    if (single) {
      const page = spread + 1;
      fill(B, await resolve(page), await resolve(page + 1));
      fill(C, await resolve(page + 1), await resolve(page + 2));
      fill(A0, null, null);
      fill(A1, null, null);
      setTurned(A0, true);
      setTurned(A1, true);
      setTurned(B, false);
      setTurned(C, false);
      setZ();
      return;
    }
    const base = spread * 2 + 2;
    fill(A0, await resolve(base - 1), await resolve(base));
    fill(A1, await resolve(base - 3), await resolve(base - 2));
    fill(B, await resolve(base + 1), await resolve(base + 2));
    fill(C, await resolve(base + 3), await resolve(base + 4));
    setTurned(A0, true);
    setTurned(A1, true);
    setTurned(B, false);
    setTurned(C, false);
    setZ();
  }

  /**
   * 翻一页。动画期间只有一张纸在动，它的正反面内容在开始前就已经贴好。
   * @returns {Promise<boolean>} 是否真的翻动了
   */
  async function turn(dir, { resolve, spread, single }) {
    if (busy) return false;
    busy = true;
    const moving = dir === 'prev' ? A0 : B;
    // 动画开始前，这张纸的正反面就已经贴好了内容（settle 时贴的）
    try {
      moving.el.classList.add('is-turning');
      moving.el.style.zIndex = '500';
      await nextFrame();
      moving.el.style.transition = `transform ${TURN_MS}ms ${BILINEAR}`;
      moving.el.style.transform = dir === 'prev' ? 'rotateY(0deg)' : 'rotateY(-180deg)';
      await wait(TURN_MS - 30);
      moving.el.style.transition = 'none';
      moving.el.classList.remove('is-turning');
      setTurned(moving, dir !== 'prev');

      if (single) {
        // 单页：纸翻过去之后按新页码重摆一次；可见页还是同一个节点，不会闪
        const newPage = spread + 1 + (dir === 'prev' ? -1 : 1);
        await settle({ resolve, spread: newPage - 1, single: true });
        return true;
      }

      if (dir === 'prev') {
        // 原 A0 现在是右页；A1 升到左页最上面；原 C 回收成更下面的一张
        const oldA0 = A0;
        const oldA1 = A1;
        const oldC = C;
        const base = (spread - 1) * 2 + 2;
        [A0, A1, B, C] = [oldA1, oldC, oldA0, B];
        fill(A0, await resolve(base - 1), await resolve(base));
        fill(A1, await resolve(base - 3), await resolve(base - 2));
        fill(B, await resolve(base + 1), await resolve(base + 2));
        fill(C, await resolve(base + 3), await resolve(base + 4));
        setTurned(A0, true);
        setTurned(A1, true);
        setTurned(B, false);
        setTurned(C, false);
        setZ();
        return true;
      }

      // 原 B 翻过去成了左页最上面；原 C 升为右页；原 A1 回收成下面那张
      const oldA0 = A0;
      const oldA1 = A1;
      const oldC = C;
      const base = (spread + 1) * 2 + 2;
      [A0, A1, B, C] = [B, oldA0, oldC, oldA1];
      fill(A0, await resolve(base - 1), await resolve(base));
      fill(B, await resolve(base + 1), await resolve(base + 2));
      fill(C, await resolve(base + 3), await resolve(base + 4));
      // 退下来那张被 A0 盖住，换成上一张的左页也看不见
      fill(A1, await resolve(base - 3), await resolve(base - 2));
      setTurned(A1, true);
      setTurned(B, false);
      setTurned(C, false);
      setTurned(A0, true);
      setZ();
      return true;
    } finally {
      busy = false;
    }
  }

  return {
    settle,
    turn,
    get busy() {
      return busy;
    },
  };
}