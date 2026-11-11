import { db } from './db.mjs';

/**
 * 服务健康记录（后台「服务状态」面板的唯一数据来源）
 * ------------------------------------------------------------
 * 只记录**真实探测过**的结果：成功/失败时间分开保存，失败时连同错误类别一起存，
 * 后台据此显示「上次成功 / 上次失败 / 最近错误」，而不是根据「配置里有没有 URL」猜在线。
 *
 * 目前只有 epicure 一项（外部 MCP）。内置 AI 的状态来自 site_ai / site_ai_profiles
 * 的实测字段（verified_at / last_status / last_error），不写这张表，两者互不混淆。
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS service_health (
    service TEXT PRIMARY KEY,
    ok INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    label TEXT,
    error TEXT,
    endpoint TEXT,
    duration_ms INTEGER,
    tool_count INTEGER,
    checked_at INTEGER NOT NULL,
    last_ok_at INTEGER,
    last_fail_at INTEGER,
    detail TEXT
  );
`);

const getStmt = db.prepare('SELECT * FROM service_health WHERE service = ?');
const allStmt = db.prepare('SELECT * FROM service_health ORDER BY checked_at DESC');

function hydrate(row) {
  if (!row) return null;
  let detail = null;
  try {
    detail = row.detail ? JSON.parse(row.detail) : null;
  } catch {
    detail = null;
  }
  return {
    service: row.service,
    ok: Boolean(row.ok),
    category: row.category || '',
    label: row.label || '',
    error: row.error || '',
    endpoint: row.endpoint || '',
    durationMs: Number(row.duration_ms || 0),
    toolCount: row.tool_count === null || row.tool_count === undefined ? null : Number(row.tool_count),
    checkedAt: Number(row.checked_at || 0),
    lastOkAt: row.last_ok_at ? Number(row.last_ok_at) : 0,
    lastFailAt: row.last_fail_at ? Number(row.last_fail_at) : 0,
    detail,
  };
}

export function readServiceHealth(service) {
  return hydrate(getStmt.get(service));
}

export function listServiceHealth() {
  return allStmt.all().map(hydrate);
}

/**
 * 写入一次探测结果。
 * 成功只刷新 last_ok_at，失败只刷新 last_fail_at —— 两个时间都要保留，不能互相覆盖。
 */
export function recordServiceHealth(service, result = {}) {
  const now = Number(result.checkedAt) || Date.now();
  const prev = readServiceHealth(service);
  const ok = Boolean(result.ok);
  const lastOkAt = ok ? now : prev?.lastOkAt || 0;
  const lastFailAt = ok ? prev?.lastFailAt || 0 : now;
  const detail = result.detail ? JSON.stringify(result.detail).slice(0, 4000) : prev?.detail ? JSON.stringify(prev.detail) : null;

  db.prepare(
    `INSERT INTO service_health
       (service, ok, category, label, error, endpoint, duration_ms, tool_count, checked_at, last_ok_at, last_fail_at, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(service) DO UPDATE SET
       ok = excluded.ok,
       category = excluded.category,
       label = excluded.label,
       error = excluded.error,
       endpoint = excluded.endpoint,
       duration_ms = excluded.duration_ms,
       tool_count = excluded.tool_count,
       checked_at = excluded.checked_at,
       last_ok_at = excluded.last_ok_at,
       last_fail_at = excluded.last_fail_at,
       detail = excluded.detail`
  ).run(
    service,
    ok ? 1 : 0,
    String(result.category || '').slice(0, 40),
    String(result.label || '').slice(0, 120),
    String(result.error || '').slice(0, 400),
    String(result.endpoint || '').slice(0, 200),
    Number(result.ms || 0) || 0,
    result.toolCount === null || result.toolCount === undefined ? null : Number(result.toolCount),
    now,
    lastOkAt,
    lastFailAt,
    detail
  );

  return readServiceHealth(service);
}