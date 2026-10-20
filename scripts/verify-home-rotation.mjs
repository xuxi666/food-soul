// 首页 3D 轮播提速回归：灵敏度、切换时长、连续操作稳定性
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (n, pass, extra = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`);
};

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/40[13]/.test(m.text())) errs.push(m.text()); });

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2600);

const rot = () => p.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
const snap = () => p.evaluate(() => {
  const c = document.querySelector('.stage canvas');
  const cs = c ? getComputedStyle(c) : null;
  const g = window.__exhibition?.gallery;
  return {
    opacity: cs?.opacity ?? 'none',
    transform: cs?.transform ?? 'none',
    items: g?.items?.length ?? -1,
    selected: g?.selected ?? -1,
    rotation: g?.rotation ?? null,
  };
});

/* ---------- 1. 拖动灵敏度 ---------- */
const r0 = await rot();
await p.mouse.move(620, 560);
await p.mouse.down();
await p.mouse.move(820, 560, { steps: 20 });
await p.waitForTimeout(60);
const r1 = await rot();
await p.mouse.up();
await p.waitForTimeout(1200);
const delta = r1 - r0;
check('拖动 200px 的旋转量提升到 ≥0.90 rad', delta >= 0.9 && delta <= 1.15, `Δ=${delta.toFixed(3)} rad（提速前 0.688）`);

/* ---------- 2. 切换收敛时长 ---------- */
const t0 = Date.now();
await p.evaluate(() => window.__exhibition.gallery.rotateTo(3));
let settled = 0;
for (let i = 0; i < 80; i += 1) {
  const a = await rot();
  await p.waitForTimeout(40);
  const c = await rot();
  if (Math.abs(c - a) < 0.0005) { settled = Date.now() - t0; break; }
}
check('切换卡片收敛 ≤900ms', settled > 0 && settled <= 900, `${settled} ms（提速前 1183ms）`);

/* ---------- 3. 选中项与中心卡片一致（走真实交互路径） ---------- */
// 先让上一步直接 rotateTo 造成的状态归位
await p.evaluate(() => {
  const g = window.__exhibition.gallery;
  g.select(3);
  g.rotateTo(3);
});
await p.waitForTimeout(1200);
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1100);
const align = await p.evaluate(() => {
  const g = window.__exhibition.gallery;
  const layout = g.layout;
  const best = layout.reduce((a, c) => (c.face > a.face ? c : a), layout[0]);
  return { selected: g.selected, bestIndex: best.index, bestFace: best.face };
});
check('选中项与最正面卡片一致', align.selected === align.bestIndex, JSON.stringify(align));

/* ---------- 4. 连续 12 次快速操作 ---------- */
const modeBtns = p.locator('.wheel-modes__btn');
for (let i = 0; i < 12; i += 1) {
  if (i % 3 === 0) {
    await modeBtns.nth(i % 2).click({ force: true });
  } else if (i % 3 === 1) {
    await p.mouse.move(700, 560);
    await p.mouse.down();
    await p.mouse.move(i % 2 ? 880 : 520, 560, { steps: 6 });
    await p.mouse.up();
  } else {
    await p.keyboard.press('ArrowRight');
  }
  await p.waitForTimeout(90);
}
await p.waitForTimeout(2400);
let s = await snap();
check('连续 12 次操作后卡片仍可见', s.opacity === '1' && s.items === 8, JSON.stringify(s));
check('连续操作后旋转角为有限值', Number.isFinite(s.rotation), String(s.rotation));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/home-rotation-after.png' });

/* ---------- 5. 连续快速拖拽 10 次 ---------- */
for (let i = 0; i < 10; i += 1) {
  await p.mouse.move(720, 560);
  await p.mouse.down();
  await p.mouse.move(720 + (i % 2 ? -260 : 260), 560, { steps: 5 });
  await p.mouse.up();
  await p.waitForTimeout(70);
}
await p.waitForTimeout(2200);
s = await snap();
check('快速拖拽 10 次后卡片仍可见', s.opacity === '1' && s.items === 8, JSON.stringify(s));

/* ---------- 6. 模式切换后仍正常 ---------- */
await modeBtns.nth(1).click({ force: true });
await p.waitForTimeout(1400);
const taste = await p.evaluate(() => window.__exhibition?.nodes?.length ?? -1);
s = await snap();
check('切换到口味模式后卡片正常', s.opacity === '1' && s.items === 8 && taste === 8, JSON.stringify({ ...s, nodes: taste }));

/* ---------- 7. 移动端拖动 ---------- */
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(2600);
const m0 = await m.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
await m.mouse.move(200, 560);
await m.mouse.down();
await m.mouse.move(320, 560, { steps: 12 });
await m.waitForTimeout(60);
const m1 = await m.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
await m.mouse.up();
await m.waitForTimeout(1000);
check('移动端拖动 120px 有明显旋转', Math.abs(m1 - m0) > 0.15, `Δ=${(m1 - m0).toFixed(3)} rad`);

/* ---------- 8. 返回首页后仍正常 ---------- */
await p.goto(BASE + '/dishes', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2600);
s = await snap();
check('返回首页后卡片正常', s.opacity === '1' && s.items === 8, JSON.stringify(s));

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
