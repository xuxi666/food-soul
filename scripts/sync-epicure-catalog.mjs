/**
 * 同步 Epicure 完整食材目录
 *
 * 数据源：https://epicure.kaikaku.ai/api/ingredients（官方站点搜索用的公开接口）
 * 用法：
 *   node scripts/sync-epicure-catalog.mjs           # 全量同步（幂等）
 *   node scripts/sync-epicure-catalog.mjs --stats   # 只看当前统计，不发请求
 */
import { syncCatalog, catalogStats, catalogCategories, queryCatalog, catalogReady } from '../server/epicure-catalog.mjs';

const onlyStats = process.argv.includes('--stats');

if (onlyStats) {
  const stats = catalogStats();
  console.log('目录统计:', JSON.stringify(stats, null, 1));
  console.log('分类:', catalogCategories().map((c) => `${c.name}(${c.count})`).join(' '));
  process.exit(0);
}

console.log('开始同步 Epicure 食材目录…');
const t0 = Date.now();
const r = await syncCatalog();
console.log('结果:', JSON.stringify(r));

if (r.ok) {
  const stats = catalogStats();
  console.log(`\n当前目录：${stats.total} 条（有中文名 ${stats.translated}，素食 ${stats.vegetarian}，纯素 ${stats.vegan}）`);
  const sample = queryCatalog({ q: 'mint', pageSize: 6 });
  console.log('搜索 "mint" →', sample.total, '条:', sample.items.map((i) => i.display).join(', '));
  const tofu = queryCatalog({ q: '豆腐', pageSize: 6 });
  console.log('搜索 "豆腐" →', tofu.total, '条:', tofu.items.map((i) => `${i.display}/${i.name}`).join(', '));
}
console.log('耗时', Date.now() - t0, 'ms');
process.exit(r.ok ? 0 : 1);
