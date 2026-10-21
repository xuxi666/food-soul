/**
 * 全站内置 AI：多套服务配置 + 总开关 + 统一路由。
 * ------------------------------------------------------------
 * - 最多 3 套配置（后端校验），同一时刻最多 1 套启用（SQLite 部分唯一索引 + 事务）。
 * - 总开关存 site_ai.enabled；配置存 site_ai_profiles。
 * - 每次 AI 请求实时读库，不做跨请求缓存，管理员切换后下一个请求立即生效。
 * - Key 只在服务端解密后用于一次外部请求，任何响应都不含 Key。
 */
import {
  getSiteAIRow,
  setSiteAIEnabled,
  listSiteProfiles,
  getSiteProfile,
  getEnabledSiteProfile,
  countSiteProfiles,
  insertSiteProfile,
  updateSiteProfile,
  deleteSiteProfile,
  setEnabledSiteProfile,
  disableSiteProfile,
  SITE_AI_MAX_PROFILES,
} from './db.mjs';
import { decryptSecret, encryptSecret, currentKeyVersion, encryptionReady } from './security.mjs';
import { testConnection, normalizeBaseUrl, validateBaseUrl } from './ai-adapter.mjs';
import { getConfigForRequest } from './ai-config.mjs';

/** 服务商类型：仅用于展示与默认 Base URL，实际请求统一走 OpenAI 兼容适配器 */
export const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: '例如 deepseek-v4-flash' },
  { id: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', hint: '例如 glm-4-flash' },
  {
    id: 'volcengine',
    label: '火山引擎（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    hint: '填方舟「接入点 ID」或模型 ID，例如 doubao-seed-1-6',
  },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', hint: '填写服务商文档中的模型 ID' },
];

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

function providerLabel(id) {
  return PROVIDERS.find((p) => p.id === id)?.label || id || '自定义';
}

/* ---------------- 校验 ---------------- */

/**
 * 管理员是可信角色，但地址仍需收紧：
 * 只允许 http/https，且拒绝云元数据地址（169.254.169.254）等明显危险的内部端点。
 */
function assertSafeBaseUrl(raw) {
  const check = validateBaseUrl(raw);
  if (!check.ok) return check;
  let host = '';
  try {
    host = new URL(check.base).hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'API Base URL 格式不正确' };
  }
  if (host === '169.254.169.254' || host === 'metadata.google.internal') {
    return { ok: false, error: '不允许使用云元数据地址' };
  }
  return { ok: true, base: check.base };
}

function cleanName(raw, fallback) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return s || fallback;
}

/* ---------------- 读：面向后台与前台的状态 ---------------- */

function publicProfile(row, activeId) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    baseUrl: row.base_url,
    model: row.model,
    hasKey: Boolean(row.key_cipher),
    verified: Boolean(row.verified_at) && row.last_status === 'ok',
    status: row.last_status || 'unverified',
    lastError: row.last_error || null,
    lastTestedAt: row.verified_at || null,
    enabled: Boolean(row.enabled),
    active: row.id === activeId,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** 后台面板数据（绝不含 Key） */
export function getSiteAIPanel() {
  const master = getSiteAIRow();
  const rows = listSiteProfiles();
  const active = rows.find((r) => r.enabled) || null;
  return {
    master: {
      enabled: Boolean(master?.enabled),
      enabledAt: master?.enabled_at || null,
      encryptionReady: encryptionReady(),
    },
    profiles: rows.map((r) => publicProfile(r, active?.id || null)),
    activeId: active?.id || null,
    count: rows.length,
    max: SITE_AI_MAX_PROFILES,
    canCreate: rows.length < SITE_AI_MAX_PROFILES,
    providers: PROVIDERS,
  };
}

/** 兼容旧调用：单套配置视角的状态 */
export function getSiteAIStatus() {
  const panel = getSiteAIPanel();
  const active = panel.profiles.find((p) => p.active) || null;
  return {
    configured: panel.count > 0,
    verified: Boolean(active?.verified),
    enabled: panel.master.enabled,
    provider: active?.provider || null,
    baseUrl: active?.baseUrl || '',
    model: active?.model || null,
    status: active?.status || (panel.count ? 'unverified' : 'not_configured'),
    lastError: active?.lastError || null,
    updatedAt: active?.updatedAt || null,
    enabledAt: panel.master.enabledAt,
    encryptionReady: panel.master.encryptionReady,
    canEnable: panel.profiles.some((p) => p.verified) && panel.master.encryptionReady,
  };
}

/** 前台可见的全站模式（不含任何密钥） */
export function getSiteMode() {
  const master = getSiteAIRow();
  const active = getEnabledSiteProfile();
  const verified = Boolean(active?.verified_at) && active?.last_status === 'ok';
  return {
    enabled: Boolean(master?.enabled) && Boolean(active) && verified && encryptionReady(),
    masterEnabled: Boolean(master?.enabled),
    configured: Boolean(active),
    verified,
    model: active?.model || null,
    provider: active?.provider || null,
    profileName: active?.name || null,
  };
}

/** 服务端内部：解密某套配置 */
function decryptProfile(row) {
  if (!row) return null;
  try {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      apiKey: decryptSecret({
        cipher: row.key_cipher,
        iv: row.key_iv,
        tag: row.key_tag,
        version: row.key_version,
      }),
      source: 'site',
    };
  } catch {
    return { error: '内置 API Key 解密失败，请在后台重新保存该配置', source: 'site' };
  }
}

/**
 * 统一路由：内置优先，否则回落到当前用户自己的配置。
 * @param {{id:string,name?:string}|null} user
 */
export function resolveAIConfig(user) {
  const master = getSiteAIRow();
  const masterOn = Boolean(master?.enabled);

  if (masterOn) {
    const active = getEnabledSiteProfile();
    if (!active) {
      return {
        ok: false,
        code: 'ai_config_unavailable',
        message: '站点内置 AI 已开启，但没有可用的服务配置，请联系管理员。',
      };
    }
    if (!encryptionReady()) {
      return {
        ok: false,
        code: 'ai_config_unavailable',
        message: '站点内置 AI 配置异常（服务端缺少加密密钥），请联系管理员。',
      };
    }
    const config = decryptProfile(active);
    if (!config || config.error) {
      return {
        ok: false,
        code: 'ai_config_unavailable',
        message: config?.error || '内置 AI 配置异常，请联系管理员。',
      };
    }
    return { ok: true, config, source: 'site' };
  }

  // 总开关关闭：只用用户自己的配置，不回落到任何内置 Key
  if (!user) {
    return {
      ok: false,
      code: 'ai_disabled',
      message: '站点内置 AI 暂未开启，请点击右上角「接入 AI」配置自己的模型。',
    };
  }
  const result = getConfigForRequest(user.id);
  if (!result.ok) {
    return {
      ...result,
      code: result.code === 'ai_not_configured' ? 'ai_disabled' : result.code,
      message:
        result.code === 'ai_not_configured'
          ? '站点内置 AI 暂未开启，请点击右上角「接入 AI」配置自己的模型。'
          : result.message,
    };
  }
  return { ...result, source: 'user' };
}

/* ---------------- 写：增删改查 ---------------- */

function validateInput(input, { requireKey }) {
  const name = cleanName(input.name, '');
  if (!name) return { ok: false, error: '请填写配置名称' };
  const provider = String(input.provider || 'custom').trim();
  if (!PROVIDER_IDS.has(provider)) return { ok: false, error: '未知的服务商类型' };
  const baseCheck = assertSafeBaseUrl(input.baseUrl);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model || '').trim().slice(0, 120);
  if (!model) return { ok: false, error: '请填写模型 ID' };
  const apiKey = String(input.apiKey || '').trim();
  if (requireKey && !apiKey) return { ok: false, error: '请填写 API Key' };
  return { ok: true, name, provider, baseUrl: baseCheck.base, model, apiKey };
}

/** 连接测试的错误码 → 中文说明 */
function explainTestError(code, error) {
  const map = {
    auth: '认证失败：API Key 无效、过期或没有该模型的访问权限',
    model: '模型不存在：请检查模型 ID 是否正确，或 Base URL 是否指向正确的服务',
    quota: '额度不足或触发限流：请检查服务商余额与调用频率',
    server: '服务商暂时不可用（5xx），请稍后重试',
    timeout: '连接超时：请检查 Base URL 与网络连通性',
    network: '网络错误：无法连接到该 Base URL',
    format: '响应格式不符合 OpenAI 兼容规范，可能不是 Chat Completions 接口',
    invalid: '参数不合法',
  };
  const base = map[code] || '连接失败';
  return error ? `${base}（${String(error).slice(0, 120)}）` : base;
}

/** 用给定或已保存的 Key 真实调用一次模型 */
async function runTest({ baseUrl, model, apiKey, timeout = 20000 }) {
  try {
    const r = await testConnection({ baseUrl, apiKey, model, timeout });
    if (!r.ok) return { ok: false, code: r.code || 'error', error: explainTestError(r.code, r.error) };
    return { ok: true, latency: r.latency };
  } catch (err) {
    return { ok: false, code: 'network', error: explainTestError('network', err?.message || err) };
  }
}

export async function createSiteProfile(input = {}, actor = {}) {
  if (!encryptionReady()) {
    return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法加密保存密钥' };
  }
  const v = validateInput(input, { requireKey: true });
  if (!v.ok) return { ok: false, error: v.error };
  if (countSiteProfiles() >= SITE_AI_MAX_PROFILES) {
    return { ok: false, error: `最多保存 ${SITE_AI_MAX_PROFILES} 套 AI 服务配置，请先删除不再使用的配置` };
  }

  // 新建即真实测一次，测通才记为已验证（新建始终为未启用）
  const tested = await runTest({ baseUrl: v.baseUrl, model: v.model, apiKey: v.apiKey });
  let enc;
  try {
    enc = encryptSecret(v.apiKey);
  } catch {
    return { ok: false, error: '服务端未配置 AI_CONFIG_SECRET，无法安全保存 API Key' };
  }

  try {
    const row = insertSiteProfile({
      name: v.name,
      provider: v.provider,
      baseUrl: v.baseUrl,
      model: v.model,
      keyCipher: enc.cipher,
      keyIv: enc.iv,
      keyTag: enc.tag,
      keyVersion: currentKeyVersion(),
      verifiedAt: tested.ok ? Date.now() : null,
      lastStatus: tested.ok ? 'ok' : 'error',
      lastError: tested.ok ? null : String(tested.error).slice(0, 300),
      updatedBy: actor.id || '',
    });
    return { ok: true, profile: publicProfile(row, null), tested };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

/**
 * 编辑配置。
 * - apiKey 留空 = 保留原密钥。
 * - 改了 provider / baseUrl / model / apiKey 时，原「已验证」状态作废，需重新测试。
 */
export async function updateSiteProfileById(id, input = {}, actor = {}) {
  const cur = getSiteProfile(id);
  if (!cur) return { ok: false, code: 'not_found', error: '配置不存在' };

  const v = validateInput(
    {
      name: input.name ?? cur.name,
      provider: input.provider ?? cur.provider,
      baseUrl: input.baseUrl ?? cur.base_url,
      model: input.model ?? cur.model,
      apiKey: input.apiKey ?? '',
    },
    { requireKey: false }
  );
  if (!v.ok) return { ok: false, error: v.error };

  const keyChanged = Boolean(v.apiKey);
  const criticalChanged =
    keyChanged || v.provider !== cur.provider || v.baseUrl !== cur.base_url || v.model !== cur.model;

  let encFields = {};
  if (keyChanged) {
    if (!encryptionReady()) {
      return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法加密保存密钥' };
    }
    const enc = encryptSecret(v.apiKey);
    encFields = { keyCipher: enc.cipher, keyIv: enc.iv, keyTag: enc.tag, keyVersion: currentKeyVersion() };
  }

  // 关键字段变更：立刻用最终生效的 Key 测一次；失败则标记为未验证
  let tested = null;
  if (criticalChanged) {
    let effectiveKey = v.apiKey;
    if (!effectiveKey) {
      const dec = decryptProfile(cur);
      effectiveKey = dec?.apiKey || '';
    }
    if (!effectiveKey) return { ok: false, error: '原密钥不可用，请重新填写 API Key' };
    tested = await runTest({ baseUrl: v.baseUrl, model: v.model, apiKey: effectiveKey });
  }

  const patch = {
    name: v.name,
    provider: v.provider,
    baseUrl: v.baseUrl,
    model: v.model,
    updatedBy: actor.id || '',
    ...encFields,
  };
  if (criticalChanged) {
    patch.verifiedAt = tested.ok ? Date.now() : null;
    patch.lastStatus = tested.ok ? 'ok' : 'error';
    patch.lastError = tested.ok ? null : String(tested.error).slice(0, 300);
  }

  const row = updateSiteProfile(cur.id, patch);
  return { ok: true, profile: publicProfile(row, row.enabled ? row.id : null), tested, revalidated: criticalChanged };
}

/** 单独测试某套配置（不会影响当前启用状态） */
export async function testSiteProfileById(id, input = {}) {
  const cur = getSiteProfile(id);
  if (!cur) return { ok: false, code: 'not_found', error: '配置不存在' };

  const baseCheck = assertSafeBaseUrl(input.baseUrl ?? cur.base_url);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model ?? cur.model ?? '').trim();
  if (!model) return { ok: false, error: '请填写模型 ID' };

  let apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    const dec = decryptProfile(cur);
    if (!dec || dec.error || !dec.apiKey) return { ok: false, error: '该配置没有可用的 API Key，请重新填写' };
    apiKey = dec.apiKey;
  }

  const tested = await runTest({ baseUrl: baseCheck.base, model, apiKey });
  updateSiteProfile(cur.id, {
    verifiedAt: tested.ok ? Date.now() : null,
    lastStatus: tested.ok ? 'ok' : 'error',
    lastError: tested.ok ? null : String(tested.error).slice(0, 300),
  });
  return { ok: tested.ok, ...tested, profile: publicProfile(getSiteProfile(cur.id), null) };
}

/** 启用某套配置：事务内先全部停用再启用，保证唯一 */
export async function enableSiteProfile(id, actor = {}) {
  const cur = getSiteProfile(id);
  if (!cur) return { ok: false, code: 'not_found', error: '配置不存在' };
  if (!encryptionReady()) return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法启用' };
  if (!cur.verified_at || cur.last_status !== 'ok') {
    return { ok: false, error: '该配置尚未通过连接测试，请先点「测试连接」' };
  }
  const dec = decryptProfile(cur);
  if (!dec || dec.error) return { ok: false, error: dec?.error || '密钥不可用' };

  // 启用前再真实测一次，避免「保存时能用、现在已失效」
  const tested = await runTest({ baseUrl: cur.base_url, model: cur.model, apiKey: dec.apiKey });
  if (!tested.ok) {
    updateSiteProfile(cur.id, {
      verifiedAt: null,
      lastStatus: 'error',
      lastError: String(tested.error).slice(0, 300),
    });
    return { ok: false, error: `连接测试未通过，无法启用：${tested.error}` };
  }
  updateSiteProfile(cur.id, { verifiedAt: Date.now(), lastStatus: 'ok', lastError: null });

  const res = setEnabledSiteProfile(cur.id, actor.id);
  if (!res.ok) return { ok: false, error: '切换失败，请重试' };
  return { ok: true, profile: publicProfile(res.profile, res.profile.id) };
}

/**
 * 删除配置。
 * - 删除未启用项：直接删。
 * - 删除当前启用项：先停用，不自动启用其他配置；
 *   若总开关开着，同步关闭总开关，避免出现「已开启但没有可用服务」的僵局。
 */
export function removeSiteProfile(id) {
  const cur = getSiteProfile(id);
  if (!cur) return { ok: false, code: 'not_found', error: '配置不存在' };
  const wasEnabled = Boolean(cur.enabled);
  let masterDisabled = false;
  if (wasEnabled) {
    disableSiteProfile(cur.id);
    if (getSiteAIRow()?.enabled) {
      setSiteAIEnabled(false, '');
      masterDisabled = true;
    }
  }
  const ok = deleteSiteProfile(cur.id);
  if (!ok) return { ok: false, error: '删除失败' };
  return { ok: true, wasEnabled, masterDisabled };
}

/** 总开关：开启前必须有「已启用 + 已验证」的配置，并现场再测一次 */
export async function setMasterSwitch(enabled, actor = {}) {
  const master = getSiteAIRow();

  if (!enabled) {
    setSiteAIEnabled(false, actor.id);
    return { ok: true, master: { enabled: false, enabledAt: null } };
  }

  if (!encryptionReady()) return { ok: false, error: '服务端缺少 AI_CONFIG_SECRET，无法开启内置 AI' };

  const active = getEnabledSiteProfile();
  if (!active) {
    return { ok: false, error: '请先在下方启用一套 AI 服务配置，再开启全站内置 AI' };
  }
  if (!active.verified_at || active.last_status !== 'ok') {
    return { ok: false, error: '当前启用的配置尚未通过连接测试，请先测试后再开启' };
  }
  const dec = decryptProfile(active);
  if (!dec || dec.error) return { ok: false, error: dec?.error || '密钥不可用' };

  const tested = await runTest({ baseUrl: active.base_url, model: active.model, apiKey: dec.apiKey });
  if (!tested.ok) {
    updateSiteProfile(active.id, {
      verifiedAt: null,
      lastStatus: 'error',
      lastError: String(tested.error).slice(0, 300),
    });
    return { ok: false, error: `当前启用配置连接失败，无法开启：${tested.error}` };
  }

  setSiteAIEnabled(true, actor.id);
  return { ok: true, master: { enabled: true, enabledAt: Date.now() }, latency: tested.latency, wasEnabled: Boolean(master?.enabled) };
}

/* ---------------- 兼容旧调用（单套配置视角） ---------------- */

/** 旧接口：测试任意参数（不落库） */
export async function testSiteAIConfig(input = {}) {
  const baseCheck = assertSafeBaseUrl(input.baseUrl);
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error };
  const model = String(input.model || '').trim();
  if (!model) return { ok: false, error: '请填写模型 ID' };

  let apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    const active = getEnabledSiteProfile() || listSiteProfiles()[0];
    const dec = decryptProfile(active);
    if (!dec || dec.error || !dec.apiKey) return { ok: false, error: '请填写 API Key' };
    apiKey = dec.apiKey;
  }
  return runTest({ baseUrl: baseCheck.base, model, apiKey });
}

/**
 * 旧接口：保存到「当前启用配置」，没有则新建第一套。
 * 旧版只有一套配置，语义上它就是「当前配置」；若此时没有任何启用项，
 * 顺手把它设为启用，保持旧行为（新接口 /profiles 不会这么做）。
 */
export async function saveSiteAIConfig(input = {}, actor = {}) {
  const existing = getEnabledSiteProfile() || listSiteProfiles()[0];
  let r;
  if (existing) {
    r = await updateSiteProfileById(existing.id, input, actor);
  } else {
    r = await createSiteProfile(input, actor);
  }
  if (!r.ok) return r;

  const savedId = r.profile?.id || existing?.id;
  if (savedId && !getEnabledSiteProfile() && r.profile?.verified) {
    setEnabledSiteProfile(savedId, actor.id);
  }
  return {
    ok: true,
    verified: Boolean(r.profile?.verified),
    testError: r.tested?.ok ? null : r.tested?.error,
    status: getSiteAIStatus(),
  };
}

/** 旧接口：总开关 */
export async function toggleSiteAI(enabled, actor = {}) {
  const r = await setMasterSwitch(enabled, actor);
  if (!r.ok) return r;
  return { ok: true, status: getSiteAIStatus() };
}

/** 脱敏日志 */
export function logAIEvent(action, detail = {}) {
  const safe = { ...detail };
  delete safe.apiKey;
  delete safe.key;
  console.log(`[site-ai] ${action} ${JSON.stringify(safe)}`);
}

export { normalizeBaseUrl };
