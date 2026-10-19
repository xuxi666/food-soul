import crypto from 'node:crypto';

/**
 * 密码、会话令牌、API Key 加密与错误脱敏。
 * 加密密钥只从服务端环境变量读取，绝不下发前端。
 */

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT).toString('base64');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  try {
    const expected = Buffer.from(String(hash || ''), 'base64');
    const actual = crypto.scryptSync(String(password), String(salt || ''), expected.length || KEY_LEN, SCRYPT);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/* ---------------- API Key 加密（AES-256-GCM） ---------------- */

function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  return buf.length === 32 ? buf : null;
}

function keyState() {
  const current = parseKey(process.env.AI_CONFIG_SECRET);
  const previous = parseKey(process.env.AI_CONFIG_SECRET_PREVIOUS);
  const version = Math.max(1, Number(process.env.AI_CONFIG_KEY_VERSION) || 1);
  return { current, previous, version };
}

export function encryptionReady() {
  return Boolean(keyState().current);
}

export function currentKeyVersion() {
  return keyState().version;
}

export function encryptSecret(plain) {
  const { current, version } = keyState();
  if (!current) {
    const err = new Error('服务端未配置 AI_CONFIG_SECRET，无法安全保存 API Key');
    err.code = 'secret_missing';
    throw err;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    version,
  };
}

export function decryptSecret({ cipher, iv, tag, version }) {
  const { current, previous, version: currentVersion } = keyState();
  const candidates = [];
  if (Number(version) === currentVersion && current) candidates.push(current);
  if (previous) candidates.push(previous);
  if (current && !candidates.includes(current)) candidates.push(current);

  for (const key of candidates) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(iv), 'base64'));
      decipher.setAuthTag(Buffer.from(String(tag), 'base64'));
      const dec = Buffer.concat([decipher.update(Buffer.from(String(cipher), 'base64')), decipher.final()]);
      return dec.toString('utf8');
    } catch {
      /* try next key */
    }
  }
  const err = new Error('API Key 解密失败，请重新配置');
  err.code = 'decrypt_failed';
  throw err;
}

/* ---------------- 错误脱敏 ---------------- */

export function redactSecret(text, secret) {
  let out = String(text || '');
  const s = String(secret || '');
  if (s) {
    out = out.split(s).join('***');
    try {
      out = out.split(encodeURIComponent(s)).join('***');
    } catch {
      /* noop */
    }
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer ***');
  out = out.replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._\-+/=]{8,}/gi, '$1***');
  return out.replace(/\s+/g, ' ').trim().slice(0, 240);
}
