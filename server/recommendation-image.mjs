import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  searchImageCandidates,
  downloadCandidate,
  ensureDir,
  listImageHashes,
} from './dish-images.mjs';

/**
 * AI 推荐菜配图：只负责给「已经生成的菜」找图，不参与推荐内容决策。
 *
 * 优先级：
 *   1. 本地已有菜品图片（server/local-dish-images.json，按菜名/别名精确匹配）
 *   2. 公开图片检索（360 / 百度 / 必应，标题必须含菜名，下载后校验）
 *   3. 没有可用图片生成服务 → 返回 fallback，由前端使用暖色菜品占位图
 *
 * 说明：当前站点没有接入图片生成 API，因此不伪造生成地址，也不调用不存在的服务。
 * 图片失败绝不删除推荐菜，也不回查图鉴/菜谱库替换推荐结果。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'public', 'dishes', 'recommendations');
const CACHE_URL = '/dishes/recommendations/';
const LEGACY_DIR = path.join(ROOT, 'public', 'dishes', 'recipe');
const LEGACY_URL = '/dishes/recipe/';
const LOCAL_INDEX_FILE = path.join(ROOT, 'server', 'local-dish-images.json');
const EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
const DEFAULT_BUDGET = 12_000;
const FALLBACK_TTL = 15 * 60 * 1000;
const MAX_SEARCH_CANDIDATES = 8;

const BAD_RE = /logo|icon|sprite|avatar|qrcode|二维码|菜单|menu|banner|广告|水印|watermark|矢量|插画|简笔画|表情包|海报|模板|wallpaper|壁纸/i;
const TRAD_SIMP = {
  鵝: '鹅', 燒: '烧', 雞: '鸡', 麵: '面', 滷: '卤', 蠔: '蚝', 鮮: '鲜', 魚: '鱼', 蝦: '虾',
  東: '东', 廣: '广', 點: '点', 醬: '酱', 湯: '汤', 飯: '饭', 龍: '龙', 鳳: '凤', 臘: '腊',
  腸: '肠', 絲: '丝', 燉: '炖', 燜: '焖', 鍋: '锅', 餃: '饺', 餅: '饼', 鹹: '咸', 豬: '猪',
  鴨: '鸭', 蓮: '莲', 蘿: '萝', 蔔: '卜', 軟: '软', 麥: '麦', 齋: '斋', 粵: '粤', 蘇: '苏',
  浙: '浙', 閩: '闽', 湘: '湘', 徽: '徽',
};

function str(value, max = 120) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeName(raw) {
  return String(raw || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[·・,，。.!！?？、:：;；'"“”‘’]/g, '')
    .slice(0, 30);
}

function normalizeForMatch(raw) {
  return String(raw || '')
    .replace(/[\s\u3000·・、,，。;；:：!！?？"'“”‘’()（）\[\]【】《》<>\/\\|—_\-~～]/g, '')
    .replace(/[A-Za-z0-9]/g, '')
    .split('')
    .map((ch) => TRAD_SIMP[ch] || ch)
    .join('');
}

function coreName(name) {
  const n = normalizeForMatch(name);
  return n.replace(
    /^(潮州|潮汕|广州|广府|顺德|客家|梅州|湛江|茂名|阳江|中山|东莞|深圳|香港|澳门|台山|开平|新会|南海|番禺|斗门|惠州|肇庆|韶关|清远|河源|汕头|揭阳|汕尾|四川|成都|重庆|山东|济南|胶东|江苏|扬州|南京|苏州|浙江|杭州|宁波|绍兴|温州|福建|福州|厦门|泉州|湖南|长沙|安徽|徽州)/,
    ''
  );
}

function keyOf(name, signature = '') {
  return crypto.createHash('sha1').update(`${normalizeName(name)}|${signature}`, 'utf8').digest('hex').slice(0, 16);
}

function loadLocalIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_INDEX_FILE, 'utf8'));
    const map = new Map();
    for (const item of parsed.items || []) {
      if (!item?.name || !item?.image) continue;
      for (const key of [item.name, ...(item.aliases || [])]) {
        const normalized = normalizeForMatch(key);
        if (normalized && !map.has(normalized)) map.set(normalized, item);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

const LOCAL_INDEX = loadLocalIndex();

function localImageFor(dish) {
  const name = normalizeForMatch(dish?.name);
  if (!name) return null;
  const entry = LOCAL_INDEX.get(name);
  if (!entry) return null;
  const file = path.join(ROOT, 'public', String(entry.image || '').replace(/^\//, ''));
  if (!fs.existsSync(file)) return null;
  return {
    url: entry.image,
    imageSource: 'local',
    imageStatus: 'success',
    match: 'local_exact',
    cached: true,
    sourceUrl: '',
    provider: 'local',
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 旧版 recipe 图片缓存只按菜名存；精确同名且 strict 的可以安全复用。
 */
function legacyImageFor(dish) {
  const name = normalizeName(dish?.name);
  if (!name || !fs.existsSync(LEGACY_DIR)) return null;
  for (const file of fs.readdirSync(LEGACY_DIR)) {
    if (!file.endsWith('.json')) continue;
    const meta = readJson(path.join(LEGACY_DIR, file));
    if (!meta || normalizeName(meta.name) !== name) continue;
    if (meta.match !== 'strict') continue;
    const base = file.replace(/\.json$/i, '');
    const image = fs.readdirSync(LEGACY_DIR).find((f) => f.startsWith(base + '.') && EXT_RE.test(f));
    if (!image) continue;
    return {
      url: LEGACY_URL + image,
      imageSource: 'local',
      imageStatus: 'success',
      match: 'local_cached',
      cached: true,
      sourceUrl: '',
      provider: 'local',
    };
  }
  return null;
}

function cacheImage(key) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs.readdirSync(CACHE_DIR);
  const image = files.find((f) => f.startsWith(key + '.') && EXT_RE.test(f));
  if (!image) return null;
  const meta = readJson(path.join(CACHE_DIR, key + '.json')) || {};
  return {
    url: CACHE_URL + image,
    imageSource: String(meta.imageSource || 'search'),
    imageStatus: 'success',
    imageDescription: String(meta.imageDescription || ''),
    match: String(meta.match || 'strict'),
    cached: true,
    sourceUrl: String(meta.sourceUrl || meta.source || ''),
    provider: String(meta.provider || ''),
  };
}

/**
 * 同一道菜换了一套食材描述时，不应该丢掉已经成功下载过的图。
 * 只在菜名完全一致时复用，不跨菜共享。
 */
function cacheByDishName(name) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const normalized = normalizeName(name);
  let best = null;
  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const meta = readJson(path.join(CACHE_DIR, file));
    if (!meta || meta.imageStatus !== 'success' || normalizeName(meta.name) !== normalized) continue;
    const base = file.replace(/\.json$/i, '');
    const image = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(base + '.') && EXT_RE.test(f));
    if (!image) continue;
    const at = Number(meta.at || 0);
    // 同一道菜已有可用图时优先保留最早成功的一张，避免反复换图引入带水印的新图。
    if (!best || at < best.at) best = { meta, image, at };
  }
  if (!best) return null;
  return {
    url: CACHE_URL + best.image,
    imageSource: String(best.meta.imageSource || 'search'),
    imageStatus: 'success',
    imageDescription: String(best.meta.imageDescription || ''),
    match: String(best.meta.match || 'strict'),
    cached: true,
    sourceUrl: String(best.meta.sourceUrl || best.meta.source || ''),
    provider: String(best.meta.provider || ''),
  };
}

function cacheFallback(key) {
  const meta = readJson(path.join(CACHE_DIR, key + '.json'));
  if (!meta || meta.imageStatus !== 'fallback') return null;
  if (Date.now() - Number(meta.at || 0) > FALLBACK_TTL) return null;
  return {
    url: '',
    imageSource: 'fallback',
    imageStatus: 'fallback',
    imageDescription: String(meta.imageDescription || ''),
    match: '',
    cached: true,
    sourceUrl: '',
    provider: '',
    reason: String(meta.reason || 'image_not_found'),
  };
}

function writeMeta(key, data) {
  ensureDir(CACHE_DIR);
  try {
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(data, null, 2));
  } catch {
    /* 缓存写失败不影响本次返回 */
  }
}

function allKnownImageHashes() {
  const dirs = [CACHE_DIR, LEGACY_DIR, path.join(ROOT, 'public', 'dishes'), path.join(ROOT, 'public', 'dishes', 'generated')];
  const set = new Set();
  for (const dir of dirs) {
    try {
      for (const hash of listImageHashes(dir)) set.add(hash);
    } catch {
      /* 某个目录不存在时忽略 */
    }
  }
  return set;
}

function signatureOf(dish) {
  const ingredients = (Array.isArray(dish?.ingredients) ? dish.ingredients : [])
    .map((x) => normalizeForMatch(x))
    .filter(Boolean)
    .sort()
    .slice(0, 8)
    .join(',');
  const flavor = (Array.isArray(dish?.flavor) ? dish.flavor : [])
    .map((x) => normalizeForMatch(x))
    .filter(Boolean)
    .sort()
    .slice(0, 4)
    .join(',');
  return crypto.createHash('sha1').update(`${ingredients}|${flavor}`, 'utf8').digest('hex').slice(0, 10);
}

function imageDescriptionFor(dish) {
  const name = str(dish?.name, 32);
  const ingredients = (Array.isArray(dish?.ingredients) ? dish.ingredients : [])
    .map((x) => str(x, 20))
    .filter(Boolean)
    .slice(0, 5)
    .join('、');
  const flavor = (Array.isArray(dish?.flavor) ? dish.flavor : [])
    .map((x) => str(x, 16))
    .filter(Boolean)
    .slice(0, 3)
    .join('、');
  if (!name) return '';
  return `真实摄影风格的${name}成品图，完整展示${ingredients || '主要食材'}，${flavor ? `${flavor}，` : ''}食材清晰可辨、色泽自然，摆盘完整，暖色中式餐桌背景，主体突出，适合美食网站横向卡片展示。`;
}

function scoreTitle(title, name) {
  const t = normalizeForMatch(title);
  const n = normalizeForMatch(name);
  if (!t || !n) return 0;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80 - Math.min(20, t.length - n.length);
  if (t.includes(n)) return 60 - Math.min(20, t.length - n.length);
  // 允许「香辣蟹煲」匹配标题「香辣蟹煲的做法」等常见 SEO 标题；
  // 只有菜名核心至少 3 字时才放宽，避免两字菜名误匹配。
  const core = coreName(name);
  if (core.length >= 3 && t.includes(core)) return 40;
  return 0;
}

function pickCandidates(candidates, dish) {
  const name = dish?.name || '';
  const scored = [];
  for (const candidate of candidates || []) {
    const title = String(candidate.title || '');
    const text = `${title} ${candidate.source || ''}`;
    if (BAD_RE.test(text) || BAD_RE.test(String(candidate.url || ''))) continue;
    const score = scoreTitle(title, name);
    if (score <= 0) continue;
    scored.push({ candidate, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_SEARCH_CANDIDATES);
}

function searchQueries(dish) {
  const name = normalizeName(dish?.name);
  if (!name) return [];
  const queries = [name, `${name} 成品图`];
  const ingredients = (Array.isArray(dish?.ingredients) ? dish.ingredients : [])
    .map((x) => str(x, 16))
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  if (ingredients) queries.push(`${name} ${ingredients}`);
  return [...new Set(queries)];
}

async function collectCandidates(dish, deadline) {
  const out = [];
  for (const query of searchQueries(dish)) {
    if (Date.now() > deadline) break;
    const list = await searchImageCandidates(query).catch(() => []);
    out.push(...list);
    if (out.length >= 8) break;
  }
  const seen = new Set();
  return out.filter((c) => {
    const key = String(c.url || '').split('?')[0];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function downloadFirst(candidates, knownHashes) {
  for (const { candidate, score } of candidates) {
    try {
      const got = await downloadCandidate(candidate, knownHashes);
      return { got, candidate, score };
    } catch {
      /* 坏链、重复图、格式不对：继续试下一张 */
    }
  }
  return null;
}

const inFlight = new Map();
const MAX_CONCURRENT = 3;
let running = 0;
const queue = [];

function schedule(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    drain();
  });
}

function drain() {
  if (running >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (!next) return;
  running += 1;
  Promise.resolve()
    .then(next.task)
    .then(next.resolve, () => next.resolve(null))
    .finally(() => {
      running -= 1;
      drain();
    });
}

/**
 * 解析一道 AI 菜的配图。永不抛错。
 * @param {{name:string,ingredients?:string[],flavor?:string[],description?:string}} dish
 * @param {{budget?:number}} [opts]
 */
export async function resolveRecommendationImage(dish, opts = {}) {
  const name = normalizeName(dish?.name);
  if (!name) {
    return {
      url: '',
      imageSource: 'fallback',
      imageStatus: 'fallback',
      imageDescription: '',
      match: '',
      cached: false,
      reason: 'dish_name_required',
    };
  }

  const local = localImageFor(dish) || legacyImageFor(dish);
  if (local) {
    return { ...local, imageDescription: imageDescriptionFor(dish) };
  }

  const signature = signatureOf(dish);
  const key = keyOf(name, signature);
  const cached = cacheByDishName(name) || cacheImage(key);
  if (cached) return cached;
  const fallback = cacheFallback(key);
  if (fallback) return fallback;

  if (inFlight.has(key)) return inFlight.get(key);

  const budget = Math.max(3000, Number(opts.budget) || DEFAULT_BUDGET);
  const deadline = Date.now() + budget;
  const work = schedule(async () => {
    try {
      const candidates = await collectCandidates(dish, deadline);
      if (!candidates.length) {
        const result = {
          url: '',
          imageSource: 'fallback',
          imageStatus: 'fallback',
          imageDescription: imageDescriptionFor(dish),
          match: '',
          cached: false,
          reason: 'search_empty',
        };
        writeMeta(key, { name, ...result, at: Date.now() });
        return result;
      }

      const picked = pickCandidates(candidates, dish);
      if (!picked.length) {
        const result = {
          url: '',
          imageSource: 'fallback',
          imageStatus: 'fallback',
          imageDescription: imageDescriptionFor(dish),
          match: '',
          cached: false,
          reason: 'search_unrelated',
        };
        writeMeta(key, { name, ...result, at: Date.now() });
        return result;
      }

      ensureDir(CACHE_DIR);
      const known = allKnownImageHashes();
      const downloaded = await downloadFirst(picked, known);
      if (!downloaded) {
        const result = {
          url: '',
          imageSource: 'fallback',
          imageStatus: 'fallback',
          imageDescription: imageDescriptionFor(dish),
          match: '',
          cached: false,
          reason: 'download_failed',
        };
        writeMeta(key, { name, ...result, at: Date.now() });
        return result;
      }

      const { got, candidate, score } = downloaded;
      const file = `${key}.${got.ext}`;
      fs.writeFileSync(path.join(CACHE_DIR, file), got.buf);
      const result = {
        url: CACHE_URL + file,
        imageSource: 'search',
        imageStatus: 'success',
        imageDescription: imageDescriptionFor(dish),
        match: score >= 60 ? 'strict' : 'title',
        cached: false,
        sourceUrl: String(candidate.source || ''),
        provider: String(candidate.provider || ''),
      };
      writeMeta(key, { name, ...result, at: Date.now() });
      return result;
    } catch (err) {
      const result = {
        url: '',
        imageSource: 'fallback',
        imageStatus: 'fallback',
        imageDescription: imageDescriptionFor(dish),
        match: '',
        cached: false,
        reason: `search_error:${String(err?.message || err).slice(0, 40)}`,
      };
      writeMeta(key, { name, ...result, at: Date.now() });
      return result;
    }
  });

  inFlight.set(key, work);
  const timeout = new Promise((resolve) =>
    setTimeout(() => {
      resolve({
        url: '',
        imageSource: 'fallback',
        imageStatus: 'fallback',
        imageDescription: imageDescriptionFor(dish),
        match: '',
        cached: false,
        reason: 'timeout',
      });
    }, budget + 1000)
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    work.finally(() => inFlight.delete(key));
  }
}

/** 测试/管理用：清掉某道菜的推荐配图缓存 */
export function clearRecommendationImage(dishName) {
  const name = normalizeName(dishName);
  if (!name || !fs.existsSync(CACHE_DIR)) return false;
  let removed = false;
  for (const file of fs.readdirSync(CACHE_DIR)) {
    try {
      const full = path.join(CACHE_DIR, file);
      if (file.endsWith('.json')) {
        const meta = readJson(full);
        if (normalizeName(meta?.name) !== name) continue;
        const base = file.replace(/\.json$/i, '');
        for (const sibling of fs.readdirSync(CACHE_DIR)) {
          if (sibling.startsWith(base + '.')) fs.unlinkSync(path.join(CACHE_DIR, sibling));
        }
        removed = true;
      }
    } catch {
      /* 忽略 */
    }
  }
  return removed;
}

export { imageDescriptionFor };