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
const settingsUrlFragment = getZToolsSettingsUrlFragment()

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
 * 读取指定 WebContentsView 的正文。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；视图尚未完成加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  }, urlFragment)
}

/**
 * 截取插件 WebContentsView 并统计可见非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number, nonBackgroundPixels: number}>} 截图和像素统计。
 * @throws {Error} 插件视图不存在时抛出。
 */
async function capturePlugin(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
    if (!contents) throw new Error('未找到 ZVC WebContentsView')
    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    // 统计具有明显颜色差或低亮度的像素，防止透明合成层产生白屏。
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 8 || (red + green + blue) / 3 < 220) nonBackgroundPixels += 1
    }
    return { png: image.toPNG().toString('base64'), width: image.getSize().width, height: image.getSize().height, nonBackgroundPixels }
  }, pluginUrl)
}

test('工作区选择、分组和会话锁定在真实 ZTools 中保持一致', async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-workspace-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const workspaceRoot = path.join(dataRoot, 'workspaces')
  const skillRoot = path.join(dataRoot, 'skills')
  const bundledSkillRoot = path.join(projectRoot, 'public', 'skills', 'develop-ztools-plugin')
  const installedSkillRoot = path.join(skillRoot, 'develop-ztools-plugin')
  let electronApp = null
  await fs.mkdir(legacyRoot, { recursive: true })
  // 预置一个无版本标记的旧简版 Skill，覆盖真实升级边界。
  await fs.mkdir(installedSkillRoot, { recursive: true })
  await fs.writeFile(path.join(installedSkillRoot, 'SKILL.md'), '---\nname: develop-ztools-plugin\ndescription: legacy\n---\n\n# Legacy Skill\n')

  try {
    const launchOptions = createZToolsLaunchOptions(dataRoot, legacyRoot)
    electronApp = await electron.launch({
      ...launchOptions,
      env: {
        ...launchOptions.env,
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZVC_SKILL_ROOT: skillRoot,
        ZVC_WORKSPACE_ROOT: workspaceRoot,
      },
    })

    const page = await electronApp.firstWindow()
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readContentsText(electronApp, settingsUrlFragment), { timeout: 15_000 }).toContain('开机自动启动')
    expect(await executeInContents(electronApp, settingsUrlFragment, `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`)).toMatchObject({ success: true })
    expect(await executeInContents(electronApp, settingsUrlFragment, `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`)).toMatchObject({ success: true })
    const plugins = await executeInContents(electronApp, settingsUrlFragment, 'window.ztools.internal.getAllPlugins()')
    const developmentPlugin = plugins.find((plugin) => plugin.name === 'ztools-vibe-coding__dev' && plugin.isDevelopment)
    expect(await executeInContents(electronApp, settingsUrlFragment, `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`)).toMatchObject({ success: true })
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 20_000 }).toContain('今天想完成什么')

    const bundledSkillState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const skill = window.zvcBridge.getSkills().find((item) => item.id === 'develop-ztools-plugin')
      const invocation = await window.zvcBridge.invokeTool('', 'Skill', { skill: 'develop-ztools-plugin' }, { enabledSkills: ['develop-ztools-plugin'] })
      return {
        skill,
        invocationName: invocation.name,
        instructionText: invocation.instructions,
        assetPaths: invocation.assets.map((asset) => asset.path),
      }
    })()`)
    expect(bundledSkillState.skill).toMatchObject({ id: 'develop-ztools-plugin', name: 'develop-ztools-plugins', path: installedSkillRoot })
    expect(bundledSkillState.invocationName).toBe('develop-ztools-plugins')
    expect(bundledSkillState.instructionText).toContain('# 开发 ZTools 插件')
    expect(bundledSkillState.instructionText).toContain('scripts/create_plugin.py')
    expect(bundledSkillState.instructionText).toContain('禁止交付模板自带或通用占位图标')
    expect(bundledSkillState.instructionText).toContain('生成独立 SVG 源图标')
    expect(bundledSkillState.assetPaths).toEqual(expect.arrayContaining([
      'references/ai-plugin-guide.md',
      'references/plugin-contract.md',
      'scripts/create_plugin.py',
      'scripts/validate_plugin.py',
      'assets/templates/vue-vite/src/App.vue',
    ]))
    expect(await fs.readFile(path.join(installedSkillRoot, 'SKILL.md'), 'utf8')).toBe(await fs.readFile(path.join(bundledSkillRoot, 'SKILL.md'), 'utf8'))
    expect(await fs.readFile(path.join(installedSkillRoot, '.zvc-bundled-revision'), 'utf8')).toBe('12')

    const seeded = await executeInContents(electronApp, pluginUrl, `(() => {
      const alpha = window.zvcBridge.createWorkspace({ name: 'Alpha 工作区' })
      const beta = window.zvcBridge.createWorkspace({ name: 'Beta 工作区' })
      window.zvcBridge.createConversation({ title: 'Alpha 会话', projectId: alpha.id })
      for (let index = 2; index <= 7; index += 1) {
        window.zvcBridge.createConversation({ title: \`Alpha 会话 \${index}\`, projectId: alpha.id })
      }
      window.zvcBridge.createConversation({ title: 'Beta 会话', projectId: beta.id })
      const recent = window.zvcBridge.createConversation({ title: '普通会话' })
      window.zvcBridge.setActiveConversation(recent.id)
      location.reload()
      return { alpha, beta, recentId: recent.id }
    })()`)
    await expect.poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 }).toContain('Alpha 工作区')

    const workspaceOverflowState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const group = [...document.querySelectorAll('.workspace-conversation-group')]
        .find((item) => item.textContent.includes('Alpha 工作区'))
      const overflow = group?.querySelector('.workspace-conversations-overflow')
      const initial = {
        visible: group?.querySelectorAll('.conversation-item').length || 0,
        label: overflow?.textContent.trim() || '',
        expanded: overflow?.getAttribute('aria-expanded'),
      }
      overflow?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const expanded = {
        visible: group?.querySelectorAll('.conversation-item').length || 0,
        label: overflow?.textContent.trim() || '',
        ariaExpanded: overflow?.getAttribute('aria-expanded'),
      }
      return { initial, expanded }
    })()`)
    expect(workspaceOverflowState).toEqual({
      initial: { visible: 5, label: '展开其余 2 个会话', expanded: 'false' },
      expanded: { visible: 7, label: '收起', ariaExpanded: 'true' },
    })

    const grouped = await executeInContents(electronApp, pluginUrl, `(() => ({
      workspaces: [...document.querySelectorAll('.workspace-conversation-group')].map((group) => group.innerText),
      recent: document.querySelector('.recent-conversation-group')?.innerText || '',
    }))()`)
    expect(grouped.workspaces).toHaveLength(2)
    expect(grouped.workspaces.find((text) => text.includes('Alpha 工作区'))).toContain('Alpha 会话')
    expect(grouped.workspaces.find((text) => text.includes('Beta 工作区'))).toContain('Beta 会话')
    expect(grouped.recent).toContain('普通会话')
    expect(grouped.recent).not.toContain('Alpha 会话')

    const expandedWorkspaceState = await executeInContents(electronApp, pluginUrl, `(() => {
      const group = [...document.querySelectorAll('.workspace-conversation-group')]
        .find((item) => item.textContent.includes('Alpha 工作区'))
      const toggle = group?.querySelector('.workspace-group-toggle')
      const workspaceTitle = toggle?.querySelector('strong')
      const conversationTitle = group?.querySelector('.conversation-item .project-item-copy strong')
      return {
        expanded: toggle?.getAttribute('aria-expanded'),
        openFolder: Boolean(toggle?.querySelector('.workspace-group-folder.is-open')),
        closedFolder: Boolean(toggle?.querySelector('.workspace-group-folder:not(.is-open)')),
        chevron: Boolean(toggle?.querySelector('.workspace-group-chevron')),
        count: Boolean(toggle?.querySelector('small')),
        titleAlignmentGap: Math.abs((workspaceTitle?.getBoundingClientRect().left || 0) - (conversationTitle?.getBoundingClientRect().left || 0)),
      }
    })()`)
    expect(expandedWorkspaceState).toMatchObject({
      expanded: 'true',
      openFolder: true,
      closedFolder: false,
      chevron: false,
      count: false,
    })
    expect(expandedWorkspaceState.titleAlignmentGap).toBeLessThanOrEqual(1)

    const collapsedWorkspaceState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const group = [...document.querySelectorAll('.workspace-conversation-group')]
        .find((item) => item.textContent.includes('Alpha 工作区'))
      const toggle = group?.querySelector('.workspace-group-toggle')
      toggle?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const result = {
        expanded: toggle?.getAttribute('aria-expanded'),
        openFolder: Boolean(toggle?.querySelector('.workspace-group-folder.is-open')),
        closedFolder: Boolean(toggle?.querySelector('.workspace-group-folder:not(.is-open)')),
        conversationsVisible: Boolean(group?.querySelector('.workspace-group-conversations')),
      }
      toggle?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      result.restoredVisible = group?.querySelectorAll('.conversation-item').length || 0
      result.overflowExpanded = group?.querySelector('.workspace-conversations-overflow')?.getAttribute('aria-expanded')
      return result
    })()`)
    expect(collapsedWorkspaceState).toEqual({
      expanded: 'false',
      openFolder: false,
      closedFolder: true,
      conversationsVisible: false,
      restoredVisible: 5,
      overflowExpanded: 'false',
    })

    // 工作区行驻留后应在右侧显示完整详情卡，而不是底部的单行路径提示。
    const workspaceHoverState = await executeInContents(electronApp, pluginUrl, `(async () => {
      const anchor = [...document.querySelectorAll('.workspace-hover-anchor')]
        .find((item) => item.textContent.includes('Alpha 工作区'))
      anchor?.dispatchEvent(new PointerEvent('pointerenter'))
      await new Promise((resolve) => setTimeout(resolve, 650))
      const card = document.querySelector('.workspace-hover-card')
      const anchorBounds = anchor?.getBoundingClientRect()
      const cardBounds = card?.getBoundingClientRect()
      const style = card ? getComputedStyle(card) : null
      return {
        text: card?.innerText || '',
        copyLabel: card?.getAttribute('aria-label') || '',
        rightOfAnchor: Boolean(anchorBounds && cardBounds && cardBounds.left >= anchorBounds.right + 7),
        position: style?.position || '',
        width: Math.round(cardBounds?.width || 0),
        borderRadius: style?.borderRadius || '',
        backgroundColor: style?.backgroundColor || '',
      }
    })()`)
    expect(workspaceHoverState.text).toContain('Alpha 工作区')
    expect(workspaceHoverState.text).toContain(seeded.alpha.path)
    expect(workspaceHoverState.text).toMatch(/创建于 \d+年\d+月\d+日 \d{2}:\d{2}/)
    expect(workspaceHoverState.copyLabel).toBe(`复制: ${seeded.alpha.path}`)
    expect(workspaceHoverState).toMatchObject({
      rightOfAnchor: true,
      position: 'fixed',
      width: 244,
      borderRadius: '12px',
      backgroundColor: 'rgb(44, 44, 46)',
    })
    const workspaceHoverScreenshot = await capturePlugin(electronApp)
    const workspaceHoverScreenshotBuffer = Buffer.from(workspaceHoverScreenshot.png, 'base64')
    await fs.writeFile(testInfo.outputPath('workspace-hover-card.png'), workspaceHoverScreenshotBuffer)
    await testInfo.attach('workspace-hover-card', {
      body: workspaceHoverScreenshotBuffer,
      contentType: 'image/png',
    })
    await executeInContents(electronApp, pluginUrl, `(() => {
      const anchor = [...document.querySelectorAll('.workspace-hover-anchor')]
        .find((item) => item.textContent.includes('Alpha 工作区'))
      anchor?.dispatchEvent(new PointerEvent('pointerleave'))
      return true
    })()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelector('.workspace-hover-card') === null`), { timeout: 3_000 }).toBe(true)

    const pickerText = await executeInContents(electronApp, pluginUrl, `(async () => {
      document.querySelector('.workspace-picker-trigger')?.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return document.querySelector('.workspace-picker-menu')?.innerText || ''
    })()`)
    expect(pickerText).toContain('创建新工作区')
    expect(pickerText).toContain('添加本地文件夹')
    expect(pickerText).toContain('Alpha 工作区')

    const capabilityState = await executeInContents(electronApp, pluginUrl, `(async () => {
      document.querySelector('.capability-button')?.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const popover = document.querySelector('.capability-popover')
      return {
        text: popover?.innerText || '',
        workspaceControls: popover?.querySelectorAll('.capability-project-note, .project-binding-section, .capability-project-option, .capability-project-action').length || 0,
      }
    })()`)
    expect(capabilityState.workspaceControls).toBe(0)
    await executeInContents(electronApp, pluginUrl, `document.querySelector('.capability-popover-header .icon-button')?.click(); true`)

    await executeInContents(electronApp, pluginUrl, `(() => {
      document.querySelector('.workspace-picker-trigger')?.click()
      const option = [...document.querySelectorAll('.workspace-picker-option')].find((item) => item.textContent.includes('Alpha 工作区'))
      option?.click()
      return true
    })()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `window.zvcBridge.getConversationById(${JSON.stringify(seeded.recentId)}).projectId`), { timeout: 5_000 }).toBe(seeded.alpha.id)

    const inheritedConversation = await executeInContents(electronApp, pluginUrl, `(() => {
      document.querySelector('.new-conversation-button')?.click()
      const state = window.zvcBridge.getInitialState()
      return window.zvcBridge.getConversationById(state.activeConversationId)
    })()`)
    expect(inheritedConversation.id).not.toBe(seeded.recentId)
    expect(inheritedConversation.projectId).toBe(seeded.alpha.id)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelector('.new-conversation-workspace .workspace-picker-trigger')?.textContent || ''`), { timeout: 5_000 }).toContain('Alpha 工作区')
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.activeElement === document.querySelector('.composer textarea')`), { timeout: 5_000 }).toBe(true)
    const pickerPlacement = await executeInContents(electronApp, pluginUrl, `(() => {
      const workspaceControl = document.querySelector('.new-conversation-workspace')
      const composer = document.querySelector('.composer')
      return {
        workspaceBottom: workspaceControl?.getBoundingClientRect().bottom || 0,
        composerTop: composer?.getBoundingClientRect().top || 0,
        insideComposer: Boolean(composer?.querySelector('.workspace-picker-trigger')),
        insideComposerFooter: Boolean(document.querySelector('.composer-footer .workspace-picker-trigger')),
      }
    })()`)
    expect(pickerPlacement.workspaceBottom).toBeLessThanOrEqual(pickerPlacement.composerTop)
    expect(pickerPlacement.insideComposer).toBe(false)
    expect(pickerPlacement.insideComposerFooter).toBe(false)
    const newConversationScreenshot = await capturePlugin(electronApp)
    const newConversationScreenshotBuffer = Buffer.from(newConversationScreenshot.png, 'base64')
    await fs.writeFile(testInfo.outputPath('new-conversation-workspace.png'), newConversationScreenshotBuffer)
    await testInfo.attach('new-conversation-workspace', { body: newConversationScreenshotBuffer, contentType: 'image/png' })

    await executeInContents(electronApp, pluginUrl, `(() => {
      const conversation = window.zvcBridge.getConversationById(${JSON.stringify(inheritedConversation.id)})
      window.zvcBridge.updateConversation(conversation.id, {
        workspaceLocked: true,
        messages: [{ id: 'user-lock', role: 'user', content: '开始处理', timestamp: Date.now() }],
      })
      location.reload()
      return true
    })()`)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, `document.querySelector('.new-conversation-workspace') === null && document.querySelector('.workspace-picker-trigger') === null`), { timeout: 10_000 }).toBe(true)
    const lockError = await executeInContents(electronApp, pluginUrl, `(() => {
      try { window.zvcBridge.setConversationWorkspace(${JSON.stringify(inheritedConversation.id)}, ${JSON.stringify(seeded.beta.id)}); return '' }
      catch (error) { return error.message }
    })()`)
    expect(lockError).toContain('工作区不可更改')
    expect(await fs.readdir(seeded.alpha.path)).toEqual([])
    expect(await fs.readdir(seeded.beta.path)).toEqual([])

    // 通过隔离视图缩放形成约 400px 的 CSS 布局宽度，覆盖宿主原生最小窗口限制。
    await electronApp.evaluate(({ webContents }, fragment) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
      if (!contents) throw new Error('未找到 ZVC WebContentsView')
      contents.setZoomFactor(2)
    }, pluginUrl)
    await expect.poll(() => executeInContents(electronApp, pluginUrl, 'window.innerWidth'), { timeout: 5_000 }).toBeLessThanOrEqual(440)
    const narrowLayout = await executeInContents(electronApp, pluginUrl, `(() => {
      const shell = document.querySelector('.app-shell')
      const conversationList = document.querySelector('.conversation-list')
      const listBounds = conversationList?.getBoundingClientRect()
      return {
        viewportWidth: window.innerWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        shellWidth: Math.ceil(shell?.getBoundingClientRect().width || 0),
        conversationListClientWidth: conversationList?.clientWidth || 0,
        conversationListScrollWidth: conversationList?.scrollWidth || 0,
        conversationListOverflowX: conversationList ? getComputedStyle(conversationList).overflowX : '',
        overflowingNodes: [...(conversationList?.querySelectorAll('*') || [])]
          .filter((item) => item.getBoundingClientRect().right > (listBounds?.right || 0) + 0.5)
          .slice(0, 12)
          .map((item) => ({ className: item.className?.baseVal || item.className || item.tagName, right: item.getBoundingClientRect().right })),
      }
    })()`)
    expect(narrowLayout.documentScrollWidth).toBeLessThanOrEqual(narrowLayout.documentClientWidth)
    expect(narrowLayout.bodyScrollWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth)
    expect(narrowLayout.shellWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth)
    expect(narrowLayout.conversationListOverflowX).toBe('hidden')
    expect(narrowLayout.conversationListScrollWidth, JSON.stringify(narrowLayout)).toBeLessThanOrEqual(narrowLayout.conversationListClientWidth)

    const screenshot = await capturePlugin(electronApp)
    // 恢复隔离视图缩放，避免后续测试复用时继承窄布局状态。
    await electronApp.evaluate(({ webContents }, fragment) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL().includes(fragment))
      contents?.setZoomFactor(1)
    }, pluginUrl)
    expect(screenshot.width).toBeGreaterThan(360)
    expect(screenshot.height).toBeGreaterThan(400)
    expect(screenshot.nonBackgroundPixels).toBeGreaterThan(2_000)
    const screenshotBuffer = Buffer.from(screenshot.png, 'base64')
    await fs.writeFile(testInfo.outputPath('workspace-ui.png'), screenshotBuffer)
    await testInfo.attach('workspace-ui', { body: screenshotBuffer, contentType: 'image/png' })
    await testInfo.attach('workspace-state', { body: Buffer.from(JSON.stringify({ grouped, pickerText, lockError, narrowLayout }, null, 2)), contentType: 'application/json' })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
