/**
 * 菜系 / 口味章节：双页杂志式分类页
 * ------------------------------------------------------------
 * 菜系页（kind === 'cuisine'）
 *   左页 = 菜系文化专题：索引 → 标题 → 小主图 + 简介 / 风味 / AI 入口 →
 *          风味档案 → 美食文化 → 历史渊源 → 人物典故 → 名菜传说 → 代表菜精选
 *   右页 = 菜品图鉴：无页码、无翻页键，独立纵向滚动，滚到底分批加载更多
 *
 * 口味页（kind === 'taste'）
 *   保持第 28 轮的版式不变（大主图 + 档案 + 精选 / 翻页目录），
 *   本轮只改菜系页：两条分支各画各的，互不影响。
 *
 * 两张纸各自独立滚动；点菜只在这一页里四边扩散成详情（book/overlay.js），
 * 不换章节、不翻书、不动另一页。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { cultureOf } from '../data/cuisineCulture.js';
import { guardImage } from '../lib/placeholder.js';
import { openDishOverlay, closeAllOverlays } from './overlay.js';
import { appRoute } from './dish-page.js';

const PER_PAGE = 6; // 口味页每页 6 道；菜系页每次加载 6 道
/** 按菜名找菜（名菜传说要引用每道菜自己的 history 字段） */
const DISH_BY_NAME = new Map(DISHES.map((d) => [d.name, d]));
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

/**
 * 页面里的滚轮滚动。
 * 书页是 3D 变身过的纸（rotateY + backface-visibility），浏览器自带的
 * 「点在哪就滚哪」在这种子树里并不可靠（实测滚轮不生效、PageDown 却可以），
 * 所以在两张纸上显式把 deltaY 换算成 scrollTop：
 *   · 只有这一页真的还能滚时才接管，滚到底就把事件让回去；
 *   · ctrl + 滚轮是缩放，不动它；
 *   · 只滚自己的容器，不会带动另一页，也不会带动整本书。
 */
function enableWheelScroll(container) {
  container.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) return;
      const max = container.scrollHeight - container.clientHeight;
      if (max <= 0) return;
      const before = container.scrollTop;
      const next = Math.max(0, Math.min(max, before + e.deltaY));
      if (next === before) return;
      container.scrollTop = next;
      e.preventDefault();
    },
    { passive: false }
  );
}

/** 名菜传说：直接用每道菜自己的 history 字段，并标出它是「相传」还是「记载」 */
function legendKind(text) {
  return /相传|传说|据说|说法|附会|追述/.test(text || '') ? 'legend' : 'record';
}

/* ---------------- 章节 ---------------- */

export function mountCategory(el, kind, id) {
  const state = { kind, id, page: 0, loaded: PER_PAGE, loading: false };

  const isTaste = () => state.kind === 'taste';
  const meta = () => (isTaste() ? TASTE_BY_ID[state.id] : CUISINE_BY_ID[state.id]);
  const dishes = () => dishesOf(state.kind, state.id);

  const leftScroll = h('div', { class: 'catb__scroll catb__scroll--left' });
  const rightScroll = h('div', { class: 'catb__scroll catb__scroll--right' });
  const leftPage = h('div', { class: 'catb__page catb__page--left', 'data-side': 'left' }, leftScroll);
  const rightPage = h('div', { class: 'catb__page catb__page--right', 'data-side': 'right' }, rightScroll);

  enableWheelScroll(leftScroll);
  enableWheelScroll(rightScroll);

  const root = h('div', { class: 'catb' }, leftPage, rightPage);
  el.append(root);

  /* ---------- 公共零件 ---------- */

  function indexBlock() {
    return h(
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
  }

  function headBlock(m) {
    return h(
      'header',
      { class: 'catb__head' },
      h('p', { class: 'catb__kicker', text: isTaste() ? 'FLAVOR · 口味探索' : 'CUISINE · 菜系' }),
      h('h1', { class: 'catb__title' }, m.name, m.en ? h('span', { class: 'catb__en', text: m.en }) : null),
      h('p', { class: 'catb__tagline', text: isTaste() ? `「${m.name}」味型 · ${dishes().length} 道菜` : m.tagline || '' })
    );
  }

  function picksBlock(list) {
    return h(
      'div',
      { class: 'catb__picks' },
      h('p', { class: 'catb__picks-kicker', text: '代表菜精选' }),
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
  }

  /* ================= 左页 A：菜系文化专题 ================= */

  function paintLeftCuisine() {
    const m = meta();
    const culture = cultureOf(state.id);
    if (!m || !culture) return;
    const list = dishes();
    const lead = list[0];
    const tags = flavorTags('cuisine', state.id, list);
    const ingredients = topTokens(list, (d) => d.ingredients, 5);
    const crafts = topTokens(list, (d) => d.techniques, 5);
    const tastes = topTokens(list, (d) => (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name || t), 3);

    /* 主视觉 + 右侧简介 / 风味 / AI 入口 */
    const hero = lead
      ? h(
          'figure',
          { class: 'catb__hero catb__hero--sm' },
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

    const ai = h(
      'button',
      {
        class: 'catb__ai',
        type: 'button',
        'data-act': 'chat',
        'data-cuisine': state.id,
        'aria-label': `和${m.name}聊天`,
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          void appRoute(`/chat/cuisine/${state.id}`, e.currentTarget, m.accent || '#b03a2e');
        },
      },
      h('span', { class: 'catb__ai-ico', 'aria-hidden': 'true' }, h('i', {}), h('i', {})),
      h(
        'span',
        { class: 'catb__ai-copy' },
        h('b', { class: 'catb__ai-t', text: `和${m.name}聊天` }),
        h('span', { class: 'catb__ai-sub', text: '由该菜系的 AI 人格应答' })
      )
    );

    const aside = h(
      'div',
      { class: 'catb__aside' },
      h('p', { class: 'catb__desc', text: m.desc }),
      tags.length ? h('div', { class: 'catb__tags' }, ...tags.map((t) => h('em', { class: 'catb__tag', text: t }))) : null,
      ai
    );

    const visual = h('div', { class: 'catb__visual' }, hero, aside);

    /* 风味档案 */
    const rows = [
      ['发源地', m.region || '—'],
      ['地域特色', culture.terrain],
      ['主要食材', ingredients.join(' · ') || '—'],
      ['烹饪技法', crafts.join(' · ') || '—'],
      ['典型味型', tastes.join(' · ') || m.tagline || '—'],
      ['饮食特点', culture.habit],
    ];
    const facts = h(
      'dl',
      { class: 'catb__facts catb__facts--cuisine' },
      ...rows.map(([k, v]) => h('div', { class: 'catb__fact' }, h('dt', { text: k }), h('dd', { text: v || '—' })))
    );

    const secKick = (no, text) => h('p', { class: 'catb__sec-kick' }, h('i', { text: no }), h('span', { text }));

    /* 01 美食文化 */
    const cultureSec = h(
      'section',
      { class: 'catb__sec', 'data-sec': 'culture' },
      secKick('01', '美食文化'),
      h('p', { class: 'catb__lead', text: culture.culture.lead }),
      h('p', { class: 'catb__body', text: culture.culture.body }),
      h(
        'blockquote',
        { class: 'catb__quote' },
        h('p', { class: 'catb__quote-text', text: `「${culture.culture.quote.text}」` }),
        h(
          'cite',
          { class: 'catb__quote-from' },
          culture.culture.quote.from,
          culture.culture.quote.note ? h('em', { text: ` · ${culture.culture.quote.note}` }) : null
        )
      )
    );

    /* 02 历史渊源 */
    const historySec = h(
      'section',
      { class: 'catb__sec', 'data-sec': 'history' },
      secKick('02', '历史渊源'),
      h(
        'ol',
        { class: 'catb__line' },
        ...culture.history.map((item) =>
          h('li', {}, h('b', { class: 'catb__line-era', text: item.era }), h('span', { class: 'catb__line-text', text: item.text }))
        )
      )
    );

    /* 03 人物典故 */
    const figuresSec = h(
      'section',
      { class: 'catb__sec', 'data-sec': 'figures' },
      secKick('03', '人物典故'),
      h(
        'div',
        { class: 'catb__figs' },
        ...culture.figures.map((f) =>
          h(
            'article',
            { class: 'catb__fig' },
            h(
              'p',
              { class: 'catb__fig-head' },
              h('b', { class: 'catb__fig-name', text: f.name }),
              h('span', { class: 'catb__fig-era', text: f.era }),
              h(
                'span',
                { class: `catb__fig-badge${f.kind === 'legend' ? ' is-legend' : ''}` },
                f.kind === 'legend' ? '民间传说' : '史料'
              )
            ),
            h('p', { class: 'catb__fig-text', text: f.text })
          )
        )
      )
    );

    /* 04 名菜传说（文字全部来自菜品自己的 history 字段） */
    const legends = culture.legends
      .map((name) => {
        const d = list.find((x) => x.name === name) || DISH_BY_NAME.get(name);
        return d && d.history ? { dish: d, text: d.history } : null;
      })
      .filter(Boolean);
    const legendSec = legends.length
      ? h(
          'section',
          { class: 'catb__sec', 'data-sec': 'legends' },
          secKick('04', '名菜传说'),
          h(
            'div',
            { class: 'catb__legends' },
            ...legends.map(({ dish, text }) => {
              const kindOf = legendKind(text);
              return h(
                'article',
                { class: 'catb__legend' },
                h(
                  'span',
                  { class: 'catb__legend-media' },
                  guardImage(h('img', { src: dish.image, alt: dish.alt || dish.name, loading: 'lazy', decoding: 'async' }), dish.name, '')
                ),
                h(
                  'div',
                  { class: 'catb__legend-body' },
                  h(
                    'p',
                    { class: 'catb__legend-head' },
                    h('b', { class: 'catb__legend-name', text: dish.name }),
                    h('span', { class: `catb__legend-badge${kindOf === 'legend' ? ' is-legend' : ''}` }, kindOf === 'legend' ? '相传·民间说法' : '史料记载')
                  ),
                  h('p', { class: 'catb__legend-text', text })
                )
              );
            })
          )
        )
      : null;

    const stack = h(
      'div',
      { class: 'catb__stack catb__stack--cuisine' },
      indexBlock(),
      headBlock(m),
      visual,
      facts,
      cultureSec,
      historySec,
      figuresSec,
      legendSec,
      picksBlock(list)
    );

    clear(leftScroll);
    leftScroll.append(stack);
    leftScroll.scrollTop = 0;
  }

  /* ================= 左页 B：口味页（保持原样） ================= */

  function paintLeftTaste() {
    const m = meta();
    if (!m) return;
    const list = dishes();
    const lead = list[0];
    const tags = flavorTags(state.kind, state.id, list);
    const ingredients = topTokens(list, (d) => d.ingredients, 4);
    const crafts = topTokens(list, (d) => d.techniques, 4);
    const cuisines = topTokens(list, (d) => [CUISINE_BY_ID[d.cuisine]?.name], 3);

    const rows = [
      ['味觉', m.desc],
      ['常见于', cuisines.join(' · ') || '—'],
      ['代表食材', ingredients.join(' · ') || '—'],
      ['主要技法', crafts.join(' · ') || '—'],
    ];

    const head = h(
      'header',
      { class: 'catb__head' },
      h('p', { class: 'catb__kicker', text: 'FLAVOR · 口味探索' }),
      h('h1', { class: 'catb__title' }, m.name, m.en ? h('span', { class: 'catb__en', text: m.en }) : null),
      h('p', { class: 'catb__tagline', text: `「${m.name}」味型 · ${list.length} 道菜` }),
      h('p', { class: 'catb__desc', text: m.desc })
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

    const stack = h('div', { class: 'catb__stack' }, indexBlock(), head, hero, facts, flavor, picksBlock(list));
    clear(leftScroll);
    leftScroll.append(stack);
  }

  /* ================= 右页 A：菜系页，连续纵向滚动 + 分批加载 ================= */

  let rightGrid = null;
  let rightMore = null;
  let rightSentinel = null;
  let observer = null;
  /* 打开这一页时哨兵可能本来就在视野里：那只说明「还没翻就到底了」，
     要等读者真的滚动过一次，才允许自动续下一批，避免一进来就把全部菜品铺开 */
  let deckScrolled = false;

  /** 哨兵是否已经靠到可视区底部（rootMargin 240px 内） */
  function sentinelNear(extra = 240) {
    if (!rightSentinel || !rightScroll) return false;
    const box = rightScroll.getBoundingClientRect();
    const line = rightSentinel.getBoundingClientRect();
    return line.top - box.bottom < extra;
  }

  /* 滚动一发生就主动量一次：哨兵本来就在视野里时，IntersectionObserver
     不会再来一次「进入」回调，得自己补这一下 */
  rightScroll.addEventListener(
    'scroll',
    () => {
      deckScrolled = true;
      if (sentinelNear()) loadMore();
    },
    { passive: true }
  );

  function moreState(list) {
    if (!rightMore) return;
    const rest = list.length - state.loaded;
    clear(rightMore);
    if (rest > 0) {
      rightMore.append(
        h(
          'button',
          {
            class: 'catb__more-btn',
            type: 'button',
            'data-act': 'more',
            onclick: () => loadMore(),
          },
          `继续往下翻 · 还有 ${rest} 道`
        )
      );
    } else {
      rightMore.append(h('p', { class: 'catb__more-end', text: `已到底 · 共 ${list.length} 道` }));
    }
    rightMore.classList.toggle('is-loading', state.loading);
  }

  function appendBatch(list) {
    if (!rightGrid) return;
    const from = rightGrid.children.length;
    const next = list.slice(from, state.loaded);
    for (const d of next) rightGrid.append(dishCard(d));
  }

  function loadMore() {
    const list = dishes();
    if (state.loading || state.loaded >= list.length) return;
    state.loading = true;
    state.loaded = Math.min(list.length, state.loaded + PER_PAGE);
    rightMore?.classList.add('is-loading');
    const label = rightMore?.querySelector('.catb__more-btn');
    if (label) label.textContent = '正在翻页…';
    // 让「正在加载」这一帧先画出来，再补卡片，避免长任务卡住滚动
    window.setTimeout(() => {
      appendBatch(list);
      state.loading = false;
      moreState(list);
    }, 160);
  }

  function paintRightCuisine() {
    const m = meta();
    if (!m) return;
    const list = dishes();
    state.loaded = Math.min(Math.max(PER_PAGE, state.loaded || PER_PAGE), Math.max(list.length, PER_PAGE));

    const top = h(
      'header',
      { class: 'catb__top catb__top--cuisine' },
      h(
        'div',
        { class: 'catb__top-copy' },
        h('h2', { class: 'catb__top-title', text: `${m.name} · 菜品目录` }),
        h('p', { class: 'catb__top-meta', text: `共 ${list.length} 道 · 向下滚动，边看边加载` }),
        h('p', { class: 'catb__top-note', text: '菜系档案在左页 · 点图片在本页展开详情' })
      )
    );

    rightGrid = h('div', { class: 'catb__grid catb__grid--scroll' }, ...list.slice(0, state.loaded).map(dishCard));
    if (!list.length) rightGrid.append(h('p', { class: 'catb__empty', text: '这个分类暂时没有菜' }));
    rightMore = h('div', { class: 'catb__more' });
    rightSentinel = h('div', { class: 'catb__sentinel', 'aria-hidden': 'true' });
    moreState(list);

    clear(rightScroll);
    rightScroll.append(h('div', { class: 'catb__stack catb__stack--deck' }, top, rightGrid, rightMore, rightSentinel));
    rightScroll.scrollTop = 0;
    deckScrolled = false;

    observer?.disconnect();
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (!deckScrolled) return;
          if (entries.some((e) => e.isIntersecting)) loadMore();
        },
        { root: rightScroll, rootMargin: '0px 0px 240px 0px', threshold: 0.01 }
      );
      observer.observe(rightSentinel);
    }
  }

  /* ================= 右页 B：口味页（原分页目录，保持不动） ================= */

  function paintRightTaste() {
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
        h('p', { class: 'catb__top-note', text: `味型档案在左页 · 点图片在本页展开详情` })
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
                  paintRightTaste();
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
                  paintRightTaste();
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

  /* ---------- 菜品卡（两页共用） ---------- */
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

  function paint() {
    if (isTaste()) {
      paintLeftTaste();
      paintRightTaste();
      return;
    }
    paintLeftCuisine();
    paintRightCuisine();
  }

  /* ---------- 分类切换（同一跨页原地换内容，只改地址不翻书） ---------- */
  let onSwitch = null;
  function switchTo(nextId) {
    if (!nextId || nextId === state.id) return;
    closeAllOverlays({ instant: true });
    state.id = nextId;
    state.page = 0;
    state.loaded = PER_PAGE;
    state.loading = false;
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
      state.loaded = PER_PAGE;
      state.loading = false;
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
    /** 滚到底部时由 IntersectionObserver 自动触发，也允许外部显式调用 */
    loadMore,
    get state() {
      return { ...state, kind: state.kind, id: state.id, page: state.page, loaded: state.loaded, total: dishes().length };
    },
    destroy() {
      observer?.disconnect();
      observer = null;
      closeAllOverlays({ instant: true });
      root.remove();
    },
  };
}