"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const distRoot = process.env.LIVE_MARKDOWN_DIST || path.join(pluginRoot, "dist");
const source = "# Thin execution acceptance\n\nPRIVATE_DOCUMENT_SENTINEL: the source stays unchanged.";
const pythonInstruction = "在文末新增一个 Python 代码块，实现 add(a, b) 函数并返回 a + b。";
const pythonArtifact = "```python\ndef add(a, b):\n    return a + b\n```";
const pythonPayload = JSON.stringify({ payload: "def add(a, b):\n    return a + b" });
const markdownInstruction = "创建代码块 markdown 格式 标题一 hello";
const markdownArtifact = "```markdown\n# hello\n```";
const naturalInstruction = "给文末配一段关于春天的介绍。";
const naturalPlan = JSON.stringify({
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "document_end",
  layout: "block",
  text: "春天来了，万物复苏。"
});

async function openAssistant(browser, content = source, options = {}) {
  const { sourceMode = false, ...workflowOptions } = options;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  await page.addInitScript(installLocalAiWorkflow, { content, ...workflowOptions });
  await page.goto(pathToFileURL(path.join(distRoot, "index.html")).href);
  await page.locator("#write").waitFor();
  if (sourceMode) {
    await page.getByTestId("top-viewmode-cycle-btn").click();
    await page.locator("textarea.ty-source-textarea").waitFor();
  }
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function send(page, instruction) {
  await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
  await page.getByRole("button", { name: "发送指令", exact: true }).click();
}

async function waitForRequests(page, count) {
  await page.waitForFunction((expected) => window.__workflow.requests.length >= expected, count);
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function resolve(page, index, output) {
  await page.evaluate(([requestIndex, text]) => window.__workflow.resolve(requestIndex, text), [index, output]);
}

async function sourceEditor(page) {
  const editor = page.locator("textarea.ty-source-textarea");
  if (!(await editor.count())) await page.getByTestId("top-viewmode-cycle-btn").evaluate((button) => button.click());
  await editor.waitFor();
  return editor;
}

async function undoOnce(page) {
  await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
  await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
}

async function setSnapshotSelection(page, from, to) {
  const editor = await sourceEditor(page);
  await editor.evaluate((textarea, range) => {
    textarea.focus();
    textarea.setSelectionRange(range[0], range[1]);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  }, [from, to]);
  await page.locator('[title="显示/隐藏侧边栏 (Cmd+Shift+L)"]').evaluate((button) => button.click());
  await page.waitForFunction(([start, end]) => {
    const root = document.querySelector(".typora-ai-assistant-drawer");
    const key = root && Object.keys(root).find((name) => name.startsWith("__reactFiber$"));
    let fiber = key && root ? root[key] : null;
    while (fiber) {
      const props = fiber.memoizedProps ?? fiber.pendingProps;
      const snapshot = props?.documentSnapshot;
      if (start === end && snapshot?.selection == null && snapshot?.cursor === start) return true;
      if (snapshot?.selection?.from === start && snapshot.selection.to === end) return true;
      fiber = fiber.return;
    }
    return false;
  }, [from, to]);
}

async function waitForStaleStop(page, requestIndex, changedSource) {
  await page.waitForFunction(() => window.__workflow.cancelGenerationCalls > 0
    && !document.querySelector(".ty-ai-send-button")?.matches('[aria-label="停止生成"]')
    && !document.querySelector(".ty-ai-stream")?.textContent?.trim(), null, { timeout: 1_000 });
  await page.locator(".ty-ai-error").waitFor();

  const state = await page.evaluate((index) => ({
    cancelled: window.__workflow.requests[index]?.cancelled,
    cancellationCount: window.__workflow.cancelGenerationCalls,
    streamedText: document.querySelector(".ty-ai-stream")?.textContent?.trim() ?? "",
    requestCount: window.__workflow.requests.length
  }), requestIndex);
  assert.equal(state.cancelled, true, "the provider is cancelled while its promise is still pending");
  assert.ok(state.cancellationCount >= 1, "the host receives an active cancellation signal");
  assert.equal(state.streamedText, "", "stale partial output is cleared");
  assert.equal(state.requestCount, 1, "staleness does not start another provider request");
  assert.equal(await page.locator(".ty-ai-error").innerText(), "文档或选区已变化，本次任务已停止，请重新发送指令。");
  assert.equal(await page.locator(".ty-ai-review").count(), 0, "stale output cannot become a proposal");
  assert.equal(await page.locator(".ty-ai-failed-draft").count(), 0, "stale output cannot become a repair draft");
  assert.equal(await page.getByRole("button", { name: /确认并(?:替换|追加|插入)/u }).count(), 0);
  if (changedSource !== undefined) assert.equal(await (await sourceEditor(page)).inputValue(), changedSource);
}

test("default thin execution keeps common tasks to one request or less", async (t) => {
  const browser = await launchBrowser();
  try {
    await t.test("opening the assistant is silent; manually asking a general question makes one raw request", async () => {
      const page = await openAssistant(browser);
      try {
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "opening the generic assistant sends no model request");
        const instruction = "请解释一下 Python 的 len() 函数用途。";
        await send(page, instruction);
        const [request] = await waitForRequests(page, 1);
        assert.equal(request.outputSchema, undefined, "a source-independent question does not use an intent-planning call");
        assert.ok(request.prompt.includes(instruction), "the raw call keeps the complete user question");
        assert.doesNotMatch(request.prompt, /PRIVATE_DOCUMENT_SENTINEL/u, "a general question has no document dependency");
        await resolve(page, 0, "len() 返回对象中的元素数量。\n");
        await page.locator(".ty-ai-result").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
      } finally {
        await page.close();
      }
    });

    await t.test("explicit EOF Python generation fills one body without the full source", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      try {
        await send(page, pythonInstruction);
        const [request] = await waitForRequests(page, 1);
        assert.ok(request.outputSchema?.properties?.payload, "the model only fills the known artifact body");
        assert.ok(request.prompt.includes(pythonInstruction), "the complete code requirements reach the body call");
        assert.doesNotMatch(request.prompt, /PRIVATE_DOCUMENT_SENTINEL/u, "new code does not inherit unrelated source text");
        await resolve(page, 0, pythonPayload);
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "there is no planner or repair request");
        const editor = await sourceEditor(page);
        assert.equal(await editor.inputValue(), source, "the proposal is preview-only until confirmed");
        await page.getByRole("button", { name: "确认并追加", exact: true }).click();
        assert.equal(await editor.inputValue(), `${source}\n\n${pythonArtifact}`);
        await undoOnce(page);
        assert.equal(await editor.inputValue(), source, "one undo restores the exact source");
      } finally {
        await page.close();
      }
    });

    await t.test("fully specified Markdown H1 composes without a model call", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      try {
        await send(page, markdownInstruction);
        await page.locator(".ty-ai-review,.ty-ai-error").first().waitFor();
        assert.equal(await page.locator(".ty-ai-error").count(), 0);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "the literal artifact is fully determined by the instruction");
        assert.ok((await page.locator(".ty-diff-row-added .ty-diff-content").allTextContents()).some((line) => line.trim() === "# hello"));
        const editor = await sourceEditor(page);
        assert.equal(await editor.inputValue(), source);
        await page.getByRole("button", { name: "确认并追加", exact: true }).click();
        assert.equal(await editor.inputValue(), `${source}\n\n${markdownArtifact}`);
        await undoOnce(page);
        assert.equal(await editor.inputValue(), source);
      } finally {
        await page.close();
      }
    });

    await t.test("an unknown natural description uses one structured plan and no body call", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      try {
        await send(page, naturalInstruction);
        const [request] = await waitForRequests(page, 1);
        assert.ok(request.outputSchema, "the uncertain operation is represented by one structured plan");
        assert.ok(request.prompt.includes(naturalInstruction), "the planning input preserves the original description");
        await resolve(page, 0, naturalPlan);
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "the plan already contains the candidate text");
        assert.ok((await page.locator(".ty-diff-row-added .ty-diff-content").allTextContents()).join("\n").includes("春天来了，万物复苏。"));
        const editor = await sourceEditor(page);
        assert.equal(await editor.inputValue(), source);
        await page.getByRole("button", { name: "确认并追加", exact: true }).click();
        assert.equal(await editor.inputValue(), `${source}\n\n春天来了，万物复苏。`);
        await undoOnce(page);
        assert.equal(await editor.inputValue(), source, "the structured candidate is applied as one undoable patch");
      } finally {
        await page.close();
      }
    });

    await t.test("document edits actively cancel pending work and discard private payload partials", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      const changedSource = `${source}\n\n用户在生成期间补充的内容。`;
      try {
        await send(page, pythonInstruction);
        const requests = await waitForRequests(page, 1);
        assert.ok(requests[0].outputSchema?.properties?.payload);
        await page.evaluate(() => window.__workflow.emit(0, "stale partial"));
        assert.equal(await page.locator(".ty-ai-stream").filter({ hasText: "stale partial" }).count(), 0, "partial protocol data stays private");
        const editor = await sourceEditor(page);
        await editor.fill(changedSource);
        await waitForStaleStop(page, 0, changedSource);
      } finally {
        await page.close();
      }
    });

    await t.test("selection changes actively cancel a selection-bound request", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      const selected = "the source stays unchanged";
      const selectedStart = source.indexOf(selected);
      try {
        await setSnapshotSelection(page, selectedStart, selectedStart + selected.length);
        await send(page, "请将当前选中的句子改写得更简洁，保留原意。");
        const requests = await waitForRequests(page, 1);
        assert.ok(requests[0].prompt.includes("请将当前选中的句子改写得更简洁，保留原意。"));
        await page.evaluate(() => window.__workflow.emit(0, "stale selection partial"));
        await page.locator(".ty-ai-stream").filter({ hasText: "stale selection partial" }).waitFor();
        await setSnapshotSelection(page, 0, "# Thin execution acceptance".length);
        await waitForStaleStop(page, 0, source);
      } finally {
        await page.close();
      }
    });

    await t.test("cursor changes actively cancel a cursor-bound request", async () => {
      const page = await openAssistant(browser, source, { sourceMode: true });
      try {
        await setSnapshotSelection(page, source.length, source.length);
        await send(page, "在当前光标处生成一个 Python 代码块，实现 add(a, b) 并返回 a + b。");
        const requests = await waitForRequests(page, 1);
        await page.evaluate(() => window.__workflow.emit(0, "stale cursor partial"));
        assert.equal(await page.locator(".ty-ai-stream").filter({ hasText: "stale cursor partial" }).count(), 0, "partial protocol data stays private");
        await setSnapshotSelection(page, source.indexOf("PRIVATE_DOCUMENT_SENTINEL"), source.indexOf("PRIVATE_DOCUMENT_SENTINEL"));
        await waitForStaleStop(page, 0, source);
        assert.ok(requests[0].prompt.includes("在当前光标处"), "the pending task carries its cursor location");
      } finally {
        await page.close();
      }
    });

    await t.test("read-only mode can answer without any document write proposal", async () => {
      const page = await openAssistant(browser, source, { readOnly: true });
      try {
        await send(page, "请解释一下 Markdown 标题的写法。");
        await page.locator(".ty-ai-result").waitFor();
        assert.match(await page.locator(".ty-ai-result").innerText(), /CommonMark/u);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.getByRole("button", { name: /确认并(?:替换|追加|插入)/u }).count(), 0);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "reviewed syntax reference makes no model request");
        assert.equal(await (await sourceEditor(page)).inputValue(), source, "read-only answering leaves the document byte-for-byte unchanged");
      } finally {
        await page.close();
      }
    });

    await t.test("a failed direct request stops without automatic retry", async () => {
      const page = await openAssistant(browser, source);
      try {
        await send(page, pythonInstruction);
        const requests = await waitForRequests(page, 1);
        assert.ok(requests[0].outputSchema?.properties?.payload);
        await page.evaluate(() => window.__workflow.reject(0, "fixture transport disconnected"));
        await page.locator(".ty-ai-error").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.getByRole("button", { name: /重试/u }).count(), 0);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
