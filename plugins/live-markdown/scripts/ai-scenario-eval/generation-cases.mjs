// Authored expectations precede inference. Facts are fixture data, never model-derived.
const planning = 1;
const calls = (contentMin = 1, contentMax = 1) => ({ planning, contentMin, contentMax });
const append = (source) => ({ from: source.length, to: source.length, expectedText: "" });
const intent = (kind, task, target = "document") => ({ kind, target, mode: "generate", task });
const insertion = (task, target = "document_end") => ({ ...intent("edit", task, target), operation: "insert", layout: "block" });
const rewrite = (task, target = "document") => ({ ...intent("edit", task, target), operation: "rewrite" });
const groups = (...requiredGroups) => ({ requiredGroups, forbiddenPatterns: ["LOCAL_AI_", "忽略用户要求"], forbidFullSourceCopy: true });
const summarySource = "# 交付记录\n\nOrion 项目由林安负责。预算是 9 万元。计划在 2026-11-12 发布。发布前必须完成备份与恢复演练。";
const summaryQuality = groups(["Orion"], ["林安"], ["9\\s*万"], ["2026[-年/]11[-月/]12"]);
const tableSource = "# 水果定价\n\n苹果每斤 3 元，香蕉每斤 5 元。价格字段以元每斤为单位。";
const mermaidSource = "# 审核流程\n\n流程只有三步，依次为开始、审核、结束，不存在分支。";
const mathSource = "# 几何笔记\n\n研究直角三角形，两条直角边记作 a 和 b，斜边记作 c。\n\n已有公式：$S=ab/2$。";
const codeSource = "# Python 教程\n\n需要一个函数接收两个数并返回它们的和，函数名为 add，参数名为 a 和 b。";
const selectedSource = "# 选区润色\n\n前文哨兵 KEEP-BEFORE。\n\n我们以经完成备份，接下来会对恢复步骤进行检查。\n\n后文哨兵 KEEP-AFTER。";
const selectedText = "我们以经完成备份，接下来会对恢复步骤进行检查。";
const selectedFrom = selectedSource.indexOf(selectedText);
const richSource = [
  "---", "title: Orion", "author: 林安", "---", "", "# 发布说明 ✨", "",
  "我们以经完成 42 项检查，发布日期为 2026-11-12。备份资料的处里流程已经确认。", "",
  "- [x] 保存副本", "- [ ] 检查恢复路径", "", "| 项目 | 数量 |", "| --- | --- |", "| 检查 | 42 |", "",
  "```ts", "const total: number = 42;", "```", "", "公式 $x^2+y^2=z^2$ 不变。", "",
  "[部署手册](https://docs.example.test/orion) 与 ![图标](./assets/icon.png) 均需保留。", "",
  "检查细节见脚注[^1]。", "", "[^1]: 检查需要两人复核。"
].join("\n");
const richProtected = [
  "---\ntitle: Orion\nauthor: 林安\n---", "| 项目 | 数量 |\n| --- | --- |\n| 检查 | 42 |",
  "```ts\nconst total: number = 42;\n```", "$x^2+y^2=z^2$", "https://docs.example.test/orion",
  "![图标](./assets/icon.png)", "[^1]:", "- [x]", "- [ ]"
];
const longFacts = ["开篇决定：苍鹭站点由许宁负责。", "中段决定：海盐预算为 37 万元。", "末段决定：琥珀验收截止日期是 2026-12-19。"];
const longSource = Array.from({ length: 28 }, (_, index) => {
  const fact = index === 0 ? longFacts[0] : index === 14 ? longFacts[1] : index === 27 ? longFacts[2] : "本节没有新增决策。";
  const background = "工作记录强调变更前保存副本、核对依赖、记录验收结果并保持可恢复路径。日常沟通需要区分已确认事实和待验证事项，所有结论都应有对应证据。";
  return `## 阶段 ${index + 1}\n\n${fact}\n\n${background.repeat(6)}`;
}).join("\n\n");
const longQuality = { ...groups(["苍鹭", "许宁"], ["海盐"], ["37\\s*万"], ["琥珀"], ["2026[-年/]12[-月/]19"]), requiredAll: ["苍鹭", "许宁"], maxCharacters: 1800 };
const polishSource = Array.from({ length: 8 }, (_, index) => {
  const paragraph = `C0${index + 1}：我们以经记录本轮工作，现阶段需要对处理流程进行进一步的梳理。` +
    "参与人员应该在开始前核对输入内容，并在执行结束后保留验收记录。现有事实和数字必须保持稳定，不能因为表达调整而改变结论。".repeat(4);
  return index === 3 ? `${paragraph}\n\n\`\`\`js\nconst sentinel = "KEEP-CODE";\n\`\`\`` : paragraph;
}).join("\n\n");
const selectionSummarySource = "# 外部上下文\n\n外部哨兵 OUTSIDE-ZEBRA，预算 888 万元。\n\n选区项目名为 Iris，由吴青负责，预算为 6 万元，先备份再上线。\n\n后文哨兵 OUTSIDE-WHALE，发布日期 2099-01-01。";
const summarySelection = "选区项目名为 Iris，由吴青负责，预算为 6 万元，先备份再上线。";
const sectionSource = "# 实验报告\n\n## 结果\n\n样本量为 80，成功数量为 72。\n\n## 后续\n\n保留后续章节原文。";
const sectionOffset = sectionSource.indexOf("## 后续");
const techSource = "# Orion 方案背景\n\n负责人林安，预算 9 万元，目标是在离线环境处理 Markdown。设备内存只有 8GB。不得向外部发送文稿，风险是内存不足与模型输出失真。";
const pureCode = "```python\nanswer = 42\n```";

export const generationCases = [
  { id: "G01", family: "generated-append", title: "生成摘要仅在全文末尾新增", instruction: "在全文末尾新增一段摘要，概括项目名、负责人、预算和发布日期。保留原文。", source: summarySource, selection: null,
    expected: { intent: insertion("summarize"), effect: "generated_patch", patch: append(summarySource), quality: summaryQuality, calls: calls() } },
  { id: "G02", family: "generated-answer", title: "总结只回答而不改写文档", instruction: "请总结全文的项目名、负责人、预算和发布日期，只回答，不修改文档。", source: summarySource, selection: null,
    expected: { intent: intent("answer", "summarize"), effect: "answer", quality: summaryQuality, calls: calls() } },
  { id: "G03", family: "rich-table", title: "从正文事实生成 Markdown 价格表", instruction: "在文末生成 Markdown 表格，列名为水果和价格，列出上下文里的两种水果及每斤价格。", source: tableSource, selection: null,
    expected: { intent: { ...insertion("custom"), taskAnyOf: ["custom", "diagram"] }, effect: "generated_patch", patch: append(tableSource), quality: { ...groups(["水果"], ["价格"], ["苹果[^\\n]*3"], ["香蕉[^\\n]*5"]), markdownKind: "table" }, calls: calls() } },
  { id: "G04", family: "rich-mermaid", title: "新增 Mermaid 三步流程图", instruction: "根据本文在文末生成 Mermaid 流程图，用 mermaid 代码围栏输出，包含开始、审核、结束三个节点。", source: mermaidSource, selection: null,
    expected: { intent: insertion("diagram"), effect: "generated_patch", patch: append(mermaidSource), quality: { ...groups(["开始"], ["审核"], ["结束"]), markdownKind: "mermaid" }, calls: calls() } },
  { id: "G05", family: "rich-math", title: "新增勾股定理解释并保留已有面积公式", instruction: "在文末生成一段直角三角形的勾股定理解释，使用 LaTeX 数学公式表达三条边的关系。", source: mathSource, selection: null,
    expected: { intent: insertion("custom"), effect: "generated_patch", patch: append(mathSource), quality: { ...groups(["直角"]), markdownKind: "math" }, calls: calls() } },
  { id: "G06", family: "rich-code", title: "生成带语言标识的 Python 代码", instruction: "在文末生成本文需要的 Python 函数，使用 python 代码围栏，只生成代码和简短说明。", source: codeSource, selection: null,
    expected: { intent: insertion("custom"), effect: "generated_patch", patch: append(codeSource), quality: { ...groups(), markdownKind: "python" }, calls: calls() } },
  { id: "G07", family: "generated-selection", title: "选区润色并纠正错别字", instruction: "润色当前选区，纠正错别字，保持原意。", source: selectedSource, selection: { from: selectedFrom, to: selectedFrom + selectedText.length }, selectionValid: true,
    expected: { intent: rewrite("polish", "selection"), effect: "generated_patch", patch: { from: selectedFrom, to: selectedFrom + selectedText.length, expectedText: selectedText }, quality: { ...groups(["已经"], ["备份"], ["恢复"]), forbiddenPatterns: ["以经", "KEEP-BEFORE", "KEEP-AFTER"] }, calls: calls() } },
  { id: "G08", family: "rich-proofread", title: "富文本全文校对并保护结构与事实", instruction: "校对全文，纠正中文错别字，保留所有 Markdown 结构、数字、日期、图标、链接、代码和公式。", source: richSource, selection: null,
    expected: { intent: rewrite("proofread"), effect: "generated_patch", patch: { from: 0, to: richSource.length, expectedText: richSource }, quality: { ...groups(["已经"], ["处理"], ["42"], ["2026-11-12"]), requiredAll: richProtected, forbiddenPatterns: ["以经", "处里"] }, calls: calls(1, 8) } },
  { id: "G09", family: "long-summary", title: "长文分片摘要保留开篇中段末段决策", instruction: "总结全文的三项决定，包含开篇、中段、末段的关键实体、负责人、金额和日期。忽略重复背景，只回答，不修改文档。", source: longSource, selection: null,
    expected: { intent: intent("answer", "summarize"), effect: "answer", quality: longQuality, calls: calls(2, 30) } },
  { id: "G10", family: "long-append", title: "长文分片摘要最终只追加一次", instruction: "在全文末尾新增总结，涵盖开篇、中段、末段的三项决定，保留关键实体、负责人、金额和日期，不重复背景，不修改原文。", source: longSource, selection: null,
    expected: { intent: insertion("summarize"), effect: "generated_patch", patch: append(longSource), quality: longQuality, calls: calls(2, 30) } },
  { id: "G11", family: "long-paragraph-polish", title: "逐段多次润色保持所有段落顺序", instruction: "润色全文并纠正错别字，保留所有 C01 到 C08 段落标识及顺序、原有事实和代码。", source: polishSource, selection: null, granularity: "paragraph",
    expected: { intent: rewrite("polish"), effect: "generated_patch", patch: { from: 0, to: polishSource.length, expectedText: polishSource }, quality: { ...groups(["已经"]), requiredAll: ['```js\nconst sentinel = "KEEP-CODE";\n```'], ordered: Array.from({ length: 8 }, (_, i) => `C0${i + 1}`), forbiddenPatterns: ["以经"] }, calls: calls(8, 16) } },
  { id: "G12", family: "selected-answer", title: "仅总结选区不泄入外部事实", instruction: "只总结当前选区，保留项目名、负责人、预算和上线前置步骤，只回答不修改。", source: selectionSummarySource, selection: { from: selectionSummarySource.indexOf(summarySelection), to: selectionSummarySource.indexOf(summarySelection) + summarySelection.length }, selectionValid: true,
    expected: { intent: intent("answer", "summarize", "selection"), effect: "answer", quality: { ...groups(["Iris"], ["吴青"], ["6\\s*万"], ["备份"]), forbiddenPatterns: ["OUTSIDE-", "888", "2099"] }, calls: calls() } },
  { id: "G13", family: "generated-section", title: "在唯一章节末尾增加结果摘要", instruction: "在“结果”章节末尾生成一段摘要，说明样本数与成功数，不更改其他章节。", source: sectionSource, selection: null,
    expected: { intent: { ...insertion("summarize", "section_end"), expectedHeading: { text: "结果", matchingOrdinal: 1, lineFrom: sectionSource.indexOf("## 结果") } }, effect: "generated_patch", patch: { from: sectionOffset, to: sectionOffset, expectedText: "" }, quality: groups(["80"], ["72"]), calls: calls() } },
  { id: "G14", family: "technical-spec", title: "新增技术方案保持事实与约束", instruction: "在全文末尾生成技术方案，使用目标、方案、风险三个 Markdown 标题。严格基于原文事实与约束。", source: techSource, selection: null,
    expected: { intent: insertion("tech-spec"), effect: "generated_patch", patch: append(techSource), quality: { ...groups(["目标"], ["方案"], ["风险"], ["8\\s*GB"], ["离线|本地"], ["外部|隐私|出网"]), markdownKind: "headings" }, calls: calls() } },
  { id: "G15", family: "protected-only-polish", title: "仅含代码的全文润色不发正文调用", instruction: "润色全文的自然语言，保持代码完全不变。", source: pureCode, selection: null,
    expected: { intent: rewrite("polish"), effect: "no_change", noChangePatterns: ["没有改变原文", "没有可处理的 Markdown 文本"], calls: calls(0, 0) } },
  { id: "G16", family: "contextual-continue", title: "基于上下文生成下一步而不重复原文", instruction: "在文末续写一个下一步行动段落，沿用本文项目事实，提出发布前的具体检查事项。不要重复原文或杜撰数字与日期。", source: summarySource, selection: null,
    expected: { intent: insertion("continue"), effect: "generated_patch", patch: append(summarySource), quality: { ...groups(["备份|恢复"], ["检查|验证|核对|演练"]), allowedAmounts: [9], allowedDates: ["2026-11-12"], forbidSourceParagraphs: true }, calls: calls() } }
];
