/**
 * 双页聊天：聊天室只占「当前内容所在那一页的另一半」
 * ------------------------------------------------------------
 * 菜品详情永远只占画册的一页（图鉴 / 菜系 / 口味里点开的详情浮层、深链接详情页都算）。
 * 菜系 / 口味模块同理：介绍在左页、目录在右页，点「和某某聊聊」时聊天挂进同一跨页的另一张纸。
 *
 *   左页：川菜介绍        右页：川菜代表菜品      ← 打开前
 *   左页：川菜介绍        右页：川菜 AI 聊天      ← 点「和川菜聊聊」后（聊天在介绍的另一半）
 *   左页：川菜介绍        右页：川菜代表菜品      ← 点「收起聊天」后
 *
 * 所以这里不新建路由、不建第二套聊天系统：
 *   · 聊天界面就是 views/chat.js 的同一个 mount，用 inline 模式挂进书页；
 *   · 会话实例按上下文（dish:xxx / cuisine:xxx / flavor:xxx）缓存，收起只是把面板从纸上
 *     摘下来（DOM 留着、流式回复继续），再打开同一上下文时原样挂回去，聊天记录不丢；
 *   · 不同上下文各自一个实例，快速切换不会串消息。
 *
 * 页面归属由 book/index.js 决定（它才知道当前跨页的左右两页是谁），
 * 这里只提供 setChatOpener / openChat 这对转接点。
 */
import { h } from '../lib/dom.js';
import chatView from '../views/chat.js';

/** 切来切去最多留几个会话实例（每个实例 = 一份完整聊天记录） */
const MAX_CACHED = 3;
const CLOSE_MS = 280;

const CONTEXT_LABEL = { dish: '菜品', cuisine: '菜系', flavor: '口味' };

/** chatKey → { subject, holder, slot, instance, ready, side, single } */
const CACHE = new Map();
/** 此刻钉在纸上的那一块：{ key, subject, holder, page, side, single } */
let current = null;
/** book/index.js 注入：把「当前跨页的另一页」找出来并挂上聊天 */
let opener = null;

/**
 * 统一上下文：菜品 / 菜系 / 口味三种。
 * 菜品对象没有 type，按菜品处理；菜系、口味必须显式给 type。
 */
function normalizeSubject(input) {
  if (!input || !input.id) return null;
  const rawType = input.type === 'taste' ? 'flavor' : input.type;
  if (rawType === 'cuisine' || rawType === 'flavor') {
    const type = rawType;
    const params = type === 'flavor' ? ['taste', String(input.id)] : ['cuisine', String(input.id)];
    return {
      type,
      id: String(input.id),
      name: input.name || input.id,
      params,
      key: `${type}:${input.id}`,
      dish: null,
    };
  }
  return {
    type: 'dish',
    id: String(input.id),
    name: input.name || input.id,
    params: [String(input.id)],
    key: `dish:${input.id}`,
    dish: input,
  };
}

export function setDishChatOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

/** 新名字，语义更准；旧名字保留给既有调用方 */
export const setChatOpener = setDishChatOpener;

export const hasOpenDishChat = () => Boolean(current);
export const openDishChatDishId = () => (current?.subject.type === 'dish' ? current.subject.id : null);

/**
 * 聊天入口统一走这里（菜品详情、菜系、口味三处都调它）。
 * 书册没接管（比如后台预览）时返回 false，调用方回落到原来的整页聊天。
 */
export function openChat(subject, origin) {
  const s = normalizeSubject(subject);
  if (!opener || !s) return false;
  return opener(s, origin) === true;
}

export const openDishChat = openChat;

/** 收起按钮 + 版式标记：内嵌的聊天室只保留「右页聊天室」这一栏 */
function decorate(entry, single) {
  const { holder, slot, subject } = entry;
  const cr = slot.querySelector('.cr');
  cr?.classList.add('cr--panel');
  const head = slot.querySelector('.cr-head');
  if (head && !head.querySelector('.dm-chat__close')) {
    const what = CONTEXT_LABEL[subject.type] || '内容';
    const btn = h(
      'button',
      {
        class: 'dm-chat__close',
        type: 'button',
        'aria-label': single ? `收起聊天，返回${what}页` : '收起聊天',
      },
      h('span', { class: 'dm-chat__close-ico', 'aria-hidden': 'true' }, '⟩'),
      h('span', { class: 'dm-chat__close-txt', text: single ? '收起聊天，返回详情' : '收起聊天' })
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDishChat('button');
    });
    head.append(btn);
  }
  holder.classList.remove('is-loading');
}

/**
 * 把某个上下文（菜品 / 菜系 / 口味）的聊天挂到 page 这张纸上。
 * @param {{subject:object, page:HTMLElement, side:'left'|'right'|'full', single?:boolean}} opts
 */
export async function openChatPanel({ subject, page, side = 'right', single = false }) {
  const s = normalizeSubject(subject);
  if (!s || !page) return null;

  // 同一个上下文已经在另一张纸上（翻页 / 换模块）：把这块搬过去，实例不重建
  if (current && current.key === s.key && current.holder.parentNode) {
    current.holder.remove();
  } else if (current && current.key !== s.key) {
    // 换上下文：旧面板先落地收起（实例留在缓存里，回来还能接着说）
    closeDishChat('switch', { instant: true });
  }

  let entry = CACHE.get(s.key);
  if (!entry) {
    const holder = h('div', { class: 'dm-chat is-loading' });
    const slot = h('div', { class: 'dm-chat__slot' });
    holder.append(slot);
    entry = { subject: s, holder, slot, instance: null, ready: null, side, single };
    entry.ready = chatView
      .mount(slot, s.params, { inline: true })
      .then((instance) => {
        entry.instance = instance;
        decorate(entry, entry.single);
        return instance;
      })
      .catch((err) => {
        console.warn('[dm-chat] 聊天挂载失败', err);
        slot.replaceChildren(h('p', { class: 'dm-chat__error', text: '聊天室暂时打不开，请刷新重试' }));
        holder.classList.remove('is-loading');
        return null;
      });
    CACHE.set(s.key, entry);
  }

  entry.side = single ? 'full' : side;
  entry.single = single;
  entry.holder.className = `dm-chat dm-chat--${entry.side} is-loading`;
  if (s.type === 'dish') entry.holder.dataset.dish = s.id;
  else delete entry.holder.dataset.dish;
  entry.holder.dataset.contextType = s.type;
  entry.holder.dataset.contextId = s.id;
  entry.holder.dataset.context = s.key;
  entry.holder.setAttribute('role', 'region');
  entry.holder.setAttribute('aria-label', `${s.name} 的 AI 聊天`);
  /*
   * 聊天面板是 absolute inset:0，铺满「这张纸当前的可视区域」。
   * 如果纸面已经向下滚过（社区右页的帖子列表就是），面板会跟着内容一起偏上去，
   * 只剩半截甚至整块跑到纸外面。所以挂载前先把纸面滚回顶部，
   * 收起时按记下的位置还原 —— 列表的滚动位置照样不丢。
   */
  const scroller = page.classList?.contains('bk-pageface') ? page : page.closest?.('.bk-pageface');
  let prevScroll = 0;
  if (scroller && scroller.scrollTop > 0) {
    prevScroll = scroller.scrollTop;
    scroller.scrollTop = 0;
  }
  page.append(entry.holder);
  current = { key: s.key, subject: s, holder: entry.holder, page, side: entry.side, single, scroller, prevScroll };

  await entry.ready;
  // 挂载可能是在「上一次收起动画」之后才完成的：确保它仍在纸上
  if (entry.holder.parentNode !== page) page.append(entry.holder);
  // 输入框聚焦可能把纸面又滚下去：面板必须始终贴在纸的可视区
  if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
  decorate(entry, single);
  requestAnimationFrame(() => entry.holder.classList.add('is-open'));

  trimCache(s.key);
  return entry;
}

/** 兼容旧调用方（dish-first 签名） */
export const openDishChatPanel = ({ dish, subject, ...rest }) => openChatPanel({ subject: subject || dish, ...rest });

function forget(key) {
  const entry = CACHE.get(key);
  if (!entry) return;
  CACHE.delete(key);
  try {
    entry.instance?.destroy?.();
  } catch {
    /* 忽略 */
  }
  entry.holder.remove();
}

function trimCache(keepKey) {
  while (CACHE.size > MAX_CACHED) {
    const oldest = [...CACHE.keys()].find((key) => key !== keepKey);
    if (!oldest) break;
    forget(oldest);
  }
}

/** 收起：面板从纸上退场，会话实例留着（聊天记录 / 正在流式的回复都还在） */
export function closeDishChat(reason = 'api', { instant = false } = {}) {
  const cur = current;
  if (!cur) return false;
  current = null;
  const holder = cur.holder;
  holder.classList.remove('is-open');
  holder.classList.add('is-closing');
  const done = () => {
    if (holder.parentNode) holder.remove();
    // 收起后把纸面滚回聊天打开前的阅读位置（社区列表的滚动位置）。
    // 必须等浏览器把面板摘掉的布局算完再 restore：同一帧里改 scrollTop
    // 会被滚动锚定按「刚被移除的面板」重新算，结果又贴到底部。
    const scroller = cur.scroller;
    const target = cur.prevScroll;
    if (scroller?.isConnected && target) {
      requestAnimationFrame(() => {
        if (scroller.isConnected) scroller.scrollTop = target;
      });
    }
  };
  if (instant) done();
  else window.setTimeout(done, CLOSE_MS);
  document.dispatchEvent(
    new CustomEvent('foodsoul:dish-chat-close', {
      detail: {
        dishId: cur.subject.type === 'dish' ? cur.subject.id : null,
        contextType: cur.subject.type,
        contextId: cur.subject.id,
        reason,
      },
    })
  );
  return true;
}

/* 菜品详情收起（返回图鉴 / 换菜 / 翻页）→ 菜品聊天跟着收；
 * 菜系 / 口味的聊天不受影响：它们的宿主页是分类页，不是那张详情浮层。 */
document.addEventListener('foodsoul:detail-close', () => {
  if (current?.subject.type === 'dish') closeDishChat('detail');
});

/* 验收 / 诊断用（只读） */
export const dishChatState = () => ({
  open: Boolean(current),
  type: current?.subject.type ?? null,
  id: current?.subject.id ?? null,
  name: current?.subject.name ?? null,
  context: current?.key ?? null,
  dishId: current?.subject.type === 'dish' ? current.subject.id : null,
  side: current?.side ?? null,
  single: current?.single ?? false,
  cached: [...CACHE.keys()],
  hasCloseButton: Boolean(current?.holder.querySelector('.dm-chat__close')),
  inputInPanel: Boolean(current?.holder.querySelector('.composer textarea')),
});