"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { NATURAL_MARKDOWN_MARKER } = require("./fixtures/prose-response.cjs");

const distRoot = process.env.LIVE_MARKDOWN_DIST || path.join(pluginRoot, "dist");
const largeDocument = "项目文稿的事实、日期、金额和 Markdown 结构必须保持原样。 ".repeat(8_000);

function observeRealWorker() {
  const NativeWorker = window.Worker;
  window.__workerCreated = 0;
  window.__workerTerminated = 0;
  window.Worker = class ObservedWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      window.__workerCreated += 1;
    }

    terminate(...args) {
      window.__workerTerminated += 1;
      return super.terminate(...args);
    }
  };
}

async function openLargeDocument(browser, content = largeDocument) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
  await page.addInitScript(installLocalAiWorkflow, { content, executionPolicy: "full" });
  await page.addInitScript(observeRealWorker);
  await page.goto(pathToFileURL(path.join(distRoot, "index.html")).href);
  await page.locator("#write .cm-content").waitFor();
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function waitForRequests(page, expected) {
  try {
    await page.waitForFunction((count) => window.__workflow.requests.length >= count, expected);
  } catch (error) {
    const state = await page.evaluate(() => ({
      requests: window.__workflow.requestInputs(), workerCreated: window.__workerCreated,
      assistant: document.querySelector(".typora-ai-assistant-drawer")?.innerText,
      taskError: document.querySelector(".ty-ai-error")?.innerText
    }));
    throw new Error(`${error.message}\nWorker browser state: ${JSON.stringify(state)}`);
  }
  return page.evaluate(() => window.__workflow.requestInputs());
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

async function liveMarkdownText(page) {
  return page.locator("#write .cm-editor").evaluate((editor) => {
    for (let element = editor.parentElement; element; element = element.parentElement) {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
      let fiber = key ? element[key] : null;
      while (fiber) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const view = hook.memoizedState?.current;
          if (view?.state?.doc && typeof view.dispatch === "function") return view.state.doc.toString();
        }
        fiber = fiber.return;
      }
    }
    return null;
  });
}

async function applyDiagnostics(page, expected) {
  return page.evaluate((target) => {
    let view = null;
    for (let element = document.querySelector("#write .cm-editor")?.parentElement; element && !view; element = element.parentElement) {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
      let fiber = key ? element[key] : null;
      while (fiber && !view) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const candidate = hook.memoizedState?.current;
          if (candidate?.state?.doc && typeof candidate.dispatch === "function") {
            view = candidate;
            break;
          }
        }
        fiber = fiber.return;
      }
    }
    const actual = view?.state.doc.toString() ?? "";
    let mismatchAt = 0;
    while (mismatchAt < Math.min(actual.length, target.length) && actual[mismatchAt] === target[mismatchAt]) mismatchAt += 1;
    return {
      editorViewPresent: Boolean(view),
      actualLength: actual.length,
      expectedLength: target.length,
      matchesExpected: actual === target,
      mismatchAt,
      actualNearMismatch: actual.slice(Math.max(0, mismatchAt - 48), mismatchAt + 80),
      expectedNearMismatch: target.slice(Math.max(0, mismatchAt - 48), mismatchAt + 80),
      selectionStart: view?.state.selection.main.from ?? null,
      selectionEnd: view?.state.selection.main.to ?? null,
      activeElement: document.activeElement?.getAttribute("aria-label") || document.activeElement?.className || document.activeElement?.tagName,
      reviewVisible: Boolean(document.querySelector(".ty-ai-review")),
      applyButtonDisabled: document.querySelector(".ty-ai-proposal-apply")?.disabled ?? null,
      assistantMessages: [...document.querySelectorAll(".ty-ai-notice, .ty-ai-error, .ty-ai-review-notice, .ty-ai-review-status")]
        .map((node) => node.textContent?.trim()).filter(Boolean),
      toast: document.querySelector(".ty-footer-toast")?.textContent?.trim() ?? null,
      dirty: Boolean(document.querySelector(".ty-unsaved-pill, .ty-dirty-dot"))
    };
  }, expected);
}

async function snapshotDiagnostics(page) {
  return page.evaluate(() => {
    const fiberFor = (element) => {
      if (!element) return null;
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
      return key ? element[key] : null;
    };
    const compact = (snapshot) => snapshot ? ({
      documentId: snapshot.documentId,
      revision: snapshot.revision,
      contentLength: snapshot.content?.length,
      selection: snapshot.selection,
      cursor: snapshot.cursor,
      selectionValid: snapshot.selectionValid,
      readOnly: snapshot.readOnly
    }) : null;
    const snapshots = { proposal: null, current: null };
    for (const root of [document.querySelector(".ty-ai-review"), document.querySelector(".typora-ai-assistant-drawer")]) {
      let fiber = fiberFor(root);
      let depth = 0;
      while (fiber && depth++ < 80) {
        const props = fiber.memoizedProps ?? fiber.pendingProps;
        if (props?.proposal?.snapshot) snapshots.proposal = compact(props.proposal.snapshot);
        if (props?.documentSnapshot) snapshots.current = compact(props.documentSnapshot);
        fiber = fiber.return;
      }
    }
    return snapshots;
  });
}

function appendPlan(text) {
  return JSON.stringify({ version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "literal", text } });
}

function proseReplacement(prompt, replacement) {
  const naturalStart = prompt.indexOf(NATURAL_MARKDOWN_MARKER);
  if (naturalStart >= 0) {
    const markdown = prompt.slice(naturalStart + NATURAL_MARKDOWN_MARKER.length);
    const target = "需要校对这一小段说明。";
    assert.ok(markdown.includes(target), "natural Markdown output is bounded to source containing the requested prose");
    assert.doesNotMatch(markdown, /PROTECTED_SOURCE_TOKEN_/, "protected code is not sent as editable prose");
    return markdown.replace(target, replacement);
  }

  const marker = "【待编辑文本槽】\n";
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1, "the provider receives the source-bound prose-slot protocol");
  const input = JSON.parse(prompt.slice(start + marker.length));
  return JSON.stringify({
    protocol: input.protocol,
    batchId: input.batchId,
    edits: input.slots.map(({ id }) => ({ id, status: "replace", text: replacement }))
  });
}

test("large browser AI tasks use a real Worker and keep edits atomic", async (t) => {
  const browser = await launchBrowser();
  let page;
  try {
    await t.test("a large document produces one confirmed append diff while the UI event loop remains active", async (t) => {
      page = await openLargeDocument(browser);
      await page.evaluate(() => {
        window.__frameCount = 0;
        window.__maxFrameGap = 0;
        window.__lastFrameAt = performance.now();
        const tick = () => { window.__frameCount += 1; requestAnimationFrame(tick); };
        const measure = (now) => {
          window.__maxFrameGap = Math.max(window.__maxFrameGap, now - window.__lastFrameAt);
          window.__lastFrameAt = now;
          requestAnimationFrame(measure);
        };
        requestAnimationFrame(tick);
        requestAnimationFrame(measure);
      });
      await send(page, "底部加 WORKER_OK");
      const inputs = await waitForRequests(page, 1);
      assert.ok(inputs[0].prompt.includes("底部加 WORKER_OK"));
      assert.equal(await page.evaluate(() => window.__workerCreated), 1, "the app must construct a real browser Worker, not a test double");
      const responsiveness = await page.evaluate(() => ({ frames: window.__frameCount, maxFrameGapMs: window.__maxFrameGap }));
      t.diagnostic(`Worker planning responsiveness before first provider response: ${JSON.stringify(responsiveness)}`);
      assert.ok(responsiveness.frames > 1, "animation frames must continue while Worker planning is pending at the provider");
      assert.ok(responsiveness.maxFrameGapMs < 250, `the UI thread should not pause for Worker planning (${responsiveness.maxFrameGapMs.toFixed(1)} ms frame gap)`);
      await page.evaluate((plan) => window.__workflow.resolve(0, plan), appendPlan("WORKER_OK"));
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "literal insertion uses one planning call and no content-generation call");
      assert.equal(await page.locator(".ty-diff-row-added").filter({ hasText: "WORKER_OK" }).count(), 1);
      const original = await sourceText(page);
      assert.equal(original, largeDocument, "the proposal must not mutate the document before confirmation");
      await page.getByRole("button", { name: "确认并追加", exact: true }).click();
      const updated = await sourceText(page);
      assert.equal(updated, `${largeDocument}\n\nWORKER_OK`, "the one proposal changes only the document end");
      assert.equal(await page.evaluate(() => window.__workerTerminated), 1, "the worker is physically terminated after completing its one proposal");
      await page.close();
      page = null;
    });

    await t.test("a fixed polish action returns its source-owned proposal without main-thread refinalization", async () => {
      const protectedText = "PROTECTED_SOURCE_TOKEN_".repeat(3_600);
      const content = `需要校对这一小段说明。\n\n\`\`\`text\n${protectedText}\n\`\`\`\n`;
      page = await openLargeDocument(browser, content);
      const originalLiveMarkdown = await liveMarkdownText(page);
      assert.ok(originalLiveMarkdown === content, `read the exact live editor Markdown without switching view modes; actual length=${originalLiveMarkdown?.length ?? "unavailable"}`);
      await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
      const inputs = await waitForRequests(page, 1);
      assert.equal(await page.evaluate(() => window.__workerCreated), 1);
      assert.ok(inputs[0].prompt.includes(NATURAL_MARKDOWN_MARKER), "local prose generation uses natural Markdown input/output");
      assert.equal(inputs[0].outputSchema, undefined, "the local body call has no structured receipt schema");
      const output = proseReplacement(inputs[0].prompt, "需要校对这一小段说明！");
      await page.evaluate((text) => window.__workflow.resolve(0, text), output);
      await page.locator(".ty-ai-review").waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "all prose work and validation completes in a single provider call");
      assert.equal(await page.evaluate(() => window.__workerTerminated), 1, "the worker finishes before the proposal is exposed");
      assert.equal(await page.locator(".ty-diff-row-added").filter({ hasText: "需要校对这一小段说明！" }).count(), 1);
      assert.equal(await liveMarkdownText(page), content, "the worker proposal remains preview-only until confirmation");
      const expected = content.replace("需要校对这一小段说明。", "需要校对这一小段说明！");
      const snapshotsBeforeApply = await snapshotDiagnostics(page);
      const editorBeforeApply = await applyDiagnostics(page, expected);
      await page.getByRole("button", { name: "确认并替换", exact: true }).click();
      const immediate = await applyDiagnostics(page, expected);
      await page.waitForFunction((value) => document.querySelector("textarea.ty-source-textarea")?.value === value, expected, { timeout: 2_000 }).catch(() => {});
      const afterWait = await applyDiagnostics(page, expected);
      assert.equal(afterWait.matchesExpected, true, `confirmed worker proposal did not update source; snapshots before apply: ${JSON.stringify(snapshotsBeforeApply)}; editor before apply: ${JSON.stringify(editorBeforeApply)}; after click: ${JSON.stringify(immediate)}; after wait: ${JSON.stringify(afterWait)}`);
      assert.equal(afterWait.reviewVisible, false, `applied proposal should close its review: ${JSON.stringify(afterWait)}`);
      assert.equal(afterWait.dirty, true, `applied proposal should mark the document dirty: ${JSON.stringify(afterWait)}`);
      assert.equal(await liveMarkdownText(page), expected);
      await page.close();
      page = null;
    });

    await t.test("cancelling a pending large prose request terminates without a partial proposal", async () => {
      const protectedText = "PROTECTED_SOURCE_TOKEN_".repeat(3_600);
      const cancellationDocument = `需要校对这一小段说明。\n\n\`\`\`text\n${protectedText}\n\`\`\`\n`;
      assert.ok(new TextEncoder().encode(cancellationDocument).byteLength > 65_536);
      page = await openLargeDocument(browser, cancellationDocument);
      await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
      const plannerInputs = await waitForRequests(page, 1);
      assert.ok(plannerInputs[0].prompt.includes("需要校对这一小段说明"), "the pending host request contains the editable prose slot");
      assert.ok(plannerInputs[0].prompt.includes(NATURAL_MARKDOWN_MARKER), "the pending local call uses the natural Markdown route");
      assert.equal(plannerInputs[0].outputSchema, undefined);
      assert.equal(await page.evaluate(() => window.__workerCreated), 1);
      await page.getByRole("button", { name: "停止生成" }).click();
      await page.getByText("已停止生成。", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__workflow.cancelGenerationCalls), 1, "cancellation reaches the active host provider request");
      assert.equal(await page.evaluate(() => window.__workerTerminated), 1, "cancellation physically terminates the Worker");
      assert.equal(await page.locator(".ty-ai-review").count(), 0, "cancelled worker output cannot publish a partial diff");
      assert.equal(await sourceText(page), cancellationDocument, "the source remains byte-for-byte unchanged after cancellation");
      await page.close();
      page = null;
    });
  } finally {
    await page?.close();
    await browser.close();
  }
});
