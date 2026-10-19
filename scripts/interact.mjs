import { chromium } from 'playwright-core';
const BASE='http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/',{waitUntil:'load'});
await p.waitForTimeout(2500);

// 切换口味探索
await p.locator('.seg__btn[data-mode="taste"]').click();
await p.waitForTimeout(500);
console.log('taste chips:', await p.locator('.chip-tab').count(), 'cards:', await p.locator('.dish-card').count());
await p.locator('.chip-tab', { hasText: '清鲜本味' }).click();
await p.waitForTimeout(500);
console.log('after taste click cards:', await p.locator('.dish-card').count(), 'title:', await p.locator('.board__title').innerText());
await p.screenshot({path:'shots/v2-board-taste.png'});

// 点击卡片进聊天
await p.locator('.dish-card a.btn--gold').first().click();
await p.waitForTimeout(1200);
console.log('route:', new (globalThis.URL)(p.url()).pathname, 'title:', await p.locator('.chat-aside__name h1').innerText());

// 发评论
await p.locator('.comment-form textarea').fill('按站里的火候提示试了一次，花椒最后撒确实不苦。');
await p.locator('.comment-form button[type="submit"]').click();
await p.waitForTimeout(1200);
console.log('comments after post:', await p.locator('.comment').count());

// 小精灵
await p.locator('.mascot__btn').click({ force: true });
await p.waitForTimeout(500);
console.log('bubble visible:', await p.locator('.mascot__bubble').isVisible());
await p.locator('.mascot__bubble .btn--gold').click({ force: true });
await p.waitForTimeout(800);
console.log('panel visible:', await p.locator('.mascot__panel').isVisible());
await p.locator('.mascot__panel textarea').fill('今天想吃点清淡的');
await p.locator('.mascot__panel .composer__send').click();
await p.waitForTimeout(2500);
console.log('mascot reply:', (await p.locator('.mascot__panel .msg--ai .msg__text').last().innerText()).slice(0,60));
await p.screenshot({path:'shots/v2-mascot.png'});

console.log('errors:', errs.length?errs:'none');
await b.close();
