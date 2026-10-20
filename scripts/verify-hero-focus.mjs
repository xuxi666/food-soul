import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

async function titleOutline(p) {
  return p.evaluate(() => {
    const t = document.querySelector('.hero__title');
    if (!t) return null;
    const cs = getComputedStyle(t);
    return {
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
      focusVisible: t.matches(':focus-visible'),
      active: document.activeElement === t,
      w: Math.round(t.getBoundingClientRect().width),
    };
  });
}

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

// 1. 首次加载
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
let t = await titleOutline(p);
check('首次打开：标题无 outline', t && t.outline.startsWith('none'), JSON.stringify(t));
await p.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/fix-hero-after.png' });

// 2. 连续刷新 3 次
for (let i = 1; i <= 3; i += 1) {
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  t = await titleOutline(p);
  check(`第 ${i} 次刷新：标题无 outline`, t && t.outline.startsWith('none'), t ? t.outline : 'no title');
}

// 3. 从其他页面返回首页
await p.goto(BASE + '/dishes', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
t = await titleOutline(p);
check('从图鉴返回首页：标题无 outline', t && t.outline.startsWith('none'), t ? t.outline : 'no title');

// 4. 站内路由返回（SPA 内点击导航）
await p.locator('.nav__links a', { hasText: '美食图鉴' }).click();
await p.waitForTimeout(900);
await p.locator('.nav__links a', { hasText: '首页' }).click();
await p.waitForTimeout(1600);
t = await titleOutline(p);
check('站内导航返回首页：标题无 outline', t && t.outline.startsWith('none'), t ? t.outline : 'no title');

// 5. 键盘焦点仍然可见（Tab 到导航链接）
await p.keyboard.press('Tab');
const kb = await p.evaluate(() => {
  const ae = document.activeElement;
  const cs = getComputedStyle(ae);
  return { tag: ae.tagName, text: (ae.textContent || '').trim().slice(0, 12), outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
});
check('Tab 键聚焦导航项仍有金色焦点环', kb.outline !== 'none 0px' && kb.outline.startsWith('solid'), JSON.stringify(kb));

// 6. 标题文案与排版未变
const layout = await p.evaluate(() => {
  const t = document.querySelector('.hero__title');
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    text: t.textContent,
    fontSize: cs.fontSize,
    letterSpacing: cs.letterSpacing,
    textAlign: cs.textAlign,
    centerOffset: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2),
    kicker: document.querySelector('.hero__kicker')?.textContent,
    sub: document.querySelector('.hero__sub')?.textContent?.slice(0, 20),
    cn: document.querySelector('.hero__cn')?.textContent,
  };
});
check('标题文案未变', layout.text === 'A TASTE OF CHINA', layout.text);
check('标题居中未变', layout.centerOffset < 2, `偏移 ${layout.centerOffset}px`);
check('上方小字仍在', layout.kicker === '食有灵 · FOOD SOUL', layout.kicker);
check('中文介绍仍在', layout.cn === '探索中国美食，与每一道菜聊聊。', layout.cn);
check('字间距未变', layout.letterSpacing !== 'normal', layout.letterSpacing);

// 7. 首页其他元素
const others = await p.evaluate(() => ({
  cards: document.querySelectorAll('.wc, canvas').length,
  nav: document.querySelectorAll('.nav__links a').length,
  modes: document.querySelectorAll('.wheel-modes__btn').length,
}));
check('转盘画布与卡片仍在', others.cards >= 1, JSON.stringify(others));
check('导航 5 项仍在', others.nav === 5, String(others.nav));

// 8. 移动端
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE + '/', { waitUntil: 'networkidle' });
await m.waitForTimeout(1500);
const mt = await m.evaluate(() => {
  const t = document.querySelector('.hero__title');
  const cs = getComputedStyle(t);
  return {
    outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check('移动端：标题无 outline', mt.outline.startsWith('none'), mt.outline);
check('移动端：无横向溢出', mt.overflowX === 0, `${mt.overflowX}px`);
await m.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/fix-hero-mobile.png' });

console.log(`\nTOTAL ${results.filter((r) => r.pass).length}/${results.length}`);
await b.close();
