import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const results = [];
const check = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`); };

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// 展开气泡
await p.evaluate(() => document.querySelector('.mascot__btn').click());
await p.waitForTimeout(500);
const bubbleVisible = await p.locator('.mascot__bubble').isVisible();
check('小助手气泡可展开', bubbleVisible);

const texts = await p.locator('.mascot__bubble > div:last-child button, .mascot__bubble > div:last-child a').allInnerTexts();
check('「逛菜系」按钮已移除', !texts.includes('逛菜系'), JSON.stringify(texts));
check('「开始聊天」仍在', texts.includes('开始聊天'), JSON.stringify(texts));
check('「先逛逛」仍在', texts.includes('先逛逛'), JSON.stringify(texts));
check('快捷按钮区无死链 a[href="/#board"]', (await p.locator('.mascot__bubble a[href="/#board"]').count()) === 0);

// 布局：两个按钮同一行、无溢出、无空白占位
const layout = await p.evaluate(() => {
  const row = document.querySelector('.mascot__bubble > div:last-child');
  const btns = [...row.querySelectorAll('button')];
  const rects = btns.map((x) => x.getBoundingClientRect());
  const rowRect = row.getBoundingClientRect();
  return {
    count: btns.length,
    sameRow: rects.every((r) => Math.abs(r.top - rects[0].top) < 1),
    rowH: Math.round(rowRect.height),
    btnH: Math.round(rects[0].height),
    gaps: rects.length > 1 ? Math.round(rects[1].left - rects[0].right) : null,
    overflowRight: Math.round(rowRect.right - window.innerWidth),
    emptySlot: Math.round(rowRect.height - rects[0].height) > 4,
  };
});
check('两个按钮同一行排列', layout.sameRow && layout.count === 2, JSON.stringify(layout));
check('无多余空白占位', !layout.emptySlot, `rowH=${layout.rowH} btnH=${layout.btnH}`);
check('不超出视口', layout.overflowRight <= 0, `right溢出 ${layout.overflowRight}px`);
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/mascot-bubble-after.png' });

// 「开始聊天」可用
await p.evaluate(() => [...document.querySelectorAll('.mascot__bubble button')].find((b) => b.textContent.includes('开始聊天')).click());
await p.waitForTimeout(600);
check('点「开始聊天」能打开对话面板', await p.locator('.mascot__panel').isVisible());
check('对话输入框可用', await p.locator('.mascot__panel textarea').isVisible());

// 关闭后「先逛逛」可用
await p.evaluate(() => document.querySelector('.mascot__close').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.mascot__btn').click());
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll('.mascot__bubble button')].find((b) => b.textContent.includes('先逛逛')).click());
await p.waitForTimeout(400);
check('点「先逛逛」能收起气泡', !(await p.locator('.mascot__bubble').isVisible()));

// 首页其他模块
const others = await p.evaluate(() => ({
  canvas: document.querySelectorAll('canvas').length,
  cards: document.querySelectorAll('.wc').length,
  nav: document.querySelectorAll('.nav__links a').length,
  modes: document.querySelectorAll('.wheel-modes__btn').length,
}));
check('轮播卡片与画布正常', others.canvas === 1, JSON.stringify(others));
check('导航 5 项正常', others.nav === 5, String(others.nav));

// 移动端
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(1500);
await m.evaluate(() => document.querySelector('.mascot__btn').click());
await m.waitForTimeout(500);
const ml = await m.evaluate(() => {
  const row = document.querySelector('.mascot__bubble > div:last-child');
  const btns = [...row.querySelectorAll('button')];
  const rowRect = row.getBoundingClientRect();
  return {
    count: btns.length,
    text: btns.map((x) => x.textContent.trim()),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    bubbleLeft: Math.round(rowRect.left),
    bubbleRight: Math.round(rowRect.right),
  };
});
check('移动端：仅剩两个按钮且文案正确', ml.count === 2 && ml.text.join('/') === '开始聊天/先逛逛', JSON.stringify(ml.text));
check('移动端：无横向溢出', ml.overflowX === 0, `${ml.overflowX}px`);
check('移动端：按钮在视口内', ml.bubbleLeft >= 0 && ml.bubbleRight <= 390, `${ml.bubbleLeft}~${ml.bubbleRight}`);
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/mascot-bubble-mobile.png' });

check('无脚本异常', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await b.close();
