import { h, clear, fmtTime, toast } from '../lib/dom.js';
import { api, guest, compressImage } from '../lib/api.js';
import { openAuthModal } from '../components/account.js';
import { DISHES, DISH_BY_ID } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';

const SORTS = [
  { id: 'latest', label: '最新' },
  { id: 'hot', label: '热门' },
  { id: 'discussed', label: '讨论最多' },
];

const KINDS = ['讨论', '菜谱分享', '提问', '角色话题'];
const MAX_IMAGES = 3;
const MAX_IMAGE = 3 * 1024 * 1024;

export default {
  async mount(root) {
    const me = guest();
    // 真实登录用户：发布、评论、上传都必须以它为准（服务端同样校验）
    let currentUser = null;
    let sort = 'latest';
    let kind = KINDS[0];

    /* ---------------- 顶部 ---------------- */
    const head = h(
      'div',
      { class: 'page-head' },
      h('a', { class: 'page-head__back', href: '/', 'data-link': '' }, '← 返回'),
      h('div', {},
        h('h1', { class: 'page-head__title', text: '美食社区' }),
        h('p', { class: 'page-head__sub', text: 'COMMUNITY · 真实读写，刷新后仍在' })
      ),
      h('div', { class: 'page-head__spacer' }),
      h('a', { class: 'btn btn--sm', href: '/dishes', 'data-link': '' }, '美食图鉴')
    );

    /* ---------------- 发帖 ---------------- */
    const textarea = h('textarea', {
      class: 'composer-box__area',
      placeholder: '分享一道菜的做法、口感、食材替代，或者你家乡的版本…',
      maxlength: '800',
      rows: '3',
      'aria-label': '帖子内容',
    });
    const dishSelect = h(
      'select',
      { class: 'field__select', 'aria-label': '关联菜品' },
      h('option', { value: '', text: '不关联菜品' }),
      ...DISHES.map((d) => h('option', { value: d.id, text: `${d.name} · ${CUISINE_BY_ID[d.cuisine]?.name}` }))
    );
    const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
    const preview = h('div', { class: 'upload-preview', hidden: true });
    let imageDataList = [];

    const pickBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => fileInput.click() }, '添加图片');
    const publishBtn = h('button', { class: 'btn btn--sm btn--solid', type: 'submit' }, '发布');

    function renderPreviews() {
      clear(preview);
      preview.hidden = imageDataList.length === 0;
      imageDataList.forEach((data, i) => {
        preview.append(
          h('div', { class: 'upload-preview__item' },
            h('img', { src: data, alt: `待发布的图片 ${i + 1}` }),
            h('button', {
              class: 'upload-preview__x',
              type: 'button',
              'aria-label': '移除图片',
              onclick: () => {
                imageDataList.splice(i, 1);
                renderPreviews();
              },
            }, '×')
          )
        );
      });
      pickBtn.disabled = !currentUser || imageDataList.length >= MAX_IMAGES;
      pickBtn.textContent = imageDataList.length >= MAX_IMAGES ? `最多 ${MAX_IMAGES} 张` : '添加图片';
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        toast('只支持 JPG / PNG / WebP / GIF', 'err');
        return;
      }
      if (file.size > MAX_IMAGE) {
        toast('图片不能超过 3MB', 'err');
        return;
      }
      try {
        const data = await compressImage(file);
        if (data.length > MAX_IMAGE) {
          toast('压缩后仍超过 3MB，请换一张', 'err');
          return;
        }
        imageDataList.push(data);
        if (imageDataList.length > MAX_IMAGES) imageDataList = imageDataList.slice(0, MAX_IMAGES);
        renderPreviews();
      } catch (err) {
        toast(err.message || '图片处理失败', 'err');
      }
    });

    /* ---------------- 分类 ---------------- */
    const kindBar = h('div', { class: 'composer-box__kinds', role: 'radiogroup', 'aria-label': '帖子分类' });
    KINDS.forEach((k) => {
      kindBar.append(
        h('button', {
          class: `chip${k === kind ? ' is-on' : ''}`,
          type: 'button',
          role: 'radio',
          'aria-checked': String(k === kind),
          onclick: (e) => {
            kind = k;
            kindBar.querySelectorAll('.chip').forEach((b) => {
              b.classList.toggle('is-on', b === e.currentTarget);
              b.setAttribute('aria-checked', String(b === e.currentTarget));
            });
          },
        }, k)
      );
    });

    // 未登录时覆盖在发布框上的登录引导（不是隐藏按钮，而是阻止进入可提交状态）
    const lockBar = h(
      'div',
      { class: 'composer-lock', hidden: true },
      h('p', { class: 'composer-lock__text', text: '请先登录后再发布内容' }),
      h(
        'button',
        {
          class: 'btn btn--sm btn--gold',
          type: 'button',
          onclick: () => openAuthModal('login'),
        },
        '登录 / 注册'
      )
    );

    const composer = h(
      'form',
      { class: 'composer-box' },
      h('div', { class: 'composer-box__meta' },
        h('span', { class: 'composer-box__who', text: '发布身份：读取中…' }),
      ),
      kindBar,
      textarea,
      preview,
      h(
        'div',
        { class: 'composer-box__bar' },
        h('div', { class: 'composer-box__actions' }, dishSelect, pickBtn, publishBtn)
      ),
      fileInput,
      lockBar
    );

    const whoEl = composer.querySelector('.composer-box__who');

    /** 登录态变化时同步发布区可用状态 */
    function applyAuthState(user) {
      currentUser = user || null;
      const loggedIn = Boolean(currentUser);
      composer.classList.toggle('is-locked', !loggedIn);
      lockBar.hidden = loggedIn;
      textarea.disabled = !loggedIn;
      dishSelect.disabled = !loggedIn;
      pickBtn.disabled = !loggedIn || imageDataList.length >= MAX_IMAGES;
      publishBtn.disabled = !loggedIn;
      if (loggedIn) {
        whoEl.textContent = `以「${currentUser.name || currentUser.email}」发布 · 已登录`;
      } else {
        whoEl.textContent = '未登录 · 登录后即可发布';
      }
    }

    applyAuthState(null);

    api.auth
      .me()
      .then((res) => applyAuthState(res?.user))
      .catch(() => applyAuthState(null));

    window.addEventListener('foodsoul:auth', (e) => {
      if (!composer.isConnected) return;
      applyAuthState(e.detail?.user);
    });

    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) {
        toast('请先登录后再发布内容', 'err');
        openAuthModal('login');
        return;
      }
      const content = textarea.value.trim();
      if (content.length < 2) {
        toast('至少写两个字', 'err');
        return;
      }
      publishBtn.disabled = true;
      publishBtn.textContent = '发布中…';
      try {
        const dishId = dishSelect.value;
        const dish = DISH_BY_ID[dishId];
        const res = await api.posts.add({
          content,
          images: imageDataList,
          kind,
          dishId,
          cuisineId: dish?.cuisine || '',
          tasteId: dish?.tastes?.[0] || '',
        });
        textarea.value = '';
        imageDataList = [];
        renderPreviews();
        if (res?.post) insertPost(res.post);
        toast('已发布');
      } catch (err) {
        toast(err.message || '发布失败', 'err');
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = '发布';
      }
    });

    /* ---------------- 排序 ---------------- */
    const tabs = h('div', { class: 'feed-tabs', role: 'tablist' });
    SORTS.forEach((s) => {
      tabs.append(
        h('button', {
          class: `feed-tabs__btn${s.id === sort ? ' is-on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(s.id === sort),
          onclick: (e) => {
            sort = s.id;
            tabs.querySelectorAll('.feed-tabs__btn').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget));
            resetFeed();
          },
        }, s.label)
      );
    });

    /* ---------------- 灯箱 ---------------- */
    let lightbox = null;
    function openLightbox(src, alt) {
      closeLightbox();
      lightbox = h('div', {
        class: 'lightbox',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': alt || '图片预览',
        onclick: closeLightbox,
      },
        h('img', { src, alt: alt || '' }),
        h('button', { class: 'lightbox__x', type: 'button', 'aria-label': '关闭', onclick: closeLightbox }, '×')
      );
      document.body.appendChild(lightbox);
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      if (lightbox) lightbox.remove();
      lightbox = null;
      // 详情层还开着就继续锁住背景，避免滚到书页后面
      document.body.style.overflow = document.querySelector('.post-detail') ? 'hidden' : '';
    }
    const onEsc = (e) => {
      if (e.key === 'Escape') closeLightbox();
    };
    document.addEventListener('keydown', onEsc);

/* ---------------- 列表状态（分页 / 去重 / 无限滚动） ---------------- */
    const PAGE_SIZE = 12; // 服务端上限 12；一屏 3 列刚好铺满两行
    let items = []; // 已加载的帖子（服务端顺序）
    let seen = new Set(); // 已渲染过的帖子 id，用来去重
    let page = 0; // 已经成功加载到第几页
    let total = 0; // 后端返回的总数（以服务端为准）
    let hasMore = true; // 后端返回的 hasMore（以服务端为准）
    let loading = false; // 正在请求：避免并发拉同一页
    let loadError = null; // 上一次请求失败，等待用户重试
    let reqSeq = 0; // 请求序号：切排序时作废旧请求
    let io = null; // IntersectionObserver
    let ioRoot = null; // 真正的滚动容器（社区所在纸面）

    const feed = h('div', { class: 'post-list', role: 'feed' });
    const feedState = h('div', { class: 'feed-state', hidden: true, 'aria-live': 'polite' });
    const sentinel = h('div', { class: 'feed-sentinel', 'aria-hidden': 'true' });
    /* 左页的数据角：数字都从已加载的真实帖子里统计，不编造 */
    const statsBox = h('div', { class: 'community-stats' });

    function paintStats() {
      clear(statsBox);
      const kinds = new Map();
      const authors = new Map();
      let today = 0;
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      for (const p of items) {
        if (p.kind) kinds.set(p.kind, (kinds.get(p.kind) || 0) + 1);
        const name = p.author?.name || '匿名';
        authors.set(name, (authors.get(name) || 0) + 1);
        if (new Date(p.createdAt).getTime() >= dayStart.getTime()) today += 1;
      }
      const topKinds = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const topAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      statsBox.append(
        h('p', { class: 'community-stats__title', text: '社区现状' }),
        h(
          'div',
          { class: 'community-stats__grid' },
          h('div', { class: 'community-stats__cell' }, h('b', { text: String(total) }), h('span', { text: '帖子总数' })),
          h('div', { class: 'community-stats__cell' }, h('b', { text: String(items.length) }), h('span', { text: '已加载' })),
          h('div', { class: 'community-stats__cell' }, h('b', { text: String(today) }), h('span', { text: '今日新帖' }))
        ),
        topKinds.length
          ? h(
              'div',
              { class: 'community-stats__row' },
              h('span', { class: 'community-stats__label', text: '常见类型' }),
              ...topKinds.map(([k, n]) => h('span', { class: 'community-stats__tag', text: `${k} ${n}` }))
            )
          : null,
        topAuthors.length
          ? h(
              'div',
              { class: 'community-stats__row' },
              h('span', { class: 'community-stats__label', text: '活跃作者' }),
              ...topAuthors.map(([k, n]) => h('span', { class: 'community-stats__tag', text: `${k} ${n}` }))
            )
          : null
      );
    }

    /* ---------------- 详情弹层：完整正文、全部图片、评论 ---------------- */
    let detail = null; // { el, post, likeBtn, commentCount, commentsBox, commentsList }

    function onDetailKey(e) {
      if (!detail || e.key !== 'Escape') return;
      // 捕获阶段截住：书自己也在 document 上监听 Esc（合上画册），不拦会一起触发
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeDetail();
    }

    function closeDetail() {
      if (!detail) return;
      detail.el.remove();
      detail = null;
      document.removeEventListener('keydown', onDetailKey, true);
      document.body.style.overflow = '';
    }

    function commentNode(c) {
      return h(
        'div',
        { class: 'post-comment' },
        h('div', { class: 'post-comment__head' },
          h('b', { text: c.author.name }),
          c.isAI ? h('span', { class: 'comment__badge', text: 'AI 回复 · 用户触发' }) : null,
          h('span', { text: fmtTime(c.createdAt) })
        ),
        h('p', { class: 'post-comment__text', text: c.content })
      );
    }

    /** Epicure 厨房分享过来的原创菜谱：折叠展示食材与步骤 */
    function recipeBlock(post) {
      const r = post.recipe;
      if (!r || !Array.isArray(r.ingredients) || !Array.isArray(r.steps)) return null;
      const DIFF = { easy: '简单', medium: '中等', hard: '复杂' };
      return h(
        'details',
        { class: 'post__recipe' },
        h(
          'summary',
          {},
          h('b', { text: r.title || '原创菜谱' }),
          h('span', {
            class: 'post__badge',
            text: r.origin === 'traditional' ? '传统菜式' : 'AI 原创',
          }),
          r.cuisine ? h('span', { class: 'post__kind', text: r.cuisine }) : null,
          r.minutes ? h('span', { class: 'post__kind', text: `${r.minutes} 分钟` }) : null,
          r.difficulty ? h('span', { class: 'post__kind', text: DIFF[r.difficulty] || r.difficulty }) : null
        ),
        h(
          'div',
          { class: 'post__recipe__body' },
          r.intro ? h('p', { text: r.intro }) : null,
          h(
            'div',
            { class: 'post__recipe__ings' },
            ...r.ingredients.map((i) =>
              h('span', {}, h('em', { text: `${i.name}${i.role === 'aux' ? '（辅）' : ''}` }), h('em', { text: `${i.amount}${i.unit}` }))
            )
          ),
          h('ol', { class: 'post__recipe__steps' }, ...r.steps.map((st) => h('li', { text: st.action }))),
          r.flavor ? h('p', { class: 'post__recipe__flavor', text: `风味分析：${r.flavor}` }) : null,
          r.model ? h('p', { class: 'post__recipe__flavor', text: `生成模型：${r.model}` }) : null
        )
      );
    }

    function dishBlock(post) {
      const dish = DISH_BY_ID[post.dishId];
      if (!dish) return null;
      return h('div', { class: 'post__dish' },
        h('a', { class: 'post__dish-main', href: `/dishes/${dish.id}`, 'data-link': '' },
          h('img', { src: dish.image, alt: '', loading: 'lazy' }),
          h('span', {}, h('b', { text: dish.name }), h('em', { text: `${CUISINE_BY_ID[dish.cuisine]?.name} · ${TASTE_BY_ID[dish.tastes[0]]?.name}` }))
        ),
        h('a', { class: 'post__dish-chat', href: `/chat/${dish.id}`, 'data-link': '' }, '聊一聊')
      );
    }

    function mediaUrls(post) {
      return (post.images?.length ? post.images : post.image ? [post.image] : []).slice(0, MAX_IMAGES);
    }

    /* ---------------- 列表卡片（统一尺寸，只放摘要） ---------------- */
    const cardIndex = new Map(); // id -> { post, el, likeBtn, commentBtn }

    async function toggleLike(post) {
      try {
        const res = await api.posts.like(post.id);
        post.likes = res.likes;
        post.likedBy = res.liked ? [...(post.likedBy || []), me.id] : (post.likedBy || []).filter((x) => x !== me.id);
        refreshMeta(post);
      } catch {
        toast('操作失败', 'err');
      }
    }

    /** 点赞数 / 评论数变化后，同步卡片与（若开着的）详情层 */
    function refreshMeta(post) {
      const entry = cardIndex.get(post.id);
      const liked = (post.likedBy || []).includes(me.id);
      if (entry) {
        entry.likeBtn.textContent = `赞 ${post.likes}`;
        entry.likeBtn.classList.toggle('is-on', liked);
        entry.commentBtn.textContent = `评论 ${(post.comments || []).length}`;
        entry.el.classList.toggle('is-liked', liked);
      }
      if (detail && detail.post.id === post.id) {
        detail.likeBtn.textContent = `赞 ${post.likes}`;
        detail.likeBtn.classList.toggle('is-on', liked);
        detail.commentCount.textContent = `${(post.comments || []).length} 条评论`;
      }
    }

    function postCard(post) {
      const liked = (post.likedBy || []).includes(me.id);
      const imgs = mediaUrls(post);
      const commentCount = (post.comments || []).length;

      const likeBtn = h('button', {
        class: `post-act${liked ? ' is-on' : ''}`,
        type: 'button',
        'aria-label': '点赞',
        onclick: (e) => {
          e.stopPropagation();
          void toggleLike(post);
        },
      }, `赞 ${post.likes}`);

      const commentBtn = h('button', {
        class: 'post-act',
        type: 'button',
        onclick: (e) => {
          e.stopPropagation();
          openDetail(post);
        },
      }, `评论 ${commentCount}`);

      const card = h('article', {
        class: 'post',
        'data-id': post.id,
        tabindex: '0',
        'aria-label': `${post.author?.name || '匿名'} 的帖子，点击查看详情`,
        onclick: () => openDetail(post),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(post);
          }
        },
      },
        h('header', { class: 'post__head' },
          h('span', { class: 'post__avatar', text: String(post.author?.name || '匿').slice(0, 1) }),
          h('div', { class: 'post__who' },
            h('b', { text: post.author?.name || '匿名' }),
            h('span', { text: fmtTime(post.createdAt) })
          )
        ),
        // 标题行固定占位：菜谱标题优先，其次用帖子分类，保证每张卡片的图片区一样高
        h('h3', {
          class: post.recipe?.title ? 'post__title' : 'post__title post__title--kind',
          text: post.recipe?.title || post.kind || '食客分享',
        }),
        h('p', { class: 'post__text', text: post.content }),
        imgs.length
          ? h('div', { class: `post__media post__media--${imgs.length}` },
              ...imgs.map((src, i) => h('img', { src, alt: `帖子图片 ${i + 1}`, loading: 'lazy' }))
            )
          : null,
        h('footer', { class: 'post__foot' },
          likeBtn,
          commentBtn,
          post.dishId && DISH_BY_ID[post.dishId] ? h('span', { class: 'post__tag', text: DISH_BY_ID[post.dishId].name }) : null,
          post.recipe ? h('span', { class: 'post__tag', text: '菜谱' }) : null,
          post.isSeed ? h('span', { class: 'post__tag', text: '示例' }) : null
        )
      );

      cardIndex.set(post.id, { post, el: card, likeBtn, commentBtn });
      return card;
    }

    /* ---------------- 详情层 ---------------- */
    function openDetail(post) {
      closeDetail();
      const liked = (post.likedBy || []).includes(me.id);
      const comments = post.comments || [];

      const likeBtn = h('button', {
        class: `post-act${liked ? ' is-on' : ''}`,
        type: 'button',
        onclick: () => void toggleLike(post),
      }, `赞 ${post.likes}`);

      const commentCount = h('span', { class: 'post-detail__count', text: `${comments.length} 条评论` });
      const commentsList = h('div', { class: 'post-detail__comments' });
      const paintComments = () => {
        clear(commentsList);
        if (!comments.length) {
          commentsList.append(h('p', { class: 'post-detail__empty', text: '还没有评论，说两句吧。' }));
          return;
        }
        comments.forEach((c) => commentsList.append(commentNode(c)));
      };
      paintComments();

      const commentInput = h('input', { type: 'text', placeholder: '写下你的做法或疑问…', maxlength: '400', 'aria-label': '评论内容' });
      const commentForm = h('form', { class: 'post-comment-form' },
        commentInput,
        h('button', { class: 'btn btn--sm', type: 'submit' }, '评论')
      );
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) {
          toast('请先登录后再评论', 'err');
          openAuthModal('login');
          return;
        }
        const v = commentInput.value.trim();
        if (!v) return;
        try {
          const res = await api.posts.comment(post.id, { content: v });
          if (res.comment) post.comments = [...(post.comments || []), res.comment];
          commentInput.value = '';
          paintComments();
          refreshMeta(post);
          toast('已评论');
        } catch (err) {
          toast(err.message || '评论失败', 'err');
        }
      });

      /* 举报 */
      const REPORT_REASONS = ['垃圾广告', '辱骂或骚扰', '不实或违规内容', '其他'];
      const reportReason = h('select', { class: 'field__select', 'aria-label': '举报原因' },
        ...REPORT_REASONS.map((r) => h('option', { value: r, text: r })));
      const reportNote = h('input', { type: 'text', class: 'field__input', maxlength: '200', placeholder: '补充说明（可选）', 'aria-label': '补充说明' });
      const reportSubmit = h('button', { class: 'btn btn--sm btn--danger', type: 'submit' }, '提交举报');
      const reportForm = h('form', { class: 'post-report__form' }, reportReason, reportNote, reportSubmit);
      const reportBox = h('div', { class: 'post-report', hidden: true },
        h('p', { class: 'post-report__title', text: '举报这条内容' }), reportForm);

      reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) {
          toast('请先登录后再举报', 'err');
          openAuthModal('login');
          return;
        }
        reportSubmit.disabled = true;
        reportSubmit.textContent = '提交中…';
        try {
          const res = await api.posts.report(post.id, { reason: reportReason.value, note: reportNote.value.trim() });
          toast(res.message || '已提交举报');
          reportBox.hidden = true;
          reportNote.value = '';
        } catch (err) {
          toast(err.message || '举报失败', 'err');
        } finally {
          reportSubmit.disabled = false;
          reportSubmit.textContent = '提交举报';
        }
      });

      const dish = DISH_BY_ID[post.dishId];
      const actions = h('div', { class: 'post-actions' },
        likeBtn,
        dish
          ? h('button', {
              class: 'post-act',
              type: 'button',
              title: '由你主动触发，让这道菜以它的味型人格回帖',
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = '思考中…';
                try {
                  const res = await api.posts.aiReply(post.id, { dishId: dish.id, content: post.content });
                  if (res.comment) post.comments = [...(post.comments || []), res.comment];
                  paintComments();
                  refreshMeta(post);
                  toast('这道菜回帖了');
                } catch (err) {
                  toast(err.message || 'AI 回复失败', 'err');
                } finally {
                  btn.disabled = false;
                  btn.textContent = '让菜回应';
                }
              },
            }, '让菜回应')
          : null,
        h('button', {
          class: 'post-act',
          type: 'button',
          onclick: () => {
            if (!currentUser) {
              toast('请先登录后再举报', 'err');
              openAuthModal('login');
              return;
            }
            reportBox.hidden = !reportBox.hidden;
          },
        }, '举报'),
        currentUser && post.author?.id === currentUser.id
          ? h('button', {
              class: 'post-act post-act--danger',
              type: 'button',
              onclick: async () => {
                if (!confirm('删除后无法恢复，确认？')) return;
                try {
                  await api.posts.remove(post.id);
                  closeDetail();
                  removePost(post.id);
                  toast('已删除');
                } catch (err) {
                  toast(err.message || '删除失败', 'err');
                }
              },
            }, '删除')
          : null
      );

      const imgs = mediaUrls(post);
      const panel = h('div', { class: 'post-detail__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '帖子详情' },
        h('button', { class: 'post-detail__x', type: 'button', 'aria-label': '关闭', onclick: () => closeDetail() }, '×'),
        h('header', { class: 'post__head' },
          h('span', { class: 'post__avatar', text: String(post.author?.name || '匿').slice(0, 1) }),
          h('div', { class: 'post__who' },
            h('b', { text: post.author?.name || '匿名' }),
            h('span', { text: fmtTime(post.createdAt) })
          ),
          post.kind ? h('span', { class: 'post__kind', text: post.kind }) : null
        ),
        post.recipe?.title ? h('h2', { class: 'post-detail__title', text: post.recipe.title }) : null,
        h('p', { class: 'post-detail__text', text: post.content }),
        imgs.length
          ? h('div', { class: `post__images post__images--${Math.min(imgs.length, 3)}` },
              ...imgs.map((src, i) =>
                h('button', {
                  class: 'post__img',
                  type: 'button',
                  'aria-label': `查看图片 ${i + 1}`,
                  onclick: () => openLightbox(src, '帖子图片'),
                }, h('img', { src, alt: `帖子图片 ${i + 1}`, loading: 'lazy' }))
              )
            )
          : null,
        recipeBlock(post),
        dishBlock(post),
        actions,
        reportBox,
        h('div', { class: 'post-detail__sep' }, commentCount),
        commentsList,
        commentForm
      );

      const overlay = h('div', {
        class: 'post-detail',
        onclick: (e) => {
          if (e.target === overlay) closeDetail();
        },
      }, panel);

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onDetailKey, true);
      detail = { el: overlay, post, likeBtn, commentCount, commentsList };
      panel.scrollTop = 0;
    }

    /* ---------------- 渲染 / 加载 ---------------- */
    function renderEmpty(text) {
      clear(feed);
      cardIndex.clear();
      feed.append(h('div', { class: 'empty-state', text }));
    }

    function appendCards(list, reset = false) {
      if (reset) {
        clear(feed);
        cardIndex.clear();
      }
      if (!list.length) return;
      const empty = feed.querySelector('.empty-state');
      if (empty) empty.remove();
      const frag = document.createDocumentFragment();
      list.forEach((p) => frag.append(postCard(p)));
      feed.append(frag);
    }

    function removePost(id) {
      items = items.filter((p) => p.id !== id);
      seen.delete(id);
      total = Math.max(0, total - 1);
      const entry = cardIndex.get(id);
      if (entry) {
        entry.el.remove();
        cardIndex.delete(id);
      }
      if (!items.length) renderEmpty('还没有帖子，来发第一条。');
      paintStats();
    }

    function setFeedState(kind, text = '') {
      clear(feedState);
      feedState.hidden = kind === 'idle';
      feedState.dataset.kind = kind;
      if (kind === 'idle') return;
      if (kind === 'loading') {
        feedState.append(h('span', { class: 'feed-spinner', 'aria-hidden': 'true' }), h('span', { text }));
      } else if (kind === 'end') {
        feedState.append(h('span', { class: 'feed-end', text }));
      } else if (kind === 'error') {
        feedState.append(
          h('span', { class: 'feed-error', text }),
          h('button', {
            class: 'feed-retry',
            type: 'button',
            onclick: () => {
              loadError = null;
              void fetchPage(page + 1);
            },
          }, '重试')
        );
      }
    }

    /** 拉下一页；target 是页码（重试时仍是同一页，不会跳号） */
    async function fetchPage(target) {
      if (loading) return;
      if (target > 1 && (!hasMore || loadError)) return;
      const seq = ++reqSeq;
      loading = true;
      loadError = null;
      setFeedState(target === 1 ? 'idle' : 'loading', '正在发现更多精彩内容……');
      try {
        const res = await api.posts.list({ sort, page: target, pageSize: PAGE_SIZE });
        if (seq !== reqSeq) return; // 排序已切换：这次结果作废
        const list = Array.isArray(res.items) ? res.items : [];
        const fresh = list.filter((p) => p && p.id && !seen.has(p.id));
        fresh.forEach((p) => seen.add(p.id));
        const isFirst = target === 1;
        items = isFirst ? fresh : [...items, ...fresh];
        total = Number.isFinite(res.total) ? res.total : items.length;
        hasMore = typeof res.hasMore === 'boolean' ? res.hasMore : items.length < total;
        page = target;
        appendCards(fresh, isFirst);
        if (!items.length) renderEmpty('还没有帖子，来发第一条。');
        paintStats();
        setFeedState(hasMore ? 'idle' : 'end', '已经看到全部内容');
      } catch (err) {
        if (seq !== reqSeq) return;
        loadError = err;
        const text = `加载失败：${String(err?.message || err).slice(0, 40)}`;
        if (target === 1 && !items.length) renderEmpty('社区加载失败，请稍后重试。');
        setFeedState('error', text);
      } finally {
        if (seq === reqSeq) loading = false;
      }
    }

    /** 重置整个列表（换排序、发布、重进页面） */
    function resetFeed() {
      items = [];
      seen = new Set();
      page = 0;
      total = 0;
      hasMore = true;
      loadError = null;
      reqSeq += 1; // 作废在途请求
      loading = false;
      clear(feed);
      cardIndex.clear();
      setFeedState('idle');
      if (ioRoot) ioRoot.scrollTop = 0;
      void fetchPage(1);
    }

    /* ---------------- 自动加载：只认社区自己的滚动容器 ---------------- */
    function resolveScrollRoot() {
      return feed.closest('.bk-pageface') || null;
    }

    function startObserver() {
      if (io) return;
      const root = resolveScrollRoot();
      if (!root) {
        // 章节先挂在暂存区、随后才被搬进纸面：等它真的落到纸面上再观察
        requestAnimationFrame(() => {
          if (!destroyed) startObserver();
        });
        return;
      }
      ioRoot = root;
      io = new IntersectionObserver(
        (entries) => {
          if (destroyed) return;
          if (!entries.some((e) => e.isIntersecting)) return;
          if (loading || !hasMore || loadError) return;
          void fetchPage(page + 1);
        },
        { root, rootMargin: '260px 0px 0px 0px', threshold: 0 }
      );
      io.observe(sentinel);
      // 首屏由 fetchPage(1) 负责；哨兵只在真的滚到底（或首屏没铺满）时才触发下一批
    }

    function stopObserver() {
      if (io) io.disconnect();
      io = null;
      ioRoot = null;
    }

    let destroyed = false;

    const page_ = h(
      'div',
      { class: 'page community-page' },
      h('div', { class: 'wrap community-wrap' },
        head,
        h('div', { class: 'community-grid' },
          h('aside', { class: 'community-side' },
            composer,
            statsBox,
            h('div', { class: 'community-note' },
              h('b', { text: '关于这里' }),
              h('p', { text: '帖子与评论保存在服务端，刷新后仍在。浏览无需登录；发帖、评论与上传图片需要先登录，内容会记在当前账号名下。' }),
              h('p', { text: 'AI 回复需要你手动点「让菜回应」，且会明确标注；未接入 AI 时不会伪造 AI 发言，请先在右上角「接入 AI」配置。' })
            ),
            h('div', { class: 'community-tips' },
              h('b', { text: '写一条能帮到人的帖' }),
              h('ul', {},
                h('li', { text: '关联菜品：别人能顺着菜名回到图鉴，看火候与味型。' }),
                h('li', { text: '写清分量与火候：几个人吃、几分钟、什么火。' }),
                h('li', { text: '失败也值得发：糊锅、出水、发苦，比成功版更有用。' }),
                h('li', { text: '一张实拍图胜过形容词，别用别人的图。' })
              )
            )
          ),
          h('div', { class: 'community-main' }, tabs, feed, feedState, sentinel)
        )
      )
    );

    root.append(page_);

    // 发布成功后把新帖直接插到列表最前面，不重新拉取、不打断阅读位置
    function insertPost(post) {
      if (!post?.id || seen.has(post.id)) return;
      seen.add(post.id);
      items.unshift(post);
      total += 1;
      const empty = feed.querySelector('.empty-state');
      if (empty) empty.remove();
      feed.prepend(postCard(post));
      paintStats();
    }

    await fetchPage(1);
    startObserver();

    return {
      destroy() {
        destroyed = true;
        stopObserver();
        closeDetail();
        closeLightbox();
        document.removeEventListener('keydown', onEsc);
      },
    };
  },
};