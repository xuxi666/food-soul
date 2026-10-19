import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept());
const errs = [];
p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push('[console] ' + m.text().slice(0, 160)));
const base = 'http://127.0.0.1:5180';

await p.goto(`${base}/community`, { waitUntil: 'load' });
await p.waitForTimeout(1500);

// 发一条关联菜品的帖子
await p.fill('.composer-box__nick', '验收员');
await p.locator('.composer-box__nick').blur();
await p.locator('.composer-box__kinds .chip', { hasText: '菜谱分享' }).click();
await p.selectOption('.composer-box select', 'mapo-tofu');
await p.fill('.composer-box__area', '验收第二帖：麻婆豆腐的家庭版做法，豆腐先焯水再下锅。');
await p.locator('.composer-box button[type=submit]').click();
await p.waitForTimeout(2500);
const first = p.locator('.post').first();
console.log('post dish name:', await first.locator('.post__dish b').innerText().catch(() => 'none'));

// 刷新验证持久化
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1800);
console.log('persisted:', (await p.locator('.post').first().locator('.post__text').innerText()).slice(0, 20));

// 让菜回应（GLM，演示失败会 toast）
const t0 = Date.now();
await p.locator('.post').first().locator('.post-act', { hasText: '让菜回应' }).click();
let aiMs = -1;
while (Date.now() - t0 < 90000) {
  if (await p.locator('.post').first().locator('.comment__badge').count()) { aiMs = Date.now() - t0; break; }
  await p.waitForTimeout(500);
}
console.log('ai reply after', aiMs, 'ms');
await p.screenshot({ path: 'shots/final/45-ai-reply.png' });

// 点赞 toggle
const likeBtn = p.locator('.post').first().locator('.post-act').first();
const l1 = (await likeBtn.innerText()).trim();
await likeBtn.click();
await p.waitForTimeout(1000);
const l2 = (await likeBtn.innerText()).trim();
await likeBtn.click();
await p.waitForTimeout(1000);
const l3 = (await likeBtn.innerText()).trim();
console.log('like:', l1, '->', l2, '->', l3);

// 热度/讨论排序
await p.locator('.feed-tabs button', { hasText: '热门' }).click();
await p.waitForTimeout(1200);
console.log('sorted hot first:', (await p.locator('.post').first().locator('.post__text').innerText()).slice(0, 24));

// 清理：删掉所有「验收」开头的帖子
for (let i = 0; i < 6; i += 1) {
  const posts = p.locator('.post');
  let removed = false;
  const n = await posts.count();
  for (let k = 0; k < n; k += 1) {
    const post = posts.nth(k);
    const text = await post.locator('.post__text').innerText().catch(() => '');
    if (text.startsWith('验收')) {
      const del = post.locator('.post-act--danger');
      if (await del.count()) {
        await del.click();
        await p.waitForTimeout(1600);
        removed = true;
      }
      break;
    }
  }
  if (!removed) break;
}
await p.waitForTimeout(800);
const health = await p.evaluate(async () => (await fetch('/api/health')).json());
console.log('community stats after cleanup:', JSON.stringify(health.community));
console.log('remaining posts:', await p.locator('.post').count());
console.log('errors:', errs.slice(0, 5));
await b.close();
