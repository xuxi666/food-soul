import fs from 'node:fs';
import path from 'node:path';

import { db } from './db.mjs';
import { LEXICON } from './epicure-lexicon.mjs';

/**
 * 食材名称解析（统一显示层）
 *
 * 图谱节点、搜索结果、已选标签都走这里，避免在绘制代码里散落硬编码。
 * 解析顺序（越靠前越权威）：
 *   1. 项目词表（人工核对，带别名）
 *   2. Epicure 官网目录（1032 条，含中文名）
 *   3. MCP 专属名映射（目录里没有、只在 MCP 出现的名字）
 *   4. 兜底：原样显示（下划线换成空格），标记 translated=false，不猜
 *
 * 注意：只做显示，不改变传给 Epicure 的原始名。
 */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();

let mcpMapCache = null;
function loadMcpMap() {
  if (mcpMapCache) return mcpMapCache;
  try {
    const file = path.join(process.cwd(), 'data', 'epicure-mcp-cn.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    mcpMapCache = new Map(
      Object.entries(raw)
        .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
        .map(([k, v]) => [norm(k), v.trim()])
    );
  } catch {
    mcpMapCache = new Map();
  }
  return mcpMapCache;
}

let lexIndex = null;
function lexiconIndex() {
  if (lexIndex) return lexIndex;
  const byEpicure = new Map();
  for (const item of LEXICON) {
    for (const cand of [item.epicure, ...(item.candidates || [])]) {
      const k = norm(cand);
      if (k && !byEpicure.has(k)) byEpicure.set(k, item.cn);
    }
  }
  lexIndex = byEpicure;
  return lexIndex;
}

/** 目录缓存：name(归一) -> cn */
let catalogIndex = null;
let catalogStamp = 0;
function catalogIndexSafe() {
  try {
    const stamp = db.prepare('SELECT COUNT(*) AS n FROM epicure_catalog').get()?.n || 0;
    if (catalogIndex && stamp === catalogStamp) return catalogIndex;
    const map = new Map();
    for (const r of db.prepare('SELECT name, cn FROM epicure_catalog').all()) {
      if (r.cn) map.set(norm(r.name), r.cn);
    }
    catalogIndex = map;
    catalogStamp = stamp;
    return map;
  } catch {
    return catalogIndex || new Map();
  }
}

/** 把下划线名变成可读英文：yu_choy → Yu Choy */
function prettify(name) {
  return String(name || '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** 中心词：组合翻译时放在末尾的中文 */
const HEAD_CN = {
  oil: '油', sauce: '酱', powder: '粉', cheese: '奶酪', pepper: '辣椒', stock: '汤', broth: '汤',
  leaf: '叶', seed: '籽', bean: '豆', flower: '花', root: '根', melon: '瓜', fish: '鱼',
  mushroom: '蘑菇', squash: '南瓜', rice: '米', bread: '面包', cake: '蛋糕', soup: '汤',
  salad: '沙拉', vinegar: '醋', wine: '酒', juice: '汁', syrup: '糖浆', paste: '酱',
  butter: '黄油', cream: '奶油', milk: '奶', sugar: '糖', salt: '盐', water: '水', tea: '茶',
  meat: '肉', sausage: '香肠', ham: '火腿', egg: '蛋', tofu: '豆腐', noodle: '面', flour: '粉',
  spice: '香料', seasoning: '调料', dressing: '酱', liqueur: '利口酒', extract: '提取物',
  blossom: '花', bud: '芽', sprout: '苗', shoot: '笋', peel: '皮', zest: '皮', puree: '泥',
  jam: '果酱', jelly: '冻', chip: '片', ball: '丸', roll: '卷', pie: '派', cookie: '饼干',
  biscuit: '饼干', cracker: '薄饼', beer: '啤酒', cider: '苹果酒', rum: '朗姆酒', vodka: '伏特加',
  whiskey: '威士忌', gin: '金酒', brandy: '白兰地', molasses: '糖蜜', nectar: '花蜜',
};

/** 从已核对的映射里反推词根（sesame_oil → 芝麻油，可推出 sesame → 芝麻） */
/** 常用食材词根（组合翻译的底表，与自动学习结果合并） */
const BASE_WORDS = {
  pizza: '披萨', zucchini: '西葫芦', honeydew: '蜜瓜', camembert: '卡芒贝尔', cane: '甘蔗',
  fish: '鱼', pork: '猪', beef: '牛', chicken: '鸡', lamb: '羊', duck: '鸭', goose: '鹅',
  shrimp: '虾', prawn: '对虾', crab: '蟹', squid: '鱿鱼', octopus: '章鱼', clam: '蛤蜊',
  oyster: '生蚝', mussel: '贻贝', scallop: '扇贝', lobster: '龙虾', abalone: '鲍鱼',
  egg: '蛋', milk: '奶', cream: '奶油', butter: '黄油', cheese: '奶酪', yogurt: '酸奶',
  pepper: '辣椒', chili: '辣椒', chilli: '辣椒', garlic: '蒜', onion: '洋葱', ginger: '姜',
  scallion: '葱', sesame: '芝麻', peanut: '花生', walnut: '核桃', almond: '杏仁', cashew: '腰果',
  hazelnut: '榛子', coconut: '椰子', palm: '棕榈', olive: '橄榄', tomato: '番茄', potato: '土豆',
  sweet: '甜', green: '青', red: '红', black: '黑', white: '白', yellow: '黄', purple: '紫',
  dried: '干', smoked: '烟熏', pickled: '腌', salted: '咸', sour: '酸', hot: '辣', wild: '野',
  sea: '海', water: '水', rice: '米', wheat: '小麦', oat: '燕麦', soy: '大豆', bean: '豆',
  corn: '玉米', mushroom: '蘑菇', truffle: '松露', herb: '香草', spice: '香料', curry: '咖喱',
  honey: '蜂蜜', maple: '枫', cocoa: '可可', chocolate: '巧克力', coffee: '咖啡', tea: '茶',
  fruit: '水果', vegetable: '蔬菜', veal: '小牛', mutton: '羊', turkey: '火鸡', bacon: '培根',
  ham: '火腿', sausage: '香肠', anchovy: '鳀鱼', tuna: '金枪鱼', salmon: '三文鱼', cod: '鳕鱼',
  bass: '鲈鱼', bream: '鲷鱼', carp: '鲤鱼', eel: '鳗鱼', seaweed: '海藻', kelp: '海带',
  nori: '海苔', bamboo: '竹', lotus: '莲', taro: '芋头', yam: '山药', pumpkin: '南瓜',
  apple: '苹果', pear: '梨', peach: '桃', plum: '李', grape: '葡萄', lemon: '柠檬', lime: '青柠',
  orange: '橙', mango: '芒果', banana: '香蕉', pineapple: '菠萝', strawberry: '草莓',
  cherry: '樱桃', blueberry: '蓝莓', raspberry: '树莓', fig: '无花果', date: '椰枣',
  raisin: '葡萄干', nut: '坚果', seed: '籽', leaf: '叶', root: '根', flower: '花',
  citrus: '柑橘', berry: '浆果', melon: '瓜', squash: '南瓜', radish: '萝卜', cabbage: '白菜',
  spinach: '菠菜', lettuce: '生菜', celery: '芹菜', carrot: '胡萝卜', broccoli: '西兰花',
  cauliflower: '花菜', cucumber: '黄瓜', eggplant: '茄子', okra: '秋葵', pea: '豌豆',
  lentil: '扁豆', chickpea: '鹰嘴豆', barley: '大麦', rye: '黑麦', buckwheat: '荞麦',
  quinoa: '藜麦', millet: '小米', sorghum: '高粱', noodle: '面', bread: '面包', cake: '蛋糕',
  durian: '榴莲', jackfruit: '菠萝蜜', lychee: '荔枝', longan: '龙眼', rambutan: '红毛丹',
  mangosteen: '山竹', pomelo: '柚子', kumquat: '金桔', loquat: '枇杷', persimmon: '柿子',
  jujube: '红枣', hawthorn: '山楂', waterchestnut: '荸荠', arrowroot: '竹芋', cassava: '木薯',
  yuca: '木薯', plantain: '大蕉', breadfruit: '面包果', salsify: '婆罗门参', celeriac: '根芹',
  kohlrabi: '苤蓝', rutabaga: '芜菁甘蓝', parsnip: '欧防风', endive: '菊苣', radicchio: '紫菊苣',
  arugula: '芝麻菜', watercress: '水芹', fennel: '茴香', leek: '韭葱', shallot: '红葱头',
  chive: '细香葱', tarragon: '龙蒿', marjoram: '马郁兰', oregano: '牛至', rosemary: '迷迭香',
  thyme: '百里香', basil: '罗勒', parsley: '欧芹', dill: '莳萝', sage: '鼠尾草', mint: '薄荷',
  wasabi: '芥末', horseradish: '辣根', saffron: '藏红花', turmeric: '姜黄', paprika: '红椒粉',
  sumac: '漆树果', zaatar: '中东香料', harissa: '哈里萨辣酱', tahini: '芝麻酱', hummus: '鹰嘴豆泥',
};

let tokenDict = null;
function buildTokenDict() {
  const dict = new Map(Object.entries(BASE_WORDS));
  const learn = (en, cn) => {
    const parts = String(en).toLowerCase().split(/[_\s]+/).filter(Boolean);
    if (parts.length < 2) return;
    const head = parts[parts.length - 1];
    const headCn = HEAD_CN[head];
    if (!headCn || !String(cn).endsWith(headCn)) return;
    const prefixCn = String(cn).slice(0, String(cn).length - headCn.length);
    const prefixEn = parts.slice(0, -1);
    // 只在「词根数 = 1」时学习，避免错误切分
    if (prefixEn.length === 1 && prefixCn) {
      if (!dict.has(prefixEn[0])) dict.set(prefixEn[0], prefixCn);
    }
  };
  for (const [en, cn] of Object.entries(Object.fromEntries(loadMcpMap()))) learn(en, cn);
  try {
    for (const r of db.prepare('SELECT name, cn FROM epicure_catalog WHERE cn IS NOT NULL').all()) learn(r.name, r.cn);
  } catch {
    /* 目录不可用时只用映射表 */
  }
  for (const [k, cn] of lexiconIndex()) learn(k, cn);
  return dict;
}

function composeName(key) {
  const parts = key.split(' ');
  if (parts.length < 2) return null;
  const head = parts[parts.length - 1];
  const headCn = HEAD_CN[head];
  if (!headCn) return null;
  if (!tokenDict) tokenDict = buildTokenDict();
  const mods = parts.slice(0, -1);
  const modCn = [];
  for (const m of mods) {
    const cn = tokenDict.get(m);
    if (!cn) return null;
    modCn.push(cn);
  }
  const prefix = modCn.join('');
  // 前缀本身已包含中心词时不再重复（honeydew_melon → 蜜瓜，不是 蜜瓜瓜）
  const out = prefix.endsWith(headCn) ? prefix : prefix + headCn;
  // 太长的组合大概率是硬拼，宁可退回「未收录」
  return out.length <= 8 ? out : null;
}

/**
 * @param {string} name Epicure 原始食材名（可能是 yu_choy 这种下划线写法）
 * @returns {{name:string, display:string, translated:boolean, source:'lexicon'|'catalog'|'mcp-map'|'raw'}}
 */
export function resolveDisplay(name) {
  const raw = String(name || '').trim();
  const key = norm(raw);
  if (!key) return { name: raw, display: raw, translated: false, source: 'raw' };

  const lex = lexiconIndex().get(key);
  if (lex) return { name: raw, display: lex, translated: true, source: 'lexicon' };

  const cat = catalogIndexSafe().get(key);
  if (cat) return { name: raw, display: cat, translated: true, source: 'catalog' };

  const mcp = loadMcpMap().get(key);
  if (mcp) return { name: raw, display: mcp, translated: true, source: 'mcp-map' };

  // 4) 组合翻译：词根 + 中心词（如 lemon_leaf → 柠檬 + 叶）
  const composed = composeName(key);
  if (composed) return { name: raw, display: composed, translated: true, source: 'compose' };

  // 5) 单个单词：直接查词根表（durian → 榴莲）
  const single = (tokenDict || (tokenDict = buildTokenDict())).get(key);
  if (single) return { name: raw, display: single, translated: true, source: 'compose' };

  // 兜底：界面上不出现英文，统一显示「未收录」，原文放到 original 供 tooltip 使用
  return { name: raw, display: '未收录', translated: false, source: 'raw', original: prettify(raw) };
}

/** 只取显示名 */
export function displayNameOf(name) {
  return resolveDisplay(name).display;
}

/** 测试用：清空缓存 */
export function __resetNameCache() {
  mcpMapCache = null;
  lexIndex = null;
  tokenDict = null;
  catalogIndex = null;
  catalogStamp = 0;
}
