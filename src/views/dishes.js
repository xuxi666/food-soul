import { h, clear, swap, toast } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, TASTES } from '../data/cuisines.js';
import { dishCard } from './category.js';
import {
  catalogState,
  catalogMeta,
  hydrateCatalog,
  loadMoreDishes,
  catalogMoreBar,
  CATALOG_STEP,
} from '../lib/catalog.js';

/**
 * 中国美食图鉴：分类 + 搜索 + 分页展示。
 * 默认每个分类只展示 10 道；「加载更多」每次追加 3 道——
 * 优先复用已保存的 AI 检索菜，没有时联网检索同分类新菜（服务端去重、真实图片落盘）。
 * 分页/缓存逻辑与菜系页、口味页共用 src/lib/catalog.js。
 */

export default {
  async mount(root) {
    let mode = 'cuisine';
    let activeId = '';
    let query = '';

    const chips = h('div', { class: 'board__chips' });
    const grid = h('div', { class: 'dish-grid', role: 'list' });
    const count = h('p', { class: 'board__count' });
    const moreHost = h('div', { class: 'catalog-more-host' });

    const seg = h(
      'div',
      { class: 'seg', role: 'tablist' },
      h('button', { class: 'seg__btn is-on', type: 'button', 'data-mode': 'cuisine' }, '按菜系'),
      h('button', { class: 'seg__btn', type: 'button', 'data-mode': 'taste' }, '按口味')
    );

    const search = h('input', {
      class: 'field__input catalog-search',
      type: 'search',
      placeholder: '搜索当前已展示的菜名 / 食材',
      'aria-label': '搜索菜品',
    });
    search.addEventListener('input', () => {
      query = search.value.trim();
      paint();
    });

    const current = () => catalogState(mode, activeId);

    function matchesQuery(d) {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        d.name.includes(q) ||
        String(d.nameEn || '').toLowerCase().includes(q) ||
        (d.ingredients || []).some((i) => i.includes(q)) ||
        String(d.signature || '').includes(q) ||
        String(d.intro || '').includes(q)
      );
    }

    function labelText(st) {
      if (!st.id) return '全部';
      const list = st.mode === 'cuisine' ? CUISINES : TASTES;
      return list.find((c) => c.id === st.id)?.name || st.id;
    }

    function paint(withFade = false) {
      const st = current();
      const list = st.items.filter(matchesQuery);
      const draw = () => {
        clear(grid);
        list.forEach((d) => grid.append(dishCard(d)));
        if (!list.length) {
          grid.append(
            h('div', {
              class: 'empty-state',
              text: query
                ? `当前分类已展示的 ${st.items.length} 道里没有匹配「${query}」的菜。可以清空搜索或「加载更多」后再试。`
                : '没有匹配的菜，换个词试试。',
            })
          );
        }
      };
      if (withFade) swap(grid, draw, 90);
      else draw();

      const brief = catalogMeta(st);
      const aiNote = brief.aiCount ? ` · 其中 AI 检索 ${brief.aiCount} 道` : '';
      count.textContent = query
        ? `搜索到 ${list.length} 道 · 当前分类已展示 ${brief.shown} 道${aiNote}`
        : `共 ${brief.total} 道 · 已展示 ${brief.shown} 道${aiNote}`;

      clear(moreHost);
      const bar = catalogMoreBar({
        state: () => st,
        note: `每次追加 ${CATALOG_STEP} 道：优先复用已保存的 AI 检索菜，没有时联网检索「${labelText(st)}」新菜并校验图片去重。`,
        onLoad: async () => {
          const res = await loadMoreDishes(st.kind, st.id);
          if (res.fresh?.length) toast(`新增 ${res.fresh.length} 道 AI 检索菜品`);
          paint();
        },
      });
      bar.el.hidden = Boolean(query);
      moreHost.append(bar.el);

      if (!st.hydrated) {
        hydrateCatalog(st.kind, st.id).then(() => {
          if (current().key === st.key) paint();
        });
      }
    }

    function renderChips() {
      clear(chips);
      chips.append(
        h(
          'button',
          {
            class: `chip-tab${activeId ? '' : ' is-on'}`,
            type: 'button',
            onclick: () => {
              activeId = '';
              renderChips();
              paint(true);
            },
          },
          '全部',
          h('em', { text: 'ALL' })
        )
      );
      const list = mode === 'cuisine' ? CUISINES : TASTES;
      list.forEach((c) => {
        chips.append(
          h(
            'button',
            {
              class: `chip-tab${activeId === c.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                activeId = c.id;
                renderChips();
                paint(true);
              },
            },
            c.name,
            h('em', { text: c.en })
          )
        );
      });
      chips.classList.toggle('is-taste', mode === 'taste');
    }

    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn || btn.dataset.mode === mode) return;
      mode = btn.dataset.mode;
      activeId = '';
      seg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-on', b === btn));
      renderChips();
      paint(true);
    });

    const page = h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'wrap' },
        h(
          'div',
          { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回'),
          h(
            'div',
            {},
            h('h1', { class: 'page-head__title', text: '中国美食图鉴' }),
            h('p', { class: 'page-head__sub', text: `${DISHES.length} DISHES · 8 CUISINES · 8 TASTES` })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: '/community', 'data-link': '' }, '去社区讨论')
        ),
        h('div', { class: 'catalog-bar' }, seg, search),
        h(
          'div',
          { class: 'board board--flat' },
          h('div', { class: 'board__aside' }, chips),
          h('div', { class: 'board__main' }, count, grid, moreHost)
        )
      )
    );

    root.append(page);
    renderChips();
    paint();
    return { destroy() {} };
  },
};
