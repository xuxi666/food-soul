/**
 * 寻味推荐的「图鉴之外」候选扩展。
 * ------------------------------------------------------------
 * 图鉴（DISHES）和站内 AI 补全库（generated-dishes.json）都可能覆盖不到
 * 用户当下非常具体的需求。此时才调用当前请求已经解析好的模型配置，
 * 让模型提出几道真实存在、可在家做的菜；随后由服务端做硬条件过滤、
 * 可选的公开资料佐证、配图检索与持久化。
 *
 * 重要边界：
 * - 这里只生成“候选”，最终排序和推荐理由仍由 recommendations.mjs 的
 *   独立排序调用完成；
 * - 模型没有联网时，候选明确标为“待核验”，绝不冒充外部检索结果；
 * - 价格、时间没有可靠依据就不填，详情页/推荐卡会显示“待确认”；
 * - 外部检索、图片检索、持久化任一失败，都只降级，不让推荐整体失败。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { DISHES } from '../src/data/dishes.js';
import { CUISINES, TASTES } from '../src/data/cuisines.js';
import { complete } from './ai-adapter.mjs';
import { extractJSON } from './json-utils.mjs';
import { webSearch } from './web-search.mjs';
import { searchImageCandidates, downloadCandidate, ensureDir, listImageHashes } from './dish-images.mjs';
import { readRecommendationDishes, upsertRecommendationDishes } from './recommendation-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(ROOT, 'public', 'dishes', 'recommendations');
const IMAGE_URL = '/dishes/recommendations/';
const IMAGE_DEADLINE = 11_000;
const VERIFY_DEADLINE = 9_000;
const CACHE_MS = 3 * 60 * 1000;
const EXPAND_MAX = 7;

const TASTE_IDS = new Set(TASTES.map((t) => t.id));
const CUISINE_IDS = new Set(CUISINES.map((c) => c.id));
const TASTE_BY_NAME = new Map(TASTES.flatMap((t) => [[t.name, t.id], [t.id, t.id]]));
const CUISINE_BY_NAME = new Map(CUISINES.flatMap((c) => [[c.name, c.id], [c.id, c.id]]));
const UNSAFE_COPY_RE = /营养|健康|养生|疗效|治疗|防癌|增强免疫|源自|起源于|发源|历史|相传|宫廷|名菜|菜系|地方特色|传统/;
function safeCopy(value, max = 120) {
  const text = cleanText(value, max);
  return UNSAFE_COPY_RE.test(text) ? '' : text;
}
const DIFFICULTY_RANK = { easy: 1, medium: 2, hard: 3 };
const METHOD_HINTS = {
  炒: ['炒', '爆', '熘', '干锅', '回锅'],
  炖: ['炖', '煲', '焖', '砂锅'],
  煮: ['煮', '汆', '灼', '浸', '汤'],
  蒸: ['蒸'],
  炸: ['炸', '酥', '油淋'],
  烤: ['烤', '烧鹅', '叉烧', '烧制'],
  煎: ['煎', '贴'],
  焖: ['焖', '红烧', '烧'],
  凉拌: ['拌', '凉菜', '凉拌'],
};
const ANIMAL_WORDS = [
  '肉', '猪', '牛', '羊', '鸡', '鸭', '鹅', '鸽', '兔', '鱼', '虾', '蟹', '贝', '蛤', '蚝', '螺',
  '鱿', '章鱼', '海参', '鲍', '火腿', '腊', '培根', '香肠', '排骨', '骨', '高汤', '鸡汤', '猪油',
  '牛油', '鱼露', '虾酱', '蚝油', '肉末', '肉丝', '肉片', '肉丸',
];
const VEGAN_EXTRA = ['蛋', '奶', '芝士', '奶酪', '黄油', '蜂蜜', '炼乳', '淡奶油'];
const SPICY_TASTES = new Set(['mala', 'xiangla', 'suanla']);
const SPICY_RE = /辣|花椒|麻椒|剁椒|泡椒|小米椒|朝天椒/;

const expansionCache = new Map();
const inflight = new Map();
let imageHashes = null;

function cleanText(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(value, max = 12, itemMax = 30) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return [...new Set(list.map((x) => cleanText(x, itemMax)).filter(Boolean))].slice(0, max);
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nameKey(value) {
  const text = typeof value === 'string' ? value : value?.name;
  return cleanText(text, 40).replace(/[\s·・,，.。;；:：!！?？'"“”‘’()（）【】\[\]《》<>、/\\|_\-—–~～]+/g, '').toLowerCase();
}

function normalizeText(value) {
  return nameKey(value).slice(0, 80);
}

function idFor(name) {
  return `rec-${crypto.createHash('sha1').update(nameKey(name)).digest('hex').slice(0, 12)}`;
}

function dishText(dish) {
  return `${dish.name || ''} ${(dish.ingredients || []).join(' ')} ${(dish.tags || []).join(' ')} ${(dish.techniques || []).join(' ')}`;
}

function methodsOf(dish) {
  const text = `${dish.name || ''} ${(dish.techniques || []).join(' ')}`;
  const out = [];
  for (const [method, hints] of Object.entries(METHOD_HINTS)) {
    if (hints.some((h) => text.includes(h))) out.push(method);
  }
  return out;
}

function isSpicy(dish) {
  if ((dish.tastes || []).some((t) => SPICY_TASTES.has(t))) return true;
  return SPICY_RE.test(dishText(dish));
}

function isVegetarian(dish) {
  const text = dishText(dish).replace(/鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|蛋清|蛋黄/g, '');
  return !ANIMAL_WORDS.some((word) => text.includes(word));
}

function isVegan(dish) {
  return isVegetarian(dish) && !VEGAN_EXTRA.some((word) => dishText(dish).includes(word));
}

function hitsExcluded(dish, tokens) {
  if (!tokens?.length) return false;
  const text = `${dish.name || ''} ${(dish.ingredients || []).join(' ')} ${(dish.tags || []).join(' ')}`;
  return tokens.some((token) => token && text.includes(token));
}

/**
 * 与 recommendations.mjs 的硬条件一致，但对“没有可靠时间/价格”的 AI 候选更保守：
 * 用户明确设了预算或时长时，宁可不用这道候选，也不拿模型猜测冒充可核验数据。
 */
function hardFailureForSynthetic(dish, cond) {
  if (!dish) return '不存在';
  if (cond.noSpicy && isSpicy(dish)) return '不吃辣';
  if (cond.vegan && !isVegan(dish)) return '纯素';
  if (cond.vegetarian && !isVegetarian(dish)) return '素食';
  if (hitsExcluded(dish, cond.excluded)) return '忌口';
  if (cond.budgetMax && cond.budgetMax !== Infinity) return '预算无可靠依据';
  if (cond.timeLimit && !(Number(dish.prep) + Number(dish.cook))) return '时长无可靠依据';
  if (cond.difficulty && DIFFICULTY_RANK[dish.difficulty] > DIFFICULTY_RANK[cond.difficulty]) return '难度';
  if (cond.flavors?.length && !(dish.tastes || []).some((t) => cond.flavors.includes(t))) return '口味';
  if (cond.methods?.length && !methodsOf(dish).some((m) => cond.methods.includes(m))) return '做法';
  return '';
}

function expandPrompt({ conditionText, existingNames, excludedNames, count, requestedDish = '' }) {
  return `用户这次的真实需求：
${conditionText}
${requestedDish ? `\n用户点名想吃：${requestedDish}。如果这道菜真实存在，必须把它放在第一位，并围绕它给出资料；不要用别的菜替代。` : ''}

已经存在于站内图鉴/补全库、或用户已经看过/不喜欢的菜名（不要重复）：
${existingNames.length ? existingNames.slice(0, 90).join('、') : '（暂无）'}
${excludedNames.length ? `用户明确排除过：${excludedNames.slice(0, 60).join('、')}` : ''}

请提出 ${count} 道满足这些需求、但**不在上面列表里**的中国菜。它们必须真实存在、有明确菜名、家庭厨房可操作，不能是拼造词、品牌套餐或泛化描述。优先考虑用户描述里的场景、情绪、口感、汤汁、暖胃、省事等真实诉求，而不是只按菜系堆名菜。

硬要求：
1. 过敏/忌口/素食/不吃辣是硬约束，任何候选都不能含用户排除的食材。
2. 不要编造价格、历史、起源、营养或疗效；不确定的信息留空。
3. 菜名不要带引号、序号、前缀；每道菜只出现一次。
4. 只根据用户需求提出候选，不要写“推荐理由”以外的分析，不要输出 Markdown。
5. tastes 只能从这些 id 里选：${[...TASTE_IDS].join('、')}；cuisine 只能从这些 id 里选：${[...CUISINE_IDS].join('、')}。
6. difficulty 只能是 easy、medium、hard；servings 是 1–6 的整数。
7. reason 用一句到两句话，必须引用至少一个用户条件，不能写“很好吃”“值得尝试”这类空话。

只输出这个 JSON：
{"dishes":[{"name":"菜名","nameEn":"","cuisine":"chuan","tastes":["qingxian"],"ingredients":["食材1","食材2"],"techniques":["蒸"],"difficulty":"easy","servings":2,"intro":"一句客观介绍","oneLiner":"一句口感/画面","signature":"两三个短词","reason":"为什么适合这位用户","tags":["家常"],"confidence":"low"}]}`;
}

function requestedPrompt({ conditionText, requestedDish, excludedNames }) {
  return `用户点名想吃这道菜：${requestedDish}

用户完整需求：
${conditionText}
${excludedNames.length ? `\n用户明确排除：${excludedNames.slice(0, 50).join('、')}` : ''}

只整理「${requestedDish}」这一道菜的资料。必须满足：
1. 这道菜必须真实存在、有明确菜名；如果它不是一道真实的中国菜，或者你无法确定，就输出 {"dishes":[]}，绝对不要换成别的菜来凑数。
2. 不要编造价格、历史、起源、营养或疗效；不确定的信息留空。
3. 过敏/忌口/素食/不吃辣是硬约束，配料里不能出现用户排除的食材。
4. 只输出 JSON，不要 Markdown，不要解释。
5. tastes 只能从这些 id 里选：${[...TASTE_IDS].join('、')}；cuisine 只能从这些 id 里选：${[...CUISINE_IDS].join('、')}。
6. difficulty 只能是 easy、medium、hard；servings 是 1–6 的整数。
7. reason 必须引用用户条件，不能写空泛的“好吃”“值得尝试”。

格式：
{"dishes":[{"name":"${requestedDish}","nameEn":"","cuisine":"","tastes":[],"ingredients":["食材1","食材2"],"techniques":[],"difficulty":"medium","servings":2,"intro":"一句客观介绍","oneLiner":"一句口感/画面","signature":"两三个短词","reason":"为什么适合这位用户","tags":[],"confidence":"low"}]}`;
}

const DishSchema = z.object({
  name: z.string().min(2).max(24),
  nameEn: z.string().max(60).optional().default(''),
  cuisine: z.string().max(20).optional().default(''),
  tastes: z.array(z.string()).max(4).optional().default([]),
  ingredients: z.array(z.string()).max(16).optional().default([]),
  techniques: z.array(z.string()).max(8).optional().default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().default('medium'),
  servings: z.number().int().min(1).max(8).optional().default(2),
  intro: z.string().max(240).optional().default(''),
  oneLiner: z.string().max(120).optional().default(''),
  signature: z.string().max(80).optional().default(''),
  reason: z.string().max(240).optional().default(''),
  tags: z.array(z.string()).max(8).optional().default([]),
  confidence: z.enum(['high', 'medium', 'low']).optional().default('low'),
});
const PayloadSchema = z.object({ dishes: z.array(DishSchema).max(10) });

function normalizeCandidate(raw, cond, existingKeys) {
  const name = cleanText(raw?.name, 24).replace(/^[0-9一二三四五六七八九十]+[.、．\s]+/, '').replace(/[「」“”"']/g, '');
  if (name.length < 2 || name.length > 16) return null;
  const key = nameKey(name);
  if (!key || existingKeys.has(key)) return null;
  const ingredients = cleanList(raw?.ingredients, 14, 30);
  if (ingredients.length < 2) return null;

  // 模型给的菜系/起源常常不可靠；图鉴外候选不拿它当事实展示，
  // 宁可留空，也不要给用户一个错误的“这是某地菜”的结论。
  const cuisine = '';
  const tastes = cleanList(raw?.tastes, 4, 20)
    .map((id) => TASTE_BY_NAME.get(id) || id)
    .filter((id) => TASTE_IDS.has(id));
  const techniques = cleanList(raw?.techniques, 8, 20);
  const dish = {
    id: idFor(name),
    name,
    nameEn: cleanText(raw?.nameEn, 60),
    cuisine,
    tastes,
    image: '',
    alt: `${name}的图片`,
    signature: safeCopy(raw?.signature, 80),
    oneLiner: safeCopy(raw?.oneLiner, 120),
    intro: safeCopy(raw?.intro, 240) || `以${ingredients.slice(0, 4).join('、')}为主的家常做法，具体口味与火候请以实际准备为准。`,
    ingredients,
    techniques,
    prep: 0,
    cook: 0,
    difficulty: ['easy', 'medium', 'hard'].includes(raw?.difficulty) ? raw.difficulty : 'medium',
    servings: Math.max(1, Math.min(6, Math.round(numberOr(raw?.servings, 2)))),
    price: null,
    tags: cleanList([...(raw?.tags || []), 'AI 扩展'], 8, 20),
    sourceType: 'ai_generated',
    sourceLabel: 'AI 扩展 · 待核验',
    confidence: 'low',
    verification: { status: 'unverified', checkedAt: '', sources: [] },
    whyFit: cleanText(raw?.reason, 220),
    credit: 'AI 扩展候选 · 未联网核实',
  };
  if (hardFailureForSynthetic(dish, cond)) return null;
  return dish;
}

async function fetchJsonCompletion(aiConfig, system, user) {
  const raw = await complete({
    baseUrl: aiConfig.baseUrl,
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.65,
    maxTokens: 2100,
    timeout: 60_000,
    stream: true,
  });
  return extractJSON(raw);
}

function pickImageCandidate(candidates, name) {
  const target = normalizeText(name);
  const scored = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const key = String(candidate?.url || '').split('?')[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = normalizeText(candidate.title);
    let score = 0;
    if (title && target) {
      if (title.includes(target)) score = 2;
      else if (target.length >= 3 && (title.includes(target.slice(1)) || title.includes(target.slice(0, -1)))) score = 1;
    }
    if (score) scored.push({ ...candidate, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function attachImage(record) {
  if (!record?.name) return record;
  const known = imageHashes || (imageHashes = new Set([
    ...listImageHashes(path.join(ROOT, 'public', 'dishes')),
    ...listImageHashes(path.join(ROOT, 'public', 'dishes', 'generated')),
    ...listImageHashes(IMAGE_DIR),
  ]));
  const work = (async () => {
    const queries = [`${record.name} 菜品 成品`, `${record.name} 家常做法`];
    const lists = [];
    for (const query of queries) {
      const got = await searchImageCandidates(query).catch(() => []);
      lists.push(...got);
      if (lists.length >= 14) break;
    }
    const candidates = pickImageCandidate(lists, record.name);
    for (const candidate of candidates.slice(0, 7)) {
      try {
        const got = await downloadCandidate(candidate, known);
        ensureDir(IMAGE_DIR);
        const file = path.join(IMAGE_DIR, `${record.id}.${got.ext}`);
        fs.writeFileSync(file, got.buf);
        record.image = `${IMAGE_URL}${record.id}.${got.ext}`;
        known.add(got.hash);
        record.imageHash = got.hash;
        record.imageProvider = got.provider;
        record.imageSource = got.source;
        record.alt = `${record.name}的成品图`;
        return record;
      } catch {
        /* 标题对不上的图、坏图、重复图都跳过 */
      }
    }
    record.image = '';
    record.alt = `${record.name}的图片`;
    record.imageNote = '暂无可靠配图';
    return record;
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(record), IMAGE_DEADLINE));
  return Promise.race([work, timeout]);
}

async function verifyWithWeb(record) {
  if (!record?.name) return record;
  const work = (async () => {
    const result = await webSearch(`${record.name} 菜 做法`, { count: 5, timeout: 7000 }).catch(() => null);
    const target = normalizeText(record.name);
    const relevant = (result?.sources || []).filter((source) => {
      const title = normalizeText(source.title);
      return target && title.includes(target);
    });
    if (relevant.length) {
      record.verification = {
        status: 'web_verified',
        checkedAt: new Date().toISOString(),
        sources: relevant.slice(0, 3).map((s) => ({
          title: cleanText(s.title, 120),
          url: String(s.url || '').slice(0, 500),
          site: cleanText(s.site, 40),
        })),
      };
      record.sourceLabel = 'AI 扩展 · 公开资料佐证';
      record.credit = 'AI 扩展候选 · 公开资料佐证 · 仍需按实际做法核对';
      record.confidence = 'medium';
    }
    return record;
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(record), VERIFY_DEADLINE));
  return Promise.race([work, timeout]);
}

function condKey(cond, batchIndex, excludedNames) {
  const payload = [
    batchIndex,
    cond.freeText,
    cond.parsed?.requestedDish || '',
    cond.selectedMoods.join(','),
    cond.flavors.join(','),
    cond.budgetMax,
    cond.peopleCount,
    cond.sceneId,
    cond.timeLimit,
    cond.difficulty,
    cond.methods.join(','),
    cond.diets.join(','),
    cond.excluded.join(','),
    excludedNames.slice(0, 90).join(','),
  ].join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

/**
 * @param {object} input
 * @param {object} input.cond 已归一化条件
 * @param {string} input.conditionText 给模型看的中文条件摘要
 * @param {object} input.aiConfig 当前请求已经鉴权的模型配置
 * @param {string[]} input.existingNames 图鉴/补全库/已看过的菜名
 * @param {string[]} input.excludedNames 用户排除过的菜名
 * @param {number} input.batchIndex
 * @returns {Promise<{status:string, records:Array, reason?:string, cached?:boolean, sources?:object}>}
 */
export async function expandRecommendationCandidates({
  cond,
  conditionText,
  aiConfig,
  existingNames = [],
  excludedNames = [],
  batchIndex = 0,
  requestedDish = '',
}) {
  if (!aiConfig?.apiKey) {
    return { status: 'unavailable', records: [], reason: 'ai_not_configured' };
  }
  const names = cleanList(existingNames, 160, 24);
  const excluded = cleanList(excludedNames, 120, 24);
  const key = condKey(cond, batchIndex, excluded);
  const hit = expansionCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { ...hit.value, records: hit.value.records.filter((d) => !excluded.some((name) => nameKey(name) === nameKey(d.name))), cached: true };
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const existingKeys = new Set([...DISHES.map((d) => nameKey(d.name)), ...names.map(nameKey)]);
    const stored = readRecommendationDishes();
    for (const dish of stored) existingKeys.add(nameKey(dish.name));
    for (const name of excluded) existingKeys.add(nameKey(name));

    let payload = null;
    let lastError = null;
    let focused = null;
    if (requestedDish && !existingKeys.has(nameKey(requestedDish))) {
      try {
        const raw = await fetchJsonCompletion(
          aiConfig,
          '你只整理用户点名的一道真实中国菜；不确定就返回空数组，不替换成别的菜。输出严格是 JSON。',
          requestedPrompt({ conditionText, requestedDish, excludedNames: excluded })
        );
        const parsed = PayloadSchema.parse(raw);
        const hit = parsed.dishes.find((dish) => nameKey(dish.name) === nameKey(requestedDish));
        if (hit) focused = normalizeCandidate(hit, cond, existingKeys);
      } catch (err) {
        console.warn(`[recommend-expand] 点名菜整理失败：${cleanText(err?.message || err, 160)}`);
      }
    }
    if (focused) {
      existingKeys.add(nameKey(focused.name));
    } else {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const raw = await fetchJsonCompletion(
          aiConfig,
          '你是中国家庭餐桌的菜品策划师。你只提出真实存在的菜名，不写菜谱，不编造历史、价格、营养或疗效。输出必须严格是 JSON。',
          expandPrompt({
            conditionText,
            existingNames: [...new Set([...names, ...[...existingKeys].slice(0, 40)])],
            excludedNames: excluded,
            count: attempt === 1 ? 6 : 8,
            requestedDish,
          })
        );
        payload = PayloadSchema.parse(raw);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[recommend-expand] attempt ${attempt} 未通过：${cleanText(err?.message || err, 180)}`);
      }
    }
    }
    if (!payload && !focused) {
      return { status: 'failed', records: [], reason: cleanText(lastError?.message || '模型没有返回可解析的候选', 160) };
    }

    const seen = new Set(existingKeys);
    const records = [];
    if (focused) records.push(focused);
    for (const raw of payload?.dishes || []) {
      const dish = normalizeCandidate(raw, cond, seen);
      if (!dish) continue;
      const keyName = nameKey(dish.name);
      if (seen.has(keyName) || records.some((d) => d.id === dish.id)) continue;
      seen.add(keyName);
      records.push(dish);
      if (records.length >= EXPAND_MAX) break;
    }

    // 已经存过同一道菜：复用已有配图/佐证，避免重复搜图。
    const storedById = new Map(stored.map((d) => [d.id, d]));
    for (const dish of records) {
      const old = storedById.get(dish.id);
      if (old) {
        dish.image = old.image || '';
        dish.alt = old.alt || dish.alt;
        dish.verification = old.verification || dish.verification;
        dish.sourceLabel = old.sourceLabel || dish.sourceLabel;
        dish.credit = old.credit || dish.credit;
      }
    }

    // 佐证和配图并行；任意一个失败都不影响候选本身。
    await Promise.all(records.map(async (dish) => {
      if (!dish.image) await attachImage(dish).catch(() => dish);
      if (dish.verification.status !== 'web_verified') await verifyWithWeb(dish).catch(() => dish);
    }));

    for (const dish of records) {
      dish.verification = dish.verification || { status: 'unverified', checkedAt: '', sources: [] };
    }
    try {
      upsertRecommendationDishes(records);
    } catch (err) {
      console.warn('[recommend-expand] 持久化失败：', cleanText(err?.message || err, 160));
    }

    const value = {
      status: records.length ? 'ok' : 'empty',
      records,
      sources: {
        generated: records.length,
        verified: records.filter((d) => d.verification?.status === 'web_verified').length,
      },
    };
    expansionCache.set(key, { at: Date.now(), value });
    if (expansionCache.size > 50) expansionCache.delete(expansionCache.keys().next().value);
    return value;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}