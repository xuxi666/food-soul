import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import './config.mjs';

/**
 * 持久化数据库（SQLite，Node 内置 node:sqlite）
 * ------------------------------------------------------------
 * 用户、会话、用户级 AI 配置都落盘到 data/foodsoul.db。
 * API Key 只以 AES-256-GCM 密文形式保存在 ai_configs 表。
 */

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'foodsoul.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS ai_configs (
    user_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    key_cipher TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_tag TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    verified_at INTEGER,
    last_status TEXT NOT NULL DEFAULT 'unverified',
    last_error TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 首页卡片图片覆盖（菜系 / 口味分开存，按 id 精确匹配）
  CREATE TABLE IF NOT EXISTS card_images (
    kind TEXT NOT NULL,
    card_id TEXT NOT NULL,
    url TEXT NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (kind, card_id)
  );

  -- 美食图鉴菜品默认图片覆盖（按 dish_id 关联，不依赖顺序）
  CREATE TABLE IF NOT EXISTS dish_images (
    dish_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );

  -- 社区举报
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    reporter_id TEXT,
    reporter_name TEXT,
    source TEXT NOT NULL DEFAULT 'web',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    handled_by TEXT,
    handled_at INTEGER,
    handle_action TEXT,
    handle_note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_reports_post ON reports(post_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once ON reports(post_id, reporter_id, status)
    WHERE status = 'pending';

  -- 管理操作审计
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

/* ---------------- 迁移：users.role ---------------- */
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

/* ---------------- users ---------------- */

export function createUser({ id, email, name, passwordHash, passwordSalt }) {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, email, name, passwordHash, passwordSalt, Date.now());
  return findUserById(id);
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase()) || null;
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(String(id || '')) || null;
}

/* ---------------- sessions ---------------- */

export function createSession({ tokenHash, userId, expiresAt }) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    Date.now(),
    expiresAt
  );
}

export function findSessionUser(tokenHash) {
  const row = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(String(tokenHash || ''));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: row.user_id, email: row.email, name: row.name, role: row.role || 'user' };
}

export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(String(tokenHash || ''));
}

export function deleteUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(String(userId || ''));
}

export function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

/* ---------------- AI configs ---------------- */

export function getAIConfigRow(userId) {
  return db.prepare('SELECT * FROM ai_configs WHERE user_id = ?').get(String(userId || '')) || null;
}

export function upsertAIConfig(row) {
  db.prepare(
    `INSERT INTO ai_configs
      (user_id, provider, base_url, model, key_cipher, key_iv, key_tag, key_version, verified_at, last_status, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       provider = excluded.provider,
       base_url = excluded.base_url,
       model = excluded.model,
       key_cipher = excluded.key_cipher,
       key_iv = excluded.key_iv,
       key_tag = excluded.key_tag,
       key_version = excluded.key_version,
       verified_at = excluded.verified_at,
       last_status = excluded.last_status,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`
  ).run(
    row.userId,
    row.provider,
    row.baseUrl,
    row.model,
    row.keyCipher,
    row.keyIv,
    row.keyTag,
    row.keyVersion,
    row.verifiedAt,
    row.lastStatus,
    row.lastError,
    Date.now()
  );
}

export function updateAIConfigStatus(userId, { status, error, verifiedAt }) {
  db.prepare(
    `UPDATE ai_configs SET last_status = ?, last_error = ?, verified_at = ?, updated_at = ? WHERE user_id = ?`
  ).run(String(status || 'unknown'), error ? String(error).slice(0, 300) : null, verifiedAt ?? null, Date.now(), String(userId || ''));
}

export function deleteAIConfigRow(userId) {
  db.prepare('DELETE FROM ai_configs WHERE user_id = ?').run(String(userId || ''));
}

/* ---------------- 角色 ---------------- */

export function getUserRole(userId) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(String(userId || ''));
  return row?.role || 'user';
}

export function setUserRole(userId, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(String(role), String(userId));
}

/* ---------------- 图片覆盖 ---------------- */

export function listCardImages(kind) {
  const rows = kind
    ? db.prepare('SELECT * FROM card_images WHERE kind = ?').all(String(kind))
    : db.prepare('SELECT * FROM card_images').all();
  return rows;
}

export function upsertCardImage({ kind, cardId, url, updatedBy }) {
  db.prepare(
    `INSERT INTO card_images (kind, card_id, url, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind, card_id) DO UPDATE SET
       url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(String(kind), String(cardId), String(url), updatedBy || null, Date.now());
}

export function deleteCardImage(kind, cardId) {
  db.prepare('DELETE FROM card_images WHERE kind = ? AND card_id = ?').run(String(kind), String(cardId));
}

export function listDishImages() {
  return db.prepare('SELECT * FROM dish_images').all();
}

export function upsertDishImage({ dishId, url, updatedBy }) {
  db.prepare(
    `INSERT INTO dish_images (dish_id, url, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(dish_id) DO UPDATE SET
       url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(String(dishId), String(url), updatedBy || null, Date.now());
}

export function deleteDishImage(dishId) {
  db.prepare('DELETE FROM dish_images WHERE dish_id = ?').run(String(dishId));
}

/* ---------------- 举报 ---------------- */

export function createReport({ id, postId, reason, note, reporterId, reporterName, source }) {
  db.prepare(
    `INSERT INTO reports (id, post_id, reason, note, reporter_id, reporter_name, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, String(postId), String(reason), note || null, reporterId || null, reporterName || null, source || 'web', Date.now());
  return getReport(id);
}

export function getReport(id) {
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(String(id || '')) || null;
}

export function listReports({ status = '', page = 1, pageSize = 20 } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  const args = status ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM reports ${where}`).get(...args).c;
  const rows = db
    .prepare(`SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  return { items: rows, total, page, pageSize, hasMore: (page - 1) * pageSize + rows.length < total };
}

export function reportsForPost(postId) {
  return db.prepare('SELECT * FROM reports WHERE post_id = ? ORDER BY created_at DESC').all(String(postId));
}

export function countPendingReports(postId) {
  return db.prepare("SELECT COUNT(*) AS c FROM reports WHERE post_id = ? AND status = 'pending'").get(String(postId)).c;
}

export function findPendingReportBy(postId, reporterId) {
  return (
    db
      .prepare("SELECT * FROM reports WHERE post_id = ? AND reporter_id = ? AND status = 'pending'")
      .get(String(postId), String(reporterId)) || null
  );
}

export function updateReportStatus({ id, status, handledBy, action, note }) {
  db.prepare(
    `UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, handle_action = ?, handle_note = ?
     WHERE id = ?`
  ).run(String(status), handledBy || null, Date.now(), action || null, note || null, String(id));
  return getReport(id);
}

export function reportStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM reports GROUP BY status').all();
  const out = { pending: 0, processing: 0, resolved: 0, rejected: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = r.c;
    out.total += r.c;
  }
  return out;
}

/* ---------------- 审计 ---------------- */

export function addAudit({ id, actorId, actorName, action, targetType, targetId, detail }) {
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_name, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, actorId || null, actorName || null, String(action), targetType || null, targetId || null, detail || null, Date.now());
}

export function listAudit(limit = 20) {
  return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

export { db, DB_PATH };
