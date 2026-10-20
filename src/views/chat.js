import { h, toast } from '../lib/dom.js';
import { api, chatStream } from '../lib/api.js';
import { DISH_BY_ID } from '../data/dishes.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../data/cuisines.js';
import { PERSONALITY_BY_ID } from '../data/personalities.js';
import { categoryMeta, personaForCategory, dishesForCategory } from '../data/categories.js';
import { applyTheme } from '../data/visualThemes.js';import { mountComments } from '../components/comments.js';
import { guardImage } from '../lib/placeholder.js';
import { copyText } from '../lib/clipboard.js';
import notFound from './notfound.js';

const QUICK_DISH = ['你是什么味道？', '你的口感是什么？', '教我在家做你。', '你和哪些菜最搭？', '给我推荐相似口味的美食。'];

function quickForCategory(category) {
  const { kind, meta, dishes } = category;
  const lead = dishes[0];
  if (kind === 'taste') {
    return [
      `${meta.name}的层次怎么理解？`,
      `${meta.name}适合哪些食材？`,
      '为什么这类味道让人上瘾？',
      lead ? `推荐一道${meta.name}的入门菜` : '推荐一道入门菜',
    ];
  }
  return [
    `${meta.name}的特点是什么？`,
    lead ? `${lead.name}和${meta.name}其他菜有什么共通点？` : `${meta.name}有哪些代表菜？`,
    `${meta.name}为什么讲究这种味型？`,
    `想学一道简单的${meta.name}，有推荐吗？`,
  ];
}

export default {
  async mount(root, params = []) {
    const search = new URLSearchParams(location.search);
    const isCategory = params.length === 2 && (params[0] === 'cuisine' || params[0] === 'taste');

    /** 菜品对象：dish 模式＝聊天主体；category 模式＝当前话题菜（可选） */
    let dish = null;
    /** 分类对象：{ kind, id, meta, persona, dishes } */
    let category = null;
    let comments = null;

    if (isCategory) {
      const [kind, id] = params;
      const meta = categoryMeta(kind, id);
      if (!meta) return notFound.mount(root);
      category = { kind, id, meta, persona: personaForCategory(kind, id), dishes: dishesForCategory(kind, id) };

      const ctxId = search.get('dish');
      if (ctxId) {
        dish = DISH_BY_ID[ctxId] || null;
        if (!dish) {
          try {
            dish = (await api.dish(ctxId))?.dish || null;
          } catch {
            dish = null;
          }
        }
      }
      if (!dish) dish = category.dishes[0] || null;
    } else {
      const dishId = params[0];
      dish = DISH_BY_ID[dishId] || null;
      if (!dish && dishId) {
        try {
          dish = (await api.dish(dishId))?.dish || null;
        } catch {
          dish = null;
        }
      }
      if (!dish) return notFound.mount(root);
    }

    const topicDish = dish; // 展示与举例用的菜，不参与人格判定
    const cuisine = topicDish ? CUISINE_BY_ID[topicDish.cuisine] : null;
    const persona = isCategory
      ? category.persona
      : PERSONALITY_BY_ID[dish.personality] || PERSONALITY_BY_ID[dish.tastes?.[0]] || null;
    const targetName = isCategory ? `${category.meta.name} AI` : dish.name;
    const themeId = isCategory ? category.id : dish.tastes?.[0] || dish.cuisine;
    const backHref = isCategory ? (category.kind === 'taste' ? `/tastes/${category.id}` : `/cuisines/${category.id}`) : '/';
    const backLabel = isCategory ? '← 返回分类' : '← 返回';

    /* ---------------- 顶部 ---------------- */
    const head = h(
      'div',
      { class: 'page-head' },
      h('a', { class: 'page-head__back', href: backHref, 'data-link': '' }, backLabel),
      h('div', {},
        h('h1', { class: 'page-head__title', text: targetName }),
        h('p', {
          class: 'page-head__sub',
          text: isCategory
            ? `${category.kind === 'taste' ? '口味人格' : '菜系人格'}${category.meta.en ? ` · ${category.meta.en}` : ''}${
                category.dishes.length ? ` · ${category.dishes.length} 道菜` : ''
              }`
            : `${cuisine?.name || ''} · ${dish.nameEn || ''}`,
        })
      ),
      h('div', { class: 'page-head__spacer' }),
      topicDish
        ? h('a', { class: 'btn btn--sm', href: `/dishes/${topicDish.id}`, 'data-link': '' }, '查看菜品')
        : null,
      h(
        'a',
        {
          class: 'btn btn--sm',
          href: isCategory ? '/' : '/recommend',
          'data-link': '',
        },
        isCategory ? '回到首页' : '换个口味'
      )
    );

    /* ---------------- 侧栏 ---------------- */
    const media = topicDish
      ? guardImage(h('img', { src: topicDish.image, alt: topicDish.alt || topicDish.name }), topicDish.name, '图片暂不可用')
      : h('div', { class: 'chat-aside__fallback', text: category?.meta.name.slice(0, 1) || '食' });

    const tags = isCategory
      ? category.kind === 'cuisine'
        ? [
            h('span', { class: 'chip chip--gold', text: category.meta.region || '中国' }),
            h('span', { class: 'chip', text: `${category.dishes.length} 道代表菜` }),
          ]
        : [
            h('span', { class: 'chip chip--gold', text: category.meta.name }),
            h('span', {
              class: 'chip',
              text: `${[...new Set(category.dishes.map((d) => d.cuisine))].length} 个菜系共享`,
            }),
          ]
      : [
          ...dish.tastes.map((t) =>
            h('span', { class: 'chip chip--gold' }, h('i', { class: 'tag-dot' }), TASTE_BY_ID[t]?.name || t)
          ),
          h('span', { class: 'chip', text: `约 ${dish.prep + dish.cook} 分钟` }),
        ];

    const asideActions = isCategory
      ? [
          h(
            'a',
            {
              class: 'btn btn--sm btn--gold',
              href: category.kind === 'taste' ? `/tastes/${category.id}` : `/cuisines/${category.id}`,
              'data-link': '',
            },
            `进入${category.kind === 'taste' ? '口味' : '菜系'}页`
          ),
          topicDish
            ? h('a', { class: 'btn btn--sm', href: `/dishes/${topicDish.id}`, 'data-link': '' }, `看「${topicDish.name}」`)
            : null,
          h('a', { class: 'btn btn--sm', href: '/dishes', 'data-link': '' }, '逛美食图鉴'),
        ]
      : [
          h('a', { class: 'btn btn--sm btn--gold', href: `/recipe?dish=${dish.id}`, 'data-link': '' }, '生成结构化菜谱'),
          h('a', { class: 'btn btn--sm', href: `/videos?q=${encodeURIComponent(dish.name)}`, 'data-link': '' }, '做菜视频'),
          h('a', { class: 'btn btn--sm', href: '#comments' }, '看食客评论'),
        ];

    const aside = h(
      'aside',
      { class: 'chat-aside' },
      h(
        'div',
        { class: 'chat-aside__media' },
        media,
        h(
          'div',
          { class: 'chat-aside__name' },
          h('h1', { text: isCategory ? category.meta.name : dish.name }),
          h('p', {
            text: isCategory
              ? `${category.kind === 'taste' ? '口味 AI' : '菜系 AI'}${topicDish ? ` · 代表菜 ${topicDish.name}` : ''}`
              : `${cuisine?.name || ''} · ${dish.nameEn || ''}`,
          })
        )
      ),
      h('div', { class: 'chat-aside__tags' }, ...tags),
      h(
        'div',
        { class: 'chat-aside__persona' },
        h('b', { text: persona ? `人格：${persona.name}` : '人格：默认' }),
        h('p', {
          text: persona
            ? `${persona.archetype}。${persona.language}`
            : '由味型驱动的默认人格。',
        }),
        isCategory
          ? h('p', {
              class: 'chat-aside__note',
              text: `说话人＝${category.meta.name}${category.kind === 'taste' ? '口味 AI' : ' AI'}${
                topicDish ? `；${topicDish.name} 只作当前话题` : ''
              }。`,
            })
          : null
      ),
      h('div', { class: 'chat-aside__actions' }, ...asideActions)
    );

    /* ---------------- 聊天主体 ---------------- */
    const messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
    const modeBadge = h('span', { class: 'chat-bar__mode', text: '连接中' });
    const bar = h(
      'div',
      { class: 'chat-bar' },
      h('i', { class: 'chat-bar__dot' }),
      h('span', { text: `${targetName} · 在线` }),
      modeBadge
    );

    const input = h('textarea', {
      rows: '1',
      placeholder: isCategory
        ? `问 ${category.meta.name} AI：味型、代表菜、食材搭配……`
        : `问 ${dish.name} 任何事：味道、火候、搭配……`,
      'aria-label': '输入消息',
    });
    const sendBtn = h('button', { class: 'composer__send', type: 'submit', text: '发送' });
    const stopBtn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', style: 'display:none' }, '停止生成');

    const composer = h('form', { class: 'composer' }, input, stopBtn, sendBtn);

    const aiNoticeText = h('span', {
      text: '当前未接入 AI 大模型，请点击右上角「接入 AI」配置后再开始对话。',
    });
    const aiNotice = h('div', { class: 'chat-ai-notice', hidden: true }, aiNoticeText);

    function showAINotice(text) {
      if (text) aiNoticeText.textContent = text;
      aiNotice.hidden = !text;
    }
    const chatMain = h(
      'section',
      { class: 'chat-main' },
      bar,
      aiNotice,
      messagesEl,
      composer,
      h('p', { class: 'composer__hint', text: 'Enter 发送 · Shift + Enter 换行 · 内容由 AI 生成，请自行判断' })
    );

    const footer = h('div', { class: 'wrap comments-slot' });
    const page = h(
      'div',
      { class: 'page chat-page theme-chat' },
      // 分类（口味/菜系）AI 聊天页不再挂载「这个味型/菜系下的菜」模块；footer 仅用于菜品聊天的评论区
      h('div', { class: 'wrap' }, head, h('div', { class: 'chat-layout' }, aside, chatMain), isCategory ? null : footer)
    );
    applyTheme(page, themeId);
    root.append(page);

    if (!isCategory) {
      comments = mountComments(footer, dish.id);
    }

    /* ---------------- 状态 ---------------- */
    const state = {
      messages: [],
      streaming: false,
      stream: null,
      lastAssistantEl: null,
      greeting: '',
      suggestAborts: new Set(),
      shownSuggestions: new Set(),
      aiConfigured: null,
    };

    function setMode(meta) {
      if (!meta) return;
      const fromSite = meta.aiSource === 'site';
      state.aiConfigured = meta.aiConfigured !== false;
      if (state.aiConfigured) {
        modeBadge.textContent = fromSite
          ? `内置 AI · ${meta.model || '模型'}`
          : meta.model || '已接入';
        modeBadge.title = fromSite
          ? `全站内置模型：${meta.model || ''}`
          : `已接入：${meta.model || '模型'}`;
        modeBadge.classList.remove('is-demo');
        showAINotice('');
        input.disabled = false;
        sendBtn.disabled = false;
        input.placeholder = isCategory
          ? `问 ${category.meta.name} AI：味型、代表菜、食材搭配……`
          : `问 ${dish.name} 任何事：味道、火候、搭配……`;
      } else {
        modeBadge.textContent = '未接入 AI';
        modeBadge.title = '请先在右上角「接入 AI」配置你自己的模型';
        modeBadge.classList.add('is-demo');
        showAINotice(meta.aiMessage || '当前未接入 AI 大模型，请点击右上角「接入 AI」配置后再开始对话。');
        input.disabled = true;
        sendBtn.disabled = true;
        input.placeholder = '请先在右上角「接入 AI」配置模型';
      }
    }

    function scrollToEnd() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function aiName() {
      return isCategory
        ? `${category.meta.name} AI${persona ? ` · ${persona.name}` : ''}`
        : `${dish.name}${persona ? ` · ${persona.name}` : ''}`;
    }

    function addMessage(role, text, { streaming = false } = {}) {
      const isAI = role === 'assistant';
      const textEl = h('div', { class: 'msg__text' });
      if (text) textEl.textContent = text;
      if (streaming) textEl.append(h('span', { class: 'cursor' }));

      const actions = h('div', { class: 'msg__actions' });
      if (!streaming && text) {
        actions.append(
          h('button', {
            type: 'button',
            onclick: async () => {
              const ok = await copyText(text);
              toast(ok ? '已复制' : '复制失败', ok ? undefined : 'err');
            },
          }, '复制')
        );
        if (isAI) {
          actions.append(h('button', { type: 'button', onclick: () => regenerate() }, '重新生成'));
        }
      }

      const suggestBox = h('div', { class: 'msg__suggest', hidden: true });

      const node = h(
        'div',
        { class: `msg msg--${isAI ? 'ai' : 'user'}` },
        h('div', { class: 'msg__avatar', text: isAI ? (isCategory ? category.meta.name.slice(0, 1) : dish.name.slice(0, 1)) : '我' }),
        h(
          'div',
          { class: 'msg__body' },
          h('div', { class: 'msg__name', text: isAI ? aiName() : '你' }),
          textEl,
          actions,
          suggestBox
        )
      );
      messagesEl.append(node);
      scrollToEnd();
      return { node, textEl, actions, suggestBox };
    }

    function finishStream(node, text) {
      node.textEl.querySelector('.cursor')?.remove();
      node.textEl.textContent = text;
      node.actions.replaceChildren(
        h('button', {
          type: 'button',
          onclick: async () => {
            const ok = await copyText(text);
            toast(ok ? '已复制' : '复制失败', ok ? undefined : 'err');
          },
        }, '复制'),
        h('button', { type: 'button', onclick: () => regenerate() }, '重新生成')
      );
      node.actions.classList.add('is-visible');
    }

    /* ---------------- 对话延伸建议 ---------------- */

    function suggestionHref(s) {
      const p = s.actionPayload || {};
      if (s.actionType === 'recipe') return `/recipe?dish=${encodeURIComponent(p.dishName || '')}`;
      if (s.actionType === 'recommend') return `/recommend?taste=${encodeURIComponent(p.taste || '')}`;
      if (s.actionType === 'video') return `/videos?q=${encodeURIComponent(p.query || '')}`;
      return '';
    }

    function markSuggestionUsed(box, chip) {
      box.querySelectorAll('.suggest-chip').forEach((el) => {
        el.classList.add('is-used');
        if (el.tagName === 'BUTTON') el.disabled = true;
      });
      chip?.classList.add('is-picked');
    }

    function suggestionChip(s, box) {
      if (s.actionType === 'chat') {
        const btn = h(
          'button',
          { class: 'suggest-chip', type: 'button', title: '继续这段对话' },
          h('span', { class: 'suggest-chip__text', text: s.text }),
          h('span', { class: 'suggest-chip__arrow', text: '→', 'aria-hidden': 'true' })
        );
        btn.addEventListener('click', () => {
          if (btn.disabled || state.streaming) return;
          markSuggestionUsed(box, btn);
          send(s.text);
        });
        return btn;
      }

      const href = suggestionHref(s);
      if (!href) return null;
      const label = { recipe: '菜谱', recommend: '推荐', video: '视频' }[s.actionType] || '新窗口';
      const link = h(
        'a',
        {
          class: 'suggest-chip suggest-chip--link',
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: `新窗口打开：${label}`,
        },
        h('span', { class: 'suggest-chip__text', text: s.text }),
        h('span', { class: 'suggest-chip__arrow', text: '↗', 'aria-hidden': 'true' })
      );
      link.addEventListener('click', () => markSuggestionUsed(box, link));
      return link;
    }

    async function loadSuggestions({ node, lastUser, assistantText }) {
      if (!node?.node?.isConnected) return;
      if (String(assistantText || '').trim().length < 12) return;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      state.suggestAborts.add(ctrl);
      node.suggestBox.hidden = false;
      node.suggestBox.replaceChildren(
        h('span', { class: 'msg__suggest-label', text: '接着聊' }),
        h('span', { class: 'suggest-loading', text: '正在想接下来聊什么…' })
      );

      try {
        const ctx = isCategory
          ? {
              mode: 'category',
              kind: category.kind,
              categoryId: category.id,
              contextDishId: topicDish?.id,
            }
          : { mode: 'dish', dishId: dish.id };

        const res = await api.suggest(
          {
            ...ctx,
            messages: state.messages.slice(-6),
            lastUser,
            lastAssistant: assistantText,
            exclude: [...state.shownSuggestions].slice(-20),
          },
          ctrl.signal
        );

        // 消息已卸载 / 已重新生成：丢弃旧结果，避免建议错位
        if (!node.node.isConnected) return;

        const list = Array.isArray(res.suggestions) ? res.suggestions.slice(0, 3) : [];
        const chips = list.map((s) => suggestionChip(s, node.suggestBox)).filter(Boolean);
        if (!chips.length) {
          node.suggestBox.hidden = true;
          node.suggestBox.replaceChildren();
          return;
        }

        const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
        node.suggestBox.replaceChildren(
          h('span', { class: 'msg__suggest-label', text: '接着聊' }),
          ...chips
        );
        list.forEach((s) => state.shownSuggestions.add(s.text));
        if (nearBottom) scrollToEnd();
      } catch (err) {
        // 建议失败/超时不影响主回答，收起加载占位
        if (node.node.isConnected) {
          node.suggestBox.hidden = true;
          node.suggestBox.replaceChildren();
        }
        if (err?.name === 'AbortError') return;
      } finally {
        clearTimeout(timer);
        state.suggestAborts.delete(ctrl);
      }
    }

    async function request({ history }) {
      if (state.streaming) return;
      if (state.aiConfigured === false) {
        toast('请先在右上角「接入 AI」配置模型');
        return;
      }
      state.streaming = true;
      sendBtn.disabled = true;
      stopBtn.style.display = 'inline-flex';

      const node = addMessage('assistant', '', { streaming: true });
      let buffer = '';
      let failed = false;

      const payload = isCategory
        ? {
            mode: category.kind,
            categoryId: category.id,
            categoryName: category.meta.name,
            contextDishId: topicDish?.id || undefined,
            messages: history,
          }
        : { dishId: dish.id, messages: history };

      state.stream = chatStream(payload, {
        onMeta: setMode,
        onDelta: (t) => {
          buffer += t;
          node.textEl.textContent = buffer;
          node.textEl.append(h('span', { class: 'cursor' }));
          scrollToEnd();
        },
        onDone: () => {},
        onAbort: () => {
          failed = true;
          finishStream(node, buffer || '（已停止生成）');
          if (buffer) state.messages.push({ role: 'assistant', content: buffer });
        },
        onError: (err) => {
          failed = true;
          if (err?.code === 'ai_not_configured' || err?.code === 'site_ai_error' || err?.code === 'ai_config_error') {
            state.aiConfigured = false;
            setMode({ aiConfigured: false, aiMessage: err.message });
          }
          node.textEl.textContent = '';
          node.node.classList.add('msg--error');
          node.textEl.append(
            h('span', { style: 'color:#e8a495', text: `生成失败：${err.message}。` }),
            h('button', {
              type: 'button',
              class: 'quick',
              style: 'margin-left:8px;height:26px',
              onclick: () => {
                node.node.remove();
                regenerate();
              },
            }, '重试')
          );
        },
      });

      await state.stream.done;
      state.streaming = false;
      sendBtn.disabled = false;
      stopBtn.style.display = 'none';

      if (!failed && buffer) {
        finishStream(node, buffer);
        state.messages.push({ role: 'assistant', content: buffer });
        const lastUser = [...state.messages].reverse().find((m) => m.role === 'user')?.content || '';
        // 独立调用，不阻塞主回答；失败时静默收起
        void loadSuggestions({ node, lastUser, assistantText: buffer });
      } else if (!failed && !buffer) {
        node.node.remove();
      }
    }

    function send(text) {
      const content = text.trim();
      if (!content || state.streaming) return;
      if (state.aiConfigured === false) {
        toast('请先在右上角「接入 AI」配置模型');
        return;
      }
      state.messages.push({ role: 'user', content });
      addMessage('user', content);
      input.value = '';
      input.style.height = 'auto';
      request({ history: state.messages.slice(-12) });
    }

    function regenerate() {
      if (state.streaming) return;
      while (state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') {
        state.messages.pop();
      }
      const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return;
      const nodes = messagesEl.querySelectorAll('.msg--ai');
      nodes[nodes.length - 1]?.remove();
      request({ history: state.messages.slice(-12) });
    }

    /* ---------------- 事件 ---------------- */
    composer.addEventListener('submit', (e) => {
      e.preventDefault();
      send(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    });

    stopBtn.addEventListener('click', () => {
      state.stream?.abort();
    });

    /* ---------------- 欢迎语 ---------------- */
    const empty = h('div', { class: 'chat-empty' });
    const quickRow = h('div', { class: 'quick-row' });
    const quickList = isCategory ? quickForCategory(category) : QUICK_DISH;
    quickList.forEach((q) => {
      quickRow.append(h('button', { class: 'quick', type: 'button', onclick: () => send(q) }, q));
    });

    try {
      const g = isCategory
        ? await api.greeting({ kind: category.kind, categoryId: category.id, contextDishId: topicDish?.id })
        : await api.greeting(dish.id);
      state.greeting = g.greeting;
      setMode({ aiConfigured: g.aiConfigured, model: g.model, aiSource: g.aiSource, aiMessage: g.aiMessage });
      empty.append(h('p', { class: 'chat-empty__hi', text: g.greeting }), quickRow);
      messagesEl.append(empty);
      state.messages.push({ role: 'assistant', content: g.greeting });
    } catch {
      const fallback = isCategory
        ? `我是${category.meta.name} ${category.kind === 'taste' ? '口味' : '菜系'} AI。想从哪儿聊起？`
        : `我是${dish.name}。想问什么？`;
      empty.append(h('p', { class: 'chat-empty__hi', text: fallback }), quickRow);
      messagesEl.append(empty);
      state.greeting = fallback;
      state.messages.push({ role: 'assistant', content: fallback });
    }

    if (!isCategory && location.hash === '#comments') {
      requestAnimationFrame(() => document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' }));
    }

    return {
      destroy() {
        state.stream?.abort();
        state.suggestAborts.forEach((c) => c.abort());
        state.suggestAborts.clear();
        comments?.destroy?.();
      },
    };
  },
};
