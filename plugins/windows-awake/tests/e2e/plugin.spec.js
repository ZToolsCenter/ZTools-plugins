import { expect, test, _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = path.join(projectRoot, 'src-ztools')
const settingsUrlFragment = 'internal-plugins/setting/index.html'
/** 不允许息屏 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED。 */
const KEEP_SYSTEM_AND_DISPLAY_FLAGS = 0x80000003
/** 允许息屏 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED。 */
const KEEP_SYSTEM_FLAGS = 0x80000001

let dataRoot = ''
let legacyRoot = ''
let pluginRoot = ''
let pluginConfigPath = ''
let manifest = null
let expectedUrl = ''
let featureCode = ''
let electronApp = null

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
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 页面脚本执行结果。
 * @throws 未找到设置页时抛出错误。
 */
async function executeInSettings(app, source) {
  return app.evaluate(async ({ webContents }, script) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents) throw new Error('未找到设置插件 WebContentsView')
    return contents.executeJavaScript(script)
  }, source)
}

/**
 * 在插件页面中执行脚本，用于读取状态和触发交互。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 页面脚本执行结果。
 * @throws 未找到插件页面时抛出错误。
 */
async function executeInPlugin(app, source) {
  return app.evaluate(
    async ({ webContents }, payload) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === payload.url)
      if (!contents) {
        const urls = webContents.getAllWebContents().map((item) => item.getURL())
        throw new Error(`未找到插件页面：${payload.url}\n当前页面：${urls.join('\n')}`)
      }
      return contents.executeJavaScript(payload.source)
    },
    { url: expectedUrl, source }
  )
}

/**
 * 读取设置插件正文，供 Playwright 轮询加载状态。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @returns {Promise<string>} 设置页正文；尚未完成加载时为空字符串。
 */
async function readSettingsText(app) {
  return app.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  })
}

/**
 * 插件页面中某个元素的可读文本。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} selector CSS 选择器。
 * @returns {Promise<string>} 元素文本；元素不存在时返回空字符串。
 */
async function readPluginText(app, selector) {
  return executeInPlugin(
    app,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || '').trim() : '' })()`
  )
}

/**
 * 在插件页面中点击元素。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} selector CSS 选择器。
 * @returns {Promise<boolean>} 是否成功点击。
 */
async function clickPluginElement(app, selector) {
  return executeInPlugin(
    app,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`
  )
}

/**
 * 读取页面上的 aria-checked 状态。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} selector CSS 选择器。
 * @returns {Promise<string>} aria-checked 的值。
 */
async function readPluginChecked(app, selector) {
  return executeInPlugin(
    app,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? String(el.getAttribute('aria-checked')) : 'missing' })()`
  )
}

/**
 * 读取插件内由 preload 提供的真实状态。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @returns {Promise<object>} awakeBridge.getStatus() 的结果。
 */
async function readBridgeStatus(app) {
  return executeInPlugin(app, 'window.awakeBridge.getStatus()')
}

/**
 * 写入输入框的值并触发 Vue 的 v-model 与 change 处理。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} selector CSS 选择器。
 * @param {string} value 要写入的值。
 * @returns {Promise<boolean>} 是否成功写入。
 */
async function setPluginInputValue(app, selector, value) {
  return executeInPlugin(
    app,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  )
}

/**
 * 枚举当前系统中由本插件守护脚本启动的 PowerShell 进程。
 * 查询脚本写入文件后以 -File 运行，避免嵌套引号在 -Command 中被重新解析。
 * @returns {Promise<{pid: number, commandLine: string}[]>} 守护进程列表。
 */
async function listGuardProcesses() {
  const queryScript = path.join(dataRoot, 'list-guards.ps1')
  const source = [
    'Get-CimInstance Win32_Process -Filter "Name = \'powershell.exe\'" |',
    "  Where-Object { $_.CommandLine -like '*awake-guard.ps1*' -and $_.CommandLine -like '*--zvc-awake-guard*' } |",
    '  ForEach-Object { \'{0}|{1}\' -f $_.ProcessId, $_.CommandLine }'
  ].join('\n')
  await fs.writeFile(queryScript, `${'\uFEFF'}${source}\n`, 'utf8')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', queryScript],
    { encoding: 'utf8', windowsHide: true }
  )
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('|')
      return { pid: Number(line.slice(0, separator)), commandLine: line.slice(separator + 1) }
    })
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0)
}

/**
 * 启动一个使用隔离数据目录的 ZTools 实例。
 * @returns {Promise<import('@playwright/test').ElectronApplication>} 隔离实例。
 */
async function launchIsolatedApp() {
  const executablePath = await resolveZToolsExecutable()
  const developmentAppRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
  return electron.launch({
    executablePath,
    args: developmentAppRoot ? [developmentAppRoot] : [],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_E2E: '1',
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot
    }
  })
}

/**
 * 打开通用设置并通过内部 API 导入、安装开发插件。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @returns {Promise<void>} 无返回值。
 */
async function prepareSettingsPage(app) {
  const page = await app.firstWindow()
  const searchInput = page.locator('.search-input')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('通用设置')
  await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
  await expect.poll(() => readSettingsText(app), { timeout: 15_000 }).not.toBe('')

  const imported = await executeInSettings(
    app,
    `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`
  )
  expect(imported, JSON.stringify(imported)).toMatchObject({ success: true })
  const installed = await executeInSettings(
    app,
    `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`
  )
  expect(installed, JSON.stringify(installed)).toMatchObject({ success: true })
}

/**
 * 以指定功能 code 启动插件页面。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @returns {Promise<void>} 无返回值。
 */
async function launchPlugin(app) {
  const launched = await executeInSettings(
    app,
    `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: ${JSON.stringify(featureCode)}}})`
  )
  expect(launched, JSON.stringify(launched)).toMatchObject({ success: true })
  await expect
    .poll(
      async () => {
        return app.evaluate(
          async ({ webContents }, url) => {
            const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
            if (!contents || contents.isLoading()) return ''
            return contents.executeJavaScript('document.body?.innerText || ""')
          },
          expectedUrl
        )
      },
      { timeout: 20_000 }
    )
    .toContain('Windows 唤醒控制')
}

/**
 * 读取插件页面状态并统计截图中的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @returns {Promise<{ready: boolean, text: string, png: string, width: number, height: number, nonBackgroundPixels: number}>} 页面状态和截图。
 */
async function inspectPluginView(app) {
  return app.evaluate(async ({ webContents }, targetUrl) => {
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
      nonBackgroundPixels
    }
  }, expectedUrl)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
  legacyRoot = path.join(dataRoot, 'legacy')
  await fs.mkdir(legacyRoot, { recursive: true })
  // 使用构建产物的隔离副本，并禁用开发入口以验证生产页面。
  pluginRoot = path.join(dataRoot, 'plugin')
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
  pluginConfigPath = path.join(pluginRoot, 'plugin.json')
  manifest = JSON.parse(await fs.readFile(pluginConfigPath, 'utf8'))
  delete manifest.development
  await fs.writeFile(pluginConfigPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  featureCode = manifest.features?.[0]?.code || 'open'
  expectedUrl = pathToFileURL(path.resolve(pluginRoot, manifest.main)).href

  electronApp = await launchIsolatedApp()
  await prepareSettingsPage(electronApp)
  await launchPlugin(electronApp)
})

test.afterAll(async () => {
  await electronApp?.close()
  electronApp = null
  await fs.rm(dataRoot, { recursive: true, force: true })
})

test('可在隔离的真实 ZTools 中安装、启动并控制 Windows 唤醒', async ({}, testInfo) => {
  const baselineGuards = await listGuardProcesses()

  // 初始状态：未唤醒，桥接与常量可用。
  const constants = await executeInPlugin(electronApp, 'window.awakeBridge.constants')
  expect(constants.MAX_DURATION_MINUTES).toBe(1440)
  expect(constants.ES_DISPLAY_REQUIRED).toBe(2)
  const initialStatus = await readBridgeStatus(electronApp)
  expect(initialStatus.active).toBe(false)
  await expect.poll(() => readPluginText(electronApp, '[data-testid="countdown"]')).toBe('未唤醒')

  // 选择 15 分钟 + 不允许息屏后开始保持唤醒。
  expect(await clickPluginElement(electronApp, '[data-testid="preset-15"]')).toBe(true)
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="preset-15"]')).toBe('true')
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="choice-no-screen-off"]')).toBe('true')
  expect(await clickPluginElement(electronApp, '[data-testid="toggle"]')).toBe(true)
  await expect.poll(() => readPluginText(electronApp, '[data-testid="toggle"]'), { timeout: 20_000 }).toBe(
    '停止保持唤醒'
  )

  // preload 上报的状态必须与真实守护进程一致：15 分钟定时、同时保持屏幕点亮。
  await expect
    .poll(async () => (await readBridgeStatus(electronApp)).active, { timeout: 20_000 })
    .toBe(true)
  const running = await readBridgeStatus(electronApp)
  expect(running.keepDisplay).toBe(true)
  expect(running.flags).toBe(KEEP_SYSTEM_AND_DISPLAY_FLAGS)
  expect(running.endsAt - running.startedAt).toBe(15 * 60 * 1000)
  expect(running.remainingSeconds).toBeGreaterThan(14 * 60)

  // 状态与运行时文件写入隔离的数据目录，不会污染用户真实数据。
  const userDataPath = await executeInPlugin(electronApp, "window.ztools.getPath('userData')")
  const runtimeDir = path.join(userDataPath, 'windows-awake')
  expect(path.resolve(userDataPath).startsWith(path.resolve(dataRoot))).toBe(true)
  const stateFile = path.join(runtimeDir, 'guard-state.json')
  const statePayload = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  expect(statePayload.pid).toBe(running.pid)
  expect(statePayload.keepDisplay).toBe(true)
  expect(statePayload.durationMinutes).toBe(15)

  // 系统中确实存在带有本插件标记的守护进程，并且请求了屏幕唤醒。
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 20_000 })
    .toBe(baselineGuards.length + 1)
  const guard = (await listGuardProcesses()).find((item) => item.pid === running.pid)
  expect(guard).toBeTruthy()
  expect(guard.commandLine).toContain('--zvc-awake-guard')
  expect(guard.commandLine).toContain('-KeepDisplay')

  // 倒计时在界面中持续走字。
  const countdownBefore = await readPluginText(electronApp, '[data-testid="countdown"]')
  expect(countdownBefore).toMatch(/^\d{2}:\d{2}$/)
  await expect
    .poll(() => readPluginText(electronApp, '[data-testid="countdown"]'), { timeout: 10_000 })
    .not.toBe(countdownBefore)

  // 运行中切换为允许息屏：立即下发新的标志位，并保留剩余时长。
  expect(await clickPluginElement(electronApp, '[data-testid="choice-allow-screen-off"]')).toBe(true)
  await expect
    .poll(async () => (await readBridgeStatus(electronApp)).flags, { timeout: 20_000 })
    .toBe(KEEP_SYSTEM_FLAGS)
  const afterSwitch = await readBridgeStatus(electronApp)
  expect(afterSwitch.keepDisplay).toBe(false)
  expect(afterSwitch.pid).not.toBe(running.pid)
  expect(Math.abs(afterSwitch.endsAt - running.endsAt)).toBeLessThan(10_000)
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 20_000 })
    .toBe(baselineGuards.length + 1)

  const inspection = await inspectPluginView(electronApp)
  expect(inspection.ready).toBe(true)
  expect(inspection.text).toContain('保持唤醒中')
  expect(inspection.width).toBeGreaterThan(0)
  expect(inspection.height).toBeGreaterThan(0)
  expect(inspection.nonBackgroundPixels).toBeGreaterThan(50)
  const screenshotPath = testInfo.outputPath('awake-running.png')
  await fs.writeFile(screenshotPath, Buffer.from(inspection.png, 'base64'))
  await testInfo.attach('awake-running', { path: screenshotPath, contentType: 'image/png' })

  // 暗色主题下同样可读：在渲染器中仿真系统深色偏好，卡片、选中项与状态色都应切换。
  const darkTheme = await electronApp.evaluate(
    async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
      contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'dark' }]
      })
      return contents.executeJavaScript(`JSON.stringify({
        matches: window.matchMedia('(prefers-color-scheme: dark)').matches,
        body: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(document.querySelector('.awake__card')).backgroundColor
      })`)
    },
    expectedUrl
  )
  const darkStyles = JSON.parse(darkTheme)
  expect(darkStyles.matches).toBe(true)
  expect(darkStyles.body).toBe('rgb(27, 31, 39)')
  expect(darkStyles.card).toBe('rgb(38, 43, 53)')
  await expect
    .poll(async () => (await inspectPluginView(electronApp)).nonBackgroundPixels > 50, { timeout: 10_000 })
    .toBe(true)
  const darkInspection = await inspectPluginView(electronApp)
  expect(darkInspection.text).toContain('保持唤醒中')
  expect(darkInspection.text).toContain('允许息屏')
  const darkScreenshotPath = testInfo.outputPath('awake-running-dark.png')
  await fs.writeFile(darkScreenshotPath, Buffer.from(darkInspection.png, 'base64'))
  await testInfo.attach('awake-running-dark', { path: darkScreenshotPath, contentType: 'image/png' })

  // 停止保持唤醒：状态、界面与系统进程都要回到未唤醒。
  expect(await clickPluginElement(electronApp, '[data-testid="toggle"]')).toBe(true)
  await expect.poll(() => readPluginText(electronApp, '[data-testid="toggle"]'), { timeout: 20_000 }).toBe(
    '开始保持唤醒'
  )
  expect((await readBridgeStatus(electronApp)).active).toBe(false)
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 20_000 })
    .toBe(baselineGuards.length)
  await expect.poll(() => fs.readFile(stateFile, 'utf8').then(() => true, () => false)).toBe(false)

  // 停止后界面保留最近一次选择，且不显示错误。
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="preset-15"]')).toBe('true')
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="choice-allow-screen-off"]')).toBe('true')
  expect(await readPluginText(electronApp, '[data-testid="error"]')).toBe('')

  // “一直保持”不带结束时间，界面显示不限时，同时可以切回不允许息屏。
  expect(await clickPluginElement(electronApp, '[data-testid="choice-no-screen-off"]')).toBe(true)
  expect(await clickPluginElement(electronApp, '[data-testid="preset-0"]')).toBe(true)
  expect(await clickPluginElement(electronApp, '[data-testid="toggle"]')).toBe(true)
  await expect
    .poll(async () => (await readBridgeStatus(electronApp)).active, { timeout: 20_000 })
    .toBe(true)
  const endless = await readBridgeStatus(electronApp)
  expect(endless.endsAt).toBe(null)
  expect(endless.remainingSeconds).toBe(null)
  expect(endless.keepDisplay).toBe(true)
  expect(endless.flags).toBe(KEEP_SYSTEM_AND_DISPLAY_FLAGS)
  await expect.poll(() => readPluginText(electronApp, '[data-testid="countdown"]')).toBe('不限时')
  const endlessState = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  expect(endlessState.endsAt).toBe(null)
  expect(endlessState.durationMinutes).toBe(0)
  expect(await clickPluginElement(electronApp, '[data-testid="toggle"]')).toBe(true)
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 20_000 })
    .toBe(baselineGuards.length)

  // 自定义时长写入宿主存储，并在重启后保留。
  expect(await clickPluginElement(electronApp, '[data-testid="preset-custom"]')).toBe(true)
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="preset-custom"]')).toBe('true')
  expect(await setPluginInputValue(electronApp, '[data-testid="custom-minutes"]', '20')).toBe(true)
  await expect
    .poll(async () => executeInPlugin(electronApp, 'window.awakeBridge.getConfig()'), { timeout: 10_000 })
    .toEqual({ durationMinutes: 20, keepDisplay: true })
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="preset-15"]')).toBe('false')
  expect(await readPluginText(electronApp, '[data-testid="error"]')).toBe('')
})

test('重启 ZTools 后保留设置，且退出宿主时不留残余进程', async () => {
  await electronApp.close()
  electronApp = await launchIsolatedApp()
  await prepareSettingsPage(electronApp)
  await launchPlugin(electronApp)

  // 上一次会话的选择通过宿主存储保留下来。
  const config = await executeInPlugin(electronApp, 'window.awakeBridge.getConfig()')
  expect(config).toEqual({ durationMinutes: 20, keepDisplay: true })
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="preset-custom"]')).toBe('true')
  expect(await executeInPlugin(electronApp, 'document.querySelector(\'[data-testid="custom-minutes"]\').value')).toBe('20')
  await expect.poll(() => readPluginChecked(electronApp, '[data-testid="choice-no-screen-off"]')).toBe('true')
  expect((await readBridgeStatus(electronApp)).active).toBe(false)

  // 启动后直接关闭宿主，守护进程应自行退出。
  const baselineGuards = await listGuardProcesses()
  expect(await clickPluginElement(electronApp, '[data-testid="toggle"]')).toBe(true)
  await expect
    .poll(async () => (await readBridgeStatus(electronApp)).active, { timeout: 20_000 })
    .toBe(true)
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 20_000 })
    .toBe(baselineGuards.length + 1)

  await electronApp.close()
  electronApp = null
  await expect
    .poll(async () => (await listGuardProcesses()).length, { timeout: 30_000 })
    .toBe(baselineGuards.length)
})
