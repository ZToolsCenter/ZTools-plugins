"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { quickstart } = require("./fixtures/cm6-rich-navigation.cjs");

test("reported literal Markdown H1 instruction needs zero inference and confirms one undoable append", async () => {
  const instruction = "底部新增代码块 markdown 标题一 hello";
  // Language, heading level and literal text are fully specified by the instruction.
  const generated = "```markdown\n# hello\n```";
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: quickstart });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.waitForLoadState("networkidle");
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
    await page.getByRole("button", { name: "发送指令", exact: true }).click();
    await page.locator(".ty-ai-review,.ty-ai-error").first().waitFor();
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "literal Markdown structure requires no model call");
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    assert.equal(await page.locator(".ty-ai-review").count(), 1);
    assert.match((await page.locator(".ty-diff-row-added").allTextContents()).join("\n"), /# hello/);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    const editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), quickstart, "preview never writes source");
    const evidenceDir = path.join(pluginRoot, ".cache/acceptance/code-artifact-b22-20261026/browser");
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, "reported-markdown-hello-diff.png"), fullPage: true });
    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    const requiredBreak = quickstart.endsWith("\n\n") ? "" : quickstart.endsWith("\n") ? "\n" : "\n\n";
    assert.equal(await editor.inputValue(), `${quickstart}${requiredBreak}${generated}`);
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await editor.inputValue(), quickstart);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
    assert.equal(await page.getByRole("button", { name: /重试/ }).count(), 0);
  } finally {
    await page.close();
    await browser.close();
  }
});
