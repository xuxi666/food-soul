/**
 * 图鉴详情 → 结构化菜谱 的跳转与名称回填验收。
 *
 * 覆盖：
 *  1. 红烧类菜品详情页点「生成菜谱」→ 名称精确回填
 *  2. 另一道菜品 → 回填它自己的名称
 *  3. 直接打开 /recipe（无参数）→ 输入框为空
 *  4. 连续从两个详情页进入 → 第二次不残留第一次的名称
 *  5. 回填后仍可编辑名称与其他字段
 *  6. 回填不会触发任何菜谱生成 / 图鉴查询请求
 *
 * 用法：node scripts/verify-recipe-preset.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// 记录所有发往菜谱接口的请求
const apiCalls = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/recipe')) apiCalls.push(`${r.method()} ${u.replace(BASE, '')}`);
});

const dishInput = () => page.locator('#dishName');

/* ---------- 1. 毛氏红烧肉 ---------- */
await page.goto(BASE + '/dishes/maoshi-hongshaorou', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const titleA = await page.locator('.cat-hero h1, h1').first().innerText();
check('详情页标题为菜品名', /红烧肉/.test(titleA), titleA.trim());

apiCalls.length = 0;
await page.locator('button', { hasText: '生成菜谱' }).first().click();
await page.waitForURL(/\/recipe\?/, { timeout: 15000 });
await page.waitForTimeout(900);
check('跳转到结构化菜谱页', page.url().includes('/recipe?'), page.url().replace(BASE, ''));

const valA = await dishInput().inputValue();
check('输入框回填「毛氏红烧肉」', valA === '毛氏红烧肉', valA);
check('URL 带 name 参数且已编码', /[?&]name=/.test(page.url()), page.url().replace(BASE, ''));
check('回填不触发菜谱接口', apiCalls.length === 0, apiCalls.join(', ') || 'none');

/* ---------- 5. 可编辑 ---------- */
await dishInput().fill('自定义菜名');
check('名称可被用户修改', (await dishInput().inputValue()) === '自定义菜名', await dishInput().inputValue());
await page.locator('input[type="number"]').first().fill('4');
check('人数可修改', (await page.locator('input[type="number"]').first().inputValue()) === '4');
await page.locator('select').first().selectOption('medium');
check('难度可修改', (await page.locator('select').first().inputValue()) === 'medium');

/* ---------- 2 & 4. 另一个菜品（连续进入，不残留） ---------- */
await page.goto(BASE + '/dishes/mapo-tofu', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
apiCalls.length = 0;
await page.locator('button', { hasText: '生成菜谱' }).first().click();
await page.waitForURL(/\/recipe\?/, { timeout: 15000 });
await page.waitForTimeout(900);
const valB = await dishInput().inputValue();
check('第二次进入回填「麻婆豆腐」', valB === '麻婆豆腐', valB);
check('不残留上一次的名称', valB !== '毛氏红烧肉', valB);
check('第二次也不触发菜谱接口', apiCalls.length === 0, apiCalls.join(', ') || 'none');

/* ---------- 连续切换（同一路由不同参数） ---------- */
await page.goto(BASE + '/dishes/gongbaojiding', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('button', { hasText: '生成菜谱' }).first().click();
await page.waitForURL(/\/recipe\?/, { timeout: 15000 });
await page.waitForTimeout(800);
const valC = await dishInput().inputValue();
check('第三次进入回填「宫保鸡丁」', valC === '宫保鸡丁', valC);

/* ---------- 3. 直接访问 ---------- */
await page.goto(BASE + '/recipe', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const valD = await dishInput().inputValue();
check('直接访问 /recipe 输入框为空', valD === '', `value="${valD}"`);
check('直接访问不触发接口', apiCalls.filter((x) => !x.includes('lookup')).length === 0, apiCalls.join(', ') || 'none');

/* ---------- 中文/特殊字符编码 ---------- */
await page.goto(BASE + '/recipe?name=' + encodeURIComponent('番茄 炒蛋（家常）'), { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const valE = await dishInput().inputValue();
check('中文/空格/括号正确解码', valE === '番茄 炒蛋（家常）', valE);

/* ---------- 刷新不残留 ---------- */
await page.goto(BASE + '/recipe?name=' + encodeURIComponent('麻婆豆腐'), { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('刷新后仍按 URL 参数回填', (await dishInput().inputValue()) === '麻婆豆腐', await dishInput().inputValue());

check('无脚本异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await page.screenshot({ path: 'F:/AIweb/美食1.0/aimeishi2.0/shots/recipe-preset.png' });

await browser.close();
const pass = results.filter((x) => x.pass).length;
console.log(`\nTOTAL ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
