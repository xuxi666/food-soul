import { h, clear } from '../lib/dom.js';
import { DISHES, DISH_BY_ID, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { getVisualTheme, applyTheme } from '../data/visualThemes.js';
import { fluidTransition } from '../lib/transition.js';
import { mountInto, adopt } from '../router.js';
import { dishCard } from './category.js';
import notFound from './notfound.js';
import { mountComments } from '../components/comments.js';
import { api } from '../lib/api.js';
import { guardImage } from '../lib/placeholder.js';

/** 菜品详情页 /dishes/:id */
export default {
  async mount(root, params) {
    const id = params?.[0];
    let dish = DISH_BY_ID[id];
    if (!dish && id) {
      try {
        const remote = await api.dish(id);
        dish = remote?.dish || null;
      } catch {
        dish = null;
      }
    }
    if (!dish) return notFound.mount(root, params);

    const cuisine = CUISINE_BY_ID[dish.cuisine];
    const persona = PERSONALITY_BY_ID[dish.personality] || PERSONALITY_BY_ID[dish.tastes[0]];
    const theme = getVisualTheme(dish.cuisine);
    const accent = theme.accent || cuisine?.accent || TASTE_BY_ID[dish.tastes[0]]?.color || '#d8b26a';

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

    const related = [
      ...DISHES.filter((d) => d.cuisine === dish.cuisine && d.id !== dish.id).slice(0, 3),
      ...DISHES.filter((d) => d.cuisine !== dish.cuisine && d.tastes[0] === dish.tastes[0]).slice(0, 3),
    ].slice(0, 6);

    const cell = (label, value) => h('div', { class: 'persona-sheet__cell' }, h('b', { text: label }), h('span', { text: value || '暂无' }));

    const commentsSlot = h('div', { class: 'detail-comments' });

    const page = h(
      'div',
      { class: 'page theme-page', style: `--accent:${accent}` },
      h('div', { class: 'theme-glow', 'aria-hidden': 'true' }),
      h('div', { class: 'wrap' },
        h('div', { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/dishes', 'data-link': '' }, '← 返回图鉴'),
          h('div', {},
            h('h1', { class: 'page-head__title', text: dish.name }),
            h('p', { class: 'page-head__sub', text: dish.nameEn ? `${dish.nameEn} · ${cuisine?.name || ''}` : cuisine?.name || '' })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: `/cuisines/${dish.cuisine}`, 'data-link': '' }, `更多${cuisine?.name || ''}菜`)
        ),

        h('section', { class: 'cat-hero detail-hero' },
          h('div', { class: 'cat-hero__copy' },
            h('p', { class: 'cat-hero__kicker', text: `${cuisine?.name || ''} · ${TASTE_BY_ID[dish.tastes[0]]?.name || ''}味型` }),
            h('p', { class: 'cat-hero__tagline', text: dish.oneLiner }),
            h('div', { class: 'cat-hero__tags' },
              ...dish.tastes.map((t) => h('span', { class: 'chip chip--gold', text: TASTE_BY_ID[t]?.name || t })),
              h('span', { class: 'chip', text: `${DIFFICULTY_LABEL[dish.difficulty] || dish.difficulty}难度` }),
              h('span', { class: 'chip', text: `约 ${dish.prep + dish.cook} 分钟` }),
              h('span', {
                class: 'chip',
                text: dish.price > 0 ? `${dish.price} 元/人 · ${dish.servings} 人份` : `${dish.servings} 人份`,
              }),
              dish.aiGenerated
                ? h('span', { class: 'chip chip--ai', text: 'AI 联网检索补全', title: dish.credit || '' })
                : null
            ),
            h('div', { class: 'cat-hero__actions' },
              h('button', {
                class: 'btn btn--solid',
                type: 'button',
                onclick: (e) => go(`/chat/${dish.id}`, e.currentTarget),
              }, `与「${dish.name}」聊聊`),
              h('button', {
                class: 'btn',
                type: 'button',
                // 同时带上菜品 id 与真实名称：菜谱页优先用名称填输入框，避免 id 解析失败时名称丢失
                onclick: (e) =>
                  go(`/recipe?dish=${encodeURIComponent(dish.id)}&name=${encodeURIComponent(dish.name)}`, e.currentTarget),
              }, '生成菜谱'),
              h('a', { class: 'btn', href: `/videos?q=${encodeURIComponent(dish.name)}`, 'data-link': '' }, '做菜视频')
            )
          ),
          h('div', { class: 'cat-hero__media' },
            guardImage(h('img', { src: dish.image, alt: dish.alt || dish.name }), dish.name, '图片暂不可用'),
            h('span', { class: 'cat-hero__caption', text: dish.signature || '风味均衡' })
          )
        ),

        h('section', { class: 'cat-block' },
          h('h2', { class: 'cat-block__title', text: '这道菜的底细' }),
          h('div', { class: 'persona-sheet detail-sheet' },
            cell('风味签名', dish.signature),
            cell('口感', dish.texture),
            cell('代表食材', (dish.ingredients || []).join('、')),
            cell('核心技法', (dish.techniques || []).join('、')),
            cell('文化背景', dish.history),
            cell('火候参考', `备料 ${dish.prep} 分钟 · 烹饪 ${dish.cook} 分钟`)
          ),
          dish.knowledge?.length
            ? h('div', { class: 'detail-knowledge' },
                h('h3', { class: 'detail-knowledge__title', text: '专属知识' }),
                ...dish.knowledge.map((k) => h('p', { class: 'detail-knowledge__item', text: `· ${k}` }))
              )
            : null
        ),

        persona
          ? h('section', { class: 'cat-block' },
              h('h2', { class: 'cat-block__title', text: '它的 AI 人格' }),
              h('p', { class: 'cat-block__sub', text: `由「${TASTE_BY_ID[dish.tastes[0]]?.name || dish.tastes[0]}」味型驱动，与菜系无关` }),
              h('div', { class: 'persona-sheet' },
                cell('人格', `${persona.name}｜${persona.archetype}`),
                cell('语言风格', persona.language),
                cell('句式与节奏', persona.rhythm),
                cell('常用比喻', persona.metaphors.join('；')),
                cell('不这样说', persona.avoid.join('；'))
              )
            )
          : null,

        related.length
          ? h('section', { class: 'cat-block' },
              h('h2', { class: 'cat-block__title', text: '相关菜品' }),
              h('p', { class: 'cat-block__sub', text: '同菜系或同味型的其他菜' }),
              h('div', { class: 'dish-grid' }, ...related.map(dishCard))
            )
          : null,

        h('section', { class: 'cat-block' },
          h('h2', { class: 'cat-block__title', text: '食客怎么说' }),
          commentsSlot
        )
      )
    );

    clear(root);
    applyTheme(page, dish.cuisine);
    root.append(page);
    mountComments(commentsSlot, dish.id);

    return { destroy() {} };
  },
};
