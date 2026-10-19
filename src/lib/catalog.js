import { DISHES } from '../data/dishes.js';
import { h, clear } from './dom.js';
import { api } from './api.js';

/**
 * 菜品分类分页服务（美食图鉴、菜系页、口味页共用）。
 *
 * 规则：
 * - 每个分类（`cuisine:chuan` / `taste:mala` / `all:`）独立保存已展示列表与加载状态；
 * - 默认 10 道，不足 10 道时展示全部；
 * - 「加载更多」先追加已持久化的 AI 补全菜（避免重复检索），不足再联网检索；
 * - 同分类内按 id 与图片 URL 双重去重，绝不重复卡片、不共用图片；
 * - 连续两轮没有新菜才判定「已展示全部」，避免无限检索。
 */

export const CATALOG_INITIAL = 10;
export const CATALOG_STEP = 3;
const EMPTY_ROUNDS = 2;

const states = new Map();

export const catalogKey = (kind, id) => `${kind}:${id || 'all'}`;

export function staticPool(kind, id) {
  if (!id) return DISHES;
  return kind === 'taste'
    ? DISHES.filter((d) => (d.tastes || []).includes(id))
    : DISHES.filter((d) => d.cuisine === id);
}

function createState(kind, id) {
  const pool = staticPool(kind, id);
  const items = pool.slice(0, CATALOG_INITIAL);
  return {
    key: catalogKey(kind, id),
    kind,
    id: id || '',
    pool,
    items,
    backlog: [], // 已持久化、尚未展示的 AI 菜
    aiCount: 0,
    aiDryRounds: 0,
    emptyRounds: 0,
    loading: false,
    hydrated: false,
    hydrating: false,
    error: '',
    notice: '',
    emptyMessage: '',
    done: false,
    usedIds: new Set(items.map((d) => d.id)),
    usedImages: new Set(items.map((d) => d.image)),
  };
}

export function catalogState(kind, id) {
  const key = catalogKey(kind, id);
  if (!states.has(key)) states.set(key, createState(kind, id));
  return states.get(key);
}

export function catalogTotal(st) {
  return st.pool.length + st.aiCount + st.backlog.length;
}

/** 页面上展示的「已展示 / 共」文案数据 */
export function catalogMeta(st) {
  return {
    shown: st.items.length,
    total: catalogTotal(st),
    aiCount: st.aiCount,
    done: st.done,
    loading: st.loading,
    error: st.error,
  };
}

/** 首次进入分类时载入服务端已保存的 AI 菜，作为更省钱的追加来源 */
export async function hydrateCatalog(kind, id) {
  const st = catalogState(kind, id);
  if (st.hydrated || st.hydrating) return st;
  st.hydrating = true;
  try {
    const res = await api.dishes({ kind, id: st.id });
    const list = (res.items || []).filter((d) => d && d.id && d.image);
    const fresh = [];
    for (const d of list) {
      if (st.pool.some((x) => x.id === d.id)) continue;
      if (st.usedIds.has(d.id) || st.usedImages.has(d.image)) continue;
      if (fresh.some((x) => x.id === d.id || x.image === d.image)) continue;
      fresh.push(d);
    }
    st.backlog = fresh;
    st.aiCount = fresh.length;
  } catch {
    st.backlog = [];
  } finally {
    st.hydrated = true;
    st.hydrating = false;
  }
  return st;
}

function acceptIncoming(st, d, batch) {
  if (!d || !d.id || !d.name || !d.image) return false;
  if (st.usedIds.has(d.id) || batch.some((x) => x.id === d.id)) return false;
  if (st.usedImages.has(d.image) || batch.some((x) => x.image === d.image)) return false;
  return true;
}

function takeBacklog(st, limit) {
  const out = [];
  while (st.backlog.length && out.length < limit) {
    const d = st.backlog[0];
    if (st.usedIds.has(d.id) || st.usedImages.has(d.image)) {
      st.backlog.shift();
      continue;
    }
    out.push(st.backlog.shift());
  }
  return out;
}

/**
 * 加载更多：返回 { fresh, added, error, done }。
 * fresh = 本轮新增的 AI 菜；added = 实际追加的全部卡片数据。
 */
export async function loadMoreDishes(kind, id) {
  const st = catalogState(kind, id);
  if (st.loading) return { fresh: [], added: [], error: '', done: st.done, busy: true };
  if (st.done) return { fresh: [], added: [], error: '', done: true };
  if (!st.hydrated) await hydrateCatalog(kind, id);

  st.loading = true;
  st.error = '';
  st.notice = '';
  st.emptyMessage = '';
  let fresh = [];
  let note = '';
  let triedAI = false;
  try {
    const cached = takeBacklog(st, CATALOG_STEP);
    if (!cached.length) {
      triedAI = true;
      const res = await api.dishSearch({
        kind: st.kind,
        id: st.id,
        excludeIds: [...st.usedIds],
        limit: CATALOG_STEP,
      });
      note = res.note || '';
      const batch = [];
      for (const d of res.items || []) {
        if (!acceptIncoming(st, d, batch)) continue;
        batch.push(d);
      }
      fresh = batch;
    } else {
      fresh = cached;
    }

    const remain = st.pool.filter(
      (d) => !st.usedIds.has(d.id) && !st.usedImages.has(d.image) && !fresh.some((f) => f.id === d.id)
    );
    const fill = remain.slice(0, Math.max(0, CATALOG_STEP - fresh.length));
    const added = [...fresh, ...fill];

    if (fresh.length) st.aiCount += fresh.length;
    if (!added.length) {
      st.emptyRounds += 1;
      st.emptyMessage = note || '暂时没有找到更多符合条件的菜品，可稍后再试。';
      if (st.emptyRounds >= EMPTY_ROUNDS) st.done = true;
    } else {
      st.emptyRounds = 0;
      st.emptyMessage = '';
      st.items = [...st.items, ...added];
      added.forEach((d) => {
        st.usedIds.add(d.id);
        if (d.image) st.usedImages.add(d.image);
      });
      if (triedAI && !fresh.length) {
        st.aiDryRounds = (st.aiDryRounds || 0) + 1;
        const filled = added.length - fresh.length;
        const short = String(note || '').slice(0, 90);
        st.notice = short
          ? `本次联网检索：${short}${filled ? `（已用站内剩余 ${filled} 道补齐）` : ''}`
          : `本次联网检索暂时没有找到新的合格菜品${filled ? `，已用站内剩余 ${filled} 道补齐` : ''}。`;
        // 站内已全部展示、且连续两轮 AI 都没带回新菜 → 停止继续检索，避免反复消耗额度
        const remainStatic = st.pool.filter((d) => !st.usedIds.has(d.id)).length;
        if (st.aiDryRounds >= 2 && remainStatic === 0) st.done = true;
      } else {
        st.aiDryRounds = 0;
      }
    }
    return { fresh, added, error: st.error, done: st.done, note };
  } catch (err) {
    st.error = err?.error || err?.message || '联网检索失败，请检查网络后重试。';
    return { fresh: [], added: [], error: st.error, done: st.done };
  } finally {
    st.loading = false;
  }
}

/** 分类页/图鉴共用的「加载更多」按钮与状态提示（样式与文案统一） */
export function catalogMoreBar({ state, onLoad, note }) {
  const bar = h('div', { class: 'catalog-more' });

  /** 点击后立刻进入反馈态：联网检索通常 30–60 秒，不能让按钮看起来没反应 */
  const startLoad = async () => {
    const st = state();
    st.uiLoading = true;
    paint();
    try {
      await onLoad();
    } finally {
      st.uiLoading = false;
      paint();
    }
  };

  const paint = () => {
    const st = state();
    clear(bar);
    if (st.loading || st.uiLoading) {
      const started = performance.now();
      const noteEl = h('p', {
        class: 'catalog-more__note',
        text: '正在联网检索同分类新菜，并校验分类、字段与图片，通常需要 30–60 秒。',
      });
      const tick = window.setInterval(() => {
        if (!noteEl.isConnected) {
          window.clearInterval(tick);
          return;
        }
        const sec = Math.round((performance.now() - started) / 1000);
        noteEl.textContent = `正在联网检索…已 ${sec} 秒（通常需要 30–60 秒，请稍候）`;
      }, 1000);
      bar.append(
        h('button', { class: 'btn btn--solid catalog-more__btn', type: 'button', disabled: true }, 'AI 正在寻找更多美食…'),
        noteEl
      );
      return;
    }
    if (st.error) {
      bar.append(
        h('p', { class: 'catalog-more__error', role: 'alert', text: st.error }),
        h(
          'button',
          {
            class: 'btn catalog-more__btn',
            type: 'button',
            onclick: startLoad,
          },
          '加载失败，请重试'
        )
      );
      return;
    }
    if (st.done) {
      bar.append(h('p', { class: 'catalog-more__note', text: `已展示全部菜品（${st.items.length} 道）。` }));
      return;
    }
    if (st.emptyMessage) {
      bar.append(
        h('p', { class: 'catalog-more__error', role: 'status', text: st.emptyMessage }),
        h(
          'button',
          {
            class: 'btn catalog-more__btn',
            type: 'button',
            onclick: startLoad,
          },
          '再试一次'
        ),
        h('p', {
          class: 'catalog-more__note',
          text: '连续两轮没有新菜时会停止继续检索，避免反复消耗联网额度。',
        })
      );
      return;
    }
    const remainStatic = st.pool.length - st.items.length;
    if (st.notice) bar.append(h('p', { class: 'catalog-more__note', text: st.notice }));
    bar.append(
      h(
        'button',
        {
          class: 'btn btn--solid catalog-more__btn',
          type: 'button',
          onclick: startLoad,
        },
        '加载更多'
      ),
      h('p', {
        class: 'catalog-more__note',
        text: note || '每次追加 3 道：优先复用已保存的 AI 检索菜，没有时再联网检索同分类新菜并校验图片去重。',
      })
    );
    if (remainStatic > 0) {
      bar.append(h('p', { class: 'catalog-more__note', text: `站内剩余未展示：${remainStatic} 道` }));
    }
  };

  paint();
  return { el: bar, paint };
}
