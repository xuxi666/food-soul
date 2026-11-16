// 口味探索模块去重的浏览器校验（真实打开画册 → 口味探索 → 逐个味型）
// 用法：node scripts/verify-taste-ui.mjs [baseUrl]
// 前提：已 `npm run build`，并有 vite preview / dev 在跑（默认 http://127.0.0.1:5199）
// 校验：八个味型页的标称道数、右页「菜品目录」首屏卡片、加载更多增量、卡片图文完整性，跨味型不重复
import { chromium } from 'playwright-core';
import { DISHES, primaryTaste } from '../src/data/dishes.js';
import { TASTES, TASTE_BY_ID } from '../src/data/cuisines.js';

const base = process.argv[2] || 'http://127.0.0.1:5199';
const PER_PAGE = 6; // 与 src/book/category.js 的首屏数量一致
const expected = Object.fromEntries(
  TASTES.map((t) => [t.id, DISHES.filter((d) => primaryTaste(d) === t.id)])
);

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text().slice(0, 200)));

const problems = [];
const seen = new Map();

/** 读当前可见味型页：标称道数 + 「菜品目录」卡片（只认标题匹配的那一块，避开书里其它章节） */
const readPage = (tasteName) =>
  page.evaluate((name) => {
    const heads = [...document.querySelectorAll('.catb__top-title')].filter((el) => el.textContent.includes(name));
    const head = heads[heads.length - 1];
    const stack = head?.closest('.catb__stack');
    const cards = stack ? [...stack.querySelectorAll('.catb__card[data-dish]')] : [];
    const taglines = [...document.querySelectorAll('.catb__tagline')].filter((el) => el.textContent.includes(name));
    const tagline = taglines[taglines.length - 1]?.textContent || '';
    return {
      tagline: tagline.replace(/\s+/g, ' ').trim(),
      declared: Number(tagline.match(/·\s*(\d+)\s*道菜/)?.[1] ?? NaN),
      cards: [...new Set(cards.map((e) => e.dataset.dish))],
      totalCards: cards.length,
      withImage: cards.filter((e) => e.querySelector('img')).length,
      withName: cards.filter((e) => (e.querySelector('.catb__card-name')?.textContent || '').trim()).length,
    };
  }, tasteName);

await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForSelector('.bk-cover', { timeout: 20000 });
await page.waitForTimeout(800);
await page.click('.bk-cover');
await page.waitForFunction(() => /\/catalog$/.test(location.pathname), null, { timeout: 20000 });

await page.click('[data-chapter="tastes"]', { force: true }).catch(() => {});
await page.waitForSelector('.catb__chip', { timeout: 20000 });

for (const t of TASTES) {
  await page.click(`.catb__chip:has-text("${t.name}")`);
  await page.waitForFunction((id) => location.pathname.endsWith(`/tastes/${id}`), t.id, { timeout: 15000 });

  const exp = expected[t.id];
  const expIds = exp.map((d) => d.id).sort();
  const firstPage = Math.min(PER_PAGE, exp.length);

  let info = null;
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(250);
    info = await readPage(t.name);
    if (info.declared === exp.length && info.cards.length === firstPage) break;
  }

  if (info.declared !== exp.length) problems.push(`${t.name}(${t.id}) 标称 ${info.declared} 道，主味型归属应为 ${exp.length} 道`);
  if (info.cards.length !== firstPage) problems.push(`${t.id} 首屏 ${info.cards.length} 道，应为 ${firstPage} 道`);
  const extra = info.cards.filter((id) => !expIds.includes(id));
  if (extra.length) problems.push(`${t.id} 出现了不属于该味型的菜：${extra.join(',')}`);
  if (info.withImage !== info.totalCards) problems.push(`${t.id} 有卡片缺图（${info.totalCards - info.withImage} 张）`);
  if (info.withName !== info.totalCards) problems.push(`${t.id} 有卡片缺菜名`);

  for (const id of info.cards) {
    if (seen.has(id)) problems.push(`${id} 同时出现在 ${TASTE_BY_ID[seen.get(id)]?.name} 与 ${t.name}`);
    else seen.set(id, t.id);
  }

  // 加载更多：只验证图鉴内增量（不依赖联网），每点一次至少多 1 道且仍属于该味型
  let moreNote = '—';
  if (exp.length > firstPage) {
    const before = info.cards.length;
    await page
      .locator('.catb__stack .catb__more-btn')
      .last()
      .click({ timeout: 5000 })
      .catch(() => {});
    let grown = before;
    for (let i = 0; i < 24; i += 1) {
      await page.waitForTimeout(250);
      const now = await readPage(t.name);
      grown = now.cards.length;
      if (grown > before) {
        const bad = now.cards.filter((id) => !expIds.includes(id));
        if (bad.length) problems.push(`${t.id} 加载更多后出现不属于该味型的菜：${bad.join(',')}`);
        for (const id of now.cards) {
          if (seen.has(id) && seen.get(id) !== t.id) problems.push(`${id} 在加载更多后跨味型重复`);
          else seen.set(id, t.id);
        }
        break;
      }
    }
    moreNote = `${before} → ${grown}`;
    if (grown <= before) problems.push(`${t.id} 点「加载更多」后道数没有增加（${before}）`);
  }

  console.log(
    `${t.name.padEnd(5)} ${t.id.padEnd(11)} ${info.tagline.padEnd(24)} 首屏 ${String(info.cards.length).padStart(2)}/${String(exp.length).padStart(2)} · 有图 ${info.withImage}/${info.totalCards} · 加载更多 ${moreNote}`
  );
}

await browser.close();

if (errors.length) {
  console.log('\n浏览器控制台错误：');
  errors.slice(0, 8).forEach((e) => console.log('  ' + e));
}
if (problems.length) {
  console.log(`\n失败：${problems.length} 项`);
  problems.slice(0, 30).forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log(`\n通过：八个味型页标称道数与数据一致，首屏与加载更多都只出本味型的菜，跨味型无重复（累计 ${seen.size} 道）。`);