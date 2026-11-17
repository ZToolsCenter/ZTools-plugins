"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const source = "# 明确新增任务\n\n原文 **格式** 和数值 27 保持不变。";
const instruction = "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。";
const generated = "```python\ndef multiply(a, b):\n    return a * b\n```";
const generatedAppendPlan = JSON.stringify({
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "document_end",
  layout: "block",
  content: { mode: "generate", task: "custom" }
});

test("free-form code insertion is planned before generation and applies one reviewed append", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: source, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.waitForLoadState("networkidle");
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
    await page.getByRole("button", { name: "发送指令", exact: true }).click();
    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const [plannerInput] = await page.evaluate(() => window.__workflow.requestInputs());
    assert.ok(plannerInput.outputSchema, "a free-form artifact request is planned before content generation");
    assert.ok(plannerInput.prompt.includes(instruction));
    assert.doesNotMatch(plannerInput.prompt, /原文 \*\*格式\*\* 和数值 27/, "the intent planner does not receive the document body");
    await page.evaluate((text) => window.__workflow.resolve(0, text), generatedAppendPlan);
    await page.waitForFunction(() => window.__workflow.requests.length === 2);
    const generationInput = (await page.evaluate(() => window.__workflow.requestInputs()))[1];
    assert.equal(generationInput.outputSchema, undefined, "content generation follows the structured plan");
    assert.match(generationInput.prompt, /multiply\(a, b\)/);
    assert.ok(generationInput.prompt.includes(source), "the content stage receives source context for the preserve-existing-content clause");
    await page.evaluate((text) => window.__workflow.resolve(1, text), generated);
    await page.locator(".ty-ai-review").waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    assert.match((await page.locator(".ty-diff-row-added").allTextContents()).join("\n"), /multiply/);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    const editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), source, "review alone never writes the document");
    const artifacts = path.join(pluginRoot, ".cache/acceptance/ai-scoped-followup-ui");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "explicit-python-diff.png"), fullPage: true });
    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    assert.equal(await editor.inputValue(), `${source}\n\n${generated}`);
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await editor.inputValue(), source, "one undo restores the exact source");
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "one planner and one content call run without a repair retry");
    assert.equal(await page.getByRole("button", { name: /重试/ }).count(), 0);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("unqualified continuation reviews an append instead of replacing the source", async () => {
  const original = "恢复演练已完成。发布窗口尚未确定。";
  const prompt = "续写一段简短的后续行动建议，沿用原文事实；不要编造日期、金额或负责人。";
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: original, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.waitForLoadState("networkidle");
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(prompt);
    await page.getByRole("button", { name: "发送指令", exact: true }).click();
    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const [plannerInput] = await page.evaluate(() => window.__workflow.requestInputs());
    assert.ok(plannerInput.outputSchema, "free-form continuation first receives an intent plan");
    await page.evaluate(() => window.__workflow.resolve(0, JSON.stringify({
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "document_end",
      layout: "block",
      content: { mode: "generate", task: "continue" }
    })));
    await page.waitForFunction(() => window.__workflow.requests.length === 2);
    const evidenceInput = (await page.evaluate(() => window.__workflow.requestInputs()))[1];
    const ids = evidenceInput.outputSchema?.properties?.suggestions?.items?.properties?.evidenceIds?.items?.enum;
    assert.ok(Array.isArray(ids) && ids.length > 0, "the content stage selects evidence from the source-bound candidates");
    const response = JSON.stringify({ suggestions: ids.map((id) => ({ action: "核对", evidenceIds: [id] })) });
    await page.evaluate((text) => window.__workflow.resolve(1, text), response);
    await page.locator(".ty-ai-review").waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    const added = (await page.locator(".ty-diff-row-added").allTextContents()).join("\n");
    assert.match(added, /建议核对/);
    assert.match(added, /证据|未满足项/);
    assert.doesNotMatch(added, /以下原文事项/);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    const editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), original);
    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    const applied = await editor.inputValue();
    assert.ok(applied.startsWith(`${original}\n\n`), "all original source remains byte-for-byte before the append");
    assert.match(applied.slice(original.length), /建议核对/);
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await editor.inputValue(), original);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "the intent plan is followed by one evidence selection call");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("explicit Markdown code artifact keeps the instruction, previews once, and applies as one undoable append", async () => {
  const original = "# B17 回归文稿\n\n保留这段原文及其 **格式**。";
  const instruction = "新增个markdown的代码块，里面加个h1的hello";
  const generated = "```markdown\n# hello\n```";
  const plan = JSON.stringify({
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "document_end",
    layout: "block",
    content: { mode: "generate", task: "custom" }
  });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    // This fixture stubs localAi.generate; the test never calls a real model.
    await page.addInitScript(installLocalAiWorkflow, { content: original, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.waitForLoadState("networkidle");
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
    await page.getByRole("button", { name: "发送指令", exact: true }).click();

    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const plannerInput = (await page.evaluate(() => window.__workflow.requestInputs()))[0];
    assert.ok(plannerInput.prompt.includes(instruction), "the planner receives the complete user instruction");
    await page.evaluate((text) => window.__workflow.resolve(0, text), plan);

    await page.locator(".ty-ai-review").waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    const added = (await page.locator(".ty-diff-row-added").allTextContents()).join("\n");
    assert.ok(added.includes("```markdown") && added.includes("# hello") && added.includes("```"), "the readable Diff preserves the complete fenced Markdown artifact");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    const editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
    assert.equal(await editor.inputValue(), original, "the source remains byte-for-byte unchanged before confirmation");

    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    const expected = `${original}\n\n${generated}`;
    assert.equal(await editor.inputValue(), expected, "confirmation appends exactly one complete Markdown code block");
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await editor.inputValue(), original, "one undo restores the exact original source");
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "the exact B17 literal Markdown template uses one intent plan and the program-generated artifact path, without a repair retry");
  } finally {
    await page.close();
    await browser.close();
  }
});
