import { h, clear, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { DISHES } from '../data/dishes.js';

const PLATFORM_LABEL = { bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书', xigua: '西瓜' };

/** 秒 → 「3:36」 */
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const pad = (v) => String(v).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** 做菜视频搜索页 /videos?q=菜名 */
export default {
  async mount(root) {
    const query = new URLSearchParams(location.search);
    const initial = (query.get('q') || '').trim();

    const input = h('input', {
      class: 'field__input',
      type: 'search',
      placeholder: '输入菜名，例如：麻婆豆腐',
      'aria-label': '搜索菜名',
      maxlength: '40',
      value: initial,
    });
    const submit = h('button', { class: 'btn btn--solid', type: 'submit' }, '搜索视频');
    const form = h('form', { class: 'video-search' }, input, submit);

    const resultsEl = h('div', { class: 'video-results', 'aria-live': 'polite' });
    const noteEl = h('p', { class: 'video-note' });
    const entriesEl = h('div', { class: 'video-entries' });

    const quick = h(
      'div',
      { class: 'video-quick' },
      h('span', { class: 'video-quick__label', text: '热门尝试' }),
      ...DISHES.slice(0, 8).map((d) =>
        h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => {
            input.value = d.name;
            search(d.name);
          },
        }, d.name)
      )
    );

    const page = h(
      'div',
      { class: 'page videos-page' },
      h('div', { class: 'wrap' },
        h('div', { class: 'page-head' },
          h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回首页'),
          h('div', {},
            h('h1', { class: 'page-head__title', text: '做菜视频' }),
            h('p', { class: 'page-head__sub', text: 'SITE VIDEO SEARCH · 真实检索 · 站内展示' })
          ),
          h('div', { class: 'page-head__spacer' }),
          h('a', { class: 'btn btn--sm', href: '/dishes', 'data-link': '' }, '美食图鉴'),
          h('a', { class: 'btn btn--sm', href: '/recipe', 'data-link': '' }, '菜谱工作台')
        ),
        form,
        quick,
        noteEl,
        resultsEl,
        entriesEl
      )
    );

    let busy = false;

    async function search(q) {
      const word = String(q || input.value || '').trim().slice(0, 40);
      if (!word) {
        toast('先输入一个菜名', 'warn');
        input.focus();
        return;
      }
      if (busy) return;
      busy = true;
      submit.disabled = true;
      noteEl.textContent = '';
      entriesEl.replaceChildren();
      clear(resultsEl);
      resultsEl.append(
        ...Array.from({ length: 4 }, () => h('div', { class: 'video-card video-card--skeleton', 'aria-hidden': 'true' }))
      );
      try {
        const bundle = await api.videos(word, 8);
        renderBundle(bundle);
      } catch (err) {
        noteEl.textContent = `视频搜索服务暂时不可用：${err?.message || '网络异常'}`;
        clear(resultsEl);
        resultsEl.append(
          h('div', { class: 'video-fail' },
            h('p', { text: '暂时没能连上视频搜索服务。' }),
            h('button', { class: 'btn btn--sm', type: 'button', onclick: () => search(word) }, '重试')
          )
        );
      } finally {
        busy = false;
        submit.disabled = false;
      }
    }

    function renderBundle(bundle) {
      clear(resultsEl);
      noteEl.textContent = bundle?.note || '';
      const results = bundle?.results || [];
      if (results.length) {
        for (const item of results) {
          resultsEl.append(
            h('a', {
              class: 'video-card',
              href: item.url,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              title: item.title,
            },
              h('div', { class: 'video-card__cover' },
                item.coverUrl
                  ? h('img', { src: item.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
                  : h('div', { class: 'video-card__cover--empty', text: '▶' }),
                item.duration
                  ? h('span', { class: 'video-card__dur', text: fmtDuration(item.duration) })
                  : null,
                h('span', { class: 'video-card__platform', text: PLATFORM_LABEL[item.platform] || item.platform })
              ),
              h('div', { class: 'video-card__body' },
                h('p', { class: 'video-card__title', text: item.title }),
                h('p', { class: 'video-card__meta' },
                  h('span', { text: item.author || '未知作者' }),
                  item.publishedAt
                    ? h('span', { text: item.publishedAt.slice(0, 10) })
                    : null
                )
              )
            )
          );
        }
      } else if (!results.length) {
        resultsEl.append(h('div', { class: 'video-none', text: '没有找到具体视频。可以用下面的平台入口继续找。' }));
      }

      const entries = bundle?.entries || [];
      if (entries.length) {
        entriesEl.append(
          h('h3', { class: 'video-entries__title', text: '去平台内继续搜索' }),
          h('div', { class: 'video-entries__list' },
            ...entries.map((entry) =>
              h('a', {
                class: 'btn btn--sm',
                href: entry.url,
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
              }, entry.title)
            )
          )
        );
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const word = String(input.value || '').trim();
      if (word) history.replaceState(history.state, '', `/videos?q=${encodeURIComponent(word)}`);
      search(word);
    });

    clear(root);
    root.append(page);
    if (initial) search(initial);

    return {
      destroy() {},
    };
  },
};
