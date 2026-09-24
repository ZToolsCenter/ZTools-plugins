import { expect, test, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addHostAiProvider, readHostModelKey } from "./host-ai-fixture.js";
import {
  createZToolsLaunchOptions,
  getZToolsSettingsUrlFragment,
} from "./ztools-launch.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pluginConfigPath = path.join(projectRoot, "public", "plugin.json");
const pluginDevelopmentPath = path.dirname(pluginConfigPath);
const pluginUrl = "http://127.0.0.1:15240";
const settingsUrlFragment = getZToolsSettingsUrlFragment();

/**
 * 在指定 WebContentsView 中执行脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws {Error} 目标 WebContentsView 不存在或脚本执行失败时抛出。
 */
async function executeInContents(electronApp, urlFragment, source) {
  return electronApp.evaluate(
    async ({ webContents }, { fragment, script }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(fragment));
      if (!contents)
        throw new Error(`未找到 ${fragment} 对应的 WebContentsView`);
      return contents.executeJavaScript(script);
    },
    { fragment: urlFragment, script: source },
  );
}

/**
 * 读取指定 WebContentsView 的正文文本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；尚未加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents || contents.isLoading()) return "";
    return contents.executeJavaScript("document.body.innerText");
  }, urlFragment);
}

/**
 * 枚举宿主中的 WebContents 状态，便于定位开发插件没有完成加载的原因。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<Array<{url: string, loading: boolean, title: string, text: string}>>} WebContents 诊断列表。
 */
async function readContentsDiagnostics(electronApp) {
  return electronApp.evaluate(async ({ webContents }) =>
    Promise.all(
      webContents.getAllWebContents().map(async (contents) => ({
        url: contents.getURL(),
        loading: contents.isLoading(),
        title: contents.getTitle(),
        text: await contents
          .executeJavaScript('document.body?.innerText || ""')
          .catch((error) => `ERROR: ${error.message}`),
      })),
    ),
  );
}

/**
 * 截取插件视图并统计可见的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number, width: number, height: number}>} 插件截图与像素统计。
 * @throws {Error} 插件 WebContentsView 不存在时抛出。
 */
async function capturePlugin(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const image = await contents.capturePage();
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8 ||
        (red + green + blue) / 3 < 220
      )
        nonBackgroundPixels += 1;
    }
    return {
      png: image.toPNG().toString("base64"),
      nonBackgroundPixels,
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

test("完整 Turn 支持复制与分叉且会话菜单使用归档", async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "zvc-conversation-actions-e2e-"),
  );
  const legacyRoot = path.join(dataRoot, "legacy");
  let electronApp = null;
  let originalClipboardText = "";
  let clipboardNeedsRestore = false;
  await fs.mkdir(legacyRoot, { recursive: true });

  try {
    electronApp = await electron.launch(
      createZToolsLaunchOptions(dataRoot, legacyRoot),
    );
    // 真实剪贴板验证前保存原内容，并在断言后或异常清理阶段恢复。
    originalClipboardText = await electronApp.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    clipboardNeedsRestore = true;

    const page = await electronApp.firstWindow();
    await page.locator(".search-input").fill("通用设置");
    await page
      .locator(".app-item, .list-item")
      .filter({ hasText: "通用设置" })
      .first()
      .click();
    await expect
      .poll(() => readContentsText(electronApp, settingsUrlFragment), {
        timeout: 15_000,
      })
      .toContain("开机自动启动");

    await addHostAiProvider(
      executeInContents,
      electronApp,
      settingsUrlFragment,
      {
        name: "会话模型测试",
        apiUrl: "http://127.0.0.1:15241/v1",
        apiKey: "test-key",
        models: [
          { modelId: "model-a" },
          ...Array.from({ length: 12 }, (_, index) => ({
            modelId: `model-${String(index + 1).padStart(2, "0")}`,
          })),
          { modelId: "model-b" },
        ],
      },
    );

    const imported = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`,
    );
    expect(imported).toMatchObject({
      success: true,
      pluginName: "ztools-vibe-coding",
    });
    expect(
      await executeInContents(
        electronApp,
        settingsUrlFragment,
        `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`,
      ),
    ).toMatchObject({ success: true });
    const plugins = await executeInContents(
      electronApp,
      settingsUrlFragment,
      "window.ztools.internal.getAllPlugins()",
    );
    const developmentPlugin = plugins.find(
      (plugin) =>
        plugin.name === "ztools-vibe-coding__dev" && plugin.isDevelopment,
    );
    expect(
      await executeInContents(
        electronApp,
        settingsUrlFragment,
        `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`,
      ),
    ).toMatchObject({ success: true });
    try {
      await expect
        .poll(() => readContentsText(electronApp, pluginUrl), {
          timeout: 20_000,
        })
        .toContain("全能 AI 助手");
    } catch (error) {
      // 插件入口加载失败时附加全部视图状态，避免通过更换端口猜测原因。
      const diagnostics = await readContentsDiagnostics(electronApp);
      throw new Error(
        `${error.message}\nWebContents: ${JSON.stringify(diagnostics, null, 2)}`,
      );
    }
    const modelAKey = await readHostModelKey(
      executeInContents,
      electronApp,
      pluginUrl,
      "model-a",
    );
    const modelBKey = await readHostModelKey(
      executeInContents,
      electronApp,
      pluginUrl,
      "model-b",
    );

    const conversationIds = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const source = window.zvcBridge.createConversation({
        title: '可分叉会话',
        modelKey: ${JSON.stringify(modelAKey)},
        messages: [
          { id: 'user-1', turnId: 'turn-1', role: 'user', content: '第一轮问题', timestamp: 1000 },
          { id: 'assistant-1', turnId: 'turn-1', role: 'assistant', content: '第一轮回答', status: 'completed', completedAt: 1500, tool_calls: [] },
          { id: 'user-2', turnId: 'turn-2', role: 'user', content: '第二轮问题', timestamp: 2000 },
          { id: 'assistant-tool', turnId: 'turn-2', role: 'assistant', content: '', status: 'completed', tool_calls: [{ id: 'call-1', name: 'bash', status: 'completed' }] },
          { id: 'tool-1', turnId: 'turn-2', role: 'tool', tool_call_id: 'call-1', content: 'done' },
          { id: 'assistant-2', turnId: 'turn-2', role: 'assistant', content: '第二轮回答', status: 'completed', completedAt: 2500, tool_calls: [] },
          { id: 'user-3', turnId: 'turn-3', role: 'user', content: '第三轮问题', timestamp: 3000 },
          { id: 'assistant-3', turnId: 'turn-3', role: 'assistant', content: '已停止的回答', status: 'stopped', tool_calls: [] },
        ],
        tasks: [{ content: '不应复制的任务', status: 'completed' }],
        contextState: { summary: '不应复制的后续摘要', compactedThroughTurnId: 'turn-2' },
      })
      const secondary = window.zvcBridge.createConversation({ title: '模型 B 会话', modelKey: ${JSON.stringify(modelBKey)} })
      const legacy = window.zvcBridge.createConversation({ title: '待恢复模型的旧会话' })
      window.zvcBridge.setActiveConversation(source.id)
      location.reload()
      return { sourceId: source.id, secondaryId: secondary.id, legacyId: legacy.id, legacyUpdatedAt: legacy.updatedAt }
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("第二轮回答");

    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `document.querySelector('.model-reasoning-trigger')?.dataset.modelValue || ''`,
      ),
    ).toBe(modelAKey);

    // 打开自定义概览并确认输入区不再渲染原生模型选择器。
    const pickerOverview = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const trigger = document.querySelector('.model-reasoning-trigger')
      if (!trigger) throw new Error('未找到模型选择触发器')
      trigger.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const popover = document.querySelector('.model-reasoning-popover')
      if (!popover) throw new Error('模型设置弹窗未打开')
      return {
        text: popover.textContent?.replace(/\\s+/g, ' ').trim() || '',
        nativeSelectCount: document.querySelectorAll('.composer select').length,
        expanded: trigger.getAttribute('aria-expanded'),
      }
    })()`,
    );
    expect(pickerOverview).toMatchObject({
      nativeSelectCount: 0,
      expanded: "true",
    });
    expect(pickerOverview.text).toContain("模型");
    expect(pickerOverview.text).toContain("model-a");

    const pickerCapture = await capturePlugin(electronApp);
    const pickerScreenshot = Buffer.from(pickerCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("model-reasoning-picker.png"),
      pickerScreenshot,
    );
    await testInfo.attach("model-reasoning-picker", {
      body: pickerScreenshot,
      contentType: "image/png",
    });
    expect(pickerCapture.nonBackgroundPixels).toBeGreaterThan(500);

    // 通过自定义列表切换模型，并恢复源会话模型供后续分叉断言使用。
    const modelOptionValues = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const row = document.querySelector('[aria-label="选择模型"]')
      if (!row) throw new Error('未找到模型列表入口')
      row.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return [...document.querySelectorAll('.model-reasoning-option')].map((option) => option.dataset.value)
    })()`,
    );
    expect(modelOptionValues).toEqual(
      expect.arrayContaining([modelAKey, modelBKey]),
    );
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.model-reasoning-option[data-value=${JSON.stringify(modelBKey)}]')?.click(); true`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `document.querySelector('.model-reasoning-trigger')?.dataset.modelValue || ''`,
        ),
      )
      .toBe(modelBKey);

    // 当前模型位于长列表末尾时，进入列表应自动定位并保持选中项完整可见。
    const selectedModelPosition = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.model-reasoning-trigger')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      document.querySelector('[aria-label="选择模型"]')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const list = document.querySelector('.model-reasoning-options')
      const selected = document.querySelector('.model-reasoning-option[aria-checked="true"]')
      if (!list || !selected) throw new Error('未找到模型列表或当前选中项')
      const listRect = list.getBoundingClientRect()
      const selectedRect = selected.getBoundingClientRect()
      return {
        scrollTop: list.scrollTop,
        selectedValue: selected.dataset.value,
        selectedVisible: selectedRect.top >= listRect.top && selectedRect.bottom <= listRect.bottom,
      }
    })()`,
    );
    expect(selectedModelPosition).toMatchObject({
      selectedValue: modelBKey,
      selectedVisible: true,
    });
    expect(selectedModelPosition.scrollTop).toBeGreaterThan(0);
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.model-reasoning-option[data-value=${JSON.stringify(modelAKey)}]')?.click(); true`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `document.querySelector('.model-reasoning-trigger')?.dataset.modelValue || ''`,
        ),
      )
      .toBe(modelAKey);

    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('模型 B 会话')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.model-reasoning-trigger')?.dataset.modelValue || ''`,
          ),
        { timeout: 5_000 },
      )
      .toBe(modelBKey);
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('可分叉会话')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.model-reasoning-trigger')?.dataset.modelValue || ''`,
          ),
        { timeout: 5_000 },
      )
      .toBe(modelAKey);

    // 首次打开没有会话模型的旧记录会补齐默认模型，但不得刷新会话活动时间。
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('待恢复模型的旧会话')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `window.zvcBridge.getConversationById(${JSON.stringify(conversationIds.legacyId)})`,
          ),
        { timeout: 5_000 },
      )
      .toBeTruthy();
    const restoredLegacy = await executeInContents(
      electronApp,
      pluginUrl,
      `window.zvcBridge.getConversationById(${JSON.stringify(conversationIds.legacyId)})`,
    );
    expect(restoredLegacy.modelKey).toBe(modelAKey);
    expect(restoredLegacy.updatedAt).toBe(conversationIds.legacyUpdatedAt);
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('可分叉会话')))?.click(); true`,
    );

    const visibleState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const trigger = document.querySelector('.conversation-item.active .conversation-menu-trigger')
      trigger?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const turnActions = [...document.querySelectorAll('.assistant-turn-actions')]
      return {
        copyButtons: document.querySelectorAll('.assistant-copy-button').length,
        branchButtons: document.querySelectorAll('.assistant-branch-button').length,
        inlineTimes: turnActions.filter((item) => item.querySelector('.message-time')).length,
        actionAlignments: turnActions.map((item) => {
          const buttonBounds = item.querySelector('.assistant-branch-button')?.getBoundingClientRect()
          const timeBounds = item.querySelector('.message-time')?.getBoundingClientRect()
          return buttonBounds && timeBounds
            ? Math.abs((buttonBounds.top + buttonBounds.bottom) / 2 - (timeBounds.top + timeBounds.bottom) / 2)
            : null
        }),
        menuText: document.querySelector('.conversation-menu')?.innerText || '',
      }
    })()`,
    );
    expect(visibleState.copyButtons).toBe(2);
    expect(visibleState.branchButtons).toBe(2);
    expect(visibleState.inlineTimes).toBe(2);
    expect(visibleState.actionAlignments).toEqual([0, 0]);
    expect(visibleState.menuText).toContain("重命名");
    expect(visibleState.menuText).toContain("分叉会话");
    expect(visibleState.menuText).toContain("归档会话");
    expect(visibleState.menuText).not.toContain("删除");

    // 复制最终助手正文，不应把思考、工具调用或时间混入剪贴板。
    const copyFeedback = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const button = document.querySelector('.assistant-copy-button')
      button?.click()
      await new Promise((resolve) => setTimeout(resolve, 50))
      button?.focus()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        label: button?.getAttribute('aria-label') || '',
        firstAction: button?.parentElement?.firstElementChild === button,
        tooltip: document.querySelector('[role="tooltip"]')?.textContent || '',
      }
    })()`,
    );
    expect(copyFeedback).toEqual({
      label: "已复制",
      firstAction: true,
      tooltip: "已复制",
    });
    await expect
      .poll(
        () => electronApp.evaluate(({ clipboard }) => clipboard.readText()),
        { timeout: 3_000 },
      )
      .toBe("第一轮回答");
    await electronApp.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      originalClipboardText,
    );
    clipboardNeedsRestore = false;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `document.querySelector('.assistant-copy-button')?.getAttribute('aria-label') || ''`,
      ),
    ).toBe("复制");

    // 在真实插件 WebContents 中触发提示，验证浮层样式和原生 title 已被统一替换。
    const tooltipState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.conversation-menu-layer')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const trigger = document.querySelector('.assistant-branch-button')
      trigger?.focus()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const tooltip = document.querySelector('[role="tooltip"]')
      const triggerBounds = trigger?.getBoundingClientRect()
      const tooltipBounds = tooltip?.getBoundingClientRect()
      const style = tooltip ? getComputedStyle(tooltip) : null
      return {
        text: tooltip?.textContent || '',
        hidden: tooltip?.hidden ?? true,
        side: tooltip?.dataset.side || '',
        position: style?.position || '',
        borderRadius: style?.borderRadius || '',
        backgroundColor: style?.backgroundColor || '',
        color: style?.color || '',
        pointerEvents: style?.pointerEvents || '',
        belowAnchor: Boolean(triggerBounds && tooltipBounds && tooltipBounds.top >= triggerBounds.bottom),
        describedBy: trigger?.getAttribute('aria-describedby') || '',
        nativeTitleCount: document.querySelectorAll('[title]').length,
      }
    })()`,
    );
    expect(tooltipState).toMatchObject({
      text: "在新会话中分叉",
      hidden: false,
      side: "bottom",
      position: "fixed",
      borderRadius: "8px",
      color: "rgb(255, 255, 255)",
      pointerEvents: "none",
      belowAnchor: true,
      describedBy: "zvc-global-tooltip",
      nativeTitleCount: 0,
    });
    expect(tooltipState.backgroundColor).toMatch(
      /^rgba?\((?:44, 44, 46|67, 69, 74)(?:, 1)?\)$/,
    );

    // 离开消息底部后显示悬浮回底按钮，点击后恢复跟随且按钮不参与滚动高度。
    const backToBottomVisible = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.activeElement?.blur()
      const content = document.querySelector('.chat-content')
      const scroller = document.querySelector('.chat-scroll')
      const spacer = document.createElement('div')
      spacer.className = 'e2e-scroll-spacer'
      spacer.style.height = '1800px'
      content?.appendChild(spacer)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (scroller) {
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 240)
        scroller.dispatchEvent(new Event('scroll'))
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const button = document.querySelector('.chat-to-bottom')
      const buttonBounds = button?.getBoundingClientRect()
      const scrollerBounds = scroller?.getBoundingClientRect()
      const style = button ? getComputedStyle(button) : null
      return {
        visible: Boolean(button),
        label: button?.getAttribute('aria-label') || '',
        width: Math.round(buttonBounds?.width || 0),
        height: Math.round(buttonBounds?.height || 0),
        borderRadius: style?.borderRadius || '',
        insideChat: Boolean(buttonBounds && scrollerBounds
          && buttonBounds.right <= scrollerBounds.right
          && buttonBounds.bottom <= scrollerBounds.bottom
          && buttonBounds.top >= scrollerBounds.top),
      }
    })()`,
    );
    expect(backToBottomVisible).toMatchObject({
      visible: true,
      label: "回到底部",
      width: 34,
      height: 34,
      insideChat: true,
    });
    expect(
      Number.parseFloat(backToBottomVisible.borderRadius),
    ).toBeGreaterThanOrEqual(17);
    const backToBottomCapture = await capturePlugin(electronApp);
    const backToBottomScreenshot = Buffer.from(
      backToBottomCapture.png,
      "base64",
    );
    await fs.writeFile(
      testInfo.outputPath("back-to-bottom.png"),
      backToBottomScreenshot,
    );
    await testInfo.attach("back-to-bottom", {
      body: backToBottomScreenshot,
      contentType: "image/png",
    });
    const backToBottomResult = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.chat-to-bottom')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const scroller = document.querySelector('.chat-scroll')
      const distance = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
      const hidden = document.querySelector('.chat-to-bottom') === null
      document.querySelector('.e2e-scroll-spacer')?.remove()
      return { distance, hidden }
    })()`,
    );
    expect(backToBottomResult.hidden).toBe(true);
    expect(backToBottomResult.distance).toBeLessThanOrEqual(1);

    const rendered = await capturePlugin(electronApp);
    expect(rendered.width).toBeGreaterThan(640);
    expect(rendered.height).toBeGreaterThan(400);
    expect(rendered.nonBackgroundPixels).toBeGreaterThan(2_000);
    const screenshot = Buffer.from(rendered.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("conversation-actions-ui.png"),
      screenshot,
    );
    await testInfo.attach("conversation-actions-ui", {
      body: screenshot,
      contentType: "image/png",
    });
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.assistant-branch-button')?.blur(); true`,
    );

    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelectorAll('.assistant-branch-button')[0]?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-item.active strong')?.textContent || ''`,
          ),
        { timeout: 10_000 },
      )
      .toBe("可分叉会话 (1)");
    const forked = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const state = window.zvcBridge.getInitialState()
      return window.zvcBridge.getConversationById(state.activeConversationId)
    })()`,
    );
    expect(forked.id).not.toBe(conversationIds.sourceId);
    expect(forked.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(forked.modelKey).toBe(modelAKey);
    expect(forked.tasks).toEqual([]);
    expect(forked.contextState.summary).toBe("");

    await testInfo.attach("conversation-actions-state", {
      body: Buffer.from(
        JSON.stringify(
          {
            visibleState,
            tooltipState,
            forkedTitle: forked.title,
            messageIds: forked.messages.map((message) => message.id),
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  } finally {
    if (electronApp && clipboardNeedsRestore) {
      await electronApp
        .evaluate(
          ({ clipboard }, text) => clipboard.writeText(text),
          originalClipboardText,
        )
        .catch(() => {});
    }
    await electronApp?.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
