/**
 * 页内详情：从被点图片的四条边向外扩散，只覆盖「这一页」
 * ------------------------------------------------------------
 * 图鉴的卡片、菜系 / 口味页的菜单卡片都共用这一层：
 *   · 覆盖层挂在「纸」（.atlas-page 或 .bk-pageface）节点内部，
 *     纸面本身 overflow:hidden，所以动画在物理上出不了这一页；
 *   · 起点 = 被点图片相对纸面的矩形（一次量完，动画期间不读布局）；
 *   · 反向播放同一条 clip-path / inset 过渡，收完再卸载实例。
 * 内容由 book/dish-page.js 负责，评论组件照旧复用。
 */
import { h } from '../lib/dom.js';
import { DISH_BY_ID } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { api } from '../lib/api.js';
import { guardImage } from '../lib/placeholder.js';
import { mountComments } from '../components/comments.js';
import { buildDishDoc } from './dish-page.js';
import { enableWheelScroll, enableTouchScroll } from '../lib/wheel-scroll.js';

const EXPAND_MS = 620;
const closers = new Set();
const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const overlayCount = () => closers.size;
export const hasOpenOverlay = () => closers.size > 0;

function syncStageFlag() {
  const stage = document.querySelector('.bk-stage');
  if (!stage) return;
  stage.classList.toggle('is-atlas-expanded', closers.size > 0);
}

/**
 * @param {HTMLElement} hostEl 纸面节点（position:relative 且会裁切子元素）
 * @returns {(onDone?:Function, opts?:{instant?:boolean})=>void} 收起函数
 */
export function openDishOverlay(hostEl, opts = {}) {
  const { dishId, origin, backLabel = '返回图鉴', onChange, accent = '#d8b26a' } = opts;
  if (!hostEl || !dishId) return null;
  if (hostEl.querySelector('.atlas-detail')) return null;

  // 一次量完：起点矩形 = 被点图片相对本页纸张的位置
  const face = hostEl.getBoundingClientRect();
  const src = (origin && origin.getBoundingClientRect()) || face;
  const top = Math.max(0, Math.round(src.top - face.top));
  const left = Math.max(0, Math.round(src.left - face.left));
  const right = Math.max(0, Math.round(face.right - src.right));
  const bottom = Math.max(0, Math.round(face.bottom - src.bottom));

  const overlay = h('div', { class: 'atlas-detail', 'data-dish': dishId });
  overlay.style.setProperty('--ex-t', `${top}px`);
  overlay.style.setProperty('--ex-r', `${right}px`);
  overlay.style.setProperty('--ex-b', `${bottom}px`);
  overlay.style.setProperty('--ex-l', `${left}px`);

  const local = DISH_BY_ID[dishId] || null;
  const photo = h(
    'div',
    { class: 'atlas-detail__photo', 'aria-hidden': 'true' },
    guardImage(h('img', { src: local?.image || '', alt: '' }), local?.name || '', '')
  );

  const crumb = h('span', { class: 'atlas-detail__crumb' });
  const scroll = h('div', { class: 'atlas-detail__scroll' });
  const doc = h(
    'div',
    { class: 'atlas-detail__doc' },
    h(
      'div',
      { class: 'atlas-detail__bar' },
      h(
        'button',
        { class: 'atlas-back atlas-back--in', type: 'button', 'data-act': 'close-detail' },
        h('span', { class: 'atlas-back__mark', 'aria-hidden': 'true' }),
        backLabel
      ),
      crumb
    ),
    scroll
  );

  overlay.append(photo, doc);
  hostEl.append(overlay);
  hostEl.dataset.expanded = '1';
  syncStageFlag();

  // 详情页在自己的书页里滚动：书页是 3D 变换过的纸，原生滚轮在这种子树里不生效，
  // 这里把 deltaY 明确换算成本容器的 scrollTop（到顶/到底就把事件让回去，不穿透到外层）
  const stopWheel = enableWheelScroll(scroll);
  const stopTouch = enableTouchScroll(scroll);

  // 先按「被点图片的位置」量一次，下一帧再放开四条边：起点与被点的图片完全重合
  void overlay.offsetWidth;
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  let commentsInstance = null;
  let alive = true;

  const paintDoc = (dish) => {
    const place = CUISINE_BY_ID[dish.cuisine]?.name || TASTE_BY_ID[(dish.tastes || [])[0]]?.name || '中华料理';
    crumb.textContent = `${place} · ${dish.name}`;
    overlay.dataset.dish = dish.id;
    const img = photo.querySelector('img');
    if (img) {
      img.src = dish.image;
      img.alt = dish.alt || dish.name;
    }
    const built = buildDishDoc(dish, { accent });
    scroll.replaceChildren(built.el);
    try {
      mountComments(built.comments, dish.id);
    } catch (err) {
      console.warn('[overlay] 评论挂载失败', err);
    }
    commentsInstance = built;
  };

  if (local) {
    paintDoc(local);
  } else {
    // 后台新增的菜不在本地数据里：走同一套接口兜底，失败就提示，不编造内容
    scroll.replaceChildren(h('p', { class: 'dm-note', text: '正在读取这道菜的档案…' }));
    api
      .dish(dishId)
      .then((res) => {
        const dish = res?.dish;
        if (!alive) return;
        if (dish) paintDoc(dish);
        else scroll.replaceChildren(h('p', { class: 'dm-note', text: '这道菜的资料暂时读不到' }));
      })
      .catch(() => {
        if (alive) scroll.replaceChildren(h('p', { class: 'dm-note', text: '这道菜的资料暂时读不到' }));
      });
  }

  let closed = false;

  async function swapDish(nextId) {
    if (closed) return;
    let dish = DISH_BY_ID[nextId];
    if (!dish) {
      try {
        dish = (await api.dish(nextId))?.dish || null;
      } catch {
        dish = null;
      }
    }
    if (!dish) return;
    doc.classList.add('is-swapping');
    await new Promise((r) => window.setTimeout(r, REDUCED() ? 20 : 140));
    paintDoc(dish);
    scroll.scrollTop = 0;
    doc.classList.remove('is-swapping');
  }

  const close = (onDone, closeOpts) => {
    if (closed) return;
    closed = true;
    alive = false;
    closers.delete(close);
    overlay.classList.add('is-closing');
    overlay.classList.remove('is-open');
    hostEl.dataset.expanded = '0';
    syncStageFlag();
    // 详情收起 = 它的双页聊天也该收起（聊天是详情的另一半页）
    document.dispatchEvent(new CustomEvent('foodsoul:detail-close', { detail: { dish: overlay.dataset.dish } }));
    onChange?.();
    const finish = () => {
      stopWheel();
      stopTouch();
      overlay.remove();
      syncStageFlag();
      if (typeof onDone === 'function') onDone();
    };
    if (closeOpts && closeOpts.instant) {
      finish();
      return;
    }
    window.setTimeout(finish, REDUCED() ? 60 : EXPAND_MS + 40);
  };

  closers.add(close);
  syncStageFlag();
  onChange?.();

  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close-detail"]')) {
      e.preventDefault();
      close();
      return;
    }
    // 指向其它模块的链接（视频 / 生成菜谱等）照常交给书去处理
    const anchor = e.target.closest('a[href]');
    if (anchor && !(anchor.getAttribute('href') || '').startsWith('/dishes')) return;
    const dishEl = e.target.closest('[data-act="dish"], [data-dish]');
    const nextId = dishEl?.dataset.dish;
    if (nextId && nextId !== overlay.dataset.dish) {
      // 相关菜品：同一层里换一道菜（不叠层、不收起，避免从已卸载的小图扩散）
      e.preventDefault();
      e.stopPropagation();
      void swapDish(nextId);
    }
  });

  return close;
}

/** 离开这一章 / 合书 / 换路径：把还开着的页内详情原地收掉 */
export function closeAllOverlays(opts) {
  for (const close of [...closers]) close(undefined, opts || { instant: true });
}

/* 键盘隔离：详情打开时 Esc 只收这一层，方向键不翻整本书 */
document.addEventListener(
  'keydown',
  (e) => {
    if (!closers.size) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const last = [...closers].pop();
      last?.();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);