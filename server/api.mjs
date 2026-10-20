import crypto from 'node:crypto';

import { DISHES } from '../src/data/dishes.js';
import { PERSONALITY_BY_ID } from '../src/data/personalities.js';
import { TASTE_BY_ID, CUISINE_BY_ID, TASTES } from '../src/data/cuisines.js';
import { buildDishSystemPrompt, buildCategorySystemPrompt, buildMascotSystemPrompt, buildRecipePrompt, buildRecommendPrompt, buildSuggestionPrompt } from './prompt.mjs';
import { validateRecipe } from './recipe-schema.mjs';
import { demoGreeting, demoCategoryGreeting } from './demo.mjs';
import { listComments, addComment, toggleLike, reportComment, deleteComment, commentCountByDish } from './store.mjs';
import { listPosts, addPost, toggleLike as togglePostLike, addComment as addPostComment, reportPost, removePost, saveImage, postStats, findPost, aiReplyStats, KINDS } from './community.mjs';
import { searchVideos } from './videos.mjs';
import { searchDishes, findDish, generatedDishes } from './dish-search.mjs';
import { lookupDish, lookupLibrary, rememberLookup, takeLookup, attachSourceSupport } from './recipe-lookup.mjs';
import { personaForCategory, dishesForCategory } from '../src/data/categories.js';
import { extractJSON } from './json-utils.mjs';
import { chatStream, complete } from './ai-adapter.mjs';
import { getCurrentUser, setSessionCookie, clearSessionCookie, requireUser, requireAdmin, sameOrigin, syncRole } from './auth.mjs';
import { createUser, findUserByEmail } from './db.mjs';
import { hashPassword, verifyPassword } from './security.mjs';
import { getAIStatus, getAIConfig, getConfigForRequest, testUserConfig, saveUserConfig, deleteUserConfig, listUserModels, markAIConfigStatus } from './ai-config.mjs';
import { rateLimit } from './rate-limit.mjs';
import { handleAdmin, getAssetOverrides, submitReport } from './admin-routes.mjs';

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readJson(req, limit = 200_000) {
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
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', reject);
  });
}


function guest(req) {
  const id = String(req.headers['x-guest-id'] || '').slice(0, 60);
  const name = decodeURIComponent(String(req.headers['x-guest-name'] || '')).slice(0, 16);
  return { id: id || 'anonymous', name: name || '访客' };
}

/* ------------------------------------------------------------------ *
 * 聊天（SSE 流式）
 * ------------------------------------------------------------------ */

function openSSE(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// 人格解析：dish.personality 优先，缺失时回退到主味型人格（口味共享人格基底）
function personaFor(dish) {
  if (!dish) return null;
  return PERSONALITY_BY_ID[dish.personality] || PERSONALITY_BY_ID[dish.tastes?.[0]] || null;
}

// 分类人格与分类菜品由 src/data/categories.js 统一推导（前端聊天页共用同一份逻辑）

/* ------------------------------------------------------------------ *
 * 账号与用户级 AI 配置
 * ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role || 'user' } : null;
}

function authPayload(user) {
  return { user: publicUser(user), ai: getAIStatus(user?.id) };
}

async function handleRegister(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const rl = rateLimit(req, 'register', 8, 60_000);
  if (!rl.ok) return send(res, 429, { error: `尝试过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 20) || email.split('@')[0].slice(0, 20) || '食客';

  if (!EMAIL_RE.test(email)) return send(res, 400, { error: '请输入有效邮箱' });
  if (password.length < 8 || password.length > 128) return send(res, 400, { error: '密码至少 8 位' });
  if (findUserByEmail(email)) return send(res, 409, { error: '该邮箱已注册' });

  const { hash, salt } = hashPassword(password);
  const user = createUser({
    id: crypto.randomUUID(),
    email,
    name,
    passwordHash: hash,
    passwordSalt: salt,
  });
  setSessionCookie(req, res, user.id);
  // 白名单邮箱注册即为管理员（角色由服务端环境变量决定）
  return send(res, 200, authPayload(syncRole(user)));
}

async function handleLogin(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const rl = rateLimit(req, 'login', 10, 60_000);
  if (!rl.ok) return send(res, 429, { error: `尝试过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(body.password || '');
  const row = findUserByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    return send(res, 401, { error: '邮箱或密码错误' });
  }
  setSessionCookie(req, res, row.id);
  return send(res, 200, authPayload(syncRole({ id: row.id, email: row.email, name: row.name, role: row.role })));
}

async function handleLogout(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  clearSessionCookie(req, res);
  return send(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = getCurrentUser(req);
  return send(res, 200, authPayload(user));
}

async function handleAIConfigGet(req, res) {
  const user = requireUser(req, res, send);
  if (!user) return;
  const config = getAIConfig(user.id);
  const status = getAIStatus(user.id);
  return send(res, 200, {
    ...status,
    baseUrl: config?.baseUrl || '',
    keyConfigured: Boolean(config?.apiKey),
  });
}

async function handleAITest(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const rl = rateLimit(req, `ai-test:${user.id}`, 10, 60_000);
  if (!rl.ok) return send(res, 429, { error: `测试过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const result = await testUserConfig(user.id, body);
  return send(res, 200, result);
}

async function handleAISave(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const rl = rateLimit(req, `ai-save:${user.id}`, 10, 60_000);
  if (!rl.ok) return send(res, 429, { error: `保存过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const result = await saveUserConfig(user.id, body);
  if (!result.ok) return send(res, 400, { error: result.error, code: result.code });
  return send(res, 200, result);
}

async function handleAIDelete(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const ai = deleteUserConfig(user.id);
  return send(res, 200, { ok: true, ai });
}

async function handleAIModels(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const rl = rateLimit(req, `ai-models:${user.id}`, 15, 60_000);
  if (!rl.ok) return send(res, 429, { error: `请求过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const result = await listUserModels(user.id, body);
  return send(res, 200, result);
}

async function handleChat(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const ai = getConfigForRequest(user.id);
  if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });

  const body = await readJson(req);
  const askedKind = body.kind || body.mode;
  const kind = askedKind === 'taste' ? 'taste' : askedKind === 'cuisine' ? 'cuisine' : '';
  const mode = kind ? 'category' : body.mode === 'mascot' ? 'mascot' : 'dish';
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return send(res, 400, { error: '缺少用户消息' });

  let meta = null;
  let persona = null;
  let dish = null;
  let categoryDishes = [];

  if (mode === 'category') {
    const categoryId = String(body.categoryId || '').slice(0, 40);
    meta = kind === 'taste' ? TASTE_BY_ID[categoryId] : CUISINE_BY_ID[categoryId];
    if (!meta) return send(res, 404, { error: '未找到该菜系或口味' });
    persona = personaForCategory(kind, meta.id);
    categoryDishes = dishesForCategory(kind, meta.id);
    // 上下文菜品是可选的：只作为聊天话题，不决定人格
    dish = body.contextDishId ? findDish(body.contextDishId) : null;
  } else if (mode === 'dish') {
    dish = findDish(body.dishId);
    if (!dish) return send(res, 404, { error: '未找到该菜品' });
    persona = personaFor(dish);
  }

  openSSE(res);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sse(res, {
    type: 'meta',
    mode,
    kind: kind || null,
    categoryId: meta?.id || null,
    categoryName: meta?.name || null,
    aiConfigured: true,
    provider: ai.config.provider,
    model: ai.config.model,
    dishId: dish?.id || null,
    personaId: persona?.id || null,
  });

  try {
    const system =
      mode === 'mascot'
        ? buildMascotSystemPrompt()
        : mode === 'category'
          ? buildCategorySystemPrompt({
              kind,
              meta,
              persona,
              dishes: categoryDishes,
              contextDish: dish,
            })
          : buildDishSystemPrompt(dish, persona);

    await chatStream({
      baseUrl: ai.config.baseUrl,
      apiKey: ai.config.apiKey,
      model: ai.config.model,
      system,
      messages,
      signal: controller.signal,
      onDelta: (text) => sse(res, { type: 'delta', text }),
    });
    markAIConfigStatus(user.id, 'ok', null);
    sse(res, { type: 'done' });
  } catch (err) {
    if (!controller.signal.aborted) {
      const code = err?.code || 'network';
      markAIConfigStatus(user.id, code, err?.message || String(err));
      sse(res, { type: 'error', message: String(err?.message || err).slice(0, 300) });
    }
  } finally {
    res.end();
  }
}

/* ------------------------------------------------------------------ *
 * 对话延伸建议（独立调用，不阻塞主回答）
 * ------------------------------------------------------------------ */

function normalizeSuggestionText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）()【】《》…—\-~～]/g, '')
    .toLowerCase();
}

function sanitizeSuggestions(raw, { mode, dish, categoryDishes = [], kind, meta, lastUser, exclude = [] }) {
  const list = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const seen = new Set();
  const excludeSet = new Set((Array.isArray(exclude) ? exclude : []).map(normalizeSuggestionText));
  const lastUserNorm = normalizeSuggestionText(lastUser);
  const dishFallback = dish?.name || categoryDishes[0]?.name || meta?.name || '';
  const tasteFallback = dish?.tastes?.[0] || (kind === 'taste' ? meta?.id : categoryDishes[0]?.tastes?.[0]) || '';
  const out = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (text.length < 4) continue;
    const norm = normalizeSuggestionText(text);
    if (!norm || seen.has(norm) || excludeSet.has(norm) || norm === lastUserNorm) continue;

    let actionType = ['chat', 'recipe', 'recommend', 'video'].includes(item.actionType) ? item.actionType : 'chat';
    const payload = item.actionPayload && typeof item.actionPayload === 'object' ? item.actionPayload : {};
    let actionPayload = {};

    // 动作类型必须和文案意图一致，避免「一句话提示」被点成菜谱/推荐
    const recipeText = /菜谱|详细做法|具体步骤|教我|怎么做|学做|火候|用量|配方/.test(text) && !/其他|别的|换个|另一道|哪些/.test(text);
    const recommendText = /推荐|相似|类似|同类|几道菜|整桌|菜单/.test(text) && !/配菜|主食|饮品|蔬菜|米饭|汤|解腻/.test(text);
    if (actionType === 'recipe' && !recipeText) {
      actionType = 'chat';
    } else if (actionType === 'recommend' && !recommendText) {
      actionType = 'chat';
    } else if (actionType === 'video' && !/视频|教程|演示/.test(text)) {
      actionType = 'chat';
    }

    if (actionType === 'recipe') {
      const mentioned = categoryDishes.find((d) => text.includes(d.name));
      const dishName = String(
        payload.dishName || mentioned?.name || (mode === 'category' ? '' : dishFallback)
      )
        .trim()
        .slice(0, 30);
      if (!dishName) {
        // 分类聊天里无法确定是哪道菜：退回普通对话，避免点开错误菜谱
        actionType = 'chat';
        actionPayload = {};
      } else {
        actionPayload = { dishName };
      }
    } else if (actionType === 'recommend') {
      const tasteRaw = String(payload.taste || tasteFallback).trim().slice(0, 30);
      const hit = TASTES.find(
        (t) => t.id === tasteRaw || t.name === tasteRaw || t.name.includes(tasteRaw) || tasteRaw.includes(t.name)
      );
      const taste = hit?.id || (TASTE_BY_ID[tasteRaw] ? tasteRaw : tasteFallback);
      if (!taste) continue;
      actionPayload = { taste };
    } else if (actionType === 'video') {
      const query = String(payload.query || dishFallback).trim().slice(0, 40);
      if (!query) continue;
      actionPayload = { query };
    } else {
      actionType = 'chat';
      actionPayload = {};
    }

    seen.add(norm);
    out.push({ text, actionType, actionPayload });
    if (out.length >= 3) break;
  }
  return out;
}

async function handleSuggest(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const ai = getConfigForRequest(user.id);
  if (!ai.ok) return send(res, 200, { suggestions: [], code: ai.code, error: ai.message });
  const body = await readJson(req);
  const askedKind = body.kind || body.mode;
  const kind = askedKind === 'taste' ? 'taste' : askedKind === 'cuisine' ? 'cuisine' : '';
  const mode = kind ? 'category' : 'dish';
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));
  const lastUser = String(body.lastUser || '').trim().slice(0, 800);
  const lastAssistant = String(body.lastAssistant || '').trim().slice(0, 1200);
  if (!lastUser || !lastAssistant) return send(res, 400, { error: '缺少对话内容' });
  if (lastAssistant.length < 12) return send(res, 200, { suggestions: [] });
  if (/^(抱歉|对不起|很抱歉|我无法|我不能|生成失败)/.test(lastAssistant)) {
    return send(res, 200, { suggestions: [] });
  }

  let meta = null;
  let persona = null;
  let dish = null;
  let categoryDishes = [];

  if (mode === 'category') {
    const categoryId = String(body.categoryId || '').slice(0, 40);
    meta = kind === 'taste' ? TASTE_BY_ID[categoryId] : CUISINE_BY_ID[categoryId];
    if (!meta) return send(res, 404, { error: '未找到该菜系或口味' });
    persona = personaForCategory(kind, meta.id);
    categoryDishes = dishesForCategory(kind, meta.id);
    dish = body.contextDishId ? findDish(body.contextDishId) : categoryDishes[0] || null;
  } else {
    dish = findDish(body.dishId);
    if (!dish) return send(res, 404, { error: '未找到该菜品' });
    persona = personaFor(dish);
  }

  const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
    .map((x) => String(x || '').trim().slice(0, 60))
    .filter(Boolean)
    .slice(-20);

  const system = buildSuggestionPrompt({
    mode,
    kind,
    meta,
    persona,
    dish,
    categoryDishes,
    messages,
    lastUser,
    lastAssistant,
    exclude,
  });

  try {
    const raw = await complete({
      baseUrl: ai.config.baseUrl,
      apiKey: ai.config.apiKey,
      model: ai.config.model,
      system,
      messages: [{ role: 'user', content: '请生成 1-3 条后续建议 JSON。' }],
      temperature: 0.8,
      maxTokens: 500,
      timeout: 30000,
    });
    const base = { mode, dish, categoryDishes, kind, meta, lastUser, exclude };
    let suggestions = sanitizeSuggestions(extractJSON(raw), base);

    // 正常回答却拿到空结果时，补一次更明确的请求（拒绝/极短回答已在前面直接返回）
    if (!suggestions.length) {
      const retryRaw = await complete({
        baseUrl: ai.config.baseUrl,
        apiKey: ai.config.apiKey,
        model: ai.config.model,
        system: `${system}\n\n注意：本轮是正常回答，请至少给 1 条与本轮直接相关的具体建议；只有确实不适合延伸时才返回 {"suggestions":[]}。`,
        messages: [{ role: 'user', content: '请至少给 1 条具体建议 JSON。' }],
        temperature: 0.5,
        maxTokens: 500,
        timeout: 30000,
      });
      suggestions = sanitizeSuggestions(extractJSON(retryRaw), base);
    }

    markAIConfigStatus(user.id, 'ok', null);
    return send(res, 200, { suggestions });
  } catch (err) {
    console.warn(`[suggest] ${String(err.message || err).slice(0, 160)}`);
    markAIConfigStatus(user.id, err?.code || 'network', err?.message || String(err));
    return send(res, 200, { suggestions: [], error: '建议生成失败' });
  }
}

/* ------------------------------------------------------------------ *
 * 菜谱生成：两阶段菜品查询
 * ------------------------------------------------------------------ */

function matchedDishPayload(d) {
  if (!d) return null;
  return { id: d.id, name: d.name, cuisine: d.cuisine, tastes: d.tastes, image: d.image, alt: d.alt };
}

/** 第一阶段 + 第二阶段查询（供前端分步展示状态） */
async function handleRecipeLookup(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const rl = rateLimit(req, `recipe-lookup:${user.id}`, 30, 60_000);
  if (!rl.ok) return send(res, 429, { error: `查询过于频繁，请 ${rl.retryAfter} 秒后再试` });

  const body = await readJson(req);
  const dishName = String(body.dishName || '').trim().slice(0, 30);
  const dishId = String(body.dishId || '').trim().slice(0, 40);
  if (!dishName && !dishId) return send(res, 400, { error: '请填写菜品名称' });

  const result = await lookupDish({ dishName, dishId });
  if (result.status === 'found') {
    return send(res, 200, {
      status: 'ok',
      dataSource: 'library',
      dish: result.dish,
      sources: [],
      matchedBy: result.matchedBy,
      message: result.message || `已在美食图鉴中找到「${result.dish.name}」。`,
    });
  }
  if (result.status === 'ambiguous') {
    return send(res, 200, {
      status: 'ambiguous',
      dataSource: 'library',
      candidates: result.candidates,
      sources: [],
      message: result.message,
    });
  }
  if (result.status === 'invalid') return send(res, 400, { error: result.message || '请填写菜品名称' });

  const lookupId = rememberLookup(result, user.id);
  return send(res, 200, { ...result, lookupId });
}

async function handleRecipe(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const ai = getConfigForRequest(user.id);
  if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });

  const body = await readJson(req);
  const input = {
    dishId: String(body.dishId || '').trim().slice(0, 40),
    dishName: String(body.dishName || '').trim().slice(0, 30),
    servings: Math.min(12, Math.max(1, Number(body.servings) || 2)),
    difficulty: ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'easy',
    ingredients: String(body.ingredients || '').slice(0, 200),
    maxMinutes: Number(body.maxMinutes) || 0,
    taste: String(body.taste || '').slice(0, 30),
    lookupId: String(body.lookupId || '').trim().slice(0, 60),
  };
  if (!input.dishName && !input.dishId) return send(res, 400, { error: '请填写菜品名称' });

  // 第一阶段：站内图鉴（含 AI 补全库）
  let dish = input.dishId ? findDish(input.dishId) : null;
  if (!dish && input.dishName) {
    const lib = lookupLibrary(input.dishName);
    if (lib.status === 'found') dish = lib.dish;
  }

  // 第二阶段：图鉴没有 → 使用当前用户已缓存的真实检索结果，或现场检索
  let lookup = null;
  if (!dish) {
    lookup = input.lookupId ? takeLookup(input.lookupId, user.id) : null;
    if (!lookup) lookup = await lookupDish({ dishName: input.dishName });
    if (!lookup || lookup.status !== 'ok') {
      return send(res, 200, {
        status: lookup?.status || 'insufficient',
        dataSource: lookup?.dataSource || 'ai-search',
        sources: lookup?.sources || [],
        sourceStats: lookup
          ? { shown: lookup.sources?.length || 0, relevant: lookup.relevantCount || 0, total: lookup.totalCount || 0 }
          : null,
        message: lookup?.message || '暂未找到足够可靠的资料，无法生成菜谱。',
        recipe: null,
      });
    }
  }

  const searchSources = lookup?.status === 'ok' ? lookup.sources : [];
  const isAiSearch = Boolean(lookup);
  const system = buildRecipePrompt(input, dish, searchSources);
  let lastIssues = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await complete({
        baseUrl: ai.config.baseUrl,
        apiKey: ai.config.apiKey,
        model: ai.config.model,
        system,
        messages: [
          {
            role: 'user',
            content:
              attempt === 0
                ? `请生成「${input.dishName}」的菜谱 JSON。`
                : `上一次输出未通过校验（${lastIssues.join('; ')}）。请严格按结构重新输出纯 JSON。`,
          },
        ],
        temperature: attempt === 0 ? 0.5 : 0.2,
        maxTokens: 2000,
        timeout: 60000,
      });
      const parsed = extractJSON(raw);
      const check = validateRecipe(parsed, input.servings);
      if (check.ok) {
        markAIConfigStatus(user.id, 'ok', null);
        const sources = isAiSearch ? attachSourceSupport(searchSources, check.recipe, input.dishName) : [];
        return send(res, 200, {
          source: 'ai',
          dataSource: isAiSearch ? 'ai-search' : 'library',
          matchedDish: matchedDishPayload(dish),
          lookupStatus: isAiSearch ? 'ok' : 'found',
          sources,
          sourceStats: isAiSearch
            ? { shown: sources.length, relevant: lookup.relevantCount ?? sources.length, total: lookup.totalCount ?? sources.length }
            : null,
          verification: isAiSearch
            ? {
                level: 'ai-synthesized',
                label: 'AI 综合公开资料整理',
                note: '菜谱由已接入的模型综合下方来源整理，未逐条核验；「关键词匹配」只表示该来源提到相关食材或做法，请以原始资料为准。',
              }
            : {
                level: 'library',
                label: '美食图鉴（站内数据）',
                note: '菜品档案来自站内图鉴；用量与步骤由已接入的模型按档案生成。',
              },
          valid: true,
          issues: [],
          recipe: check.recipe,
        });
      }
      console.warn(
        `[recipe] attempt ${attempt} 未通过校验：raw_len=${String(raw || '').length} head=${JSON.stringify(String(raw || '').slice(0, 80))}`
      );
      lastIssues = check.issues;
    } catch (err) {
      console.warn(`[recipe] attempt ${attempt} 调用失败：${String(err.message || err).slice(0, 200)}`);
      markAIConfigStatus(user.id, err?.code || 'network', err?.message || String(err));
      lastIssues = [String(err.message || err).slice(0, 160)];
    }
  }

  // 不提供本地/模拟菜谱兜底：模型失败时明确告知
  return send(res, 200, {
    status: 'failed',
    dataSource: isAiSearch ? 'ai-search' : 'library',
    matchedDish: matchedDishPayload(dish),
    sources: isAiSearch ? attachSourceSupport(searchSources, null, input.dishName) : [],
    message: '模型没有返回可用菜谱，请稍后重试。',
    issues: lastIssues,
    recipe: null,
  });
}

/* ------------------------------------------------------------------ *
 * 推荐
 * ------------------------------------------------------------------ */

const DIFF_RANK = { easy: 1, medium: 2, hard: 3 };

function filterCandidates(input) {
  const relaxed = [];
  let pool = DISHES.slice();

  const avoid = String(input.avoid || '');
  if (/辣/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('spicy'));
  if (/海鲜|水产/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('seafood') && !d.tags.includes('fish'));
  if (/猪肉/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('pork'));
  if (/牛肉/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('beef'));
  if (/蛋/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('egg'));
  if (/坚果/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('nuts'));
  if (/酒/.test(avoid)) pool = pool.filter((d) => !d.tags.includes('alcohol'));
  if (/素|斋/.test(avoid)) {
    pool = pool.filter(
      (d) => !d.tags.some((t) => ['fish', 'seafood', 'pork', 'beef', 'poultry', 'egg'].includes(t))
    );
  }

  if (input.taste && TASTE_BY_ID[input.taste]) {
    const byTaste = pool.filter((d) => d.tastes.includes(input.taste));
    if (byTaste.length >= 3) pool = byTaste;
    else relaxed.push('taste');
  }

  if (input.difficulty && DIFF_RANK[input.difficulty]) {
    const max = DIFF_RANK[input.difficulty];
    const byDiff = pool.filter((d) => DIFF_RANK[d.difficulty] <= max);
    if (byDiff.length >= 3) pool = byDiff;
    else relaxed.push('difficulty');
  }

  if (input.minutes) {
    const byTime = pool.filter((d) => d.prep + d.cook <= input.minutes);
    if (byTime.length >= 3) pool = byTime;
    else relaxed.push('minutes');
  }

  if (input.budget) {
    const byBudget = pool.filter((d) => d.price <= input.budget);
    if (byBudget.length >= 3) pool = byBudget;
    else relaxed.push('budget');
  }

  if (input.ingredients) {
    const words = String(input.ingredients)
      .split(/[，,、\s]+/)
      .filter((w) => w.length >= 1);
    if (words.length) {
      const scored = pool.map((d) => ({
        dish: d,
        score: words.reduce((acc, w) => acc + (d.ingredients.some((i) => i.includes(w) || w.includes(i)) ? 1 : 0), 0),
      }));
      const hit = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      if (hit.length >= 3) pool = hit.map((s) => s.dish);
      else relaxed.push('ingredients');
    }
  }

  return { pool, relaxed };
}

async function handleRecommend(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
  const user = requireUser(req, res, send);
  if (!user) return;
  const ai = getConfigForRequest(user.id);
  if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });

  const body = await readJson(req);
  const input = {
    taste: body.taste || '',
    budget: Number(body.budget) || 0,
    people: Math.min(12, Math.max(1, Number(body.people) || 2)),
    ingredients: String(body.ingredients || '').slice(0, 120),
    minutes: Number(body.minutes) || 0,
    difficulty: body.difficulty || '',
    avoid: String(body.avoid || '').slice(0, 80),
  };

  const { pool, relaxed } = filterCandidates(input);
  const base = pool.length ? pool : DISHES;
  const offset = Math.abs(Number(body.offset) || 0) % Math.max(1, base.length);
  const rotated = base.slice(offset).concat(base.slice(0, offset));
  const candidates = rotated.slice(0, 8);

  let picks = [];
  try {
    const raw = await complete({
      baseUrl: ai.config.baseUrl,
      apiKey: ai.config.apiKey,
      model: ai.config.model,
      system: buildRecommendPrompt(input, candidates),
      messages: [{ role: 'user', content: '请给出推荐 JSON。' }],
      temperature: 0.7,
      maxTokens: 800,
      timeout: 45000,
    });
    const parsed = extractJSON(raw);
    if (parsed?.picks?.length) {
      const valid = parsed.picks
        .map((p) => ({ dish: candidates.find((c) => c.id === p.id), reason: String(p.reason || '').slice(0, 160) }))
        .filter((p) => p.dish);
      if (valid.length) picks = valid.slice(0, 3);
    }
  } catch (err) {
    markAIConfigStatus(user.id, err?.code || 'network', err?.message || String(err));
    return send(res, 503, { error: '模型暂时不可用，请稍后重试', code: 'ai_failed' });
  }

  if (!picks.length) {
    return send(res, 200, { source: 'ai', demo: false, relaxed, picks: [], message: '模型没有给出可用推荐，请重试。' });
  }

  markAIConfigStatus(user.id, 'ok', null);
  send(res, 200, {
    source: 'ai',
    demo: false,
    relaxed,
    picks: picks.map((p) => ({
      id: p.dish.id,
      name: p.dish.name,
      cuisine: p.dish.cuisine,
      tastes: p.dish.tastes,
      image: p.dish.image,
      reason: p.reason,
      minutes: p.dish.prep + p.dish.cook,
      difficulty: p.dish.difficulty,
      price: p.dish.price,
    })),
  });
}

/* ------------------------------------------------------------------ *
 * 评论
 * ------------------------------------------------------------------ */

async function handleComments(req, res, url) {
  const path = url.pathname.replace(/^\/api\/comments\/?/, '');
  const parts = path.split('/').filter(Boolean);

  if (req.method === 'GET' && !parts.length) {
    const dishId = url.searchParams.get('dishId') || '';
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(20, Math.max(3, Number(url.searchParams.get('pageSize')) || 5));
    if (!dishId) return send(res, 400, { error: '缺少 dishId' });
    return send(res, 200, listComments(dishId, page, pageSize));
  }

  if (req.method === 'POST' && !parts.length) {
    const body = await readJson(req);
    const who = guest(req);
    const content = String(body.content || '').trim();
    if (!body.dishId || !findDish(body.dishId)) return send(res, 400, { error: '菜品不存在' });
    if (content.length < 2) return send(res, 400, { error: '评论太短了，至少 2 个字' });
    if (content.length > 300) return send(res, 400, { error: '评论最多 300 字' });
    const result = addComment({
      dishId: body.dishId,
      parentId: body.parentId || null,
      content,
      author: who,
    });
    if (!result.ok) return send(res, 400, { error: '要回复的评论不存在' });
    return send(res, 201, { comment: result.comment });
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'like') {
    const who = guest(req);
    const result = toggleLike(parts[0], who.id);
    if (!result) return send(res, 404, { error: '评论不存在' });
    return send(res, 200, result);
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'report') {
    const result = reportComment(parts[0]);
    if (!result) return send(res, 404, { error: '评论不存在' });
    return send(res, 200, { ...result, message: '已收到举报，演示环境不会自动处理。' });
  }

  if (req.method === 'DELETE' && parts.length === 1) {
    const who = guest(req);
    const result = deleteComment(parts[0], who.id);
    if (!result.ok) {
      return send(res, result.reason === 'forbidden' ? 403 : 404, {
        error: result.reason === 'forbidden' ? '只能删除自己发布的评论' : '评论不存在',
      });
    }
    return send(res, 200, { ok: true });
  }

  // 用户主动触发的 AI 回复（明确标记 isAI）
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'ai-reply') {
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send);
    if (!user) return;
    const ai = getConfigForRequest(user.id);
    if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });

    const body = await readJson(req);
    const dish = findDish(body.dishId);
    if (!dish) return send(res, 404, { error: '菜品不存在' });
    const persona = personaFor(dish);
    const question = String(body.content || '').slice(0, 200);
    try {
      const text = await complete({
        baseUrl: ai.config.baseUrl,
        apiKey: ai.config.apiKey,
        model: ai.config.model,
        system: buildDishSystemPrompt(dish, persona),
        messages: [{ role: 'user', content: `有食客在评论区说：「${question}」。请用你的身份回应一句，80 字以内。` }],
        temperature: 0.9,
        maxTokens: 300,
        timeout: 30000,
      });
      const result = addComment({
        dishId: dish.id,
        parentId: body.parentId || null,
        content: text.slice(0, 200),
        author: { id: `ai-${dish.id}`, name: `${dish.name} · AI` },
        isAI: true,
      });
      if (!result.ok) return send(res, 400, { error: '要回复的评论不存在' });
      markAIConfigStatus(user.id, 'ok', null);
      return send(res, 201, { comment: result.comment });
    } catch (err) {
      markAIConfigStatus(user.id, err?.code || 'network', err?.message || String(err));
      return send(res, 503, { error: '模型暂时不可用，请稍后重试', code: 'ai_failed' });
    }
  }

  return send(res, 404, { error: 'not-found' });
}

/* ------------------------------------------------------------------ *
 * 社区帖子
 * ------------------------------------------------------------------ */

async function handlePosts(req, res, url) {
  const rest = url.pathname.replace(/^\/api\/posts\/?/, '');
  const parts = rest.split('/').filter(Boolean);

  if (req.method === 'GET' && !parts.length) {
    const sort = ['latest', 'hot', 'discussed'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'latest';
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(12, Math.max(3, Number(url.searchParams.get('pageSize')) || 6));
    const dishId = url.searchParams.get('dishId') || '';
    return send(res, 200, listPosts({ sort, dishId, page, pageSize }));
  }

  if (req.method === 'POST' && !parts.length) {
    // 发帖必须登录：作者身份只从服务端会话读取，忽略请求体里的任何用户标识
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send, '请先登录后再发布内容');
    if (!user) return;

    const body = await readJson(req);
    const who = { id: user.id, name: user.name || user.email.split('@')[0] };
    const content = String(body.content || '').trim();
    if (content.length < 2) return send(res, 400, { error: '说点什么吧，至少 2 个字' });
    if (content.length > 800) return send(res, 400, { error: '帖子最多 800 字' });
    // 关联数据必须真实存在，保证各入口数据一致
    if (body.dishId && !findDish(body.dishId)) return send(res, 400, { error: '关联菜品不存在' });
    if (body.cuisineId && !CUISINE_BY_ID[body.cuisineId]) return send(res, 400, { error: '菜系不存在' });
    if (body.tasteId && !TASTE_BY_ID[body.tasteId]) return send(res, 400, { error: '味型不存在' });
    if (body.kind && !KINDS.includes(body.kind)) return send(res, 400, { error: '分类不合法' });

    const UPLOAD_RE = /^\/uploads\/[a-f0-9-]+\.(jpg|jpeg|png|webp|gif)$/i;
    // 图片统一落盘：dataURL 由服务端保存；已是站内 /uploads/ 路径则白名单放行
    const resolveImage = (raw) => {
      if (!raw) return '';
      if (typeof raw !== 'string') return null;
      if (raw.startsWith('data:')) {
        const saved = saveImage(raw, who.id);
        if (!saved.ok) return { error: saved.error };
        return saved.url;
      }
      if (UPLOAD_RE.test(raw)) return raw;
      return { error: '图片路径不合法' };
    };
    const imageList = [];
    let image = '';
    for (const raw of [...(Array.isArray(body.images) ? body.images : []).slice(0, 3), body.image].filter((x) => x)) {
      if (imageList.length >= 3) break;
      const out = resolveImage(raw);
      if (out && typeof out === 'object') return send(res, 400, { error: out.error });
      if (out) {
        imageList.push(out);
        if (!image) image = out;
      }
    }
    const post = addPost({
      content,
      image,
      images: imageList,
      kind: body.kind,
      dishId: body.dishId || '',
      cuisineId: body.cuisineId || '',
      tasteId: body.tasteId || '',
      author: { id: who.id, name: who.name },
    });
    return send(res, 201, { post });
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'like') {
    const who = guest(req);
    const result = togglePostLike(parts[0], who.id);
    if (!result) return send(res, 404, { error: '帖子不存在' });
    return send(res, 200, result);
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'comments') {
    // 评论同样是社区内容，必须登录
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send, '请先登录后再评论');
    if (!user) return;

    const body = await readJson(req);
    const who = { id: user.id, name: user.name || user.email.split('@')[0] };
    const content = String(body.content || '').trim();
    if (content.length < 1) return send(res, 400, { error: '评论不能为空' });
    const result = addPostComment(parts[0], {
      content,
      author: { id: who.id, name: who.name },
      parentId: body.parentId || null,
    });
    if (!result.ok) {
      return send(res, result.error === 'parent-invalid' ? 400 : 404, {
        error: result.error === 'parent-invalid' ? '要回复的评论不存在' : '帖子不存在',
      });
    }
    return send(res, 201, { comment: result.comment });
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'report') {
    // 举报需登录，写入 reports 表并去重（同一用户对同一内容只保留一条待处理）
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send, '请先登录后再举报');
    if (!user) return;
    const body = await readJson(req).catch(() => ({}));
    const post = findPost(parts[0]);
    if (!post || post.deletedAt) return send(res, 404, { error: '帖子不存在' });
    const out = submitReport({
      post,
      user,
      reason: body.reason,
      note: body.note,
      source: 'web',
    });
    if (!out.ok) return send(res, 429, { error: out.message, code: out.code });
    const counter = reportPost(parts[0]);
    return send(res, 201, {
      ok: true,
      reportId: out.report.id,
      reports: counter?.reports ?? 0,
      message: '已提交举报，管理员会尽快处理',
    });
  }

  if (req.method === 'DELETE' && parts.length === 1) {
    // 只能删自己发的帖：归属按会话用户判定
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send, '请先登录后再操作');
    if (!user) return;
    const result = removePost(parts[0], user.id);
    if (!result.ok) {
      return send(res, result.reason === 'forbidden' ? 403 : 404, {
        error: result.reason === 'forbidden' ? '只能删除自己发布的帖子' : '帖子不存在',
      });
    }
    return send(res, 200, { ok: true });
  }

  // 用户主动触发：让关联菜品以它的味型人格回帖
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'ai-reply') {
    if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
    const user = requireUser(req, res, send);
    if (!user) return;
    const ai = getConfigForRequest(user.id);
    if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });

    const body = await readJson(req);
    const post = findPost(parts[0]);
    if (!post) return send(res, 404, { error: '帖子不存在' });
    const dish = findDish(body.dishId || post.dishId);
    if (!dish) return send(res, 400, { error: '这条帖子没有关联菜品' });
    // 限流：每帖 AI 回复 ≤3 条、同一菜品 ≤2 条
    const stats = aiReplyStats(post);
    if (stats.total >= 3) return send(res, 429, { error: '这道菜在本帖已经说得够多了' });
    if (stats.byDish(dish.id) >= 2) return send(res, 429, { error: '这道菜已经回过两次了，换一道菜问问' });
    const persona = personaFor(dish);
    const question = String(body.content || post.content || '').slice(0, 200);
    try {
      const text = await complete({
        baseUrl: ai.config.baseUrl,
        apiKey: ai.config.apiKey,
        model: ai.config.model,
        system: buildDishSystemPrompt(dish, persona),
        messages: [{ role: 'user', content: `有食客在社区里说：「${question}」。用你的身份回一句，80 字以内。` }],
        temperature: 0.9,
        maxTokens: 300,
        timeout: 30000,
      });
      const result = addPostComment(parts[0], {
        content: text.slice(0, 300),
        author: { id: `ai-${dish.id}`, name: `${dish.name} · AI` },
        isAI: true,
        aiDishId: dish.id,
      });
      if (!result.ok) return send(res, 404, { error: '帖子不存在' });
      markAIConfigStatus(user.id, 'ok', null);
      return send(res, 201, { comment: result.comment });
    } catch (err) {
      markAIConfigStatus(user.id, err?.code || 'network', err?.message || String(err));
      return send(res, 503, { error: '模型暂时不可用，请稍后重试', code: 'ai_failed' });
    }
  }

  return send(res, 404, { error: 'not-found' });
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (path.startsWith('/api/admin')) return await handleAdmin(req, res, url);

    // 前端启动时拉取卡片/菜品图片覆盖（公开只读）
    if (req.method === 'GET' && path === '/api/assets/overrides') {
      return send(res, 200, getAssetOverrides());
    }

    if (req.method === 'GET' && path === '/api/health') {
      return send(res, 200, {
        ok: true,
        auth: true,
        ai: 'user-config',
        dishes: DISHES.length,
        generated: generatedDishes().length,
        comments: commentCountByDish(),
        community: postStats(),
      });
    }

    /* ---------------- 账号 ---------------- */
    if (req.method === 'POST' && path === '/api/auth/register') return await handleRegister(req, res);
    if (req.method === 'POST' && path === '/api/auth/login') return await handleLogin(req, res);
    if (req.method === 'POST' && path === '/api/auth/logout') return await handleLogout(req, res);
    if (req.method === 'GET' && path === '/api/auth/me') return await handleMe(req, res);

    /* ---------------- 用户级 AI 配置 ---------------- */
    if (req.method === 'GET' && path === '/api/ai/status') return await handleMe(req, res);
    if (req.method === 'GET' && path === '/api/ai/config') return await handleAIConfigGet(req, res);
    if (req.method === 'POST' && path === '/api/ai/test') return await handleAITest(req, res);
    if (req.method === 'POST' && path === '/api/ai/config') return await handleAISave(req, res);
    if (req.method === 'DELETE' && path === '/api/ai/config') return await handleAIDelete(req, res);
    if (req.method === 'POST' && path === '/api/ai/models') return await handleAIModels(req, res);

    if (req.method === 'GET' && path === '/api/greeting') {
      const user = getCurrentUser(req);
      const aiStatus = getAIStatus(user?.id);
      const aiConfigured = Boolean(aiStatus.configured && aiStatus.verified);
      const kindParam = url.searchParams.get('kind');
      // 分类 AI 欢迎语：菜系 / 口味由 kind + categoryId 决定，菜品只是可选话题
      if (kindParam === 'cuisine' || kindParam === 'taste') {
        const categoryId = String(url.searchParams.get('categoryId') || url.searchParams.get('id') || '').slice(0, 40);
        const meta = kindParam === 'taste' ? TASTE_BY_ID[categoryId] : CUISINE_BY_ID[categoryId];
        if (!meta) return send(res, 404, { error: '菜系或口味不存在' });
        const persona = personaForCategory(kindParam, meta.id);
        const contextDish = findDish(url.searchParams.get('contextDishId') || url.searchParams.get('dishId'));
        return send(res, 200, {
          greeting: demoCategoryGreeting({
            kind: kindParam,
            meta,
            persona,
            contextDish,
            dishes: dishesForCategory(kindParam, meta.id),
          }),
          aiConfigured,
          model: aiStatus.model || null,
          provider: aiStatus.provider || null,
          kind: kindParam,
          categoryId: meta.id,
          categoryName: meta.name,
          personaId: persona?.id || null,
        });
      }
      const dish = findDish(url.searchParams.get('dishId'));
      if (!dish) return send(res, 404, { error: '菜品不存在' });
      const persona = personaFor(dish);
      return send(res, 200, {
        greeting: demoGreeting(dish, persona),
        aiConfigured,
        model: aiStatus.model || null,
        provider: aiStatus.provider || null,
      });
    }

    if (req.method === 'POST' && path === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && path === '/api/suggest') return await handleSuggest(req, res);
    if (req.method === 'POST' && path === '/api/recipe/lookup') return await handleRecipeLookup(req, res);
    if (req.method === 'POST' && path === '/api/recipe') return await handleRecipe(req, res);
    if (req.method === 'POST' && path === '/api/recommend') return await handleRecommend(req, res);
    if (req.method === 'GET' && path === '/api/videos/search') {
      const bundle = await searchVideos({
        q: url.searchParams.get('q') || '',
        limit: url.searchParams.get('limit') || undefined,
      });
      return send(res, 200, bundle);
    }
    if (req.method === 'POST' && path === '/api/upload') {
      // 上传只服务社区发图，必须登录；未授权请求不落盘
      if (!sameOrigin(req)) return send(res, 403, { error: '非法请求来源' });
      const user = requireUser(req, res, send, '请先登录后再上传图片');
      if (!user) return;
      const body = await readJson(req);
      const saved = saveImage(body.image, user.id);
      return send(res, saved.ok ? 200 : 400, saved);
    }
    if (req.method === 'POST' && path === '/api/dishes/search') {
      const user = requireUser(req, res, send);
      if (!user) return;
      const ai = getConfigForRequest(user.id);
      if (!ai.ok) return send(res, 409, { error: ai.message, code: ai.code });
      const body = await readJson(req);
      const result = await searchDishes({
        kind: body.kind,
        id: body.id,
        excludeIds: body.excludeIds,
        limit: body.limit,
        modelConfig: ai.config,
      });
      const status = result.status === 'failed' ? 503 : 200;
      return send(res, status, result);
    }
    if (req.method === 'GET' && path === '/api/dishes') {
      const kind = url.searchParams.get('kind') === 'taste' ? 'taste' : url.searchParams.get('kind') === 'cuisine' ? 'cuisine' : '';
      const id = String(url.searchParams.get('id') || '').slice(0, 40);
      const items = generatedDishes().filter((d) => {
        if (!kind || !id) return true;
        // 只有「为这个分类检索出来」的 AI 菜才进入该分类列表，避免早期粗略归类把别的菜系混进来
        return d.source?.requestedKind === kind && d.source?.categoryId === id;
      });
      return send(res, 200, { items: items.slice(0, 120), total: items.length });
    }
    if (req.method === 'GET' && path.startsWith('/api/dishes/')) {
      const id = decodeURIComponent(path.slice('/api/dishes/'.length));
      const dish = findDish(id);
      if (!dish) return send(res, 404, { error: '菜品不存在' });
      return send(res, 200, { dish });
    }
    if (path.startsWith('/api/posts')) return await handlePosts(req, res, url);
    if (path.startsWith('/api/comments')) return await handleComments(req, res, url);

    return send(res, 404, { error: 'not-found' });
  } catch (err) {
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        /* noop */
      }
      return;
    }
    return send(res, 500, { error: String(err.message || err).slice(0, 300) });
  }
}

