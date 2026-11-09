/**
 * 视频章节
 * ------------------------------------------------------------
 * 左页：搜索工作区（标题 / 搜索框 / 状态 / 结果列表 / 独立滚动）
 * 右页：中华美食书法封面（固定展示，不承载任何搜索结果）
 *
 * 状态机：idle → loading → success | empty | error
 * 数据一律来自现有 /api/videos/search（B 站实时检索），不造假数据、不复用旧结果。
 *
 * 入口约定：
 *   · 普通进入（书签 / 目录 / 翻页）→ 地址里没有 q，保持 idle，不发请求；
 *   · 菜品详情页「做菜视频」→ 地址带 ?q=菜名，挂载时填入并自动检索一次；
 *   · 离开本章时由书页通知 resetSearch()，下次回来是干净的初始态。
 */
import { h, clear, html } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { enableWheelScroll, enableTouchScroll } from '../lib/wheel-scroll.js';

const PLATFORM = { bilibili: 'B 站', douyin: '抖音', xiaohongshu: '小红书', xigua: '西瓜' };
const PHASE = { IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', EMPTY: 'empty', ERROR: 'error' };

function fmtDuration(sec) {
  const n = Math.round(Number(sec) || 0);
  if (!n) return '';
  const m = Math.floor(n / 60);
  const s = String(n % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** 地址里的关键词（只有从详情页跳过来才带） */
function queryFromUrl() {
  try {
    return (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 24);
  } catch {
    return '';
  }
}

/* ------------------------------ 水墨小画 ------------------------------ */

/** 碗、筷、蒸汽、谷粒：左页空状态用的点睛小画 */
const INK_BOWL = `
<svg class="vid__ink" viewBox="0 0 320 200" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M134 82c-10-15-3-27 5-37 7-9 9-17 4-27" stroke-width="1.6" opacity=".42"/>
    <path d="M163 78c-10-16-2-29 6-40 6-8 8-15 3-23" stroke-width="1.9" opacity=".58"/>
    <path d="M192 84c-8-13-1-23 6-32 6-8 8-14 3-21" stroke-width="1.5" opacity=".34"/>
    <path d="M98 102h126c-2 31-25 53-63 53s-61-22-63-53z" stroke-width="2.2" opacity=".72"/>
    <path d="M98 102c21 8 105 8 126 0" stroke-width="1.3" opacity=".46"/>
    <path d="M140 155c-1 8-3 12-7 17M184 155c1 8 3 12 7 17" stroke-width="1.5" opacity=".4"/>
    <path d="M124 172h74" stroke-width="2.1" opacity=".48"/>
    <path d="M214 58 130 98" stroke-width="2.7" opacity=".5"/>
    <path d="M221 70 138 106" stroke-width="2.2" opacity=".4"/>
    <ellipse cx="74" cy="150" rx="3.6" ry="2" opacity=".34"/>
    <ellipse cx="86" cy="163" rx="2.8" ry="1.7" opacity=".26"/>
    <ellipse cx="57" cy="139" rx="2.4" ry="1.5" opacity=".28"/>
  </g>
</svg>`;

/** 右页封面上的水墨：一碗饭、一双筷、几缕热气、散落的谷物与器皿 */
const INK_COVER = `
<svg class="vcover__ink" viewBox="0 0 420 360" aria-hidden="true" focusable="false">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="205" cy="182" r="132" stroke-width=".8" opacity=".16"/>
    <path d="M252 84c-14-21-4-38 7-52 9-12 12-23 5-34" stroke-width="1.7" opacity=".4"/>
    <path d="M288 92c-13-22-3-40 8-55 8-11 10-21 4-30" stroke-width="1.9" opacity=".5"/>
    <path d="M218 86c-11-17-3-31 6-43 7-10 9-18 4-26" stroke-width="1.4" opacity=".3"/>
    <path d="M118 168h180c-3 44-35 75-90 75s-87-31-90-75z" stroke-width="2.4" opacity=".62"/>
    <path d="M118 168c30 11 150 11 180 0" stroke-width="1.3" opacity=".4"/>
    <path d="M178 243c-2 11-4 17-10 24M238 243c2 11 4 17 10 24" stroke-width="1.6" opacity=".34"/>
    <path d="M156 268h104" stroke-width="2.2" opacity=".42"/>
    <path d="M332 118 154 190" stroke-width="3" opacity=".42"/>
    <path d="M341 136 165 202" stroke-width="2.4" opacity=".32"/>
    <ellipse cx="84" cy="250" rx="4.6" ry="2.6" opacity=".3"/>
    <ellipse cx="101" cy="268" rx="3.6" ry="2" opacity=".22"/>
    <ellipse cx="62" cy="231" rx="3" ry="1.8" opacity=".24"/>
    <ellipse cx="332" cy="262" rx="26" ry="9" stroke-width="1.2" opacity=".26"/>
    <ellipse cx="332" cy="262" rx="15" ry="5" stroke-width="1" opacity=".2"/>
    <path d="M74 300c26-10 56-10 82 0" stroke-width="1.2" opacity=".18"/>
  </g>
</svg>`;

/* ------------------------------ 挂载 ------------------------------ */

export function mountVideos(el) {
  const state = {
    phase: PHASE.IDLE,
    q: '',
    list: [],
    entries: [],
    note: '',
    error: '',
    token: 0,
  };

  /* --- 顶部：标题 + 搜索框 + 按钮 + 状态 --- */
  const searchInput = h('input', {
    class: 'vid__search',
    type: 'search',
    name: 'q',
    placeholder: '输入菜品名称，例如 松鼠鳜鱼',
    autocomplete: 'off',
    'aria-label': '视频搜索关键词',
  });
  const status = h('p', { class: 'vid__status', role: 'status', 'aria-live': 'polite' });
  const body = h('div', { class: 'vid__body' });

  const form = h(
    'form',
    { class: 'vid__form', method: 'get', onsubmit: (e) => { e.preventDefault(); submit(); } },
    h(
      'span',
      { class: 'vid__field' },
      html`<svg class="vid__field-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m15.2 15.4 4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      searchInput
    ),
    h('button', { class: 'vid__go', type: 'submit' }, h('span', { text: '搜索' }))
  );

  const top = h(
    'div',
    { class: 'vid__top' },
    h('p', { class: 'vid__eyebrow', text: '影像·检索' }),
    h(
      'div',
      { class: 'vid__titlerow' },
      h('h2', { class: 'vid__title' }, h('span', { text: '做菜视频' }), h('em', { text: 'VIDEO' })),
      h('span', { class: 'vid__title-line', 'aria-hidden': 'true' })
    ),
    form,
    status
  );

  const left = h('div', { class: 'vid__page vid__page--left' }, top, body);

  /* --- 右页：中华美食书法封面（固定，不随搜索变化） --- */
  const right = h(
    'div',
    { class: 'vid__page vid__page--right' },
    h(
      'div',
      { class: 'vcover' },
      h('span', { class: 'vcover__wash', 'aria-hidden': 'true' }),
      h(
        'header',
        { class: 'vcover__top' },
        h('p', { class: 'vcover__mark', text: '食有灵 · 影像卷' }),
        h('span', { class: 'vcover__rule', 'aria-hidden': 'true' }),
        h('p', { class: 'vcover__en', text: 'THE TASTE OF CHINA' })
      ),
      h(
        'div',
        { class: 'vcover__stage' },
        h('p', { class: 'vcover__aside', text: '五味调和 · 四季有时' }),
        h('div', { class: 'vcover__art' }, html`${INK_COVER}`),
        h(
          'div',
          { class: 'vcover__poem' },
          h('p', { class: 'vcover__line', text: '人间有味是清欢' }),
          h(
            'div',
            { class: 'vcover__sign' },
            h('p', { class: 'vcover__by', text: '苏轼《浣溪沙》' }),
            h('span', { class: 'vcover__seal', 'aria-hidden': 'true', text: '清欢' })
          )
        )
      ),
      h(
        'footer',
        { class: 'vcover__foot' },
        h(
          'p',
          { class: 'vcover__quote' },
          h('span', { text: '食不厌精，脍不厌细' }),
          h('em', { text: '《论语 · 乡党》' })
        ),
        h('p', { class: 'vcover__note', text: '一箸一味，皆是中华饮食的千年传承' }),
        h('span', { class: 'vcover__stamp', 'aria-hidden': 'true', text: '食有灵' })
      )
    )
  );

  const root = h('div', { class: 'vid' }, left, right);
  el.append(root);

  /* ---------------------------- 状态渲染 ---------------------------- */

  function paintStatus() {
    status.dataset.phase = state.phase;
    switch (state.phase) {
      case PHASE.LOADING:
        status.textContent = `正在检索「${state.q}」…`;
        break;
      case PHASE.SUCCESS:
        status.textContent = `「${state.q}」· 共 ${state.list.length} 条 · 哔哩哔哩实时检索`;
        break;
      case PHASE.EMPTY:
        status.textContent = `「${state.q}」没有检索到视频`;
        break;
      case PHASE.ERROR:
        status.textContent = state.error;
        break;
      default:
        status.textContent = '输入菜品名称后按回车，或点右侧「搜索」';
    }
  }

  function idleView() {
    return h(
      'div',
      { class: 'vid__idle' },
      h('div', { class: 'vid__idle-art' }, html`${INK_BOWL}`),
      h('span', { class: 'vid__idle-rule', 'aria-hidden': 'true' }),
      h('p', { class: 'vid__idle-main', text: '寻味中华，探寻烹饪之道' }),
      h('p', { class: 'vid__idle-sub', text: '输入菜品名称，发现更多烹饪灵感' }),
      h('span', { class: 'vid__idle-seal', text: '待寻' })
    );
  }

  function loadingView() {
    return h(
      'div',
      { class: 'vid__loading', 'aria-hidden': 'true' },
      ...Array.from({ length: 4 }, () =>
        h(
          'div',
          { class: 'vid__skel' },
          h('span', { class: 'vid__skel-cover' }),
          h('span', { class: 'vid__skel-lines' }, h('i'), h('i'))
        )
      )
    );
  }

  function entriesView() {
    if (!state.entries.length) return null;
    return h(
      'div',
      { class: 'vid__entries' },
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

  function itemView(v) {
    const platform = PLATFORM[v.platform] || v.platform || '';
    return h(
      'a',
      { class: 'vid__item', href: v.url, target: '_blank', rel: 'noopener noreferrer' },
      h(
        'span',
        { class: 'vid__cover' },
        v.coverUrl
          ? h('img', { src: v.coverUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : h('span', { class: 'vid__cover-ph', text: '视频' }),
        v.duration ? h('span', { class: 'vid__dur', text: fmtDuration(v.duration) }) : null,
        h('span', { class: 'vid__play', 'aria-hidden': 'true' }, html`<svg viewBox="0 0 24 24"><path d="M9 7.5v9l7.5-4.5z" fill="currentColor"/></svg>`)
      ),
      h(
        'span',
        { class: 'vid__meta' },
        h('span', { class: 'vid__vtitle', text: v.title || '' }),
        h('span', { class: 'vid__vsub', text: [platform, v.author].filter(Boolean).join(' · ') })
      ),
      h('span', { class: 'vid__out', 'aria-hidden': 'true' }, html`<svg viewBox="0 0 24 24"><path d="M8 16 16 8M9.5 8H16v6.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
    );
  }

  function resultsView() {
    return h(
      'div',
      { class: 'vid__results' },
      h(
        'div',
        { class: 'vid__results-head' },
        h('p', { class: 'vid__results-title', text: `「${state.q}」的视频` }),
        h('span', { class: 'vid__results-count', text: `${state.list.length} 条` })
      ),
      h('div', { class: 'vid__list' }, ...state.list.map(itemView)),
      state.note ? h('p', { class: 'vid__note', text: state.note }) : null,
      entriesView()
    );
  }

  function emptyView() {
    return h(
      'div',
      { class: 'vid__blank' },
      h('p', { class: 'vid__blank-title', text: `没有找到「${state.q}」的相关视频` }),
      h('p', { class: 'vid__blank-sub', text: '换个说法或更短的关键词再试一次，也可以直接去平台里搜。' }),
      h(
        'div',
        { class: 'vid__blank-acts' },
        h('button', { class: 'vid__btn', type: 'button', onclick: () => retry() }, '重新搜索'),
        entriesView()
      ),
      state.note ? h('p', { class: 'vid__note', text: state.note }) : null
    );
  }

  function errorView() {
    return h(
      'div',
      { class: 'vid__blank vid__blank--error' },
      h('p', { class: 'vid__blank-title', text: '这次没取到视频' }),
      // 具体原因在顶部状态行里已经写明，这里只给下一步怎么做，避免同一句话出现两遍
      h('p', {
        class: 'vid__blank-sub',
        text: state.entries.length
          ? '稍后重试，或换成更短的关键词；也可以直接用下面的平台入口去搜。'
          : '稍后重试，或换成更短的关键词再试一次。',
      }),
      h(
        'div',
        { class: 'vid__blank-acts' },
        h('button', { class: 'vid__btn', type: 'button', onclick: () => retry() }, '重新搜索'),
        entriesView()
      )
    );
  }

  function paintBody() {
    clear(body);
    let node = null;
    if (state.phase === PHASE.LOADING) node = loadingView();
    else if (state.phase === PHASE.SUCCESS) node = resultsView();
    else if (state.phase === PHASE.EMPTY) node = emptyView();
    else if (state.phase === PHASE.ERROR) node = errorView();
    else node = idleView();
    body.append(node);
    left.dataset.phase = state.phase;
  }

  function paint() {
    paintStatus();
    paintBody();
  }

  /* ---------------------------- 搜索 ---------------------------- */

  function retry() {
    void runSearch(state.q || searchInput.value);
  }

  function submit() {
    const q = searchInput.value.trim();
    if (!q) {
      // 空输入不发请求：只把提示点亮，保持当前状态
      status.dataset.phase = 'hint';
      status.textContent = '请输入菜品名称再搜索';
      searchInput.focus();
      return;
    }
    void runSearch(q);
  }

  async function runSearch(raw) {
    const q = String(raw || '').trim().slice(0, 24);
    if (!q) return;
    const token = ++state.token;
    state.phase = PHASE.LOADING;
    state.q = q;
    state.error = '';
    state.list = [];
    state.entries = [];
    state.note = '';
    if (searchInput.value !== q) searchInput.value = q;
    left.scrollTop = 0; // 新结果从顶部开始读
    paint();

    let bundle = null;
    try {
      bundle = await api.videos(q, 12);
    } catch (err) {
      if (token !== state.token) return; // 已有更新的搜索，丢弃旧结果
      const msg = String((err && (err.message || err)) || '未知错误');
      state.phase = PHASE.ERROR;
      // 网络断掉时浏览器只会给 "Failed to fetch"，换成中文提示
      state.error = /failed to fetch|network|load failed|fetch/i.test(msg)
        ? '检索失败：网络连接异常，请检查网络后重试'
        : `检索失败：${msg.slice(0, 60)}`;
      paint();
      return;
    }
    if (token !== state.token) return;

    state.list = Array.isArray(bundle?.results) ? bundle.results : [];
    state.entries = Array.isArray(bundle?.entries) ? bundle.entries : [];
    state.note = typeof bundle?.note === 'string' ? bundle.note : '';

    // 平台自己报错（例如 B 站接口不可用）：明确说「失败」，不要伪装成「没搜到」
    const bili = Array.isArray(bundle?.providers) ? bundle.providers.find((p) => p.platform === 'bilibili') : null;
    if (!state.list.length && bili && bili.status === 'error') {
      state.phase = PHASE.ERROR;
      state.error = `检索失败：${bili.reason || '平台接口暂不可用'}`;
    } else {
      state.phase = state.list.length ? PHASE.SUCCESS : PHASE.EMPTY;
    }
    paint();
  }

  /** 清空回到初始态（离开章节时由书页调用） */
  function resetSearch() {
    state.token += 1; // 让在途请求作废
    state.phase = PHASE.IDLE;
    state.q = '';
    state.list = [];
    state.entries = [];
    state.note = '';
    state.error = '';
    searchInput.value = '';
    applied = '';
    left.scrollTop = 0;
    paint();
  }

  /**
   * 地址里的关键词变了才动：同一次来源不会重复请求。
   *   '' → 清空；'菜名' → 填空并检索一次
   */
  let applied = '';
  function syncQuery(raw) {
    const next = String(raw || '').trim().slice(0, 24);
    if (next === applied) return;
    applied = next;
    if (!next) {
      if (state.phase !== PHASE.IDLE) resetSearch();
      return;
    }
    void runSearch(next);
  }

  /* ---------------------------- 交互 ---------------------------- */

  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // 中文输入法选词时的回车不算提交
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  });

  // 滚动时给吸顶的搜索区加一点阴影，明确「上面还有内容」
  let stuck = false;
  left.addEventListener('scroll', () => {
    const on = left.scrollTop > 6;
    if (on === stuck) return;
    stuck = on;
    top.classList.toggle('is-stuck', on);
  }, { passive: true });

  // 书页是 3D 纸片，滚轮 / 触摸要显式换算（只滚这一页，不带动右页和整本书）
  const stopWheel = enableWheelScroll(left);
  const stopTouch = enableTouchScroll(left);

  paint();

  // 从菜品详情页「做菜视频」进来时地址带 ?q=：填入并自动检索一次
  const initial = queryFromUrl();
  applied = initial;
  if (initial) void runSearch(initial);

  return {
    el: root,
    syncQuery,
    resetSearch,
    destroy() {
      state.token += 1;
      stopWheel();
      stopTouch();
      root.remove();
    },
  };
}