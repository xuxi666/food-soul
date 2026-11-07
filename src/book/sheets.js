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
 *
 * 旋转由我们自己的 rAF 循环驱动（不用 CSS transition），每一帧都按真实角度
 * 决定露出哪一面：|角度| < 90° 只画正面，≥ 90° 只画背面。
 * 这样即使某个浏览器在 3D 扁平化 / backface-visibility 上有 bug，
 * 也绝不会出现「翻过中缝还是上一页」的情况。
 */
import { h } from '../lib/dom.js';

const TURN_MS = 680;
const BEZIER = [0.32, 0.05, 0.22, 1];

/** 把 time 0..1 映射成 eased 0..1（和原来 CSS 用的 cubic-bezier 一致，手感不变） */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sx(t) - x;
      if (Math.abs(dx) < 1e-4) break;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return Math.min(1, Math.max(0, t));
  };
  return (x) => sy(solve(x));
}
const ease = cubicBezier(...BEZIER);

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
  return { el, front, back, name, slot: name, angle: 0 };
}

export function createSheets(host) {
  let A0 = makeSheet('a0');
  let A1 = makeSheet('a1');
  let B = makeSheet('b');
  let C = makeSheet('c');
  for (const s of [A1, A0, C, B]) host.append(s.el);

  let busy = false;
  /** 每帧回调：书签层靠它拿到「正在翻的纸 + 实时角度」，从而真正跟着纸转 */
  const hooks = { onAngle: null };

  /**
   * 把一张纸摆到某个角度，并按角度决定哪一面朝上。
   * 正面只在 |angle| < 90° 时显示，背面只在 ≥ 90° 时显示；
   * 这不是「动画结束后换内容」，两个面的内容从动画开始前就在纸上了。
   */
  function applyAngle(sheet, deg) {
    sheet.angle = deg;
    sheet.el.style.transform = `rotateY(${deg}deg)`;
    const frontUp = Math.abs(deg) < 90;
    sheet.front.style.visibility = frontUp ? '' : 'hidden';
    sheet.back.style.visibility = frontUp ? 'hidden' : '';
  }

  const setTurned = (sheet, turned) => {
    sheet.turned = turned;
    sheet.el.classList.toggle('is-turned', turned);
    applyAngle(sheet, turned ? -180 : 0);
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
    const fp = frontPage?.dataset?.globalPage;
    const bp = backPage?.dataset?.globalPage;
    if (fp && bp && fp === bp) {
      console.warn('[book] 正反面绑到了同一页', sheet.name, fp);
    }
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
  async function turn(dir, { resolve, spread, single, ms = TURN_MS }) {
    if (busy) return false;
    busy = true;
    const dur = Math.max(160, ms);
    const moving = dir === 'prev' ? A0 : B;
    const from = dir === 'prev' ? -180 : 0;
    const to = dir === 'prev' ? 0 : -180;
    try {
      moving.el.classList.add('is-turning');
      moving.el.style.zIndex = '500';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // 逐帧驱动旋转：每一帧都按当前角度决定露出正面还是背面
      await new Promise((done) => {
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const deg = from + (to - from) * ease(p);
          applyAngle(moving, deg);
          hooks.onAngle?.(moving, deg);
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });

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

  /** 诊断用：当前四张纸各自的正反面是哪一页 */
  function inspect() {
    const one = (s) => ({
      slot: s.name,
      angle: Math.round(s.angle),
      turned: !!s.turned,
      z: s.el.style.zIndex,
      visibleFace: Math.abs(s.angle) < 90 ? 'front' : 'back',
      front: s.front.firstElementChild?.dataset?.globalPage || null,
      back: s.back.firstElementChild?.dataset?.globalPage || null,
      frontVisible: getComputedStyle(s.front).visibility,
      backVisible: getComputedStyle(s.back).visibility,
    });
    return { a0: one(A0), a1: one(A1), b: one(B), c: one(C), busy };
  }

  return {
    settle,
    turn,
    inspect,
    hooks,
    /** 当前四个槽位对应的纸（角色会互换，所以每次现取） */
    all: () => [A0, A1, B, C],
    get busy() {
      return busy;
    },
  };
}