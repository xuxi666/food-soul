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
`);

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
      `SELECT s.user_id, s.expires_at, u.email, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(String(tokenHash || ''));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: row.user_id, email: row.email, name: row.name };
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

export { db, DB_PATH };
