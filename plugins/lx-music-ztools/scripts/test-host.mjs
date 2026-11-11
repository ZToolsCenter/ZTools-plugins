import { _electron as electron, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const data = mkdtempSync(join(tmpdir(), 'lx-ztools-e2e-'))
const evidence = resolve('../output/lx-music-ztools')
mkdirSync(join(data, 'legacy'))
mkdirSync(evidence, { recursive: true })
const production = process.argv.includes('--production')
const server = production ? null : await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } })
await server?.listen()
let app
try {
  app = await electron.launch({ executablePath: process.env.ZTOOLS_EXECUTABLE || resolve('node_modules/electron/dist/electron.exe'),
    args: [process.env.ZTOOLS_APP || 'D:/Program Files/ZTools/resources/app.asar'],
    env: { ...process.env, ZTOOLS_DATA_ROOT: data, ZTOOLS_LEGACY_USER_DATA_PATH: join(data, 'legacy'), ZTOOLS_E2E: '1' }, timeout: 45000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.search-input', { timeout: 30000 })
  // 在隔离实例中调用宿主实际注册的处理器，避免弹出文件选择对话框。
  const registration = await app.evaluate(async ({ ipcMain, BrowserWindow }, options) => {
    const sender = BrowserWindow.getAllWindows().find(x => x.getTitle() === 'ZTools').webContents
    const handlers = ipcMain._invokeHandlers
    if (options.production) {
      const installed = await handlers.get('install-plugin-from-path')({ sender }, options.zip)
      return { installed }
    }
    const result = await handlers.get('upsert-dev-project-by-config-path')({ sender }, options.file)
    if (!result.success) throw new Error(JSON.stringify(result))
    const installed = await handlers.get('install-dev-plugin')({ sender }, result.pluginName || 'lx-music-ztools')
    return { result, installed }
  }, { production, file: resolve('src-ztools/plugin.json'), zip: resolve('../output/lx-music-ztools/lx-music-ztools-0.0.1.zip') })
  assert.equal(registration.installed.success, true)
  await page.locator('.search-input').fill('洛雪音乐')
  const result = page.locator('.app-item').filter({ hasText: '洛雪音乐' }).first()
  try { await expect(result).toBeVisible({ timeout: 15000 }) }
  catch (error) { console.log('SEARCH STATE', await page.locator('body').innerText()); throw error }
  await result.click()
  const match = production ? 'dist/index.html' : '127.0.0.1:5173'
  await expect.poll(async () => app.evaluate(({ webContents }, match) => webContents.getAllWebContents().map(x => x.getURL()).find(x => x.includes(match)) || '', match), { timeout: 20000 }).toContain(match)
  // WebContentsView 不一定出现在 windows() 中，用其实际 webContents 检查并截图。
  const snapshot = await app.evaluate(async ({ webContents }, match) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes(match))
    const state = await wc.executeJavaScript(`({text:document.body.innerText,host:window.services.diagnose(),count:window.services.getLaunchCount(),storage:window.services.checkStorage()})`)
    const image = await wc.capturePage()
    return { ...state, png: image.toPNG().toString('base64') }
  }, match)
  assert.equal(snapshot.host.app, 'ZTools')
  assert.ok(snapshot.count >= 1)
  assert.equal(snapshot.storage, true)
  assert.match(snapshot.text, /框架验证版/)
  assert.match(snapshot.text, /music/)
  writeFileSync(join(evidence, production ? 'host-production.png' : 'host-plugin.png'), Buffer.from(snapshot.png, 'base64'))
  delete snapshot.png
  writeFileSync(join(evidence, production ? 'host-production.json' : 'host-test.json'), JSON.stringify({ result: 'PASS', mode: production ? 'ZTools app.asar on Electron 42.3.3, isolated data, production ZIP' : 'ZTools app.asar on Electron 42.3.3, isolated data, development plugin', data, registration, snapshot }, null, 2))
  console.log('PASS ZTools 加载、搜索触发、生命周期、preload 和存储', snapshot.host)
} finally {
  if (app) await app.close()
  await server?.close()
}
