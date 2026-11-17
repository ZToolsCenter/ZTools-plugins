"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const source = "# 标题代码回归\n\nPRIVATE_SOURCE_TOKEN 必须保留。";
const instruction = "新增代码块markdown的标题一 hello";
const artifact = "```markdown\n# hello\n```";
const plan = JSON.stringify({
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "document_end",
  layout: "block",
  content: { mode: "generate", task: "custom" }
});

async function sourceText(page) {
  let editor = page.locator("textarea.ty-source-textarea");
  if (!(await editor.count())) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
  }
  return editor.inputValue();
}

test("a literal Markdown heading gets one model plan, a structured Diff, and one undoable append", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: source, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
    await page.getByRole("button", { name: "发送指令", exact: true }).click();

    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const [planner] = await page.evaluate(() => window.__workflow.requestInputs());
    assert.ok(planner.prompt.includes(instruction), "the no-position request still goes through intent planning");
    assert.ok(planner.outputSchema, "the planner receives the structured intent contract");
    assert.doesNotMatch(planner.prompt, /PRIVATE_SOURCE_TOKEN/u, "the planner receives no document body");
    const insert = planner.outputSchema.anyOf.find(({ properties }) => properties.operation?.const === "insert");
    const content = insert?.properties.content.anyOf ?? [];
    const modes = content.map(({ properties }) => properties.mode.const);
    assert.ok(modes.includes("generate"));
    assert.ok(!modes.includes("literal"), "a code artifact cannot be planned as the plain word hello or markdown");

    await page.evaluate((text) => window.__workflow.resolve(0, text), plan);
    await page.waitForFunction(() => window.__workflow.requests.length >= 2 || document.querySelector(".ty-ai-review"));
    const requestCount = await page.evaluate(() => window.__workflow.requests.length);
    if (requestCount > 1) {
      // The pre-compiler path should never reach this fallback. Keep the browser flow observable
      // on that regression so the failure identifies the extra body-model call instead of timing out.
      await page.evaluate((text) => window.__workflow.resolve(1, text), artifact);
    }
    await page.locator(".ty-ai-review").waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    const added = (await page.locator(".ty-diff-row-added").allTextContents()).join("\n");
    assert.ok(added.includes("```markdown") && added.includes("# hello") && added.includes("```"), "Diff shows the compiled fenced heading, not a bare word");

    const editor = page.locator("textarea.ty-source-textarea");
    assert.equal(await sourceText(page), source, "the source remains unchanged before confirmation");
    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    assert.equal(await editor.inputValue(), `${source}\n\n${artifact}`);
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await editor.inputValue(), source, "one undo restores the exact original source");
    assert.equal(requestCount, 1, "the plan compiles this fixed artifact without a second content-model call");
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
  } finally {
    await page.close();
    await browser.close();
  }
});
