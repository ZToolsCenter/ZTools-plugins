"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { quickstart } = require("./fixtures/cm6-rich-navigation.cjs");
const { NATURAL_MARKDOWN_MARKER, proseResponse } = require("./fixtures/prose-response.cjs");
const acceptanceDir = path.join(pluginRoot, ".cache/acceptance/ai-intent");

const shortSource = "项目团队已经准备了第一份文稿。\n\n第二段说明校验通过后再发布。\n\n第三段要求保留全部结论。";
const longSource = Array.from({ length: 12 }, (_, index) =>
  `## 第 ${index + 1} 节\n\n` + `团队已准备文稿，校验通过后再发布，原有结论需要完整保留。`.repeat(18)
).join("\n\n");
const paragraphSource = Array.from({ length: 8 }, (_, index) =>
  `记录${String(index + 1).padStart(2, "0")}：团队已经准备核对材料，编号${index + 1}的结论需要完整保留，并在复核后发布。`
).join("\n\n");

async function requestCount(page, count) {
  await page.waitForFunction((expected) => window.__workflow.requests.length >= expected, count);
  return page.evaluate(() => window.__workflow.requestInputs());
}

function proseChunk(input) {
  const markerAt = input.prompt.indexOf(NATURAL_MARKDOWN_MARKER);
  assert.ok(markerAt >= 0, "local prose prompts must end with a natural Markdown source fragment");
  assert.equal(input.outputSchema, undefined, "local Markdown generation must not impose a structured receipt schema");
  const markdown = input.prompt.slice(markerAt + NATURAL_MARKDOWN_MARKER.length);
  assert.ok(markdown.length > 0, "the text after the marker is the source-owned Markdown chunk");
  return markdown;
}

async function resolve(page, index, text) {
  await page.evaluate(([at, output]) => window.__workflow.resolve(at, output), [index, text]);
}

async function resolveProse(page, index, transform) {
  const inputs = await requestCount(page, index + 1);
  await resolve(page, index, proseResponse(inputs[index].prompt, transform));
  return inputs[index];
}

async function sourceText(page) {
  const textarea = page.locator("textarea.ty-source-textarea");
  if (await textarea.count()) return textarea.inputValue();
  await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
  await textarea.waitFor();
  return textarea.inputValue();
}

async function plannedProseBatchCount(page) {
  await page.waitForFunction(() => /正在处理第\s*1\/\d+\s*组\s*(?:Markdown\s*)?正文/.test(document.querySelector(".ty-ai-notice")?.textContent || ""));
  const notice = await page.locator(".ty-ai-notice").innerText();
  const match = /正在处理第\s*1\/(\d+)\s*组\s*(?:Markdown\s*)?正文/.exec(notice);
  assert.ok(match, `the first request should expose its precomputed prose batch plan; got: ${notice}`);
  return Number(match[1]);
}

async function resolvePlannedBatches(page, transform, startIndex = 0) {
  const plannedBatches = await plannedProseBatchCount(page);
  const original = await sourceText(page);
  let sourceOffset = 0;
  for (let offset = 0; offset < plannedBatches; offset += 1) {
    const index = startIndex + offset;
    const inputs = await requestCount(page, index + 1);
    await page.waitForFunction(([current, total]) => {
      const notice = document.querySelector(".ty-ai-notice")?.textContent || "";
      return new RegExp(`正在处理第\\s*${current}\\s*\\/\\s*${total}\\s*组\\s*(?:Markdown\\s*)?正文`).test(notice);
    }, [offset + 1, plannedBatches]);
    const markdown = proseChunk(inputs[index]);
    const sourceAt = original.indexOf(markdown, sourceOffset);
    assert.ok(sourceAt >= sourceOffset, `batch ${offset + 1} must contain a source-owned Markdown fragment in original order`);
    sourceOffset = sourceAt + markdown.length;
    await resolve(page, index, proseResponse(inputs[index].prompt, transform));
    await page.waitForFunction((count) => document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error") || window.__workflow.requests.length > count, index + 1);
    if (await page.locator(".ty-ai-error").count()) assert.fail(await page.locator(".ty-ai-error").innerText());
    if (offset + 1 < plannedBatches) await requestCount(page, index + 2);
  }
  await page.locator(".ty-ai-review").waitFor();
  assert.equal(await page.evaluate(() => window.__workflow.requests.length), startIndex + plannedBatches, "one provider response is expected per precomputed batch, with no retries");
  return { batches: plannedBatches, nextRequestIndex: startIndex + plannedBatches };
}

test("AI harness: atomic proposals, bounded recovery, and request isolation", async (t) => {
  const browser = await launchBrowser();
  fs.mkdirSync(acceptanceDir, { recursive: true });
  let page;
  const boot = async (content = shortSource) => {
    await page?.close();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    await page.addInitScript(installLocalAiWorkflow, { content, captureClipboard: true, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-content").waitFor();
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
    await page.locator("textarea.ty-source-textarea").waitFor();
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    return page;
  };
  const polish = () => page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();

  try {
    await t.test("invalid structure stops after one call and leaves the source editable", async () => {
      await boot();
      const instruction = page.getByRole("textbox", { name: "输入 AI 指令" });
      await instruction.fill("润色这份文稿，并保留全部 Markdown 结构");
      await polish();
      const inputs = await requestCount(page, 1);
      const firstChunk = proseChunk(inputs[0]);
      assert.ok(firstChunk.startsWith("项目团队"), "the first Markdown chunk must be from the document prose");
      await resolve(page, 0, proseResponse(inputs[0].prompt, (text) => text === firstChunk ? `# ${text}` : text));
      await page.locator(".ty-ai-error").waitFor();
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "invalid AST output must terminate without an automatic retry");
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /正在进行第\s*\d+\s*次重试|正在重试/);
      assert.equal(await page.getByRole("button", { name: /重试/ }).count(), 0, "failure recovery must not expose a retry button");
      assert.equal(await instruction.isEnabled(), true, "the instruction field must unlock when AST validation terminates the task");
      assert.equal(await instruction.inputValue(), "润色这份文稿，并保留全部 Markdown 结构", "failure must preserve the user's editable instruction");
      await page.screenshot({ path: path.join(acceptanceDir, "terminal-ast-failure.png"), fullPage: true });
      await page.getByRole("button", { name: "修改指令并聚焦输入框" }).click();
      assert.equal(await instruction.evaluate((element) => document.activeElement === element), true, "the failure notice must restore focus to the editable instruction field");
      await instruction.fill("修改指令后再开始");
      assert.equal(await instruction.inputValue(), "修改指令后再开始");
      assert.equal(await sourceText(page), shortSource);
    });

    await t.test("malformed nested Markdown structure is rejected without a partial proposal", async () => {
      const nestedSource = "## 发布计划\n\n- 准备\n  - 校验源码\n    - 对照 AST\n- 发布\n\n保留收尾说明。";
      await boot(nestedSource);
      await polish();
      const inputs = await requestCount(page, 1);
      const chunk = proseChunk(inputs[0]);
      assert.ok(chunk.includes("准备"), "the nested list Markdown must be within the source-owned chunk");
      await resolve(page, 0, proseResponse(inputs[0].prompt, (text) => text === chunk ? `**${text}**` : text));
      await page.locator(".ty-ai-error").waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "a malformed nested AST must stop after its single response");
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "invalid nested list structure cannot be presented as an applicable proposal");
      assert.equal(await sourceText(page), nestedSource, "failed AST validation must leave Markdown bytes unchanged");
    });

    await t.test("a fresh explicit run isolates callbacks from the failed task", async () => {
      await boot();
      await polish();
      const inputs = await requestCount(page, 1);
      const failedChunk = proseChunk(inputs[0]);
      await resolve(page, 0, proseResponse(inputs[0].prompt, (text) => text === failedChunk ? `# ${text}` : text));
      await page.locator(".ty-ai-error").waitFor();
      await polish();
      const newInputs = await requestCount(page, 2);
      assert.deepEqual(
        proseChunk(newInputs[1]),
        failedChunk,
        "a fresh task must be planned from the same unchanged source Markdown"
      );
      await page.evaluate(() => {
        window.__workflow.emit(0, "STALE_FAILED_ATTEMPT");
        window.__workflow.emit(1, "CURRENT_NEW_TASK_STREAM");
      });
      await page.waitForTimeout(50);
      const drawerText = await page.locator(".typora-ai-assistant-drawer").innerText();
      assert.doesNotMatch(drawerText, /STALE_FAILED_ATTEMPT|CURRENT_NEW_TASK_STREAM/, "silent protocol output from both generations stays private");
      assert.equal(await page.locator(".ty-ai-stream").count(), 0, "raw Markdown generation output is never rendered as assistant text");
      assert.equal(await page.getByRole("button", { name: "停止生成" }).isEnabled(), true, "the fresh provider request remains active");
      await page.evaluate(() => window.__workflow.emit(0, "x".repeat(1_048_577)));
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 0, "an oversized stale callback must not abort a separately started task");
      assert.equal(await page.getByRole("button", { name: "停止生成" }).isEnabled(), true, "the active request remains stoppable after an oversized stale callback");
      const completed = await resolvePlannedBatches(page, (body) => body.replace("已经准备了", "已准备"), 1);
      assert.ok(completed.batches >= 1, "the new explicit run completes every planned batch after the prior task failed");
      const expectedProposal = shortSource.replace("已经准备了", "已准备");
      await page.locator(".ty-ai-review").waitFor();
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.copiedText), expectedProposal, "copy action must retain the complete proposal beyond folded diff context");
      assert.equal(await sourceText(page), shortSource);
    });

    await t.test("failure in the final planned batch cannot expose a partial result", async () => {
      await boot(longSource);
      await polish();
      const plannedBatches = await plannedProseBatchCount(page);
      assert.ok(plannedBatches > 1, "the long fixture must plan multiple batches before the first provider call");
      for (let index = 0; index < plannedBatches - 1; index += 1) {
        await resolveProse(page, index, (text) => text);
        await page.waitForFunction((count) => document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error") || window.__workflow.requests.length > count, index + 1);
        assert.equal(await page.locator(".ty-ai-error").count(), 0, "unchanged acknowledgements must let each planned batch complete");
        assert.equal(await page.locator(".ty-ai-review").count(), 0, "no partial proposal may be published before the final batch");
        await requestCount(page, index + 2);
      }
      const inputs = await requestCount(page, plannedBatches);
      assert.ok(longSource.includes(proseChunk(inputs[plannedBatches - 1])), "the injected transport failure belongs to a source-owned final chunk");
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      await page.evaluate((index) => window.__workflow.reject(index, "fixture transport disconnected"), plannedBatches - 1);
      await page.locator(".ty-ai-error").waitFor();
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await sourceText(page), longSource);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), plannedBatches, "the final batch failure is not retried");
    });

    await t.test("stop prevents further chunks even if the provider resolves after cancellation", async () => {
      await boot(longSource);
      await polish();
      await requestCount(page, 1);
      await page.getByRole("button", { name: "停止生成" }).click();
      await resolveProse(page, 0, (text) => text);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await sourceText(page), longSource);
    });

    await t.test("a cancelled provider settling cannot clear or cancel a newer silent edit", async () => {
      await boot();
      await polish();
      const initial = await requestCount(page, 1);
      await page.getByRole("button", { name: "停止生成" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 1, "stopping the first task cancels only its provider request");
      await polish();
      const inputs = await requestCount(page, 2);
      assert.equal(await page.getByRole("button", { name: "停止生成" }).isEnabled(), true, "the replacement task is busy and its stop control is enabled");
      await page.evaluate(() => {
        window.__workflow.emit(1, "CURRENT_AFTER_STOP");
        window.__workflow.emit(0, "STALE_AFTER_STOP");
      });
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /CURRENT_AFTER_STOP|STALE_AFTER_STOP/, "raw planner/prose content is private for current and stale requests");
      assert.equal(await page.locator(".ty-ai-stream").count(), 0, "silent Markdown chunks do not create a visible stream");
      await resolve(page, 0, proseResponse(initial[0].prompt, (text) => text));
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole("button", { name: "停止生成" }).isEnabled(), true, "settling the cancelled provider leaves the new task busy and stoppable");
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 1, "the late old response does not cancel the new provider request");
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /CURRENT_AFTER_STOP|STALE_AFTER_STOP/);
      assert.equal(await page.locator(".ty-ai-stream").count(), 0, "settling the old response still cannot reveal raw source Markdown");
      assert.equal(proseChunk(inputs[1]), proseChunk(initial[0]), "the new task keeps its own source-bound chunk after an old request settles");
      const completed = await resolvePlannedBatches(page, (text) => text.replace("已经准备了", "已准备"), 1);
      assert.equal(completed.nextRequestIndex, 1 + completed.batches);
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.locator(".ty-ai-review").count(), 1, "only the current valid receipt creates one Diff proposal");
      const expectedProposal = shortSource.replace("已经准备了", "已准备");
      assert.match((await page.locator(".ty-ai-review .ty-diff-row-deleted .ty-diff-content").allTextContents()).join("\n"), /已经准备了/);
      assert.match((await page.locator(".ty-ai-review .ty-diff-row-added .ty-diff-content").allTextContents()).join("\n"), /已准备/);
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.copiedText), expectedProposal, "the Diff contains the exact current-task replacement");
      assert.equal(await sourceText(page), shortSource, "the newer task remains a preview until its own confirmation");
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 1, "completing the new receipt does not cancel its own provider request");
    });

    await t.test("all planned prose batches produce one replacement and one undo restores the full original", async () => {
      await boot(longSource);
      await polish();
      const completed = await resolvePlannedBatches(page, (text) => text.replaceAll("团队已准备文稿", "团队已备好文稿"));
      assert.ok(completed.batches >= 1, "the fixture must complete the batch plan generated for this source and provider budget");
      assert.equal(await page.locator(".ty-ai-review").count(), 1);
      assert.equal(await sourceText(page), longSource);
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      const expected = longSource.replaceAll("团队已准备文稿", "团队已备好文稿");
      assert.equal(await page.evaluate(() => window.__workflow.copiedText), expected, "the single proposal must contain every completed slot in source order");
      await page.getByRole("button", { name: "确认并替换" }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      assert.equal(await sourceText(page), expected);
      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      assert.equal(await sourceText(page), longSource);
    });

    await t.test("local conservative edits correct every paragraph in the planned batches and commit atomically", async () => {
      await boot(paragraphSource);
      await polish();
      const completed = await resolvePlannedBatches(page, (text) => text.replaceAll("已经准备", "已备好"));
      const inputs = await page.evaluate(() => window.__workflow.requestInputs());
      assert.equal(inputs.length, completed.batches, "every precomputed batch must receive exactly one fixture response before review");
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.locator(".ty-ai-review").count(), 1, "all eight paragraphs must produce one complete proposal");
      assert.equal(await sourceText(page), paragraphSource, "all paragraph responses remain preview-only until confirmation");
      const expected = paragraphSource.replaceAll("已经准备", "已备好");
      assert.equal((expected.match(/已备好/g) || []).length, 8, "the candidate must correct all eight paragraphs, not only an early batch");
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      assert.equal(await page.evaluate(() => window.__workflow.copiedText), expected, "copy must contain the complete merged document in original order");
      await page.getByRole("button", { name: "确认并替换" }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      assert.equal(await sourceText(page), expected, "one confirmation applies the exact complete proposal");
      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      assert.equal(await sourceText(page), paragraphSource, "one undo restores the exact original document");
    });

    await t.test("stopping after the first response prevents the next planned batch", async () => {
      await boot(longSource);
      await polish();
      await requestCount(page, 1);
      await page.getByRole("button", { name: "停止生成" }).click();
      await resolveProse(page, 0, (text) => text);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "stopping the task must prevent the next planned batch");
      assert.equal(await page.locator(".ty-ai-review").count(), 0);
      assert.equal(await sourceText(page), longSource);
    });

    await t.test("custom restructuring can intentionally merge paragraphs", async () => {
      await boot("第一段说明发布目标。\n\n第二段说明发布时间。");
      const instruction = "合并为一个段落，保留原意。";
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
      await page.getByRole("button", { name: "发送指令" }).click();
      const plannerInputs = await requestCount(page, 1);
      assert.ok(plannerInputs[0].prompt.includes(instruction));
      assert.ok(plannerInputs[0].prompt.includes("当前没有选区"));
      assert.doesNotMatch(plannerInputs[0].prompt, /第一段说明发布目标|第二段说明发布时间/, "the planner receives the instruction and bounded candidates, never the document body");
      await resolve(page, 0, JSON.stringify({ version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "restructure" } }));
      const inputs = await requestCount(page, 2);
      assert.match(inputs[1].prompt, /合并为一个段落/);
      await resolve(page, 1, "发布目标与发布时间已明确。");
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.locator(".ty-ai-error").count(), 0);
      assert.doesNotMatch(await page.locator(".typora-ai-assistant-drawer").innerText(), /\"operation\":\"rewrite\"/, "the planning JSON is never rendered as user-facing content");
    });

    await t.test("planned literal append uses one planner call, creates one diff, and one-step undo", async () => {
      assert.ok(quickstart.length >= 3_000 && quickstart.length <= 4_000, `expected the real roughly 3,400-character Quickstart, got ${quickstart.length}`);
      await boot(quickstart);
      const instruction = "底部加hello";
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
      await page.getByRole("button", { name: "发送指令" }).click();
      const plannerInputs = await requestCount(page, 1);
      assert.ok(plannerInputs[0].prompt.includes(instruction));
      assert.ok(plannerInputs[0].prompt.includes("当前没有选区"));
      assert.doesNotMatch(plannerInputs[0].prompt, /Live Markdown 为你提供读者与创作者/, "planning must not transmit the document body");
      await resolve(page, 0, JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text: "hello" } }));
      await page.locator(".ty-ai-review").waitFor();

      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "the literal requires one intent-planning call and zero content-generation calls");
      assert.equal(await sourceText(page), quickstart, "the proposal must leave the original source untouched until confirmation");
      assert.match(await page.locator(".ty-ai-review-heading").innerText(), /全文末尾/);
      assert.equal(await page.getByRole("button", { name: "确认并追加" }).count(), 1);
      assert.equal(await page.locator(".ty-diff-row-added").filter({ hasText: "hello" }).count(), 1, "the diff should show one appended literal");
      await page.screenshot({ path: path.join(acceptanceDir, "append-review-quickstart.png"), fullPage: true });

      const separator = quickstart.endsWith("\n\n") ? "" : quickstart.endsWith("\n") ? "\n" : "\n\n";
      const expected = `${quickstart}${separator}hello`;
      await page.getByRole("button", { name: "确认并追加" }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      const appended = await sourceText(page);
      assert.equal(appended, expected, "appending must preserve the source and create exactly one new final paragraph");
      assert.equal((appended.match(/hello/g) || []).length, 1, "the literal must be appended exactly once");

      await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
      await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
      assert.equal(await sourceText(page), quickstart, "one undo restores the exact original Quickstart");
    });
  } finally {
    await page?.close();
    await browser.close();
  }
});
