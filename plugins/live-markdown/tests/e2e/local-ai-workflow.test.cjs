"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { NATURAL_MARKDOWN_MARKER, proseResponse } = require("./fixtures/prose-response.cjs");
const { readThinProseSlots, thinProseResponse, assertOnlyAuthorizedProse } = require("./fixtures/thin-prose-response.cjs");

const distIndexHtml = path.join(pluginRoot, "dist/index.html");

async function startPage(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(6000);
  await page.addInitScript(installLocalAiWorkflow, { ...options, executionPolicy: options.executionPolicy ?? "full" });
  await page.goto(pathToFileURL(distIndexHtml).href, { waitUntil: "domcontentloaded" });
  await page.locator(".typora-workbench").waitFor();
  await page.locator("#write .cm-editor").waitFor();
  return page;
}

async function openAssistant(page) {
  await page.locator('[data-testid="top-ai-copilot-btn"]').click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
}

async function startPolish(page) {
  await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
}

async function startLocalDeployment(page) {
  await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "本地部署" }).click();
  await page.locator(".ty-ai-plans article").first().getByRole("button", { name: "下载并启用" }).click();
}

async function setStatus(page, phase, modelId) {
  await page.evaluate(([nextPhase, id]) => window.__workflow.setStatus(nextPhase, id), [phase, modelId]);
}

async function waitForRequests(page, count) {
  try {
    await page.waitForFunction((expected) => window.__workflow.requestInputs().length >= expected, count);
  } catch (error) {
    const state = await page.evaluate(() => ({ requests: window.__workflow.requestInputs(), assistant: document.querySelector(".typora-ai-assistant-drawer")?.innerText }));
    throw new Error(`${error.message}\nAI fixture state: ${JSON.stringify(state)}`);
  }
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function resolveRequest(page, index, text) {
  await page.evaluate(([requestIndex, output]) => window.__workflow.resolve(requestIndex, output), [index, text]);
  await page.locator(".ty-ai-review").waitFor();
}

function polishResponse(prompt, from, to) {
  const markerAt = prompt.indexOf(NATURAL_MARKDOWN_MARKER);
  assert.notEqual(markerAt, -1, "local prose execution should use a natural Markdown source fragment");
  const sourceMarkdown = prompt.slice(markerAt + NATURAL_MARKDOWN_MARKER.length);
  assert.ok(sourceMarkdown.length > 0, "the prompt suffix after the marker is the exact source-owned Markdown fragment");
  let replaced = false;
  const response = proseResponse(prompt, (source) => {
    if (!replaced && source.includes(from)) {
      replaced = true;
      return source.replace(from, to);
    }
    return source;
  });
  assert.ok(replaced, `the source-owned edit slot should contain ${JSON.stringify(from)}`);
  assert.notEqual(response, sourceMarkdown, "a positive polish case must produce a real edit instead of a no-op");
  return response;
}

async function editorText(page) {
  return page.locator("#write .cm-content").evaluate((node) => node.textContent || "");
}

async function editDocument(page, text) {
  await page.locator("#write .cm-content").fill(text);
  await page.waitForFunction((expected) => document.querySelector("#write .cm-content")?.textContent === expected, text);
}

function scenario(t, name, callback) {
  const selected = process.env.LOCAL_AI_WORKFLOW_SCENARIO;
  return t.test(name, { skip: Boolean(selected && !name.toLowerCase().includes(selected.toLowerCase())) }, callback);
}

test("Real Chromium file:// E2E: local AI deployment and safe edit workflow", async (t) => {
  assert.equal(fs.existsSync(distIndexHtml), true, "dist/index.html must exist; build with vite and prepare-dist first");
  const browser = await launchBrowser();
  const pages = [];
  const boot = async (options) => {
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    pages.length = 0;
    const page = await startPage(browser, options);
    pages.push(page);
    return page;
  };
  try {
    await scenario(t, "local deployment UI is hidden, legacy non-ready local config migrates, and selecting host model resumes only the captured action", async () => {
      const initial = "Original full document text.";
      const page = await boot({ configured: false, content: initial, executionPolicy: "thin" });
      await page.evaluate(() => {
        localStorage.setItem("typora_agent_orchestration_config_v1", JSON.stringify({
          provider: "local", model: "local-small", providerConfigured: true, localAiSource: "managed"
        }));
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".typora-workbench").waitFor();
      await page.locator("#write .cm-editor").waitFor();
      await openAssistant(page);
      await startPolish(page);
      await page.locator(".ty-ai-model-setup").waitFor();
      assert.equal(await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "本地部署" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "使用 Ollama" }).count(), 0);
      await page.getByRole("button", { name: "打开 ZTools 模型设置" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.redirectAiSettingsCalls), 1);
      await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "ZTools" }).click();
      await page.getByRole("button", { name: "使用此模型" }).click();
      const requests = await waitForRequests(page, 1);
      assert.match(requests[0].prompt, /请润色以下 Markdown 正文，只改善表达清晰度和流畅度，保留原意、事实和格式/u,
        "the original polish action is represented by the built-in polish instruction");
      const slots = assertOnlyAuthorizedProse(requests[0].prompt, initial);
      assert.ok(slots.some(({ text }) => text.includes("Original full document text.")), "the task sends the authorized prose slot");
      assert.deepEqual(slots, readThinProseSlots(requests[0].prompt));
      assert.equal(requests.length, 1, "the task reaches the host model in one call");
      await resolveRequest(page, 0, thinProseResponse(requests[0].prompt, "Original full document text.", "Original complete document text."));
      assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1, "review does not trigger another model call");
      assert.match(await page.locator(".ty-ai-review .ty-diff-row-deleted").innerText(), /Original full document text\./);
      assert.match(await page.locator(".ty-ai-review .ty-diff-row-added").innerText(), /Original complete document text\./);
      assert.match(await editorText(page), /Original full document text\./, "generation must remain a preview until confirmation");
      await page.getByRole("button", { name: "确认并替换" }).click();
      await page.waitForFunction(() => document.querySelector("#write .cm-content")?.textContent.includes("Original complete document text."));
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "a confirmed proposal is consumed once");
      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      await page.waitForFunction((expected) => document.querySelector("#write .cm-content")?.textContent === expected, initial);
    });

    await scenario(t, "editing while model setup is open invalidates the original pending polish", async () => {
      const page = await boot({ configured: false, content: "Captured content before setup." });
      await openAssistant(page);
      await startPolish(page);
      await page.locator(".ty-ai-model-setup").waitFor();
      await editDocument(page, "New unsaved content while selecting model.");
      await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "ZTools" }).click();
      await page.getByRole("button", { name: "使用此模型" }).click();
      await page.getByText("选择模型期间文档或选区已变化，本次操作已取消，请重新发起。", { exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.__workflow.requestInputs())).length, 0, "stale pending action must not reach inference");
    });

    await scenario(t, "closing model setup and assistant cancels the pending action", async () => {
      const page = await boot({ configured: false, content: "Setup survives drawer close." });
      await openAssistant(page);
      await startPolish(page);
      await page.locator(".ty-ai-model-setup").waitFor();
      await page.locator('.ty-ai-model-setup header button[aria-label="关闭"]').click();
      await page.locator('[aria-label="关闭 AI 助手"]').click();
      await page.locator('[data-testid="top-ai-copilot-btn"]').click();
      await page.locator(".typora-ai-assistant-drawer").waitFor();
      await page.locator(".ty-ai-model-trigger").click();
      await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "ZTools" }).click();
      await page.getByRole("button", { name: "使用此模型" }).click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 0, "closing cancels the pending action");
    });

    await scenario(t, "send uses the current unsaved full document; a mapped selection sends only its exact range", async () => {
      const full = "Latest unsaved document body.";
      const page = await boot({ content: "Old persisted text." });
      await editDocument(page, full);
      await openAssistant(page);
      await startPolish(page);
      let requests = await waitForRequests(page, 1);
      assert.match(requests[0].prompt, /Latest unsaved document body\./);
      await resolveRequest(page, 0, polishResponse(requests[0].prompt, "Latest unsaved document body.", "Latest unsaved document text."));
      await page.getByRole("button", { name: "取消修改" }).click();

      const selectedText = "a draft sentence";
      await editDocument(page, `${selectedText}; SECRET remainder.`);
      const editor = page.locator("#write .cm-content");
      await editor.click({ position: { x: 5, y: 10 } });
      await editor.press("Home");
      for (let index = 0; index < selectedText.length; index++) await editor.press("Shift+ArrowRight");
      await page.getByText(/将处理当前选区/).waitFor();
      await startPolish(page);
      requests = await waitForRequests(page, 2);
      assert.match(requests[1].prompt, /a draft sentence/);
      assert.doesNotMatch(requests[1].prompt, /SECRET remainder/);
      const selectionMarkerAt = requests[1].prompt.indexOf(NATURAL_MARKDOWN_MARKER);
      assert.notEqual(selectionMarkerAt, -1, "local selection edits use the natural Markdown execution path");
      assert.equal(requests[1].outputSchema, undefined);
      assert.equal(requests[1].prompt.slice(selectionMarkerAt + NATURAL_MARKDOWN_MARKER.length), selectedText, "the selection prompt suffix is exactly the mapped source range");
      await resolveRequest(page, 1, polishResponse(requests[1].prompt, selectedText, "A draft sentence"));
      assert.match(await page.locator(".ty-ai-review .ty-diff-row-deleted").innerText(), /a draft sentence/);
      assert.match(await page.locator(".ty-ai-review .ty-diff-row-added").innerText(), /A draft sentence/);
      assert.equal(await page.locator(".ty-ai-review").count(), 1);
      await page.getByRole("button", { name: "取消修改" }).click();
      assert.equal(await editorText(page), `${selectedText}; SECRET remainder.`, "cancelling the mapped-selection proposal must preserve the source");
    });

    await scenario(t, "document changes during inference disable stale apply", async () => {
      const page = await boot({ content: "Before request." });
      await openAssistant(page);
      await startPolish(page);
      const requests = await waitForRequests(page, 1);
      await editDocument(page, "Changed while model is running.");
      const staleCandidate = polishResponse(requests[0].prompt, "Before request.", "Prior to request.");
      await page.evaluate(([index, output]) => window.__workflow.resolve(index, output), [0, staleCandidate]);
      await page.locator(".ty-ai-error").waitFor();
      assert.equal(await page.locator(".ty-ai-error").innerText(), "文档或选区已变化，本次任务已停止，请重新发送指令。");
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "stale model output never becomes a review proposal");
      assert.equal(await page.locator(".ty-ai-failed-draft").count(), 0, "stale output cannot be repaired against an old snapshot");
      assert.equal(await page.getByRole("button", { name: /确认并(?:替换|追加|插入)/u }).count(), 0, "no write action is shown for stale output");
      assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1, "stale output does not retry inference");
      assert.equal(await editorText(page), "Changed while model is running.");
    });

    await scenario(t, "editing while local readiness is pending cancels the captured request", async () => {
      const page = await boot({ content: "Snapshot before status preflight." });
      await openAssistant(page);
      await page.waitForFunction(() => window.__workflow.statusCalls >= 1);
      await page.evaluate(() => window.__workflow.deferNextStatus());
      await startPolish(page);
      await page.waitForFunction(() => window.__workflow.statusCalls >= 2);
      await editDocument(page, "Snapshot changed while readiness was pending.");
      await page.evaluate(() => window.__workflow.resolveDeferredStatuses());
      await page.getByText("选择模型期间文档或选区已变化，本次操作已取消，请重新发起。", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 0);
    });

    await scenario(t, "closing during local readiness preflight prevents late generation", async () => {
      const page = await boot({ content: "Close before readiness returns." });
      await openAssistant(page);
      await page.waitForFunction(() => window.__workflow.statusCalls >= 1);
      await page.evaluate(() => window.__workflow.deferNextStatus());
      await startPolish(page);
      await page.waitForFunction(() => window.__workflow.statusCalls >= 2);
      await page.locator('[aria-label="关闭 AI 助手"]').click();
      await page.evaluate(() => window.__workflow.resolveDeferredStatuses());
      await page.locator('[data-testid="top-ai-copilot-btn"]').click();
      await page.locator(".typora-ai-assistant-drawer").waitFor();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 0);
    });

    await scenario(t, "choosing a new provider cancels the active generation and discards its proposal", async () => {
      const page = await boot({ content: "Provider switch cancels active output." });
      await openAssistant(page);
      await startPolish(page);
      const requests = await waitForRequests(page, 1);
      await page.locator(".ty-ai-model-trigger").click();
      await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "ZTools" }).click();
      await page.getByRole("button", { name: "使用此模型" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 1, "provider change must cancel the in-flight local generation");
      assert.equal(await page.evaluate(() => window.__workflow.requests[0].cancelled), true);
      await page.evaluate(() => window.__workflow.emit(0, "OLD_PROVIDER_CHUNK"));
      const lateResponse = polishResponse(requests[0].prompt, "Provider switch cancels active output.", "Changing provider cancels active output.");
      await page.evaluate((output) => window.__workflow.resolve(0, output), lateResponse);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "old result must not leave an applicable proposal");
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /OLD_PROVIDER_CHUNK|Changing provider cancels active output/);
    });

    await scenario(t, "late chunks after cancellation cannot contaminate a newer request", async () => {
      const page = await boot({ content: "Cancel stream test." });
      await openAssistant(page);
      await startPolish(page);
      await waitForRequests(page, 1);
      await page.getByRole("button", { name: "停止生成" }).click();
      await startPolish(page);
      const requests = await waitForRequests(page, 2);
      await page.evaluate(() => window.__workflow.emit(0, "STALE_CHUNK"));
      await page.evaluate(() => window.__workflow.emit(1, "CURRENT_CHUNK"));
      await resolveRequest(page, 1, polishResponse(requests[1].prompt, "Cancel stream test.", "Cancel stream testing."));
      await page.waitForTimeout(80);
      const visible = await page.locator(".typora-ai-assistant-drawer").innerText();
      assert.doesNotMatch(visible, /STALE_CHUNK/);
      assert.match(await page.locator(".ty-ai-review .ty-diff-row-added").innerText(), /Cancel stream testing\./);
    });

    await scenario(t, "read-only permission previews output but cannot write", async () => {
      const initial = "read-only source.";
      const page = await boot({ content: initial, permissionLevel: "read-only" });
      await openAssistant(page);
      await startPolish(page);
      const requests = await waitForRequests(page, 1);
      await resolveRequest(page, 0, polishResponse(requests[0].prompt, "read-only source.", "Read-only source."));
      assert.equal(await page.getByRole("button", { name: "确认并替换" }).isDisabled(), true);
      assert.equal(await editorText(page), initial);
    });
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    await browser.close();
  }
});
