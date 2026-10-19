import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 真实图片检索：必应 / 百度 图片检索（无需 Key 的公开结果页），
 * 下载后本地落盘，保证「同一道菜的图片稳定、可缓存、可去重」。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT = 9000;
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 9 * 1024;

const MAGIC = [
  { ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, ext: 'jpg' },
  { ok: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, ext: 'png' },
  { ok: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP', ext: 'webp' },
  { ok: (b) => b.slice(0, 3).toString('ascii') === 'GIF', ext: 'gif' },
];

function sniff(buf) {
  for (const m of MAGIC) if (m.ok(buf)) return m.ext;
  return '';
}

async function fetchText(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(referer ? { referer } : {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImage(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...(referer ? { referer } : {}), accept: 'image/*,*/*;q=0.6' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    const type = String(res.headers.get('content-type') || '');
    if (!/image\//i.test(type)) throw new Error('not-image');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) throw new Error('bad-size');
    const ext = sniff(buf);
    if (!ext) throw new Error('bad-magic');
    return { buf, ext };
  } finally {
    clearTimeout(timer);
  }
}

/** 必应图片：从结果页的 m="{...}" JSON 里取缩略图/原图地址 */
function parseBing(html) {
  const out = [];
  const re = /m="(\{[^"]*?\})"/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    try {
      const j = JSON.parse(raw);
      const url = j.turl || j.murl;
      if (url && /^https?:\/\//.test(url)) out.push({ url, source: j.purl || j.murl || url, title: j.t || '' });
    } catch {
      /* 忽略坏片段 */
    }
    if (out.length >= 12) break;
  }
  return out;
}

/** 百度图片：公开结果 JSON 的 thumbURL / middleURL */
function parseBaidu(text) {
  const out = [];
  try {
    const j = JSON.parse(text);
    for (const item of j.data || []) {
      if (!item || typeof item !== 'object') continue;
      const url = item.thumbURL || item.middleURL || item.hoverURL;
      if (url && /^https?:\/\//.test(url)) {
        out.push({
          url,
          source: item.fromURL || item.fromPageTitleEnc || '',
          title: String(item.fromPageTitleEnc || '').replace(/<[^>]+>/g, ''),
        });
      }
      if (out.length >= 12) break;
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

export async function searchImageCandidates(query) {
  const candidates = [];
  const seen = new Set();
  const push = (list, provider, referer) => {
    for (const c of list) {
      const key = c.url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ...c, provider, referer });
    }
  };
  try {
    push(parseBaidu(await fetchText(
      'https://image.baidu.com/search/acjson?tn=resultjson_com&word=' + encodeURIComponent(query) + '&pn=0&rn=12',
      'https://image.baidu.com/'
    )), '百度图片', 'https://image.baidu.com/');
  } catch {
    /* 网络受限时忽略 */
  }
  if (candidates.length < 3) {
    try {
      push(parseBing(await fetchText(
        'https://cn.bing.com/images/search?q=' + encodeURIComponent(query) + '&first=1',
        'https://cn.bing.com/'
      )), '必应图片', 'https://cn.bing.com/');
    } catch {
      /* 忽略 */
    }
  }
  return candidates;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 下载候选图，做哈希/魔术字校验，返回可落盘的 buffer。
 * @param {{url:string, referer?:string, provider?:string, source?:string}} candidate
 * @param {Set<string>} knownHashes 已使用的图片哈希集合（用于去重）
 */
export async function downloadCandidate(candidate, knownHashes) {
  const { buf, ext } = await fetchImage(candidate.url, candidate.referer);
  const hash = sha256(buf);
  if (knownHashes.has(hash)) throw new Error('dup-hash');
  knownHashes.add(hash);
  return {
    buf,
    ext,
    hash,
    provider: candidate.provider || '',
    source: String(candidate.source || '').slice(0, 200),
  };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function imageFileHash(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return '';
  }
}

export function listImageHashes(dir) {
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) continue;
    const h = imageFileHash(path.join(dir, name));
    if (h) set.add(h);
  }
  return set;
}
