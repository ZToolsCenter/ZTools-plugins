"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { characterRect } = require("./fixtures/cm6-paragraph-flow.cjs");
const { setPublicSourceCaret } = require("./fixtures/cm6-public-source-caret.cjs");
const { quickstart, settle } = require("./fixtures/cm6-rich-navigation.cjs");

const cjkStart = "宽屏软换行验证段落：末尾源码必须保留出版级排";
const cjkSource = `${cjkStart}\n版。`;
const semanticSource = [
  "# Paragraph flow fixture",
  "",
  "左侧中文行末\n右侧中文行首",
  "",
  cjkSource,
  "",
  "中文强调前\n**后文强调**",
  "**before `a  b` after**",
  "",
  "Latin soft break alpha\nbeta stays separated",
  "",
  "two-space hard break  \nnext row after two spaces",
  "backslash hard break\\\nnext row after backslash",
  "",
  "paragraph before blank\ncontinued in same paragraph",
  "",
  "paragraph after blank",
  "",
  "> quote first row\n> quote second row",
  "",
  "prose before TOC\n[TOC]\nprose after TOC",
  "",
  "prose before math  \n$$\nx + y = z\n$$\nprose after math",
  "",
  "",
  "- first list item",
  "- second list item",
  "",
  "```ts",
  "const flowProbe = 1;",
  "```",
  "",
  "$$",
  "x^2 + y^2 = z^2",
  "$$",
  "",
  "## Fixture section",
  "",
  "[TOC]"
].join("\n");

const navigationSource = [
  "# Paragraph navigation",
  "",
  "",
  `${cjkStart}\n版。`,
  "",
  "",
  "## Following section"
].join("\n");

function exactQuickstartWithSoftTail() {
  return quickstart.replace("出版级排版。", "出版级排\n版。");
}

async function openCm6(content, { width = 1600, height = 1000, dpr = 1, theme = "night", fontSize = 16, lineWidth = "full" } = {}) {
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: dpr
  });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content });
  await page.addInitScript(({ themeName, fontSize: preferredSize, lineWidth: preferredLineWidth }) => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = "cm6";
      state.preferences.theme = themeName;
      state.preferences.fontSize = preferredSize;
      state.preferences.lineWidth = preferredLineWidth;
      return state;
    };
  }, { themeName: theme, fontSize, lineWidth });
  await page.goto(process.env.READING_IMAGES_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-content").waitFor();
  await page.locator("#write .cm-line").first().waitFor();
  await settle(page);
  return { browser, page };
}

async function setView(page, target) {
  const button = page.getByTestId("top-viewmode-cycle-btn");
  const targetText = target === "reading" ? "当前: 阅读模式" : "当前: 实时预览";
  for (let attempt = 0; attempt < 4; attempt++) {
    const title = await button.getAttribute("title");
    if (title?.includes(targetText)) return;
    await button.click();
    await settle(page);
  }
  throw new Error(`Could not reach ${target} mode: ${await button.getAttribute("title")}`);
}

async function currentSource(page) {
  const button = page.getByTestId("top-viewmode-cycle-btn");
  for (let attempt = 0; attempt < 4; attempt++) {
    const title = await button.getAttribute("title");
    if (title?.includes("当前: 源代码")) break;
    await button.click();
    await settle(page);
  }
  const source = page.locator("textarea.ty-source-textarea");
  await source.waitFor();
  const text = await source.inputValue();
  for (let attempt = 0; attempt < 4; attempt++) {
    const title = await button.getAttribute("title");
    if (title?.includes("当前: 实时预览")) break;
    await button.click();
    await settle(page);
  }
  await page.locator("#write .cm-content").waitFor();
  return text;
}

async function focusToken(page, token) {
  const line = page.locator(".cm-line").filter({ hasText: token }).first();
  await line.click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("cm-content"));
  await settle(page);
}

async function setCaretAtTokenOffset(page, token, offset) {
  await setPublicSourceCaret(page, token, offset);
  await settle(page);
}

async function setCaretOnBlankLine(page, position) {
  const result = await page.locator(".cm-line").evaluateAll((lines, where) => {
    const targetText = where === "before" ? "宽屏软换行验证段落" : "版。";
    const targetIndex = lines.findIndex((line) => line.textContent.includes(targetText));
    const index = where === "before" ? targetIndex - 1 : targetIndex + 1;
    if (targetIndex < 0 || lines[index]?.textContent.trim() !== "") {
      return { targetIndex, index, lines: lines.map((line) => line.textContent) };
    }
    const range = document.createRange();
    range.selectNodeContents(lines[index]);
    range.collapse(true);
    document.querySelector(".cm-content")?.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { targetIndex, index, lines: lines.map((line) => line.textContent) };
  }, position);
  assert.ok(result.targetIndex >= 0, `expected target source text: ${JSON.stringify(result)}`);
  assert.equal(result.lines[result.index]?.trim(), "", `expected adjacent empty source row: ${JSON.stringify(result)}`);
  await settle(page);
  return result;
}

async function caretSnapshot(page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const selection = window.getSelection();
    const anchorLine = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest(".cm-line")
      : selection?.anchorNode?.parentElement?.closest(".cm-line");
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const rect = anchorLine?.getBoundingClientRect();
    return {
      sourceLine: anchorLine?.textContent ?? null,
      anchorIndex: anchorLine ? lines.indexOf(anchorLine) : -1,
      previousLine: anchorLine ? lines[lines.indexOf(anchorLine) - 1]?.textContent ?? null : null,
      nextLine: anchorLine ? lines[lines.indexOf(anchorLine) + 1]?.textContent ?? null : null,
      cursor: cursor && { x: cursor.x, y: cursor.y, height: cursor.height },
      line: rect && { x: rect.x, y: rect.y, height: rect.height, lineHeight: parseFloat(getComputedStyle(anchorLine).lineHeight) },
      selection: selection && { rangeCount: selection.rangeCount, collapsed: selection.isCollapsed }
    };
  });
}

test("CM6 soft line breaks join visually, preserve word boundaries, and keep hard breaks and block semantics", async () => {
  const { browser, page } = await openCm6(semanticSource, { width: 1600 });
  try {
    const left = await characterRect(page, "末");
    const right = await characterRect(page, "右");
    assert.ok(left && right, "the CJK soft-break tokens must render");
    assert.ok(Math.abs(left.y - right.y) < 2,
      `a CJK soft break should continue on the same visual row when space is available: ${JSON.stringify({ left, right })}`);
    const tailBefore = await characterRect(page, "排", "#write .cm-content", "last", cjkStart);
    const tailAfter = await characterRect(page, "版。");
    assert.ok(tailBefore && tailAfter && Math.abs(tailBefore.y - tailAfter.y) < 2,
      `at a wide viewport the source tail '排\\n版。' must display on one visual row: ${JSON.stringify({ tailBefore, tailAfter })}`);

    const alpha = await characterRect(page, "alpha");
    const beta = await characterRect(page, "beta");
    assert.ok(alpha && beta, "Latin soft-break words must render");
    assert.ok(Math.abs(alpha.y - beta.y) < 2 && beta.x > alpha.right + 2,
      `a Latin soft break must display a separating space without a line break: ${JSON.stringify({ alpha, beta })}`);
    const beforeBold = await characterRect(page, "前");
    const afterBold = await characterRect(page, "后文强调");
    assert.ok(beforeBold && afterBold && Math.abs(beforeBold.y - afterBold.y) < 2,
      `a CJK soft break adjacent to emphasis must remain in the same paragraph flow: ${JSON.stringify({ beforeBold, afterBold })}`);

    const twoSpaceTail = await characterRect(page, "two-space hard break");
    const twoSpaceNext = await characterRect(page, "next row after two spaces");
    assert.ok(twoSpaceTail && twoSpaceNext && twoSpaceNext.y > twoSpaceTail.y + 4,
      `two trailing spaces must retain an explicit hard break: ${JSON.stringify({ twoSpaceTail, twoSpaceNext })}`);
    const slashTail = await characterRect(page, "backslash hard break");
    const slashNext = await characterRect(page, "next row after backslash");
    assert.ok(slashTail && slashNext && slashNext.y > slashTail.y + 4,
      `a backslash hard break must remain a line break: ${JSON.stringify({ slashTail, slashNext })}`);

    const inlineWhitespace = page.locator(".cm-inline-code-whitespace").filter({ hasText: "  " }).first();
    await inlineWhitespace.waitFor();
    const inlineSpacing = await inlineWhitespace.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) context.font = style.font;
      const twoSpacesWidth = context?.measureText("a  b").width ?? 0;
      const oneSpaceWidth = context?.measureText("a b").width ?? 0;
      return {
        text: element.textContent,
        width: box.width,
        twoSpacesWidth,
        oneSpaceWidth,
        whiteSpace: style.whiteSpace,
        font: style.font
      };
    });
    assert.ok(inlineSpacing.text.includes("a  b") && inlineSpacing.whiteSpace === "break-spaces" &&
      inlineSpacing.twoSpacesWidth > inlineSpacing.oneSpaceWidth && inlineSpacing.width >= inlineSpacing.twoSpacesWidth - 3,
      `the two inline-code spaces must remain visibly preserved using their inherited font metrics: ${JSON.stringify(inlineSpacing)}`);

    await page.locator(".cm-scroller").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.locator(".ty-codeblock-lang").waitFor();
    await settle(page);
    assert.ok(await page.locator(".cm-codeblock-line").filter({ hasText: "const flowProbe" }).count(), "fenced code should remain rendered as code");
    assert.ok(await page.locator(".cm-blockquote-line").filter({ hasText: "quote first row" }).count(), "blockquote lines should retain quote styling");
    assert.ok(await page.locator(".ty-cm6-math-widget").count(), "block math should remain a math widget");
    assert.ok(await page.locator(".ty-cm6-toc-widget").count(), "the TOC should remain a widget");
    assert.ok(await page.locator("#write").getByText("first list item", { exact: false }).count(), "list content should remain visible");
    await page.locator(".cm-line").filter({ hasText: "prose before TOC" }).first().scrollIntoViewIfNeeded();
    await settle(page);
    const tocBefore = await characterRect(page, "prose before TOC");
    const tocAfter = await characterRect(page, "prose after TOC");
    assert.ok(tocBefore && tocAfter && tocAfter.y > tocBefore.y + 4,
      `a TOC widget between soft source lines must remain a separate rendered block: ${JSON.stringify({ tocBefore, tocAfter })}`);
    const tocWidgetBox = await page.locator(".ty-cm6-toc-widget").first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    assert.ok(tocWidgetBox.top > tocBefore.y && tocWidgetBox.bottom < tocAfter.y,
      `the TOC widget itself must occupy the visual gap between its neighboring prose: ${JSON.stringify({ tocBefore, tocWidgetBox, tocAfter })}`);
    await page.locator(".cm-line").filter({ hasText: "prose before math" }).first().scrollIntoViewIfNeeded();
    await settle(page);
    const mathBefore = await characterRect(page, "prose before math");
    const mathAfter = await characterRect(page, "prose after math");
    assert.ok(mathBefore && mathAfter && mathAfter.y > mathBefore.y + 4,
      `a math widget between soft source lines must remain a separate rendered block: ${JSON.stringify({ mathBefore, mathAfter })}`);
    const mathWidgetBox = await page.locator(".ty-cm6-math-widget").first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    assert.ok(mathWidgetBox.top > mathBefore.y && mathWidgetBox.bottom < mathAfter.y,
      `the math widget itself must occupy the visual gap between its neighboring prose: ${JSON.stringify({ mathBefore, mathWidgetBox, mathAfter })}`);

    const paragraphA = await characterRect(page, "continued in same paragraph");
    const paragraphB = await characterRect(page, "paragraph after blank");
    assert.ok(paragraphA && paragraphB && paragraphB.y > paragraphA.y + 22,
      `an empty source line must still separate paragraphs: ${JSON.stringify({ paragraphA, paragraphB })}`);
    assert.equal(await currentSource(page), semanticSource, "preview normalization must preserve every original Markdown newline");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 merges the exact Quickstart soft break in preview and reading at 800 CSS px", async () => {
  const { browser, page } = await openCm6(exactQuickstartWithSoftTail(), { width: 800, height: 820, dpr: 2 });
  try {
    const paragraph = page.locator(".cm-paragraph-preview").filter({ hasText: "无缝所见即所得体验" }).first();
    await paragraph.waitFor();
    await page.addStyleTag({ content: "#write .cm-paragraph-preview { max-width: 426px !important; }" });
    const layout = await paragraph.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: rect.width, whiteSpace: style.whiteSpace, userModify: style.webkitUserModify };
    });
    assert.equal(layout.whiteSpace, "normal", `unfocused preview must allow ordinary wrapping: ${JSON.stringify(layout)}`);
    assert.equal(layout.userModify, "read-write", `only editable preview paragraphs should receive the preview whitespace override: ${JSON.stringify(layout)}`);
    assert.ok(layout.width <= 426.5, `the text column should be constrained to the measured 426px host width: ${JSON.stringify(layout)}`);
    const previewText = await page.locator("#write").innerText();
    assert.match(previewText, /优美出版级排版。/,
      "the preview text should present the CJK soft break as continuous paragraph text");
    const joinedTail = page.locator(".cm-softbreak-join").filter({ hasText: "排版" }).last();
    assert.equal(await joinedTail.textContent(), "排版", "the two CJK glyphs adjacent to the preserved LF must share the nowrap join wrapper");
    const finalLayout = await paragraph.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(element).whiteSpace
    }));
    assert.ok(finalLayout.width <= 426.5, `the paragraph must remain at host width after CM6 redraw: ${JSON.stringify(finalLayout)}`);
    assert.equal(finalLayout.whiteSpace, "normal");
    const visibleTailBefore = await characterRect(page, "排", "#write .cm-content", "last", "优美出版级排");
    const visibleTailAfter = await characterRect(page, "版。");
    assert.ok(visibleTailBefore && visibleTailAfter && Math.abs(visibleTailBefore.y - visibleTailAfter.y) < 2,
      `the 800 CSS px preview should reflow the source tail '排\\n版。' onto one visual row: ${JSON.stringify({ visibleTailBefore, visibleTailAfter })}`);
    const screenshotDir = path.join(pluginRoot, ".cache/acceptance/paragraph-flow");
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "quickstart-softbreak-preview-800css-dpr2.png"), fullPage: true });

    await setView(page, "reading");
    const readingText = await page.locator("#write").innerText();
    assert.match(readingText, /优美出版级排版。/,
      "reading mode should join the same CJK soft break as preview mode");
    const readingState = await page.locator("#write").evaluate((element) => ({
      editable: element.isContentEditable,
      userModify: getComputedStyle(element).webkitUserModify
    }));
    assert.equal(await page.locator('#write textarea, #write [contenteditable="true"]').count(), 0, "reading must not expose an editable control");
    assert.equal(readingState.editable, false, `reading mode must remain non-editable: ${JSON.stringify(readingState)}`);
    assert.notEqual(readingState.userModify, "read-write", `the preview override must not leak into reading mode: ${JSON.stringify(readingState)}`);
    const readingPreview = page.locator("#write .ty-paragraph-block").filter({ hasText: "无缝所见即所得体验" }).first();
    assert.equal(await readingPreview.count(), 1, "reading must render the same paragraph in the readonly renderer");
    {
      const readingParagraphState = await readingPreview.evaluate((element) => ({
        editable: element.isContentEditable,
        userModify: getComputedStyle(element).webkitUserModify
      }));
      assert.equal(readingParagraphState.editable, false, `the same paragraph must not become editable in reading mode: ${JSON.stringify(readingParagraphState)}`);
      assert.notEqual(readingParagraphState.userModify, "read-write", `reading mode must not receive the preview-only user-modify value: ${JSON.stringify(readingParagraphState)}`);
    }
    assert.equal(await currentSource(page), exactQuickstartWithSoftTail(),
      "reading and preview must keep the raw LF available unchanged in source mode");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 focusing keeps soft breaks joined; Enter adds one LF and Undo restores exact source", async () => {
  const original = `# Edit flow\n\n${cjkSource}\n\n[TOC]`;
  const { browser, page } = await openCm6(original);
  try {
    const previewStyle = await page.locator(".cm-paragraph-preview").filter({ hasText: cjkStart }).first().evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      userModify: getComputedStyle(element).webkitUserModify
    }));
    assert.equal(previewStyle.whiteSpace, "normal");
    assert.equal(previewStyle.userModify, "read-write");
    await focusToken(page, "宽屏软换行验证段落");
    const focusedFirstLine = page.locator(".cm-line").filter({ hasText: cjkStart }).first();
    const focusedDecorations = await focusedFirstLine.evaluate((element) => ({
      preview: element.classList.contains("cm-paragraph-preview"),
      joined: [...element.querySelectorAll(".cm-softbreak-join")].some((join) => join.textContent === "排版"),
      text: element.textContent
    }));
    assert.equal(focusedDecorations.preview, false, "focus must leave the preview-only layout class inactive");
    assert.equal(focusedDecorations.joined, true, "the outer CJK no-wrap join must remain active while editing");
    assert.ok(focusedDecorations.text.includes("版。"), "the active rendered paragraph must keep its joined tail available");
    const activeTailA = await characterRect(page, "排", "#write .cm-content", "last", cjkStart);
    const activeTailB = await characterRect(page, "版。", "#write .cm-content", "last", "版。");
    assert.ok(activeTailA && activeTailB && Math.abs(activeTailA.y - activeTailB.y) < 2,
      `soft LF must remain folded while editing: ${JSON.stringify({ focusedDecorations, activeTailA, activeTailB })}`);
    assert.notEqual(await focusedFirstLine.evaluate((element) => getComputedStyle(element).whiteSpace), "normal",
      "editing must restore the source line-break whitespace mode");
    assert.equal(await focusedFirstLine.evaluate((element) => getComputedStyle(element).webkitUserModify), "read-write-plaintext-only",
      "editing must restore the original plaintext-only user-modify behavior");
    assert.equal(await currentSource(page), original, "entering edit mode must not rewrite the source LF");

    await focusToken(page, "宽屏软换行验证段落");
    const position = cjkStart.indexOf("出版级排") + "出版级排".length;
    await setCaretAtTokenOffset(page, "宽屏软换行验证段落：末尾源码必须保留出版级排", position);
    await page.keyboard.press("Enter");
    await settle(page);
    const afterEnter = original.replace(cjkSource, `${cjkStart}\n\n版。`);
    assert.equal(await currentSource(page), afterEnter, "one Enter must insert exactly one LF without changing adjacent Markdown");

    await focusToken(page, "宽屏软换行验证段落");
    await page.keyboard.press("Meta+z");
    await settle(page);
    assert.equal(await currentSource(page), original, "one Undo must restore the exact original source including its soft LF");

    await focusToken(page, "宽屏软换行验证段落");
    const tailA = await characterRect(page, "排", "#write .cm-content", "last", cjkStart);
    const tailB = await characterRect(page, "版。", "#write .cm-content", "last", "版。");
    assert.ok(tailA && tailB && Math.abs(tailA.y - tailB.y) < 2,
      `after Undo the original source LF must still display as one soft-break paragraph: ${JSON.stringify({ tailA, tailB })}`);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 ArrowDown from the preceding blank enters the merged paragraph's first visual row and Up returns", async () => {
  const { browser, page } = await openCm6(navigationSource);
  try {
    const before = await setCaretOnBlankLine(page, "before");
    const beforeCaret = await caretSnapshot(page);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    const entered = await caretSnapshot(page);
    assert.ok(entered.sourceLine?.includes(cjkStart) && entered.sourceLine?.includes("版。"),
      `Down must enter the complete soft-break-merged paragraph: ${JSON.stringify({ before, entered })}`);
    assert.ok(entered.selection?.collapsed && entered.selection.rangeCount === 1,
      `navigation must leave one collapsed selection: ${JSON.stringify(entered)}`);
    assert.ok(entered.cursor && beforeCaret.cursor && entered.cursor.y > beforeCaret.cursor.y,
      `the caret should move down into the paragraph: ${JSON.stringify({ beforeCaret, entered })}`);
    const firstRawChar = await characterRect(page, "宽");
    assert.ok(firstRawChar && Math.abs(entered.cursor.x - firstRawChar.x) <= 3,
      `Down should preserve the blank row's first-column goal: ${JSON.stringify({ entered, firstRawChar })}`);

    await page.keyboard.press("ArrowUp");
    await settle(page);
    const returned = await caretSnapshot(page);
    assert.equal(returned.sourceLine?.trim(), "", `one Up should return to the preceding blank row: ${JSON.stringify(returned)}`);
    assert.ok(returned.nextLine?.includes(cjkStart),
      `Up must return to the blank immediately before the merged paragraph: ${JSON.stringify(returned)}`);
    assert.equal(await currentSource(page), navigationSource);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 ArrowUp from the following blank enters the merged paragraph's last visual row and Down returns", async () => {
  const { browser, page } = await openCm6(navigationSource);
  try {
    const before = await setCaretOnBlankLine(page, "after");
    const beforeCaret = await caretSnapshot(page);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    const entered = await caretSnapshot(page);
    assert.ok(entered.sourceLine?.includes(cjkStart) && entered.sourceLine?.includes("版。"),
      `Up must enter the final visual row of the soft-break-merged paragraph: ${JSON.stringify({ before, entered })}`);
    assert.ok(entered.selection?.collapsed && entered.selection.rangeCount === 1,
      `navigation must leave one collapsed selection: ${JSON.stringify(entered)}`);
    const expandedRows = await page.locator(".cm-line").evaluateAll((lines, text) => {
      const tailIndex = lines.findIndex((line) => line.textContent.includes(text) && line.textContent.includes("版。"));
      const tail = lines[tailIndex];
      const followingBlank = lines.slice(tailIndex + 1).find((line) => line.textContent.trim() === "");
      const rect = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { y: box.y, height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) };
      };
      return { tailIndex, text: tail?.textContent, tail: rect(tail), followingBlank: rect(followingBlank) };
    }, cjkStart);
    assert.ok(expandedRows.tail && expandedRows.followingBlank &&
      expandedRows.followingBlank.y >= expandedRows.tail.y + expandedRows.tail.height - 2 &&
      expandedRows.followingBlank.y - expandedRows.tail.y <= expandedRows.tail.height + 3,
      `the joined paragraph and following blank must occupy adjacent visual rows: ${JSON.stringify({ beforeCaret, entered, expandedRows })}`);
    const firstVisibleChar = await characterRect(page, "宽", "#write .cm-content", "last", cjkStart);
    assert.ok(firstVisibleChar && Math.abs(entered.cursor.x - firstVisibleChar.x) <= 3,
      `Up should preserve the blank row's first-column goal in the folded paragraph: ${JSON.stringify({ entered, firstVisibleChar })}`);

    await page.keyboard.press("ArrowDown");
    await settle(page);
    const returned = await caretSnapshot(page);
    assert.equal(returned.sourceLine?.trim(), "", `one Down should return to the following blank row: ${JSON.stringify(returned)}`);
    assert.ok(returned.previousLine?.includes(cjkStart) && returned.previousLine?.includes("版。"),
      `Down must return to the blank immediately after the merged paragraph: ${JSON.stringify(returned)}`);
    assert.equal(await currentSource(page), navigationSource);
  } finally {
    await page.close();
    await browser.close();
  }
});
