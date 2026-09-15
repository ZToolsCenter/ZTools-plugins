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
 * 截取 ZVC 设置弹窗并统计实际绘制的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number, width: number, height: number}>} 设置弹窗截图与像素统计。
 * @throws {Error} 插件视图或设置弹窗不存在时抛出。
 */
async function captureSettingsDialog(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(async () => {
      const dialog = document.querySelector('[role="dialog"][aria-label="ZVC 设置"]')
      if (!dialog) throw new Error('未找到 ZVC 设置弹窗')
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = dialog.getBoundingClientRect()
      return { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8 ||
        (red + green + blue) / 3 < 215
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

/**
 * 在当前会话输入并发送一条测试消息。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} text 消息文本。
 * @returns {Promise<void>} 消息提交完成后的 Promise。
 * @throws {Error} 输入框或发送按钮不可用时抛出。
 */
async function sendMessage(electronApp, text) {
  await executeInContents(
    electronApp,
    pluginUrl,
    `(async () => {
    const textarea = document.querySelector('.composer textarea')
    const button = document.querySelector('.send-button')
    if (!textarea || !button) throw new Error('未找到消息输入控件')
    textarea.value = ${JSON.stringify(text)}
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (button.disabled) throw new Error('发送按钮未启用')
    button.click()
  })()`,
  );
}

/**
 * 截取插件聊天区域并统计非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number, width: number, height: number}>} 截图与像素统计。
 * @throws {Error} 插件视图或聊天区域不存在时抛出。
 */
async function captureChatArea(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");

    const rect = await contents.executeJavaScript(`(() => {
      const chat = document.querySelector('.chat-scroll')
      if (!chat) throw new Error('未找到聊天区域')
      const bounds = chat.getBoundingClientRect()
      return {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
      }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8 ||
        (red + green + blue) / 3 < 220
      ) {
        nonBackgroundPixels += 1;
      }
    }
    return {
      png: image.toPNG().toString("base64"),
      nonBackgroundPixels,
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 将思考面板滚入可视区域并截取局部画面。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number}>} 思考面板截图。
 * @throws {Error} 插件视图或思考面板不存在时抛出。
 */
async function captureReasoningPanel(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");

    const rect = await contents.executeJavaScript(`(async () => {
      const panel = document.querySelector('.reasoning-block')
      if (!panel) throw new Error('未找到思考面板')
      panel.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = panel.getBoundingClientRect()
      return {
        x: Math.max(0, Math.floor(bounds.x)),
        y: Math.max(0, Math.floor(bounds.y)),
        width: Math.min(Math.floor(bounds.width), window.innerWidth - Math.max(0, Math.floor(bounds.x))),
        height: Math.min(Math.floor(bounds.height), window.innerHeight - Math.max(0, Math.floor(bounds.y))),
      }
    })()`);
    const image = await contents.capturePage(rect);
    return {
      png: image.toPNG().toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 将上下文压缩标记滚入可视区域并截取展开内容。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number, width: number, height: number}>} 压缩标记截图与内容像素统计。
 * @throws {Error} 插件视图或压缩标记不存在时抛出。
 */
async function captureContextCompaction(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(async () => {
      const marker = document.querySelector('.context-compaction')
      if (!marker) throw new Error('未找到上下文压缩标记')
      const summary = marker.querySelector('summary')
      if (!summary) throw new Error('未找到上下文压缩标题行')
      summary.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = summary.getBoundingClientRect()
      const x = Math.max(0, Math.floor(bounds.x) - 4)
      const y = Math.max(0, Math.floor(bounds.y) - 4)
      return {
        x,
        y,
        width: Math.min(Math.ceil(bounds.width) + 8, window.innerWidth - x),
        height: Math.min(260, window.innerHeight - y),
      }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8 ||
        (red + green + blue) / 3 < 205
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

/**
 * 截取展开的 Shell 终端卡片并统计可见内容像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, darkPixels: number, width: number, height: number}>} 终端截图与像素统计。
 * @throws {Error} 插件视图或终端卡片不存在时抛出。
 */
async function captureShellTerminal(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");

    const rect = await contents.executeJavaScript(`(async () => {
      const terminal = document.querySelector('.shell-terminal')
      if (!terminal) throw new Error('未找到 Shell 终端卡片')
      terminal.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = terminal.getBoundingClientRect()
      return {
        x: Math.max(0, Math.floor(bounds.x)),
        y: Math.max(0, Math.floor(bounds.y)),
        width: Math.min(Math.floor(bounds.width), window.innerWidth - Math.max(0, Math.floor(bounds.x))),
        height: Math.min(Math.floor(bounds.height), window.innerHeight - Math.max(0, Math.floor(bounds.y))),
      }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let darkPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if ((red + green + blue) / 3 < 190) darkPixels += 1;
    }
    return {
      png: image.toPNG().toString("base64"),
      darkPixels,
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 将用户消息滚入可视区域并截取主题色气泡。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, coloredPixels: number, width: number, height: number}>} 用户气泡截图与彩色像素统计。
 * @throws {Error} 插件视图或用户气泡不存在时抛出。
 */
async function captureUserBubble(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");

    const rect = await contents.executeJavaScript(`(async () => {
      const bubble = document.querySelector('.message-user .message-body')
      if (!bubble) throw new Error('未找到用户消息气泡')
      bubble.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = bubble.getBoundingClientRect()
      return {
        x: Math.max(0, Math.floor(bounds.x) - 4),
        y: Math.max(0, Math.floor(bounds.y) - 4),
        width: Math.min(Math.ceil(bounds.width) + 8, window.innerWidth - Math.max(0, Math.floor(bounds.x) - 4)),
        height: Math.min(Math.ceil(bounds.height) + 8, window.innerHeight - Math.max(0, Math.floor(bounds.y) - 4)),
      }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let coloredPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 10)
        coloredPixels += 1;
    }
    return {
      png: image.toPNG().toString("base64"),
      coloredPixels,
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 截取展开的任务面板并统计可见内容像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, nonBackgroundPixels: number, width: number, height: number}>} 任务面板截图和像素统计。
 * @throws {Error} 插件视图或任务面板不存在时抛出。
 */
async function captureTaskPanel(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(async () => {
      const panel = document.querySelector('.task-strip')
      if (!panel) throw new Error('未找到任务面板')
      panel.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = panel.getBoundingClientRect()
      return { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
    })()`);
    const image = await contents.capturePage(rect);
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8 ||
        (red + green + blue) / 3 < 205
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

/**
 * 截取输入框区域，确认底部控件移除后的真实布局。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number}>} 输入框区域截图。
 * @throws {Error} 插件视图或输入框区域不存在时抛出。
 */
async function captureComposer(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(() => {
      const composer = document.querySelector('.composer-wrap')
      if (!composer) throw new Error('未找到输入框区域')
      const bounds = composer.getBoundingClientRect()
      return { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) }
    })()`);
    const image = await contents.capturePage(rect);
    return {
      png: image.toPNG().toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 截取侧栏的新会话按钮，供中性按钮样式做视觉验证。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number}>} 新会话按钮截图。
 * @throws {Error} 插件视图或新会话按钮不存在时抛出。
 */
async function captureNewConversationButton(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(() => {
      const button = document.querySelector('.new-conversation-button')
      if (!button) throw new Error('未找到新会话按钮')
      const bounds = button.getBoundingClientRect()
      return { x: Math.floor(bounds.x) - 4, y: Math.floor(bounds.y) - 4, width: Math.ceil(bounds.width) + 8, height: Math.ceil(bounds.height) + 8 }
    })()`);
    const image = await contents.capturePage(rect);
    return {
      png: image.toPNG().toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
    };
  }, pluginUrl);
}

/**
 * 通过 Electron 输入事件拖动侧栏边界并读取最终布局。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {number} deltaX 相对当前边界的水平拖动距离。
 * @returns {Promise<{initialWidth: number, width: number, handleWidth: number, handleCursor: string, edgeGap: number}>} 拖动前后侧栏与边界布局。
 * @throws {Error} 插件视图或侧栏拖拽区域不存在时抛出。
 */
async function dragSidebar(electronApp, deltaX) {
  return electronApp.evaluate(
    async ({ webContents }, payload) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(payload.fragment));
      if (!contents) throw new Error("未找到 ZVC WebContentsView");
      const bounds = await contents.executeJavaScript(`(() => {
      const sidebar = document.querySelector('.sidebar')
      const handle = document.querySelector('.sidebar-resize-handle')
      if (!sidebar || !handle) throw new Error('未找到侧栏拖拽区域')
      const sidebarBounds = sidebar.getBoundingClientRect()
      const handleBounds = handle.getBoundingClientRect()
      return {
        initialWidth: sidebarBounds.width,
        x: Math.round(handleBounds.left + handleBounds.width / 2),
        y: Math.round(handleBounds.top + Math.min(120, handleBounds.height / 2)),
      }
    })()`);
      const targetX = Math.round(bounds.x + payload.deltaX);

      // DevTools 输入显式保持 buttons=1，验证 Pointer Capture 和完整拖拽生命周期。
      const alreadyAttached = contents.debugger.isAttached();
      if (!alreadyAttached) contents.debugger.attach("1.3");
      try {
        await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: bounds.x,
          y: bounds.y,
          buttons: 0,
        });
        await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: bounds.x,
          y: bounds.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        for (let step = 1; step <= 3; step += 1) {
          await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: Math.round(bounds.x + (payload.deltaX * step) / 3),
            y: bounds.y,
            button: "left",
            buttons: 1,
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: targetX,
          y: bounds.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
      } finally {
        // 只释放本辅助函数创建的调试连接，保留宿主已有的调试会话。
        if (!alreadyAttached && contents.debugger.isAttached())
          contents.debugger.detach();
      }
      await new Promise((resolve) => setTimeout(resolve, 40));

      const finalLayout = await contents.executeJavaScript(`(() => {
      const sidebar = document.querySelector('.sidebar')
      const handle = document.querySelector('.sidebar-resize-handle')
      if (!sidebar || !handle) throw new Error('拖拽后侧栏区域不存在')
      const sidebarBounds = sidebar.getBoundingClientRect()
      const handleBounds = handle.getBoundingClientRect()
      return {
        width: sidebarBounds.width,
        handleWidth: handleBounds.width,
        handleCursor: getComputedStyle(handle).cursor,
        edgeGap: Math.abs(handleBounds.left + handleBounds.width / 2 - sidebarBounds.right),
      }
    })()`);
      return { initialWidth: bounds.initialWidth, ...finalLayout };
    },
    { fragment: pluginUrl, deltaX },
  );
}

test("流式显示并保留模型思考过程", async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "zvc-reasoning-e2e-"),
  );
  const legacyRoot = path.join(dataRoot, "legacy");
  let electronApp = null;

  await fs.mkdir(legacyRoot, { recursive: true });

  try {
    electronApp = await electron.launch(
      createZToolsLaunchOptions(dataRoot, legacyRoot),
    );

    const page = await electronApp.firstWindow();
    const searchInput = page.locator(".search-input");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("通用设置");
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
        name: "Reasoning Mock",
        apiUrl: "http://127.0.0.1:15241/v1",
        apiKey: "test-key",
        models: [
          { modelId: "deepseek-v4-flash", contextWindow: 262144 },
          { modelId: "deepseek-v4-flash-4k", contextWindow: 4096 },
          { modelId: "gpt-5.6-sol", contextWindow: 262144 },
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
    const installed = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.installDevPlugin('ztools-vibe-coding')`,
    );
    expect(installed).toMatchObject({ success: true });

    const pluginList = await executeInContents(
      electronApp,
      settingsUrlFragment,
      "window.ztools.internal.getAllPlugins()",
    );
    const developmentPlugin = pluginList.find(
      (plugin) =>
        plugin.name === "ztools-vibe-coding__dev" && plugin.isDevelopment,
    );
    const launchResult = await executeInContents(
      electronApp,
      settingsUrlFragment,
      `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`,
    );
    expect(launchResult).toMatchObject({ success: true });
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("全能 AI 助手");
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('[aria-label="ZVC 设置"]')?.click(); true`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `document.querySelector('[aria-label="SSE 事件合并间隔"]')?.value || ''`,
        ),
      )
      .toBe("50");
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const select = document.querySelector('[aria-label="SSE 事件合并间隔"]')
      select.value = '100'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `window.zvcBridge.getInitialState().streamBatchIntervalMs`,
        ),
      )
      .toBe(100);
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `document.querySelector('[aria-label="自动压缩上下文触发阈值"]')?.value || ''`,
        ),
      )
      .toBe("70");
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const select = document.querySelector('[aria-label="自动压缩上下文触发阈值"]')
      select.value = '80'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `window.zvcBridge.getInitialState().autoCompactionThresholdPercent`,
        ),
      )
      .toBe(80);
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `document.querySelector('[aria-label="工具最大并发数"]')?.value || ''`,
        ),
      )
      .toBe("10");
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const select = document.querySelector('[aria-label="工具最大并发数"]')
      select.value = '3'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `window.zvcBridge.getInitialState().toolConcurrencyLimit`,
        ),
      )
      .toBe(3);
    const settingsCapture = await captureSettingsDialog(electronApp);
    const settingsScreenshot = Buffer.from(settingsCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-settings-context-threshold.png"),
      settingsScreenshot,
    );
    await testInfo.attach("zvc-settings-context-threshold", {
      body: settingsScreenshot,
      contentType: "image/png",
    });
    expect(settingsCapture.width).toBeGreaterThan(300);
    expect(settingsCapture.height).toBeGreaterThan(140);
    expect(settingsCapture.nonBackgroundPixels).toBeGreaterThan(500);
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const select = document.querySelector('[aria-label="SSE 事件合并间隔"]')
      select.value = '50'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const thresholdSelect = document.querySelector('[aria-label="自动压缩上下文触发阈值"]')
      thresholdSelect.value = '70'
      thresholdSelect.dispatchEvent(new Event('change', { bubbles: true }))
      const concurrencySelect = document.querySelector('[aria-label="工具最大并发数"]')
      concurrencySelect.value = '10'
      concurrencySelect.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelector('[role="dialog"][aria-label="ZVC 设置"] [aria-label="关闭"]')?.click()
      return true
    })()`,
    );
    const reasoningModelKey = await readHostModelKey(
      executeInContents,
      electronApp,
      pluginUrl,
      "deepseek-v4-flash",
    );
    const compactModelKey = await readHostModelKey(
      executeInContents,
      electronApp,
      pluginUrl,
      "deepseek-v4-flash-4k",
    );
    const openAiModelKey = await readHostModelKey(
      executeInContents,
      electronApp,
      pluginUrl,
      "gpt-5.6-sol",
    );

    const taskConversationIds = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const initialState = window.zvcBridge.getInitialState()
      const conversationId = initialState.activeConversationId || initialState.conversations[0]?.id
      const taskResult = await window.zvcBridge.invokeTool('', 'task_write', { tasks: [
        { content: '分析当前需求', status: 'completed' },
        { content: '实现任务面板和运行状态', status: 'in_progress' },
        { content: '完成构建与界面验证', status: 'pending' }
      ] }, { conversationId })
      await window.zvcBridge.saveConversationState(conversationId, { title: 'E2E 主会话', tasks: taskResult.tasks })
      const secondary = window.zvcBridge.createConversation({
        title: 'E2E 独立任务会话',
        tasks: [{ content: '只属于第二个会话', status: 'in_progress' }]
      })
      window.zvcBridge.setActiveConversation(conversationId)
      location.reload()
      return { primary: conversationId, secondary: secondary.id }
    })()`,
    );
    expect(taskConversationIds.primary).not.toBe(taskConversationIds.secondary);
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("deepseek-v4-flash");

    const primaryTasks = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const header = document.querySelector('.task-strip-header')
      if (!header) throw new Error('主会话未显示任务清单')
      if (header.getAttribute('aria-expanded') !== 'true') header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const tasks = [...document.querySelectorAll('.task-line')].map((item) => item.textContent?.trim())
      header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return tasks
    })()`,
    );
    expect(primaryTasks).toContain("分析当前需求");
    expect(primaryTasks).not.toContain("只属于第二个会话");

    const secondaryTasks = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const target = [...document.querySelectorAll('.conversation-item')]
        .find((item) => item.textContent?.includes('E2E 独立任务会话'))
      if (!target) throw new Error('未找到第二个任务会话')
      target.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const header = document.querySelector('.task-strip-header')
      if (!header) throw new Error('第二个会话未显示任务清单')
      header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const tasks = [...document.querySelectorAll('.task-line')].map((item) => item.textContent?.trim())
      header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return tasks
    })()`,
    );
    expect(secondaryTasks).toEqual(["只属于第二个会话"]);

    const restoredPrimaryTasks = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const target = [...document.querySelectorAll('.conversation-item')]
        .find((item) => item.textContent?.includes('E2E 主会话'))
      if (!target) throw new Error('未找到主任务会话')
      target.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const header = document.querySelector('.task-strip-header')
      if (!header) throw new Error('主会话未恢复任务清单')
      header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const tasks = [...document.querySelectorAll('.task-line')].map((item) => item.textContent?.trim())
      header.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return tasks
    })()`,
    );
    expect(restoredPrimaryTasks).toContain("分析当前需求");
    expect(restoredPrimaryTasks).not.toContain("只属于第二个会话");

    // 会话切换会重新绑定输入区，等待关键控件完成同一轮渲染后再读取计算样式。
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `Boolean(
      document.querySelector('.model-reasoning-trigger')
      && document.querySelector('.composer-context-button')
      && document.querySelector('.context-meter-trigger')
      && document.querySelector('.task-strip')
    )`,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    const composerChrome = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => ({
      autoApproveToggle: Boolean(document.querySelector('.composer .auto-approve-toggle')),
      hint: Boolean(document.querySelector('.composer-hint')),
      topbarModelSelect: Boolean(document.querySelector('.topbar select')),
      composerModelSelect: (() => {
        const trigger = document.querySelector('.model-reasoning-trigger')
        const style = getComputedStyle(trigger)
        return {
          visible: Boolean(trigger),
          value: trigger?.dataset.modelValue,
          reasoningValue: trigger?.dataset.reasoningValue,
          width: style.width,
          height: style.height,
          borderWidth: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
        }
      })(),
      composerRadius: getComputedStyle(document.querySelector('.composer')).borderTopLeftRadius,
      contextButton: (() => {
        const button = document.querySelector('.composer-context-button')
        const style = getComputedStyle(button)
        return { visible: Boolean(button), width: style.width, height: style.height, label: button?.getAttribute('aria-label') }
      })(),
      contextMeter: (() => {
        const button = document.querySelector('.context-meter-trigger')
        const style = getComputedStyle(button)
        return {
          visible: Boolean(button),
          width: style.width,
          height: style.height,
          label: button?.getAttribute('aria-label'),
        }
      })(),
      taskRadius: getComputedStyle(document.querySelector('.task-strip')).borderTopLeftRadius,
      iconButtonRadius: getComputedStyle(document.querySelector('.icon-button')).borderTopLeftRadius,
      sendButtonRadius: getComputedStyle(document.querySelector('.send-button')).borderTopLeftRadius,
      conversationListGap: getComputedStyle(document.querySelector('.conversation-list')).rowGap,
      newConversationButton: (() => {
        const button = document.querySelector('.new-conversation-button')
        const primaryProbe = document.createElement('span')
        primaryProbe.style.backgroundColor = 'var(--primary)'
        document.body.append(primaryProbe)
        const style = getComputedStyle(button)
        const result = {
          height: style.height,
          borderWidth: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          background: style.backgroundColor,
          primary: getComputedStyle(primaryProbe).backgroundColor,
        }
        primaryProbe.remove()
        return result
      })(),
    }))()`,
    );
    expect(composerChrome).toMatchObject({
      autoApproveToggle: false,
      hint: false,
      topbarModelSelect: false,
      composerModelSelect: {
        visible: true,
        value: reasoningModelKey,
        reasoningValue: "",
        height: "28px",
        borderWidth: "0px",
        radius: "8px",
      },
      composerRadius: "22px",
      contextButton: {
        visible: true,
        width: "30px",
        height: "30px",
        label: "压缩上下文",
      },
      contextMeter: {
        visible: true,
        width: "28px",
        height: "28px",
        label: "上下文已用 0%",
      },
      taskRadius: "12px",
      iconButtonRadius: "8px",
      sendButtonRadius: "999px",
      conversationListGap: "2px",
      newConversationButton: {
        height: "38px",
        borderWidth: "1px",
        radius: "12px",
      },
    });
    expect(
      parseFloat(composerChrome.composerModelSelect.width),
    ).toBeGreaterThan(100);
    expect(composerChrome.newConversationButton.background).not.toBe(
      composerChrome.newConversationButton.primary,
    );
    const contextMeterPanel = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.context-meter-trigger')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return document.querySelector('.context-meter-panel')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    })()`,
    );
    expect(contextMeterPanel).toContain("/ 262,144");
    expect(contextMeterPanel).not.toContain("系统提示词");
    const newConversationCapture =
      await captureNewConversationButton(electronApp);
    const newConversationScreenshot = Buffer.from(
      newConversationCapture.png,
      "base64",
    );
    await fs.writeFile(
      testInfo.outputPath("zvc-new-conversation-button.png"),
      newConversationScreenshot,
    );
    await testInfo.attach("zvc-new-conversation-button", {
      body: newConversationScreenshot,
      contentType: "image/png",
    });
    expect(newConversationCapture.width).toBeGreaterThan(180);
    expect(newConversationCapture.height).toBeGreaterThanOrEqual(46);
    const widenedSidebar = await dragSidebar(electronApp, 130);
    expect(widenedSidebar).toMatchObject({
      initialWidth: 220,
      width: 350,
      handleWidth: 8,
      handleCursor: "col-resize",
    });
    expect(widenedSidebar.edgeGap).toBeLessThanOrEqual(1);
    const minimumSidebar = await dragSidebar(electronApp, -500);
    expect(minimumSidebar.width).toBe(220);
    expect(minimumSidebar.edgeGap).toBeLessThanOrEqual(1);
    const restoredSidebar = await dragSidebar(electronApp, 40);
    expect(restoredSidebar.width).toBe(260);
    const sidebarToggleIconState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const closeButton = document.querySelector('button[aria-label="收起侧栏"]')
      const closePath = closeButton?.querySelector('svg path')?.getAttribute('d') || ''
      closeButton?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const openButton = document.querySelector('button[aria-label="展开会话栏"]')
      const openPath = openButton?.querySelector('svg path')?.getAttribute('d') || ''
      const openViewBox = openButton?.querySelector('svg')?.getAttribute('viewBox') || ''
      const resizeHandleWhileCollapsed = Boolean(document.querySelector('.sidebar-resize-handle'))
      openButton?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        samePath: Boolean(closePath) && closePath === openPath,
        openViewBox,
        resizeHandleWhileCollapsed,
        resizeHandleAfterExpand: Boolean(document.querySelector('.sidebar-resize-handle')),
      }
    })()`,
    );
    expect(sidebarToggleIconState).toEqual({
      samePath: true,
      openViewBox: "0 0 16 16",
      resizeHandleWhileCollapsed: false,
      resizeHandleAfterExpand: true,
    });
    const composerGrowthState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      if (!textarea) throw new Error('未找到输入框')
      /**
       * 更新测试草稿并等待输入框完成尺寸同步。
       * @param {string} value 测试草稿内容。
       * @returns {Promise<number>} 更新后的输入框高度。
       */
      const updateDraft = async (value) => {
        textarea.value = value
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return textarea.getBoundingClientRect().height
      }
      const singleLineHeight = await updateDraft('单行输入')
      const multiLineHeight = await updateDraft(Array.from({ length: 10 }, (_, index) => '第' + (index + 1) + '行输入').join('\\n'))
      const style = getComputedStyle(textarea)
      const state = {
        singleLineHeight,
        multiLineHeight,
        maxHeight: style.maxHeight,
        resize: style.resize,
        overflowY: style.overflowY,
      }
      state.resetHeight = await updateDraft('')
      return state
    })()`,
    );
    expect(composerGrowthState.maxHeight).toBe("336px");
    expect(composerGrowthState.resize).toBe("none");
    expect(composerGrowthState.multiLineHeight).toBeGreaterThan(
      composerGrowthState.singleLineHeight,
    );
    expect(composerGrowthState.multiLineHeight).toBeLessThanOrEqual(336);
    expect(composerGrowthState.resetHeight).toBe(
      composerGrowthState.singleLineHeight,
    );
    const composerCapture = await captureComposer(electronApp);
    const composerScreenshot = Buffer.from(composerCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-composer-clean.png"),
      composerScreenshot,
    );
    await testInfo.attach("zvc-composer-clean", {
      body: composerScreenshot,
      contentType: "image/png",
    });
    expect(composerCapture.width).toBeGreaterThan(500);
    expect(composerCapture.height).toBeGreaterThan(90);

    const defaultTaskState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => ({
      title: document.querySelector('.task-strip-header strong')?.textContent,
      progress: document.querySelector('.task-strip-progress')?.textContent,
      expanded: document.querySelector('.task-strip-header')?.getAttribute('aria-expanded'),
      rows: document.querySelectorAll('.task-line').length,
    }))()`,
    );
    expect(defaultTaskState).toEqual({
      title: "任务",
      progress: "1 已完成 · 1 进行中 · 1 待处理",
      expanded: "false",
      rows: 0,
    });
    const expandedTaskState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.task-strip-header')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        expanded: document.querySelector('.task-strip-header')?.getAttribute('aria-expanded'),
        rows: document.querySelectorAll('.task-line').length,
        activeGlyph: Boolean(document.querySelector('.task-line.in_progress .task-status-glyph')),
      }
    })()`,
    );
    expect(expandedTaskState).toEqual({
      expanded: "true",
      rows: 3,
      activeGlyph: true,
    });
    const taskCapture = await captureTaskPanel(electronApp);
    const taskScreenshot = Buffer.from(taskCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-task-panel.png"),
      taskScreenshot,
    );
    await testInfo.attach("zvc-task-panel", {
      body: taskScreenshot,
      contentType: "image/png",
    });
    expect(taskCapture.width).toBeGreaterThan(400);
    expect(taskCapture.height).toBeGreaterThan(80);
    expect(taskCapture.nonBackgroundPixels).toBeGreaterThan(250);
    const collapsedTaskState = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      document.querySelector('.task-strip-header')?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        expanded: document.querySelector('.task-strip-header')?.getAttribute('aria-expanded'),
        rows: document.querySelectorAll('.task-line').length,
      }
    })()`,
    );
    expect(collapsedTaskState).toEqual({ expanded: "false", rows: 0 });

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '请回答测试问题'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sendButton = document.querySelector('.send-button')
      if (!sendButton || sendButton.disabled) throw new Error('发送按钮未启用')
      sendButton.click()
      return true
    })()`,
    );

    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("思考");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-running-status')?.textContent?.trim() || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("正在深入处理…");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-token-stats')?.textContent?.trim() || ''`,
          ),
        { timeout: 5_000 },
      )
      .toMatch(/^↑\S+ ↓\S+$/);
    const runningStatusLayout = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const scroller = document.querySelector('.chat-scroll')
      const content = document.querySelector('.chat-content')
      const status = document.querySelector('.conversation-running-status')
      const previousMessage = status?.previousElementSibling
      if (!scroller || !content || !status || !previousMessage) throw new Error('消息流运行状态不存在')
      const primaryProbe = document.createElement('span')
      primaryProbe.style.color = 'var(--primary)'
      document.body.append(primaryProbe)
      const primary = getComputedStyle(primaryProbe).color
      primaryProbe.remove()
      const statusBounds = status.getBoundingClientRect()
      const previousBounds = previousMessage.getBoundingClientRect()
      return {
        position: getComputedStyle(status).position,
        parent: status.parentElement?.className,
        overlayExists: Boolean(document.querySelector('.conversation-running-overlay')),
        color: getComputedStyle(status).color,
        primary,
        followsPreviousMessage: statusBounds.top >= previousBounds.bottom,
      }
    })()`,
    );
    expect(runningStatusLayout).toMatchObject({
      position: "static",
      parent: "chat-content",
      overlayExists: false,
      followsPreviousMessage: true,
    });
    expect(runningStatusLayout.color).toBe(runningStatusLayout.primary);
    const followedRunningStatus = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const scroller = document.querySelector('.chat-scroll')
      const content = document.querySelector('.chat-content')
      const status = document.querySelector('.conversation-running-status')
      if (!scroller || !content || !status) throw new Error('消息流运行状态不存在')
      const filler = document.createElement('div')
      filler.dataset.runningStatusTestFiller = ''
      filler.style.height = (scroller.clientHeight + 160) + 'px'
      content.insertBefore(filler, status)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const scrollerBounds = scroller.getBoundingClientRect()
      const statusBounds = status.getBoundingClientRect()
      const state = {
        hasOverflow: scroller.scrollHeight > scroller.clientHeight,
        distanceToBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
        statusVisibleAboveBottom: statusBounds.bottom <= scrollerBounds.bottom && statusBounds.bottom >= scrollerBounds.top,
      }

      // 自动跟随时增高消息流，运行提示应保持在同一视觉位置。
      const followedStatusTop = statusBounds.top
      filler.style.height = (scroller.clientHeight + 240) + 'px'
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      state.statusFollowDelta = Math.abs(status.getBoundingClientRect().top - followedStatusTop)

      // 模拟一次很轻的向上滚轮，后续内容增长不能再抢回滚动位置。
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 8)
      scroller.dispatchEvent(new Event('scroll'))
      state.readerTop = scroller.scrollTop
      filler.style.height = (scroller.clientHeight + 360) + 'px'
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      state.topAfterReaderPausedFollow = scroller.scrollTop

      // 测试结束前由用户回到底部，恢复后续流式响应的自动跟随。
      scroller.scrollTop = scroller.scrollHeight
      scroller.dispatchEvent(new Event('scroll'))
      state.resumedDistanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      filler.remove()
      return state
    })()`,
    );
    expect(followedRunningStatus.hasOverflow).toBe(true);
    expect(followedRunningStatus.distanceToBottom).toBeLessThanOrEqual(1);
    expect(followedRunningStatus.statusVisibleAboveBottom).toBe(true);
    expect(followedRunningStatus.statusFollowDelta).toBeLessThanOrEqual(1);
    expect(followedRunningStatus.topAfterReaderPausedFollow).toBe(
      followedRunningStatus.readerTop,
    );
    expect(followedRunningStatus.resumedDistanceToBottom).toBeLessThanOrEqual(
      1,
    );
    const runningCapture = await captureChatArea(electronApp);
    const runningScreenshot = Buffer.from(runningCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-running-status.png"),
      runningScreenshot,
    );
    await testInfo.attach("zvc-running-status", {
      body: runningScreenshot,
      contentType: "image/png",
    });
    expect(runningCapture.nonBackgroundPixels).toBeGreaterThan(250);
    const collapsedDuringStream = await executeInContents(
      electronApp,
      pluginUrl,
      `!document.querySelector('.reasoning-block')?.open`,
    );
    expect(collapsedDuringStream).toBe(true);
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.reasoning-block summary')?.click(); true`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("先理解用户的问题。");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("再组织最终答案。");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("printf zvc-tool-test");
    const toolRowState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const row = document.querySelector('.tool-summary')
      return {
        title: row?.querySelector('.tool-name')?.textContent,
        summary: row?.querySelector('.tool-description')?.textContent,
        bordered: getComputedStyle(document.querySelector('.tool-call')).borderTopWidth,
      }
    })()`,
    );
    expect(toolRowState).toMatchObject({
      title: "Bash",
      summary: "printf zvc-tool-test",
      bordered: "0px",
    });
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.tool-summary')?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.shell-terminal-output')?.textContent || ''`,
          ),
        { timeout: 5_000 },
      )
      .toBe("zvc-tool-test");
    const terminalState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => ({
      command: document.querySelector('.shell-terminal-command')?.textContent,
      output: document.querySelector('.shell-terminal-output')?.textContent,
      state: document.querySelector('.shell-terminal')?.dataset.state,
      copyLabel: document.querySelector('.shell-terminal-copy')?.textContent?.trim(),
      genericDetailsVisible: Boolean(document.querySelector('.tool-details')),
    }))()`,
    );
    expect(terminalState).toEqual({
      command: "printf zvc-tool-test",
      output: "zvc-tool-test",
      state: "done",
      copyLabel: "复制",
      genericDetailsVisible: false,
    });
    const terminalCapture = await captureShellTerminal(electronApp);
    const terminalScreenshot = Buffer.from(terminalCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-shell-terminal.png"),
      terminalScreenshot,
    );
    await testInfo.attach("zvc-shell-terminal", {
      body: terminalScreenshot,
      contentType: "image/png",
    });
    expect(terminalCapture.width).toBeGreaterThan(400);
    expect(terminalCapture.height).toBeGreaterThan(70);
    expect(terminalCapture.darkPixels).toBeGreaterThan(300);
    const reasoningLayout = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
        const element = document.querySelector('.reasoning-content')
        const style = getComputedStyle(element)
        return {
          overflowY: style.overflowY,
          maxHeight: style.maxHeight,
          heightGap: element.scrollHeight - element.clientHeight,
        }
      })()`,
    );
    expect(reasoningLayout).toEqual({
      overflowY: "visible",
      maxHeight: "none",
      heightGap: 0,
    });
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("命令执行完成，整理最终回答。");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("这是最终回答。");
    const reasoningEndedBeforeResponse = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const panels = [...document.querySelectorAll('.reasoning-block')]
      const currentPanel = panels.at(-1)
      return {
        panelCount: panels.length,
        reasoningRunning: currentPanel?.classList.contains('is-running') ?? null,
        responseRunning: Boolean(document.querySelector('.conversation-running-status')),
      }
    })()`,
    );
    expect(reasoningEndedBeforeResponse).toEqual({
      panelCount: 2,
      reasoningRunning: false,
      responseRunning: true,
    });
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `Boolean(document.querySelector('.conversation-running-status'))`,
          ),
        { timeout: 5_000 },
      )
      .toBe(false);
    const renderedState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const scroller = document.querySelector('.chat-scroll')
      const userMessage = document.querySelector('.message-user')
      const userBody = userMessage?.querySelector('.message-body')
      const userLastParagraph = userBody?.querySelector('p:last-child')
      const assistantMessage = [...document.querySelectorAll('.message-assistant')].at(-1)
      const assistantBody = assistantMessage?.querySelector('.message-body')
      const userBounds = userMessage?.getBoundingClientRect()
      const userBodyBounds = userBody?.getBoundingClientRect()
      const assistantBounds = assistantMessage?.getBoundingClientRect()
      const assistantBodyBounds = assistantBody?.getBoundingClientRect()
      const markdown = assistantMessage?.querySelector('.markdown-content')
      const inlineCode = markdown?.querySelector(':not(pre) > code')
      const nestedList = markdown?.querySelector('li > ul')
      const markdownHeading = markdown?.querySelector('h2')
      const codeBlock = markdown?.querySelector('.markdown-code-block')
      const codePre = codeBlock?.querySelector(':scope > pre')
      const markdownStyle = markdown ? getComputedStyle(markdown) : null
      const inlineCodeStyle = inlineCode ? getComputedStyle(inlineCode) : null
      const codeBlockStyle = codeBlock ? getComputedStyle(codeBlock) : null
      const codePreStyle = codePre ? getComputedStyle(codePre) : null
      const messageTimes = [...document.querySelectorAll('.message-time')].map((item) => item.textContent)
      const assistantTimeCounts = [...document.querySelectorAll('.message-assistant')].map((item) => item.querySelectorAll('.message-time').length)
      return {
        katex: Boolean(document.querySelector('.markdown-content .katex')),
        table: Boolean(document.querySelector('.markdown-content table')),
        heading: document.querySelector('.markdown-content h1')?.textContent,
        avatarCount: document.querySelectorAll('.message-avatar').length,
        userDisplay: userMessage ? getComputedStyle(userMessage).display : '',
        userRightInset: userBounds && userBodyBounds ? Math.round(userBounds.right - userBodyBounds.right) : -1,
        userBubbleBackground: userBody ? getComputedStyle(userBody).backgroundColor : '',
        userLastParagraphMarginBottom: userLastParagraph ? getComputedStyle(userLastParagraph).marginBottom : '',
        userBubbleWidthRatio: userBounds && userBodyBounds ? userBodyBounds.width / userBounds.width : 1,
        assistantBodyInset: assistantBounds && assistantBodyBounds ? Math.round(assistantBodyBounds.left - assistantBounds.left) : -1,
        markdownFontSize: markdownStyle?.fontSize,
        markdownLineHeight: markdownStyle?.lineHeight,
        inlineCodeColor: inlineCodeStyle?.color,
        assistantTextColor: assistantBody ? getComputedStyle(assistantBody).color : '',
        inlineCodeBackground: inlineCodeStyle?.backgroundColor,
        inlineCodeRadius: inlineCodeStyle?.borderRadius,
        codeBlockPadding: codeBlockStyle?.padding,
        codeBlockBorder: codeBlockStyle?.borderTopWidth,
        codeBlockRadius: codeBlockStyle?.borderTopLeftRadius,
        codePreRadius: codePreStyle?.borderTopLeftRadius,
        nestedListMarginTop: nestedList ? getComputedStyle(nestedList).marginTop : '',
        markdownHeadingSize: markdownHeading ? getComputedStyle(markdownHeading).fontSize : '',
        messageTimes,
        assistantTimeCounts,
      }
    })()`,
    );
    expect(renderedState).toMatchObject({
      katex: true,
      table: true,
      heading: "测试答案",
      avatarCount: 0,
      userDisplay: "flex",
      userRightInset: 0,
      userLastParagraphMarginBottom: "",
      assistantBodyInset: 0,
      markdownFontSize: "14px",
      markdownLineHeight: "22.68px",
      inlineCodeRadius: "5px",
      codeBlockPadding: "0px",
      codeBlockBorder: "1px",
      codeBlockRadius: "12px",
      codePreRadius: "0px",
      nestedListMarginTop: "3px",
      markdownHeadingSize: "16px",
      messageTimes: [
        expect.stringMatching(/^\d{2}:\d{2}$/),
        expect.stringMatching(/^\d{2}:\d{2}$/),
      ],
      assistantTimeCounts: [0, 1],
    });
    expect(renderedState.userBubbleBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(renderedState.userBubbleWidthRatio).toBeLessThanOrEqual(0.83);
    expect(renderedState.inlineCodeColor).toBe(
      renderedState.assistantTextColor,
    );
    expect(renderedState.inlineCodeBackground).not.toBe("rgba(0, 0, 0, 0)");

    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      document.querySelector('.message-assistant .markdown-code-block')?.scrollIntoView({ block: 'center', behavior: 'instant' })
      return true
    })()`,
    );
    const markdownStyleCapture = await captureChatArea(electronApp);
    const markdownStyleScreenshot = Buffer.from(
      markdownStyleCapture.png,
      "base64",
    );
    await fs.writeFile(
      testInfo.outputPath("zvc-markdown-style.png"),
      markdownStyleScreenshot,
    );
    await testInfo.attach("zvc-markdown-style", {
      body: markdownStyleScreenshot,
      contentType: "image/png",
    });
    expect(markdownStyleCapture.nonBackgroundPixels).toBeGreaterThan(1_000);

    const userBubbleCapture = await captureUserBubble(electronApp);
    const userBubbleScreenshot = Buffer.from(userBubbleCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-user-bubble.png"),
      userBubbleScreenshot,
    );
    await testInfo.attach("zvc-user-bubble", {
      body: userBubbleScreenshot,
      contentType: "image/png",
    });
    expect(userBubbleCapture.width).toBeGreaterThan(120);
    expect(userBubbleCapture.height).toBeGreaterThan(35);
    expect(userBubbleCapture.coloredPixels).toBeGreaterThan(300);

    // 局部截图改变了滚动位置，重新回到底部后再检查消息自动跟随结果。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const scroller = document.querySelector('.chat-scroll')
      scroller.scrollTop = scroller.scrollHeight
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `(() => { const scroller = document.querySelector('.chat-scroll'); return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight })()`,
        ),
      )
      .toBeLessThan(30);

    const capture = await captureChatArea(electronApp);
    const screenshot = Buffer.from(capture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-reasoning-markdown.png"),
      screenshot,
    );
    await testInfo.attach("zvc-reasoning-markdown", {
      body: screenshot,
      contentType: "image/png",
    });
    expect(capture.width).toBeGreaterThan(500);
    expect(capture.height).toBeGreaterThan(300);
    expect(capture.nonBackgroundPixels).toBeGreaterThan(2_000);

    const reasoningCapture = await captureReasoningPanel(electronApp);
    const reasoningScreenshot = Buffer.from(reasoningCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-reasoning-panel.png"),
      reasoningScreenshot,
    );
    await testInfo.attach("zvc-reasoning-panel", {
      body: reasoningScreenshot,
      contentType: "image/png",
    });
    expect(reasoningCapture.width).toBeGreaterThan(400);
    // 紧凑时间线布局不再包含旧式卡片边框，高度以两行正文的最小绘制区域校验。
    expect(reasoningCapture.height).toBeGreaterThan(100);

    const streamMetrics = await executeInContents(
      electronApp,
      pluginUrl,
      "window.__zvcLastStreamMetrics",
    );
    // 模拟服务会发送 40 个以上原始 delta，宿主默认 50ms 合并后插件只接收少量批次。
    expect(streamMetrics.receivedChunks).toBeGreaterThan(5);
    expect(streamMetrics.receivedChunks).toBeLessThan(20);
    expect(streamMetrics.flushes).toBeLessThan(streamMetrics.receivedChunks);
    expect(streamMetrics.contentLength).toBeGreaterThan(500);
    expect(streamMetrics.reasoningLength).toBeGreaterThan(200);

    const lastRequest = await fetch("http://127.0.0.1:15241/last-request").then(
      (response) => response.json(),
    );
    expect(lastRequest.model).toBe("deepseek-v4-flash");
    expect(lastRequest.thinking).toEqual({ type: "enabled" });

    const openAiReasoningResult = await executeInContents(
      electronApp,
      pluginUrl,
      `window.zvcBridge.chat({
      model: ${JSON.stringify(openAiModelKey)},
      messages: [{ role: 'user', content: '测试 OpenAI 推理映射' }],
      tools: [],
      reasoningEffort: 'high'
    }, () => {})`,
    );
    expect(openAiReasoningResult).toMatchObject({
      content: "OpenAI 推理映射完成。",
      reasoning_content: "已使用 OpenAI 推理强度。",
    });
    const openAiReasoningRequest = await fetch(
      "http://127.0.0.1:15241/last-request",
    ).then((response) => response.json());
    expect(openAiReasoningRequest.model).toBe("gpt-5.6-sol");
    expect(openAiReasoningRequest.reasoning_effort).toBe("high");
    expect(openAiReasoningRequest.thinking).toBeUndefined();

    await sendMessage(electronApp, "测试模型自动重试");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-running-status')?.textContent?.trim() || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("重试（1/2）");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("模型自动重试已恢复。");
    const recoveredRequests = await fetch(
      "http://127.0.0.1:15241/requests",
    ).then((response) => response.json());
    const recoveredAttempts = recoveredRequests.filter(
      (item) =>
        [...item.messages].reverse().find((message) => message.role === "user")
          ?.content === "测试模型自动重试",
    );
    expect(recoveredAttempts).toHaveLength(3);
    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `({
      running: Boolean(document.querySelector('.conversation-running-status')),
      error: document.querySelector('.inline-error')?.textContent || '',
    })`,
      ),
    ).toEqual({ running: false, error: "" });

    await sendMessage(electronApp, "测试停止模型重试");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-running-status')?.textContent?.trim() || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("重试（1/2）");
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.send-button.stop')?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `Boolean(document.querySelector('.conversation-running-status'))`,
          ),
        { timeout: 2_000 },
      )
      .toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stoppedRetryRequests = await fetch(
      "http://127.0.0.1:15241/requests",
    ).then((response) => response.json());
    const stoppedRetryAttempts = stoppedRetryRequests.filter(
      (item) =>
        [...item.messages].reverse().find((message) => message.role === "user")
          ?.content === "测试停止模型重试",
    );
    expect(stoppedRetryAttempts).toHaveLength(1);

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '测试停止未完成工具'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sendButton = document.querySelector('.send-button')
      if (!sendButton || sendButton.disabled) throw new Error('停止测试消息未能发送')
      sendButton.click()
      return true
    })()`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const call = [...document.querySelectorAll('.tool-call')].at(-1)
      return call?.classList.contains('is-streaming') && call.querySelector('.tool-name')?.textContent === '写入'
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.send-button.stop')?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const call = [...document.querySelectorAll('.tool-call')].at(-1)
      return {
        cancelled: Boolean(call?.classList.contains('is-cancelled')),
        summary: call?.querySelector('.tool-description')?.textContent,
        status: call?.querySelector('.tool-status')?.textContent,
        runningStatus: Boolean(document.querySelector('.conversation-running-status')),
      }
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toEqual({
        cancelled: true,
        summary: "已取消",
        status: "已取消",
        runningStatus: false,
      });
    const cancelledToolCapture = await captureChatArea(electronApp);
    const cancelledToolScreenshot = Buffer.from(
      cancelledToolCapture.png,
      "base64",
    );
    await fs.writeFile(
      testInfo.outputPath("zvc-cancelled-tool.png"),
      cancelledToolScreenshot,
    );
    await testInfo.attach("zvc-cancelled-tool", {
      body: cancelledToolScreenshot,
      contentType: "image/png",
    });
    expect(cancelledToolCapture.nonBackgroundPixels).toBeGreaterThan(250);

    // 模拟进程退出时留下的流式状态，重载后应自动收口并写回已取消状态。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const initial = window.zvcBridge.getInitialState()
      const conversation = window.zvcBridge.getConversationById(initial.activeConversationId)
      const message = [...conversation.messages].reverse().find((item) => Array.isArray(item.tool_calls) && item.tool_calls.length)
      const call = message.tool_calls.at(-1)
      call.status = 'streaming'
      call.result = ''
      await window.zvcBridge.commitConversationChanges(conversation.id, {
        upserts: [message],
      })
      location.reload()
      return true
    })()`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const call = [...document.querySelectorAll('.tool-call')].at(-1)
      return {
        cancelled: Boolean(call?.classList.contains('is-cancelled')),
        status: call?.querySelector('.tool-status')?.textContent,
      }
    })()`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ cancelled: true, status: "已取消" });

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '测试超过二十轮工具调用'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sendButton = document.querySelector('.send-button')
      if (!sendButton || sendButton.disabled) throw new Error('长工具循环测试消息未能发送')
      sendButton.click()
      return true
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 20_000 })
      .toContain("已完成超过二十轮工具调用。");
    const longLoopState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => ({
      timeCalls: [...document.querySelectorAll('.tool-call .tool-name')].filter((item) => item.textContent === '时间').length,
      error: document.querySelector('.inline-error')?.textContent?.trim() || '',
      running: Boolean(document.querySelector('.conversation-running-status')),
    }))()`,
    );
    expect(longLoopState).toEqual({ timeCalls: 21, error: "", running: false });

    const beforeManualCompaction = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const initial = window.zvcBridge.getInitialState()
      const conversation = window.zvcBridge.getConversationById(initial.activeConversationId)
      const button = document.querySelector('.composer-context-button')
      if (!button || button.disabled) throw new Error('上下文压缩按钮不可用')
      button.click()
      return { id: conversation.id, messageCount: conversation.messages.length }
    })()`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const initial = window.zvcBridge.getInitialState()
      const conversation = window.zvcBridge.getConversationById(initial.activeConversationId)
      return {
        summary: conversation.contextState?.summary || '',
        boundary: conversation.contextState?.compactedThroughMessageId || '',
        messageCount: conversation.messages.length,
        compacting: document.querySelector('.conversation-running-status')?.textContent?.includes('整理上下文') || false,
      }
    })()`,
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({
        summary: expect.stringContaining("用户目标与意图"),
        boundary: expect.any(String),
        messageCount: beforeManualCompaction.messageCount + 1,
        compacting: false,
      });
    const manualCompactionState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const conversation = window.zvcBridge.getConversationById(${JSON.stringify(beforeManualCompaction.id)})
      return {
        boundary: conversation.contextState.compactedThroughMessageId,
        messageCount: conversation.messages.length,
        buttonLabel: document.querySelector('.composer-context-button')?.getAttribute('aria-label'),
      }
    })()`,
    );
    expect(manualCompactionState.messageCount).toBe(
      beforeManualCompaction.messageCount + 1,
    );
    expect(manualCompactionState.boundary).not.toBe("");
    expect(manualCompactionState.buttonLabel).toBe("压缩上下文");
    const manualCompactionMarker = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const row = document.querySelector('.context-compaction')
      const summary = row?.querySelector('summary')
      if (!row || !summary) throw new Error('未显示上下文压缩标记')
      const before = row.open
      summary.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        text: summary.textContent.trim(),
        before,
        after: row.open,
        body: row.querySelector('.context-compaction-body')?.textContent?.trim() || '',
      }
    })()`,
    );
    expect(manualCompactionMarker).toMatchObject({
      text: expect.stringContaining("上下文已压缩"),
      before: false,
      after: true,
      body: expect.stringContaining("用户目标与意图"),
    });
    const compactionCapture = await captureContextCompaction(electronApp);
    expect(compactionCapture.width).toBeGreaterThan(300);
    expect(compactionCapture.height).toBeGreaterThan(50);
    expect(compactionCapture.nonBackgroundPixels).toBeGreaterThan(100);
    await fs.writeFile(
      testInfo.outputPath("zvc-context-compaction.png"),
      Buffer.from(compactionCapture.png, "base64"),
    );
    const manualCompactionRequest = await fetch(
      "http://127.0.0.1:15241/last-request",
    ).then((response) => response.json());
    if (manualCompactionRequest.tools?.length)
      expect(manualCompactionRequest.tool_choice).toBe("none");
    else expect(manualCompactionRequest.tool_choice).toBeUndefined();
    expect(manualCompactionRequest.thinking).toEqual({ type: "enabled" });
    expect(manualCompactionRequest.max_tokens).toBe(8192);
    expect(manualCompactionRequest.messages.at(-1).content).toContain(
      "上下文压缩引擎",
    );
    expect(
      manualCompactionRequest.messages.some((message) =>
        message.content?.includes("上下文已压缩"),
      ),
    ).toBe(false);

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '测试上下文超限恢复'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sendButton = document.querySelector('.send-button')
      if (!sendButton || sendButton.disabled) throw new Error('上下文超限测试消息未能发送')
      sendButton.click()
      return true
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 10_000 })
      .toContain("上下文压缩后已恢复。");
    const compactionRequests = await fetch(
      "http://127.0.0.1:15241/requests",
    ).then((response) => response.json());
    const overflowRequests = compactionRequests.filter((item) =>
      item.messages.some(
        (message) =>
          message.role === "user" && message.content === "测试上下文超限恢复",
      ),
    );
    const summaryRequests = compactionRequests.filter((item) =>
      item.messages.at(-1)?.content?.includes("上下文压缩引擎"),
    );
    expect(overflowRequests).toHaveLength(2);
    expect(summaryRequests.length).toBeGreaterThanOrEqual(2);
    expect(
      overflowRequests
        .at(-1)
        .messages.some((message) =>
          message.content?.includes("<compacted-summary>"),
        ),
    ).toBe(true);
    const recoveredState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const initial = window.zvcBridge.getInitialState()
      const conversation = window.zvcBridge.getConversationById(initial.activeConversationId)
      return {
        boundary: conversation.contextState.compactedThroughMessageId,
        answerCount: [...document.querySelectorAll('.message-assistant')].filter((item) => item.textContent.includes('上下文压缩后已恢复。')).length,
        error: document.querySelector('.inline-error')?.textContent?.trim() || '',
      }
    })()`,
    );
    expect(recoveredState.boundary).not.toBe(manualCompactionState.boundary);
    expect(recoveredState.answerCount).toBe(1);
    expect(recoveredState.error).toBe("");
    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `document.querySelectorAll('.context-compaction').length`,
      ),
    ).toBe(2);

    // 构造超过 4K 窗口 70% 阈值的单 Turn 多工具步骤，覆盖超长 Turn 内的压力压缩入口。
    const automaticCompactionSetup = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const initial = window.zvcBridge.getInitialState()
      const conversation = window.zvcBridge.getConversationById(initial.activeConversationId)
      const now = Date.now()
      const longToolResult = '需要保留的自动压缩旧工具结果。'.repeat(450)
      const turnId = crypto.randomUUID()
      const additions = [{ id: crypto.randomUUID(), turnId, role: 'user', content: '自动压缩单轮工具任务', timestamp: now }]
      for (let index = 1; index <= 4; index += 1) {
        const callId = \`auto-compact-call-\${index}\`
        additions.push({
          id: crypto.randomUUID(),
          turnId,
          role: 'assistant',
          content: '',
          status: 'completed',
          completedAt: now + index * 2 - 1,
          tool_calls: [{ id: callId, name: 'read', arguments: JSON.stringify({ path: \`fixture-\${index}.txt\` }), status: 'completed' }],
        })
        additions.push({
          id: crypto.randomUUID(),
          turnId,
          role: 'tool',
          tool_call_id: callId,
          name: 'read',
          content: longToolResult,
          timestamp: now + index * 2,
        })
      }
      additions.push({ id: crypto.randomUUID(), turnId, role: 'assistant', content: '单轮工具步骤已完成。', completedAt: now + 9 })
      await window.zvcBridge.commitConversationChanges(conversation.id, {
        state: { modelKey: ${JSON.stringify(compactModelKey)} },
        upserts: additions,
      })
      location.reload()
      return { markerCount: conversation.messages.filter((message) => message.kind === 'context-compaction').length }
    })()`,
    );
    expect(automaticCompactionSetup.markerCount).toBe(2);
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("deepseek-v4-flash-4k");

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      textarea.value = '测试自动压缩提示'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const sendButton = document.querySelector('.send-button')
      if (!sendButton || sendButton.disabled) throw new Error('自动压缩测试消息未能发送')
      sendButton.click()
      return true
    })()`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-running-status')?.textContent?.trim() || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("正在压缩上下文");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 10_000 })
      .toContain("自动压缩提示验证完成。");

    const automaticCompactionMarker = await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const rows = [...document.querySelectorAll('.context-compaction')]
      const row = rows.at(-1)
      const summary = row?.querySelector('summary')
      const scroller = document.querySelector('.chat-scroll')
      if (!row || !summary || !scroller) throw new Error('自动压缩完成后未显示压缩标记')
      const rowBounds = row.getBoundingClientRect()
      const scrollerBounds = scroller.getBoundingClientRect()
      const visible = rowBounds.bottom > scrollerBounds.top && rowBounds.top < scrollerBounds.bottom
      summary.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        count: rows.length,
        visible,
        text: summary.textContent.trim(),
        open: row.open,
        body: row.querySelector('.context-compaction-body')?.textContent?.trim() || '',
      }
    })()`,
    );
    expect(automaticCompactionMarker).toMatchObject({
      count: 3,
      visible: true,
      text: expect.stringContaining("上下文已压缩"),
      open: true,
      body: expect.stringContaining("用户目标与意图"),
    });
    const requestsAfterAutomaticCompaction = await fetch(
      "http://127.0.0.1:15241/requests",
    ).then((response) => response.json());
    const automaticSummaryRequest = requestsAfterAutomaticCompaction
      .filter((item) =>
        item.messages.at(-1)?.content?.includes("上下文压缩引擎"),
      )
      .at(-1);
    const summarizedToolCalls = automaticSummaryRequest.messages
      .flatMap((message) =>
        message.role === "assistant" ? message.tool_calls || [] : [],
      )
      .map((call) => call.id);
    const summarizedToolResults = automaticSummaryRequest.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.tool_call_id);
    expect(summarizedToolCalls.length).toBeGreaterThan(0);
    expect(summarizedToolResults).toEqual(summarizedToolCalls);

    // 重载后必须从会话 JSONL 恢复标记与摘要，避免只存在于当前响应式内存。
    await executeInContents(electronApp, pluginUrl, "location.reload(); true");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelectorAll('.context-compaction').length`,
          ),
        { timeout: 15_000 },
      )
      .toBe(3);
    const persistedAutomaticCompaction = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const rows = [...document.querySelectorAll('.context-compaction')]
      const row = rows.at(-1)
      return {
        text: row?.querySelector('summary')?.textContent?.trim() || '',
        hasSummary: Boolean(row?.querySelector('summary')),
      }
    })()`,
    );
    expect(persistedAutomaticCompaction).toMatchObject({
      text: expect.stringContaining("上下文已压缩"),
      hasSummary: true,
    });
  } finally {
    await electronApp?.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
