import { expect, test, _electron as electron } from '@playwright/test'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = path.join(projectRoot, 'src-ztools')

async function resolveZToolsExecutable() {
  const executablePath = String(process.env.ZTOOLS_E2E_EXECUTABLE_PATH || '').trim()
  if (!executablePath) throw new Error('当前 ZTools 进程未提供宿主路径，请从 ZVC 中运行测试')
  if (!path.isAbsolute(executablePath)) throw new Error('ZTOOLS_E2E_EXECUTABLE_PATH 必须是绝对路径')
  try {
    await fs.access(executablePath, fsConstants.X_OK)
    return executablePath
  } catch {
    throw new Error(`当前 ZTools 宿主不存在或不可执行：${executablePath}`)
  }
}

async function executeInSettings(electronApp, source) {
  const fragment = 'internal-plugins/setting/index.html'
  return electronApp.evaluate(
    async ({ webContents }, args) => {
      const { script, fragment: target } = args
      const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(target))
      if (!contents) throw new Error('未找到设置插件 WebContentsView')
      return contents.executeJavaScript(script)
    },
    { script: source, fragment },
  )
}

async function readSettingsText(electronApp) {
  const fragment = 'internal-plugins/setting/index.html'
  return electronApp.evaluate(async ({ webContents }, target) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(target))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, fragment)
}

async function readPluginText(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, expectedUrl)
}

async function runScriptOnPlugin(electronApp, expectedUrl, script) {
  return electronApp.evaluate(async ({ webContents }, args) => {
    const { targetUrl, source } = args
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents) throw new Error(`未找到插件页面：${targetUrl}`)
    return contents.executeJavaScript(source)
  }, { targetUrl: expectedUrl, source: script })
}

async function inspectPluginView(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents || contents.isLoading()) {
      return { ready: false, text: '', png: '', width: 0, height: 0, nonBackgroundPixels: 0 }
    }
    const text = await contents.executeJavaScript('document.body?.innerText || ""')
    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (spread > 8 || (red + green + blue) / 3 < 220) nonBackgroundPixels += 1
    }
    return {
      ready: true,
      text,
      png: image.toPNG().toString('base64'),
      width: image.getSize().width,
      height: image.getSize().height,
      nonBackgroundPixels
    }
  }, expectedUrl)
}

test('隔离 ZTools 环境可安装并跑通税前/税后双向计算', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugin')
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json')
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(pluginConfigPath, 'utf8'))
  delete manifest.development
  await fs.writeFile(pluginConfigPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const expectedUrl = pathToFileURL(path.resolve(pluginRoot, manifest.main)).href
  const screenshotPath = testInfo.outputPath('plugin-view.png')
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    const executablePath = await resolveZToolsExecutable()
    const developmentAppRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
    electronApp = await electron.launch({
      executablePath,
      args: developmentAppRoot ? [developmentAppRoot] : [],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot
      }
    })

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readSettingsText(electronApp), { timeout: 15_000 }).not.toBe('')

    const imported = await executeInSettings(electronApp, `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`)
    expect(imported, JSON.stringify(imported)).toMatchObject({ success: true })
    const installed = await executeInSettings(electronApp, `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`)
    expect(installed, JSON.stringify(installed)).toMatchObject({ success: true })
    const launchResult = await executeInSettings(electronApp, `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: 'open'}})`)
    expect(launchResult, JSON.stringify(launchResult)).toMatchObject({ success: true })

    await expect.poll(async () => (await inspectPluginView(electronApp, expectedUrl)).ready, { timeout: 20_000 }).toBe(true)

    // 打开后不预置任何数字，只显示空态提示。
    await expect
      .poll(() => readPluginText(electronApp, expectedUrl), { timeout: 10_000 })
      .toContain('劳务报酬计算器')
    await expect
      .poll(() => readPluginText(electronApp, expectedUrl), { timeout: 10_000 })
      .toContain('输入金额后自动计算')

    // 输入 10000 元税前 → 税后 8400 元，预扣个税 1600 元（预扣率表二 20%）。
    const fillGrossScript = `(async () => {
      const el = document.querySelector('[data-testid="gross-input"]')
      if (!el) return 'missing'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '10000')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`
    expect(await runScriptOnPlugin(electronApp, expectedUrl, fillGrossScript)).toBe('ok')
    await expect
      .poll(() => readPluginText(electronApp, expectedUrl), { timeout: 10_000 })
      .toContain('8,400.00')
    await expect
      .poll(() => readPluginText(electronApp, expectedUrl), { timeout: 10_000 })
      .toContain('1,600.00')

    // 切换到税后 → 税前，输入 8400 反推税前 10000 元。
    const clickTabScript = `(() => {
      const el = document.querySelector('[data-testid="tab-reverse"]')
      if (!el) return false
      el.click()
      return true
    })()`
    await runScriptOnPlugin(electronApp, expectedUrl, clickTabScript)
    const fillNetScript = `(async () => {
      const el = document.querySelector('[data-testid="net-input"]')
      if (!el) return 'missing'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '8400')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`
    expect(await runScriptOnPlugin(electronApp, expectedUrl, fillNetScript)).toBe('ok')
    const scriptReverse = `(async () => {
      const text = document.body.innerText
      return { text, hasNet: !!document.querySelector('[data-testid="net-input"]') }
    })()`
    await expect.poll(async () => (await runScriptOnPlugin(electronApp, expectedUrl, scriptReverse)).text, { timeout: 10_000 })
      .toContain('10,000.00')
    await expect.poll(async () => (await runScriptOnPlugin(electronApp, expectedUrl, scriptReverse)).text, { timeout: 10_000 })
      .toContain('税后 → 税前')

    // 清空输入应展示提示，而不是残留旧结果。
    const clearScript = `(async () => {
      const el = document.querySelector('[data-testid="net-input"]')
      if (!el) return 'missing'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`
    expect(await runScriptOnPlugin(electronApp, expectedUrl, clearScript)).toBe('ok')
    await expect
      .poll(async () => (await runScriptOnPlugin(electronApp, expectedUrl, scriptReverse)).text, { timeout: 10_000 })
      .toContain('输入金额后自动计算')

    const inspection = await inspectPluginView(electronApp, expectedUrl)
    expect(inspection.width).toBeGreaterThan(0)
    expect(inspection.height).toBeGreaterThan(0)
    expect(inspection.nonBackgroundPixels).toBeGreaterThan(50)
    await fs.writeFile(screenshotPath, Buffer.from(inspection.png, 'base64'))
    await testInfo.attach('plugin-view', { path: screenshotPath, contentType: 'image/png' })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
