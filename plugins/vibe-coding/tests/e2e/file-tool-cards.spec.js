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
 * @param {string} urlFragment 目标 URL 片段。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws {Error} 目标 WebContentsView 不存在或脚本执行失败时抛出。
 */
async function executeInContents(electronApp, urlFragment, source) {
  return electronApp.evaluate(async ({ webContents }, { fragment, script }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error(`未找到 ${fragment} 对应的 WebContentsView`)
    return contents.executeJavaScript(script)
  }, { fragment: urlFragment, script: source })
}

/**
 * 读取指定 WebContentsView 的正文文本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；尚未加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body.innerText')
  }, urlFragment)
}

/**
 * 截取指定的已展开文件工具卡片用于视觉回归检查。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} selector 文件卡片选择器。
 * @returns {Promise<Buffer>} 文件卡片 PNG 数据。
 * @throws {Error} 插件视图或文件卡片不存在时抛出。
 */
async function captureFileCard(electronApp, selector) {
  return electronApp.evaluate(async ({ webContents }, { fragment, targetSelector }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error('未找到 ZVC WebContentsView')
    const rect = await contents.executeJavaScript(`(async () => {
      const card = document.querySelector(${JSON.stringify(targetSelector)})
      if (!card) throw new Error('未找到文件卡片')
      card.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = card.getBoundingClientRect()
      return { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
    })()`)
    return (await contents.capturePage(rect)).toPNG().toString('base64')
  }, { fragment: pluginUrl, targetSelector: selector }).then((value) => Buffer.from(value, 'base64'))
}

test('读取和写入工具使用可持久化的专用文件卡片', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-file-card-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp = null
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    electronApp = await electron.launch(createZToolsLaunchOptions(dataRoot, legacyRoot))

    const page = await electronApp.firstWindow()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readContentsText(electronApp, settingsUrl), { timeout: 15_000 }).toContain('开机自动启动')

    await executeInContents(electronApp, settingsUrl, `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`)
    await executeInContents(electronApp, settingsUrl, `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`)
    const plugins = await executeInContents(electronApp, settingsUrl, 'window.ztools.internal.getAllPlugins()')
    const developmentPlugin = plugins.find((plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment)
    await executeInContents(
      electronApp,
      settingsUrl,
      `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`,
    )
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('全能 AI 助手')

    // 直接写入一条带展示元数据的会话，验证保存并重载后的卡片恢复路径。
    await executeInContents(electronApp, pluginUrl, `(() => {
      const path = '/tmp/zvc-file-card-example.js'
      const lines = Array.from({ length: 12 }, (_, index) => ({ number: index + 1, text: 'const value' + (index + 1) + ' = ' + (index + 1) }))
      const conversation = window.zvcBridge.createConversation({
        title: '文件卡片测试',
        messages: [{
          id: 'assistant-file-cards', role: 'assistant', content: '', status: 'completed', tool_calls: [
            { id: 'read-call', name: 'read', args: { path }, status: 'completed', result: '{"content":"ok"}', presentation: { card: 'read', path, lang: 'javascript', lines, totalLines: 12 } },
            { id: 'write-call', name: 'write', args: { path }, status: 'completed', result: '{"ok":true}', presentation: { card: 'diff', path, diffs: [{ path, oldText: 'const value = 1\\nconst stale = true', newText: 'const value = 2\\nconst active = true' }] } },
          ],
        }],
      })
      window.zvcBridge.setActiveConversation(conversation.id)
      location.reload()
      return conversation.id
    })()`)

    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('文件卡片测试')
    const state = await executeInContents(electronApp, pluginUrl, `(async () => {
      document.querySelector('[aria-label="模型设置"] button[title="关闭"]')?.click()
      document.querySelectorAll('.tool-summary').forEach((button) => button.click())
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        readLines: document.querySelectorAll('.file-read-line').length,
        hiddenLabel: document.querySelector('.file-read-card .file-card-expand')?.textContent?.trim(),
        highlightedSpans: document.querySelectorAll('.file-read-card .hljs-keyword').length,
        deletedLines: document.querySelectorAll('.file-diff-line.is-del').length,
        addedLines: document.querySelectorAll('.file-diff-line.is-add').length,
        footer: document.querySelector('.file-diff-footer')?.textContent?.trim(),
      }
    })()`)

    expect(state).toEqual({
      readLines: 8,
      hiddenLabel: '… 其余 4 行',
      highlightedSpans: 8,
      deletedLines: 2,
      addedLines: 2,
      footer: '└ +2 -2 · 1 file',
    })
    const readScreenshot = await captureFileCard(electronApp, '.file-read-card')
    const diffScreenshot = await captureFileCard(electronApp, '.file-diff-card')
    await fs.writeFile(testInfo.outputPath('zvc-read-tool-card.png'), readScreenshot)
    await fs.writeFile(testInfo.outputPath('zvc-diff-tool-card.png'), diffScreenshot)
    await testInfo.attach('zvc-read-tool-card', { body: readScreenshot, contentType: 'image/png' })
    await testInfo.attach('zvc-diff-tool-card', { body: diffScreenshot, contentType: 'image/png' })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
