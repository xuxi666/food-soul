import crypto from 'node:crypto';
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

  -- 全站内置 AI：总开关（单行，id=1）。配置本身在 site_ai_profiles。
  CREATE TABLE IF NOT EXISTS site_ai (
    id INTEGER PRIMARY KEY CHECK (id = 1),
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
    enabled INTEGER NOT NULL DEFAULT 0,
    enabled_at INTEGER,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );

  -- 全站内置 AI：最多 3 套服务配置
  CREATE TABLE IF NOT EXISTS site_ai_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
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
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  );

  -- 同一时刻最多一套启用：部分唯一索引由 SQLite 保证原子性
  CREATE UNIQUE INDEX IF NOT EXISTS idx_site_ai_profile_single_enabled
    ON site_ai_profiles(enabled) WHERE enabled = 1;

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

/* ---------------- 全站内置 AI 总开关：保证单行存在 ---------------- */
db.prepare(
  `INSERT OR IGNORE INTO site_ai
     (id, provider, base_url, model, key_cipher, key_iv, key_tag, key_version, updated_at)
   VALUES (1, '', '', '', '', '', '', 1, ?)`
).run(Date.now());

/* ---------------- 迁移：users.role ---------------- */
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

/* ---------------- 迁移：旧单套内置 AI → site_ai_profiles ---------------- */
const PROVIDER_LABEL = { deepseek: 'DeepSeek', zhipu: '智谱 AI', volcengine: '火山引擎', custom: '自定义' };
/**
 * 老版本把内置 AI 存在 site_ai 单行里。这里把它搬成第一套配置，
 * 保留原密文与验证状态；迁移后清空旧行密文，避免管理员删光配置后又被重建。
 */
(() => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM site_ai_profiles').get()?.c || 0;
  if (count > 0) return;
  const legacy = db.prepare('SELECT * FROM site_ai WHERE id = 1').get();
  if (!legacy || !legacy.key_cipher) return;
  const now = Date.now();
  db.prepare(
    `INSERT INTO site_ai_profiles
      (id, name, provider, base_url, model, key_cipher, key_iv, key_tag, key_version,
       verified_at, last_status, last_error, enabled, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    `${PROVIDER_LABEL[legacy.provider] || legacy.provider || '内置'} 默认配置`,
    legacy.provider || 'custom',
    legacy.base_url,
    legacy.model,
    legacy.key_cipher,
    legacy.key_iv,
    legacy.key_tag,
    legacy.key_version || 1,
    legacy.verified_at ?? null,
    legacy.last_status || 'unverified',
    legacy.last_error || null,
    legacy.enabled ? 1 : 0,
    legacy.updated_at || now,
    legacy.updated_at || now,
    legacy.updated_by || null
  );
  db.prepare("UPDATE site_ai SET key_cipher = '', key_iv = '', key_tag = '' WHERE id = 1").run();
  console.log('[db] 已将旧版内置 AI 配置迁移为 site_ai_profiles 的第一套配置');
})();

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

/* ---------------- 全站内置 AI ---------------- */

export function getSiteAIRow() {
  return db.prepare('SELECT * FROM site_ai WHERE id = 1').get() || null;
}

export function upsertSiteAIConfig(row) {
  db.prepare(
    `INSERT INTO site_ai
      (id, provider, base_url, model, key_cipher, key_iv, key_tag, key_version,
       verified_at, last_status, last_error, enabled, enabled_at, updated_by, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
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
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).run(
    row.provider,
    row.baseUrl,
    row.model,
    row.keyCipher,
    row.keyIv,
    row.keyTag,
    row.keyVersion,
    row.verifiedAt ?? null,
    row.lastStatus || 'unverified',
    row.lastError || null,
    row.updatedBy || null,
    Date.now()
  );
  return getSiteAIRow();
}

export function updateSiteAIStatus({ status, error, verifiedAt }) {
  db.prepare('UPDATE site_ai SET last_status = ?, last_error = ?, verified_at = ?, updated_at = ? WHERE id = 1').run(
    String(status || 'unknown'),
    error ? String(error).slice(0, 300) : null,
    verifiedAt ?? null,
    Date.now()
  );
}

/** 关闭时保留配置，只改开关；开启要求已验证 */
export function setSiteAIEnabled(enabled, by = '') {
  const now = Date.now();
  db.prepare(
    `INSERT INTO site_ai (id, provider, base_url, model, key_cipher, key_iv, key_tag, key_version,
       enabled, enabled_at, updated_by, updated_at)
     VALUES (1, '', '', '', '', '', '', 1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       enabled_at = excluded.enabled_at,
       updated_by = COALESCE(excluded.updated_by, site_ai.updated_by),
       updated_at = excluded.updated_at`
  ).run(enabled ? 1 : 0, enabled ? now : null, by || null, now);
  return getSiteAIRow();
}

/* ---------------- 内置 AI：多套配置（最多 3 套） ---------------- */

export const SITE_AI_MAX_PROFILES = 3;

export function listSiteProfiles() {
  return db.prepare('SELECT * FROM site_ai_profiles ORDER BY created_at ASC').all();
}

export function getSiteProfile(id) {
  return db.prepare('SELECT * FROM site_ai_profiles WHERE id = ?').get(String(id || '')) || null;
}

export function countSiteProfiles() {
  return db.prepare('SELECT COUNT(*) AS c FROM site_ai_profiles').get()?.c || 0;
}

export function getEnabledSiteProfile() {
  return db.prepare('SELECT * FROM site_ai_profiles WHERE enabled = 1').get() || null;
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* noop */
    }
    throw err;
  }
}

/** 新增配置：数量上限在事务内校验，避免并发插入超过 3 套 */
export function insertSiteProfile(row) {
  return tx(() => {
    const c = countSiteProfiles();
    if (c >= SITE_AI_MAX_PROFILES) {
      const err = new Error(`最多保存 ${SITE_AI_MAX_PROFILES} 套 AI 服务配置`);
      err.code = 'limit';
      throw err;
    }
    const now = Date.now();
    const id = row.id || crypto.randomUUID();
    db.prepare(
      `INSERT INTO site_ai_profiles
        (id, name, provider, base_url, model, key_cipher, key_iv, key_tag, key_version,
         verified_at, last_status, last_error, enabled, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      id,
      row.name,
      row.provider,
      row.baseUrl,
      row.model,
      row.keyCipher,
      row.keyIv,
      row.keyTag,
      row.keyVersion,
      row.verifiedAt ?? null,
      row.lastStatus || 'unverified',
      row.lastError || null,
      now,
      now,
      row.updatedBy || null
    );
    return getSiteProfile(id);
  });
}

export function updateSiteProfile(id, patch) {
  const cur = getSiteProfile(id);
  if (!cur) return null;
  db.prepare(
    `UPDATE site_ai_profiles SET
       name = ?, provider = ?, base_url = ?, model = ?,
       key_cipher = ?, key_iv = ?, key_tag = ?, key_version = ?,
       verified_at = ?, last_status = ?, last_error = ?, updated_at = ?, updated_by = ?
     WHERE id = ?`
  ).run(
    patch.name ?? cur.name,
    patch.provider ?? cur.provider,
    patch.baseUrl ?? cur.base_url,
    patch.model ?? cur.model,
    patch.keyCipher ?? cur.key_cipher,
    patch.keyIv ?? cur.key_iv,
    patch.keyTag ?? cur.key_tag,
    patch.keyVersion ?? cur.key_version,
    patch.verifiedAt === undefined ? cur.verified_at : patch.verifiedAt,
    patch.lastStatus ?? cur.last_status,
    patch.lastError === undefined ? cur.last_error : patch.lastError,
    Date.now(),
    patch.updatedBy ?? cur.updated_by,
    cur.id
  );
  return getSiteProfile(id);
}

export function deleteSiteProfile(id) {
  const info = db.prepare('DELETE FROM site_ai_profiles WHERE id = ?').run(String(id || ''));
  return info.changes > 0;
}

/** 切换启用：同一事务内先全量置 0 再置 1，杜绝两套同时启用 */
export function setEnabledSiteProfile(id, by = '') {
  const target = getSiteProfile(id);
  if (!target) return { ok: false, reason: 'not-found' };
  tx(() => {
    db.prepare('UPDATE site_ai_profiles SET enabled = 0, updated_at = ? WHERE enabled = 1').run(Date.now());
    db.prepare('UPDATE site_ai_profiles SET enabled = 1, updated_at = ?, updated_by = ? WHERE id = ?').run(
      Date.now(),
      by || null,
      target.id
    );
  });
  return { ok: true, profile: getSiteProfile(target.id) };
}

/** 停用指定配置（用于删除前的清理） */
export function disableSiteProfile(id) {
  db.prepare('UPDATE site_ai_profiles SET enabled = 0, updated_at = ? WHERE id = ?').run(Date.now(), String(id || ''));
}

export { db, DB_PATH };
