import { uuid } from './clipboard.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/* ---------------- 访客身份（演示用，非真实账号体系） ---------------- */
const GUEST_KEY = 'foodsoul.guest.v1';
const NICK_KEY = 'foodsoul.nickname.v1';

export function getNickname() {
  try {
    return String(localStorage.getItem(NICK_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** 自定义昵称：仅存本机浏览器，最长 16 字；清空则回退自动昵称。 */
export function setNickname(name) {
  const v = String(name || '').trim().slice(0, 16);
  try {
    if (v) localStorage.setItem(NICK_KEY, v);
    else localStorage.removeItem(NICK_KEY);
  } catch {
    /* noop */
  }
  return v;
}

export function guest() {
  const nickname = getNickname();
  try {
    const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    if (saved?.id) {
      const name = nickname || saved.name || `食客${Math.floor(1000 + Math.random() * 9000)}`;
      return { id: saved.id, name };
    }
  } catch {
    /* noop */
  }
  const name = nickname || `食客${Math.floor(1000 + Math.random() * 9000)}`;
  const g = { id: uuid(), name };
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(g));
  } catch {
    /* noop */
  }
  return g;
}

function guestHeaders() {
  const g = guest();
  return {
    'x-guest-id': g.id,
    'x-guest-name': encodeURIComponent(g.name),
  };
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.note || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  health: () => jsonFetch('/api/health'),

  /**
   * 欢迎语：传 dishId 字符串＝菜品人格；传对象＝分类 AI
   * { kind: 'cuisine'|'taste', categoryId, contextDishId }
   */
  greeting: (target) => {
    if (typeof target === 'string') {
      return jsonFetch(`/api/greeting?dishId=${encodeURIComponent(target)}`);
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(target || {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    return jsonFetch(`/api/greeting?${params.toString()}`);
  },

  upload: (dataUrl) =>
    jsonFetch('/api/upload', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ image: dataUrl }) }),

  recipeLookup: (payload) =>
    jsonFetch('/api/recipe/lookup', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),

  recipe: (payload) =>
    jsonFetch('/api/recipe', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),

  recommend: (payload) =>
    jsonFetch('/api/recommend', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),

  /** 对话延伸建议：AI 回答完成后单独调用，不阻塞主回答 */
  suggest: (payload, signal) =>
    jsonFetch('/api/suggest', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload), signal }),

  /* ---------------- 账号与用户级 AI 配置 ---------------- */
  auth: {
    me: () => jsonFetch('/api/auth/me'),
    register: (payload) =>
      jsonFetch('/api/auth/register', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    login: (payload) =>
      jsonFetch('/api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    logout: () => jsonFetch('/api/auth/logout', { method: 'POST', headers: JSON_HEADERS }),
  },

  ai: {
    config: () => jsonFetch('/api/ai/config'),
    test: (payload) =>
      jsonFetch('/api/ai/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    save: (payload) =>
      jsonFetch('/api/ai/config', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),
    remove: () => jsonFetch('/api/ai/config', { method: 'DELETE' }),
    models: (payload = {}) =>
      jsonFetch('/api/ai/models', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }),
  },

  /** 菜品详情：站内静态库 + AI 检索补全的菜品 */
  dish: (id) => jsonFetch(`/api/dishes/${encodeURIComponent(id)}`),

  /** 已持久化的 AI 补全菜品（可按分类过滤），用于分类页复用缓存、避免重复检索 */
  dishes: ({ kind = '', id = '' } = {}) => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (id) qs.set('id', id);
    const tail = qs.toString();
    return jsonFetch(`/api/dishes${tail ? `?${tail}` : ''}`);
  },

  /** 图鉴「加载更多」：AI 联网检索同分类新菜（服务端去重、真实图片落盘） */
  dishSearch: (payload) =>
    jsonFetch('/api/dishes/search', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      // 服务端单轮有硬预算（模型 + 检索 + 取图 ≤95s），前端再加一层兜底，避免永久等待
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(110_000) : undefined,
    }),

  posts: {
    list: ({ sort = 'latest', page = 1, dishId = '' } = {}) =>
      jsonFetch(`/api/posts?sort=${sort}&page=${page}${dishId ? `&dishId=${encodeURIComponent(dishId)}` : ''}`),
    add: (payload) =>
      jsonFetch('/api/posts', {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...guestHeaders() },
        body: JSON.stringify(payload),
      }),
    like: (id) => jsonFetch(`/api/posts/${id}/like`, { method: 'POST', headers: guestHeaders() }),
    comment: (id, payload) =>
      jsonFetch(`/api/posts/${id}/comments`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...guestHeaders() },
        body: JSON.stringify(payload),
      }),
    report: (id) => jsonFetch(`/api/posts/${id}/report`, { method: 'POST' }),
    remove: (id) => jsonFetch(`/api/posts/${id}`, { method: 'DELETE', headers: guestHeaders() }),
    aiReply: (id, payload) =>
      jsonFetch(`/api/posts/${id}/ai-reply`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...guestHeaders() },
        body: JSON.stringify(payload),
      }),
  },

  comments: {
    list: (dishId, page = 1) =>
      jsonFetch(`/api/comments?dishId=${encodeURIComponent(dishId)}&page=${page}`),
    add: (payload) =>
      jsonFetch('/api/comments', {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...guestHeaders() },
        body: JSON.stringify(payload),
      }),
    like: (id) =>
      jsonFetch(`/api/comments/${id}/like`, { method: 'POST', headers: guestHeaders() }),
    report: (id) => jsonFetch(`/api/comments/${id}/report`, { method: 'POST' }),
    remove: (id) =>
      jsonFetch(`/api/comments/${id}`, { method: 'DELETE', headers: guestHeaders() }),
    aiReply: (id, payload) =>
      jsonFetch(`/api/comments/${id}/ai-reply`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, ...guestHeaders() },
        body: JSON.stringify(payload),
      }),
  },

  /** 站内做菜视频搜索（真实检索，服务端清洗与校验） */
  videos: (q, limit = 8) =>
    jsonFetch(`/api/videos/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};

/**
 * 把用户照片压到长边 1600px 的 JPEG dataURL，减少上传体积。
 * 失败时抛出可读的中文错误。
 */
export async function compressImage(file, maxSize = 1600, quality = 0.82) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('这张图读不出来（HEIC 等格式请先转成 JPG）');
  }
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 流式聊天。返回 { abort, done }。
 * 菜品人格：{ dishId, messages }
 * 菜系 / 口味 AI：{ mode: 'cuisine'|'taste', categoryId, contextDishId?, messages }
 * 小精灵：{ mode: 'mascot', messages }
 * onMeta / onDelta / onDone / onError 都是可选回调。
 */
export function chatStream(
  { dishId, mode = 'dish', kind, categoryId, categoryName, contextDishId, messages },
  handlers = {}
) {
  const controller = new AbortController();
  const categoryMode = kind || (mode === 'cuisine' || mode === 'taste' ? mode : '');
  const payload = {
    dishId: dishId || undefined,
    mode: categoryMode || mode,
    messages,
  };
  if (categoryMode) payload.categoryId = categoryId;
  if (categoryMode && categoryName) payload.categoryName = categoryName;
  if (categoryMode && contextDishId) payload.contextDishId = contextDishId;

  const done = (async () => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `连接失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (event.type === 'meta') handlers.onMeta?.(event);
          else if (event.type === 'delta') handlers.onDelta?.(event.text || '');
          else if (event.type === 'done') handlers.onDone?.();
          else if (event.type === 'error') handlers.onError?.(new Error(event.message || '生成失败'));
        }
      }
      handlers.onDone?.();
    } catch (err) {
      if (err.name === 'AbortError') handlers.onAbort?.();
      else handlers.onError?.(err);
    }
  })();

  return { abort: () => controller.abort(), done };
}
