import { chromium } from 'playwright-core';
const URL = 'http://127.0.0.1:5180/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });

// 1. no-webgl fallback
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) {
      if (String(t).startsWith('webgl')) return null;
      return orig.call(this, t, ...a);
    };
  });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  console.log('fallback body class:', await p.evaluate(() => document.body.className));
  console.log('fallback items:', await p.evaluate(() => document.querySelectorAll('.fallback__item').length));
  await p.screenshot({ path: 'shots/qa-fallback.png' });
  await ctx.close();
}

// 2. keyboard focus
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__exhibition?.gallery?.ready === true, null, { timeout: 20000 });
  await p.waitForTimeout(900);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(700);
  console.log('after tab -> selected:', await p.evaluate(() => window.__exhibition.gallery.selected),
              'rotation:', await p.evaluate(() => window.__exhibition.gallery.rotation.toFixed(3)));
  await p.keyboard.press('Tab');
  await p.waitForTimeout(700);
  console.log('after tab2 -> selected:', await p.evaluate(() => window.__exhibition.gallery.selected));
  await p.screenshot({ path: 'shots/qa-keyboard.png' });
  await ctx.close();
}

// 3. resize behaviour
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__exhibition?.gallery?.ready === true, null, { timeout: 20000 });
  await p.waitForTimeout(800);
  for (const [w,h,name] of [[1920,1080,'1920'],[1024,768,'1024'],[768,1024,'768p']]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(600);
    console.log(name, JSON.stringify(await p.evaluate(() => window.__exhibition.gallery.debug)));
    await p.screenshot({ path: `shots/qa-${name}.png` });
  }
  await ctx.close();
}

// 4. click vs drag threshold
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__exhibition?.gallery?.ready === true, null, { timeout: 20000 });
  await p.waitForTimeout(800);
  await p.mouse.move(720, 470); await p.mouse.down();
  await p.mouse.move(760, 470, { steps: 6 }); // 40px = drag
  await p.mouse.up();
  await p.waitForTimeout(300);
  console.log('40px drag selected (should be -1):', await p.evaluate(() => window.__exhibition.gallery.selected));
  await p.mouse.move(720, 470); await p.mouse.down();
  await p.mouse.move(723, 471, { steps: 2 }); // 3px jitter = click
  await p.mouse.up();
  await p.waitForTimeout(300);
  console.log('3px jitter selected (should be 0):', await p.evaluate(() => window.__exhibition.gallery.selected));
  await ctx.close();
}
await b.close();
