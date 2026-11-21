import { describe, expect, it, vi } from "vitest";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTaskCore } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import { resolveAiEdit } from "../../src/core/ai/editProposal";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { readTaskCandidateDraft } from "../../src/core/ai/taskCandidateFailure";
import { reviewTaskDraft } from "../../src/core/ai/taskDraftReview";

const source = "# 原文\n\n保留这段内容。\n";
const snapshot: AiDocumentSnapshot = { documentId: "v2.md", revision: 2, content: source, selection: null, cursor: source.length, readOnly: false };
const insert = { version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "custom" } };

function run(instruction: string, body = "错误的占位结果", plan: unknown = insert, snap = snapshot) {
  const invoke = vi.fn(async (prompt: string) => prompt.includes("本次用户指令：") ? JSON.stringify(plan) : body);
  const promise = runPlannedAiTaskCore({
    action: "custom", source: snap.content, userPrompt: instruction, provider: "local",
    baseSystemPrompt: "你是一位创作与排版助手，行文优美。",
    actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
  }, snap, { invoke, isCurrent: () => true, abortCurrent() {} });
  return { invoke, promise };
}

describe("unified execution plan production seam", () => {
  it.each([
    ["创建代码块 markdown 格式 标题一 hello", /```markdown\s*\n# hello\s*\n```/u],
    ["在文末新增代码块 markdown 格式 标题二 “检查边界：状态✅”", /## 检查边界：状态✅/u],
    ["在文末新增 JSON 代码块，内容为 {\"ok\": true, \"count\": 3}。", /"count"\s*:\s*3/u],
    ["新增一个 Markdown 表格，列名为测试项、结果；行数据为编译器→通过、测试→待定。", /\|\s*编译器\s*\|\s*通过\s*\|/u],
    ["在文末新增一个 LaTeX 显示公式块，用 $$ 包裹公式，表达勾股定理：a^2 + b^2 = c^2。", /\$\$\s*a\^2\s*\+\s*b\^2\s*=\s*c\^2\s*\$\$/u],
    ["在文末新增三个状态图标清单：✅ 已完成、⚠️ 待确认、❌ 已阻塞。", /[-*] ✅ 已完成/u],
    ["在文末新增 Mermaid 流程图，按顺序表示开始→审核→结束。", /审核/u]
  ])("constructs complete declared artifacts without content inference: %s", async (instruction, expected) => {
    const { promise, invoke } = run(instruction);
    const result = await promise;
    expect(result.proposal).toBeDefined();
    expect(result.proposal!.patch?.insertText).toMatch(expected);
    expect(resolveAiEdit(result.proposal!)?.content.startsWith(source)).toBe(true);
    expect(invoke.mock.calls.filter(([prompt]) => !prompt.includes("本次用户指令："))).toHaveLength(0);
    expect(result.executionPlan?.kind).toBe("edit");
  });

  it.each([
    ["在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。", "```python\ndef a_plus_b(a,b):\n    return a+b\n```"],
    ["在文末创建一个 Markdown 代码块，包含二级标题“hello”，并解释它的用途。", "```markdown\n# hello\n\n用途说明。\n```"]
  ])("rejects complete-looking artifacts that violate explicit parameters: %s", async (instruction, body) => {
    const { promise } = run(instruction, body);
    await expect(promise).rejects.toThrow(/函数|名称|标题|级别/u);
  });

  it("uses the original instruction and a task system for source-independent code", async () => {
    const instruction = "在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。";
    const invoke = vi.fn(async (prompt: string, system: string) => {
      if (prompt.includes("本次用户指令：")) return JSON.stringify(insert);
      expect(prompt).toContain(instruction);
      expect(prompt).not.toContain("保留这段内容");
      expect(prompt).not.toContain("【全文上下文】");
      expect(system).not.toContain("行文优美");
      return "```python\ndef add(a,b):\n    return a+b\n```";
    });
    const result = await runPlannedAiTaskCore({ action: "custom", source, userPrompt: instruction,
      baseSystemPrompt: "行文优美", actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, snapshot, { invoke, isCurrent: () => true, abortCurrent() {} });
    expect(result.proposal).toBeDefined();
  });

  it("never treats a table column parameter as the whole literal artifact", async () => {
    const plan = { ...insert, content: { mode: "literal", text: "水果" } };
    const { promise } = run("严格根据原文新增两列表格，列名“水果”“价格”，列出文中所有水果及价格。", "", plan);
    await expect(promise).rejects.toThrow(/产物|表格|格式/u);
  });

  it("allows a validated source relation inside an appended table without treating it as whole-document echo", async () => {
    const fact = "发布流程要求所有服务团队在每次正式上线之前完成两名独立审核人的双人审批并更新可执行的回滚计划并明确当前负责人与具体发布日期并记录每项变更的审批状态验证结果和关联工单编号并确保所有责任人能够通过原始记录复核每一项操作结果。";
    const content = fact + "\n\n第二段只记录无关的归档说明，不包含发布流程数据。";
    const snap = { ...snapshot, content, cursor: content.length };
    const body = JSON.stringify({ columns: ["事实"], rows: [{ sourceId: "row-0", cells: [fact] }] });
    const { promise } = run("根据原文新增 Markdown 表格，列名为事实。", body, insert, snap);
    const result = await promise;
    expect(result.executionPlan?.kind === "edit" && result.executionPlan.content.mode).toBe("source_transform");
    expect(result.sourceFacts).toEqual([fact]);
    expect(resolveAiEdit(result.proposal!)?.content.startsWith(content)).toBe(true);
    expect(result.proposal?.patch?.insertText).toContain("| " + fact + " |");
  });

  it("returns no-op for a pure prohibition without calling a model", async () => {
    const { promise, invoke } = run("不要新增代码块");
    const result = await promise;
    expect(invoke).not.toHaveBeenCalled();
    expect(result.executionPlan?.kind).toBe("no_op");
    expect(result.proposal).toBeUndefined();
  });

  it("reports an unchanged rewrite as an unchanged document without an applicable proposal", async () => {
    const rewrite = { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "custom" } };
    const { promise } = run("请处理当前文稿。", source, rewrite);
    const result = await promise;
    expect(result.preservedSource).toBe(true);
    expect(result.text).toBe(source);
    expect(result.proposal).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("文档保持不变");
  });

  it("keeps a complete failed candidate editable and reviews a correction with zero model calls", async () => {
    const { promise, invoke } = run("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。", "```python\ndef a_plus_b(a,b):\n    return a+b\n```");
    const failure = await promise.catch(error => error);
    const draft = readTaskCandidateDraft(failure);
    expect(draft?.text).toContain("a_plus_b");
    const calls = invoke.mock.calls.length;
    const proposal = reviewTaskDraft(draft!, snapshot, "```python\ndef add(a,b):\n    return a+b\n```");
    expect(resolveAiEdit(proposal)?.content).toContain("def add(a,b)");
    expect(resolveAiEdit(proposal)?.content.startsWith(source)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(calls);
    expect(() => reviewTaskDraft(draft!, { ...snapshot, revision: 3 }, draft!.text)).toThrow(/版本/u);
  });

  it("retains a complete code response rejected before the final artifact gate", async () => {
    const { promise } = run("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。", "def add(a,b):\n    return a+b");
    const failure = await promise.catch(error => error);
    const draft = readTaskCandidateDraft(failure);
    expect(draft?.text).toBe("def add(a,b):\n    return a+b");
    expect(reviewTaskDraft(draft!, snapshot, "```python\ndef add(a,b):\n    return a+b\n```").mode).toBe("append");
  });

  it.each([
    "请只基于全文回答：上线前有哪些三个关键事实？不要修改文稿。",
    "请解释“底部加hello”是什么意思，勿修改文稿。"
  ])("keeps explicit answers out of the edit lane: %s", async instruction => {
    const plan = { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } };
    const { promise } = run(instruction, "这是所要求的回答。", plan);
    const result = await promise;
    expect(result.answerOnly).toBe(true);
    expect(result.executionPlan?.kind).toBe("answer");
    expect(result.proposal).toBeUndefined();
  });
});
