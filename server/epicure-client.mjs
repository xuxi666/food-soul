import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Epicure MCP 客户端（服务端专用，不暴露给浏览器）
 *
 * 协议：MCP Streamable HTTP（JSON-RPC over POST，响应可能是 SSE 帧）
 * 端点：https://epicure-mcp.kaikaku.ai/mcp
 *
 * 设计要点：
 * - 单例会话：initialize 一次，复用 mcp-session-id；过期自动重建
 * - tools/list 结果缓存 10 分钟，用于校验工具是否存在
 * - 每次调用带超时（默认 12s），失败不抛给业务层以外的调用方
 * - 结果按 工具名+参数 缓存，避免同一食材反复请求
 * - 只允许调用白名单内的工具，防止被当成通用 MCP 代理
 */

const ENDPOINT = process.env.EPICURE_MCP_URL || 'https://epicure-mcp.kaikaku.ai/mcp';
const CLIENT_NAME = 'food-soul';
const CLIENT_VERSION = '1.0.0';

const CALL_TIMEOUT = Number(process.env.EPICURE_TIMEOUT_MS) || 12000;
const TOOLS_TTL = 10 * 60 * 1000;
const RESULT_TTL = 30 * 60 * 1000;
const MAX_RESULT_CACHE = 400;

/** 业务实际会用到的工具（其余不开放调用） */
export const ALLOWED_TOOLS = new Set([
  'pairing_score',
  'find_pairings',
  'neighbors',
  'compare_on_axis',
  'flavour_correlations',
  'cultural_profile',
  'where_on_atlas',
  'ingredient_on_factor',
  'list_targets',
  'list_factors',
  'morph',
  'pareto_navigate',
  'closest_mode',
]);

let session = null;          // { id, at }
let sessionPromise = null;   // 并发初始化去重
let toolsCache = null;       // { at, tools }
const resultCache = new Map(); // key -> { at, value }

export function isEpicureDisabled() {
  return String(process.env.EPICURE_DISABLED || '') === '1';
}

function cacheGet(key) {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL) {
    resultCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (resultCache.size >= MAX_RESULT_CACHE) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
  resultCache.set(key, { at: Date.now(), value });
}

/** 从响应里取出 JSON-RPC 结果：可能是纯 JSON，也可能是 SSE 帧 */
function parseRpcPayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* 落到 SSE 解析 */
    }
  }
  const lines = trimmed.split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      last = JSON.parse(raw);
    } catch {
      /* 忽略坏帧 */
    }
  }
  return last;
}

async function postRpc(body, { sessionId, timeout = CALL_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const sid = res.headers.get('mcp-session-id');
    const text = await res.text();
    if (res.status === 404) {
      const err = new Error('session-expired');
      err.code = 'session-expired';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`epicure-http-${res.status}`);
      err.code = 'http';
      err.status = res.status;
      throw err;
    }
    return { payload: parseRpcPayload(text), sessionId: sid };
  } finally {
    clearTimeout(timer);
  }
}

let nextId = 0;

async function ensureSession(force = false) {
  if (!force && session && Date.now() - session.at < 20 * 60 * 1000) return session.id;
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const { payload, sessionId } = await postRpc(
      {
        jsonrpc: '2.0',
        id: ++nextId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        },
      },
      { timeout: CALL_TIMEOUT }
    );
    if (!payload?.result || !sessionId) {
      const err = new Error('epicure-init-failed');
      err.code = 'init';
      throw err;
    }
    session = { id: sessionId, at: Date.now() };
    // 按协议补一条 initialized 通知（无 id，不需要等结果）
    await postRpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { sessionId, timeout: 5000 }
    ).catch(() => {});
    return sessionId;
  })();

  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

/** 获取工具清单（含真实 inputSchema），缓存 10 分钟 */
export async function listTools({ force = false } = {}) {
  if (!force && toolsCache && Date.now() - toolsCache.at < TOOLS_TTL) return toolsCache.tools;
  const sid = await ensureSession();
  const { payload } = await postRpc(
    { jsonrpc: '2.0', id: ++nextId, method: 'tools/list', params: {} },
    { sessionId: sid }
  );
  const tools = payload?.result?.tools;
  if (!Array.isArray(tools)) {
    const err = new Error('epicure-tools-failed');
    err.code = 'tools';
    throw err;
  }
  toolsCache = { at: Date.now(), tools };
  return tools;
}

/**
 * 调用一个工具。返回 { ok, data, text, error, cached, ms }
 * 不抛异常，调用方按 ok 分支处理。
 */
export async function callTool(name, args = {}, opts = {}) {
  if (isEpicureDisabled()) return { ok: false, error: 'epicure-disabled' };
  if (!ALLOWED_TOOLS.has(name)) return { ok: false, error: 'tool-not-allowed' };

  const key = `${name}:${JSON.stringify(args)}`;
  const cached = cacheGet(key);
  if (cached && !opts.noCache) return { ...cached, cached: true };

  const started = Date.now();
  const timeout = Math.max(2000, Number(opts.timeout) || CALL_TIMEOUT);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const sid = await ensureSession(attempt > 0);
      const { payload } = await postRpc(
        { jsonrpc: '2.0', id: ++nextId, method: 'tools/call', params: { name, arguments: args } },
        { sessionId: sid, timeout }
      );
      if (payload?.error) {
        const value = { ok: false, error: String(payload.error.message || 'rpc-error').slice(0, 200), ms: Date.now() - started };
        return value;
      }
      const result = payload?.result || {};
      const text = (result.content || [])
        .filter((c) => c && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      const value = {
        ok: !result.isError,
        text,
        data: safeJson(text),
        error: result.isError ? text.slice(0, 200) : null,
        ms: Date.now() - started,
      };
      if (value.ok) cacheSet(key, value);
      return value;
    } catch (err) {
      const code = err?.code || 'network';
      if (code === 'session-expired' && attempt === 0) {
        await sleep(120);
        continue;
      }
      if (attempt === 0 && code !== 'http') {
        await sleep(200);
        continue;
      }
      return { ok: false, error: `${code}: ${String(err.message || err).slice(0, 120)}`, ms: Date.now() - started };
    }
  }
  return { ok: false, error: 'unreachable', ms: Date.now() - started };
}

function safeJson(text) {
  if (!text) return null;
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** 健康状态：能否连上、工具数、耗时 */
export async function epicureStatus() {
  if (isEpicureDisabled()) return { ok: false, disabled: true, error: 'epicure-disabled' };
  const started = Date.now();
  try {
    const tools = await listTools();
    return {
      ok: true,
      endpoint: ENDPOINT,
      tools: tools.map((t) => t.name),
      toolCount: tools.length,
      ms: Date.now() - started,
      cached: Boolean(toolsCache && Date.now() - toolsCache.at > 50),
    };
  } catch (err) {
    return { ok: false, error: `${err?.code || 'network'}: ${String(err.message || err).slice(0, 120)}`, ms: Date.now() - started };
  }
}

/** 测试用：清空缓存与会话 */
export function __resetEpicure() {
  session = null;
  toolsCache = null;
  resultCache.clear();
}
