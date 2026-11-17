"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const source = "# 文档\n\n润色需要结合目标读者。\n\n最后一段保持原样。";

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  await page.addInitScript(installLocalAiWorkflow, { content: source, captureClipboard: true, executionPolicy: "full" });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-editor").waitFor();
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function awaitRequests(page, count) {
  await page.waitForFunction(expected => window.__workflow.requests.length >= expected, count);
  return page.evaluate(() => window.__workflow.requestInputs());
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

test("intent questions are planned before answering and never edit the source", async t => {
  const browser = await launchBrowser();
  let page;
  try {
    await t.test("a question mentioning polish is answered after one private plan request", async () => {
      page = await boot(browser);
      const instruction = "如何润色这段话？";
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
      await page.getByRole("button", { name: "发送指令", exact: true }).click();

      const first = await awaitRequests(page, 1);
      assert.ok(first[0].prompt.includes(instruction));
      assert.ok(first[0].prompt.includes("当前没有选区"));
      assert.doesNotMatch(first[0].prompt, /润色需要结合目标读者/u, "the planner receives no document body");
      assert.ok(first[0].outputSchema, "the model first receives a structured intent schema");
      await page.evaluate(() => window.__workflow.resolve(0, JSON.stringify({
        version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" }
      })));

      const calls = await awaitRequests(page, 2);
      assert.ok(calls[1].prompt.includes(instruction), "the answer stage receives the original question");
      await page.evaluate(() => window.__workflow.resolve(1, "这是在询问润色这类编辑任务的方法，不是在请求改写文稿。"));
      await page.locator(".ty-ai-result").waitFor();

      assert.equal(await page.locator(".ty-ai-review").count(), 0, "an answer cannot expose edit confirmation");
      assert.match(await page.locator(".ty-ai-result").innerText(), /询问润色这类编辑任务的方法/u);
      assert.equal(await sourceText(page), source);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2);
      await page.close();
      page = null;
    });

    await t.test("an unclear model plan stops with the instruction editable and no retry", async () => {
      page = await boot(browser);
      const instruction = "给最后那块处理一下";
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
      await page.getByRole("button", { name: "发送指令", exact: true }).click();
      const first = await awaitRequests(page, 1);
      assert.ok(first[0].outputSchema, "the ambiguous request is sent through intent planning");
      assert.doesNotMatch(first[0].prompt, /润色需要结合目标读者/u);
      await page.evaluate(() => window.__workflow.resolve(0, JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" })));
      await page.locator(".ty-ai-error").waitFor();

      const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
      assert.equal(await composer.isEnabled(), true);
      assert.equal(await composer.inputValue(), instruction);
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "clarification does not trigger content generation or retry");
      assert.equal(await sourceText(page), source);
      await page.close();
      page = null;
    });
  } finally {
    if (page) await page.close();
    await browser.close();
  }
});
