/**
 * 验收：AI 聊天「对话延伸建议」
 * 用法：先启动 dev server（5180），再 node scripts/verify-chat-suggestions.mjs
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

async function ask(text) {
  const ta = page.locator('.chat-main .composer textarea')
  await ta.fill(text)
  await ta.press('Enter')
}

/* ---------------- 1. 菜品聊天：流式期间不显示建议，结束后显示 ---------------- */
await page.goto(`${BASE}/chat/mapo-tofu`, { waitUntil: 'networkidle' })
await page.waitForSelector('.chat-empty', { timeout: 30000 })
await ask('麻婆豆腐的口感是什么？')
await page.waitForSelector('.msg--ai .cursor', { timeout: 30000 })
const during = await page.locator('.suggest-chip').count()
check('流式输出期间不显示最终建议', during === 0, `chips=${during}`)

await page.waitForSelector('.msg__suggest .suggest-chip', { timeout: 120000 })
const chips = page.locator('.msg--ai').last().locator('.msg__suggest .suggest-chip')
const n = await chips.count()
check('回答结束后出现 1-3 条建议', n >= 1 && n <= 3, `count=${n}`)
const texts = await page.locator('.msg--ai').last().locator('.suggest-chip__text').allInnerTexts()
check('建议文本非空', texts.every((t) => t.trim().length >= 4), texts.join(' | '))

// 建议类型与文案匹配（至少有一个可点击项）
const tags = await chips.evaluateAll((els) => els.map((e) => e.tagName))
check('建议是可点击的按钮或链接', tags.every((t) => t === 'BUTTON' || t === 'A'), tags.join(','))
const links = page.locator('.msg--ai').last().locator('a.suggest-chip')
if (await links.count()) {
  const href = await links.first().getAttribute('href')
  const target = await links.first().getAttribute('target')
  const rel = await links.first().getAttribute('rel')
  check('动作型建议指向现有功能页面', /^\/(recipe|recommend|videos)/.test(href || ''), href || '')
  check('动作型建议安全新窗口打开', target === '_blank' && String(rel).includes('noopener'), `target=${target} rel=${rel}`)
}

/* ---------------- 2. 口味聊天：点击建议继续对话，上下文/归属正确 ---------------- */
await page.goto(`${BASE}/chat/taste/mala`, { waitUntil: 'networkidle' })
await page.waitForSelector('.chat-empty', { timeout: 30000 })
await ask('麻辣味型适合什么菜？')
await page.waitForSelector('.msg__suggest .suggest-chip', { timeout: 120000 })

const catChips = page.locator('.msg--ai').last().locator('.msg__suggest .suggest-chip')
const catCount = await catChips.count()
check('口味聊天页也能生成建议', catCount >= 1, `count=${catCount}`)
const chatButtons = page.locator('.msg--ai').last().locator('button.suggest-chip')
const btnCount = await chatButtons.count()
check('存在可直接继续对话的建议', btnCount >= 1, `buttons=${btnCount}`)

if (btnCount > 0) {
  const picked = (await chatButtons.first().locator('.suggest-chip__text').innerText()).trim()
  const aiBefore = await page.locator('.msg--ai').count()
  await chatButtons.first().click()
  // 旧建议被标记为已使用，不能重复点击
  const oldUsed = await page.locator('.msg--ai').nth(aiBefore - 1).locator('.suggest-chip.is-used').count()
  check('点击后旧建议标记为已使用', oldUsed >= 1, `used=${oldUsed}`)

  await page.waitForFunction(
    (t) => [...document.querySelectorAll('.msg--user .msg__text')].some((el) => el.textContent.trim() === t),
    picked,
    { timeout: 30000 }
  )
  const userHits = await page.locator('.msg--user .msg__text', { hasText: picked }).count()
  check('建议作为新用户消息提交且只提交一次', userHits === 1, `hits=${userHits}`)

  await page.waitForFunction(
    (before) => document.querySelectorAll('.msg--ai').length >= before + 1,
    aiBefore,
    { timeout: 120000 }
  )
  await page.waitForSelector('.msg__suggest .suggest-chip', { timeout: 120000 })
  const aiAfter = await page.locator('.msg--ai').count()
  check('点击后正常追加一条 AI 回复（不重复）', aiAfter === aiBefore + 1, `before=${aiBefore} after=${aiAfter}`)
  const newTexts = await page.locator('.msg--ai').last().locator('.suggest-chip__text').allInnerTexts()
  check('新建议不会重复已点击的那条', !newTexts.some((t) => t.trim() === picked), newTexts.join(' | '))
  check('旧建议仍归属旧消息（未错位）', (await page.locator('.msg--ai').nth(aiBefore - 1).locator('.suggest-chip').count()) >= 1)
}

/* ---------------- 3. 移动端 ---------------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await setTestCookie(mobile, testCookie)
await mobile.goto(`${BASE}/chat/mapo-tofu`, { waitUntil: 'networkidle' })
await mobile.waitForSelector('.chat-empty', { timeout: 30000 })
await mobile.locator('.chat-main .composer textarea').fill('麻婆豆腐的历史是什么？')
await mobile.locator('.chat-main .composer textarea').press('Enter')
await mobile.waitForSelector('.msg__suggest .suggest-chip', { timeout: 120000 })
check('移动端：建议正常显示', (await mobile.locator('.suggest-chip').count()) >= 1)
check('移动端：无横向溢出', (await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1)

check('全程无页面脚本异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await clearTestConfig(testCookie)
await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
