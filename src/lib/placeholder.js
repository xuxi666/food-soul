/**
 * 图片兜底：每道菜生成一张独立的占位图（深色 + 菜名），
 * 保证不同菜品即使图片加载失败也不会共用同一张图。
 */
const cache = new Map();

const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function dishPlaceholder(name = '中国菜', sub = '图片暂不可用') {
  const key = `${name}|${sub}`;
  if (cache.has(key)) return cache.get(key);
  const title = esc(name);
  const note = esc(sub);
  const fontSize = title.length > 6 ? 34 : 42;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 780" width="600" height="780">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#12141c"/><stop offset="0.55" stop-color="#1b1e28"/><stop offset="1" stop-color="#0b0d12"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.38" r="0.6">` +
    `<stop offset="0" stop-color="#d8b26a" stop-opacity="0.18"/><stop offset="1" stop-color="#d8b26a" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="600" height="780" fill="url(#bg)"/>` +
    `<rect width="600" height="780" fill="url(#glow)"/>` +
    `<circle cx="300" cy="330" r="96" fill="none" stroke="#d8b26a" stroke-opacity="0.28" stroke-width="1.5"/>` +
    `<circle cx="300" cy="330" r="64" fill="none" stroke="#d8b26a" stroke-opacity="0.16" stroke-width="1"/>` +
    `<text x="300" y="330" text-anchor="middle" dominant-baseline="middle" fill="#d8b26a" fill-opacity="0.85" ` +
    `font-family="'Songti SC','Noto Serif SC',serif" font-size="30" letter-spacing="6">${title.slice(0, 4)}</text>` +
    `<text x="300" y="486" text-anchor="middle" fill="#f4f1ea" font-family="'Songti SC','Noto Serif SC',serif" ` +
    `font-size="${fontSize}" letter-spacing="4">${title}</text>` +
    `<text x="300" y="524" text-anchor="middle" fill="#f4f1ea" fill-opacity="0.42" ` +
    `font-family="system-ui,'PingFang SC','Microsoft YaHei',sans-serif" font-size="15" letter-spacing="3">${note}</text>` +
    `<text x="300" y="700" text-anchor="middle" fill="#d8b26a" fill-opacity="0.4" ` +
    `font-family="system-ui,'PingFang SC','Microsoft YaHei',sans-serif" font-size="12" letter-spacing="6">FOOD SOUL</text>` +
    `</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

/** 给 img 挂兜底：加载失败时换成该菜品专属占位图，只触发一次 */
export function guardImage(img, name, sub) {
  img.addEventListener(
    'error',
    () => {
      img.src = dishPlaceholder(name, sub);
    },
    { once: true }
  );
  return img;
}
