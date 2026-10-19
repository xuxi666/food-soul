import { SEARCH_CONFIG } from './config.mjs';

/**
 * 真实联网检索（智谱 Web Search API）
 * ------------------------------------------------------------
 * 使用 /api/paas/v4/web_search 而不是聊天接口的 web_search 工具：
 * 后者在 glm-4-flash 等模型上不会返回 search_result，容易把模型自身知识伪装成检索结果。
 * 这里返回的每一条都来自搜索接口的 search_result（title/link/media/content），可追溯。
 */

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 80;

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
  const url = String(raw?.link || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const title = cleanText(raw?.title, 120) || url;
  const snippet = cleanText(raw?.content, 600);
  return {
    title,
    site: cleanText(raw?.media, 60) || hostOf(url),
    url,
    snippet,
    publishDate: cleanText(raw?.publish_date, 24),
    refer: cleanText(raw?.refer, 24),
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

/**
 * @param {string} query
 * @param {{count?:number, engine?:'search_std'|'search_pro', timeout?:number}} [opts]
 * @returns {Promise<{status:'ok'|'empty'|'failed'|'timeout'|'unavailable', sources:Array, message:string, cached?:boolean}>}
 */
export async function webSearch(query, opts = {}) {
  const q = cleanText(query, 80);
  if (!SEARCH_CONFIG.apiKey) {
    return { status: 'unavailable', sources: [], message: '未配置联网检索服务（SEARCH_API_KEY），无法联网检索。' };
  }
  if (!q) return { status: 'empty', sources: [], message: '检索词为空。' };

  const engine = opts.engine === 'search_pro' ? 'search_pro' : 'search_std';
  const count = Math.max(1, Math.min(10, Number(opts.count) || 6));
  const timeout = Math.max(3000, Math.min(30000, Number(opts.timeout) || 15000));
  const key = `${engine}|${count}|${q}`;

  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { ...hit.value, cached: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${SEARCH_CONFIG.baseUrl}/web_search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${SEARCH_CONFIG.apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({ search_engine: engine, search_query: q, count }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const value = {
        status: 'failed',
        sources: [],
        message: `检索服务返回 ${res.status}${text ? `：${cleanText(text, 80)}` : ''}`,
      };
      return value;
    }

    const data = await res.json().catch(() => null);
    const raw = Array.isArray(data?.search_result) ? data.search_result : [];
    const sources = dedupe(raw.map(normalizeSource).filter(Boolean));
    const value = {
      status: sources.length ? 'ok' : 'empty',
      sources,
      message: sources.length ? '' : '没有检索到相关资料。',
      intent: cleanText(data?.search_intent, 60),
    };
    if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      status: aborted ? 'timeout' : 'failed',
      sources: [],
      message: aborted
        ? '联网检索超时（15 秒内未返回），请稍后重试。'
        : `联网检索失败：${cleanText(err?.message || err, 80)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 并发执行多组检索词，按 URL 去重合并来源 */
export async function webSearchMany(queries, opts = {}) {
  const list = [...new Set((Array.isArray(queries) ? queries : [queries]).map((q) => cleanText(q, 80)).filter(Boolean))];
  if (!list.length) return { status: 'empty', sources: [], message: '检索词为空。', queries: [] };

  const results = await Promise.all(list.map((q) => webSearch(q, opts)));
  const sources = dedupe(results.flatMap((r) => r.sources));

  let status = 'empty';
  if (sources.length) status = 'ok';
  else if (results.some((r) => r.status === 'timeout')) status = 'timeout';
  else if (results.every((r) => r.status === 'failed')) status = 'failed';
  else if (results.every((r) => r.status === 'unavailable')) status = 'unavailable';

  const message =
    status === 'ok'
      ? ''
      : results.find((r) => r.message)?.message || '没有检索到相关资料。';

  return { status, sources, message, queries: list, results: results.map((r) => r.status) };
}
