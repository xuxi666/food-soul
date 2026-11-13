/**
 * 营养分析缓存。
 *
 * 缓存键只包含会影响计算结果的输入：菜名、食材、用量、单位、份数、
 * 是否允许典型份量估算、是否使用典型菜模板和营养数据库版本。份数或任一用量变化
 * 都会生成新键，不会复用旧结果。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'nutrition-cache.json');
const TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const memory = new Map();
let disk = null;
let writeTimer = 0;

function loadDisk() {
  if (disk) return disk;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    disk = parsed && typeof parsed === 'object' ? parsed : { entries: {} };
  } catch {
    disk = { entries: {} };
  }
  if (!disk.entries || typeof disk.entries !== 'object') disk.entries = {};
  return disk;
}

function prune(entries) {
  const now = Date.now();
  const rows = Object.entries(entries)
    .filter(([, v]) => v && Number(v.at) && now - Number(v.at) <= TTL)
    .sort((a, b) => Number(b[1].at) - Number(a[1].at))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(rows);
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = 0;
    try {
      const data = loadDisk();
      data.entries = prune(data.entries);
      data.savedAt = Date.now();
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, 'utf8');
      fs.renameSync(tmp, FILE);
    } catch {
      /* 缓存失败不影响分析 */
    }
  }, 120);
  if (typeof writeTimer.unref === 'function') writeTimer.unref();
}

export function cacheKey(input, dataVersion) {
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map((x) => [
      String(x.name || '').normalize('NFKC').trim().toLowerCase(),
      Number.isFinite(Number(x.amount)) ? Number(x.amount) : null,
      String(x.unit || '').normalize('NFKC').trim().toLowerCase(),
      String(x.role || '').trim(),
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const raw = JSON.stringify({
    v: dataVersion,
    dish: String(input.dishName || '').normalize('NFKC').trim().toLowerCase(),
    servings: Number(input.servings) || null,
    allow: Boolean(input.allowTypicalPortions),
    template: Boolean(input.templateUsed),
    ingredients,
  });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

export function getCached(key) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at <= TTL) return hit.value;
  if (hit) memory.delete(key);
  const data = loadDisk();
  const row = data.entries[key];
  if (!row || !Number(row.at) || Date.now() - Number(row.at) > TTL) return null;
  memory.set(key, { at: Number(row.at), value: row.value });
  return row.value;
}

export function setCached(key, value) {
  const at = Date.now();
  memory.set(key, { at, value });
  if (memory.size > 500) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) memory.delete(oldest[0]);
  }
  const data = loadDisk();
  data.entries[key] = { at, value };
  scheduleWrite();
}