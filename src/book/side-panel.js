/**
 * 书页对侧辅助面板（推荐菜品详情 / 推荐聊天）
 * ------------------------------------------------------------
 * 只负责“把一块内容挂到当前跨页的另一张纸上”，不制造全屏层：
 *   · 面板 absolute inset:0 铺在目标纸面内部，纸外的画册、书脊、书签都不动；
 *   · 桌面双页：推荐结果在右页时，面板落在左页；反过来也一样；
 *   · 手机单页：没有“另一半”可借，面板铺满当前这张纸，收起即还原；
 *   · 目标页 top 先归零，关闭时恢复原来的滚动位置；
 *   · 面板自己滚动，下面的书页滚动位置不被改写。
 *
 * 页面的左右判断由 book/index.js 注入，不在本模块写死。
 */
import { h } from '../lib/dom.js';

const CLOSE_MS = 240;
let opener = null;
let current = null;
let seq = 0;
let openWidth = 0;
let resizeTimer = 0;

export function setSidePanelOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

export const hasOpenSidePanel = () => Boolean(current);

export const sidePanelState = () => ({
  open: Boolean(current),
  key: current?.key ?? null,
  label: current?.label ?? null,
  side: current?.side ?? null,
  single: current?.single ?? false,
  pageSide: current?.page?.dataset?.pageSide ?? null,
  hasCloseButton: Boolean(current?.holder?.querySelector('.dm-side__close')),
});

/**
 * 打开 / 更新一块对侧内容。
 * @param {{key:string, originEl:HTMLElement, kicker?:string, label?:string, render:()=>HTMLElement, onClose?:Function}} opts
 */
export async function openSidePanel({ key, originEl, kicker = '', label = '', render, onClose = null }) {
  if (!opener || !key || typeof render !== 'function') return null;
  const mySeq = ++seq;
  const slot = await opener({ originEl });
  if (mySeq !== seq || !slot?.page) return null;

  const page = slot.page;
  const side = slot.single ? 'full' : slot.side === 'left' ? 'left' : slot.side === 'right' ? 'right' : 'full';

  if (current && current.key === key && current.page === page && current.holder.isConnected) {
    current.kicker.textContent = kicker;
    current.title.textContent = label;
    current.label = label;
    current.holder.setAttribute('aria-label', label || '菜品辅助内容');
    current.onClose = typeof onClose === 'function' ? onClose : null;
    current.body.replaceChildren(render());
    return current;
  }

  closeSidePanel('switch', { instant: true });

  const kickerEl = h('span', { class: 'dm-side__kicker', text: kicker });
  const titleEl = h('span', { class: 'dm-side__title', text: label });
  const closeBtn = h(
    'button',
    { class: 'dm-side__close', type: 'button', 'aria-label': `收起${label || '当前内容'}` },
    h('span', { class: 'dm-side__close-ico', 'aria-hidden': 'true', text: '⟩' }),
    h('span', { class: 'dm-side__close-txt', text: '收起' })
  );
  const body = h('div', { class: 'dm-side__body' });
  const holder = h(
    'section',
    {
      class: `dm-side dm-side--${side}`,
      role: 'region',
      'aria-label': label || '菜品辅助内容',
    },
    h('header', { class: 'dm-side__bar' }, h('div', { class: 'dm-side__heading' }, kickerEl, titleEl), closeBtn),
    body
  );

  const scroller = page.classList?.contains('bk-pageface') ? page : page.closest?.('.bk-pageface');
  const prevScroll = scroller?.scrollTop || 0;
  if (scroller && prevScroll > 0) scroller.scrollTop = 0;

  page.append(holder);
  page.classList.add('has-dm-side');
  body.append(render());

  current = {
    key,
    label,
    holder,
    body,
    kicker: kickerEl,
    title: titleEl,
    page,
    side,
    single: Boolean(slot.single),
    scroller,
    prevScroll,
    originEl: originEl || null,
    onClose: typeof onClose === 'function' ? onClose : null,
    closeTimer: 0,
  };

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSidePanel('button');
  });

  openWidth = window.innerWidth;
  requestAnimationFrame(() => {
    if (current?.holder === holder) holder.classList.add('is-open');
  });

  return current;
}

export function closeSidePanel(reason = 'api', { instant = false } = {}) {
  seq += 1;
  const cur = current;
  if (!cur) return false;
  current = null;
  cur.page?.classList.remove('has-dm-side');
  cur.holder.classList.remove('is-open');
  cur.holder.classList.add('is-closing');

  const done = () => {
    cur.closeTimer = 0;
    cur.holder.remove();
    if (cur.scroller?.isConnected) cur.scroller.scrollTop = cur.prevScroll;
  };

  window.clearTimeout(cur.closeTimer);
  if (instant) done();
  else cur.closeTimer = window.setTimeout(done, CLOSE_MS);

  try {
    cur.onClose?.(reason);
  } catch {
    /* 面板 cleanup 不应打断合页 */
  }

  document.dispatchEvent(
    new CustomEvent('foodsoul:side-panel-close', {
      detail: { key: cur.key, reason },
    })
  );
  return true;
}

/* Esc 只收这一层；书页和自己的键盘逻辑不受影响。 */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !current || event.defaultPrevented) return;
  event.preventDefault();
  closeSidePanel('escape');
});

/* 双页 / 单页断点变化：旧页会被重排，直接收起，避免面板悬空。 */
window.addEventListener('resize', () => {
  if (!current) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (current && Math.abs(window.innerWidth - openWidth) > 40) {
      closeSidePanel('resize', { instant: true });
    }
  }, 180);
});