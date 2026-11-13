/**
 * 营养分析前端客户端。
 * 只负责调用统一接口、缓存/去重和格式化；不做任何营养公式。
 */
import { api } from './api.js';

export const NUTRIENT_FIELDS = [
  { key: 'proteinG', label: '蛋白质', unit: '克', short: '蛋白质' },
  { key: 'fatG', label: '脂肪', unit: '克', short: '脂肪' },
  { key: 'carbsG', label: '碳水化合物', unit: '克', short: '碳水' },
  { key: 'fiberG', label: '膳食纤维', unit: '克', short: '膳食纤维' },
  { key: 'sugarG', label: '糖', unit: '克', short: '糖' },
  { key: 'sodiumMg', label: '钠', unit: '毫克', short: '钠' },
  { key: 'saturatedFatG', label: '饱和脂肪', unit: '克', short: '饱和脂肪' },
  { key: 'cholesterolMg', label: '胆固醇', unit: '毫克', short: '胆固醇' },
];

const cache = new Map();
const inflight = new Map();
const CACHE_TTL = 10 * 60 * 1000;

export function nutritionKey(payload) {
  const ingredients = (Array.isArray(payload?.ingredients) ? payload.ingredients : [])
    .map((x) => [
      String(x?.name || '').normalize('NFKC').trim().toLowerCase(),
      Number.isFinite(Number(x?.amount)) && Number(x?.amount) > 0 ? Number(x.amount) : null,
      String(x?.unit || '').normalize('NFKC').trim().toLowerCase(),
      String(x?.role || '').trim(),
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    dishName: String(payload?.dishName || '').normalize('NFKC').trim().toLowerCase(),
    sourceModule: String(payload?.sourceModule || ''),
    servings: Number(payload?.servings) || null,
    allowTypicalPortions: payload?.allowTypicalPortions !== false,
    ingredients,
  });
}

export async function analyzeNutrition(payload, { signal } = {}) {
  const key = nutritionKey(payload);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  if (inflight.has(key)) return inflight.get(key);
  const promise = api.nutrition
    .analyze(payload, { signal })
    .then((res) => {
      if (!res?.ok || !res.nutrition) throw new Error(res?.error || '营养分析失败');
      cache.set(key, { at: Date.now(), data: res.nutrition });
      return res.nutrition;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function formatNutrient(value, key) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '暂无数据';
  const n = Number(value);
  if (key === 'energyKcal') return String(Math.round(n));
  if (Math.abs(n) >= 100) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

export function nutrientUnit(key) {
  if (key === 'energyKcal') return '千卡';
  if (key === 'sodiumMg' || key === 'cholesterolMg') return '毫克';
  return '克';
}

export function dataTone(type) {
  return type === 'calculated'
    ? 'calculated'
    : type === 'estimated'
      ? 'estimated'
      : type === 'insufficient'
        ? 'insufficient'
        : 'partial';
}