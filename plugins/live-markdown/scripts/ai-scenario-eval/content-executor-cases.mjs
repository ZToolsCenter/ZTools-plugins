import { thinExecutionCases, thinExecutionMatrixSummary } from "./thin-execution-cases.mjs";

const source = {
  plain: "# Working notes\n\nReview is underway.",
  code: "# API notes\n\nThe input is validated before the request runs.",
  headings: "# Release\n\n## Context\n\nExisting context.\n\n## Archive\n\nKeep this section.",
  price: "# Current prices\n\nCedar costs 10 yuan. Maple costs 20 yuan.",
  sameAmount: "Cedar 由林安负责，预算 30 万元。\n\nMaple 由周岚负责，预算也是 30 万元。",
  unknownStatus: "This excerpt is partial.\n\nOrion has an assigned owner, Min Lee. Its status is not included here.",
  inlinePolish: "The **release note** need a check. Keep `v2.1` exact; the [docs](https://internal.invalid/r3) and formula $x^2$ remain. 🧪",
  crlfPolish: [
    "---", "title: preserve", "---", "", "OPEN-EDGE", "", "The release notes needs a review.", "",
    "Date: 2026-11-03; budget: 14 万元.", "", "| key | value |", "| --- | --- |", "| status | draft |", "",
    "$$E = mc^2$$", "", "```ts", "const sentinel = 'KEEP';", "```", "", "CLOSE-EDGE"
  ].join("\r\n"),
  markerPolish: "OPEN-EDGE\n\nThe checklist need review.\n\nCLOSE-EDGE",
  appendix: "The partial excerpt names Falcon but assigns no build number to Raven. It may omit other pages.",
  readonly: "# Locked notes\n\nThis file is read-only."
};

const longFacts = [
  ["## 01 开篇", "开篇决定：苍鹭站点由许宁负责，状态为准备中。"],
  ["## 02 记录", "本节只说明背景材料已归档。"],
  ["## 03 记录", "本节只说明会议按计划举行。"],
  ["## 04 记录", "本节记录一次常规复核。"],
  ["## 05 记录", "本节未增加决定。"],
  ["## 06 记录", "本节只补充流程背景。"],
  ["## 07 记录", "本节重复说明资料来自工作组。"],
  ["## 08 记录", "本节只说明负责人需要复查。"],
  ["## 09 中段", "中段决定：海盐预算为 37 万元，采购人是周岚。"],
  ["## 10 记录", "本节只说明执行顺序未变。"],
  ["## 11 记录", "本节补充普通进度信息。"],
  ["## 12 记录", "本节说明仍在核对来源。"],
  ["## 13 记录", "本节没有新增金额。"],
  ["## 14 记录", "本节只重复背景约束。"],
  ["## 15 记录", "本节说明归档工作继续。"],
  ["## 16 记录", "本节只列出后续复查。"],
  ["## 17 记录", "本节未增加新的日期。"],
  ["## 18 末段", "末段决定：琥珀验收截止日期为 2026-12-19。"]
];
const longSource = longFacts.map(([heading, paragraph]) => `${heading}\n\n${paragraph}\n\n背景说明：此处保留跨阶段记录，复核时应以明确标注的决定为准。`).join("\n\n");

const span = (text, from, to = from) => ({ from, to, expectedText: text.slice(from, to) });
const append = (text, extra = {}) => ({
  effect: "insert", target: "document_end", patch: span(text, text.length), unchangedOutside: true, ...extra
});
const rewrite = (text, extra = {}) => ({
  effect: "replace", target: "document", patch: span(text, 0, text.length), unchangedOutside: false, ...extra
});
function scenario(id, family, instruction, text, expected, options = {}) {
  const live = options.live === true;
  return {
    id, family, instruction, source: text, selection: options.selection ?? null, cursor: options.cursor ?? null,
    entryAction: options.entryAction ?? "command", skill: options.skill ?? null,
    preconditions: options.preconditions ?? null, expected, live,
    livePriority: live ? options.livePriority : null,
    executionMode: live ? "live" : "controlled", liveModels: live ? 2 : 0
  };
}

export const addedContentExecutorCases = [
  scenario("B31-CODE-H2", "content-code-contract", "在文末新增 Markdown 二级标题“API <v2> & C++”，其后放 TypeScript 代码围栏并定义 greetUser 函数。", source.code,
    append(source.code, { format: "code", artifact: { type: "code", language: "typescript", functionName: "greetUser", heading: { level: 2, text: "API <v2> & C++" } }, semanticReview: true }), { live: true, livePriority: 26 }),
  scenario("B31-CODE-H4", "content-code-contract", "在文末用四级标题“接口 (v2) [beta]”，随后用 Python 代码围栏定义 run_check。", source.code,
    append(source.code, { format: "code", artifact: { type: "code", language: "python", functionName: "run_check", heading: { level: 4, text: "接口 (v2) [beta]" } }, semanticReview: true }), { live: true, livePriority: 27 }),
  scenario("B31-HEAD-ZH-ORDER", "content-heading-order", "按顺序在文末新增两个 H2 标题：迁移观察、后续计划。只需要标题。", source.headings,
    append(source.headings, { format: "headings", artifact: { type: "headings", headings: [{ level: 2, text: "迁移观察" }, { level: 2, text: "后续计划" }] } }), { live: true, livePriority: 28 }),
  scenario("B31-HEAD-EN-ORDER", "content-heading-order", "Add these two H2 headings at the end, in order: Compatibility Review, Next Actions. Add headings only.", source.headings,
    append(source.headings, { format: "headings", artifact: { type: "headings", headings: [{ level: 2, text: "Compatibility Review" }, { level: 2, text: "Next Actions" }] } })),
  scenario("B31-JSON-FALSE-NULL", "content-json-primitives", "在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。", source.plain,
    append(source.plain, { format: "json", artifact: { type: "json", value: { enabled: false, owner: null, tags: ["青", "蓝"] } } }), { live: true, livePriority: 29 }),
  scenario("B31-JSON-ARRAY-PRIMITIVES", "content-json-primitives", "只在文末输出 JSON 数组 [false, null, \"pending\", 3]，保持顺序。", source.plain,
    append(source.plain, { format: "json", artifact: { type: "json", value: [false, null, "pending", 3] } })),
  scenario("B31-JSON-NULL", "content-json-primitives", "文末只输出 JSON 原始值 null，不要对象或代码围栏。", source.plain,
    append(source.plain, { format: "json", artifact: { type: "json", value: null } })),
  scenario("B31-TABLE-PIPE", "content-table-cells", "在文末创建一行 Markdown 表格，列名 Key、Value；Value 单元格必须是字面值 A|B，用转义竖线保存在一个单元格内。", source.plain,
    append(source.plain, { format: "table", artifact: { type: "table", columns: ["Key", "Value"], requiredCells: [{ column: "Value", value: "A|B" }] } })),
  scenario("B31-TABLE-BREAK", "content-table-cells", "在文末创建一行 Markdown 表格，列名 Field、Note；Note 单元格内容为“line one 换行 line two”，用字面 <br> 表示单元格内换行。", source.plain,
    append(source.plain, { format: "table", artifact: { type: "table", columns: ["Field", "Note"], requiredCells: [{ column: "Note", value: "line one<br>line two" }] } })),
  scenario("B31-TABLE-PRICE", "content-table-source-values", "根据原文生成两列表格，列名 Product、Price；仅列 Cedar 10 yuan 和 Maple 20 yuan，价格必须分别对应原文。", source.price,
    rewrite(source.price, { format: "table", artifact: { type: "table", columns: ["Product", "Price"], rows: [["Cedar", "10 yuan"], ["Maple", "20 yuan"]] } }), { live: true, livePriority: 30 }),
  scenario("B31-FACT-SAME-AMOUNT", "content-source-relations", "只回答 Cedar 和 Maple 各自的负责人及预算；两个预算金额相同，不能把负责人对应关系互换。", source.sameAmount,
    { effect: "answer", facts: ["Cedar 由林安负责，预算 30 万元", "Maple 由周岚负责，预算 30 万元"], semanticReview: true }, { live: true, livePriority: 31 }),
  scenario("B31-FACT-UNKNOWN-STATUS", "content-source-unknown", "这段摘录是否说明 Orion 当前状态？只说明摘录里能确认的内容；不要把摘录未提及写成全文都不存在。", source.unknownStatus,
    { effect: "answer", facts: ["摘录未提供 Orion 状态", "不能据此断言完整文档没有状态信息"], semanticReview: true }),
  scenario("B31-POL-INLINE-ATOMS", "content-polish-preservation", "只润色可读正文，保留强调格式、`v2.1`、链接目标、公式和 🧪 原样；不要改写结构。", source.inlinePolish,
    rewrite(source.inlinePolish, { format: "markdown", facts: ["粗体边界不变", "v2.1 不变", "链接目标 https://internal.invalid/r3 不变", "公式 $x^2$ 不变", "emoji 🧪 不变"], semanticReview: true }), { entryAction: "polish", live: true, livePriority: 32 }),
  scenario("B31-POL-CRLF-STRUCTURE", "content-polish-preservation", "润色可读正文，保留 CRLF 换行、frontmatter、表格、公式、代码和边缘标记原样。", source.crlfPolish,
    rewrite(source.crlfPolish, { format: "markdown", facts: ["CRLF 行结束符保留", "frontmatter、表格、公式、代码逐字节保留", "OPEN-EDGE/CLOSE-EDGE 标记保留"], semanticReview: true }), { entryAction: "polish", live: true, livePriority: 33 }),
  scenario("B31-POL-OUTER-MARKERS", "content-polish-preservation", "Polish the readable prose but preserve the first and last document markers exactly as written.", source.markerPolish,
    rewrite(source.markerPolish, { format: "markdown", facts: ["首尾标记原样保留", "中间正文可润色"], semanticReview: true }), { entryAction: "polish" }),
  scenario("B31-LONG-COVERAGE", "content-long-source-coverage", "只回答全文开篇、中段、末段明确决定的实体及负责人、预算或截止日期，按三个位置分别作答。不要把背景重复句当成决定。", longSource,
    { effect: "answer", facts: ["开篇：苍鹭站点由许宁负责，状态为准备中", "中段：海盐预算 37 万元，采购人为周岚", "末段：琥珀验收截止日期 2026-12-19"], semanticReview: true }, { live: true, livePriority: 34 }),
  scenario("B31-LONG-SAME-AMOUNT", "content-long-source-coverage", "阅读全文，分别列出 Cedar 和 Maple 的负责人及预算；不要因金额相同而交换主体关系。", `${longSource}\n\n## 附录：预算对照\n\nCedar 由林安负责，预算 30 万元。Maple 由周岚负责，预算也是 30 万元。`,
    { effect: "answer", facts: ["Cedar—林安—30 万元", "Maple—周岚—30 万元"], semanticReview: true }),
  scenario("B31-FACT-UNKNOWN-BUILD", "content-source-unknown", "What exact build number is assigned to Raven? Answer only from this excerpt; distinguish an unreported value from proof that the complete document lacks it.", source.appendix,
    { effect: "answer", facts: ["Raven build number is unknown in this excerpt", "do not claim the full document contains no build number"], semanticReview: true }),
  scenario("B31-CONTROL-CANCEL", "content-control", "生成期间用户点击取消；不要应用迟到的候选内容。", source.plain,
    { effect: "no_op", unchangedOutside: true }, { entryAction: "cancel", preconditions: { cancelDuringGeneration: true } }),
  scenario("B31-CONTROL-READONLY", "content-control", "在文末添加一段状态说明。", source.readonly,
    { effect: "clarify", target: "document_end", unchangedOutside: true }, { preconditions: { readOnly: true } })
];

export const contentExecutorCases = [...thinExecutionCases, ...addedContentExecutorCases];
export const contentExecutorCaseMatrix = contentExecutorCases.map(({ id, family, instruction, expected, live, livePriority, executionMode }) => ({
  id, family, instruction, effect: expected.effect, live, livePriority, executionMode
}));
export const contentExecutorMatrixSummary = Object.freeze({
  caseCount: contentExecutorCases.length,
  originalCaseCount: thinExecutionCases.length,
  addedCaseCount: addedContentExecutorCases.length,
  familyCount: new Set(contentExecutorCases.map(({ family }) => family)).size,
  liveCaseIds: contentExecutorCases.filter(({ live }) => live).map(({ id }) => id),
  liveCaseCount: contentExecutorCases.filter(({ live }) => live).length,
  addedLiveCaseCount: addedContentExecutorCases.filter(({ live }) => live).length,
  controlledCaseCount: contentExecutorCases.filter(({ live }) => !live).length,
  strategyCount: 3,
  liveModelsPerScenario: 2,
  estimatedLiveComparisons: contentExecutorCases.filter(({ live }) => live).length * 3 * 2
});

if (thinExecutionCases.length !== 79 || thinExecutionMatrixSummary.caseCount !== 79 || addedContentExecutorCases.length < 20) {
  throw new Error("B31 must retain the frozen 79-case B30 matrix and add at least 20 independent cases.");
}
if (contentExecutorMatrixSummary.addedLiveCaseCount > 10 || contentExecutorMatrixSummary.estimatedLiveComparisons > 210) {
  throw new Error("B31 live routes exceed the authorized comparison budget.");
}
