import { expect, test, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addHostAiProvider } from "./host-ai-fixture.js";
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
 * 截取插件视图用于核对并发会话状态提示。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<Buffer>} 插件视图 PNG 数据。
 * @throws {Error} 插件 WebContentsView 不存在时抛出。
 */
async function capturePlugin(electronApp) {
  const base64 = await electronApp.evaluate(
    async ({ webContents }, fragment) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().includes(fragment));
      if (!contents) throw new Error("未找到 ZVC WebContentsView");
      return (await contents.capturePage()).toPNG().toString("base64");
    },
    pluginUrl,
  );
  return Buffer.from(base64, "base64");
}

/**
 * 在当前会话输入并发送一条消息。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} text 消息文本。
 * @returns {Promise<void>} 消息成功提交后的 Promise。
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

test("切换会话时后台响应继续运行且按会话隔离", async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "zvc-multi-session-e2e-"),
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
        name: "Multi Session Mock",
        apiUrl: "http://127.0.0.1:15241/v1",
        apiKey: "test-key",
        models: [{ modelId: "deepseek-v4-flash" }],
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
    const pluginList = await executeInContents(
      electronApp,
      settingsUrlFragment,
      "window.ztools.internal.getAllPlugins()",
    );
    const developmentPlugin = pluginList.find(
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
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("全能 AI 助手");

    const conversationA = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const initial = window.zvcBridge.getInitialState()
      return initial.activeConversationId || initial.conversations[0]?.id
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("deepseek-v4-flash");

    await sendMessage(electronApp, "测试多会话 A");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("会话 A 已开始。");

    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.new-conversation-button')?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-item.active strong')?.textContent || ''`,
          ),
        { timeout: 5_000 },
      )
      .toBe("新的对话");
    const conversationB = await executeInContents(
      electronApp,
      pluginUrl,
      `window.zvcBridge.getInitialState().activeConversationId`,
    );
    expect(conversationB).not.toBe(conversationA);

    await sendMessage(electronApp, "测试多会话 B");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelectorAll('.conversation-runtime-status.is-running').length`,
          ),
        { timeout: 5_000 },
      )
      .toBe(2);
    const runningIndicatorLayout = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const item = [...document.querySelectorAll('.conversation-item')]
        .find((element) => element.textContent.includes('测试多会话 B'))
      const status = item?.querySelector('.conversation-runtime-status.is-running')
      const title = item?.querySelector('.project-item-copy')
      const time = item?.querySelector('.conversation-time')
      if (!item || !status || !title || !time) throw new Error('未找到运行中会话的完整列表布局')
      return {
        statusBeforeTitle: status.compareDocumentPosition(title) === Node.DOCUMENT_POSITION_FOLLOWING,
        statusLeft: status.getBoundingClientRect().left,
        titleLeft: title.getBoundingClientRect().left,
        timeLeft: time.getBoundingClientRect().left,
      }
    })()`,
    );
    expect(runningIndicatorLayout.statusBeforeTitle).toBe(true);
    expect(runningIndicatorLayout.statusLeft).toBeLessThan(
      runningIndicatorLayout.titleLeft,
    );
    expect(runningIndicatorLayout.titleLeft).toBeLessThan(
      runningIndicatorLayout.timeLeft,
    );
    const screenshot = await capturePlugin(electronApp);
    await fs.writeFile(
      testInfo.outputPath("zvc-multi-conversation-running.png"),
      screenshot,
    );
    await testInfo.attach("zvc-multi-conversation-running", {
      body: screenshot,
      contentType: "image/png",
    });

    // 在两个请求都运行时切回 A，确保较短的 B 响应会在后台完成。
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('测试多会话 A')))?.click(); true`,
    );
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
      .toBe(true);
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `Boolean([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('测试多会话 B'))?.querySelector('.conversation-runtime-status.is-completed'))`,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("会话 A 已完成。");

    // 用稳定的长内容模拟真实历史会话，切换后必须恢复该会话自己的尾部位置。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const style = document.createElement('style')
      style.id = 'e2e-long-conversation'
      style.textContent = '.chat-content { min-height: 3000px !important; }'
      document.head.appendChild(style)
      return true
    })()`,
    );
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('测试多会话 B')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const scroller = document.querySelector('.chat-scroll')
      return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);
    const isolatedState = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => ({
      completedReminder: Boolean(document.querySelector('.conversation-item.active .conversation-runtime-status.is-completed')),
      chatText: [...document.querySelectorAll('.message')].map((item) => item.textContent).join('\\n'),
      a: window.zvcBridge.getConversationById(${JSON.stringify(conversationA)}).messages.map((message) => message.content || '').join('\\n'),
      b: window.zvcBridge.getConversationById(${JSON.stringify(conversationB)}).messages.map((message) => message.content || '').join('\\n'),
    }))()`,
    );
    expect(isolatedState.completedReminder).toBe(false);
    expect(isolatedState.chatText).toContain("会话 B 已完成。");
    expect(isolatedState.chatText).not.toContain("会话 A 已完成。");
    expect(isolatedState.a).toContain("会话 A 已完成。");
    expect(isolatedState.a).not.toContain("会话 B 已完成。");
    expect(isolatedState.b).toContain("会话 B 已完成。");
    expect(isolatedState.b).not.toContain("会话 A 已完成。");

    // 用户离开底部后按稳定消息行保存阅读位置，跨会话往返不得被重新抢到底部。
    const readerAnchor = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const scroller = document.querySelector('.chat-scroll')
      if (!scroller) throw new Error('未找到聊天滚动容器')
      scroller.scrollTop = 80
      scroller.dispatchEvent(new Event('scroll'))
      const viewport = scroller.getBoundingClientRect()
      const row = [...document.querySelectorAll('[data-chat-anchor-key]')]
        .find((element) => {
          const rect = element.getBoundingClientRect()
          return rect.bottom > viewport.top && rect.top < viewport.bottom
        })
      if (!row) throw new Error('未找到可见消息锚点')
      return {
        key: row.dataset.chatAnchorKey,
        top: row.getBoundingClientRect().top - viewport.top,
      }
    })()`,
    );
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('测试多会话 A')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-item.active')?.textContent || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("测试多会话 A");
    await executeInContents(
      electronApp,
      pluginUrl,
      `([...document.querySelectorAll('.conversation-item')].find((item) => item.textContent.includes('测试多会话 B')))?.click(); true`,
    );
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.conversation-item.active')?.textContent || ''`,
          ),
        { timeout: 5_000 },
      )
      .toContain("测试多会话 B");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const scroller = document.querySelector('.chat-scroll')
      const row = [...document.querySelectorAll('[data-chat-anchor-key]')]
        .find((element) => element.dataset.chatAnchorKey === ${JSON.stringify(readerAnchor.key)})
      if (!scroller || !row) return 999
      return Math.abs((row.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - ${readerAnchor.top})
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);

    // 冷启动直接进入长历史会话，覆盖模板 ref 建立和强制贴底落在同一更新周期的场景。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const now = Date.now()
      const messages = Array.from({ length: 50 }, (_, index) => ({
        id: 'cold-' + index,
        role: index % 2 ? 'assistant' : 'user',
        content: ('冷会话第 ' + (index + 1) + ' 条消息。').repeat(20),
        timestamp: now + index,
      }))
      window.zvcBridge.createConversation({ title: '冷会话滚动测试', messages })
      location.reload()
      return true
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 10_000 })
      .toContain("冷会话第 50 条消息");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const scroller = document.querySelector('.chat-scroll')
      return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);

    // 无实际位移的残余滚轮事件不能释放贴底所有权，随后异步增高仍必须持续跟随。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      document.querySelector('.chat-scroll')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }))
      const block = document.createElement('div')
      block.id = 'e2e-async-layout-growth'
      block.style.height = '700px'
      document.querySelector('.chat-content')?.appendChild(block)
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
      const scroller = document.querySelector('.chat-scroll')
      return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);

    // 输入区高度变化属于同一个滚动契约，不能把已经贴底的消息顶离视口。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const textarea = document.querySelector('.composer textarea')
      if (!textarea) throw new Error('未找到消息输入框')
      textarea.value = Array.from({ length: 14 }, (_, index) => '输入框高度变化 ' + index).join('\\n')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
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
      const scroller = document.querySelector('.chat-scroll')
      return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);

    // 开发 URL 使用持久化 partition；重载同一地址时不能被 Chromium 的旧滚动位置覆盖。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const scroller = document.querySelector('.chat-scroll')
      if (!scroller) throw new Error('未找到聊天滚动容器')
      scroller.scrollTop = Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2)
      scroller.dispatchEvent(new Event('scroll'))
      location.reload()
      return true
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 10_000 })
      .toContain("冷会话第 50 条消息");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `(() => {
      const scroller = document.querySelector('.chat-scroll')
      return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1
    })()`,
          ),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);
  } finally {
    if (electronApp) await electronApp.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
