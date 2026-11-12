/**
 * 寻味推荐期间产生的图鉴外候选（AI 扩展 / 外部资料佐证）持久化。
 * ------------------------------------------------------------
 * 这份数据只服务推荐结果的后续动作：详情、聊天、生成菜谱、反馈。
 * 它不会混进图鉴列表，也不会被当成图鉴里的既有菜品。
 *
 * 设计原则：
 * - 读失败不影响推荐主流程，返回空数组；
 * - 写失败只记日志，不让推荐整体失败；
 * - 只保留推荐系统自己生成的 id（rec-*），不做任意文件写入；
 * - 单条记录做字段白名单清洗，前端与详情页拿到的都是可序列化数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_FILE = path.join(ROOT, 'data', 'recommendation-dishes.json');
const STORE_MAX = 240;

let cache = null;
let cacheAt = 0;
const CACHE_MS = 1500;

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(value, max = 12, itemMax = 30) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return [...new Set(list.map((x) => cleanText(x, itemMax)).filter(Boolean))].slice(0, max);
}

function cleanNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanText(raw.id, 48);
  if (!/^rec-[a-z0-9-]{6,40}$/i.test(id)) return null;
  const name = cleanText(raw.name, 24);
  if (name.length < 2) return null;
  const verification = raw.verification && typeof raw.verification === 'object' ? raw.verification : {};
  const sources = (Array.isArray(verification.sources) ? verification.sources : [])
    .slice(0, 4)
    .map((s) => ({
      title: cleanText(s?.title, 120),
      url: /^https?:\/\//i.test(String(s?.url || '')) ? String(s.url).slice(0, 500) : '',
      site: cleanText(s?.site, 40),
    }))
    .filter((s) => s.url);
  return {
    id,
    name,
    nameEn: cleanText(raw.nameEn, 60),
    cuisine: cleanText(raw.cuisine, 20),
    tastes: cleanList(raw.tastes, 4, 20),
    image: cleanText(raw.image, 300),
    alt: cleanText(raw.alt, 160),
    signature: cleanText(raw.signature, 80),
    oneLiner: cleanText(raw.oneLiner, 120),
    intro: cleanText(raw.intro, 240),
    ingredients: cleanList(raw.ingredients, 14, 30),
    techniques: cleanList(raw.techniques, 8, 20),
    prep: cleanNumber(raw.prep, 0, 240),
    cook: cleanNumber(raw.cook, 0, 240),
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium',
    servings: cleanNumber(raw.servings, 1, 12, 2),
    price: null,
    tags: cleanList(raw.tags, 8, 20),
    sourceType: ['ai_generated', 'database', 'external'].includes(raw.sourceType) ? raw.sourceType : 'ai_generated',
    sourceLabel: cleanText(raw.sourceLabel, 40) || 'AI 扩展候选',
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    verification: {
      status: ['web_verified', 'unverified'].includes(verification.status) ? verification.status : 'unverified',
      checkedAt: cleanText(verification.checkedAt, 40),
      sources,
    },
    whyFit: cleanText(raw.whyFit, 220),
    credit: cleanText(raw.credit, 160),
    createdAt: cleanText(raw.createdAt, 40),
    updatedAt: cleanText(raw.updatedAt, 40),
  };
}

function parseStore(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed?.dishes;
  return (Array.isArray(list) ? list : []).map(cleanRecord).filter(Boolean);
}

export function readRecommendationDishes() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  try {
    if (!fs.existsSync(STORE_FILE)) {
      cache = [];
      cacheAt = now;
      return cache;
    }
    cache = parseStore(fs.readFileSync(STORE_FILE, 'utf8')).slice(-STORE_MAX);
    cacheAt = now;
    return cache;
  } catch (err) {
    console.warn('[recommendation-store] 读取失败：', String(err?.message || err).slice(0, 160));
    cache = [];
    cacheAt = now;
    return cache;
  }
}

export function findRecommendationDish(id) {
  const key = cleanText(id, 48);
  if (!key) return null;
  return readRecommendationDishes().find((d) => d.id === key) || null;
}

export function writeRecommendationDishes(list) {
  const safe = (Array.isArray(list) ? list : []).map(cleanRecord).filter(Boolean).slice(-STORE_MAX);
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      dishes: safe,
    };
    const tmp = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
    cache = safe;
    cacheAt = Date.now();
    return true;
  } catch (err) {
    console.warn('[recommendation-store] 写入失败：', String(err?.message || err).slice(0, 160));
    return false;
  }
}

/**
 * 合并写入：同一个 id 以较新的记录为准，但保留 createdAt / 已有图片，
 * 避免「换一批」重复扩展时把已经下载好的配图冲掉。
 */
export function upsertRecommendationDishes(records) {
  const incoming = (Array.isArray(records) ? records : []).map(cleanRecord).filter(Boolean);
  if (!incoming.length) return readRecommendationDishes();
  const current = readRecommendationDishes();
  const map = new Map(current.map((d) => [d.id, d]));
  for (const item of incoming) {
    const old = map.get(item.id);
    map.set(item.id, {
      ...old,
      ...item,
      image: item.image || old?.image || '',
      alt: item.alt || old?.alt || `${item.name}的图片`,
      createdAt: old?.createdAt || item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const merged = [...map.values()].slice(-STORE_MAX);
  writeRecommendationDishes(merged);
  return merged;
}

export function recommendationStoreStats() {
  return { file: STORE_FILE, count: readRecommendationDishes().length };
}