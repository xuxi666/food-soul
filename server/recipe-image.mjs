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
 * 图鉴未收录菜品的配图：复用 dish-images.mjs 的公开图片检索与下载能力，
 * 按菜名做一次真实检索，命中后落盘到 public/dishes/recipe/，按菜名缓存。
 *
 * 设计约束：
 * - 只做「配图」，失败一律返回 null，绝不影响菜谱生成；
 * - 结果按菜名哈希命名，同一道菜重复生成时直接复用，不重复检索；
 * - 菜名不同 → 文件名不同，不会串图；
 * - 下载走 dish-images 的既有校验（大小、超时、magic、content-type）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'dishes', 'recipe');
const URL_BASE = '/dishes/recipe/';
const BUDGET_MS = 7000;
const EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

/** 去掉括号补充、多余空白，最长 20 字，避免把「馒头（家常版）」当成两个查询 */
function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 20);
}

function cleanSource(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/AzdH3F|^ippr_/i.test(s)) return '';
  if (!/^https?:\/\//i.test(s)) return s.slice(0, 80);
  return s.slice(0, 200);
}

function keyOf(name) {
  return crypto.createHash('sha1').update(name, 'utf8').digest('hex').slice(0, 16);
}

/** 明显不是菜品图的候选直接跳过 */
const BAD_RE = /logo|icon|sprite|avatar|qrcode|二维码|菜单|menu|banner|广告|水印/i;

function readCached(key) {
  if (!fs.existsSync(DIR)) return null;
  for (const file of fs.readdirSync(DIR)) {
    if (!file.startsWith(key + '.')) continue;
    if (!EXT_RE.test(file)) continue;
    const meta = file.replace(EXT_RE, '') + '.json';
    let source = '';
    try {
      source = JSON.parse(fs.readFileSync(path.join(DIR, meta), 'utf8')).source || '';
    } catch {
      /* 没有来源文件也不影响使用 */
    }
    return { url: URL_BASE + file, source, provider: '', cached: true };
  }
  return null;
}

function scoreOf(text, name) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, '');
  const n = name.toLowerCase();
  if (!t) return -1;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80 - Math.min(20, t.length - n.length);
  if (t.includes(n)) return 60 - Math.min(20, t.length - n.length);
  return 0;
}

/** 先按「标题越接近菜名越优先」打分；都不沾边时退一步用第一张有标题的图 */
function pickCandidate(candidates, name) {
  const scored = [];
  for (const c of candidates) {
    const text = `${c.title || ''} ${c.source || ''}`;
    if (BAD_RE.test(text) || BAD_RE.test(c.url)) continue;
    const score = scoreOf(c.title || '', name) || scoreOf(text, name);
    scored.push({ c, score });
  }
  const strict = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (strict.length) return { candidate: strict[0].c, match: 'strict' };
  const loose = scored.filter((x) => (x.c.title || '').trim().length > 0).map((x) => x.c);
  return loose.length ? { candidate: loose[0], match: 'loose' } : null;
}

/**
 * 取一道未收录菜品的配图。永远不抛错。
 * @param {string} dishName
 * @param {{budget?:number}} [opts]
 * @returns {Promise<{url:string,source:string,provider:string,cached:boolean}|null>}
 */
export async function getRecipeImage(dishName, opts = {}) {
  const name = normalizeName(dishName);
  if (!name) return null;
  const key = keyOf(name);

  const cached = readCached(key);
  if (cached) return cached;

  const budget = Math.max(2000, Number(opts.budget) || BUDGET_MS);
  const deadline = Date.now() + budget;

  const work = (async () => {
    const queries = [`${name} 菜品 成品`, `${name} 家常做法`];
    let candidates = [];
    for (const q of queries) {
      candidates = await searchImageCandidates(q).catch(() => []);
      if (candidates.length >= 3) break;
      if (Date.now() > deadline) break;
    }
    if (!candidates.length) return null;

    const picked = pickCandidate(candidates, name);
    if (!picked) return null;

    ensureDir(DIR);
    const known = listImageHashes(DIR);
    const got = await downloadCandidate(picked.candidate, known);
    const file = `${key}.${got.ext}`;
    fs.writeFileSync(path.join(DIR, file), got.buf);
    try {
      fs.writeFileSync(
        path.join(DIR, `${key}.json`),
        JSON.stringify({ name, source: cleanSource(got.source), provider: got.provider, match: picked.match, at: Date.now() })
      );
    } catch {
      /* 元数据写失败不影响图片 */
    }
    return { url: URL_BASE + file, source: cleanSource(got.source), provider: got.provider, cached: false };
  })().catch(() => null);

  // 超时就让图片这一路放弃，不拖慢菜谱响应
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), budget));
  return Promise.race([work, timeout]);
}

/** 供测试脚本用：清掉某道菜的缓存 */
export function clearRecipeImage(dishName) {
  const name = normalizeName(dishName);
  if (!name || !fs.existsSync(DIR)) return false;
  const key = keyOf(name);
  let removed = false;
  for (const file of fs.readdirSync(DIR)) {
    if (!file.startsWith(key + '.')) continue;
    try {
      fs.unlinkSync(path.join(DIR, file));
      removed = true;
    } catch {
      /* 忽略 */
    }
  }
  return removed;
}
