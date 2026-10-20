/**
 * 全站内置 AI 配置与路由。
 * ------------------------------------------------------------
 * - 管理员内置 Key 与用户个人 Key 严格分开存（site_ai / ai_configs）。
 * - 每次 AI 请求都从数据库读开关状态，不做跨请求缓存，
 *   保证管理员关闭后下一个请求立即失效。
 * - Key 只在服务端解密后用于一次外部请求，不进入任何响应。
 */
import {
  getSiteAIRow,
  upsertSiteAIConfig,
  updateSiteAIStatus,
  setSiteAIEnabled,
} from './db.mjs';
import { decryptSecret, encryptSecret, currentKeyVersion, encryptionReady } from './security.mjs';
import { testConnection, normalizeBaseUrl, validateBaseUrl } from './ai-adapter.mjs';
import { getConfigForRequest } from './ai-config.mjs';

/** 面向管理后台的状态（绝不含 Key） */
export function getSiteAIStatus() {
  const row = getSiteAIRow();
  if (!row) {
    return {
      configured: false,
      verified: false,
      enabled: false,
      provider: null,
      baseUrl: '',
      model: null,
      status: 'not_configured',
      lastError: null,
      updatedAt: null,
      enabledAt: null,
      encryptionReady: encryptionReady(),
      canEnable: false,
    };
  }
  const verified = Boolean(row.verified_at) && row.last_status === 'ok';
  return {
    configured: true,
    verified,
    enabled: Boolean(row.enabled),
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    status: row.last_status || 'unverified',
    lastError: row.last_error || null,
    updatedAt: row.updated_at,
    enabledAt: row.enabled_at || null,
    encryptionReady: encryptionReady(),
    // 只有「已验证 + 加密可用」才允许开启
    canEnable: verified && encryptionReady(),
  };
}

/** 服务端内部使用：解密后的内置配置；失败返回 null */
function readSiteConfig() {
  const row = getSiteAIRow();
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
      source: 'site',
      verifiedAt: row.verified_at,
    };
  } catch {
    return { error: '内置 API Key 解密失败，请在后台重新保存', source: 'site' };
  }
}

/** 当前全站模式（不含任何密钥） */
export function getSiteMode() {
  const row = getSiteAIRow();
  const enabled = Boolean(row?.enabled);
  const verified = Boolean(row?.verified_at) && row?.last_status === 'ok';
  return {
    enabled: enabled && verified && encryptionReady(),
    configured: Boolean(row),
    verified,
    model: row?.model || null,
    provider: row?.provider || null,
  };
}

/**
 * 统一路由：内置优先，否则回落到当前用户自己的配置。
 * @param {{id:string,name?:string}|null} user 已通过会话校验的用户
 */
export function resolveAIConfig(user) {
  const mode = getSiteMode();
  if (mode.enabled) {
    const site = readSiteConfig();
    if (site && !site.error) return { ok: true, config: site, source: 'site' };
    return {
      ok: false,
      code: 'site_ai_error',
      message: site?.error || '内置 AI 配置异常，请联系管理员',
    };
  }

  if (!user) {
    return {
      ok: false,
      code: 'auth_required',
      message: '当前未接入 AI 大模型，请点击右上角「接入 AI」配置自己的模型。',
    };
  }

  const result = getConfigForRequest(user.id);
  return { ...result, source: 'user' };
}

/* ---------------- 管理操作 ---------------- */

/** 真实连接测试（使用传入 Key；留空则用已保存的 Key） */
export async function testSiteAIConfig(input = {}) {
  const baseCheck = validateBaseUrl(input.baseUrl);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model || '').trim();
  if (!model) return { ok: false, error: '请填写模型 ID' };

  let apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    const saved = readSiteConfig();
    if (!saved || saved.error || !saved.apiKey) {
      return { ok: false, error: '请填写 API Key（尚未保存过可用的内置 Key）' };
    }
    apiKey = saved.apiKey;
  }

  try {
    const result = await testConnection({ baseUrl: baseCheck.base, apiKey, model, timeout: 20000 });
    if (!result?.ok) return { ok: false, error: result?.error || '连接测试失败' };
    return { ok: true, latency: result.latency, reply: result.reply };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

/** 保存配置：Key 留空时保留原密钥；保存后自动标记为已验证（仅当传入 verifyToken 或刚才测试过） */
export async function saveSiteAIConfig(input = {}, actor = {}) {
  if (!encryptionReady()) {
    return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法加密保存密钥' };
  }
  const baseCheck = validateBaseUrl(input.baseUrl);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model || '').trim().slice(0, 100);
  if (!model) return { ok: false, error: '请填写模型 ID' };
  const provider = String(input.provider || 'custom').trim().slice(0, 30) || 'custom';

  const row = getSiteAIRow();
  const rawKey = String(input.apiKey || '').trim();

  // Key 留空且已有配置：沿用原密文，避免掩码字段为空把 Key 覆盖掉
  let keyCipher, keyIv, keyTag, keyVersion;
  if (!rawKey) {
    if (!row) return { ok: false, error: '首次保存必须填写 API Key' };
    keyCipher = row.key_cipher;
    keyIv = row.key_iv;
    keyTag = row.key_tag;
    keyVersion = row.key_version;
  } else {
    const enc = encryptSecret(rawKey);
    keyCipher = enc.cipher;
    keyIv = enc.iv;
    keyTag = enc.tag;
    keyVersion = currentKeyVersion();
  }

  // 保存前必须真实测通（用最终生效的 Key）
  const effectiveKey = rawKey || readSiteConfig()?.apiKey || '';
  if (!effectiveKey) return { ok: false, error: 'API Key 不可用，请重新填写' };
  const tested = await testConnection({
    baseUrl: baseCheck.base,
    apiKey: effectiveKey,
    model,
    timeout: 20000,
  }).catch((err) => ({ ok: false, error: String(err?.message || err) }));

  upsertSiteAIConfig({
    provider,
    baseUrl: baseCheck.base,
    model,
    keyCipher,
    keyIv,
    keyTag,
    keyVersion,
    verifiedAt: tested.ok ? Date.now() : null,
    lastStatus: tested.ok ? 'ok' : 'error',
    lastError: tested.ok ? null : String(tested.error || '连接测试失败').slice(0, 300),
    updatedBy: actor.id || '',
  });

  return {
    ok: true,
    verified: Boolean(tested.ok),
    testError: tested.ok ? null : String(tested.error || '连接测试失败'),
    status: getSiteAIStatus(),
  };
}

/** 开关：开启前重新做一次真实连接测试，失败则拒绝 */
export async function toggleSiteAI(enabled, actor = {}) {
  const status = getSiteAIStatus();
  if (!status.configured) return { ok: false, error: '尚未配置内置 AI，无法开启' };
  if (!status.encryptionReady) return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法启用' };

  if (!enabled) {
    setSiteAIEnabled(false, actor.id);
    return { ok: true, status: getSiteAIStatus() };
  }

  const config = readSiteConfig();
  if (!config || config.error) return { ok: false, error: config?.error || '内置配置不可用' };

  // 开启前再验证一次，避免「配置已保存但模型已失效」被误开启
  const tested = await testConnection({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeout: 20000,
  }).catch((err) => ({ ok: false, error: String(err?.message || err) }));

  updateSiteAIStatus({
    status: tested.ok ? 'ok' : 'error',
    error: tested.ok ? null : String(tested.error || '连接测试失败'),
    verifiedAt: tested.ok ? Date.now() : null,
  });

  if (!tested.ok) {
    return { ok: false, error: `连接测试未通过，无法开启：${String(tested.error || '').slice(0, 120)}` };
  }

  setSiteAIEnabled(true, actor.id);
  return { ok: true, status: getSiteAIStatus() };
}

/** 脱敏日志用：永不输出 Key */
export function logAIEvent(action, detail = {}) {
  const safe = { ...detail };
  delete safe.apiKey;
  delete safe.key;
  console.log(`[site-ai] ${action} ${JSON.stringify(safe)}`);
}

export { normalizeBaseUrl };
