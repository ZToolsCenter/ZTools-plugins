"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const distRoot = process.env.LIVE_MARKDOWN_DIST || path.join(pluginRoot, "dist");
const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
const sentence = "The release notes needs a careful review before it can ship.";
const corrected = "The release notes need a careful review before it can ship.";
const opaquePadding = "PROTECTED_READONLY_SENTINEL_0123456789\n".repeat(2_000);
const largeSource = `${sentence}\n\n\`\`\`text\n${opaquePadding}\`\`\`\n`;
const MAX_PRE_PROVIDER_MS = 8_000;
const MAX_P95_FRAME_GAP_MS = 750;

async function openAssistant(browser, content, pageWorkers, pageErrors) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  page.on("worker", worker => pageWorkers.push({ url: worker.url(), at: Date.now() }));
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.addInitScript(installLocalAiWorkflow, {
    content,
    modelId,
    executionPolicy: "thin"
  });
  await page.goto(pathToFileURL(path.join(distRoot, "index.html")).href);
  await page.locator("#write .cm-editor").waitFor();
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function startResponsivenessProbe(page) {
  await page.evaluate(() => {
    const probe = window.__agreementProbe = {
      startedAt: performance.now(),
      frameTimes: [],
      active: true
    };
    const tick = now => {
      if (!probe.active) return;
      probe.frameTimes.push(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopResponsivenessProbe(page) {
  return page.evaluate(() => {
    const probe = window.__agreementProbe;
    if (!probe) return null;
    probe.active = false;
    const gaps = probe.frameTimes.slice(1).map((time, index) => time - probe.frameTimes[index]);
    const sortedGaps = [...gaps].sort((left, right) => left - right);
    return {
      elapsedMs: performance.now() - probe.startedAt,
      frameCount: probe.frameTimes.length,
      maxFrameGapMs: gaps.length ? Math.max(...gaps) : null,
      p95FrameGapMs: sortedGaps.length ? sortedGaps[Math.floor((sortedGaps.length - 1) * 0.95)] : null
    };
  });
}

async function waitForFirstProviderRequest(page, pageWorkers, pageErrors) {
  try {
    await page.waitForFunction(() => window.__workflow?.requests?.length > 0, null, { timeout: 12_000 });
  } catch (cause) {
    const state = await page.evaluate(() => ({
      requests: window.__workflow?.requestInputs?.() ?? [],
      localStatus: window.__workflow?.localStatus ?? null,
      assistant: document.querySelector(".typora-ai-assistant-drawer")?.innerText ?? null,
      notices: [...document.querySelectorAll(".ty-ai-error,.ty-ai-warning,.ty-ai-notice")].map(node => node.innerText),
      sourceLength: document.querySelector("#write .cm-editor")?.innerText.length ?? null,
      probe: window.__agreementProbe ? {
        elapsedMs: performance.now() - window.__agreementProbe.startedAt,
        frames: window.__agreementProbe.frameTimes.length
      } : null
    }));
    throw new Error(`No provider request arrived. state=${JSON.stringify({ ...state, pageWorkers, pageErrors })}`, { cause });
  }
  return page.evaluate(() => window.__workflow.requestInputs()[0]);
}

async function waitForProposal(page, pageWorkers, pageErrors) {
  try {
    await page.waitForFunction(() => document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error"), null, { timeout: 15_000 });
  } catch (cause) {
    const state = await page.evaluate(() => ({
      requestCount: window.__workflow?.requests?.length ?? 0,
      assistant: document.querySelector(".typora-ai-assistant-drawer")?.innerText ?? null,
      notices: [...document.querySelectorAll(".ty-ai-error,.ty-ai-warning,.ty-ai-notice")].map(node => node.innerText),
      reviewVisible: Boolean(document.querySelector(".ty-ai-review"))
    }));
    throw new Error(`No proposal or task error appeared. state=${JSON.stringify({ ...state, pageWorkers, pageErrors })}`, { cause });
  }
  const error = await page.locator(".ty-ai-error").allTextContents();
  assert.deepEqual(error, [], `the worker rejected the proposal: ${JSON.stringify({ error, pageWorkers, pageErrors })}`);
}

async function liveMarkdownText(page) {
  return page.evaluate(() => {
    const editor = document.querySelector("#write .cm-editor");
    for (let element = editor?.parentElement; element; element = element.parentElement) {
      const key = Object.keys(element).find(name => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
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

async function runCorrection(page, t, pageWorkers, pageErrors, source, rawOutput, expected) {
  await startResponsivenessProbe(page);
  await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
  const request = await waitForFirstProviderRequest(page, pageWorkers, pageErrors);
  const responsiveness = await stopResponsivenessProbe(page);
  t.diagnostic(`Pre-provider worker run: ${JSON.stringify({ responsiveness, pageWorkers, pageErrors })}`);
  const executionPolicy = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("typora_agent_orchestration_config_v1") ?? "null")?.executionPolicy ?? null; }
    catch { return null; }
  });

  assert.match(page.url(), /^file:/u, "the regression runs against the packaged dist over file://");
  assert.equal(executionPolicy, "thin", `the regression must exercise the thin readable-prose route; provider prompt=${request.prompt}`);
  assert.ok(request.prompt.includes(corrected), "the provider sees source prose after the SVA prepass");
  assert.ok(!request.prompt.includes(sentence), "the incorrect original predicate is corrected before the provider call");
  assert.equal(request.outputSchema, undefined, "readable prose remains a plain text model request");
  assert.ok(pageWorkers.length >= 1,
    `the packaged thin route should emit a real Worker event: ${JSON.stringify({ pageWorkers, providerPrompt: request.prompt })}`);
  assert.ok(responsiveness?.elapsedMs <= MAX_PRE_PROVIDER_MS,
    `pre-provider planning should finish within ${MAX_PRE_PROVIDER_MS} ms: ${JSON.stringify(responsiveness)}`);
  assert.ok(responsiveness?.frameCount >= 1 || responsiveness?.elapsedMs < 50,
    `the page animation loop should progress during worker planning unless it completes within one frame: ${JSON.stringify(responsiveness)}`);
  if (responsiveness?.p95FrameGapMs != null) {
    assert.ok(responsiveness.p95FrameGapMs <= MAX_P95_FRAME_GAP_MS,
      `worker planning should not stall most UI frames: ${JSON.stringify(responsiveness)}`);
  }

  // Deliberately return the original error. The postpass must correct it without a second call.
  await page.evaluate(text => window.__workflow.resolve(0, text), rawOutput);
  await waitForProposal(page, pageWorkers, pageErrors);
  assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1, "pre/post normalization cannot add a provider call");
  assert.equal(await liveMarkdownText(page), source, "the candidate remains preview-only until confirmation");
  assert.match(await page.locator(".ty-ai-review .ty-diff-row-deleted").innerText(), /needs/u);
  assert.match(await page.locator(".ty-ai-review .ty-diff-row-added").innerText(), /need/u);

  await page.getByRole("button", { name: "确认并替换", exact: true }).click();
  assert.equal(await liveMarkdownText(page), expected, "confirmation applies the normalized result and preserves all other source bytes");
  await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
  const undo = page.locator(".ty-menu-dropdown .ty-menu-option").first();
  assert.match(await undo.innerText(), /撤销/u);
  await undo.click();
  assert.equal(await liveMarkdownText(page), source, "one undo restores the exact original source");
  assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
}

test("packaged English agreement worker preserves preview and one-step undo across document sizes", { timeout: 120_000 }, async t => {
  const browser = await launchBrowser();
  try {
    await t.test("small readable prose is normalized before and after one provider call", async t => {
      const pageWorkers = [];
      const pageErrors = [];
      const page = await openAssistant(browser, sentence, pageWorkers, pageErrors);
      try {
        await runCorrection(page, t, pageWorkers, pageErrors, sentence, sentence, corrected);
      } finally {
        await page.close();
      }
    });

    await t.test("large CM6 document runs nested NLP in the real AiTaskWorker and preserves fenced source", async t => {
      assert.ok(new TextEncoder().encode(largeSource).byteLength > 65_536, "the fixture must cross the large-task worker threshold");
      const pageWorkers = [];
      const pageErrors = [];
      const page = await openAssistant(browser, largeSource, pageWorkers, pageErrors);
      try {
        await runCorrection(page, t, pageWorkers, pageErrors, largeSource, sentence, largeSource.replace(sentence, corrected));
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
