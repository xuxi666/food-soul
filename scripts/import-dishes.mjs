/**
 * 从参考项目（食有灵 1.0 · React 版）迁移菜品库与菜品照片
 * ---------------------------------------------------------------
 * 背景：本项目（食有灵 2.0，原生 JS + Three.js）原有 16 道菜 + 通用图库照片；
 * 参考项目有 92 道带内容与真实对应照片的菜品库（src/data/dishes/*.ts）。
 * 本脚本把参考库里的「八大菜系」菜品映射成本项目的 Dish 形状（字段一一对应，
 * 不做任何编造：拿不到的字段用文档化的推导规则或省略），并把参考项目的菜品照片
 * 复制成 public/dishes/<菜品 id>.jpg，做到「图片与菜品数据一一对应」。
 *
 * 用法：node scripts/import-dishes.mjs [--ref <参考项目根目录>]
 *   - 默认参考项目根目录 = 本项目的上一级（F:\AIweb\美食1.0）
 *   - 只读参考项目：不改动参考项目任何文件
 *   - 需要 esbuild（本项目 devDependencies 已随 vite 安装）
 *
 * 生成物：
 *   src/data/dishes/library.js      迁移来的菜品条目（唯一数据源，供 dishes/index.js 合并）
 *   public/dishes/<id>.jpg          与菜品对应的中国美食照片
 *   .tmp/ref-dishes.mjs             参考库的临时打包产物（可删除，已 gitignore）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const REF = (() => {
  const i = process.argv.indexOf('--ref');
  return i > -1 ? path.resolve(process.argv[i + 1]) : path.resolve(PROJECT, '..');
})();

const REF_DATA = path.join(REF, 'src', 'data', 'dishes', 'index.ts');
const REF_PHOTOS = path.join(REF, 'public', 'images', 'photos');
const OUT_DATA = path.join(PROJECT, 'src', 'data', 'library-dishes.js');
const OUT_PHOTOS = path.join(PROJECT, 'public', 'dishes');
const TMP = path.join(PROJECT, '.tmp');

const CUISINE_IDS = ['chuan', 'yue', 'lu', 'su', 'zhe', 'min', 'xiang', 'hui'];

/* ------------------------------------------------------------------ *
 * 1. 味型映射：参考库的 flavors 词表 → 本项目的八种味型 id
 *    只做「词表命中」，命中不到就不写味型（该菜不进口味模式），不猜。
 * ------------------------------------------------------------------ */
const FLAVOR_RULES = [
  [['麻辣', '麻香', '麻'], 'mala'],
  [['酸辣'], 'suanla'],
  [['香辣', '糊辣', '辣'], 'xiangla'],
  [['酱香', '酱味', '酱油', '发酵', '豆香'], 'jiangxiang'],
  [['清鲜', '清淡', '清爽', '清甜', '清雅', '鲜嫩', '爽口', '糟香', '脆爽', '清润', '清香', '本味'], 'qingxian'],
  [['咸鲜', '咸香', '鲜香', '鲜味', '鲜', '汤汁'], 'xianxian'],
  [['鲜甜', '香甜', '酸甜', '甜', '奶香', '蜜香'], 'xiantian'],
  [['醇厚', '浓香', '酥烂', '软糯', '油润', '丰腴', '油香', '脆皮', '酥脆', '腊香', '锅巴', '焦香'], 'chunhou'],
  [['酸', '酸香'], 'suanla'],
];

const TASTE_IDS = ['mala', 'xiangla', 'suanla', 'qingxian', 'xianxian', 'xiantian', 'jiangxiang', 'chunhou'];

function tastesOf(dish) {
  const hits = [];
  for (const [words, taste] of FLAVOR_RULES) {
    if (taste === 'xiangla' && hits.includes('mala')) continue; // 麻辣已经说明了辣的方向
    if (taste === 'suanla' && hits.includes('xiantian')) continue; // 酸甜走鲜甜，不再标酸辣
    if (hits.includes(taste)) continue;
    if (words.some((w) => (dish.flavors || []).some((f) => f.includes(w)))) hits.push(taste);
  }
  // 参考库的「辣度」是真实标注，辣度 ≥2 且没映射出辣味型时补一个辣的方向
  if (!hits.some((t) => ['mala', 'xiangla', 'suanla'].includes(t)) && dish.spicy >= 2) hits.push('xiangla');
  return hits.filter((t) => TASTE_IDS.includes(t)).slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * 2. 难度映射：参考库的「入门 / 家常 / 进阶 / 考功夫」→ 本项目的 easy / medium / hard
 * ------------------------------------------------------------------ */
const DIFFICULTY = { 入门: 'easy', 家常: 'medium', 进阶: 'medium', 考功夫: 'hard' };

/* ------------------------------------------------------------------ *
 * 3. 字段映射（参考库 Dish → 本项目 Dish）
 *    - 无编造：拿不到就省略；需要近似的字段用文档化规则推导并在条目上写明
 *    - prep/cook：参考库只给「家庭制作总分钟数」minutes，这里统一放在 prep，
 *      cook 记 0，前端展示的「约 prep + cook 分钟」等于真实总时长
 *    - servings：参考库没有份量字段，统一 2 人份（默认值，不假装是原数据）
 * ------------------------------------------------------------------ */
function toLocal(dish) {
  const tastes = tastesOf(dish);
  const knowledge = [
    dish.flavorProfile ? `口味特征：${dish.flavorProfile}` : '',
    dish.cookingMethods?.length ? `常用技法：${dish.cookingMethods.join('、')}` : '',
    dish.ingredients?.length ? `主要食材：${dish.ingredients.join('、')}` : '',
    dish.allergens?.length ? `过敏原提示：${dish.allergens.join('、')}` : '',
    dish.history ? `历史渊源：${dish.history.slice(0, 120)}` : '',
  ].filter(Boolean);

  return {
    id: dish.id,
    name: dish.name,
    cuisine: dish.cuisineId,
    tastes,
    image: `/dishes/${dish.id}.jpg`,
    alt: dish.imageAlt,
    signature: dish.flavors.length ? dish.flavors.join(' · ') : dish.flavorProfile,
    oneLiner: dish.desc,
    intro: dish.summary,
    ingredients: dish.ingredients || [],
    texture: dish.flavorProfile || (dish.flavors || []).join('、'),
    techniques: dish.cookingMethods || [],
    history: dish.history,
    personality: tastes[0],
    knowledge,
    prep: dish.minutes,
    cook: 0,
    difficulty: DIFFICULTY[dish.difficulty] || 'medium',
    servings: 2,
    price: dish.price,
    tags: dish.tags || [],
    credit: 'AI 生成菜品照片（智谱 CogView-3-Flash）· 迁移自参考项目菜品库',
  };
}

/* ------------------------------------------------------------------ *
 * 4. 打包参考库并读取（esbuild 只做编译，不执行参考项目的其它代码）
 * ------------------------------------------------------------------ */
function bundleReference() {
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, 'ref-dishes.mjs');
  // Windows 下 execFileSync('.cmd') 会 EINVAL，直接用 node 跑 esbuild 的 JS 入口
  const js = path.join(PROJECT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const bin = path.join(PROJECT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const cmd = fs.existsSync(js) ? process.execPath : bin;
  const args = fs.existsSync(js)
    ? [js, REF_DATA, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=warning']
    : [REF_DATA, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=warning'];
  if (!fs.existsSync(js) && !fs.existsSync(bin)) throw new Error('找不到 esbuild（需要 vite 自带的 esbuild）');
  execFileSync(cmd, args, { cwd: REF, stdio: 'inherit' });
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. 主流程
 * ------------------------------------------------------------------ */
const bundled = bundleReference();
const ref = await import(pathToFileURL(bundled).href);
const all = ref.dishDatabase;
if (!Array.isArray(all)) throw new Error('参考库没有导出 dishDatabase');

const kept = all.filter((d) => d.cuisineId && CUISINE_IDS.includes(d.cuisineId));
const skipped = all.filter((d) => !kept.includes(d));
const mapped = kept.map(toLocal);

const noTaste = mapped.filter((d) => !d.tastes.length);

/* 复制照片：public/images/photos/<参考 photo 名>.jpg → public/dishes/<id>.jpg */
fs.mkdirSync(OUT_PHOTOS, { recursive: true });
let copied = 0;
const missing = [];
for (const dish of kept) {
  const from = path.join(REF_PHOTOS, `${dish.photo}.jpg`);
  const to = path.join(OUT_PHOTOS, `${dish.id}.jpg`);
  if (!dish.photo || !fs.existsSync(from)) {
    missing.push(dish.id);
    continue;
  }
  fs.copyFileSync(from, to);
  copied += 1;
}

/* 写出 library.js（唯一来源；不要在生成文件里手改，改脚本） */
const header = `/**
 * 迁移菜品库（自动生成，请勿手改 —— 由 scripts/import-dishes.mjs 生成）
 * ---------------------------------------------------------------
 * 来源：参考项目（食有灵 1.0）src/data/dishes/*.ts 的八大菜系菜品，
 * 字段映射规则见 scripts/import-dishes.mjs 顶部注释；
 * 照片：public/images/photos/<菜名>.jpg → public/dishes/<菜品 id>.jpg（一菜一图）。
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 * 条目数：${mapped.length}
 */
export const LIBRARY_DISHES = [
`;

const body = mapped
  .map((d) => {
    const lines = [
      `  {`,
      `    id: ${JSON.stringify(d.id)},`,
      `    name: ${JSON.stringify(d.name)},`,
      `    cuisine: ${JSON.stringify(d.cuisine)},`,
      `    tastes: ${JSON.stringify(d.tastes)},`,
      `    image: ${JSON.stringify(d.image)},`,
      `    alt: ${JSON.stringify(d.alt)},`,
      `    signature: ${JSON.stringify(d.signature)},`,
      `    oneLiner: ${JSON.stringify(d.oneLiner)},`,
      `    intro: ${JSON.stringify(d.intro)},`,
      `    ingredients: ${JSON.stringify(d.ingredients)},`,
      `    texture: ${JSON.stringify(d.texture)},`,
      `    techniques: ${JSON.stringify(d.techniques)},`,
      `    history: ${JSON.stringify(d.history)},`,
      `    personality: ${JSON.stringify(d.personality)},`,
      `    knowledge: ${JSON.stringify(d.knowledge)},`,
      `    prep: ${d.prep},`,
      `    cook: ${d.cook},`,
      `    difficulty: ${JSON.stringify(d.difficulty)},`,
      `    servings: ${d.servings},`,
      `    price: ${d.price},`,
      `    tags: ${JSON.stringify(d.tags)},`,
      `    credit: ${JSON.stringify(d.credit)},`,
      `  },`,
    ];
    return lines.join('\n');
  })
  .join('\n');

fs.writeFileSync(OUT_DATA, `${header}${body}\n];\n`, 'utf8');

/* ------------------------------------------------------------------ *
 * 6. 汇报（写入 .tmp/import-report.json，便于检查脚本复用）
 * ------------------------------------------------------------------ */
const byCuisine = {};
for (const d of mapped) byCuisine[d.cuisine] = (byCuisine[d.cuisine] || 0) + 1;
const byTaste = {};
for (const d of mapped) for (const t of d.tastes) byTaste[t] = (byTaste[t] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  ref: REF,
  total: all.length,
  kept: mapped.length,
  skipped: skipped.length,
  skippedIds: skipped.map((d) => d.id),
  copiedPhotos: copied,
  missingPhotos: missing,
  noTaste: noTaste.map((d) => d.id),
  byCuisine,
  byTaste,
  flavors: [...new Set(all.flatMap((d) => d.flavors || []))].sort(),
};
fs.writeFileSync(path.join(TMP, 'import-report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`参考库 ${report.total} 道 → 迁移 ${report.kept} 道（跳过 ${report.skipped} 道无八大菜系归属）`);
console.log('各菜系:', byCuisine);
console.log('各味型:', byTaste);
console.log(`照片复制 ${copied} 张，缺失 ${missing.length} 张${missing.length ? ': ' + missing.join(', ') : ''}`);
console.log(`没有映射到味型的菜（不进口味模式）: ${noTaste.length ? noTaste.map((d) => d.id).join(', ') : '无'}`);
console.log(`未使用的参考库口味词：`, report.flavors.filter((f) => !FLAVOR_RULES.some(([ws]) => ws.some((w) => f.includes(w)))));
console.log(`写出 ${path.relative(PROJECT, OUT_DATA)}`);
