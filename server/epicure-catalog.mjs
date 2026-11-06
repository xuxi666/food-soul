import https from 'node:https';

// 线上服务器到 Cloudflare 的 IPv6 不通，这里同样强制 IPv4
const agentV4 = new https.Agent({ family: 4, keepAlive: true });
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

import { db } from './db.mjs';
import { LEXICON } from './epicure-lexicon.mjs';
import { CN_MAP } from './epicure-cn-map.mjs';

const STATUS_FILE = path.join(ROOT, 'data', 'epicure-mcp-status.json');

/**
 * Epicure 完整食材目录
 *
 * 数据源：官方站点公开接口 https://epicure.kaikaku.ai/api/ingredients
 * （页面搜索用的就是它，返回 1032 条，含分类、素食标记、原始出现次数）
 *
 * 注意：
 * - 该接口对 UA 有校验，curl 默认 UA 会被拒，这里固定用浏览器 UA；
 * - 中文名只来自我们核对过的词表，没有对应中文的条目留空，前端显示原始英文名，
 *   不编造翻译；别名同理。
 * - 同步只做 upsert，失败不会清空旧数据。
 */

const CATALOG_URL = process.env.EPICURE_CATALOG_URL || 'https://epicure.kaikaku.ai/api/ingredients';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 30000;

/** 官方 18 个分类的中文标签（仅用于展示，不改原始分类值） */
export const CATEGORY_CN = {
  Beverage: '饮品',
  Condiment: '调味品',
  Dairy: '乳制品',
  Fat: '油脂',
  Fish: '鱼类',
  Fruit: '水果',
  Grain: '谷物',
  Herbs: '香草',
  Legumes: '豆类',
  Meat: '肉类',
  Nuts: '坚果',
  Pantry: '厨房常备',
  Produce: '生鲜',
  Protein: '蛋白类',
  Seafood: '水产',
  Spice: '香料',
  Sweet: '甜味',
  Veg: '蔬菜',
};

/** 展示优先级：中国厨房最常用的类别排前面 */
export const CATEGORY_ORDER = [
  'Veg',
  'Meat',
  'Seafood',
  'Fish',
  'Spice',
  'Condiment',
  'Legumes',
  'Grain',
  'Produce',
  'Fruit',
  'Herbs',
  'Nuts',
  'Dairy',
  'Fat',
  'Pantry',
  'Protein',
  'Sweet',
  'Beverage',
];

/** 常用食材：按中文词表里已核对的中式高频项 + 官方 original_count 高者补足 */
const POPULAR_NAMES = new Set(
  [
    'pork',
    'beef',
    'chicken',
    'lamb',
    'duck',
    'tofu',
    'egg',
    'shiitake mushroom',
    'wood ear mushroom',
    'scallion',
    'ginger',
    'garlic',
    'soy sauce',
    'light soy sauce',
    'dark soy sauce',
    'vinegar',
    'rice wine',
    'doubanjiang',
    'sichuan peppercorn',
    'star anise',
    'chili',
    'dried chili',
    'sesame oil',
    'cabbage',
    'chinese napa cabbage',
    'daikon',
    'potato',
    'tomato',
    'eggplant',
    'cucumber',
    'rice',
    'flour',
    'noodle',
    'shrimp',
    'crab',
    'salt',
    'sugar',
    'cornstarch',
    'oyster sauce',
    'bok choy',
  ].map((s) => s.toLowerCase())
);

/** 名称归一：忽略下划线/空格差异、大小写 */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'user-agent': UA, accept: 'application/json', referer: 'https://epicure.kaikaku.ai/' },
        timeout: TIMEOUT,
        agent: agentV4,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`catalog-http-${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(new Error('catalog-bad-json'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('catalog-timeout')));
    req.on('error', reject);
  });
}

/** 中文映射：先挂人工译名表，再挂词表（词表优先级更高，含分类与别名） */
function buildCnIndex() {
  const byNorm = new Map();
  // 1) 词表（带分类、别名，优先）
  for (const item of LEXICON) {
    for (const cand of [item.cn, ...(item.candidates || [])]) {
      const key = normalizeName(cand);
      if (!key) continue;
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key).push({ cn: item.cn, aliases: [] });
    }
  }
  // 2) 人工译名表（只补没有的，不覆盖词表）
  for (const [name, cn] of Object.entries(CN_MAP)) {
    const key = normalizeName(name);
    if (!key || !cn) continue;
    if (!byNorm.has(key)) byNorm.set(key, [{ cn, aliases: [] }]);
  }
  return byNorm;
}

const upsert = () =>
  db.prepare(`
    INSERT INTO epicure_catalog (name, category, categories, is_vegan, is_vegetarian, original_count, cn, cn_aliases, active, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'epicure-api', ?)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category,
      categories = excluded.categories,
      is_vegan = excluded.is_vegan,
      is_vegetarian = excluded.is_vegetarian,
      original_count = excluded.original_count,
      cn = COALESCE(excluded.cn, epicure_catalog.cn),
      cn_aliases = CASE WHEN excluded.cn_aliases != '[]' THEN excluded.cn_aliases ELSE epicure_catalog.cn_aliases END,
      active = 1,
      updated_at = excluded.updated_at
  `);

let syncing = null;

/**
 * 全量同步（幂等）。并发调用只会跑一次。
 * @returns {Promise<{ok:boolean,total:number,added:number,updated:number,removed:number,ms:number,error?:string}>}
 */
export function syncCatalog() {
  if (syncing) return syncing;
  syncing = (async () => {
    const startedAt = Date.now();
    const logId = db
      .prepare('INSERT INTO epicure_sync_log (started_at, status) VALUES (?, ?)')
      .run(startedAt, 'running').lastInsertRowid;

    try {
      const payload = await fetchJson(CATALOG_URL);
      const list = Array.isArray(payload?.ingredients) ? payload.ingredients : [];
      if (!list.length) throw new Error('catalog-empty');

      const cnIndex = buildCnIndex();
      const before = new Set(db.prepare('SELECT name FROM epicure_catalog').all().map((r) => r.name));
      const now = Date.now();
      let added = 0;
      let updated = 0;
      let failed = 0;

      db.exec('BEGIN IMMEDIATE');
      try {
        const stmt = upsert();
        for (const it of list) {
          const name = String(it?.name || '').trim();
          if (!name) {
            failed += 1;
            continue;
          }
          const norm = normalizeName(name);
          const hit = cnIndex.get(norm) || [];
          const primary = hit[0] || null;
          const aliases = hit.map((h) => h.cn).filter((c) => c && c !== primary?.cn);
          const cats = Array.isArray(it.all_categories) && it.all_categories.length ? it.all_categories : [it.category].filter(Boolean);

          stmt.run(
            name,
            String(it.category || cats[0] || 'Pantry'),
            JSON.stringify(cats),
            it.is_vegan ? 1 : 0,
            it.is_vegetarian ? 1 : 0,
            Number(it.original_count) || 0,
            primary?.cn || null,
            JSON.stringify([...new Set(aliases)].slice(0, 6)),
            now
          );
          if (before.has(name)) updated += 1;
          else added += 1;
        }

        // 套用已实测的 MCP 可解析结果（data/epicure-mcp-status.json）
        try {
          const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
          const stmt = db.prepare('UPDATE epicure_catalog SET mcp_ok = ?, mcp_name = ? WHERE name = ?');
          for (const [name, v] of Object.entries(status.items || {})) {
            stmt.run(v.ok === 1 ? 1 : 0, v.mcp || null, name);
          }
        } catch {
          /* 没有校验文件就保持未验证状态 */
        }

        // 目录里已经没有的：标记 inactive，不删数据
        const names = new Set(list.map((i) => String(i?.name || '').trim()));
        let removed = 0;
        for (const n of before) {
          if (!names.has(n)) {
            db.prepare('UPDATE epicure_catalog SET active = 0, updated_at = ? WHERE name = ?').run(now, n);
            removed += 1;
          }
        }

        db.prepare(
          'UPDATE epicure_sync_log SET finished_at = ?, total = ?, added = ?, updated = ?, removed = ?, failed = ?, status = ?, note = ? WHERE id = ?'
        ).run(now, list.length, added, updated, removed, failed, 'ok', payload.sorted_by || '', logId);
        db.exec('COMMIT');

        return { ok: true, total: list.length, added, updated, removed, failed, ms: Date.now() - startedAt };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200);
      db.prepare('UPDATE epicure_sync_log SET finished_at = ?, status = ?, note = ? WHERE id = ?').run(
        Date.now(),
        'failed',
        msg,
        logId
      );
      return { ok: false, error: msg, total: 0, added: 0, updated: 0, removed: 0, ms: Date.now() - startedAt };
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** 数据库里是否已有目录 */
export function catalogReady() {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM epicure_catalog WHERE active = 1').get();
    return (row?.n || 0) > 0;
  } catch {
    return false;
  }
}

/** 统计：总量 / 有中文 / 可分析（有目录名即可分析）/ 最后同步 */
export function catalogStats() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN cn IS NOT NULL AND cn != '' THEN 1 ELSE 0 END) AS translated,
              SUM(CASE WHEN is_vegetarian = 1 THEN 1 ELSE 0 END) AS vegetarian,
              SUM(CASE WHEN is_vegan = 1 THEN 1 ELSE 0 END) AS vegan,
              SUM(CASE WHEN mcp_ok = 1 THEN 1 ELSE 0 END) AS analyzable,
              SUM(CASE WHEN mcp_ok = 0 THEN 1 ELSE 0 END) AS unanalyzable,
              SUM(CASE WHEN mcp_ok IS NULL THEN 1 ELSE 0 END) AS unverified
         FROM epicure_catalog WHERE active = 1`
    )
    .get() || {};
  const last = db
    .prepare("SELECT * FROM epicure_sync_log WHERE status IN ('ok','failed') ORDER BY id DESC LIMIT 1")
    .get();
  const running = db.prepare("SELECT COUNT(*) AS n FROM epicure_sync_log WHERE status = 'running'").get();
  return {
    // total 与列表口径一致：只算有中文名的
    total: row.translated || 0,
    translated: row.translated || 0,
    catalogTotal: row.total || 0,
    vegetarian: row.vegetarian || 0,
    vegan: row.vegan || 0,
    // 只有经过 MCP 实测能解析的才算可分析
    analyzable: row.analyzable || 0,
    unanalyzable: row.unanalyzable || 0,
    unverified: row.unverified || 0,
    lastSyncAt: last?.finished_at || last?.started_at || null,
    lastSync: last
      ? {
          status: last.status,
          total: last.total,
          added: last.added,
          updated: last.updated,
          removed: last.removed,
          failed: last.failed,
          note: last.note,
        }
      : null,
    syncing: (running?.n || 0) > 0,
  };
}

/**
 * 分页查询（服务端搜索，前端不必一次渲染上千条）
 * @param {{q?:string,category?:string,mode?:'all'|'popular'|'translated',page?:number,pageSize?:number}} opts
 */
export function queryCatalog(opts = {}) {
  const q = String(opts.q || '').trim();
  const category = String(opts.category || '').trim();
  const mode = ['all', 'popular', 'translated'].includes(opts.mode) ? opts.mode : 'all';
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(60, Math.max(6, Number(opts.pageSize) || 30));

  // 只展示有中文名的食材：没有译名的不进列表，也不参与搜索
  const where = ["active = 1", "cn IS NOT NULL", "cn != ''"];
  const args = [];
  if (category && category !== 'all') {
    where.push('(category = ? OR categories LIKE ?)');
    args.push(category, `%"${category}"%`);
  }
  if (opts.vegetarian) where.push('is_vegetarian = 1');
  if (opts.vegan) where.push('is_vegan = 1');
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    where.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(cn,\'\')) LIKE ? OR LOWER(cn_aliases) LIKE ?)');
    args.push(like, like, like);
  }

  // 按指定中文名批量取（起点推荐用），保持传入顺序
  if (Array.isArray(opts.names) && opts.names.length) {
    const names = opts.names.map((n) => String(n).slice(0, 20)).slice(0, 20);
    const ph = names.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM epicure_catalog WHERE active = 1 AND cn IN (${ph})`)
      .all(...names);
    const order = new Map(names.map((n, i) => [n, i]));
    rows.sort((a, b) => (order.get(a.cn) ?? 99) - (order.get(b.cn) ?? 99));
    // 同一中文名可能对应多个官方条目（如 阿魏/阿魏），只留能算风味的那个
    const seen = new Map();
    for (const r of rows) {
      const prev = seen.get(r.cn);
      if (!prev || (r.mcp_ok === 1 && prev.mcp_ok !== 1)) seen.set(r.cn, r);
    }
    const deduped = [...seen.values()].sort((a, b) => (order.get(a.cn) ?? 99) - (order.get(b.cn) ?? 99));
    rows.length = 0;
    rows.push(...deduped);
    return {
      total: rows.length,
      page: 1,
      pageSize: rows.length,
      hasMore: false,
      items: rows.map(mapRow),
    };
  }

  const whereSql = where.join(' AND ');
  let rows;
  let total;
  if (mode === 'popular' && !q && (!category || category === 'all')) {
    // 常用：先按人工清单，再按原始出现次数补足
    const all = db
      .prepare(`SELECT * FROM epicure_catalog WHERE ${whereSql} ORDER BY original_count DESC`)
      .all(...args);
    const picked = all.filter((r) => POPULAR_NAMES.has(normalizeName(r.name)));
    const rest = all.filter((r) => !POPULAR_NAMES.has(normalizeName(r.name)));
    const merged = [...picked, ...rest];
    total = merged.length;
    rows = merged.slice((page - 1) * pageSize, page * pageSize);
  } else {
    total = db.prepare(`SELECT COUNT(*) AS n FROM epicure_catalog WHERE ${whereSql}`).get(...args)?.n || 0;
    rows = db
      .prepare(`SELECT * FROM epicure_catalog WHERE ${whereSql} ORDER BY original_count DESC, name ASC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize);
  }

  return {
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    items: rows.map((r) => ({
      name: r.name,
      cn: r.cn || '',
      display: r.cn || r.name,
      category: r.category,
      categoryCn: CATEGORY_CN[r.category] || r.category,
      categories: safeArray(r.categories),
      isVegan: Boolean(r.is_vegan),
      isVegetarian: Boolean(r.is_vegetarian),
      originalCount: r.original_count,
      aliases: safeArray(r.cn_aliases),
      translated: Boolean(r.cn),
      analyzable: r.mcp_ok === 1,
      mcpName: r.mcp_name || r.name,
      popular: POPULAR_NAMES.has(normalizeName(r.name)),
    })),
  };
}

function mapRow(r) {
  return {
    name: r.name,
    cn: r.cn || '',
    display: r.cn || r.name,
    category: r.category,
    categoryCn: CATEGORY_CN[r.category] || r.category,
    categories: safeArray(r.categories),
    isVegan: Boolean(r.is_vegan),
    isVegetarian: Boolean(r.is_vegetarian),
    originalCount: r.original_count,
    aliases: safeArray(r.cn_aliases),
    translated: Boolean(r.cn),
    analyzable: r.mcp_ok === 1,
    mcpName: r.mcp_name || null,
    popular: POPULAR_NAMES.has(normalizeName(r.name)),
  };
}

function safeArray(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 分类列表（带中文标签与计数） */
export function catalogCategories() {
  const rows = db
    .prepare('SELECT category, COUNT(*) AS n FROM epicure_catalog WHERE active = 1 GROUP BY category')
    .all();
  const map = new Map(rows.map((r) => [r.category, r.n]));
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
    id: c,
    name: CATEGORY_CN[c] || c,
    count: map.get(c) || 0,
  }));
}

/** 按名称/中文名找一条（供网络与生成用） */
export function findCatalogEntry(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const norm = normalizeName(raw);
  const row =
    db.prepare('SELECT * FROM epicure_catalog WHERE name = ? COLLATE NOCASE LIMIT 1').get(raw) ||
    db.prepare('SELECT * FROM epicure_catalog WHERE LOWER(name) = ? LIMIT 1').get(norm) ||
    db.prepare("SELECT * FROM epicure_catalog WHERE cn = ? LIMIT 1").get(raw) ||
    db.prepare("SELECT * FROM epicure_catalog WHERE cn_aliases LIKE ? LIMIT 1").get(`%"${raw}"%`);
  if (!row) return null;
  return {
    name: row.name,
    mcpName: row.mcp_name || row.name,
    mcpOk: row.mcp_ok,
    cn: row.cn || '',
    display: row.cn || row.name,
    category: row.category,
    categoryCn: CATEGORY_CN[row.category] || row.category,
    isVegan: Boolean(row.is_vegan),
    isVegetarian: Boolean(row.is_vegetarian),
    translated: Boolean(row.cn),
  };
}
