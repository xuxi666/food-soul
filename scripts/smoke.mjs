import { chromium } from 'playwright-core';
const URL = 'http://127.0.0.1:5180';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu','--use-angle=d3d11','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push('[console] '+m.text()); });
p.on('pageerror', e => errs.push('[pageerror] '+e.message));

await p.goto(URL + '/', { waitUntil: 'load' });
await p.waitForTimeout(3500);
console.log('hero ready:', await p.evaluate(() => document.body.className));
await p.screenshot({ path: 'shots/v2-home-hero.png' });

await p.evaluate(() => document.querySelector('#board').scrollIntoView());
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots/v2-home-board.png' });
console.log('dish cards:', await p.locator('.dish-card').count());

await p.evaluate(() => document.querySelector('#personas').scrollIntoView());
await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/v2-home-personas.png' });
console.log('persona answers:', await p.locator('.persona-answer').count());

// chat
await p.goto(URL + '/chat/mapo-tofu', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots/v2-chat.png' });
await p.locator('.quick').first().click();
await p.waitForTimeout(2500);
const msg = await p.locator('.msg--ai .msg__text').last().innerText();
console.log('chat reply:', msg.slice(0, 80));
await p.screenshot({ path: 'shots/v2-chat-reply.png' });

// recipe
await p.goto(URL + '/recipe?dish=mapo-tofu&servings=2', { waitUntil: 'load' });
await p.waitForTimeout(2500);
console.log('recipe card:', await p.locator('.recipe-card').count(), 'steps:', await p.locator('.step').count());
await p.screenshot({ path: 'shots/v2-recipe.png', fullPage: false });

// recommend
await p.goto(URL + '/recommend', { waitUntil: 'load' });
await p.waitForTimeout(2000);
console.log('picks:', await p.locator('.pick').count());
await p.screenshot({ path: 'shots/v2-recommend.png' });

console.log('errors:', errs.length ? errs.slice(0,10) : 'none');
await b.close();
