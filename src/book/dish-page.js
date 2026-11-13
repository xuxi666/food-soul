/**
 * 菜品详情：编辑式紧凑双栏（单页美食专题）
 * ------------------------------------------------------------
 * 一份内容，两个宿主：
 *   1. 书页内的「四边扩散详情」（book/overlay.js）
 *   2. 深链接 /dishes/:id 的章节内页（views/dish-detail.js）
 *
 * 版式自 2026-11 起改为：
 *   顶部  菜名 + 英文 + 真实分类标签
 *   中部  左：菜品主图（约半页宽）  右：四个操作入口 2×2
 *   下部  基础信息条 + 介绍 / 风味 / 食材 / 特色 / 掌故（紧凑信息块）
 *   末尾  食客怎么说
 * 原来的「相关内容」栏已按需求删除；推荐能力仍在图鉴与菜系页各自保留。
 *
 * 所有文字、标签、图片都来自 src/data/dishes.js（以及 /api/dishes/:id 的兜底），
 * 没有的字段就不渲染，不编造：步骤取自 techniques，操作要点取自 knowledge。
 */
import { h, html, toast } from '../lib/dom.js';
import { DISHES, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { dishPlaceholder, guardImage } from '../lib/placeholder.js';
import { navigateToRecipeModule } from './recipe-nav.js';
import { openDishChat } from './chat-panel.js';
import { openDishVideos } from './video-panel.js';
import { createNutritionCard } from '../components/nutrition-card.js';

/**
 * 打开站内独立页面（AI 聊天 / 生成菜谱）。
 * 沿用详情页原来的「卡片转场」：先写地址，再把目标页挂进 stage，动画结束接管路由。
 * 这里用动态 import：router.js 会静态引入本模块的宿主（views/dish-detail.js），
 * 顶层互相 import 会形成初始化顺序死结。
 */
export async function appRoute(href, el, accent = '#d8b26a') {
  const [{ fluidTransition }, { mountInto, adopt }] = await Promise.all([
    import('../lib/transition.js'),
    import('../router.js'),
  ]);
  if (location.pathname + location.search !== href.split('#')[0]) history.pushState({}, '', href);
  return fluidTransition({
    kind: 'card',
    el,
    accent,
    render: (stageEl) => mountInto(href, stageEl),
    commit: (stageEl, instance) => adopt(stageEl, instance, href),
  });
}

/* ---------- 按钮图标：细线，描边跟随文字色，不引外部资源 ---------- */
const ICON_SVG = {
  chat: '<svg class="dm-act__ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5.2H4v10.6h3.1V19l4.2-3.2H20z"/><path d="M8.4 10.5h.02M12 10.5h.02M15.6 10.5h.02"/></svg>',
  recipe:
    '<svg class="dm-act__ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.6h9.4L19 7.4V20.4H6z"/><path d="M15.2 3.8v3.6h3.6"/><path d="M9 11.6h7M9 14.6h7M9 17.2h4.4"/></svg>',
  video:
    '<svg class="dm-act__ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.4" y="5.4" width="17.2" height="13.2" rx="1.6"/><path d="M10.2 9.4l4.6 2.6-4.6 2.6z"/></svg>',
  more: '<svg class="dm-act__ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.6" height="6.6" rx="1"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1"/></svg>',
};
// html() 已经把 <svg> 根节点给出来了，这里直接克隆整棵 SVG（再取 firstElementChild 会只剩下 <path>）
const icon = (key) => html`${ICON_SVG[key] || ''}`?.cloneNode(true) || null;

/** 一句话特色拆成短词（「油厚、椒香、鱼片嫩」→ 三个标签） */
function signatureTokens(dish) {
  return String(dish.signature || '')
    .split(/[、·,，/|]+/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 6);
}

const kick = (no, text) => h('p', { class: 'dm-kick' }, h('i', { text: no }), h('span', { text }));
const sec = (key, ...children) => h('section', { class: `dm-sec dm-sec--${key}`, 'data-sec': key }, ...children);

/**
 * @returns {{ el: HTMLElement, comments: HTMLElement }}
 */
export function buildDishDoc(dish, { accent = '#d8b26a', compact = false, linkRelated = false } = {}) {
  const cuisine = CUISINE_BY_ID[dish.cuisine];
  const tastes = (dish.tastes || []).map((t) => TASTE_BY_ID[t]).filter(Boolean);
  const persona = PERSONALITY_BY_ID[dish.personality] || PERSONALITY_BY_ID[(dish.tastes || [])[0]];
  const minutes = (dish.prep || 0) + (dish.cook || 0);
  const techniques = dish.techniques || [];
  const notes = dish.knowledge || [];
  const comments = h('div', { class: 'dm-comments' });
  // 标题区标签 = 真实味型（分类标签）；资料区「风味特点」= signature 拆出来的口感词，两者不重复
  const tags = tastes.map((t) => t.name).slice(0, 3);
  const flavorWords = signatureTokens(dish).length ? signatureTokens(dish) : tastes.map((t) => t.name);

  const root = h('article', { class: `dm${compact ? ' dm--compact' : ''}`, style: `--accent:${accent}` });

  /* ---------- 一、标题区（放在图片右侧的信息栏里） ---------- */
  const head = h(
    'header',
    { class: 'dm-head' },
    h(
      'p',
      { class: 'dm-head__kicker' },
      h('span', { text: cuisine?.name || '中华料理' }),
      h('i', { 'aria-hidden': 'true', text: '·' }),
      h('span', { text: tastes.map((t) => t.name).join(' / ') || '风味' })
    ),
    h(
      'h1',
      { class: 'dm-title' },
      dish.name,
      dish.nameEn ? h('span', { class: 'dm-title__en', text: dish.nameEn }) : null
    ),
    dish.oneLiner ? h('p', { class: 'dm-line', text: dish.oneLiner }) : null,
    tags.length
      ? h('div', { class: 'dm-tags' }, ...tags.map((t) => h('em', { class: 'dm-tag', text: t })))
      : null
  );

  /* ---------- 二、首屏：左图 40% + 右信息 60% ---------- */
  const moreHref = cuisine ? `/cuisines/${dish.cuisine}` : '/dishes';
  const moreLabel = cuisine ? `更多${cuisine.name}` : '更多同类菜';

  const media = h(
    'figure',
    { class: 'dm-hero' },
    // 4:3 容器只包住图片，图注仍留在容器外，避免改变详情页原有信息结构。
    h(
      'div',
      { class: 'dm-hero__frame' },
      guardImage(
        h('img', {
          src: dish.image || dishPlaceholder(dish.name, '图片待补'),
          alt: dish.alt || dish.name,
          decoding: 'async',
        }),
        dish.name,
        '菜品图片'
      )
    ),
    dish.alt ? h('figcaption', { class: 'dm-hero__cap', text: dish.alt }) : null
  );

  // 胶囊按钮：暖金底 + 三层涟漪 + 文字上滑换行（参考 Hover 按钮样式，色系沿用画册）
  const pill = (tag, attrs, key, label) =>
    h(
      tag,
      { class: `dm-act dm-act--${key}`, ...attrs },
      h(
        'span',
        { class: 'dm-act__bg', 'aria-hidden': 'true' },
        h(
          'span',
          { class: 'dm-act__layers' },
          h('span', { class: 'dm-act__layer dm-act__layer--1' }),
          h('span', { class: 'dm-act__layer dm-act__layer--2' }),
          h('span', { class: 'dm-act__layer dm-act__layer--3' })
        )
      ),
      icon(key),
      h(
        'span',
        { class: 'dm-act__label' },
        h('span', { class: 'dm-act__txt', text: label }),
        h('span', { class: 'dm-act__txt dm-act__txt--hover', 'aria-hidden': 'true', text: label })
      )
    );

  const acts = h(
    'div',
    { class: 'dm-acts' },
    pill(
      'button',
      {
        type: 'button',
        title: `和 AI 食灵聊「${dish.name}」的风味、来历与做法`,
        /*
         * 双页联动：详情不动，聊天直接开在「详情所在页的另一半」。
         * 聊天室是 views/chat.js 的同一个实例（inline 模式），不是新的一套聊天。
         * 只有画册没接管（比如独立预览）时才回落到原来的整页聊天。
         */
        onclick: (e) => {
          e.preventDefault?.();
          e.stopPropagation?.();
          if (!openDishChat(dish, e.currentTarget)) void appRoute(`/chat/${dish.id}`, e.currentTarget, accent);
        },
      },
      'chat',
      `与「${dish.name}」聊聊`
    ),
    pill(
      'button',
      {
        type: 'button',
        title: '进结构化食谱，菜名已代填',
        onclick: (e) => {
          /*
           * 全站统一入口：这里不再自己拼地址、不再分「书开着走 goto / 书合着走 appRoute」。
           * recipe-nav 统一做菜名标准化，然后交给画册用原有的翻页（或开书）动画进入菜谱章，
           * 落地后菜谱模块消费这条任务并回填菜名——入口之间行为完全一致。
           */
          e.preventDefault?.();
          navigateToRecipeModule({
            dishId: dish.id,
            dishName: dish.name,
            englishName: dish.nameEn,
            sourceType: 'dish-detail',
            sourcePage: location.pathname,
          });
        },
      },
      'recipe',
      '生成菜谱'
    ),
    pill(
      'button',
      {
        type: 'button',
        'data-act': 'videos',
        title: `在另一半书页展开「${dish.name}」的做菜视频`,
        onclick: (e) => {
          e.preventDefault();
          if (!openDishVideos(dish, e.currentTarget)) {
            // 画册未接管时没有独立的视频页可去；不伪造一个全屏页面。
            toast('视频会在画册的菜品详情里展开', 'warn');
          }
        },
      },
      'video',
      '做菜视频'
    ),
    pill(
      'a',
      {
        href: moreHref,
        'data-link': '',
        'data-act': 'more-cuisine',
        title: cuisine ? `看其他${cuisine.name}菜` : '回到美食图鉴',
      },
      'more',
      moreLabel
    )
  );

  /* ---------- 三、基础信息与营养：放进右侧信息栏 ---------- */
  const facts = [
    ['用时', minutes ? `${minutes} 分钟` : '—'],
    ['难度', DIFFICULTY_LABEL[dish.difficulty] || '—'],
    ['人均', dish.price ? `¥${dish.price}` : '—'],
    ['份量', dish.servings ? `${dish.servings} 人份` : '—'],
  ];

  const ings = dish.ingredients || [];
  const tokens = flavorWords;
  let nutrition = null;
  if (ings.length) {
    // 画册页空间有限：营养入口默认折叠，只占一行；展开后才请求营养接口。
    nutrition = createNutritionCard(
      {
        dishName: dish.name,
        sourceModule: 'dish-detail',
        servings: Number(dish.servings) > 0 ? Number(dish.servings) : 2,
        allowTypicalPortions: true,
        ingredients: ings.map((name) => ({ name, amount: null, unit: '', role: 'main' })),
      },
      { folded: true, title: '营养成分' }
    );
  }

  const mainIngs = ings.slice(0, 4);
  const info = h(
    'div',
    { class: 'dm-info' },
    head,
    tokens.length || dish.texture
      ? h(
          'div',
          { class: 'dm-info__feature' },
          h('p', { class: 'dm-info__label', text: '菜品特色' }),
          tokens.length ? h('div', { class: 'dm-flavor' }, ...tokens.map((t) => h('em', { text: t }))) : null,
          dish.texture ? h('p', { class: 'dm-info__texture', text: dish.texture }) : null
        )
      : null,
    h(
      'ul',
      { class: 'dm-facts' },
      ...facts.map(([k, v]) => h('li', {}, h('b', { text: k }), h('span', { text: v })))
    ),
    mainIngs.length
      ? h(
          'div',
          { class: 'dm-info__ingredients' },
          h(
            'p',
            { class: 'dm-info__label' },
            '主要食材',
            ings.length > mainIngs.length ? h('span', { text: `等 ${ings.length} 种` }) : null
          ),
          h(
            'ul',
            { class: 'dm-ing dm-ing--summary' },
            ...mainIngs.map((name, i) =>
              h('li', {}, h('i', { text: String(i + 1).padStart(2, '0') }), h('span', { text: name }))
            )
          )
        )
      : null,
    nutrition?.el || null,
    acts
  );

  root.append(h('section', { class: 'dm-top' }, media, info));

  /* ---------- 四、图片下方：完整介绍与资料 ---------- */
  if (dish.intro) {
    root.append(sec('intro', kick('01', '这道菜'), h('p', { class: 'dm-lead', text: dish.intro })));
  }

  if (ings.length) {
    root.append(
      sec(
        'ingredients',
        kick('02', '完整食材'),
        h(
          'ul',
          { class: 'dm-ing' },
          ...ings.map((name, i) =>
            h('li', {}, h('i', { text: String(i + 1).padStart(2, '0') }), h('span', { text: name }))
          )
        )
      )
    );
  }

  if (techniques.length) {
    root.append(
      sec(
        'steps',
        kick('03', '制作步骤'),
        h(
          'ul',
          { class: 'dm-tech' },
          ...techniques.map((t, i) => h('li', {}, h('i', { text: String(i + 1).padStart(2, '0') }), h('span', { text: t })))
        )
      )
    );
  }

  if (notes.length) {
    root.append(
      sec(
        'tips',
        kick('04', '烹饪技巧'),
        h('ul', { class: 'dm-notes' }, ...notes.map((t) => h('li', { text: t })))
      )
    );
  }

  if (dish.history) {
    root.append(sec('history', kick('05', '掌故'), h('p', { class: 'dm-body', text: dish.history })));
  }

  /* ---------- 五、食客怎么说 ---------- */
  root.append(sec('talk', kick('06', '食客怎么说'), comments));

  return { el: root, comments };
}