import { redactSecret } from './security.mjs';

/**
 * 统一模型适配层（OpenAI 兼容 /chat/completions）
 * ------------------------------------------------------------
 * 所有用户级模型调用都走这里：连接测试、流式聊天、非流式 JSON、模型列表。
 * 错误信息会脱敏，绝不包含 API Key。
 */

export class AIError extends Error {
  constructor(message, { code = 'ai_error', status = 0 } = {}) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/chat\/completions$/i, '');
  return s;
}

export function validateBaseUrl(raw) {
  const base = normalizeBaseUrl(raw);
  if (!base) return { ok: false, error: '请填写 API Base URL' };
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: 'API Base URL 必须以 http:// 或 https:// 开头' };
    }
    return { ok: true, base };
  } catch {
    return { ok: false, error: 'API Base URL 格式不正确' };
  }
}

function mapStatus(status) {
  if (status === 401 || status === 403) return { code: 'auth', message: 'API Key 无效或没有访问权限' };
  if (status === 404) return { code: 'model', message: '模型不存在，或 API Base URL 不正确' };
  if (status === 429) return { code: 'quota', message: '请求过于频繁或额度不足' };
  if (status >= 500) return { code: 'server', message: '模型服务暂时不可用' };
  return { code: 'http', message: `模型服务返回错误（HTTP ${status}）` };
}

async function readError(res, apiKey) {
  const text = await res.text().catch(() => '');
  let detail = '';
  try {
    const json = JSON.parse(text);
    detail = String(json?.error?.message || json?.message || json?.error || '');
  } catch {
    detail = String(text || '');
  }
  const mapped = mapStatus(res.status);
  const safe = redactSecret(detail, apiKey);
  return new AIError(safe ? `${mapped.message}：${safe}` : mapped.message, {
    code: mapped.code,
    status: res.status,
  });
}

function timeoutSignal(external, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

function pickContent(json) {
  const msg = json?.choices?.[0]?.message;
  if (!msg) return null;
  if (typeof msg.content === 'string') return msg.content;
  if (typeof msg.reasoning_content === 'string') return msg.reasoning_content;
  return null;
}

/** 真实连接测试：向指定模型发起一次最小请求 */
export async function testConnection({ baseUrl, apiKey, model, timeout = 15000 }) {
  const baseCheck = validateBaseUrl(baseUrl);
  if (!baseCheck.ok) return { ok: false, code: 'invalid', error: baseCheck.error };
  if (!String(apiKey || '').trim()) return { ok: false, code: 'invalid', error: '请填写 API Key' };
  if (!String(model || '').trim()) return { ok: false, code: 'invalid', error: '请填写模型 ID' };

  const started = Date.now();
  const { signal, cleanup } = timeoutSignal(null, timeout);
  try {
    const res = await fetch(`${baseCheck.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      }),
    });
    if (!res.ok) {
      const err = await readError(res, apiKey);
      return { ok: false, code: err.code, status: err.status, error: err.message };
    }
    const json = await res.json().catch(() => null);
    const content = pickContent(json);
    if (content === null) {
      return { ok: false, code: 'format', error: '模型返回格式不符合 OpenAI 兼容规范' };
    }
    return { ok: true, model, latency: Date.now() - started };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: '连接超时（15 秒），请检查 Base URL 或网络' };
    }
    return {
      ok: false,
      code: 'network',
      error: redactSecret(`无法连接到模型服务：${err?.message || err}`, apiKey) || '无法连接到模型服务',
    };
  } finally {
    cleanup();
  }
}

/** 流式聊天：SSE 增量回调，返回完整文本 */
export async function chatStream({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  temperature = 0.85,
  signal,
  onDelta,
}) {
  const baseCheck = validateBaseUrl(baseUrl);
  if (!baseCheck.ok) throw new AIError(baseCheck.error, { code: 'invalid' });
  const { signal: s, cleanup } = timeoutSignal(signal, 120000);
  try {
    const res = await fetch(`${baseCheck.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: s,
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok || !res.body) throw await readError(res, apiKey);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || '';
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        } catch {
          /* 跳过不完整行 */
        }
      }
    }
    return full;
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw err;
      throw new AIError('模型响应超时，请稍后重试', { code: 'timeout' });
    }
    throw new AIError(redactSecret(`模型调用失败：${err?.message || err}`, apiKey), { code: 'network' });
  } finally {
    cleanup();
  }
}

/** 非流式调用：返回文本 */
export async function complete({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  temperature = 0.6,
  maxTokens = 2000,
  timeout = 60000,
  signal,
}) {
  const baseCheck = validateBaseUrl(baseUrl);
  if (!baseCheck.ok) throw new AIError(baseCheck.error, { code: 'invalid' });
  const { signal: s, cleanup } = timeoutSignal(signal, timeout);
  try {
    const res = await fetch(`${baseCheck.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: s,
      body: JSON.stringify({
        model,
        stream: false,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok) throw await readError(res, apiKey);
    const json = await res.json().catch(() => null);
    const content = pickContent(json);
    if (content === null) throw new AIError('模型返回格式不符合 OpenAI 兼容规范', { code: 'format' });
    return content;
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw err;
      throw new AIError('模型响应超时，请稍后重试', { code: 'timeout' });
    }
    throw new AIError(redactSecret(`模型调用失败：${err?.message || err}`, apiKey), { code: 'network' });
  } finally {
    cleanup();
  }
}

/** 模型列表（可选能力，部分服务商不支持） */
export async function listModels({ baseUrl, apiKey, timeout = 12000 }) {
  const baseCheck = validateBaseUrl(baseUrl);
  if (!baseCheck.ok) return { ok: false, code: 'invalid', error: baseCheck.error };
  if (!apiKey) return { ok: false, code: 'invalid', error: '请填写 API Key' };
  const { signal, cleanup } = timeoutSignal(null, timeout);
  try {
    const res = await fetch(`${baseCheck.base}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      const err = await readError(res, apiKey);
      return { ok: false, code: err.code, error: err.message };
    }
    const json = await res.json().catch(() => null);
    const list = json?.data || json?.models || [];
    const models = (Array.isArray(list) ? list : [])
      .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
      .filter(Boolean)
      .slice(0, 200);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, code: 'network', error: redactSecret(`获取模型列表失败：${err?.message || err}`, apiKey) };
  } finally {
    cleanup();
  }
}
