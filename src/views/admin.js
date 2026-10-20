/**
 * 管理后台（/admin）
 * ------------------------------------------------------------
 * 权限完全由服务端判定：本页只负责展示，所有请求都打到 /api/admin/*，
 * 普通用户/未登录会在第一个请求就拿到 401/403，页面显示无权限。
 */
import { h, clear, toast, fmtTime } from '../lib/dom.js';
import { api, compressImage } from '../lib/api.js';
import { applyOverrideLocally } from '../lib/overrides.js';

const TABS = [
  { id: 'overview', label: '后台概览', en: 'OVERVIEW' },
  { id: 'posts', label: '社区内容', en: 'POSTS' },
  { id: 'cards', label: '首页图片', en: 'CARDS' },
  { id: 'dishes', label: '美食图鉴', en: 'DISHES' },
  { id: 'reports', label: '举报处理', en: 'REPORTS' },
];

const REPORT_STATUS = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已处理',
  rejected: '已驳回',
};


export default {
  async mount(root) {
    const page = h('div', { class: 'page admin-page' });
    root.append(page);

    // 权限探测：失败即显示无权限，不渲染任何管理数据
    let boot;
    try {
      boot = await api.admin.overview();
    } catch (err) {
      page.append(forbidden(err.message));
      return;
    }

    let tab = 'overview';
    const content = h('div', { class: 'admin-content' });
    const navBtns = new Map();

    const nav = h(
      'aside',
      { class: 'admin-nav' },
      h('div', { class: 'admin-nav__brand' },
        h('b', { text: '食有灵 · 管理后台' }),
        h('span', { text: boot.admin?.email || '' })
      ),
      ...TABS.map((t) => {
        const btn = h(
          'button',
          {
            class: 'admin-nav__item',
            type: 'button',
            onclick: () => switchTab(t.id),
          },
          h('span', { text: t.label }),
          h('em', { text: t.en })
        );
        navBtns.set(t.id, btn);
        return btn;
      }),
      h('div', { class: 'admin-nav__foot' },
        h('a', { class: 'admin-nav__item', href: '/', 'data-link': '' }, h('span', { text: '返回前台' }), h('em', { text: 'SITE' })),
        h(
          'button',
          {
            class: 'admin-nav__item admin-nav__item--danger',
            type: 'button',
            onclick: async () => {
              if (!confirm('确认退出登录？退出后将无法继续访问后台。')) return;
              try {
                await api.auth.logout();
              } catch { /* noop */ }
              window.dispatchEvent(new CustomEvent('foodsoul:auth', { detail: { user: null } }));
              location.href = '/';
            },
          },
          h('span', { text: '退出管理后台' }),
          h('em', { text: 'LOGOUT' })
        )
      )
    );

    page.append(
      h('div', { class: 'admin-shell' },
        nav,
        h('main', { class: 'admin-main' },
          h('header', { class: 'admin-head' },
            h('h1', { text: '管理后台' }),
            h('p', { text: '社区内容、首页图片、美食图鉴与举报处理' })
          ),
          content
        )
      )
    );

    function switchTab(id) {
      tab = id;
      navBtns.forEach((btn, key) => btn.classList.toggle('is-on', key === id));
      render();
    }

    function render() {
      clear(content);
      if (tab === 'overview') return renderOverview();
      if (tab === 'posts') return renderPosts();
      if (tab === 'cards') return renderCards();
      if (tab === 'dishes') return renderDishes();
      if (tab === 'reports') return renderReports();
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
      return h(
        'div',
        { class: 'admin-denied' },
        h('h1', { text: '无权访问' }),
        h('p', { text: message || '需要管理员权限' }),
        h('a', { class: 'btn btn--sm', href: '/', 'data-link': '' }, '返回首页')
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

    switchTab('overview');
  },
};
