import { chromium } from 'playwright-core';
const B='http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport:{width:1440,height:900} });
const p = await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(B+'/',{waitUntil:'load'});
await p.waitForTimeout(3200);
await p.screenshot({path:'shots/h2-initial.png'});

// 拖拽 200px
await p.mouse.move(720,470); await p.mouse.down();
for(let i=1;i<=10;i++){ await p.mouse.move(720+i*20,470); await p.waitForTimeout(16); }
await p.mouse.up(); await p.waitForTimeout(1400);
await p.screenshot({path:'shots/h2-dragged.png'});

// 点击左侧卡片选中
await p.mouse.click(520,360); await p.waitForTimeout(900);
console.log('after select url:', new (globalThis.URL)(p.url()).pathname);
await p.screenshot({path:'shots/h2-selected.png'});
console.log('full panels:', await p.locator('.cp.is-full').count());
console.log('cta count:', await p.locator('.cp__cta').count());
// 点 CTA
const href = await p.locator('.cp.is-full .cp__cta').first().getAttribute('href');
const box = await p.locator('.cp.is-full .cp__cta').first().boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(1400);
console.log('cta href:', href, '-> route:', new (globalThis.URL)(p.url()).pathname);
console.log('errors:', errs.length?errs:'none');
await b.close();
