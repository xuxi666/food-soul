import { CUISINE_BY_ID, TASTE_BY_ID } from './cuisines.js';
import { DISHES } from './dishes.js';
import { PERSONALITY_BY_ID } from './personalities.js';

/**
 * 菜系 / 口味「分类」的公共数据推导。
 * 前端聊天页与服务端提示词共用同一份逻辑：
 * - 分类决定聊天人格（菜系取该菜系里出现最多的味型人格，口味直接用味型人格）
 * - 菜品只是分类下的内容，不参与人格判定
 */

export function categoryMeta(kind, id) {
  if (kind === 'taste') return TASTE_BY_ID[id] || null;
  if (kind === 'cuisine') return CUISINE_BY_ID[id] || null;
  return null;
}

export function dishesForCategory(kind, id) {
  if (kind === 'taste') return DISHES.filter((d) => (d.tastes || []).includes(id));
  if (kind === 'cuisine') return DISHES.filter((d) => d.cuisine === id);
  return [];
}

/**
 * 菜系的主味型提示：默认按该菜系内出现次数最多的味型决定人格，
 * 只有「菜系身份与该菜系代表味型不一致」时才显式指定。
 */
const CUISINE_TASTE_HINT = {
  chuan: 'mala', // 川菜的招牌是麻辣，而不是单纯香辣
  min: 'qingxian', // 闽菜以清鲜、不腻著称
};

export function personaForCategory(kind, id) {
  if (kind === 'taste') return PERSONALITY_BY_ID[id] || null;
  const hinted = CUISINE_TASTE_HINT[id];
  if (hinted && PERSONALITY_BY_ID[hinted]) return PERSONALITY_BY_ID[hinted];
  const list = dishesForCategory('cuisine', id);
  const counts = new Map();
  for (const dish of list) for (const taste of dish.tastes || []) counts.set(taste, (counts.get(taste) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (
    PERSONALITY_BY_ID[top] ||
    PERSONALITY_BY_ID[list[0]?.personality] ||
    PERSONALITY_BY_ID[list[0]?.tastes?.[0]] ||
    null
  );
}

export function categoryChatHref(kind, id, contextDishId) {
  const base = `/chat/${kind}/${encodeURIComponent(id)}`;
  return contextDishId ? `${base}?dish=${encodeURIComponent(contextDishId)}` : base;
}
