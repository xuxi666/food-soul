/**
 * 统一营养分析服务。
 *
 * 四个入口（厨房 / AI 推荐 / 菜谱 / 菜品详情）都只调用这里，
 * 每个模块不再保留自己的营养公式。
 */
import {
  DATA_VERSION,
  DATA_SOURCE,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  resolveFood,
  toGrams,
  estimateGrams,
  getDishTemplate,
  getDataInfo,
} from './nutrition-data.mjs';
import { cacheKey, getCached, setCached } from './nutrition-cache.mjs';

const MODULES = new Set(['kitchen', 'recommendation', 'recipe', 'dish-detail', 'unknown']);
const DATA_LABELS = {
  calculated: '数据库计算',
  estimated: '估算值',
  partial: '数据不完整',
  insufficient: '暂无足够数据',
};

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function text(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function amountValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeIngredients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((item) => {
      if (typeof item === 'string') return { name: text(item, 80), amount: null, unit: '', role: 'main' };
      if (!item || typeof item !== 'object') return null;
      const name = text(item.name, 80);
      if (!name) return null;
      return {
        name,
        amount: amountValue(item.amount),
        unit: text(item.unit, 16),
        role: ['main', 'aux', 'seasoning'].includes(item.role) ? item.role : 'main',
      };
    })
    .filter(Boolean);
}

function normalizeInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求内容格式不正确' };
  const dishName = text(body.dishName, 80);
  let ingredients = normalizeIngredients(body.ingredients);
  const seasonings = normalizeIngredients(body.seasonings).map((x) => ({ ...x, role: 'seasoning' }));
  ingredients = [...ingredients, ...seasonings].slice(0, 40);
  if (!dishName && !ingredients.length) {
    return { ok: false, error: '请提供菜品名称或食材信息' };
  }
  const servingsRaw = Number(body.servings);
  const servings = Number.isFinite(servingsRaw) && servingsRaw >= 1 && servingsRaw <= 20 ? servingsRaw : null;
  const sourceModule = MODULES.has(body.sourceModule) ? body.sourceModule : 'unknown';
  return {
    ok: true,
    input: {
      dishName: dishName || '未命名菜品',
      sourceModule,
      servings,
      ingredients,
      allowTypicalPortions: body.allowTypicalPortions !== false,
    },
  };
}

function emptyNutrients() {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null]));
}

function sumNutrients(rows) {
  const total = emptyNutrients();
  const counts = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  for (const row of rows) {
    for (const key of NUTRIENT_KEYS) {
      const value = row.nutrients?.[key];
      if (Number.isFinite(value)) {
        total[key] = (total[key] ?? 0) + value;
        counts[key] += 1;
      }
    }
  }
  for (const key of NUTRIENT_KEYS) {
    if (!counts[key]) total[key] = null;
    else total[key] = round1(total[key]);
  }
  return total;
}

function calcRow(food, grams) {
  const nutrients = emptyNutrients();
  if (!food || !Number.isFinite(grams)) return nutrients;
  for (const key of NUTRIENT_KEYS) {
    const per100 = food.per100g?.[key];
    if (Number.isFinite(per100)) nutrients[key] = round1((per100 * grams) / 100);
  }
  return nutrients;
}

function cacheSafe(nutrition) {
  return nutrition;
}

function buildResult(input, rows, { templateUsed = false, templateName = '' } = {}) {
  const total = sumNutrients(rows);
  const hasAnyValue = NUTRIENT_KEYS.some((k) => Number.isFinite(total[k]));
  const servings = input.servings;
  const perServing = emptyNutrients();
  if (servings) {
    for (const key of NUTRIENT_KEYS) {
      perServing[key] = Number.isFinite(total[key]) ? round1(total[key] / servings) : null;
    }
  }
  const missingIngredients = rows.filter((r) => !r.matched).map((r) => r.inputName);
  const missingNutrients = NUTRIENT_KEYS.filter((k) => !Number.isFinite(total[k])).map((k) => NUTRIENT_LABELS[k]);
  const matchedIngredients = rows.filter((r) => r.matched).length;
  const quantified = rows.filter((r) => Number.isFinite(r.grams)).length;
  const nutrientCoverage = NUTRIENT_KEYS.filter((k) => Number.isFinite(total[k])).length;
  const estimated = templateUsed || rows.some((r) => r.quantityEstimated);
  // 主营养项齐全时仍可称为「数据库计算」；糖/饱和脂肪等数据源缺口
  // 单独显示「暂无数据」，不因此把所有菜都笼统标成「数据不完整」。
  const coreKeys = ['energyKcal', 'proteinG', 'fatG', 'carbsG', 'sodiumMg'];
  const coreComplete = coreKeys.every((k) => Number.isFinite(total[k]));
  const incomplete = !hasAnyValue || !coreComplete || missingIngredients.length > 0;
  const score =
    rows.length === 0
      ? 0
      : Math.round(
          100 *
            ((matchedIngredients / rows.length) * 0.45 +
              (quantified / rows.length) * 0.25 +
              (nutrientCoverage / NUTRIENT_KEYS.length) * 0.3)
        );

  const dataType = !hasAnyValue
    ? 'insufficient'
    : incomplete
      ? 'partial'
      : estimated
        ? 'estimated'
        : 'calculated';

  const assumptions = ['按生食材与全部调味料计算，未扣除烹调损失。'];
  if (templateUsed) assumptions.push(`没有提供具体配方，采用「${templateName}」的典型用料估算，不是精确配方。`);
  if (rows.some((r) => r.quantityEstimated)) assumptions.push('部分食材没有可用用量，按常见份量或单位换算估算。');
  if (missingIngredients.length) assumptions.push('本地营养库未匹配到的食材没有计入，数值可能偏低。');
  if (!hasAnyValue) assumptions.push('没有足够的食材或配方信息，无法可靠计算营养。');
  if (missingNutrients.includes('糖') || missingNutrients.includes('饱和脂肪')) {
    assumptions.push('糖和饱和脂肪在当前数据源中没有完整记录，缺失项显示「暂无数据」。');
  }

  const sourceItems = rows
    .filter((r) => r.matched && r.food)
    .map((r) => ({
      id: r.food.id,
      name: r.food.name,
      url: r.food.sourceUrl,
    }));

  return {
    version: 1,
    dishName: input.dishName,
    sourceModule: input.sourceModule,
    servings,
    ingredients: rows.map((r) => ({
      inputName: r.inputName,
      standardName: r.food?.name || '',
      amount: r.amount,
      unit: r.unit,
      grams: Number.isFinite(r.grams) ? round1(r.grams) : null,
      role: r.role,
      databaseId: r.food?.id || '',
      source: r.food ? 'cn_fct' : '',
      matched: Boolean(r.matched),
      quantityEstimated: Boolean(r.quantityEstimated),
      nutrients: r.nutrients,
      note: r.note || '',
    })),
    total,
    perServing: servings ? perServing : emptyNutrients(),
    dataType,
    dataLabel: DATA_LABELS[dataType],
    completeness: {
      score,
      matchedIngredients,
      totalIngredients: rows.length,
      quantifiedIngredients: quantified,
      nutrientCoverage,
      missingIngredients,
      missingNutrients,
    },
    flags: {
      estimated: Boolean(estimated),
      incomplete: Boolean(incomplete),
      templateUsed: Boolean(templateUsed),
    },
    assumptions,
    sources: [
      {
        name: DATA_SOURCE.name,
        publisher: DATA_SOURCE.publisher || '',
        url: DATA_SOURCE.url,
        version: DATA_VERSION,
        licenseNote: DATA_SOURCE.licenseNote || '',
      },
    ],
    sourceItems,
    analyzedAt: new Date().toISOString(),
  };
}

export function analyzeNutrition(body) {
  const normalized = normalizeInput(body);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error, code: 'invalid_input' };
  const input = normalized.input;

  let templateUsed = false;
  let templateName = '';
  if (!input.ingredients.length) {
    const template = getDishTemplate(input.dishName);
    if (template?.length) {
      input.ingredients = normalizeIngredients(template).map((x) => ({ ...x, role: 'main' }));
      templateUsed = true;
      templateName = input.dishName;
    }
  }
  // 模板估算与用户明确给出同样食材的结果，数值可能相同，但“估算/来源”语义不同，不能共用缓存。
  input.templateUsed = templateUsed;

  const cacheToken = cacheKey(input, DATA_VERSION);
  const cached = getCached(cacheToken);
  if (cached) return { ok: true, cached: true, nutrition: cached };

  const rows = [];
  for (const item of input.ingredients) {
    const resolved = resolveFood(item.name);
    if (!resolved) {
      rows.push({
        inputName: item.name,
        matched: false,
        food: null,
        amount: item.amount,
        unit: item.unit,
        role: item.role,
        grams: null,
        quantityEstimated: false,
        nutrients: emptyNutrients(),
        note: '本地营养库暂无该食材，未计入',
      });
      continue;
    }
    const food = resolved.food;
    let grams = null;
    let quantityEstimated = false;
    let note = '';
    if (item.amount !== null) {
      const converted = toGrams({
        food,
        inputName: item.name,
        amount: item.amount,
        unit: item.unit,
        servings: input.servings,
      });
      grams = converted.grams;
      quantityEstimated = Boolean(converted.estimated);
      note = converted.note || '';
      if (grams === null) note = note || '用量无法换算为克';
    }
    if (grams === null && input.allowTypicalPortions) {
      const est = estimateGrams(food, input.servings || 2);
      grams = est.grams;
      quantityEstimated = true;
      note =
        item.amount !== null
          ? `用量单位「${item.unit || '未填'}」无法可靠换算，按${food.category || '常见食材'}典型份量估算`
          : est.note;
    }
    rows.push({
      inputName: item.name,
      matched: true,
      food,
      amount: item.amount,
      unit: item.unit,
      role: item.role,
      grams,
      quantityEstimated,
      nutrients: calcRow(food, grams),
      note,
    });
  }

  const nutrition = buildResult(input, rows, { templateUsed, templateName });
  setCached(cacheToken, cacheSafe(nutrition));
  return { ok: true, cached: false, nutrition };
}

export function nutritionPublicInfo() {
  return getDataInfo();
}