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

/**
 * AI 推荐专用暖色美食占位图。
 * 不使用黑色背景，也不写「图片待补」；每道菜仍有一张按菜名生成的独立图。
 */
export function recommendationPlaceholder(name = '中国菜') {
  const key = `recommendation|${name}`;
  if (cache.has(key)) return cache.get(key);
  const title = esc(String(name || '中国菜').slice(0, 18));
  const fontSize = title.length > 9 ? 27 : title.length > 6 ? 31 : 36;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 680" width="600" height="680">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0.9" y2="1">` +
    `<stop offset="0" stop-color="#fbf4e7"/><stop offset="0.55" stop-color="#f3e4cf"/><stop offset="1" stop-color="#e8d3b7"/>` +
    `</linearGradient>` +
    `<radialGradient id="warm" cx="0.5" cy="0.42" r="0.55">` +
    `<stop offset="0" stop-color="#fffaf0" stop-opacity="0.95"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="bowl" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#b96043"/><stop offset="1" stop-color="#8f432f"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="600" height="680" fill="url(#bg)"/>` +
    `<rect width="600" height="680" fill="url(#warm)"/>` +
    `<circle cx="300" cy="298" r="152" fill="#fffdf7" fill-opacity="0.68"/>` +
    `<circle cx="300" cy="298" r="128" fill="none" stroke="#c99a62" stroke-opacity="0.3" stroke-width="1.4"/>` +
    `<ellipse cx="300" cy="360" rx="150" ry="78" fill="#d9b184" fill-opacity="0.22"/>` +
    `<path d="M190 306q110-54 220 0-12 74-110 74t-110-74Z" fill="url(#bowl)"/>` +
    `<ellipse cx="300" cy="306" rx="110" ry="33" fill="#f4d7a8"/>` +
    `<ellipse cx="300" cy="306" rx="94" ry="25" fill="#e8b36b" fill-opacity="0.65"/>` +
    `<g fill="#7f9a62">` +
    `<ellipse cx="264" cy="300" rx="18" ry="10" transform="rotate(-18 264 300)"/>` +
    `<ellipse cx="330" cy="311" rx="17" ry="9" transform="rotate(20 330 311)"/>` +
    `<ellipse cx="304" cy="290" rx="14" ry="8" transform="rotate(-6 304 290)"/>` +
    `</g>` +
    `<g fill="#d8843c" fill-opacity="0.88">` +
    `<circle cx="280" cy="315" r="7"/><circle cx="320" cy="296" r="6"/><circle cx="346" cy="316" r="5"/>` +
    `</g>` +
    `<g stroke="#b98754" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.52">` +
    `<path d="M250 244c-13-18 13-27 0-45"/><path d="M300 234c-13-18 13-27 0-45"/><path d="M350 244c-13-18 13-27 0-45"/>` +
    `</g>` +
    `<g stroke="#9a6b43" stroke-width="5" stroke-linecap="round" opacity="0.72">` +
    `<path d="M412 358l74-54"/><path d="M424 372l74-54"/>` +
    `</g>` +
    `<text x="300" y="478" text-anchor="middle" fill="#5f3b27" font-family="'Songti SC','Noto Serif SC',serif" ` +
    `font-size="${fontSize}" letter-spacing="3">${title}</text>` +
    `<text x="300" y="514" text-anchor="middle" fill="#9a7756" font-family="system-ui,'PingFang SC','Microsoft YaHei',sans-serif" ` +
    `font-size="13" letter-spacing="5">AI 寻味配图</text>` +
    `<text x="300" y="626" text-anchor="middle" fill="#b28b61" fill-opacity="0.7" ` +
    `font-family="system-ui,'PingFang SC','Microsoft YaHei',sans-serif" font-size="11" letter-spacing="6">FOOD SOUL</text>` +
    `</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

/** 推荐图片加载失败：切暖色占位图，并通知卡片更新状态。 */
export function guardRecommendationImage(img, name, onFallback) {
  img.addEventListener('error', () => {
    const retrySource = img.getAttribute('src') || '';
    const retries = Number(img.dataset.imageRetries || '0');
    const canRetry = retrySource.startsWith('/') && retries < 2;
    if (canRetry) {
      img.dataset.imageRetries = String(retries + 1);
      // 部分静态服务在图片刚写入时会短暂回退到 HTML，隔一次事件循环再取，
      // 加查询参数绕开中间层缓存；两次仍失败才使用暖色占位图。
      window.setTimeout(() => {
        img.src = `${retrySource}${retrySource.includes('?') ? '&' : '?'}_r=${Date.now()}`;
      }, 160 + retries * 260);
      return;
    }
    img.dataset.placeholder = '1';
    img.dataset.imageFallback = '1';
    img.src = recommendationPlaceholder(name);
    if (typeof onFallback === 'function') onFallback();
  });
  return img;
}
