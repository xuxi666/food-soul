/**
 * 视频章节：左页视频列表 / 右页按菜系挑菜
 * 数据来自现有 /api/videos/search（B 站真实检索）
 */
import { h, clear } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { DISHES } from '../data/dishes.js';
import { CUISINES } from '../data/cuisines.js';

const PLATFORM = { bilibili: 'B 站', douyin: '抖音', xiaohongshu: '小红书', xigua: '西瓜' };

function fmtDuration(sec) {
  const n = Math.round(Number(sec) || 0);
  if (!n) return '';
  const m = Math.floor(n / 60);
  const s = String(n % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function mountVideos(el) {
  const state = { q: '麻婆豆腐', list: [], entries: [], note: '', loading: false, error: '' };

  const searchInput = h('input', { class: 'vid__search', type: 'search', placeholder: '搜菜名，例如 红烧肉', value: state.q });
  const status = h('p', { class: 'vid__status', text: '' });
  const listBox = h('div', { class: 'vid__list' });
  const pickBox = h('div', { class: 'vid__picks' });
  const entryBox = h('div', { class: 'vid__entries' });
  const resultHead = h('p', { class: 'vid__kicker', text: '检索结果' });

  const root = h(
    'div',
    { class: 'vid' },
    // 左页：找视频（搜索 + 按菜系挑 + 平台入口）
    h(
      'div',
      { class: 'vid__page vid__page--left' },
      h('div', { class: 'vid__head' }, h('b', { text: '做菜视频' }), searchInput),
      status,
      h('p', { class: 'vid__kicker', text: '按菜系挑一道' }),
      pickBox,
      entryBox
    ),
    // 右页：看结果（视频列表）
    h('div', { class: 'vid__page vid__page--right' }, resultHead, listBox)
  );
  el.append(root);

  function paintPicks() {
    clear(pickBox);
    for (const c of CUISINES) {
      const dishes = DISHES.filter((d) => d.cuisine === c.id);
      if (!dishes.length) continue;
      pickBox.append(
        h(
          'div',
          { class: 'vid__group' },
          h(
            'div',
            { class: 'vid__group-head' },
            h('p', { class: 'vid__group-name', text: c.name }),
            h('span', { class: 'vid__group-count', text: `${dishes.length} 道` })
          ),
          h(
            'div',
            { class: 'vid__group-list' },
            ...dishes.slice(0, 3).map((d) =>
              h(
                'button',
                {
                  class: `vid__pick${state.q === d.name ? ' is-on' : ''}`,
                  type: 'button',
                  'data-dish': d.id,
                  onclick: () => {
                    state.q = d.name;
                    searchInput.value = d.name;
                    paintPicks();
                    void load();
                  },
                },
                d.name
              )
            )
          )
        )
      );
    }
  }

  function paintList() {
    clear(listBox);
    clear(entryBox);
    if (state.loading) {
      status.textContent = `正在检索「${state.q}」…`;
      resultHead.textContent = '检索结果';
      listBox.append(h('p', { class: 'vid__empty', text: '加载中…' }));
      return;
    }
    if (state.error) {
      status.textContent = state.error;
      resultHead.textContent = '检索结果';
      listBox.append(h('p', { class: 'vid__empty', text: '换个菜名试试' }));
      return;
    }
    status.textContent = `当前关键词「${state.q}」`;
    resultHead.textContent = `「${state.q}」的视频 · ${state.list.length} 条`;
    if (!state.list.length) {
      listBox.append(h('p', { class: 'vid__empty', text: '没有找到相关视频，可以直接去平台里搜：' }));
    }
    for (const v of state.list) {
      listBox.append(
        h(
          'a',
          { class: 'vid__item', href: v.url, target: '_blank', rel: 'noopener noreferrer' },
          h(
            'div',
            { class: 'vid__cover' },
            v.coverUrl
              ? h('img', { src: v.coverUrl, alt: v.title || '', loading: 'lazy', referrerpolicy: 'no-referrer' })
              : h('span', { class: 'vid__cover-ph', text: '视频' }),
            v.duration ? h('span', { class: 'vid__dur', text: fmtDuration(v.duration) }) : null
          ),
          h(
            'div',
            { class: 'vid__meta' },
            h('p', { class: 'vid__title', text: v.title || '' }),
            h('p', { class: 'vid__sub', text: [PLATFORM[v.platform] || v.platform, v.author].filter(Boolean).join(' · ') })
          )
        )
      );
    }

    // 平台入口：检索不到时的兜底，也让右页底部有真实去处
    if (state.entries.length) {
      entryBox.append(
        h('p', { class: 'vid__entries-title', text: '去平台里继续找' }),
        h(
          'div',
          { class: 'vid__entries-list' },
          ...state.entries.map((entry) =>
            h('a', { class: 'vid__entry', href: entry.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, entry.title)
          )
        )
      );
    }
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    paintList();
    try {
      const bundle = await api.videos(state.q, 8);
      state.list = bundle?.results || [];
      state.entries = bundle?.entries || [];
      state.note = bundle?.note || '';
    } catch (err) {
      state.error = `检索失败：${String(err.message || err).slice(0, 30)}`;
      state.list = [];
      state.entries = [];
    } finally {
      state.loading = false;
      paintList();
    }
  }

  let timer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = searchInput.value.trim();
      if (!v || v === state.q) return;
      state.q = v;
      paintPicks();
      void load();
    }, 420);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = searchInput.value.trim();
    if (!v) return;
    state.q = v;
    paintPicks();
    void load();
  });

  paintPicks();
  void load();

  return {
    el: root,
    destroy() {
      clearTimeout(timer);
      root.remove();
    },
  };
}
