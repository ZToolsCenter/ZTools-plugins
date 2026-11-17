import { contentQualityCases } from "./content-quality-cases.mjs";

const source = "# Notes\n\nPRIVATE_SOURCE is unchanged.";
const insertion = artifact => ({ effect: "insert", target: "document_end", unchangedOutside: true,
  patch: { from: source.length, to: source.length, expectedText: "" }, artifact, semanticReview: true });
function fixture(id, instruction, text, expected, entryAction = "command") {
  return { id, family: "b33-quality-refinement", instruction, source: text, selection: null, cursor: null,
    entryAction, skill: null, preconditions: null, expected, live: true, livePriority: 200,
    executionMode: "live", liveModels: 2 };
}
function polish(id, text, facts, effect = "replace") {
  return fixture(id, "校对正文，纠正明确的语法错误；保留原意、数字、单位、链接目标、代码及 Markdown 格式。正确的句子保持原样。", text,
    { effect, target: "document", ...(effect === "replace" ? { patch: { from: 0, to: text.length, expectedText: text } } : {}),
      semanticReview: true, facts }, "proofread");
}
const sections = names => ({ type: "headings", headings: names.map(text => ({ text, level: 2 })) });

/** Additions never change the original B31/B32 instructions or quality expectations. */
export const refinementVariants = [
  polish("B33-POL-LINK-PLURAL", "These [drafts](https://internal.invalid/drafts) requires approval.", ["drafts require approval", "URL original"]),
  polish("B33-POL-COUNT", "The team have 12 reviewers, and each reviewer need access.", ["team has", "reviewer needs", "12 original"]),
  polish("B33-POL-TWO-NUMBERS", "Cedar have 2 reviewers, while Maple have 5 reviewers.", ["both have -> has", "Cedar 2 and Maple 5 remain bound"]),
  polish("B33-POL-PERCENT", "The pass rate are 25%, and the result need review.", ["rate is", "result needs", "25% original"]),
  polish("B33-POL-CODE-COUNT", "The [release](https://internal.invalid/r) have 3 stages and use `R17`.", ["release has and uses", "3 stages original", "URL and R17 original"]),
  polish("B33-POL-CORRECT-NUMBER", "The release has 3 stages, and each stage needs approval.", ["correct prose stays unchanged", "3 original"], "no_op"),
  fixture("B33-CODE-TS-ASYNC", "在文末添加 TypeScript 代码块，定义异步函数 loadLabel，接收字符串参数并返回该字符串，不要添加标题。", source,
    { ...insertion({ type: "code", language: "typescript", functionName: "loadLabel" }), facts: ["async function", "string in and same string out", "valid TypeScript body"] }),
  fixture("B33-CODE-JS", "在文末新增 JavaScript 代码围栏，定义 greetGuest 函数，接收 name 并返回问候字符串。", source,
    { ...insertion({ type: "code", language: "javascript", functionName: "greetGuest" }), facts: ["valid JavaScript", "function accepts name", "returns greeting"] }),
  fixture("B33-CODE-TS-TEMPLATE", "在文末新增二级标题“Example”，后面放 TypeScript 代码块，定义 makeLabel 函数，返回包含 name 参数的模板字符串。", source,
    { ...insertion({ type: "code", language: "typescript", functionName: "makeLabel", heading: { level: 2, text: "Example" } }), facts: ["one outer H2", "template literal", "no Markdown wrapper in code body"] }),
  fixture("B33-CODE-MARKDOWN", "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world。", source,
    { ...insertion({ type: "code", language: "markdown" }), facts: ["inside markdown fence H1 hello", "inside same fence bullet world"] }),
  fixture("B33-OPEN-EN", "At the end, write a release rehearsal draft with these headings in order: Goal, Steps, Risks. Include executable steps and concrete risk scenarios; frame it as a proposal, not a completed event.", source,
    { ...insertion(sections(["Goal", "Steps", "Risks"])), facts: ["goal for release rehearsal", "steps state actions and checks", "risk conditions and consequences", "no invented past events"] }),
  fixture("B33-OPEN-ZH", "在文末写一份回滚演练建议，按顺序用小标题 目标、步骤、风险 组织。每个步骤给出动作和检查点，风险说明触发条件与应对；不要假称演练已完成。", source,
    { ...insertion(sections(["目标", "步骤", "风险"])), facts: ["rollback rehearsal purpose", "action and checkpoint", "risk condition and response", "proposal language"] })
];

export const refinementCases = [...contentQualityCases,
  ...refinementVariants.map((item, index) => ({ ...item, livePriority: 200 + index }))];
export const refinementMatrixSummary = Object.freeze({ baselineCaseCount: contentQualityCases.length,
  addedCaseCount: refinementVariants.length, caseCount: refinementCases.length,
  liveCaseCount: refinementCases.length, liveCaseIds: refinementCases.map(({ id }) => id) });
