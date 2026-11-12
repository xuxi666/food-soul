/**
 * 章节书签（画册级固定导航）
 * ------------------------------------------------------------
 * 书签不再绑定某一张会翻转的纸，也不会跟着纸从右书口跑到左书口。
 * 所有有效章节始终按 CHAPTERS 的顺序，在画册最右侧纵向排列；
 * 翻页、跳章、开合、聊天 / 视频面板展开时只更新选中态，不改位置。
 *
 *   .bk-marks      挂在 .bk-stage 的独立绝对定位层，位置由 book.css 计算
 *     └ .bk-mark-rig
 *         └ .bk-mark
 *
 * anchorPage / spread 仍保留在 data 属性里，供导航定位章节使用；
 * 它们不再参与书签的屏幕位置计算。
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

    // 固定竖列中的一枚：不需要再从书脊伸出的联动杆
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
   * 书签从章节纸页模型中分离之后，翻页 / 跳章 / 开合都不再参与屏幕位置计算。
   * 这里刻意不读取 angleFor，也不写 --rig-deg / --mark-flip：
   * 任何一次写角度都会让「固定右侧」失效。
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

  /** 诊断：每枚书签现在绑在哪张纸、哪一侧 */
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