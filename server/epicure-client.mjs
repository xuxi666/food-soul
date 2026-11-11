import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Epicure MCP 客户端（官方 SDK + Streamable HTTP）
 *
 * 为什么自己实现 fetch：
 * 线上服务器到 Cloudflare 的 IPv6 不通，Node 自带 fetch(undici) 会一直等到超时，
 * 而 curl 正常。这里用 node:https + Agent({family:4}) 强制 IPv4，行为稳定。
 *
 * 其余能力：
 * - 单例连接复用，出错自动重连一次
 * - tools/list 缓存（EPICURE_CACHE_TTL_MS）
 * - 调用结果缓存，避免同一食材反复请求
 * - 并发上限 EPICURE_MAX_CONCURRENCY
 * - 工具白名单：不允许前端传任意工具名
 * - 任何异常都不抛出到业务层以外，服务不会因此崩溃
 */

const URL_RAW = process.env.EPICURE_MCP_URL || 'https://epicure-mcp.kaikaku.ai/mcp';
const ENABLED = String(process.env.EPICURE_ENABLED ?? 'true') !== 'false';
const CALL_TIMEOUT = Number(process.env.EPICURE_TIMEOUT_MS) || 10000;
const CACHE_TTL = Number(process.env.EPICURE_CACHE_TTL_MS) || 300000;
const MAX_CONCURRENCY = Math.max(1, Number(process.env.EPICURE_MAX_CONCURRENCY) || 3);

export const ALLOWED_TOOLS = new Set([
  'compare_on_axis',
  'pairing_score',
  'find_pairings',
  'flavour_correlations',
  'cultural_profile',
  'neighbors',
  'morph',
  'list_targets',
  'list_factors',
  'ingredient_on_factor',
  'pareto_navigate',
  'closest_mode',
  'where_on_atlas',
]);

/* ---------------- IPv4 fetch ---------------- */
const agentHttps = new https.Agent({ family: 4, keepAlive: true, keepAliveMsecs: 15000 });
const agentHttp = new http.Agent({ family: 4, keepAlive: true });

function headersToObject(h) {
  if (!h) return {};
  if (typeof h.forEach === 'function' && !Array.isArray(h)) {
    const out = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...h };
}

/**
 * 最近一次 HTTP 传输的原始状态：诊断用。
 * Cloudflare 的 1033 / 5xx 是一张 HTML 错误页，SDK 只会报「解析失败」，
 * 把状态码和页面片段留下来，后台才能说清是「隧道/网关」而不是「模型 Key 错误」。
 */
let lastHttp = { at: 0, status: 0, text: '' };

/** 与标准 fetch 兼容的最小实现，只走 IPv4 */
function ipv4Fetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const u = url instanceof URL ? url : new URL(typeof url === 'string' ? url : url.url || url.href);
    const isHttps = u.protocol !== 'http:';
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: init.method || 'GET',
        headers: headersToObject(init.headers),
        agent: isHttps ? agentHttps : agentHttp,
      },
      (res) => {
        const status = res.statusCode || 200;
        if (status >= 400) {
          // 错误响应体很小，整段读下来当证据（成功响应仍走流式，不改变原行为）
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            if (size < 4096) {
              chunks.push(c);
              size += c.length;
            }
          });
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            lastHttp = { at: Date.now(), status, text: text.slice(0, 1200) };
            resolve(
              new Response(text, {
                status,
                statusText: res.statusMessage || '',
                headers: res.headers,
              })
            );
          });
          res.on('error', (err) => reject(err));
          return;
        }
        lastHttp = { at: Date.now(), status, text: '' };
        const body = Readable.toWeb(res);
        resolve(
          new Response(body, {
            status,
            statusText: res.statusMessage || '',
            headers: res.headers,
          })
        );
      }
    );
    req.on('error', (err) => reject(err));
    if (init.signal) {
      const onAbort = () => req.destroy(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      if (init.signal.aborted) onAbort();
      else init.signal.addEventListener('abort', onAbort, { once: true });
    }
    const body = init.body;
    if (body && typeof body.getReader === 'function') {
      // Request.body 是 ReadableStream
      const nodeStream = Readable.fromWeb(body);
      nodeStream.on('data', (c) => req.write(c));
      nodeStream.on('end', () => req.end());
      nodeStream.on('error', (e) => req.destroy(e));
      return;
    }
    if (body) {
      req.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body));
    }
    req.end();
  });
}

/* ---------------- 连接管理 ---------------- */
let client = null;
let connecting = null;
let toolsCache = null; // { at, tools }
const resultCache = new Map(); // key -> { at, value }

let active = 0;
const waiters = [];

async function acquire() {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  active += 1;
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

export function isEpicureEnabled() {
  return ENABLED;
}

/** 只读配置摘要（不含任何密钥；用于后台展示「端点来自环境变量还是默认值」） */
export function epicureConfig() {
  return {
    enabled: ENABLED,
    endpoint: URL_RAW,
    endpointSource: process.env.EPICURE_MCP_URL ? 'env' : 'default',
    callTimeoutMs: CALL_TIMEOUT,
    cacheTtlMs: CACHE_TTL,
    maxConcurrency: MAX_CONCURRENCY,
  };
}

async function ensureClient(force = false) {
  if (!ENABLED) throw Object.assign(new Error('epicure-disabled'), { code: 'disabled' });
  if (!force && client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const transport = new StreamableHTTPClientTransport(new URL(URL_RAW), {
      fetch: ipv4Fetch,
      requestInit: { headers: { 'user-agent': 'food-soul/1.0 (+epicure)' } },
    });
    const c = new Client({ name: 'food-soul', version: '1.0.0' }, { capabilities: {} });
    await c.connect(transport);
    client = c;
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function dropClient() {
  try {
    client?.close?.();
  } catch {
    /* 忽略关闭异常 */
  }
  client = null;
}

/* ---------------- 工具清单 ---------------- */
export async function listTools({ force = false } = {}) {
  if (!force && toolsCache && Date.now() - toolsCache.at < CACHE_TTL) return toolsCache.tools;
  const c = await ensureClient();
  const res = await c.listTools();
  const tools = Array.isArray(res?.tools) ? res.tools : [];
  toolsCache = { at: Date.now(), tools };
  return tools;
}

/** 给前端看的工具清单：只保留名称、说明、参数名与必填项，不暴露内部字段 */
export async function toolsPublic() {
  const tools = await listTools();
  return tools.map((t) => {
    const schema = t.inputSchema || {};
    const props = schema.properties || {};
    return {
      name: t.name,
      description: String(t.description || '').slice(0, 300),
      params: Object.keys(props).map((k) => ({
        name: k,
        type: String(props[k]?.type || (props[k]?.anyOf ? 'any' : 'unknown')),
        required: Array.isArray(schema.required) && schema.required.includes(k),
        description: String(props[k]?.description || props[k]?.title || '').slice(0, 160),
      })),
      allowed: ALLOWED_TOOLS.has(t.name),
    };
  });
}

/* ---------------- 调用 ---------------- */
function cacheKey(name, args) {
  return `${name}:${JSON.stringify(args)}`;
}

/**
 * 调用一个工具。永不抛异常。
 * @returns {{ok:boolean, data:any, text:string, error:string|null, ms:number, cached?:boolean}}
 */
export async function callTool(name, args = {}, opts = {}) {
  if (!ENABLED) return { ok: false, error: 'epicure-disabled', ms: 0 };
  if (!ALLOWED_TOOLS.has(name)) return { ok: false, error: 'tool-not-allowed', ms: 0 };

  const key = cacheKey(name, args);
  const hit = resultCache.get(key);
  if (!opts.noCache && hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.value, cached: true };

  const timeout = Math.max(2000, Number(opts.timeout) || CALL_TIMEOUT);
  const started = Date.now();

  await acquire();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const c = await ensureClient(attempt > 0);
        const res = await c.callTool({ name, arguments: args }, undefined, { timeout });
        const parts = Array.isArray(res?.content) ? res.content : [];
        const text = parts
          .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n');
        const value = {
          ok: !res?.isError,
          text,
          data: parseMaybeJson(text),
          error: res?.isError ? text.slice(0, 240) : null,
          ms: Date.now() - started,
        };
        if (value.ok) {
          if (resultCache.size > 400) resultCache.delete(resultCache.keys().next().value);
          resultCache.set(key, { at: Date.now(), value });
        }
        return value;
      } catch (err) {
        const code = err?.code || '';
        const retryable =
          code === 'ECONNRESET' || code === 'EPIPE' || /closed|abort|timeout/i.test(String(err?.message || ''));
        if (attempt === 0 && retryable) {
          dropClient();
          await sleep(150);
          continue;
        }
        return {
          ok: false,
          error: `${code || 'error'}: ${String(err?.message || err).slice(0, 140)}`,
          ms: Date.now() - started,
        };
      }
    }
    return { ok: false, error: 'unreachable', ms: Date.now() - started };
  } finally {
    release();
  }
}

function parseMaybeJson(text) {
  if (!text) return null;
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/* ---------------- 状态 ---------------- */
export async function epicureStatus() {
  if (!ENABLED) return { enabled: false, ok: false, error: 'epicure-disabled' };
  const started = Date.now();
  try {
    const tools = await listTools();
    return {
      enabled: true,
      ok: true,
      url: URL_RAW,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
      ms: Date.now() - started,
      cacheTtlMs: CACHE_TTL,
      timeoutMs: CALL_TIMEOUT,
      maxConcurrency: MAX_CONCURRENCY,
    };
  } catch (err) {
    return {
      enabled: true,
      ok: false,
      url: URL_RAW,
      error: String(err?.code || err?.message || err).slice(0, 160),
      ms: Date.now() - started,
    };
  }
}

/* ---------------- 诊断（后台状态面板用） ---------------- */

/**
 * 把各种失败归到一个可读的类别。
 * 只是分类，不改变任何业务结果；分类依据是原始 code / message / HTTP 状态与页面片段。
 */
export function classifyEpicureError(err, http = lastHttp) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  const all = `${code} ${msg}`;
  const page = `${http?.text || ''}`;
  const status = Number(http?.status || 0);

  if (code === 'disabled') return { category: 'disabled', label: '外部服务已在服务端关闭' };
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(all)) return { category: 'dns', label: '域名解析失败（DNS）' };
  if (/ECONNREFUSED/i.test(all)) return { category: 'refused', label: '端口拒绝连接（服务未监听）' };
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|connect timeout|ABORT_ERR|aborted|诊断超时/i.test(all))
    return { category: 'timeout', label: '连接超时（外部服务无响应）' };
  if (/cloudflare|cf-ray|cf-mitigated|error 10\d\d\tunnel|\btunnel\b|1033|522|523|530/i.test(`${all} ${page}`))
    return { category: 'tunnel', label: 'Cloudflare 隧道/网关异常', status };
  if (status === 401 || status === 403 || /\b401\b|\b403\b|unauthor|forbidden/i.test(all))
    return { category: 'auth', label: '外部服务鉴权失败（401/403）', status };
  if (status === 429) return { category: 'rate-limit', label: '外部服务限流（429）', status };
  if (status >= 500) return { category: 'http-5xx', label: `外部服务返回 HTTP ${status}`, status };
  if (status >= 400) return { category: 'http-4xx', label: `外部服务返回 HTTP ${status}`, status };
  return { category: 'network', label: '网络或协议错误' };
}

function withDeadline(promise, ms, onTimeout) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        /* 超时清理失败不影响诊断结果 */
      }
      reject(Object.assign(new Error(`诊断超时（>${ms}ms）`), { code: 'ETIMEDOUT' }));
    }, Math.max(1000, Number(ms) || 8000));
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * 真实诊断：重置连接 → 重新握手 + tools/list → 再真调一次工具。
 * 与 epicureStatus() 的区别：
 *  - 不吃 toolsCache（否则会把 5 分钟内的旧结果当成「现在还在线」）
 *  - 整个握手阶段有硬超时（epicureStatus 没有，可能一直挂着）
 *  - 区分 DNS / 隧道 / 超时 / 鉴权 / 网关 / 工具错误
 * 永不抛异常。
 */
export async function diagnoseEpicure({ timeoutMs = 8000, toolProbe = true, tool = 'list_targets' } = {}) {
  const started = Date.now();
  const checkedAt = started;
  const base = {
    enabled: ENABLED,
    endpoint: URL_RAW,
    endpointSource: process.env.EPICURE_MCP_URL ? 'env' : 'default',
    timeoutMs,
    checkedAt,
  };
  if (!ENABLED) {
    return {
      ...base,
      ok: false,
      category: 'disabled',
      label: '外部服务已在服务端关闭（EPICURE_ENABLED=false）',
      error: 'epicure-disabled',
      ms: 0,
      checkedAt,
    };
  }

  lastHttp = { at: 0, status: 0, text: '' };
  try {
    dropClient();
    toolsCache = null;
    const tools = await withDeadline(listTools({ force: true }), timeoutMs, dropClient);

    let toolCall = { name: tool, ok: false, error: null, ms: 0 };
    if (toolProbe) {
      const r = await callTool(tool, {}, { noCache: true, timeout: Math.min(10000, Math.max(3000, timeoutMs)) });
      toolCall = { name: tool, ok: Boolean(r.ok), error: r.ok ? null : String(r.error || '').slice(0, 200), ms: r.ms || 0 };
    }
    const ok = toolCall.ok || !toolProbe;
    return {
      ...base,
      ok,
      category: ok ? 'ok' : 'tool-error',
      label: ok ? '外部服务可用' : '握手成功但工具调用失败',
      toolCount: tools.length,
      tools: tools.map((t) => t.name).slice(0, 20),
      toolCall,
      error: ok ? null : toolCall.error,
      httpStatus: lastHttp.status || 0,
      ms: Date.now() - started,
      checkedAt,
    };
  } catch (err) {
    const hit = classifyEpicureError(err);
    dropClient();
    toolsCache = null;
    return {
      ...base,
      ok: false,
      category: hit.category,
      label: hit.label,
      httpStatus: hit.status || lastHttp.status || 0,
      error: `${hit.label}：${String(err?.code || err?.message || err).slice(0, 160)}`,
      pageSnippet: lastHttp.text ? lastHttp.text.replace(/\s+/g, ' ').slice(0, 180) : '',
      ms: Date.now() - started,
      checkedAt,
    };
  }
}

/** 测试用：清空连接与缓存 */
export function __resetEpicure() {
  dropClient();
  toolsCache = null;
  resultCache.clear();
}
