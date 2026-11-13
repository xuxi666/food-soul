/**
 * 构建本地营养食材数据。
 *
 * 数据来源：中国疾病预防控制中心营养与健康所
 * 「食物营养成分查询平台」https://nlc.chinanutri.cn/fq/
 *
 * 这是开发期的一次性导入脚本，不在网站运行时访问外网。
 * 只导入网站常用食材分类，保留来源链接和抓取日期；运行：
 *   node scripts/build-nutrition-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'data', 'nutrition', 'foods.json');
const API = 'https://nlc.chinanutri.cn/fq/FoodInfoQueryAction!queryFoodInfoList.do';
const SOURCE_URL = 'https://nlc.chinanutri.cn/fq/';

const CATEGORIES = [
  { id: 1, name: '谷类及制品' },
  { id: 10, name: '薯类、淀粉及制品' },
  { id: 11, name: '干豆类及制品' },
  { id: 12, name: '蔬菜类及制品' },
  { id: 13, name: '菌藻类' },
  { id: 14, name: '水果类及制品' },
  { id: 15, name: '坚果、种子类' },
  { id: 16, name: '畜肉类及制品' },
  { id: 17, name: '禽肉类及制品' },
  { id: 18, name: '乳类及制品' },
  { id: 19, name: '蛋类及制品' },
  { id: 20, name: '鱼虾蟹贝类' },
  { id: 26, name: '糖、果脯和蜜饯、蜂蜜' },
  { id: 27, name: '油脂类' },
  { id: 28, name: '调味品类' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function text(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function num(raw) {
  const s = text(raw);
  if (!s || s === '—' || s === 'Tr' || s === 'tr' || s === '-') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function round(n, digits = 2) {
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/** 「马铃薯[土豆，洋芋]」→ 基础名 + 方括号别名 */
function splitFoodName(raw) {
  const name = text(raw);
  const aliases = [];
  let base = name;
  const bracket = name.match(/^(.+?)[\[【]([^\]】]+)[\]】]\s*(.*)$/);
  if (bracket) {
    base = text(bracket[1] + (bracket[3] ? `(${bracket[3]})` : ''));
    for (const a of bracket[2].split(/[，,、;；]/)) {
      const v = text(a);
      if (v) aliases.push(v);
    }
  }
  // 去掉「(鲜)」「（熟）」这类状态注释，但保留「(均值)」「(肥瘦)」等有区分度的名称
  const clean = base.replace(/[（(](鲜|生|熟|净|水发|干制|带皮|去皮)[）)]$/g, '').trim();
  if (clean && clean !== base) aliases.push(clean);
  return { name, base, aliases: [...new Set(aliases.filter((x) => x !== name))] };
}

function rowToFood(row, category) {
  if (!Array.isArray(row) || !row[0] || !row[2]) return null;
  const parsed = splitFoodName(row[2]);
  const energyKj = num(row[7]);
  const ediblePct = row[5] ? num(row[5]) : null;
  return {
    id: `cn-${row[0]}`,
    name: parsed.name,
    baseName: parsed.base,
    aliases: parsed.aliases,
    category: category.name,
    source: 'cn_fct',
    sourceUrl: `https://nlc.chinanutri.cn/fq/foodinfo/${row[0]}.html`,
    ediblePct: ediblePct === null ? 100 : ediblePct,
    per100g: {
      energyKcal: energyKj === null ? null : round(energyKj / 4.184, 1),
      proteinG: num(row[8]),
      fatG: num(row[9]),
      carbsG: num(row[12]),
      fiberG: num(row[13]),
      sugarG: null,
      sodiumMg: num(row[24]),
      saturatedFatG: null,
      cholesterolMg: num(row[10]),
    },
  };
}

async function fetchPage(categoryId, page) {
  const body = new URLSearchParams({
    categoryOne: String(categoryId),
    categoryTwo: '0',
    foodName: '0',
    pageNum: String(page),
    field: '0',
    flag: '0',
  });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function main() {
  const items = [];
  const seen = new Set();
  for (const category of CATEGORIES) {
    const first = await fetchPage(category.id, 1);
    const pages = Math.max(1, Number(first.totalPages) || 1);
    const lists = [first.list];
    for (let p = 2; p <= pages; p += 1) {
      await sleep(120);
      lists.push((await fetchPage(category.id, p)).list);
    }
    for (const list of lists) {
      for (const row of Array.isArray(list) ? list : []) {
        const food = rowToFood(row, category);
        if (!food || seen.has(food.id)) continue;
        seen.add(food.id);
        items.push(food);
      }
    }
    console.log(`${category.name}: ${pages} 页`);
    await sleep(120);
  }

  items.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
  const out = {
    version: new Date().toISOString().slice(0, 10),
    source: {
      name: '中国食物营养成分查询平台',
      publisher: '中国疾病预防控制中心营养与健康所',
      url: SOURCE_URL,
      licenseNote: '仅缓存网站常用食材的查询结果并注明来源，不重新分发完整数据库。',
      retrievedAt: new Date().toISOString(),
    },
    count: items.length,
    items,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`写入 ${OUT}：${items.length} 条`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});