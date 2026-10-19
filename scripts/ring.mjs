import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5180/',{waitUntil:'load'});
await p.waitForTimeout(3000);
const before = await p.evaluate(()=>window.__exhibition?.gallery?.rotation ?? null);
await p.mouse.move(720, 470);
await p.mouse.down();
for (let i=1;i<=10;i++){ await p.mouse.move(720+i*18, 470); await p.waitForTimeout(16); }
await p.mouse.up();
await p.waitForTimeout(500);
const after = await p.evaluate(()=>window.__exhibition?.gallery?.rotation ?? null);
console.log('drag rotation:', before?.toFixed(3), '->', after?.toFixed(3));
// 点击居中卡片
await p.mouse.click(720, 470);
await p.waitForTimeout(700);
console.log('caption visible:', await p.locator('#heroCaption.is-on').count());
console.log('caption text:', (await p.locator('#heroCaption').innerText()).replace(/\n/g,' | '));
await p.screenshot({path:'shots/v2-hero-selected.png'});
// 点击卡片进聊天
await p.locator('#heroCaption a').click();
await p.waitForTimeout(1000);
console.log('route:', new (globalThis.URL)(p.url()).pathname);
await b.close();
