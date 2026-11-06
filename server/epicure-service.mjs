import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { callTool } from './epicure-client.mjs';
import { LEXICON, CATEGORIES, findEntry } from './epicure-lexicon.mjs';

/**
 * Epicure 业务层：把「中文食材 + 用户意图」翻译成真实的工具调用，
 * 并把结果整理成前端能直接渲染的结构。
 *
 * 约束：
 * - 所有食材先过中文词表，未验证的食材不参与计算，也不编造关系；
 * - 关系只来自 neighbors / pairing_score 的真实返回；
 * - 中国美食约束在服务端做二次筛选（菜系标签 + 食材类别白名单）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEXICON_FILE = path.join(ROOT, 'data', 'epicure-lexicon.json');

let cache = null; // { at, items: Map<epicure, entry>, byCn: Map<cn, entry> }

/** 读取校验后的词表；按 Epicure 规范名去重（同名的保留最常见中文名，其余记为别名） */
export function loadLexicon() {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache;

  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(LEXICON_FILE, 'utf8'));
  } catch {
    raw = null;
  }
  // 没有校验文件时退回源词表（此时不保证全部可解析）
  const items = raw?.items?.length
    ? raw.items
    : LEXICON.map((e) => ({ id: e.id, cn: e.cn, cat: e.cat, epicure: e.candidates[0], cuisineRegion: null, foodGroup: null }));

  const byEpicure = new Map();
  for (const it of items) {
    const key = it.epicure;
    const prev = byEpicure.get(key);
    if (!prev) {
      byEpicure.set(key, { ...it, aliases: [] });
    } else if (it.cn.length < prev.cn.length) {
      // 更短的中文名更适合当主名
      byEpicure.set(key, { ...it, aliases: [...prev.aliases, prev.cn, ...(prev.aliases || [])] });
    } else {
      prev.aliases.push(it.cn);
    }
  }

  const byCn = new Map();
  for (const entry of byEpicure.values()) {
    byCn.set(entry.cn, entry);
    for (const a of entry.aliases) byCn.set(a, entry);
  }

  cache = {
    at: Date.now(),
    generatedAt: raw?.generatedAt || null,
    verified: raw?.verified ?? items.length,
    total: raw?.total ?? LEXICON.length,
    categories: CATEGORIES,
    items: [...byEpicure.values()],
    byCn,
    byEpicure,
    unresolved: raw?.unresolved || [],
  };
  return cache;
}

/** 中文 / 拼音 / 英文 → 词表条目；查不到返回 null */
export function resolveIngredient(input) {
  const lex = loadLexicon();
  const raw = String(input || '').trim();
  if (!raw) return null;
  const hit = lex.byCn.get(raw) || lex.byEpicure.get(raw.toLowerCase());
  if (hit) return hit;
  const src = findEntry(raw);
  if (!src) return null;
  return lex.byCn.get(src.cn) || lex.byEpicure.get(src.candidates[0]) || null;
}

/**
 * 中国美食约束：Epicure 的 cuisine_region 是分号分隔的多标签，
 * 含 East_Asian 或 universal 视为可进入中国菜创作；其余（如 Japanese/Latin_American 独占）降权。
 */
export function chinaAffinity(entry) {
  const region = String(entry?.cuisineRegion || '');
  if (!region) return { ok: true, reason: 'unknown-region' };
  const tags = region.split(';').map((s) => s.trim());
  if (tags.includes('East_Asian')) return { ok: true, reason: 'east-asian' };
  if (tags.includes('universal')) return { ok: true, reason: 'universal' };
  return { ok: false, reason: region };
}

/** 单个食材的真实近邻（用于关系网络） */
export async function neighborsOf(entry, topK = 8) {
  const r = await callTool('neighbors', { ingredient: entry.epicure, top_k: topK }, { timeout: 12000 });
  if (!r.ok || !r.data?.neighbors) return { ok: false, error: r.error, items: [] };
  const lex = loadLexicon();
  const items = r.data.neighbors
    .map((n) => {
      const known = lex.byEpicure.get(n.name);
      return {
        epicure: n.name,
        cn: known?.cn || n.name,
        cat: known?.cat || null,
        known: Boolean(known),
        sim: Number(n.sim),
        rank: n.rank,
        cuisineRegion: known?.cuisineRegion || null,
        foodGroup: known?.foodGroup || null,
      };
    })
    .filter((n) => n.known || Number.isFinite(n.sim));
  return { ok: true, items, ms: r.ms, cached: Boolean(r.cached) };
}

/**
 * 构建风味关系网络。
 * 结构：centers（用户选中）→ 关联节点（neighbors 一级）→ 延伸节点（一级里最靠前的若干再取近邻）
 * 只画真实返回的边，边权为余弦相似度。
 */
export async function buildNetwork(inputIds, opts = {}) {
  const lex = loadLexicon();
  const centers = [];
  const unresolved = [];
  for (const id of inputIds) {
    const e = resolveIngredient(id);
    if (e) centers.push(e);
    else unresolved.push(String(id));
  }
  if (!centers.length) return { ok: false, error: 'no-valid-ingredient', unresolved, nodes: [], edges: [] };

  const depth = Math.min(2, Math.max(1, Number(opts.depth) || 2));
  const perNode = Math.min(12, Math.max(3, Number(opts.topK) || 8));
  const expandFrom = Math.min(3, Math.max(0, Number(opts.expand) ?? 2));

  const nodes = new Map(); // epicure -> node
  const edges = [];
  const pushNode = (data, level) => {
    const prev = nodes.get(data.epicure);
    if (prev) {
      if (level < prev.level) prev.level = level;
      return prev;
    }
    const node = { ...data, level };
    nodes.set(data.epicure, node);
    return node;
  };

  centers.forEach((c) => pushNode({ epicure: c.epicure, cn: c.cn, cat: c.cat, known: true, sim: 1, foodGroup: c.foodGroup, cuisineRegion: c.cuisineRegion }, 0));

  // 一级：每个中心食材的真实近邻
  const level1 = new Map(); // centerEpicure -> neighbors[]
  await Promise.all(
    centers.map(async (c) => {
      const r = await neighborsOf(c, perNode);
      level1.set(c.epicure, r.items);
      for (const n of r.items) {
        pushNode(n, 1);
        edges.push({ from: c.epicure, to: n.epicure, weight: n.sim, kind: 'similar' });
      }
    })
  );

  // 二级：从相似度最高的一级节点继续扩展
  if (depth >= 2 && expandFrom > 0) {
    const seeds = [...level1.values()]
      .flat()
      .sort((a, b) => b.sim - a.sim)
      .slice(0, expandFrom);
    await Promise.all(
      seeds.map(async (s) => {
        const r = await neighborsOf({ epicure: s.epicure }, Math.max(3, Math.floor(perNode / 2)));
        for (const n of r.items) {
          if (nodes.has(n.epicure) && nodes.get(n.epicure).level <= 2) {
            // 已有节点：只补边，避免重复节点
          }
          pushNode(n, 2);
          if (!edges.some((e) => e.from === s.epicure && e.to === n.epicure)) {
            edges.push({ from: s.epicure, to: n.epicure, weight: n.sim, kind: 'similar' });
          }
        }
      })
    );
  }

  const nodeList = [...nodes.values()].map((n) => {
    const aff = chinaAffinity(n);
    return { ...n, chinaFriendly: aff.ok, chinaReason: aff.reason };
  });

  return {
    ok: true,
    centers: centers.map((c) => c.epicure),
    nodes: nodeList,
    edges,
    unresolved,
    stats: {
      nodes: nodeList.length,
      edges: edges.length,
      unknown: nodeList.filter((n) => !n.known).length,
      lexicon: { verified: lex.verified, total: lex.total },
    },
  };
}

/** 两种食材的真实搭配分 */
export async function pairingOf(a, b) {
  const ea = resolveIngredient(a);
  const eb = resolveIngredient(b);
  if (!ea || !eb) return { ok: false, error: 'unresolved', missing: [!ea ? a : null, !eb ? b : null].filter(Boolean) };
  const r = await callTool('pairing_score', { ingredient_a: ea.epicure, ingredient_b: eb.epicure });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, a: { cn: ea.cn, epicure: ea.epicure }, b: { cn: eb.cn, epicure: eb.epicure }, text: r.text, data: r.data, ms: r.ms };
}

/** 食材库：给前端的分组列表 */
export function ingredientLibrary() {
  const lex = loadLexicon();
  return {
    categories: lex.categories,
    total: lex.items.length,
    verified: lex.verified,
    items: lex.items.map((i) => ({
      id: i.id,
      cn: i.cn,
      epicure: i.epicure,
      cat: i.cat,
      aliases: i.aliases,
      foodGroup: i.foodGroup,
      cuisineRegion: i.cuisineRegion,
      chinaFriendly: chinaAffinity(i).ok,
    })),
    unresolved: lex.unresolved.map((u) => u.cn),
  };
}
