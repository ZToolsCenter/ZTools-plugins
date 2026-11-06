import { expect, test, _electron as electron } from '@playwright/test'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = path.join(projectRoot, 'src-ztools')
const settingsUrlFragment = 'internal-plugins/setting/index.html'

/**
 * 读取由当前运行中 ZTools 进程注入的宿主可执行文件路径。
 * @returns {Promise<string>} ZTools 可执行文件绝对路径。
 * @throws 宿主路径缺失、不是绝对路径或不可执行时抛出。
 */
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

/**
 * 在设置插件的 WebContentsView 中执行受控脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 页面脚本执行结果。
 * @throws 未找到设置页时抛出错误。
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
 * 读取设置插件正文，供 Playwright 轮询加载状态。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @returns {Promise<string>} 设置页正文；尚未完成加载时为空字符串。
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
 * 读取插件页面状态并统计截图中的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面 URL。
 * @returns {Promise<{ready: boolean, text: string, png: string, width: number, height: number, nonBackgroundPixels: number}>} 页面状态和截图。
 * @throws 插件页面脚本或截图失败时抛出错误。
 */
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
    // 防止 DOM 已加载但 Electron 合成层仍为空白。
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
      nonBackgroundPixels,
    }
  }, expectedUrl)
}

/**
 * 在插件页面中执行交互脚本并返回结果。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面 URL。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws 插件页面尚未就绪时抛出错误。
 */
async function executeInPlugin(electronApp, expectedUrl, source) {
  return electronApp.evaluate(
    async ({ webContents }, { targetUrl, script }) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
      if (!contents || contents.isLoading()) throw new Error('插件页面尚未就绪')
      return contents.executeJavaScript(script)
    },
    { targetUrl: expectedUrl, script: source },
  )
}

test('可在隔离的真实 ZTools 中安装并显示生产插件', { timeout: 180_000 }, async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugin')
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json')
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(pluginConfigPath, 'utf8'))
  // 隔离副本禁用开发入口，确保本用例验证构建后的本地页面。
  delete manifest.development
  await fs.writeFile(pluginConfigPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const featureCode = manifest.features?.[0]?.code || 'open'
  const expectedUrl = pathToFileURL(path.resolve(pluginRoot, manifest.main)).href
  const screenshotPath = testInfo.outputPath('plugin-view.png')
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    // 使用当前 ZTools 进程对应的宿主和隔离目录，避免读取或污染用户的真实数据。
    const executablePath = await resolveZToolsExecutable()
    const developmentAppRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
    electronApp = await electron.launch({
      executablePath,
      args: developmentAppRoot ? [developmentAppRoot] : [],
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
    await expect.poll(() => readSettingsText(electronApp), { timeout: 15_000 }).not.toBe('')

    // 通过设置插件的内部 API 导入、安装并启动当前构建产物。
    const imported = await executeInSettings(
      electronApp,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`,
    )
    expect(imported, JSON.stringify(imported)).toMatchObject({ success: true })
    const installed = await executeInSettings(
      electronApp,
      `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`,
    )
    expect(installed, JSON.stringify(installed)).toMatchObject({ success: true })
    const launchResult = await executeInSettings(
      electronApp,
      `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: ${JSON.stringify(featureCode)}}})`,
    )
    expect(launchResult, JSON.stringify(launchResult)).toMatchObject({ success: true })

    await expect.poll(
      async () => (await inspectPluginView(electronApp, expectedUrl)).ready,
      { timeout: 20_000 },
    ).toBe(true)
    const inspection = await inspectPluginView(electronApp, expectedUrl)
    expect(inspection.width).toBeGreaterThan(0)
    expect(inspection.height).toBeGreaterThan(0)
    expect(inspection.nonBackgroundPixels).toBeGreaterThan(50)
    if (process.env.ZTOOLS_E2E_EXPECTED_TEXT) {
      expect(inspection.text).toContain(process.env.ZTOOLS_E2E_EXPECTED_TEXT)
    }

    await fs.writeFile(screenshotPath, Buffer.from(inspection.png, 'base64'))
    await testInfo.attach('plugin-view', {
      path: screenshotPath,
      contentType: 'image/png',
    })

    // —— 业务断言：新建任务、勾选自动分组、设置面板、重载后持久化 ——
    const run = (script) => executeInPlugin(electronApp, expectedUrl, script)
    const groupCount = (group) => run(`document.querySelector('[data-count="${group}"]')?.textContent ?? ''`)

    expect(await run('document.body.innerText')).toContain('待处理')
    expect(await groupCount('pending')).toBe('0')

    // 输入两条任务：Enter 提交，新任务始终进入待处理分组。
    await run(`(() => {
      const input = document.querySelector('.new-task-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const add = (text) => {
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      }
      add('E2E 任务一')
      add('E2E 任务二')
      return true
    })()`)
    await expect.poll(() => groupCount('pending'), { timeout: 10_000 }).toBe('2')
    expect(await groupCount('done')).toBe('0')
    expect(await run('document.body.innerText')).toContain('E2E 任务一')

    // 勾选任务后自动移入已完成分组。
    await run(`document.querySelector('.task-card .check').click(); true`)
    await expect.poll(() => groupCount('pending'), { timeout: 10_000 }).toBe('1')
    await expect.poll(() => groupCount('done'), { timeout: 10_000 }).toBe('1')

    // 切到已完成分组：任务在列且保持勾选态。
    await run(`[...document.querySelectorAll('.group-item')].find((button) => button.textContent.includes('已完成')).click(); true`)
    await expect
      .poll(
        () =>
          run(
            `document.body.innerText.includes('E2E 任务二') && Boolean(document.querySelector('.task-card .check[aria-checked="true"]'))`,
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
    expect(await groupCount('done')).toBe('1')

    // 取消勾选后任务回到待处理分组。
    await run(`document.querySelector('.task-card .check').click(); true`)
    await expect.poll(() => groupCount('pending'), { timeout: 10_000 }).toBe('2')
    await expect.poll(() => groupCount('done'), { timeout: 10_000 }).toBe('0')

    // 切回待处理分组后两张任务卡都在列。
    await run(`[...document.querySelectorAll('.group-item')].find((button) => button.textContent.includes('待处理')).click(); true`)
    await expect.poll(() => run(`document.querySelectorAll('.task-card').length`), { timeout: 10_000 }).toBe(2)

    // ? 打开设置面板，切换 Markdown 开关，Esc 关闭。
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); true`)
    await expect
      .poll(() => run(`document.body.innerText.includes('Vim 快捷键')`), { timeout: 10_000 })
      .toBe(true)
    await run(`document.querySelector('.settings-panel .switch').click(); true`)
    await expect
      .poll(
        () => run(`document.querySelector('.settings-panel .switch').getAttribute('aria-checked')`),
        { timeout: 10_000 },
      )
      .toBe('true')
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await expect.poll(() => run(`!document.querySelector('.settings-panel')`), { timeout: 10_000 }).toBe(true)

    // 勾选一条任务使其进入已完成，再验证两段式清空。
    await run(`document.querySelector('.task-card .check').click(); true`)
    await expect.poll(() => groupCount('done'), { timeout: 10_000 }).toBe('1')
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); true`)
    await expect
      .poll(() => run(`document.querySelector('.settings-panel') !== null`), { timeout: 10_000 })
      .toBe(true)
    // 首次点击仅武装确认，数据保持不变。
    await run(`document.querySelector('.danger-button').click(); true`)
    await expect
      .poll(
        () => run(`document.querySelector('.danger-button').textContent.includes('再次点击')`),
        { timeout: 10_000 },
      )
      .toBe(true)
    expect(await groupCount('done')).toBe('1')
    // 二次点击执行清空。
    await run(`document.querySelector('.danger-button').click(); true`)
    await expect.poll(() => groupCount('done'), { timeout: 10_000 }).toBe('0')
    await expect.poll(() => groupCount('pending'), { timeout: 10_000 }).toBe('1')
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
    await expect.poll(() => run(`!document.querySelector('.settings-panel')`), { timeout: 10_000 }).toBe(true)

    // 重新加载插件页面：任务与设置从宿主存储恢复。
    await electronApp.evaluate(
      ({ webContents }, targetUrl) => {
        const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
        if (!contents) throw new Error('未找到插件页面')
        contents.reload()
      },
      expectedUrl,
    )
    try {
      await expect
        .poll(async () => (await inspectPluginView(electronApp, expectedUrl)).ready, {
          timeout: 20_000,
        })
        .toBe(true)
    } catch (error) {
      // 定位失败时输出全部 WebContents 状态，便于区分“页面仍在加载”和“视图已销毁”。
      const state = await electronApp.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((item) => ({
          url: item.getURL(),
          loading: item.isLoading(),
        })),
      )
      throw new Error(`重载后插件页面未就绪，WebContents：${JSON.stringify(state)}`)
    }
    const reloaded = await inspectPluginView(electronApp, expectedUrl)
    expect(reloaded.text).toContain('待处理')
    expect(reloaded.text).toContain('E2E 任务一')
    expect(reloaded.text).not.toContain('E2E 任务二')
    expect(await groupCount('pending')).toBe('1')
    expect(await groupCount('done')).toBe('0')

    // 重载后设置仍然生效：Markdown 开关保持开启。
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); true`)
    await expect
      .poll(() => run(`document.querySelector('.settings-panel .switch').getAttribute('aria-checked')`), {
        timeout: 10_000,
      })
      .toBe('true')
    const finalScreenshotPath = testInfo.outputPath('plugin-view-final.png')
    const finalInspection = await inspectPluginView(electronApp, expectedUrl)
    await fs.writeFile(finalScreenshotPath, Buffer.from(finalInspection.png, 'base64'))
    await testInfo.attach('plugin-view-final', {
      path: finalScreenshotPath,
      contentType: 'image/png',
    })
  } finally {
    // 无论断言是否成功，都释放测试实例并删除本次创建的数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
