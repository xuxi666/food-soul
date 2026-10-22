import crypto from 'node:crypto';

import { DISHES } from '../src/data/dishes.js';
import { findDish, generatedDishes } from './dish-search.mjs';
import { webSearchMany } from './web-search.mjs';

/**
 * 菜谱工作台的两阶段菜品查询
 * ------------------------------------------------------------
 * 1) 先在站内图鉴（DISHES + AI 补全库）里按规范化名称/别名匹配；
 * 2) 图鉴没有，才调用真实联网检索（智谱 Web Search API），并返回可追溯来源。
 * 不把模型自身知识伪装成检索结果；来源不足时明确返回 insufficient。
 */

/* ---------------- 名称规范化 ---------------- */

const PUNCT = /[\s\u3000·・,，.。;；:：!！?？'"“”‘’()（）【】\[\]《》<>、/\\|_\-—–~～]+/g;

// 仅收录“同一道菜的不同叫法”，不把相近但不同的菜强行合并
const ALIAS_GROUPS = [
  ['番茄炒蛋', '西红柿炒鸡蛋', '西红柿炒蛋', '番茄炒鸡蛋'],
  ['宫保鸡丁', '宫爆鸡丁'],
  ['海蛎煎', '蚵仔煎', '蚝仔煎'],
];

export function normalizeName(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/[（(][^）)]*[）)]/g, '');
  s = s.replace(/(的做法|做法|菜谱|食谱|怎么做|如何做|家常版|家常)$/g, '');
  s = s.replace(PUNCT, '');
  return s.toLowerCase();
}

export function nameVariants(raw) {
  const norm = normalizeName(raw);
  const set = new Set();
  if (norm) set.add(norm);
  const group = ALIAS_GROUPS.find((g) => g.some((x) => normalizeName(x) === norm));
  if (group) group.forEach((x) => set.add(normalizeName(x)));
  return [...set].filter(Boolean);
}

function cleanInput(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((d) => {
    if (!d || seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

export function publicDish(d) {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    cuisine: d.cuisine,
    tastes: d.tastes,
    image: d.image,
    alt: d.alt,
    ingredients: d.ingredients,
    techniques: d.techniques,
    oneLiner: d.oneLiner,
  };
}

/* ---------------- 第一阶段：站内图鉴 ---------------- */

export function lookupLibrary(rawName) {
  const name = cleanInput(rawName);
  if (!name) return { status: 'invalid' };

  const all = [...DISHES, ...generatedDishes()];
  const variants = nameVariants(name);

  // 精确/别名匹配
  const exact = dedupeById(all.filter((d) => variants.includes(normalizeName(d.name))));
  if (exact.length === 1) return { status: 'found', dish: exact[0], matchedBy: 'exact' };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact.slice(0, 6) };

  // 保守模糊：仅接受长度差 ≤2 的包含关系，避免把不同菜当成同一道
  const targets = variants.filter((v) => v.length >= 2);
  const fuzzy = dedupeById(
    all.filter((d) => {
      const n = normalizeName(d.name);
      if (n.length < 2) return false;
      return targets.some((t) => (n.includes(t) || t.includes(n)) && Math.abs(n.length - t.length) <= 2);
    })
  );
  if (fuzzy.length === 1) return { status: 'found', dish: fuzzy[0], matchedBy: 'fuzzy' };
  if (fuzzy.length > 1) return { status: 'ambiguous', candidates: fuzzy.slice(0, 6) };

  return { status: 'none' };
}

/* ---------------- 第二阶段：真实联网检索 ---------------- */

function isRelevant(source, variants) {
  const hay = normalizeName(`${source.title || ''} ${source.snippet || ''}`);
  return variants.some((v) => v.length >= 2 && hay.includes(v));
}

export async function lookupDish({ dishName, dishId } = {}) {
  if (dishId) {
    const dish = findDish(String(dishId));
    if (dish) {
      return { status: 'found', dataSource: 'library', dish: publicDish(dish), sources: [], matchedBy: 'id' };
    }
  }

  const name = cleanInput(dishName);
  if (!name) {
    return { status: 'invalid', dataSource: 'none', sources: [], message: '请填写菜品名称。' };
  }

  const lib = lookupLibrary(name);
  if (lib.status === 'found') {
    return {
      status: 'found',
      dataSource: 'library',
      dish: publicDish(lib.dish),
      sources: [],
      matchedBy: lib.matchedBy,
      message: `已在美食图鉴中找到「${lib.dish.name}」。`,
    };
  }
  if (lib.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      dataSource: 'library',
      candidates: lib.candidates.map(publicDish),
      sources: [],
      message: '图鉴中有多道同名或相近的菜，请确认你要的是哪一道。',
    };
  }

  const variants = nameVariants(name);
  let queries = [`${name} 做法 食材`, `${name} 菜谱`, `${name} 起源 历史`];
  let found = await webSearchMany(queries, { count: 6, timeout: 15000 });
  let relevant = found.sources.filter((s) => isRelevant(s, variants));

  // 三个长查询全空时，退回只搜菜名：自建实例对短查询命中率明显更高
  if (!found.sources.length) {
    const retry = await webSearchMany([name], { count: 8, timeout: 15000 });
    if (retry.sources.length) {
      found = retry;
      relevant = retry.sources.filter((s) => isRelevant(s, variants));
      queries = [name];
    }
  }

  const listed = (relevant.length ? relevant : found.sources.slice(0, 6)).slice(0, 8);

  let status = found.status;
  // 只要有一条直接相关就能作为生成依据；此前要求 ≥2 条，冷门菜几乎必然落到「无资料」
  if (relevant.length >= 1) status = 'ok';
  else if (found.status === 'ok' || found.status === 'empty') status = 'insufficient';

  const message =
    status === 'ok'
      ? `图鉴暂无记录，已检索到 ${relevant.length} 条与「${name}」直接相关的公开资料。`
      : status === 'timeout'
        ? '联网检索超时。'
        : status === 'failed'
          ? found.message || '联网检索失败。'
          : status === 'unavailable'
            ? '未配置联网检索服务（SEARCH_API_KEY），无法联网检索。'
            : `暂未找到足够可靠的资料（检索到 ${found.sources.length} 条，直接相关 ${relevant.length} 条）。`;

  return {
    status,
    dataSource: 'ai-search',
    dishName: name,
    // 检索层的真实结果，供上层决定「降级为模型知识」还是「直接报错」
    searchStatus: found.status,
    errorKind: found.errorKind || '',
    httpStatus: found.httpStatus || 0,
    retryable: Boolean(found.retryable),
    sources: listed.map((s) => ({
      ...s,
      relevant: relevant.includes(s),
      supports: [],
      verified: false,
      status: relevant.includes(s) ? '待核验' : '相关但未直接支持',
    })),
    relevantCount: relevant.length,
    totalCount: found.sources.length,
    queries,
    message,
  };
}

/* ---------------- 检索结果 → 菜谱字段对应 ---------------- */

const STEP_WORDS = ['炒', '煮', '蒸', '炖', '烤', '焖', '炸', '煎', '拌', '烧', '卤', '烩', '煲', '汆', '焯', '腌', '勾芡'];

/**
 * 为每条来源标注它可能支持哪些菜谱信息（关键词匹配，不等于逐条人工核验）。
 */
export function attachSourceSupport(sources, recipe, dishName) {
  const ingredients = (recipe?.ingredients || [])
    .map((i) => String(i.name || '').trim())
    .filter((n) => n.length >= 2);
  const variants = nameVariants(dishName);

  return (Array.isArray(sources) ? sources : []).map((s) => {
    const hay = `${s.title || ''} ${s.snippet || ''}`;
    const normHay = normalizeName(hay);
    const mentions = variants.some((v) => v.length >= 2 && normHay.includes(v));
    const supports = [];
    if (mentions && ingredients.some((t) => hay.includes(t))) supports.push('食材');
    if (mentions && STEP_WORDS.some((w) => hay.includes(w))) supports.push('做法');
    if (mentions && /起源|历史|由来|传说|文化|典故|来历/.test(hay)) supports.push('背景');

    return {
      ...s,
      relevant: mentions,
      supports,
      verified: mentions,
      status: mentions
        ? supports.length
          ? `已检索 · 关键词匹配（${supports.join('、')}）`
          : '已检索 · 未直接对应菜谱字段'
        : '检索到但未直接支持本菜',
    };
  });
}

/* ---------------- 查询结果短时缓存（避免二次请求重复检索） ---------------- */

const LOOKUPS = new Map();
const LOOKUP_TTL = 10 * 60 * 1000;

export function rememberLookup(result, userId) {
  const id = crypto.randomUUID();
  LOOKUPS.set(id, { ...result, userId, at: Date.now() });
  if (LOOKUPS.size > 60) LOOKUPS.delete(LOOKUPS.keys().next().value);
  return id;
}

export function takeLookup(id, userId) {
  if (!id) return null;
  const hit = LOOKUPS.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > LOOKUP_TTL) {
    LOOKUPS.delete(id);
    return null;
  }
  if (hit.userId && userId && hit.userId !== userId) return null;
  return hit;
}
