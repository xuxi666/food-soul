/**
 * 图片覆盖层：管理员在后台改过的菜品图片，启动时一次性拉取并写回本地数据源。
 * 菜系 / 口味卡图随旧首页转盘一起下线，现在只保留菜品图覆盖。
 */
import { DISHES } from '../data/dishes.js';

let current = { dishes: {} };

export function getOverrides() {
  return current;
}

function apply(data) {
  current = { dishes: data?.dishes || {} };
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
  if (kind !== 'dish') return;
  current.dishes[id] = url;
  const dish = DISHES.find((d) => d.id === id);
  if (dish) dish.image = url;
}