/**
 * 图鉴章节：左右两页按「从左到右、先左页后右页」排列菜品。
 * 每跨页 8 道（每页 2×2），放不下就翻页，不滚动整页。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, TASTES } from '../data/cuisines.js';

const PER_PAGE = 4;
const PER_SPREAD = PER_PAGE * 2;

/** 手机端只显示一页，每屏 4 道 */
const perScreen = () => (window.innerWidth <= 860 ? PER_PAGE : PER_SPREAD);

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

  function totalPages() {
    return Math.max(1, Math.ceil(filtered().length / perScreen()));
  }

  function card(d) {
    return h(
      'a',
      { class: 'atlas__card', href: `/dishes/${d.id}`, 'data-link': '', 'data-dish': d.id },
      h(
        'div',
        { class: 'atlas__media' },
        d.image ? h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy' }) : null
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
    const pages = totalPages();
    barR.append(
      h('div', { class: 'atlas__pager' },
        h('span', { class: 'atlas__pagenum', text: `${String(state.page + 1).padStart(2, '0')} / ${String(pages).padStart(2, '0')}` }),
        h('span', { class: 'atlas__pagetip', text: perScreen() === PER_SPREAD ? '左右两页共 8 道 · 页脚翻页' : '每页 4 道 · 页脚翻页' })
      )
    );
  }

  function paint(withBar = true) {
    if (withBar) paintBar();
    paintBarRight();
    const list = filtered();
    const step = perScreen();
    const start = state.page * step;
    const slice = list.slice(start, start + step);
    clear(gridL);
    clear(gridR);
    slice.slice(0, PER_PAGE).forEach((d) => gridL.append(card(d)));
    slice.slice(PER_PAGE).forEach((d) => gridR.append(card(d)));
    if (!slice.length) {
      gridL.append(h('p', { class: 'atlas__empty', text: '没有符合条件的菜' }));
    }
  }

  paint();

  return {
    el: root,
    get page() {
      return state.page;
    },
    get pages() {
      return totalPages();
    },
    hasPrev: () => state.page > 0,
    hasNext: () => state.page < totalPages() - 1,
    prev() {
      if (state.page <= 0) return false;
      state.page -= 1;
      return true;
    },
    next() {
      if (state.page >= totalPages() - 1) return false;
      state.page += 1;
      return true;
    },
    repaint: paint,
    mountInto(el) {
      el.append(root);
    },
  };
}
