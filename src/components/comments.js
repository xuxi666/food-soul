import { h, clear, fmtTime, toast } from '../lib/dom.js';
import { api, guest } from '../lib/api.js';

export function mountComments(root, dishId) {
  const me = guest();
  let page = 1;
  let total = 0;
  let items = [];

  const countEl = h('span', { class: 'comments__count', text: '—' });
  const list = h('div', { class: 'comment-list' });
  const moreWrap = h('div', { class: 'comments__more' });
  const textarea = h('textarea', {
    placeholder: '说说你吃过的版本、遇到的问题，或者想问的细节……',
    maxlength: '300',
    'aria-label': '评论内容',
  });

  const form = h(
    'form',
    { class: 'comment-form' },
    textarea,
    h(
      'div',
      { class: 'comment-form__side' },
      h('span', { class: 'comment-form__who', text: `以访客「${me.name}」发言` }),
      h('button', { class: 'btn btn--sm btn--solid', type: 'submit' }, '发布')
    )
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = textarea.value.trim();
    if (content.length < 2) {
      toast('至少写两个字吧', 'err');
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await api.comments.add({ dishId, content });
      textarea.value = '';
      page = 1;
      await load();
      toast('已发布');
    } catch (err) {
      toast(err.message || '发布失败', 'err');
    } finally {
      btn.disabled = false;
    }
  });

  function commentNode(c, { isReply = false } = {}) {
    const isMine = c.author.id === me.id;
    const likeBtn = h(
      'button',
      {
        class: `like${c.likedBy?.includes(me.id) ? ' is-on' : ''}`,
        type: 'button',
        onclick: async () => {
          try {
            const res = await api.comments.like(c.id);
            c.likes = res.likes;
            c.likedBy = res.liked ? [...(c.likedBy || []), me.id] : (c.likedBy || []).filter((x) => x !== me.id);
            likeBtn.textContent = `赞 ${c.likes}`;
            likeBtn.classList.toggle('is-on', res.liked);
          } catch {
            toast('操作失败', 'err');
          }
        },
      },
      `赞 ${c.likes}`
    );

    const replyBox = h('div', { class: 'comment__reply-form', style: 'display:none' });
    const replyInput = h('input', { type: 'text', placeholder: '回复…', maxlength: '200', 'aria-label': '回复内容' });
    const replySend = h('button', { class: 'btn btn--sm', type: 'button' }, '发送');
    replyBox.append(replyInput, replySend);

    const actions = h(
      'div',
      { class: 'comment__actions' },
      likeBtn,
      !isReply
        ? h('button', {
            type: 'button',
            onclick: () => {
              replyBox.style.display = replyBox.style.display === 'none' ? 'flex' : 'none';
              if (replyBox.style.display === 'flex') replyInput.focus();
            },
          }, '回复')
        : null,
      !isReply && !c.isAI
        ? h('button', {
            type: 'button',
            title: '由你主动触发，让这道菜以它的味型人格回应',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = '思考中…';
              try {
                await api.comments.aiReply(c.id, { dishId, content: c.content, parentId: c.id });
                await load();
                toast('这道菜回应了');
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
        type: 'button',
        onclick: async () => {
          if (!confirm('确认举报这条评论？')) return;
          try {
            const res = await api.comments.report(c.id);
            toast(res.message || '已收到举报');
          } catch {
            toast('举报失败', 'err');
          }
        },
      }, '举报'),
      isMine
        ? h('button', {
            type: 'button',
            onclick: async () => {
              if (!confirm('删除后无法恢复，确认删除？')) return;
              try {
                await api.comments.remove(c.id);
                await load();
                toast('已删除');
              } catch (err) {
                toast(err.message || '删除失败', 'err');
              }
            },
          }, '删除')
        : null
    );

    replySend.addEventListener('click', async () => {
      const v = replyInput.value.trim();
      if (v.length < 1) return;
      replySend.disabled = true;
      try {
        await api.comments.add({ dishId, parentId: c.id, content: v });
        replyInput.value = '';
        await load();
        toast('已回复');
      } catch (err) {
        toast(err.message || '回复失败', 'err');
      } finally {
        replySend.disabled = false;
      }
    });

    return h(
      'article',
      { class: 'comment', 'data-id': c.id },
      h(
        'div',
        { class: 'comment__head' },
        h('span', { class: 'comment__author', text: c.author.name }),
        c.isAI
          ? h('span', { class: 'comment__badge', text: 'AI 回复 · 用户触发' })
          : h('span', { class: 'comment__badge comment__badge--guest', text: '访客' }),
        h('span', { text: fmtTime(c.createdAt) })
      ),
      h('p', { class: 'comment__text', text: c.content }),
      actions,
      replyBox
    );
  }

  function render() {
    clear(list);
    if (!items.length) {
      list.append(h('p', { class: 'note-line', text: '还没有评论。说说你的版本？' }));
      moreWrap.replaceChildren();
      return;
    }
    items.forEach((c) => {
      const node = commentNode(c);
      if (c.replies?.length) {
        const replies = h('div', { class: 'comment__replies' });
        c.replies.forEach((r) => replies.append(commentNode(r, { isReply: true })));
        node.append(replies);
      }
      list.append(node);
    });

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
        }, `加载更多（${total - items.length}）`)
      );
    }
  }

  async function load({ append = false } = {}) {
    try {
      const res = await api.comments.list(dishId, page);
      total = res.total;
      items = append ? [...items, ...res.items] : res.items;
      countEl.textContent = `${total} 条`;
      render();
    } catch {
      countEl.textContent = '—';
      clear(list);
      list.append(h('p', { class: 'note-line', text: '评论服务暂时不可用。' }));
    }
  }

  const section = h(
    'section',
    { class: 'comments', id: 'comments' },
    h('div', { class: 'comments__head' },
      h('h2', { text: '食客评论' }),
      countEl,
      h('span', { class: 'comments__count', text: '· 访客身份，仅存本机' })
    ),
    form,
    list,
    moreWrap,
    h('p', { class: 'note-line', text: '评论保存在服务端 data/comments.json，刷新后仍在。AI 回复需要你手动触发，并会明确标注。' })
  );

  root.append(section);
  load();

  return { destroy() {} };
}
