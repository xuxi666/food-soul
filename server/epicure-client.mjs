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
        const body = Readable.toWeb(res);
        resolve(
          new Response(body, {
            status: res.statusCode || 200,
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

/** 测试用：清空连接与缓存 */
export function __resetEpicure() {
  dropClient();
  toolsCache = null;
  resultCache.clear();
}
