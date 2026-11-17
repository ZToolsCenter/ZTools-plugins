"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { assertOnlyAuthorizedProse, thinProseResponse } = require("./fixtures/thin-prose-response.cjs");

const target = "TARGET 原始短句需要润色，并且预算为 27 元。";
const source = `# Scope\n\nSECRET_BEFORE 不属于选区。\n\n${target}\n\nSECRET_AFTER 也不属于选区。`;

async function boot(browser, content = source, configured = true, engine = "cm6") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.addInitScript(installLocalAiWorkflow, { content, configured });
  await page.addInitScript(engine => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = engine;
      return state;
    };
  }, engine);
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator(engine === "cm6" ? "#write .cm-editor" : "#write .ty-block-wrapper").first().waitFor();
  return page;
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function selectTarget(page) {
  await page.locator(".cm-line").filter({ hasText: new RegExp(`^${target}$`) }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.locator(".ty-floating-selection-toolbar").waitFor();
}

async function slash(page, query, label, keyboard = false) {
  await page.keyboard.type(`/${query}`);
  const item = page.locator(".ty-slash-item").filter({ hasText: label });
  await item.waitFor();
  if (keyboard) await page.keyboard.press("Enter");
  else await item.click();
}

async function requests(page, count) {
  await page.waitForFunction(count => window.__workflow.requests.length >= count, count);
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function drawerBinding(page) {
  return page.evaluate(() => {
    const drawer = document.querySelector(".typora-ai-assistant-drawer");
    const fiberKey = drawer && Object.keys(drawer).find(key => key.startsWith("__reactFiber$"));
    let fiber = fiberKey ? drawer[fiberKey] : null;
    while (fiber) {
      const props = fiber.memoizedProps;
      if (props && props.documentSnapshot) {
        const snapshot = props.documentSnapshot;
        const selection = snapshot.selection;
        return {
          selectedText: props.selectedText ?? "",
          selectionValid: snapshot.selectionValid,
          selection: selection ? { ...selection, text: snapshot.content.slice(selection.from, selection.to) } : null,
          scopeText: drawer.querySelector(".ty-ai-scope")?.textContent ?? ""
        };
      }
      fiber = fiber.return;
    }
    return { error: "TyporaAiAssistant props with documentSnapshot were not found", fiberKey, scopeText: drawer?.querySelector(".ty-ai-scope")?.textContent ?? "" };
  });
}

async function readSource(page) {
  await page.getByTestId("top-viewmode-cycle-btn").evaluate(button => button.click());
  const editor = page.locator("textarea.ty-source-textarea");
  await editor.waitFor();
  return editor.inputValue();
}

function promptData(prompt) {
  const marker = "输入 JSON 数据：\n";
  const marked = prompt.lastIndexOf(marker);
  const candidates = marked >= 0 ? [prompt.slice(marked + marker.length)] : [];
  candidates.push(prompt.split(/\r?\n/u, 1)[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* Source-bearing Skill prompts may use a template rather than JSON. */ }
  }
  return null;
}

function assertSelectedRequest(input) {
  const data = promptData(input.prompt);
  const scopedSource = data?.source ?? data?.document;
  if (scopedSource !== undefined) {
    assert.equal(scopedSource, target, "a structured request carries exactly the authorized selection");
  } else {
    assert.ok(input.prompt.includes(target), "the request must contain the selected source");
    assert.doesNotMatch(input.prompt, /SECRET_BEFORE|SECRET_AFTER/, "a selection must never silently expand to the full document");
  }
  assert.doesNotMatch(input.prompt, /SECRET_BEFORE|SECRET_AFTER/, "a selection must never silently expand to the full document");
}

function assertSelectedThinProseRequest(input) {
  const slots = assertOnlyAuthorizedProse(input.prompt, target);
  const editableText = slots.map(({ text }) => text).join("");
  assert.equal(editableText, target.replace(/\s*27\s*元。/u, ""), "all readable prose is owned while the amount and terminal punctuation stay in the source");
  assert.ok(slots.every(({ text }) => !/\b27\b/u.test(text)), "the numeric source token stays outside editable slots");
  assert.doesNotMatch(input.prompt, /SECRET_BEFORE|SECRET_AFTER/, "a prose slot request must not expand to the full document");
  const edits = input.outputSchema?.properties?.edits;
  assert.equal(edits?.minItems, slots.length, "the response schema requires one edit receipt per owned slot");
  assert.equal(edits?.maxItems, slots.length);
  assert.deepEqual(edits?.items?.properties?.id?.enum, slots.map(({ id }) => id));
  return slots;
}

test("slash TOC preserves adjacent prose and renders while writing below it", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, "# Heading\n\n12\n\n## Second heading\n\nAfter");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.locator(".cm-line").filter({ hasText: /^12$/ }).click();
    await page.keyboard.press("Home");
    await slash(page, "toc", "文章目录", true);
    await page.keyboard.type("新增内容123");
    const toc = page.locator(".ty-cm6-toc-widget");
    await toc.waitFor();
    assert.match(await toc.innerText(), /Heading/);
    await toc.locator(".md-toc-item").filter({ hasText: "Second heading" }).click();
    assert.match(await page.locator(".cm-heading-2").innerText(), /Second heading/);
    await page.screenshot({ path: path.join(screenshotRoot, "slash-toc-after.png") });
    await page.getByTestId("top-viewmode-cycle-btn").click();
    const actual = await page.locator("textarea.ty-source-textarea").inputValue();
    assert.equal((actual.match(/\[toc\]/gi) || []).length, 1);
    assert.ok(actual.includes("新增内容123\n12"));
    assert.ok(actual.endsWith("## Second heading\n\nAfter"));
    assert.doesNotMatch(actual, /\/toc/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});

test("a standalone TOC line renders within prose while embedded and code literals remain literal", async () => {
  const browser = await launchBrowser();
  const content = "# Heading\n\nIntro\n[toc]\nAfter\n\n[toc]12\n\n`[toc]`\n\n\\[toc]\n\n- [toc]\n\n> [toc]\n\n```text\n[toc]\n```";
  const page = await boot(browser, content);
  try {
    await page.locator(".ty-cm6-toc-widget").waitFor();
    assert.equal(await page.locator(".ty-cm6-toc-widget").count(), 1);
    assert.match(await page.locator(".cm-content").innerText(), /Intro/);
    assert.match(await page.locator(".cm-content").innerText(), /After/);
    await page.getByTestId("top-viewmode-cycle-btn").click();
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), content);
  } finally { await page.close(); await browser.close(); }
});

test("slash AI only opens the assistant, and enabling a model does not replay a generic entry", async () => {
  const browser = await launchBrowser();
  try {
    for (const configured of [true, false]) {
      const page = await boot(browser, "# Document\n\nBody text stays unchanged.", configured);
      try {
        await page.locator(".cm-line").filter({ hasText: /^Body text stays unchanged\.$/ }).click();
        await page.keyboard.press("Home");
        await slash(page, "ai", "AI 创作助手", configured);
        await page.locator(".typora-ai-assistant-drawer").waitFor();
        await settle(page);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
        assert.equal(await page.locator(".ty-ai-model-setup").count(), 0);
        if (!configured) {
          await page.locator(".ty-ai-model-trigger").click();
          await page.locator(".ty-ai-model-setup").waitFor();
          assert.equal(await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "本地部署", exact: true }).count(), 0, "local deployment UI is hidden");
          assert.equal(await page.getByRole("button", { name: "打开 ZTools 模型设置", exact: true }).count(), 1);
          await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "ZTools", exact: true }).click();
          await page.getByRole("button", { name: "使用此模型", exact: true }).click();
          await page.locator(".ty-ai-model-setup").waitFor({ state: "detached" });
          await settle(page);
          assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
        }
        await page.getByLabel("输入 AI 指令", { exact: true }).fill("请检查这篇文稿。");
        await page.getByRole("button", { name: "发送指令", exact: true }).click();
        const inputs = await requests(page, 1);
        assert.match(inputs[0].prompt, /请检查这篇文稿/);
        assert.equal(promptData(inputs[0].prompt)?.source, "# Document\n\nBody text stays unchanged.", "the combined call receives the authorized full-document source");
        assert.equal(inputs.length, 1, "the unknown check is completed in one combined request");
        await page.evaluate(() => window.__workflow.resolve(0, JSON.stringify({
          version: 1, kind: "answer", target: "document", text: "这篇文稿目前包含一个标题和一段正文。"
        })));
        await page.locator(".ty-ai-result").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1);
        assert.equal(await page.locator(".ty-ai-review").count(), 0, "an answer does not create a document proposal");
        assert.equal(await readSource(page), "# Document\n\nBody text stays unchanged.", "the answer leaves the document unchanged");
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("selection AI keeps scope, cancels or reviews dedicated prose edits, and summarizes from evidence", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const originalEditorText = await page.locator("#write .cm-content").textContent();
    await selectTarget(page);
    await page.locator(".ty-floating-selection-toolbar").getByRole("button", { name: "AI 创作", exact: true }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    await settle(page);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
    assert.match(await page.locator(".ty-ai-scope").innerText(), /当前选区/);
    await page.getByLabel("输入 AI 指令", { exact: true }).fill("请检查选中的文字。");
    await page.getByRole("button", { name: "发送指令", exact: true }).click();
    const plannerInputs = await requests(page, 1);
    assertSelectedRequest(plannerInputs[0]);
    assert.equal(plannerInputs.length, 1);
    await page.evaluate(() => window.__workflow.resolve(0, JSON.stringify({
      version: 1, kind: "answer", target: "selection", text: "选中的句子可以再简洁一些。"
    })));
    await page.locator(".ty-ai-result").waitFor();
    assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1, "selection answers use one combined call");
    assert.equal(await page.locator(".ty-ai-review").count(), 0);

    for (let count = 2; count <= 3; count++) {
      await selectTarget(page);
      await page.locator(".ty-floating-selection-toolbar").getByRole("button", { name: "润色", exact: true }).click();
      const inputs = await requests(page, count);
      assert.equal(inputs.length, count);
      const slots = assertSelectedThinProseRequest(inputs[count - 1]);
      assert.match(inputs[count - 1].systemPrompt, /专业中文编辑/);
      if (count === 2) {
        await page.getByRole("button", { name: "停止生成", exact: true }).click();
        await page.waitForFunction(index => window.__workflow.requests[index]?.cancelled === true, count - 1);
        assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), count, "cancellation does not retry the prose task");
        assert.equal(await page.locator(".ty-ai-review").count(), 0, "cancelled prose never becomes a Diff proposal");
        assert.equal(await page.locator("#write .cm-content").textContent(), originalEditorText, "cancellation leaves the selected source unchanged");
      } else {
        const polished = "TARGET 这段短文已润色，预算为 27 元。";
        const response = thinProseResponse(inputs[count - 1].prompt, target, polished);
        const edits = JSON.parse(response).edits;
        assert.deepEqual(edits.map(({ id }) => id).sort(), slots.map(({ id }) => id).sort(), "the fixture returns exactly the owned slot IDs");
        assert.equal(edits.map(({ text }) => text).join(""), polished.replace(/\s*27\s*元。/u, ""), "slot edits contain the expected editable text while the amount, unit and final punctuation stay source-owned");
        await page.evaluate(([index, output]) => window.__workflow.resolve(index, output), [count - 1, response]);
        const review = page.locator(".ty-ai-review");
        await review.waitFor();
        const removed = (await review.locator(".ty-diff-row-deleted .ty-diff-content").allTextContents()).join("\n");
        const added = (await review.locator(".ty-diff-row-added .ty-diff-content").allTextContents()).join("\n");
        assert.ok(removed.includes(target), "Diff identifies the selected original prose");
        assert.ok(added.includes(polished), "Diff previews the returned prose-slot edit");
        assert.equal(await page.locator("#write .cm-content").textContent(), originalEditorText, "the proposal is not written before confirmation");
        await page.getByRole("button", { name: "取消修改", exact: true }).click();
        await review.waitFor({ state: "detached" });
        assert.equal(await page.locator("#write .cm-content").textContent(), originalEditorText, "dismissing the Diff preserves the source bytes");
      }
    }

    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await selectTarget(page);
    await page.locator(".ty-floating-selection-toolbar").getByRole("button", { name: "AI 创作", exact: true }).click();
    await page.getByLabel("输入 AI 指令", { exact: true }).waitFor();
    await settle(page);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 3, "opening must not replay the prior polish");
    await selectTarget(page);
    await page.locator(".ty-floating-selection-toolbar").getByRole("button", { name: "总结", exact: true }).click();
    await page.locator(".ty-ai-result,.ty-ai-error").first().waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 3,
      "the only selected summary fact is source-required, so the summary completes without model selection");
    assert.equal(await page.getByRole("button", { name: "确认并替换", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /确认并(?:追加|插入)/ }).count(), 0, "summary defaults to an assistant answer");
    assert.equal(await page.locator(".ty-ai-review,.ty-ai-error").count(), 0);
    assert.match(await page.locator(".ty-ai-result").innerText(), /TARGET 原始短句需要润色，并且预算为 27 元/u);
    await page.getByRole("button", { name: "关闭 AI 助手", exact: true }).click();
    await page.getByTestId("top-viewmode-cycle-btn").click();
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});

test("legacy context-menu AI uses mapped inline-code text and refuses unmappable or lost selections", async () => {
  const browser = await launchBrowser();
  try {
    for (const scenario of ["mapped", "unmapped", "lost"]) {
      const legacySource = scenario === "unmapped" ? source : source.replace(target, "`" + target + "`");
      const page = await boot(browser, legacySource, true, "block");
      try {
        const paragraph = page.locator("#write .ty-paragraph-block").filter({ hasText: target }).first();
        await paragraph.evaluate(element => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const node = walker.nextNode();
          if (!node) throw new Error("The selected paragraph must contain text");
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, node.textContent.length);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
        const box = await paragraph.boundingBox();
        await paragraph.dispatchEvent("contextmenu", { clientX: box.x + 10, clientY: box.y + 5, button: 2 });
        await page.locator("#context-menu").waitFor();
        assert.match(await page.locator(".ty-context-section-label").filter({ hasText: "AI 智能处理" }).innerText(), /已选/);
        if (scenario === "lost") await page.evaluate(() => window.getSelection().removeAllRanges());
        await page.locator("#context-menu").getByRole("button", { name: /AI 选区润色/ }).click();
        await page.locator(".typora-ai-assistant-drawer").waitFor();
        await settle(page);
        const binding = await drawerBinding(page);
        if (scenario === "mapped") {
          assert.equal(binding.selectionValid, true, "the legacy editor maps the selected inline-code text to a source range");
          assert.equal(binding.selection?.text, target, "the authorized range contains the text inside the Markdown code delimiters");
          assert.equal(binding.selectedText, target);
          const inputs = await requests(page, 1);
          const slots = assertSelectedThinProseRequest(inputs[0]);
          assert.equal(slots.length, 1, "the readable prose is editable while the amount and final punctuation stay source-owned");
          assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1, "mapped prose uses one local generation call");
          const polished = "TARGET 这段短句已润色，预算为 27 元。";
          const response = thinProseResponse(inputs[0].prompt, target, polished);
          await page.evaluate(output => window.__workflow.resolve(0, output), response);
          await page.locator(".ty-ai-review").waitFor();
          assert.match(await page.locator(".ty-ai-review .ty-diff-row-deleted").innerText(), /TARGET 原始短句需要润色，并且预算为 27 元/u);
          assert.match(await page.locator(".ty-ai-review .ty-diff-row-added").innerText(), /TARGET 这段短句已润色，预算为 27 元/u);
          assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 1, "the prose proposal does not retry inference");
        } else {
          assert.ok(binding.selectionValid === false || binding.selection === null,
            `${scenario} must not leave a valid source range bound to the old selection`);
          await page.locator(".ty-ai-warning").waitFor();
          assert.equal(await page.evaluate(() => window.__workflow.requestInputs().length), 0,
            "unmappable or lost selections are refused before inference");
          assert.equal(await page.locator(".ty-ai-review").count(), 0, "an unmappable or lost selection cannot create a proposal");
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
