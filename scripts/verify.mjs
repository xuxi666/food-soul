import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://127.0.0.1:5180/';
const OUT = 'shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

async function runDesktop() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__exhibition?.gallery?.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(1800);

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  log('webgl:', webgl);
  log('body class:', await page.evaluate(() => document.body.className));
  log('selected initial:', await page.evaluate(() => window.__exhibition.gallery.selected));
  log('rotation initial:', await page.evaluate(() => window.__exhibition.gallery.rotation.toFixed(4)));
  log('scroll size:', await page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} / ${innerWidth}x${innerHeight}`));

  await page.screenshot({ path: `${OUT}/desktop-01-initial.png` });

  // --- click front card ---
  await page.mouse.click(720, 470);
  await page.waitForTimeout(600);
  log('selected after click:', await page.evaluate(() => window.__exhibition.gallery.selected));
  log('aria-pressed:', await page.evaluate(() => [...document.querySelectorAll('#srGallery button')].map((b) => b.getAttribute('aria-pressed')).join(',')));
  await page.screenshot({ path: `${OUT}/desktop-02-selected.png` });

  // --- drag: must rotate, must not select ---
  const before = await page.evaluate(() => window.__exhibition.gallery.rotation);
  await page.mouse.move(700, 460);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(700 + i * 20, 460, { steps: 2 });
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__exhibition.gallery.rotation);
  log('drag rotation delta:', (after - before).toFixed(4), 'rad');
  log('selected after drag:', await page.evaluate(() => window.__exhibition.gallery.selected));
  await page.screenshot({ path: `${OUT}/desktop-03-dragged.png` });

  // --- inertia settles ---
  await page.waitForTimeout(1600);
  const settled = await page.evaluate(() => window.__exhibition.gallery.rotation);
  log('rotation after settle:', settled.toFixed(4));
  await page.screenshot({ path: `${OUT}/desktop-04-settled.png` });

  // --- text selection works ---
  const sel = await page.evaluate(() => {
    const h = document.querySelector('.hero__title');
    const r = document.createRange();
    r.selectNodeContents(h);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return s.toString();
  });
  log('selectable title text:', JSON.stringify(sel));

  // --- hit test: title is on top, canvas does not block ---
  const topAtTitle = await page.evaluate(() => {
    const r = document.querySelector('.hero__title').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el ? `${el.tagName}.${el.className}` : 'none';
  });
  log('element at title:', topAtTitle);

  // --- fps sample ---
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n += 1;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else res(n);
        };
        requestAnimationFrame(tick);
      })
  );
  log('fps approx:', fps);

  log('console issues:', errors.length ? errors : 'none');
  await ctx.close();
}

async function runMobile() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__exhibition?.gallery?.ready === true, null, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/mobile-01-initial.png` });

  // touch drag through CDP
  const client = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => window.__exhibition.gallery.rotation);
  const y = 470;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (let i = 1; i <= 10; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 300 - i * 18, y }],
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__exhibition.gallery.rotation);
  log('mobile touch rotation delta:', (after - before).toFixed(4));
  log('mobile selected after drag:', await page.evaluate(() => window.__exhibition.gallery.selected));
  await page.screenshot({ path: `${OUT}/mobile-02-dragged.png` });

  // tap to select
  await page.touchscreen.tap(195, 470);
  await page.waitForTimeout(600);
  log('mobile selected after tap:', await page.evaluate(() => window.__exhibition.gallery.selected));
  await page.screenshot({ path: `${OUT}/mobile-03-selected.png` });
  log('mobile errors:', errors.length ? errors : 'none');
  await ctx.close();
}

await runDesktop();
await runMobile();
await browser.close();
log('done');
