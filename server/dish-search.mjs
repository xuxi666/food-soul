import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISHES, DISH_BY_ID } from '../src/data/dishes.js';
import { CUISINE_BY_ID, CUISINES, TASTE_BY_ID, TASTES } from '../src/data/cuisines.js';
import { isSearchConfigured } from './config.mjs';
import { extractJSON } from './json-utils.mjs';
import { complete } from './ai-adapter.mjs';
import { webSearch } from './web-search.mjs';
import {
  ensureDir,
  listImageHashes,
  downloadCandidate,
  searchImageCandidates,
} from './dish-images.mjs';

/**
 * AI 联网补全菜品：GLM(web_search) 生成真实菜品资料 → 真实图片检索去重 → 落盘持久化。
 * 只补「站内还没有的菜」，任何环节失败都明确报错，不伪造数据。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN_FILE = path.join(ROOT, 'data', 'generated-dishes.json');
const GEN_DIR = path.join(ROOT, 'public', 'dishes', 'generated');
const GEN_URL = '/dishes/generated/';
const GEN_MAX = 320;

const TASTE_IDS = TASTES.map((t) => t.id);
const CUISINE_IDS = CUISINES.map((c) => c.id);
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TECHNIQUES = ['炒', '蒸', '炖', '烧', '煮', '焖', '拌', '炸', '烤', '卤', '煎', '烩', '煲', '汆'];

/* ---------------- 检索方向：按菜系给模型更多角度，避免一轮只想到那几道 ---------------- */
const CUISINE_THEMES = {
  chuan: ['四川传统名菜', '成都家常菜', '重庆江湖菜', '川味小吃', '川菜宴席菜'],
  yue: ['广东传统名菜', '广府菜（广州菜）代表菜', '潮汕特色菜', '客家传统菜', '广东地方小吃', '粤式宴席菜'],
  lu: ['山东传统名菜', '济南菜', '胶东海鲜菜', '孔府菜', '鲁地小吃'],
  su: ['江苏传统名菜', '淮扬菜', '金陵菜', '苏式面点', '江南甜点'],
  zhe: ['浙江传统名菜', '杭州菜', '宁波菜', '绍兴菜', '温州菜', '浙式点心'],
  min: ['福建传统名菜', '福州菜', '闽南菜', '闽西客家菜', '福建小吃'],
  xiang: ['湖南传统名菜', '长沙家常菜', '湘西菜', '湘式腊味', '湖南小吃'],
  hui: ['安徽传统名菜', '徽州菜', '沿江菜', '徽式点心'],
};
const REGION_OF = { chuan: '四川', yue: '广东', lu: '山东', su: '江苏', zhe: '浙江', min: '福建', xiang: '湖南', hui: '安徽' };

/* 味型侧的检索方向：同样是「方向」不是菜名，每轮换一组，避免反复搜同一批 */
const TASTE_THEMES = {
  mala: ['川渝麻辣名菜', '重庆火锅与江湖菜', '水煮系列', '麻辣凉菜', '麻辣香锅类'],
  xiangla: ['湘菜香辣代表菜', '川味香辣菜', '干锅爆炒香辣菜', '辣椒炒肉类', '香辣小吃'],
  suanla: ['酸辣汤羹类', '酸辣粉面小吃', '泡椒酸辣菜', '酸汤类菜肴', '醋香开胃菜'],
  qingxian: ['清蒸海鲜', '白灼与水煮本味菜', '上汤时蔬', '清炖汤品', '原味家常菜'],
  xianxian: ['咸鲜家常菜', '高汤煨制菜', '豉油葱油类', '咸鲜宴席菜', '咸鲜小炒'],
  xiantian: ['糖醋类菜肴', '蜜汁与挂霜菜', '甜口烧菜', '鲜甜海河鲜', '甜味小吃'],
  jiangxiang: ['酱香卤味', '豆瓣酱香菜', '甜面酱与面酱菜', '酱烧菜', '酱香家常菜'],
  chunhou: ['红烧肉肘子类', '老火煨炖菜', '胶质浓香菜', '砂锅菜', '慢炖汤菜'],
};

/** 按分类取检索方向：菜系用 CUISINE_THEMES，口味用 TASTE_THEMES */
/* 菜名里的风味线索：只用来排除「菜名明摆着是别的味型」的候选 */
const TASTE_NAME_HINTS = {
  mala: ['麻辣', '麻婆', '水煮', '花椒', '椒麻'],
  xiangla: ['香辣', '剁椒', '干锅', '辣椒炒', '小炒'],
  suanla: ['酸辣', '酸汤', '泡椒', '酸菜', '醋'],
  qingxian: ['清蒸', '白灼', '上汤', '清炖', '原味'],
  xianxian: ['咸鲜', '葱油', '豉油', '高汤'],
  xiantian: ['糖醋', '蜜汁', '拔丝', '挂霜', '甜'],
  jiangxiang: ['酱香', '酱爆', '酱焖', '卤', '酱'],
  chunhou: ['红烧', '扣肉', '煨', '砂锅', '浓汤'],
};

/* 菜系佐证词：模型给的菜系要能在检索结果里找到对应地域，否则宁可不写 */
const CUISINE_WORDS = {
  chuan: ['川菜', '四川', '成都', '重庆', '川味', '巴蜀'],
  yue: ['粤菜', '广东', '广州', '潮汕', '客家', '顺德', '广府'],
  lu: ['鲁菜', '山东', '济南', '胶东', '孔府'],
  su: ['苏菜', '江苏', '扬州', '南京', '苏州', '淮扬'],
  zhe: ['浙菜', '浙江', '杭州', '宁波', '绍兴', '温州'],
  min: ['闽菜', '福建', '福州', '厦门', '泉州', '闽南'],
  xiang: ['湘菜', '湖南', '长沙', '湘西', '湘潭'],
  hui: ['徽菜', '安徽', '徽州', '皖南'],
};

/** 菜名本身是否指向另一个味型（是则不给当前味型收录，省一轮检索） */
function nameTasteConflict(name, target) {
  const hit = (id) => (TASTE_NAME_HINTS[id] || []).some((w) => String(name).includes(w));
  if (hit(target)) return false; // 菜名明确指向本味型，放行
  return Object.keys(TASTE_NAME_HINTS).some((id) => id !== target && hit(id));
}

/** 菜系是否有检索结果佐证（找不到就当未知，不硬写） */
function cuisineSupported(id, text) {
  const words = CUISINE_WORDS[id] || [];
  const hay = String(text || '');
  return words.some((w) => hay.includes(w));
}

function deckThemes(context) {
  const base = context.kind === 'taste' ? TASTE_THEMES[context.fallbackTaste] : CUISINE_THEMES[context.fallbackCuisine];
  return base && base.length ? base : null;
}

function themeFor(context, round) {
  const base = deckThemes(context) || [
    `${context.label}经典名菜`,
    `${context.label}地方特色菜`,
    `${context.label}传统小吃`,
  ];
  const offset = round % base.length;
  return [...base.slice(offset), ...base.slice(0, offset)].slice(0, 4);
}

/** 繁体→简体（只覆盖菜名里常见的字，够用且不依赖第三方库） */
const TRAD_SIMP = {
  鵝: '鹅', 燒: '烧', 雞: '鸡', 麵: '面', 滷: '卤', 蠔: '蚝', 鮮: '鲜', 魚: '鱼', 蝦: '虾',
  東: '东', 廣: '广', 點: '点', 醬: '酱', 湯: '汤', 飯: '饭', 龍: '龙', 鳳: '凤', 臘: '腊',
  腸: '肠', 絲: '丝', 燉: '炖', 燜: '焖', 鍋: '锅', 餃: '饺', 餅: '饼', 鹹: '咸', 豬: '猪',
  鴨: '鸭', 鵪: '鹌', 鶉: '鹑', 蓮: '莲', 蘿: '萝', 蔔: '卜', 漿: '浆', 糰: '团', 圓: '圆',
  軟: '软', 麥: '麦', 齋: '斋', 粵: '粤', 蘇: '苏', 浙: '浙', 閩: '闽', 湘: '湘', 徽: '徽',
};

/** 归一化：去空白与标点、去英文数字、繁体转简体，用于菜名比对 */
function normalizeForMatch(v) {
  return String(v || '')
    .replace(/[\s\u3000·・、,，。;；:：!！?？"'“”‘’()（）\[\]【】《》<>\/\\|—_\-~～]/g, '')
    .replace(/[A-Za-z0-9]/g, '')
    .split('')
    .map((ch) => TRAD_SIMP[ch] || ch)
    .join('');
}

/** 检索结果里是否真的出现了这道菜（允许省略地域前缀） */
function nameMatches(hay, name) {
  const h = normalizeForMatch(hay);
  const n = normalizeForMatch(name);
  if (!h || !n) return false;
  if (h.includes(n)) return true;
  if (n.length >= 3) {
    const core = n.replace(
      /^(潮州|潮汕|广州|广府|顺德|客家|梅州|湛江|茂名|阳江|中山|东莞|深圳|香港|澳门|台山|开平|新会|南海|番禺|斗门|惠州|肇庆|韶关|清远|河源|汕头|揭阳|汕尾|四川|成都|重庆|山东|济南|胶东|江苏|扬州|南京|苏州|浙江|杭州|宁波|绍兴|温州|福建|福州|厦门|泉州|湖南|长沙|安徽|徽州)/,
      ''
    );
    if (core.length >= 2 && core !== n && h.includes(core)) return true;
  }
  return false;
}

/**
 * 近似重名：只在「一方完整包含另一方且长度差 ≤ 3」时判定为同一道菜。
 * 这样「蒸排骨」不会被当成「豉汁蒸排骨」之外的新菜，也不会误杀「白灼虾」与「油焖大虾」。
 */
function looksLikeExisting(name, existingNames) {
  const n = normalizeForMatch(name);
  if (n.length < 2) return false;
  for (const raw of existingNames) {
    const e = normalizeForMatch(raw);
    if (!e) continue;
    if (e === n) return true;
    if (Math.abs(e.length - n.length) > 3) continue;
    if (e.includes(n) || n.includes(e)) return true;
  }
  return false;
}

function logDishSearch(fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => k + '=' + (typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : v));
  console.log('[dish-search] ' + parts.join(' '));
}

/**
 * 单条候选验证：最多 3 组检索词，必须同时满足
 *   1) 至少一条结果的「标题」里就有这道菜（不是只出现在其它菜的列表摘要里）
 *   2) 至少两个不同站点的结果提到它
 * 组合名（例如「双皮奶炖蛋花汤」这类模型自创的组合）通常过不了第一条。
 */
async function verifyCandidate(name, context) {
  const region = REGION_OF[context.fallbackCuisine] || '';
  const queries = [`${name} 做法`, region ? `${name} ${region}` : `${name} 菜谱`, name];
  const hostOf = (src) => {
    try {
      return new URL(src.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  let queriesRun = 0;
  let last = null;
  let sawService = false;
  const titleHits = new Map();
  const anyHits = new Map();

  for (const q of queries) {
    const r = await webSearch(q, { count: 5, timeout: 9000 });
    queriesRun += 1;
    last = r;
    if (r.status === 'ok' || r.status === 'empty') sawService = true;
    for (const src of r.sources || []) {
      const key = String(src.url || src.title || '').slice(0, 240);
      if (nameMatches(src.title || '', name)) titleHits.set(key, src);
      if (nameMatches((src.title || '') + ' ' + (src.snippet || ''), name)) anyHits.set(key, src);
    }
    const hosts = new Set([...anyHits.values()].map(hostOf).filter(Boolean));
    if (titleHits.size >= 1 && hosts.size >= 2) {
      return {
        ok: true,
        query: q,
        source: r,
        queries: queriesRun,
        sawService,
        hosts: [...hosts].slice(0, 3),
        titleHit: String([...titleHits.values()][0]?.title || '').slice(0, 48),
      };
    }
    if (r.status === 'failed' || r.status === 'unavailable') break; // 服务不可用别浪费剩下两组
  }

  const hosts = new Set([...anyHits.values()].map(hostOf).filter(Boolean));
  const reason = !last
    ? '未检索到可靠资料'
    : last.status === 'timeout'
      ? '检索超时，未验证'
      : titleHits.size === 0
        ? '没有找到这道菜的菜谱页，已跳过'
        : hosts.size < 2
          ? '只有单一来源提到，真实性不足，已跳过'
          : '未检索到可靠资料，已跳过';
  return { ok: false, query: '', source: last, queries: queriesRun, reason, sawService };
}


let cache = null;
let hashCache = null;
const inflight = new Map();

/** 旧记录自愈：口味页的记录按当前判据复检（菜名味型冲突的丢掉，菜系无佐证的抹掉） */
/** 旧记录自愈：口味页的记录按当前判据复检 —— 菜名指向别的味型的丢掉，
 *  菜系一律抹掉（同时把文案里顺带写死的菜系名换掉，避免前后矛盾）。 */
function sanitizeGenerated(list) {
  const targetOf = (d) => (d?.source?.requestedKind === 'taste' ? d.source.categoryId || '' : '');
  return list
    .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string')
    .filter((d) => {
      const target = targetOf(d);
      return !target || !nameTasteConflict(d.name, target);
    })
    .map((d) => {
      const target = targetOf(d);
      if (!target || !d.cuisine) return d;
      const oldName = CUISINE_BY_ID[d.cuisine]?.name || '';
      const swap = (v) => (oldName ? String(v || '').split(oldName).join('中国菜') : v);
      return {
        ...d,
        cuisine: '',
        alt: `${d.name}（中国菜）`,
        oneLiner: swap(d.oneLiner),
        intro: swap(d.intro),
        signature: swap(d.signature),
        knowledge: (d.knowledge || []).map(swap),
      };
    });
}

function readGenerated() {
  if (cache) return cache;
  cache = [];
  try {
    if (fs.existsSync(GEN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(GEN_FILE, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed?.dishes;
      if (Array.isArray(list)) {
        cache = sanitizeGenerated(list);
      }
    }
  } catch {
    cache = [];
  }
  return cache;
}

function writeGenerated(list) {
  cache = list.slice(-GEN_MAX);
  const dir = path.dirname(GEN_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = GEN_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), dishes: cache }, null, 2));
  fs.renameSync(tmp, GEN_FILE);
}

export function generatedDishes() {
  return readGenerated();
}

export function findDish(id) {
  if (!id) return null;
  return DISH_BY_ID[id] || readGenerated().find((d) => d.id === id) || null;
}

function knownHashes() {
  if (!hashCache) {
    hashCache = listImageHashes(path.join(ROOT, 'public', 'dishes'));
    hashCache = new Set([...hashCache, ...listImageHashes(GEN_DIR)]);
  }
  return hashCache;
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/[「」【】《》""'']/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 10);
}

function num(v, fallback, min = 0, max = 600) {
  const n = typeof v === 'number' ? v : parseInt(String(v || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pickTastes(raw, fallbackTaste) {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  const ids = [];
  for (const t of list) {
    if (TASTE_IDS.includes(t)) ids.push(t);
    else {
      const hit = TASTES.find((x) => x.name === t || x.name.includes(t) || t.includes(x.name));
      if (hit) ids.push(hit.id);
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length) return unique.slice(0, 3);
  const fb = fallbackTaste && TASTE_IDS.includes(fallbackTaste) ? fallbackTaste : 'qingxian';
  return [fb];
}

function pickCuisine(raw, fallbackCuisine, allowEmpty = false) {
  const id = String(raw || '').trim();
  if (CUISINE_IDS.includes(id)) return id;
  const hit = CUISINES.find((c) => c.name === id || (id && (c.name.includes(id) || id.includes(c.name))));
  if (hit) return hit.id;
  if (fallbackCuisine && CUISINE_IDS.includes(fallbackCuisine)) return fallbackCuisine;
  return allowEmpty ? '' : 'chuan';
}

function pickTechniques(raw) {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((t) => String(t || '').trim())
    .filter((t) => TECHNIQUES.includes(t));
  return [...new Set(list)].slice(0, 4);
}

function makeId(name, cuisine) {
  return 'ai-' + crypto.createHash('sha1').update(name + '|' + cuisine).digest('hex').slice(0, 10);
}

function contextFor(kind, id) {
  if (kind === 'taste') {
    const taste = TASTE_BY_ID[id];
    return taste ? { kind, label: taste.name + '味型', fallbackTaste: taste.id, fallbackCuisine: '', desc: taste.desc || '' } : null;
  }
  if (kind === 'cuisine') {
    const cuisine = CUISINE_BY_ID[id];
    return cuisine ? { kind, label: cuisine.name, fallbackCuisine: cuisine.id, fallbackTaste: '' } : null;
  }
  return { kind: 'all', label: '中国菜', fallbackCuisine: '', fallbackTaste: '' };
}

async function askModel(context, excludeNames, want, modelConfig, themes = [], round = 0) {
  const system = [
    '你是中国菜资料整理助手。',
    '请提出「真实存在、常见、可在家里做」的候选菜品，之后系统会用真实网络检索逐条验证。',
    '只输出一个 JSON 对象，不要解释、不要 markdown 围栏。',
  ].join('\n');

  const user = [
    `请为「${context.label}」提出 ${want} 道站内还没有的真实菜品候选（已有 ${excludeNames.length} 道，不要重复）。`,
    context.kind === 'taste'
      ? '只输出精简 JSON：{"dishes":[{"name":"中文菜名(2-10字)","cuisine":"菜系id","tastes":["味型id"],"ingredients":["主料1","主料2"],"intro":"一句话介绍(不超过30字)"}]}'
      : '只输出精简 JSON：{"dishes":[{"name":"中文菜名(2-10字)","ingredients":["主料1","主料2"],"intro":"一句话介绍(不超过30字)"}]}',
    context.kind === 'taste'
      ? `每道菜都要给 tastes（只能取 ${TASTE_IDS.join('/')}）：第一位填这道菜真正的主味型，必须就是 ${context.fallbackTaste}；主味型不是这个的菜不要提。`
      : '每道菜必须给 name 与 1-4 个主料；味型、菜系、技法、时间由系统按分类自动补全，不要输出这些字段。',
    context.kind === 'all'
      ? `例外：本次按“全部”检索，请额外给出 cuisine（只能取：${CUISINE_IDS.join('/')}）与 tastes（只能取：${TASTE_IDS.join('/')}）。`
      : '',
    context.kind === 'cuisine' && context.fallbackCuisine
      ? `本次只收「${context.label}」的菜（菜系 id: ${context.fallbackCuisine}），其它菜系一律不要；请优先给有代表性、但站内还没收录的经典菜。`
      : context.kind === 'taste' && context.fallbackTaste
        ? `本次只收符合「${context.label}」的菜（味型 id: ${context.fallbackTaste}${context.desc ? `，特征：${context.desc}` : ''}）。判断依据是这道菜的主要风味，不是菜名里有没有相关字眼。`
        : '本次收全国范围内的常见家常菜。',
    themes.length ? `本轮优先从这些方向里找（这是检索方向，不是菜名，也不要照抄成菜名）：${themes.join('、')}。` : '',
    round > 0 ? '上一轮候选已被验证过，本轮请换地区、换类型，不要再给同一批菜。' : '',
    '菜名必须是真实存在的中文菜名，简体，不要编造，不要加字改装。',
    `已收录（禁止重复）：${excludeNames.slice(-120).join('、')}`,
  ].join('\n');

  const content = await complete({
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    model: modelConfig.model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.55,
    maxTokens: 900,
    timeout: 60000,
  });
  const parsed = extractJSON(content);
  const list = parsed?.dishes;
  if (!Array.isArray(list)) throw new Error('模型未返回可解析的菜品 JSON');
  return { list };
}

async function attachImage(record, { deadline = 0, name = '' } = {}) {
  const target = normalizeForMatch(name || record.name);
  const queries = [`${name || record.name} 菜品 成品`, `${name || record.name} 家常做法`, `${name || record.name} 菜谱`];
  const lists = [];
  for (const q of queries) {
    const got = await searchImageCandidates(q).catch(() => []);
    lists.push(...got);
    if (lists.length >= 14) break;
  }
  const seen = new Set();
  const scored = [];
  for (const c of lists) {
    const key = String(c.url || '').split('?')[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = normalizeForMatch(c.title || '');
    let score = 0;
    if (title && target) {
      if (title.includes(target)) score = 2;
      else if (target.length >= 3 && (title.includes(target.slice(1)) || title.includes(target.slice(0, -1)))) score = 1;
    }
    scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const cand of scored.slice(0, 8)) {
    // 标题里对不上菜名的一律不用：宁可给占位图，也不拿别的菜的图冒充
    if (cand.score < 1) break;
    if (deadline && Date.now() > deadline) break;
    try {
      const got = await downloadCandidate(cand, knownHashes());
      return { buf: got.buf, ext: got.ext, hash: got.hash, provider: got.provider, source: got.source, score: cand.score };
    } catch {
      /* 换下一张 */
    }
  }
  return null;
}

/**
 * 搜索并落盘新增菜品。
 * @param {{kind?:'cuisine'|'taste'|'all', id?:string, excludeIds?:string[], limit?:number}} input
 */
export async function searchDishes(input = {}) {
  const hasId = Boolean(input.id);
  const kind = !hasId ? 'all' : input.kind === 'taste' ? 'taste' : 'cuisine';
  const context = contextFor(kind, String(input.id || ''));
  if (!context) return { status: 'failed', note: '分类不存在', items: [], reason: 'bad_category' };

  const limit = Math.max(1, Math.min(6, Number(input.limit) || 3));
  const excludeIds = new Set(
    (Array.isArray(input.excludeIds) ? input.excludeIds : []).map(String).filter(Boolean)
  );

  if (!input.modelConfig?.apiKey) {
    return {
      status: 'failed',
      items: [],
      note: '请先登录并在右上角接入 AI 大模型。',
      configNeeded: ['ai'],
      reason: 'ai_not_configured',
    };
  }
  if (!isSearchConfigured()) {
    return {
      status: 'failed',
      items: [],
      note: '联网检索服务未配置，无法验证菜品真实性。',
      configNeeded: ['SEARCH_API_KEY'],
      reason: 'search_not_configured',
    };
  }

  const key = `${kind}:${context.label}:${limit}`;
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const startedAt = Date.now();
    const deadline = startedAt + 95_000;
    const stats = {
      rounds: 0,
      queries: 0,
      searchOk: 0,
      searchFailed: 0,
      proposed: 0,
      parsed: 0,
      sameName: 0,
      verified: 0,
      rejected: 0,
      imageMissing: 0,
      accepted: 0,
      ms: 0,
    };
    const items = [];
    const skipped = [];

    try {
      const generated = readGenerated();
      const existingNames = new Set([...DISHES.map((d) => d.name), ...generated.map((d) => d.name)]);
      const claimed = new Set(knownHashes());
      const proposed = new Set();
      const pool = [];
      let modelError = null;

      /* ---------- 1) 候选：最多 3 轮，每轮换检索方向，凑够就停 ---------- */
      for (
        let round = 0;
        round < 3 && items.length + pool.length < limit && Date.now() < deadline - 15_000;
        round += 1
      ) {
        stats.rounds += 1;
        const want = Math.min(12, Math.max(6, (limit - items.length) * 3));
        const themes = themeFor(context, round);
        let list = [];
        try {
          const asked = await askModel(
            context,
            [...existingNames, ...proposed],
            want,
            input.modelConfig,
            themes,
            round
          );
          list = asked.list;
        } catch (err) {
          // 单轮模型异常（例如返回了无法解析的 JSON）不终止整轮：
          // 还有下一轮机会，全部轮次都失败才上报「服务不可用」
          modelError = err;
          stats.modelErrors = (stats.modelErrors || 0) + 1;
          continue;
        }
        stats.proposed += list.length;

        const candidates = [];
        for (const raw of list) {
          const name = cleanName(raw?.name || raw?.菜名 || raw?.dish || raw?.title);
          if (name.length < 2) {
            skipped.push({ name: name || '(空)', reason: '菜名无效' });
            continue;
          }
          if (proposed.has(name)) {
            stats.sameName += 1;
            continue;
          }
          if (kind === 'taste' && nameTasteConflict(name, context.fallbackTaste)) {
            skipped.push({ name, reason: '菜名指向别的味型' });
            continue;
          }
          if (existingNames.has(name) || excludeIds.has(name) || looksLikeExisting(name, existingNames)) {
            stats.sameName += 1;
            skipped.push({ name, reason: '站内已有同名/近名菜品，已跳过' });
            continue;
          }
          proposed.add(name);
          stats.parsed += 1;
          candidates.push({ raw, name });
        }
        if (!candidates.length) continue;

        /* 并行验证：4 个一批，命中就收，避免候选太多烧光预算 */
        for (let i = 0; i < candidates.length && items.length + pool.length < limit; i += 4) {
          if (Date.now() > deadline - 10_000) break;
          const batch = candidates.slice(i, i + 4);
          const verdicts = await Promise.all(
            batch.map((c) => verifyCandidate(c.name, context).then((v) => {
              stats.queries += v.queries;
              return v;
            }))
          );
          batch.forEach((c, k) => {
            const v = verdicts[k];
            if (v.sawService) stats.searchOk += 1;
            else stats.searchFailed += 1;
            if (!v.ok) {
              stats.rejected += 1;
              skipped.push({ name: c.name, reason: v.reason });
              return;
            }
            stats.verified += 1;
            if (!pool.some((x) => x.name === c.name) && !items.some((x) => x.name === c.name)) {
              pool.push({ raw: c.raw, name: c.name, verdict: v });
            }
          });
        }
      }

      if (!items.length && !pool.length && stats.searchOk === 0 && stats.searchFailed > 0) {
        stats.ms = Date.now() - startedAt;
        logDishSearch({
          kind,
          id: input.id || '',
          label: context.label,
          rounds: stats.rounds,
          queries: stats.queries,
          proposed: stats.proposed,
          reason: 'search_unavailable',
          ms: stats.ms,
        });
        return {
          status: 'failed',
          items: [],
          skipped,
          reason: 'search_unavailable',
          stats,
          note: '暂时无法连接美食检索服务，请稍后重试。',
        };
      }

      if (!items.length && !pool.length && stats.parsed === 0 && modelError) {
        // 模型没给出任何可用候选：对外只报「没生成出来」，内部细节只进日志
        stats.ms = Date.now() - startedAt;
        logDishSearch({
          kind,
          id: input.id || '',
          label: context.label,
          rounds: stats.rounds,
          proposed: stats.proposed,
          modelErrors: stats.modelErrors || 0,
          error: String(modelError?.message || modelError).slice(0, 120),
          reason: 'model_failed',
          ms: stats.ms,
        });
        return {
          status: 'failed',
          items: [],
          skipped,
          reason: 'model_failed',
          stats,
          note: '本次没能生成新的候选菜品，请稍后重试。',
        };
      }

      /* ---------- 2) 物化：补字段、取真实图片、落盘 ---------- */
      for (const entry of pool) {
        if (items.length >= limit) break;
        const { raw, name, verdict } = entry;
        let cuisine = pickCuisine(raw?.cuisine, context.fallbackCuisine, kind === 'taste');
        // 口味页不认菜系：联网发现只保证「菜是真的 + 主味型对得上」。
        // 菜系由模型顺口猜的并不可靠（实测把酸辣土豆丝写成浙菜、麻辣烫写成闽菜），
        // 所以一律留空，卡片改显示味型（需求允许「所属地域或类型」）。
        if (kind === 'taste') cuisine = '';
        if (!cuisine && kind === 'cuisine') {
          skipped.push({ name, reason: '缺少菜系' });
          continue;
        }
        if (kind === 'cuisine' && cuisine !== context.fallbackCuisine) {
          skipped.push({ name, reason: `菜系不符（${CUISINE_BY_ID[cuisine]?.name || cuisine}）` });
          continue;
        }
        const rawTastes = Array.isArray(raw?.tastes) ? raw.tastes : raw?.tastes ? [raw.tastes] : [];
        let tastes = pickTastes(raw?.tastes, context.fallbackTaste);
        if (!tastes.length) tastes = [cuisine === 'chuan' ? 'mala' : 'xianxian'];
        if (kind === 'taste' && (!tastes.includes(context.fallbackTaste) || (rawTastes.length && tastes[0] !== context.fallbackTaste))) {
          skipped.push({ name, reason: `味型不符（主味型是${TASTE_BY_ID[tastes[0]]?.name || tastes[0]}）` });
          continue;
        }
        const id = makeId(name, cuisine);
        if (
          excludeIds.has(id) ||
          DISH_BY_ID[id] ||
          generated.some((d) => d.id === id) ||
          items.some((d) => d.id === id)
        ) {
          stats.sameName += 1;
          skipped.push({ name, reason: '重复菜品' });
          continue;
        }

        const intro = String(raw?.intro || raw?.description || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        const ingredients = (Array.isArray(raw?.ingredients) ? raw.ingredients : [])
          .map((x) => String(x || '').trim().slice(0, 12))
          .filter(Boolean)
          .slice(0, 8);
        const record = {
          id,
          name,
          nameEn: String(raw?.nameEn || '').replace(/[^\w\s'-]/g, '').slice(0, 40),
          cuisine,
          tastes,
          image: '',
          alt: `${name}（${CUISINE_BY_ID[cuisine]?.name || '中国菜'}）`,
          signature:
            (pickTechniques(raw?.techniques).join('、') || '家常做法') +
            '，' +
            String(intro || `${CUISINE_BY_ID[cuisine]?.name || '中国菜'}风味`).slice(0, 14),
          oneLiner:
            intro ||
            (ingredients.length
              ? `${name}：以${ingredients.slice(0, 3).join('、')}为主的${CUISINE_BY_ID[cuisine]?.name || '中国菜'}做法。`
              : `${name}，${CUISINE_BY_ID[cuisine]?.name || '中国菜'}的经典做法。`),
          intro:
            intro ||
            (ingredients.length
              ? `${name}，${CUISINE_BY_ID[cuisine]?.name || '中国菜'}；代表食材：${ingredients.slice(0, 4).join('、')}。`
              : `${name}，通过真实网络检索发现并验证的${CUISINE_BY_ID[cuisine]?.name || '中国菜'}菜品。`),
          ingredients,
          texture: String(raw?.texture || '口感以家常做法为准').slice(0, 60),
          techniques: pickTechniques(raw?.techniques).length ? pickTechniques(raw?.techniques) : ['炒'],
          history: '',
          personality: tastes[0],
          knowledge: [
            `${name} 属于${CUISINE_BY_ID[cuisine]?.name || '中国菜'}，味型以${TASTE_BY_ID[tastes[0]]?.name || '家常'}为主。`,
            `代表食材：${ingredients.slice(0, 5).join('、') || '按家常做法' }。`,
            '本条资料由 AI 提出候选 + 联网检索逐条验证，图片来自公开图片检索结果，仅供参考。',
          ],
          prep: num(raw?.prep, 15, 0, 240),
          cook: num(raw?.cook, 15, 0, 240),
          difficulty: DIFFICULTIES.includes(raw?.difficulty) ? raw.difficulty : 'medium',
          servings: 2,
          price: 0,
          tags: ['AI 补全', '新发现'],
          aiGenerated: true,
          credit: `AI 候选 + 真实检索验证 · ${input.modelConfig.model}`,
          source: {
            type: 'ai-search',
            model: input.modelConfig.model,
            verifiedBy: verdict.query || 'web_search',
            verifiedAt: new Date().toISOString(),
            verificationSources: (verdict.source?.sources || []).slice(0, 3).map((x) => ({
              title: x.title,
              site: x.site,
              url: x.url,
            })),
            requestedKind: kind,
            categoryId: String(input.id || ''),
            searchedAt: new Date().toISOString(),
          },
        };

        const img = await attachImage(record, { deadline, name });
        if (img) {
          if (claimed.has(img.hash)) {
            skipped.push({ name, reason: '图片与站内其他菜重复，已跳过' });
            continue;
          }
          claimed.add(img.hash);
          ensureDir(GEN_DIR);
          const file = path.join(GEN_DIR, `${record.id}.${img.ext}`);
          fs.writeFileSync(file, img.buf);
          record.image = `${GEN_URL}${record.id}.${img.ext}`;
          record.imageHash = img.hash;
          record.imageProvider = img.provider;
          record.imageSource = img.source;
          record.source.imageProvider = img.provider;
          record.source.imageSource = img.source;
        } else {
          // 拿不到「标题对得上」的真实图片时保留菜品本身，前端用统一占位图，
          // 不拿别的菜的图冒充（下一轮再补图）
          stats.imageMissing += 1;
          record.imageNote = '暂无可靠配图';
        }

        items.push(record);
        existingNames.add(name);
      }

      if (items.length) {
        const merged = [...readGenerated(), ...items];
        writeGenerated(merged);
      }

      stats.accepted = items.length;
      stats.skipped = skipped.length;
      stats.ms = Date.now() - startedAt;

      const reason = items.length
        ? 'ok'
        : stats.verified === 0
          ? 'unverified'
          : stats.proposed === 0
            ? 'no_candidates'
            : 'no_new';

      const notes = [];
      if (items.length) {
        notes.push(`发现了 ${items.length} 道新菜品（模型候选 ${stats.proposed} 道，检索验证通过 ${stats.verified} 道）。`);
      } else if (reason === 'no_candidates') {
        notes.push('模型本轮没有给出新的候选菜品，可以再试一次。');
      } else if (reason === 'unverified') {
        notes.push(`本次没有发现新的可靠菜品：${stats.proposed} 道候选都没能在公开资料中验证到，可以尝试再次探索。`);
      } else {
        notes.push('本次没有发现新的可靠菜品，可以尝试再次探索。');
      }
      if (!items.length && skipped.length) {
        notes.push(
          '被跳过的候选：' +
            skipped
              .slice(0, 3)
              .map((s) => `${s.name}（${s.reason}）`)
              .join('；')
        );
      }

      logDishSearch({
        kind,
        id: context.id || input.id || '',
        label: context.label,
        rounds: stats.rounds,
        queries: stats.queries,
        proposed: stats.proposed,
        parsed: stats.parsed,
        verified: stats.verified,
        rejected: stats.rejected,
        sameName: stats.sameName,
        imageMissing: stats.imageMissing,
        accepted: items.length,
        reason,
        ms: stats.ms,
      });

      return {
        status: items.length ? 'ok' : 'empty',
        items,
        skipped,
        note: notes.join(' '),
        reason,
        stats,
        total: readGenerated().length,
      };
    } catch (err) {
      const aborted = err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''));
      const raw = String(err?.message || '未知错误');
      const upstream = /1234|网络错误/.test(raw);
      stats.ms = Date.now() - startedAt;
      logDishSearch({
        kind,
        id: context.id || input.id || '',
        label: context.label,
        rounds: stats.rounds,
        queries: stats.queries,
        proposed: stats.proposed,
        verified: stats.verified,
        accepted: 0,
        reason: aborted ? 'timeout' : upstream ? 'upstream' : 'error',
        error: raw.slice(0, 120),
        ms: stats.ms,
      });
      return {
        status: 'failed',
        items: [],
        skipped: [],
        reason: aborted ? 'timeout' : upstream ? 'upstream' : 'error',
        stats,
        note: aborted
          ? '联网检索超时（模型 75 秒内未返回结果），请稍后重试。'
          : upstream
            ? '联网搜索服务暂时不可用（模型服务返回网络错误），请稍后点「重试」。'
            : `联网检索失败：${raw.slice(0, 80)}`,
      };
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}