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
    let page = 1;
    let items = [];
    let total = 0;
    let loading = false;

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
        await api.posts.add({
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
        page = 1;
        await load();
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
            page = 1;
            load();
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
      document.body.style.overflow = '';
    }
    const onEsc = (e) => {
      if (e.key === 'Escape') closeLightbox();
    };
    document.addEventListener('keydown', onEsc);

    /* ---------------- 列表 ---------------- */
    const feed = h('div', { class: 'post-list' });
    const moreWrap = h('div', { class: 'feed-more' });

    function commentNode(post, c) {
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

    function imagesBlock(post) {
      const urls = (post.images?.length ? post.images : post.image ? [post.image] : []).slice(0, MAX_IMAGES);
      if (!urls.length) return null;
      return h(
        'div',
        { class: `post__images post__images--${Math.min(urls.length, 3)}` },
        ...urls.map((src, i) =>
          h('button', {
            class: 'post__img',
            type: 'button',
            'aria-label': `查看图片 ${i + 1}`,
            onclick: () => openLightbox(src, '帖子图片'),
          }, h('img', { src, alt: `帖子图片 ${i + 1}`, loading: 'lazy' }))
        )
      );
    }

    function postCard(post) {
      const dish = DISH_BY_ID[post.dishId];
      const liked = (post.likedBy || []).includes(me.id);
      const likeBtn = h(
        'button',
        {
          class: `post-act${liked ? ' is-on' : ''}`,
          type: 'button',
          onclick: async () => {
            try {
              const res = await api.posts.like(post.id);
              post.likes = res.likes;
              post.likedBy = res.liked ? [...(post.likedBy || []), me.id] : (post.likedBy || []).filter((x) => x !== me.id);
              likeBtn.textContent = `赞 ${res.likes}`;
              likeBtn.classList.toggle('is-on', res.liked);
            } catch {
              toast('操作失败', 'err');
            }
          },
        },
        `赞 ${post.likes}`
      );

      const commentBox = h('div', { class: 'post-comments' });
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
          await api.posts.comment(post.id, { content: v });
          commentInput.value = '';
          await load();
          toast('已评论');
        } catch (err) {
          toast(err.message || '评论失败', 'err');
        }
      });

      const comments = post.comments || [];
      comments.forEach((c) => commentBox.append(commentNode(post, c)));
      commentBox.append(commentForm);

      const actions = h(
        'div',
        { class: 'post-actions' },
        likeBtn,
        h('button', {
          class: 'post-act',
          type: 'button',
          onclick: () => {
            const open = commentBox.classList.toggle('is-open');
            if (open) commentInput.focus();
          },
        }, `评论 ${comments.length}`),
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
                  await api.posts.aiReply(post.id, { dishId: dish.id, content: post.content });
                  await load();
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
          onclick: async () => {
            if (!confirm('确认举报这条内容？')) return;
            try {
              const res = await api.posts.report(post.id);
              toast(res.message || '已收到举报');
            } catch {
              toast('举报失败', 'err');
            }
          },
        }, '举报'),
        currentUser && post.author.id === currentUser.id
          ? h('button', {
              class: 'post-act post-act--danger',
              type: 'button',
              onclick: async () => {
                if (!confirm('删除后无法恢复，确认？')) return;
                try {
                  await api.posts.remove(post.id);
                  await load();
                  toast('已删除');
                } catch (err) {
                  toast(err.message || '删除失败', 'err');
                }
              },
            }, '删除')
          : null
      );

      return h(
        'article',
        { class: 'post' },
        h('header', { class: 'post__head' },
          h('span', { class: 'post__avatar', text: post.author.name.slice(0, 1) }),
          h('div', { class: 'post__who' },
            h('b', { text: post.author.name }),
            h('span', { text: fmtTime(post.createdAt) })
          ),
          post.kind ? h('span', { class: 'post__kind', text: post.kind }) : null,
          post.isSeed ? h('span', { class: 'post__badge', text: '示例内容' }) : null
        ),
        h('p', { class: 'post__text', text: post.content }),
        imagesBlock(post),
        dish
          ? h('div', { class: 'post__dish' },
              h('a', { class: 'post__dish-main', href: `/dishes/${dish.id}`, 'data-link': '' },
                h('img', { src: dish.image, alt: '', loading: 'lazy' }),
                h('span', {}, h('b', { text: dish.name }), h('em', { text: `${CUISINE_BY_ID[dish.cuisine]?.name} · ${TASTE_BY_ID[dish.tastes[0]]?.name}` }))
              ),
              h('a', { class: 'post__dish-chat', href: `/chat/${dish.id}`, 'data-link': '' }, '聊一聊')
            )
          : null,
        actions,
        commentBox
      );
    }

    function render() {
      clear(feed);
      if (!items.length) {
        feed.append(h('div', { class: 'empty-state', text: '还没有帖子，来发第一条。' }));
      }
      items.forEach((p) => feed.append(postCard(p)));
      clear(moreWrap);
      if (items.length < total) {
        moreWrap.append(
          h('button', {
            class: 'btn btn--sm',
            type: 'button',
            onclick: async () => {
              page += 1;
              await load({ append: true });
            },
          }, `加载更多（还有 ${total - items.length} 条）`)
        );
      }
    }

    async function load({ append = false } = {}) {
      if (loading) return;
      loading = true;
      try {
        const res = await api.posts.list({ sort, page });
        total = res.total;
        items = append ? [...items, ...res.items] : res.items;
        render();
      } catch (err) {
        clear(feed);
        feed.append(h('div', { class: 'empty-state', text: `社区加载失败：${err.message}` }));
      } finally {
        loading = false;
      }
    }

    const page_ = h(
      'div',
      { class: 'page community-page' },
      h('div', { class: 'wrap community-wrap' },
        head,
        h('div', { class: 'community-grid' },
          h('div', { class: 'community-main' }, tabs, feed, moreWrap),
          h('aside', { class: 'community-side' },
            composer,
            h('div', { class: 'community-note' },
              h('b', { text: '关于这里' }),
              h('p', { text: '帖子与评论保存在服务端，刷新后仍在。浏览无需登录；发帖、评论与上传图片需要先登录，内容会记在当前账号名下。' }),
              h('p', { text: 'AI 回复需要你手动点「让菜回应」，且会明确标注；未接入 AI 时不会伪造 AI 发言，请先在右上角「接入 AI」配置。' })
            )
          )
        )
      )
    );

    root.append(page_);
    await load();

    return {
      destroy() {
        closeLightbox();
        document.removeEventListener('keydown', onEsc);
      },
    };
  },
};
