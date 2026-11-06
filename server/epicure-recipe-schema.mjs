import { z } from 'zod';

/**
 * Epicure 厨房的创意菜谱结构。
 * 与 recipe-schema.mjs 的区别：多了原创标记、风味设计、创作说明、食材主辅角色。
 */

const CreativeItem = z.object({
  name: z.string().min(1).max(30),
  amount: z.number().positive().max(10000),
  unit: z.string().min(1).max(10),
  role: z.enum(['main', 'aux']),
  substitutable: z.boolean(),
});

const CreativeStep = z.object({
  step: z.number().int().min(1).max(50),
  action: z.string().min(1).max(300),
  heat: z.string().max(20),
  minutes: z.number().min(0).max(600),
  note: z.string().max(160),
});

export const CreativeRecipeSchema = z.object({
  dish_name: z.string().min(1).max(24),
  dish_type: z.enum(['traditional', 'original']),
  cuisine_style: z.string().min(1).max(20),
  intro: z.string().min(1).max(160),
  flavor_profile: z.array(z.string().max(12)).min(1).max(6),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  servings: z.number().int().min(1).max(12),
  prep_minutes: z.number().min(0).max(300),
  cook_minutes: z.number().min(0).max(600),
  ingredients: z.array(CreativeItem).min(1).max(24),
  steps: z.array(CreativeStep).min(2).max(20),
  flavor_design: z.object({
    pairing_notes: z.string().max(400),
    key_flavors: z.array(z.string().max(12)).max(6),
    risk: z.string().max(200),
  }),
  creation_notes: z.string().max(500),
});

const num = (v, fallback = 0) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/** 宽容修复模型输出，再交给 zod 严格校验 */
export function normalizeCreative(raw, fallbackServings = 2) {
  if (!raw || typeof raw !== 'object') return raw;
  const fd = raw.flavor_design && typeof raw.flavor_design === 'object' ? raw.flavor_design : {};

  const ingredients = arr(raw.ingredients)
    .slice(0, 24)
    .map((it, i) => {
      if (typeof it === 'string') {
        return { name: it.slice(0, 30), amount: 100, unit: 'g', role: 'main', substitutable: true };
      }
      const role = it?.role === 'aux' || it?.role === '辅助' ? 'aux' : 'main';
      return {
        name: str(it?.name || it?.ingredient || `食材${i + 1}`).slice(0, 30),
        amount: Math.max(0.1, num(it?.amount, 100)),
        unit: str(it?.unit || 'g').slice(0, 10) || 'g',
        role,
        substitutable: it?.substitutable === undefined ? true : Boolean(it.substitutable),
      };
    });

  const steps = arr(raw.steps)
    .slice(0, 20)
    .map((s, i) => {
      if (typeof s === 'string') {
        return { step: i + 1, action: s.slice(0, 300), heat: '', minutes: 0, note: '' };
      }
      return {
        step: Math.max(1, Math.min(50, num(s?.step, i + 1))),
        action: str(s?.action || s?.description || s?.detail || '').slice(0, 300),
        heat: str(s?.heat || s?.heat_level || '').slice(0, 20),
        minutes: Math.max(0, num(s?.minutes ?? s?.duration_minutes, 0)),
        note: str(s?.note || s?.tips || '').slice(0, 160),
      };
    })
    .filter((s) => s.action);

  const difficultyRaw = str(raw.difficulty || raw.level || 'medium').toLowerCase();
  const difficulty = ['easy', 'medium', 'hard'].includes(difficultyRaw)
    ? difficultyRaw
    : /简单|容易/.test(difficultyRaw)
      ? 'easy'
      : /复杂|困难/.test(difficultyRaw)
        ? 'hard'
        : 'medium';

  return {
    dish_name: str(raw.dish_name || raw.name || '未命名创意菜').slice(0, 24),
    dish_type: raw.dish_type === 'traditional' || raw.dish_type === '传统' ? 'traditional' : 'original',
    cuisine_style: str(raw.cuisine_style || raw.cuisine || '创新融合').slice(0, 20),
    intro: str(raw.intro || raw.summary || '').slice(0, 160),
    flavor_profile: arr(raw.flavor_profile || raw.taste_profile || raw.tastes)
      .map((t) => str(t).slice(0, 12))
      .filter(Boolean)
      .slice(0, 6),
    difficulty,
    servings: Math.min(12, Math.max(1, num(raw.servings, fallbackServings))),
    prep_minutes: Math.max(0, num(raw.prep_minutes ?? raw.prep_time_minutes, 10)),
    cook_minutes: Math.max(0, num(raw.cook_minutes ?? raw.cook_time_minutes, 15)),
    ingredients,
    steps,
    flavor_design: {
      pairing_notes: str(fd.pairing_notes || fd.notes || '').slice(0, 400),
      key_flavors: arr(fd.key_flavors || fd.flavors).map((t) => str(t).slice(0, 12)).filter(Boolean).slice(0, 6),
      risk: str(fd.risk || fd.conflict || '').slice(0, 200),
    },
    creation_notes: str(raw.creation_notes || raw.notes || '').slice(0, 500),
  };
}

export function validateCreative(raw, servings) {
  const normalized = normalizeCreative(raw, servings);
  const parsed = CreativeRecipeSchema.safeParse(normalized);
  if (parsed.success) return { ok: true, recipe: parsed.data, issues: [] };
  const issues = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`);
  return { ok: false, recipe: normalized, issues };
}
