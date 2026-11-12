/**
 * 章节书签（书籍外框导航）
 * ------------------------------------------------------------
 * 书签是书籍外框的一部分：它跟随整本书的回正、缩放、平移和旋转，
 * 但和 .bk-spread / .bk-cover 同级，不进入纸张叶片，因此不会被单页翻页带走。
 * 所有有效章节始终按 CHAPTERS 的顺序，贴在书籍右缘纵向排列；
 * 翻页、跳章、聊天 / 视频面板展开时只更新选中态，不改位置。
 *
 *   .bk-book
 *     ├ .bk-spread（左右页 / 翻页叶片）
 *     ├ .bk-cover（封面）
 *     └ .bk-marks（书籍右缘导航，跟随 .bk-book 的整体变换）
 *         └ .bk-mark-rig
 *             └ .bk-mark
 *
 * anchorPage / spread 仍保留在 data 属性里，供导航定位章节使用；
 * 它们不参与书签的视觉定位。
 */
import { h } from '../lib/dom.js';

/**
 * @param {{
 *   list: Array<{ id: string, label: string, tint: string, anchorPage: number, spread: number }>,
 *   onPick: (spec: any) => void,
 * }} options
 */
export function createBookmarks({ list, onPick }) {
  const layer = h('div', {
    class: 'bk-marks',
    role: 'tablist',
    'aria-label': '章节书签',
  });

  const items = [];

  for (const spec of list) {
    const tab = h(
      'button',
      {
        class: 'bk-mark',
        type: 'button',
        role: 'tab',
        'data-chapter': spec.id,
        'data-anchor-page': String(spec.anchorPage),
        'data-spread': String(spec.spread),
        'aria-selected': 'false',
        title: spec.label,
        'aria-label': spec.label,
      },
      h('span', { class: 'bk-mark__label', text: spec.label }),
      h('span', { class: 'bk-mark__edge', 'aria-hidden': 'true' })
    );
    tab.style.setProperty('--mark-tint', spec.tint);
    /* 书签优先级最高：先吃掉这次点击，绝不让它落到下面的页面内容上 */
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(spec);
    });

    // 书籍右缘竖列中的一枚：只做定位包装，不参与书页翻页
    const rig = h('div', { class: 'bk-mark-rig' }, tab);
    layer.append(rig);

    items.push({ spec, rig, tab, sheet: null, side: 'right' });
  }

  function setActive(id) {
    for (const { spec, tab } of items) {
      const on = spec.id === id;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /**
   * 只同步非位置状态。
   *
   * 书签的屏幕位置完全由祖先 .bk-book 的整体 transform 决定；
   * 单页翻页 / 跳章不会改变这个 transform，所以这里不写任何几何值。
   *
   * @param {{
   *   closed: boolean,
   *   single: boolean,
   *   settling: boolean,
   * }} options
   */
  function sync({ closed, single, settling }) {
    layer.classList.toggle('is-settling', !!settling);
    for (const item of items) {
      item.sheet = null;
      item.side = 'right';
      item.tab.classList.remove('is-left');
      item.tab.classList.add('is-right');
    }
    layer.classList.toggle('is-closed', !!closed);
    layer.classList.toggle('is-single', !!single);
  }

  /** 诊断：每枚书签当前所在侧与屏幕位置 */
  function state() {
    return items.map(({ spec, tab, sheet, side }) => ({
      bookmarkId: spec.id,
      chapterId: spec.id,
      anchorPageIndex: spec.anchorPage,
      anchorSheetId: sheet?.slot || null,
      anchorSheetAngle: sheet?.angle ?? null,
      currentSide: side,
      position: tab.getBoundingClientRect().left < window.innerWidth / 2 ? 'left-half' : 'right-half',
    }));
  }

  return { layer, setActive, sync, state, items };
}