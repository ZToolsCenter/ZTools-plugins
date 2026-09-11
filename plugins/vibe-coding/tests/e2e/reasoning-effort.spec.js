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
 * @param {string} urlFragment 目标页面 URL 特征。
 * @param {string} source 待执行脚本。
 * @returns {Promise<unknown>} 页面脚本结果。
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
 * 读取指定 WebContentsView 的正文。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @param {string} urlFragment 目标页面 URL 特征。
 * @returns {Promise<string>} 页面正文；尚未加载时返回空字符串。
 */
async function readContentsText(electronApp, urlFragment) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents || contents.isLoading()) return "";
    return contents.executeJavaScript('document.body?.innerText || ""');
  }, urlFragment);
}

/**
 * 截取输入框底部控制区并统计实际绘制像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number, nonBackgroundPixels: number}>} 输入框截图和像素统计。
 * @throws {Error} ZVC 页面或输入框不存在时抛出。
 */
async function captureComposer(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const rect = await contents.executeJavaScript(`(async () => {
      const composer = document.querySelector('.composer')
      if (!composer) throw new Error('未找到输入框')
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const bounds = composer.getBoundingClientRect()
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
        Math.max(red, green, blue) - Math.min(red, green, blue) > 7 ||
        (red + green + blue) / 3 < 215
      )
        nonBackgroundPixels += 1;
    }
    return {
      png: image.toPNG().toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
      nonBackgroundPixels,
    };
  }, pluginUrl);
}

/**
 * 打开并截取模型与推理等级触发器及其弹窗，验证弹层不会被输入区裁剪。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<{png: string, width: number, height: number, nonBackgroundPixels: number, text: string}>} 弹窗截图、尺寸、像素统计和正文。
 * @throws {Error} ZVC 页面、触发器或弹窗不存在时抛出。
 */
async function captureModelReasoningPicker(electronApp) {
  return electronApp.evaluate(async ({ webContents }, fragment) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes(fragment));
    if (!contents) throw new Error("未找到 ZVC WebContentsView");
    const state = await contents.executeJavaScript(`(async () => {
      const trigger = document.querySelector('.model-reasoning-trigger')
      if (!trigger) throw new Error('未找到模型与推理等级触发器')
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const popover = document.querySelector('.model-reasoning-popover')
      if (!popover) throw new Error('模型与推理等级弹窗未打开')
      const triggerBounds = trigger.getBoundingClientRect()
      const popoverBounds = popover.getBoundingClientRect()
      const left = Math.max(0, Math.floor(Math.min(triggerBounds.left, popoverBounds.left) - 8))
      const top = Math.max(0, Math.floor(Math.min(triggerBounds.top, popoverBounds.top) - 8))
      const right = Math.ceil(Math.max(triggerBounds.right, popoverBounds.right) + 8)
      const bottom = Math.ceil(Math.max(triggerBounds.bottom, popoverBounds.bottom) + 8)
      return {
        rect: { x: left, y: top, width: right - left, height: bottom - top },
        text: popover.textContent?.replace(/\\s+/g, ' ').trim() || '',
      }
    })()`);
    const image = await contents.capturePage(state.rect);
    const bitmap = image.toBitmap();
    let nonBackgroundPixels = 0;
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index];
      const green = bitmap[index + 1];
      const red = bitmap[index + 2];
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 7 ||
        (red + green + blue) / 3 < 215
      )
        nonBackgroundPixels += 1;
    }
    return {
      png: image.toPNG().toString("base64"),
      width: image.getSize().width,
      height: image.getSize().height,
      nonBackgroundPixels,
      text: state.text,
    };
  }, pluginUrl);
}

/**
 * 通过开发设置插件导入、安装并启动 ZVC。
 * @param {import('@playwright/test').ElectronApplication} electronApp Electron 应用实例。
 * @returns {Promise<void>} ZVC 启动完成后的 Promise。
 * @throws {Error} 导入、安装或启动任一步失败时抛出。
 */
async function launchZvc(electronApp) {
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
  const launched = await executeInContents(
    electronApp,
    settingsUrlFragment,
    `window.ztools.internal.launch({path: ${JSON.stringify(developmentPlugin?.path || pluginDevelopmentPath)}, type: 'plugin', name: 'ZTools Vibe Coding', param: {payload: '', type: 'text', code: 'zvc-home'}})`,
  );
  expect(launched).toMatchObject({ success: true });
}

test("会话可选择宿主声明的推理强度并用于实际请求", async ({}, testInfo) => {
  const dataRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "zvc-reasoning-effort-e2e-"),
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
        name: "Reasoning Effort Mock",
        apiUrl: "http://127.0.0.1:15241/v1",
        apiKey: "test-key",
        models: [
          {
            modelId: "gpt-5.6-sol",
            contextWindow: 262144,
            reasoning: {
              protocol: "openai-compatible",
              efforts: { low: "low", high: "high", xhigh: "ultra" },
              defaultEffort: "high",
              responseField: "auto",
            },
          },
        ],
      },
    );

    await launchZvc(electronApp);
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("gpt-5.6-sol");

    const hostReasoning = await executeInContents(
      electronApp,
      pluginUrl,
      `window.zvcBridge.getHostModels().then((models) => models[0]?.reasoning)`,
    );
    expect(hostReasoning).toEqual({
      efforts: [
        { id: "low", label: "低" },
        { id: "high", label: "高" },
        { id: "xhigh", label: "极高" },
      ],
      defaultEffort: "high",
    });

    expect(
      await executeInContents(
        electronApp,
        pluginUrl,
        `document.querySelector('.model-reasoning-trigger')?.dataset.reasoningValue || ''`,
      ),
    ).toBe("high");

    // 按用户实际路径打开自定义弹窗，再进入推理等级列表。
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const trigger = document.querySelector('.model-reasoning-trigger')
      if (!trigger) throw new Error('未找到模型与推理等级触发器')
      trigger.click()
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `Boolean(document.querySelector('.model-reasoning-popover'))`,
        ),
      )
      .toBe(true);
    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const row = document.querySelector('[aria-label="选择推理等级"]')
      if (!row) throw new Error('未找到推理等级入口')
      row.click()
      return true
    })()`,
    );
    const reasoningOptions = await executeInContents(
      electronApp,
      pluginUrl,
      `[...document.querySelectorAll('.model-reasoning-option')].map((option) => ({ value: option.dataset.value, label: option.textContent?.trim() }))`,
    );
    expect(reasoningOptions).toEqual([
      { value: "low", label: "低" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "极高" },
    ]);

    await executeInContents(
      electronApp,
      pluginUrl,
      `(() => {
      const option = document.querySelector('.model-reasoning-option[data-value="xhigh"]')
      if (!option) throw new Error('未找到极高推理等级选项')
      option.click()
      return true
    })()`,
    );
    await expect
      .poll(() =>
        executeInContents(
          electronApp,
          pluginUrl,
          `window.zvcBridge.getInitialState().conversations.find((item) => item.id === window.zvcBridge.getInitialState().activeConversationId)?.reasoningEffort || ''`,
        ),
      )
      .toBe("xhigh");

    // 重载插件页面，验证强度来自会话 JSONL/索引恢复，而非当前组件内存。
    await executeInContents(electronApp, pluginUrl, "location.reload(); true");
    await expect
      .poll(
        () =>
          executeInContents(
            electronApp,
            pluginUrl,
            `document.querySelector('.model-reasoning-trigger')?.dataset.reasoningValue || ''`,
          ),
        { timeout: 15_000 },
      )
      .toBe("xhigh");

    const pickerCapture = await captureModelReasoningPicker(electronApp);
    const pickerScreenshot = Buffer.from(pickerCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-model-reasoning-picker.png"),
      pickerScreenshot,
    );
    await testInfo.attach("zvc-model-reasoning-picker", {
      body: pickerScreenshot,
      contentType: "image/png",
    });
    expect(pickerCapture.text).toContain("模型");
    expect(pickerCapture.text).toContain("推理等级");
    expect(pickerCapture.text).toContain("极高");
    expect(pickerCapture.width).toBeGreaterThan(250);
    expect(pickerCapture.height).toBeGreaterThan(100);
    expect(pickerCapture.nonBackgroundPixels).toBeGreaterThan(300);
    await executeInContents(
      electronApp,
      pluginUrl,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`,
    );

    const composerCapture = await captureComposer(electronApp);
    const screenshot = Buffer.from(composerCapture.png, "base64");
    await fs.writeFile(
      testInfo.outputPath("zvc-reasoning-effort-selector.png"),
      screenshot,
    );
    await testInfo.attach("zvc-reasoning-effort-selector", {
      body: screenshot,
      contentType: "image/png",
    });
    expect(composerCapture.width).toBeGreaterThan(500);
    expect(composerCapture.nonBackgroundPixels).toBeGreaterThan(400);

    await executeInContents(
      electronApp,
      pluginUrl,
      `(async () => {
      const textarea = document.querySelector('.composer textarea')
      const button = document.querySelector('.send-button')
      if (!textarea || !button) throw new Error('未找到消息输入控件')
      textarea.value = '测试 OpenAI 推理映射'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      button.click()
    })()`,
    );
    await expect
      .poll(() => readContentsText(electronApp, pluginUrl), { timeout: 15_000 })
      .toContain("OpenAI 推理映射完成。");

    const providerRequest = await fetch(
      "http://127.0.0.1:15241/last-request",
    ).then((response) => response.json());
    expect(providerRequest.reasoning_effort).toBe("ultra");
  } finally {
    if (electronApp) await electronApp.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
});
