// 首页空闲自转回归：速度 1.5×、长时间稳定、重挂载不叠加、交互不受影响
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
await p.waitForTimeout(5000); // 越过 2.4s 空闲阈值

const rot = () => p.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
const visible = () => p.evaluate(() => {
  const c = document.querySelector('.stage canvas');
  const cs = c ? getComputedStyle(c) : null;
  return { opacity: cs?.opacity ?? 'none', items: window.__exhibition?.gallery?.items?.length ?? -1 };
});

async function speed(ms = 6000) {
  const a = await rot();
  await p.waitForTimeout(ms);
  const c = await rot();
  return (c - a) / (ms / 1000);
}

/* ---------- 1. 空闲速度 ---------- */
const s1 = await speed(6000);
check('空闲自转速度 ≈0.036 rad/s（原 0.024，+50%）', s1 >= 0.033 && s1 <= 0.039, `${s1.toFixed(4)} rad/s`);

/* ---------- 2. 30 秒稳定性 ---------- */
const s2 = await speed(6000); // 累计 ~12s
await p.waitForTimeout(12000); // 累计 ~24s
const s3 = await speed(6000); // ~30s
const stable = Math.abs(s3 - s1) / s1 < 0.08;
check('连续 30 秒速度稳定（无加速/减速）', stable, `${s1.toFixed(4)} → ${s2.toFixed(4)} → ${s3.toFixed(4)} rad/s`);
let v = await visible();
check('长时间自转后卡片仍可见', v.opacity === '1' && v.items === 8, JSON.stringify(v));

/* ---------- 3. 交互后恢复自转 ---------- */
await p.mouse.move(620, 560);
await p.mouse.down();
await p.mouse.move(820, 560, { steps: 16 });
await p.mouse.up();
// 惯性衰减（约 3.3s）+ 空闲阈值 2.4s ≈ 5.7s，等待后再测
await p.waitForTimeout(8000);
const s4 = await speed(5000);
check('拖动后自转恢复到同一速度', s4 >= 0.032 && s4 <= 0.040, `${s4.toFixed(4)} rad/s`);

/* ---------- 4. 拖动灵敏度/切换时长未被改动 ---------- */
const r0 = await rot();
await p.mouse.move(600, 560);
await p.mouse.down();
await p.mouse.move(800, 560, { steps: 20 });
await p.waitForTimeout(60);
const r1 = await rot();
await p.mouse.up();
await p.waitForTimeout(1500);
const dragDelta = r1 - r0;
check('拖动 200px 灵敏度保持 0.9~1.05 rad', dragDelta >= 0.9 && dragDelta <= 1.05, `Δ=${dragDelta.toFixed(3)}`);

const t0 = Date.now();
await p.evaluate(() => {
  const g = window.__exhibition.gallery;
  g.select(3);
  g.rotateTo(3);
});
let settled = 0;
for (let i = 0; i < 80; i += 1) {
  const a = await rot();
  await p.waitForTimeout(40);
  const c = await rot();
  if (Math.abs(c - a) < 0.0005) { settled = Date.now() - t0; break; }
}
check('切换收敛时长保持 ≈750ms（未被改快/改慢）', settled > 0 && settled <= 950, `${settled} ms`);

/* ---------- 5. 重挂载不叠加动画循环 ---------- */
await p.goto(BASE + '/dishes', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(5000);
const s5 = await speed(6000);
// 若旧循环未清理，速度会成倍增加
check('返回首页后自转速度不变（无循环叠加）', s5 >= 0.033 && s5 <= 0.039, `${s5.toFixed(4)} rad/s`);
const galleries = await p.evaluate(() => document.querySelectorAll('.stage canvas').length);
check('页面上只有一份画廊画布', galleries === 1, `${galleries} 个 canvas`);

/* ---------- 6. 减少动态效果时不自转 ---------- */
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const p2 = await ctx.newPage();
await p2.goto(BASE + '/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(6000);
const a2 = await p2.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
await p2.waitForTimeout(5000);
const c2 = await p2.evaluate(() => window.__exhibition?.gallery?.rotation ?? null);
check('prefers-reduced-motion 下不自转（沿用原规则）', Math.abs(c2 - a2) < 0.002, `Δ=${Math.abs(c2 - a2).toFixed(4)}`);
await ctx.close();

/* ---------- 7. 模式切换后自转仍正常 ---------- */
await p.locator('.wheel-modes__btn').nth(1).click({ force: true });
await p.waitForTimeout(5000);
const s6 = await speed(5000);
check('切换口味模式后自转正常', s6 >= 0.032 && s6 <= 0.040, `${s6.toFixed(4)} rad/s`);

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
