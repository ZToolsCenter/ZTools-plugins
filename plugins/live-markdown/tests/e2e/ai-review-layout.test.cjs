"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { proseResponse } = require("./fixtures/prose-response.cjs");

const oldPhrase = "本文中的待替换短语";
const newPhrase = "本文中的已替换短语";
const source = Array.from({ length: 18 }, (_, index) =>
  `## 第 ${index + 1} 节\n\n` + (index === 9
    ? `本节保留完整上下文，只将${oldPhrase}改为目标文本。`
    : `本节是保持不变的中文正文，用于验证长文差异预览能够折叠未修改上下文。`).repeat(3)
).join("\n\n");

async function getRequests(page, expected) {
  await page.waitForFunction((count) => window.__workflow.requests.length >= count, expected);
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function prepareLongProposal(page) {
  const base = await page.evaluate(() => window.__workflow.requests.length);
  await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
  let index = base;
  let replaced = false;
  while (index < base + 50) {
    const inputs = await getRequests(page, index + 1);
    const output = proseResponse(inputs[index].prompt, text => {
      if (replaced || !text.includes(oldPhrase)) return text;
      replaced = true;
      return text.replace(oldPhrase, newPhrase);
    });
    await page.evaluate(([at, text]) => window.__workflow.resolve(at, text), [index, output]);
    await page.waitForFunction((count) => document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error") || window.__workflow.requests.length > count, index + 1);
    index += 1;
    if (await page.locator(".ty-ai-error").count()) assert.fail(await page.locator(".ty-ai-error").innerText());
    if (await page.locator(".ty-ai-review").count()) break;
  }
  assert.ok(index < base + 50, "long-document planning should finish within the bounded chunk count");
}

async function assertSameRow(locator, message) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { centerY: rect.y + rect.height / 2 };
  }));
  assert.ok(boxes.length > 0, `${message}: controls should be visible`);
  assert.ok(boxes.every((box) => Math.abs(box.centerY - boxes[0].centerY) <= 3), `${message}: ${JSON.stringify(boxes)}`);
}

async function assertCanvasBrand(page, viewport) {
  const brand = page.locator(".ty-ai-canvas-brand");
  await page.locator(".typora-ai-assistant-drawer").evaluate(async (drawer) => {
    await Promise.all(drawer.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  assert.equal(await brand.count(), 1, "the idle assistant should show its canvas brand");
  assert.equal(await brand.isVisible(), true);
  assert.equal(await brand.getAttribute("aria-hidden"), "true", "the decorative brand should be hidden from assistive technology");
  assert.equal(await page.locator(".ty-ai-composer-brand").count(), 0, "the composer must not contain a second brand row");
  assert.equal(await page.locator(".ty-ai-composer-input .ty-ai-composer-watermark").count(), 0, "the text input must not contain a brand watermark");
  assert.equal(await brand.locator("img").count(), 1, "the canvas brand should include the plugin logo");
  assert.match(await brand.innerText(), /AI 助手/);

  const geometry = await brand.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const main = element.closest(".ty-ai-main").getBoundingClientRect();
    const mark = element.querySelector(".ty-ai-canvas-brand-mark").getBoundingClientRect();
    const previous = [];
    for (let node = element.previousElementSibling; node; node = node.previousElementSibling) {
      const box = node.getBoundingClientRect();
      if (box.height) previous.push({ bottom: box.bottom, selector: node.className || node.tagName });
    }
    const style = getComputedStyle(element.querySelector(".ty-ai-canvas-brand-mark"));
    return {
      brand: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 },
      main: { left: main.left, right: main.right, top: main.top, bottom: main.bottom, centerX: main.x + main.width / 2 },
      mark: { top: mark.top, bottom: mark.bottom, centerX: mark.x + mark.width / 2, centerY: mark.y + mark.height / 2 },
      previous,
      opacity: Number(style.opacity),
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  assert.ok(Math.abs(geometry.brand.centerX - geometry.main.centerX) < 2, `the brand canvas should use the assistant's horizontal center: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.mark.centerX - geometry.brand.centerX) < 2 && Math.abs(geometry.mark.centerY - geometry.brand.centerY) < 2, `the logo and label should be centered in the empty canvas area: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.previous.every((item) => geometry.brand.top >= item.bottom - 1), `the brand canvas must start below scope and notices: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.brand.top >= geometry.main.top && geometry.brand.bottom <= geometry.main.bottom + 1, `the brand canvas must remain inside the assistant main region: ${JSON.stringify(geometry)}`);
  const dock = await page.locator(".ty-ai-dock").boundingBox();
  assert.ok(geometry.brand.bottom <= dock.y + 1, `the brand canvas must not overlap the fixed dock: ${JSON.stringify({ geometry, dock })}`);
  assert.ok(geometry.opacity >= 0.3 && geometry.opacity <= 0.4, `the logo watermark should remain subtle: ${geometry.opacity}`);
  assert.equal(geometry.pointerEvents, "none", "the brand must not intercept pointer input");
  if (viewport) assert.ok(geometry.brand.right <= viewport.width + 1, `the brand should fit the viewport: ${JSON.stringify({ viewport, geometry })}`);
}

test("AI edit review uses a readable inline diff and keeps controls docked beside the composer", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content: source, captureClipboard: true, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-editor").waitFor();
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
    await page.locator("textarea.ty-source-textarea").waitFor();
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();

    await assertCanvasBrand(page, { width: 1440, height: 1000 });
    for (const viewport of [{ width: 320, height: 420 }, { width: 900, height: 480 }, { width: 320, height: 820 }]) {
      await page.setViewportSize(viewport);
      await assertCanvasBrand(page, viewport);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    assert.equal(await page.locator(".ty-ai-canvas-brand").count(), 0, "the Skills panel should not display assistant canvas branding");
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    assert.equal(await page.locator(".ty-ai-canvas-brand").count(), 0, "the MCP panel should not display assistant canvas branding");
    await page.getByRole("button", { name: "助手", exact: true }).click();
    await assertCanvasBrand(page, { width: 1440, height: 1000 });
    await page.getByRole("button", { name: "关闭 AI 助手" }).click();
    await page.locator(".typora-ai-assistant-drawer").waitFor({ state: "detached" });
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    await assertCanvasBrand(page, { width: 1440, height: 1000 });

    const dock = page.locator(".ty-ai-dock");
    const quickActions = dock.locator(".ty-ai-actions");
    const moreTrigger = quickActions.locator(".ty-ai-more-trigger");
    const frequent = quickActions.locator(".ty-ai-quick-action:not(.ty-ai-more-trigger)");
    await assertSameRow(frequent, "frequent tasks should share one idle row");
    assert.equal(await quickActions.getByRole("button", { name: "更多续写", exact: true }).count(), 0);
    for (const label of ["续写", "图表", "学术润色", "技术方案"]) {
      assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, `${label} should be hidden until More opens`);
    }

    await moreTrigger.click();
    assert.equal(await moreTrigger.getAttribute("aria-expanded"), "true");
    const moreGroup = page.locator(".ty-ai-more-actions");
    assert.equal(await moreGroup.getAttribute("role"), "group");
    assert.equal(await moreGroup.isVisible(), true);
    const moreBounds = await moreGroup.boundingBox();
    assert.ok(moreBounds.x >= 0 && moreBounds.x + moreBounds.width <= 1440, "More menu should stay within the viewport horizontally");
    assert.ok(moreBounds.y >= 0 && moreBounds.y + moreBounds.height <= 1000, "More menu should stay within the viewport vertically");
    for (const label of ["续写", "图表", "学术润色", "技术方案"]) {
      assert.equal(await moreGroup.getByRole("button", { name: label, exact: true }).isVisible(), true, `${label} should be available in More`);
    }
    for (const viewport of [{ width: 320, height: 420 }, { width: 380, height: 480 }]) {
      await page.setViewportSize(viewport);
      const bounds = await moreGroup.boundingBox();
      assert.ok(bounds, `More should remain visible at ${viewport.width}x${viewport.height}`);
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, `More should fit the narrow viewport: ${JSON.stringify({ viewport, bounds })}`);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, `More should fit the short viewport: ${JSON.stringify({ viewport, bounds })}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.keyboard.press("Escape");
    assert.equal(await moreTrigger.getAttribute("aria-expanded"), "false", "Escape should close More");
    assert.equal(await moreTrigger.evaluate((element) => document.activeElement === element), true, "Escape should restore focus to More");
    await moreTrigger.click();
    await page.locator(".typora-ai-assistant-drawer").locator(".ty-ai-drawer-title-group").click();
    assert.equal(await moreTrigger.getAttribute("aria-expanded"), "false", "outside pointer should close More");

    await moreTrigger.click();
    await moreGroup.getByRole("button", { name: "技术方案", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await moreTrigger.getAttribute("aria-expanded"), "false", "tabbing outside More should close its disclosure");
    assert.equal(await page.getByRole("textbox", { name: "输入 AI 指令" }).evaluate((element) => document.activeElement === element), true, "closing after Tab must preserve the user's destination focus");

    const requestCountBeforeChart = await page.evaluate(() => window.__workflow.requests.length);
    await moreTrigger.click();
    await moreGroup.getByRole("button", { name: "图表", exact: true }).click();
    await page.waitForFunction((count) => window.__workflow.requests.length === count + 1, requestCountBeforeChart);
    assert.equal(await page.locator(".ty-ai-canvas-brand").count(), 0, "canvas branding should disappear while a task is running");
    assert.equal(await moreTrigger.getAttribute("aria-expanded"), "false", "choosing a task should close More");
    assert.equal(await moreTrigger.isDisabled(), true, "More should be disabled while a task is running");
    assert.equal(await frequent.evaluateAll((elements) => elements.every((element) => element.disabled)), true, "frequent tasks should be disabled while busy");
    await page.getByRole("button", { name: "停止生成" }).click();
    await page.waitForFunction(() => !document.querySelector(".ty-ai-more-trigger")?.disabled);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), requestCountBeforeChart + 1, "choosing a chart task must issue exactly one model call");

    const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
    await assertCanvasBrand(page, { width: 1440, height: 1000 });
    await assertSameRow(frequent, "frequent tasks should share one idle row");
    for (const button of await frequent.all()) {
      assert.ok(await button.locator("svg").count() > 0, "each quick task should pair an icon with its text label");
      assert.ok((await button.innerText()).trim().length > 0, "each quick task should keep a visible text label");
    }
    await page.setViewportSize({ width: 320, height: 820 });
    const idleOverflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, actions: document.querySelector(".ty-ai-actions")?.getBoundingClientRect().toJSON() }));
    assert.ok(idleOverflow.document <= idleOverflow.viewport + 1, `idle task controls including copy should fit at 320px: ${JSON.stringify(idleOverflow)}`);
    assert.ok(idleOverflow.actions.x >= 0 && idleOverflow.actions.right <= idleOverflow.viewport + 1, `idle actions should stay inside the viewport: ${JSON.stringify(idleOverflow)}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const requestsBeforeImeCheck = await page.evaluate(() => window.__workflow.requests.length);
    await composer.fill("保留原文，只替换指定短语");
    await composer.evaluate((textarea) => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true, keyCode: 229 })));
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), requestsBeforeImeCheck, "IME confirmation must not submit the assistant prompt");
    assert.equal(await composer.inputValue(), "保留原文，只替换指定短语");
    await composer.fill("");

    await prepareLongProposal(page);
    const review = page.locator(".ty-ai-review");
    assert.equal(await page.locator(".ty-ai-canvas-brand").count(), 0, "canvas branding should stay hidden while a proposal is shown");
    assert.equal(await review.getAttribute("aria-label"), "修改对照预览");
    assert.equal(await review.locator(".ty-diff-unified").count(), 1, "AI proposals should start in the shared unified DiffView");
    const deletedRow = review.locator(".ty-diff-row-deleted");
    const addedRow = review.locator(".ty-diff-row-added");
    assert.equal(await deletedRow.locator(".ty-diff-token-deleted").allTextContents().then((items) => items.join("")), "待", "only the removed Chinese character should be red");
    assert.equal(await addedRow.locator(".ty-diff-token-added").allTextContents().then((items) => items.join("")), "已", "only the inserted Chinese character should be green");
    const unchangedOld = await deletedRow.locator(".ty-diff-token:not(.ty-diff-token-deleted):not(.ty-diff-token-added)").allTextContents().then((items) => items.join(""));
    const unchangedNew = await addedRow.locator(".ty-diff-token:not(.ty-diff-token-deleted):not(.ty-diff-token-added)").allTextContents().then((items) => items.join(""));
    for (const unchanged of [unchangedOld, unchangedNew]) {
      assert.match(unchanged, /本文中的/);
      assert.match(unchanged, /替换短语/);
    }
    assert.ok(await review.locator(".ty-diff-context-fold").count() > 0, "unchanged long context must be folded by default");
    assert.ok((await review.locator(".ty-diff-row-deleted").count()) <= 1, "a short phrase change must not render the whole document as deleted");

    const composerWrap = dock.locator(".ty-ai-composer-wrap");
    for (const action of [".ty-ai-result-actions", ".ty-ai-composer-wrap"]) {
      assert.equal(await dock.locator(action).count(), 1, `${action} must live in the fixed action dock`);
    }
    assert.equal(await dock.locator(".ty-ai-actions").count(), 0, "quick tasks should be hidden while a proposal awaits review");
    assert.equal(await dock.locator(".ty-ai-more-trigger").count(), 0, "More should be hidden while a proposal awaits review");
    assert.equal(await dock.locator(".ty-ai-composer-wrap .ty-ai-settings-trigger").count(), 1, "settings should sit beside the composer model selector");
    const composerToolbar = dock.locator(".ty-ai-composer-toolbar");
    assert.equal(await composerToolbar.locator(".ty-ai-model-trigger").count(), 1);
    await assertSameRow(composerToolbar.locator(".ty-ai-model-trigger, .ty-ai-settings-trigger, .ty-ai-send-button"), "model, settings and send controls should share the composer row");
    for (const name of ["复制结果", "确认并替换", "取消修改"]) {
      assert.equal(await dock.getByRole("button", { name }).count(), 1, `${name} must be available in the review action row`);
    }
    assert.equal(await dock.locator(".ty-ai-result-actions .ty-ai-copy-icon").count(), 1, "review copy should be one compact icon control");
    await assertSameRow(dock.locator(".ty-ai-review-status, .ty-ai-copy-icon, .ty-ai-proposal-actions > button"), "review status and actions should share one row");
    const dockBounds = await dock.boundingBox();
    const drawerBounds = await page.locator(".typora-ai-assistant-drawer").boundingBox();
    const composerBounds = await composerWrap.boundingBox();
    assert.ok(Math.abs(dockBounds.y + dockBounds.height - (drawerBounds.y + drawerBounds.height)) < 3, "the action dock must stay attached to the bottom of the assistant sidebar");
    assert.ok(composerBounds.y > dockBounds.y && composerBounds.y + composerBounds.height <= dockBounds.y + dockBounds.height, "the input must remain inside the dock below the review row");
    assert.equal(await page.locator(".ty-ai-composer-input .ty-ai-composer-watermark").count(), 0, "proposal review must not restore an input watermark");

    const beforeScroll = await dock.boundingBox();
    await page.locator(".ty-ai-main").evaluate((main) => { main.scrollTop = main.scrollHeight; });
    await page.waitForTimeout(50);
    const afterScroll = await dock.boundingBox();
    assert.ok(Math.abs(beforeScroll.y - afterScroll.y) < 2, "the action dock and composer must stay fixed while review content scrolls");

    await page.screenshot({ path: path.join(screenshotRoot, "ai-review-unified-light.png"), fullPage: true });
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").filter({ hasText: "Night" }).click();
    await page.waitForFunction(() => document.querySelector(".typora-workbench")?.classList.contains("theme-night"));
    assert.equal(await page.locator(".typora-workbench").evaluate((element) => element.classList.contains("theme-night")), true, "dark-theme evidence must use the app's actual Night theme");
    await page.screenshot({ path: path.join(screenshotRoot, "ai-review-unified-dark.png"), fullPage: true });

    for (const viewport of [{ width: 380, height: 820 }, { width: 320, height: 820 }, { width: 900, height: 480 }]) {
      const { width, height } = viewport;
      await page.setViewportSize(viewport);
      for (const name of ["复制结果", "取消修改", "确认并替换"]) {
        const control = dock.getByRole("button", { name });
        assert.equal(await control.isVisible(), true, `${name} should remain visible at ${width}x${height}`);
        const box = await control.boundingBox();
        assert.ok(box.y + box.height <= height + 1, `${name} should remain inside the viewport at ${width}x${height}`);
      }
      const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, drawer: document.querySelector(".typora-ai-assistant-drawer")?.scrollWidth, drawerClient: document.querySelector(".typora-ai-assistant-drawer")?.clientWidth }));
      assert.ok(overflow.document <= overflow.viewport + 1, `no horizontal document overflow at ${width}px: ${JSON.stringify(overflow)}`);
      assert.ok(overflow.drawer <= overflow.drawerClient + 1, `no assistant drawer overflow at ${width}px: ${JSON.stringify(overflow)}`);
    }

    await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
    const expected = source.replace(oldPhrase, newPhrase);
    assert.equal(await page.evaluate(() => window.__workflow.copiedText), expected, "copy must expose the complete proposal even though unchanged diff context is folded");
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source, "proposal generation must remain preview-only until confirmation");

    await page.getByRole("button", { name: "取消修改" }).click();
    await page.locator(".ty-ai-review").waitFor({ state: "detached" });
    assert.equal(await dock.locator(".ty-ai-actions").isVisible(), true, "cancel should restore idle task controls");
    assert.equal(await dock.locator(".ty-ai-result-actions").count(), 0, "cancel should leave proposal review mode");
    assert.equal(await page.locator(".ty-ai-canvas-brand").count(), 0, "cancel may leave the generated result visible, so the canvas brand remains hidden");
    assert.equal(await dock.locator(".ty-ai-quick-copy").count(), 1, "the idle result copy affordance should be a single icon control");
    await assertSameRow(dock.locator(".ty-ai-actions > *"), "idle copy should not create a second toolbar row");

    await prepareLongProposal(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "确认并替换" }).click();
    await page.locator(".ty-ai-review").waitFor({ state: "detached" });
    const sourceEditor = page.locator("textarea.ty-source-textarea");
    assert.equal(await sourceEditor.inputValue(), expected, "confirmation must apply the exact reviewed proposal");
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await sourceEditor.inputValue(), source, "one undo must restore the exact original document");
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await browser.close();
  }
});
