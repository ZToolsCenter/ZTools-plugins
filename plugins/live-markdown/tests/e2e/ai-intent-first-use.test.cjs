"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const source = "第一段。\n\n最后一段。";
const append = (text) => ({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text } });
async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content: source, executionPolicy: "full" });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-editor").waitFor();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
  await page.locator("textarea.ty-source-textarea").waitFor();
  await page.getByTestId("top-ai-copilot-btn").click();
  return page;
}
async function submit(page, instruction) {
  await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
  await page.getByRole("button", { name: "发送指令", exact: true }).click();
  await page.waitForFunction(() => window.__workflow.requests.length === 1);
}
async function resolve(page, plan) {
  await page.evaluate((output) => window.__workflow.resolve(0, JSON.stringify(output)), plan);
}

test("first custom request respects actual scope and preserves comma-separated literal content", async (t) => {
  const browser = await launchBrowser();
  try {
    await t.test("the first unselected append creates an exact literal EOF patch without a content call", async () => {
      const page = await open(browser);
      try {
        await submit(page, "底部加个hello， world");
        assert.match(await page.locator(".ty-ai-scope").innerText(), /未选择内容/);
        const input = await page.evaluate(() => window.__workflow.requests[0].input);
        assert.match(input.prompt, /当前没有选区/);
        assert.ok(input.prompt.includes('"text":"hello， world"'), "the raw literal is supplied as a traceable data candidate");
        await resolve(page, { ...append("hello， world"), content: { mode: "literal", literalId: "literal-1" } });
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.locator(".ty-ai-error").count(), 0);
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        await page.getByRole("button", { name: "确认并追加", exact: true }).click();
        await page.locator(".ty-ai-review").waitFor({ state: "detached" });
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source + "\n\nhello， world");
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
      } finally { await page.close(); }
    });

    for (const [name, plan] of [
      ["model invents a selection conflict", { version: 1, kind: "clarify", reason: "scope_conflict" }],
      ["model chooses an unavailable selection target", { ...append("hello， world"), target: "selection_end" }]
    ]) {
      await t.test(name + " is reported as a model-scope error without retrying or widening", async () => {
        const page = await open(browser);
        try {
          await submit(page, "底部加个hello， world");
          await resolve(page, plan);
          await page.locator(".ty-ai-error").waitFor();
          const message = await page.locator(".ty-ai-error").innerText();
          assert.match(message, /模型.*范围.*不一致/);
          assert.doesNotMatch(message, /当前选区与指令范围不明确/);
          assert.equal(await page.locator(".ty-ai-review").count(), 0);
          assert.equal(await page.getByRole("textbox", { name: "输入 AI 指令" }).isEnabled(), true);
          assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
          assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        } finally { await page.close(); }
      });
    }

    await t.test("an explicit selection request without a selection does not become a document rewrite", async () => {
      const page = await open(browser);
      try {
        const instruction = "润色选区";
        const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
        await composer.fill(instruction);
        await page.getByRole("button", { name: "发送指令", exact: true }).click();
        const error = page.locator(".ty-ai-error");
        await error.waitFor();
        assert.match(await error.innerText(), /这条指令要求处理当前选区，但没有可用的有效选区。请重新选择内容或明确改为处理全文。/);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        assert.equal(await composer.isEnabled(), true);
        assert.equal(await composer.inputValue(), instruction);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "selection preconditions fail before any planning call");
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
