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
import {
  listCategoryDishes,
  getFeed,
  primeAtlas,
  atlasRemaining,
  takeAtlasBatch,
  discoverBatch,
  retryDiscovery,
  ATLAS_BATCH,
  DISCOVER_BATCH,
} from '../data/dishFeed.js';
import { guardImage } from '../lib/placeholder.js';
import { openDishOverlay, closeAllOverlays } from './overlay.js';
import { appRoute } from './dish-page.js';

const PER_PAGE = 6; // 口味页每页 6 道；菜系页首屏也是 6 道（正好三行两列）
const PICKS = 3;
// 图鉴批次 / 发现批次由 data/dishFeed.js 统一定义（ATLAS_BATCH / DISCOVER_BATCH）
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
    loading: false,
    phase: '', // 'atlas' | 'discover'
    notice: '',
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

  /* ================= 左页 A：紧凑的菜系专题（一屏读完） ================= */

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
    const tags = [...new Set([...(extra?.tags || []), ...tastes].filter(Boolean))].slice(0, 4);

    /* ② 中部：代表菜主视觉（左 48%）+ 风味档案 / 简介 / AI 入口（右 52%） */
    const hero = lead
      ? h(
          'figure',
          { class: 'catb__hero catb__hero--split' },
          guardImage(
            h('img', { src: lead.image, alt: lead.alt || lead.name, loading: 'eager', decoding: 'async' }),
            lead.name,
            '图片暂不可用'
          ),
          h('span', { class: 'catb__hero-tag', text: '代表菜' }),
          h(
            'figcaption',
            { class: 'catb__hero-cap catb__hero-cap--over' },
            h('b', { text: lead.name }),
            h('span', { text: lead.oneLiner || lead.intro || '' })
          )
        )
      : null;

    const facts = h(
      'dl',
      { class: 'catb__panel-facts' },
      ...[
        ['发源地', m.region || '—'],
        ['代表食材', ingredients.join(' · ') || '—'],
        ['主要技法', crafts.join(' · ') || '—'],
        ['典型风味', tastes.join(' · ') || m.tagline || '—'],
      ].map(([k, v]) => h('div', { class: 'catb__panel-row' }, h('dt', { text: k }), h('dd', { text: v || '—' })))
    );

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

    const panel = h(
      'div',
      { class: 'catb__panel' },
      h('p', { class: 'catb__panel-desc', text: m.desc }),
      facts,
      tags.length
        ? h(
            'div',
            { class: 'catb__tagbox' },
            h('p', { class: 'catb__tagbox-k', text: '风味关键词' }),
            h('div', { class: 'catb__tags catb__tags--panel' }, ...tags.map((t) => h('em', { class: 'catb__tag', text: t })))
          )
        : null,
      ai
    );

    const visual = h('div', { class: 'catb__visual catb__visual--split' }, hero, panel);

    /* ③ 下部：美食文化三栏（共享一个横带，不拆成大卡片） */
    const cells = [
      ['地域风土', culture?.terrain],
      ['饮食文化', extra?.festive],
      ['烹饪特色', culture?.habit],
    ].filter(([, text]) => !!text);

    const band = h(
      'section',
      { class: 'catb__culture-band', 'data-sec': 'culture' },
      ...cells.map(([title, text], i) =>
        h(
          'div',
          { class: 'catb__cell' },
          h(
            'p',
            { class: 'catb__cell-k' },
            h('i', { class: 'catb__cell-n', text: String(i + 1).padStart(2, '0') }),
            h('span', { text: title })
          ),
          h('p', { class: 'catb__cell-b', text })
        )
      )
    );

    const story = culture?.culture || null;
    if (story?.quote?.text) {
      band.append(
        h(
          'p',
          { class: 'catb__band-quote' },
          h('span', { class: 'catb__band-q', text: `「${story.quote.text}」` }),
          h('em', { class: 'catb__band-from', text: story.quote.from || '' })
        )
      );
    }

    const stack = h(
      'div',
      { class: 'catb__stack catb__stack--cuisine catb__stack--fit' },
      indexBlock(),
      headBlock(m),
      visual,
      band,
      picksBlock(list)
    );

    clear(leftScroll);
    leftScroll.append(stack);
    leftScroll.scrollTop = 0;
  }/* ================= 左页 B：口味页（保持原样） ================= */

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

  /* ================= 右页 A：菜品目录 + 图鉴外发现 ================= */

  let rightGrid = null;
  let rightMore = null;
  let rightMoreBtn = null;
  let rightMoreLabel = null;
  let rightMoreText = null;
  let rightHeadMeta = null;
  let rightHeadHint = null;

  /** 当前分类的发现会话（按分类缓存，切走再切回来恢复已加载的卡片） */
  function currentFeed() {
    return getFeed(state.kind, state.id);
  }

  function discoveredCount(f = currentFeed()) {
    return f.items.filter((d) => f.sourceById.get(d.id) === 'discovered').length;
  }

  function paintRightHead(f = currentFeed()) {
    if (!rightHeadMeta) return;
    const newCount = discoveredCount(f);
    const atlasShown = f.items.length - newCount;
    rightHeadMeta.textContent = `已展示 ${f.items.length} 道 · 图鉴 ${atlasShown} 道${
      newCount ? ` · 新发现 ${newCount} 道` : ''
    }`;
    if (rightHeadHint) {
      const m = meta();
      rightHeadHint.textContent = newCount
        ? `继续探索${m?.name || ''}：图鉴之外的发现都已标明来源，图片与做法来自公开检索。`
        : `继续探索${m?.name || ''}，还有更多风味等待发现。`;
    }
  }

  function moreStatus() {
    if (!rightMoreBtn || !rightMoreText || !rightMoreLabel) return;
    const f = currentFeed();
    const rest = atlasRemaining(f);
    if (state.loading) {
      rightMoreBtn.disabled = true;
      rightMoreLabel.textContent = state.phase === 'atlas' ? '正在加载图鉴菜品……' : '正在发现更多相关菜品……';
      rightMoreText.textContent =
        state.phase === 'atlas' ? `图鉴还有 ${rest} 道未展示` : '联网检索并校验菜名、菜系与图片，通常需要 30–60 秒';
      rightMore.classList.add('is-loading');
      rightMore.hidden = false;
      return;
    }
    rightMoreBtn.disabled = false;
    rightMore.classList.remove('is-loading');
    rightMore.hidden = false;
    if (state.error) {
      rightMoreLabel.textContent = '重新加载';
      rightMoreText.textContent = state.error.slice(0, 60) || '加载失败，请再试一次';
      rightMore.classList.add('is-error');
      return;
    }
    rightMore.classList.remove('is-error');
    if (f.done) {
      rightMoreLabel.textContent = '再试一次';
      rightMoreText.textContent = '暂时没有发现更多相关菜品';
      return;
    }
    rightMoreLabel.textContent = '加载更多';
    if (rest > 0) {
      rightMoreText.textContent = `还有 ${rest} 道图鉴菜品 · 继续往下翻`;
    } else if (state.notice) {
      rightMoreText.textContent = state.notice.slice(0, 60);
    } else {
      rightMoreText.textContent = '继续探索图鉴之外的美食';
    }
  }

  /**
   * 点一次「加载更多」：
   *   1. 图鉴里还有没展示的 → 追加下一批（本地，立即）；
   *   2. 图鉴已全部展示 → 先取服务端已保存的发现结果，没有才触发一次联网检索。
   */
  async function loadMore() {
    if (state.loading) return;
    const f = currentFeed();
    const token = ++state.requestId;
    state.loading = true;
    state.error = '';
    state.notice = '';
    state.phase = atlasRemaining(f) > 0 ? 'atlas' : 'discover';
    if (state.phase === 'discover' && f.done) retryDiscovery(f);
    moreStatus();

    try {
      if (state.phase === 'atlas') {
        // 留一帧，让「正在加载图鉴菜品……」真的能被看见
        await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));
        if (token !== state.requestId) return;
        const items = takeAtlasBatch(f, ATLAS_BATCH);
        for (const d of items) rightGrid.append(dishCard(d, { source: 'atlas' }));
        state.notice = items.length ? '' : '图鉴菜品已全部展示';
      } else {
        if (import.meta.env?.DEV && DEBUG_FAIL_NEXT) {
          DEBUG_FAIL_NEXT = false;
          throw new Error('debug: discovery failure');
        }
        const res = await discoverBatch(f, DISCOVER_BATCH);
        if (token !== state.requestId) return; // 期间换了菜系：这批不进界面
        for (const d of res.items) rightGrid.append(dishCard(d, { source: 'discovered' }));
        state.notice = res.note || '';
      }
      paintRightHead(f);
    } catch (err) {
      if (token === state.requestId) {
        // 服务端会回「请先登录 / 检索服务未配置 / 本轮超时」这类可直接展示的说明，
        // 只有网络层的「请求失败 (503)」才换成一句通用提示
        const raw = String(err?.message || '');
        state.error = !raw || /^请求失败|^debug:/.test(raw) ? '联网检索失败，请稍后再试' : raw.slice(0, 60);
        if (import.meta.env?.DEV) console.warn('[catb] 发现菜品失败', err);
      }
    } finally {
      if (token === state.requestId) {
        state.loading = false;
        moreStatus();
      }
    }
  }

  function paintRightCuisine() {
    const m = meta();
    if (!m) return;
    const f = currentFeed();
    if (!f.items.length) primeAtlas(f, PER_PAGE);

    rightHeadMeta = h('p', { class: 'catb__top-meta' });
    rightHeadHint = h('p', { class: 'catb__top-note' });
    const top = h(
      'header',
      { class: 'catb__top catb__top--cuisine' },
      h(
        'div',
        { class: 'catb__top-copy' },
        h('h2', { class: 'catb__top-title', text: `${m.name} · 菜品目录` }),
        rightHeadMeta,
        rightHeadHint
      )
    );

    rightGrid = h(
      'div',
      { class: 'catb__grid catb__grid--scroll' },
      ...f.items.map((d) => dishCard(d, { source: f.sourceById.get(d.id) === 'discovered' ? 'discovered' : 'atlas' }))
    );
    if (!f.items.length) rightGrid.append(h('p', { class: 'catb__empty', text: '这个分类暂时没有菜' }));

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
    moreStatus();

    clear(rightScroll);
    rightScroll.append(h('div', { class: 'catb__stack catb__stack--deck' }, top, rightGrid, rightMore));
    rightScroll.scrollTop = 0;
    paintRightHead(f);
  }/* ================= 右页 B：口味页（原分页目录，保持不动） ================= */

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

  /* ---------- 菜品卡（两页共用；source 只是右页的来源标识） ---------- */
  function dishCard(d, opts = {}) {
    const tastes = (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name).filter(Boolean);
    const mins = minutes(d);
    const discovered = opts.source === 'discovered';
    return h(
      'article',
      { class: `catb__card${discovered ? ' is-discovered' : ''}`, 'data-dish': d.id, 'data-source': discovered ? 'discovered' : 'atlas' },
      h(
        'button',
        { class: 'catb__card-media', type: 'button', 'data-act': 'dish', 'data-dish': d.id, 'aria-label': `查看${d.name}详情` },
        guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }), d.name, '图片暂不可用'),
        // 来源标识只在菜系页出现（口味页沿用原版式，不额外加徽标）
        opts.source ? h('span', { class: 'catb__card-src', text: discovered ? '新发现' : '已收录' }) : null
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
    state.loading = false;
    state.error = '';
    state.notice = '';
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
    // 验收用的小开关（只在 DEV 打包里存在）。同一张纸面会同时挂着别的章节镜像，
    // 所以按「分类」登记，测试先用 __catDebug.use('cuisine:chuan') 选中当前可见的那个实例。
    const registry = (window.__catDebug = window.__catDebug || { instances: {} });
    const self = {
      key: `${state.kind}:${state.id}`,
      /** 下一次「加载更多」直接失败，看失败提示与重试 */
      failNextMore() {
        DEBUG_FAIL_NEXT = true;
      },
      /** 把当前分类的发现会话直接标成「两轮无结果」，用来看「暂时没有发现更多」的收尾态 */
      dryFeed() {
        state.requestId += 1;
        state.loading = false;
        const feed = currentFeed();
        feed.dryRounds = 2;
        feed.done = true;
        feed.lastNotice = '暂时没有发现更多可用的相关菜品。';
        feed.hydrated = true;
        feed.backlog = [];
        state.notice = '';
        state.error = '';
        moreStatus();
      },
      /** 只读：当前分类的发现会话快照（验收用） */
      feed() {
        const feed = currentFeed();
        return {
          key: feed.key,
          shown: feed.items.length,
          discovered: discoveredCount(feed),
          backlog: feed.backlog.length,
          hydrated: feed.hydrated,
          dryRounds: feed.dryRounds,
          done: feed.done,
          ids: feed.items.map((d) => d.id),
          names: feed.items.map((d) => d.name),
        };
      },
    };
    registry.instances[self.key] = self;
    registry.use = (key) => Object.assign(registry, registry.instances[key] || {});
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
      state.loading = false;
      state.error = '';
      state.notice = '';
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
      const feed = currentFeed();
      return {
        kind: state.kind,
        id: state.id,
        page: state.page,
        loading: state.loading,
        phase: state.phase,
        error: state.error,
        notice: state.notice,
        shown: feed.items.length,
        discovered: discoveredCount(feed),
        atlasRemaining: atlasRemaining(feed),
        done: feed.done,
        total: feed.pool.length,
      };
    },
    destroy() {
      closeAllOverlays({ instant: true });
      root.remove();
    },
  };
}