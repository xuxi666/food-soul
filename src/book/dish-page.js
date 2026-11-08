/**
 * 菜品详情：单页纵向美食专题
 * ------------------------------------------------------------
 * 一份内容，两个宿主：
 *   1. 书页内的「四边扩散详情」（book/overlay.js）
 *   2. 深链接 /dishes/:id 的章节内页（views/dish-detail.js）
 *
 * 所有文字、标签、图片都来自 src/data/dishes.js（以及 /api/dishes/:id 的兜底），
 * 没有分步操作文本的菜品不做编造：步骤一律取自真实的 techniques 字段，
 * 操作要点取自 knowledge 字段。
 */
import { h } from '../lib/dom.js';
import { DISHES, DIFFICULTY_LABEL } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { guardImage } from '../lib/placeholder.js';

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

/** 风味特征标签：真实来源 = signature 里用顿号分出来的词 + 味型名 */
function flavorTokens(dish) {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && s.length <= 6 && !out.includes(s)) out.push(s);
  };
  String(dish.signature || '')
    .split(/[、·,，/|]+/)
    .forEach(push);
  (dish.tastes || []).forEach((t) => push(TASTE_BY_ID[t]?.name));
  return out.slice(0, 8);
}

function relatedOf(dish) {
  const sameCuisine = DISHES.filter((d) => d.cuisine === dish.cuisine && d.id !== dish.id);
  const sameTaste = DISHES.filter((d) => d.cuisine !== dish.cuisine && (d.tastes || [])[0] === (dish.tastes || [])[0]);
  const out = [];
  for (const d of [...sameCuisine.slice(0, 3), ...sameTaste.slice(0, 3)]) {
    if (out.length >= 4) break;
    if (!out.some((x) => x.id === d.id)) out.push(d);
  }
  return out;
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
  const related = relatedOf(dish);
  const comments = h('div', { class: 'dm-comments' });

  const root = h('article', { class: `dm${compact ? ' dm--compact' : ''}`, style: `--accent:${accent}` });

  /* ---------- B. 标题区 ---------- */
  root.append(
    h(
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
      dish.oneLiner ? h('p', { class: 'dm-line', text: dish.oneLiner }) : null
    )
  );

  /* ---------- C. 主视觉 + 基础信息 ---------- */
  const facts = [
    ['难度', DIFFICULTY_LABEL[dish.difficulty] || '—'],
    ['时间', minutes ? `${minutes} 分钟` : '—'],
    ['份量', dish.servings ? `${dish.servings} 人份` : '—'],
    ['参考', dish.price > 0 ? `${dish.price} 元/人` : '—'],
  ];
  root.append(
    h(
      'figure',
      { class: 'dm-hero' },
      guardImage(
        h('img', { src: dish.image, alt: dish.alt || dish.name, loading: 'eager', decoding: 'async' }),
        dish.name,
        '图片暂不可用'
      ),
      h(
        'figcaption',
        { class: 'dm-hero__cap' },
        h('b', { text: dish.name }),
        dish.signature ? h('span', { text: dish.signature }) : null
      )
    ),
    h(
      'ul',
      { class: 'dm-facts' },
      ...facts.map(([k, v]) => h('li', {}, h('b', { text: k }), h('span', { text: v })))
    )
  );

  /* ---------- D. 菜品介绍 ---------- */
  root.append(
    sec(
      'intro',
      kick('01', '这道菜'),
      dish.intro ? h('p', { class: 'dm-lead', text: dish.intro }) : null,
      dish.texture ? h('blockquote', { class: 'dm-quote', text: dish.texture }) : null
    )
  );

  /* ---------- E. 历史与典故 ---------- */
  if (dish.history || notes.length) {
    root.append(
      sec(
        'history',
        kick('02', '来历与掌故'),
        dish.history ? h('p', { class: 'dm-body', text: dish.history }) : null
      )
    );
  }

  /* ---------- F. 风味档案 ---------- */
  const tokens = flavorTokens(dish);
  if (tokens.length) {
    root.append(
      sec(
        'flavor',
        kick('03', '风味档案'),
        h('div', { class: 'dm-flavor' }, ...tokens.map((t) => h('em', { text: t })))
      )
    );
  }

  /* ---------- G. 食材清单 ---------- */
  if ((dish.ingredients || []).length) {
    root.append(
      sec(
        'ingredients',
        kick('04', '食材清单'),
        h(
          'ul',
          { class: 'dm-ing' },
          ...dish.ingredients.map((name, i) =>
            h('li', {}, h('i', { text: String(i + 1).padStart(2, '0') }), h('span', { text: name }))
          )
        ),
        h('p', {
          class: 'dm-note',
          text: dish.servings ? `用量按 ${dish.servings} 人份准备，可自行增减` : '用量可按人数自行增减',
        })
      )
    );
  }

  /* ---------- H. 烹饪步骤（真实 techniques 顺序） ---------- */
  if (techniques.length) {
    root.append(
      sec(
        'steps',
        kick('05', '烹饪步骤'),
        h(
          'ol',
          { class: 'dm-steps' },
          ...techniques.map((t, i) =>
            h(
              'li',
              {},
              h('b', { class: 'dm-step__no', text: String(i + 1) }),
              h('div', { class: 'dm-step__body' }, h('h4', { class: 'dm-step__name', text: t }))
            )
          )
        ),
        h('p', { class: 'dm-note', text: '按技法先后排列；关键火候与易失手的地方见下方要点' })
      )
    );
  }

  /* ---------- I. 技法与要点 ---------- */
  if (notes.length || techniques.length) {
    root.append(
      sec(
        'craft',
        kick('06', '技法与要点'),
        h(
          'ul',
          { class: 'dm-craft' },
          h('li', {}, h('b', { text: '备料' }), h('span', { text: `${dish.prep || 0} 分钟` })),
          h('li', {}, h('b', { text: '烹饪' }), h('span', { text: `${dish.cook || 0} 分钟` })),
          h('li', {}, h('b', { text: '难度' }), h('span', { text: DIFFICULTY_LABEL[dish.difficulty] || '—' }))
        ),
        ...(notes.length
          ? [
              h('h4', { class: 'dm-sub', text: '关键要点' }),
              h('ol', { class: 'dm-notes' }, ...notes.map((n, i) => h('li', { text: n, 'data-no': String(i + 1) }))),
            ]
          : [])
      )
    );
  }

  /* ---------- J. 相关内容 ---------- */
  root.append(
    sec(
      'related',
      kick('07', '相关内容'),
      related.length
        ? h(
            'div',
            { class: 'dm-related' },
            ...related.map((d) =>
              h(
                linkRelated ? 'a' : 'button',
                linkRelated
                  ? { class: 'dm-rel', href: `/dishes/${d.id}`, 'data-link': '' }
                  : { class: 'dm-rel', type: 'button', 'data-act': 'dish', 'data-dish': d.id, 'aria-label': `查看${d.name}` },
                h(
                  'span',
                  { class: 'dm-rel__media' },
                  guardImage(
                    h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy', decoding: 'async' }),
                    d.name,
                    ''
                  )
                ),
                h('span', { class: 'dm-rel__name', text: d.name }),
                h('span', { class: 'dm-rel__sig', text: d.signature || '' })
              )
            )
          )
        : null,
      h(
        'div',
        { class: 'dm-links' },
        h('a', { class: 'dm-link', href: `/videos?q=${encodeURIComponent(dish.name)}`, 'data-link': '' }, '做菜视频'),
        dish.cuisine
          ? h('a', { class: 'dm-link', href: `/cuisines/${dish.cuisine}`, 'data-link': '' }, `更多${cuisine?.name || ''}菜`)
          : tastes[0]
            ? h('a', { class: 'dm-link', href: `/tastes/${tastes[0].id}`, 'data-link': '' }, `更多${tastes[0].name}菜`)
            : null
      )
    )
  );

  /* ---------- K. AI 人格入口 ---------- */
  if (persona) {
    root.append(
      sec(
        'ai',
        kick('08', '和这道菜聊聊'),
        h(
          'div',
          { class: 'dm-ai' },
          h(
            'div',
            { class: 'dm-ai__who' },
            h('b', { class: 'dm-ai__name', text: persona.name }),
            h('span', { class: 'dm-ai__arch', text: persona.archetype })
          ),
          h('p', { class: 'dm-ai__lang', text: persona.language }),
          h('p', { class: 'dm-ai__rhythm', text: `${persona.rhythm}｜常用比喻：${(persona.metaphors || []).slice(0, 2).join('；')}` }),
          h(
            'div',
            { class: 'dm-ai__acts' },
            h(
              'button',
              {
                class: 'btn btn--sm btn--solid',
                type: 'button',
                onclick: (e) => void appRoute(`/chat/${dish.id}`, e.currentTarget, accent),
              },
              `与「${dish.name}」聊聊`
            ),
            h(
              'button',
              {
                class: 'btn btn--sm',
                type: 'button',
                onclick: (e) =>
                  void appRoute(
                    `/recipe?dish=${encodeURIComponent(dish.id)}&name=${encodeURIComponent(dish.name)}`,
                    e.currentTarget,
                    accent
                  ),
              },
              '生成菜谱'
            )
          )
        )
      )
    );
  }

  /* ---------- 评论 ---------- */
  root.append(
    sec(
      'talk',
      kick('09', '食客怎么说'),
      comments
    )
  );

  return { el: root, comments };
}