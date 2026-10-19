import { chromium } from 'playwright-core';
const B='http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });

// desktop
const c1 = await b.newContext({ viewport:{width:1440,height:900} });
const p = await c1.newPage();
await p.goto(B+'/',{waitUntil:'load'});
await p.waitForTimeout(3200);
await p.screenshot({path:'shots/final-hero.png'});
await p.goto(B+'/chat/mapo-tofu',{waitUntil:'load'});
await p.waitForTimeout(1200);
await p.locator('.quick').first().click();
await p.waitForTimeout(2600);
await p.screenshot({path:'shots/final-chat.png'});
await p.goto(B+'/recipe?dish=shui-zhu-yu&servings=3',{waitUntil:'load'});
await p.waitForTimeout(2200);
await p.screenshot({path:'shots/final-recipe.png'});
await c1.close();

// mobile
const c2 = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const m = await c2.newPage();
await m.goto(B+'/',{waitUntil:'load'});
await m.waitForTimeout(3200);
await m.screenshot({path:'shots/final-mobile.png'});
await c2.close();
await b.close();
console.log('done');
