/**
 * 管理后台（/admin）
 * ------------------------------------------------------------
 * 权限完全由服务端判定：本页只负责展示，所有请求都打到 /api/admin/*，
 * 普通用户/未登录会在第一个请求就拿到 401/403，页面显示无权限。
 *
 * 布局：后台不是独立网页，而是画册里的一叠「内页」——
 *   左页 .adm-side = 标题 + 分类导航 + 数据概览 + 系统状态 + 退出/返回
 *   右页 .adm-main = 当前分类的管理内容
 * 书页栈（src/book/pages.js 的 SPLITTERS.admin）按这两个节点把内容分到左右两张纸上。
 */
import { h, clear, toast, fmtTime } from '../lib/dom.js';
import { api, compressImage } from '../lib/api.js';
import { applyOverrideLocally } from '../lib/overrides.js';
import { openAuthModal } from '../components/account.js';

const TABS = [
  { id: 'overview', label: '后台概览', en: 'OVERVIEW' },
  { id: 'posts', label: '社区内容', en: 'POSTS' },
  { id: 'cards', label: '首页图片', en: 'CARDS' },
  { id: 'dishes', label: '美食图鉴', en: 'DISHES' },
  { id: 'siteai', label: '内置 AI', en: 'BUILT-IN AI' },
  { id: 'reports', label: '举报处理', en: 'REPORTS' },
];

const REPORT_STATUS = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已处理',
  rejected: '已驳回',
};


const ADMIN_HINT = {
  overview: '社区、图鉴、首页图片与举报的整体情况',
  posts: '查看与删除社区帖子、评论',
  cards: '替换首页菜系 / 口味配图',
  dishes: '替换图鉴菜品配图与文案',
  siteai: '内置 AI 开关、服务商与 API 配置',
  reports: '处理用户举报',
};

/* 退出后台：回到进入前的画册位置（由 src/book/index.js 接管跳转） */
function leaveAdmin() {
  window.dispatchEvent(new CustomEvent('foodsoul:admin-leave'));
}

export default {
  async mount(root) {
    const page = h('div', { class: 'page admin-page' });
    root.append(page);

    const cleanups = [];
    const onDestroy = (fn) => cleanups.push(fn);

    // 权限探测：失败即显示无权限，不渲染任何管理数据（服务端 401/403）
    let boot;
    try {
      boot = await api.admin.overview();
    } catch (err) {
      page.append(forbidden(err.message));
      return {
        destroy() {
          page.remove();
        },
      };
    }

    let tab = 'overview';
    const content = h('div', { class: 'admin-content' });
    const navBtns = new Map();
    /** 已渲染过的页签：切走时整块 DOM 暂存，切回来原样放回（输入与滚动都保留） */
    const stash = new Map();

    const TITLES = Object.fromEntries(TABS.map((t) => [t.id, t.label]));

    /* ---------------- 左页：导航 / 概览 / 状态 ---------------- */

    const nav = h(
      'div',
      { class: 'adm-side__nav admin-nav', role: 'tablist', 'aria-label': '管理功能' },
      ...TABS.map((t) => {
        const btn = h(
          'button',
          {
            class: 'admin-nav__item',
            type: 'button',
            role: 'tab',
            'aria-selected': 'false',
            onclick: () => switchTab(t.id),
          },
          h('span', { text: t.label }),
          h('em', { text: t.en })
        );
        navBtns.set(t.id, btn);
        return btn;
      })
    );

    const stat = (label, value, hint) =>
      h(
        'div',
        { class: 'adm-stat' },
        h('b', { class: 'adm-stat__value', text: String(value) }),
        h('span', { class: 'adm-stat__label', text: label }),
        hint ? h('em', { class: 'adm-stat__hint', text: hint }) : null
      );

    const s = boot.stats;
    const statusBox = h('div', { class: 'adm-status' }, h('p', { class: 'adm-status__row', text: '读取内置 AI 状态…' }));

    const side = h(
      'aside',
      { class: 'adm-side' },
      h(
        'header',
        { class: 'adm-brand' },
        h('span', { class: 'adm-brand__seal', 'aria-hidden': 'true', text: '印' }),
        h(
          'div',
          { class: 'adm-brand__text' },
          h('b', { text: '食有灵 · 管理后台' }),
          h('span', { text: boot.admin?.email || '管理员' })
        )
      ),
      h('p', { class: 'adm-side__label', text: '管理功能' }),
      nav,
      h('p', { class: 'adm-side__label', text: '数据概览' }),
      h(
        'div',
        { class: 'adm-stats' },
        stat('社区帖子', s.posts.posts, `评论 ${s.posts.comments}`),
        stat('待处理举报', s.reports.pending, `累计 ${s.reports.total}`),
        stat('首页图片', s.cards.cuisine + s.cards.taste, `已替换 ${s.cards.overridden}`),
        stat('图鉴菜品', s.dishes.total, `已替换 ${s.dishes.overridden}`)
      ),
      h('p', { class: 'adm-side__label', text: '系统状态' }),
      statusBox,
      h(
        'div',
        { class: 'adm-side__foot' },
        h('button', { class: 'adm-link', type: 'button', onclick: () => leaveAdmin() }, h('span', { text: '返回画册' }), h('em', { text: 'BACK' })),
        h(
          'button',
          { class: 'adm-link adm-link--danger', type: 'button', onclick: logout },
          h('span', { text: '退出登录' }),
          h('em', { text: 'LOGOUT' })
        )
      )
    );

    /* ---------------- 右页：管理内容 ---------------- */

    const title = h('h1', { class: 'adm-title', text: TITLES[tab] });
    const hint = h('p', { class: 'adm-hint', text: ADMIN_HINT[tab] });

    const main = h(
      'main',
      { class: 'adm-main', role: 'tabpanel' },
      h('header', { class: 'adm-head' }, title, hint),
      content
    );

    page.append(h('div', { class: 'admin-shell adm-book' }, side, main));

    /* 系统状态：内置 AI 总开关与已验证配置（失败不影响其它内容） */
    void (async () => {
      try {
        const data = await api.admin.siteAi();
        const active = (data.profiles || []).find((p) => p.enabled) || null;
        const verified = (data.profiles || []).filter((p) => p.verified).length;
        clear(statusBox);
        statusBox.append(
          h(
            'p',
            { class: 'adm-status__row' },
            h('i', { class: `adm-dot ${data.master?.enabled ? 'is-on' : 'is-off'}`, 'aria-hidden': 'true' }),
            h('span', { text: data.master?.enabled ? `内置 AI 已开启 · ${active?.name || '未选择配置'}` : '内置 AI 已关闭' })
          ),
          h('p', { class: 'adm-status__row' }, h('i', { class: `adm-dot ${verified ? 'is-on' : 'is-off'}`, 'aria-hidden': 'true' }), h('span', { text: `已验证配置 ${verified} / ${(data.profiles || []).length} 套` })),
          h('p', { class: 'adm-status__row' }, h('i', { class: 'adm-dot is-on', 'aria-hidden': 'true' }), h('span', { text: '服务端接口正常' }))
        );
      } catch (err) {
        clear(statusBox);
        statusBox.append(h('p', { class: 'adm-status__row adm-status__row--warn', text: err.message || '状态读取失败' }));
      }
    })();

    function switchTab(id) {
      if (tab === id) return;
      // 把当前页签的 DOM 整块收进暂存区（未提交的输入、图片预览都保住）
      const keep = [...content.childNodes];
      if (keep.length) {
        putAway(content, keep);
        stash.set(tab, keep);
      }
      tab = id;
      navBtns.forEach((btn, key) => {
        btn.classList.toggle('is-on', key === id);
        btn.setAttribute('aria-selected', String(key === id));
      });
      title.textContent = TITLES[id];
      hint.textContent = ADMIN_HINT[id];
      const back = stash.get(id);
      if (back?.length) {
        stash.delete(id);
        for (const n of back) content.append(n);
        animateIn();
        return;
      }
      render();
    }

    /** 从容器摘下节点但不销毁（innerHTML 风格地收走，节点状态原样保留） */
    function putAway(box, nodes) {
      for (const n of nodes) box.removeChild(n);
    }

    /** 轻微的内容过渡：只淡入，不位移 */
    function animateIn() {
      content.classList.remove('is-swapping');
      void content.offsetWidth;
      content.classList.add('is-swapping');
    }

    function render() {
      clear(content);
      animateIn();
      if (tab === 'overview') return renderOverview();
      if (tab === 'posts') return renderPosts();
      if (tab === 'cards') return renderCards();
      if (tab === 'dishes') return renderDishes();
      if (tab === 'siteai') return renderSiteAI();
      if (tab === 'reports') return renderReports();
    }

    navBtns.forEach((btn, key) => {
      btn.classList.toggle('is-on', key === tab);
      btn.setAttribute('aria-selected', String(key === tab));
    });

    async function logout() {
      if (!confirm('确认退出登录？退出后将无法继续访问后台。')) return;
      try {
        await api.auth.logout();
      } catch {
        /* noop */
      }
      window.dispatchEvent(new CustomEvent('foodsoul:auth', { detail: { user: null } }));
      window.dispatchEvent(new CustomEvent('foodsoul:auth-changed'));
      toast('已退出登录');
      leaveAdmin();
    }

    /* ---------------- 通用块 ---------------- */

    const loading = (text = '加载中…') => h('div', { class: 'admin-state' }, h('span', { class: 'admin-spinner' }), text);
    const empty = (text) => h('div', { class: 'admin-state admin-state--empty', text });
    const failed = (text, retry) =>
      h('div', { class: 'admin-state admin-state--error' },
        h('p', { text: text || '加载失败' }),
        retry ? h('button', { class: 'btn btn--sm', type: 'button', onclick: retry }, '重试') : null
      );

    function prettyDetail(detail) {
      if (!detail) return '';
      try {
        const obj = JSON.parse(detail);
        return Object.entries(obj)
          .filter(([, v]) => v !== '' && v !== null && v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ');
      } catch {
        return String(detail);
      }
    }

    function forbidden(message) {
      // 未授权时同样是画册里的一叠内页：左页说明，右页禁令。
      // 不请求任何 /api/admin/* 数据，页面里也没有管理内容。
      return h(
        'div',
        { class: 'admin-shell adm-book adm-book--denied' },
        h(
          'aside',
          { class: 'adm-side' },
          h(
            'header',
            { class: 'adm-brand' },
            h('span', { class: 'adm-brand__seal', 'aria-hidden': 'true', text: '印' }),
            h('div', { class: 'adm-brand__text' }, h('b', { text: '食有灵 · 管理后台' }), h('span', { text: '仅管理员可见' }))
          ),
          h('p', { class: 'adm-side__label', text: '管理功能' }),
          h('p', { class: 'adm-side__empty', text: '通过服务端身份验证后才会显示管理功能。' }),
          h(
            'div',
            { class: 'adm-side__foot' },
            h('button', { class: 'adm-link', type: 'button', onclick: () => leaveAdmin() }, h('span', { text: '返回画册' }), h('em', { text: 'BACK' }))
          )
        ),
        h(
          'main',
          { class: 'adm-main adm-main--denied' },
          h(
            'div',
            { class: 'adm-denied' },
            h('span', { class: 'adm-denied__seal', 'aria-hidden': 'true', text: '禁' }),
            h('h1', { text: '无权访问' }),
            h('p', { text: message || '需要管理员权限' }),
            h(
              'div',
              { class: 'adm-denied__acts' },
              h('button', { class: 'btn btn--sm btn--gold', type: 'button', onclick: () => openAuthModal('login') }, '登录管理员账号'),
              h('button', { class: 'btn btn--sm', type: 'button', onclick: () => leaveAdmin() }, '返回画册')
            )
          )
        )
      );
    }

    function pager(data, onGo) {
      if (!data || data.total <= data.pageSize) return null;
      const max = Math.max(1, Math.ceil(data.total / data.pageSize));
      return h(
        'div',
        { class: 'admin-pager' },
        h('button', {
          class: 'btn btn--sm',
          type: 'button',
          disabled: data.page <= 1,
          onclick: () => onGo(data.page - 1),
        }, '上一页'),
        h('span', { text: `${data.page} / ${max} · 共 ${data.total} 条` }),
        h('button', {
          class: 'btn btn--sm',
          type: 'button',
          disabled: !data.hasMore,
          onclick: () => onGo(data.page + 1),
        }, '下一页')
      );
    }

    /* ---------------- 概览 ---------------- */

    async function renderOverview() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.overview();
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderOverview));
        return;
      }
      clear(content);
      const s = data.stats;
      const stat = (label, value, hint) =>
        h('div', { class: 'admin-stat' },
          h('span', { class: 'admin-stat__label', text: label }),
          h('b', { class: 'admin-stat__value', text: String(value) }),
          hint ? h('span', { class: 'admin-stat__hint', text: hint }) : null
        );

      content.append(
        h('div', { class: 'admin-stats' },
          stat('社区帖子', s.posts.posts, `评论 ${s.posts.comments}`),
          stat('待处理举报', s.reports.pending, `累计 ${s.reports.total}`),
          stat('首页卡片', s.cards.cuisine + s.cards.taste, `已替换 ${s.cards.overridden}`),
          stat('图鉴菜品', s.dishes.total, `已替换 ${s.dishes.overridden}`)
        ),
        h('section', { class: 'admin-card' },
          h('h2', { class: 'admin-card__title', text: '最近管理操作' }),
          data.recentAudit?.length
            ? h('ul', { class: 'admin-audit' },
                ...data.recentAudit.map((a) =>
                  h('li', {},
                    h('span', { class: 'admin-audit__act', text: a.action }),
                    h('span', { text: prettyDetail(a.detail) }),
                    h('em', { text: `${a.actor_name || a.actor_id || ''} · ${fmtTime(a.created_at)}` })
                  )
                )
              )
            : empty('还没有管理操作记录')
        )
      );
    }

    /* ---------------- 社区内容 ---------------- */

    let postQ = '';
    let postPage = 1;

    async function renderPosts() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.posts({ q: postQ, page: postPage, pageSize: 10 });
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderPosts));
        return;
      }
      clear(content);

      const search = h('input', {
        class: 'admin-input',
        type: 'search',
        placeholder: '搜索内容 / 作者',
        value: postQ,
      });
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        postQ = search.value.trim();
        postPage = 1;
        clear(content);
        renderPosts();
      });

      content.append(
        h('div', { class: 'admin-toolbar' },
          search,
          h('button', {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              postQ = search.value.trim();
              postPage = 1;
              clear(content);
              renderPosts();
            },
          }, '搜索')
        )
      );

      if (!data.items.length) {
        content.append(empty(postQ ? '没有匹配的帖子' : '社区还没有帖子'));
        return;
      }

      const list = h('div', { class: 'admin-list' });
      data.items.forEach((p) => {
        const delBtn = h('button', {
          class: 'btn btn--sm btn--danger',
          type: 'button',
          onclick: async () => {
            const preview = p.content.slice(0, 40);
            if (!confirm(`确认删除这条帖子？\n\n作者：${p.author?.name || '未知'}\n内容：${preview}…\n\n删除后前台不再展示（保留审计记录）。`)) return;
            delBtn.disabled = true;
            delBtn.textContent = '删除中…';
            try {
              await api.admin.deletePost(p.id, '管理员在后台删除');
              toast('已删除');
              clear(content);
              renderPosts();
            } catch (err) {
              toast(err.message || '删除失败', 'err');
              delBtn.disabled = false;
              delBtn.textContent = '删除';
            }
          },
        }, '删除');

        list.append(
          h('article', { class: 'admin-row' },
            h('div', { class: 'admin-row__main' },
              h('div', { class: 'admin-row__meta' },
                h('b', { text: p.author?.name || '未知' }),
                h('span', { text: p.kind || '讨论' }),
                h('span', { text: fmtTime(p.createdAt) }),
                p.reports ? h('span', { class: 'admin-badge admin-badge--warn', text: `举报 ${p.reports}` }) : null
              ),
              h('p', { class: 'admin-row__text', text: p.content }),
              p.image ? h('img', { class: 'admin-thumb', src: p.image, alt: '帖子图片', loading: 'lazy' }) : null
            ),
            h('div', { class: 'admin-row__side' }, delBtn)
          )
        );
      });

      content.append(list);
      const p = pager(data, (n) => { postPage = n; clear(content); renderPosts(); });
      if (p) content.append(p);
    }

    /* ---------------- 首页卡片图片 ---------------- */

    async function renderCards() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.cards();
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderCards));
        return;
      }
      clear(content);

      const group = (kind, title, hint) => {
        const rows = data.items.filter((c) => c.kind === kind);
        return h('section', { class: 'admin-card' },
          h('div', { class: 'admin-card__head' },
            h('h2', { class: 'admin-card__title', text: title }),
            h('span', { class: 'admin-card__hint', text: hint })
          ),
          h('div', { class: 'admin-grid' }, ...rows.map((c) => cardTile(kind, c)))
        );
      };

      content.append(
        group('cuisine', '八大菜系卡片', '首页「八大菜系」模式的卡片主图'),
        group('taste', '八大口味卡片', '首页「口味探索」模式的卡片主图')
      );
    }

    function cardTile(kind, c) {
      const img = h('img', { class: 'admin-tile__img', src: c.image, alt: c.name, loading: 'lazy' });
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
      const stateEl = h('span', { class: 'admin-tile__state', text: c.overridden ? '已替换' : '默认图片' });

      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return toast('只支持 JPG / PNG / WebP / GIF', 'err');
        if (f.size > 3 * 1024 * 1024) return toast('图片不能超过 3MB', 'err');
        if (!confirm(`确认用这张图片替换「${c.name}」的卡片主图？`)) return;
        try {
          const dataUrl = await compressImage(f);
          const up = await api.admin.upload(dataUrl);
          await api.admin.saveCard({ kind, id: c.id, url: up.url });
          img.src = up.url;
          applyOverrideLocally({ kind, id: c.id, url: up.url });
          stateEl.textContent = '已替换';
          resetBtn.disabled = false; // 刚换上去的图，立刻可以恢复默认
          toast(`「${c.name}」图片已更新`);
        } catch (err) {
          toast(err.message || '替换失败', 'err');
        }
      });

      const resetBtn = h('button', {
        class: 'btn btn--sm',
        type: 'button',
        disabled: !c.overridden,
        onclick: async () => {
          if (!confirm(`恢复「${c.name}」为默认图片？`)) return;
          try {
            await api.admin.resetCard(kind, c.id);
            applyOverrideLocally({ kind, id: c.id, url: '' });
            toast('已恢复默认');
            clear(content);
            renderCards();
          } catch (err) {
            toast(err.message || '恢复失败', 'err');
          }
        },
      }, '恢复默认');

      return h('div', { class: 'admin-tile' },
        h('div', { class: 'admin-tile__media' }, img),
        h('div', { class: 'admin-tile__body' },
          h('b', { text: c.name }),
          h('span', { class: 'admin-tile__path', text: c.image, title: c.image }),
          h('div', { class: 'admin-tile__actions' },
            h('button', { class: 'btn btn--sm btn--gold', type: 'button', onclick: () => file.click() }, '更换图片'),
            resetBtn
          ),
          stateEl
        ),
        file
      );
    }

    /* ---------------- 美食图鉴 ---------------- */

    let dishQ = '';
    let dishPage = 1;

    async function renderDishes() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.dishes({ q: dishQ, page: dishPage, pageSize: 12 });
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderDishes));
        return;
      }
      clear(content);

      const search = h('input', { class: 'admin-input', type: 'search', placeholder: '搜索菜名', value: dishQ });
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        dishQ = search.value.trim();
        dishPage = 1;
        clear(content);
        renderDishes();
      });

      content.append(
        h('div', { class: 'admin-toolbar' },
          search,
          h('button', {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              dishQ = search.value.trim();
              dishPage = 1;
              clear(content);
              renderDishes();
            },
          }, '搜索')
        )
      );

      if (!data.items.length) {
        content.append(empty('没有匹配的菜品'));
        return;
      }

      content.append(
        h('div', { class: 'admin-grid' }, ...data.items.map((d) => dishTile(d)))
      );
      const p = pager(data, (n) => { dishPage = n; clear(content); renderDishes(); });
      if (p) content.append(p);
    }

    function dishTile(d) {
      const img = h('img', { class: 'admin-tile__img', src: d.image, alt: d.name, loading: 'lazy' });
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
      const stateEl = h('span', { class: 'admin-tile__state', text: d.overridden ? '已替换' : '默认图片' });

      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return toast('只支持 JPG / PNG / WebP / GIF', 'err');
        if (f.size > 3 * 1024 * 1024) return toast('图片不能超过 3MB', 'err');
        if (!confirm(`确认替换「${d.name}」的默认图片？`)) return;
        try {
          const dataUrl = await compressImage(f);
          const up = await api.admin.upload(dataUrl);
          await api.admin.saveDish({ id: d.id, url: up.url });
          img.src = up.url;
          applyOverrideLocally({ kind: 'dish', id: d.id, url: up.url });
          stateEl.textContent = '已替换';
          toast(`「${d.name}」图片已更新`);
        } catch (err) {
          toast(err.message || '替换失败', 'err');
        }
      });

      return h('div', { class: 'admin-tile' },
        h('div', { class: 'admin-tile__media' }, img),
        h('div', { class: 'admin-tile__body' },
          h('b', { text: d.name }),
          h('span', { class: 'admin-tile__sub', text: `${d.cuisineName || '未分类'} · ${d.id}` }),
          h('div', { class: 'admin-tile__actions' },
            h('button', { class: 'btn btn--sm btn--gold', type: 'button', onclick: () => file.click() }, '更换图片'),
            h('button', {
              class: 'btn btn--sm',
              type: 'button',
              disabled: !d.overridden,
              onclick: async () => {
                if (!confirm(`恢复「${d.name}」为默认图片？`)) return;
                try {
                  await api.admin.resetDish(d.id);
                  toast('已恢复默认');
                  clear(content);
                  renderDishes();
                } catch (err) {
                  toast(err.message || '恢复失败', 'err');
                }
              },
            }, '恢复默认')
          ),
          stateEl
        ),
        file
      );
    }

    /* ---------------- 内置 AI ---------------- */

    /* ---------------- 内置 AI（多服务商） ---------------- */

    const PROVIDER_FALLBACK = [
      { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: '例如 deepseek-v4-flash' },
      { id: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', hint: '例如 glm-4-flash' },
      { id: 'volcengine', label: '火山引擎（豆包）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', hint: '方舟接入点 ID / 模型 ID' },
      { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', hint: '服务商文档中的模型 ID' },
    ];

    function providerMeta(list, id) {
      return (list || PROVIDER_FALLBACK).find((p) => p.id === id) || PROVIDER_FALLBACK[PROVIDER_FALLBACK.length - 1];
    }

    /** 配置表单：新增与编辑共用 */
    function profileForm({ providers, initial = {}, submitText, onSubmit }) {
      const list = providers?.length ? providers : PROVIDER_FALLBACK;
      const meta0 = providerMeta(list, initial.provider || 'deepseek');

      const name = h('input', {
        class: 'admin-input',
        type: 'text',
        maxlength: '40',
        placeholder: '例如 DeepSeek 主模型',
        value: initial.name || '',
        'aria-label': '配置名称',
      });
      const provider = h(
        'select',
        { class: 'admin-input', 'aria-label': '服务商' },
        ...list.map((p) => h('option', { value: p.id, text: p.label, selected: (initial.provider || 'deepseek') === p.id }))
      );
      const baseUrl = h('input', {
        class: 'admin-input',
        type: 'url',
        placeholder: 'https://api.example.com/v1',
        value: initial.baseUrl || meta0.baseUrl,
        'aria-label': 'API Base URL',
      });
      const model = h('input', {
        class: 'admin-input',
        type: 'text',
        maxlength: '120',
        placeholder: meta0.hint,
        value: initial.model || '',
        'aria-label': '模型 ID',
      });
      const apiKey = h('input', {
        class: 'admin-input',
        type: 'password',
        autocomplete: 'new-password',
        placeholder: initial.hasKey ? '已保存（留空则保持不变）' : 'sk-...',
        'aria-label': 'API Key',
      });
      const msg = h('p', { class: 'admin-ai__result' });

      provider.addEventListener('change', () => {
        const m = providerMeta(list, provider.value);
        if (!initial.hasKey) baseUrl.value = m.baseUrl;
        model.placeholder = m.hint;
      });

      const submit = h('button', { class: 'btn btn--sm btn--gold', type: 'submit' }, submitText);

      const form = h(
        'form',
        { class: 'admin-ai-form' },
        h('div', { class: 'admin-ai__grid' },
          h('label', { class: 'admin-field' }, h('span', { text: '配置名称' }), name),
          h('label', { class: 'admin-field' }, h('span', { text: '服务商' }), provider),
          h('label', { class: 'admin-field' }, h('span', { text: 'API Base URL' }), baseUrl),
          h('label', { class: 'admin-field' }, h('span', { text: '模型 ID' }), model),
          h('label', { class: 'admin-field' }, h('span', { text: 'API Key' }), apiKey)
        ),
        msg,
        h('div', { class: 'admin-ai__actions' }, submit)
      );

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submit.disabled = true;
        const label = submit.textContent;
        submit.textContent = '保存中…';
        msg.textContent = '';
        msg.className = 'admin-ai__result';
        try {
          await onSubmit({
            name: name.value.trim(),
            provider: provider.value,
            baseUrl: baseUrl.value.trim(),
            model: model.value.trim(),
            apiKey: apiKey.value.trim(),
          });
        } catch (err) {
          msg.textContent = err.message || '保存失败';
          msg.className = 'admin-ai__result is-err';
          submit.disabled = false;
          submit.textContent = label;
        }
      });

      return form;
    }

    function profileCard(p, ctx) {
      const { providers, master, rerender } = ctx;
      const meta = providerMeta(providers, p.provider);
      const badge = (text, tone) => h('span', { class: `admin-badge admin-badge--${tone}`, text });

      const resultLine = h('p', {
        class: `admin-ai__result${p.status === 'error' ? ' is-err' : p.verified ? ' is-ok' : ''}`,
        text: p.lastError
          ? `最近一次测试失败：${p.lastError}`
          : p.verified
            ? '最近一次连接测试通过'
            : '尚未测试连接',
      });

      const testBtn = h('button', {
        class: 'btn btn--sm',
        type: 'button',
        onclick: async () => {
          testBtn.disabled = true;
          testBtn.textContent = '测试中…';
          resultLine.textContent = '正在连接…';
          resultLine.className = 'admin-ai__result';
          try {
            const r = await api.admin.testSiteAiProfile(p.id);
            toast(r.latency ? `连接成功（${r.latency} ms）` : '连接成功');
          } catch (err) {
            toast(err.message || '连接失败', 'err');
          } finally {
            rerender();
          }
        },
      }, '测试连接');

      const enableBtn = p.enabled
        ? null
        : h('button', {
            class: 'btn btn--sm btn--gold',
            type: 'button',
            onclick: async () => {
              if (!confirm(`启用「${p.name}」？同一时间只能有一套配置处于启用状态，切换后会立即影响全站 AI。`)) return;
              enableBtn.disabled = true;
              enableBtn.textContent = '切换中…';
              try {
                await api.admin.enableSiteAiProfile(p.id);
                toast('已切换启用配置');
                window.dispatchEvent(new CustomEvent('foodsoul:auth-changed'));
              } catch (err) {
                toast(err.message || '启用失败', 'err');
              } finally {
                rerender();
              }
            },
          }, '启用');

      const editBtn = h('button', { class: 'btn btn--sm', type: 'button' }, '编辑');
      const delBtn = h('button', {
        class: 'btn btn--sm btn--danger',
        type: 'button',
        onclick: async () => {
          const tip = p.enabled
            ? `「${p.name}」是当前启用配置。删除后会先停用，且不会自动启用其他配置。确认删除？`
            : `删除配置「${p.name}」？此操作不可撤销。`;
          if (!confirm(tip)) return;
          delBtn.disabled = true;
          delBtn.textContent = '删除中…';
          try {
            const r = await api.admin.deleteSiteAiProfile(p.id);
            toast(r.wasEnabled ? '已删除并停用该配置' : '配置已删除');
            if (r.wasEnabled) window.dispatchEvent(new CustomEvent('foodsoul:auth-changed'));
          } catch (err) {
            toast(err.message || '删除失败', 'err');
          } finally {
            rerender();
          }
        },
      }, '删除');

      const editBox = h('div', { class: 'admin-ai-edit', hidden: true });
      editBtn.addEventListener('click', () => {
        if (!editBox.hidden) {
          editBox.hidden = true;
          editBtn.textContent = '编辑';
          return;
        }
        clear(editBox);
        editBox.append(
          profileForm({
            providers,
            initial: { name: p.name, provider: p.provider, baseUrl: p.baseUrl, model: p.model, hasKey: p.hasKey },
            submitText: '保存修改',
            onSubmit: async (payload) => {
              const r = await api.admin.updateSiteAiProfile(p.id, payload);
              if (r.revalidated && r.tested && !r.tested.ok) {
                toast('已保存，但连接测试未通过，需要重新测试后才能启用', 'err');
              } else {
                toast(r.revalidated ? '已保存并重新验证' : '已保存');
              }
              window.dispatchEvent(new CustomEvent('foodsoul:auth-changed'));
              rerender();
            },
          })
        );
        editBox.hidden = false;
        editBtn.textContent = '收起';
      });

      return h(
        'article',
        { class: `admin-ai-profile${p.enabled ? ' is-active' : ''}` },
        h('div', { class: 'admin-ai-profile__head' },
          h('div', { class: 'admin-ai-profile__title' },
            h('b', { text: p.name }),
            h('span', { class: 'admin-ai-profile__provider', text: p.providerLabel || meta.label })
          ),
          h('div', { class: 'admin-ai__badges' },
            p.enabled ? badge('当前使用中', 'resolved') : badge('未启用', 'rejected'),
            p.verified ? badge('已验证', 'resolved') : badge(p.status === 'error' ? '测试失败' : '未验证', 'pending')
          )
        ),
        h('dl', { class: 'admin-ai-profile__meta' },
          h('div', {}, h('dt', { text: 'Base URL' }), h('dd', { text: p.baseUrl })),
          h('div', {}, h('dt', { text: '模型 ID' }), h('dd', { text: p.model })),
          h('div', {}, h('dt', { text: 'API Key' }), h('dd', { text: p.hasKey ? '已加密保存（不会回显）' : '未保存' })),
          h('div', {}, h('dt', { text: '最近测试' }), h('dd', { text: p.lastTestedAt ? fmtTime(p.lastTestedAt) : '—' })),
          h('div', {}, h('dt', { text: '更新时间' }), h('dd', { text: p.updatedAt ? fmtTime(p.updatedAt) : '—' }))
        ),
        resultLine,
        h('div', { class: 'admin-ai__actions' }, testBtn, enableBtn, editBtn, delBtn),
        editBox,
        p.enabled && !master.enabled
          ? h('p', { class: 'admin-ai__warn', text: '这套配置已选中，但全站内置 AI 总开关处于关闭状态，当前不会对外提供 AI 服务。' })
          : null
      );
    }

    async function renderSiteAI() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.siteAi();
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderSiteAI));
        return;
      }
      clear(content);

      const { master, profiles, canCreate, max, count, providers } = data;
      const rerender = () => {
        clear(content);
        renderSiteAI();
      };

      /* ---- 总开关 ---- */
      const masterBtn = h('button', {
        class: `btn btn--sm ${master.enabled ? 'btn--danger' : 'btn--gold'}`,
        type: 'button',
        onclick: async () => {
          const want = !master.enabled;
          const tip = want
            ? '开启后全站用户都会使用当前启用的内置 AI 配置（服务端会先真实连接测试一次）。确认开启？'
            : '关闭后全站内置 AI 立即停止服务，用户需各自在右上角「接入 AI」配置模型。已保存的配置会保留。确认关闭？';
          if (!confirm(tip)) return;
          masterBtn.disabled = true;
          masterBtn.textContent = '保存中…';
          try {
            await api.admin.setSiteAiMaster(want);
            toast(want ? '全站内置 AI 已开启' : '全站内置 AI 已关闭');
            window.dispatchEvent(new CustomEvent('foodsoul:auth-changed'));
          } catch (err) {
            toast(err.message || '操作失败', 'err');
          } finally {
            rerender();
          }
        },
      }, master.enabled ? '关闭内置 AI' : '开启内置 AI');

      const active = profiles.find((p) => p.enabled) || null;

      content.append(
        h('section', { class: 'admin-card admin-ai' },
          h('div', { class: 'admin-card__head' },
            h('h2', { class: 'admin-card__title', text: '全站内置 AI' }),
            h('div', { class: 'admin-ai__badges' },
              master.enabled
                ? h('span', { class: 'admin-badge admin-badge--resolved', text: '已开启' })
                : h('span', { class: 'admin-badge admin-badge--rejected', text: '已关闭' }),
              master.encryptionReady
                ? null
                : h('span', { class: 'admin-badge admin-badge--warn', text: '缺少加密密钥' })
            )
          ),
          h('p', {
            class: 'admin-card__hint',
            text: master.enabled
              ? `全站正在使用「${active?.name || '—'}」· ${active?.model || '—'}，所有用户无需自备 Key。`
              : '关闭状态下，全站 AI 走用户各自「接入 AI」的模型；没有个人配置的用户会收到明确提示。',
          }),
          h('div', { class: 'admin-ai__master' },
            h('div', { class: 'admin-ai__master-state' },
              h('b', { text: master.enabled ? '已开启' : '已关闭' }),
              h('span', {
                text: master.enabled
                  ? `当前配置：${active?.name || '未选择'} · 模型 ${active?.model || '—'}`
                  : '开关状态已持久化，刷新或重新登录后仍然有效',
              })
            ),
            masterBtn
          ),
          master.enabled && !active
            ? h('p', { class: 'admin-ai__warn', text: '异常：总开关已开启但没有启用的配置。请立刻选择一套配置启用，或关闭总开关。' })
            : null,
          !master.enabled && !profiles.some((p) => p.verified)
            ? h('p', { class: 'admin-ai__warn', text: '开启条件：至少有一套配置通过连接测试并被启用。' })
            : null
        )
      );

      /* ---- 配置列表 ---- */
      const addBtn = h('button', {
        class: 'btn btn--sm',
        type: 'button',
        disabled: !canCreate,
        onclick: () => {
          addBox.hidden = !addBox.hidden;
          addBtn.textContent = addBox.hidden ? '新增 AI 服务' : '收起';
        },
      }, '新增 AI 服务');

      const addBox = h('div', { class: 'admin-ai-add', hidden: true });
      addBox.append(
        profileForm({
          providers,
          submitText: '保存配置',
          onSubmit: async (payload) => {
            const r = await api.admin.createSiteAiProfile(payload);
            toast(r.tested?.ok ? '已保存并验证通过' : `已保存，但连接测试失败：${r.tested?.error || ''}`, r.tested?.ok ? undefined : 'err');
            rerender();
          },
        })
      );

      content.append(
        h('section', { class: 'admin-card' },
          h('div', { class: 'admin-card__head' },
            h('h2', { class: 'admin-card__title', text: `AI 服务配置（${count}/${max}）` }),
            addBtn
          ),
          canCreate
            ? null
            : h('p', { class: 'admin-ai__warn', text: `最多保存 ${max} 套 AI 服务配置，请先删除不再使用的配置。` }),
          addBox,
          profiles.length
            ? h('div', { class: 'admin-ai-list' }, ...profiles.map((p) => profileCard(p, { providers, master, rerender })))
            : h('p', { class: 'admin-card__hint', text: '还没有配置。点右上角「新增 AI 服务」添加第一套。' })
        )
      );
    }


    /* ---------------- 举报处理 ---------------- */

    let reportStatus = 'pending';
    let reportPage = 1;

    async function renderReports() {
      content.append(loading());
      let data;
      try {
        data = await api.admin.reports({ status: reportStatus, page: reportPage, pageSize: 10 });
      } catch (err) {
        clear(content);
        content.append(failed(err.message, renderReports));
        return;
      }
      clear(content);

      const tabs = h('div', { class: 'admin-chips' });
      [['pending', '待处理'], ['processing', '处理中'], ['resolved', '已处理'], ['rejected', '已驳回'], ['', '全部']].forEach(([id, label]) => {
        tabs.append(
          h('button', {
            class: `chip${reportStatus === id ? ' is-on' : ''}`,
            type: 'button',
            onclick: () => { reportStatus = id; reportPage = 1; clear(content); renderReports(); },
          }, `${label}${id === 'pending' && data.stats?.pending ? ` ${data.stats.pending}` : ''}`)
        );
      });
      content.append(tabs);

      if (!data.items.length) {
        content.append(empty(reportStatus === 'pending' ? '没有待处理的举报' : '没有符合条件的举报'));
        return;
      }

      const list = h('div', { class: 'admin-list' });
      data.items.forEach((r) => list.append(reportRow(r)));
      content.append(list);

      const p = pager(data, (n) => { reportPage = n; clear(content); renderReports(); });
      if (p) content.append(p);
    }

    function reportRow(r) {
      const act = async (action, label, confirmText) => {
        if (confirmText && !confirm(confirmText)) return;
        try {
          await api.admin.handleReport(r.id, { action, note: '' });
          toast(label);
          clear(content);
          renderReports();
        } catch (err) {
          toast(err.message || '操作失败', 'err');
        }
      };

      const buttons = [];
      if (r.status === 'pending') {
        buttons.push(h('button', { class: 'btn btn--sm', type: 'button', onclick: () => act('processing', '已标记为处理中') }, '标记处理中'));
      }
      if (r.status === 'pending' || r.status === 'processing') {
        buttons.push(
          h('button', {
            class: 'btn btn--sm btn--danger',
            type: 'button',
            onclick: () => act('delete-post', '已删除违规内容', `确认删除被举报内容并结案？\n\n内容：${(r.post?.content || '').slice(0, 50)}…\n\n该帖所有待处理举报会一并标记为已处理。`),
          }, '确认违规并删除'),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => act('reject', '已驳回') }, '驳回举报'),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => act('resolve', '已标记处理') }, '标记已处理')
        );
      }

      return h('article', { class: 'admin-row' },
        h('div', { class: 'admin-row__main' },
          h('div', { class: 'admin-row__meta' },
            h('span', { class: `admin-badge admin-badge--${r.status}`, text: REPORT_STATUS[r.status] || r.status }),
            h('b', { text: r.reason }),
            h('span', { text: fmtTime(r.created_at) }),
            r.relatedCount > 1 ? h('span', { class: 'admin-badge admin-badge--warn', text: `同帖 ${r.relatedCount} 条举报` }) : null
          ),
          r.note ? h('p', { class: 'admin-row__text', text: `补充说明：${r.note}` }) : null,
          r.post
            ? h('div', { class: 'admin-quote' },
                h('span', { class: 'admin-quote__author', text: r.post.author?.name || '未知作者' }),
                h('p', { text: r.post.content }),
                r.post.deletedAt ? h('span', { class: 'admin-badge admin-badge--resolved', text: '内容已删除' }) : null
              )
            : h('p', { class: 'admin-row__text', text: '被举报内容已不存在' }),
          h('div', { class: 'admin-row__foot' },
            h('span', { text: `举报人：${r.reporter_name || '匿名'}` }),
            h('span', { text: `ID：${r.id.slice(0, 8)}` }),
            r.handled_at ? h('span', { text: `处理于 ${fmtTime(r.handled_at)}` }) : null
          )
        ),
        buttons.length ? h('div', { class: 'admin-row__side' }, ...buttons) : h('div', { class: 'admin-row__side' }, h('span', { class: 'admin-tile__state', text: '已结案' }))
      );
    }

    /* 登录态在别处失效（退出、过期）：立刻收起管理内容 */
    const onAuth = (e) => {
      const user = e?.detail?.user;
      if (user && user.role === 'admin') return;
      if (!page.isConnected) return;
      clear(content);
      toast('登录状态已失效，请重新登录管理员账号', 'err');
    };
    window.addEventListener('foodsoul:auth', onAuth);
    onDestroy(() => window.removeEventListener('foodsoul:auth', onAuth));

    render();

    return {
      destroy() {
        for (const fn of cleanups) {
          try {
            fn();
          } catch {
            /* 忽略 */
          }
        }
        page.remove();
      },
    };
  },
};
