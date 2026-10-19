/**
 * 验收：删除 AI 聊天页的「这个味型下的菜 / 这个菜系下的菜」模块
 * ------------------------------------------------------------
 * 1. /chat/cuisine/chuan：无「这个菜系下的菜」标题、无 .chat-related、无空 footer；
 *    聊天区 / 输入框 / 发送按钮正常，真实流式回复正常
 * 2. /chat/taste/mala：无「这个味型下的菜」标题、无 .chat-related、无空 footer
 * 3. /chat/mapo-tofu（菜品聊天）：评论区仍在（不受影响）
 * 4. /cuisines/chuan、/tastes/mala（分类页，非聊天页）：菜品展示仍在
 * 5. 移动端：两个聊天页无横向溢出，输入框可见
 * 6. 控制台无报错
 * 用法：先启动 dev server（5180），再 node scripts/verify-chat-dish-removal.mjs
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(e.message))

const headingCount = async (text) =>
  page.evaluate((t) => [...document.querySelectorAll('h1,h2,h3')].filter((el) => (el.textContent || '').includes(t)).length, text)

/* ---------------- 菜系 AI 聊天页 ---------------- */
await page.goto(`${BASE}/chat/cuisine/chuan`, { waitUntil: 'networkidle' })
check('菜系聊天页：无「这个菜系下的菜」标题', (await headingCount('这个菜系下的菜')) === 0)
check('菜系聊天页：无 .chat-related 模块', (await page.locator('.chat-related').count()) === 0)
check('菜系聊天页：无空 comments-slot 残留', (await page.locator('.comments-slot').count()) === 0)
check('菜系聊天页：聊天区存在', (await page.locator('.chat-main').count()) === 1)
check('菜系聊天页：输入框可见', await page.locator('.chat-main .composer textarea').isVisible())
check('菜系聊天页：发送按钮可见', await page.locator('.chat-main .composer__send').isVisible())
check('菜系聊天页：AI 人格标题存在', (await page.locator('.page-head__title').innerText()).includes('AI'))

/* 真实流式回复 */
try {
  const ta = page.locator('.chat-main .composer textarea')
  await ta.fill('用一句话介绍川菜的特点')
  await page.locator('.chat-main .composer__send').click()
  await page.waitForFunction(
    () => {
      const texts = [...document.querySelectorAll('.messages .msg--ai .msg__text')]
      return texts.some((t) => (t.textContent || '').trim().length > 6)
    },
    { timeout: 30000 },
  )
  const reply = await page.locator('.messages .msg--ai .msg__text').last().innerText()
  check('菜系聊天页：真实流式回复正常', reply.trim().length > 6, `长度=${reply.trim().length}`)
} catch (err) {
  check('菜系聊天页：真实流式回复正常', false, err.message)
}

/* ---------------- 口味 AI 聊天页 ---------------- */
await page.goto(`${BASE}/chat/taste/mala`, { waitUntil: 'networkidle' })
check('口味聊天页：无「这个味型下的菜」标题', (await headingCount('这个味型下的菜')) === 0)
check('口味聊天页：无 .chat-related 模块', (await page.locator('.chat-related').count()) === 0)
check('口味聊天页：无空 comments-slot 残留', (await page.locator('.comments-slot').count()) === 0)
check('口味聊天页：聊天区存在', (await page.locator('.chat-main').count()) === 1)
check('口味聊天页：输入框可见', await page.locator('.chat-main .composer textarea').isVisible())
check('口味聊天页：发送按钮可见', await page.locator('.chat-main .composer__send').isVisible())

/* ---------------- 菜品聊天页：评论区不受影响 ---------------- */
await page.goto(`${BASE}/chat/mapo-tofu`, { waitUntil: 'networkidle' })
check('菜品聊天页：评论区容器仍在', (await page.locator('.comments-slot').count()) === 1)
check('菜品聊天页：评论表单仍在', (await page.locator('.comment-form').count()) === 1)
check('菜品聊天页：聊天区存在', (await page.locator('.chat-main').count()) === 1)

/* ---------------- 分类页（非聊天页）：菜品展示不受影响 ---------------- */
await page.goto(`${BASE}/cuisines/chuan`, { waitUntil: 'networkidle' })
check('菜系分类页：菜品卡片仍展示', (await page.locator('.dish-grid .dish-card').count()) > 0)
await page.goto(`${BASE}/tastes/mala`, { waitUntil: 'networkidle' })
check('口味分类页：菜品卡片仍展示', (await page.locator('.dish-grid .dish-card').count()) > 0)

/* ---------------- 移动端 ---------------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await setTestCookie(mobile, testCookie)
for (const path of ['/chat/cuisine/chuan', '/chat/taste/mala']) {
  await mobile.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`移动端 ${path}：无横向溢出`, overflow <= 1, `overflow=${overflow}px`)
  check(`移动端 ${path}：输入框可见`, await mobile.locator('.chat-main .composer textarea').isVisible())
}

check('全程无页面脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await clearTestConfig(testCookie)
await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
