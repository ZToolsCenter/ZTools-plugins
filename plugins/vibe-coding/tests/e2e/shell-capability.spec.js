import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createZToolsLaunchOptions, getZToolsSettingsUrlFragment } from './ztools-launch.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginConfigPath = path.join(projectRoot, 'public', 'plugin.json')
const pluginDevelopmentPath = path.dirname(pluginConfigPath)
const pluginUrl = 'http://127.0.0.1:15240'
const settingsUrl = getZToolsSettingsUrlFragment()

/**
 * 在指定 WebContentsView 中执行脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlPrefix 目标 URL 片段。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws {Error} 目标 WebContentsView 不存在或脚本执行失败时抛出。
 */
async function executeInContents(electronApp, urlPrefix, source) {
  return electronApp.evaluate(async ({ webContents }, { prefix, script }) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(prefix))
    if (!contents) throw new Error(`未找到 ${prefix} 对应的 WebContentsView`)
    return contents.executeJavaScript(script)
  }, { prefix: urlPrefix, script: source })
}

/**
 * 读取指定 WebContentsView 的正文文本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlPrefix 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；尚未加载时返回空字符串。
 */
async function readContentsText(electronApp, urlPrefix) {
  return electronApp.evaluate(async ({ webContents }, prefix) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(prefix))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body.innerText')
  }, urlPrefix)
}

/**
 * 截取能力弹窗并统计足够暗的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, darkPixels: number, width: number, height: number}>} 截图与像素统计。
 * @throws {Error} 插件视图或能力弹窗不存在时抛出。
 */
async function captureCapabilityPanel(electronApp) {
  return electronApp.evaluate(async ({ webContents }, prefix) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().startsWith(prefix))
    if (!contents) throw new Error('未找到 ZVC WebContentsView')

    const rect = await contents.executeJavaScript(`(() => {
      const panel = document.querySelector('.capability-popover')
      if (!panel) throw new Error('能力弹窗未打开')
      const bounds = panel.getBoundingClientRect()
      return {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
      }
    })()`)
    const image = await contents.capturePage(rect)
    const bitmap = image.toBitmap()
    let darkPixels = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      if ((red + green + blue) / 3 < 190) darkPixels += 1
    }
    return {
      png: image.toPNG().toString('base64'),
      darkPixels,
      width: image.getSize().width,
      height: image.getSize().height,
    }
  }, pluginUrl)
}

test('Shell Executor 分组切换后能力弹窗仍正常绘制', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-shell-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const searchRoot = path.join(dataRoot, 'search-fixture')
  const cancelMarker = path.join(dataRoot, 'cancelled-process-must-not-write.txt')
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.mkdir(path.join(searchRoot, 'src'), { recursive: true })
  await fs.mkdir(path.join(searchRoot, 'ignored'), { recursive: true })
  await fs.writeFile(path.join(searchRoot, '.gitignore'), 'ignored/\n')
  await fs.writeFile(path.join(searchRoot, 'src', 'visible.txt'), 'needle-visible\n')
  await fs.writeFile(path.join(searchRoot, 'ignored', 'hidden.txt'), 'needle-hidden\n')

  try {
    const launchOptions = createZToolsLaunchOptions(dataRoot, legacyRoot)
    electronApp = await electron.launch(launchOptions)

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => readContentsText(electronApp, settingsUrl), { timeout: 15_000 })
      .toContain('开机自动启动')

    const imported = await executeInContents(
      electronApp,
      settingsUrl,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`
    )
    expect(imported).toMatchObject({ success: true, pluginName: 'ztools-vibe-coding' })
    const installed = await executeInContents(
      electronApp,
      settingsUrl,
      `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`
    )
    expect(installed).toMatchObject({ success: true })

    const pluginList = await executeInContents(
      electronApp,
      settingsUrl,
      'window.ztools.internal.getAllPlugins()'
    )
    const developmentPlugin = pluginList.find(
      (plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment
    )
    expect(developmentPlugin?.path).toBe(pluginDevelopmentPath)

    const launchResult = await executeInContents(
      electronApp,
      settingsUrl,
      `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`
    )
    expect(launchResult).toMatchObject({ success: true })
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain('全能 AI 助手')

    // ZVC 子进程必须继承当前 Electron 宿主路径，不能自行扫描到另一安装版本。
    const hostPathCommand = `node -e "process.stdout.write(process.env.ZTOOLS_E2E_EXECUTABLE_PATH || '')"`
    const inheritedHost = await executeInContents(electronApp, pluginUrl, `(async () => (
      window.zvcBridge.invokeTool('', 'bash', {
        command: ${JSON.stringify(hostPathCommand)},
        timeoutMs: 3000
      })
    ))()`)
    expect(inheritedHost).toMatchObject({ code: 0 })
    const inheritedHostPath = String(inheritedHost.stdout || inheritedHost.output || '').trim()
    expect(await fs.realpath(inheritedHostPath)).toBe(await fs.realpath(launchOptions.executablePath))

    // Windows PowerShell 输出必须保留中文、Emoji 和多字节符号，不能在分片解码时替换为 �。
    const unicodeCommand = process.platform === 'win32'
      ? 'Write-Output "中文 😀 ✓"'
      : 'printf "中文 😀 ✓\\n"'
    const unicodeResult = await executeInContents(electronApp, pluginUrl, `(async () => (
      window.zvcBridge.invokeTool('', 'bash', {
        command: ${JSON.stringify(unicodeCommand)},
        timeoutMs: 3000
      })
    ))()`)
    expect(unicodeResult).toMatchObject({ code: 0 })
    expect(unicodeResult.stdout).toContain('中文 😀 ✓')
    expect(unicodeResult.stdout).not.toContain('�')

    const footerLayout = await executeInContents(electronApp, pluginUrl, `(() => {
      const footer = document.querySelector('.sidebar-footer')?.getBoundingClientRect()
      const settings = document.querySelector('.sidebar-footer [aria-label="ZVC 设置"]')?.getBoundingClientRect()
      const collapse = document.querySelector('.sidebar-collapse-button')?.getBoundingClientRect()
      return {
        footerRight: footer?.right || 0,
        settingsLeft: settings?.left || 0,
        collapseLeft: collapse?.left || 0,
        collapseRight: collapse?.right || 0,
      }
    })()`)
    expect(footerLayout.collapseLeft).toBeGreaterThan(footerLayout.settingsLeft)
    expect(footerLayout.footerRight - footerLayout.collapseRight).toBeLessThan(20)

    const delayedCommand = process.platform === 'win32'
      ? 'Start-Sleep -Milliseconds 1200; Write-Output zvc-timeout-ok'
      : 'sleep 1.2; printf zvc-timeout-ok'
    const timeoutCommand = process.platform === 'win32'
      ? 'Start-Sleep -Milliseconds 1500'
      : 'sleep 1.5'
    const shellTimeoutState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const completedAt = Date.now()
      const completed = await window.zvcBridge.invokeTool('', 'bash', {
        command: ${JSON.stringify(delayedCommand)},
        timeoutMs: 3000
      })
      let timeoutMessage = ''
      const timedOutAt = Date.now()
      try {
        await window.zvcBridge.invokeTool('', 'bash', {
          command: ${JSON.stringify(timeoutCommand)},
          timeoutMs: 1000
        })
      } catch (error) {
        timeoutMessage = error.message || String(error)
      }
      return {
        completed,
        completedElapsed: timedOutAt - completedAt,
        timeoutElapsed: Date.now() - timedOutAt,
        timeoutMessage,
      }
    })()`)
    expect(shellTimeoutState.completed).toMatchObject({ code: 0, stdout: 'zvc-timeout-ok' })
    expect(shellTimeoutState.completedElapsed).toBeGreaterThanOrEqual(1000)
    expect(shellTimeoutState.timeoutElapsed).toBeGreaterThanOrEqual(900)
    expect(shellTimeoutState.timeoutElapsed).toBeLessThan(4000)
    expect(shellTimeoutState.timeoutMessage).toContain('命令执行超时（1000ms）')

    // 验证输出分片会多次到达 Renderer，而不是等进程结束后一次性返回。
    const progressCommand = process.platform === 'win32'
      ? 'Write-Output first; Start-Sleep -Milliseconds 250; Write-Output second; Start-Sleep -Milliseconds 250; Write-Output third'
      : 'printf "first\\n"; sleep 0.25; printf "second\\n"; sleep 0.25; printf "third\\n"'
    const progressState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const updates = []
      const result = await window.zvcBridge.invokeTool('', 'bash', {
        command: ${JSON.stringify(progressCommand)},
        timeoutMs: 3000
      }, { callId: 'e2e-shell-progress' }, (update) => updates.push(update))
      return { result, updates }
    })()`)
    expect(progressState.result).toMatchObject({ code: 0 })
    expect(progressState.result.output).toContain('first')
    expect(progressState.result.output).toContain('third')
    expect(progressState.updates.filter((update) => update.output).length).toBeGreaterThanOrEqual(2)
    expect(progressState.updates.some((update) => update.phase === 'settled')).toBe(true)

    // 取消必须终止整个进程组，等待超过原命令延时后再检查副作用。
    const cancelCommand = process.platform === 'win32'
      ? `Write-Output started; Start-Sleep -Seconds 3; Set-Content -Path '${cancelMarker}' -Value residual`
      : `printf "started\\n"; sleep 3; printf residual > "${cancelMarker}"`
    const cancelState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const updates = []
      const startedAt = Date.now()
      const callId = 'e2e-shell-cancel'
      const execution = window.zvcBridge.invokeTool('', 'bash', {
        command: ${JSON.stringify(cancelCommand)},
        timeoutMs: 10000
      }, { callId }, (update) => updates.push(update))
      await new Promise((resolve) => setTimeout(resolve, 250))
      const cancelled = window.zvcBridge.cancelTool(callId)
      let message = ''
      try { await execution } catch (error) { message = error.message || String(error) }
      return { cancelled, message, elapsedMs: Date.now() - startedAt, updates }
    })()`)
    expect(cancelState.cancelled).toBe(true)
    expect(cancelState.message).toContain('已取消')
    expect(cancelState.elapsedMs).toBeLessThan(2500)
    expect(cancelState.updates.some((update) => String(update.output || '').includes('started'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 3200))
    await expect(fs.access(cancelMarker)).rejects.toThrow()

    // 通过真实 preload 桥调用三个搜索工具，并确认 rg/fd 保持 .gitignore 语义。
    const searchState = await executeInContents(electronApp, pluginUrl, `(async () => ({
      grep: await window.zvcBridge.invokeTool('', 'grep', { pattern: 'needle', path: ${JSON.stringify(searchRoot)} }, { callId: 'e2e-grep' }),
      find: await window.zvcBridge.invokeTool('', 'find', { pattern: '*.txt', path: ${JSON.stringify(searchRoot)} }, { callId: 'e2e-find' }),
      ls: await window.zvcBridge.invokeTool('', 'ls', { path: ${JSON.stringify(searchRoot)} }, { callId: 'e2e-ls' }),
    }))()`)
    expect(searchState.grep.text).toContain('src/visible.txt')
    expect(searchState.grep.text).not.toContain('ignored/hidden.txt')
    expect(searchState.find.files).toContain('src/visible.txt')
    expect(searchState.find.files).not.toContain('ignored/hidden.txt')
    expect(searchState.ls.entries).toEqual(expect.arrayContaining(['.gitignore', 'ignored/', 'src/']))

    await executeInContents(electronApp, pluginUrl, `(() => {
      document.querySelector('[aria-label="模型设置"] button[title="关闭"]')?.click()
      document.querySelector('.capability-button')?.click()
      return true
    })()`)
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain('Shell Executor')

    const capabilityState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const group = [...document.querySelectorAll('.tool-group-section')]
        .find((item) => item.textContent?.includes('Shell Executor'))
      if (!group) throw new Error('未找到 Shell Executor 分组')
      group.scrollIntoView({ block: 'center' })
      const defaultCollapsed = !group.querySelector('.tool-group-tools')
        && group.querySelector('.group-collapse')?.getAttribute('aria-label') === '展开'
      group.querySelector('.tool-group-title')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const checkbox = group.querySelector('.tool-group-check')
      const body = document.querySelector('.capability-popover-body')
      const results = []
      for (let index = 0; index < 5; index += 1) {
        checkbox.click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        results.push({
          checked: checkbox.getAttribute('aria-checked') === 'true',
          panelVisible: Boolean(document.querySelector('.capability-popover')),
          bodyTextLength: body.innerText.length,
          shellSwitches: [...group.querySelectorAll('.tool-capability-row input')]
            .filter((input) => input.checked).length,
        })
      }
      return { defaultCollapsed, results }
    })()`)

    expect(capabilityState.defaultCollapsed).toBe(true)
    expect(capabilityState.results).toEqual([
      { checked: true, panelVisible: true, bodyTextLength: expect.any(Number), shellSwitches: 4 },
      { checked: false, panelVisible: true, bodyTextLength: expect.any(Number), shellSwitches: 0 },
      { checked: true, panelVisible: true, bodyTextLength: expect.any(Number), shellSwitches: 4 },
      { checked: false, panelVisible: true, bodyTextLength: expect.any(Number), shellSwitches: 0 },
      { checked: true, panelVisible: true, bodyTextLength: expect.any(Number), shellSwitches: 4 },
    ])
    expect(capabilityState.results.every((state) => state.bodyTextLength > 250)).toBe(true)

    const capture = await captureCapabilityPanel(electronApp)
    const screenshot = Buffer.from(capture.png, 'base64')
    await fs.writeFile(testInfo.outputPath('zvc-shell-capability.png'), screenshot)
    await testInfo.attach('zvc-shell-capability', { body: screenshot, contentType: 'image/png' })
    expect(capture.width).toBeGreaterThan(300)
    expect(capture.height).toBeGreaterThan(450)
    expect(capture.darkPixels).toBeGreaterThan(1_000)
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
