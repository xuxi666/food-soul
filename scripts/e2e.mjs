import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept());
const errs = [];
p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push('[console] ' + m.text().slice(0, 160)));
const base = 'http://127.0.0.1:5180';

async function waitText(sel, text, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = await p.locator(`${sel}`, { hasText: text }).count();
    if (n > 0) return Date.now() - t0;
    await p.waitForTimeout(400);
  }
  return -1;
}

/* ---------- 1. 菜品聊天：发一条消息，等模型流式回复 ---------- */
await p.goto(`${base}/chat/mapo-tofu`, { waitUntil: 'load' });
await p.waitForTimeout(2500);
const before = await p.locator('.msg--ai').count();
await p.fill('.composer-box textarea, .chat-composer textarea, textarea', '你到底是什么味道？说具体点。');
await p.keyboard.press('Enter');
let ok = await waitText('.msg--ai', '花椒', 60000);
if (ok < 0) ok = await p.waitForFunction((n) => document.querySelectorAll('.msg--ai').length > n + 1, before, { timeout: 60000 }).then(() => 1).catch(() => -1);
await p.waitForTimeout(1500);
const after = await p.locator('.msg--ai').count();
const last = (await p.locator('.msg--ai').last().innerText()).replace(/\s+/g, ' ').slice(0, 120);
console.log('chat: ai msgs', before, '->', after, '| last:', last);
await p.screenshot({ path: 'shots/final/40-chat-reply.png' });

/* ---------- 2. 社区：昵称/分类/多图/发布/灯箱/评论/AI回帖/点赞/删除 ---------- */
await p.goto(`${base}/community`, { waitUntil: 'load' });
await p.waitForTimeout(1500);
await p.fill('.composer-box__nick', '验收员');
await p.locator('.composer-box__nick').blur();
await p.waitForTimeout(300);
await p.locator('.composer-box__kinds .chip', { hasText: '提问' }).click();
await p.fill('.composer-box__area', '验收测试帖：麻婆豆腐怎么才能做出「麻、辣、烫、香」？');
await p.setInputFiles('input[type=file]', 'F:/AIweb/美食1.0/aimeishi2.0/public/dishes/mapo-tofu.jpg');
await p.waitForTimeout(1200);
console.log('preview imgs:', await p.locator('.upload-preview__item img').count());
await p.screenshot({ path: 'shots/final/41-compose.png' });
await p.locator('.composer-box button[type=submit]').click();
await p.waitForTimeout(2500);
const firstPost = p.locator('.post').first();
console.log('first post text:', (await firstPost.locator('.post__text').innerText()).slice(0, 40));
console.log('first post kind:', await firstPost.locator('.post__kind').innerText());
console.log('first post imgs:', await firstPost.locator('.post__img').count());
await p.screenshot({ path: 'shots/final/42-published.png' });

// 灯箱
await firstPost.locator('.post__img').first().click();
await p.waitForTimeout(500);
console.log('lightbox open:', await p.locator('.lightbox').isVisible());
await p.screenshot({ path: 'shots/final/43-lightbox.png' });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
console.log('lightbox closed:', !(await p.locator('.lightbox').isVisible()));

// 评论
await firstPost.locator('.post-act', { hasText: '评论' }).first().click();
await p.waitForTimeout(400);
await firstPost.locator('.post-comment-form input').fill('验收评论：火候要中小火，勾芡分三次。');
await firstPost.locator('.post-comment-form button[type=submit]').click();
await p.waitForTimeout(2000);
console.log('comment shown:', (await p.locator('.post').first().locator('.post-comment__text').count()) > 0);

// 让菜回应（GLM）
const aiT0 = Date.now();
await p.locator('.post').first().locator('.post-act', { hasText: '让菜回应' }).first().click();
const aiOk = await waitText('.comment__badge', 'AI 回复', 90000);
console.log('ai reply in', aiOk, 'ms total', Date.now() - aiT0);
await p.screenshot({ path: 'shots/final/44-ai-reply.png' });

// 点赞
const likeBtn = p.locator('.post').first().locator('.post-act').first();
const likeBefore = await likeBtn.innerText();
await likeBtn.click();
await p.waitForTimeout(1200);
console.log('like:', likeBefore.replace(/\s+/g, ' '), '->', (await likeBtn.innerText()).replace(/\s+/g, ' '));

console.log('errors:', errs.slice(0, 5));
await b.close();
