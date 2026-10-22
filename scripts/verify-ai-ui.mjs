/**
 * 验收：右上角「接入 AI」完整 UI 流程
 * 用法：先启动 dev server（5180），再 node scripts/verify-ai-ui.mjs
 * 注意：真实 API Key 从服务端 .env 读取，不会打印或写入测试文件。
 */
import { chromium } from 'playwright-core'
import { SEARCH_CONFIG } from '../server/config.mjs'

const BASE = 'http://127.0.0.1:5180'
const KEY = SEARCH_CONFIG.apiKey
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

const email = `ui-${Date.now()}@example.com`
const password = 'TestPass123!'

async function reloadAfter(action) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), action()])
  await page.waitForTimeout(500)
}

/* 1. 未登录状态 */
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.account-bar', { timeout: 15000 })
check('右上角有「接入 AI」入口', (await page.getByRole('button', { name: '接入 AI' }).count()) === 1)
check('未登录显示未接入状态', (await page.locator('.account-status__full').innerText()).includes('当前未接入 AI 大模型'))

/* 2. 点击接入 AI → 登录/注册弹窗 */
await page.getByRole('button', { name: '接入 AI' }).click()
await page.waitForSelector('.account-modal', { timeout: 5000 })
check('未登录点击接入 AI 打开登录弹窗', (await page.locator('.account-modal__head h2').innerText()).includes('登录 / 注册'))

/* 3. 注册 */
await page.locator('.account-tab', { hasText: '注册' }).click()
await page.locator('.account-modal input[type="email"]').fill(email)
await page.locator('.account-modal input[type="password"]').fill(password)
await page.locator('.account-modal input[type="text"]').fill('UI测试')
await reloadAfter(() => page.locator('.account-modal button[type="submit"]').click())

/* 4. 注册后自动打开接入 AI 弹窗 */
await page.waitForSelector('.account-modal', { timeout: 10000 })
const modalTitle = await page.locator('.account-modal__head h2').innerText()
check('注册后自动进入接入 AI', modalTitle.includes('接入 AI'), modalTitle)

if (KEY) {
  /* 5. 填写配置并测试 */
  await page.locator('.account-modal select.account-input').selectOption('zhipu')
  await page.locator('.account-modal input[type="password"]').fill(KEY)
  await page.locator('.account-modal input[list="ai-model-list"]').fill('glm-4-flash')
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => {
      const box = document.querySelector('.account-status-box')
      return box && box.textContent.includes('连接成功')
    },
    { timeout: 45000 }
  )
  check('连接测试成功并显示模型', (await page.locator('.account-status-box').innerText()).includes('glm-4-flash'))

  /* 6. 保存并接入 */
  await reloadAfter(() => page.getByRole('button', { name: '保存并接入' }).click())
  await page.waitForSelector('.account-status__full', { timeout: 15000 })
  check('保存后右上角显示已接入', (await page.locator('.account-status__full').innerText()).includes('已接入：glm-4-flash'))

  /* 7. 聊天使用用户自己的模型 */
  await page.goto(`${BASE}/chat/mapo-tofu`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.chat-empty', { timeout: 20000 })
  await page.locator('.chat-main .composer textarea').fill('用一句话介绍你自己。')
  await page.locator('.chat-main .composer textarea').press('Enter')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.msg--ai .msg__text')].some((el) => (el.textContent || '').trim().length > 6),
    { timeout: 60000 }
  )
  check('聊天正常流式输出', true)
  check('聊天状态显示已接入模型', (await page.locator('.chat-bar__mode').innerText()).includes('glm-4-flash'))
  check('未出现未接入提示', await page.locator('.chat-ai-notice').isHidden())

  /* 8. 浏览器存储不含密钥 */
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  check('浏览器存储不含 API Key', !storage.includes(KEY))
} else {
  console.log('SKIP 真实模型 UI 测试：未配置 SEARCH_API_KEY')
}

/* 9. 退出登录 */
await page.goto(BASE, { waitUntil: 'networkidle' })
await reloadAfter(() => page.getByRole('button', { name: '退出' }).click())
await page.waitForSelector('.account-status__full', { timeout: 15000 })
check('退出后显示未接入', (await page.locator('.account-status__full').innerText()).includes('当前未接入 AI 大模型'))

/* 10. 退出后聊天给出明确提示 */
await page.goto(`${BASE}/chat/mapo-tofu`, { waitUntil: 'networkidle' })
await page.waitForSelector('.chat-empty', { timeout: 20000 })
check('未登录聊天页显示接入提示', await page.locator('.chat-ai-notice').isVisible())
check('未登录聊天输入被禁用', await page.locator('.chat-main .composer textarea').isDisabled())
check('未登录发送按钮被禁用', await page.locator('.chat-main .composer__send').isDisabled())

/* 11. 重新登录，配置恢复 */
await page.getByRole('button', { name: '登录 / 注册' }).click()
await page.waitForSelector('.account-modal', { timeout: 5000 })
await page.locator('.account-modal input[type="email"]').fill(email)
await page.locator('.account-modal input[type="password"]').fill(password)
await reloadAfter(() => page.locator('.account-modal button[type="submit"]').click())
await page.waitForSelector('.account-status__full', { timeout: 15000 })
check('重新登录后配置恢复', (await page.locator('.account-status__full').innerText()).includes('已接入：glm-4-flash'))

/* 12. 移动端 */
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.account-bar', { timeout: 10000 })
check('移动端「接入 AI」入口可见', await page.getByRole('button', { name: '接入 AI' }).isVisible())
check('移动端无横向溢出', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)
await page.getByRole('button', { name: '接入 AI' }).click()
await page.waitForSelector('.account-modal', { timeout: 5000 })
const box = await page.locator('.account-modal').boundingBox()
check('移动端配置弹窗不超出视口', Boolean(box) && box.width <= 390 && box.height <= 844, box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'null')
check('移动端弹窗无横向溢出', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)

// 清理测试账号的 AI 配置，避免把真实密钥留在测试数据库里
try {
  await page.evaluate(async () => {
    await fetch('/api/ai/config', { method: 'DELETE' })
  })
} catch {}

check('全程无页面脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
