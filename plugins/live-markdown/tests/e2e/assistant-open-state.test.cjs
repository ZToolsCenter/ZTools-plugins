"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { readThinProseSlots, thinProseResponse, assertOnlyAuthorizedProse } = require("./fixtures/thin-prose-response.cjs");

const distIndexHtml = path.join(pluginRoot, "dist/index.html");
const initialDocument = "# AI Assistant State\n\nBody text stays unchanged.";

async function startPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.addInitScript(installLocalAiWorkflow, { content: initialDocument });
  await page.goto(pathToFileURL(distIndexHtml).href, { waitUntil: "domcontentloaded" });
  await page.locator(".typora-workbench").waitFor();
  await page.locator("#write .cm-editor").waitFor();
  return page;
}

async function openWithSlashAi(page) {
  const bodyLine = page.locator(".cm-line").filter({ hasText: /^Body text stays unchanged\.$/ });
  await bodyLine.click();
  await page.keyboard.press("Home");
  await page.keyboard.type("/ai");
  await page.locator(".ty-slash-item").filter({ hasText: "AI 创作助手" }).click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
}

async function waitForRequests(page, count) {
  await page.waitForFunction((expected) => window.__workflow.requestInputs().length >= expected, count);
  return page.evaluate(() => window.__workflow.requestInputs());
}

function assertThinPolishRequest(input, source, expectedSlotText) {
  const slots = assertOnlyAuthorizedProse(input.prompt, source);
  assert.ok(slots.some(({ text }) => text.includes(expectedSlotText)), "the request includes the expected authorized prose slot");
  const edits = input.outputSchema?.properties?.edits;
  assert.equal(edits?.minItems, slots.length, "the provider must return exactly one receipt per slot");
  assert.equal(edits?.maxItems, slots.length);
  assert.deepEqual(edits?.items?.properties?.id?.enum, slots.map(({ id }) => id));
  return slots;
}

async function selectText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(50);
}

async function assertWholeDocumentScope(page) {
  await page.locator(".ty-ai-scope").filter({ hasText: "未选择内容，将处理当前文件全文" }).waitFor();
  assert.equal(await page.locator(".ty-ai-warning").filter({ hasText: "此编辑器无法把当前选区准确映射到 Markdown 源码" }).count(), 0);
}

test("generic /ai opens without requests and external assistant selections do not become editor scope", async () => {
  assert.equal(fs.existsSync(distIndexHtml), true, "dist/index.html must exist; use the separately prepared current dist");
  const browser = await launchBrowser();
  let page;
  try {
    page = await startPage(browser);
    await openWithSlashAi(page);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 0);
    await assertWholeDocumentScope(page);

    await selectText(page, ".ty-ai-drawer-title-group b");
    await assertWholeDocumentScope(page);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 0);

    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.locator(".ty-ai-skills-heading h2").waitFor();
    await selectText(page, ".ty-ai-skills-heading h2");
    await page.getByRole("button", { name: "助手", exact: true }).click();
    await assertWholeDocumentScope(page);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 0);

    await page.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor({ state: "detached" });
    await openWithSlashAi(page);
    await assertWholeDocumentScope(page);
    assert.equal(await page.getByText("已停止生成。", { exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 0);
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close();
  }
});

test("Stop feedback remains visible until close, then generic slash reopen clears it without another request", async () => {
  const browser = await launchBrowser();
  let page;
  try {
    page = await startPage(browser);
    await openWithSlashAi(page);
    await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
    const inputs = await waitForRequests(page, 1);
    const slots = assertThinPolishRequest(inputs[0], initialDocument, "Body text stays unchanged.");
    assert.deepEqual(slots, readThinProseSlots(inputs[0].prompt));

    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await page.getByText("已停止生成。", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1);

    await page.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor({ state: "detached" });
    await openWithSlashAi(page);
    assert.equal(await page.getByText("已停止生成。", { exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 1);
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close();
  }
});

test("generic AI creation entry during generation leaves the request alive and reaches guarded review", async () => {
  const browser = await launchBrowser();
  let page;
  try {
    page = await startPage(browser);
    await openWithSlashAi(page);
    await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
    const inputs = await waitForRequests(page, 1);
    assertThinPolishRequest(inputs[0], initialDocument, "Body text stays unchanged.");
    assert.equal(inputs.length, 1, "the known polish task starts one provider request");

    const editor = page.locator("#write .cm-content");
    const sourceBeforeEntry = await editor.textContent();
    const bodyLine = page.locator(".cm-line").filter({ hasText: /^Body text stays unchanged\.$/ });
    await bodyLine.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const floatingToolbar = page.locator(".ty-floating-selection-toolbar");
    await floatingToolbar.waitFor();
    await floatingToolbar.getByRole("button", { name: "AI 创作", exact: true }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 0);
    assert.equal(await page.evaluate(() => window.__workflow.requests[0].cancelled), false);
    assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 1);
    assert.equal(await editor.textContent(), sourceBeforeEntry, "generic AI entry must leave Markdown source unchanged");

    const polished = thinProseResponse(inputs[0].prompt, "Body text stays unchanged.", "Body text polished while retaining the full document structure.");
    await page.evaluate(output => window.__workflow.resolve(0, output), polished);
    await page.locator(".ty-ai-review").waitFor();
    const completedState = await page.evaluate(() => ({
      review: Boolean(document.querySelector(".ty-ai-review")),
      drawer: document.querySelector(".typora-ai-assistant-drawer")?.innerText,
      document: document.querySelector("#write .cm-content")?.textContent,
      requests: window.__workflow.requestInputs().length,
      cancelled: window.__workflow.requests[0]?.cancelled,
      cancelGenerationCalls: window.__workflow.cancelGenerationCalls
    }));
    assert.ok(completedState.review, `active generic re-entry should reach review: ${JSON.stringify(completedState)}`);
    assert.equal(completedState.requests, 1, "opening another entry does not duplicate the in-flight request");
    assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 0);
    assert.equal(completedState.document, sourceBeforeEntry, "generation remains preview-only until explicit confirmation");
    assert.match(await page.locator(".ty-ai-review").innerText(), /Body text polished while retaining the full document structure\./);
    assert.equal(await page.getByRole("button", { name: "确认并替换", exact: true }).count(), 1, "the result is guarded behind its explicit review action");
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close();
  }
});

test("CM6 selection sync clears stale selection on mode switch and allows multi-block compound insertion with fenced JSON", async () => {
  const browser = await launchBrowser();
  let page;
  try {
    const doc = "# 清单\n\n1. 第一条\n2. 第二条\n3. 第三条\n4. 第四条内容\n5. 第五条内容\n";
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(7000);
    await page.addInitScript(installLocalAiWorkflow, { content: doc });
    await page.goto(pathToFileURL(distIndexHtml).href, { waitUntil: "domcontentloaded" });
    await page.locator(".typora-workbench").waitFor();
    await page.locator("#write .cm-editor").waitFor();

    // Select line in CM6, then switch to source mode and back: stale selection must not trigger warning in CM6
    const line4 = page.locator(".cm-line").filter({ hasText: /^4\. 第四条内容$/ });
    await line4.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.locator(".ty-floating-selection-toolbar").waitFor();

    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.locator("textarea.ty-source-textarea").waitFor();
    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.locator("#write .cm-editor").waitFor();

    await page.locator(".cm-line").filter({ hasText: /^5\. 第五条内容$/ }).click();
    await page.keyboard.press("Home");
    await page.keyboard.type("/ai");
    await page.locator(".ty-slash-item").filter({ hasText: "AI 创作助手" }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    await assertWholeDocumentScope(page);

    // Send same-anchor compound multi-artifact prompt and respond with fenced JSON
    const composer = page.getByLabel("输入 AI 指令", { exact: true });
    await composer.fill("4、5条中间插入一个二元一次方程式并在下面插入一个rust的代码块，输出打印helloworld");
    await page.getByRole("button", { name: "发送指令", exact: true }).click();
    const inputs = await waitForRequests(page, 1);
    assert.equal(inputs.length, 1);
    assert.equal(await page.locator(".ty-ai-error").count(), 0);

    const fencedJson = "```json\n" + JSON.stringify({
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "exact_match",
      find: "4. 第四条内容",
      occurrence: "single",
      matchScope: "document",
      text: "$$\nx + 2y = 5\n$$\n\n```rust\nfn main() {\n    println!(\"helloworld\");\n}\n```"
    }) + "\n```";
    await page.evaluate((output) => window.__workflow.resolve(0, output), fencedJson);
    await page.locator(".ty-ai-review").waitFor();
    await page.getByRole("button", { name: /确认并(?:插入|应用)/ }).click();
    await page.locator(".ty-ai-review").waitFor({ state: "detached" });

    await page.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor({ state: "detached" });
    await page.getByTestId("top-viewmode-cycle-btn").click();
    const updatedSource = await page.locator("textarea.ty-source-textarea").inputValue();
    assert.ok(updatedSource.includes("4. 第四条内容\n\n$$\nx + 2y = 5\n$$\n\n```rust"));
    assert.ok(updatedSource.includes("5. 第五条内容"));
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close();
  }
});
