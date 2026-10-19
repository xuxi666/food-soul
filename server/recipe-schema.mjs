import { z } from 'zod';

const ItemSchema = z.object({
  name: z.string().min(1).max(40),
  amount: z.number().positive().max(10000),
  unit: z.string().min(1).max(12),
  optional: z.boolean(),
});

const StepSchema = z.object({
  step: z.number().int().min(1).max(50),
  title: z.string().min(1).max(40),
  description: z.string().min(1).max(400),
  duration_minutes: z.number().min(0).max(600),
  heat_level: z.enum(['low', 'medium', 'high']),
  tips: z.string().max(200),
});

export const RecipeSchema = z.object({
  dish_name: z.string().min(1).max(40),
  servings: z.number().int().min(1).max(20),
  prep_time_minutes: z.number().min(0).max(600),
  cook_time_minutes: z.number().min(0).max(600),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  ingredients: z.array(ItemSchema).min(1).max(30),
  seasonings: z.array(ItemSchema).max(30),
  steps: z.array(StepSchema).min(1).max(30),
  taste_profile: z.array(z.string().max(20)).max(10),
  substitutions: z.array(z.string().max(200)).max(10),
  common_mistakes: z.array(z.string().max(200)).max(10),
  safety_notes: z.array(z.string().max(200)).max(10),
});

const num = (v, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));

/** 模型常把数组写成字符串，这里宽容转成数组 */
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function normalizeItem(raw, i) {
  if (typeof raw === 'string') {
    return { name: raw.slice(0, 40), amount: 100, unit: 'g', optional: false };
  }
  return {
    name: str(raw?.name || raw?.ingredient || `食材${i + 1}`).slice(0, 40),
    amount: Math.max(0.1, num(raw?.amount, 100)),
    unit: str(raw?.unit || 'g').slice(0, 12) || 'g',
    optional: Boolean(raw?.optional),
  };
}

/** 宽松修复模型输出，再交给 zod 严格校验 */
export function normalizeRecipe(raw, fallbackServings = 2) {
  if (!raw || typeof raw !== 'object') return raw;
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  return {
    dish_name: str(raw.dish_name || raw.name || '家常菜').slice(0, 40),
    servings: Math.min(20, Math.max(1, Math.round(num(raw.servings, fallbackServings)))),
    prep_time_minutes: Math.max(0, Math.round(num(raw.prep_time_minutes ?? raw.prep_time, 15))),
    cook_time_minutes: Math.max(0, Math.round(num(raw.cook_time_minutes ?? raw.cook_time, 20))),
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'easy',
    ingredients: (Array.isArray(raw.ingredients) ? raw.ingredients : []).map(normalizeItem).slice(0, 30),
    seasonings: (Array.isArray(raw.seasonings) ? raw.seasonings : []).map(normalizeItem).slice(0, 30),
    steps: steps.map((s, i) => ({
      step: i + 1,
      title: str(s?.title || `步骤 ${i + 1}`).slice(0, 40) || `步骤 ${i + 1}`,
      description: str(s?.description || s?.detail || '按顺序操作，注意火候。').slice(0, 400) || '按顺序操作，注意火候。',
      duration_minutes: Math.max(0, Math.min(600, Math.round(num(s?.duration_minutes, 5)))),
      heat_level: ['low', 'medium', 'high'].includes(s?.heat_level) ? s.heat_level : 'medium',
      tips: str(s?.tips || '').slice(0, 200),
    })),
    taste_profile: arr(raw.taste_profile).map((t) => str(t).slice(0, 20)).filter(Boolean).slice(0, 10),
    substitutions: arr(raw.substitutions).map((t) => str(t).slice(0, 200)).filter(Boolean).slice(0, 10),
    common_mistakes: arr(raw.common_mistakes).map((t) => str(t).slice(0, 200)).filter(Boolean).slice(0, 10),
    safety_notes: arr(raw.safety_notes).map((t) => str(t).slice(0, 200)).filter(Boolean).slice(0, 10),
  };
}

export function validateRecipe(raw, fallbackServings) {
  const normalized = normalizeRecipe(raw, fallbackServings);
  const result = RecipeSchema.safeParse(normalized);
  if (result.success) return { ok: true, recipe: result.data, issues: [] };
  return {
    ok: false,
    recipe: null,
    issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 6),
  };
}
