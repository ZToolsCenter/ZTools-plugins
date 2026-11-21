"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

test("code theme updates rendered code and persists across reload", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: 'Intro\n\n```js\n/* first\nsecond */\nconst x = 42;\n```\n' });
    await page.addInitScript(() => {
      const bridge = window.typoraBridge;
      const load = bridge.loadPersistedState;
      bridge.loadPersistedState = () => {
        const state = load();
        const saved = localStorage.getItem("typora_ztools_preferences_v1");
        if (saved) state.preferences = JSON.parse(saved);
        return state;
      };
    });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    const keyword = page.locator(".cm-codeblock-line .hljs-keyword").first();
    await keyword.waitFor();
    const before = await keyword.evaluate((el) => getComputedStyle(el).color);
    assert.equal(await page.locator('.cm-codeblock-line .hljs-comment').count(), 2);
    await page.locator('[title="偏好设置 (Cmd+,)"]').click();
    await page.getByTestId("code-theme-select").selectOption("contrast");
    assert.equal(await page.locator("html").getAttribute("data-code-theme"), "contrast");
    const contrastColor = await keyword.evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(contrastColor, before);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("typora_ztools_preferences_v1"))).codeTheme, "contrast");
    await page.locator('#ty-preferences .ty-preferences-header .ty-icon-btn').click();
    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.getByTestId("top-viewmode-cycle-btn").click();
    const renderedKeyword = page.locator(".ty-code-render .hljs-keyword").first();
    await renderedKeyword.waitFor();
    assert.equal(await renderedKeyword.evaluate((el) => getComputedStyle(el).color), contrastColor);
    assert.equal(await page.locator(".ty-code-render .hljs-comment").count(), 2);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.codeTheme === "contrast");
  } finally { await browser.close(); }
});
