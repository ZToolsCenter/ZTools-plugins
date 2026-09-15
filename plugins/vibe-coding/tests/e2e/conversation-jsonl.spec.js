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
 * 列出当前全部 WebContents 的地址、加载状态和正文摘要，供加载失败时诊断。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<Array<Record<string, unknown>>>} WebContents 诊断列表。
 */
async function readContentsInventory(electronApp) {
  return electronApp.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents().map(async (contents) => ({
    id: contents.id,
    url: contents.getURL(),
    loading: contents.isLoading(),
    text: contents.isDestroyed() ? '' : await contents.executeJavaScript('document.body?.innerText?.slice(0, 300) || ""').catch((error) => String(error)),
    overlay: contents.isDestroyed() ? '' : await contents.executeJavaScript('document.querySelector("vite-error-overlay")?.shadowRoot?.textContent?.slice(0, 1200) || ""').catch((error) => String(error)),
    page: contents.isDestroyed() ? null : await contents.executeJavaScript(`({
      html: document.documentElement?.outerHTML?.slice(0, 1000) || '',
      scripts: [...document.scripts].map((script) => script.src),
      resources: performance.getEntriesByType('resource').map((entry) => entry.name).slice(-20),
      bridge: typeof window.zvcBridge,
      ztools: typeof window.ztools,
    })`).catch((error) => ({ error: String(error) })),
  }))))
}

test('超过数据库单文档上限的会话通过 JSONL 切换并重载', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-jsonl-e2e-'))
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
    try {
      await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('全能 AI 助手')
    } catch (error) {
      console.error('WebContents inventory:', await readContentsInventory(electronApp))
      throw error
    }

    const created = await executeInContents(electronApp, pluginUrl, `(() => {
      const content = '大'.repeat(700000)
      const large = window.zvcBridge.createConversation({
        title: '大型 JSONL 会话',
        messages: [{ id: 'large-message', role: 'user', content, timestamp: Date.now() }],
      })
      const other = window.zvcBridge.createConversation({ title: '切换目标' })
      window.zvcBridge.setActiveConversation(other.id)
      const switched = window.zvcBridge.setActiveConversation(large.id)
      const storage = window.zvcBridge.getConversationStorageInfo(large.id)
      const index = window.ztools.db.get('zvc/conversations/' + large.id)
      window.zvcBridge.setActiveConversation(other.id)
      return {
        largeId: large.id,
        contentLength: switched.messages[0].content.length,
        logPath: storage.logPath,
        indexBytes: new TextEncoder().encode(JSON.stringify(index)).length,
        indexHasMessages: Boolean(index?.metadata?.messages),
      }
    })()`)

    expect(created.contentLength).toBe(700000)
    expect(created.indexBytes).toBeLessThan(10_000)
    expect(created.indexHasMessages).toBe(false)
    expect(created.logPath).toContain(path.join('plugins-data', 'ztools-vibe-coding', 'sessions'))
    expect((await fs.stat(created.logPath)).size).toBeGreaterThan(1024 * 1024)

    await executeInContents(electronApp, pluginUrl, 'location.reload()')
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('切换目标')
    const restoredLength = await executeInContents(
      electronApp,
      pluginUrl,
      `window.zvcBridge.getConversationById(${JSON.stringify(created.largeId)}).messages[0].content.length`,
    )
    expect(restoredLength).toBe(700000)

    // 长会话首次只挂载尾部窗口，向前展开后仍保持完整 Turn 边界。
    const pagedConversationId = await executeInContents(electronApp, pluginUrl, `(() => {
      const now = Date.now()
      const messages = Array.from({ length: 120 }, (_, index) => ({
        id: 'paged-' + index,
        turnId: 'turn-' + index,
        role: index % 2 ? 'assistant' : 'user',
        status: index % 2 ? 'completed' : undefined,
        content: '分页消息 ' + index,
        timestamp: now + index,
        completedAt: now + index,
      }))
      return window.zvcBridge.createConversation({ title: '分页会话', messages }).id
    })()`)
    await executeInContents(electronApp, pluginUrl, 'location.reload()')
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('分页消息 119')
    const initialRendered = await executeInContents(electronApp, pluginUrl, `({
      messages: document.querySelectorAll('.message').length,
      hasLoader: Boolean(document.querySelector('.history-loader button')),
    })`)
    expect(initialRendered.messages).toBe(50)
    expect(initialRendered.hasLoader).toBe(true)
    const initialRuntimeTrace = await executeInContents(electronApp, pluginUrl, `(() => ({
      registered: window.__zvcTrace?.findLast((entry) => entry.event === 'conversation:runtime-registered' && entry.conversationId === ${JSON.stringify(pagedConversationId)}),
      executionLoaded: window.__zvcTrace?.some((entry) => entry.event === 'execution:history-loaded' && entry.conversationId === ${JSON.stringify(pagedConversationId)}),
    }))()`)
    expect(initialRuntimeTrace.registered).toMatchObject({ visibleMessages: 50, totalMessages: 120, hasMore: true })
    expect(initialRuntimeTrace.executionLoaded).toBe(false)
    const historyAnchor = await executeInContents(electronApp, pluginUrl, `(() => {
      const scroller = document.querySelector('.chat-scroll')
      if (!scroller) throw new Error('未找到聊天滚动容器')
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll'))
      const row = document.querySelector('[data-chat-anchor-key]')
      if (!row) throw new Error('未找到历史消息锚点')
      return {
        key: row.dataset.chatAnchorKey,
        top: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      }
    })()`)
    await executeInContents(electronApp, pluginUrl, `document.querySelector('.history-loader button').click()`)
    await expect.poll(
      () => executeInContents(electronApp, pluginUrl, `document.querySelectorAll('.message').length`),
      { timeout: 5_000 },
    ).toBe(100)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `(() => {
      const scroller = document.querySelector('.chat-scroll')
      const row = [...document.querySelectorAll('[data-chat-anchor-key]')]
        .find((element) => element.dataset.chatAnchorKey === ${JSON.stringify(historyAnchor.key)})
      if (!scroller || !row) return 999
      return Math.abs((row.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - ${historyAnchor.top})
    })()`), { timeout: 5_000 }).toBeLessThanOrEqual(1)
    const loadedPageTrace = await executeInContents(electronApp, pluginUrl, `window.__zvcTrace?.findLast((entry) => entry.event === 'history:page-loaded')`)
    expect(loadedPageTrace).toMatchObject({ conversationId: pagedConversationId, loaded: 50, visibleMessages: 100, start: 20 })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
