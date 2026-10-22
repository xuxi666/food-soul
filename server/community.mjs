import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'community.json');
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

const SEED = {
  version: 1,
  posts: [
    {
      id: 'seed-post-1',
      author: { id: 'editorial', name: '食有灵编辑部' },
      content:
        '第一锅高汤是怎么吊的？我们把八个菜系的清汤、奶汤、红汤做法整理成了对照表，欢迎补充你们家的版本。',
      image: '/dishes/fo-tiao-qiang.jpg',
      dishId: 'fo-tiao-qiang',
      cuisineId: 'min',
      tasteId: 'chunhou',
      createdAt: Date.now() - 1000 * 60 * 60 * 30,
      likes: 18,
      likedBy: [],
      reports: 0,
      isSeed: true,
      comments: [
        {
          id: 'seed-c-1',
          author: { id: 'editorial', name: '食有灵编辑部' },
          content: '补一句：奶汤要大火冲，汤色才白；清汤全程小火，不能滚。',
          createdAt: Date.now() - 1000 * 60 * 60 * 29,
          isAI: false,
          parentId: null,
        },
      ],
    },
    {
      id: 'seed-post-2',
      author: { id: 'editorial', name: '食有灵编辑部' },
      content:
        '同样是"麻辣"，川菜的麻在花椒、湘菜的辣在鲜椒。你更习惯哪一种？说说你家的做法。',
      image: '/dishes/duo-jiao-yu-tou.jpg',
      dishId: 'duo-jiao-yu-tou',
      cuisineId: 'xiang',
      tasteId: 'xiangla',
      createdAt: Date.now() - 1000 * 60 * 60 * 9,
      likes: 26,
      likedBy: [],
      reports: 0,
      isSeed: true,
      comments: [],
    },
    {
      id: 'seed-post-3',
      author: { id: 'editorial', name: '食有灵编辑部' },
      content: '白切鸡的"虾眼水"到底怎么判断？拍了张图，水面刚冒小泡就对了。',
      image: '/dishes/bai-qie-ji.jpg',
      dishId: 'bai-qie-ji',
      cuisineId: 'yue',
      tasteId: 'qingxian',
      createdAt: Date.now() - 1000 * 60 * 90,
      likes: 11,
      likedBy: [],
      reports: 0,
      isSeed: true,
      comments: [],
    },
  ],
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(SEED, null, 2));
}

function read() {
  ensure();
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(data.posts)) data.posts = [];
    return data;
  } catch {
    return { version: 1, posts: [] };
  }
}

function write(state) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export const KINDS = ['讨论', '菜谱分享', '提问', '角色话题'];

export function listPosts({ sort = 'latest', dishId = '', page = 1, pageSize = 6 } = {}) {
  const { posts } = read();
  let list = posts.filter((p) => !p.deletedAt);
  if (dishId) list = list.filter((p) => p.dishId === dishId);
  const heat = (p) => (p.likes || 0) + (p.comments?.length || 0) * 2;
  if (sort === 'hot') list.sort((a, b) => heat(b) - heat(a) || b.createdAt - a.createdAt);
  else if (sort === 'discussed') list.sort((a, b) => (b.comments?.length || 0) - (a.comments?.length || 0));
  else list.sort((a, b) => b.createdAt - a.createdAt);

  const total = list.length;
  const start = (page - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  };
}

/** 按 id 直接取单帖（AI 回复、点赞等场景用，避免全量列表查找） */
export function findPost(id) {
  const { posts } = read();
  return posts.find((p) => p.id === id) || null;
}

export function addPost({ content, image, images, kind, dishId, cuisineId, tasteId, author }) {
  const state = read();
  const post = {
    id: crypto.randomUUID(),
    author,
    content: content.trim().slice(0, 800),
    kind: KINDS.includes(kind) ? kind : '讨论',
    image: image || '',
    images: (Array.isArray(images) ? images : []).filter((u) => typeof u === 'string' && u).slice(0, 3),
    dishId: dishId || '',
    cuisineId: cuisineId || '',
    tasteId: tasteId || '',
    createdAt: Date.now(),
    likes: 0,
    likedBy: [],
    reports: 0,
    isSeed: false,
    comments: [],
  };
  state.posts.unshift(post);
  write(state);
  return post;
}

export function toggleLike(id, guestId) {
  const state = read();
  const p = state.posts.find((x) => x.id === id);
  if (!p) return null;
  const i = p.likedBy.indexOf(guestId);
  if (i >= 0) {
    p.likedBy.splice(i, 1);
    p.likes = Math.max(0, p.likes - 1);
  } else {
    p.likedBy.push(guestId);
    p.likes += 1;
  }
  write(state);
  return { likes: p.likes, liked: p.likedBy.includes(guestId) };
}

export function addComment(postId, { content, author, isAI = false, parentId = null, aiDishId = '' }) {
  const state = read();
  const p = state.posts.find((x) => x.id === postId);
  if (!p) return { ok: false, error: 'post-missing' };
  // parentId 必须指向本帖的一级评论（只允许两层）
  if (parentId) {
    const parent = p.comments.find((c) => c.id === parentId);
    if (!parent || parent.parentId) return { ok: false, error: 'parent-invalid' };
  }
  const c = {
    id: crypto.randomUUID(),
    author,
    content: content.trim().slice(0, 400),
    createdAt: Date.now(),
    isAI,
    parentId,
    aiDishId: aiDishId || '',
  };
  p.comments.push(c);
  write(state);
  return { ok: true, comment: c };
}

/** 统计某帖已被 AI 代言的次数（用于限流：每帖 ≤3、同菜品 ≤2） */
export function aiReplyStats(post) {
  const aiComments = (post.comments || []).filter((c) => c.isAI);
  return {
    total: aiComments.length,
    byDish: (dishId) => aiComments.filter((c) => c.aiDishId === dishId).length,
  };
}

export function reportPost(id) {
  const state = read();
  const p = state.posts.find((x) => x.id === id);
  if (!p || p.deletedAt) return null;
  p.reports = (p.reports || 0) + 1;
  write(state);
  return { reports: p.reports };
}

/**
 * 软删除：保留原始数据与管理记录，列表不再展示。
 * by: 操作人 id；reason: 删除原因
 */
export function softDeletePost(id, { by = '', reason = '' } = {}) {
  const state = read();
  const p = state.posts.find((x) => x.id === id);
  if (!p) return { ok: false, reason: 'not-found' };
  if (p.deletedAt) return { ok: true, already: true, post: p };
  p.deletedAt = Date.now();
  p.deletedBy = by;
  p.deleteReason = String(reason || '').slice(0, 200);
  write(state);
  return { ok: true, post: p };
}

/** 管理端列表：支持关键词搜索与分页，包含举报数与删除状态 */
export function adminListPosts({ q = '', page = 1, pageSize = 10, includeDeleted = false } = {}) {
  const { posts } = read();
  const kw = String(q || '').trim().toLowerCase();
  let list = posts.slice();
  if (!includeDeleted) list = list.filter((p) => !p.deletedAt);
  if (kw) {
    list = list.filter((p) =>
      [p.content, p.author?.name, p.kind, p.dishId].filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const start = (page - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize).map((p) => ({
      id: p.id,
      content: p.content,
      author: p.author,
      kind: p.kind,
      dishId: p.dishId || '',
      image: p.image || '',
      images: p.images || [],
      createdAt: p.createdAt,
      likes: p.likes || 0,
      comments: p.comments?.length || 0,
      reports: p.reports || 0,
      deletedAt: p.deletedAt || null,
    })),
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  };
}

export function removePost(id, userId) {
  const state = read();
  const p = state.posts.find((x) => x.id === id);
  if (!p || p.deletedAt) return { ok: false, reason: 'not-found' };
  if (p.author.id !== userId) return { ok: false, reason: 'forbidden' };
  const res = softDeletePost(id, { by: userId, reason: '作者本人删除' });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// 文件头魔数校验：防止伪造 Content-Type 上传其他内容
const MAGIC = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/gif': (b) => b.length > 4 && b.slice(0, 4).toString('ascii') === 'GIF8',
  'image/webp': (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
};

// 每个访客每小时最多 20 张上传（内存计数，重启清零）
const uploadWindow = new Map();
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 3600_000;

/** 图片以 dataURL 上传，服务端校验类型、魔数与大小后落盘 */
export function saveImage(dataUrl, guestId = 'anon') {
  const m = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/i.exec(dataUrl || '');
  if (!m) return { ok: false, error: '图片格式不正确' };
  const mime = m[1].toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) return { ok: false, error: '只支持 JPG / PNG / WebP / GIF' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return { ok: false, error: '图片不能超过 3MB' };
  if (!MAGIC[mime]?.(buf)) return { ok: false, error: '图片内容与格式不符' };

  const now = Date.now();
  const rec = uploadWindow.get(guestId);
  const active = rec && now - rec.reset < UPLOAD_WINDOW_MS ? rec : null;
  if (active && active.count >= UPLOAD_LIMIT) return { ok: false, error: '上传太频繁，请稍后再试' };

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  uploadWindow.set(guestId, { count: (active?.count || 0) + 1, reset: active?.reset || now });
  return { ok: true, url: `/uploads/${name}` };
}

export function postStats() {
  const { posts } = read();
  return {
    posts: posts.length,
    comments: posts.reduce((n, p) => n + (p.comments?.length || 0), 0),
  };
}
