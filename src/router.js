import { clear } from './lib/dom.js';
import home from './views/home.js';
import chat from './views/chat.js';
import recipe from './views/recipe.js';
import recommend from './views/recommend.js';
import cuisine from './views/cuisine.js';
import taste from './views/taste.js';
import dishes from './views/dishes.js';
import dishDetail from './views/dish-detail.js';
import community from './views/community.js';
import videos from './views/videos.js';
import notFound from './views/notfound.js';
import admin from './views/admin.js';
import {
  abortTransition,
  fluidTransition,
  isTransitioning,
  tapPulse,
} from './lib/transition.js';

let viewEl = null;
let active = null;
let renderToken = 0;

const ROUTES = [
  { name: 'home', re: /^\/$/, mod: home },
  { name: 'cuisine', re: /^\/cuisines\/([\w-]+)$/, mod: cuisine },
  { name: 'taste', re: /^\/tastes\/([\w-]+)$/, mod: taste },
  { name: 'chatCategory', re: /^\/chat\/(cuisine|taste)\/([\w-]+)$/, mod: chat },
  { name: 'chat', re: /^\/chat\/([\w-]+)$/, mod: chat },
  { name: 'dishes', re: /^\/dishes$/, mod: dishes },
  { name: 'dishDetail', re: /^\/dishes\/([\w-]+)$/, mod: dishDetail },
  { name: 'community', re: /^\/community$/, mod: community },
  { name: 'recipe', re: /^\/recipe$/, mod: recipe },
  { name: 'recommend', re: /^\/recommend$/, mod: recommend },
  { name: 'videos', re: /^\/videos$/, mod: videos },
  { name: 'admin', re: /^\/admin$/, mod: admin },
];

export function normalize(pathname) {
  // 允许传入完整 href（带 ?query / #hash），路由匹配只看 pathname
  const path = String(pathname || '/').split('#')[0].split('?')[0];
  const p = path.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

export function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { ...r, params: m.slice(1) };
  }
  return { name: '404', mod: notFound, params: [] };
}

function scrollToHash(hash) {
  if (!hash) return;
  const el = document.querySelector(hash);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 依据点击来源判断入口方向，决定转场的轻微位移 */
function transitionKind(url, link) {
  if (url.pathname === '/' && normalize(location.pathname) !== '/') return 'back';
  if (link?.closest('.nav')) return 'nav';
  if (link?.closest('.page-head')) return 'back';
  return link?.dataset?.transition || 'auto';
}

/**
 * 页面跳转统一入口：默认播放流体穿梭转场。
 * @returns {boolean} 是否接受了本次跳转（转场进行中的重复点击会被忽略）
 */
export function navigate(to, opts = {}) {
  const url = new URL(to, location.origin);
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    scrollToHash(url.hash);
    return true;
  }
  if (isTransitioning()) return false;
  history.pushState({}, '', url.pathname + url.search + url.hash);
  const kind = opts.kind || transitionKind(url, opts.link);
  transitionRender(kind).catch((err) => {
    console.warn('[navigate]', err);
    render();
  });
  return true;
}

/** 转场/切换完成后把焦点交给新页面的主标题，保证键盘与读屏可用 */
function focusView() {
  if (!viewEl) return;
  const target = viewEl.querySelector('h1') || viewEl;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  try {
    target.focus({ preventScroll: true });
  } catch {
    /* 忽略极少数浏览器不支持 */
  }
}

/** 以转场方式渲染当前位置（目标页面在动画中真实挂载） */
export async function transitionRender(kind = 'auto') {
  const target = location.pathname + location.search + location.hash;
  return fluidTransition({
    kind,
    render: (stage) => mountInto(target, stage),
    commit: (stage, instance) => adopt(stage, instance, target),
  });
}

/** 直接渲染（首次载入、转场失败兜底） */
export async function render() {
  const token = ++renderToken;
  const path = normalize(location.pathname);
  const route = matchRoute(path);

  if (active?.destroy) {
    try {
      active.destroy();
    } catch (err) {
      console.warn('[view destroy]', err);
    }
  }
  active = null;
  clear(viewEl);
  document.body.dataset.route = route.name;

  const instance = await route.mod.mount(viewEl, route.params);
  if (token !== renderToken) {
    instance?.destroy?.();
    return;
  }
  active = instance || null;

  if (location.hash) requestAnimationFrame(() => scrollToHash(location.hash));
  else window.scrollTo(0, 0);
  focusView();
}

/** 把某个路由的视图挂到任意容器（供流体转场做真实预览） */
export async function mountInto(path, container) {
  const route = matchRoute(normalize(path));
  document.body.dataset.route = route.name;
  return route.mod.mount(container, route.params);
}

/** 转场结束：把预览层里的真实 DOM 接管到 #view，并写入历史 */
export function adopt(stage, instance, path) {
  if (active?.destroy) {
    try {
      active.destroy();
    } catch (err) {
      console.warn('[view destroy]', err);
    }
  }
  active = null;
  clear(viewEl);

  const nodes = [...stage.children].filter((el) => el.id !== 'nav-preview');
  nodes.forEach((el) => viewEl.append(el));

  const route = matchRoute(normalize(path));
  document.body.dataset.route = route.name;
  const want = String(path || '').split('#')[0];
  if (location.pathname + location.search !== want) {
    history.pushState({}, '', path);
  }
  active = instance || null;
  window.scrollTo(0, 0);
  focusView();
}

export function initRouter(el) {
  viewEl = el;
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    if (isTransitioning()) return;
    tapPulse(link);
    navigate(url.pathname + url.search + url.hash, { link });
  });
  window.addEventListener('popstate', () => {
    // 浏览器前进/后退：同样使用转场，返回首页用更轻的反向过渡
    if (isTransitioning()) {
      abortTransition();
      render();
      return;
    }
    const kind = normalize(location.pathname) === '/' ? 'back' : 'auto';
    transitionRender(kind).catch((err) => {
      console.warn('[popstate]', err);
      render();
    });
  });
  render();
}

export function currentView() {
  return active;
}
