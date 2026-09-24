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
const sessionPath = process.env.ZVC_SESSION_REPLAY_PATH || ''
const flymuxApiKey = process.env.ZVC_FLYMUX_API_KEY || ''

// 诊断请求可能包含真实会话内容，不生成 trace、截图或测试附件。
test.use({ trace: 'off', screenshot: 'off' })
test.skip(!sessionPath || !flymuxApiKey, '需要 ZVC_SESSION_REPLAY_PATH 和 ZVC_FLYMUX_API_KEY')

/**
 * 从原子 JSONL 检查点和提交事件重放一份只读会话快照。
 * @param {string} filePath 会话 JSONL 文件路径。
 * @returns {Promise<Record<string, unknown>>} 可重新写入隔离会话的快照。
 * @throws {Error} 文件不存在、JSON 无效或会话没有有效状态时抛出。
 */
async function loadSessionSnapshot(filePath) {
  const values = new Map()
  let order = []
  let metadata = {}
  let contextState = {}
  let tasks = []
  const lines = (await fs.readFile(filePath, 'utf8')).split('\n').filter(Boolean)
  for (const line of lines) {
    const event = JSON.parse(line)
    if (event.type === 'conversation/checkpoint') {
      values.clear()
      order = []
      for (const [index, message] of (event.messages || []).entries()) {
        const key = message?.id ? `id:${message.id}` : `index:${index}`
        values.set(key, message)
        order.push(key)
      }
    } else if (event.type === 'conversation/commit') {
      for (const key of event.messages?.removed || []) values.delete(key)
      for (const item of event.messages?.upserts || []) {
        if (item?.key && item.message && typeof item.message === 'object') values.set(item.key, item.message)
      }
      if (Array.isArray(event.messages?.order)) order = event.messages.order
      else for (const key of event.messages?.appended || []) if (!order.includes(key)) order.push(key)
      order = order.filter((key) => values.has(key))
    } else continue
    if (event.state && typeof event.state === 'object') metadata = event.state
    if (event.state?.contextState && typeof event.state.contextState === 'object') contextState = event.state.contextState
    if (Array.isArray(event.state?.tasks)) tasks = event.state.tasks
  }
  const messages = order.map((key) => values.get(key)).filter(Boolean).map((message) => ({
    id: message.id,
    turnId: message.turnId,
    role: message.role,
    source: message.source,
    content: message.content || '',
    reasoning: message.reasoning || '',
    parts: message.parts,
    tool_call_id: message.tool_call_id,
    name: message.name,
    tool_calls: message.tool_calls,
  }))
  if (!messages.length) throw new Error(`会话没有可回放的消息：${filePath}`)
  return { metadata, contextState, tasks, messages }
}

/**
 * 在指定 WebContentsView 中执行受控脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} urlFragment 目标 WebContentsView URL 片段。
 * @param {string} source 页面脚本。
 * @returns {Promise<unknown>} 页面脚本结果。
 * @throws {Error} 找不到目标 WebContentsView 或脚本执行失败时抛出。
 */
async function executeInContents(electronApp, urlFragment, source) {
  return electronApp.evaluate(async ({ webContents }, { fragment, script }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error(`未找到 ${fragment} 对应的 WebContentsView`)
    return contents.executeJavaScript(script)
  }, { fragment: urlFragment, script: source })
}

/**
 * 在页面中调用带结构化参数的函数，避免把会话内容拼接进脚本文本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} urlFragment 目标 WebContentsView URL 片段。
 * @param {string} functionSource 只接收一个参数的函数源码。
 * @param {unknown} value 需要序列化传入的参数。
 * @returns {Promise<unknown>} 页面函数结果。
 * @throws {Error} 找不到目标 WebContentsView 或脚本执行失败时抛出。
 */
async function executeInContentsWithValue(electronApp, urlFragment, functionSource, value) {
  return electronApp.evaluate(async ({ webContents }, { fragment, source, payload }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error(`未找到 ${fragment} 对应的 WebContentsView`)
    return contents.executeJavaScript(`(${source})(${JSON.stringify(payload)})`)
  }, { fragment: urlFragment, source: functionSource, payload: value })
}

/**
 * 读取可能尚未创建的 WebContentsView 正文。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} urlFragment 目标 WebContentsView URL 片段。
 * @returns {Promise<string>} 页面正文；视图未出现或仍在加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, urlFragment)
}

/**
 * 读取插件正文，供真实 Electron 加载状态轮询使用。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @returns {Promise<string>} 插件正文；尚未加载完成时返回空字符串。
 */
async function readPluginText(electronApp) {
  return readContentsText(electronApp, pluginUrl)
}

/**
 * 读取当前回放轮次的运行状态和调试请求摘要。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @returns {Promise<Record<string, unknown>>} 不含密钥和正文的诊断摘要。
 */
async function readReplayDiagnostics(electronApp) {
  return executeInContents(electronApp, pluginUrl, `(() => {
    const requests = Array.isArray(window.__zvcDebugRequests) ? window.__zvcDebugRequests : []
    const errors = Array.isArray(window.__zvcDebugErrors) ? window.__zvcDebugErrors : []
    const conversation = window.zvcBridge.getInitialState().conversations
      .find((item) => item.id === window.zvcBridge.getInitialState().activeConversationId)
    const full = conversation ? window.zvcBridge.getConversationById(conversation.id) : null
    const assistant = [...(full?.messages || [])].reverse().find((item) => item.role === 'assistant')
    const request = requests.at(-1)
    return {
      running: Boolean(document.querySelector('.conversation-running-status')),
      inlineError: document.querySelector('.inline-error')?.textContent?.trim() || '',
      waitingTools: document.querySelectorAll('.tool-call.is-waiting').length,
      messageCount: full?.messages?.length || 0,
      assistantStatus: assistant?.status || '',
      assistantFailure: assistant?.failure || null,
      assistantToolCalls: (assistant?.tool_calls || []).map((call) => ({ name: call.name, status: call.status, argumentChars: String(call.arguments || '').length })),
      request: request ? {
        model: request.model,
        messageCount: request.messages?.length || 0,
        toolCount: request.tools?.length || 0,
        messageChars: JSON.stringify(request.messages || []).length,
        toolChars: JSON.stringify(request.tools || []).length,
        imageBlocks: (request.messages || []).reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url').length : 0), 0),
      } : null,
      errors: errors.slice(-3).map((error) => ({ code: error.code, status: error.status, message: error.message, requestId: error.requestId })),
    }
  })()`)
}

/**
 * 发送一条不会自动批准工具的继续消息。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} text 继续消息文本。
 * @returns {Promise<void>} 消息提交完成后的 Promise。
 * @throws {Error} 输入框或发送按钮不可用时抛出。
 */
async function sendMessage(electronApp, text) {
  await executeInContentsWithValue(electronApp, pluginUrl, `(value) => new Promise((resolve, reject) => {
    const textarea = document.querySelector('.composer textarea')
    const button = document.querySelector('.send-button')
    if (!textarea || !button) {
      reject(new Error('未找到消息输入控件'))
      return
    }
    textarea.value = value
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (button.disabled) reject(new Error('发送按钮未启用'))
      else {
        button.click()
        resolve(true)
      }
    }))
  })`, text)
}

/**
 * 在插件页面内启动一个请求变体，避免跨进程脚本长时间持有 Promise。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {{mode: 'without-tools'|'latest-user-with-tools', label: string}} variant 请求变体。
 * @returns {Promise<void>} 变体请求已在页面后台启动后的 Promise。
 * @throws {Error} 页面无法启动变体请求时抛出。
 */
async function startRequestVariant(electronApp, variant) {
  const started = await executeInContentsWithValue(electronApp, pluginUrl, `(value) => {
    window.__zvcVariantRuns ||= {}
    window.__zvcVariantRuns[value.label] = { status: 'running' }
    ;(async () => {
      const events = []
      let requestId = ''
      let timedOut = false
      const summarizeEvents = () => ({
        count: events.length,
        types: events.reduce((map, event) => ({ ...map, [event.type]: (map[event.type] || 0) + 1 }), {}),
      })
      const timeoutId = window.setTimeout(() => {
        timedOut = true
        if (requestId) window.zvcBridge.abortChat(requestId)
      }, 45000)
      try {
        const models = await window.zvcBridge.getHostModels()
        const model = models.find((item) => item.modelId === 'gpt-5.6-sol')
        const original = window.__zvcSessionReplayRequest
        if (!model?.value) throw new Error('缺少 Fly 宿主模型配置')
        if (!original) throw new Error('缺少原始回放请求')
        const systemMessage = original.messages?.find((message) => message.role === 'system')
        const latestUserMessage = [...(original.messages || [])].reverse().find((message) => message.role === 'user')
        const messages = value.mode === 'latest-user-with-tools'
          ? [systemMessage, latestUserMessage].filter(Boolean)
          : original.messages
        const tools = value.mode === 'without-tools' ? undefined : original.tools
        const response = await window.zvcBridge.chat({
          model: model.value,
          messages,
          tools,
          reasoningEffort: 'high',
        }, (event) => {
          if (event.type === 'request') requestId = event.requestId || ''
          if (['reasoning', 'content', 'tool_call', 'reasoning_end'].includes(event.type)) {
            events.push({ type: event.type, deltaChars: String(event.delta || event.argumentsDelta || '').length, name: event.name || '' })
          }
        })
        window.__zvcVariantRuns[value.label] = {
          status: 'completed',
          label: value.label,
          ok: true,
          finishReason: response.finish_reason || '',
          responseContentChars: String(response.content || '').length,
          responseReasoningChars: String(response.reasoning_content || '').length,
          responseToolCalls: (response.tool_calls || []).map((call) => ({ name: call.function?.name || '', argumentChars: String(call.function?.arguments || '').length })),
          events: summarizeEvents(),
        }
      } catch (error) {
        window.__zvcVariantRuns[value.label] = {
          status: 'completed',
          label: value.label,
          ok: false,
          timedOut,
          error: { name: error.name, code: error.code, status: error.status, message: error.message, failure: error.failure || null, requestId: error.requestId || '' },
          events: summarizeEvents(),
        }
      } finally {
        window.clearTimeout(timeoutId)
      }
    })()
    return true
  }`, variant)
  if (!started) throw new Error(`无法启动请求变体：${variant.label}`)
}

/**
 * 等待页面内请求变体结束并读取结构化结果。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} label 请求变体标签。
 * @returns {Promise<Record<string, unknown>>} 响应结束、失败和工具调用统计。
 * @throws {Error} 页面在测试边界内没有发布结果时抛出。
 */
async function waitForRequestVariant(electronApp, label) {
  await expect.poll(() => executeInContentsWithValue(
    electronApp,
    pluginUrl,
    `(value) => window.__zvcVariantRuns?.[value]?.status || ''`,
    label,
  ), { timeout: 55_000, intervals: [250, 500, 1000] }).toBe('completed')
  return executeInContentsWithValue(
    electronApp,
    pluginUrl,
    `(value) => window.__zvcVariantRuns?.[value] || null`,
    label,
  )
}

test('使用真实 Fly 模型回放指定 JSONL 会话并定位工具流失败边界', async () => {
  test.setTimeout(360_000)
  const snapshot = await loadSessionSnapshot(sessionPath)
  const sourceDataRoot = path.resolve(path.dirname(sessionPath), '..', '..')
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-flymux-session-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp = null

  // 只复制会话引用的附件对象，避免原会话图片在隔离实例中无法物化。
  await fs.cp(
    path.join(sourceDataRoot, 'attachments'),
    path.join(dataRoot, 'plugins-data', 'ztools-vibe-coding', 'attachments'),
    { recursive: true },
  )
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    const electronEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => value && key !== 'ZVC_FLYMUX_API_KEY')
    )
    electronApp = await electron.launch({
      executablePath: process.env.ZTOOLS_E2E_EXECUTABLE_PATH || '/Applications/ZTools.app/Contents/MacOS/ZTools',
      args: [],
      env: {
        ...electronEnvironment,
        ZVC_DEBUG: '1',
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      },
    })

    const page = await electronApp.firstWindow()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readContentsText(electronApp, settingsUrlFragment), { timeout: 15_000 }).toContain('开机自动启动')
    await addHostAiProvider(executeInContents, electronApp, settingsUrlFragment, {
      name: 'Flymux Replay',
      apiUrl: 'https://api.flymux.com/v1',
      apiKey: flymuxApiKey,
      models: [{
        modelId: 'gpt-5.6-sol',
        contextWindow: 262144,
        reasoning: {
          protocol: 'auto',
          efforts: { high: 'high' },
          defaultEffort: 'high',
          responseField: 'auto',
        },
      }],
    })
    await expect(executeInContents(electronApp, settingsUrlFragment, `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`)).resolves.toMatchObject({ success: true })
    await expect(executeInContents(electronApp, settingsUrlFragment, 'window.ztools.internal.installDevPlugin("ztools-vibe-coding")')).resolves.toMatchObject({ success: true })
    const plugins = await executeInContents(electronApp, settingsUrlFragment, 'window.ztools.internal.getAllPlugins()')
    const developmentPlugin = plugins.find((plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment)
    await expect(executeInContents(electronApp, settingsUrlFragment, `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`)).resolves.toMatchObject({ success: true })
    await expect.poll(() => readPluginText(electronApp), { timeout: 15_000 }).toContain('全能 AI 助手')

    const setup = await executeInContentsWithValue(electronApp, pluginUrl, `async (value) => {
      const models = await window.zvcBridge.getHostModels()
      const modelKey = models.find((model) => model.modelId === 'gpt-5.6-sol')?.value
      if (!modelKey) throw new Error('缺少 Fly 宿主模型配置')
      const workspace = window.zvcBridge.createWorkspace({ name: 'Flymux 会话回放' })
      const conversation = window.zvcBridge.createConversation({
        ...value.snapshot.metadata,
        title: 'Flymux 会话回放',
        modelKey,
        projectId: workspace.id,
        workspaceLocked: true,
        enabledTools: value.snapshot.metadata.enabledTools,
        enabledSkills: value.snapshot.metadata.enabledSkills,
        autoApproveTools: false,
        tasks: value.snapshot.tasks,
        contextState: value.snapshot.contextState,
        messages: value.snapshot.messages,
      })
      window.zvcBridge.setActiveConversation(conversation.id)
      return { id: conversation.id, messageCount: conversation.messages.length, workspace: workspace.path }
    }`, { snapshot })
    expect(setup.messageCount).toBeGreaterThan(250)
    await executeInContents(electronApp, pluginUrl, 'location.reload()')
    await expect.poll(() => readPluginText(electronApp), { timeout: 15_000 }).toContain('Flymux 会话回放')

    await sendMessage(electronApp, '继续处理当前任务')
    await expect.poll(async () => {
      const state = await readReplayDiagnostics(electronApp)
      return state.running || Boolean(state.request) || Boolean(state.inlineError)
    }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true)
    await expect.poll(async () => {
      const state = await readReplayDiagnostics(electronApp)
      return !state.running || state.waitingTools > 0 || Boolean(state.inlineError)
    }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(true).catch(() => {})
    let first = await readReplayDiagnostics(electronApp)
    if (first.running && first.waitingTools === 0) {
      await executeInContents(electronApp, pluginUrl, 'document.querySelector(".send-button.stop")?.click(); true')
      await expect.poll(async () => !(await readReplayDiagnostics(electronApp)).running, { timeout: 10_000 }).toBe(true)
      first = { ...(await readReplayDiagnostics(electronApp)), diagnosticTimeout: true }
    }
    console.log('[Flymux session replay] original', JSON.stringify(first))

    // 如果模型成功生成了完整工具调用，停止等待确认，避免诊断测试执行本地命令。
    if (first.waitingTools > 0) await executeInContents(electronApp, pluginUrl, 'document.querySelector(".send-button.stop")?.click(); true')
    const request = await executeInContents(electronApp, pluginUrl, `(() => {
      window.__zvcSessionReplayRequest = window.__zvcDebugRequests?.at(-1) || null
      const value = window.__zvcSessionReplayRequest
      return value ? {
        messageCount: value.messages?.length || 0,
        toolCount: value.tools?.length || 0,
        messageChars: JSON.stringify(value.messages || []).length,
        toolChars: JSON.stringify(value.tools || []).length,
      } : null
    })()`)
    expect(request).toBeTruthy()

    const variants = [
      { label: 'without-tools', mode: 'without-tools' },
      { label: 'latest-user-with-tools', mode: 'latest-user-with-tools' },
    ]
    const variantResults = []
    for (const variant of variants) {
      // 变体串行执行，避免并发大请求影响提供商响应时间和失败归因。
      await startRequestVariant(electronApp, variant)
      variantResults.push(await waitForRequestVariant(electronApp, variant.label))
    }
    console.log('[Flymux session replay] variants', JSON.stringify({ request, results: variantResults }))
  } finally {
    // 测试失败时也先终止仍在运行的模型或工具等待，避免 Electron 清理被请求超时拖住。
    if (electronApp) {
      await executeInContents(electronApp, pluginUrl, 'document.querySelector(".send-button.stop")?.click(); true').catch(() => {})
    }
    await electronApp?.close().catch(() => {})
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
