"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { quickstart, settle } = require("./fixtures/cm6-rich-navigation.cjs");
const { characterRect } = require("./fixtures/cm6-paragraph-flow.cjs");
const { setPublicSourceCaret } = require("./fixtures/cm6-public-source-caret.cjs");

const softBreakSource = quickstart.replace("出版级排版。", "出版级排\n版。");
const hardBreakText = "主动编辑硬换行  \n下一行仍须断开";
const content = `${softBreakSource}\n\n${hardBreakText}`;

async function openEditor(browser, source, width = 800) {
  const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content: source });
  await page.addInitScript(() => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      Object.assign(state.preferences, { editorEngine: "cm6", theme: "night", lineWidth: "full", fontSize: 16 });
      return state;
    };
  });
  await page.goto(process.env.READING_IMAGES_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator("#write .cm-content").waitFor();
  await page.addStyleTag({ content: "#write .cm-editor .cm-line { max-width: 426px !important; }" });
  await settle(page);
  return page;
}

async function setCaret(page, phrase, offset) {
  await setPublicSourceCaret(page, phrase, offset);
  await settle(page);
}

async function readSource(page) {
  const mode = page.getByTestId("top-viewmode-cycle-btn");
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await mode.getAttribute("title"))?.includes("当前: 源代码")) break;
    await mode.click();
    await settle(page);
  }
  const textarea = page.locator("textarea.ty-source-textarea");
  await textarea.waitFor();
  const source = await textarea.inputValue();
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await mode.getAttribute("title"))?.includes("当前: 实时预览")) break;
    await mode.click();
    await settle(page);
  }
  await page.locator("#write .cm-content").waitFor();
  return source;
}

async function setMode(page, modeName) {
  const button = page.getByTestId("top-viewmode-cycle-btn");
  const target = modeName === "reading" ? "当前: 阅读模式" : "当前: 实时预览";
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await button.getAttribute("title"))?.includes(target)) return;
    await button.click();
    await settle(page);
  }
  throw new Error(`could not reach ${modeName} mode: ${await button.getAttribute("title")}`);
}

async function selectText(page, phrase) {
  const selected = await page.locator("#write .cm-content").evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let flattened = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, from: flattened.length, to: flattened.length + node.textContent.length });
      flattened += node.textContent;
    }
    const start = flattened.indexOf(text);
    if (start < 0) return false;
    const locate = (offset) => nodes.find((entry) => offset >= entry.from && offset < entry.to);
    const from = locate(start);
    const to = locate(start + text.length - 1);
    if (!from || !to) return false;
    const range = document.createRange();
    range.setStart(from.node, start - from.from);
    range.setEnd(to.node, start + text.length - to.from);
    root.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString() === text;
  }, phrase);
  assert.equal(selected, true, `could not select the rendered text ${JSON.stringify(phrase)}`);
  await settle(page);
}

async function placeCaretOnBlankAfterIntro(page) {
  const location = await page.locator("#write .cm-content").evaluate((root) => {
    const lines = [...root.querySelectorAll(".cm-line")];
    const introIndex = lines.findIndex((line) => line.textContent.includes("无缝所见即所得体验"));
    const blankIndex = lines.findIndex((line, index) => index > introIndex && line.textContent.trim() === "");
    const blank = lines[blankIndex];
    if (introIndex < 0 || !blank) return { found: false, lines: lines.map((line) => line.textContent) };
    const range = document.createRange();
    range.selectNodeContents(blank);
    range.collapse(true);
    root.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { found: true, blankIndex, text: blank.textContent };
  });
  assert.equal(location.found, true, `expected an empty rendered row after the Quickstart intro: ${JSON.stringify(location)}`);
  await settle(page);
  return location;
}

async function testViewSummary(page, positions) {
  return page.evaluate((requested) => {
    // Test-only React-fiber lookup of CM6LivePreviewEditor's useRef-held EditorView.
    let view = null;
    const editors = [...document.querySelectorAll(".cm-editor")];
    for (const editor of editors) {
      for (let element = editor.parentElement; element && !view; element = element.parentElement) {
        const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
        let fiber = fiberKey ? element[fiberKey] : null;
        while (fiber && !view) {
          for (let hook = fiber.memoizedState; hook; hook = hook.next) {
            const candidate = hook.memoizedState?.current;
            if (candidate?.state?.doc && typeof candidate.lineBlockAt === "function") {
              view = candidate;
              break;
            }
          }
          fiber = fiber.return;
        }
      }
    }
    if (!view) return { available: false };
    const doc = view.state.doc;
    const lineBlock = (position) => {
      const offset = Math.max(0, Math.min(doc.length, position));
      const line = doc.lineAt(offset);
      const block = view.lineBlockAt(offset);
      return {
        position: offset,
        docLine: { number: line.number, from: line.from, to: line.to, text: line.text.slice(0, 96) },
        block: { from: block.from, to: block.to, top: block.top, bottom: block.bottom, height: block.height, type: block.type },
        blockDocBounds: {
          firstLineFrom: doc.lineAt(block.from).from,
          lastLineTo: doc.lineAt(Math.max(block.from, block.to - 1)).to,
          blockToEqualsLastLineTo: block.to === doc.lineAt(Math.max(block.from, block.to - 1)).to,
          sourceText: doc.sliceString(block.from, block.to),
          endsWithLF: doc.sliceString(Math.max(block.from, block.to - 1), block.to) === "\n"
        }
      };
    };
    const current = view.state.selection.main;
    const domSelection = window.getSelection();
    return {
      available: true,
      docLength: doc.length,
      selection: { anchor: current.anchor, head: current.head, from: current.from, to: current.to, empty: current.empty },
      focused: document.activeElement?.classList.contains("cm-content") ?? false,
      positions: Object.fromEntries(Object.entries(requested).map(([name, offset]) => [name, lineBlock(offset)])),
      caret: lineBlock(current.head),
      domSelection: { collapsed: domSelection?.isCollapsed ?? null, text: domSelection?.toString() ?? "" }
    };
  }, positions);
}

async function cursorSnapshot(page) {
  return page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const selection = window.getSelection();
    const activeLine = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest(".cm-line")
      : selection?.anchorNode?.parentElement?.closest(".cm-line");
    const rect = activeLine?.getBoundingClientRect();
    return {
      x: cursor?.x ?? null,
      y: cursor?.y ?? null,
      line: activeLine?.textContent ?? null,
      lineBox: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      selected: selection?.toString() ?? "",
      active: document.activeElement?.classList.contains("cm-content") ?? false
    };
  });
}

async function assertJoinedTail(page, state) {
  const before = await characterRect(page, "排", "#write .cm-content", "last", "优美出版级排");
  const after = await characterRect(page, "版。", "#write .cm-content", "last", "版。");
  assert.ok(before && after && Math.abs(before.y - after.y) < 2,
    `the active soft-LF seam must keep '排版' together at 426px: ${JSON.stringify({ before, after, state })}`);
  const join = page.locator(".cm-softbreak-join").filter({ hasText: "排版" }).last();
  assert.equal(await join.textContent(), "排版", "the active editor must retain the outer CJK no-wrap join across the unchanged LF");
  return { before, after };
}

test("CM6 keeps soft-LF CJK joining active while preserving source, visible-row navigation, hard breaks, and read-only mode", async () => {
  const browser = await launchBrowser();
  const page = await openEditor(browser, content);
  try {
    const inactivePosition = softBreakSource.indexOf("展开 Markdown");
    const inactive = await testViewSummary(page, { phrase: inactivePosition, tail: softBreakSource.indexOf("版。") });
    assert.equal(inactive.available, true, "the test-only view lookup must expose public EditorView.lineBlockAt diagnostics");

    const clickTarget = await characterRect(page, "Live Markdown", "#write .cm-content", "first", "为你提供");
    assert.ok(clickTarget, "the original rich paragraph must expose a real text hit target");
    await page.mouse.click(clickTarget.x + clickTarget.width / 2, clickTarget.y + clickTarget.height / 2);
    await settle(page);
    const clickState = await testViewSummary(page, { phrase: inactivePosition, tail: softBreakSource.indexOf("版。") });
    const emphasisStart = softBreakSource.indexOf("**Live Markdown**");
    assert.ok(clickState.focused && clickState.selection.head >= emphasisStart && clickState.selection.head <= emphasisStart + "**Live Markdown**".length,
      `a real click on rich paragraph text must focus that source paragraph: ${JSON.stringify(clickState)}`);
    const visibleEmphasis = await page.locator(".cm-line").filter({ hasText: "为你提供" }).first().textContent();
    assert.ok(visibleEmphasis.includes("**Live Markdown**"),
      `active editing must expose the original Markdown emphasis markers: ${JSON.stringify(visibleEmphasis)}`);

    await setCaret(page, "展开 Markdown", 3);
    const activePosition = await testViewSummary(page, { phrase: inactivePosition, tail: softBreakSource.indexOf("版。") });
    const activeLine = page.locator(".cm-line").filter({ hasText: "展开 Markdown 源码编辑" }).first();
    const activeState = await activeLine.evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let boldNode = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes("Live Markdown")) {
          boldNode = walker.currentNode;
          break;
        }
      }
      const bold = boldNode?.parentElement?.closest(".cm-bold,strong,b") ?? boldNode?.parentElement;
      return {
        focused: document.activeElement?.classList.contains("cm-content") ?? false,
        active: !line.classList.contains("cm-paragraph-preview"),
        width: line.getBoundingClientRect().width,
        lineHeight: parseFloat(getComputedStyle(line).lineHeight),
        whiteSpace: getComputedStyle(line).whiteSpace,
        strongText: boldNode?.textContent ?? null,
        strongWeight: bold ? getComputedStyle(bold).fontWeight : null,
        joinText: line.querySelector(".cm-softbreak-join")?.textContent ?? null
      };
    });
    assert.equal(activeState.focused, true);
    assert.equal(activeState.active, true, "placing the caret must activate source editing");
    assert.ok(Math.abs(activeState.width - 426) < 1, `the persistent host-width constraint must remain 426 CSS px when active: ${JSON.stringify(activeState)}`);
    assert.ok(activeState.strongText?.includes("Live Markdown") && Number(activeState.strongWeight) >= 600,
      `the original strong emphasis must remain visibly bold in active editing: ${JSON.stringify(activeState)}`);
    const joinedTail = await assertJoinedTail(page, activeState);
    const evidenceDir = path.join(pluginRoot, ".cache/acceptance/active-paragraph-flow");
    const activeScreenshot = path.join(evidenceDir, "active-softbreak-426px.png");
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: activeScreenshot, fullPage: true, caret: "initial" });
    const bundle = await page.locator("script[src]").evaluateAll((scripts) => scripts.map((script) => script.getAttribute("src")));
    fs.writeFileSync(path.join(evidenceDir, "active-softbreak-426px.json"), JSON.stringify({
      bundle, viewport: { width: 800, height: 820, dpr: 2, constrainedLineWidth: 426 }, activeState,
      inactiveLineBlocks: inactive, activeLineBlocks: activePosition, joinedTail
    }, null, 2));

    await selectText(page, "展开 Markdown");
    const selected = await cursorSnapshot(page);
    assert.equal(selected.selected, "展开 Markdown", `selection inside Markdown emphasis must remain selectable while soft-LF stays active: ${JSON.stringify(selected)}`);
    assert.ok(await page.locator(".cm-softbreak-join").filter({ hasText: "排版" }).last().count(),
      "selecting active Markdown must not remove the outer CJK join decoration");

    await setCaret(page, "展开 Markdown", 3);
    const beforeDown = await cursorSnapshot(page);
    const beforeDownView = await testViewSummary(page, { phrase: inactivePosition, tail: softBreakSource.indexOf("版。") });
    await page.keyboard.press("ArrowDown");
    await settle(page);
    const afterDown = await cursorSnapshot(page);
    const afterDownView = await testViewSummary(page, { phrase: inactivePosition, tail: softBreakSource.indexOf("版。") });
    fs.writeFileSync(path.join(evidenceDir, "active-softbreak-426px.json"), JSON.stringify({
      bundle, viewport: { width: 800, height: 820, dpr: 2, constrainedLineWidth: 426 }, activeState,
      inactiveLineBlocks: inactive, activeLineBlocks: activePosition, joinedTail,
      navigationDiagnostic: { beforeDown, beforeDownView, afterDown, afterDownView }
    }, null, 2));
    assert.ok(afterDown.active && afterDown.line?.includes("无缝所见即所得体验") && afterDown.y > beforeDown.y + 8,
      `ArrowDown must advance within the active paragraph's visible rows: ${JSON.stringify({ beforeDown, afterDown })}`);
    assert.ok(Math.abs((afterDown.y - beforeDown.y) - activeState.lineHeight) <= 4,
      `one ArrowDown must advance by exactly one computed visual row (${activeState.lineHeight}px): ${JSON.stringify({ beforeDown, afterDown })}`);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    const afterUp = await cursorSnapshot(page);
    assert.ok(afterUp.line?.includes("无缝所见即所得体验") && Math.abs(afterUp.y - beforeDown.y) <= 3,
      `ArrowUp should return to the adjacent prior visual row: ${JSON.stringify({ beforeDown, afterDown, afterUp })}`);
    await assertJoinedTail(page, activeState);

    await setCaret(page, "展开 Markdown", 3);
    const beforeLeft = await cursorSnapshot(page);
    await page.keyboard.press("ArrowLeft");
    await settle(page);
    const afterLeft = await cursorSnapshot(page);
    await page.keyboard.press("ArrowRight");
    await settle(page);
    const afterRight = await cursorSnapshot(page);
    assert.ok(beforeLeft.active && afterLeft.active && afterRight.active &&
      Math.abs(beforeLeft.y - afterLeft.y) < 2 && Math.abs(beforeLeft.y - afterRight.y) < 2,
    `horizontal movement around inline source decorations must remain on the same rendered row: ${JSON.stringify({ beforeLeft, afterLeft, afterRight })}`);

    await setCaret(page, "版。", 2);
    const paragraphEnd = await testViewSummary(page, { tail: softBreakSource.indexOf("版。") });
    assert.equal(paragraphEnd.selection.head, softBreakSource.indexOf("版。") + "版。".length,
      `the endpoint probe must place the caret at the paragraph's exact source end: ${JSON.stringify(paragraphEnd)}`);
    assert.equal(paragraphEnd.caret.blockDocBounds.blockToEqualsLastLineTo, true,
      `lineBlockAt at the caret must cover the raw final source line exactly: ${JSON.stringify(paragraphEnd.caret)}`);
    const boldAtEnd = await page.locator(".cm-bold").filter({ hasText: "Live Markdown" }).first().evaluate((element) => ({
      text: element.textContent,
      weight: getComputedStyle(element).fontWeight
    }));
    assert.ok(boldAtEnd.text.includes("Live Markdown") && Number(boldAtEnd.weight) >= 600,
      `moving the caret to paragraph.to must not hide earlier StrongEmphasis: ${JSON.stringify(boldAtEnd)}`);
    const endpointJoin = await assertJoinedTail(page, { selection: paragraphEnd.selection });

    await setCaret(page, "主动编辑硬换行", 0);
    await page.locator(".cm-line").filter({ hasText: "主动编辑硬换行" }).first().scrollIntoViewIfNeeded();
    await settle(page);
    const hardBefore = await characterRect(page, "主动编辑硬换行");
    const hardAfter = await characterRect(page, "下一行仍须断开");
    assert.ok(hardBefore && hardAfter && hardAfter.y > hardBefore.y + 4,
      `a Markdown hard break must stay a visual break while the surrounding editor is active: ${JSON.stringify({ hardBefore, hardAfter })}`);
    assert.equal(await readSource(page), content,
      "selection/navigation and active soft-LF rendering must preserve every exact Markdown byte including source LFs and hard-break spaces");
    await setMode(page, "reading");
    const readingState = await page.locator("#write").evaluate((element) => ({
      editable: element.isContentEditable,
      userModify: getComputedStyle(element).webkitUserModify
    }));
    assert.equal(await page.locator('#write textarea, #write [contenteditable="true"]').count(), 0, "reading must not expose an editable control");
    assert.equal(readingState.editable, false, `reading mode must remain readonly: ${JSON.stringify(readingState)}`);
    assert.notEqual(readingState.userModify, "read-write", `the active editor override must not leak into reading mode: ${JSON.stringify(readingState)}`);

    const evidence = {
      bundle,
      viewport: { width: 800, height: 820, dpr: 2, constrainedLineWidth: 426 },
      sourceExact: true,
      activeState,
      inactiveLineBlocks: inactive,
      activeLineBlocks: activePosition,
      joinedTail,
      horizontal: { beforeLeft, afterLeft, afterRight },
      paragraphEnd,
      endpointJoin,
      vertical: { beforeDown, afterDown, afterUp },
      hardBreak: { hardBefore, hardAfter },
      readingState
    };
    fs.writeFileSync(path.join(evidenceDir, "active-softbreak-426px.json"), JSON.stringify(evidence, null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 native Enter inserts a soft LF that stays joined; Undo restores the exact source", async () => {
  const source = "# Enter contract\n\n这是一段用于验证编辑时软换行的中文内容。";
  const browser = await launchBrowser();
  const page = await openEditor(browser, source, 1600);
  try {
    await setCaret(page, "编辑时软换行", 2);
    await page.keyboard.press("Enter");
    await settle(page);
    const afterEnter = source.replace("编辑时", "编辑\n时");
    assert.equal(await readSource(page), afterEnter, "native Enter must insert exactly one source LF and preserve surrounding text");
    await setCaret(page, "时软换行", 1);
    const left = await characterRect(page, "编辑", "#write .cm-content", "last", "编辑");
    const right = await characterRect(page, "时软", "#write .cm-content", "last", "时软");
    assert.ok(left && right && Math.abs(left.y - right.y) < 2,
      `an active soft LF inserted by native Enter must remain visually joined: ${JSON.stringify({ left, right })}`);
    await page.keyboard.press("Meta+z");
    await settle(page);
    assert.equal(await readSource(page), source, "one native Undo must restore the original exact source");
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 lineBlockAt and ArrowUp from the trailing blank target the joined paragraph's final visual row", async () => {
  const browser = await launchBrowser();
  const page = await openEditor(browser, softBreakSource);
  try {
    const blank = await placeCaretOnBlankAfterIntro(page);
    const blankPosition = await testViewSummary(page, { paragraphStart: softBreakSource.indexOf("Live Markdown"), paragraphTail: softBreakSource.indexOf("版。") });
    assert.equal(blankPosition.available, true);
    assert.equal(blankPosition.domSelection.collapsed, true);
    await page.keyboard.press("ArrowUp");
    await settle(page);
    const entered = await cursorSnapshot(page);
    const after = await testViewSummary(page, { paragraphStart: softBreakSource.indexOf("Live Markdown"), paragraphTail: softBreakSource.indexOf("版。") });
    const finalGeometry = await page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first().evaluate((line) => {
      const box = line.getBoundingClientRect();
      return { top: box.top, height: box.height, lineHeight: parseFloat(getComputedStyle(line).lineHeight) };
    });
    assert.ok(entered.active && entered.line?.includes("无缝所见即所得体验") && entered.line?.includes("版。"),
      `one Up must enter the joined intro paragraph, not skip it: ${JSON.stringify({ blank, entered, before: blankPosition, after })}`);
    assert.ok(entered.y >= finalGeometry.top + finalGeometry.height - finalGeometry.lineHeight - 4 &&
      entered.y < finalGeometry.top + finalGeometry.height + 3,
    `Up from the following blank should land on the paragraph's final visible row: ${JSON.stringify({ entered, finalGeometry })}`);
    assert.equal(after.selection.head >= 0, true);
    assert.ok(Math.abs(after.caret.block.top - after.positions.paragraphTail.block.top) < finalGeometry.height + 3,
      `the current lineBlockAt caret should be geometrically adjacent to the source tail position: ${JSON.stringify({ before: blankPosition, after, finalGeometry })}`);
    const joined = await assertJoinedTail(page, { paragraph: "intro" });
    assert.equal(await readSource(page), softBreakSource, "Up navigation and lineBlock measurements must leave all source LFs unchanged");
    const evidenceDir = path.join(pluginRoot, ".cache/acceptance/active-paragraph-flow");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "blank-up-line-blocks.json"), JSON.stringify({ blank, before: blankPosition, after, entered, finalGeometry, joined }, null, 2));
  } finally {
    await page.close();
    await browser.close();
  }
});
