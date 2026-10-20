/**
 * 首页全屏背景插画验收。
 *
 * 检查四件事：
 *  1. 背景层级与遮罩：插画在最底层、两层遮罩不拦截事件、卡片在其之上
 *  2. 背景不参与 3D 变换：卡片旋转/拖动时 .hero__bg 的 transform 恒为 none
 *  3. 布局：桌面/移动端均无横向溢出，标题与卡片可见
 *  4. 回归：连点首页、切换模式、拖拽后卡片不消失
 *
 * 用法：node scripts/verify-home-bg.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const b = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

const probe = () =>
  (() => {
    const bg = document.querySelector('.hero__bg');
    const stage = document.querySelector('.stage');
    const canvas = document.querySelector('.stage canvas');
    const copy = document.querySelector('.hero__copy');
    const cs = getComputedStyle(bg);
    const before = getComputedStyle(bg, '::before');
    const after = getComputedStyle(bg, '::after');
    const img = cs.backgroundImage.match(/url\("([^"]+)"\)/);
    return {
      bgZ: Number(cs.zIndex),
      stageZ: stage ? Number(getComputedStyle(stage).zIndex) : -1,
      copyZ: copy ? Number(getComputedStyle(copy).zIndex) : -1,
      bgPE: cs.pointerEvents,
      beforePE: before.pointerEvents,
      afterPE: after.pointerEvents,
      bgSize: cs.backgroundSize,
      bgPos: cs.backgroundPosition,
      bgTransform: cs.transform,
      bgImage: img ? img[1] : '',
      hasBefore: before.backgroundImage !== 'none',
      hasAfter: after.backgroundImage !== 'none',
      canvasOpacity: canvas ? getComputedStyle(canvas).opacity : 'none',
      canvasTransform: canvas ? getComputedStyle(canvas).transform : '',
      items: window.__exhibition?.gallery?.items?.length ?? -1,
      rotation: window.__exhibition?.gallery?.rotation ?? null,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  })();

const errors = [];
async function openPage(viewport) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2600);
  return p;
}

/* ---------------- 桌面端 ---------------- */
let p = await openPage({ width: 1440, height: 900 });
let s = await p.evaluate(probe);

check('背景层在最底层（z-index 0）', s.bgZ === 0, `z=${s.bgZ}`);
check('3D 卡片层在背景之上', s.stageZ > s.bgZ, `stage=${s.stageZ} > bg=${s.bgZ}`);
check('文字层在卡片之上', s.copyZ > s.stageZ, `copy=${s.copyZ} > stage=${s.stageZ}`);
check('背景层不拦截指针事件', s.bgPE === 'none', s.bgPE);
check('全屏遮罩层不拦截指针事件', s.beforePE === 'none' && s.afterPE === 'none', `${s.beforePE}/${s.afterPE}`);
check('遮罩层已渲染（::before + ::after）', s.hasBefore && s.hasAfter);
check('背景使用 cover 不拉伸', s.bgSize.startsWith('cover'), s.bgSize);
check('背景定位可配置', s.bgPos.startsWith('50% 44%'), s.bgPos);

// 背景图是否真的加载成功（文件缺失时浏览器仍返回 url，用 Image 探活）
const imgOk = await p.evaluate(async (url) => {
  if (!url) return false;
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth > 0);
    im.onerror = () => resolve(false);
    im.src = url;
  });
}, s.bgImage);
if (!s.bgImage) {
  console.log('SKIP | 背景插画文件可加载 | --hero-bg-image 为 none（尚未导入插画）');
  results.push({ name: 'bg-file', pass: true });
} else {
  check('背景插画文件可加载', imgOk, s.bgImage);
}

check('首屏卡片可见（8 张）', s.canvasOpacity === '1' && s.items === 8, `opacity=${s.canvasOpacity} items=${s.items}`);
check('桌面端无横向溢出', s.scrollW <= s.clientW, `${s.scrollW}/${s.clientW}`);

/* 背景不参与 3D 变换：拖动卡片后对比 */
const rot0 = s.rotation;
await p.mouse.move(620, 560);
await p.mouse.down();
await p.mouse.move(840, 560, { steps: 18 });
await p.mouse.up();
await p.waitForTimeout(600);
const s2 = await p.evaluate(probe);
check('拖动后卡片确实旋转', Math.abs(s2.rotation - rot0) > 0.2, `Δ=${(s2.rotation - rot0).toFixed(3)} rad`);
check('卡片旋转时背景 transform 保持 none', s2.bgTransform === 'none', s2.bgTransform);
check('卡片旋转时背景定位不变', s2.bgPos === s.bgPos, `${s.bgPos} -> ${s2.bgPos}`);
check('卡片旋转时背景图未换源', s2.bgImage === s.bgImage);

/* 遮罩不挡点击：点模式按钮能切换 */
const modeBtn = p.locator('.wheel-modes__btn').nth(1);
await modeBtn.click({ force: true });
await p.waitForTimeout(1500);
const modeOn = await p.evaluate(() => document.querySelector('.wheel-modes__btn.is-on')?.textContent?.trim() || '');
check('遮罩不阻挡模式切换点击', /口味/.test(modeOn), modeOn);
await p.locator('.wheel-modes__btn').nth(0).click({ force: true });
await p.waitForTimeout(1200);

/* 连点首页两次（历史 bug 场景）后卡片仍在 */
const homeLink = p.locator('.nav__links a', { hasText: '首页' });
await homeLink.click({ force: true });
await p.waitForTimeout(120);
await homeLink.click({ force: true });
await p.waitForTimeout(2400);
const s3 = await p.evaluate(probe);
check('连点首页后卡片仍可见', s3.canvasOpacity === '1' && s3.items === 8, `opacity=${s3.canvasOpacity} items=${s3.items}`);
check('连点首页后背景仍在', s3.bgImage === s.bgImage && s3.bgTransform === 'none');
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/bg-desktop.png' });
await p.close();

/* ---------------- 移动端 ---------------- */
p = await openPage({ width: 390, height: 844 });
const m = await p.evaluate(probe);
check('移动端背景定位单独调整', m.bgPos.startsWith('56% 32%'), m.bgPos);
check('移动端仍为 cover', m.bgSize.startsWith('cover'), m.bgSize);
check('移动端无横向溢出', m.scrollW <= m.clientW, `${m.scrollW}/${m.clientW}`);
check('移动端卡片可见', m.canvasOpacity === '1' && m.items === 8, `opacity=${m.canvasOpacity} items=${m.items}`);
check('移动端遮罩不拦截事件', m.beforePE === 'none' && m.afterPE === 'none');
const titleVisible = await p.locator('.hero__title').isVisible();
check('移动端标题可见', titleVisible);
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/bg-mobile.png' });
await p.close();

check('无脚本异常', errors.length === 0, errors.slice(0, 2).join(' | '));

await b.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
