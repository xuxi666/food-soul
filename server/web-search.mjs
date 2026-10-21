/**
 * 联网检索（自建 SearXNG）。
 * ------------------------------------------------------------
 * 只用自建实例，不再依赖任何付费检索 API：
 *   SEARXNG_URL=http://127.0.0.1:8080
 *
 * 实例要求：settings.yml 里 search.formats 含 json、server.limiter 为 false。
 *
 * 稳定性处理（自建实例抓的是公开搜索引擎，数据中心 IP 容易被限流）：
 *   - 空结果会再试一次（搜索引擎冷却几秒后常能返回）
 *   - 429 / 5xx 有限重试
 *   - 结果按 URL 去重、过滤非 http(s) 链接
 *   - 同一 query 结果缓存 10 分钟，失败缓存 20 秒
 *
 * 日志全程脱敏：只输出 provider / endpoint / 阶段 / HTTP 状态 / 结果数 /
 * 命中引擎 / 不可用引擎 / 耗时，不含任何密钥。
 */
import { SEARCH_CONFIG } from './config.mjs';

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const FAIL_CACHE_TTL = 20 * 1000;
const MAX_CACHE = 80;
const MAX_ATTEMPTS = 2;

function providerId() {
  return 'searxng';
}

function searxngBase() {
  const raw = process.env.SEARXNG_URL !== undefined ? process.env.SEARXNG_URL : SEARCH_CONFIG.searxngUrl;
  return String(raw || '').replace(/\/$/, '');
}

function endpointHost() {
  try {
    return new URL(searxngBase()).host;
  } catch {
    return '(invalid)';
  }
}

function logSearch(fields) {
  const parts = [
    `provider=${providerId()}`,
    `endpoint=${endpointHost()}`,
    ...Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : v}`),
  ];
  console.log('[web-search] ' + parts.join(' '));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cleanText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeSource(raw) {
  const url = String(raw?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    title: cleanText(raw?.title, 120) || url,
    site: cleanText(raw?.engine, 40) || hostOf(url),
    url,
    snippet: cleanText(raw?.content, 600),
    publishDate: cleanText(raw?.publishedDate, 24),
    refer: cleanText(raw?.engine, 24),
    host: hostOf(url),
  };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

const KIND_MESSAGE = {
  auth: '自建检索实例拒绝访问（可能开启了 limiter 或反爬）',
  rate_limit: '自建检索实例限流',
  server: '自建检索实例内部错误',
  network: '无法连接自建检索实例',
  timeout: '自建检索实例超时',
  failed: '自建检索实例返回异常',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 单次请求 */
async function requestOnce(q, { count, timeout }) {
  const base = searxngBase();
  const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&language=zh-CN&safesearch=0&categories=general`;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  logSearch({ stage: 'request', q: cleanText(q, 40), count });
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'food-soul/1.0 (+recipe-lookup)' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errorKind =
        res.status === 429 ? 'rate_limit' : res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'server' : 'failed';
      logSearch({ stage: 'response', status: res.status, kind: errorKind, duration: `${Date.now() - started}ms` });
      return {
        ok: false,
        errorKind,
        httpStatus: res.status,
        retryable: errorKind === 'rate_limit' || errorKind === 'server',
        message: `${KIND_MESSAGE[errorKind]}（HTTP ${res.status}）`,
      };
    }

    const data = await res.json().catch(() => null);
    const raw = Array.isArray(data?.results) ? data.results : [];
    const sources = dedupe(raw.map(normalizeSource).filter(Boolean)).slice(0, Math.max(count, 6));
    const unresponsive = Array.isArray(data?.unresponsive_engines) ? data.unresponsive_engines : [];
    logSearch({
      stage: 'response',
      status: res.status,
      results: sources.length,
      engines: [...new Set(raw.map((r) => r.engine).filter(Boolean))].join('/') || '-',
      down: unresponsive.map((d) => d[0]).join('/') || '-',
      duration: `${Date.now() - started}ms`,
    });
    return { ok: true, sources, intent: '' };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const errorKind = aborted ? 'timeout' : 'network';
    logSearch({
      stage: 'transport',
      kind: errorKind,
      cause: err?.cause?.code || err?.code || '-',
      duration: `${Date.now() - started}ms`,
      msg: cleanText(err?.message || err, 80),
    });
    return {
      ok: false,
      errorKind,
      httpStatus: 0,
      retryable: true,
      message: `${KIND_MESSAGE[errorKind]}：${cleanText(err?.message || err, 60)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Bing RSS（官方 RSS 端点，无 Key、无验证码） ---------------- */

const BING_RSS = 'https://cn.bing.com/search';

/** 测试或私有部署可覆盖；显式设为空串表示关闭 Bing 兜底 */
function bingBase() {
  const raw = process.env.BING_RSS_URL !== undefined ? process.env.BING_RSS_URL : BING_RSS;
  return String(raw || '');
}

function decodeXml(v) {
  return String(v || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml) {
  const out = [];
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const title = decodeXml((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = decodeXml((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const desc = decodeXml((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1]);
    const date = decodeXml((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
    if (!/^https?:\/\//i.test(link)) continue;
    out.push({
      title: title || link,
      site: 'bing',
      url: link,
      snippet: desc.slice(0, 600),
      publishDate: date.slice(0, 24),
      refer: 'bing-rss',
      host: hostOf(link),
    });
  }
  return out;
}

/**
 * 用 Bing 的 RSS 输出做第二来源。
 * 官方端点，不需要 Key，机房 IP 也很少触发验证码，用来兜底自建实例被限流的情况。
 */
async function bingRssSearch(q, { timeout }) {
  // Bing 的 RSS 端点对长查询很敏感：「糖三角 做法」会退化成搜「糖」。
  // 只保留菜名部分，命中率明显更高，后续再由 isRelevant 过滤。
  const shortQ = String(q).split(/\s+/)[0] || q;
  const url = `${bingBase()}?q=${encodeURIComponent(shortQ)}&format=rss&setlang=zh-CN&cc=CN`;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeout, 10000));
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; food-soul/1.0)',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      logSearch({ stage: 'bing-rss', status: res.status, duration: `${Date.now() - started}ms` });
      return { ok: false, sources: [] };
    }
    const xml = await res.text();
    const sources = dedupe(parseRss(xml));
    logSearch({ stage: 'bing-rss', status: res.status, results: sources.length, duration: `${Date.now() - started}ms` });
    return { ok: true, sources };
  } catch (err) {
    logSearch({
      stage: 'bing-rss',
      kind: err?.name === 'AbortError' ? 'timeout' : 'network',
      duration: `${Date.now() - started}ms`,
    });
    return { ok: false, sources: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} query
 * @param {{count?:number, timeout?:number}} [opts]
 * @returns {Promise<{status:'ok'|'empty'|'failed'|'timeout'|'unavailable', errorKind:string,
 *   httpStatus:number, retryable:boolean, sources:Array, message:string, cached?:boolean}>}
 */
export async function webSearch(query, opts = {}) {
  const q = cleanText(query, 80);
  if (!q) {
    return { status: 'empty', errorKind: '', httpStatus: 0, retryable: false, sources: [], message: '检索词为空。' };
  }
  const hasSearxng = Boolean(searxngBase());
  if (!hasSearxng && !bingBase()) {
    logSearch({ stage: 'config', kind: 'not_configured' });
    return {
      status: 'unavailable',
      errorKind: 'not_configured',
      httpStatus: 0,
      retryable: false,
      sources: [],
      message: '未配置联网检索：SEARXNG_URL 为空，且 Bing 兜底被关闭。',
    };
  }
  if (!hasSearxng) logSearch({ stage: 'config', kind: 'searxng_not_configured' });

  const count = Math.max(1, Math.min(10, Number(opts.count) || 6));
  const timeout = Math.max(3000, Math.min(30000, Number(opts.timeout) || 15000));
  const cacheKey = `${count}|${q}`;

  const hit = CACHE.get(cacheKey);
  if (hit) {
    const ttl = hit.value.status === 'ok' ? CACHE_TTL : FAIL_CACHE_TTL;
    if (Date.now() - hit.at < ttl) return { ...hit.value, cached: true };
    CACHE.delete(cacheKey);
  }

  // 自建实例与 Bing RSS 并行：任何一个有结果就能用，机房 IP 被限流时不至于整条挂掉
  const runOnce = async () => {
    const [bing, sx] = await Promise.all([
      bingBase() ? bingRssSearch(q, { timeout }) : Promise.resolve({ ok: false, sources: [] }),
      hasSearxng ? requestOnce(q, { count, timeout }) : Promise.resolve(null),
    ]);
    const sources = dedupe([...(sx?.ok ? sx.sources : []), ...bing.sources]).slice(0, Math.max(count, 6));
    return { sources, sx, bing };
  };

  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const r = await runOnce();

    if (r.sources.length) {
      const value = {
        status: 'ok',
        errorKind: '',
        httpStatus: 200,
        retryable: false,
        sources: r.sources,
        message: '',
        intent: r.sx?.intent || '',
      };
      if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(cacheKey, { at: Date.now(), value });
      return value;
    }

    // 两边都空时也重试一次：引擎冷却几秒后常能返回
    const sxFailed = r.sx && !r.sx.ok;
    last = sxFailed
      ? r.sx
      : { errorKind: '', httpStatus: 200, retryable: false, message: '没有检索到相关资料。', empty: true };

    if (attempt === MAX_ATTEMPTS - 1) break;
    if (sxFailed && !r.sx.retryable) break;
    const wait = sxFailed ? 400 : 700;
    logSearch({ stage: 'retry', attempt: attempt + 1, reason: sxFailed ? r.sx.errorKind : 'empty', waitMs: wait });
    await sleep(wait);
  }

  const value = last?.empty
    ? { status: 'empty', errorKind: '', httpStatus: 200, retryable: false, sources: [], message: '没有检索到相关资料。' }
    : {
        status: last?.errorKind === 'timeout' ? 'timeout' : 'failed',
        errorKind: last?.errorKind || 'failed',
        httpStatus: last?.httpStatus || 0,
        retryable: Boolean(last?.retryable),
        sources: [],
        message: last?.message || KIND_MESSAGE.failed,
      };

  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** 并发执行多组检索词，按 URL 去重合并来源 */
export async function webSearchMany(queries, opts = {}) {
  const list = [...new Set((Array.isArray(queries) ? queries : [queries]).map((q) => cleanText(q, 80)).filter(Boolean))];
  if (!list.length) {
    return { status: 'empty', errorKind: '', sources: [], message: '检索词为空。', queries: [] };
  }

  // 先跑第一条：地址没配或实例直接拒绝时，剩下的查询必然同样失败，少打几次
  const first = await webSearch(list[0], opts);
  const fatal = ['auth', 'not_configured'];
  if (first.errorKind && fatal.includes(first.errorKind)) {
    return {
      status: first.status,
      errorKind: first.errorKind,
      httpStatus: first.httpStatus,
      retryable: first.retryable,
      sources: [],
      message: first.message,
      queries: list,
      results: [first.status],
    };
  }

  const rest = list.length > 1 ? await Promise.all(list.slice(1).map((q) => webSearch(q, opts))) : [];
  const results = [first, ...rest];
  const sources = dedupe(results.flatMap((r) => r.sources));

  let status = 'empty';
  if (sources.length) status = 'ok';
  else if (results.some((r) => r.status === 'timeout')) status = 'timeout';
  else if (results.every((r) => r.status === 'failed')) status = 'failed';
  else if (results.every((r) => r.status === 'unavailable')) status = 'unavailable';

  const primary = results.find((r) => r.errorKind) || results[0];

  return {
    status,
    errorKind: status === 'ok' ? '' : primary.errorKind || '',
    httpStatus: primary.httpStatus || 0,
    retryable: Boolean(primary.retryable),
    sources,
    message: status === 'ok' ? '' : primary.message || '没有检索到相关资料。',
    queries: list,
    results: results.map((r) => r.status),
  };
}
