// 生成 transfer/ 下的图标：用系统已安装的 Chrome 把 SVG 栅格化，不下载任何浏览器。
//   icon.png     插件 logo，也是上传（分享）指令的图标
//   download.png 下载指令的图标
// 用法：npm --prefix transfer run logo
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 与「大古截图」同一套视觉：蓝色渐变圆角方块、白色图形、右上角一枚橙色圆点。
// 背景必须是渐变：纯色图标会被 ZTools 在深色主题下整体反色。
// 图形取自 Lucide 的 upload / download（24 网格，箭头在上、托盘在下）。
const GLYPHS = {
  'icon.png': `
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" x2="12" y1="2" y2="15"/>`,
  'download.png': `
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="8 11 12 15 16 11"/>
    <line x1="12" x2="12" y1="2" y2="15"/>`
}

const logoSvg = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f8ff7"/>
      <stop offset="0.55" stop-color="#2f6fe4"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <circle cx="398" cy="118" r="26" fill="#fb923c"/>
  <g transform="translate(96 96) scale(13.3333)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}
  </g>
</svg>`

const executablePath = [
  process.env.DAGU_OCR_PLAYWRIGHT_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((candidate) => candidate && existsSync(candidate))

const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${logoSvg(glyph)}`)
    const target = fileURLToPath(new URL(`../${name}`, import.meta.url))
    await page.locator('svg').screenshot({ path: target, omitBackground: true })
    console.log(`已生成 ${target}`)
  }
} finally {
  await browser.close()
}
