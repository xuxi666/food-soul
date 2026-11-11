/**
 * 全站「生成菜谱」统一导航
 * ------------------------------------------------------------
 * 所有「生成菜谱 / 生成结构化菜谱 / 查看做法」入口都从这里进来，
 * 入口本身不再各写一套跳转逻辑（不各自拼 URL、不各自改地址）。
 *
 * 一次导航 = 一个任务（payload），流程固定：
 *   1. 入口调用 navigateToRecipeModule(dishInfo)
 *   2. 这里做数据标准化（菜名优先用正式中文名，英文名不覆盖中文名）
 *   3. 任务写进 pending（最后一次点击生效）并落一份到 sessionStorage
 *   4. 交给画册执行真实翻页（书由 index.js 注册的 navigator 负责）
 *   5. 落地后画册派发 foodsoul:recipe-nav 事件，菜谱模块 consume 一次并回填
 *
 * 一次性消费：consume 之后 pending 与 sessionStorage 同时清空，
 * 因此「普通进入菜谱模块」「刷新页面」都不会重复回填旧菜名。
 *
 * 这个模块不 import 画册，画册反过来 import 它 —— 依赖是单向的，不会成环。
 */
import { DISH_BY_ID, DISHES } from '../data/dishes.js';

/** 画册落地后派发的事件名：菜谱模块监听它回填表单 */
export const RECIPE_NAV_EVENT = 'foodsoul:recipe-nav';
/** 菜谱模块的地址（章节注册信息里的 href 也是它） */
export const RECIPE_PATH = '/recipe';

const STORE_KEY = 'foodsoul:recipe-nav-pending';
const NAME_MAX = 30;
const LOG_MAX = 24;

/** 当前待消费任务：只保留最后一次点击 */
let pending = null;
/** 画册注册的导航实现（翻页 / 开书），由 book/index.js 注入 */
let navigator = null;
let seq = 0;
const logList = [];

function note(level, message, extra = null) {
  const item = { at: new Date().toISOString(), level, message, extra };
  logList.push(item);
  if (logList.length > LOG_MAX) logList.shift();
  if (level === 'warn') console.warn('[recipe-nav]', message, extra || '');
  return item;
}

/* ---------------- 数据标准化 ---------------- */

/** 去掉首尾空白、全角空格、成对引号，以及结尾的括号补充说明（「剁椒鱼头（湘菜）」→「剁椒鱼头」） */
export function normalizeDishName(raw) {
  let s = String(raw ?? '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
  s = s.replace(/\s*[（(][^（）()]{0,24}[)）]\s*$/g, '').trim();
  s = s.replace(/^[「『“"']+/g, '').replace(/[」』”"']+$/g, '').trim();
  return s.slice(0, NAME_MAX);
}

function normalizeEnglish(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 60) : null;
}

/**
 * 菜名优先级：正式中文名（图鉴数据）→ 传入的中文名（标准化后）→ 原始名。
 * 英文名永远不参与覆盖：它只在没有中文名时作为上下文保留，不写进输入框。
 */
export function resolveDishName({ dishId, dishName, rawName } = {}) {
  const id = String(dishId ?? '').trim();
  const byId = id ? DISH_BY_ID[id] : null;
  if (byId?.name) return byId.name;

  const given = normalizeDishName(dishName);
  if (given) {
    const known = DISHES.find((d) => d.name === given);
    return known ? known.name : given;
  }

  const raw = normalizeDishName(rawName);
  if (raw) {
    const known = DISHES.find((d) => d.name === raw);
    return known ? known.name : raw;
  }

  return '';
}

/* ---------------- 任务（一次性消费） ---------------- */

function persist(payload) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch {
    /* 隐私模式 / 配额不足：只走内存，功能不受影响 */
  }
}

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function dropStored() {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 看一眼当前任务，但不消费 */
export function peekRecipeNav() {
  return pending || readStored();
}

/**
 * 消费当前任务（菜谱模块挂载后调用）。
 * @param {string} [navigationId] 只接受这一条任务（落地回调用它，避免旧任务盖掉新点击）
 * @returns {object|null} 被消费的任务；已被更新点击取代时返回 null，且不会动新任务
 */
export function consumeRecipeNav(navigationId) {
  const task = pending || readStored();
  if (!task) return null;
  if (navigationId && task.navigationId !== navigationId) return null;
  if (pending && task === pending) pending = null;
  dropStored();
  return task;
}

/** 丢弃任务（切走 / 出错时用） */
export function clearRecipeNav() {
  pending = null;
  dropStored();
}

/** 画册注册真实翻页实现 */
export function setRecipeNavigator(fn) {
  navigator = typeof fn === 'function' ? fn : null;
}

/** 任务 → 菜谱模块地址（刷新 / 分享 / 独立页整页进入都靠它） */
export function recipeHref(payload) {
  const q = new URLSearchParams();
  if (payload?.dishId) q.set('dish', payload.dishId);
  if (payload?.dishName) q.set('name', payload.dishName);
  if (payload?.sourceType) q.set('from', payload.sourceType);
  const s = q.toString();
  return s ? `${RECIPE_PATH}?${s}` : RECIPE_PATH;
}

/** 由入口给的零散信息组装标准任务 */
export function createRecipeNav(input = {}) {
  const dishName = resolveDishName(input);
  const sourcePage = String(input.sourcePage || (typeof location !== 'undefined' ? location.pathname : '') || 'unknown');
  const payload = {
    navigationId: `rn-${Date.now().toString(36)}-${(seq += 1).toString(36)}`,
    dishId: String(input.dishId ?? '').trim() || null,
    dishName: dishName || null,
    englishName: normalizeEnglish(input.englishName),
    sourcePage,
    sourceType: String(input.sourceType || 'unknown'),
    rawName: normalizeDishName(input.rawName ?? input.dishName) || null,
    /* 入口可附带的上下文（例如 Chat 的对话主题、厨房的食材方向），不参与菜名判定 */
    recipeContext: input.recipeContext && typeof input.recipeContext === 'object' ? input.recipeContext : null,
    createdAt: new Date().toISOString(),
  };
  return payload;
}

/**
 * 全站唯一入口：点「生成菜谱」就调它。
 * @param {{dishId?:string, dishName?:string, englishName?:string, sourcePage?:string, sourceType?:string, rawName?:string}} input
 * @returns {object} 本次导航任务
 */
export function navigateToRecipeModule(input = {}) {
  const payload = createRecipeNav(input);
  if (!payload.dishName) {
    note('warn', '入口没有拿到可用的中文菜名：只翻到菜谱模块，不预填', {
      dishId: payload.dishId,
      sourceType: payload.sourceType,
      sourcePage: payload.sourcePage,
      englishName: payload.englishName,
    });
  }

  /* 连续点击不同菜品：只保留最后一次，前一条会在消费时被 navigationId 挡掉 */
  if (pending && pending.navigationId !== payload.navigationId) {
    note('info', '新的导航任务取代了尚未消费的旧任务', {
      dropped: pending.dishName,
      replacedBy: payload.dishName,
    });
  }
  pending = payload;
  persist(payload);
  note('info', `菜谱导航：${payload.dishName || '（无菜名）'}`, {
    navigationId: payload.navigationId,
    sourceType: payload.sourceType,
  });

  const bookLive = typeof document !== 'undefined' && !!document.querySelector('.bk-sheet');
  if (navigator && bookLive) {
    navigator(payload); /* 画册真实翻页 */
  } else if (typeof location !== 'undefined') {
    /* 画册不在当前 DOM（AI 聊天等独立页）：整页进入，书启动后按任务开书并回填 */
    note('info', '画册不在当前 DOM，改为整页进入菜谱模块', { href: recipeHref(payload) });
    location.assign(recipeHref(payload));
  }
  return payload;
}

/** 诊断：最近的任务与告警（验收 / 排查用） */
export function recipeNavLog() {
  return logList.slice();
}

if (typeof window !== 'undefined') {
  window.__recipeNav = {
    navigate: navigateToRecipeModule,
    peek: peekRecipeNav,
    consume: consumeRecipeNav,
    clear: clearRecipeNav,
    href: recipeHref,
    log: recipeNavLog,
    event: RECIPE_NAV_EVENT,
  };
}