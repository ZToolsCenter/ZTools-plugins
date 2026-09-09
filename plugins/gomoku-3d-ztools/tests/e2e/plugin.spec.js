import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = path.join(projectRoot, 'src-ztools')

/**
 * 在设置插件的 WebContentsView 中执行受控脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 页面脚本执行结果。
 */
async function executeInSettings(electronApp, source) {
  return electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents) throw new Error('未找到设置插件 WebContentsView')
    return contents.executeJavaScript(script)
  }, source)
}

/**
 * 读取设置页正文以等待其完成加载。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @returns {Promise<string>} 设置页正文。
 */
async function readSettingsText(electronApp) {
  return electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  })
}

/**
 * 在五子棋插件页面执行脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面地址。
 * @param {string} source 要执行的脚本。
 * @returns {Promise<unknown>} 页面脚本结果。
 */
async function executeInPlugin(electronApp, expectedUrl, source) {
  return electronApp.evaluate(async ({ webContents }, args) => {
    const candidates = webContents.getAllWebContents().filter((item) => item.getURL() === args.expectedUrl)
    const measured = await Promise.all(candidates.map(async (contents) => ({
      contents,
      area: await contents.executeJavaScript(`Math.max(0, ...[...document.querySelectorAll('canvas')].map((canvas) => canvas.clientWidth * canvas.clientHeight))`).catch(() => 0),
    })))
    const contents = measured.sort((a, b) => b.area - a.area)[0]?.contents
    if (!contents) throw new Error('未找到五子棋插件 WebContentsView')
    return contents.executeJavaScript(args.source)
  }, { expectedUrl, source })
}

/**
 * 通过 Electron 原生输入通道点击可见棋盘中心。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面地址。
 * @returns {Promise<boolean>} 是否找到棋盘并发送了点击。
 */
async function clickPluginBoard(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const candidates = webContents.getAllWebContents().filter((item) => item.getURL() === targetUrl)
    const measured = await Promise.all(candidates.map(async (contents) => ({
      contents,
      area: await contents.executeJavaScript(`Math.max(0, ...[...document.querySelectorAll('canvas')].map((canvas) => canvas.getBoundingClientRect().width * canvas.getBoundingClientRect().height))`).catch(() => 0),
    })))
    const contents = measured.sort((a, b) => b.area - a.area)[0]?.contents
    if (!contents) return false
    const point = await contents.executeJavaScript(`(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => {
        const ar = a.getBoundingClientRect()
        const br = b.getBoundingClientRect()
        return br.width * br.height - ar.width * ar.height
      })[0]
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    })()`)
    if (!point) return false
    contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    contents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    return true
  }, expectedUrl)
}

/**
 * 截取插件画面并统计非背景像素，避免只验证 DOM 而遗漏 WebGL 白屏。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面地址。
 * @returns {Promise<{ready: boolean, text: string, png: string, width: number, height: number, nonBackgroundPixels: number, boardRenderedPixels: number, canvasWidth: number, canvasHeight: number, webglReady: boolean, drawingBufferWidth: number, drawingBufferHeight: number}>} 插件状态。
 */
async function inspectPluginView(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const candidates = webContents.getAllWebContents().filter((item) => item.getURL() === targetUrl)
    const measured = await Promise.all(candidates.map(async (contents) => ({
      contents,
      area: await contents.executeJavaScript(`Math.max(0, ...[...document.querySelectorAll('canvas')].map((canvas) => canvas.clientWidth * canvas.clientHeight))`).catch(() => 0),
    })))
    const contents = measured.sort((a, b) => b.area - a.area)[0]?.contents
    if (!contents || contents.isLoading()) {
      return {
        ready: false,
        text: '',
        png: '',
        width: 0,
        height: 0,
        nonBackgroundPixels: 0,
        boardRenderedPixels: 0,
        canvasWidth: 0,
        canvasHeight: 0,
        webglReady: false,
        drawingBufferWidth: 0,
        drawingBufferHeight: 0,
      }
    }
    const state = await contents.executeJavaScript(`(() => {
      const canvases = [...document.querySelectorAll('canvas')]
      const canvas = canvases.sort((a, b) =>
        b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
      )[0]
      const rect = canvas?.getBoundingClientRect()
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
      return {
        text: document.body?.innerText || '',
        canvasWidth: rect?.width || 0,
        canvasHeight: rect?.height || 0,
        canvasRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        webglReady: !!gl,
        drawingBufferWidth: gl?.drawingBufferWidth || 0,
        drawingBufferHeight: gl?.drawingBufferHeight || 0,
      }
    })()`)
    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (spread > 8 || (red + green + blue) / 3 < 218) nonBackgroundPixels += 1
    }
    let boardRenderedPixels = 0
    if (state.canvasRect && state.canvasRect.width > 0 && state.canvasRect.height > 0) {
      const boardImage = await contents.capturePage({
        x: Math.max(0, Math.floor(state.canvasRect.x)),
        y: Math.max(0, Math.floor(state.canvasRect.y)),
        width: Math.max(1, Math.floor(state.canvasRect.width)),
        height: Math.max(1, Math.floor(state.canvasRect.height)),
      })
      const boardBitmap = boardImage.toBitmap()
      for (let index = 0; index < boardBitmap.length; index += 4) {
        const blue = boardBitmap[index]
        const green = boardBitmap[index + 1]
        const red = boardBitmap[index + 2]
        const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
        if (spread > 14 || (red + green + blue) / 3 < 225) boardRenderedPixels += 1
      }
    }
    return {
      ready: true,
      text: state.text,
      png: image.toPNG().toString('base64'),
      width: image.getSize().width,
      height: image.getSize().height,
      nonBackgroundPixels,
      boardRenderedPixels,
      canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight,
      webglReady: state.webglReady,
      drawingBufferWidth: state.drawingBufferWidth,
      drawingBufferHeight: state.drawingBufferHeight,
    }
  }, expectedUrl)
}

test('可在真实 ZTools 中安装、渲染 WebGL 棋盘并持久化视图设置', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-gomoku-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugin')
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json')
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(pluginConfigPath, 'utf8'))
  delete manifest.development
  await fs.writeFile(pluginConfigPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const expectedUrl = pathToFileURL(path.resolve(pluginRoot, manifest.main)).href
  const screenshotPath = testInfo.outputPath('gomoku-plugin.png')
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await electron.launch({
      executablePath:
        process.env.ZTOOLS_E2E_EXECUTABLE_PATH
        || '/Applications/ZTools.app/Contents/MacOS/ZTools',
      args: [],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      },
    })

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readSettingsText(electronApp), { timeout: 20_000 }).not.toBe('')

    const imported = await executeInSettings(
      electronApp,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`,
    )
    expect(imported).toMatchObject({ success: true })
    const installed = await executeInSettings(
      electronApp,
      `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`,
    )
    expect(installed).toMatchObject({ success: true })
    const launched = await executeInSettings(
      electronApp,
      `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: 'gomoku-3d'}})`,
    )
    expect(launched).toMatchObject({ success: true })

    await expect.poll(
      async () => (await inspectPluginView(electronApp, expectedUrl)).text,
      { timeout: 25_000 },
    ).toContain('五子棋')

    await expect.poll(
      async () => (await inspectPluginView(electronApp, expectedUrl)).canvasWidth,
      { timeout: 20_000 },
    ).toBeGreaterThan(250)
    await expect.poll(
      async () => (await inspectPluginView(electronApp, expectedUrl)).boardRenderedPixels,
      { timeout: 20_000 },
    ).toBeGreaterThan(20_000)
    const inspection = await inspectPluginView(electronApp, expectedUrl)
    expect(inspection.canvasWidth).toBeGreaterThan(250)
    expect(inspection.canvasHeight).toBeGreaterThan(250)
    expect(inspection.webglReady).toBe(true)
    expect(inspection.drawingBufferWidth).toBeGreaterThan(250)
    expect(inspection.drawingBufferHeight).toBeGreaterThan(250)
    expect(inspection.nonBackgroundPixels).toBeGreaterThan(10_000)
    expect(inspection.boardRenderedPixels).toBeGreaterThan(20_000)

    const placed = await clickPluginBoard(electronApp, expectedUrl)
    expect(placed).toBe(true)
    await expect.poll(
      () => executeInPlugin(
        electronApp,
        expectedUrl,
        `Number((document.body?.innerText || '').match(/手数\\s*(\\d+)/)?.[1] || 0)`,
      ),
      { timeout: 10_000 },
    ).toBeGreaterThan(0)

    const switched = await executeInPlugin(
      electronApp,
      expectedUrl,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('2D 平面'))
        if (!button) return false
        button.click()
        return true
      })()`,
    )
    expect(switched).toBe(true)
    await expect.poll(
      () => executeInPlugin(
        electronApp,
        expectedUrl,
        `[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('2D 平面'))?.getAttribute('aria-pressed') || ''`,
      ),
    ).toBe('true')

    await electronApp.evaluate(async ({ webContents }, targetUrl) => {
      const candidates = webContents.getAllWebContents().filter((item) => item.getURL() === targetUrl)
      const measured = await Promise.all(candidates.map(async (contents) => ({
        contents,
        area: await contents.executeJavaScript(`Math.max(0, ...[...document.querySelectorAll('canvas')].map((canvas) => canvas.clientWidth * canvas.clientHeight))`).catch(() => 0),
      })))
      const contents = measured.sort((a, b) => b.area - a.area)[0]?.contents
      if (!contents) throw new Error('未找到插件页面')
      await contents.reload()
    }, expectedUrl)
    await expect.poll(
      () => executeInPlugin(
        electronApp,
        expectedUrl,
        `[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('2D 平面'))?.getAttribute('aria-pressed') || ''`,
      ),
      { timeout: 20_000 },
    ).toBe('true')
    await expect.poll(
      () => executeInPlugin(
        electronApp,
        expectedUrl,
        `Number((document.body?.innerText || '').match(/手数\\s*(\\d+)/)?.[1] || 0)`,
      ),
      { timeout: 20_000 },
    ).toBeGreaterThan(0)

    const bridgeType = await executeInPlugin(
      electronApp,
      expectedUrl,
      `typeof window.gomokuBridge?.saveTextFile`,
    )
    expect(bridgeType).toBe('function')

    await fs.writeFile(screenshotPath, Buffer.from(inspection.png, 'base64'))
    await testInfo.attach('gomoku-plugin', { path: screenshotPath, contentType: 'image/png' })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
