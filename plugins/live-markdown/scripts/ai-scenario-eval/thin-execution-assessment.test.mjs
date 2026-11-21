import test from "node:test";
import assert from "node:assert/strict";
import { thinExecutionCases, thinExecutionMatrixSummary } from "./thin-execution-cases.mjs";
import { assessThinExecutionCase } from "./thin-execution-assessment.mjs";

const byId = (id) => thinExecutionCases.find((scenario) => scenario.id === id);
const successfulPatch = (scenario, bodyText, patchInsertText = bodyText) => {
  const { from, to, expectedText } = scenario.expected.patch;
  return {
    from, to, expectedText, insertText: patchInsertText,
    content: scenario.source.slice(0, from) + patchInsertText + scenario.source.slice(to)
  };
};
const observe = (effect, text = "", extra = {}) => ({
  effect, text, completed: true, calls: 1, program: false, truncated: false, ...extra
});
const assess = (scenario, observation, strategy = "thin") => assessThinExecutionCase(scenario, {
  direct: observe("error", ""), [strategy]: observation, full: observe("error", "")
});

test("the frozen matrix spans 50+ cases, 10+ families, and bounded live representatives", () => {
  assert.equal(thinExecutionCases.length, 79);
  assert.ok(thinExecutionCases.length >= 50);
  assert.ok(new Set(thinExecutionCases.map(({ family }) => family)).size >= 10);
  assert.equal(new Set(thinExecutionCases.map(({ id }) => id)).size, thinExecutionCases.length);
  const live = thinExecutionCases.filter(({ live }) => live);
  assert.equal(live.length, 25);
  assert.equal(thinExecutionCases.length - live.length, 54, "the original 74 cases remain alongside the five live regressions");
  assert.equal(thinExecutionMatrixSummary.estimatedLiveComparisons, live.length * 3 * 2);
  assert.equal(thinExecutionMatrixSummary.estimatedLiveComparisons, 150);
  assert.deepEqual(live.map(({ livePriority }) => livePriority).sort((a, b) => a - b), Array.from({ length: live.length }, (_, index) => index + 1));
  for (const scenario of thinExecutionCases) {
    assert.ok(scenario.instruction && scenario.source !== undefined && scenario.expected.effect);
    assert.equal(typeof scenario.live, "boolean");
    assert.equal(scenario.live, Number.isInteger(scenario.livePriority));
    if (scenario.expected.target === "selection" && scenario.expected.patch) {
      assert.equal(scenario.expected.patch.from, scenario.selection.from, scenario.id + " starts at the selected range");
      assert.equal(scenario.expected.patch.to, scenario.selection.to, scenario.id + " ends at the selected range");
    }
  }
});

test("exact append and replacement pass only with the authored range, literal, and untouched outside bytes", () => {
  const scenario = byId("APP01");
  const text = scenario.expected.exactText;
  const valid = assess(scenario, observe("insert", text, { target: scenario.expected.target, patch: successfulPatch(scenario, text, "\n\n" + text) }));
  assert.equal(valid.lanes.thin.layers.scope.pass, true);
  assert.equal(valid.lanes.thin.layers.parameters.pass, true);

  const typo = `${text}！`;
  const wrong = assess(scenario, observe("insert", typo, { target: scenario.expected.target, patch: successfulPatch(scenario, typo, "\n\n" + typo) }));
  assert.equal(wrong.lanes.thin.layers.scope.pass, true);
  assert.equal(wrong.lanes.thin.layers.parameters.pass, false);

  const missing = assess(scenario, observe("insert", "", { target: scenario.expected.target, patch: successfulPatch(scenario, "", "\n\n") }));
  assert.equal(missing.lanes.thin.layers.task.pass, false);
  assert.equal(missing.lanes.thin.layers.scope.pass, true);
  assert.equal(missing.lanes.thin.layers.parameters.pass, false);

  const replacement = byId("REP02");
  const replacementText = replacement.expected.exactText;
  const nearMiss = successfulPatch(replacement, replacementText);
  nearMiss.content = nearMiss.content.replace("KEEP-MIDDLE", "changed-middle");
  const unsafe = assess(replacement, observe("replace", replacementText, { target: replacement.expected.target, patch: nearMiss }));
  assert.equal(unsafe.lanes.thin.layers.scope.pass, false);
});

test("allowed selection ranges accept equivalent patches only when the exact full document matches", () => {
  const base = byId("POL01");
  const { from, to } = base.selection;
  const expectedText = "我们已经完成备份。";
  const exactContent = base.source.slice(0, from) + expectedText + base.source.slice(to);
  const scenario = {
    ...base,
    expected: { effect: "replace", target: "selection", allowedRange: { from, to }, exactContent }
  };
  const patchResult = (start, end, insertText, content) => {
    const patch = {
      from: start, to: end, expectedText: base.source.slice(start, end), insertText,
      content: content ?? base.source.slice(0, start) + insertText + base.source.slice(end)
    };
    return assess(scenario, observe("replace", insertText, { target: "selection", patch }));
  };

  const wholeSelection = patchResult(from, to, expectedText);
  assert.equal(wholeSelection.lanes.thin.layers.scope.pass, true);
  assert.equal(wholeSelection.lanes.thin.layers.parameters.pass, true);

  const typoFrom = base.source.indexOf("以经", from);
  assert.equal(base.source.slice(typoFrom, typoFrom + 2), "以经");
  const typoOnly = patchResult(typoFrom, typoFrom + 2, "已经");
  assert.equal(typoOnly.lanes.thin.layers.scope.pass, true);
  assert.equal(typoOnly.lanes.thin.layers.parameters.pass, true);

  const wrongWord = patchResult(from, to, "我们以经完成备份。");
  assert.equal(wrongWord.lanes.thin.layers.scope.pass, true);
  assert.equal(wrongWord.lanes.thin.layers.parameters.pass, false);
  const extraEdit = patchResult(from, to, "我们已经完全完成备份。");
  assert.equal(extraEdit.lanes.thin.layers.scope.pass, true);
  assert.equal(extraEdit.lanes.thin.layers.parameters.pass, false);

  const validLocalPatch = base.source.slice(0, typoFrom) + "已经" + base.source.slice(typoFrom + 2);
  const outsideWrite = patchResult(typoFrom, typoFrom + 2, "已经", validLocalPatch.replace("KEEP-AFTER", "CHANGED-AFTER"));
  assert.equal(outsideWrite.lanes.thin.layers.scope.pass, false);
  const outOfRange = patchResult(from - 1, to, "KEEP-BEFORE\n\n我们已经完成备份。");
  assert.equal(outOfRange.lanes.thin.layers.scope.pass, false);
});

test("section-end literal content is scored separately from deterministic Markdown separators", () => {
  const scenario = byId("HEAD01");
  const insertText = scenario.expected.patch.insertText;
  const { from, to, expectedText } = scenario.expected.patch;
  const patch = { from, to, expectedText, insertText, content: scenario.source.slice(0, from) + insertText + scenario.source.slice(to) };
  const result = assess(scenario, observe("insert", "Reviewed.", { target: scenario.expected.target, patch }));
  assert.equal(result.lanes.thin.layers.scope.pass, true);
  assert.equal(result.lanes.thin.layers.parameters.pass, true);
});

test("HEAD01 and HEAD04 use the next heading line start without changing the full proposal", () => {
  const expectedContents = {
    HEAD01: "# Report\n\n## Results\n\n80 samples passed.\n\nReviewed.\n\n## Next\n\nKeep this section.",
    HEAD04: "# Report\n\n## Results\n\n80 samples passed.\n\nAudited.\n\n## Next\n\nKeep this section."
  };
  const bodies = { HEAD01: "Reviewed.", HEAD04: "Audited." };
  for (const id of ["HEAD01", "HEAD04"]) {
    const scenario = byId(id);
    const { from, to, expectedText, insertText } = scenario.expected.patch;
    assert.equal(from, scenario.source.indexOf("## Next"), id + " starts at the next heading line");
    assert.equal(to, from, id + " inserts without replacing source text");
    assert.equal(expectedText, "");
    assert.equal(insertText, bodies[id] + "\n\n");
    const proposed = scenario.source.slice(0, from) + insertText + scenario.source.slice(to);
    assert.equal(proposed, expectedContents[id], id + " keeps the exact intended Markdown layout");

    const formerBlankLineOffset = scenario.source.indexOf("\n\n## Next");
    const formerEquivalent = scenario.source.slice(0, formerBlankLineOffset) + "\n\n" + bodies[id] + scenario.source.slice(formerBlankLineOffset);
    assert.equal(proposed, formerEquivalent, id + " remains byte-for-byte equivalent to the previous boundary");

    const result = assess(scenario, observe("insert", bodies[id], {
      target: scenario.expected.target, patch: successfulPatch(scenario, bodies[id], insertText)
    }));
    assert.equal(result.lanes.thin.layers.scope.pass, true, id);
    assert.equal(result.lanes.thin.layers.parameters.pass, true, id);
  }
});

test("semantic first/last and heading target labels align with runner normalization", () => {
  const last = byId("REP02");
  const lastText = last.expected.exactText;
  const lastResult = assess(last, observe("replace", lastText, {
    target: "last_match", patch: successfulPatch(last, lastText)
  }));
  assert.equal(last.expected.target, "last_match");
  assert.equal(lastResult.lanes.thin.layers.scope.pass, true);
  assert.equal(assess(last, observe("replace", lastText, {
    target: "first_match", patch: successfulPatch(last, lastText)
  })).lanes.thin.layers.scope.pass, false);

  const first = byId("REP07");
  const firstResult = assess(first, observe("replace", first.expected.exactText, {
    target: "first_match", patch: successfulPatch(first, first.expected.exactText)
  }));
  assert.equal(first.expected.target, "first_match");
  assert.equal(firstResult.lanes.thin.layers.scope.pass, true);

  const heading = byId("HEAD01");
  const headingPatch = successfulPatch(heading, "Reviewed.", heading.expected.patch.insertText);
  const headingResult = assess(heading, observe("insert", "Reviewed.", {
    target: "heading:Results", patch: headingPatch
  }));
  assert.equal(heading.expected.target, "heading:Results");
  assert.equal(headingResult.lanes.thin.layers.scope.pass, true);
});

test("code contract checks H1/H2, explicit language aliases, and defined function name", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const scenario = byId("CODE01");
  const correct = "## 计算函数\n\n" + fence + "py\ndef add(a, b):\n    return a + b\n" + fence;
  assert.equal(assess(scenario, observe("insert", correct, { target: scenario.expected.target })).lanes.thin.layers.format.pass, true);

  const wrongLevel = correct.replace("## 计算函数", "# 计算函数");
  assert.equal(assess(scenario, observe("insert", wrongLevel, { target: scenario.expected.target })).lanes.thin.layers.parameters.pass, false);
  const headingAfterBlock = fence + "py\ndef add(a, b):\n    return a + b\n" + fence + "\n\n## 计算函数";
  assert.equal(assess(scenario, observe("insert", headingAfterBlock, { target: scenario.expected.target })).lanes.thin.layers.parameters.pass, false);
  const wrongName = correct.replace("def add(", "def a_plus_b(");
  assert.equal(assess(scenario, observe("insert", wrongName, { target: scenario.expected.target })).lanes.thin.layers.parameters.pass, false);
  const wrongLanguage = correct.replace(fence + "py", fence + "javascript");
  assert.equal(assess(scenario, observe("insert", wrongLanguage, { target: scenario.expected.target })).lanes.thin.layers.format.pass, false);
  const commentOnly = fence + "python\n# def add(a, b):\n" + fence;
  assert.equal(assess(scenario, observe("insert", commentOnly, { target: scenario.expected.target })).lanes.thin.layers.parameters.pass, false);

  const h1Case = byId("CODE02");
  const untagged = "# 运算\n\n" + fence + "\nconst total = 2;\n" + fence;
  assert.equal(assess(h1Case, observe("insert", untagged, { target: h1Case.expected.target })).lanes.thin.layers.format.pass, true);
  assert.equal(assess(h1Case, observe("insert", untagged.replace("# 运算", "## 运算"), { target: h1Case.expected.target })).lanes.thin.layers.parameters.pass, false);

  const tsCase = byId("CODE05");
  const ts = fence + "ts\nexport const formatName = (name: string) => name.trim();\n" + fence;
  assert.equal(assess(tsCase, observe("insert", ts, { target: tsCase.expected.target })).lanes.thin.layers.format.pass, true);
});

test("Markdown code-block headings, heading follow-up text, independent answers, and full-document polish are assessed", () => {
  const fence = String.fromCharCode(96).repeat(3);
  for (const id of ["CODE06", "CODE07"]) {
    const scenario = byId(id);
    const text = fence + "markdown\n# hello\n" + fence;
    const result = assess(scenario, observe("insert", text, {
      target: scenario.expected.target, patch: successfulPatch(scenario, text)
    }));
    assert.equal(result.lanes.thin.layers.task.pass, true, id);
    assert.equal(result.lanes.thin.layers.scope.pass, true, id);
    assert.equal(result.lanes.thin.layers.format.pass, true, id);
    assert.equal(result.lanes.thin.layers.parameters.pass, true, id);
    const wrongHeading = assess(scenario, observe("insert", text.replace("# hello", "## hello"), { target: scenario.expected.target }));
    assert.equal(wrongHeading.lanes.thin.layers.format.pass, true, id);
    assert.equal(wrongHeading.lanes.thin.layers.parameters.pass, false, id);
  }

  const heading = byId("HEAD06");
  const headingText = "## 状态\n\n准备发布";
  const headingResult = assess(heading, observe("insert", headingText, {
    target: heading.expected.target, patch: successfulPatch(heading, headingText)
  }));
  assert.equal(headingResult.lanes.thin.layers.format.pass, true);
  assert.equal(headingResult.lanes.thin.layers.parameters.pass, true);
  for (const omission of ["### 状态\n\n准备发布", "## 状态", "## 状态 准备发布"]) {
    const result = assess(heading, observe("insert", omission, { target: heading.expected.target }));
    assert.equal(result.lanes.thin.layers.parameters.pass, false, JSON.stringify(omission));
  }

  const answer = byId("ANS07");
  const answerResult = assess(answer, observe("answer", "Markdown 一级标题以 # 加空格开头，例如 # 标题。"));
  assert.equal(answerResult.lanes.thin.layers.task.pass, true);
  assert.equal(answerResult.lanes.thin.layers.quality.status, "needs_manual_review");

  const polish = byId("POL05");
  const polished = [
    "KEEP-OUTER-START",
    "",
    "The release notes need a careful review before shipment.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Status | draft |",
    "",
    "$$E = mc^2$$",
    "",
    fence + "js",
    "const sentinel = 'KEEP-CODE';",
    fence,
    "",
    "KEEP-OUTER-END"
  ].join("\n");
  const polishResult = assess(polish, observe("replace", polished, {
    target: "document", patch: successfulPatch(polish, polished)
  }));
  assert.equal(polish.entryAction, "polish");
  assert.equal(polishResult.lanes.thin.layers.task.pass, true);
  assert.equal(polishResult.lanes.thin.layers.scope.pass, true);
  assert.equal(polishResult.lanes.thin.layers.quality.status, "needs_manual_review");
  assert.deepEqual(polishResult.lanes.thin.layers.quality.factsForHumanReview, polish.expected.facts);
});

test("code artifacts reject incomplete nested fences but allow multiple complete fenced blocks", () => {
  const scenario = byId("CODE06");
  const incompleteNested = "````markdown\n# hello\n```python\nprint(1)\n````";
  const incompleteResult = assess(scenario, observe("insert", incompleteNested, {
    target: scenario.expected.target, patch: successfulPatch(scenario, incompleteNested)
  }));
  assert.equal(incompleteResult.lanes.thin.layers.format.pass, false);
  assert.equal(incompleteResult.lanes.thin.disposition, "failed");
  const incompleteAlias = incompleteNested.replace("markdown", "md");
  assert.equal(assess(scenario, observe("insert", incompleteAlias, {
    target: scenario.expected.target, patch: successfulPatch(scenario, incompleteAlias)
  })).lanes.thin.layers.format.pass, false);

  const completeNested = "````markdown\n# hello\n```python\nprint(1)\n```\n````";
  const nestedResult = assess(scenario, observe("insert", completeNested, {
    target: scenario.expected.target, patch: successfulPatch(scenario, completeNested)
  }));
  assert.equal(nestedResult.lanes.thin.layers.format.pass, true);
  assert.equal(nestedResult.lanes.thin.layers.parameters.pass, true);

  const multipleComplete = "```markdown\n# hello\n```\n\n```markdown\n# example\n```";
  const multipleResult = assess(scenario, observe("insert", multipleComplete, {
    target: scenario.expected.target, patch: successfulPatch(scenario, multipleComplete)
  }));
  assert.equal(multipleResult.lanes.thin.layers.format.pass, true);
  assert.equal(multipleResult.lanes.thin.layers.parameters.pass, true);
  assert.equal(multipleResult.lanes.thin.disposition, "completed");
});

test("table parameter checks ignore only numeric-to-unit spacing", () => {
  const scenario = byId("TABLE02");
  const table = (apple, banana, columns = "水果 | 价格") =>
    `| ${columns} |\n| --- | --- |\n| 苹果 | ${apple} |\n| 香蕉 | ${banana} |`;
  const compactPrices = table("3元/斤", "5元/斤");
  const compactResult = assess(scenario, observe("insert", compactPrices, { target: scenario.expected.target }));
  assert.equal(compactResult.lanes.thin.layers.format.pass, true);
  assert.equal(compactResult.lanes.thin.layers.parameters.pass, true);

  const wrongPrice = assess(scenario, observe("insert", table("4元/斤", "5元/斤"), { target: scenario.expected.target }));
  assert.equal(wrongPrice.lanes.thin.layers.parameters.pass, false);
  const missingUnit = assess(scenario, observe("insert", table("3", "5元/斤"), { target: scenario.expected.target }));
  assert.equal(missingUnit.lanes.thin.layers.parameters.pass, false);
  const wrongRows = assess(scenario, observe("insert", table("5元/斤", "3元/斤"), { target: scenario.expected.target }));
  assert.equal(wrongRows.lanes.thin.layers.parameters.pass, false);
  const wrongColumns = assess(scenario, observe("insert", table("3元/斤", "5元/斤", "物品 | 价格"), { target: scenario.expected.target }));
  assert.equal(wrongColumns.lanes.thin.layers.parameters.pass, false);
});

test("TABLE03 replacement scope is deterministic; English source cells expose a known oracle false positive", () => {
  const scenario = byId("TABLE03");
  assert.equal(scenario.instruction, "根据原文把水果和每斤价格转成两列表格，列名必须为水果、价格；不要增加第三种水果。");
  assert.equal(scenario.source, "# Fruit prices\n\nApples cost 3 yuan per jin; bananas cost 5 yuan per jin.");
  assert.equal(scenario.expected.effect, "replace");
  assert.equal(scenario.expected.target, "document");
  assert.deepEqual(scenario.expected.patch, {
    from: 0, to: scenario.source.length, expectedText: scenario.source
  });

  const table = "| 水果 | 价格 |\n| --- | --- |\n| 苹果 | 3 元/斤 |\n| 香蕉 | 5 元/斤 |";
  const replacementResult = assess(scenario, observe("replace", table, {
    target: "document", patch: successfulPatch(scenario, table)
  }));
  assert.equal(replacementResult.lanes.thin.layers.task.pass, true);
  assert.equal(replacementResult.lanes.thin.layers.scope.pass, true);
  assert.equal(replacementResult.lanes.thin.layers.format.pass, true);
  assert.equal(replacementResult.lanes.thin.layers.parameters.pass, true);

  const sourceLanguagePreserving = "| 水果 | 价格 |\n| --- | --- |\n| Apples | 3 yuan per jin |\n| Bananas | 5 yuan per jin |";
  const knownFalsePositive = assess(scenario, observe("replace", sourceLanguagePreserving, {
    target: "document", patch: successfulPatch(scenario, sourceLanguagePreserving)
  }));
  assert.equal(knownFalsePositive.lanes.thin.layers.format.pass, true);
  assert.equal(knownFalsePositive.lanes.thin.layers.parameters.pass, false,
    "Known TABLE03 scorer false positive: the English source labels are valid, but the frozen oracle expects unrequested Chinese translations; review separately and do not count as a model failure.");

  const appendResult = assess(scenario, observe("insert", table, {
    target: "document_end",
    patch: {
      from: scenario.source.length, to: scenario.source.length, expectedText: "", insertText: table,
      content: scenario.source + table
    }
  }));
  assert.equal(appendResult.lanes.thin.layers.task.pass, false);
  assert.equal(appendResult.lanes.thin.layers.scope.pass, false);
});

test("JSON, table captions, formula delimiters, Mermaid relations, and icon lists use explicit contracts", () => {
  const json = byId("JSON01");
  assert.equal(assess(json, observe("insert", '```json\n{"name":"Orion","active":true}\n```', { target: json.expected.target })).lanes.thin.layers.format.pass, true);
  const wrongJsonValue = assess(json, observe("insert", '```json\n{"name":"Orion","active":false}\n```', { target: json.expected.target }));
  assert.equal(wrongJsonValue.lanes.thin.layers.format.pass, true);
  assert.equal(wrongJsonValue.lanes.thin.layers.parameters.pass, false);

  const table = byId("TABLE02");
  const captioned = "水果价格（单位：元/斤）\n\n| 水果 | 价格 |\n| --- | --- |\n| 苹果 | 3 元/斤 |\n| 香蕉 | 5 元/斤 |";
  assert.equal(assess(table, observe("insert", captioned, { target: table.expected.target })).lanes.thin.layers.format.pass, true);
  const wrongTable = captioned.replace("| 苹果 | 3 元/斤 |", "| 苹果 | 8 元/斤 |");
  const wrongTableValue = assess(table, observe("insert", wrongTable, { target: table.expected.target }));
  assert.equal(wrongTableValue.lanes.thin.layers.format.pass, true);
  assert.equal(wrongTableValue.lanes.thin.layers.parameters.pass, false);
  const pipeTableCase = byId("TABLE05");
  const pipeTable = "| 标记 | 内容 |\n| --- | --- |\n| 任意标记 | A\\|B |";
  assert.equal(assess(pipeTableCase, observe("insert", pipeTable, { target: pipeTableCase.expected.target })).lanes.thin.layers.format.pass, true);
  assert.equal(assess(pipeTableCase, observe("insert", pipeTable.replace("A\\|B", "A\\|C"), { target: pipeTableCase.expected.target })).lanes.thin.layers.parameters.pass, false);
  const orderedRows = byId("TABLE06");
  const tableWithFreeHeaders = "| Any | Header |\n| --- | --- |\n| red | 1 |\n| blue | 2 |";
  assert.equal(assess(orderedRows, observe("insert", tableWithFreeHeaders, { target: orderedRows.expected.target })).lanes.thin.layers.format.pass, true);
  const wrongRowOrder = "| Any | Header |\n| --- | --- |\n| blue | 2 |\n| red | 1 |";
  assert.equal(assess(orderedRows, observe("insert", wrongRowOrder, { target: orderedRows.expected.target })).lanes.thin.layers.parameters.pass, false);

  const math = byId("MATH01");
  assert.equal(assess(math, observe("insert", "勾股关系：\n$$a^2 + b^2 = c^2$$", { target: math.expected.target })).lanes.thin.layers.format.pass, true);
  assert.equal(assess(math, observe("insert", "勾股关系：\na^2 + b^2 = c^2", { target: math.expected.target })).lanes.thin.layers.format.pass, false);
  const wrongFormula = assess(math, observe("insert", "勾股关系：\n$$a^2 + b^2 = d^2$$", { target: math.expected.target }));
  assert.equal(wrongFormula.lanes.thin.layers.format.pass, true);
  assert.equal(wrongFormula.lanes.thin.layers.parameters.pass, false);
  const flexibleMath = byId("MATH03");
  assert.equal(assess(flexibleMath, observe("insert", "$x_{n+1}=x_n+1$", { target: flexibleMath.expected.target })).lanes.thin.layers.format.pass, true);
  assert.equal(assess(flexibleMath, observe("insert", "$$x_{n+1}=x_n+1$$", { target: flexibleMath.expected.target })).lanes.thin.layers.format.pass, true);

  const mermaid = byId("MER01");
  const graph = "```mermaid\ngraph TD\n  start[开始] --> review[审核]\n  review --> done[结束]\n```";
  const assessMermaid = text => assess(mermaid, observe("insert", text, { target: mermaid.expected.target }));
  assert.equal(assessMermaid(graph).lanes.thin.layers.format.pass, true);
  assert.equal(assessMermaid(graph).lanes.thin.layers.parameters.pass, true, "plain labels match the requested nodes and edges");
  const wrongEdge = assess(mermaid, observe("insert", graph.replace("review --> done", "start --> done"), { target: mermaid.expected.target }));
  assert.equal(wrongEdge.lanes.thin.layers.format.pass, true);
  assert.equal(wrongEdge.lanes.thin.layers.parameters.pass, false);
  const wrongDirection = assess(mermaid, observe("insert", graph.replace("graph TD", "graph LR"), { target: mermaid.expected.target }));
  assert.equal(wrongDirection.lanes.thin.layers.format.pass, true);
  assert.equal(wrongDirection.lanes.thin.layers.parameters.pass, false);
  const quoted = "```mermaid\ngraph TD\n  Node1[\"开始\"]\n  Node2[\"审核\"]\n  Node3[\"结束\"]\n  Node1 --> Node2\n  Node2 --> Node3\n```";
  assert.equal(assessMermaid(quoted).lanes.thin.layers.parameters.pass, true, "standard quoted renderer labels are decoded");
  assert.equal(assessMermaid(quoted.replaceAll('["', '[#quot;').replaceAll('"]', "#quot;]")).lanes.thin.layers.parameters.pass, true,
    "renderer quote entities are decoded without evaluating Mermaid content");
  assert.equal(assessMermaid(quoted.replace('  Node3["结束"]\n', "")).lanes.thin.layers.parameters.pass, false, "a missing requested node fails parameters");
  assert.equal(assessMermaid(quoted.replace("  Node2 --> Node3\n", "")).lanes.thin.layers.parameters.pass, false, "a missing requested edge fails parameters");

  const icons = byId("ICON01");
  const list = "- ✅ 通过\n- ⚠️ 待确认\n- ❌ 失败";
  assert.equal(assess(icons, observe("insert", list, { target: icons.expected.target })).lanes.thin.layers.format.pass, true);
  assert.equal(assess(icons, observe("insert", list.replace("⚠️", "✅"), { target: icons.expected.target })).lanes.thin.layers.parameters.pass, false);
});

test("unrequested heading levels and unknown Mermaid semantics remain unconstrained", () => {
  const headings = byId("OPEN01");
  const mixedLevels = "# Goal\n\n### Steps\n\n## Risks";
  const mixedLevelResult = assess(headings, observe("insert", mixedLevels, { target: headings.expected.target }));
  assert.equal(mixedLevelResult.lanes.thin.layers.format.pass, true);
  assert.equal(mixedLevelResult.lanes.thin.layers.parameters.pass, true);

  const mermaid = byId("MER05");
  const fence = String.fromCharCode(96).repeat(3);
  const graph = fence + "mermaid\nflowchart LR\n  subgraph Complex\n    a{{Choice}} ==>|yes| b[(Store)]\n  end\n" + fence;
  const shapeResult = assess(mermaid, observe("insert", graph, { target: mermaid.expected.target }));
  assert.equal(shapeResult.lanes.thin.layers.format.pass, true);
  assert.equal(shapeResult.lanes.thin.layers.parameters.pass, true);
});

test("answer keywords and partial long-document facts remain manual-review items", () => {
  const qa = byId("ANS03");
  const keywordRichButWrong = "Iris 由王五负责，吴青负责复核。预算是 60 万元，而不是 6 万元。";
  const result = assess(qa, observe("answer", keywordRichButWrong));
  assert.equal(result.lanes.thin.layers.quality.status, "needs_manual_review");
  assert.equal(result.lanes.thin.disposition, "needs_manual_review");

  const long = byId("LONG01");
  const partial = "开篇决定：苍鹭站点由许宁负责；中段预算是 37 万元。";
  const partialResult = assess(long, observe("answer", partial));
  assert.equal(partialResult.lanes.thin.layers.quality.status, "needs_manual_review");
  assert.deepEqual(partialResult.lanes.thin.layers.quality.factsForHumanReview, long.expected.facts);
});

test("clarification is a safe stop, not completion; cancellation and truncation keep their distinct outcomes", () => {
  const ambiguous = byId("HEAD02");
  const clarified = assess(ambiguous, observe("clarify", "请指出要修改哪个‘结果’章节。"));
  assert.equal(clarified.lanes.thin.disposition, "safe_stop");
  assert.equal(clarified.lanes.thin.layers.task.pass, true);
  assert.notEqual(clarified.lanes.thin.disposition, "completed");

  const edit = byId("APP01");
  const refused = assess(edit, observe("clarify", "请确认是否追加。"));
  assert.equal(refused.lanes.thin.layers.task.pass, false, "refusal cannot count as completing a requested edit");

  const cancelCase = byId("CTL06");
  const cancelled = assess(cancelCase, observe("no_op", "", { completed: false, cancelled: true, calls: 0, program: true }));
  assert.equal(cancelled.lanes.thin.disposition, "safe_stop");
  assert.equal(cancelled.lanes.thin.layers.quality.status, "not_applicable");

  const truncated = assess(edit, observe("insert", "partial", { completed: false, truncated: true }));
  assert.equal(truncated.lanes.thin.disposition, "blocked_truncated");
  assert.equal(truncated.lanes.thin.layers.quality.status, "not_scored");
});

test("warnings keep a candidate reviewable and never authorize automatic writeback", () => {
  const scenario = byId("OPEN01");
  const draft = "## Goal\n\nA possible goal.\n\n## Steps\n\nReview it.\n\n## Risks\n\nUnknowns need review.";
  const warning = assess(scenario, observe("insert", draft, {
    target: scenario.expected.target, patch: successfulPatch(scenario, draft),
    warnings: ["meaning needs human review"], reviewable: true, autoApplied: false
  }));
  assert.equal(warning.lanes.thin.disposition, "needs_manual_review");
  assert.equal(warning.lanes.thin.layers.writeSafety.pass, true);

  const autoApplied = assess(scenario, observe("insert", draft, {
    target: scenario.expected.target, patch: successfulPatch(scenario, draft),
    warnings: ["meaning needs human review"], reviewable: true, autoApplied: true
  }));
  assert.equal(autoApplied.lanes.thin.layers.writeSafety.pass, false);
});

test("all three strategy outcomes and every failure layer remain visible", () => {
  const scenario = byId("JSON01");
  const valid = '```json\n{"name":"Orion","active":true}\n```';
  const result = assessThinExecutionCase(scenario, {
    direct: observe("insert", valid, { target: scenario.expected.target }),
    thin: observe("insert", '```json\n{"name":"Orion","active":false}\n```', { target: scenario.expected.target }),
    full: observe("clarify", "Need more context.")
  });
  assert.deepEqual(Object.keys(result.lanes), ["direct", "thin", "full"]);
  assert.equal(result.lanes.direct.layers.format.pass, true);
  assert.equal(result.lanes.thin.layers.format.pass, true);
  assert.equal(result.lanes.thin.layers.parameters.pass, false);
  assert.equal(result.lanes.full.layers.task.pass, false);
  assert.ok(result.lanes.thin.failedLayers.includes("parameters"));
  assert.deepEqual(result.comparison.strategies.map(({ name }) => name), ["direct", "thin", "full"]);
});
