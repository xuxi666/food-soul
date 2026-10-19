import { createSession, deleteSession, deleteUserSessions, findSessionUser, cleanupSessions } from './db.mjs';
import { hashToken, newSessionToken } from './security.mjs';

const COOKIE_NAME = 'fs_session';
const TTL_DAYS = Math.max(1, Math.min(30, Number(process.env.SESSION_TTL_DAYS) || 7));

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
  return findSessionUser(hashToken(token));
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

export function requireUser(req, res, send) {
  const user = getCurrentUser(req);
  if (!user) {
    send(res, 401, { error: '请先登录后再使用 AI 功能', code: 'auth_required' });
    return null;
  }
  return user;
}
