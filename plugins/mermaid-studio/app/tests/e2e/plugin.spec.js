import { expect, test, _electron as electron } from '@playwright/test'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = projectRoot

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
 * 在设置插件的 WebContentsView 中执行脚本。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} source 页面脚本。
 * @returns {Promise<unknown>} 执行结果。
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
 * 安装并启动插件，返回插件页面 URL。
 * @param {import('@playwright/test').ElectronApplication} app 隔离的 Electron 应用。
 * @param {string} pluginRoot 插件目录。
 * @param {string} manifestPath 插件清单路径。
 * @param {object} manifest 插件清单内容。
 * @returns {Promise<string>} 插件页面 URL。
 */
async function mountPlugin(app, pluginRoot, manifestPath, manifest) {
  const settingsPage = await app.firstWindow()
  await settingsPage.locator('.search-input').waitFor({ state: 'visible', timeout: 30_000 })
  await settingsPage.locator('.search-input').fill('通用设置')
  await settingsPage.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
  await settingsPage.waitForTimeout(2500)

  const imported = await executeInSettings(
    app,
    `window.ztools.internal.importDevPlugin(${JSON.stringify(manifestPath)})`,
  )
  expect(imported, JSON.stringify(imported)).toMatchObject({ success: true })
  const installed = await executeInSettings(
    app,
    `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`,
  )
  expect(installed, JSON.stringify(installed)).toMatchObject({ success: true })
  const code = manifest.features?.[0]?.code || 'open'
  const launched = await executeInSettings(
    app,
    `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: ${JSON.stringify(code)}}})`,
  )
  expect(launched, JSON.stringify(launched)).toMatchObject({ success: true })

    return pathToFileURL(path.resolve(pluginRoot, manifest.main)).href
}

test('在真实 ZTools 中安装并运行 Mermaid 图表工作室', async ({}, testInfo) => {
  const step = (message) => {
    console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${message}`)
  }
  const executablePath = await resolveZToolsExecutable()
  step(`宿主：${executablePath}`)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugin')
  const manifestPath = path.join(pluginRoot, 'plugin.json')
  let app = null

  try {
    await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    // 隔离副本禁用开发入口，确保验证的是构建产物
    delete manifest.development
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.mkdir(legacyRoot, { recursive: true })

    app = await electron.launch({
      executablePath,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      },
    })
    step('Electron 已启动')

    const pluginUrl = await mountPlugin(app, pluginRoot, manifestPath, manifest)
    step(`插件已启动：${pluginUrl}`)

    // 等到插件窗口出现，用 Page 断言代替 app.evaluate 轮询，避免序列化开销
    // 注意：Electron 实际 URL 的盘符/斜杠大小写可能与 pathToFileURL 不同，用文件名宽松匹配
    let pluginPage = null
    for (let attempt = 0; attempt < 120; attempt += 1) {
      pluginPage = app
        .windows()
        .find((win) => win.url().startsWith('file://') && win.url().endsWith('/web/index.html')) || null
      if (pluginPage) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    expect(pluginPage, `未找到插件窗口，url=${pluginUrl}`).toBeTruthy()
    step('已找到插件窗口')

    // 1) 页面加载并渲染出图表
    await pluginPage.waitForSelector('.canvas svg', { timeout: 60_000 })
    step('SVG 已渲染')
    await expect(pluginPage.locator('.brand-text strong')).toHaveText('Mermaid 图表工作室')
    await expect(pluginPage.locator('.status-text')).toContainText('渲染成功')
    step('初始渲染断言通过')

    // 2) preload 只暴露三个业务方法
    const methods = await pluginPage.evaluate(() =>
      window.mermaidStudio ? Object.keys(window.mermaidStudio).sort() : null,
    )
    expect(methods).toEqual(['readSettings', 'saveFile', 'writeSettings'])

    // 3) Mermaid 预览含 foreignObject，导出时必须转换
    expect(await pluginPage.evaluate(() => !!document.querySelector('.canvas svg foreignObject'))).toBe(
      true,
    )

    // 4) 切换模板后重新渲染
    await pluginPage.evaluate(() => {
      ;[...document.querySelectorAll('.toolbar-group .btn')]
        .find((btn) => btn.textContent.trim() === '模板')
        .click()
    })
    await expect(pluginPage.locator('.template-card')).toHaveCount(12)
    await pluginPage.evaluate(() => {
      ;[...document.querySelectorAll('.template-card')]
        .find((card) => card.textContent.includes('时序图'))
        .click()
    })
    await expect(pluginPage.locator('.pane-head .tag')).toHaveText('sequence')
    await expect(pluginPage.locator('.status-text')).toContainText('渲染成功')

    // 5) 导出 PNG / SVG / PDF 并校验落盘内容
    const downloadsDir = await executeInSettings(app, `window.ztools.getPath('downloads')`)
    step(`下载目录：${downloadsDir}`)
    const listExports = async () => {
      const names = await fs.readdir(downloadsDir).catch(() => [])
      return names.filter((name) => /^mermaid-.*\.(png|svg|pdf)$/.test(name))
    }
    const before = new Set(await listExports())

    /**
     * 点击按钮并等待导出结束。
     * @param {() => Promise<void>} click 触发导出的操作
     * @returns {Promise<void>}
     */
    const waitExportDone = async (click) => {
      await click()
      await expect(pluginPage.locator('.status-text')).toContainText(/导出完成|失败/, {
        timeout: 60_000,
      })
      await expect(pluginPage.locator('.status-text')).toContainText('导出完成')
    }

    await waitExportDone(() =>
      pluginPage.evaluate(() => {
        ;[...document.querySelectorAll('.toolbar-group.right .btn')]
          .find((btn) => btn.textContent.trim() === 'PNG')
          .click()
      }),
    )
    step('PNG 导出完成')
    await waitExportDone(() =>
      pluginPage.evaluate(() => {
        ;[...document.querySelectorAll('.toolbar-group.right .btn')]
          .find((btn) => btn.textContent.trim() === 'SVG')
          .click()
      }),
    )
    await pluginPage.evaluate(() => {
      ;[...document.querySelectorAll('.toolbar-group.right .btn')]
        .find((btn) => btn.textContent.trim() === 'PDF')
        .click()
    })
    await pluginPage.locator('.pdf-dialog .btn.primary').click()
    await expect(pluginPage.locator('.status-text')).toContainText('导出完成', { timeout: 60_000 })

    const created = (await listExports()).filter((name) => !before.has(name))
    expect(created.length, `下载目录未产生导出文件：${created.join(',')}`).toBeGreaterThanOrEqual(3)

    const pngName = created.find((name) => name.endsWith('.png'))
    const svgName = created.find((name) => name.endsWith('.svg'))
    const pdfName = created.find((name) => name.endsWith('.pdf'))
    expect(pngName, '缺少 PNG').toBeTruthy()
    expect(svgName, '缺少 SVG').toBeTruthy()
    expect(pdfName, '缺少 PDF').toBeTruthy()

    const pngBuffer = await fs.readFile(path.join(downloadsDir, pngName))
    expect(pngBuffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

    const svgText = await fs.readFile(path.join(downloadsDir, svgName), 'utf8')
    expect(svgText).toContain('xmlns="http://www.w3.org/2000/svg"')
    // 对外 SVG 不能包含 foreignObject，否则第三方编辑器无法显示文字
    expect(svgText).not.toContain('foreignObject')
    expect(svgText).toMatch(/<text/)

    const pdfBuffer = await fs.readFile(path.join(downloadsDir, pdfName))
    expect(pdfBuffer.subarray(0, 5).toString()).toBe('%PDF-')

    await Promise.all(created.map((name) => fs.rm(path.join(downloadsDir, name), { force: true })))

    // 6) 配置持久化走过 dbStorage
    const saved = await pluginPage.evaluate(() => {
      window.mermaidStudio.writeSettings({ exportScale: 3 })
      return window.mermaidStudio.readSettings()
    })
    expect(saved.exportScale).toBe(3)
    await pluginPage.evaluate(() => window.mermaidStudio.writeSettings({ exportScale: 2 }))

    // 截图留证
    const screenshotPath = testInfo.outputPath('plugin-view.png')
    await pluginPage.screenshot({ path: screenshotPath })
    await testInfo.attach('plugin-view', { path: screenshotPath, contentType: 'image/png' })
  } finally {
    await app?.close().catch(() => {})
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => {})
  }
})
