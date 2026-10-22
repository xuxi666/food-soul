/**
 * 验收：菜谱工作台手动输入 + 两阶段查询 + 真实来源展示
 * 用法：先启动 dev server（5180），再 node scripts/verify-recipe-search.mjs
 */
import { chromium } from 'playwright-core'
import { getTestCookie, setTestCookie, clearTestConfig } from './test-session.mjs'

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
const testCookie = await getTestCookie()
await setTestCookie(page, testCookie)
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(e.message))

const submit = async () => page.locator('.tool-form button[type="submit"]').click()

/* 0. 输入框是手动输入，不是下拉 */
await page.goto(`${BASE}/recipe`, { waitUntil: 'networkidle' })
const tag = await page.locator('#dishName').evaluate((el) => el.tagName)
check('菜品名称是可手动输入的 input（不是 select）', tag === 'INPUT', `tag=${tag}`)
check('页面有「生成菜谱」按钮', (await page.locator('.tool-form button[type="submit"]').count()) === 1)

/* 1. 空输入 */
await page.locator('#dishName').fill('')
await submit()
await page.waitForTimeout(300)
check('空输入：显示明确错误提示', await page.locator('.field__error').isVisible(), await page.locator('.field__error').innerText())
check('空输入：没有发起查询', (await page.locator('.lookup-status').count()) === 0 && (await page.locator('.recipe-card').count()) === 0)

/* 2. 图鉴菜 */
await page.locator('#dishName').fill('麻婆豆腐')
await submit()
await page.waitForSelector('.recipe-card', { timeout: 90000 })
check('图鉴菜：生成菜谱成功', (await page.locator('.recipe-card h2').innerText()).includes('麻婆豆腐'))
check('图鉴菜：标注「美食图鉴」', (await page.locator('.recipe-source-badge').innerText()).includes('美食图鉴'))
check('图鉴菜：有「资料来源」区块', (await page.locator('.recipe-sources').count()) === 1)
check('图鉴菜：来源为站内图鉴', (await page.locator('.recipe-sources').innerText()).includes('美食图鉴（站内）'))
check('图鉴菜：没有外部来源卡片', (await page.locator('.source-item').count()) === 0)
check('图鉴菜：显示站内数据说明', (await page.locator('.verify-banner--ok').count()) === 1)

/* 3. AI 检索菜 */
await page.locator('#dishName').fill('番茄炒蛋')
await submit()
await page.waitForSelector('.recipe-card', { timeout: 180000 })
check('AI 检索菜：生成菜谱成功', (await page.locator('.recipe-card h2').innerText()).includes('番茄炒蛋'))
check('AI 检索菜：标注「AI 检索」', (await page.locator('.recipe-source-badge').innerText()).includes('AI 检索'))
check('AI 检索菜：显示未逐条核验提示', (await page.locator('.verify-banner--warn').count()) === 1)
const sourceCount = await page.locator('.source-item').count()
check('AI 检索菜：展示真实来源卡片', sourceCount > 0, `count=${sourceCount}`)
const summary = await page.locator('.recipe-sources__head .source-status').innerText()
check('AI 检索菜：显示检索统计', summary.includes('真实检索') && (summary.includes('展示') || summary.includes('直接相关')), summary)
check('AI 检索菜：来源标注关键词匹配', (await page.locator('.source-item__chips .source-chip').count()) > 0)

const firstLink = page.locator('.source-item__title').first()
const href = await firstLink.getAttribute('href')
const target = await firstLink.getAttribute('target')
const rel = await firstLink.getAttribute('rel')
check('来源链接是真实 http(s) URL', Boolean(href && /^https?:\/\//i.test(href)), href || '')
check('来源链接新窗口打开且带 noopener', target === '_blank' && String(rel).includes('noopener'), `target=${target} rel=${rel}`)

/* 抽查来源 URL 可达性（403 视为站点反爬，404/5xx/网络失败视为不可用） */
const urls = await page.$$eval('.source-item__url', (as) => as.slice(0, 3).map((a) => a.getAttribute('href')))
let reachable = 0
const probes = []
for (const url of urls) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 Chrome/120' } })
    clearTimeout(timer)
    probes.push(`${res.status} ${url}`)
    if (res.status < 500 && res.status !== 404) reachable += 1
  } catch (e) {
    probes.push(`ERR ${url}`)
  }
}
check('至少 1 条来源链接可访问', reachable > 0, probes.join(' | '))

/* 4. 资料不足 */
await page.locator('#dishName').fill('火星烤石头')
await submit()
await page.waitForSelector('.recipe-failure', { timeout: 180000 })
check('资料不足：明确提示暂未找到足够可靠的资料', (await page.locator('.recipe-failure').innerText()).includes('暂未找到足够可靠的资料'))
check('资料不足：不生成菜谱', (await page.locator('.recipe-card').count()) === 0)
check('资料不足：提供重试入口', (await page.locator('.recipe-failure button').count()) >= 1)

/* 5. 同名歧义 */
await page.locator('#dishName').fill('佛跳墙')
await submit()
await page.waitForSelector('.ambiguous-list', { timeout: 60000 })
const candidates = await page.locator('.ambiguous-list button').count()
check('同名歧义：让用户选择具体版本', candidates >= 2, `candidates=${candidates}`)
await page.locator('.ambiguous-list button').first().click()
await page.waitForSelector('.recipe-card', { timeout: 90000 })
check('歧义选择后正常生成菜谱', (await page.locator('.recipe-card h2').innerText()).includes('佛跳墙'))

/* 6. 移动端 */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await setTestCookie(mobile, testCookie)
await mobile.goto(`${BASE}/recipe`, { waitUntil: 'networkidle' })
check('移动端：输入框可见', await mobile.locator('#dishName').isVisible())
check('移动端：生成按钮可见', await mobile.locator('.tool-form button[type="submit"]').isVisible())
check('移动端：无横向溢出', (await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)
await mobile.locator('#dishName').fill('麻婆豆腐')
await mobile.locator('.tool-form button[type="submit"]').click()
await mobile.waitForSelector('.recipe-card', { timeout: 90000 })
check('移动端：菜谱卡片正常渲染', (await mobile.locator('.recipe-card').count()) === 1)
check('移动端：生成后仍无横向溢出', (await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)

check('全程无页面脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await clearTestConfig(testCookie)
await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
