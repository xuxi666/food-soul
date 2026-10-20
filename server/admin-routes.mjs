// 管理员后台接口：概览、社区管理、卡片/菜品图片、举报处理
// 所有写操作都经过 requireAdmin（服务端会话 + 环境变量白名单），前端声明无效。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISHES } from '../src/data/dishes.js';
import { buildCuisineNodes, buildTasteNodes } from '../src/data/wheel.js';
import { CUISINE_BY_ID, TASTE_BY_ID } from '../src/data/cuisines.js';
import { adminListPosts, findPost, softDeletePost, postStats, saveImage } from './community.mjs';
import { generatedDishes } from './dish-search.mjs';
import { requireAdmin, sameOrigin } from './auth.mjs';
import {
  listCardImages,
  upsertCardImage,
  deleteCardImage,
  listDishImages,
  upsertDishImage,
  deleteDishImage,
  createReport,
  getReport,
  listReports,
  reportsForPost,
  findPendingReportBy,
  updateReportStatus,
  reportStats,
  addAudit,
  listAudit,
} from './db.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

/* ---------------- 工具 ---------------- */

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJson(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 只接受两类图片地址，避免任意路径写入/读取：
 * 1. 本服务上传目录 /uploads/<uuid>.<ext>
 * 2. public 下真实存在的站内资源
 */
export function normalizeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^\/uploads\/[a-f0-9-]+\.(jpg|jpeg|png|webp|gif)$/i.test(raw)) return raw;
  if (!raw.startsWith('/') || raw.includes('..') || raw.includes('\\')) return null;
  const abs = path.resolve(PUBLIC_DIR, '.' + raw);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return null;
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return raw;
  } catch {
    /* noop */
  }
  return null;
}

function audit(actor, action, targetType, targetId, detail) {
  addAudit({
    id: crypto.randomUUID(),
    actorId: actor.id,
    actorName: actor.name || actor.email,
    action,
    targetType,
    targetId,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
  });
}

/* ---------------- 公共：图片覆盖 ---------------- */

/** 前端启动时读取：卡片与菜品的图片覆盖 */
export function getAssetOverrides() {
  const cards = { cuisine: {}, taste: {} };
  for (const row of listCardImages()) {
    if (!cards[row.kind]) continue;
    cards[row.kind][row.card_id] = row.url;
  }
  const dishes = {};
  for (const row of listDishImages()) dishes[row.dish_id] = row.url;
  return { cards, dishes, updatedAt: Date.now() };
}

/* ---------------- 数据组装 ---------------- */

function cardRows() {
  const overrides = getAssetOverrides().cards;
  const rows = [];
  for (const node of buildCuisineNodes()) {
    rows.push({
      kind: 'cuisine',
      id: node.id,
      name: node.name,
      meta: node.meta,
      href: node.href,
      defaultImage: node.image || '',
      image: overrides.cuisine[node.id] || node.image || '',
      overridden: Boolean(overrides.cuisine[node.id]),
    });
  }
  for (const node of buildTasteNodes()) {
    rows.push({
      kind: 'taste',
      id: node.id,
      name: node.name,
      meta: node.meta,
      href: node.href,
      defaultImage: node.image || '',
      image: overrides.taste[node.id] || node.image || '',
      overridden: Boolean(overrides.taste[node.id]),
    });
  }
  return rows;
}

function allDishes() {
  const map = new Map();
  for (const d of DISHES) map.set(d.id, d);
  for (const d of generatedDishes()) if (!map.has(d.id)) map.set(d.id, d);
  return [...map.values()];
}

/* ---------------- 路由 ---------------- */

export async function handleAdmin(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean);

  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const actor = requireAdmin(req, res, send);
  if (!actor) return;

  const method = req.method;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 10));

  /* 概览 */
  if (method === 'GET' && parts[0] === 'overview') {
    const cards = cardRows();
    return send(res, 200, {
      ok: true,
      admin: { id: actor.id, name: actor.name, email: actor.email },
      stats: {
        posts: postStats(),
        reports: reportStats(),
        cards: {
          cuisine: cards.filter((c) => c.kind === 'cuisine').length,
          taste: cards.filter((c) => c.kind === 'taste').length,
          overridden: cards.filter((c) => c.overridden).length,
        },
        dishes: { total: allDishes().length, overridden: listDishImages().length },
      },
      recentAudit: listAudit(8),
    });
  }

  /* 社区帖子 */
  if (parts[0] === 'posts') {
    if (method === 'GET' && parts.length === 1) {
      const q = String(url.searchParams.get('q') || '').slice(0, 60);
      return send(res, 200, adminListPosts({ q, page, pageSize }));
    }
    if (method === 'GET' && parts.length === 2) {
      const post = findPost(parts[1]);
      if (!post) return send(res, 404, { error: '帖子不存在' });
      return send(res, 200, { post, reports: reportsForPost(post.id) });
    }
    if (method === 'DELETE' && parts.length === 2) {
      const body = await readJson(req).catch(() => ({}));
      const post = findPost(parts[1]);
      if (!post) return send(res, 404, { error: '帖子不存在' });
      if (post.deletedAt) return send(res, 200, { ok: true, already: true });
      const reason = String(body.reason || '管理员删除').slice(0, 200);
      const result = softDeletePost(post.id, { by: actor.id, reason });
      if (!result.ok) return send(res, 400, { error: '删除失败' });
      audit(actor, 'post.delete', 'post', post.id, { reason, author: post.author?.name });
      // 该帖的待处理举报一并标记为已处理
      for (const r of reportsForPost(post.id)) {
        if (r.status !== 'pending' && r.status !== 'processing') continue;
        updateReportStatus({
          id: r.id,
          status: 'resolved',
          handledBy: actor.id,
          action: 'delete-post',
          note: '内容已被管理员删除',
        });
      }
      return send(res, 200, { ok: true });
    }
  }

  /* 首页卡片图片 */
  if (parts[0] === 'cards') {
    if (method === 'GET') {
      return send(res, 200, { items: cardRows() });
    }
    if (method === 'POST' && parts.length === 1) {
      const body = await readJson(req).catch(() => ({}));
      const kind = body.kind === 'taste' ? 'taste' : body.kind === 'cuisine' ? 'cuisine' : '';
      if (!kind) return send(res, 400, { error: '卡片类型不合法' });
      const id = String(body.id || '');
      const exists = kind === 'cuisine' ? CUISINE_BY_ID[id] : TASTE_BY_ID[id];
      if (!exists) return send(res, 404, { error: '卡片不存在' });
      const image = normalizeImageUrl(body.url);
      if (!image) return send(res, 400, { error: '图片地址不合法' });
      upsertCardImage({ kind, cardId: id, url: image, updatedBy: actor.id });
      audit(actor, 'card.image', kind, id, { url: image });
      return send(res, 200, { ok: true, kind, id, image });
    }
    if (method === 'DELETE' && parts.length === 3) {
      const kind = parts[1] === 'taste' ? 'taste' : 'cuisine';
      const id = String(parts[2] || '');
      deleteCardImage(kind, id);
      audit(actor, 'card.reset', kind, id, {});
      return send(res, 200, { ok: true });
    }
  }

  /* 美食图鉴菜品图片 */
  if (parts[0] === 'dishes') {
    if (method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const overrides = getAssetOverrides().dishes;
      let list = allDishes();
      if (q) list = list.filter((d) => `${d.name} ${d.id}`.toLowerCase().includes(q));
      const total = list.length;
      const start = (page - 1) * pageSize;
      return send(res, 200, {
        items: list.slice(start, start + pageSize).map((d) => ({
          id: d.id,
          name: d.name,
          cuisine: d.cuisine,
          cuisineName: CUISINE_BY_ID[d.cuisine]?.name || '',
          defaultImage: d.image || '',
          image: overrides[d.id] || d.image || '',
          overridden: Boolean(overrides[d.id]),
        })),
        total,
        page,
        pageSize,
        hasMore: start + pageSize < total,
      });
    }
    if (method === 'POST' && parts.length === 1) {
      const body = await readJson(req).catch(() => ({}));
      const id = String(body.id || '');
      if (!allDishes().some((d) => d.id === id)) return send(res, 404, { error: '菜品不存在' });
      const image = normalizeImageUrl(body.url);
      if (!image) return send(res, 400, { error: '图片地址不合法' });
      upsertDishImage({ dishId: id, url: image, updatedBy: actor.id });
      audit(actor, 'dish.image', 'dish', id, { url: image });
      return send(res, 200, { ok: true, id, image });
    }
    if (method === 'DELETE' && parts.length === 2) {
      deleteDishImage(parts[1]);
      audit(actor, 'dish.reset', 'dish', parts[1], {});
      return send(res, 200, { ok: true });
    }
  }

  /* 举报 */
  if (parts[0] === 'reports') {
    if (method === 'GET' && parts.length === 1) {
      const status = ['pending', 'processing', 'resolved', 'rejected'].includes(url.searchParams.get('status'))
        ? url.searchParams.get('status')
        : '';
      const result = listReports({ status, page, pageSize });
      const items = result.items.map((r) => {
        const post = findPost(r.post_id);
        return {
          ...r,
          post: post
            ? {
                id: post.id,
                content: post.content,
                author: post.author,
                createdAt: post.createdAt,
                image: post.image || '',
                deletedAt: post.deletedAt || null,
              }
            : null,
          relatedCount: reportsForPost(r.post_id).length,
        };
      });
      return send(res, 200, { ...result, items, stats: reportStats() });
    }
    if (method === 'POST' && parts.length === 3 && parts[2] === 'handle') {
      const body = await readJson(req).catch(() => ({}));
      const report = getReport(parts[1]);
      if (!report) return send(res, 404, { error: '举报不存在' });
      const action = String(body.action || '');
      const note = String(body.note || '').slice(0, 200);
      const map = {
        processing: { status: 'processing', action: 'mark-processing' },
        reject: { status: 'rejected', action: 'reject' },
        resolve: { status: 'resolved', action: 'resolve' },
        'delete-post': { status: 'resolved', action: 'delete-post' },
      };
      const target = map[action];
      if (!target) return send(res, 400, { error: '处理动作不合法' });

      if (action === 'delete-post') {
        const post = findPost(report.post_id);
        if (!post) return send(res, 404, { error: '被举报内容不存在' });
        const del = softDeletePost(post.id, { by: actor.id, reason: `举报处理：${report.reason}` });
        if (!del.ok) return send(res, 500, { error: '删除内容失败' });
        // 同一帖子的其他待处理举报同步为已处理，避免列表残留
        for (const r of reportsForPost(post.id)) {
          if (r.status === 'pending' || r.status === 'processing') {
            updateReportStatus({
              id: r.id,
              status: 'resolved',
              handledBy: actor.id,
              action: 'delete-post',
              note: note || '内容已删除',
            });
          }
        }
        audit(actor, 'report.delete-post', 'post', post.id, { reportId: report.id, reason: report.reason });
        return send(res, 200, { ok: true, report: getReport(report.id) });
      }

      const updated = updateReportStatus({
        id: report.id,
        status: target.status,
        handledBy: actor.id,
        action: target.action,
        note,
      });
      audit(actor, `report.${target.action}`, 'report', report.id, { note });
      return send(res, 200, { ok: true, report: updated });
    }
  }

  /* 审计日志 */
  if (method === 'GET' && parts[0] === 'audit') {
    return send(res, 200, { items: listAudit(Math.min(100, pageSize * 3)) });
  }

  /* 图片上传（仅管理员） */
  if (method === 'POST' && parts[0] === 'upload') {
    const body = await readJson(req).catch(() => ({}));
    if (!body.image) return send(res, 400, { error: '缺少图片数据' });
    const saved = saveImage(body.image, `admin-${actor.id}`);
    if (!saved.ok) return send(res, 400, { error: saved.error });
    return send(res, 200, { ok: true, url: saved.url });
  }

  return send(res, 404, { error: '未知的管理接口' });
}

/* ---------------- 公开：提交举报 ---------------- */

export function submitReport({ post, user, reason, note, source }) {
  const existing = findPendingReportBy(post.id, user.id);
  if (existing) return { ok: false, code: 'duplicate', message: '你已经举报过这条内容，我们正在处理' };
  const report = createReport({
    id: crypto.randomUUID(),
    postId: post.id,
    reason: String(reason || '其他').slice(0, 40),
    note: String(note || '').slice(0, 300),
    reporterId: user.id,
    reporterName: user.name || user.email,
    source: source || 'web',
  });
  return { ok: true, report };
}
