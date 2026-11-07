/**
 * 图鉴章节：左右两页按「从左到右、先左页后右页」排列菜品。
 * 每跨页 8 道（每页 2×2），放不下就翻页，不滚动整页。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, TASTES } from '../data/cuisines.js';

const PER_PAGE = 4;
const PER_SPREAD = PER_PAGE * 2;

/** 单页模式每屏 4 道，双页模式每跨页 8 道（由书壳的 is-single 类决定） */
const isSingle = () => Boolean(document.querySelector('.bk-stage.is-single'));
const perScreen = () => (isSingle() ? PER_PAGE : PER_SPREAD);

/**
 * 把菜品切成「跨页」，每跨页再对半分给左右两页。
 * 不能让最后几跨页只剩一道菜、另一半书页空着：
 * 统一按跨页数均分（例如 97 道 → 13 跨页：6 跨 8 道 + 7 跨 7 道），
 * 这样每跨页左右都至少有 3 道。
 */
function splitSpreads(list, single) {
  if (!list.length) return [];
  if (single) {
    const out = [];
    for (let i = 0; i < list.length; i += PER_PAGE) out.push([list.slice(i, i + PER_PAGE), []]);
    return out;
  }
  const counts = Math.max(1, Math.ceil(list.length / PER_SPREAD)) || 1;
  const base = Math.floor(list.length / counts);
  const rest = list.length % counts;
  const sizes = Array.from({ length: counts }, (_, i) => base + (i < rest ? 1 : 0));
  const out = [];
  let at = 0;
  for (const size of sizes) {
    const chunk = list.slice(at, at + size);
    at += size;
    const half = Math.ceil(chunk.length / 2);
    out.push([chunk.slice(0, half), chunk.slice(half)]);
  }
  return out;
}

const CUISINE_NAME = Object.fromEntries(CUISINES.map((c) => [c.id, c.name]));
const TASTE_NAME = Object.fromEntries(TASTES.map((t) => [t.id, t.name]));

export function createAtlas(contentEl, { onNavigate } = {}) {
  const state = { cuisine: '', taste: '', q: '', page: 0 };

  const root = h('div', { class: 'atlas' });
  const barL = h('div', { class: 'atlas__bar' });
  const barR = h('div', { class: 'atlas__bar atlas__bar--right' });
  const gridL = h('div', { class: 'atlas__grid' });
  const gridR = h('div', { class: 'atlas__grid' });
  const pageL = h('div', { class: 'atlas__page' }, barL, gridL);
  const pageR = h('div', { class: 'atlas__page' }, barR, gridR);
  root.append(pageL, pageR);

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return DISHES.filter((d) => {
      if (state.cuisine && d.cuisine !== state.cuisine) return false;
      if (state.taste && !(d.tastes || []).includes(state.taste)) return false;
      if (!q) return true;
      return (
        d.name.includes(q) ||
        String(d.nameEn || '').toLowerCase().includes(q) ||
        (d.ingredients || []).some((i) => i.includes(q))
      );
    });
  }

  function card(d) {
    return h(
      'a',
      { class: 'atlas__card', href: `/dishes/${d.id}`, 'data-link': '', 'data-dish': d.id },
      h(
        'div',
        { class: 'atlas__media' },
        d.image ? h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }) : null
      ),
      h(
        'div',
        { class: 'atlas__body' },
        h('h3', { class: 'atlas__name', text: d.name }),
        h(
          'div',
          { class: 'atlas__tags' },
          h('span', { class: 'atlas__tag', text: CUISINE_NAME[d.cuisine] || '' }),
          (d.tastes || [])[0] ? h('span', { class: 'atlas__tag atlas__tag--soft', text: TASTE_NAME[d.tastes[0]] || '' }) : null
        ),
        h('p', { class: 'atlas__desc', text: (d.oneLiner || d.intro || '').slice(0, 34) })
      )
    );
  }

  function paintBar() {
    clear(barL);
    barL.append(
      h('div', { class: 'atlas__title' }, h('b', { text: '中国美食图鉴' }), h('span', { text: `${filtered().length} 道` })),
      h(
        'div',
        { class: 'atlas__chips' },
        h(
          'button',
          {
            class: `atlas__chip${state.cuisine ? '' : ' is-on'}`,
            type: 'button',
            onclick: () => {
              state.cuisine = '';
              state.page = 0;
              paint();
            },
          },
          '全部'
        ),
        ...CUISINES.map((c) =>
          h(
            'button',
            {
              class: `atlas__chip${state.cuisine === c.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                state.cuisine = state.cuisine === c.id ? '' : c.id;
                state.page = 0;
                paint();
              },
            },
            c.name
          )
        )
      ),
      h(
        'div',
        { class: 'atlas__chips atlas__chips--taste' },
        ...TASTES.slice(0, 6).map((t) =>
          h(
            'button',
            {
              class: `atlas__chip atlas__chip--taste${state.taste === t.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                state.taste = state.taste === t.id ? '' : t.id;
                state.page = 0;
                paint();
              },
            },
            t.name
          )
        )
      )
    );

    const input = h('input', {
      class: 'atlas__search',
      type: 'search',
      placeholder: '搜菜名 / 食材',
      value: state.q,
      'aria-label': '搜索菜品',
    });
    input.addEventListener('input', () => {
      state.q = input.value;
      state.page = 0;
      paint(false);
    });
    barL.append(input);
  }

  function paintBarRight() {
    clear(barR);
    const single = perScreen() === PER_PAGE;
    const spreads = splitSpreads(filtered(), single);
    const cur = Math.min(state.page, Math.max(0, spreads.length - 1));
    const left = single ? cur + 1 : cur * 2 + 1;
    const right = single ? left : left + 1;
    const last = single ? Math.max(1, spreads.length) : Math.max(2, spreads.length * 2);
    barR.append(
      h(
        'div',
        { class: 'atlas__pager' },
        h('span', { class: 'atlas__pagenum', text: single ? `第 ${left} 页 / 共 ${last} 页` : `第 ${left}–${right} 页 / 共 ${last} 页` }),
        h('span', { class: 'atlas__pagetip', text: single ? '每页 4 道 · 页脚翻页' : '左页先、右页后 · 每跨页 6–8 道' })
      )
    );
  }

  function paint(withBar = true) {
    if (withBar) paintBar();
    paintBarRight();
    const single = perScreen() === PER_PAGE;
    const spreads = splitSpreads(filtered(), single);
    if (state.page >= spreads.length) state.page = Math.max(0, spreads.length - 1);
    const [leftItems, rightItems] = spreads[state.page] || [[], []];
    clear(gridL);
    clear(gridR);
    leftItems.forEach((d) => gridL.append(card(d)));
    rightItems.forEach((d) => gridR.append(card(d)));
    if (!leftItems.length && !rightItems.length) {
      gridL.append(h('p', { class: 'atlas__empty', text: '没有符合条件的菜' }));
    }
    if (!single && leftItems.length && !rightItems.length) {
      // 极端情况（只筛出 1 道）：右页留真实的同类推荐，避免整页空白
      const used = new Set(leftItems.map((d) => d.id));
      const picks = DISHES.filter((d) => !used.has(d.id) && d.cuisine === leftItems[0].cuisine).slice(0, 2);
      gridR.append(
        h('p', { class: 'atlas__filler-title', text: '同菜系还值得看' }),
        ...picks.map((d) => card(d))
      );
    }
  }

  paint();

  /** 当前每屏是单页还是双页 */
  const singleMode = () => perScreen() === PER_PAGE;
  /** 跨页总数（单页模式下就是页数） */
  function spreadCount() {
    return Math.max(1, splitSpreads(filtered(), singleMode()).length);
  }
  /** 当前跨页的左右页码（真实页码，左页奇数、右页偶数） */
  function pageNumbers() {
    const idx = Math.min(state.page, spreadCount() - 1);
    if (singleMode()) return [idx + 1, null];
    return [idx * 2 + 1, idx * 2 + 2];
  }

  return {
    el: root,
    get page() {
      return state.page;
    },
    get pages() {
      return singleMode() ? spreadCount() : spreadCount() * 2;
    },
    get spreadCount() {
      return spreadCount();
    },
    pageNumbers,
    hasPrev: () => state.page > 0,
    hasNext: () => state.page < spreadCount() - 1,
    prev() {
      if (state.page <= 0) return false;
      state.page -= 1;
      return true;
    },
    next() {
      if (state.page >= spreadCount() - 1) return false;
      state.page += 1;
      return true;
    },
    repaint: paint,
    mountInto(el) {
      el.append(root);
    },
  };
}
