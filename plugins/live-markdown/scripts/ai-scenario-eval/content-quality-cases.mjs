import { contentExecutorCases } from "./content-executor-cases.mjs";

export const originalQualityIds = ["CODE01", "OPEN01", "ANS01", "ANS03", "LONG01", "ANS07", "POL05",
  "B31-CODE-H2", "B31-CODE-H4", "B31-HEAD-ZH-ORDER", "B31-JSON-FALSE-NULL", "B31-TABLE-PRICE",
  "B31-FACT-SAME-AMOUNT", "B31-POL-INLINE-ATOMS", "B31-POL-CRLF-STRUCTURE", "B31-LONG-COVERAGE"];
const source = "# Notes\n\nPRIVATE_SOURCE is unchanged.";
const insert = artifact => ({ effect: "insert", target: "document_end", unchangedOutside: true,
  patch: { from: source.length, to: source.length, expectedText: "" }, artifact });
function fixture(id, instruction, text, expected, entryAction = "command") {
  return { id, family: "b32-quality-variants", instruction, source: text, selection: null, cursor: null,
    entryAction, skill: null, preconditions: null, expected, live: true, livePriority: 100,
    executionMode: "live", liveModels: 2 };
}
const headings = (names, level = 2) => ({ type: "headings", headings: names.map(text => ({ text, level })) });
function polish(id, text, facts) {
  return fixture(id, "润色并纠正可读正文的语法错误，保留已有 Markdown 格式、代码、链接目标、公式和数字不变。", text,
    { effect: "replace", target: "document", patch: { from: 0, to: text.length, expectedText: text },
      semanticReview: true, facts }, "polish");
}

export const qualityVariants = [
  fixture("B32-HEAD-EN", "Add these two H2 headings at the end, in order: Compatibility Review, Next Actions. Add headings only.", source,
    insert(headings(["Compatibility Review", "Next Actions"]))),
  fixture("B32-HEAD-QUOTE", "在文末新增两个 H3 标题：“API, tools”、“R&D and QA”。只需要标题。", source,
    insert(headings(["API, tools", "R&D and QA"], 3))),
  fixture("B32-HEAD-REPEAT", "在文末新增两个 H2 标题：“状态”、“状态”。只需要标题。", source,
    insert(headings(["状态", "状态"]))),
  fixture("B32-HEAD-MISMATCH", "在文末新增两个 H2 标题：甲、乙、丙。只需要标题。", source,
    { effect: "clarify", unchangedOutside: true }),
  fixture("B32-JSON-NESTED", "在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 config:{\"limit\":3,\"tags\":[\"青\",\"蓝\"]}。", source,
    insert({ type: "json", value: { enabled: false, owner: null, config: { limit: 3, tags: ["青", "蓝"] } } })),
  fixture("B32-JSON-UNICODE", "在文末追加 JSON 对象，仅包含 label:“🧪测试”、active:false 和 note:“keep and add 原样”三个字段。", source,
    insert({ type: "json", value: { label: "🧪测试", active: false, note: "keep and add 原样" } })),
  fixture("B32-JSON-ARRAY", "只在文末输出 JSON 数组 [false, null, \"pending\", 3]，保持顺序。", source,
    insert({ type: "json", value: [false, null, "pending", 3] })),
  fixture("B32-JSON-DYNAMIC", "在文末生成一个任务配置 JSON 对象，仅包含 taskName 和 retryCount，任务名自行拟定，重试次数为 3。", source,
    { ...insert({ type: "json" }), semanticReview: true, facts: ["仅含 taskName、retryCount", "taskName 为有意义的字符串", "retryCount 为数字 3"] }),
  polish("B32-POL-EMPHASIS", "The **deployment** have a problem. Keep `R17` unchanged.", ["deployment has a problem", "强调与R17保留"]),
  polish("B32-POL-LINK", "These [release notes](https://internal.invalid/release) needs review.", ["release notes need review", "链接目标原样"]),
  polish("B32-POL-NUMBER", "The release have 3 stages, and each stage need approval.", ["release has 3 stages", "each stage needs approval", "数字3不变"]),
  polish("B32-POL-ZH", "这个发布计划的内容有一点点过于的重复重复，请大家进行一下复核。", ["减少重复和冗余", "不添加事实"]),
  fixture("B32-POL-CORRECT", "校对正文，只纠正明确语法错误；已经正确的句子保持原样。", "The release notes need a review.",
    { effect: "no_op", semanticReview: true, facts: ["正确句子可以no-op"] }, "proofread"),
  fixture("B32-OPEN-ZH", "在文末写一个发布演练草案，按顺序用小标题 目标、步骤、风险 组织。不要复述指令或使用占位内容。", source,
    { ...insert(headings(["目标", "步骤", "风险"])), semanticReview: true, facts: ["目标说明演练目的", "步骤可执行", "风险有具体场景"] }),
  fixture("B32-TABLE-EN-UNITS", "根据原文生成两列表格，列名 Product、Price，保留商品与完整价格及单位。", "Cedar costs 10 yuan per month; Maple costs 20 yuan per month.",
    { effect: "replace", target: "document", semanticReview: true, artifact: { type: "table", columns: ["Product", "Price"], rows: [["Cedar", "10 yuan per month"], ["Maple", "20 yuan per month"]] } }),
  fixture("B32-TABLE-SAME-AMOUNT", "根据原文生成两列表格，列名 Product、Price，不能交换商品与币种的关系。", "Cedar costs 10 USD; Maple costs 10 CNY.",
    { effect: "replace", target: "document", semanticReview: true, artifact: { type: "table", columns: ["Product", "Price"], rows: [["Cedar", "10 USD"], ["Maple", "10 CNY"]] } })
];

export const contentQualityCases = [
  ...contentExecutorCases.filter(({ id }) => originalQualityIds.includes(id)),
  ...qualityVariants.map((item, index) => ({ ...item, livePriority: 100 + index }))
];
export const contentQualityMatrixSummary = Object.freeze({ originalCaseCount: originalQualityIds.length,
  addedCaseCount: qualityVariants.length, caseCount: contentQualityCases.length,
  liveCaseCount: contentQualityCases.length, liveCaseIds: contentQualityCases.map(({ id }) => id) });
