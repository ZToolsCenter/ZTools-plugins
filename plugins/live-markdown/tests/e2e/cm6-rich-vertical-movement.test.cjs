"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { intro, quickstart, settle } = require("./fixtures/cm6-rich-navigation.cjs");
const { setPublicSourceCaret } = require("./fixtures/cm6-public-source-caret.cjs");

async function openQuickstart(content = quickstart) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content });
  await page.addInitScript(({ theme, fontSize }) => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = "cm6";
      state.preferences.theme = theme;
      state.preferences.fontSize = fontSize;
      return state;
    };
  }, { theme: "night", fontSize: 16 });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-content").waitFor();
  await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().waitFor();
  return { browser, page };
}

async function placeCaretInBlankBeforeIntro(page) {
  const before = await page.locator(".cm-line").evaluateAll((lines) => {
    const introIndex = lines.findIndex((line) => line.textContent.includes("无缝所见即所得体验"));
    const blankIndex = introIndex - 1;
    const blank = lines[blankIndex];
    if (introIndex < 1 || blank?.textContent.trim() !== "") {
      return { introIndex, blankIndex, lines: lines.map((line) => line.textContent) };
    }
    const range = document.createRange();
    range.selectNodeContents(blank);
    range.collapse(true);
    document.querySelector(".cm-content")?.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { introIndex, blankIndex, lines: lines.map((line) => line.textContent) };
  });
  assert.ok(before.introIndex > 0, `expected the complete Chinese intro: ${JSON.stringify(before)}`);
  assert.equal(before.blankIndex, before.introIndex - 1);
  assert.equal(before.lines[before.blankIndex].trim(), "", "the caret must start in the immediately preceding blank source line");
  await settle(page);
  const snapshot = await measureCaret(page);
  assert.equal(snapshot.anchorIndex, before.blankIndex, `the collapsed Range must stay on the preceding blank line: ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.anchorText.trim(), "");
  return before;
}

async function measureCaret(page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const selection = window.getSelection();
    const anchorLine = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest(".cm-line")
      : selection?.anchorNode?.parentElement?.closest(".cm-line");
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const lineRect = anchorLine?.getBoundingClientRect();
    return {
      anchorText: anchorLine?.textContent ?? null,
      anchorIndex: anchorLine ? lines.indexOf(anchorLine) : -1,
      anchorOffset: selection?.anchorOffset,
      cursor: cursor && { x: cursor.x, y: cursor.y, height: cursor.height },
      line: lineRect && {
        x: lineRect.x,
        y: lineRect.y,
        width: lineRect.width,
        height: lineRect.height,
        lineHeight: parseFloat(getComputedStyle(anchorLine).lineHeight)
      }
    };
  });
}

async function placeCaretAtLineOffset(page, lineText, offset) {
  const result = await setPublicSourceCaret(page, lineText, offset, { exactLine: true });
  await settle(page);
  return result;
}

async function readSourceWithoutEditing(page) {
  const mode = page.getByTestId("top-viewmode-cycle-btn");
  let title = await mode.getAttribute("title");
  if (title?.includes("阅读模式")) {
    await mode.click();
    await settle(page);
    title = await mode.getAttribute("title");
  }
  assert.ok(title?.includes("实时预览") || title?.includes("源代码"), `unexpected editor mode: ${title}`);
  if (title.includes("实时预览")) await mode.click();
  await settle(page);
  const source = page.locator("textarea.ty-source-textarea");
  await source.waitFor();
  const value = await source.inputValue();
  await mode.click();
  await settle(page);
  await mode.click();
  await page.locator(".cm-content").waitFor();
  return value;
}

function assertCaretOnVisualRow(snapshot, rowIndex, message) {
  assert.ok(snapshot.cursor && snapshot.line, `${message}: missing caret geometry ${JSON.stringify(snapshot)}`);
  const top = snapshot.line.y + rowIndex * snapshot.line.lineHeight;
  assert.ok(snapshot.cursor.y >= top - 3 && snapshot.cursor.y < top + snapshot.line.lineHeight + 3,
    `${message}: expected row ${rowIndex} starting near y=${top}, got ${JSON.stringify(snapshot)}`);
}

test("CM6 ArrowDown enters the first rich-text visual row and advances one visual row at a time", async () => {
  const { browser, page } = await openQuickstart();
  try {
    await placeCaretInBlankBeforeIntro(page);

    await page.keyboard.press("ArrowDown");
    await settle(page);
    const firstRow = await measureCaret(page);
    assert.equal(firstRow.anchorText, intro, "Down should reveal and enter the complete intro source line");
    assertCaretOnVisualRow(firstRow, 0, "first Down must land on the intro's first visible row after reflow");
    assert.ok(firstRow.line.height > firstRow.line.lineHeight * 1.5,
      `the intro must wrap to several visual rows: ${JSON.stringify(firstRow)}`);

    await page.keyboard.press("ArrowDown");
    await settle(page);
    const secondRow = await measureCaret(page);
    assert.equal(secondRow.anchorText, intro, "second Down must remain within the same logical Markdown paragraph");
    const delta = secondRow.cursor.y - firstRow.cursor.y;
    assert.ok(Math.abs(delta - firstRow.line.lineHeight) <= 4,
      `second Down must advance exactly one rendered line (${firstRow.line.lineHeight}px), got ${delta}px: ${JSON.stringify({ firstRow, secondRow })}`);
    assertCaretOnVisualRow(secondRow, 1, "second Down must land on the next visible row");

    await page.keyboard.press("ArrowUp");
    await settle(page);
    const returned = await measureCaret(page);
    assert.equal(returned.anchorText, intro);
    assertCaretOnVisualRow(returned, 0, "one Up must return to the first visible row");
    assert.equal(await readSourceWithoutEditing(page), quickstart,
      "Down/Up movement and live source reveal must preserve the complete Markdown document");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 ArrowUp from the joined source tail moves one visual row and ArrowDown restores its goal column", async () => {
  const content = quickstart.replace("出版级排版。", "出版级排\n版。");
  const { browser, page } = await openQuickstart(content);
  try {
    // Preview may visually merge soft source LFs, so reveal the paragraph before locating its exact raw tail row.
    await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().click();
    await page.waitForFunction(() => document.activeElement?.classList.contains("cm-content"));
    await settle(page);
    const sourceCaret = await placeCaretAtLineOffset(page, "版。", 1);
    const tailStart = await measureCaret(page);
    assert.equal(sourceCaret.position, content.indexOf("版。") + 1, "the controlled start must remain at source column one of the final raw line");
    assert.ok(tailStart.anchorText?.includes("Live Markdown") && tailStart.anchorText?.includes("版。"),
      `the active DOM should expose the complete soft-LF-joined paragraph: ${JSON.stringify(tailStart)}`);

    await page.keyboard.press("ArrowUp");
    await settle(page);
    const previousRow = await measureCaret(page);
    assert.equal(previousRow.anchorText, tailStart.anchorText,
      `Up must stay in the same joined paragraph: ${JSON.stringify({ tailStart, previousRow })}`);
    assert.ok(previousRow.line.height > previousRow.line.lineHeight * 1.5,
      `the joined paragraph must occupy multiple visible rows: ${JSON.stringify(previousRow)}`);
    assert.ok(Math.abs((tailStart.cursor.y - previousRow.cursor.y) - previousRow.line.lineHeight) <= 4,
      `Up must move exactly one visible row from the joined tail: ${JSON.stringify({ tailStart, previousRow })}`);

    await page.keyboard.press("ArrowDown");
    await settle(page);
    const returned = await measureCaret(page);
    assert.equal(returned.anchorText, tailStart.anchorText, `Down should return within the joined paragraph: ${JSON.stringify(returned)}`);
    assert.ok(Math.abs(returned.cursor.y - tailStart.cursor.y) <= 3,
      `Down should restore the starting visual row: ${JSON.stringify({ tailStart, returned })}`);
    assert.ok(Math.abs(returned.cursor.x - tailStart.cursor.x) <= 3,
      `Down should preserve the original horizontal column: ${JSON.stringify({ tailStart, returned })}`);
    assert.equal(await readSourceWithoutEditing(page), content,
      "vertical navigation through the hard line must preserve every source character");
  } finally {
    await page.close();
    await browser.close();
  }
});
