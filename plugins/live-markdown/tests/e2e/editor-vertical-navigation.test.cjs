"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const long = "abcdefghij".repeat(30);
async function boot(browser, content, engine = "block") {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.addInitScript(installLocalAiWorkflow, { content });
  await page.addInitScript(engine => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = engine;
      return state;
    };
  }, engine);
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator(engine === "block" ? "#write .ty-block-wrapper" : "#write .cm-editor").first().waitFor();
  return page;
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function activeState(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
  });
}
async function caret(page, offset) {
  await page.evaluate(offset => document.activeElement.setSelectionRange(offset, offset), offset);
  await settle(page);
}
async function fixedTextarea(page) {
  return page.locator("#write textarea.ty-live-textarea").evaluate(el => {
    for (const [name, value] of Object.entries({ width: "320px", padding: "0", border: "0", "box-sizing": "content-box", "font-family": "monospace", "font-size": "16px", "line-height": "20px", "letter-spacing": "0", "word-break": "normal" })) {
      el.style.setProperty(name, value, "important");
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = "16px monospace";
    return Math.floor(320 / context.measureText("a").width);
  });
}
async function focusParagraph(page, text) {
  await page.locator("#write .ty-paragraph-block").filter({ hasText: text }).first().click();
  await page.locator("#write textarea.ty-live-textarea").waitFor();
}
async function sourceText(page) {
  await page.getByTestId("top-viewmode-cycle-btn").click();
  return page.locator("textarea.ty-source-textarea").inputValue();
}

test("legacy arrows follow soft-wrapped visual rows before crossing a block", async () => {
  const browser = await launchBrowser();
  const content = `Previous paragraph\n\n${long}\n\nNext paragraph`;
  const page = await boot(browser, content);
  try {
    await focusParagraph(page, long);
    const columns = await fixedTextarea(page);
    await caret(page, 0);
    await page.keyboard.press("ArrowDown");
    assert.ok((await activeState(page)).start >= columns);
    await page.keyboard.press("ArrowUp");
    assert.equal((await activeState(page)).value, long, "up from the exact start of the second visual row must not skip the first row");
    assert.equal((await activeState(page)).start, 0);
    await caret(page, long.length);
    for (let row = 1; row <= 4; row++) {
      await page.keyboard.press("ArrowUp");
      const state = await activeState(page);
      assert.equal(state.value, long, "an interior visual row must stay in the same block");
      assert.ok(Math.abs(state.start - (long.length - columns * row)) <= 1, JSON.stringify({ columns, row, state }));
      assert.equal(state.start, state.end);
    }
    await page.keyboard.press("ArrowDown");
    assert.ok(Math.abs((await activeState(page)).start - (long.length - columns * 3)) <= 1);
    await caret(page, 2);
    const composingHandled = await page.locator("#write textarea.ty-live-textarea").evaluate(el => {
      const event = new KeyboardEvent("keydown", { key: "ArrowUp", isComposing: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(composingHandled, false, "IME candidate navigation must not be intercepted");
    assert.equal((await activeState(page)).value, long);
    await caret(page, 2);
    await page.keyboard.press("Shift+ArrowUp");
    assert.equal((await activeState(page)).value, long, "shift selection must stay native");
    await caret(page, 2);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.equal((await activeState(page)).value, "Previous paragraph");
    await focusParagraph(page, long);
    await fixedTextarea(page);
    await caret(page, long.length);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    assert.equal((await activeState(page)).value, "Next paragraph");
    assert.equal(await sourceText(page), content, "navigation must never alter Markdown source");
  } finally { await page.close(); await browser.close(); }
});

test("legacy cross-block arrows use the target heading typography", async () => {
  const browser = await launchBrowser();
  const heading = "A long heading with different font sizes ".repeat(8).trim();
  const content = `# ${heading}\n\nMiddle paragraph\n\n## ${heading}`;
  const page = await boot(browser, content);
  try {
    await focusParagraph(page, "Middle paragraph");
    await caret(page, 0);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.equal((await activeState(page)).value, `# ${heading}`);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    assert.equal((await activeState(page)).value, "Middle paragraph", "the previous heading must be entered on its actual last visual row");
    await caret(page, "Middle paragraph".length);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    assert.equal((await activeState(page)).value, `## ${heading}`);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.equal((await activeState(page)).value, "Middle paragraph", "the next heading must be entered on its actual first visual row");
    assert.equal(await sourceText(page), content);
  } finally { await page.close(); await browser.close(); }
});

test("legacy empty and wrapped insertion drafts cross only at their visual edge", async () => {
  const browser = await launchBrowser();
  try {
    for (const tail of [false, true]) {
      const page = await boot(browser, tail ? "Before draft" : "Before draft\n\nAfter draft");
      try {
        await focusParagraph(page, "Before draft");
        await caret(page, "Before draft".length);
        await page.keyboard.press("Enter");
        await page.getByPlaceholder("在此处继续输入新段落...").waitFor();
        await page.keyboard.press("ArrowUp");
        await settle(page);
        assert.equal((await activeState(page)).value, "Before draft", "an empty draft has a real first visual row");
        await caret(page, "Before draft".length);
        await page.keyboard.press("Enter");
        await page.getByPlaceholder("在此处继续输入新段落...").fill(long);
        const columns = await fixedTextarea(page);
        await caret(page, long.length);
        await page.keyboard.press("ArrowUp");
        assert.equal((await activeState(page)).value, long);
        assert.ok(Math.abs((await activeState(page)).start - (long.length - columns)) <= 1);
        await caret(page, 0);
        await page.keyboard.press("ArrowUp");
        await settle(page);
        assert.equal((await activeState(page)).value, "Before draft");
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("legacy terminal newline and wrap-off navigation preserve the adjacent row", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, "Previous");
  try {
    await focusParagraph(page, "Previous");
    await caret(page, "Previous".length);
    await page.keyboard.press("Enter");
    await page.getByPlaceholder("在此处继续输入新段落...").fill(`${long}\n`);
    await fixedTextarea(page);
    await caret(page, long.length + 1);
    const state = await activeState(page);
    assert.equal(state.value, `${long}\n`);
    await page.keyboard.press("ArrowUp");
    assert.equal((await activeState(page)).value, `${long}\n`, "the terminal empty row must move into its own preceding visual row");
    assert.ok((await activeState(page)).start < state.start);
    await page.locator("#write textarea.ty-live-textarea").evaluate(el => { el.wrap = "off"; });
    await caret(page, long.length - 1);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.equal((await activeState(page)).value, "Previous", "an unwrapped source row must cross immediately");
  } finally { await page.close(); await browser.close(); }
});

test("CM6 native arrows and slash menu each move exactly one row or item", async () => {
  const browser = await launchBrowser();
  const content = `# Heading\n\n${long.repeat(2)}\n\nLast`;
  const page = await boot(browser, content, "cm6");
  try {
    const line = page.locator(".cm-line").filter({ hasText: new RegExp(`^${long.repeat(2)}$`) });
    const box = await line.boundingBox();
    assert.ok(box.height > 100, "the paragraph must span several visual rows");
    await line.click({ position: { x: box.width - 5, y: box.height - 5 } });
    await page.keyboard.press("End");
    await settle(page);
    const yPositions = [];
    for (let index = 0; index < 4; index++) {
      yPositions.push((await page.locator(".cm-cursor").boundingBox()).y);
      await page.keyboard.press("ArrowUp");
      await settle(page);
    }
    const lineHeight = await line.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
    for (let index = 1; index < yPositions.length; index++) {
      assert.ok(Math.abs(yPositions[index - 1] - yPositions[index] - lineHeight) <= 2, JSON.stringify({ yPositions, lineHeight }));
    }
    const beforeDown = (await page.locator(".cm-cursor").boundingBox()).y;
    await page.keyboard.press("ArrowDown");
    await settle(page);
    assert.ok(Math.abs((await page.locator(".cm-cursor").boundingBox()).y - beforeDown - lineHeight) <= 2);
    await page.locator(".cm-line").filter({ hasText: /^Last$/ }).click();
    await page.keyboard.press("Home");
    await page.keyboard.type("/");
    await page.locator(".ty-slash-item").first().waitFor();
    // The visible active item, rather than a debounce timer, is the contract.
    const activeText = () => page.locator(".ty-slash-item.is-selected").innerText();
    const first = await activeText();
    assert.equal(await page.locator(".ty-slash-item.is-selected").getAttribute("data-index"), "0");
    await page.keyboard.press("ArrowDown");
    const second = await activeText();
    assert.notEqual(first, second);
    assert.equal(await page.locator(".ty-slash-item.is-selected").getAttribute("data-index"), "1");
    await page.keyboard.press("ArrowUp");
    assert.equal(await activeText(), first);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    assert.equal(await sourceText(page), content);
  } finally { await page.close(); await browser.close(); }
});

test("CM6 consecutive empty rows move one source line in both directions without edits", async () => {
  const browser = await launchBrowser();
  const content = `# Heading\n\n${long}\n\n\nAfter`;
  const page = await boot(browser, content, "cm6");
  const position = () => page.locator(".cm-content").evaluate(content => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const line = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest(".cm-line");
    const lines = [...content.querySelectorAll(".cm-line")];
    return { index: lines.indexOf(line), text: line?.textContent };
  });
  try {
    const firstEmpty = await page.locator(".cm-line").evaluateAll(lines => {
      const paragraph = lines.findIndex(line => line.textContent.includes("abcdefghij"));
      return paragraph + 1;
    });
    await page.locator(".cm-line").nth(firstEmpty).evaluate(line => {
      document.querySelector(".cm-content").focus();
      const range = document.createRange();
      range.setStart(line, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await settle(page);
    const before = await position();
    assert.deepEqual(before, { index: firstEmpty, text: "" });
    await page.keyboard.press("ArrowDown");
    await settle(page);
    assert.deepEqual(await position(), { index: firstEmpty + 1, text: "" });
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.deepEqual(await position(), before);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.deepEqual(await position(), before, "rapid opposite keys must not leave a delayed caret move");
    assert.equal(await sourceText(page), content);
  } finally { await page.close(); await browser.close(); }
});
