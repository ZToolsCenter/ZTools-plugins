"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { intro, quickstart, settle } = require("./fixtures/cm6-rich-navigation.cjs");

const sourceDocument = `---\ntitle: CM6 line break probe\nauthor: E2E\n---\n\n${quickstart}`;
const reportedBaseSource = quickstart.replace("版。\n\n[TOC]", "版。\n\n\n[TOC]");
const reportedExactSource = reportedBaseSource.replace("出版级排版。", "出版级排\n版。");
const insertionOffset = intro.indexOf("排版。") + 1;
const left = intro.slice(0, insertionOffset);
const right = intro.slice(insertionOffset);

async function boot(browser, content = sourceDocument, theme = "github", width = 720, fontSize = 16) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content });
  await page.addInitScript(({ themeName, fontSize: preferenceFontSize }) => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = "cm6";
      state.preferences.theme = themeName;
      state.preferences.fontSize = preferenceFontSize;
      return state;
    };
  }, { themeName: theme, fontSize });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-content").waitFor();
  await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("cm-content"));
  return page;
}

async function placeCaretAtBreakPoint(page) {
  const result = await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().evaluate((line, offset) => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (consumed + node.textContent.length >= offset) {
        const range = document.createRange();
        range.setStart(node, offset - consumed);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return { lineText: line.textContent, offset };
      }
      consumed += node.textContent.length;
    }
    return { lineText: line.textContent, offset, unavailable: true };
  }, insertionOffset);
  assert.equal(result.lineText, intro, "the caret must target the complete raw welcome paragraph");
  assert.equal(result.unavailable, undefined, `expected a DOM text position at source offset ${insertionOffset}`);
  await settle(page);
}

async function placeCaretInExactLine(page, lineText, offset) {
  const result = await page.locator(".cm-line").evaluateAll((lines, position) => {
    const line = lines.find((candidate) => candidate.textContent === position.lineText);
    if (!line) return { found: false, lines: lines.map((candidate) => candidate.textContent) };
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (consumed + node.textContent.length >= position.offset) {
        const range = document.createRange();
        range.setStart(node, position.offset - consumed);
        range.collapse(true);
        document.querySelector(".cm-content")?.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return { found: true };
      }
      consumed += node.textContent.length;
    }
    return { found: false, lines: lines.map((candidate) => candidate.textContent) };
  }, { lineText, offset });
  assert.equal(result.found, true, `expected source row ${JSON.stringify(lineText)} at offset ${offset}: ${JSON.stringify(result.lines)}`);
  await settle(page);
}

async function placeCaretOnEmptyRowAfterTail(page, tailSeparated = false) {
  // The active editor keeps soft LFs folded into one paragraph. Locate its
  // following empty row from rendered geometry instead of source-line count.
  await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("cm-content"));
  await settle(page);
  const result = await page.locator(".cm-line").evaluateAll((lines, separated) => {
    const tailIndex = lines.findIndex((line) => separated
      ? line.textContent === "版。"
      : line.textContent.includes("Live Markdown") && line.textContent.includes("版。"));
    const blankIndex = tailIndex + 1;
    if (tailIndex < 0 || lines[blankIndex]?.textContent !== "") {
      return { tailIndex, blankIndex, lines: lines.map((line) => line.textContent) };
    }
    const range = document.createRange();
    range.selectNodeContents(lines[blankIndex]);
    range.collapse(true);
    document.querySelector(".cm-content")?.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { tailIndex, blankIndex, lines: lines.map((line) => line.textContent) };
  }, tailSeparated);
  assert.ok(result.tailIndex >= 0, `expected the folded Quickstart paragraph ending in '版。': ${JSON.stringify(result.lines)}`);
  assert.equal(result.blankIndex, result.tailIndex + 1, `the trailing caret row must directly follow the rendered paragraph: ${JSON.stringify(result)}`);
  assert.equal(result.lines[result.blankIndex], "", `the selected CM6 row must be truly empty: ${JSON.stringify(result.lines)}`);
  await settle(page);
  const before = await snapshot(page);
  assert.equal(before.anchorText, "");
  assert.equal(before.anchorOffset, 0, `the caret must remain at the start of the visible trailing blank after soft-break folding: ${JSON.stringify({ result, before })}`);
  return { ...result, sourceRows: result.lines, before };
}

async function insertEnterAtTokenPiece(page, piece, offset) {
  const lineText = await page.locator(".cm-line").evaluateAll((lines, token) => {
    return lines.find((line) => line.textContent.includes(token.piece))?.textContent ?? null;
  }, { piece });
  assert.ok(lineText, `expected a visible logical source line containing ${JSON.stringify(piece)}`);
  const pieceStart = lineText.indexOf(piece);
  await placeCaretInExactLine(page, lineText, pieceStart + offset);
  await page.keyboard.press("Enter");
  await settle(page);
}

async function verifyTailRowNavigation(page, tailSeparated = false) {
  const { tailIndex, sourceRows, before } = await placeCaretOnEmptyRowAfterTail(page, tailSeparated);
  if (tailSeparated) {
    assert.equal(sourceRows[tailIndex], "版。", `a blank source line must keep the final sentence in its own paragraph: ${JSON.stringify(sourceRows)}`);
  } else {
    assert.ok(sourceRows[tailIndex]?.includes("Live Markdown") && sourceRows[tailIndex]?.includes("版。"),
      `the active display must keep source soft LFs inside one paragraph: ${JSON.stringify(sourceRows.slice(Math.max(0, tailIndex - 2), tailIndex + 1))}`);
  }
  assert.equal(before.anchorText, "", `navigation must start in the blank after the complete paragraph: ${JSON.stringify(before)}`);

  await page.keyboard.press("ArrowUp");
  await settle(page);
  const up = await snapshot(page);
  if (tailSeparated) {
    assert.equal(up.anchorText, "版。", `the final short paragraph must remain distinct from the previous paragraph: ${JSON.stringify({ before, up })}`);
  } else {
    assert.ok(up.anchorText?.includes("Live Markdown") && up.anchorText?.includes("版。"),
      `Up must enter the merged paragraph's final visual row: ${JSON.stringify({ before, up })}`);
  }
  assert.ok(up.cursor && up.anchorRect && up.cursor.y >= up.anchorRect.y - 3 && up.cursor.y < up.anchorRect.y + up.anchorRect.height,
    `one Up must land within the active paragraph: ${JSON.stringify({ before, up })}`);
  if (!tailSeparated) {
    const lastVisibleRowTop = up.anchorRect.y + up.anchorRect.height - up.anchorRect.lineHeight;
    assert.ok(up.anchorRect.height > up.anchorRect.lineHeight * 1.5 && up.cursor.y >= lastVisibleRowTop - 3,
      `one Up from the following blank must land on the paragraph's final wrapped visual row: ${JSON.stringify({ before, up, lastVisibleRowTop })}`);
  }

  await page.keyboard.press("ArrowDown");
  await settle(page);
  const down = await snapshot(page);
  assert.equal(down.anchorText, "");
  assert.equal(down.anchorOffset, 0, `Down must return to the start of the same trailing blank row: ${JSON.stringify({ before, up, down })}`);
  assert.ok(down.previousText?.includes("版。") && (tailSeparated || down.previousText?.includes("Live Markdown")),
    `Down must return to the blank immediately after the correct paragraph: ${JSON.stringify(down)}`);

  await page.keyboard.press("ArrowUp");
  await settle(page);
  const repeatedUp = await snapshot(page);
  assert.ok(tailSeparated ? repeatedUp.anchorText === "版。" :
    repeatedUp.anchorText?.includes("Live Markdown") && repeatedUp.anchorText?.includes("版。"),
  `a repeated Up should re-enter the same final paragraph: ${JSON.stringify(repeatedUp)}`);

  await page.keyboard.press("ArrowUp");
  await settle(page);
  const priorUp = await snapshot(page);
  if (tailSeparated) {
    assert.equal(priorUp.anchorText, "", `the blank source paragraph must remain a distinct navigation stop: ${JSON.stringify({ repeatedUp, priorUp })}`);
    assert.equal(priorUp.nextText, "版。");
  } else {
    assert.ok(priorUp.anchorText?.includes("Live Markdown") && priorUp.anchorText?.includes("版。"),
      `a second Up must stay in the merged paragraph instead of treating source LFs as visual rows: ${JSON.stringify(priorUp)}`);
    assert.ok(priorUp.cursor && repeatedUp.cursor && priorUp.anchorRect?.lineHeight &&
      Math.abs((repeatedUp.cursor.y - priorUp.cursor.y) - priorUp.anchorRect.lineHeight) <= 4,
    `consecutive Up presses must visit adjacent visible rows: ${JSON.stringify({ repeatedUp, priorUp })}`);
  }
  return { before, up, down, repeatedUp, priorUp, sourceRows };
}

async function assertConfiguredBodyFontSize(page, expected) {
  const actual = await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().evaluate((line) =>
    parseFloat(getComputedStyle(line).fontSize));
  assert.equal(actual, expected,
    `CM6 body text must use the configured ${expected}px font, got ${actual}px`);
}

const softLfCases = [
  { name: "three consecutive soft LFs", ending: "出版\n级排\n版。", enterSplits: [["出版级排版。", 2], ["级排版。", 2]] },
  { name: "two consecutive soft LFs", ending: "出版级排\n版。", enterSplits: [["出版级排版。", 4]] },
  { name: "an empty source paragraph before the short tail", ending: "出版级排\n\n版。", tailSeparated: true, enterSplits: [["出版级排版。", 4], ["版。", 0]] },
  {
    name: "the exact restored Quickstart source with two blank rows before the TOC",
    ending: "出版级排\n版。",
    enterBaseContent: reportedBaseSource,
    exactContent: reportedExactSource,
    enterSplits: [["出版级排版。", 4]]
  },
  {
    name: "exact reported source at 720px with 14px preference",
    ending: "出版级排\n版。",
    enterBaseContent: reportedBaseSource,
    exactContent: reportedExactSource,
    width: 720,
    fontSize: 14,
    enterSplits: [["出版级排版。", 4]]
  },
  {
    name: "exact reported source at 1000px with 20px preference",
    ending: "出版级排\n版。",
    enterBaseContent: reportedBaseSource,
    exactContent: reportedExactSource,
    width: 1000,
    fontSize: 20,
    enterSplits: [["出版级排版。", 4]]
  }
];

for (const scenario of softLfCases) {
  test(`CM6 ArrowUp enters the final visible row after ${scenario.name}`, async () => {
    const browser = await launchBrowser();
    const content = scenario.exactContent ?? quickstart.replace("出版级排版。", scenario.ending);
    const page = await boot(browser, content, "night", scenario.width ?? 800, scenario.fontSize ?? 16);
    try {
      assert.notEqual(content, quickstart, "fixture must contain the requested soft-LF pattern");
      await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().waitFor();
      if (scenario.fontSize) await assertConfiguredBodyFontSize(page, scenario.fontSize);
      const trace = await verifyTailRowNavigation(page, scenario.tailSeparated);
      assert.equal(await fullSource(page), content, "ArrowUp/Down must preserve every exact soft LF, hard break, and blank source row");
    } finally {
      await page.close();
      await browser.close();
    }
  });
}

for (const scenario of softLfCases) {
  test(`actual Enter sequence preserves ${scenario.name} source while navigation follows visual rows`, async () => {
    const browser = await launchBrowser();
    const page = await boot(browser, scenario.enterBaseContent ?? quickstart, "night", scenario.width ?? 800, scenario.fontSize ?? 16);
    try {
      const originalLine = await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().textContent();
      assert.ok(originalLine.includes("出版级排版。"), "the native sample intro must contain the target ending");
      if (scenario.fontSize) await assertConfiguredBodyFontSize(page, scenario.fontSize);
      for (const [piece, offset] of scenario.enterSplits) await insertEnterAtTokenPiece(page, piece, offset);
      const expected = scenario.exactContent ?? quickstart.replace("出版级排版。", scenario.ending);
      assert.equal(await fullSource(page), expected, "native Enter events must produce exactly the requested source-line pattern");
      const trace = await verifyTailRowNavigation(page, scenario.tailSeparated);
      assert.equal(await fullSource(page), expected, "Enter sequence must produce only the intended newline pattern");
      assert.ok(scenario.tailSeparated ? trace.up.anchorText === "版。" :
        trace.up.anchorText?.includes("Live Markdown") && trace.up.anchorText?.includes("版。"),
      `the caret must enter the correct joined or hard-separated paragraph: ${JSON.stringify(trace.up)}`);
    } finally {
      await page.close();
      await browser.close();
    }
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const introLines = lines.filter((line) => line.textContent.includes("Live Markdown") || line.textContent.includes("出版级排版"));
    const selection = window.getSelection();
    const anchorLine = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest(".cm-line")
      : selection?.anchorNode?.parentElement?.closest(".cm-line");
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const anchorRect = anchorLine?.getBoundingClientRect();
    return {
      introLines: introLines.map((line) => ({
        text: line.textContent,
        rendered: line.innerText,
        rect: (() => { const r = line.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        lineHeight: parseFloat(getComputedStyle(line).lineHeight)
      })),
      anchorText: anchorLine?.textContent ?? null,
      anchorIndex: anchorLine ? lines.indexOf(anchorLine) : -1,
      anchorRect: anchorRect && {
        x: anchorRect.x,
        y: anchorRect.y,
        width: anchorRect.width,
        height: anchorRect.height,
        lineHeight: parseFloat(getComputedStyle(anchorLine).lineHeight),
        fontSize: parseFloat(getComputedStyle(anchorLine).fontSize)
      },
      anchorOffset: selection?.anchorOffset,
      cursor: cursor && { x: cursor.x, y: cursor.y, height: cursor.height },
      previousText: anchorLine?.previousElementSibling?.textContent ?? null,
      nextText: anchorLine?.nextElementSibling?.textContent ?? null,
      logicalLines: lines.map((line) => line.textContent)
    };
  });
}

async function fullSource(page) {
  const mode = page.getByTestId("top-viewmode-cycle-btn");
  let title = await mode.getAttribute("title");
  if (title?.includes("阅读模式")) {
    await mode.click();
    await settle(page);
    title = await mode.getAttribute("title");
  }
  assert.ok(title?.includes("实时预览") || title?.includes("源代码"), `unexpected editor mode before source read: ${title}`);
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

for (const key of ["Enter", "Shift+Enter"]) {
  test(`CM6 ${key} at the Chinese paragraph ending preserves source and maps the next ArrowUp`, async () => {
    const browser = await launchBrowser();
    const page = await boot(browser);
    try {
      await placeCaretAtBreakPoint(page);
      const before = await snapshot(page);
      assert.equal(before.anchorText, intro);

      await page.keyboard.press(key);
      await settle(page);
      const afterBreak = await snapshot(page);
      const expected = sourceDocument.replace(intro, `${left}\n${right}`);
      assert.ok(afterBreak.anchorText?.includes(left) && afterBreak.anchorText?.includes(right),
        `${key} must keep its inserted soft LF within one active paragraph: ${JSON.stringify({ before, afterBreak, left, right })}`);

      const beforeUp = await snapshot(page);
      await page.keyboard.press("ArrowUp");
      await settle(page);
      const afterUp = await snapshot(page);
      assert.ok(beforeUp.anchorText?.includes(left) && beforeUp.anchorText?.includes(right));
      assert.ok(afterUp.anchorText?.includes(left) && afterUp.anchorText?.includes(right),
        `${key} followed by one ArrowUp must stay in the folded Markdown paragraph: ${JSON.stringify({ before, afterBreak, beforeUp, afterUp })}`);
      assert.ok(beforeUp.cursor && afterUp.cursor && afterUp.cursor.y < beforeUp.cursor.y - 8,
        `${key} followed by one ArrowUp must move to a previous visible row: ${JSON.stringify({ before, afterBreak, beforeUp, afterUp })}`);
      const sourceAfterUp = await fullSource(page);
      assert.equal(sourceAfterUp, expected,
        `${key} should insert exactly one newline, preserve all surrounding Markdown, and ArrowUp must not edit source`);
    } finally {
      await page.close();
      await browser.close();
    }
  });
}
