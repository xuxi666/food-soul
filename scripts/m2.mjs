import { chromium } from 'playwright-core';
const B='http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const p = await c.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(B+'/',{waitUntil:'load'});
await p.waitForTimeout(3200);
await p.screenshot({path:'shots/h2-mobile.png'});
// 点卡片选中
await p.touchscreen.tap(195, 360);
await p.waitForTimeout(900);
await p.screenshot({path:'shots/h2-mobile-selected.png'});
// 点 CTA
const box = await p.locator('.cp.is-full .cp__cta').first().boundingBox();
await p.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
await p.waitForTimeout(1300);
console.log('route:', new (globalThis.URL)(p.url()).pathname);
console.log('overflow:', await p.evaluate(()=>document.documentElement.scrollWidth + '/' + innerWidth));
console.log('errors:', errs.length?errs:'none');
await b.close();
