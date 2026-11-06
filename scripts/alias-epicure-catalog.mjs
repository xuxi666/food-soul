/**
 * 为「目录里有、但 MCP 解析不了」的食材寻找真实可用的 MCP 名称
 *
 * 做法：生成若干候选写法，逐个丢给 MCP 的 neighbors 验证，
 * 只有真的解析成功才写入 mcp_name —— 不猜、不编。
 *
 * 用法：node scripts/alias-epicure-catalog.mjs
 */
import { db } from '../server/db.mjs';
import { callTool } from '../server/epicure-client.mjs';

const CONCURRENCY = 2;

const rows = db
  .prepare("SELECT name, cn, category FROM epicure_catalog WHERE active = 1 AND mcp_ok = 0 AND mcp_name IS NULL ORDER BY original_count DESC")
  .all();
console.log(`待找别名 ${rows.length} 条`);

function candidates(row) {
  const n = row.name;
  const out = new Set();
  const add = (x) => {
    const v = String(x || '').trim();
    if (v && v !== n) out.add(v);
  };

  // 单复数
  if (n.endsWith('s')) add(n.slice(0, -1));
  else add(`${n}s`);

  // 奶酪类：加/去 cheese
  if (row.category === 'Dairy') {
    if (!n.includes('cheese')) add(`${n} cheese`);
  } else if (n.endsWith(' cheese')) {
    add(n.replace(/ cheese$/, ''));
  }

  // 常见同义写法
  const synonym = {
    chili: 'chili_pepper',
    'dried chili': 'chili_pepper',
    'dried red chili': 'chili_pepper',
    'thai chili': 'birds_eye_chili',
    'green chili': 'green_chili',
    'jalapeno chile': 'jalapeno',
    'chipotle chile': 'chipotle',
    'chicken stock': 'chicken_broth',
    'beef stock': 'beef_broth',
    'veal stock': 'veal_broth',
    'vegetable stock': 'vegetable_broth',
    'fish stock': 'fish_broth',
    'mushroom stock': 'mushroom_broth',
    'salad green': 'lettuce',
    gherkin: 'pickle',
    'green pea': 'pea',
    oats: 'oat',
    breadcrumbs: 'breadcrumb',
    macaroni: 'pasta',
    ricotta: 'ricotta cheese',
    mozzarella: 'mozzarella cheese',
    cheddar: 'cheddar cheese',
    'sweet wine': 'dessert wine',
    'orange juice': 'orange',
    'pimento pepper': 'pimento',
    annatto: 'annatto seed',
    'beef fat': 'beef tallow',
    'coca cola': 'cola',
    courgette: 'zucchini',
    'cured ham': 'prosciutto',
    'lemon zest': 'lemon',
    'chickpea flour': 'gram flour',
    cider: 'apple cider',
    crawfish: 'crayfish',
    'snow fungus': 'white fungus',
    'pickled jalapeno chilies': 'pickled jalapeno',
  };
  if (synonym[n]) add(synonym[n]);

  return [...out].slice(0, 4);
}

const setOk = db.prepare('UPDATE epicure_catalog SET mcp_ok = 1, mcp_name = ? WHERE name = ?');

let i = 0;
let found = 0;
let none = 0;
const started = Date.now();

async function worker() {
  while (i < rows.length) {
    const row = rows[i++];
    const cands = candidates(row);
    let hit = '';
    for (const c of cands) {
      const r = await callTool('neighbors', { ingredient: c, top_k: 1 }, { timeout: 12000, noCache: true });
      if (r.ok) {
        hit = c;
        break;
      }
      if (/429/.test(String(r.error || ''))) await new Promise((res) => setTimeout(res, 1200));
    }
    if (hit) {
      found += 1;
      setOk.run(hit, row.name);
    } else {
      none += 1;
    }
    if ((found + none) % 50 === 0) {
      console.log(`  进度 ${found + none}/${rows.length} · 找到 ${found} · 未找到 ${none} · ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const stat = db
  .prepare('SELECT SUM(mcp_ok = 1) AS yes, SUM(mcp_ok = 0) AS no, SUM(mcp_ok IS NULL) AS unknown FROM epicure_catalog WHERE active = 1')
  .get();
console.log(`\n完成：新找到 ${found} 条可用别名，仍无对应 ${none} 条，耗时 ${Math.round((Date.now() - started) / 1000)}s`);
console.log('目录状态：可分析', stat.yes || 0, '· 不可解析', stat.no || 0, '· 未验证', stat.unknown || 0);
process.exit(0);
