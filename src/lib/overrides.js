/**
 * 图片覆盖层：管理员在后台改过的卡片/菜品图片，启动时一次性拉取并写回本地数据源。
 * 这样首页、图鉴、详情页读到的都是同一份已覆盖的数据，不会出现页面间不一致。
 */
import { DISHES } from '../data/dishes.js';
import { setCardOverrides } from '../data/wheel.js';

let current = { cards: { cuisine: {}, taste: {} }, dishes: {} };

export function getOverrides() {
  return current;
}

function apply(data) {
  current = {
    cards: {
      cuisine: data?.cards?.cuisine || {},
      taste: data?.cards?.taste || {},
    },
    dishes: data?.dishes || {},
  };
  setCardOverrides(current.cards);
  for (const dish of DISHES) {
    const url = current.dishes[dish.id];
    if (url) dish.image = url;
  }
}

/** 启动时调用；失败时保持内置默认图片，不影响页面渲染 */
export async function loadAssetOverrides() {
  try {
    const res = await fetch('/api/assets/overrides', { headers: { accept: 'application/json' } });
    if (!res.ok) return current;
    const data = await res.json();
    apply(data);
    return current;
  } catch {
    return current;
  }
}

/** 后台保存后本地立即生效（无需刷新） */
export function applyOverrideLocally({ kind, id, url }) {
  if (kind === 'cuisine' || kind === 'taste') {
    current.cards[kind][id] = url;
    setCardOverrides(current.cards);
  } else if (kind === 'dish') {
    current.dishes[id] = url;
    const dish = DISHES.find((d) => d.id === id);
    if (dish) dish.image = url;
  }
}
