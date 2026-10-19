/* 极小的 DOM 工具，避免引入框架 */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function html(strings, ...values) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String.raw(strings, ...values).trim();
  return tpl.content.firstElementChild;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 轻量切换过渡：先淡出，再替换内容，再淡入 */
export function swap(el, render, ms = 160) {
  el.classList.add('is-swapping');
  window.setTimeout(() => {
    render();
    el.classList.remove('is-swapping');
  }, ms);
}

export function toast(message, kind = 'ok') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = h('div', { id: 'toast-host', class: 'toast-host' });
    document.body.append(host);
  }
  const item = h('div', { class: `toast toast--${kind}`, text: message });
  host.append(item);
  requestAnimationFrame(() => item.classList.add('is-in'));
  window.setTimeout(() => {
    item.classList.remove('is-in');
    window.setTimeout(() => item.remove(), 400);
  }, 2600);
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
