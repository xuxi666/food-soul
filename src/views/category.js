import { h, clear } from '../lib/dom.js';
import { DISHES, DISH_BY_ID, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { getVisualTheme, themeIdFor, applyTheme } from '../data/visualThemes.js';
import { fluidTransition } from '../lib/transition.js';
import { mountInto, adopt } from '../router.js';
import { guardImage } from '../lib/placeholder.js';
import {
  catalogState,
  catalogMeta,
  hydrateCatalog,
  loadMoreDishes,
  catalogMoreBar,
} from '../lib/catalog.js';

export function dishCard(d) {
  const cuisine = CUISINE_BY_ID[d.cuisine];
  const minutes = (d.prep || 0) + (d.cook || 0);
  return h(
    'article',
    { class: `dish-card${d.aiGenerated ? ' is-ai' : ''}`, 'data-dish': d.id },
    h('a', { class: 'dish-card__media', href: `/dishes/${d.id}`, 'data-link': '' },
      guardImage(
        h('img', { src: d.image, alt: d.alt, loading: 'lazy', decoding: 'async' }),
        d.name,
        d.aiGenerated ? 'AI 检索图片暂不可用' : '图片暂不可用'
      ),
      h('span', { class: 'dish-card__tags' },
        ...d.tastes.slice(0, 2).map((t) => h('i', { class: 'dish-card__tag', text: TASTE_BY_ID[t]?.name || t }))
      ),
      d.aiGenerated ? h('span', { class: 'dish-card__ai', text: 'AI 检索' }) : null
    ),
    h('div', { class: 'dish-card__body' },
      h('div', { class: 'dish-card__head' },
        h('h3', { class: 'dish-card__name', text: d.name }),
        h('span', { class: 'dish-card__cuisine', text: cuisine?.name || '' })
      ),
      h('p', { class: 'dish-card__line', text: d.intro }),
      h('p', { class: 'dish-card__sig', text: `${d.signature}${minutes ? ` · 约 ${minutes} 分钟` : ''}` }),
      h('div', { class: 'dish-card__actions' },
        h('a', { class: 'btn btn--sm', href: `/dishes/${d.id}`, 'data-link': '' }, '查看详情'),
        h('a', { class: 'btn btn--sm btn--gold', href: `/chat/${d.id}`, 'data-link': '' }, '与它聊天'),
        h('a', { class: 'btn btn--sm', href: `/recipe?dish=${d.id}`, 'data-link': '' }, '查看做法')
      )
    )
  );
}

/**
 * 菜系 / 口味详情页（两种模式共用一个骨架，内容来自各自的数据源）
 */
export function buildCategoryPage({ kind, id }) {
  const isTaste = kind === 'taste';
  const meta = isTaste ? TASTE_BY_ID[id] : CUISINE_BY_ID[id];
  if (!meta) return null;

  const dishes = isTaste
    ? DISHES.filter((d) => d.tastes.includes(id))
    : DISHES.filter((d) => d.cuisine === id);
  const persona = isTaste ? PERSONALITY_BY_ID[id] : PERSONALITY_BY_ID[dishes[0]?.personality];
  const theme = getVisualTheme(themeIdFor({ kind, id }));
  const accent = theme.accent || (isTaste ? meta.color : meta.accent);
  const lead = dishes[0];

  const tags = isTaste
    ? [...new Set(dishes.map((d) => CUISINE_BY_ID[d.cuisine]?.name))].filter(Boolean)
    : [...new Set(dishes.flatMap((d) => d.tastes))].map((t) => TASTE_BY_ID[t]?.name).filter(Boolean);

  const go = (href, el) => {
    // 先写入地址：转场里的目标页在 mount 时读的是 location.search，
    // adopt 要到动画结束才 pushState，晚一步会导致 query 参数读不到
    if (location.pathname + location.search !== href.split('#')[0]) {
      history.pushState({}, '', href);
    }
    fluidTransition({
      kind: 'card',
      el,
      accent,
      render: (stageEl) => mountInto(href, stageEl),
      commit: (stageEl, instance) => adopt(stageEl, instance, href),
    });
  };

  /* ---------------- 分类菜品列表：默认 10 道 + 加载更多 ---------------- */
  const state = catalogState(kind, id);
  const counter = h('p', { class: 'cat-block__sub' });
  const grid = h('div', { class: 'dish-grid', role: 'list' });
  const renderList = () => {
    clear(grid);
    state.items.forEach((d) => grid.append(dishCard(d)));
    const brief = catalogMeta(state);
    counter.textContent = `共 ${brief.total} 道 · 已展示 ${brief.shown} 道${
      brief.aiCount ? ` · 其中 AI 检索 ${brief.aiCount} 道` : ''
    } · 点击卡片查看详情`;
  };
  const moreBar = catalogMoreBar({
    state: () => state,
    onLoad: async () => {
      await loadMoreDishes(kind, id);
      renderList();
    },
  });
  renderList();
  hydrateCatalog(kind, id).then(() => {
    renderList();
    moreBar.paint();
  });

  const page = h(
    'div',
    { class: 'page theme-page', style: `--accent:${accent}` },
    h('div', { class: 'theme-glow', 'aria-hidden': 'true' }),
    h('div', { class: 'wrap' },
      h('div', { class: 'page-head' },
        h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回转盘'),
        h('div', {},
          h('h1', { class: 'page-head__title', text: meta.name }),
          h('p', { class: 'page-head__sub', text: isTaste ? `TASTE · ${meta.en}` : `${meta.region} · ${meta.en}` })
        ),
        h('div', { class: 'page-head__spacer' }),
        h('a', { class: 'btn btn--sm', href: '/dishes', 'data-link': '' }, '美食图鉴')
      ),

      h('section', { class: 'cat-hero' },
        h('div', { class: 'cat-hero__copy' },
          h('p', { class: 'cat-hero__kicker', text: isTaste ? '味型 · 决定人格' : '菜系 · 地域与体系' }),
          h('p', { class: 'cat-hero__tagline', text: isTaste ? '同一种味型，共享一种说话方式。' : meta.tagline }),
          h('p', { class: 'cat-hero__desc', text: meta.desc }),
          h('div', { class: 'cat-hero__tags' }, ...tags.slice(0, 4).map((t) => h('span', { class: 'chip chip--gold', text: t }))),
          h('div', { class: 'cat-hero__actions' },
            h('button', {
              class: 'btn btn--solid',
              type: 'button',
              onclick: (e) => go(`/chat/${kind}/${id}${lead ? `?dish=${lead.id}` : ''}`, e.currentTarget),
            }, `与「${meta.name} AI」聊天`),
            h('button', {
              class: 'btn',
              type: 'button',
              onclick: (e) => go(`/recipe?dish=${lead.id}`, e.currentTarget),
            }, '生成菜谱')
          )
        ),
        lead
          ? h('a', { class: 'cat-hero__media', href: `/chat/${lead.id}`, 'data-link': '' },
              guardImage(h('img', { src: lead.image, alt: lead.alt }), lead.name, '图片暂不可用'),
              h('span', { class: 'cat-hero__caption', text: lead.oneLiner })
            )
          : null
      ),

      persona
        ? h('section', { class: 'cat-block' },
            h('h2', { class: 'cat-block__title', text: 'AI 人格档案' }),
            h('p', { class: 'cat-block__sub', text: isTaste ? `由「${meta.name}」味型驱动，与菜系无关` : '由代表菜的主味型决定，而非菜系名称' }),
            h('div', { class: 'persona-sheet' },
              h('div', { class: 'persona-sheet__cell' }, h('b', { text: persona.name }), h('span', { text: persona.archetype })),
              h('div', { class: 'persona-sheet__cell' }, h('b', { text: '语言风格' }), h('span', { text: persona.language })),
              h('div', { class: 'persona-sheet__cell' }, h('b', { text: '句式与节奏' }), h('span', { text: persona.rhythm })),
              h('div', { class: 'persona-sheet__cell' }, h('b', { text: '常用比喻' }), h('span', { text: persona.metaphors.join('；') })),
              h('div', { class: 'persona-sheet__cell' }, h('b', { text: '不这样说' }), h('span', { text: persona.avoid.join('；') }))
            )
          )
        : null,

      h('section', { class: 'cat-block' },
        h('h2', { class: 'cat-block__title', text: isTaste ? '这个味型下的菜' : '代表菜' }),
        counter,
        grid,
        moreBar.el
      )
    )
  );

  return page;
}
