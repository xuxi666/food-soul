/**
 * 把人工译名表里与目录主名不同的写法补进 cn_aliases（离线可跑，不依赖 Epicure 服务）。
 *
 * 背景：目录的主中文名优先取「词表」，而译名表（CN_MAP）里可能用了更常见的叫法，
 * 例如 garlic 词表叫「蒜」、译名表叫「大蒜」，只按主名搜「大蒜」就搜不到。
 * 同步时已经会合并（buildCnIndex），这里给已经同步过的库补一次历史数据。
 *
 * 用法：node scripts/sync-cn-aliases.mjs [--dry]
 */
import { db } from '../server/db.mjs';
import { CN_MAP } from '../server/epicure-cn-map.mjs';

const dry = process.argv.includes('--dry');

const rows = db.prepare('SELECT name, cn, cn_aliases FROM epicure_catalog').all();
const byName = new Map(rows.map((r) => [r.name, r]));

const update = db.prepare('UPDATE epicure_catalog SET cn_aliases = ?, updated_at = ? WHERE name = ?');
const now = Date.now();

let touched = 0;
const sample = [];

for (const [name, cn] of Object.entries(CN_MAP)) {
  const row = byName.get(name);
  if (!row || !cn) continue;
  if (row.cn === cn) continue; // 主名一致，不需要别名
  let list = [];
  try {
    list = JSON.parse(row.cn_aliases || '[]');
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  if (list.includes(cn)) continue;
  const next = [...new Set([...list, cn])].slice(0, 6);
  touched += 1;
  if (sample.length < 8) sample.push(`${name}: ${row.cn} + 别名「${cn}」`);
  if (!dry) update.run(JSON.stringify(next), now, name);
}

console.log(`共 ${rows.length} 行，补别名 ${touched} 行${dry ? '（dry-run，未写库）' : ''}`);
if (sample.length) console.log('示例：\n  ' + sample.join('\n  '));