/**
 * 菜系 / 口味 的菜品数据层（菜系页右页的「加载更多」就走这里）
 * ------------------------------------------------------------
 * 现状说明（第 32 轮核对过）：
 *   菜系目录的数据来自随包发布的菜品清单 src/data/dishes.js（97 道，字段齐全），
 *   页面本来就不发 HTTP 请求；服务端 /api/dishes 只返回 AI 生成的菜，而且没有
 *   page / pageSize 参数（`items.slice(0, 120)` + total），并不承载这份图鉴。
 *
 *   所以这里不新造后端，也不重复请求第一页 —— 而是把「同一份过滤结果」包成
 *   一个游标式的小接口：offset / limit 进，{ items, total, hasMore, nextOffset } 出。
 *   语义和真正的分页接口一致，将来要换成 HTTP 分页，只要把这个文件的实现换掉。
 */

import { DISHES } from './dishes.js';

const BATCH = 4;

/** 该分类下的菜品：必须有图，按名字与图片去重（同一道菜的重复条目只留一条） */
export function listCategoryDishes(kind, id) {
  if (!id) return [];
  const list = DISHES.filter((d) => (kind === 'taste' ? (d.tastes || []).includes(id) : d.cuisine === id));
  const seenName = new Set();
  const seenImage = new Set();
  return list.filter((d) => {
    if (!d.image || seenName.has(d.name) || seenImage.has(d.image)) return false;
    seenName.add(d.name);
    seenImage.add(d.image);
    return true;
  });
}

/**
 * 取一批菜品（游标式）。
 * @returns {Promise<{kind:string,id:string,items:Array,total:number,hasMore:boolean,nextOffset:number,offset:number}>}
 */
export function fetchDishBatch(kind, id, { offset = 0, limit = BATCH } = {}) {
  const all = listCategoryDishes(kind, id);
  const start = Math.max(0, Math.min(Number(offset) || 0, all.length));
  const size = Math.max(1, Number(limit) || BATCH);
  const end = Math.min(all.length, start + size);
  const items = all.slice(start, end);
  // 让出一帧再返回：调用方能真的画出「正在加载…」，也能被中途的菜系切换打断
  return new Promise((resolve) => {
    const done = () =>
      resolve({
        kind,
        id,
        items,
        offset: start,
        total: all.length,
        nextOffset: end,
        hasMore: end < all.length,
      });
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(done, 0));
    else setTimeout(done, 0);
  });
}

/** 追加前的图片预热：解码完成再插进来，滚动时不会有一下子的空白 */
export function preloadDishImages(items, timeout = 700) {
  if (!items?.length) return Promise.resolve();
  const wait = items.map(
    (d) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = d.image;
        if (img.decode) img.decode().then(resolve, resolve);
      })
  );
  return Promise.race([Promise.all(wait), new Promise((resolve) => setTimeout(resolve, timeout))]);
}

export const DISH_BATCH_SIZE = BATCH;