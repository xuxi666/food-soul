import { h, clear } from '../lib/dom.js';
import { chatStream } from '../lib/api.js';
import { currentMascot, MASCOTS } from '../data/mascots.js';

const QUICK = ['今天吃什么？', '八大菜系有哪些？', '想吃点清淡的', '怎么用这个网站？'];

export function mountMascot(root) {
  const mascot = currentMascot();
  let open = false;
  let panelOpen = false;
  let messages = [];
  let stream = null;
  let busy = false;

  const btn = h('button', {
    class: 'mascot__btn',
    type: 'button',
    'aria-label': `美食小精灵（${mascot.name}），点击打开对话`,
    'aria-expanded': 'false',
    html: mascot.svg,
  });

  const bubble = h('div', { class: 'mascot__bubble', role: 'dialog', 'aria-label': '小精灵问候' });

  const bubbleQuick = h('div', { class: 'quick-row' });
  bubble.append(
    h('p', { text: `${mascot.line} 我是食有灵的小精灵，可以帮你找菜、讲菜系，或者陪你聊聊今天想吃什么。` }),
    bubbleQuick,
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
      h('button', { class: 'btn btn--sm btn--gold', type: 'button', onclick: () => openPanel() }, '开始聊天'),
      h('a', { class: 'btn btn--sm', href: '/#board', 'data-link': '', onclick: () => closeBubble() }, '逛菜系'),
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => closeBubble() }, '先逛逛')
    )
  );

  const messagesEl = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: '1', placeholder: '问点吃的…', 'aria-label': '给小精灵发消息' });
  const sendBtn = h('button', { class: 'composer__send', type: 'submit', text: '发送' });
  const panel = h(
    'div',
    { class: 'mascot__panel', role: 'dialog', 'aria-label': '小精灵对话' },
    h('div', { class: 'mascot__panel-head' },
      h('b', { text: `小精灵 · ${mascot.name}` }),
      h('span', { style: 'font-size:9px;letter-spacing:.1em;color:var(--faint)', text: '通用助手' }),
      h('button', { class: 'mascot__close', type: 'button', 'aria-label': '关闭对话', onclick: () => closePanel() }, '×')
    ),
    messagesEl,
    h('form', { class: 'composer' }, input, sendBtn)
  );

  const wrap = h('div', { class: 'mascot' }, bubble, panel, btn);
  panel.style.display = 'none';
  bubble.style.display = 'none';
  root.append(wrap);

  QUICK.forEach((q) => {
    bubbleQuick.append(
      h('button', {
        class: 'quick',
        type: 'button',
        onclick: () => {
          openPanel();
          send(q);
        },
      }, q)
    );
  });

  function setOpen(next) {
    open = next;
    bubble.style.display = next && !panelOpen ? 'block' : 'none';
    bubble.classList.toggle('is-on', next && !panelOpen);
    btn.setAttribute('aria-expanded', String(next));
  }

  function closeBubble() {
    setOpen(false);
  }

  function openPanel() {
    panelOpen = true;
    bubble.style.display = 'none';
    bubble.classList.remove('is-on');
    panel.style.display = 'flex';
    if (!messages.length) {
      addMessage('ai', `你好，我是${mascot.name}小精灵。想找菜、想了解菜系，或者不知道今天吃什么，都可以问我。`);
    }
    input.focus();
  }

  function closePanel() {
    panelOpen = false;
    panel.style.display = 'none';
    setOpen(false);
  }

  function addMessage(role, text) {
    const textEl = h('div', { class: 'msg__text', text });
    const node = h(
      'div',
      { class: `msg msg--${role === 'ai' ? 'ai' : 'user'}` },
      h('div', { class: 'msg__avatar', text: role === 'ai' ? mascot.name.slice(0, 1) : '我' }),
      h('div', { class: 'msg__body' },
        h('div', { class: 'msg__name', text: role === 'ai' ? '小精灵' : '你' }),
        textEl
      )
    );
    messagesEl.append(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return textEl;
  }

  async function send(text) {
    const content = String(text || '').trim();
    if (!content || busy) return;
    busy = true;
    sendBtn.disabled = true;
    addMessage('user', content);
    messages.push({ role: 'user', content });
    const textEl = addMessage('ai', '');
    textEl.append(h('span', { class: 'cursor' }));

    let buffer = '';
    stream = chatStream(
      { mode: 'mascot', messages: messages.slice(-10) },
      {
        onDelta: (t) => {
          buffer += t;
          textEl.textContent = buffer;
          textEl.append(h('span', { class: 'cursor' }));
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
        onError: (err) => {
          textEl.textContent = `抱歉，我这边出了点问题：${err.message}`;
        },
      }
    );
    await stream.done;
    textEl.querySelector('.cursor')?.remove();
    if (buffer) messages.push({ role: 'assistant', content: buffer });
    busy = false;
    sendBtn.disabled = false;
  }

  btn.addEventListener('click', () => {
    if (panelOpen) {
      closePanel();
      return;
    }
    setOpen(!open);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (open || panelOpen)) {
      closePanel();
    }
  });

  // 输入控件获得焦点时收起，避免遮挡移动端输入
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && !wrap.contains(t)) {
      wrap.classList.add('is-quiet');
      if (!panelOpen) setOpen(false);
    }
  });
  document.addEventListener('focusout', () => {
    wrap.classList.remove('is-quiet');
  });

  panel.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    input.style.height = 'auto';
    send(v);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      send(v);
    }
  });

  // 调试用：确保素材库存在
  if (!MASCOTS.length) console.warn('[mascot] 素材缺失');

  return {
    destroy() {
      stream?.abort();
      wrap.remove();
    },
  };
}
