// 首页动态美食墙验收：密排网格、奇偶反向无缝循环、画册不被遮罩覆盖、纵深柔化、层级与性能
// 用法：node scripts/verify-wall.mjs            （默认 http://127.0.0.1:5190）
//       BASE=https://... node scripts/verify-wall.mjs
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5190';

const results = [];
const check = (n, pass, extra = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

/* ---------------- 极简 PNG 解码（够读浏览器截图：8 位 RGB/RGBA、非隔行） ---------------- */
function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.from(line);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) cur[x] = (cur[x] + a) & 0xff;
      else if (filter === 2) cur[x] = (cur[x] + b) & 0xff;
      else if (filter === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  const at = (x, y) => {
    const i = y * stride + x * bpp;
    return [out[i], out[i + 1], out[i + 2]];
  };
  const box = (x0, y0, x1, y1) => {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const [r, g, b] = at(x, y);
        sum += 0.299 * r + 0.587 * g + 0.114 * b;
        n += 1;
      }
    }
    return sum / n;
  };
  /** 横向梯度均值：越大越锐 */
  const sharp = (x0, y0, x1, y1) => {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1 - 1; x += 1) {
        const [r1, g1, b1] = at(x, y);
        const [r2, g2, b2] = at(x + 1, y);
        sum += Math.abs(0.299 * r1 + 0.587 * g1 + 0.114 * b1 - (0.299 * r2 + 0.587 * g2 + 0.114 * b2));
        n += 1;
      }
    }
    return sum / n;
  };
  return { w, h, at, box, sharp };
}

const shot = async (page, path) => decodePng(await page.screenshot({ path }));

const WALL_STATE = () => {
  const rows = [...document.querySelectorAll('.bk-wall__row')];
  const tracks = [...document.querySelectorAll('.bk-wall__track')];
  const sets = [...document.querySelectorAll('.bk-wall__set')];
  const imgs = [...document.querySelectorAll('.bk-wall__img')];
  const firstRowCards = rows[0] ? [...rows[0].querySelectorAll('.bk-wall__set')[0].querySelectorAll('.bk-wall__card')] : [];
  const c0 = firstRowCards[0]?.getBoundingClientRect();
  const c1 = firstRowCards[1]?.getBoundingClientRect();
  const row0 = rows[0]?.getBoundingClientRect();
  const row1 = rows[1]?.getBoundingClientRect();
  return {
    vw: innerWidth,
    vh: innerHeight,
    rows: rows.length,
    rowSum: Math.round(rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0)),
    tracks: tracks.map((t) => ({
      dir: t.className.includes('--right') ? 'right' : 'left',
      dur: parseFloat(getComputedStyle(t).animationDuration),
      delay: getComputedStyle(t).animationDelay,
    })),
    setW: sets[0] ? Math.round(sets[0].getBoundingClientRect().width) : 0,
    ratio: sets[0] ? +(tracks[0].getBoundingClientRect().width / sets[0].getBoundingClientRect().width).toFixed(3) : 0,
    perRow: firstRowCards.length,
    cards: document.querySelectorAll('.bk-wall__card').length,
    imgs: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    uniq: new Set(imgs.map((i) => i.getAttribute('src')).filter(Boolean)).size,
    gapX: c0 && c1 ? Math.round(c1.x - (c0.x + c0.width)) : -1,
    gapY: row0 && row1 ? Math.round(row1.top - row0.bottom) : -1,
    cardInRow: row0 && c0 ? Math.round((row0.height - c0.height) / 2) : -1,
    cardRatio: c0 ? +(c0.width / c0.height).toFixed(2) : 0,
    cardRadius: document.querySelector('.bk-wall__card') ? getComputedStyle(document.querySelector('.bk-wall__card')).borderRadius : '',
    pointer: getComputedStyle(document.querySelector('.bk-wall')).pointerEvents,
    allPointerNone: ['.bk-wall', '.bk-wall__veil', '.bk-wall__blur', '.bk-wall__glow'].every(
      (s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).pointerEvents === 'none'
    ),
    cameraZ: +(getComputedStyle(document.querySelector('.bk-camera')).zIndex) || 0,
    veilZ: +(getComputedStyle(document.querySelector('.bk-wall__veil')).zIndex) || 0,
    overflowX: document.documentElement.scrollWidth - innerWidth,
  };
};

const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
const open = async (viewport = { width: 1440, height: 900 }) => {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 160));
  });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(4200);
  return p;
};

/* ================= 桌面：几何与密度 ================= */
const p = await open();
const d = await p.evaluate(WALL_STATE);

check('背景铺满整屏、无横向溢出', d.rowSum >= d.vh - 2 && d.overflowX <= 0, `rows=${d.rows} rowSum=${d.rowSum}/${d.vh} overflowX=${d.overflowX}`);
check('桌面行数 6~9（铺到顶底）', d.rows >= 6 && d.rows <= 9, `${d.rows} 行 · 每行 ${Math.round(d.rowSum / d.rows)}px`);
check('每行至少 8 张、横向连续', d.perRow >= 8, `每行 ${d.perRow} 张`);
check('水平间距 ≤ 8px', d.gapX >= 0 && d.gapX <= 8, `gapX=${d.gapX}px`);
check('垂直间距 ≤ 8px', d.gapY >= 0 && d.gapY + d.cardInRow * 2 <= 8, `rowGap=${d.gapY}px + 行内留白 ${d.cardInRow * 2}px`);
check('卡片统一 1.5:1 且有圆角', d.cardRatio >= 1.45 && d.cardRatio <= 1.55 && /px/.test(d.cardRadius), `${d.cardRatio}:1 radius=${d.cardRadius}`);
check('奇数行向右、偶数行向左', d.tracks.every((t, i) => t.dir === (i % 2 === 0 ? 'right' : 'left')), d.tracks.map((t) => t.dir).join(','));
check('每行周期 25~60s 且互不相同', d.tracks.every((t) => t.dur >= 25 && t.dur <= 60) && new Set(d.tracks.map((t) => t.dur)).size === d.tracks.length, d.tracks.map((t) => t.dur + 's').join(','));
check('相邻行相位错开', new Set(d.tracks.map((t) => t.delay)).size === d.tracks.length, d.tracks.map((t) => t.delay).join(','));
check('轨道 = 两段相同内容，-50% 正好一段', d.ratio === 2, `ratio=${d.ratio} setW=${d.setW}`);
check('每段宽度 ≥ 视口宽（循环处无空白）', d.setW >= d.vw, `${d.setW} ≥ ${d.vw}`);
check('图片够多且不重复发牌（唯一 ≥ 55）', d.uniq >= 55, `唯一 ${d.uniq} 张 / 共 ${d.imgs} 个`);
check('所有图片加载成功、无破图', d.loaded === d.imgs && d.broken === 0, `${d.loaded}/${d.imgs}`);
check('背景不拦截鼠标', d.allPointerNone && d.pointer === 'none');
check('画册层级高于遮罩层（camera > veil）', d.cameraZ > d.veilZ, `camera=${d.cameraZ} veil=${d.veilZ}`);

/* ================= 运动：单调、无缝、有速度差 ================= */
const motion = await p.evaluate(async () => {
  const tracks = [...document.querySelectorAll('.bk-wall__track')];
  const read = () => tracks.map((t) => new DOMMatrixReadOnly(getComputedStyle(t).transform).m41);
  const samples = [];
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => {
      samples.push(read());
      if (performance.now() - t0 < 1800) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  return {
    frames: samples.length,
    perTrack: tracks.map((_, i) => {
      const ds = [];
      for (let k = 1; k < samples.length; k += 1) ds.push(samples[k][i] - samples[k - 1][i]);
      return {
        moved: Math.abs(samples[samples.length - 1][i] - samples[0][i]) > 3,
        sameSign: ds.every((v) => v >= -0.01) || ds.every((v) => v <= 0.01),
        maxStep: +Math.max(...ds.map(Math.abs)).toFixed(2),
        speed: +Math.abs(samples[samples.length - 1][i] - samples[0][i]).toFixed(1),
      };
    }),
  };
});
check('每行都在动、方向单调无回跳', motion.perTrack.every((t) => t.moved && t.sameSign), `帧数 ${motion.frames}`);
check('无跳帧级瞬移（单帧 < 6px）', motion.perTrack.every((t) => t.maxStep < 6), motion.perTrack.map((t) => t.maxStep).join(','));
check('各行速度有差异', new Set(motion.perTrack.map((t) => t.speed)).size >= 4, motion.perTrack.map((t) => t.speed).join(','));

/* ================= 像素级：遮罩只作用背景，画册干净 ================= */
await p.addStyleTag({ content: '.bk-wall__track{animation-play-state:paused!important}' });
await p.waitForTimeout(250);
const withVeil = await shot(p, '.tmp/wall/70-with-veil.png');
await p.addStyleTag({ content: '.bk-wall__veil{display:none!important}' });
await p.waitForTimeout(250);
const noVeil = await shot(p, '.tmp/wall/71-no-veil.png');
await p.evaluate(() => document.querySelectorAll('style').forEach((s) => {
  if (s.textContent.includes('.bk-wall__veil{display:none')) s.remove();
}));
await p.waitForTimeout(200);

const cover = await p.evaluate(() => {
  const r = document.querySelector('.bk-cover').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
const nearBox = [cover.x + cover.w + 8, cover.y + 120, cover.x + cover.w + 78, cover.y + cover.h - 120];
const farBox = [withVeil.w - 140, 300, withVeil.w - 20, 700];
const nearD = withVeil.box(...nearBox) - noVeil.box(...nearBox);
const farD = withVeil.box(...farBox) - noVeil.box(...farBox);
const nearRatio = withVeil.sharp(...nearBox) / noVeil.sharp(...nearBox);
check('画册附近有柔化（亮度抬升 4~45、锐度降 5%~45%）', nearD > 4 && nearD < 45 && nearRatio > 0.55 && nearRatio < 0.95, `Δ亮度=${nearD.toFixed(1)} 锐度比=${nearRatio.toFixed(2)}`);
check('外围背景保持清晰（Δ亮度 < 8）', Math.abs(farD) < 8, `Δ=${farD.toFixed(1)}`);

/* ================= 打开后：书在最上层、背景退后 ================= */
await p.locator('.bk-cover').click();
await p.waitForTimeout(3200);

// 画册本体不被任何层染色：给遮罩上红，书页必须还是纸色
const pageBoxes = await p.evaluate(() => {
  const faces = [...document.querySelectorAll('.bk-sheet__face')].filter((e) => e.getBoundingClientRect().width > 300);
  return faces.slice(0, 2).map((f) => {
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
await p.addStyleTag({ content: '.bk-wall__veil{background:rgba(255,0,0,.65)!important} .bk-wall__glow{opacity:0!important}' });
await p.waitForTimeout(350);
const red = await shot(p, '.tmp/wall/72-red-veil.png');
const blocks = [];
for (const pb of pageBoxes) {
  blocks.push([pb.x + 30, Math.round(pb.y + pb.h / 2) - 15]);
  blocks.push([Math.round(pb.x + pb.w / 2) - 15, pb.y + pb.h - 70]);
}
const samples = blocks.map(([bx, by]) => red.at(bx + 15, by + 15));
const bookClean = samples.every(([r, g, b2]) => g > 150 && b2 > 140 && r - g < 45);
check('画册不被遮罩/柔光覆盖（书页仍是纸色）', bookClean, '纸面采样 ' + JSON.stringify(samples));
const opened = await p.evaluate(() => ({
  mode: window.__book.mode,
  wallOpacity: +getComputedStyle(document.querySelector('.bk-wall')).opacity,
  contentLen: (document.querySelector('.bk-content')?.innerText || '').length,
}));
check('翻开后背景降存在感且仍在', opened.wallOpacity > 0.4 && opened.wallOpacity < 0.8 && opened.mode === 'open', `opacity=${opened.wallOpacity}`);
check('书页内容完整', opened.contentLen > 100, `${opened.contentLen} 字`);
await p.screenshot({ path: '.tmp/wall/73-open.png' });

await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1100);
const turned = await p.evaluate(() => ({ spread: window.__book.spread }));
await p.locator('.bk-back').click();
await p.waitForTimeout(2400);
const closed = await p.evaluate(() => ({ mode: window.__book.mode, opacity: +getComputedStyle(document.querySelector('.bk-wall')).opacity }));
check('翻页 / 合上不受背景影响', turned.spread > 0 && closed.mode === 'closed' && closed.opacity > 0.95, `spread=${turned.spread}`);
await p.screenshot({ path: '.tmp/wall/74-closed.png' });
await p.close();

/* ================= 适配：1920 / 平板 / 手机 ================= */
for (const [label, w, h, minRows, maxRows, minPerRow] of [
  ['1920', 1920, 1080, 6, 9, 8],
  ['平板 834', 834, 1112, 4, 6, 4],
  ['手机 390', 390, 844, 3, 5, 3],
]) {
  const vp = await open({ width: w, height: h });
  const s = await vp.evaluate(WALL_STATE);
  check(`${label}：行数 ${minRows}~${maxRows}、间距紧凑、无溢出`, s.rows >= minRows && s.rows <= maxRows && s.gapX <= 8 && s.setW >= s.vw && s.overflowX <= 0, `rows=${s.rows} 每行=${s.perRow} gapX=${s.gapX} setW=${s.setW}/${s.vw}`);
  check(`${label}：奇偶反向且 1.5:1`, s.tracks.every((t, i) => t.dir === (i % 2 === 0 ? 'right' : 'left')) && s.cardRatio >= 1.45 && s.cardRatio <= 1.55, s.tracks.map((t) => t.dir).join(','));
  await vp.screenshot({ path: `.tmp/wall/75-${label.replace(/\s/g, '')}.png` });
  await vp.close();
}

/* ================= 缩放重建 ================= */
const rs = await open();
const resizeOut = [];
for (const [w, h] of [[900, 620], [1920, 1080], [1440, 900]]) {
  await rs.setViewportSize({ width: w, height: h });
  await rs.waitForTimeout(700);
  const s = await rs.evaluate(WALL_STATE);
  resizeOut.push(`${w}x${h}:${s.rows}行${s.setW >= s.vw && s.ratio === 2 ? '✓' : '✗'}`);
}
check('窗口缩放后轨道重建、不留空隙', resizeOut.every((r) => r.endsWith('✓')), resizeOut.join(' '));

const paused = await rs.evaluate(async () => {
  const wall = document.querySelector('.bk-wall');
  const x = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.bk-wall__track')).transform).m41;
  wall.classList.add('is-paused');
  const a = x();
  await new Promise((r) => setTimeout(r, 600));
  const b2 = x();
  wall.classList.remove('is-paused');
  return Math.abs(b2 - a);
});
check('页面隐藏时动画停住', paused < 2, `Δ=${paused.toFixed(2)}px`);
await rs.close();

/* ================= reduced motion / 体积 / 报错 ================= */
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const rp = await ctx.newPage();
await rp.goto(BASE + '/', { waitUntil: 'load' });
await rp.waitForTimeout(1600);
const rm = await rp.evaluate(async () => {
  const x = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.bk-wall__track')).transform).m41;
  const a = x();
  await new Promise((r) => setTimeout(r, 700));
  return { name: getComputedStyle(document.querySelector('.bk-wall__track')).animationName, delta: Math.abs(x() - a), cards: document.querySelectorAll('.bk-wall__card').length };
});
check('prefers-reduced-motion 下静止但网格仍在', rm.name === 'none' && rm.delta < 2 && rm.cards > 0, `Δ=${rm.delta.toFixed(1)} cards=${rm.cards}`);
await ctx.close();

const net = await open();
const bytes = await net.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/wall/')).reduce((a, e) => a + (e.transferSize || 0), 0));
const longTasks = await net.evaluate(() => new Promise((res) => {
  const list = [];
  try {
    const obs = new PerformanceObserver((l) => list.push(...l.getEntries().map((e) => Math.round(e.duration))));
    obs.observe({ type: 'longtask', buffered: true });
    setTimeout(() => { obs.disconnect(); res(list); }, 1200);
  } catch { res([]); }
}));
check('背景图总体积 < 2MB', bytes > 0 && bytes < 2 * 1024 * 1024, `${Math.round(bytes / 1024)} KB`);
check('无长任务阻塞（>50ms 的 ≤ 2 个）', longTasks.filter((t) => t > 50).length <= 2, longTasks.join(',') || '无');
await net.close();

check('没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' / '));

await b.close();
const pass = results.filter(Boolean).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);