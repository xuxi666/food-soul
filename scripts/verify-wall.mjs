// 首页动态美食墙验收：多行网格、奇偶反向、无缝循环、纵深模糊、层级与交互、性能与适配
// 用法：node scripts/verify-wall.mjs            （默认 http://127.0.0.1:5190）
//       BASE=https://... node scripts/verify-wall.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5190';
const SPEC = { rowsPC: [5, 7], rowsTablet: [4, 6], rowsPhone: [3, 4], durs: [25, 60] };

const results = [];
const check = (n, pass, extra = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

/** 读背景墙的整体状态 */
const WALL_STATE = () => {
  const rows = [...document.querySelectorAll('.bk-wall__row')];
  const tracks = [...document.querySelectorAll('.bk-wall__track')];
  const sets = [...document.querySelectorAll('.bk-wall__set')];
  const imgs = [...document.querySelectorAll('.bk-wall__img')];
  const card = document.querySelector('.bk-wall__card');
  const cr = card ? card.getBoundingClientRect() : null;
  return {
    vw: innerWidth,
    vh: innerHeight,
    rows: rows.length,
    rowSum: Math.round(rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0)),
    tracks: tracks.map((t) => ({
      dir: t.className.includes('--right') ? 'right' : 'left',
      dur: parseFloat(getComputedStyle(t).animationDuration),
      name: getComputedStyle(t).animationName,
      delay: getComputedStyle(t).animationDelay,
    })),
    setW: sets[0] ? Math.round(sets[0].getBoundingClientRect().width) : 0,
    ratio: sets[0] ? +(tracks[0].getBoundingClientRect().width / sets[0].getBoundingClientRect().width).toFixed(3) : 0,
    perRow: sets[0] ? sets[0].querySelectorAll('.bk-wall__card').length : 0,
    cards: document.querySelectorAll('.bk-wall__card').length,
    imgs: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    uniq: new Set(imgs.map((i) => i.getAttribute('src')).filter(Boolean)).size,
    cardRatio: cr ? +(cr.width / cr.height).toFixed(2) : 0,
    pointer: getComputedStyle(document.querySelector('.bk-wall')).pointerEvents,
    z: getComputedStyle(document.querySelector('.bk-wall')).zIndex,
    allPointerNone: ['.bk-wall', '.bk-wall__veil', '.bk-wall__blur', '.bk-wall__glow'].every(
      (s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).pointerEvents === 'none'
    ),
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

/* ---------- 桌面 ---------- */
const p = await open();
const d = await p.evaluate(WALL_STATE);

check('背景墙铺满整屏、无横向溢出', d.rowSum >= d.vh - 2 && (await p.evaluate(() => document.documentElement.scrollWidth)) <= d.vw, `rows=${d.rows} rowSum=${d.rowSum}/${d.vh}`);
check('桌面行数在 5~7 行', d.rows >= SPEC.rowsPC[0] && d.rows <= SPEC.rowsPC[1], `${d.rows} 行`);
check('奇数行向右、偶数行向左', d.tracks.every((t, i) => t.dir === (i % 2 === 0 ? 'right' : 'left')), d.tracks.map((t) => t.dir).join(','));
check('每行周期 25~60s 且互不相同', d.tracks.every((t) => t.dur >= SPEC.durs[0] && t.dur <= SPEC.durs[1]) && new Set(d.tracks.map((t) => t.dur)).size === d.tracks.length, d.tracks.map((t) => t.dur + 's').join(','));
check('相邻行起相位错开（delay 不同）', new Set(d.tracks.map((t) => t.delay)).size === d.tracks.length, d.tracks.map((t) => t.delay).join(','));
check('轨道 = 两段相同内容，-50% 正好一段', d.ratio === 2, `ratio=${d.ratio} setW=${d.setW}`);
check('每段宽度 ≥ 视口宽（循环处无空白）', d.setW >= d.vw, `${d.setW} ≥ ${d.vw}`);
check('卡片比例约 1.5:1、无文字', d.cardRatio >= 1.45 && d.cardRatio <= 1.55 && (await p.evaluate(() => !document.querySelector('.bk-wall').innerText.trim())), `${d.cardRatio}:1`);
check('图片不重复填坑（唯一图 ≥ 30 张）', d.uniq >= 30, `唯一 ${d.uniq} 张 / 共 ${d.imgs} 张`);
check('所有图片加载成功、无破图', d.loaded === d.imgs && d.broken === 0, `${d.loaded}/${d.imgs} broken=${d.broken}`);
check('背景不拦截鼠标（pointer-events: none）', d.allPointerNone && d.pointer === 'none', `wall=${d.pointer}`);
check('画册在背景之上（层级正确）', await p.evaluate(() => {
  const cover = document.querySelector('.bk-cover').getBoundingClientRect();
  const el = document.elementFromPoint(cover.x + cover.width / 2, cover.y + cover.height / 2);
  return !!el && !!el.closest('.bk-cover');
}), '书页中心命中的是封面');

/* 运动学：逐帧采样 transform，检查方向单调、无跳变 */
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
  const perTrack = tracks.map((_, i) => {
    const ds = [];
    for (let k = 1; k < samples.length; k += 1) ds.push(samples[k][i] - samples[k - 1][i]);
    const sameSign = ds.every((v) => v >= -0.01) || ds.every((v) => v <= 0.01);
    return {
      moved: Math.abs(samples[samples.length - 1][i] - samples[0][i]) > 3,
      sameSign,
      maxStep: +Math.max(...ds.map(Math.abs)).toFixed(2),
      speed: +Math.abs(samples[samples.length - 1][i] - samples[0][i]).toFixed(1),
    };
  });
  return { frames: samples.length, perTrack };
});
check('每行确实在动，方向单调无回跳', motion.perTrack.every((t) => t.moved && t.sameSign), `帧数 ${motion.frames}`);
check('没有跳帧级瞬移（单帧位移 < 6px）', motion.perTrack.every((t) => t.maxStep < 6), motion.perTrack.map((t) => t.maxStep).join(','));
check('各行速度有差异', new Set(motion.perTrack.map((t) => t.speed)).size >= 3, motion.perTrack.map((t) => t.speed + 'px/1.8s').join(','));

/* 纵深：近书模糊、外围清晰 */
const depth = await p.evaluate(() => {
  const blur = getComputedStyle(document.querySelector('.bk-wall__blur'));
  const glow = getComputedStyle(document.querySelector('.bk-wall__glow'));
  return { bf: blur.backdropFilter || blur.webkitBackdropFilter, mask: blur.webkitMaskImage || blur.maskImage, glow: !!glow.backgroundImage };
});
check('画册附近有渐变模糊层（backdrop-filter + 径向遮罩）', /blur\(/.test(depth.bf) && /radial-gradient/.test(depth.mask), depth.bf);
check('暖白柔光层存在', depth.glow);

/* 打开画册后背景退后、但不消失 */
await p.screenshot({ path: '.tmp/wall/30-verify-closed.png' });
await p.locator('.bk-cover').click();
await p.waitForTimeout(3200);
const opened = await p.evaluate(() => ({
  mode: window.__book.mode,
  wallOpacity: +getComputedStyle(document.querySelector('.bk-wall')).opacity,
  contentLen: (document.querySelector('.bk-content')?.innerText || '').length,
  pageFilter: getComputedStyle(document.querySelector('.bk-pageface') || document.body).filter,
}));
check('翻开后背景降存在感（0.4~0.8）且仍在', opened.wallOpacity > 0.4 && opened.wallOpacity < 0.8, `opacity=${opened.wallOpacity}`);
check('画册书页未被模糊/变暗', opened.pageFilter === 'none' && opened.mode === 'open', `mode=${opened.mode}`);
await p.screenshot({ path: '.tmp/wall/31-verify-open.png' });

/* 开合不影响原有交互 */
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1100);
const turned = await p.evaluate(() => ({ spread: window.__book.spread }));
await p.locator('.bk-back').click();
await p.waitForTimeout(2400);
const closed = await p.evaluate(() => ({ mode: window.__book.mode, opacity: +getComputedStyle(document.querySelector('.bk-wall')).opacity }));
check('翻页 / 合上不受背景影响', turned.spread > 0 && closed.mode === 'closed' && closed.opacity > 0.95, `spread=${turned.spread} 合上后 opacity=${closed.opacity}`);
await p.close();

/* ---------- 适配 ---------- */
for (const [label, w, h, range] of [
  ['1920', 1920, 1080, SPEC.rowsPC],
  ['平板 834', 834, 1112, SPEC.rowsTablet],
  ['手机 390', 390, 844, SPEC.rowsPhone],
]) {
  const vp = await open({ width: w, height: h });
  const s = await vp.evaluate(WALL_STATE);
  check(`${label}：行数 ${range[0]}~${range[1]}、铺满、无溢出`, s.rows >= range[0] && s.rows <= range[1] && s.rowSum >= s.vh - 2 && s.setW >= s.vw, `rows=${s.rows} cardRatio=${s.cardRatio} setW=${s.setW}/${s.vw}`);
  check(`${label}：奇偶反向保持`, s.tracks.every((t, i) => t.dir === (i % 2 === 0 ? 'right' : 'left')), s.tracks.map((t) => t.dir).join(','));
  await vp.close();
}

/* 窗口变化后重建，不能出现空隙 */
const rs = await open({ width: 1440, height: 900 });
const resizeOut = [];
for (const [w, h] of [[900, 620], [1920, 1080], [1440, 900]]) {
  await rs.setViewportSize({ width: w, height: h });
  await rs.waitForTimeout(700);
  const s = await rs.evaluate(WALL_STATE);
  resizeOut.push({ size: `${w}x${h}`, rows: s.rows, ok: s.setW >= s.vw && s.ratio === 2 && s.rowSum >= s.vh - 2 });
}
check('窗口缩放后轨道重建、不留空隙', resizeOut.every((r) => r.ok), resizeOut.map((r) => `${r.size}:${r.rows}行`).join(' '));

/* 页面隐藏时暂停 */
const paused = await rs.evaluate(async () => {
  const wall = document.querySelector('.bk-wall');
  const x = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.bk-wall__track')).transform).m41;
  wall.classList.add('is-paused');
  const a = x();
  await new Promise((r) => setTimeout(r, 600));
  const b2 = x();
  wall.classList.remove('is-paused');
  return { delta: Math.abs(b2 - a) };
});
check('隐藏/暂停时动画停住', paused.delta < 2, `Δ=${paused.delta.toFixed(2)}px`);
await rs.close();

/* prefers-reduced-motion */
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
check('prefers-reduced-motion 下静止但网格仍在', rm.name === 'none' && rm.delta < 2 && rm.cards > 0, `anim=${rm.name} Δ=${rm.delta.toFixed(1)} cards=${rm.cards}`);
await ctx.close();

/* 首屏开销 */
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
check('背景图总体积 < 1.5MB', bytes > 0 && bytes < 1.5 * 1024 * 1024, `${Math.round(bytes / 1024)} KB`);
check('加载后无长任务阻塞（>50ms 的任务 ≤ 2 个）', longTasks.filter((t) => t > 50).length <= 2, longTasks.join(',') || '无');
await net.close();

check('没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' / '));

await b.close();
const pass = results.filter(Boolean).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);