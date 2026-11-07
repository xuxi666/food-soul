/**
 * 章节书签（书口索引）
 * ------------------------------------------------------------
 * 书签不是网页侧边导航，而是插在画册右侧书口上的纸质索引：
 *   - 全部排在书的右侧外缘，合上时从封面边缘露出，打开后从右页外缘露出；
 *   - 每个书签绑定一个真实章节起始页（targetPage），点击就翻到那一章；
 *   - 书签不印页码，只有章节名；
 *   - 翻页时，绑定页正好在「正在翻的那张纸」上的书签会和纸共享同一个角度，
 *     随纸一起转（不是另外播一段假动画），纸落定的同时书签回到书口位置。
 *
 * 位置依据：书签层挂在 .bk-book 内部，所以书的缩放、合书 15° 倾斜、
 * 开合位移都会自动带上书签，不需要额外同步。
 */
import { h } from '../lib/dom.js';

/**
 * @param {{ list: Array<{id:string,label:string,tint:string,targetPage:number}>, onPick: (spec) => void }} options
 */
export function createBookmarks({ list, onPick }) {
  const layer = h('div', {
    class: 'bk-marks',
    role: 'tablist',
    'aria-label': '章节书签',
  });

  const items = new Map();

  for (const [i, spec] of list.entries()) {
    const el = h(
      'button',
      {
        class: 'bk-mark',
        type: 'button',
        role: 'tab',
        'data-chapter': spec.id,
        'data-target-page': String(spec.targetPage),
        'aria-selected': 'false',
        title: spec.label,
        'aria-label': spec.label,
      },
      h('span', { class: 'bk-mark__label', text: spec.label }),
      h('span', { class: 'bk-mark__edge', 'aria-hidden': 'true' })
    );
    el.style.setProperty('--mark-tint', spec.tint);
    el.style.setProperty('--mark-i', String(i));
    el.style.setProperty('--mark-jog', `${(i % 3) * 3}px`);
    el.addEventListener('click', () => onPick(spec));
    layer.append(el);
    items.set(spec.id, { spec, el });
  }

  function setActive(id) {
    for (const [key, { el }] of items) {
      const on = key === id;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /** 合上 / 打开：只切状态，不换内容（同一套书签数据） */
  function setClosed(closed) {
    layer.classList.toggle('is-closed', closed);
  }

  /**
   * 翻页过程中被调用（每帧）。
   * pages = 正在翻的那张纸的正反面页码；只有绑定在这两页上的书签跟着纸转。
   */
  function riding({ pages, deg }) {
    for (const { spec, el } of items.values()) {
      const bound = pages.includes(spec.targetPage);
      el.classList.toggle('is-riding', bound);
      if (bound) el.style.setProperty('--ride-deg', `${deg.toFixed(2)}deg`);
    }
  }

  /** 纸落定：所有书签回到书口 */
  function idle() {
    for (const { el } of items.values()) {
      el.classList.remove('is-riding');
      el.style.setProperty('--ride-deg', '0deg');
    }
  }

  return { layer, setActive, setClosed, riding, idle, items };
}