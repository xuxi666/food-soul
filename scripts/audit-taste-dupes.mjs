// 口味分类重复检查（可重复执行）
// 用法：node scripts/audit-taste-dupes.mjs [--json]
// 作用：
//   1. 列出每个口味分类当前（多标签包含）与「主味型唯一归属」两种口径下的菜品数与清单
//   2. 找出跨口味重复的菜（tastes 里带了多个味型）
//   3. 按规范化菜名 + 别名 + 同菜系做近似重复检测，找出「不同 id 其实是同一道菜」的记录
//   4. 校验主味型与人格是否一致、是否存在无味型/未知味型的脏数据
import { DISHES } from '../src/data/dishes.js';
import { TASTES, TASTE_BY_ID, CUISINE_BY_ID } from '../src/data/cuisines.js';

const asJson = process.argv.includes('--json');

/** 规范化菜名：去掉空白、标点、修饰性语言，用于发现「仅名称差异」的重复 */
const NAME_NOISE = /[\s\u3000·・,，。.、!！?？:：;；()（）【】\[\]"“”'‘’\-—/\\|]+/g;
const DECOR = /(正宗|传统|经典|老式|家常|私房|古法|秘制|特色|招牌|精选|简易|快手|懒人版?|家庭版?)/g;

function normName(name) {
  return String(name || '')
    .replace(NAME_NOISE, '')
    .replace(DECOR, '')
    .trim();
}

const primaryOf = (d) => (d.tastes || [])[0] || '';

const report = {
  total: DISHES.length,
  tastes: {},
  multiTaste: [],
  nameGroups: [],
  aliasHits: [],
  personalityMismatch: [],
  missingTaste: [],
  unknownTaste: [],
};

for (const t of TASTES) {
  const byMembership = DISHES.filter((d) => (d.tastes || []).includes(t.id));
  const byPrimary = DISHES.filter((d) => primaryOf(d) === t.id);
  report.tastes[t.id] = {
    name: t.name,
    membership: byMembership.length,
    primary: byPrimary.length,
    onlySecondary: byMembership.filter((d) => primaryOf(d) !== t.id).map((d) => d.id),
    primaryList: byPrimary.map((d) => d.id),
  };
}

for (const d of DISHES) {
  const tastes = d.tastes || [];
  if (!tastes.length) report.missingTaste.push(d.id);
  for (const t of tastes) if (!TASTE_BY_ID[t]) report.unknownTaste.push(`${d.id}:${t}`);
  if (tastes.length > 1) report.multiTaste.push({ id: d.id, name: d.name, cuisine: d.cuisine, tastes });
  if (d.personality && tastes.length && d.personality !== tastes[0]) {
    report.personalityMismatch.push({ id: d.id, name: d.name, tastes, personality: d.personality });
  }
}

// 同规范化菜名但 id 不同 → 近似重复
const byNorm = new Map();
for (const d of DISHES) {
  const key = normName(d.name);
  if (!byNorm.has(key)) byNorm.set(key, []);
  byNorm.get(key).push(d);
}
for (const [key, list] of byNorm) {
  if (list.length > 1) {
    report.nameGroups.push({
      key,
      items: list.map((d) => ({ id: d.id, name: d.name, cuisine: d.cuisine, primary: primaryOf(d) })),
    });
  }
}

// 别名与其他菜的正名冲突 → 同一道菜的两个入口
const nameIndex = new Map(DISHES.map((d) => [normName(d.name), d]));
for (const d of DISHES) {
  for (const alias of d.aliases || []) {
    const hit = nameIndex.get(normName(alias));
    if (hit && hit.id !== d.id) {
      report.aliasHits.push({ aliasOf: d.id, name: d.name, alias, clashesWith: hit.id, clashName: hit.name });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`菜品总数：${report.total}\n`);
  console.log('口味分类（包含口径 / 主味型唯一口径）：');
  for (const t of TASTES) {
    const r = report.tastes[t.id];
    console.log(
      `  ${t.id.padEnd(11)} ${t.name}  ${String(r.membership).padStart(3)} → ${String(r.primary).padStart(3)}   ` +
        `仅作次要标签：${r.onlySecondary.length ? r.onlySecondary.join(',') : '—'}`
    );
  }
  const dupTotal = new Set(report.multiTaste.map((m) => m.id)).size;
  console.log(`\n跨口味重复（tastes 多于一项，会在多个口味页出现）：${dupTotal} 道`);
  for (const m of report.multiTaste) {
    console.log(
      `  ${m.id.padEnd(22)} ${m.name.padEnd(8)} [${m.tastes.join(' > ')}]  主=${primaryOf({ tastes: m.tastes })}`
    );
  }
  console.log(`\n规范化同名但不同 id（疑似同一道菜）：${report.nameGroups.length} 组`);
  for (const g of report.nameGroups) {
    console.log(`  「${g.key}」→ ` + g.items.map((i) => `${i.id}(${i.name}/${i.primary})`).join(' , '));
  }
  console.log(`\n别名与正名冲突：${report.aliasHits.length} 处`);
  for (const a of report.aliasHits) console.log(`  ${a.aliasOf}(${a.name}) 的别名「${a.alias}」= ${a.clashesWith}(${a.clashName})`);
  console.log(`\n人格与主味型不一致：${report.personalityMismatch.length} 道`);
  for (const p of report.personalityMismatch) console.log(`  ${p.id}(${p.name}) tastes=${p.tastes.join('>')} personality=${p.personality}`);
  if (report.missingTaste.length) console.log(`\n缺少味型：${report.missingTaste.join(', ')}`);
  if (report.unknownTaste.length) console.log(`\n未知味型：${report.unknownTaste.join(', ')}`);
}