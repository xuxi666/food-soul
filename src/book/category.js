/**
 * 菜系 / 口味章节：双页杂志式分类页
 * ------------------------------------------------------------
 * 左页 = 专题介绍：分类索引 → 标题 → 代表菜主视觉 → 菜系档案 →
 *        风味特征 → 底部精选 3 道菜
 * 右页 = 菜品目录：页头（名称 / 总数 / 说明 / 翻页）+ 两列卡片
 *
 * 两张纸各自独立滚动；点菜只在这一页里四边扩散成详情（book/overlay.js），
 * 不换章节、不翻书、不动另一页。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { guardImage } from '../lib/placeholder.js';
import { openDishOverlay, closeAllOverlays } from './overlay.js';

const PER_PAGE = 6;
const PICKS = 3;

/* ---------------- 数据派生（全部来自现有菜品字段，不编造） ---------------- */

function dishesOf(kind, id) {
  const list = DISHES.filter((d) => (kind === 'taste' ? (d.tastes || []).includes(id) : d.cuisine === id));
  const seenName = new Set();
  const seenImage = new Set();
  return list.filter((d) => {
    if (!d.image || seenName.has(d.name) || seenImage.has(d.image)) return false;
    seenName.add(d.name);
    seenImage.add(d.image);
    return true;
  });
}

/** 出现频次最高的词（食材 / 技法 / 风味词） */
function topTokens(list, pick, limit) {
  const map = new Map();
  for (const dish of list) {
    for (const raw of pick(dish) || []) {
      for (const token of String(raw).split(/[、·,，/|]+/)) {
        const t = token.trim();
        if (!t || t.length > 6) continue;
        map.set(t, (map.get(t) || 0) + 1);
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, limit);
}

function flavorTags(kind, id, list) {
  const tags = topTokens(list, (d) => [d.signature], 6);
  if (kind === 'taste') {
    const name = TASTE_BY_ID[id]?.name;
    const extra = topTokens(list, (d) => d.tastes.map((t) => TASTE_BY_ID[t]?.name || t), 4);
    return [...new Set([name, ...tags, ...extra].filter(Boolean))].slice(0, 7);
  }
  return tags;
}

const minutes = (d) => (d.prep || 0) + (d.cook || 0);

/* ---------------- 章节 ---------------- */

export function mountCategory(el, kind, id) {
  const state = { kind, id, page: 0 };

  const isTaste = () => state.kind === 'taste';
  const meta = () => (isTaste() ? TASTE_BY_ID[state.id] : CUISINE_BY_ID[state.id]);
  const dishes = () => dishesOf(state.kind, state.id);

  const leftScroll = h('div', { class: 'catb__scroll catb__scroll--left' });
  const rightScroll = h('div', { class: 'catb__scroll catb__scroll--right' });
  const leftPage = h('div', { class: 'catb__page catb__page--left', 'data-side': 'left' }, leftScroll);
  const rightPage = h('div', { class: 'catb__page catb__page--right', 'data-side': 'right' }, rightScroll);

  const root = h('div', { class: 'catb' }, leftPage, rightPage);
  el.append(root);

  /* ---------- 左页 ---------- */
  function paintLeft() {
    const m = meta();
    if (!m) return;
    const list = dishes();
    const lead = list[0];
    const tags = flavorTags(state.kind, state.id, list);
    const ingredients = topTokens(list, (d) => d.ingredients, 4);
    const crafts = topTokens(list, (d) => d.techniques, 4);
    const tastes = topTokens(list, (d) => d.tastes.map((t) => TASTE_BY_ID[t]?.name || t), 3);
    const cuisines = topTokens(list, (d) => [CUISINE_BY_ID[d.cuisine]?.name], 3);

    const rows = isTaste()
      ? [
          ['味觉', m.desc],
          ['常见于', cuisines.join(' · ') || '—'],
          ['代表食材', ingredients.join(' · ') || '—'],
          ['主要技法', crafts.join(' · ') || '—'],
        ]
      : [
          ['发源地', m.region || '—'],
          ['代表食材', ingredients.join(' · ') || '—'],
          ['主要技法', crafts.join(' · ') || '—'],
          ['常见味型', tastes.join(' · ') || '—'],
        ];

    const index = h(
      'div',
      { class: 'catb__index' },
      h('p', { class: 'catb__index-kicker', text: isTaste() ? '味型索引' : '菜系索引' }),
      h(
        'div',
        { class: 'catb__chips' },
        ...(isTaste() ? TASTES : CUISINES).map((c) =>
          h(
            'button',
            {
              class: `catb__chip${c.id === state.id ? ' is-on' : ''}`,
              type: 'button',
              'data-chip': c.id,
              onclick: () => switchTo(c.id),
            },
            c.name
          )
        )
      )
    );

    const head = h(
      'header',
      { class: 'catb__head' },
      h('p', { class: 'catb__kicker', text: isTaste() ? 'FLAVOR · 口味探索' : 'CUISINE · 菜系' }),
      h(
        'h1',
        { class: 'catb__title' },
        m.name,
        m.en ? h('span', { class: 'catb__en', text: m.en }) : null
      ),
      h('p', { class: 'catb__tagline', text: isTaste() ? `「${m.name}」味型 · ${list.length} 道菜` : m.tagline || '' }),
      h('p', { class: 'catb__desc', text: isTaste() ? m.desc : m.desc })
    );

    const hero = lead
      ? h(
          'figure',
          { class: 'catb__hero' },
          guardImage(
            h('img', { src: lead.image, alt: lead.alt || lead.name, loading: 'eager', decoding: 'async' }),
            lead.name,
            '图片暂不可用'
          ),
          h(
            'figcaption',
            { class: 'catb__hero-cap' },
            h('b', { text: lead.name }),
            h('span', { text: lead.oneLiner || lead.intro || '' })
          ),
          h('span', { class: 'catb__hero-tag', text: '代表菜' })
        )
      : null;

    const facts = h(
      'dl',
      { class: 'catb__facts' },
      ...rows.map(([k, v]) => h('div', { class: 'catb__fact' }, h('dt', { text: k }), h('dd', { text: v || '—' })))
    );

    const flavor = tags.length
      ? h(
          'div',
          { class: 'catb__flavor' },
          h('p', { class: 'catb__flavor-kicker', text: '风味特征' }),
          h('div', { class: 'catb__tags' }, ...tags.map((t) => h('em', { class: 'catb__tag', text: t })))
        )
      : null;

    const picks = h(
      'div',
      { class: 'catb__picks' },
      h('p', { class: 'catb__picks-kicker', text: '精选菜品' }),
      h(
        'div',
        { class: 'catb__pick-row' },
        ...list.slice(0, PICKS).map((d) =>
          h(
            'button',
            { class: 'catb__pick', type: 'button', 'data-act': 'dish', 'data-dish': d.id, 'aria-label': `查看${d.name}` },
            h(
              'span',
              { class: 'catb__pick-media' },
              guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }), d.name, '')
            ),
            h('span', { class: 'catb__pick-name', text: d.name }),
            h('span', { class: 'catb__pick-sig', text: d.signature || '' })
          )
        )
      )
    );

    const stack = h('div', { class: 'catb__stack' }, index, head, hero, facts, flavor, picks);
    clear(leftScroll);
    leftScroll.append(stack);
  }

  /* ---------- 右页 ---------- */
  function dishCard(d) {
    const tastes = (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name).filter(Boolean);
    const mins = minutes(d);
    return h(
      'article',
      { class: 'catb__card', 'data-dish': d.id },
      h(
        'button',
        { class: 'catb__card-media', type: 'button', 'data-act': 'dish', 'data-dish': d.id, 'aria-label': `查看${d.name}详情` },
        guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }), d.name, '图片暂不可用')
      ),
      h(
        'button',
        { class: 'catb__card-body', type: 'button', 'data-act': 'dish', 'data-dish': d.id },
        h(
          'span',
          { class: 'catb__card-head' },
          h('b', { class: 'catb__card-name', text: d.name }),
          h('em', { class: 'catb__card-cuisine', text: CUISINE_BY_ID[d.cuisine]?.name || '' })
        ),
        h('span', { class: 'catb__card-line', text: d.oneLiner || d.intro || '' }),
        h(
          'span',
          { class: 'catb__card-meta' },
          ...tastes.slice(0, 2).map((t) => h('i', { class: 'catb__card-tag', text: t })),
          mins ? h('i', { class: 'catb__card-tag is-soft', text: `${mins} 分钟` }) : null,
          h('i', { class: 'catb__card-tag is-soft', text: DIFFICULTY_LABEL[d.difficulty] || '' })
        )
      )
    );
  }

  function paintRight() {
    const m = meta();
    if (!m) return;
    const list = dishes();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page >= pages) state.page = pages - 1;
    const slice = list.slice(state.page * PER_PAGE, state.page * PER_PAGE + PER_PAGE);

    const top = h(
      'header',
      { class: 'catb__top' },
      h(
        'div',
        { class: 'catb__top-copy' },
        h('h2', { class: 'catb__top-title', text: `${m.name} · 菜品目录` }),
        h('p', { class: 'catb__top-meta', text: `共 ${list.length} 道 · 第 ${state.page + 1} / ${pages} 页` }),
        h('p', {
          class: 'catb__top-note',
          text: `${isTaste() ? '味型' : '菜系'}档案在左页 · 点图片在本页展开详情`,
        })
      ),
      pages > 1
        ? h(
            'div',
            { class: 'catb__pager' },
            h(
              'button',
              {
                class: 'catb__turn',
                type: 'button',
                disabled: state.page <= 0 ? '' : null,
                'aria-label': '上一页',
                onclick: () => {
                  if (state.page <= 0) return;
                  state.page -= 1;
                  paintRight();
                },
              },
              '‹'
            ),
            h('span', { class: 'catb__pager-now', text: `${state.page + 1}/${pages}` }),
            h(
              'button',
              {
                class: 'catb__turn',
                type: 'button',
                disabled: state.page >= pages - 1 ? '' : null,
                'aria-label': '下一页',
                onclick: () => {
                  if (state.page >= pages - 1) return;
                  state.page += 1;
                  paintRight();
                },
              },
              '›'
            )
          )
        : null
    );

    const grid = h(
      'div',
      { class: 'catb__grid' },
      ...slice.map(dishCard),
      ...(slice.length ? [] : [h('p', { class: 'catb__empty', text: '这个分类暂时没有菜' })])
    );

    const scrollTop = rightScroll.scrollTop;
    clear(rightScroll);
    rightScroll.append(h('div', { class: 'catb__stack' }, top, grid));
    rightScroll.scrollTop = scrollTop;
  }

  function paint() {
    paintLeft();
    paintRight();
  }

  /* ---------- 分类切换（同一跨页原地换内容，只改地址不翻书） ---------- */
  let onSwitch = null;
  function switchTo(nextId) {
    if (!nextId || nextId === state.id) return;
    closeAllOverlays({ instant: true });
    state.id = nextId;
    state.page = 0;
    paint();
    const href = isTaste() ? `/tastes/${nextId}` : `/cuisines/${nextId}`;
    if (location.pathname !== href) history.replaceState({ path: href }, '', href);
    onSwitch?.(href);
  }

  /* ---------- 点菜：只在这一页里扩散 ----------
   * 注意：.catb__page--left/right 会被书页模块搬进各自的纸面里，
   * .catb 本身不会进 DOM，所以监听必须挂在两张纸上（root 上只作兜底）。
   */
  function onDeckClick(e) {
    const act = e.target.closest('[data-act="dish"]');
    if (!act) return;
    const dishId = act.closest('[data-dish]')?.dataset.dish || act.dataset.dish;
    if (!dishId) return;
    e.preventDefault();
    e.stopPropagation();
    const host = act.closest('.bk-pageface') || root;
    const origin = act.querySelector('img') || act;
    openDishOverlay(host, {
      dishId,
      origin,
      backLabel: '返回目录',
      accent: isTaste() ? meta()?.color || '#b0794a' : meta()?.accent || '#b0794a',
    });
  }
  leftPage.addEventListener('click', onDeckClick);
  rightPage.addEventListener('click', onDeckClick);

  paint();

  return {
    el: root,
    /** 地址里带了别的分类（书签 / 深链接 / 前进后退）：只换内容，不重建纸面 */
    update(nextKind, nextId) {
      if (nextKind === state.kind && nextId === state.id) return;
      state.kind = nextKind;
      state.id = nextId;
      state.page = 0;
      closeAllOverlays({ instant: true });
      paint();
    },
    /** 书的翻页/合书/换章前调用：把还开着的页内详情原地收掉 */
    closeAll() {
      closeAllOverlays({ instant: true });
    },
    setSwitchHandler(fn) {
      onSwitch = fn;
    },
    get state() {
      return { ...state, kind: state.kind, id: state.id, page: state.page, total: dishes().length };
    },
    destroy() {
      closeAllOverlays({ instant: true });
      root.remove();
    },
  };
}