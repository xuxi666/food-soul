import { createSession, deleteSession, deleteUserSessions, findSessionUser, cleanupSessions, setUserRole } from './db.mjs';
import { hashToken, newSessionToken } from './security.mjs';

const COOKIE_NAME = 'fs_session';
const TTL_DAYS = Math.max(1, Math.min(30, Number(process.env.SESSION_TTL_DAYS) || 7));

/** 管理员白名单：只来自服务端环境变量，前端无法影响 */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase());
}

/** 按白名单同步角色（白名单加入即提升，移出即降级），返回带最新角色的用户 */
export function syncRole(user) {
  if (!user) return null;
  const shouldBeAdmin = isAdminEmail(user.email);
  const isAdmin = user.role === 'admin';
  if (shouldBeAdmin === isAdmin) return user;
  setUserRole(user.id, shouldBeAdmin ? 'admin' : 'user');
  return { ...user, role: shouldBeAdmin ? 'admin' : 'user' };
}

export function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function sessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

export function getCurrentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  cleanupSessions();
  return syncRole(findSessionUser(hashToken(token)));
}

export function isSecureRequest(req) {
  return (
    process.env.NODE_ENV === 'production' ||
    String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
  );
}

export function setSessionCookie(req, res, userId) {
  const token = newSessionToken();
  const expiresAt = Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000;
  createSession({ tokenHash: hashToken(token), userId, expiresAt });
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      (TTL_DAYS * 24 * 60 * 60)
    )}${secure}`
  );
  return token;
}

export function clearSessionCookie(req, res) {
  const token = sessionToken(req);
  if (token) deleteSession(hashToken(token));
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function logoutAllSessions(userId) {
  deleteUserSessions(userId);
}

/** 同源校验：带 Origin 的写请求必须来自本站，降低 CSRF 风险 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requireUser(req, res, send, message = '请先登录后再使用 AI 功能') {
  const user = getCurrentUser(req);
  if (!user) {
    send(res, 401, { error: message, code: 'auth_required' });
    return null;
  }
  return user;
}

/** 管理员鉴权：角色只来自服务端会话 + 白名单，不接受任何前端声明 */
export function requireAdmin(req, res, send) {
  const user = requireUser(req, res, send, '请先登录');
  if (!user) return null;
  if (user.role !== 'admin') {
    send(res, 403, { error: '没有管理员权限', code: 'forbidden' });
    return null;
  }
  return user;
}
