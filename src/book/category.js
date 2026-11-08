/**
 * 菜系 / 口味章节：双页杂志式分类页（两种分类共用同一套版式）
 * ------------------------------------------------------------
 * 菜系页（kind === 'cuisine'）与口味页（kind === 'taste'）走同一个框架，
 * 差别只在「左页取哪些字段、下部横带写什么」：
 *
 *   左页 = 一屏读完的专题（不滚动就看完）：
 *          分类索引 → 名称/英文/简介 → 代表菜图 + 档案 + AI 入口 →
 *          三栏横带（菜系=地缘文化 / 口味=味型关系）→ 代表菜精选
 *   右页 = 菜品目录：无页码、无翻页键，独立纵向滚动，
 *          卡片两列网格 + 来源标识（图鉴收录 / 新发现），
 *          列表底部一枚「加载更多」：先补图鉴剩余，再联网发现新菜
 *
 * 数据层见 src/data/dishFeed.js（按分类各存一份已加载状态）。
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
import { guardImage, dishPlaceholder } from '../lib/placeholder.js';

/** 仅开发环境：把「加载更多」的每一步都打到控制台，便于排查（生产构建里整段被摇掉） */
const logCat = (...args) => {
  if (import.meta.env?.DEV) console.info('[catalog]', ...args);
};
import { openDishOverlay, closeAllOverlays } from './overlay.js';
import { appRoute } from './dish-page.js';

const PER_PAGE = 6; // 右页首屏 6 道（正好三行两列），菜系 / 口味一致
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
    loading: false,
    phase: '', // 'atlas' | 'discover'
    notice: '',
    error: false,
    requestId: 0, // 切换菜系后作废旧请求
    clicks: 0, // 「加载更多」点击计数（只用于日志）
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

/* ================= 左页：紧凑专题页（菜系 / 口味共用一套结构） =================
   * 两种分类走同一套版式，区别只在「取哪些字段」：
   *   菜系 → 发源地 / 代表食材 / 主要技法 / 典型风味
   *   口味 → 核心特征 / 主要味觉元素 / 常见食材 / 代表技法
   * 下部横带同理：菜系用地缘文化，口味用味型关系 —— 都从现有菜品数据派生，不写死文案。
   */

  /** 口味页用：风味字（麻 / 辣 / 香 / 鲜…），从菜品的 signature 单字里按出现频次统计 */
  function flavorChars(list, limit = 4) {
    const map = new Map();
    for (const d of list) {
      for (const token of String(d.signature || '').split(/[、·,，/|]+/)) {
        const t = token.trim();
        if (t.length !== 1) continue;
        map.set(t, (map.get(t) || 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .slice(0, limit);
  }

  /** 口味页用：主要烹饪动词（把「炒豆瓣出红油」这类长句归并成「炒 / 焖 / 烧」） */
  function craftVerbs(list, limit = 3) {
    const verbs = ['炒', '蒸', '炖', '烧', '煮', '焖', '拌', '炸', '烤', '卤', '煎', '烩', '煲', '汆', '爆', '煸', '焗', '熏', '熬', '腌'];
    const map = new Map();
    for (const d of list) {
      for (const raw of d.techniques || []) {
        const text = String(raw);
        for (const v of verbs) {
          const n = text.split(v).length - 1;
          if (n) map.set(v, (map.get(v) || 0) + n);
        }
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([v]) => v)
      .slice(0, limit);
  }

  /** 口味页用：这个味型和哪些味型最常出现在同一道菜里（数据来自菜品自己的 tastes 数组） */
  function coTastes(id, limit = 2) {
    const map = new Map();
    for (const d of DISHES) {
      const ts = d.tastes || [];
      if (!ts.includes(id)) continue;
      for (const t of ts) {
        if (!t || t === id) continue;
        map.set(t, (map.get(t) || 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([t, n]) => `${TASTE_BY_ID[t]?.name || t}（${n} 道）`);
  }

  function paintLeft() {
    const m = meta();
    if (!m) return;
    const taste = isTaste();
    const list = dishes();
    const lead = list[0];
    const culture = taste ? null : cultureOf(state.id);
    const extra = taste ? null : cultureExtraOf(state.id);

    const ingredients = topTokens(list, (d) => d.ingredients, 4);
    const crafts = topTokens(list, (d) => d.techniques, 3);
    const tastes = topTokens(list, (d) => (d.tastes || []).map((t) => TASTE_BY_ID[t]?.name || t), 3);
    const cuisines = topTokens(list, (d) => [CUISINE_BY_ID[d.cuisine]?.name], 3);
    const feelings = topTokens(list, (d) => [d.signature], 4);
    const notes = taste ? m.notes || flavorChars(list, 4) : [];
    const verbs = taste ? m.crafts || craftVerbs(list, 3) : [];
    const co = taste ? coTastes(state.id, 2) : [];
    const coShort = co.map((c) => c.replace(/（.*$/, ''));
    const avgMin = list.length ? Math.round(list.reduce((sum, d) => sum + minutes(d), 0) / list.length) : 0;

    const tags = (taste ? [m.name, ...notes.slice(0, 3)] : [...(extra?.tags || []), ...tastes])
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 4);

    const headLine = notes.length ? `${notes.slice(0, 3).join('、')}为主，${coShort.length ? `常与${coShort.join('、')}同菜` : '口味独立成系'}` : '';

    /* 难度分布：口味页横带用「多为家常 / 多为讲究」代替笼统描述 */
    const diffTally = list.reduce((acc, d) => {
      acc[d.difficulty] = (acc[d.difficulty] || 0) + 1;
      return acc;
    }, {});
    const diffMajor = Object.entries(diffTally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

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

    const rows = taste
      ? [
          ['核心特征', headLine || m.desc || '—'],
          ['主要味觉元素', notes.join(' · ') || feelings.join(' · ') || m.name],
          ['常见食材', ingredients.join(' · ') || '—'],
          ['代表技法', verbs.join(' · ') || '—'],
        ]
      : [
          ['发源地', m.region || '—'],
          ['代表食材', ingredients.join(' · ') || '—'],
          ['主要技法', crafts.join(' · ') || '—'],
          ['典型风味', tastes.join(' · ') || m.tagline || '—'],
        ];

    const facts = h(
      'dl',
      { class: 'catb__panel-facts' },
      ...rows.map(([k, v]) => h('div', { class: 'catb__panel-row' }, h('dt', { text: k }), h('dd', { text: v || '—' })))
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
          const accent = taste ? m.color || '#b0794a' : m.accent || '#b03a2e';
          void appRoute(`/chat/${taste ? 'taste' : 'cuisine'}/${state.id}`, e.currentTarget, accent);
        },
      },
      h('span', { class: 'catb__ai-ico', 'aria-hidden': 'true' }, h('i', {}), h('i', {})),
      h(
        'span',
        { class: 'catb__ai-copy' },
        h('b', { class: 'catb__ai-t', text: `和${m.name}聊天` }),
        h('span', { class: 'catb__ai-sub', text: taste ? '由该味型的 AI 人格应答' : '由该菜系的 AI 人格应答' })
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

    /* ③ 下部：三栏横带（菜系 = 地缘文化，口味 = 味型关系） */
    const cells = (
      taste
        ? [
            ['常见地域', cuisines.join(' · ') || '各地都有'],
            ['味型关系', co.length ? `常与「${co.join('」「')}」同现` : '独立成味，较少与其它味型同菜出现'],
            ['用时与难度', `${avgMin ? `平均 ${avgMin} 分钟` : '时间不等'}${diffMajor ? ` · 难度：${DIFFICULTY_LABEL[diffMajor] || diffMajor}` : ''}`],
          ]
        : [
            ['地域风土', culture?.terrain],
            ['饮食文化', extra?.festive],
            ['烹饪特色', culture?.habit],
          ]
    ).filter(([, text]) => !!text);

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

    const story = taste ? null : culture?.culture;
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
  }  /* ================= 右页 A：菜品目录 + 图鉴外发现 ================= */

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
      rightMore.classList.add('is-loading');
      rightMore.hidden = false;
      if (state.phase === 'atlas') {
        rightMoreLabel.textContent = '正在加载图鉴菜品……';
        rightMoreText.textContent = `图鉴还有 ${rest} 道未展示`;
      } else {
        rightMoreLabel.textContent = '正在发现更多相关菜品……';
        rightMoreText.textContent = '联网检索并逐条验证菜名、菜系与图片，通常需要 10–40 秒';
      }
      return;
    }
    rightMoreBtn.disabled = false;
    rightMore.classList.remove('is-loading');
    rightMore.hidden = false;
    if (state.error) {
      // 检索服务不可用 / 超时：明确说清楚，不能伪装成「没有更多」
      rightMoreLabel.textContent = '重新搜索';
      rightMoreText.textContent = state.error.slice(0, 60) || '暂时无法连接美食检索服务，请稍后重试。';
      rightMore.classList.add('is-error');
      return;
    }
    rightMore.classList.remove('is-error');
    if (f.done) {
      rightMoreLabel.textContent = '重新搜索';
      rightMoreText.textContent = (state.notice || '本次没有发现新的可靠菜品，可以尝试再次探索。').slice(0, 60);
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
    state.clicks = (state.clicks || 0) + 1;
    state.phase = atlasRemaining(f) > 0 ? 'atlas' : 'discover';
    if (state.phase === 'discover' && f.done) retryDiscovery(f);
    const keepScroll = rightScroll ? rightScroll.scrollTop : 0;
    logCat('click', {
      cuisine: state.id,
      click: state.clicks,
      phase: state.phase,
      shown: f.items.length,
      atlasRest: atlasRemaining(f),
    });
    moreStatus();

    try {
      if (state.phase === 'atlas') {
        // 留一帧，让「正在加载图鉴菜品……」真的能被看见
        await new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));
        if (token !== state.requestId) return;
        const items = takeAtlasBatch(f, ATLAS_BATCH);
        for (const d of items) rightGrid.append(dishCard(d, { source: 'atlas' }));
        state.notice = items.length ? `已补充 ${items.length} 道图鉴菜品` : '图鉴菜品已全部展示';
        logCat('atlas-batch', { added: items.length, rest: atlasRemaining(f) });
      } else {
        if (import.meta.env?.DEV && DEBUG_FAIL_NEXT) {
          DEBUG_FAIL_NEXT = false;
          throw new Error('debug: discovery failure');
        }
        const res = await discoverBatch(f, DISCOVER_BATCH);
        if (token !== state.requestId) return; // 期间换了菜系：这批不进界面
        for (const d of res.items) rightGrid.append(dishCard(d, { source: 'discovered' }));
        // 界面只说结论，为什么没找到（候选数、被谁跳过）留在控制台与后端日志里
        state.notice = res.items.length
          ? `发现了 ${res.items.length} 道新菜品`
          : res.status === 'failed'
            ? '暂时无法连接美食检索服务，请稍后重试。'
            : '本次没有发现新的可靠菜品，可以尝试再次探索。';
        if (!res.items.length) logCat('discover:empty', { reason: res.reason, note: res.note });
        logCat('discover', {
          status: res.status,
          reason: res.reason,
          added: res.items.length,
          stats: res.stats,
          done: f.done,
        });
      }
      paintRightHead(f);
      if (rightScroll) rightScroll.scrollTop = keepScroll; // 追加不跳动滚动位置
    } catch (err) {
      if (token === state.requestId) {
        // 服务端会回「请先登录 / 检索超时 / 服务不可用」这类可直接展示的说明
        const raw = String(err?.message || '');
        state.error =
          !raw || /^请求失败|Failed to fetch|NetworkError|^debug:/.test(raw)
            ? '暂时无法连接美食检索服务，请稍后重试。'
            : raw.slice(0, 60);
        logCat('error', { message: raw.slice(0, 160) });
      }
    } finally {
      if (token === state.requestId) {
        state.loading = false;
        moreStatus();
      }
    }
  }

  function paintRight() {
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
        guardImage(
          h('img', {
            // 图鉴外发现暂时没有可靠配图时用统一占位图，不拿别的菜的图顶替
            src: d.image || dishPlaceholder(d.name, d.imageNote || '暂无可靠配图'),
            alt: d.alt || d.name,
            loading: 'lazy',
            decoding: 'async',
          }),
          d.name,
          '图片暂不可用'
        ),
        // 来源标识：图鉴原有 →「图鉴收录」，联网发现 →「新发现」（菜系 / 口味两页一致）
        h('span', {
          class: `catb__card-src${discovered ? ' is-new' : ''}`,
          'data-src': discovered ? 'discovered' : 'atlas',
          text: discovered ? '新发现' : '图鉴收录',
        })
      ),
      h(
        'button',
        { class: 'catb__card-body', type: 'button', 'data-act': 'dish', 'data-dish': d.id },
        h(
          'span',
          { class: 'catb__card-head' },
          h('b', { class: 'catb__card-name', text: d.name }),
          h('em', { class: 'catb__card-cuisine', text: CUISINE_BY_ID[d.cuisine]?.name || (isTaste() ? meta()?.name || '' : '') })
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
    paintLeft();
    paintRight();
  }

  /* ---------- 分类切换（同一跨页原地换内容，只改地址不翻书） ---------- */
  let onSwitch = null;
  function switchTo(nextId) {
    if (!nextId || nextId === state.id) return;
    closeAllOverlays({ instant: true });
    state.id = nextId;
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

  // 仅开发环境：给自动化测试和排查留一个只读把手（生产构建里被摇掉）
  if (import.meta.env?.DEV) {
    // 书里可能同时挂着好几页分类页，取「当前可见的那一页」，避免拿到别的实例
    const handle = {
      state,
      el: root,
      feed: () => currentFeed(),
      items: () => currentFeed().items.slice(),
      loadMore: () => loadMore(),
      failNext: () => {
        DEBUG_FAIL_NEXT = true;
      },
    };
    window.__catbs = (window.__catbs || []).filter((x) => x.el && x.el.isConnected);
    window.__catbs.push(handle);
    window.__catb = handle;
    window.__catbActive = () =>
      window.__catbs.find((x) => x.el && x.el.isConnected && x.el.getClientRects().length > 0) || handle;
  }

  return {
    el: root,
    /** 地址里带了别的分类（书签 / 深链接 / 前进后退）：只换内容，不重建纸面 */
    update(nextKind, nextId) {
      if (nextKind === state.kind && nextId === state.id) return;
      state.kind = nextKind;
      state.id = nextId;
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