import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addHostAiProvider } from './host-ai-fixture.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginConfigPath = path.join(projectRoot, 'public', 'plugin.json')
const pluginDevelopmentPath = path.dirname(pluginConfigPath)
const pluginUrl = 'http://127.0.0.1:15240'
const settingsUrlFragment = 'internal-plugins/setting/index.html'
const flymuxApiKey = process.env.ZVC_FLYMUX_API_KEY || ''

// 真实凭据不得进入失败 trace 或截图产物。
test.use({ trace: 'off', screenshot: 'off' })
test.skip(!flymuxApiKey, '需要通过 ZVC_FLYMUX_API_KEY 提供 Flymux API Key')

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
 * @returns {Promise<string>} 页面正文；尚未完成加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, urlFragment)
}

/**
 * 读取最后一条助手消息的思考面板和正文状态。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{running: boolean, completed: boolean, reasoningLength: number, hasReasoningBlock: boolean, title: string, answerLength: number}>} 助手消息可见状态。
 */
async function readAssistantResult(electronApp) {
  return executeInContents(electronApp, pluginUrl, `(() => {
    const assistant = [...document.querySelectorAll('.message-assistant')].at(-1)
    const reasoning = assistant?.querySelector('.reasoning-block')
    return {
      running: Boolean(document.querySelector('.conversation-running-status')),
      completed: Boolean(assistant && !assistant.querySelector('.tool-call.is-running, .tool-call.is-streaming')),
      reasoningLength: reasoning?.querySelector('.reasoning-summary')?.textContent?.trim().length || 0,
      hasReasoningBlock: Boolean(reasoning),
      title: reasoning?.querySelector('.reasoning-title')?.textContent || '',
      answerLength: assistant?.querySelector('.markdown-content')?.textContent?.trim().length || 0,
    }
  })()`)
}

test('Flymux gpt-5.6-sol 返回并显示真实思考内容', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-flymux-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 不把真实密钥传给 Electron 子进程环境，只在配置调用期间注入隔离实例。
    const electronEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => value && key !== 'ZVC_FLYMUX_API_KEY')
    )
    electronApp = await electron.launch({
      executablePath:
        process.env.ZTOOLS_E2E_EXECUTABLE_PATH ||
        '/Applications/ZTools.app/Contents/MacOS/ZTools',
      args: [],
      env: {
        ...electronEnvironment,
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
    await expect
      .poll(() => readContentsText(electronApp, settingsUrlFragment), { timeout: 15_000 })
      .toContain('开机自动启动')

    await addHostAiProvider(executeInContents, electronApp, settingsUrlFragment, {
      name: 'Flymux Real',
      apiUrl: 'https://api.flymux.com/v1',
      apiKey: flymuxApiKey,
      models: [{
        modelId: 'gpt-5.6-sol',
        contextWindow: 65536,
        reasoning: {
          protocol: 'auto',
          efforts: { high: 'high' },
          defaultEffort: 'high',
          responseField: 'auto',
        },
      }],
    })

    const imported = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`
    )
    expect(imported).toMatchObject({ success: true, pluginName: 'ztools-vibe-coding' })
    const installed = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`
    )
    expect(installed).toMatchObject({ success: true })

    const pluginList = await executeInContents(
      electronApp,
      settingsUrlFragment,
      'window.ztools.internal.getAllPlugins()'
    )
    const developmentPlugin = pluginList.find(
      (plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment
    )
    const launchResult = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`
    )
    expect(launchResult).toMatchObject({ success: true })
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain('全能 AI 助手')

    // 模型凭据由宿主管理，插件会话只保存无工具干扰的运行配置。
    const configured = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
        const conversation = window.zvcBridge.createConversation({
          title: 'Flymux 真实推理测试',
          enabledTools: [],
          enabledSkills: [],
          autoApproveTools: false
        })
        window.zvcBridge.setActiveConversation(conversation.id)
        location.reload()
        return true
      })()`
    )
    expect(configured).toBe(true)
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain('Flymux Real - gpt-5.6-sol')

    await executeInContents(electronApp, pluginUrl, `(() => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '请分析：有 12 枚外观相同的硬币，其中一枚重量异常但不知道轻重，只能使用无砝码天平三次。请说明如何确定异常硬币及其轻重，答案保持简洁。'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await expect.poll(() => executeInContents(
      electronApp,
      pluginUrl,
      `Boolean(document.querySelector('.send-button:not(.stop):not(:disabled)'))`
    )).toBe(true)
    await executeInContents(electronApp, pluginUrl, `document.querySelector('.send-button')?.click(); true`)

    await expect.poll(() => readAssistantResult(electronApp), {
      timeout: 90_000,
      intervals: [500, 1000, 2000],
    }).toMatchObject({
      running: false,
      completed: true,
      hasReasoningBlock: true,
      title: '思考',
    })
    const result = await readAssistantResult(electronApp)
    expect(result.reasoningLength).toBeGreaterThan(0)
    expect(result.answerLength).toBeGreaterThan(0)

    const stored = await executeInContents(electronApp, pluginUrl, `(() => {
      const conversation = window.zvcBridge.getInitialState().conversations
        .find((item) => item.title === 'Flymux 真实推理测试')
      const full = conversation ? window.zvcBridge.getConversationById(conversation.id) : null
      const assistant = [...(full?.messages || [])].reverse().find((message) => message.role === 'assistant')
      return {
        reasoningLength: String(assistant?.reasoning || '').length,
        contentLength: String(assistant?.content || '').length,
        status: assistant?.status,
      }
    })()`)
    expect(stored.status).toBe('completed')
    expect(stored.reasoningLength).toBeGreaterThan(0)
    expect(stored.contentLength).toBeGreaterThan(0)
  } finally {
    // 无论真实请求成功与否，都关闭隔离宿主并删除临时数据。
    if (electronApp) await electronApp.close().catch(() => {})
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
