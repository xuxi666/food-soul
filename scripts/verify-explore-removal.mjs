/**
 * 验收：删除「AI 美食探索」模块（导航项 + /explore 页面 + 相关入口）
 * 用法：先启动 dev server（5180），再 node scripts/verify-explore-removal.mjs
 */
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:5180'
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(e.message))

const text = async (sel) => page.locator(sel).innerText()
const linkHrefs = async () => page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') || ''))

/* 1. 首页导航 */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const navText = await text('.nav__links')
check('首页导航不再出现「AI 美食探索」', !navText.includes('AI 美食探索'))
check('首页导航项数量为 5', (await page.locator('.nav__links a').count()) === 5, `count=${await page.locator('.nav__links a').count()}`)
check('首页无任何 /explore 链接', !(await linkHrefs()).some((h) => h.includes('/explore')))
check('首页转盘仍在', (await page.locator('.wheel-hero, .hero').count()) > 0)

/* 2. /explore 已不存在 */
await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle' })
check('/explore 进入 404（模块已删除）', (await page.locator('h1').first().innerText()) === '404')
check('/explore 显示未找到文案', (await page.locator('main, #view').innerText()).includes('这道菜不在菜单上'))

/* 3. 菜系 / 口味分类页入口已修正 */
for (const path of ['/cuisines/chuan', '/tastes/mala']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  const head = await text('.page-head')
  check(`${path}：不再有「探索更多」`, !head.includes('探索更多'))
  check(`${path}：菜品卡片仍展示`, (await page.locator('.dish-grid .dish-card').count()) > 0)
  check(`${path}：无 /explore 链接`, !(await linkHrefs()).some((h) => h.includes('/explore')))
}

/* 4. 社区页入口已修正 */
await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' })
const comHead = await text('.page-head')
check('社区页：不再有「探索」按钮', !comHead.includes('探索'))
check('社区页：信息流/发帖框仍在', (await page.locator('.composer-box').count()) === 1 && (await page.locator('.post-list').count()) === 1)
check('社区页：无 /explore 链接', !(await linkHrefs()).some((h) => h.includes('/explore')))

/* 5. 菜系 AI 聊天页按钮已修正 */
await page.goto(`${BASE}/chat/cuisine/chuan`, { waitUntil: 'networkidle' })
const chatHead = await text('.page-head')
check('菜系聊天页：不再有「看口味人格」', !chatHead.includes('看口味人格'))
check('菜系聊天页：提供「回到首页」', chatHead.includes('回到首页'))
check('菜系聊天页：聊天输入框正常', await page.locator('.chat-main .composer textarea').isVisible())
check('菜系聊天页：无 /explore 链接', !(await linkHrefs()).some((h) => h.includes('/explore')))

/* 6. 美食图鉴筛选（chip-tab 样式仍在） */
await page.goto(`${BASE}/dishes`, { waitUntil: 'networkidle' })
check('美食图鉴：筛选 chip 仍渲染', (await page.locator('.chip-tab').count()) > 0, `count=${await page.locator('.chip-tab').count()}`)
check('美食图鉴：菜品卡片仍展示', (await page.locator('.dish-card').count()) > 0)
check('美食图鉴：无横向溢出', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)

/* 7. 移动端布局 */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
for (const path of ['/', '/cuisines/chuan', '/community', '/chat/cuisine/chuan', '/dishes']) {
  await mobile.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check(`移动端 ${path}：无横向溢出`, overflow <= 1, `overflow=${overflow}px`)
}

check('全程无页面脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
