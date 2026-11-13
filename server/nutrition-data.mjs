/**
 * 营养数据层：本地食材匹配、别名、单位换算、典型份量。
 *
 * 营养数字只来自 data/nutrition/foods.json（中国食物营养成分查询平台），
 * 本模块不调用大模型、不访问外网，也不生成任何营养数值。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data', 'nutrition');

export const NUTRIENT_KEYS = [
  'energyKcal',
  'proteinG',
  'fatG',
  'carbsG',
  'fiberG',
  'sugarG',
  'sodiumMg',
  'saturatedFatG',
  'cholesterolMg',
];

export const NUTRIENT_LABELS = {
  energyKcal: '能量',
  proteinG: '蛋白质',
  fatG: '脂肪',
  carbsG: '碳水化合物',
  fiberG: '膳食纤维',
  sugarG: '糖',
  sodiumMg: '钠',
  saturatedFatG: '饱和脂肪',
  cholesterolMg: '胆固醇',
};

export const NUTRIENT_UNITS = {
  energyKcal: '千卡',
  proteinG: '克',
  fatG: '克',
  carbsG: '克',
  fiberG: '克',
  sugarG: '克',
  sodiumMg: '毫克',
  saturatedFatG: '克',
  cholesterolMg: '毫克',
};

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
};

const foodsDoc = readJson('foods.json', { version: '', items: [] });
const aliasDoc = readJson('aliases.json', {});

export const DATA_VERSION = String(foodsDoc.version || 'unknown');
export const DATA_SOURCE = foodsDoc.source || {
  name: '中国食物营养成分查询平台',
  url: 'https://nlc.chinanutri.cn/fq/',
};

const allFoods = Array.isArray(foodsDoc.items) ? foodsDoc.items : [];
export const FOODS = allFoods;
const foodById = new Map(allFoods.map((f) => [f.id, f]));

const aliasMap = aliasDoc.aliases && typeof aliasDoc.aliases === 'object' ? aliasDoc.aliases : {};
const unitWeights = aliasDoc.unitWeights && typeof aliasDoc.unitWeights === 'object' ? aliasDoc.unitWeights : {};
const densities = aliasDoc.densities && typeof aliasDoc.densities === 'object' ? aliasDoc.densities : {};
const portionGrams = aliasDoc.portionGrams && typeof aliasDoc.portionGrams === 'object' ? aliasDoc.portionGrams : {};
const edibleHints = Array.isArray(aliasDoc.edibleHints) ? aliasDoc.edibleHints : [];
const typicalDishes = aliasDoc.typicalDishes && typeof aliasDoc.typicalDishes === 'object' ? aliasDoc.typicalDishes : {};

/** NFKC 后去掉分隔符，保留中英文和数字；用于名称索引，不用于展示。 */
export function normalizeName(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000()[\]{}【】、，,。.;；:：·\-—_/\\|]/g, '')
    .trim();
}

/** 去掉「(鲜)」「[别名]」「（适量）」等修饰，用于二次匹配。 */
function looseName(raw) {
  return normalizeName(
    String(raw ?? '')
      .replace(/[\[【][^\]】]*[\]】]/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
  );
}

const foodIndex = new Map();

function indexFood(food, key, priority = 0) {
  const k = normalizeName(key);
  if (!k) return;
  const old = foodIndex.get(k);
  if (!old || priority > old.priority || (priority === old.priority && /均值|标准|鲜/.test(food.name) && !/均值|标准|鲜/.test(old.food.name))) {
    foodIndex.set(k, { food, priority });
  }
}

for (const food of allFoods) {
  const preferred = /均值|标准|鲜/.test(food.name) ? 2 : 1;
  indexFood(food, food.name, preferred);
  if (food.baseName) indexFood(food, food.baseName, preferred - 0.1);
  for (const alias of food.aliases || []) indexFood(food, alias, 0.8);
}
for (const [alias, targetName] of Object.entries(aliasMap)) {
  const food = allFoods.find((f) => f.name === targetName);
  if (food) indexFood(food, alias, 3);
}

function splitAlternatives(raw) {
  return String(raw ?? '')
    .split(/\s*(?:或|\/|、|，|,)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripPreparationWords(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/^(新鲜|鲜|干制|水发|熟|生|带皮|去皮|净|整|大|小|嫩|老)/, '');
  s = s.replace(/(丝|片|丁|末|块|段|粒|泥|蓉|碎)$/, '');
  return s;
}

/**
 * 把用户/AI 给的食材名解析成标准食材。
 * 返回 null 表示没有可靠匹配，绝不猜一个食物来填数字。
 */
export function resolveFood(raw) {
  const original = String(raw ?? '').trim();
  if (!original) return null;
  const candidates = [original, ...splitAlternatives(original)];
  const seen = new Set();
  for (const candidate of candidates) {
    const keys = [normalizeName(candidate), looseName(candidate)];
    const stripped = stripPreparationWords(candidate);
    if (stripped && stripped !== candidate) keys.push(normalizeName(stripped), looseName(stripped));
    for (const key of keys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hit = foodIndex.get(key);
      if (hit) return { food: hit.food, matchedAs: candidate, exact: candidate === original };
    }
  }

  // 仅在名字足够长时做包含匹配，避免「盐」误中「盐水鸭」之类。
  const base = looseName(original);
  if (base.length >= 3) {
    let best = null;
    for (const [key, hit] of foodIndex) {
      if (key.length < 2) continue;
      if (base.includes(key) || key.includes(base)) {
        const score = Math.min(key.length, base.length) * 10 - Math.abs(key.length - base.length);
        if (!best || score > best.score) best = { ...hit, score };
      }
    }
    if (best && best.score >= 20) return { food: best.food, matchedAs: original, exact: false };
  }
  return null;
}

export function getFoodById(id) {
  return foodById.get(id) || null;
}

export function getDishTemplate(dishName) {
  const key = normalizeName(dishName);
  if (!key) return null;
  for (const [name, list] of Object.entries(typicalDishes)) {
    if (normalizeName(name) === key) return Array.isArray(list) ? list : null;
  }
  return null;
}

function unitKey(unit) {
  return String(unit ?? '').normalize('NFKC').trim().toLowerCase();
}

function densityFor(food, inputName) {
  return densities[food?.name] || densities[inputName] || 1;
}

/**
 * 返回 { grams, estimated, note }。
 * 不能可靠换算时 grams = null，让上层展示「暂无数据」；
 * 不能把无法换算的「1 个」当成 1 克。
 */
export function toGrams({ food, inputName, amount, unit, servings }) {
  const n = Number(amount);
  const u = unitKey(unit);
  if (!Number.isFinite(n) || n <= 0) return { grams: null, estimated: false, note: '缺少可用用量' };

  const weights = unitWeights[food?.name] || {};
  const pieceWeight = weights[u] || weights[u.replace(/个|只|枚|根|瓣|片|块|朵|颗|粒|把|碗|杯/g, '')];
  let grams = null;
  let estimated = false;
  let note = '';

  if (['g', '克', '公克', 'gram', 'grams'].includes(u) || !u) {
    grams = n;
    estimated = !u;
    if (!u) note = '未注明单位，按克计算';
  } else if (['kg', '千克', '公斤', 'kilogram'].includes(u)) {
    grams = n * 1000;
  } else if (['斤', '市斤'].includes(u)) {
    grams = n * 500;
  } else if (['两'].includes(u)) {
    grams = n * 50;
  } else if (['lb', '磅'].includes(u)) {
    grams = n * 453.592;
  } else if (['oz', '盎司'].includes(u)) {
    grams = n * 28.3495;
  } else if (['ml', '毫升', 'cc'].includes(u)) {
    grams = n * densityFor(food, inputName);
    note = densityFor(food, inputName) === 1 ? '按 1 毫升≈1 克换算' : '按食材密度换算';
  } else if (['l', '升'].includes(u)) {
    grams = n * 1000 * densityFor(food, inputName);
    note = '按食材密度换算';
  } else if (['茶匙', '小勺', '小匙'].includes(u)) {
    grams = n * 5 * densityFor(food, inputName);
    estimated = true;
    note = '按 1 茶匙≈5 毫升估算';
  } else if (['汤匙', '大勺', '大匙', '勺'].includes(u)) {
    grams = n * 15 * densityFor(food, inputName);
    estimated = true;
    note = '按 1 汤匙≈15 毫升估算';
  } else if (['杯', 'cup'].includes(u)) {
    grams = n * 240 * densityFor(food, inputName);
    estimated = true;
    note = '按 1 杯≈240 毫升估算';
  } else if (pieceWeight) {
    grams = n * Number(pieceWeight);
    estimated = true;
    note = `按单个约${pieceWeight}克估算`;
  } else if (['个', '只', '枚', '根', '瓣', '片', '块', '朵', '颗', '粒', '把', '碗'].includes(u)) {
    // 没有该食材的单个重量，不强行给一个数字。
    grams = null;
    note = `「${unit}」没有可靠单重，未换算`;
  } else {
    grams = null;
    note = `单位「${unit}」未识别`;
  }

  if (grams !== null) {
    const canApplyEdible = food?.ediblePct > 0 && food.ediblePct < 100 && edibleHints.some((x) => String(inputName).includes(x));
    if (canApplyEdible) {
      grams *= food.ediblePct / 100;
      estimated = true;
      note = `按食部 ${food.ediblePct}% 折算`;
    }
    // 估算份量本身已经按整道菜计，不再重复乘人数。
    grams = Math.max(0.1, Math.round(grams * 10) / 10);
  }
  return { grams, estimated, note };
}

/** 只有菜名时，按食材类别给一个透明的典型份量（克），并标记 estimated。 */
export function estimateGrams(food, servings = 2) {
  if (!food) return { grams: null, note: '未匹配食材' };
  const base = Number(portionGrams[food.category] ?? 100);
  const scale = Math.max(0.5, Math.min(3, Number(servings) > 0 ? Number(servings) / 2 : 1));
  return {
    grams: Math.max(1, Math.round(base * scale)),
    note: `未提供用量，按${food.category || '常见食材'}典型份量估算`,
  };
}

export function getDataInfo() {
  return {
    version: DATA_VERSION,
    source: DATA_SOURCE,
    count: allFoods.length,
  };
}