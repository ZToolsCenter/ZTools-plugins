"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pluginRoot } = require("../browser.cjs");

const acceptanceDir = path.join(pluginRoot, ".cache/acceptance/rich-cursor");
const intro = "**Live Markdown** 为你提供读者与创作者合一的**无缝所见即所得体验**。它消除了传统双栏预览的视线割裂与排版噪点，让你全神贯注于内容创作：点击任意段落即可实时展开 Markdown 源码编辑，移开焦点后立即渲染为优美出版级排版。";
const introPlain = intro.replace(/\*\*/g, "");
const sampleSource = fs.readFileSync(path.join(pluginRoot, "src/core/sampleDocs.ts"), "utf8");
const sampleModule = { exports: {} };
const sampleJs = require("typescript").transpileModule(sampleSource, {
  compilerOptions: { module: require("typescript").ModuleKind.CommonJS }
}).outputText;
vm.runInNewContext(sampleJs, { exports: sampleModule.exports, module: sampleModule });
const quickstart = sampleModule.exports.SAMPLE_QUICKSTART_DOC;

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function blankLineAfterCm6Intro(page) {
  const { blankIndex } = await cm6IntroAndNextBlankIndexes(page);
  return page.locator(".cm-line").nth(blankIndex);
}

async function cm6IntroAndNextBlankIndexes(page) {
  const indexes = await page.locator(".cm-line").evaluateAll((lines) => {
    const introIndex = lines.findIndex((line) => line.innerText.includes("无缝所见即所得体验"));
    const blankIndex = lines.findIndex((line, index) => index > introIndex && line.innerText.trim() === "");
    return { introIndex, blankIndex };
  });
  assert.equal(indexes.blankIndex, indexes.introIndex + 1,
    `the first source row after the intro must be the blank row: ${JSON.stringify(indexes)}`);
  return indexes;
}

async function clickBlankLineAtCenter(page) {
  const { introIndex, blankIndex } = await cm6IntroAndNextBlankIndexes(page);
  assert.ok(blankIndex >= 0, "the complete quickstart should have a blank CM6 source line after its intro");
  const blankLine = page.locator(".cm-line").nth(blankIndex);
  const box = await blankLine.boundingBox();
  assert.ok(box, "the first empty line after the intro should have measurable geometry");
  await blankLine.click({ position: { x: 2, y: box.height / 2 } });
  await settle(page);
  const selection = await cm6NavigationSnapshot(page);
  assert.equal(selection.sourceLines[blankIndex]?.trim(), "",
    `the source row after the intro must remain empty even if native click maps to the following [TOC] row: ${JSON.stringify(selection)}`);
  return { introIndex, blankIndex, selection };
}

async function placeCm6CaretOnBlankAfterIntro(page) {
  const { introIndex, blankIndex } = await cm6IntroAndNextBlankIndexes(page);
  assert.ok(blankIndex >= 0, "the complete quickstart should have a blank CM6 source line after its intro");
  const blankLine = page.locator(".cm-line").nth(blankIndex);
  await blankLine.scrollIntoViewIfNeeded();
  await blankLine.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    document.querySelector(".cm-content")?.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await settle(page);
  const selection = await cm6NavigationSnapshot(page);
  assert.equal(selection.anchorLineIndex, blankIndex,
    `the DOM Range must select the exact first empty line after the intro: ${JSON.stringify({ introIndex, blankIndex, selection })}`);
  assert.equal(selection.sourceLines[blankIndex]?.trim(), "",
    `the selected source line must be empty: ${JSON.stringify(selection.sourceLines)}`);
  return { introIndex, blankIndex, selection };
}

async function cm6NavigationSnapshot(page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const line = lines.find((element) => element.innerText.includes("无缝所见即所得体验"));
    const lineRect = line?.getBoundingClientRect();
    const visibleCursors = [...document.querySelectorAll(".cm-cursor")].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visibility: style.visibility, opacity: style.opacity };
    }).filter((rect) => rect.visibility !== "hidden" && rect.opacity !== "0" && rect.height > 0);
    const selection = window.getSelection();
    const anchorLine = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest(".cm-line")
      : selection?.anchorNode?.parentElement?.closest(".cm-line");
    const anchorLineIndex = anchorLine ? lines.indexOf(anchorLine) : -1;
    let anchorOffsetInLine = null;
    if (anchorLine && selection?.anchorNode) {
      try {
        const range = document.createRange();
        range.selectNodeContents(anchorLine);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        anchorOffsetInLine = range.toString().length;
      } catch {}
    }
    return {
      activeClass: document.activeElement?.className,
      introText: line?.innerText,
      introSourceText: line?.textContent,
      introPlainText: line?.innerText.replace(/\*\*/g, "").trim(),
      sourceLines: lines.map((element) => element.textContent),
      introRect: lineRect && { x: lineRect.x, y: lineRect.y, width: lineRect.width, height: lineRect.height },
      lineHeight: line && parseFloat(getComputedStyle(line).lineHeight),
      cursors: visibleCursors,
      anchorLineText: anchorLine?.textContent ?? null,
      anchorLineIndex,
      anchorOffsetInLine,
      selection: selection && {
        anchorText: selection.anchorNode?.textContent,
        anchorOffset: selection.anchorOffset,
        focusText: selection.focusNode?.textContent,
        focusOffset: selection.focusOffset,
        collapsed: selection.isCollapsed
      }
    };
  });
}

async function runCm6ScenarioWithEvidence(page, scenario, beforeSelection, run) {
  const beforeScreenshot = await page.screenshot({ fullPage: true });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await run();
  } catch (error) {
    fs.mkdirSync(acceptanceDir, { recursive: true });
    fs.writeFileSync(path.join(acceptanceDir, `before-${scenario}.png`), beforeScreenshot);
    fs.writeFileSync(path.join(acceptanceDir, `${scenario}-before-selection.json`), JSON.stringify(beforeSelection, null, 2));
    const after = await cm6NavigationSnapshot(page).catch(() => ({ unavailable: true }));
    fs.writeFileSync(path.join(acceptanceDir, `${scenario}-after-row.json`), JSON.stringify(after, null, 2));
    await page.screenshot({ path: path.join(acceptanceDir, `after-${scenario}.png`), fullPage: true }).catch(() => {});
    await page.context().tracing.stop({ path: path.join(acceptanceDir, `${scenario}.trace.zip`) }).catch(() => {});
    throw error;
  }
  await page.context().tracing.stop();
}

async function toggleEditorMode(page, title) {
  const button = page.locator(`.ty-footer-btn[title="${title}"]`).first();
  await button.click();
  assert.equal(await button.evaluate((element) => element.classList.contains("active")), true,
    `${title} should be enabled through the editor's actual control`);
}

async function placeCm6CaretAtIntroEnd(page) {
  const line = page.locator(".cm-line").filter({ hasText: "无缝所见即所得体验" }).first();
  await line.scrollIntoViewIfNeeded();
  const caretSet = await line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastText = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent) lastText = walker.currentNode;
    }
    if (!lastText) return null;
    const range = document.createRange();
    range.setStart(lastText, lastText.textContent.length);
    range.collapse(true);
    const editor = document.querySelector(".cm-content");
    editor?.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return { offset: lastText.textContent.length, text: lastText.textContent };
  });
  await settle(page);
  const state = await cm6NavigationSnapshot(page);
  assert.equal(state.introPlainText, introPlain, "the paragraph must remain a single complete, untruncated visible line");
  assert.equal(state.anchorLineText?.replace(/\*\*/g, "").trim(), introPlain,
    `the caret must remain in the complete intro line: ${JSON.stringify(state)}`);
  assert.equal(state.anchorOffsetInLine, intro.length,
    `the DOM Range must place the caret at the final Markdown source offset: ${JSON.stringify({ caretSet, state })}`);
  return state;
}

function assertCm6CaretOnBlankLine(state, scenario) {
  assert.equal(state.anchorLineText?.trim(), "", `${scenario}: the active source line must be blank: ${JSON.stringify(state)}`);
  assert.ok(state.anchorLineIndex >= 0, `${scenario}: expected a DOM line index for the blank caret`);
}

function assertQuickstartIntroNotSplit(state, scenario) {
  const introLines = state.sourceLines.filter((line) => line.replace(/\*\*/g, "").trim() === introPlain);
  assert.equal(introLines.length, 1, `${scenario}: the complete intro must remain a single line, not be split mid-source`);
}

async function assertCm6CaretOnIntroLastRow(page, scenario) {
  await settle(page);
  const state = await cm6NavigationSnapshot(page);
  assert.equal(state.introPlainText, introPlain, `${scenario}: the complete intro must remain on one untruncated line`);
  assert.ok(state.introRect && state.lineHeight && state.cursors.length,
    `${scenario}: expected actual CM6 layout and caret geometry, got ${JSON.stringify(state)}`);
  const lastRowTop = state.introRect.y + state.introRect.height - state.lineHeight;
  const caret = state.cursors[0];
  assert.ok(caret.y >= lastRowTop - 3 && caret.y < state.introRect.y + state.introRect.height,
    `${scenario}: expected the final visible intro row, got ${JSON.stringify({ state, lastRowTop })}`);
  return state;
}

module.exports = {
  intro,
  introPlain,
  quickstart,
  settle,
  blankLineAfterCm6Intro,
  cm6IntroAndNextBlankIndexes,
  clickBlankLineAtCenter,
  placeCm6CaretOnBlankAfterIntro,
  cm6NavigationSnapshot,
  runCm6ScenarioWithEvidence,
  toggleEditorMode,
  placeCm6CaretAtIntroEnd,
  assertCm6CaretOnBlankLine,
  assertQuickstartIntroNotSplit,
  assertCm6CaretOnIntroLastRow
};
