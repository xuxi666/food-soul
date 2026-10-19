import { h, clear, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { CUISINE_BY_ID, TASTES, TASTE_BY_ID } from '../data/cuisines.js';
import { DIFFICULTY_LABEL } from '../data/dishes.js';

const tasteOptions = [
  { id: '', label: '不限' },
  ...TASTES.map((t) => ({ id: t.id, label: t.name })),
];

export default {
  async mount(root) {
    const search = new URLSearchParams(location.search);

    const taste = h(
      'select',
      { class: 'field__select' },
      ...tasteOptions.map((t) => h('option', { value: t.id, text: t.label, selected: t.id === (search.get('taste') || '') }))
    );
    const budget = h('input', { class: 'field__input', type: 'number', min: '0', max: '2000', placeholder: '不限', value: '' });
    const people = h('input', { class: 'field__input', type: 'number', min: '1', max: '12', value: '2' });
    const minutes = h('input', { class: 'field__input', type: 'number', min: '0', max: '600', placeholder: '不限', value: '' });
    const difficulty = h(
      'select',
      { class: 'field__select' },
      h('option', { value: '', text: '不限' }),
      h('option', { value: 'easy', text: '简单' }),
      h('option', { value: 'medium', text: '中等' }),
      h('option', { value: 'hard', text: '进阶' })
    );
    const ingredients = h('textarea', { class: 'field__area', placeholder: '例如：豆腐、鱼、青菜', maxlength: '120' });
    const avoid = h('input', { class: 'field__input', type: 'text', placeholder: '例如：不吃辣、不吃海鲜', maxlength: '80' });

    const form = h(
      'form',
      { class: 'tool-form' },
      h('h2', { text: '今天想吃点什么' }),
      h('label', { class: 'field' }, h('span', { text: '口味' }), taste),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { text: '人均预算（元）' }), budget),
        h('label', { class: 'field' }, h('span', { text: '用餐人数' }), people)
      ),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { text: '可用时间（分钟）' }), minutes),
        h('label', { class: 'field' }, h('span', { text: '难度' }), difficulty)
      ),
      h('label', { class: 'field' }, h('span', { text: '可用食材' }), ingredients),
      h('label', { class: 'field' }, h('span', { text: '忌口 / 饮食限制' }), avoid),
      h('button', { class: 'btn btn--solid', type: 'submit' }, '帮我挑三道'),
      h('p', { class: 'tool-note', text: '候选来自站内真实菜品库，模型只负责筛选后的解释，不会虚构菜品。' })
    );

    const results = h('div', { class: 'pick-grid' });
    const resultWrap = h('div', {},
      h('div', { class: 'page-head', style: 'padding-bottom:16px;margin-bottom:18px;border:0' },
        h('div', {}, h('h2', { class: 'page-head__title', style: 'font-size:20px', text: '为你挑选' })),
        h('div', { class: 'page-head__spacer' }),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: () => run({ shuffle: true }) }, '换一批')
      ),
      results
    );

    const page = h(
      'div',
      { class: 'page' },
      h('div', { class: 'wrap' },
        h('div', { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回'),
          h('div', {},
            h('h1', { class: 'page-head__title', text: '今天吃什么' }),
            h('p', { class: 'page-head__sub', text: 'FILTER THE DATABASE, THEN ASK WHY' })
          )
        ),
        h('div', { class: 'tool-grid' }, form, resultWrap)
      )
    );
    root.append(page);

    let offset = 0;

    function pickCard(p) {
      const cuisine = CUISINE_BY_ID[p.cuisine];
      return h(
        'article',
        { class: 'pick' },
        h('a', { class: 'pick__media', href: `/chat/${p.id}`, 'data-link': '' },
          h('img', { src: p.image, alt: `${p.name}`, loading: 'lazy' })
        ),
        h('div', { class: 'pick__body' },
          h('div', { class: 'pick__head' },
            h('h3', { class: 'pick__name', text: p.name }),
            h('span', { class: 'pick__cuisine', text: cuisine?.name || '' })
          ),
          h('p', { class: 'pick__reason', text: p.reason }),
          h('div', { class: 'pick__meta' },
            ...p.tastes.map((t) => h('span', { class: 'chip' }, h('i', { class: 'tag-dot' }), TASTE_BY_ID[t]?.name || t)),
            h('span', { class: 'chip', text: `约 ${p.minutes} 分钟` }),
            h('span', { class: 'chip', text: DIFFICULTY_LABEL[p.difficulty] || p.difficulty }),
            h('span', { class: 'chip', text: `约 ¥${p.price}/人` })
          ),
          h('div', { class: 'pick__actions' },
            h('a', { class: 'btn btn--sm btn--gold', href: `/chat/${p.id}`, 'data-link': '' }, '与它聊天'),
            h('a', { class: 'btn btn--sm', href: `/recipe?dish=${p.id}`, 'data-link': '' }, '查看菜谱')
          )
        )
      );
    }

    async function run({ shuffle = false } = {}) {
      if (shuffle) offset += 3;
      clear(results);
      results.append(
        h('div', { class: 'skeleton', style: 'height:150px' }),
        h('div', { class: 'skeleton', style: 'height:150px' }),
        h('div', { class: 'skeleton', style: 'height:150px' })
      );
      try {
        const res = await api.recommend({
          taste: taste.value,
          budget: Number(budget.value) || 0,
          people: Number(people.value) || 2,
          ingredients: ingredients.value,
          minutes: Number(minutes.value) || 0,
          difficulty: difficulty.value,
          avoid: avoid.value,
          offset,
        });
        clear(results);
        if (!res.picks?.length) {
          results.append(h('div', { class: 'empty-state', text: '没有符合条件的菜，放宽一点试试？' }));
          return;
        }
        res.picks.forEach((p) => results.append(pickCard(p)));
        if (res.relaxed?.length) {
          const map = { taste: '口味', budget: '预算', minutes: '时间', difficulty: '难度', ingredients: '食材' };
          toast(`条件太窄，已放宽：${res.relaxed.map((r) => map[r] || r).join('、')}`);
        }
      } catch (err) {
        clear(results);
        results.append(h('div', { class: 'empty-state', text: `推荐失败：${err.message}` }));
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      offset = 0;
      run();
    });

    run();
    return { destroy() {} };
  },
};
