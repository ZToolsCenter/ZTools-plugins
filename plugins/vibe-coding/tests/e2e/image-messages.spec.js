import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addHostAiProvider } from './host-ai-fixture.js'
import { createZToolsLaunchOptions, getZToolsSettingsUrlFragment } from './ztools-launch.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginConfigPath = path.join(projectRoot, 'public', 'plugin.json')
const pluginDevelopmentPath = path.dirname(pluginConfigPath)
const pluginUrl = 'http://127.0.0.1:15240'
const settingsUrl = getZToolsSettingsUrlFragment()
const pixelPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/**
 * 在指定 WebContentsView 中执行脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws {Error} 目标 WebContentsView 不存在时抛出。
 */
async function executeInContents(electronApp, urlFragment, source) {
  return electronApp.evaluate(async ({ webContents }, { fragment, script }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error(`未找到 ${fragment} 对应的 WebContentsView`)
    return contents.executeJavaScript(script)
  }, { fragment: urlFragment, script: source })
}

/**
 * 读取指定插件视图的正文。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；未加载完成时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body.innerText')
  }, urlFragment)
}

/**
 * 截取插件视图并统计明显区别于背景的像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number}>} PNG 截图和非背景像素数。
 * @throws {Error} 插件视图不存在时抛出。
 */
async function capturePluginView(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error('未找到 ZVC WebContentsView')
    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 8 || (red + green + blue) / 3 < 220) nonBackgroundPixels += 1
    }
    return { png: image.toPNG().toString('base64'), nonBackgroundPixels }
  }, pluginUrl)
}

test('用户图片和 read 工具图片使用附件引用进入模型上下文', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-image-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const generatedImagePath = path.join(dataRoot, 'generated.png')
  let electronApp = null
  await fs.mkdir(legacyRoot, { recursive: true })
  await fs.writeFile(generatedImagePath, Buffer.from(pixelPngBase64, 'base64'))

  try {
    electronApp = await electron.launch(createZToolsLaunchOptions(dataRoot, legacyRoot))

    const page = await electronApp.firstWindow()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readContentsText(electronApp, settingsUrl), { timeout: 15_000 }).toContain('开机自动启动')
    await addHostAiProvider(executeInContents, electronApp, settingsUrl, {
      name: 'Image Test',
      apiUrl: 'http://127.0.0.1:15241/v1',
      apiKey: 'test-key',
      models: [{ modelId: 'image-model', inputModalities: ['text', 'image'] }],
    })
    await executeInContents(electronApp, settingsUrl, `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`)
    await executeInContents(electronApp, settingsUrl, `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`)
    const plugins = await executeInContents(electronApp, settingsUrl, 'window.ztools.internal.getAllPlugins()')
    const developmentPlugin = plugins.find((plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment)
    await executeInContents(electronApp, settingsUrl, `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`)
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('全能 AI 助手')

    const conversationId = await executeInContents(electronApp, pluginUrl, `(() => {
      const state = window.zvcBridge.getInitialState()
      const id = state.activeConversationId || state.conversations[0]?.id
      window.zvcBridge.updateConversation(id, { enabledTools: ['read'], autoApproveTools: true })
      location.reload()
      return id
    })()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelector('.composer textarea')?.placeholder || ''`), { timeout: 15_000 }).toContain('问任何问题')

    await executeInContents(electronApp, pluginUrl, `(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(pixelPngBase64)}), (character) => character.charCodeAt(0))
      const file = new File([bytes], 'pixel.png', { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      const input = document.querySelector('.composer-file-input')
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.composer .image-attachment img').length`), { timeout: 8_000 }).toBe(1)

    await executeInContents(electronApp, pluginUrl, `(() => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '请描述这张图片'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('.send-button').click()
    })()`)
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('已收到图片。')

    const requestsAfterUpload = await fetch('http://127.0.0.1:15241/requests').then((response) => response.json())
    const uploadRequest = requestsAfterUpload.find((request) => request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')))
    const uploadedImageUrl = uploadRequest.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []).find((part) => part.type === 'image_url').image_url.url
    expect(uploadedImageUrl).toMatch(/^data:image\/png;base64,/) 

    const storageInfo = await executeInContents(electronApp, pluginUrl, `window.zvcBridge.getConversationStorageInfo(${JSON.stringify(conversationId)})`)
    const logText = await fs.readFile(storageInfo.logPath, 'utf8')
    expect(logText).toContain('sha256:')
    expect(logText).not.toContain('data:image/')
    expect(logText).not.toContain(pixelPngBase64)

    await executeInContents(electronApp, pluginUrl, 'location.reload()')
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.message-user .image-attachment img').length`), { timeout: 10_000 }).toBe(1)

    await executeInContents(electronApp, pluginUrl, `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = ${JSON.stringify(`测试工具读取图片：${generatedImagePath}`)}
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      document.querySelector('.send-button').click()
    })()`)
    await expect.poll(async () => {
      const requests = await fetch('http://127.0.0.1:15241/requests').then((response) => response.json())
      return requests.some((request) => request.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call-read-image') && request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')))
    }, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.tool-call').length`), { timeout: 8_000 }).toBeGreaterThan(0)
    await executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.tool-call .tool-summary')[document.querySelectorAll('.tool-call .tool-summary').length - 1].click()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.image-tool-card .image-attachment img').length`), { timeout: 8_000 }).toBe(1)
    const capture = await capturePluginView(electronApp)
    expect(capture.nonBackgroundPixels).toBeGreaterThan(2_000)
    await testInfo.attach('zvc-image-messages', { body: Buffer.from(capture.png, 'base64'), contentType: 'image/png' })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
