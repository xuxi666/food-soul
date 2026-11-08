/**
 * 菜系 / 口味章节：双页杂志式分类页
 * ------------------------------------------------------------
 * 菜系页（kind === 'cuisine'）—— 第 32 轮定稿
 *   左页 = 一屏读完的菜系专题（不滚动就看完）：
 *          菜系导航 → 名称/简介 → 代表菜图 + 风味标签 + AI 入口 →
 *          风味档案（4 项）→ 美食文化（精简版）→ 代表菜精选
 *   右页 = 菜品图鉴：无页码、无翻页键，独立纵向滚动，
 *          列表底部一枚「加载更多」，点一次追加一批，到底显示「已到底」
 *
 *   上一轮左页里的「历史渊源」「人物典故」「名菜传说」三块独立模块已按要求撤掉；
 *   数据没有删（src/data/cuisineCulture.js 仍保留 history / figures / legends）。
 *
 * 口味页（kind === 'taste'）
 *   保持原版式（大主图 + 四行档案 + 精选 / 翻页目录），本轮不动。
 *
 * 两张纸各自独立滚动；点菜只在这一页里四边扩散成详情（book/overlay.js），
 * 不换章节、不翻书、不动另一页。
 */
import { h, clear } from '../lib/dom.js';
import { DISHES, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { cultureOf, cultureExtraOf } from '../data/cuisineCulture.js';
import { listCategoryDishes, fetchDishBatch, preloadDishImages } from '../data/dishFeed.js';
import { guardImage } from '../lib/placeholder.js';
import { openDishOverlay, closeAllOverlays } from './overlay.js';
import { appRoute } from './dish-page.js';

const PER_PAGE = 6; // 口味页每页 6 道；菜系页首屏也是 6 道（正好三行两列）
const PICKS = 3;
const MORE_LIMIT = 4; // 菜系页每次「加载更多」追加 4 道（两行）
/** 仅开发环境：让下一次「加载更多」失败，用来验证失败态（生产构建里永远是 false） */
let DEBUG_FAIL_NEXT = false;

/* ---------------- 数据派生（全部来自现有菜品字段，不编造） ---------------- */

const dishesOf = (kind, id) => listCategoryDishes(kind, id);

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

/* ---------------- 章节 ---------------- */

export function mountCategory(el, kind, id) {
  const state = {
    kind,
    id,
    page: 0, // 口味页页码
    loaded: PER_PAGE, // 菜系页游标：已经铺出来的条数
    loading: false,
    hasMore: true,
    error: false,
    requestId: 0, // 切换菜系后作废旧请求
  };

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

  /* ================= 左页 A：一屏读完的菜系专题 ================= */

  function paintLeftCuisine() {
    const m = meta();
    const culture = cultureOf(state.id);
    const extra = cultureExtraOf(state.id);
    if (!m) return;
    const list = dishes();
    const lead = list[0];
    const ingredients = topTokens(list, (d) => d.ingredients, 4);
    const crafts = topTokens(list, (d) => d.techniques, 3);
    const tastes = topTokens(list, (d) => (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name || t), 3);
    const tags = [...new Set([...(extra?.tags || []), ...tastes].filter(Boolean))].slice(0, 5);

    /* 代表菜图（比上一轮略大）+ 右侧简介 / 风味 / AI 入口 */
    const hero = lead
      ? h(
          'figure',
          { class: 'catb__hero catb__hero--lg' },
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

    const visual = h('div', { class: 'catb__visual catb__visual--lg' }, hero, aside);

    /* 风味档案：四项，全部真实取值 */
    const facts = h(
      'dl',
      { class: 'catb__facts catb__facts--cuisine' },
      ...[
        ['发源地', m.region || '—'],
        ['主要食材', ingredients.join(' · ') || '—'],
        ['烹饪技法', crafts.join(' · ') || '—'],
        ['典型味型', tastes.join(' · ') || m.tagline || '—'],
      ].map(([k, v]) => h('div', { class: 'catb__fact' }, h('dt', { text: k }), h('dd', { text: v || '—' })))
    );

    /* 美食文化（精简版）：一句破题 + 地域 / 日常 / 节庆三点 + 关键词 */
    const points = [
      ['地域', culture?.terrain],
      ['日常', culture?.habit],
      ['节庆', extra?.festive],
    ].filter(([, text]) => !!text);

    const cultureSec = h(
      'section',
      { class: 'catb__sec catb__sec--culture', 'data-sec': 'culture' },
      h('p', { class: 'catb__sec-kick' }, h('i', { text: '01' }), h('span', { text: '美食文化' })),
      culture?.culture?.lead ? h('p', { class: 'catb__lead', text: culture.culture.lead }) : null,
      points.length
        ? h(
            'ul',
            { class: 'catb__points' },
            ...points.map(([k, text]) => h('li', { class: 'catb__point' }, h('b', { class: 'catb__point-k', text: k }), h('span', { class: 'catb__point-v', text })))
          )
        : null,
      tags.length
        ? h('div', { class: 'catb__culture-tags' }, ...tags.map((t) => h('em', { class: 'catb__tag catb__tag--soft', text: t })))
        : null
    );

    const stack = h(
      'div',
      { class: 'catb__stack catb__stack--cuisine catb__stack--fit' },
      indexBlock(),
      headBlock(m),
      visual,
      facts,
      cultureSec,
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

  /* ================= 右页 A：菜系页，两列 + 显式「加载更多」 ================= */

  let rightGrid = null;
  let rightMore = null;
  let rightMoreBtn = null;
  let rightMoreLabel = null;
  let rightMoreText = null;

  function resetCursor(list) {
    state.loaded = Math.min(PER_PAGE, list.length);
    state.hasMore = state.loaded < list.length;
    state.loading = false;
    state.error = false;
  }

  function moreStatus(list) {
    if (!rightMoreBtn || !rightMoreText || !rightMoreLabel) return;
    const rest = Math.max(0, list.length - state.loaded);
    if (state.loading) {
      rightMoreBtn.disabled = true;
      rightMoreLabel.textContent = '正在加载…';
      rightMoreText.textContent = `还有 ${rest} 道`;
      rightMore.classList.add('is-loading');
      return;
    }
    rightMoreBtn.disabled = false;
    rightMore.classList.remove('is-loading');
    if (state.error) {
      rightMoreLabel.textContent = '重新加载';
      rightMoreText.textContent = '加载失败，请再试一次';
      rightMore.hidden = false;
      return;
    }
    if (state.hasMore) {
      rightMoreLabel.textContent = '加载更多';
      rightMoreText.textContent = `还有 ${rest} 道`;
      rightMore.hidden = false;
    } else {
      rightMoreLabel.textContent = '加载更多';
      rightMoreText.textContent = `已到底 · 共 ${list.length} 道`;
      rightMore.hidden = true; // 没有更多时按钮收起来，只留一行低调的收尾
    }
  }

  /** 点一次「加载更多」：取下一批 → 追到末尾 → 滚动位置不动 */
  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    const token = ++state.requestId;
    const kind = state.kind;
    const id = state.id;
    state.loading = true;
    state.error = false;
    moreStatus(dishes());
    try {
      // 只在开发环境可注入的一次失败，用来验证失败态（生产构建里不存在）
      if (import.meta.env?.DEV && DEBUG_FAIL_NEXT) {
        DEBUG_FAIL_NEXT = false;
        throw new Error('debug: load-more failure');
      }
      const batch = await fetchDishBatch(kind, id, { offset: state.loaded, limit: MORE_LIMIT });
      // 期间换了菜系 / 又点了一次：这批作废，绝不混进别的分类
      if (token !== state.requestId || batch.kind !== state.kind || batch.id !== state.id) return;
      await preloadDishImages(batch.items);
      if (token !== state.requestId || batch.id !== state.id) return;
      for (const d of batch.items) rightGrid.append(dishCard(d));
      state.loaded = batch.nextOffset;
      state.hasMore = batch.hasMore;
    } catch (err) {
      if (token === state.requestId) state.error = true;
      if (import.meta.env?.DEV) console.warn('[catb] 加载更多失败', err);
    } finally {
      if (token === state.requestId) {
        state.loading = false;
        moreStatus(dishes());
      }
    }
  }

  function paintRightCuisine() {
    const m = meta();
    if (!m) return;
    const list = dishes();
    resetCursor(list);

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

    rightMoreBtn = h(
      'button',
      {
        class: 'catb__more-btn',
        type: 'button',
        'data-act': 'more',
        onclick: () => void loadMore(),
      },
      h('span', { class: 'catb__more-label', text: '加载更多' }),
      h('i', { class: 'catb__more-ico', 'aria-hidden': 'true' })
    );
    rightMoreLabel = rightMoreBtn.querySelector('.catb__more-label');
    rightMoreText = h('p', { class: 'catb__more-status' });
    rightMore = h('div', { class: 'catb__more' }, rightMoreBtn, rightMoreText);
    moreStatus(list);

    clear(rightScroll);
    rightScroll.append(h('div', { class: 'catb__stack catb__stack--deck' }, top, rightGrid, rightMore));
    rightScroll.scrollTop = 0;
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
    state.requestId += 1; // 作废还在路上的旧批次
    state.loaded = PER_PAGE;
    state.loading = false;
    state.hasMore = true;
    state.error = false;
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

  if (import.meta.env?.DEV) {
    // 验收用的小开关：下一次「加载更多」直接失败，看失败提示与重试
    window.__catDebug = {
      failNextMore() {
        DEBUG_FAIL_NEXT = true;
      },
    };
  }

  return {
    el: root,
    /** 地址里带了别的分类（书签 / 深链接 / 前进后退）：只换内容，不重建纸面 */
    update(nextKind, nextId) {
      if (nextKind === state.kind && nextId === state.id) return;
      state.kind = nextKind;
      state.id = nextId;
      state.page = 0;
      state.requestId += 1;
      state.loaded = PER_PAGE;
      state.loading = false;
      state.hasMore = true;
      state.error = false;
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
    /** 「加载更多」：按钮点击走这里，也允许外部显式调用（测试/自动化） */
    loadMore,
    get state() {
      return {
        kind: state.kind,
        id: state.id,
        page: state.page,
        loaded: state.loaded,
        loading: state.loading,
        hasMore: state.hasMore,
        total: dishes().length,
      };
    },
    destroy() {
      closeAllOverlays({ instant: true });
      root.remove();
    },
  };
}