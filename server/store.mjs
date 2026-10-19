import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'comments.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(
      FILE,
      JSON.stringify(
        {
          version: 1,
          comments: [
            {
              id: 'seed-1',
              dishId: 'mapo-tofu',
              parentId: null,
              author: { id: 'seed-guest-1', name: '阿岚', isGuest: true },
              content:
                '照着站里的步骤做了三次，第三次终于把花椒面留到最后撒，麻味一下就对了。豆腐先焯水真的不容易碎。',
              createdAt: Date.now() - 1000 * 60 * 60 * 26,
              likes: 12,
              likedBy: [],
              reports: 0,
              isAI: false,
            },
            {
              id: 'seed-2',
              dishId: 'mapo-tofu',
              parentId: 'seed-1',
              author: { id: 'seed-guest-2', name: '小满', isGuest: true },
              content: '请问你用的什么豆瓣？我这边买到的偏咸，第二次就少放了点盐。',
              createdAt: Date.now() - 1000 * 60 * 60 * 20,
              likes: 3,
              likedBy: [],
              reports: 0,
              isAI: false,
            },
            {
              id: 'seed-3',
              dishId: 'duo-jiao-yu-tou',
              parentId: null,
              author: { id: 'seed-guest-3', name: '老陈', isGuest: true },
              content: '剁椒本身就咸，我第一次做没减盐，齁得慌。后来按提示少放酱油，好多了。',
              createdAt: Date.now() - 1000 * 60 * 60 * 8,
              likes: 6,
              likedBy: [],
              reports: 0,
              isAI: false,
            },
          ],
        },
        null,
        2
      )
    );
  }
}

function read() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { version: 1, comments: [] };
  }
}

function write(state) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export function listComments(dishId, page = 1, pageSize = 6) {
  const { comments } = read();
  const roots = comments
    .filter((c) => c.dishId === dishId && !c.parentId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = roots.length;
  const start = (page - 1) * pageSize;
  const pageRoots = roots.slice(start, start + pageSize);
  const items = pageRoots.map((c) => ({
    ...c,
    replies: comments
      .filter((r) => r.parentId === c.id)
      .sort((a, b) => a.createdAt - b.createdAt),
  }));
  return { items, total, page, pageSize, hasMore: start + pageSize < total };
}

export function addComment({ dishId, parentId = null, content, author, isAI = false }) {
  const state = read();
  // parentId 必须指向同一道菜下的一级评论（只允许两层：根评论 + 回复）
  if (parentId) {
    const parent = state.comments.find((c) => c.id === parentId);
    if (!parent || parent.dishId !== dishId || parent.parentId) {
      return { ok: false, error: 'parent-invalid' };
    }
  }
  const comment = {
    id: crypto.randomUUID(),
    dishId,
    parentId,
    author: { id: author.id, name: author.name, isGuest: true },
    content: content.trim().slice(0, 300),
    createdAt: Date.now(),
    likes: 0,
    likedBy: [],
    reports: 0,
    isAI,
  };
  state.comments.push(comment);
  write(state);
  return { ok: true, comment };
}

export function toggleLike(id, guestId) {
  const state = read();
  const c = state.comments.find((x) => x.id === id);
  if (!c) return null;
  const i = c.likedBy.indexOf(guestId);
  if (i >= 0) {
    c.likedBy.splice(i, 1);
    c.likes = Math.max(0, c.likes - 1);
  } else {
    c.likedBy.push(guestId);
    c.likes += 1;
  }
  write(state);
  return { likes: c.likes, liked: c.likedBy.includes(guestId) };
}

export function reportComment(id) {
  const state = read();
  const c = state.comments.find((x) => x.id === id);
  if (!c) return null;
  c.reports += 1;
  write(state);
  return { reports: c.reports };
}

export function deleteComment(id, guestId) {
  const state = read();
  const idx = state.comments.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  if (state.comments[idx].author.id !== guestId) return { ok: false, reason: 'forbidden' };
  state.comments.splice(idx, 1);
  // 一并删除其下回复
  state.comments = state.comments.filter((c) => c.parentId !== id);
  write(state);
  return { ok: true };
}

export function commentCountByDish() {
  const { comments } = read();
  const map = {};
  for (const c of comments) map[c.dishId] = (map[c.dishId] || 0) + 1;
  return map;
}
