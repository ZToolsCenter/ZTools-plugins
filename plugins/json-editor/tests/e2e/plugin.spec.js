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

async function capturePluginView(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents) throw new Error('未找到 JSON 编辑器 WebContentsView')

    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      if (bitmap[index + 3] === 0) continue
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (spread > 8 || (red + green + blue) / 3 < 220) nonBackgroundPixels += 1
    }
    return { png: image.toPNG().toString('base64'), ...image.getSize(), nonBackgroundPixels }
  }, expectedUrl)
}

async function attachPluginView(electronApp, expectedUrl, testInfo, name) {
  const view = await capturePluginView(electronApp, expectedUrl)
  expect(view.width).toBeGreaterThan(0)
  expect(view.height).toBeGreaterThan(0)
  expect(view.nonBackgroundPixels).toBeGreaterThan(50)
  const screenshotPath = testInfo.outputPath(name + '.png')
  await fs.writeFile(screenshotPath, Buffer.from(view.png, 'base64'))
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

async function readPluginText(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, expectedUrl)
}

async function executeInPlugin(electronApp, targetUrl, source) {
  return electronApp.evaluate(({ webContents }, { targetUrl, source }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents) throw new Error('未找到 JSON 编辑器 WebContentsView')
    return contents.executeJavaScript(source)
  }, { targetUrl, source })
}

async function readPluginInstances(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const instances = webContents.getAllWebContents()
      .filter((contents) => contents.getURL() === targetUrl && !contents.isLoading())
    return Promise.all(instances.map(async (contents) => ({
      id: contents.id,
      ...await contents.executeJavaScript(`({
        windowType: window.ztools.getWindowType(),
        input: document.querySelector('#inputEditor .view-lines')?.textContent ?? '',
        output: document.querySelector('#outputEditor .view-lines')?.textContent.trim() ?? '',
        filter: document.querySelector('.footer input')?.value ?? '',
      })`),
    })))
  }, expectedUrl)
}

async function checkSystemClipboard(electronApp, expectedUrl, testInfo) {
  const canRestoreClipboard = await electronApp.evaluate(({ clipboard }) => {
    const formats = clipboard.availableFormats()
    if (formats.some((format) => format !== 'text/plain')) return false
    globalThis.jsonEditorClipboardBackup = formats.length ? clipboard.readText() : null
    return true
  })
  if (!canRestoreClipboard) {
    testInfo.annotations.push({ type: 'clipboard', description: '剪贴板包含非纯文本内容，跳过系统剪贴板写入' })
    return
  }

  const checks = [
    {
      button: '压缩 JSON 并复制',
      text: '{"items":[{"n":10},{"n":20}]}',
      message: '已复制压缩 JSON',
    },
    {
      button: 'JSON 转 TypeScript 并复制',
      text: 'interface RootObject {\n  items: Item[];\n}\n\ninterface Item {\n  n: number;\n}',
      message: '已复制转换 TypeScript',
    },
  ]
  try {
    for (const check of checks) {
      await executeInPlugin(electronApp, expectedUrl,
        `document.querySelector(${JSON.stringify('button[aria-label^="' + check.button + '"]')}).click()`)
      await expect.poll(() => electronApp.evaluate(
        ({ clipboard }, text) => clipboard.readText() === text, check.text,
      )).toBe(true)
      await expect.poll(() => executeInPlugin(electronApp, expectedUrl,
        `document.querySelector('[role="alert"]')?.textContent`)).toContain(check.message)
    }
    testInfo.annotations.push({ type: 'clipboard', description: '已验证压缩和 TypeScript 转换写入系统剪贴板' })
  } finally {
    await electronApp.evaluate(({ clipboard }, testTexts) => {
      const previous = globalThis.jsonEditorClipboardBackup
      delete globalThis.jsonEditorClipboardBackup
      if (!testTexts.includes(clipboard.readText())) return
      if (clipboard.availableFormats().some((format) => format !== 'text/plain')) return
      if (previous === null) clipboard.clear()
      else clipboard.writeText(previous)
    }, checks.map((check) => check.text))
  }
}

test('可在隔离的真实 ZTools 中安装并显示生产插件', async ({}, testInfo) => {
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
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    // 使用当前 ZTools 进程对应的宿主和隔离目录，避免读取或污染用户的真实数据。
    const executablePath = await resolveZToolsExecutable()
    const developmentAppRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
    electronApp = await electron.launch({
      executablePath,
      colorScheme: null,
      args: developmentAppRoot ? [developmentAppRoot] : [],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      },
    })

    await electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
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
    const launchPlugin = (type, payload) => executeInSettings(electronApp,
      `window.ztools.internal.launch(${JSON.stringify({
        path: pluginRoot,
        type: 'plugin',
        name: manifest.title,
        param: { code: featureCode, type, payload },
      })})`)
    const launchResult = await launchPlugin('text', '')
    expect(launchResult, JSON.stringify(launchResult)).toMatchObject({ success: true })

    await expect.poll(
      () => readPluginText(electronApp, expectedUrl),
      { timeout: 20_000 },
    ).toContain('URL Params、XML、YAML 粘贴自动转为 JSON')
    const jsonPath = path.join(dataRoot, 'payload.json')
    const fileText = '{"source":"preload","value":42}'
    await fs.writeFile(jsonPath, fileText)
    expect(await executeInPlugin(electronApp, expectedUrl,
      `window.services.readFileContent(${JSON.stringify(jsonPath)})`)).toBe(fileText)

    const readEditor = (selector) => executeInPlugin(electronApp, expectedUrl,
      `document.querySelector(${JSON.stringify(selector + ' .view-lines')})?.textContent || ''`)
    await executeInPlugin(electronApp, expectedUrl, `(() => {
      const editor = document.querySelector('#inputEditor textarea')
      const data = new DataTransfer()
      data.setData('text/plain', 'items: [{n: 10}, {n: 20}]')
      editor.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}))
    })()`)
    await expect.poll(() => readEditor('#inputEditor')).toContain('"items"')
    await executeInPlugin(electronApp, expectedUrl, `(() => {
      const filter = document.querySelector('.footer input')
      filter.value = '.items.map(x=>x.n)'
      filter.dispatchEvent(new Event('input', {bubbles: true}))
    })()`)
    await expect.poll(() => readEditor('#outputEditor')).toMatch(/10,.*20/s)

    const folded = () => executeInPlugin(electronApp, expectedUrl,
      'Boolean(document.querySelector("#inputEditor .codicon-folding-collapsed"))')
    await expect.poll(() => executeInPlugin(electronApp, expectedUrl,
      'Boolean(document.querySelector("#inputEditor .codicon-folding-expanded"))')).toBe(true)
    await executeInPlugin(electronApp, expectedUrl, 'document.querySelector(\'button[aria-label^="折叠全部"]\').click()')
    await expect.poll(folded).toBe(true)
    await executeInPlugin(electronApp, expectedUrl, 'document.querySelector(\'button[aria-label^="展开全部"]\').click()')
    await expect.poll(folded).toBe(false)

    const measureLayout = () => executeInPlugin(electronApp, expectedUrl, `(() => {
      const editor = document.querySelector('#inputEditor .monaco-editor')
      const input = document.querySelector('.footer input').getBoundingClientRect()
      const lastButton = document.querySelector('.handle button:last-of-type').getBoundingClientRect()
      const output = document.querySelector('#outputEditor').getBoundingClientRect()
      const surfaceSelectors = [
        'html', 'body', '#app', '.editor-shell', '.content', '.footer', '.footer input',
        '.content > div > .monaco-editor', '.monaco-editor-background', '.monaco-editor .margin',
        '.monaco-editor .lines-decorations',
      ]
      const opaqueSurfaces = surfaceSelectors.filter((selector) =>
        Array.from(document.querySelectorAll(selector)).some((element) =>
          getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'))
      return {
        opaqueSurfaces,
        contentBorderTop: getComputedStyle(document.querySelector('.content')).borderTopWidth,
        viewport: window.innerWidth,
        editorDark: editor.classList.contains('vs-dark'),
        inputWidth: input.width,
        outputWidth: output.width,
        lastButtonRight: lastButton.right,
      }
    })()`)
    const normal = await measureLayout()
    expect(normal.editorDark).toBe(false)
    expect(normal.opaqueSurfaces).toEqual([])
    expect(normal.contentBorderTop).toBe('0px')
    expect(normal.outputWidth).toBeGreaterThan(0)
    expect(normal.lastButtonRight).toBeLessThanOrEqual(normal.viewport)
    await attachPluginView(electronApp, expectedUrl, testInfo, 'plugin-light')

    await electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })
    await expect.poll(async () => (await measureLayout()).editorDark).toBe(true)

    const hostWindow = await electronApp.browserWindow(page)
    const resized = await hostWindow.evaluate((window, targetUrl) => {
      const views = [window.contentView]
      while (views.length) {
        const view = views.shift()
        if (view.webContents?.getURL() === targetUrl) {
          view.setBounds({ ...view.getBounds(), width: 480 })
          return true
        }
        views.push(...view.children)
      }
      return false
    }, expectedUrl)
    expect(resized).toBe(true)
    await expect.poll(async () => (await measureLayout()).viewport).toBe(480)
    const narrow = await measureLayout()
    expect(narrow.opaqueSurfaces).toEqual([])
    expect(narrow.inputWidth).toBeGreaterThan(30)
    expect(narrow.outputWidth).toBeGreaterThan(0)
    expect(narrow.lastButtonRight).toBeLessThanOrEqual(narrow.viewport)
    await attachPluginView(electronApp, expectedUrl, testInfo, 'plugin-dark-narrow')
    await checkSystemClipboard(electronApp, expectedUrl, testInfo)

    await page.keyboard.press('ControlOrMeta+d')
    await expect.poll(() => readPluginInstances(electronApp, expectedUrl)).toEqual([
      expect.objectContaining({ windowType: 'detach', filter: '.items.map(x=>x.n)' }),
    ])
    const secondLaunch = await launchPlugin('regex', '{"window":"second"}')
    expect(secondLaunch, JSON.stringify(secondLaunch)).toMatchObject({ success: true })
    await expect.poll(() => readPluginInstances(electronApp, expectedUrl)).toEqual(expect.arrayContaining([
      expect.objectContaining({ windowType: 'detach', input: expect.stringContaining('"items"') }),
      expect.objectContaining({ windowType: 'main', input: expect.stringContaining('"second"'), filter: '' }),
    ]))

    const detached = (await readPluginInstances(electronApp, expectedUrl))
      .find((instance) => instance.windowType === 'detach')
    await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript(`(() => {
      const filter = document.querySelector('.footer input')
      filter.value = '.items[1].n'
      filter.dispatchEvent(new Event('input', {bubbles: true}))
    })()`), detached.id)
    await expect.poll(() => readPluginInstances(electronApp, expectedUrl)).toEqual(expect.arrayContaining([
      expect.objectContaining({ windowType: 'detach', output: '20' }),
      expect.objectContaining({ windowType: 'main', input: expect.stringContaining('"second"'), filter: '' }),
    ]))

    const embedded = (await readPluginInstances(electronApp, expectedUrl))
      .find((instance) => instance.windowType === 'main')
    await electronApp.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id)
      contents.focus()
      await contents.executeJavaScript('document.querySelector("#inputEditor textarea").focus()')
    }, embedded.id)
    const pressInEditor = (keyCode, modifiers = []) => electronApp.evaluate(
      ({ webContents }, { id, keyCode, modifiers }) => {
        const contents = webContents.fromId(id)
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      }, { id: embedded.id, keyCode, modifiers },
    )
    const editorFindOpen = () => electronApp.evaluate(({ webContents }, id) =>
      webContents.fromId(id).executeJavaScript(
        'document.querySelector("#inputEditor .find-widget")?.classList.contains("visible") ?? false',
      ), embedded.id)

    await pressInEditor('F', [process.platform === 'darwin' ? 'meta' : 'control'])
    await expect.poll(editorFindOpen).toBe(true)
    await pressInEditor('Escape')
    await expect.poll(editorFindOpen).toBe(false)
    await expect(searchInput).toHaveCount(0)

    await pressInEditor('Escape')
    await expect(searchInput).toBeVisible({ timeout: 3000 })
    await expect(searchInput).toBeFocused()
    expect(await hostWindow.evaluate((window) => window.isVisible())).toBe(true)

    expect(await launchPlugin('text', '')).toMatchObject({ success: true })
    await expect.poll(() => readPluginInstances(electronApp, expectedUrl)).toEqual(expect.arrayContaining([
      expect.objectContaining({ windowType: 'detach', output: '20' }),
      expect.objectContaining({ windowType: 'main', input: expect.stringContaining('"second"') }),
    ]))
  } finally {
    // 无论断言是否成功，都释放测试实例并删除本次创建的数据目录。
    try {
      await electronApp?.close()
    } finally {
      await fs.rm(dataRoot, { recursive: true, force: true })
    }
  }
})
