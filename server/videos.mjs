/**
 * 站内做菜视频搜索（服务端）
 * ------------------------------------------------------------
 * - 哔哩哔哩：调用网页版公开搜索接口（先取匿名会话 buvid3，再搜索；命中风控刷新一次会话重试）。
 *   不登录、不破解签名、不绕过验证码；拿不到就如实报错，绝不伪造数据。
 * - 抖音 / 小红书 / 西瓜视频：不抓取，只提供官方搜索页入口（sourceType = 'search-entry'）。
 * - 所有结果经过：HTML 清洗、https + 域名白名单校验、去重、相关度排序、数量截断。
 * - 缓存：关键词级内存缓存 10 分钟；失败短缓存 60 秒。
 */

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BILIBILI_ORIGIN = 'https://www.bilibili.com/';
const BILIBILI_SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/search/type';
const SESSION_TTL_MS = 25 * 60 * 1000;
const SESSION_FAIL_COOLDOWN_MS = 30 * 1000;
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/* ------------------------------ 平台元数据 ------------------------------ */

export const VIDEO_PLATFORMS = {
  bilibili: {
    id: 'bilibili',
    label: '哔哩哔哩',
    short: 'B站',
    searchUrl: (keyword) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
  },
  douyin: {
    id: 'douyin',
    label: '抖音',
    short: '抖音',
    searchUrl: (keyword) => `https://www.douyin.com/search/${encodeURIComponent(keyword)}`,
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    label: '小红书',
    short: '小红书',
    searchUrl: (keyword) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`,
  },
  xigua: {
    id: 'xigua',
    label: '西瓜视频',
    short: '西瓜',
    searchUrl: (keyword) => `https://www.ixigua.com/search/${encodeURIComponent(keyword)}/`,
  },
};

export const VIDEO_PLATFORM_IDS = ['bilibili', 'douyin', 'xiaohongshu', 'xigua'];

/* ------------------------------ 链接校验 ------------------------------ */

const VIDEO_HOSTS = {
  bilibili: ['bilibili.com'],
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com'],
  xigua: ['ixigua.com'],
};

const COVER_HOSTS = [
  'hdslb.com',
  'bilivideo.com',
  'douyinpic.com',
  'bytedance.com',
  'byteimg.com',
  'pstatp.com',
  'xiaohongshu.com',
  'xhscdn.com',
  'ixiguavideo.com',
  'ixigua.com',
];

function hostMatches(hostname, domains) {
  const host = String(hostname || '').toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function normalizeProtocolUrl(raw) {
  const text = String(raw || '').trim();
  return text.startsWith('//') ? `https:${text}` : text;
}

function sanitizeUrl(raw, domains) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(normalizeProtocolUrl(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!hostMatches(url.hostname, domains)) return null;
  url.protocol = 'https:';
  return url.toString();
}

export function sanitizeVideoUrl(raw, platform) {
  return sanitizeUrl(raw, VIDEO_HOSTS[platform] || []);
}

export function sanitizeCoverUrl(raw) {
  return sanitizeUrl(raw, COVER_HOSTS);
}

/* ------------------------------ 清洗工具 ------------------------------ */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#x0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 「3:36」「1:02:03」→ 秒；无法解析返回 0 */
export function parseBilibiliDuration(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const parts = raw.trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
}

/** 秒 → 「3:36」（小于 1 秒返回空串） */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const pad = (value) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/* ------------------------------ B 站检索 ------------------------------ */

const BV_RE = /^BV[0-9A-Za-z]{8,12}$/;

export function normalizeBilibiliItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== 'video') return null;
  const bvid = typeof raw.bvid === 'string' ? raw.bvid.trim() : '';
  if (!BV_RE.test(bvid)) return null;
  const title = stripHtml(raw.title);
  if (!title) return null;
  const url = sanitizeVideoUrl(`https://www.bilibili.com/video/${bvid}`, 'bilibili');
  if (!url) return null;

  const result = { id: `bilibili-${bvid}`, title: title.slice(0, 120), platform: 'bilibili', url, sourceType: 'video' };
  const cover = sanitizeCoverUrl(raw.pic);
  if (cover) result.coverUrl = cover;
  const author = stripHtml(raw.author).slice(0, 40);
  if (author) result.author = author;
  const duration = parseBilibiliDuration(raw.duration);
  if (duration > 0) result.duration = duration;
  const description = stripHtml(raw.description).slice(0, 90);
  if (description && description !== result.title) result.description = description;
  const pubdate = Number(raw.pubdate);
  if (Number.isFinite(pubdate) && pubdate > 0) {
    const date = new Date(pubdate * 1000);
    if (Number.isFinite(date.getTime())) result.publishedAt = date.toISOString();
  }
  return result;
}

/** 相关度 / 教程完整度排序（分数相同保持平台原始顺序） */
export function scoreVideoResult(item, base) {
  const title = item.title;
  let score = 0;
  if (title.includes(base)) score += 4;
  if (/(家常|家庭版|在家)/.test(title)) score += 1;
  if (/(教程|教学|讲解|做法|烹饪|步骤)/.test(title)) score += 1;
  if (/(简单|快手|懒人|新手|入门|零基础)/.test(title)) score += 1;
  if (item.duration) {
    if (item.duration >= 60 && item.duration <= 1200) score += 1;
  }
  return score;
}

let session = null;
let sessionInFlight = null;

async function ensureBilibiliCookie(force = false) {
  const now = Date.now();
  if (!force && session) {
    if ('cookie' in session && now - session.ts < SESSION_TTL_MS) return session.cookie;
    if ('failure' in session && now - session.ts < SESSION_FAIL_COOLDOWN_MS) throw new Error(session.failure);
  }
  if (!force && sessionInFlight) return sessionInFlight;

  const task = (async () => {
    try {
      const response = await fetch(BILIBILI_ORIGIN, {
        headers: { 'User-Agent': WEB_UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const headerShim = response.headers;
      const rawCookies = typeof headerShim.getSetCookie === 'function' ? headerShim.getSetCookie() : [];
      const cookie = rawCookies.map((item) => item.split(';')[0]).join('; ');
      if (!/(?:^|;\s*)buvid3=/.test(cookie)) throw new Error('未获得匿名会话（buvid3）');
      session = { cookie, ts: Date.now() };
      return cookie;
    } catch (error) {
      const message = `无法建立平台匿名会话（${String(error?.message ?? error).slice(0, 60)}）`;
      session = { failure: message, ts: Date.now() };
      throw new Error(message);
    }
  })();

  sessionInFlight = task;
  try {
    return await task;
  } finally {
    if (sessionInFlight === task) sessionInFlight = null;
  }
}

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + ttlMs, value });
}

export function clearVideoSearchCache() {
  cache.clear();
  session = null;
}

function buildBilibiliSearchUrl(keyword) {
  const url = new URL(BILIBILI_SEARCH_ENDPOINT);
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  url.searchParams.set('order', 'totalrank');
  return url.toString();
}

async function fetchBilibiliSearch(keyword) {
  const cacheKey = `bilibili|${keyword}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const finish = (outcome) => {
    cacheSet(cacheKey, outcome, outcome.status === 'error' ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS);
    return outcome;
  };

  const attempt = async (cookie) => {
    const response = await fetch(buildBilibiliSearchUrl(keyword), {
      headers: {
        'User-Agent': WEB_UA,
        Referer: BILIBILI_ORIGIN,
        Accept: 'application/json',
        Cookie: cookie,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('返回内容不是 JSON（可能被网关拦截）');
    }
  };

  try {
    let cookie = await ensureBilibiliCookie();
    let json = await attempt(cookie);
    if (json?.code === -412 || json?.code === -799) {
      cookie = await ensureBilibiliCookie(true);
      json = await attempt(cookie);
    }
    if (json?.code === -412 || json?.code === -799) {
      return finish({ status: 'error', items: [], reason: `平台风控限制（code ${json.code}）` });
    }
    if (json?.code !== 0) {
      return finish({ status: 'error', items: [], reason: `平台返回异常（code ${json?.code}）` });
    }
    const list = Array.isArray(json?.data?.result) ? json.data.result : [];
    const items = list.map(normalizeBilibiliItem).filter(Boolean);
    return finish(items.length ? { status: 'ok', items } : { status: 'empty', items: [] });
  } catch (error) {
    return finish({
      status: 'error',
      items: [],
      reason: `请求失败（${String(error?.message ?? error).slice(0, 60)}）`,
    });
  }
}

/* ------------------------------ 主流程 ------------------------------ */

const ENTRY_ONLY_REASON = '该平台未开放通用视频搜索接口，仅提供官方搜索页入口（不抓取、不绕过风控）';

/** 生成 3 条确定性搜索关键词（不经过模型，避免幻觉） */
export function buildVideoKeywords(base) {
  const clean = String(base || '').trim();
  if (!clean) return [];
  return [...new Set([`${clean} 家常做法`, `${clean} 教程`, `${clean} 详细做法`])].slice(0, 3);
}

export function buildSearchEntries(base, platforms = VIDEO_PLATFORM_IDS) {
  const word = `${String(base || '').trim()} 家常做法`.trim();
  if (!word) return [];
  return platforms.map((platform) => ({
    id: `${platform}-entry`,
    title: `在${VIDEO_PLATFORMS[platform].label}搜索更多`,
    platform,
    url: VIDEO_PLATFORMS[platform].searchUrl(word),
    sourceType: 'search-entry',
  }));
}

/**
 * 执行一次完整的视频检索。
 * @param {{q?: string, limit?: number}} input q 必填（菜名或任意美食关键词）
 * @returns {{status:'done'|'failed', note:string, query:string, keywords:string[], results:object[], entries:object[], providers:object[], took:number, searchedAt:number}}
 */
export async function searchVideos(input = {}) {
  const startedAt = Date.now();
  const q = String(input.q || input.dish || input.query || '').trim().slice(0, 40);
  if (!q) {
    throw Object.assign(new Error('缺少搜索内容（q 必填）'), { status: 400 });
  }
  const limit = Math.min(12, Math.max(1, Math.round(Number(input.limit) || 8)));

  const keywords = buildVideoKeywords(q);
  const outcomes = await Promise.all(keywords.map((keyword) => fetchBilibiliSearch(keyword)));

  const merged = new Map();
  for (const outcome of outcomes) {
    for (const item of outcome.items) if (!merged.has(item.id)) merged.set(item.id, item);
  }
  const results = [...merged.values()]
    .map((item, index) => ({ item, index, score: scoreVideoResult(item, q) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);

  const errored = outcomes.filter((outcome) => outcome.status === 'error');
  const bilibiliStatus = outcomes.some((outcome) => outcome.status === 'ok')
    ? 'ok'
    : errored.length === outcomes.length
      ? 'error'
      : 'empty';
  const reason = [...new Set(errored.map((item) => item.reason).filter(Boolean))].join('；');

  const entries = buildSearchEntries(q);
  const providers = VIDEO_PLATFORM_IDS.map((platform) =>
    platform === 'bilibili'
      ? { platform, status: bilibiliStatus, count: results.length, ...(bilibiliStatus === 'error' ? { reason } : {}) }
      : { platform, status: 'skipped', count: 0, reason: ENTRY_ONLY_REASON }
  );

  let note;
  if (results.length > 0) {
    note = `已在哔哩哔哩实时检索到 ${results.length} 条相关视频。搜索关键词：${keywords.slice(0, 2).join('；')}。`;
  } else if (bilibiliStatus === 'error') {
    note = `暂时无法取得具体视频（${reason || '平台接口暂不可用'}）。可以用下面的平台搜索入口继续找，或稍后重试。`;
  } else {
    note = '这次没有检索到合适的单个视频。换个关键词试试，或直接用下面的平台搜索入口。';
  }

  return {
    status: 'done',
    note,
    query: q,
    keywords,
    results,
    entries,
    providers,
    took: Date.now() - startedAt,
    searchedAt: Date.now(),
  };
}
