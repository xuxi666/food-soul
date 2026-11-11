import { h, toast } from '../lib/dom.js';
import { api, chatStream } from '../lib/api.js';
import { DISH_BY_ID, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { CUISINE_CULTURE } from '../data/cuisineCulture.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { categoryMeta, personaForCategory, dishesForCategory } from '../data/categories.js';
import { applyTheme } from '../data/visualThemes.js';
import { mountComments } from '../components/comments.js';
import { guardImage } from '../lib/placeholder.js';
import { navigateToRecipeModule, recipeHref } from '../book/recipe-nav.js';
import { copyText } from '../lib/clipboard.js';
import { enableWheelScroll, enableTouchScroll } from '../lib/wheel-scroll.js';
import notFound from './notfound.js';

const QUICK_DISH = ['你是什么味道？', '你的口感是什么？', '教我在家做你。', '你和哪些菜最搭？', '给我推荐相似口味的美食。'];

function quickForCategory(category) {
  const { kind, meta, dishes } = category;
  const lead = dishes[0];
  if (kind === 'taste') {
    return [
      `${meta.name}的层次怎么理解？`,
      `${meta.name}适合哪些食材？`,
      '为什么这类味道让人上瘾？',
      lead ? `推荐一道${meta.name}的入门菜` : '推荐一道入门菜',
    ];
  }
  return [
    `${meta.name}的特点是什么？`,
    lead ? `${lead.name}和${meta.name}其他菜有什么共通点？` : `${meta.name}有哪些代表菜？`,
    `${meta.name}为什么讲究这种味型？`,
    `想学一道简单的${meta.name}，有推荐吗？`,
  ];
}

export default {
  async mount(root, params = [], opts = {}) {
    /** 内嵌模式：挂在画册另一半页里，不是站内独立页（不接管 stage、不加 is-site-page） */
    const inline = opts.inline === true;
    const search = new URLSearchParams(location.search);
    const isCategory = params.length === 2 && (params[0] === 'cuisine' || params[0] === 'taste');

    /** 菜品对象：dish 模式＝聊天主体；category 模式＝当前话题菜（可选） */
    let dish = null;
    /** 分类对象：{ kind, id, meta, persona, dishes } */
    let category = null;
    let comments = null;

    if (isCategory) {
      const [kind, id] = params;
      const meta = categoryMeta(kind, id);
      if (!meta) return notFound.mount(root);
      category = { kind, id, meta, persona: personaForCategory(kind, id), dishes: dishesForCategory(kind, id) };

      const ctxId = search.get('dish');
      if (ctxId) {
        dish = DISH_BY_ID[ctxId] || null;
        if (!dish) {
          try {
            dish = (await api.dish(ctxId))?.dish || null;
          } catch {
            dish = null;
          }
        }
      }
      if (!dish) dish = category.dishes[0] || null;
    } else {
      const dishId = params[0];
      dish = DISH_BY_ID[dishId] || null;
      if (!dish && dishId) {
        try {
          dish = (await api.dish(dishId))?.dish || null;
        } catch {
          dish = null;
        }
      }
      if (!dish) return notFound.mount(root);
    }

    const topicDish = dish; // 展示与举例用的菜，不参与人格判定
    const cuisine = topicDish ? CUISINE_BY_ID[topicDish.cuisine] : null;
    const persona = isCategory
      ? category.persona
      : PERSONALITY_BY_ID[dish.personality] || PERSONALITY_BY_ID[dish.tastes?.[0]] || null;
    const targetName = isCategory ? `${category.meta.name} AI` : dish.name;
    const themeId = isCategory ? category.id : dish.tastes?.[0] || dish.cuisine;
    const backHref = isCategory ? (category.kind === 'taste' ? `/tastes/${category.id}` : `/cuisines/${category.id}`) : '/';
    const backLabel = isCategory ? '← 返回分类' : '← 返回';

/* ================= 左页：中国美食档案 ================= */
    /* 迁移菜品库的条目带 credit（照片为 AI 生成、内容迁移自参考项目），文化记载要据此打标 */
    const isLibraryDish = Boolean(topicDish?.credit);
    const cuisineCulture = !isCategory && cuisine ? CUISINE_CULTURE[cuisine.id] || null : null;

    const dishName = isCategory ? category.meta.name : dish.name;
    const dishNameEn = isCategory
      ? category.kind === 'cuisine'
        ? category.meta.en || ''
        : category.meta.en || ''
      : dish.nameEn || cuisine?.en || '';
    const regionLine = isCategory
      ? category.kind === 'cuisine'
        ? category.meta.region || ''
        : ''
      : cuisine?.region || '';
    const cuisineLine = isCategory
      ? category.kind === 'taste'
        ? '口味档案'
        : '菜系档案'
      : cuisine?.name || '';
    const leadLine = isCategory ? category.meta.tagline || category.meta.desc || '' : dish.oneLiner || dish.signature || '';
    const introLine = isCategory ? category.meta.desc || '' : dish.intro || '';

    /* 图片：优先横向展示，按左页高度自适应，不做过度裁切 */
    const media = topicDish
      ? guardImage(
          h('img', { src: topicDish.image, alt: topicDish.alt || topicDish.name, loading: 'lazy' }),
          topicDish.name,
          '图片暂不可用'
        )
      : h('div', { class: 'cr-visual__fallback', text: (isCategory ? category.meta.name : dish.name).slice(0, 1) });

    const visual = h(
      'figure',
      { class: 'cr-visual' },
      h('div', { class: 'cr-visual__frame' }, media),
      h(
        'figcaption',
        { class: 'cr-visual__caption' },
        h('b', { text: dishName }),
        dishNameEn ? h('span', { class: 'cr-visual__en', text: dishNameEn }) : null,
        leadLine ? h('span', { class: 'cr-visual__line', text: leadLine }) : null
      )
    );

    /* ---------- 风味档案 ---------- */
    const flavorTastes = (isCategory ? [] : dish.tastes || [])
      .map((t) => TASTE_BY_ID[t])
      .filter(Boolean)
      .map((t) => h('span', { class: 'cr-chip cr-chip--taste', style: `--chip:${t.color}`, text: t.name }));

    const flavorChips = (items, cls) =>
      items && items.length ? h('div', { class: 'cr-chips' }, ...items.map((x) => h('span', { class: `cr-chip ${cls || ''}`, text: x }))) : null;

    const cookMinutes = topicDish ? (topicDish.prep || 0) + (topicDish.cook || 0) : 0;

    const flavorBlock = topicDish
      ? h(
          'section',
          { class: 'cr-block cr-flavor' },
          h('h2', { class: 'cr-block__title' }, h('span', { text: '风味档案' }), h('i', { text: 'FLAVOR' })),
          h(
            'div',
            { class: 'cr-facts' },
            flavorTastes.length
              ? h('div', { class: 'cr-fact' }, h('span', { class: 'cr-fact__k', text: '核心口味' }), h('div', { class: 'cr-chips' }, ...flavorTastes))
              : null,
            topicDish.texture
              ? h('div', { class: 'cr-fact cr-fact--wide' }, h('span', { class: 'cr-fact__k', text: '口感与层次' }), h('p', { class: 'cr-fact__v', text: topicDish.texture }))
              : null,
            topicDish.techniques?.length
              ? h('div', { class: 'cr-fact' }, h('span', { class: 'cr-fact__k', text: '烹饪方式' }), flavorChips(topicDish.techniques))
              : null,
            h(
              'div',
              { class: 'cr-fact' },
              h('span', { class: 'cr-fact__k', text: '烹饪信息' }),
              h(
                'div',
                { class: 'cr-meta' },
                cookMinutes ? h('span', { class: 'cr-meta__item' }, h('em', { text: '时间' }), h('b', { text: `${cookMinutes} 分钟` })) : null,
                topicDish.difficulty ? h('span', { class: 'cr-meta__item' }, h('em', { text: '难度' }), h('b', { text: DIFFICULTY_LABEL[topicDish.difficulty] || topicDish.difficulty })) : null,
                topicDish.servings ? h('span', { class: 'cr-meta__item' }, h('em', { text: '份量' }), h('b', { text: `${topicDish.servings} 人份` })) : null
              )
            ),
            topicDish.ingredients?.length
              ? h(
                  'div',
                  { class: 'cr-fact cr-fact--wide' },
                  h('span', { class: 'cr-fact__k', text: '主要食材' }),
                  h('div', { class: 'cr-chips' }, ...topicDish.ingredients.map((x) => h('span', { class: 'cr-chip cr-chip--ing', text: x })))
                )
              : null
          )
        )
      : null;

    /* ---------- 饮食文化：只用项目里已有的、区分了出处的资料 ---------- */
    const cultureCards = [];
    if (!isCategory && topicDish?.history) {
      cultureCards.push(
        h(
          'article',
          { class: 'cr-culture__card' },
          h('h3', { class: 'cr-culture__h' }, h('span', { text: '菜品起源' }), h('i', { class: isLibraryDish ? 'cr-src cr-src--pending' : 'cr-src', text: isLibraryDish ? '迁移资料 · 待核实' : '菜品档案' })),
          h('p', { class: 'cr-culture__text', text: topicDish.history })
        )
      );
    }
    if (cuisineCulture?.terrain || cuisineCulture?.habit) {
      cultureCards.push(
        h(
          'article',
          { class: 'cr-culture__card' },
          h('h3', { class: 'cr-culture__h' }, h('span', { text: `${cuisine?.name || ''}地域饮食` }), h('i', { class: 'cr-src', text: '菜系档案' })),
          cuisineCulture.period ? h('p', { class: 'cr-culture__period', text: cuisineCulture.period }) : null,
          cuisineCulture.terrain ? h('p', { class: 'cr-culture__text', text: cuisineCulture.terrain }) : null,
          cuisineCulture.habit ? h('p', { class: 'cr-culture__text', text: cuisineCulture.habit }) : null
        )
      );
    }
    if (cuisineCulture?.culture?.quote?.text) {
      const q = cuisineCulture.culture.quote;
      cultureCards.push(
        h(
          'blockquote',
          { class: 'cr-culture__quote' },
          h('p', { text: `「${q.text}」` }),
          h('footer', { text: `—— ${q.from || ''}${q.note ? `（${q.note}）` : ''}` })
        )
      );
    }

    const cultureBlock = cultureCards.length
      ? h(
          'section',
          { class: 'cr-block cr-culture' },
          h('h2', { class: 'cr-block__title' }, h('span', { text: '饮食文化' }), h('i', { text: 'CULTURE' })),
          h('div', { class: 'cr-culture__list' }, ...cultureCards.filter(Boolean))
        )
      : null;

    /* ---------- 烹饪技法 ---------- */
    const craftPoints = !isCategory && topicDish?.knowledge?.length ? topicDish.knowledge.slice(0, 3) : [];
    const craftBlock =
      !isCategory && (topicDish?.techniques?.length || craftPoints.length)
        ? h(
            'section',
            { class: 'cr-block cr-craft' },
            h('h2', { class: 'cr-block__title' }, h('span', { text: '烹饪技法' }), h('i', { text: 'CRAFT' })),
            topicDish?.techniques?.length
              ? h(
                  'ol',
                  { class: 'cr-craft__steps' },
                  ...topicDish.techniques.map((t) => h('li', { class: 'cr-craft__step', text: t }))
                )
              : null,
            craftPoints.length
              ? h(
                  'ul',
                  { class: 'cr-craft__notes' },
                  h('li', { class: 'cr-craft__notes-h', text: '厨艺要点' }),
                  ...craftPoints.map((t) => h('li', { text: t }))
                )
              : null
          )
        : null;

    /* ---------- 分类 AI：保留原有性格卡 ---------- */
    const personaIntro = persona ? [persona.archetype, persona.emotion].filter(Boolean) : [];
    const personaSkills = [
      topicDish?.history ? '菜品历史' : null,
      cuisine?.name ? `${cuisine.name}饮食文化` : null,
      topicDish?.ingredients?.length ? '食材知识' : null,
      topicDish?.texture || topicDish?.signature ? '风味特点' : null,
      topicDish?.techniques?.length ? '烹饪技巧' : null,
    ].filter(Boolean);
    const personaBlock = h(
      'section',
      { class: 'cr-persona' },
      h('h2', { class: 'cr-block__title' }, h('span', { text: '角色性格' }), h('i', { text: persona ? persona.name : 'DEFAULT' })),
      personaIntro.map((line) => h('p', { class: 'cr-persona__text', text: line })).length
        ? h('div', {}, ...personaIntro.map((line) => h('p', { class: 'cr-persona__text', text: line })))
        : null,
      persona?.flavor ? h('p', { class: 'cr-persona__quote', text: persona.flavor }) : null,
      personaSkills.length
        ? h(
            'div',
            { class: 'cr-skills' },
            h('span', { class: 'cr-skills__label', text: '擅长聊' }),
            ...personaSkills.map((s) => h('span', { class: 'cr-skills__item', text: s }))
          )
        : null
    );

    /* ---------- 底部操作 ---------- */
    const mainActions = isCategory
      ? [
          h('a', { class: 'btn btn--sm btn--gold cr-act cr-act--main', href: category.kind === 'taste' ? `/tastes/${category.id}` : `/cuisines/${category.id}`, 'data-link': '' }, `进入${category.kind === 'taste' ? '口味' : '菜系'}页`),
          topicDish ? h('a', { class: 'btn btn--sm cr-act', href: `/dishes/${topicDish.id}`, 'data-link': '' }, `看「${topicDish.name}」`) : null,
        ]
      : [
          h('button', {
            class: 'btn btn--sm btn--gold cr-act cr-act--main',
            type: 'button',
            /* 聊天页是独立页（画册不在 DOM）：统一导航会自动整页进入并带着菜名 */
            onclick: () =>
              navigateToRecipeModule({
                dishId: dish.id,
                dishName: dish.name,
                englishName: dish.nameEn,
                sourceType: 'chat-dossier',
                sourcePage: location.pathname,
              }),
          }, '生成结构化菜谱'),
          h('a', { class: 'btn btn--sm cr-act', href: `/dishes/${dish.id}`, 'data-link': '' }, '查看菜谱'),
        ];
    const minorActions = isCategory
      ? [h('a', { class: 'btn btn--sm cr-act cr-act--ghost', href: '/dishes', 'data-link': '' }, '逛美食图鉴')]
      : [
          h('a', { class: 'btn btn--sm cr-act cr-act--ghost', href: '/kitchen', 'data-link': '' }, '换个口味'),
          h('a', { class: 'btn btn--sm cr-act cr-act--ghost', href: `/videos?q=${encodeURIComponent(dish.name)}`, 'data-link': '' }, '做菜视频'),
          h('button', { class: 'btn btn--sm cr-act cr-act--ghost', type: 'button', onclick: () => setPane('comments') }, '食客评论'),
        ];

    const leftActions = h(
      'footer',
      { class: 'cr-actions' },
      h('div', { class: 'cr-actions__row' }, ...mainActions.filter(Boolean)),
      h('div', { class: 'cr-actions__row cr-actions__row--minor' }, ...minorActions.filter(Boolean))
    );

    const leftBody = h(
      'div',
      { class: 'cr-left__body' },
      h(
        'header',
        { class: 'cr-titleblock' },
        h('div', { class: 'cr-topbar' }, h('a', { class: 'cr-back', href: backHref, 'data-link': '' }, backLabel)),
        h('p', { class: 'cr-titleblock__kicker' }, h('i', { text: cuisineLine }), regionLine ? h('span', { text: regionLine }) : null),
        h('h1', { class: 'cr-titleblock__name', text: dishName }),
        dishNameEn ? h('p', { class: 'cr-titleblock__en', text: dishNameEn }) : null,
        leadLine ? h('p', { class: 'cr-titleblock__lead', text: leadLine }) : null,
        introLine ? h('p', { class: 'cr-titleblock__intro', text: introLine }) : null
      ),
      visual,
      isCategory ? personaBlock : null,
      flavorBlock,
      cultureBlock,
      craftBlock,
      isCategory ? null : h('p', { class: 'cr-note', text: isLibraryDish ? '文化内容迁移自项目菜品库，历史说法存在不同版本，仅供了解。' : '文化内容来自项目菜品档案；历史说法存在不同版本，仅供了解。' })
    );

    const deco = h('div', { class: 'cr-left__deco', 'aria-hidden': 'true' });
    if (!isCategory && cuisine && ['chuan', 'yue', 'zhe'].includes(cuisine.id)) {
      deco.dataset.deco = cuisine.id;
    }

    const leftScroll = h('div', { class: 'cr-left__inner' }, leftBody);

    const dossier = h('aside', { class: 'cr-left' }, leftScroll, leftActions, deco);

    /* ================= 中央书脊（独立一格，不挤占任何一页） ================= */
    const spine = h('div', { class: 'cr-spine', 'aria-hidden': 'true' });

    /* ================= 右页：沉浸式聊天室 ================= */
    const messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
    /** 欢迎态节点：第一条消息发出后就摘掉 */
    let welcomeEl = null;
    const modeBadge = h('span', { class: 'cr-model', text: '连接中' });

    const chatHead = h(
      'header',
      { class: 'cr-head' },
      h('a', { class: 'cr-head__back', href: backHref, 'data-link': '', 'aria-label': backLabel.replace('← ', '').trim() || '返回' }, '←'),
      h(
        'div',
        { class: 'cr-head__id' },
        h(
          'h2',
          { class: 'cr-head__name' },
          h('span', { class: 'cr-head__title', text: targetName }),
          h('span', { class: 'cr-online' }, h('i', { class: 'cr-online__dot' }), h('em', { text: '在线' }))
        ),
        h('p', {
          class: 'cr-head__sub',
          text: isCategory
            ? `${category.kind === 'taste' ? '口味' : '菜系'} AI · ${category.dishes.length} 道菜`
            : [persona?.archetype || '美食角色', cuisine?.name].filter(Boolean).join(' · '),
        })
      ),
      h(
        'div',
        { class: 'cr-head__meta' },
        h('span', { class: 'cr-head__model-label', text: '模型' }),
        modeBadge
      )
    );

    const tabChat = h('button', { class: 'cr-tab is-on', type: 'button', role: 'tab', 'aria-selected': 'true' }, 'AI 聊天');
    const tabComments = h('button', { class: 'cr-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }, '食客评论');
    // 分类 AI 页没有食客评论，就不摆这个切换器（避免点进去是一块空面板）
    const tabs = isCategory ? null : h('div', { class: 'cr-tabs', role: 'tablist' }, tabChat, tabComments);

    /* 单页模式（≤1023）下的三视图切换 */
    const paneBtnDossier = h('button', { class: 'cr-pane-tab', type: 'button', 'data-pane': 'dossier' }, '菜品档案');
    const paneBtnChat = h('button', { class: 'cr-pane-tab is-on', type: 'button', 'data-pane': 'chat' }, 'AI 聊天');
    const paneBtnComments = isCategory ? null : h('button', { class: 'cr-pane-tab', type: 'button', 'data-pane': 'comments' }, '食客评论');
    const paneTabs = h('div', { class: 'cr-pane-tabs', role: 'tablist' }, paneBtnDossier, paneBtnChat, paneBtnComments);

    const aiNoticeText = h('span', {
      text: '当前未接入 AI 大模型，请点击右上角「接入 AI」配置后再开始对话。',
    });
    const aiNotice = h('div', { class: 'chat-ai-notice', hidden: true }, aiNoticeText);

    function showAINotice(text) {
      if (text) aiNoticeText.textContent = text;
      aiNotice.hidden = !text;
    }

    const input = h('textarea', {
      rows: '1',
      placeholder: isCategory
        ? `问 ${category.meta.name} AI：味型、代表菜、食材搭配……`
        : `问 ${dish.name} 任何事：味道、火候、搭配……`,
      'aria-label': '输入消息',
    });
    const sendBtn = h('button', { class: 'composer__send', type: 'submit', text: '发送' });
    const stopBtn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', style: 'display:none' }, '停止生成');
    const composer = h('form', { class: 'composer' }, input, stopBtn, sendBtn);

    const chatPanel = h(
      'div',
      { class: 'cr-panel cr-panel--chat', role: 'tabpanel' },
      aiNotice,
      messagesEl,
      h(
        'div',
        { class: 'cr-composer' },
        composer,
        h('p', { class: 'composer__hint', text: 'Enter 发送 · Shift + Enter 换行 · 内容由 AI 生成，请自行判断' })
      )
    );

    /* 评论区：复用现有 mountComments，只在右页里 */
    const commentsHost = isCategory ? null : h('div', { class: 'cr-comments' });
    const commentsPanel = isCategory
      ? null
      : h('div', { class: 'cr-panel cr-panel--comments', role: 'tabpanel' }, commentsHost);

    const chatRoom = h('section', { class: 'cr-right' }, chatHead, tabs, chatPanel, commentsPanel);

    const page = h('div', { class: 'page chat-page theme-chat cr', 'data-view': 'chat', 'data-pane': 'chat' }, paneTabs, dossier, spine, chatRoom);
    applyTheme(page, themeId);
    root.append(page);

    /* 这一页盖住了整张跨页：画册中缝（.bk-gutter，z-index 高于内容层）必须让位，
       否则它会压在右页中央，既画出多余的装饰线，又拦掉那一带的点击。 */
    const bookStage = document.querySelector('.bk-stage');
    // 内嵌时纸张仍属于画册：不能把整本书判成站内页（那会把页码纸全藏起来）
    if (!inline) bookStage?.classList.add('is-site-page');

    /* ---------------- 视图切换：AI 聊天 / 食客评论 ---------------- */
    function setView(view) {
      const toComments = view === 'comments' && Boolean(commentsPanel);
      page.dataset.view = toComments ? 'comments' : 'chat';
      tabChat.classList.toggle('is-on', !toComments);
      tabComments.classList.toggle('is-on', toComments);
      tabChat.setAttribute('aria-selected', String(!toComments));
      tabComments.setAttribute('aria-selected', String(toComments));
      // 切回来时聊天记录原样还在，只把视角交回最新一条
      if (!toComments) requestAnimationFrame(() => scrollToEnd());
    }
    tabChat.addEventListener('click', () => setPane('chat'));
    tabComments.addEventListener('click', () => setPane('comments'));

    /* ---------------- 单页三视图：档案 / 聊天 / 评论 ---------------- */
    function setPane(pane) {
      const next = pane === 'dossier' ? 'dossier' : pane === 'comments' && commentsPanel ? 'comments' : 'chat';
      page.dataset.pane = next;
      if (next !== 'dossier') setView(next);
      [...paneTabs.children].forEach((b) => {
        const on = b.dataset.pane === next;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });
    }
    [...paneTabs.children].forEach((b) => b.addEventListener('click', () => setPane(b.dataset.pane)));

    /* 纸面里没有 3D 翻转了，但滚轮/触摸仍交给显式换算，手感才一致 */
    const offWheel = [
      enableWheelScroll(leftScroll),
      enableWheelScroll(messagesEl),
      commentsHost ? enableWheelScroll(commentsHost) : null,
      enableTouchScroll(leftScroll),
      enableTouchScroll(messagesEl),
      commentsHost ? enableTouchScroll(commentsHost) : null,
    ];

    if (!isCategory) {
      comments = mountComments(commentsHost, dish.id);
    }

    /* ---------------- 状态 ---------------- */
    const state = {
      messages: [],
      streaming: false,
      stream: null,
      lastAssistantEl: null,
      greeting: '',
      suggestAborts: new Set(),
      shownSuggestions: new Set(),
      aiConfigured: null,
    };

    function setMode(meta) {
      if (!meta) return;
      const fromSite = meta.aiSource === 'site';
      state.aiConfigured = meta.aiConfigured !== false;
      if (state.aiConfigured) {
        modeBadge.textContent = fromSite
          ? `内置 AI · ${meta.model || '模型'}`
          : meta.model || '已接入';
        modeBadge.title = fromSite
          ? `全站内置模型：${meta.model || ''}`
          : `已接入：${meta.model || '模型'}`;
        modeBadge.classList.remove('is-demo');
        showAINotice('');
        input.disabled = false;
        // 流式中 meta 事件也会走到这里：不能把「生成中禁止重复提交」又打开
        sendBtn.disabled = Boolean(state.streaming);
        input.placeholder = isCategory
          ? `问 ${category.meta.name} AI：味型、代表菜、食材搭配……`
          : `问 ${dish.name} 任何事：味道、火候、搭配……`;
      } else {
        modeBadge.textContent = '未接入 AI';
        modeBadge.title = '请先在右上角「接入 AI」配置你自己的模型';
        modeBadge.classList.add('is-demo');
        showAINotice(meta.aiMessage || '当前未接入 AI 大模型，请点击右上角「接入 AI」配置后再开始对话。');
        input.disabled = true;
        sendBtn.disabled = true;
        input.placeholder = '请先在右上角「接入 AI」配置模型';
      }
    }

    /** 用户是否还停在底部附近：只有这时才跟着新消息往下走 */
    function atBottom() {
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    }

    /*
     * 是否跟随新内容滚动。用「滚动事件 + 标记」而不是每次渲染时现算：
     * 流式分片在同一帧里连续到达时，scrollHeight 已经变了而 scrollTop 还没跟上，
     * 现算会误判成「用户已经翻走了」，答案就再也不跟随了。
     */
    let follow = true;
    let lastTop = 0;
    messagesEl.addEventListener(
      'scroll',
      () => {
        const top = messagesEl.scrollTop;
        // 只有「往上翻」才停止跟随；内容变高或自己滚到底都不算用户离开
        if (top < lastTop - 4) follow = false;
        else if (atBottom()) follow = true;
        lastTop = top;
      },
      { passive: true }
    );

    function scrollToEnd() {
      follow = true;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function aiName() {
      return isCategory
        ? `${category.meta.name} AI${persona ? ` · ${persona.name}` : ''}`
        : `${dish.name}${persona ? ` · ${persona.name}` : ''}`;
    }

    function addMessage(role, text, { streaming = false } = {}) {
      const isAI = role === 'assistant';
      const textEl = h('div', { class: 'msg__text' });
      if (text) textEl.textContent = text;
      if (streaming) textEl.append(h('span', { class: 'cursor' }));

      const actions = h('div', { class: 'msg__actions' });
      if (!streaming && text) {
        actions.append(
          h('button', {
            type: 'button',
            onclick: async () => {
              const ok = await copyText(text);
              toast(ok ? '已复制' : '复制失败', ok ? undefined : 'err');
            },
          }, '复制')
        );
        if (isAI) {
          actions.append(h('button', { type: 'button', onclick: () => regenerate() }, '重新生成'));
        }
      }

      const suggestBox = h('div', { class: 'msg__suggest', hidden: true });

      const node = h(
        'div',
        { class: `msg msg--${isAI ? 'ai' : 'user'}` },
        h('div', { class: 'msg__avatar', text: isAI ? (isCategory ? category.meta.name.slice(0, 1) : dish.name.slice(0, 1)) : '我' }),
        h(
          'div',
          { class: 'msg__body' },
          h('div', { class: 'msg__name', text: isAI ? aiName() : '你' }),
          textEl,
          actions,
          suggestBox
        )
      );
      messagesEl.append(node);
      scrollToEnd();
      return { node, textEl, actions, suggestBox };
    }

    function finishStream(node, text) {
      node.textEl.querySelector('.cursor')?.remove();
      node.textEl.textContent = text;
      node.actions.replaceChildren(
        h('button', {
          type: 'button',
          onclick: async () => {
            const ok = await copyText(text);
            toast(ok ? '已复制' : '复制失败', ok ? undefined : 'err');
          },
        }, '复制'),
        h('button', { type: 'button', onclick: () => regenerate() }, '重新生成')
      );
      node.actions.classList.add('is-visible');
    }

    /* ---------------- 对话延伸建议 ---------------- */

    function suggestionHref(s) {
      const p = s.actionPayload || {};
      /* 地址也由统一契约拼装：点击仍走统一入口，这里只是中键 / 新窗口的兜底 */
      if (s.actionType === 'recipe') return recipeHref({ dishName: p.dishName, sourceType: 'chat-suggestion' });
      if (s.actionType === 'recommend') return `/kitchen?taste=${encodeURIComponent(p.taste || '')}`;
      if (s.actionType === 'video') return `/videos?q=${encodeURIComponent(p.query || '')}`;
      return '';
    }

    function markSuggestionUsed(box, chip) {
      box.querySelectorAll('.suggest-chip').forEach((el) => {
        el.classList.add('is-used');
        if (el.tagName === 'BUTTON') el.disabled = true;
      });
      chip?.classList.add('is-picked');
    }

    function suggestionChip(s, box) {
      if (s.actionType === 'chat') {
        const btn = h(
          'button',
          { class: 'suggest-chip', type: 'button', title: '继续这段对话' },
          h('span', { class: 'suggest-chip__text', text: s.text }),
          h('span', { class: 'suggest-chip__arrow', text: '→', 'aria-hidden': 'true' })
        );
        btn.addEventListener('click', () => {
          if (btn.disabled || state.streaming) return;
          markSuggestionUsed(box, btn);
          send(s.text);
        });
        return btn;
      }

      const href = suggestionHref(s);
      if (!href) return null;
      const label = { recipe: '菜谱', recommend: '厨房', video: '视频' }[s.actionType] || '新窗口';
      const link = h(
        'a',
        {
          class: 'suggest-chip suggest-chip--link',
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: `新窗口打开：${label}`,
        },
        h('span', { class: 'suggest-chip__text', text: s.text }),
        h('span', { class: 'suggest-chip__arrow', text: '↗', 'aria-hidden': 'true' })
      );
      link.addEventListener('click', (e) => {
        markSuggestionUsed(box, link);
        /* AI 给的菜谱建议同样走统一导航：模型只给菜名，没有 id，交给 recipe-nav 标准化 */
        if (s.actionType === 'recipe') {
          e.preventDefault();
          navigateToRecipeModule({
            dishName: s.actionPayload?.dishName,
            sourceType: 'chat-suggestion',
            sourcePage: location.pathname,
          });
        }
      });
      return link;
    }

    async function loadSuggestions({ node, lastUser, assistantText }) {
      if (!node?.node?.isConnected) return;
      if (String(assistantText || '').trim().length < 12) return;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      state.suggestAborts.add(ctrl);
      node.suggestBox.hidden = false;
      node.suggestBox.replaceChildren(
        h('span', { class: 'msg__suggest-label', text: '接着聊' }),
        h('span', { class: 'suggest-loading', text: '正在想接下来聊什么…' })
      );
      if (follow) scrollToEnd();

      try {
        const ctx = isCategory
          ? {
              mode: 'category',
              kind: category.kind,
              categoryId: category.id,
              contextDishId: topicDish?.id,
            }
          : { mode: 'dish', dishId: dish.id };

        const res = await api.suggest(
          {
            ...ctx,
            messages: state.messages.slice(-6),
            lastUser,
            lastAssistant: assistantText,
            exclude: [...state.shownSuggestions].slice(-20),
          },
          ctrl.signal
        );

        // 消息已卸载 / 已重新生成：丢弃旧结果，避免建议错位
        if (!node.node.isConnected) return;

        const list = Array.isArray(res.suggestions) ? res.suggestions.slice(0, 3) : [];
        const chips = list.map((s) => suggestionChip(s, node.suggestBox)).filter(Boolean);
        if (!chips.length) {
          node.suggestBox.hidden = true;
          node.suggestBox.replaceChildren();
          return;
        }

        node.suggestBox.replaceChildren(
          h('span', { class: 'msg__suggest-label', text: '接着聊' }),
          ...chips
        );
        list.forEach((s) => state.shownSuggestions.add(s.text));
        if (follow) scrollToEnd();
      } catch (err) {
        // 建议失败/超时不影响主回答，收起加载占位
        if (node.node.isConnected) {
          node.suggestBox.hidden = true;
          node.suggestBox.replaceChildren();
        }
        if (err?.name === 'AbortError') return;
      } finally {
        clearTimeout(timer);
        state.suggestAborts.delete(ctrl);
      }
    }

    async function request({ history }) {
      if (state.streaming) return;
      if (state.aiConfigured === false) {
        toast('请先在右上角「接入 AI」配置模型');
        return;
      }
      state.streaming = true;
      sendBtn.disabled = true;
      stopBtn.style.display = 'inline-flex';

      const node = addMessage('assistant', '', { streaming: true });
      let buffer = '';
      let failed = false;

      const payload = isCategory
        ? {
            mode: category.kind,
            categoryId: category.id,
            categoryName: category.meta.name,
            contextDishId: topicDish?.id || undefined,
            messages: history,
          }
        : { dishId: dish.id, messages: history };

      state.stream = chatStream(payload, {
        onMeta: setMode,
        onDelta: (t) => {
          // 用户正在往上翻历史时不拽回底部；发给自己的新消息才强制跟随
          buffer += t;
          node.textEl.textContent = buffer;
          node.textEl.append(h('span', { class: 'cursor' }));
          if (follow) scrollToEnd();
        },
        onDone: () => {},
        onAbort: () => {
          failed = true;
          finishStream(node, buffer || '（已停止生成）');
          if (buffer) state.messages.push({ role: 'assistant', content: buffer });
        },
        onError: (err) => {
          failed = true;
          if (['ai_not_configured', 'ai_disabled', 'site_ai_error', 'ai_config_error', 'ai_config_unavailable'].includes(err?.code)) {
            state.aiConfigured = false;
            setMode({ aiConfigured: false, aiMessage: err.message });
          }
          node.textEl.textContent = '';
          node.node.classList.add('msg--error');
          node.textEl.append(
            h('span', { style: 'color:#e8a495', text: `生成失败：${err.message}。` }),
            h('button', {
              type: 'button',
              class: 'quick',
              style: 'margin-left:8px;height:26px',
              onclick: () => {
                node.node.remove();
                regenerate();
              },
            }, '重试')
          );
        },
      });

      await state.stream.done;
      state.streaming = false;
      sendBtn.disabled = false;
      stopBtn.style.display = 'none';

      if (!failed && buffer) {
        finishStream(node, buffer);
        state.messages.push({ role: 'assistant', content: buffer });
        const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')?.content || '';
        // 独立调用，不阻塞主回答；失败时静默收起
        void loadSuggestions({ node, lastUser, assistantText: buffer });
      } else if (!failed && !buffer) {
        node.node.remove();
      }
    }

    function send(text) {
      const content = text.trim();
      if (!content || state.streaming) return;
      if (state.aiConfigured === false) {
        toast('请先在右上角「接入 AI」配置模型');
        return;
      }
      state.messages.push({ role: 'user', content });
      // 第一条消息发出后，欢迎语与快捷提问退场，让聊天记录成为主角
      if (welcomeEl?.isConnected && messagesEl.contains(welcomeEl)) welcomeEl.remove();
      addMessage('user', content);
      input.value = '';
      input.style.height = 'auto';
      request({ history: state.messages.slice(-12) });
    }

    function regenerate() {
      if (state.streaming) return;
      while (state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') {
        state.messages.pop();
      }
      const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return;
      const nodes = messagesEl.querySelectorAll('.msg--ai');
      nodes[nodes.length - 1]?.remove();
      request({ history: state.messages.slice(-12) });
    }

    /* ---------------- 事件 ---------------- */
    composer.addEventListener('submit', (e) => {
      e.preventDefault();
      send(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    });

    stopBtn.addEventListener('click', () => {
      state.stream?.abort();
    });

    /* ---------------- 欢迎语 ---------------- */
    const empty = h('div', { class: 'chat-empty' });
    welcomeEl = empty;
    const quickRow = h('div', { class: 'quick-row' });
    const quickList = isCategory ? quickForCategory(category) : QUICK_DISH;
    quickList.forEach((q) => {
      quickRow.append(h('button', { class: 'quick', type: 'button', onclick: () => send(q) }, q));
    });

    try {
      const g = isCategory
        ? await api.greeting({ kind: category.kind, categoryId: category.id, contextDishId: topicDish?.id })
        : await api.greeting(dish.id);
      state.greeting = g.greeting;
      setMode({ aiConfigured: g.aiConfigured, model: g.model, aiSource: g.aiSource, aiMessage: g.aiMessage });
      empty.append(h('p', { class: 'chat-empty__hi', text: g.greeting }), quickRow);
      messagesEl.append(empty);
      state.messages.push({ role: 'assistant', content: g.greeting });
    } catch {
      const fallback = isCategory
        ? `我是${category.meta.name} ${category.kind === 'taste' ? '口味' : '菜系'} AI。想从哪儿聊起？`
        : `我是${dish.name}。想问什么？`;
      empty.append(h('p', { class: 'chat-empty__hi', text: fallback }), quickRow);
      messagesEl.append(empty);
      state.greeting = fallback;
      state.messages.push({ role: 'assistant', content: fallback });
    }

    // 老的「看食客评论」锚点仍然可用：落到评论区视图，而不是滚到两页之外
    if (!isCategory && location.hash === '#comments') {
      requestAnimationFrame(() => setView('comments'));
    }

    return {
      destroy() {
        state.stream?.abort();
        state.suggestAborts.forEach((c) => c.abort());
        state.suggestAborts.clear();
        offWheel.forEach((off) => {
          try {
            off?.();
          } catch {
            /* 忽略 */
          }
        });
        comments?.destroy?.();
        if (!inline) bookStage?.classList.remove('is-site-page');
      },
    };
  },
};
