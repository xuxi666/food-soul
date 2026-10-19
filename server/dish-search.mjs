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

let cache = null;
let hashCache = null;
const inflight = new Map();

function readGenerated() {
  if (cache) return cache;
  cache = [];
  try {
    if (fs.existsSync(GEN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(GEN_FILE, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : parsed?.dishes;
      if (Array.isArray(list)) {
        cache = list.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string');
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

function pickCuisine(raw, fallbackCuisine) {
  const id = String(raw || '').trim();
  if (CUISINE_IDS.includes(id)) return id;
  const hit = CUISINES.find((c) => c.name === id || (id && (c.name.includes(id) || id.includes(c.name))));
  if (hit) return hit.id;
  return fallbackCuisine && CUISINE_IDS.includes(fallbackCuisine) ? fallbackCuisine : 'chuan';
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
    return taste ? { kind, label: taste.name + '味型', fallbackTaste: taste.id, fallbackCuisine: '' } : null;
  }
  if (kind === 'cuisine') {
    const cuisine = CUISINE_BY_ID[id];
    return cuisine ? { kind, label: cuisine.name, fallbackCuisine: cuisine.id, fallbackTaste: '' } : null;
  }
  return { kind: 'all', label: '中国菜', fallbackCuisine: '', fallbackTaste: '' };
}

async function askModel(context, excludeNames, want, modelConfig) {
  const system = [
    '你是中国菜资料整理助手。',
    '请提出「真实存在、常见、可在家里做」的候选菜品，之后系统会用真实网络检索逐条验证。',
    '只输出一个 JSON 对象，不要解释、不要 markdown 围栏。',
  ].join('\n');

  const user = [
    `请为「${context.label}」提出 ${want} 道站内还没有的真实菜品候选（已有 ${excludeNames.length} 道，不要重复）。`,
    '只输出精简 JSON：{"dishes":[{"name":"中文菜名(2-10字)","ingredients":["主料1","主料2"]}]}',
    '每道菜必须给 name 与 1-4 个主料；味型、菜系、技法、时间由系统按分类自动补全，不要输出这些字段。',
    context.kind === 'all'
      ? `例外：本次按“全部”检索，请额外给出 cuisine（只能取：${CUISINE_IDS.join('/')}）与 tastes（只能取：${TASTE_IDS.join('/')}）。`
      : '',
    context.kind === 'cuisine' && context.fallbackCuisine
      ? `本次只收「${context.label}」的菜（菜系 id: ${context.fallbackCuisine}），其它菜系一律不要；请优先给有代表性、但站内还没收录的经典菜。`
      : context.kind === 'taste' && context.fallbackTaste
        ? `本次只收符合「${context.label}」（味型 id: ${context.fallbackTaste}）的菜，按真实食材与烹饪方式判断，不要只看菜名里的字。`
        : '本次收全国范围内的常见家常菜。',
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

async function attachImage(record, { deadline = 0, maxAttempts = 3 } = {}) {
  const queries = [`${record.name} 菜品 成品`, `${record.name} 家常做法`];
  const lists = await Promise.all(queries.map((q) => searchImageCandidates(q).catch(() => [])));
  let attempts = 0;
  for (const candidates of lists) {
    for (const cand of candidates.slice(0, 4)) {
      if (attempts >= maxAttempts) return null;
      if (deadline && Date.now() > deadline) return null;
      attempts += 1;
      try {
        const got = await downloadCandidate(cand, knownHashes());
        // 先只下载到内存，是否采用（哈希去重、落盘）由外层顺序决定
        return { buf: got.buf, ext: got.ext, hash: got.hash, provider: got.provider, source: got.source };
      } catch {
        /* 换下一张 */
      }
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
  if (!context) return { status: 'failed', note: '分类不存在', items: [] };

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
    };
  }
  if (!isSearchConfigured()) {
    return {
      status: 'failed',
      items: [],
      note: '联网检索服务未配置（SEARCH_API_KEY），无法验证菜品真实性。',
      configNeeded: ['SEARCH_API_KEY'],
    };
  }

  const key = `${kind}:${context.label}`;
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const startedAt = Date.now();
      const generated = readGenerated();
      const existingNames = new Set([...DISHES.map((d) => d.name), ...generated.map((d) => d.name)]);
      const want = Math.min(5, limit + 2);
      const { list } = await askModel(context, [...existingNames], want, input.modelConfig);

    const items = [];
    const skipped = [];
    // 整轮硬预算 95 秒（含模型调用与真实检索），单道菜最多 3 次下载尝试；哈希去重按顺序认领
    const deadline = startedAt + 95_000;
    const claimed = new Set(knownHashes());
    for (const raw of list.slice(0, want + 2)) {
      if (items.length >= limit) break;
      const name = cleanName(raw?.name || raw?.菜名 || raw?.dish || raw?.title);
      if (name.length < 2) {
        skipped.push({ name: name || '(空)', reason: '菜名无效' });
        continue;
      }
      if (existingNames.has(name) || excludeIds.has(name)) {
        skipped.push({ name, reason: '站内已有，已跳过' });
        continue;
      }
      const cuisine = pickCuisine(raw?.cuisine, context.fallbackCuisine);
      if (!cuisine) {
        skipped.push({ name, reason: '缺少菜系' });
        continue;
      }
      if (kind === 'cuisine' && cuisine !== context.fallbackCuisine) {
        skipped.push({ name, reason: `菜系不符（${CUISINE_BY_ID[cuisine]?.name || cuisine}）` });
        continue;
      }
      let tastes = pickTastes(raw?.tastes, context.fallbackTaste);
      if (!tastes.length) tastes = [cuisine === 'chuan' ? 'mala' : 'xianxian'];
      if (kind === 'taste' && !tastes.includes(context.fallbackTaste)) {
        skipped.push({ name, reason: '味型不符' });
        continue;
      }
      const id = makeId(name, cuisine);
      if (excludeIds.has(id) || excludeIds.has(name)) {
        skipped.push({ name, reason: '已展示的菜品' });
        continue;
      }
      if (DISH_BY_ID[id] || generated.some((d) => d.id === id) || items.some((d) => d.id === id)) {
        skipped.push({ name, reason: '重复菜品' });
        continue;
      }
      if (Date.now() > deadline) {
        skipped.push({ name, reason: '本轮检索超时' });
        continue;
      }
      const verified = await webSearch(`${name} 做法 食材`, { count: 3, timeout: 8000 });
      const verifiedHay = verified.sources.map((x) => `${x.title} ${x.snippet}`).join(' ');
      if (!verified.sources.length || !verifiedHay.includes(name)) {
        skipped.push({
          name,
          reason: verified.status === 'timeout' ? '检索超时，未验证' : '未检索到可靠资料，已跳过',
        });
        continue;
      }
      const record = {
        id,
        name,
        nameEn: String(raw?.nameEn || '').replace(/[^\w\s'-]/g, '').slice(0, 40),
        cuisine,
        tastes,
        image: '',
        alt: `${name}（${CUISINE_BY_ID[cuisine]?.name || '中国菜'}）`,
        signature: (pickTechniques(raw?.techniques).join('、') || '家常做法') + '，' + String(raw?.intro || '').slice(0, 14),
        oneLiner: String(raw?.intro || `${name}，站内新增的家常菜品。`).slice(0, 60),
        intro: String(raw?.intro || `${name}，站内新增的家常菜品。`).slice(0, 200),
        ingredients: (Array.isArray(raw?.ingredients) ? raw.ingredients : [])
          .map((x) => String(x || '').trim().slice(0, 12))
          .filter(Boolean)
          .slice(0, 8),
        texture: String(raw?.texture || '口感以家常做法为准').slice(0, 60),
        techniques: pickTechniques(raw?.techniques).length ? pickTechniques(raw?.techniques) : ['炒'],
        history: '',
        personality: tastes[0],
        knowledge: [
          `${name} 属于${CUISINE_BY_ID[cuisine]?.name || '中国菜'}，味型以${TASTE_BY_ID[tastes[0]]?.name || '家常'}为主。`,
          `代表食材：${(Array.isArray(raw?.ingredients) ? raw.ingredients : []).slice(0, 5).join('、') || '按家常做法' }。`,
          '本条资料由 AI 联网检索整理，图片来自公开图片检索结果，仅供参考。',
        ],
        prep: num(raw?.prep, 15, 0, 240),
        cook: num(raw?.cook, 15, 0, 240),
        difficulty: DIFFICULTIES.includes(raw?.difficulty) ? raw.difficulty : 'medium',
        servings: 2,
        price: 0,
        tags: ['AI 补全'],
        aiGenerated: true,
        credit: `AI 候选 + 真实检索验证 · ${input.modelConfig.model}`,
        source: {
          type: 'ai-search',
          model: input.modelConfig.model,
          verifiedBy: 'web_search',
          verifiedAt: new Date().toISOString(),
          verificationSources: verified.sources.slice(0, 3).map((x) => ({ title: x.title, site: x.site, url: x.url })),
          requestedKind: kind,
          categoryId: String(input.id || ''),
          searchedAt: new Date().toISOString(),
        },
      };
      if (!record.ingredients.length) {
        skipped.push({ name, reason: '缺少食材信息' });
        continue;
      }
      const img = await attachImage(record, { deadline });
      if (!img) {
        skipped.push({ name, reason: '未找到可用图片，已跳过' });
        continue;
      }
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
      items.push(record);
      existingNames.add(name);
    }

    if (items.length) {
      const merged = [...readGenerated(), ...items];
      writeGenerated(merged);
    }

    const notes = [];
    if (!items.length) notes.push('本轮没有找到可用的新菜品（可能都已在站内，或图片来源不可用）。');
    if (skipped.length) notes.push(`${skipped.length} 道被跳过：` + skipped.slice(0, 3).map((s) => `${s.name}（${s.reason}）`).join('；'));

    return {
      status: items.length ? 'ok' : 'empty',
      items,
      skipped,
      note: notes.join(' '),
      total: readGenerated().length,
    };
    } catch (err) {
      const aborted = err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''));
      const raw = String(err?.message || '未知错误');
      const upstream = /1234|网络错误/.test(raw);
      return {
        status: 'failed',
        items: [],
        skipped: [],
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
