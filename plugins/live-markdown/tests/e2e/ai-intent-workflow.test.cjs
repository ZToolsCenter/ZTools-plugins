"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const acceptanceDir = path.join(pluginRoot, ".cache/acceptance/ai-intent");
const source = "# 意图规划验收\n\n选中范围。\n\n## 真实结尾\n\n文档的最后一行。";

async function openEditor(browser, content = source, workflowOptions = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.addInitScript(installLocalAiWorkflow, {
    ...workflowOptions,
    executionPolicy: workflowOptions.executionPolicy ?? "full",
    content,
    captureClipboard: true
  });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-editor").waitFor();
  if (content === "") {
    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.locator("textarea.ty-source-textarea").fill("");
  }
  return page;
}

async function boot(browser, content = source, workflowOptions = {}) {
  const page = await openEditor(browser, content, workflowOptions);
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function requests(page, count) {
  await page.waitForFunction((expected) => window.__workflow.requests.length >= expected, count);
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function resolve(page, index, output) {
  await page.evaluate(([at, text]) => window.__workflow.resolve(at, text), [index, output]);
}

async function send(page, instruction) {
  await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
  await page.getByRole("button", { name: "发送指令", exact: true }).click();
}

async function sourceText(page) {
  let editor = page.locator("textarea.ty-source-textarea");
  if (!(await editor.count())) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    editor = page.locator("textarea.ty-source-textarea");
    await editor.waitFor();
  }
  return editor.inputValue();
}

function answerPlan() {
  return JSON.stringify({ version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" } });
}

function appendPlan(text) {
  return JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text } });
}

test("AI intent planning keeps protocol output private and gates every edit", async (t) => {
  const browser = await launchBrowser();
  let page;
  fs.mkdirSync(acceptanceDir, { recursive: true });

  try {
    await t.test("invalid plan unlocks the composer and stops without a retry", async () => {
      page = await boot(browser);
      const instruction = "在文末加一行 hello";
      await send(page, instruction);
      const inputs = await requests(page, 1);
      assert.ok(inputs[0].prompt.includes(instruction));
      assert.ok(inputs[0].prompt.includes("当前没有选区"));
      assert.doesNotMatch(inputs[0].prompt, /文档的最后一行。/, "the planner receives no document body");
      await resolve(page, 0, "{\"version\":1,");
      const error = page.locator(".ty-ai-error");
      await error.waitFor();
      const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
      assert.equal(await composer.isEnabled(), true, "terminal planner errors leave the instruction editable");
      assert.equal(await composer.inputValue(), instruction);
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "malformed plans are not retried");
      assert.equal(await page.getByRole("button", { name: /重试/ }).count(), 0);
      await page.screenshot({ path: path.join(acceptanceDir, "planner-error-unlocks-composer.png"), fullPage: true });
      await page.close();
      page = null;
    });

    await t.test("an empty document accepts an explicit literal append through planning only", async () => {
      page = await boot(browser, "");
      const instruction = "在文末加一行 hello";
      await send(page, instruction);
      const inputs = await requests(page, 1);
      assert.ok(inputs[0].prompt.includes(instruction));
      assert.ok(inputs[0].prompt.includes("当前没有选区"));
      await resolve(page, 0, appendPlan("hello"));
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "literal insertion into an empty document requires no content generation");
      assert.equal(await sourceText(page), "", "the document remains unchanged until confirmation");
      await page.getByRole("button", { name: "确认并追加", exact: true }).click();
      assert.equal(await sourceText(page), "hello");
      await page.close();
      page = null;
    });

    await t.test("bottom replacement changes only the last match after Diff confirmation and one undo restores it", async () => {
      const original = `${source}\n\nhello\n\n中间 **保持原样**。\n\nhello`;
      page = await boot(browser, original);
      await send(page, "底部hello改成helloworld");
      await page.locator(".ty-ai-review").waitFor();
      assert.match(await page.locator(".ty-ai-review-heading").innerText(), /最后一处/);
      assert.match((await page.locator(".ty-diff-row-added").allTextContents()).join("\n"), /helloworld/);
      assert.equal(await sourceText(page), original, "the proposal does not write without confirmation");
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "fully bound literal replacement uses no planner, body call or retry");
      await page.screenshot({ path: path.join(acceptanceDir, "bottom-replace-diff.png"), fullPage: true });
      await page.getByRole("button", { name: "确认并替换", exact: true }).click();
      assert.equal(await sourceText(page), original.slice(0, -5) + "helloworld");
      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      assert.equal(await sourceText(page), original, "one undo restores all original bytes");
      await page.close();
      page = null;
    });

    await t.test("a missing replacement target leaves the source and instruction editable without retrying", async () => {
      page = await boot(browser, source);
      const instruction = "底部hello改成helloworld";
      await send(page, instruction);
      await requests(page, 1);
      await resolve(page, 0, JSON.stringify({ version: 1, kind: "edit", operation: "replace_exact", target: "document", findId: "literal-1", occurrence: "last", content: { mode: "literal", literalId: "literal-2" } }));
      await page.locator(".ty-ai-error").waitFor();
      assert.match(await page.locator(".ty-ai-error").innerText(), /没有在指定范围找到.*原文/);
      const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
      assert.equal(await composer.isEnabled(), true);
      assert.equal(await composer.inputValue(), instruction);
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
      assert.equal(await sourceText(page), source);
      await page.close();
      page = null;
    });

    await t.test("an answer displays generated text without creating an edit proposal", async () => {
      page = await boot(browser, source, { readOnly: true });
      const instruction = "总结这篇文稿的主要结论";
      await send(page, instruction);
      const plannerInputs = await requests(page, 1);
      assert.ok(plannerInputs[0].prompt.includes(instruction));
      assert.ok(plannerInputs[0].prompt.includes("当前没有选区"));
      await resolve(page, 0, answerPlan());
      const inputs = await requests(page, 2);
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /\"kind\":\"answer\"/, "planner JSON never appears in the assistant UI");
      await resolve(page, 1, "主要结论是先校验来源，再进行发布。");
      await page.locator(".ty-ai-result").waitFor();
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "answer-only results never expose apply controls");
      assert.match(await page.locator(".ty-ai-result").innerText(), /主要结论是先校验来源/);
      assert.equal(await sourceText(page), source, "answer-only generation leaves the source unchanged");
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2);
      await page.close();
      page = null;
    });

    await t.test("a late cancelled planner cannot publish a proposal or disturb the next request", async () => {
      page = await boot(browser);
      await send(page, "全文末尾加旧标记");
      await requests(page, 1);
      await page.getByRole("button", { name: "停止生成", exact: true }).click();
      await page.getByText("已停止生成。", { exact: true }).waitFor();

      await send(page, "总结这篇文稿的主要结论");
      await requests(page, 2);
      await resolve(page, 0, appendPlan("旧标记"));
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "the cancelled planner cannot start a content-generation call");
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "a stale planner response cannot create a proposal");

      await resolve(page, 1, answerPlan());
      await requests(page, 3);
      await resolve(page, 2, "文稿先校验来源，再进行发布。");
      await page.locator(".ty-ai-result").waitFor();
      assert.match(await page.locator(".ty-ai-result").innerText(), /先校验来源/);
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 3);
      await page.close();
      page = null;
    });

    await t.test("an explicit document-end plan ignores the active selection and applies as one undoable diff", async () => {
      page = await openEditor(browser);
      const selectedLine = page.locator(".cm-line").filter({ hasText: /^选中范围。$/ });
      await selectedLine.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.locator(".ty-floating-selection-toolbar").waitFor();
      await page.locator(".ty-floating-selection-toolbar").getByRole("button", { name: "AI 创作", exact: true }).click();
      await page.locator(".typora-ai-assistant-drawer").waitFor();

      const instruction = "请在全文最末尾添加“全文尾标记”";
      await send(page, instruction);
      const plannerInputs = await requests(page, 1);
      assert.ok(plannerInputs[0].prompt.includes("当前有有效选区"), "the test must have a real active editor selection");
      assert.ok(plannerInputs[0].prompt.includes(instruction));
      await resolve(page, 0, appendPlan("全文尾标记"));
      await page.locator(".ty-ai-review").waitFor();

      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "literal content requires no generation call after planning");
      assert.equal(await sourceText(page), source, "proposal generation is preview-only");
      assert.equal(await page.locator(".ty-ai-warning").count(), 0, "an explicit document patch must not display an unrelated lost-selection warning");
      assert.match(await page.locator(".ty-ai-review-heading").innerText(), /全文末尾/);
      assert.equal(await page.getByRole("button", { name: "确认并追加", exact: true }).isEnabled(), true);
      const addedText = await page.locator(".ty-diff-row-added").allTextContents();
      assert.ok(addedText.join("\n").includes("全文尾标记"), "Diff must show the appended literal");
      await page.screenshot({ path: path.join(acceptanceDir, "document-end-with-active-selection.png"), fullPage: true });

      const expected = `${source}\n\n全文尾标记`;
      await page.getByRole("button", { name: "确认并追加", exact: true }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      assert.equal(await sourceText(page), expected, "the patch targets the real end of the entire document, not the selected paragraph");
      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      assert.equal(await sourceText(page), source, "one undo restores the exact original document");
      await page.close();
      page = null;
    });

    await t.test("a document edit made while planning invalidates the resulting proposal", async () => {
      page = await openEditor(browser);
      await page.getByTestId("top-viewmode-cycle-btn").click();
      const editor = page.locator("textarea.ty-source-textarea");
      await editor.waitFor();
      await page.getByTestId("top-ai-copilot-btn").click();
      await page.locator(".typora-ai-assistant-drawer").waitFor();
      await send(page, "全文最末尾添加“新内容”");
      await requests(page, 1);

      const changedSource = `${source}\n\n并发修改。`;
      await editor.click({ position: { x: 32, y: 20 } });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.insertText(changedSource);
      await page.waitForFunction((expected) => document.querySelector("textarea.ty-source-textarea")?.value === expected, changedSource);
      await resolve(page, 0, appendPlan("新内容"));
      await page.locator(".ty-ai-error").waitFor();
      assert.equal(await page.locator(".ty-ai-error").innerText(), "文档或选区已变化，本次任务已停止，请重新发送指令。");
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "a stale plan stops before exposing a proposal");
      assert.equal(await page.locator(".ty-ai-failed-draft").count(), 0, "a stale plan cannot be repaired against obsolete context");
      assert.equal(await page.getByRole("button", { name: /确认并(?:替换|追加|插入)/u }).count(), 0, "a stale plan exposes no write action");
      assert.equal(await sourceText(page), changedSource, "planning must not overwrite edits made after its snapshot");
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "a stale plan does not retry planning or content generation");
      await page.screenshot({ path: path.join(acceptanceDir, "stale-document-plan-stopped.png"), fullPage: true });
      await page.close();
      page = null;
    });
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close();
  }
});
