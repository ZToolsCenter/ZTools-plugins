"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const {
  intro,
  introPlain,
  quickstart,
  settle,
  blankLineAfterCm6Intro,
  clickBlankLineAtCenter,
  placeCm6CaretOnBlankAfterIntro,
  cm6NavigationSnapshot,
  runCm6ScenarioWithEvidence,
  toggleEditorMode,
  placeCm6CaretAtIntroEnd,
  assertCm6CaretOnBlankLine,
  assertQuickstartIntroNotSplit,
  assertCm6CaretOnIntroLastRow
} = require("./fixtures/cm6-rich-navigation.cjs");

const acceptanceDir = path.join(pluginRoot, ".cache/acceptance/rich-cursor");
const welcome = `# Welcome to Live Markdown\n\n[TOC]\n\n${intro}\n\n## 1. 核心工作流与视图模式`;

async function boot(browser, content, { width = 760, fontSize = 16, engine = "block" } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(8000);
  await page.addInitScript(installLocalAiWorkflow, { content });
  await page.addInitScript(({ fontSize, engine }) => {
    const load = window.typoraBridge.loadPersistedState;
    window.typoraBridge.loadPersistedState = () => {
      const state = load();
      state.preferences.editorEngine = engine;
      state.preferences.fontSize = fontSize;
      return state;
    };
  }, { fontSize, engine });
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  await page.locator(engine === "cm6" ? "#write .cm-content" : "#write .ty-block-wrapper").first().waitFor();
  return page;
}

async function focusParagraph(page, marker) {
  await page.locator("#write .ty-paragraph-block").filter({ hasText: marker }).first().click();
  const textarea = page.locator("#write textarea.ty-live-textarea");
  await textarea.waitFor();
  return textarea;
}

async function setCaret(page, offset) {
  await page.evaluate(offset => {
    const textarea = document.activeElement;
    textarea.setSelectionRange(offset, offset);
  }, offset);
  await settle(page);
}

async function activeState(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      value: element.value,
      placeholder: element.placeholder,
      start: element.selectionStart,
      end: element.selectionEnd
    };
  });
}

async function assertLastVisualRowByHome(page, draftTextarea) {
  await draftTextarea.press("ArrowUp");
  await settle(page);
  const entered = await activeState(page);
  assert.equal(entered.value, intro, "ArrowUp from an empty draft must enter the preceding rich paragraph");
  assert.equal(entered.start, entered.end, "visual navigation must leave a single caret");

  // Jump to the source end, then use native Home to identify the final
  // wrapped row's start without altering the source text.
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Home");
  await settle(page);
  const lastRowStart = await activeState(page);
  assert.equal(lastRowStart.value, intro);
  assert.ok(entered.start >= lastRowStart.start,
    `the custom move must land on the paragraph's final visual row: ${JSON.stringify({ entered, lastRowStart })}`);
}

test("rich Chinese welcome paragraph cross-block arrows land on its actual last visual row", async () => {
  fs.mkdirSync(acceptanceDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await boot(browser, welcome, { width: 720 });
  try {
    await page.screenshot({ path: path.join(acceptanceDir, "before-rich-paragraph-navigation.png"), fullPage: true });
    const paragraph = await focusParagraph(page, "无缝所见即所得体验");
    const paragraphMetrics = await paragraph.evaluate(element => ({
      font: getComputedStyle(element).font,
      width: element.clientWidth,
      height: element.scrollHeight,
      lineHeight: getComputedStyle(element).lineHeight
    }));
    assert.ok(paragraphMetrics.height > parseFloat(paragraphMetrics.lineHeight) * 2,
      `The welcome paragraph must wrap naturally with its real CSS: ${JSON.stringify(paragraphMetrics)}`);
    assert.equal(await paragraph.inputValue(), intro, "the WYSIWYG paragraph must expand to the expected Markdown source");

    await setCaret(page, intro.length);
    await page.keyboard.press("Enter");
    const midDraft = page.getByPlaceholder("在此处继续输入新段落...");
    await midDraft.waitFor();
    await assertLastVisualRowByHome(page, midDraft);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("rich Chinese tail draft uses the actual body typography and native row transition", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, `# Welcome\n\n${intro}`, { width: 680, fontSize: 16 });
  try {
    const paragraph = await focusParagraph(page, "无缝所见即所得体验");
    await setCaret(page, intro.length);
    await page.keyboard.press("Enter");
    const tailDraft = page.getByPlaceholder("在此处继续输入新段落...");
    await tailDraft.waitFor();
    await assertLastVisualRowByHome(page, tailDraft);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("body-to-Chinese-heading navigation uses the destination font at 24px in a narrow viewport", async () => {
  const browser = await launchBrowser();
  const body = "前置正文";
  const heading = "跨块移动必须按照中文标题的真实字号与换行宽度定位光标".repeat(5);
  const page = await boot(browser, `${body}\n\n# ${heading}\n\n[TOC]`, { width: 520, fontSize: 24 });
  try {
    const bodyTextarea = await focusParagraph(page, body);
    await setCaret(page, body.length);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    const intoHeading = await activeState(page);
    assert.equal(intoHeading.value, `# ${heading}`);
    const headingMetrics = await page.locator("#write textarea.ty-live-textarea").evaluate(element => ({
      font: getComputedStyle(element).font,
      lineHeight: getComputedStyle(element).lineHeight,
      width: element.clientWidth,
      height: element.scrollHeight
    }));
    assert.ok(headingMetrics.height > parseFloat(headingMetrics.lineHeight) * 2,
      `The Chinese heading must wrap using its real destination style: ${JSON.stringify(headingMetrics)}`);

    await page.keyboard.press("ArrowUp");
    await settle(page);
    assert.equal((await activeState(page)).value, body,
      "ArrowUp from the heading's first visual row must return to the preceding body block");
    assert.equal(await bodyTextarea.inputValue(), body);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 exact blank source row ArrowUp enters the rich Chinese paragraph on its last wrapped row", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, welcome, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    await page.locator(".cm-content").waitFor();
    await page.getByText("无缝所见即所得体验", { exact: false }).first().waitFor();
    const { introIndex, blankIndex, selection: beforeSelection } = await placeCm6CaretOnBlankAfterIntro(page);
    assert.equal(blankIndex, introIndex + 1, "the tested source line must be the first blank row after the complete intro");
    assertQuickstartIntroNotSplit(beforeSelection, "before ArrowUp from the blank source row");
    assertCm6CaretOnBlankLine(beforeSelection, "before ArrowUp from the blank source row");
    await runCm6ScenarioWithEvidence(page, "cm6-rich-paragraph-navigation", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      const after = await assertCm6CaretOnIntroLastRow(page, "exact blank source row → ArrowUp");
      assert.equal(after.introSourceText?.replace(/\*\*/g, "").trim(), introPlain,
        "focusing the rich paragraph should reveal its complete source without changing the document");
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 body-to-Chinese-heading navigation uses the actual destination layout in a narrow viewport", async () => {
  const browser = await launchBrowser();
  const body = "前置正文";
  const heading = "跨块移动必须按照中文标题的真实字号与换行宽度定位光标".repeat(5);
  const page = await boot(browser, `${body}\n# ${heading}\n\n[TOC]`, { width: 520, fontSize: 24, engine: "cm6" });
  try {
    const bodyLine = page.locator(".cm-line").filter({ hasText: body }).first();
    await bodyLine.click({ position: { x: 10, y: 5 }, force: true });
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await settle(page);

    const state = await page.evaluate(() => {
      const headingLine = [...document.querySelectorAll(".cm-line")].find((line) => line.textContent.includes("跨块移动必须"));
      const bodyLine = [...document.querySelectorAll(".cm-line")].find((line) => line.textContent.includes("前置正文"));
      const caretRect = document.querySelector(".cm-cursor")?.getBoundingClientRect();
      const lineRect = headingLine?.getBoundingClientRect();
      return {
        active: document.activeElement?.classList.contains("cm-content"),
        fontSize: headingLine && parseFloat(getComputedStyle(headingLine).fontSize),
        bodyFontSize: bodyLine && parseFloat(getComputedStyle(bodyLine).fontSize),
        lineHeight: headingLine && parseFloat(getComputedStyle(headingLine).lineHeight),
        line: lineRect && { y: lineRect.y, height: lineRect.height },
        caret: caretRect && { y: caretRect.y, height: caretRect.height }
      };
    });
    assert.equal(state.active, true);
    assert.ok(state.line && state.caret && state.line.height > state.lineHeight * 2,
      `the Chinese heading should wrap over multiple visual rows at the narrow width: ${JSON.stringify(state)}`);
    assert.ok(state.fontSize > state.bodyFontSize,
      `the heading should retain its larger real CSS typography: ${JSON.stringify(state)}`);
    assert.ok(state.caret.y >= state.line.y - 2 && state.caret.y < state.line.y + state.lineHeight,
      `ArrowDown should place the caret on the heading's first visual row: ${JSON.stringify(state)}`);
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 center click then ArrowUp advances from the actual selected source row", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, quickstart, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    const { introIndex, blankIndex, selection: beforeSelection } = await clickBlankLineAtCenter(page);
    const clickedBlank = beforeSelection.anchorLineIndex === blankIndex && beforeSelection.sourceLines[blankIndex]?.trim() === "";
    const clickedToc = beforeSelection.anchorLineIndex === blankIndex + 1 && beforeSelection.sourceLines[blankIndex + 1]?.trim() === "[TOC]";
    assert.ok(clickedBlank || clickedToc,
      `the click must land on the intro's first blank line or reveal that the browser selected adjacent [TOC]: ${JSON.stringify({ introIndex, blankIndex, beforeSelection })}`);
    await runCm6ScenarioWithEvidence(page, "cm6-click-empty-arrow-up", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      await settle(page);
      const after = await cm6NavigationSnapshot(page);
      if (clickedBlank) {
        await assertCm6CaretOnIntroLastRow(page, "click exact blank source line → ArrowUp");
      } else {
        assert.equal(after.anchorLineIndex, blankIndex,
          `when the click placed the caret on [TOC], one Up must stop at the intervening blank line: ${JSON.stringify({ beforeSelection, after })}`);
        assert.equal(after.anchorLineText?.trim(), "", "ArrowUp must land in the adjacent empty row");
      }
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 Enter Enter at the intro source end keeps the full source and ArrowUp reaches the adjacent blank line", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, quickstart, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    await placeCm6CaretAtIntroEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await settle(page);
    const beforeSelection = await cm6NavigationSnapshot(page);
    assertQuickstartIntroNotSplit(beforeSelection, "after two Enter keys");
    assertCm6CaretOnBlankLine(beforeSelection, "after two Enter keys");
    await runCm6ScenarioWithEvidence(page, "cm6-enter-enter-arrow-up", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      await settle(page);
      const after = await cm6NavigationSnapshot(page);
      assertQuickstartIntroNotSplit(after, "after ArrowUp from the second consecutive blank line");
      assertCm6CaretOnBlankLine(after, "ArrowUp from the second consecutive blank line");
      assert.equal(after.anchorLineIndex, beforeSelection.anchorLineIndex - 1,
        `one ArrowUp should move to the immediately preceding blank line, not skip to the paragraph: ${JSON.stringify({ beforeSelection, after })}`);
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 one Enter at the intro source end then ArrowUp returns to the complete intro last row", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, quickstart, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    await placeCm6CaretAtIntroEnd(page);
    await page.keyboard.press("Enter");
    await settle(page);
    const beforeSelection = await cm6NavigationSnapshot(page);
    assertQuickstartIntroNotSplit(beforeSelection, "after one Enter key");
    assertCm6CaretOnBlankLine(beforeSelection, "after one Enter key");
    await runCm6ScenarioWithEvidence(page, "cm6-enter-arrow-up", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      await assertCm6CaretOnIntroLastRow(page, "intro end → Enter → ArrowUp");
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 intro end ArrowDown enters its adjacent blank line and ArrowUp returns to the intro final row in focus mode", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, quickstart, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    await toggleEditorMode(page, "专注模式 (F8)");
    await placeCm6CaretAtIntroEnd(page);
    await page.keyboard.press("ArrowDown");
    await settle(page);
    const beforeSelection = await cm6NavigationSnapshot(page);
    assertQuickstartIntroNotSplit(beforeSelection, "after ArrowDown from the intro source end");
    assertCm6CaretOnBlankLine(beforeSelection, "ArrowDown from the intro's source end");
    await runCm6ScenarioWithEvidence(page, "cm6-down-up-focus-mode", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      await assertCm6CaretOnIntroLastRow(page, "intro final visual row → ArrowDown → ArrowUp with focus mode");
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

test("CM6 center click then ArrowUp in typewriter mode moves only one adjacent visual row", async () => {
  const browser = await launchBrowser();
  const page = await boot(browser, quickstart, { width: 720, fontSize: 16, engine: "cm6" });
  try {
    await toggleEditorMode(page, "打字机滚动模式 (F9)");
    const { introIndex, blankIndex, selection: beforeSelection } = await clickBlankLineAtCenter(page);
    const clickedBlank = beforeSelection.anchorLineIndex === blankIndex && beforeSelection.sourceLines[blankIndex]?.trim() === "";
    const clickedToc = beforeSelection.anchorLineIndex === blankIndex + 1 && beforeSelection.sourceLines[blankIndex + 1]?.trim() === "[TOC]";
    assert.ok(clickedBlank || clickedToc,
      `the click must land on the first blank line or adjacent [TOC]: ${JSON.stringify({ introIndex, blankIndex, beforeSelection })}`);
    await runCm6ScenarioWithEvidence(page, "cm6-click-empty-arrow-up-typewriter", beforeSelection, async () => {
      await page.keyboard.press("ArrowUp");
      await settle(page);
      const after = await cm6NavigationSnapshot(page);
      if (clickedBlank) {
        await assertCm6CaretOnIntroLastRow(page, "click exact blank source line → ArrowUp with typewriter mode");
      } else {
        assert.equal(after.anchorLineIndex, blankIndex,
          `one Up from [TOC] must stop at the intervening blank row in typewriter mode: ${JSON.stringify({ beforeSelection, after })}`);
        assert.equal(after.anchorLineText?.trim(), "");
      }
    });
  } finally {
    await page.close();
    await browser.close();
  }
});

