/**
 * 图鉴章节：每页 3–4 道菜，一页一块「纸」，由书页栈摆到左右两页上。
 * 筛选面板只在图鉴第一页（左页）出现；其余页脚给出当前筛选状态。
 * 数据全部来自 src/data/dishes.js，不编造。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';

const PER_PAGE = 4;

const CUISINE_NAME = Object.fromEntries(CUISINES.map((c) => [c.id, c.name]));
const TASTE_NAME = Object.fromEntries(TASTES.map((t) => [t.id, t.name]));

export function createAtlas({ onChange } = {}) {
  const state = { cuisine: '', taste: '', q: '' };
  const pages = new Map(); // 页码索引 → { el, grid, foot, idx }

  const filtered = () =>
    DISHES.filter((d) => {
      if (state.cuisine && d.cuisine !== state.cuisine) return false;
      if (state.taste && !(d.tastes || []).includes(state.taste)) return false;
      const q = state.q.trim().toLowerCase();
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.alt || '').toLowerCase().includes(q) ||
        (d.ingredients || []).some((i) => i.includes(state.q.trim()))
      );
    });

  /** 页数保持偶数：一跨页正好两页，不出现「半张纸」 */
  function shape() {
    const n = filtered().length;
    if (!n) return { count: 0, sizes: [] };
    const raw = Math.ceil(n / PER_PAGE);
    const count = Math.max(2, raw + (raw % 2));
    const base = Math.floor(n / count);
    const rest = n % count;
    const sizes = Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
    return { count, sizes };
  }

  const pageCount = () => shape().count;
  const spreadCount = () => Math.ceil(pageCount() / 2);

  function sliceOf(pageIndex) {
    const { sizes } = shape();
    let at = 0;
    for (let i = 0; i < pageIndex && i < sizes.length; i++) at += sizes[i];
    return filtered().slice(at, at + (sizes[pageIndex] || 0));
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

  /** 筛选状态一句话；点了回到第一页 */
  function filterLine() {
    const bits = [];
    if (state.cuisine) bits.push(CUISINE_NAME[state.cuisine]);
    if (state.taste) bits.push(`${TASTE_NAME[state.taste]}味`);
    if (state.q.trim()) bits.push(`“${state.q.trim()}”`);
    return bits.length ? bits.join(' · ') : '全部菜品';
  }

  function paintFilters(box) {
    clear(box);
    box.append(
      h(
        'div',
        { class: 'atlas__title' },
        h('b', { text: '中国美食图鉴' }),
        h('span', { text: `${filtered().length} 道` })
      ),
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
              commit();
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
                commit();
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
                commit();
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
      commit({ keepFocus: input });
    });
    box.append(input);
  }

  function commit({ keepFocus } = {}) {
    for (const page of pages.values()) page.rendered = null;
    for (const page of pages.values()) paintPage(page);
    onChange?.();
    if (keepFocus) {
      // 重绘会换掉输入框：把焦点和光标还回去
      const again = pages.get('0:left')?.filterBox?.querySelector('.atlas__search');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }
  }

  const stateKey = () => `${state.cuisine}|${state.taste}|${state.q}`;

  function paintPage(page) {
    // 内容没变就不重画：翻页动画结束时不会重新生成可见页面的 DOM
    const key = `${stateKey()}#${pageCount()}`;
    if (page.rendered === key && page.grid.childElementCount) return;
    page.rendered = key;
    const items = sliceOf(page.idx);
    clear(page.grid);
    items.forEach((d) => page.grid.append(card(d)));
    if (!items.length) page.grid.append(h('p', { class: 'atlas__empty', text: '没有符合条件的菜' }));
    if (page.foot) {
      clear(page.foot);
      page.foot.append(
        h('span', { class: 'atlas__pagenum', text: `第 ${page.idx + 1} 页 · 共 ${pageCount()} 页` }),
        h('span', { class: 'atlas__pagetip', text: filterLine() })
      );
    }
  }

  /** 生成第 idx 页的纸面（side: 'left' | 'right'） */
  function page(idx, side) {
    const key = `${idx}:${side}`;
    const cached = pages.get(key);
    if (cached) {
      paintPage(cached);
      return cached.el;
    }
    const grid = h('div', { class: 'atlas-page__grid' });
    let filterBox = null;
    if (side === 'left' && idx === 0) {
      filterBox = h('div', { class: 'atlas-page__filter' });
    }
    const head = h(
      'div',
      { class: 'atlas-page__head' },
      h('p', { class: 'atlas-page__kicker', text: side === 'left' ? '中国美食图鉴 · 左页' : '中国美食图鉴 · 右页' })
    );
    const foot = h('div', { class: 'atlas-page__foot' });
    const el = h('div', { class: 'atlas-page' }, head, filterBox, grid, foot);
    const pageRec = { el, grid, foot, idx, filterBox };
    pages.set(key, pageRec);
    if (filterBox) paintFilters(filterBox);
    paintPage(pageRec);
    return el;
  }

  return {
    page,
    pageCount,
    spreadCount,
    /** 数据变了（例如筛选后页数变化）时由书页栈调用 */
    reset() {
      pages.clear();
    },
    get filterLabel() {
      return filterLine();
    },
  };
}