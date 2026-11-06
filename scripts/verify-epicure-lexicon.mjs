/**
 * 校验中国食材词表：逐个候选名去 Epicure 试解析，只保留真实能识别的。
 * 产出 data/epicure-lexicon.json（前端与后端都以这份为准）。
 *
 * 用法：node scripts/verify-epicure-lexicon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEXICON, CATEGORIES } from '../server/epicure-lexicon.mjs';
import { callTool, epicureStatus } from '../server/epicure-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'epicure-lexicon.json');

const CONCURRENCY = 4;

async function resolveOne(entry) {
  for (const cand of entry.candidates) {
    const r = await callTool('where_on_atlas', { ingredient: cand, top_k_neighbors_2d: 1 }, { timeout: 10000 });
    if (!r.ok) continue;
    const d = r.data;
    if (!d || !d.ingredient) continue;
    return {
      id: entry.id,
      cn: entry.cn,
      cat: entry.cat,
      epicure: d.ingredient,
      matchedFrom: cand,
      cuisineRegion: d.cuisine_region || null,
      foodGroup: d.food_group || null,
      atlasXY: Array.isArray(d.atlas_xy) ? d.atlas_xy : null,
      ms: r.ms,
    };
  }
  return null;
}

async function main() {
  const status = await epicureStatus();
  if (!status.ok) {
    console.error('[中止] Epicure 不可用：', status.error);
    process.exit(1);
  }
  console.log(`[Epicure] ${status.toolCount} 个工具可用，开始校验 ${LEXICON.length} 条食材…`);

  const ok = [];
  const failed = [];
  let i = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < LEXICON.length) {
      const entry = LEXICON[i++];
      const got = await resolveOne(entry);
      if (got) {
        ok.push(got);
        console.log(`  ✓ ${entry.cn.padEnd(4)} → ${got.epicure}  (${got.cuisineRegion}/${got.foodGroup})`);
      } else {
        failed.push({ id: entry.id, cn: entry.cn, cat: entry.cat, tried: entry.candidates });
        console.log(`  ✗ ${entry.cn.padEnd(4)} 候选均无法解析：${entry.candidates.join(', ')}`);
      }
    }
  });
  await Promise.all(workers);

  ok.sort((a, b) => LEXICON.findIndex((e) => e.id === a.id) - LEXICON.findIndex((e) => e.id === b.id));

  const payload = {
    generatedAt: new Date().toISOString(),
    epicureTools: status.tools,
    total: LEXICON.length,
    verified: ok.length,
    failed: failed.length,
    categories: CATEGORIES,
    items: ok,
    unresolved: failed,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');

  console.log(`\n完成：${ok.length}/${LEXICON.length} 条已验证，${failed.length} 条待补`);
  console.log('输出：', OUT);
}

main().catch((e) => {
  console.error('失败：', e);
  process.exit(1);
});
