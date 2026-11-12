/**
 * 章节书签（书口索引）
 * ------------------------------------------------------------
 * 每一枚书签都绑在一张真实的纸上，而不是固定在书边：
 *
 *   bookmark.anchorPage  —— 这一章第一跨页的「右页」页码（2*spread+3）
 *   bookmark.anchorSheet —— 当前正载着这一页的那张纸（每帧从纸页栈查，不缓存）
 *   bookmark.side        —— 那张纸在右（未翻）还是在左（已翻 -180°）
 *
 * 结构上是一根「联动杆」：
 *
 *   .bk-mark-rig   从书脊（50%）开始、宽度 = 一页 + 34px，绕书脊 rotateY(--rig-deg)
 *     └ .bk-mark   贴在杆的右端，即书页外缘
 *
 * 杆的角度 = 它绑定那张纸的角度（同一个值、同一帧、同一个旋转轴）。
 * 所以纸翻到左边，杆跟着转到左边，书签自然出现在左侧书口；
 * 纸翻回来，书签也跟着回来。过 90° 时杆和书签正好侧立看不见，
 * 就在这一刻把标签自身反翻 180°，保证左侧的标签仍然正着读。
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

  for (const [i, spec] of list.entries()) {
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
    tab.style.setProperty('--mark-jog', `${(i % 3) * 2}px`);
    /* 书签优先级最高：先吃掉这次点击，绝不让它落到下面的页面内容上 */
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(spec);
    });

    // 联动杆：从书脊伸到书页外缘，绕书脊转，角度跟纸张同步
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
   * 按「这张纸现在什么角度」重排书签。
   * @param {{
   *   angleFor: (spec: any) => { angle: number, slot: string } | null,
   *   closed: boolean,
   *   single: boolean,
   *   settling: boolean,
   * }} options
   */
  function sync({ angleFor, closed, single, settling }) {
    layer.classList.toggle('is-settling', !!settling);
    for (const item of items) {
      let deg = 0;
      let side = 'right';
      let sheet = null;

      if (!closed && !single) {
        sheet = angleFor(item.spec);
        if (sheet) {
          deg = sheet.angle || 0;
          side = deg <= -90 ? 'left' : 'right';
        }
      }

      item.sheet = sheet;
      item.side = side;

      item.rig.style.setProperty('--rig-deg', `${deg.toFixed(2)}deg`);
      // 过 90° 时标签侧立不可见，在这一刻把标签自身反翻，保证落地后正着读
      item.tab.style.setProperty('--mark-flip', Math.abs(deg) >= 90 ? '180deg' : '0deg');
      item.tab.classList.toggle('is-left', side === 'left');
      item.tab.classList.toggle('is-right', side === 'right');
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