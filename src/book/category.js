/**
 * 菜系 / 口味章节：定制左右双页
 * 左页：章节索引 + 介绍 + AI 人格档案 + 操作入口
 * 右页：代表菜（2×3 网格，可翻到下一页）
 */
import { h, clear } from '../lib/dom.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES, CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { guardImage } from '../lib/placeholder.js';

const PER_PAGE = 6;

export function mountCategory(el, kind, id) {
  const state = { kind, id, page: 0 };

  const indexBox = h('div', { class: 'catb__index' });
  const heroBox = h('div', { class: 'catb__hero' });
  const personaBox = h('div', { class: 'catb__persona' });
  const listBox = h('div', { class: 'catb__grid' });
  const countLine = h('p', { class: 'catb__count' });
  const pager = h('div', { class: 'catb__pager' });

  const root = h(
    'div',
    { class: 'catb' },
    h('div', { class: 'catb__page catb__page--left' }, indexBox, heroBox, personaBox),
    h('div', { class: 'catb__page catb__page--right' }, h('div', { class: 'catb__head' }, countLine, pager), listBox)
  );
  el.append(root);

  const isTaste = () => state.kind === 'taste';
  const meta = () => (isTaste() ? TASTE_BY_ID[state.id] : CUISINE_BY_ID[state.id]);
  const dishes = () =>
    isTaste()
      ? DISHES.filter((d) => (d.tastes || []).includes(state.id))
      : DISHES.filter((d) => d.cuisine === state.id);

  function card(d) {
    const minutes = (d.prep || 0) + (d.cook || 0);
    return h(
      'a',
      { class: 'catb__card', href: `/dishes/${d.id}`, 'data-link': '', 'data-dish': d.id },
      h(
        'div',
        { class: 'catb__media' },
        guardImage(h('img', { src: d.image, alt: d.alt || d.name, loading: 'lazy' }), d.name, '图片暂不可用')
      ),
      h(
        'div',
        { class: 'catb__body' },
        h('h3', { class: 'catb__name', text: d.name }),
        h('p', { class: 'catb__line', text: (d.oneLiner || d.intro || '').slice(0, 30) }),
        h('p', { class: 'catb__meta', text: `${d.signature || ''}${minutes ? ` · ${minutes} 分钟` : ''}` })
      )
    );
  }

  function paintIndex() {
    clear(indexBox);
    const list = isTaste() ? TASTES : CUISINES;
    indexBox.append(
      h('p', { class: 'catb__kicker', text: isTaste() ? '味型索引' : '菜系索引' }),
      h(
        'div',
        { class: 'catb__chips' },
        ...list.map((c) =>
          h(
            'button',
            {
              class: `catb__chip${c.id === state.id ? ' is-on' : ''}`,
              type: 'button',
              onclick: () => {
                if (c.id === state.id) return;
                state.id = c.id;
                state.page = 0;
                paint();
                onSwitch?.(isTaste() ? `/tastes/${c.id}` : `/cuisines/${c.id}`);
              },
            },
            c.name
          )
        )
      )
    );
  }

  function paintHero() {
    const m = meta();
    if (!m) return;
    clear(heroBox);
    const tags = isTaste()
      ? [...new Set(dishes().map((d) => CUISINE_BY_ID[d.cuisine]?.name))].filter(Boolean)
      : [...new Set(dishes().flatMap((d) => d.tastes || []))].map((t) => TASTE_BY_ID[t]?.name).filter(Boolean);

    heroBox.append(
      h('p', { class: 'catb__kicker', text: isTaste() ? `TASTE · ${m.en || ''}` : `${m.region || ''} · ${m.en || ''}` }),
      h('h1', { class: 'catb__title', text: m.name }),
      h('p', { class: 'catb__tagline', text: isTaste() ? '同一种味型，共享一种说话方式。' : m.tagline }),
      h('p', { class: 'catb__desc', text: m.desc }),
      h('div', { class: 'catb__tags' }, ...tags.slice(0, 4).map((t) => h('span', { class: 'catb__tag', text: t }))),
      (() => {
        const lead = dishes()[0];
        return lead
          ? h('a', { class: 'catb__lead', href: `/dishes/${lead.id}`, 'data-link': '' },
              guardImage(h('img', { src: lead.image, alt: lead.alt || lead.name }), lead.name, '图片暂不可用'))
          : null;
      })(),
      h(
        'div',
        { class: 'catb__actions' },
        h(
          'a',
          {
            class: 'btn btn--sm btn--solid',
            href: `/chat/${isTaste() ? 'taste' : 'cuisine'}/${state.id}${dishes()[0] ? `?dish=${dishes()[0].id}` : ''}`,
            'data-link': '',
          },
          `与「${m.name} AI」聊天`
        ),
        h(
          'a',
          { class: 'btn btn--sm', href: `/recipe${dishes()[0] ? `?dish=${dishes()[0].id}` : ''}`, 'data-link': '' },
          '生成菜谱'
        )
      )
    );
  }

  function paintPersona() {
    clear(personaBox);
    const list = dishes();
    const persona = isTaste() ? PERSONALITY_BY_ID[state.id] : PERSONALITY_BY_ID[list[0]?.personality];
    if (!persona) return;
    personaBox.append(
      h('p', { class: 'catb__kicker', text: 'AI 人格档案' }),
      h(
        'div',
        { class: 'catb__sheet' },
        h('div', { class: 'catb__cell' }, h('b', { text: persona.name }), h('span', { text: persona.archetype })),
        h('div', { class: 'catb__cell' }, h('b', { text: '语言风格' }), h('span', { text: persona.language })),
        h('div', { class: 'catb__cell' }, h('b', { text: '常用比喻' }), h('span', { text: (persona.metaphors || []).slice(0, 2).join('；') }))
      )
    );
  }

  function paintList() {
    const list = dishes();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page >= pages) state.page = pages - 1;
    const slice = list.slice(state.page * PER_PAGE, state.page * PER_PAGE + PER_PAGE);
    clear(listBox);
    slice.forEach((d) => listBox.append(card(d)));
    if (!slice.length) listBox.append(h('p', { class: 'catb__empty', text: '这个分类暂时没有菜' }));
    countLine.textContent = `共 ${list.length} 道 · 第 ${state.page + 1} / ${pages} 页`;
    clear(pager);
    if (pages > 1) {
      pager.append(
        h(
          'button',
          { class: 'catb__turn', type: 'button', disabled: state.page <= 0 ? '' : null, onclick: () => { state.page -= 1; paintList(); } },
          '‹'
        ),
        h(
          'button',
          { class: 'catb__turn', type: 'button', disabled: state.page >= pages - 1 ? '' : null, onclick: () => { state.page += 1; paintList(); } },
          '›'
        )
      );
    }
  }

  function paint() {
    paintIndex();
    paintHero();
    paintPersona();
    paintList();
  }

  let onSwitch = null;
  paint();

  return {
    el: root,
    update(nextKind, nextId) {
      if (nextKind === state.kind && nextId === state.id) return;
      state.kind = nextKind;
      state.id = nextId;
      state.page = 0;
      paint();
    },
    setSwitchHandler(fn) {
      onSwitch = fn;
    },
    destroy() {
      root.remove();
    },
  };
}
