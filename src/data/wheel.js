// 首页转盘的双模式数据源：菜系 / 口味各自独立，不共用同一份映射。
import { DISHES } from './dishes.js';
import { CUISINES, TASTES, CUISINE_BY_ID, TASTE_BY_ID } from './cuisines.js';

// 管理员在后台配置的卡片图片覆盖（按 kind + id 精确匹配，互不影响）
let CARD_OVERRIDES = { cuisine: {}, taste: {} };

export function setCardOverrides(next) {
  CARD_OVERRIDES = {
    cuisine: { ...(next?.cuisine || {}) },
    taste: { ...(next?.taste || {}) },
  };
}

function dishBrief(d) {
  return { id: d.id, name: d.name, image: d.image, tastes: d.tastes };
}

/** 八大菜系节点：图片取该菜系第一道代表菜 */
export function buildCuisineNodes() {
  return CUISINES.map((c, i) => {
    const dishes = DISHES.filter((d) => d.cuisine === c.id);
    const lead = dishes[0];
    const tags = [...new Set(dishes.flatMap((d) => d.tastes))]
      .slice(0, 3)
      .map((t) => TASTE_BY_ID[t]?.name)
      .filter(Boolean);
    return {
      kind: 'cuisine',
      id: c.id,
      index: String(i + 1).padStart(2, '0'),
      name: c.name,
      en: c.en,
      meta: c.region,
      tagline: c.tagline,
      desc: c.desc,
      tags,
      dishes: dishes.map(dishBrief),
      image: CARD_OVERRIDES.cuisine[c.id] || lead?.image,
      alt: lead?.alt || `${c.name}代表菜`,
      href: `/cuisines/${c.id}`,
      accent: c.accent,
    };
  });
}

/** 口味节点：图片优先取「不是任何菜系代表菜、且本模式内未被用过」的菜，保证每张卡片图片唯一 */
export function buildTasteNodes() {
  const cuisineLeadIds = new Set(
    CUISINES.map((c) => DISHES.find((d) => d.cuisine === c.id)?.id).filter(Boolean)
  );
  const used = new Set();
  return TASTES.map((t, i) => {
    const dishes = DISHES.filter((d) => d.tastes.includes(t.id));
    const lead =
      dishes.find((d) => !cuisineLeadIds.has(d.id) && !used.has(d.image)) ||
      dishes.find((d) => !used.has(d.image)) ||
      dishes[0];
    if (lead?.image) used.add(lead.image);
    const cuisines = [...new Set(dishes.map((d) => CUISINE_BY_ID[d.cuisine]?.name))].filter(Boolean);
    return {
      kind: 'taste',
      id: t.id,
      index: String(i + 1).padStart(2, '0'),
      name: t.name,
      en: t.en,
      meta: `${cuisines.length} 个菜系共享`,
      tagline: '味型决定人格',
      desc: t.desc,
      tags: cuisines.slice(0, 3),
      dishes: dishes.map(dishBrief),
      image: CARD_OVERRIDES.taste[t.id] || lead?.image,
      alt: lead?.alt || `${t.name}代表菜`,
      href: `/tastes/${t.id}`,
      accent: t.color,
    };
  });
}

export const WHEEL_MODES = [
  { id: 'cuisine', label: '八大菜系', hint: 'EIGHT CUISINES' },
  { id: 'taste', label: '口味探索', hint: 'EIGHT TASTES' },
];

export function nodesFor(mode) {
  return mode === 'taste' ? buildTasteNodes() : buildCuisineNodes();
}
