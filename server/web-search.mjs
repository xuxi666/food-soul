import crypto from 'node:crypto';

import { SEARCH_CONFIG } from './config.mjs';

/**
 * 真实联网检索（智谱 Web Search API）
 * ------------------------------------------------------------
 * 使用 /api/paas/v4/web_search 而不是聊天接口的 web_search 工具：
 * 后者在 glm-4-flash 等模型上不会返回 search_result，容易把模型自身知识伪装成检索结果。
 * 这里返回的每一条都来自搜索接口的 search_result（title/link/media/content），可追溯。
 *
 * 错误分类（errorKind）：
 *   quota       429 且服务商说余额/资源包不足 → 不可重试，需要充值或换 Key
 *   auth        401/403 或「令牌不匹配」 → 不可重试，需要检查 Key / 接口权限
 *   not_found   404 → 接口地址不对
 *   rate_limit  429 但属于频率限制 → 可有限重试
 *   server      5xx → 可有限重试
 *   network     网络异常 → 可有限重试
 *   timeout     超时 → 可有限重试
 * 说明：服务商可能把「余额不足」也放在 429 里，所以不能只看状态码。
 */

const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
/** 失败结果的短缓存：避免配额/鉴权类错误在几秒内被重复打到服务商 */
const FAIL_CACHE_TTL = 20 * 1000;
const MAX_CACHE = 80;
const MAX_ATTEMPTS = 2;

/**
 * 诊断日志（脱敏）：
 * 只记录服务商、端点主机、HTTP 状态、服务商错误码、阶段、耗时和密钥指纹。
 * 密钥本身永不落日志；指纹是 sha256 前 8 位，用于确认「加载的是哪一把 Key」。
 */
function fingerprint(key) {
  return key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) : 'none';
}

/**
 * 解析本次请求用的检索 Key。
 * 优先 SEARCH_API_KEY；没配时复用「内置 AI」当前启用的智谱配置，
 * 这样一个智谱账号只需要维护一把 Key。非智谱的内置配置不会拿来检索。
 */
let resolveKeyPromise = null;
async function resolveKey() {
  if (SEARCH_CONFIG.apiKey) return { apiKey: SEARCH_CONFIG.apiKey, source: 'env' };
  if (!resolveKeyPromise) {
    resolveKeyPromise = import('./site-ai.mjs')
      .then((m) => m.getActiveZhipuKey())
      .catch(() => null)
      .finally(() => {
        // 允许配置变化后重新解析（不长期缓存）
        setTimeout(() => {
          resolveKeyPromise = null;
        }, 3000);
      });
  }
  const fromSite = await resolveKeyPromise;
  if (fromSite?.apiKey) return { apiKey: fromSite.apiKey, source: 'site-profile' };
  return { apiKey: '', source: 'none' };
}

function endpointHost() {
  try {
    return new URL(SEARCH_CONFIG.baseUrl).host;
  } catch {
    return '(invalid)';
  }
}

function logSearch(fields) {
  const { keyFp = 'none', ...rest } = fields;
  const parts = [`provider=zhipu`, `endpoint=${endpointHost()}`, `keyFp=${keyFp}`, ...Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : v}`)];
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

/* ---------------- 错误解析与分类 ---------------- */

const QUOTA_RE = /余额|资源包|充值|欠费|配额|额度|quota|balance|insufficient|arrears/i;
// 只匹配「凭证/权限」类措辞。不能用裸 token —— 智谱会把
// 「令牌不匹配或检索配额已用完」放在同一条里，那类其实要先查 Key 与接口权限。
const AUTH_RE = /令牌不匹配|令牌无效|令牌已过期|令牌错误|身份验证失败|鉴权失败|认证失败|未授权|无权限|没有访问权限|api[\s_-]?key\s*(无效|错误)|invalid\s*(api[\s_-]?)?key|unauthorized|forbidden/i;

/** 服务商明确的业务码优先，避免文案里同时出现「令牌」和「配额」时判错 */
const QUOTA_CODES = new Set(['1113', '1114']);
const AUTH_CODES = new Set(['1000', '1001', '1002', '1003', '1004']);

/**
 * 只从结构化 JSON 里取错误信息。
 * 非 JSON 响应体一律不回传内容 —— 避免把服务商原始报文（可能含凭证片段）带给前端。
 */
function readErrorBody(text) {
  const raw = String(text || '').trim();
  if (!raw || raw[0] !== '{') return { code: '', message: '' };
  try {
    const data = JSON.parse(raw);
    const err = data?.error || data;
    return {
      code: cleanText(err?.code ?? err?.error_code ?? '', 20),
      message: cleanText(err?.message ?? err?.msg ?? '', 120),
    };
  } catch {
    return { code: '', message: '' };
  }
}

function classify(status, body) {
  const code = String(body.code || '');
  const hay = `${body.code} ${body.message}`;

  // 1) 服务商业务码
  if (QUOTA_CODES.has(code)) return 'quota';
  if (AUTH_CODES.has(code)) return 'auth';
  // 2) 文案措辞：先判凭证/权限，再判额度（避免「令牌不匹配或配额已用完」被当成额度问题）
  if (AUTH_RE.test(hay)) return 'auth';
  if (QUOTA_RE.test(hay)) return 'quota';
  // 3) 状态码兜底
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'failed';
}

const RETRYABLE = new Set(['rate_limit', 'server', 'network', 'timeout']);

const KIND_MESSAGE = {
  quota: '联网检索额度不足（余额或资源包已用尽），需要充值或更换检索 Key',
  auth: '联网检索认证失败（Key 无效、已被撤销，或未开通 Web Search 权限）',
  not_found: '检索接口地址不正确（404），请检查 SEARCH_BASE_URL',
  rate_limit: '检索服务请求过于频繁，已被限流',
  server: '检索服务暂时不可用（服务商 5xx）',
  network: '联网检索网络异常',
  failed: '联网检索失败',
};

function describe(errorKind, httpStatus, body) {
  const base = KIND_MESSAGE[errorKind] || KIND_MESSAGE.failed;
  const detail = body.message ? `：${body.message}` : '';
  return `${base}（HTTP ${httpStatus}${body.code ? ` / ${body.code}` : ''}）${detail}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- 单次请求 ---------------- */

async function requestOnce(url, payload, timeout, apiKey, keyFp) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  logSearch({ keyFp, stage: 'request', engine: payload.search_engine, q: cleanText(payload.search_query, 40), count: payload.count });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const raw = Array.isArray(data?.search_result) ? data.search_result : [];
      const sources = dedupe(raw.map(normalizeSource).filter(Boolean));
      logSearch({ keyFp, stage: 'response', status: res.status, results: sources.length, duration: `${Date.now() - started}ms` });
      return {
        ok: true,
        sources,
        intent: cleanText(data?.search_intent, 60),
      };
    }

    const text = await res.text().catch(() => '');
    const body = readErrorBody(text);
    const errorKind = classify(res.status, body);
    const retryAfter = Number(res.headers.get('retry-after'));
    logSearch({
      keyFp,
      stage: 'response',
      status: res.status,
      code: body.code || '-',
      kind: errorKind,
      retryAfter: retryAfter || '-',
      duration: `${Date.now() - started}ms`,
      msg: body.message || '(非 JSON 响应体，未记录内容)',
    });
    return {
      ok: false,
      errorKind,
      httpStatus: res.status,
      code: body.code,
      message: describe(errorKind, res.status, body),
      retryable: RETRYABLE.has(errorKind),
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : 0,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const errorKind = aborted ? 'timeout' : 'network';
    logSearch({
      keyFp,
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
      code: '',
      message: aborted
        ? `联网检索超时（${Math.round(timeout / 1000)} 秒内未返回）`
        : `联网检索失败：${cleanText(err?.message || err, 80)}`,
      retryable: true,
      retryAfterMs: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 对外接口 ---------------- */

/**
 * @param {string} query
 * @param {{count?:number, engine?:'search_std'|'search_pro', timeout?:number}} [opts]
 * @returns {Promise<{status:'ok'|'empty'|'failed'|'timeout'|'unavailable', errorKind:string,
 *   httpStatus:number, retryable:boolean, sources:Array, message:string, cached?:boolean}>}
 */
export async function webSearch(query, opts = {}) {
  const q = cleanText(query, 80);

  const { apiKey, source } = await resolveKey();
  if (!apiKey) {
    logSearch({ stage: 'config', kind: 'not_configured' });
    return {
      status: 'unavailable',
      errorKind: 'not_configured',
      httpStatus: 0,
      retryable: false,
      sources: [],
      message: '未配置联网检索服务（SEARCH_API_KEY），且没有可复用的内置 AI 智谱配置。',
    };
  }
  const keyFp = fingerprint(apiKey);
  if (!q) {
    return { status: 'empty', errorKind: '', httpStatus: 0, retryable: false, sources: [], message: '检索词为空。' };
  }

  const engine = opts.engine === 'search_pro' ? 'search_pro' : 'search_std';
  const count = Math.max(1, Math.min(10, Number(opts.count) || 6));
  const timeout = Math.max(3000, Math.min(30000, Number(opts.timeout) || 15000));
  // 缓存 key 带上凭据来源，避免换 Key 后仍命中旧结果
  const key = `${engine}|${count}|${q}|${keyFp}`;

  const hit = CACHE.get(key);
  if (hit) {
    const ttl = hit.value.status === 'ok' || hit.value.status === 'empty' ? CACHE_TTL : FAIL_CACHE_TTL;
    if (Date.now() - hit.at < ttl) return { ...hit.value, cached: true };
    CACHE.delete(key);
  }

  const url = `${SEARCH_CONFIG.baseUrl}/web_search`;
  if (source !== 'env') logSearch({ keyFp, stage: 'config', source });
  const payload = { search_engine: engine, search_query: q, count };

  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const r = await requestOnce(url, payload, timeout, apiKey, keyFp);

    if (r.ok) {
      const value = {
        status: r.sources.length ? 'ok' : 'empty',
        errorKind: '',
        httpStatus: 200,
        retryable: false,
        sources: r.sources,
        message: r.sources.length ? '' : '没有检索到相关资料。',
        intent: r.intent,
      };
      if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(key, { at: Date.now(), value });
      return value;
    }

    last = r;
    // 配额/鉴权/地址错误重试没有意义，直接返回
    if (!r.retryable || attempt === MAX_ATTEMPTS - 1) break;
    const wait = r.retryAfterMs || 400 * (attempt + 1);
    logSearch({ keyFp, stage: 'retry', attempt: attempt + 1, kind: r.errorKind, waitMs: wait });
    await sleep(wait);
  }

  const value = {
    status: last.errorKind === 'timeout' ? 'timeout' : 'failed',
    errorKind: last.errorKind,
    httpStatus: last.httpStatus,
    retryable: last.retryable,
    sources: [],
    message: last.message,
  };
  // 失败也短缓存，避免同一菜品被连点/多标签页反复打到服务商
  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: Date.now(), value });
  return value;
}

/** 并发执行多组检索词，按 URL 去重合并来源 */
export async function webSearchMany(queries, opts = {}) {
  const list = [...new Set((Array.isArray(queries) ? queries : [queries]).map((q) => cleanText(q, 80)).filter(Boolean))];
  if (!list.length) {
    return { status: 'empty', errorKind: '', sources: [], message: '检索词为空。', queries: [] };
  }

  // 先跑第一条：如果配额/鉴权/地址本身有问题，剩下的查询必然同样失败，
  // 直接返回可以少打两次请求（避免无谓消耗与限流）。
  const first = await webSearch(list[0], opts);
  const fatal = ['quota', 'auth', 'not_found', 'not_configured'];
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

  // 取第一个有 errorKind 的结果作为本次失败的代表
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
