"use strict";

const assert = require("node:assert/strict");

function assertContainsAll(actual, expected, message) {
  const missing = expected.filter((item) => !actual.includes(item));
  assert.deepEqual(missing, [], `${message}; missing: ${missing.join(" | ")}`);
}

function tableShape(text) {
  const rows = text.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  return rows.map((row) => row.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));
}

function validateCaseResult(testCase, result, imageUrl) {
  const source = result.afterSource;
  if (testCase.preservation) {
    assertContainsAll(source, testCase.preservation, "Protected rich Markdown structures must remain byte-exact after confirmation");
    result.formattingProtection = { status: "passed", details: "Every listed syntax fixture is present byte-for-byte after confirmation.", expectedUnchanged: testCase.preservation };
  }
  if (testCase.id === "full-polish") {
    const localImage = result.rendering.selectors.images.find((image) => image.src === imageUrl);
    result.rendering.localSvgImage = localImage || null;
    result.rendering.imageLoaded = Boolean(localImage?.complete && localImage.naturalWidth > 0);
    result.rendering.note = result.rendering.imageLoaded
      ? "Local SVG load is verified; fixture image does not depend on the network."
      : "CM6 currently has no live Markdown image preview widget: source URL preservation passed, while image rendering failed in this acceptance run.";
    const renderedRows = result.rendering.selectors.tableCellCounts[0] || [];
    assert.ok(renderedRows.length >= 3 && renderedRows.every((cells) => cells === 3), `Escaped-pipe table must render three columns; got ${JSON.stringify(renderedRows)}`);
    result.rendering.escapedPipeTableCellCounts = renderedRows;
    const checkboxStates = result.rendering.selectors.taskCheckboxes.map((item) => item.checked);
    assert.deepEqual(checkboxStates, [true, false], `Rendered task list must expose checked and unchecked checkbox widgets; got ${JSON.stringify(checkboxStates)}`);
    result.rendering.status = result.rendering.imageLoaded ? "partial" : "image_not_observed";
  }
  if (testCase.kind === "selection") {
    const originalSuffix = testCase.source.slice(testCase.selection.length);
    assert.ok(source.endsWith(originalSuffix), "Everything after the selected text must remain byte-exact even if the generated prefix changes length");
    const rewrittenPrefix = source.slice(0, source.length - originalSuffix.length);
    assert.notEqual(rewrittenPrefix, testCase.selection, "The selected prose should actually change");
    result.formattingProtection = { status: "passed", details: "Proposal was applied and the suffix (including table and document tail) remained byte-exact." };
  }
  if (testCase.id.startsWith("mermaid-insert")) {
    assert.match(result.previewText, /```mermaid\s*[\s\S]+?```/i, "Diagram output must be a fenced Mermaid block");
    assert.match(result.previewText, /(?:flowchart|graph)\s+(?:TD|LR|TB|RL)|sequenceDiagram|^pie\b|^gantt\b/im, "Diagram must begin with supported Mermaid grammar");
    assert.match(source, /```mermaid[\s\S]+?```/i, "Confirmed source must contain the generated Mermaid block");
    const diagramClose = source.indexOf("```", source.indexOf("```mermaid") + "```mermaid".length);
    assert.ok(diagramClose >= 0, "Confirmed source must contain a Mermaid closing fence");
    assert.equal(source[diagramClose + 3], "\n", "Generated block insertion must keep a newline before original content");
    assert.ok(/```\n{2,}# 发布流程/.test(source), "Generated block must have a blank line before the original heading");
    assert.ok(result.rendering.selectors.diagramBlock > 0 && result.rendering.selectors.diagramSvg > 0, "Generated Mermaid must render to SVG in the editor");
    result.formattingProtection = { status: "passed", details: "Mermaid fence grammar was present in the preview and confirmed source; live editor produced an SVG." };
    result.rendering.status = "passed";
  }
  if (testCase.id.startsWith("math-add")) {
    const lines = source.split(/\r?\n/).map((line) => line.trim());
    const inlineDisplayBlocks = lines.filter((line) => /^\$\$\s+.+\s+\$\$$/.test(line)).length;
    let fencedDisplayBlocks = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== "$$") continue;
      const closing = lines.indexOf("$$", index + 1);
      if (closing > index + 1) {
        fencedDisplayBlocks += 1;
        index = closing;
      }
    }
    const newMath = inlineDisplayBlocks + fencedDisplayBlocks;
    result.formattingProtection = { status: newMath >= 1 ? "passed" : "failed", details: `Standalone display-math blocks with delimiters on separate lines: ${newMath}.` };
    result.rendering.status = result.rendering.selectors.blockMath > 0 ? "passed" : "failed";
    assert.ok(newMath >= 1, "Expected $$ delimiters around a display formula on one line or on standalone delimiter lines");
    assert.ok(result.rendering.selectors.blockMath >= 1, "A requested display formula must produce at least one block-math renderer in live mode");
    assert.match(source, /(?:\bn\b.{0,80}(?:样本|项|数据|数量)|(?:样本|项|数据|数量).{0,80}\bn\b)/i, "Expected natural language explanation for n");
    assert.match(source, /(?:x_i|x\s*[_\\{]?i).{0,80}(?:表示|代表|第\s*i|样本|数据)|(?:表示|代表|第\s*i).{0,80}(?:x_i|x\s*[_\\{]?i)/i, "Expected natural language explanation for x_i");
    result.formattingProtection.details += ` Source saved after explicit confirmation; blockMath=${result.rendering.selectors.blockMath}, inlineMath=${result.rendering.selectors.inlineMath}.`;
  }
  if (testCase.id === "table-add") {
    const shape = tableShape(source);
    assert.ok(shape.length >= 4, "Expected a header, separator and at least two data rows in a Markdown table");
    assert.ok(shape.every((row) => row.length >= 3), `Expected at least three columns; parsed rows: ${JSON.stringify(shape)}`);
    assert.match(source, /轻量/);
    assert.match(source, /均衡/);
    result.newTableRows = shape;
    result.formattingProtection = { status: "passed", details: `Confirmed Markdown table has ${shape.length} rows and ${shape[0].length} columns.` };
    const renderedRows = result.rendering.selectors.tableCellCounts;
    assert.ok(renderedRows.length > 0 && renderedRows.every((row) => row.length === shape[0].length), `Rendered table column count must match source; got ${JSON.stringify(renderedRows)}`);
    result.rendering.tableCellCounts = renderedRows;
    result.rendering.status = "passed";
  }
  if (testCase.protectedEdit) {
    const cellsAndFormula = ["| 轻量 | 4 GB |", "$J = x + 1$"];
    assertContainsAll(source, cellsAndFormula, "Existing table and formula are expected to stay protected from explicit edit requests");
    assert.doesNotMatch(source, /\| 轻量 \| 8 GB \|/);
    assert.doesNotMatch(source, /\$J = x \+ 2\$/);
    result.formattingProtection = { status: "passed", details: "Explicit table/formula edits were refused by protection; exact originals remain in saved source." };
  }
}

module.exports = { validateCaseResult };
