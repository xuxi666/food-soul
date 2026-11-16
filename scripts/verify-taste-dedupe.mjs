// 口味分类去重校验（可重复执行）
// 用法：node scripts/verify-taste-dedupe.mjs
// 校验内容：
//   1. 每道菜都有主味型，且主味型是已知味型
//   2. 八个口味分类按主味型唯一归属：两两不相交，并集等于全部菜品
//   3. 同一分类内没有重复菜名、重复图片
//   4. 分类池与各调用点（catalog / dishFeed / categories 推导）口径一致
//   5. 人格与主味型一致
// 退出码：0 通过，1 有不符合项（便于接进 CI）
import { DISHES, DISH_BY_ID, inTaste, primaryTaste, dishesByTaste } from '../src/data/dishes.js';
import { TASTES, TASTE_BY_ID } from '../src/data/cuisines.js';
import { dishesForCategory } from '../src/data/categories.js';
import { listCategoryDishes } from '../src/data/dishFeed.js';
import { staticPool, catalogState, catalogMeta } from '../src/lib/catalog.js';

const problems = [];
const warn = [];

/* 1. 主味型完整性 */
for (const d of DISHES) {
  const p = primaryTaste(d);
  if (!p) problems.push(`${d.id} 没有主味型`);
  else if (!TASTE_BY_ID[p]) problems.push(`${d.id} 的主味型 ${p} 不是已知味型`);
  const others = (d.tastes || []).filter((t) => !TASTE_BY_ID[t]);
  if (others.length) problems.push(`${d.id} 含未知味型标签：${others.join(',')}`);
}

/* 2. 八个分类互不相交、并集全覆盖 */
const seen = new Map();
const counts = {};
for (const t of TASTES) {
  const list = dishesByTaste(t.id);
  counts[t.id] = list.length;
  for (const d of list) {
    if (seen.has(d.id)) {
      problems.push(`${d.id}（${d.name}）同时出现在 ${seen.get(d.id)} 和 ${t.id}`);
    } else {
      seen.set(d.id, t.id);
    }
  }
}
if (seen.size !== DISHES.length) {
  const missing = DISHES.filter((d) => !seen.has(d.id)).map((d) => `${d.id}(${primaryTaste(d)})`);
  problems.push(`有 ${missing.length} 道菜没有落到任何口味分类：${missing.slice(0, 10).join('、')}`);
}

/* 3. 分类内重复 */
for (const t of TASTES) {
  const names = new Map();
  const images = new Map();
  for (const d of dishesByTaste(t.id)) {
    if (names.has(d.name)) problems.push(`${t.id} 内重名：${d.name}（${names.get(d.name)} / ${d.id}）`);
    else names.set(d.name, d.id);
    if (d.image) {
      if (images.has(d.image)) problems.push(`${t.id} 内重复图片：${d.image}（${images.get(d.image)} / ${d.id}）`);
      else images.set(d.image, d.id);
    }
  }
}

/* 4. 各调用点口径一致 */
for (const t of TASTES) {
  const expect = dishesByTaste(t.id).map((d) => d.id).sort().join(',');
  const variants = {
    'categories.dishesForCategory': dishesForCategory('taste', t.id),
    'dishFeed.listCategoryDishes': listCategoryDishes('taste', t.id),
    'catalog.staticPool': staticPool('taste', t.id),
  };
  for (const [label, list] of Object.entries(variants)) {
    const got = list
      .filter((d) => d && d.id)
      .map((d) => d.id)
      .sort()
      .join(',');
    if (got !== expect) {
      problems.push(`${label} 与主味型口径不一致：${t.id}（${list.length} vs ${dishesByTaste(t.id).length}）`);
    }
  }
  // 带图口径允许更少（listCategoryDishes 会过滤无图/重复），但不能多
  if (variants['dishFeed.listCategoryDishes'].length > dishesByTaste(t.id).length) {
    problems.push(`dishFeed 在 ${t.id} 返回了多于归属数的菜`);
  }
  // 图鉴页 / 口味页共用 catalog 的池：首屏只展示前 10 道，但池子总数与标称一致
  const meta = catalogMeta(catalogState('taste', t.id));
  if (meta.total !== dishesByTaste(t.id).length) {
    problems.push(`catalog 标称 ${t.id} 共 ${meta.total} 道，应为 ${dishesByTaste(t.id).length} 道`);
  }
}

/* 5. 人格一致 */
for (const d of DISHES) {
  if (d.personality && primaryTaste(d) && d.personality !== primaryTaste(d)) {
    problems.push(`${d.id}（${d.name}）人格 ${d.personality} 与主味型 ${primaryTaste(d)} 不一致`);
  }
}

/* 汇总 */
const total = DISHES.length;
const sum = TASTES.reduce((n, t) => n + counts[t.id], 0);
console.log(`菜品总数 ${total}，八类归属合计 ${sum}`);
console.log(
  '各口味分类：' +
    TASTES.map((t) => `${t.name}${counts[t.id]}`).join(' · ')
);
const multi = DISHES.filter((d) => (d.tastes || []).length > 1).length;
console.log(`多味型标签菜品 ${multi} 道（标签保留，但只在一个口味分类中归属）`);
if (warn.length) warn.forEach((w) => console.log('WARN ' + w));
if (problems.length) {
  console.log(`\n失败：${problems.length} 项`);
  problems.slice(0, 40).forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('\n通过：口味分类之间没有重复菜品，分类归属唯一且覆盖完整。');