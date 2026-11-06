import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { callTool } from './epicure-client.mjs';
import { LEXICON, CATEGORIES, findEntry } from './epicure-lexicon.mjs';
import { findCatalogEntry, catalogReady } from './epicure-catalog.mjs';
import { resolveDisplay } from './epicure-names.mjs';

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

  // 1) 中文词表（有核对过的中文名）
  const hit = lex.byCn.get(raw) || lex.byEpicure.get(raw.toLowerCase());
  if (hit) return hit;
  const src = findEntry(raw);
  if (src) {
    const viaSrc = lex.byCn.get(src.cn) || lex.byEpicure.get(src.candidates[0]);
    if (viaSrc) return viaSrc;
  }

  // 2) MCP 专属名（官网目录里没有，但 Epicure 能算）：能解析出中文名就接受
  const shown = resolveDisplay(raw);
  if (shown.translated && shown.source === 'mcp-map') {
    return {
      id: raw,
      cn: shown.display,
      epicure: raw,
      cat: null,
      aliases: [],
      foodGroup: null,
      cuisineRegion: null,
      translated: true,
      vegetarian: true,
      vegan: false,
    };
  }

  // 3) 完整目录兜底：优先用词表里同名食材的 MCP 已验证名
  //    （目录名和 MCP 词表偶有拼写差异，如 szechuan peppercorn vs sichuan_peppercorn）
  if (catalogReady()) {
    const c = findCatalogEntry(raw);
    if (c) {
      const lexSame = lex.byCn.get(c.cn || '');
      if (lexSame) return lexSame;
      return {
        id: c.name,
        cn: c.display,
        epicure: c.mcpName || c.name,
        cat: null,
        aliases: [],
        foodGroup: c.category,
        cuisineRegion: null,
        translated: c.translated,
        vegetarian: c.isVegetarian,
        vegan: c.isVegan,
      };
    }
  }
  return null;
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
      const cat = known || (catalogReady() ? findCatalogEntry(n.name) : null);
      // 统一显示名：词表 → 目录 → MCP 专属映射 → 原始名
      const shown = resolveDisplay(n.name);
      return {
        epicure: n.name, // 原始名，传给 Epicure 的参数不变
        cn: shown.display,
        display: shown.display,
        nameSource: shown.source,
        cat: known?.cat || null,
        known: shown.translated,
        sim: Number(n.sim),
        rank: n.rank,
        cuisineRegion: known?.cuisineRegion || null,
        foodGroup: cat?.foodGroup || cat?.category || null,
        translated: shown.translated,
      };
    })
    .filter((n) => Number.isFinite(n.sim));
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

  centers.forEach((c) =>
    pushNode(
      {
        epicure: c.epicure,
        cn: c.cn,
        display: c.cn,
        cat: c.cat,
        known: true,
        translated: true,
        nameSource: 'center',
        sim: 1,
        foodGroup: c.foodGroup,
        cuisineRegion: c.cuisineRegion,
      },
      0
    )
  );

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

  const noData = centers.filter((c) => !edges.some((e) => e.from === c.epicure)).map((c) => c.cn);

  return {
    ok: true,
    centers: centers.map((c) => c.epicure),
    nodes: nodeList,
    edges,
    unresolved,
    noData,
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
const POPULAR_IDS = new Set([
  'zhurou', 'wuhuarou', 'niurou', 'jirou', 'yu', 'xia',
  'baicai', 'xiaobaicai', 'luobo', 'tudou', 'qiezi', 'fanqie', 'huanggua',
  'xianggu', 'muer', 'doufu', 'jidan',
  'cong', 'jiang', 'suan', 'xiangcai', 'ganlajiao', 'huajiao', 'bajiao',
  'jiangyou', 'shengchou', 'cu', 'liaojiu', 'doubanjiang', 'yan',
]);

export function ingredientLibrary() {
  const lex = loadLexicon();
  return {
    categories: lex.categories,
    total: lex.items.length,
    verified: lex.verified,
    items: lex.items.map((i) => {
      const group = String(i.foodGroup || '').toLowerCase();
      const cat = i.cat;
      const nonVeg = cat === 'meat' || cat === 'seafood' || /meat|fish|seafood/.test(group);
      const dairy = cat === 'dairy' || /dairy|egg/.test(group);
      return {
        id: i.id,
        cn: i.cn,
        epicure: i.epicure,
        cat,
        aliases: i.aliases,
        foodGroup: i.foodGroup,
        cuisineRegion: i.cuisineRegion,
        chinaFriendly: chinaAffinity(i).ok,
        vegetarian: !nonVeg,
        vegan: !nonVeg && !dairy,
        // 常用：按中式厨房真实高频挑，不用词表顺序（否则全是肉类水产）
        popular: POPULAR_IDS.has(i.id),
      };
    }),
    unresolved: lex.unresolved.map((u) => u.cn),
  };
}

/* ============================================================
 * 13 个工具的封装层
 * - 参数按官方 tools/list 的真实 Schema 校验（必填/类型/范围）
 * - 食材字段统一走中文词表映射，映射不到就明确报错，不偷换成别的食材
 * - 记录本次用到哪些工具，供前端与提示词使用
 * ============================================================ */

const INT = (v, min, max, fallback) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const NUM = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
};

export const TOOL_SPECS = {
  compare_on_axis: { required: ['ingredient_a', 'ingredient_b', 'axis'], ingredient: ['ingredient_a', 'ingredient_b'], text: ['axis'] },
  pairing_score: { required: ['ingredient_a', 'ingredient_b'], ingredient: ['ingredient_a', 'ingredient_b'] },
  find_pairings: { required: ['ingredients'], ingredientList: ['ingredients'], bool: ['is_vegan', 'is_vegetarian'] },
  flavour_correlations: { optional: { limit: [1, 100], min_abs_correlation: [0, 1] } },
  cultural_profile: { required: ['ingredient'], ingredient: ['ingredient'] },
  neighbors: { required: ['ingredient'], ingredient: ['ingredient'], optional: { top_k: [1, 50] } },
  morph: { required: ['seed', 'target'], ingredient: ['seed'], morphTarget: true, optional: { angle_deg: [0, 180], top_k: [1, 50] } },
  list_targets: { optional: { limit: [1, 50], offset: [0, 10000] }, enum: { kind: ['direction', 'mode'] } },
  list_factors: { optional: { min_coherence: [0, 1] }, bool: ['include_examples'] },
  ingredient_on_factor: { required: ['ingredient', 'factor'], ingredient: ['ingredient'], ints: { factor: [0, 19] } },
  pareto_navigate: { required: ['seed', 'pole'], ingredient: ['seed'], pole: true, optional: { top_k_poles: [1, 10], max_frontier: [1, 25] } },
  closest_mode: { required: ['ingredient'], ingredient: ['ingredient'], optional: { top_k: [1, 20] } },
  where_on_atlas: { required: ['ingredient'], ingredient: ['ingredient'], optional: { top_k_neighbors_2d: [1, 25] } },
};

function coerceArgs(spec, raw) {
  const out = {};
  const resolved = [];
  const missing = [];

  for (const key of spec.required || []) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') missing.push(key);
  }
  if (missing.length) return { ok: false, error: `缺少参数：${missing.join(', ')}`, missing };

  for (const key of spec.ingredient || []) {
    if (raw[key] === undefined) continue;
    const entry = resolveIngredient(raw[key]);
    if (!entry) return { ok: false, error: `食材「${String(raw[key]).slice(0, 20)}」未收录，无法计算`, unresolved: raw[key] };
    out[key] = entry.epicure;
    resolved.push({ field: key, cn: entry.cn, epicure: entry.epicure });
  }

  for (const key of spec.ingredientList || []) {
    const list = Array.isArray(raw[key]) ? raw[key] : raw[key] ? [raw[key]] : [];
    if (!list.length) return { ok: false, error: `缺少参数：${key}`, missing: [key] };
    const mapped = [];
    for (const item of list.slice(0, 12)) {
      const entry = resolveIngredient(item);
      if (!entry) return { ok: false, error: `食材「${String(item).slice(0, 20)}」未收录，无法计算`, unresolved: item };
      mapped.push(entry.epicure);
      resolved.push({ field: key, cn: entry.cn, epicure: entry.epicure });
    }
    out[key] = mapped;
  }

  // morph.target：官方是判别联合，字符串按「方向」处理
  if (spec.morphTarget) {
    const t = raw.target;
    if (typeof t === 'string' && t.trim()) {
      out.target = { kind: 'direction', name: t.trim().slice(0, 60) };
    } else if (t && typeof t === 'object' && ['direction', 'mode', 'ingredient'].includes(t.kind)) {
      out.target = t;
    } else {
      return { ok: false, error: 'target 需为方向名，或 {kind:"direction"|"mode"|"ingredient", ...}' };
    }
  }

  // pareto_navigate.pole：{factor:0-19, side:"a"|"b"}
  if (spec.pole) {
    const pl = raw.pole;
    const factor = Number(pl?.factor);
    const side = String(pl?.side || '');
    if (!Number.isInteger(factor) || factor < 0 || factor > 19 || !['a', 'b'].includes(side)) {
      return { ok: false, error: 'pole 需为 {factor: 0-19, side: "a"|"b"}' };
    }
    out.pole = { factor, side };
  }

  for (const [key, [min, max]] of Object.entries(spec.ints || {})) {
    if (raw[key] === undefined || raw[key] === '') continue;
    const v = INT(raw[key], min, max, undefined);
    if (v === undefined) return { ok: false, error: `${key} 需为 ${min}-${max} 的整数` };
    out[key] = v;
  }

  for (const key of spec.text || []) {
    if (raw[key] !== undefined && raw[key] !== '') out[key] = String(raw[key]).slice(0, 60);
  }
  for (const [key, [min, max]] of Object.entries(spec.optional || {})) {
    if (raw[key] === undefined || raw[key] === '') continue;
    const v = Number.isInteger(min) ? INT(raw[key], min, max, undefined) : NUM(raw[key], min, max);
    if (v !== undefined) out[key] = v;
  }
  for (const key of spec.bool || []) {
    if (raw[key] !== undefined) out[key] = Boolean(raw[key]);
  }
  for (const [key, allowed] of Object.entries(spec.enum || {})) {
    if (raw[key] !== undefined && allowed.includes(raw[key])) out[key] = raw[key];
  }
  return { ok: true, args: out, resolved };
}

/**
 * 统一调用入口：只允许白名单工具，参数按 Schema 校验。
 * @returns {{ok:boolean, tool:string, args?:object, resolved?:Array, data?:any, text?:string, error?:string, ms:number}}
 */
export async function runTool(name, rawArgs = {}) {
  const spec = TOOL_SPECS[name];
  if (!spec) return { ok: false, tool: name, error: 'tool-not-allowed', ms: 0 };
  const coerced = coerceArgs(spec, rawArgs);
  if (!coerced.ok) return { ok: false, tool: name, error: coerced.error, unresolved: coerced.unresolved, ms: 0 };

  const started = Date.now();
  const r = await callTool(name, coerced.args, { timeout: 12000 });
  if (!r.ok) return { ok: false, tool: name, args: coerced.args, error: r.error, ms: r.ms };
  return {
    ok: true,
    tool: name,
    args: coerced.args,
    resolved: coerced.resolved,
    data: r.data,
    text: r.text,
    ms: r.ms,
    cached: Boolean(r.cached),
  };
}

/**
 * 风味分析总入口：按业务模式挑选最相关的工具，不无脑全调。
 * mode: single | pair | multi | cuisine | direction | atlas
 */
export async function analyze(input = {}) {
  const mode = ['single', 'pair', 'multi', 'cuisine', 'direction', 'atlas'].includes(input.mode) ? input.mode : 'single';
  const names = (Array.isArray(input.ingredients) ? input.ingredients : [input.ingredient])
    .filter((x) => x !== undefined && x !== null && x !== '')
    .slice(0, 8);

  const used = [];
  const notes = [];
  const unresolved = [];
  const results = {};

  const run = async (tool, args) => {
    const r = await runTool(tool, args);
    used.push({ tool, ok: r.ok, ms: r.ms });
    if (!r.ok && r.unresolved) unresolved.push(r.unresolved);
    return r;
  };

  if (!names.length) return { ok: false, error: '请至少提供一个食材', mode, used, unresolved };

  const entries = names.map((n) => ({ raw: n, entry: resolveIngredient(n) }));
  const valid = entries.filter((e) => e.entry);
  for (const e of entries) if (!e.entry) unresolved.push(e.raw);
  if (!valid.length) return { ok: false, error: '食材均未收录', mode, used, unresolved, items: entries };

  const primary = valid[0].entry;

  if (mode === 'pair') {
    if (valid.length < 2) return { ok: false, error: '双食材分析需要两个食材', mode, used, unresolved };
    const [a, b] = valid;
    const score = await run('pairing_score', { ingredient_a: a.raw, ingredient_b: b.raw });
    results.pairing = score.ok ? score.data || score.text : null;
    if (input.axis) {
      const cmp = await run('compare_on_axis', { ingredient_a: a.raw, ingredient_b: b.raw, axis: input.axis });
      results.compare = cmp.ok ? cmp.data || cmp.text : null;
    }
    results.subjects = [a.entry.cn, b.entry.cn];
  } else if (mode === 'multi') {
    const graph = await run('find_pairings', { ingredients: valid.map((v) => v.raw) });
    results.pairings = graph.ok ? graph.data || graph.text : null;
    const pairs = [];
    for (let i = 0; i < valid.length && pairs.length < 3; i += 1) {
      for (let j = i + 1; j < valid.length && pairs.length < 3; j += 1) {
        const s = await run('pairing_score', { ingredient_a: valid[i].raw, ingredient_b: valid[j].raw });
        if (s.ok) pairs.push({ a: valid[i].entry.cn, b: valid[j].entry.cn, score: s.data?.pairing_score ?? null, label: s.data?.percentile_label || '' });
      }
    }
    results.pairs = pairs;
    results.subjects = valid.map((v) => v.entry.cn);
  } else if (mode === 'cuisine') {
    const cp = await run('cultural_profile', { ingredient: primary.cn });
    results.cultural = cp.ok ? cp.data || cp.text : null;
    const nb = await run('neighbors', { ingredient: primary.cn, top_k: 6 });
    results.neighbors = nb.ok ? nb.data || null : null;
    results.subjects = [primary.cn];
  } else if (mode === 'direction') {
    const target = String(input.target || '').trim();
    if (!target) return { ok: false, error: '方向分析需要 target', mode, used, unresolved };
    const m = await run('morph', { seed: primary.cn, target, angle_deg: Number(input.angle) || 30, top_k: 6 });
    results.morph = m.ok ? m.data || m.text : null;
    const p = await run('pareto_navigate', { seed: primary.cn, pole: { factor: Number(input.poleFactor) || 0, side: input.poleSide === 'b' ? 'b' : 'a' }, top_k_poles: 3 });
    results.pareto = p.ok ? p.data || p.text : null;
    results.subjects = [primary.cn];
    results.target = target;
  } else if (mode === 'atlas') {
    const w = await run('where_on_atlas', { ingredient: primary.cn, top_k_neighbors_2d: 5 });
    results.atlas = w.ok ? w.data || w.text : null;
    const c = await run('closest_mode', { ingredient: primary.cn, top_k: 3 });
    results.mode = c.ok ? c.data || c.text : null;
    results.subjects = [primary.cn];
  } else {
    // single：坐标 + 近邻 + 文化画像
    const w = await run('where_on_atlas', { ingredient: primary.cn, top_k_neighbors_2d: 5 });
    results.atlas = w.ok ? w.data || w.text : null;
    const nb = await run('neighbors', { ingredient: primary.cn, top_k: 8 });
    results.neighbors = nb.ok ? nb.data || null : null;
    const cp = await run('cultural_profile', { ingredient: primary.cn });
    results.cultural = cp.ok ? cp.data || cp.text : null;
    results.subjects = [primary.cn];
  }

  const anyOk = used.some((u) => u.ok);
  if (!anyOk) notes.push('Epicure 未返回有效结果，本次不做风味结论。');

  return {
    ok: anyOk,
    mode,
    subjects: results.subjects || [],
    results,
    used,
    unresolved,
    notes,
    ms: used.reduce((s, u) => s + (u.ms || 0), 0),
  };
}

/* ============================================================
 * 菜品级辅助评分（推荐用）
 * 菜谱里的食材名是「嫩豆腐 / 郫县豆瓣」这类口语写法，先做宽松匹配。
 * ============================================================ */

/** 宽松匹配：精确 → 词表中文名被包含 → 词表项包含输入（限长度差 ≤ 2） */
export function resolveLoose(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const exact = resolveIngredient(raw);
  if (exact) return exact;
  const lex = loadLexicon();
  let best = null;
  for (const entry of lex.items) {
    if (raw.includes(entry.cn)) {
      if (!best || entry.cn.length > best.cn.length) best = entry;
    }
  }
  if (best) return best;
  for (const entry of lex.items) {
    if (entry.cn.length >= 2 && raw.length >= 2 && entry.cn.includes(raw) && entry.cn.length - raw.length <= 2) {
      return entry;
    }
  }
  return null;
}

/** 把一道菜的食材映射成 Epicure 名，最多取 n 个 */
export function dishIngredients(dish, n = 2) {
  const list = Array.isArray(dish?.ingredients) ? dish.ingredients : [];
  const out = [];
  for (const raw of list) {
    if (out.length >= n) break;
    const hit = resolveLoose(raw);
    if (hit && !out.some((o) => o.epicure === hit.epicure)) out.push({ cn: hit.cn, epicure: hit.epicure, from: raw });
  }
  return out;
}

/**
 * 给推荐结果打 Epicure 辅助分。
 * 有用户食材时：算候选菜主料与用户食材的搭配分；
 * 没有时：用菜的主料在风味空间中的近邻做「风味典型度」参考（仅作展示，不排序）。
 */
export async function scoreDishes(dishes, { userIngredient = '' } = {}) {
  const userEntry = userIngredient ? resolveLoose(userIngredient) : null;
  const out = [];
  for (const dish of dishes.slice(0, 3)) {
    const ings = dishIngredients(dish, 2);
    if (!ings.length) {
      out.push({ id: dish.id, ok: false, reason: 'no-mapped-ingredient' });
      continue;
    }
    if (userEntry) {
      const scores = [];
      for (const ing of ings) {
        const r = await runTool('pairing_score', { ingredient_a: ing.cn, ingredient_b: userEntry.cn });
        if (r.ok && Number.isFinite(Number(r.data?.pairing_score))) {
          scores.push({ with: ing.cn, score: Number(r.data.pairing_score), label: r.data.percentile_label || '' });
        }
      }
      if (!scores.length) {
        out.push({ id: dish.id, ok: false, reason: 'pairing-failed', ingredients: ings.map((i) => i.cn) });
        continue;
      }
      const avg = scores.reduce((s, x) => s + x.score, 0) / scores.length;
      out.push({
        id: dish.id,
        ok: true,
        basis: 'pairing',
        score: Number(avg.toFixed(4)),
        detail: scores,
        against: userEntry.cn,
      });
    } else {
      const r = await runTool('neighbors', { ingredient: ings[0].cn, top_k: 4 });
      out.push({
        id: dish.id,
        ok: r.ok,
        basis: 'neighbors',
        ingredients: ings.map((i) => i.cn),
        neighbors: r.ok ? (r.data?.neighbors || []).map((n) => n.name).slice(0, 4) : [],
      });
    }
  }
  return out;
}


/* ============================================================
 * Auto-add：用真实搭配图谱给当前选择补充食材
 * ============================================================ */
export async function autoAddIngredients({ ids = [], count = 3, vegetarian = false, plantBased = false } = {}) {
  const lex = loadLexicon();
  const selected = ids.map((x) => resolveIngredient(x)).filter(Boolean);
  if (!selected.length) return { ok: false, error: '请先选择至少一种食材' };

  const r = await runTool('find_pairings', { ingredients: selected.map((s) => s.cn) });
  if (!r.ok || !r.text) return { ok: false, error: r.error || '未取得搭配结果' };

  // find_pairings 返回的是文本图谱：抓 "name (0.123)" 形式的节点
  const picked = [];
  const seen = new Set(selected.map((s) => s.epicure));
  const re = /([a-z][a-z0-9_ ]{2,32})\s*\((0\.\d+)\)/gi;
  let m;
  while ((m = re.exec(r.text)) && picked.length < 40) {
    const name = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    const score = Number(m[2]);
    if (!Number.isFinite(score) || seen.has(name)) continue;
    seen.add(name);
    const hit = lex.byEpicure.get(name);
    if (!hit) continue;
    const group = String(hit.foodGroup || '').toLowerCase();
    const nonVeg = hit.cat === 'meat' || hit.cat === 'seafood' || /meat|fish|seafood/.test(group);
    const dairy = hit.cat === 'dairy' || /dairy|egg/.test(group);
    if (vegetarian && nonVeg) continue;
    if (plantBased && (nonVeg || dairy)) continue;
    picked.push({ id: hit.id, cn: hit.cn, epicure: hit.epicure, cat: hit.cat, score });
  }

  picked.sort((a, b) => b.score - a.score);
  return { ok: true, items: picked.slice(0, Math.max(1, Math.min(8, count))), total: picked.length };
}
