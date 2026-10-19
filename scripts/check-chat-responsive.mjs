/**
 * 聊天页自适应检查：多视口下无横向溢出、聊天区/输入框在视口内
 * 用法：先启动 dev server（5180），再 node scripts/check-chat-responsive.mjs
 */
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:5180'
const ROUTES = ['/chat/cuisine/chuan', '/chat/taste/mala', '/chat/mapo-tofu']
const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'laptop 1280x720', width: 1280, height: 720 },
  { name: 'tablet 768x1024', width: 768, height: 1024 },
  { name: 'mobile 390x844', width: 390, height: 844 },
  { name: 'small 360x640', width: 360, height: 640 },
  { name: 'landscape 844x390', width: 844, height: 390 },
  { name: 'landscape 667x375', width: 667, height: 375 },
]

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

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }
      }
      const messages = document.querySelector('.chat-page .messages')
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        main: r('.chat-page .chat-main'),
        messages: r('.chat-page .messages'),
        composer: r('.chat-page .composer'),
        aside: r('.chat-page .chat-aside'),
        msgScroll: messages ? { client: messages.clientHeight, scroll: messages.scrollHeight } : null,
      }
    })

    const tag = `${vp.name} ${route}`
    const short = vp.height <= 560
    check(`${tag}：无横向溢出`, m.overflowX <= 1, `overflow=${m.overflowX}px`)
    check(`${tag}：聊天区存在且有高度`, Boolean(m.main && m.main.height >= (short ? 150 : 240)), `h=${m.main ? Math.round(m.main.height) : 'null'}`)
    check(`${tag}：输入框在视口内`, Boolean(m.composer && m.composer.top >= 0 && m.composer.bottom <= m.innerH + 2), m.composer ? `top=${Math.round(m.composer.top)} bottom=${Math.round(m.composer.bottom)} vh=${m.innerH}` : 'null')
    check(`${tag}：消息区有可用高度`, Boolean(m.messages && m.messages.height >= (short ? 45 : 100)), `h=${m.messages ? Math.round(m.messages.height) : 'null'}`)
    check(`${tag}：聊天区不超出右边界`, Boolean(m.main && m.main.right <= m.innerW + 1), m.main ? `right=${Math.round(m.main.right)} vw=${m.innerW}` : 'null')
    if (vp.width <= 980) {
      check(`${tag}：移动端聊天区在侧栏之前`, Boolean(m.main && m.aside && m.main.top <= m.aside.top + 1), m.main && m.aside ? `mainTop=${Math.round(m.main.top)} asideTop=${Math.round(m.aside.top)}` : 'null')
    }
  }
  check(`${vp.name}：控制台无报错`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()
console.log(`\nTOTAL FAIL=${failures}`)
process.exit(failures > 0 ? 1 : 0)
