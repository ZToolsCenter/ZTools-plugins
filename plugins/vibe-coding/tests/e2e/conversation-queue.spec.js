import { expect, test, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addHostAiProvider } from "./host-ai-fixture.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pluginConfigPath = path.join(projectRoot, "public", "plugin.json");
const pluginDevelopmentPath = path.dirname(pluginConfigPath);
const pluginUrl = "http://127.0.0.1:15240";
const settingsUrlFragment = process.env.ZTOOLS_E2E_APP_ROOT
  ? "http://127.0.0.1:15177"
  : "internal-plugins/setting/index.html";

/**
 * 在指定 WebContentsView 中执行脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 脚本执行结果。
 * @throws {Error} 目标视图不存在或脚本执行失败时抛出。
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
 * 读取指定 WebContentsView 的正文。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标 URL 片段。
 * @returns {Promise<string>} 页面正文；视图未就绪时返回空字符串。
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
 * 截取 ZVC 插件 WebContentsView 的当前可见区域。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<Buffer>} 插件视图 PNG 数据。
 * @throws {Error} ZVC WebContentsView 不存在时抛出。
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
 * 在当前会话填写草稿并点击发送按钮。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} text 草稿文本。
 * @param {'排队发送'|'插话发送'|''} busyMode 运行中发送前需要选择的模式。
 * @returns {Promise<void>} 点击提交后的 Promise。
 * @throws {Error} 输入控件或发送按钮不可用时抛出。
 */
async function sendMessage(electronApp, text, busyMode = "") {
  await executeInContents(
    electronApp,
    pluginUrl,
    `(async () => {
    const textarea = document.querySelector('.composer textarea')
    if (!textarea) throw new Error('未找到消息输入控件')
    textarea.value = ${JSON.stringify(text)}
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })()`,
  );
  if (busyMode) await selectBusyMode(electronApp, busyMode);
  await executeInContents(
    electronApp,
    pluginUrl,
    `(() => {
    const button = document.querySelector('.send-button:not(.stop)')
    if (!button) throw new Error('未找到发送按钮')
    if (button.disabled) throw new Error('发送按钮未启用')
    button.click()
  })()`,
  );
}

/**
 * 新建并切换到一个空会话。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<void>} 新会话完成切换后的 Promise。
 */
async function createConversation(electronApp) {
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
}

/**
 * 通过输入框菜单选择运行中的发送模式。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {'排队发送'|'插话发送'} label 目标菜单文案。
 * @returns {Promise<void>} 模式选择完成后的 Promise。
 */
async function selectBusyMode(electronApp, label) {
  const selected = await executeInContents(
    electronApp,
    pluginUrl,
    `(async () => {
    document.querySelector('.send-mode-toggle')?.click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const option = [...document.querySelectorAll('.submission-mode-menu button')].find((button) => button.textContent.includes(${JSON.stringify(label)}))
    option?.click()
    return Boolean(option)
  })()`,
  );
  if (!selected) throw new Error(`未找到发送模式：${label}`);
}

/**
 * 解析 ZTools 生产应用或源码开发环境使用的 Electron 可执行文件。
 * @param {string} sourceAppRoot ZTools 源码根目录；为空表示使用生产应用。
 * @returns {string} Electron 可执行文件绝对路径。
 */
function resolveHostExecutable(sourceAppRoot) {
  if (process.env.ZTOOLS_E2E_EXECUTABLE_PATH)
    return process.env.ZTOOLS_E2E_EXECUTABLE_PATH;
  if (sourceAppRoot)
    return path.join(
      sourceAppRoot,
      "node_modules",
      "electron",
      "dist",
      "Electron.app",
      "Contents",
      "MacOS",
      "Electron",
    );
  return "/Applications/ZTools.app/Contents/MacOS/ZTools";
}

test("运行中的 Session 支持排队、安全插话和停止后继续队列", async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zvc-queue-e2e-"));
  const legacyRoot = path.join(dataRoot, "legacy");
  let electronApp = null;
  await fs.mkdir(legacyRoot, { recursive: true });

  try {
    const sourceAppRoot = process.env.ZTOOLS_E2E_APP_ROOT || "";
    electronApp = await electron.launch({
      executablePath: resolveHostExecutable(sourceAppRoot),
      args: sourceAppRoot ? [sourceAppRoot] : [],
      cwd: sourceAppRoot || undefined,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value),
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: "1",
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ...(sourceAppRoot
          ? { ZTOOLS_SETTING_DEV_SERVER_URL: "http://127.0.0.1:15177" }
          : {}),
      },
    });

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
        name: "Queue Mock",
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
      .toContain("deepseek-v4-flash");

    // 默认运行中发送进入 FIFO 队列，首轮结束后自动开始下一 Turn。
    await sendMessage(electronApp, "测试排队首轮");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("排队首轮已开始。");
    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `(() => ({
      buttons: document.querySelectorAll('.send-button').length,
      label: document.querySelector('.send-button')?.getAttribute('aria-label'),
      stop: document.querySelector('.send-button')?.classList.contains('stop'),
      modeToggle: Boolean(document.querySelector('.send-mode-toggle')),
    }))()`,
      ),
    ).toEqual({
      buttons: 1,
      label: "停止当前 Turn",
      stop: true,
      modeToggle: false,
    });
    await sendMessage(electronApp, "测试排队次轮");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("测试排队次轮");
    const queuedScreenshot = await capturePlugin(electronApp);
    await fs.writeFile(
      testInfo.outputPath("zvc-queue-dock.png"),
      queuedScreenshot,
    );
    await testInfo.attach("zvc-queue-dock", {
      body: queuedScreenshot,
      contentType: "image/png",
    });
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 8_000 })
      .toContain("排队次轮已执行。");
    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `document.querySelectorAll('.queue-dock').length`,
      ),
    ).toBe(0);

    // 选择插话模式后，消息在当前模型流结束的安全边界进入同一个 Turn。
    await createConversation(electronApp);
    await sendMessage(electronApp, "测试插话首轮");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("插话首轮正在处理。");
    await sendMessage(electronApp, "测试安全插话", "插话发送");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("等待插话");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 8_000 })
      .toContain("插话已在当前 Turn 继续。");
    const steerTurnIds = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const id = window.zvcBridge.getInitialState().activeConversationId
      return window.zvcBridge.getConversationById(id).messages.filter((message) => message.role === 'user').map((message) => message.turnId)
    })()`,
    );
    expect(steerTurnIds).toHaveLength(2);
    expect(new Set(steerTurnIds).size).toBe(1);

    // 强制停止只终止当前 Turn，已排队消息在收口后继续执行。
    await createConversation(electronApp);
    await sendMessage(electronApp, "测试停止保留队列");
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 5_000 })
      .toContain("停止测试首轮已开始。");
    await sendMessage(electronApp, "测试停止后的队列", "排队发送");
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.querySelector('.send-button.stop')?.click(); true`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 8_000 })
      .toContain("停止后队列继续执行。");

    const persistedInbox = await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const id = window.zvcBridge.getInitialState().activeConversationId
      return {
        pendingMessages: window.zvcBridge.getConversationById(id).pendingMessages,
        logPath: window.zvcBridge.getConversationStorageInfo(id).logPath,
      }
    })()`,
    );
    expect(persistedInbox.pendingMessages).toEqual([]);
    const sessionLog = await fs.readFile(persistedInbox.logPath, "utf8");
    expect(sessionLog).toContain('"pendingMessages":[]');

    const screenshot = await capturePlugin(electronApp);
    await fs.writeFile(
      testInfo.outputPath("zvc-conversation-queue.png"),
      screenshot,
    );
    await testInfo.attach("zvc-conversation-queue", {
      body: screenshot,
      contentType: "image/png",
    });
  } finally {
    if (electronApp) await electronApp.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
