// 社区示例帖子验收：只读浏览，不发帖、不登录、不改数据。
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:5199';
const results = [];
const check = (name, pass, extra = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const titles = [
  '今天的下饭神菜',
  '周末给自己做顿好的',
  '米饭杀手',
  '在家复刻杭州名菜',
  '给生活一点仪式感',
  '最简单的幸福',
  '自己做的小笼包终于成功了',
  '夏日甜品自由',
  '第一次做中式点心',
  '无辣不欢的一餐',
];
const dishIds = [
  'gongbaojiding',
  'hong-shao-rou',
  'mapo-tofu',
  'xi-hu-cu-yu',
  'fo-tiao-qiang',
  'fanqie-chaodan',
  'xiaolongbao',
  'yangzhi-ganlu',
  'danhuang-su',
  'shui-zhu-yu',
];

fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function openCommunity(target) {
  await target.goto(`${BASE}/community`, { waitUntil: 'load' });
  await target.waitForTimeout(1400);
  // 画册默认停在封面；从章节书签进入社区，保留现有书页式社区布局。
  if ((await target.locator('.post').count()) === 0) {
    const nav = target.locator('a,button').filter({ hasText: '社区' }).first();
    if (await nav.count()) {
      await nav.click();
      await target.waitForTimeout(1800);
    }
  }
}

await openCommunity(page);
await page.waitForTimeout(1000);

const initialCount = await page.locator('.post').count();
check('社区首屏正常渲染', initialCount >= 3, `${initialCount} 张卡片`);
check('未登录发布锁层仍在', await page.locator('.composer-lock').isVisible());
check('首屏第一张是示例帖', (await page.locator('.post').first().locator('.post__title').innerText()) === titles[0]);

// 滚到底触发现有自动加载，直到了 10 条示例全部出现在 DOM 中。
for (let i = 0; i < 10; i += 1) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(900);
  const nowTitles = await page.locator('.post__title').allInnerTexts();
  if (titles.every((title) => nowTitles.includes(title))) break;
}
// 逐张滚过，确保懒加载图片都已实际请求。
await page.evaluate(async () => {
  for (const card of document.querySelectorAll('.post')) {
    card.scrollIntoView();
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(800);
const loadedCount = await page.locator('.post').count();
check('自动加载后能看到更多帖子', loadedCount >= 10, `${loadedCount} 张卡片`);

const cardTitles = await page.locator('.post__title').allInnerTexts();
for (const title of titles) check(`列表出现：${title}`, cardTitles.includes(title));

const cardAudit = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.post')].filter((card) =>
    [...card.querySelectorAll('.post__title')].some((t) =>
      [
        '今天的下饭神菜', '周末给自己做顿好的', '米饭杀手', '在家复刻杭州名菜', '给生活一点仪式感',
        '最简单的幸福', '自己做的小笼包终于成功了', '夏日甜品自由', '第一次做中式点心', '无辣不欢的一餐',
      ].includes(t.textContent.trim())
    )
  );
  return cards.map((card) => {
    const media = card.querySelector('.post__media');
    const img = card.querySelector('.post__media img');
    const rect = media?.getBoundingClientRect();
    const left = card.getBoundingClientRect().left;
    return {
      title: card.querySelector('.post__title')?.textContent.trim(),
      mediaRatio: rect ? Number((rect.width / rect.height).toFixed(3)) : null,
      naturalWidth: img?.naturalWidth || 0,
      left: Math.round(left),
      height: Math.round(card.getBoundingClientRect().height),
    };
  });
});
check('10 条示例卡片全部出现', cardAudit.length === 10, `${cardAudit.length} 张`);
check('示例图片均为 4:3 卡片比例', cardAudit.every((c) => Math.abs(c.mediaRatio - 1.333) < 0.02), JSON.stringify(cardAudit.map((c) => c.mediaRatio)));
check('示例图片均已实际加载', cardAudit.every((c) => c.naturalWidth > 0), JSON.stringify(cardAudit.map((c) => c.naturalWidth)));
const lefts = [...new Set(cardAudit.map((c) => c.left))];
check('桌面网格按列对齐', lefts.length >= 2 && lefts.length <= 4, `列起点 ${lefts.join(',')}`);

await page.screenshot({ path: 'shots/community-examples-desktop.png', fullPage: false });

// 打开第一条示例详情，检查标题、正文、菜品关联与详情布局。
await page.locator('.post').first().click();
await page.waitForTimeout(700);
check('帖子详情打开', await page.locator('.com-detail__panel').isVisible());
check('详情标题来自帖子 title', (await page.locator('.post-detail__title').innerText()) === titles[0]);
check('详情正文存在', (await page.locator('.post-detail__text').innerText()).includes('鸡腿肉切丁'));
const dishHref = await page.locator('.post__dish-main').first().getAttribute('href');
check('详情关联真实菜品', dishHref === `/dishes/${dishIds[0]}`, dishHref || '无');
check('详情显示菜品卡片', (await page.locator('.post__dish--detail').count()) === 1);
await page.screenshot({ path: 'shots/community-examples-detail.png', fullPage: false });

// 关闭详情，打开番茄炒蛋帖子详情，再从菜品卡片进入新增菜品详情。
await page.locator('.com-detail__back').click();
await page.waitForTimeout(400);
const tomatoCard = page.locator('.post').filter({ has: page.locator('.post__title', { hasText: '最简单的幸福' }) }).first();
await tomatoCard.click();
await page.waitForTimeout(700);
await page.locator('.post__dish-main[href="/dishes/fanqie-chaodan"]').click();
await page.waitForTimeout(1000);
const dishBody = await page.locator('body').innerText();
check('新增菜品详情可访问', dishBody.includes('番茄炒蛋'));
check('新增菜品图片存在', await page.locator('img[src="/community/community-tomato-egg.jpg"]').count() > 0);
await page.screenshot({ path: 'shots/community-examples-dish.png', fullPage: false });

// 移动端：无横向溢出，图片保持 4:3。
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await openCommunity(mobile);
const mobileAudit = await mobile.evaluate(() => {
  const card = document.querySelector('.post');
  const media = card?.querySelector('.post__media');
  const rect = media?.getBoundingClientRect();
  return {
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    ratio: rect ? Number((rect.width / rect.height).toFixed(3)) : null,
  };
});
check('移动端无横向溢出', mobileAudit.overflowX === 0, `${mobileAudit.overflowX}px`);
check('移动端图片保持 4:3', Math.abs(mobileAudit.ratio - 1.333) < 0.02, String(mobileAudit.ratio));
await mobile.screenshot({ path: 'shots/community-examples-mobile.png', fullPage: false });

const realErrors = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(e));
check('无脚本异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(`\nTOTAL ${results.filter(Boolean).length}/${results.length}`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);