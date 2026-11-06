import fs from 'node:fs';
import path from 'node:path';

import { db } from './db.mjs';
import { LEXICON } from './epicure-lexicon.mjs';

/**
 * 食材名称解析（统一显示层）
 *
 * 图谱节点、搜索结果、已选标签都走这里，避免在绘制代码里散落硬编码。
 * 解析顺序（越靠前越权威）：
 *   1. 项目词表（人工核对，带别名）
 *   2. Epicure 官网目录（1032 条，含中文名）
 *   3. MCP 专属名映射（目录里没有、只在 MCP 出现的名字）
 *   4. 兜底：原样显示（下划线换成空格），标记 translated=false，不猜
 *
 * 注意：只做显示，不改变传给 Epicure 的原始名。
 */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();

let mcpMapCache = null;
function loadMcpMap() {
  if (mcpMapCache) return mcpMapCache;
  try {
    const file = path.join(process.cwd(), 'data', 'epicure-mcp-cn.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    mcpMapCache = new Map(
      Object.entries(raw)
        .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
        .map(([k, v]) => [norm(k), v.trim()])
    );
  } catch {
    mcpMapCache = new Map();
  }
  return mcpMapCache;
}

let lexIndex = null;
function lexiconIndex() {
  if (lexIndex) return lexIndex;
  const byEpicure = new Map();
  for (const item of LEXICON) {
    for (const cand of [item.epicure, ...(item.candidates || [])]) {
      const k = norm(cand);
      if (k && !byEpicure.has(k)) byEpicure.set(k, item.cn);
    }
  }
  lexIndex = byEpicure;
  return lexIndex;
}

/** 目录缓存：name(归一) -> cn */
let catalogIndex = null;
let catalogStamp = 0;
function catalogIndexSafe() {
  try {
    const stamp = db.prepare('SELECT COUNT(*) AS n FROM epicure_catalog').get()?.n || 0;
    if (catalogIndex && stamp === catalogStamp) return catalogIndex;
    const map = new Map();
    for (const r of db.prepare('SELECT name, cn FROM epicure_catalog').all()) {
      if (r.cn) map.set(norm(r.name), r.cn);
    }
    catalogIndex = map;
    catalogStamp = stamp;
    return map;
  } catch {
    return catalogIndex || new Map();
  }
}

/** 把下划线名变成可读英文：yu_choy → Yu Choy */
function prettify(name) {
  return String(name || '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * @param {string} name Epicure 原始食材名（可能是 yu_choy 这种下划线写法）
 * @returns {{name:string, display:string, translated:boolean, source:'lexicon'|'catalog'|'mcp-map'|'raw'}}
 */
export function resolveDisplay(name) {
  const raw = String(name || '').trim();
  const key = norm(raw);
  if (!key) return { name: raw, display: raw, translated: false, source: 'raw' };

  const lex = lexiconIndex().get(key);
  if (lex) return { name: raw, display: lex, translated: true, source: 'lexicon' };

  const cat = catalogIndexSafe().get(key);
  if (cat) return { name: raw, display: cat, translated: true, source: 'catalog' };

  const mcp = loadMcpMap().get(key);
  if (mcp) return { name: raw, display: mcp, translated: true, source: 'mcp-map' };

  // 兜底：界面上不出现英文，统一显示「未收录」，原文放到 original 供 tooltip 使用
  return { name: raw, display: '未收录', translated: false, source: 'raw', original: prettify(raw) };
}

/** 只取显示名 */
export function displayNameOf(name) {
  return resolveDisplay(name).display;
}

/** 测试用：清空缓存 */
export function __resetNameCache() {
  mcpMapCache = null;
  lexIndex = null;
  catalogIndex = null;
  catalogStamp = 0;
}
