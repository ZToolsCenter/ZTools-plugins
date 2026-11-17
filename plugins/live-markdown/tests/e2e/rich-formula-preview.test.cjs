"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

test("display formulas after a hard break preserve code literals, surrounding bold text and source", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const source = [
    "# 公式与格式验收", "",
    "**代码前 `code` 代码后**", "",
    "**公式前 $z$ 公式后**", "",
    "正文硬换行后展示：  ",
    "$$ \\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i $$  ",
    "变量说明保持原样。", "",
    "字面代码 `$y$` 和 `$$literal$$` 不显示公式。", "",
    "[查询链接](https://example.test/?q=$u$)", "",
    "结尾保持原样。"
  ].join("\n");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content: source });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    const editor = page.locator("#write .cm-content");
    await editor.locator(".ty-cm6-math-widget").waitFor();
    assert.equal(await editor.locator(".ty-cm6-math-widget").count(), 1);
    assert.equal(await editor.locator(".ty-cm6-math-inline-widget").count(), 1);
    assert.ok((await editor.locator(".cm-inline-code").allTextContents()).includes("$y$"));
    assert.ok((await editor.locator(".cm-inline-code").allTextContents()).includes("$$literal$$"));
    const bold = (await editor.locator(".cm-bold").allTextContents()).join(" ");
    for (const text of ["代码前", "代码后", "公式前", "公式后"]) assert.ok(bold.includes(text), `${text} must retain bold styling`);
    await page.screenshot({ path: path.join(screenshotRoot, "rich-formula-preview.png"), fullPage: true });
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
    const textarea = page.locator("textarea.ty-source-textarea");
    await textarea.waitFor();
    assert.equal(await textarea.inputValue(), source);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
  }
});
