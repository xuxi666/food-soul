import crypto from 'node:crypto';

import { getAIConfigRow, upsertAIConfig, updateAIConfigStatus, deleteAIConfigRow } from './db.mjs';
import { decryptSecret, encryptSecret, currentKeyVersion } from './security.mjs';
import { testConnection, listModels, normalizeBaseUrl, validateBaseUrl } from './ai-adapter.mjs';

/**
 * 用户级 AI 配置：读取/测试/保存/删除、状态、验证令牌。
 * API Key 只在服务端解密后用于一次模型请求，绝不进入响应。
 */

const VERIFY_TTL = 10 * 60 * 1000;
const verifications = new Map();

function pruneVerifications() {
  const now = Date.now();
  for (const [token, item] of verifications) {
    if (item.expiresAt <= now) verifications.delete(token);
  }
}

function keyFingerprint(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 32);
}

function configHash({ provider, baseUrl, model, apiKey }) {
  return crypto
    .createHash('sha256')
    .update(`${provider}|${normalizeBaseUrl(baseUrl)}|${model}|${keyFingerprint(apiKey)}`)
    .digest('hex');
}

function rememberVerification(userId, hash) {
  pruneVerifications();
  const token = crypto.randomBytes(24).toString('base64url');
  verifications.set(token, { userId, hash, expiresAt: Date.now() + VERIFY_TTL });
  return token;
}

function consumeVerification(token, userId, hash) {
  pruneVerifications();
  const item = verifications.get(String(token || ''));
  if (!item) return false;
  verifications.delete(String(token));
  return item.userId === userId && item.hash === hash && item.expiresAt > Date.now();
}

export function getAIConfig(userId) {
  const row = getAIConfigRow(userId);
  if (!row) return null;
  try {
    const apiKey = decryptSecret({
      cipher: row.key_cipher,
      iv: row.key_iv,
      tag: row.key_tag,
      version: row.key_version,
    });
    return {
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      apiKey,
      verifiedAt: row.verified_at,
      status: row.last_status,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  } catch {
    return {
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      apiKey: '',
      verifiedAt: null,
      status: 'error',
      lastError: 'API Key 解密失败，请重新配置',
      updatedAt: row.updated_at,
      decryptError: true,
    };
  }
}

export function getAIStatus(userId) {
  const row = getAIConfigRow(userId);
  if (!row) {
    return {
      configured: false,
      verified: false,
      status: 'not_configured',
      provider: null,
      model: null,
      lastError: null,
      updatedAt: null,
    };
  }
  const verified = Boolean(row.verified_at) && row.last_status === 'ok';
  return {
    configured: true,
    verified,
    status: row.last_status || 'unverified',
    provider: row.provider,
    model: row.model,
    lastError: row.last_error || null,
    updatedAt: row.updated_at,
  };
}

/** 每个 AI 请求前调用：返回当前用户自己的配置或明确的错误 */
export function getConfigForRequest(userId) {
  const config = getAIConfig(userId);
  if (!config) {
    return {
      ok: false,
      code: 'ai_not_configured',
      message: '当前未接入 AI 大模型，请先在右上角「接入 AI」配置。',
    };
  }
  if (!config.apiKey) {
    return {
      ok: false,
      code: 'ai_config_error',
      message: config.lastError || 'AI 配置异常，请重新接入。',
    };
  }
  return { ok: true, config };
}

export function validateConfigInput(input = {}) {
  const provider = String(input.provider || 'custom').trim().slice(0, 30) || 'custom';
  const baseCheck = validateBaseUrl(input.baseUrl);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model || '').trim().slice(0, 100);
  if (!model) return { ok: false, error: '请填写模型 ID' };
  const apiKey = String(input.apiKey || '').trim().slice(0, 500);
  return { ok: true, provider, baseUrl: baseCheck.base, model, apiKey };
}

export async function testUserConfig(userId, input) {
  const v = validateConfigInput(input);
  if (!v.ok) return { ok: false, code: 'invalid', error: v.error };
  const existing = getAIConfig(userId);
  const apiKey = v.apiKey || existing?.apiKey || '';
  if (!apiKey) return { ok: false, code: 'invalid', error: '请填写 API Key' };

  const result = await testConnection({ baseUrl: v.baseUrl, apiKey, model: v.model });
  if (result.ok) {
    const verifyToken = rememberVerification(
      userId,
      configHash({ provider: v.provider, baseUrl: v.baseUrl, model: v.model, apiKey })
    );
    if (existing && normalizeBaseUrl(existing.baseUrl) === v.baseUrl && existing.model === v.model) {
      updateAIConfigStatus(userId, { status: 'ok', error: null, verifiedAt: Date.now() });
    }
    return { ...result, verifyToken };
  }

  if (existing && normalizeBaseUrl(existing.baseUrl) === v.baseUrl && existing.model === v.model) {
    updateAIConfigStatus(userId, { status: 'failed', error: result.error, verifiedAt: null });
  }
  return result;
}

export async function saveUserConfig(userId, input) {
  const v = validateConfigInput(input);
  if (!v.ok) return { ok: false, code: 'invalid', error: v.error };
  const existing = getAIConfig(userId);
  const existingRow = getAIConfigRow(userId);
  const apiKey = v.apiKey || existing?.apiKey || '';
  if (!apiKey) return { ok: false, code: 'invalid', error: '请填写 API Key' };

  const hash = configHash({ provider: v.provider, baseUrl: v.baseUrl, model: v.model, apiKey });
  if (!consumeVerification(input.verifyToken, userId, hash)) {
    return { ok: false, code: 'not_verified', error: '请先完成连接测试，测试通过后才能保存' };
  }

  let enc;
  if (v.apiKey) {
    try {
      enc = encryptSecret(apiKey);
    } catch (err) {
      return {
        ok: false,
        code: err.code || 'secret_missing',
        error: '服务端未配置 AI_CONFIG_SECRET，无法安全保存 API Key',
      };
    }
  } else if (existingRow) {
    enc = {
      cipher: existingRow.key_cipher,
      iv: existingRow.key_iv,
      tag: existingRow.key_tag,
      version: existingRow.key_version,
    };
  } else {
    return { ok: false, code: 'invalid', error: '请填写 API Key' };
  }

  upsertAIConfig({
    userId,
    provider: v.provider,
    baseUrl: v.baseUrl,
    model: v.model,
    keyCipher: enc.cipher,
    keyIv: enc.iv,
    keyTag: enc.tag,
    keyVersion: enc.version || currentKeyVersion(),
    verifiedAt: Date.now(),
    lastStatus: 'ok',
    lastError: null,
  });

  return { ok: true, ai: getAIStatus(userId) };
}

export function deleteUserConfig(userId) {
  deleteAIConfigRow(userId);
  return getAIStatus(userId);
}

/** 模型调用成功后更新状态；鉴权/模型错误会清空 verified_at，网络/限流错误保留已验证状态 */
export function markAIConfigStatus(userId, status, error) {
  const row = getAIConfigRow(userId);
  if (!row) return;
  const hardFail = ['auth', 'model', 'invalid', 'format'].includes(status);
  const nextStatus = status === 'ok' ? 'ok' : hardFail ? 'failed' : 'unavailable';
  const verifiedAt = status === 'ok' ? Date.now() : hardFail ? null : row.verified_at;
  updateAIConfigStatus(userId, {
    status: nextStatus,
    error: status === 'ok' ? null : String(error || '模型暂时不可用').slice(0, 300),
    verifiedAt,
  });
}

export async function listUserModels(userId, input = {}) {
  const existing = getAIConfig(userId);
  const baseUrl = input.baseUrl || existing?.baseUrl || '';
  const apiKey = String(input.apiKey || '').trim() || existing?.apiKey || '';
  if (!baseUrl) return { ok: false, error: '请填写 API Base URL' };
  if (!apiKey) return { ok: false, error: '请填写 API Key' };
  return listModels({ baseUrl, apiKey });
}
