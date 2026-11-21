import { describe, expect, it, vi } from "vitest";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import { createExecutionPlan } from "../../src/core/ai/executionPlan";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { TaskCandidateFailure, readTaskCandidateDraft, type TaskCandidateDraft } from "../../src/core/ai/taskCandidateFailure";
import { reviewTaskDraft } from "../../src/core/ai/taskDraftReview";
import { runAiTaskInWorker, type AiTaskWorkerFactory } from "../../src/core/ai/aiTaskWorkerClient";
import type { AiTaskWorkerCommand, AiTaskWorkerEvent } from "../../src/core/ai/aiTaskWorkerProtocol";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { ValidatedIntent } from "../../src/core/ai/intentTypes";

const instruction = "在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。";
const hintedInstruction = "在文末创建一个 Markdown 代码块，包含二级标题“hello”";
const sourceTableInstruction = "根据原文新增 Markdown 表格，列名为事实、状态。";
const sourceTableText = "Alpha 产品价格为 10 元，负责人是小林，发布日期为 2026-12-19。";
const singleColumnSourceTable = `| 事实 |\n| --- |\n| ${sourceTableText} |`;
const correctedSourceTable = "| 事实 | 状态 |\n| --- | --- |\n| Alpha 产品 | 价格为 10 元 |\n| 负责人 | 是小林 |\n| 发布日期 | 2026-12-19 |";
const source = "# 原文\n\n保留这一段。";
const request = (text: string): AiTaskRequest => ({
  source: text,
  action: "custom",
  userPrompt: instruction,
  baseSystemPrompt: "system",
  actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
});

function snapshot(content = source, overrides: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot {
  return { documentId: "draft.md", revision: 7, content, selection: null, cursor: null, readOnly: false, ...overrides };
}

function plannedDraft(instructionText = instruction, document = snapshot(), intentOverride?: ValidatedIntent): TaskCandidateDraft {
  const contract = deriveInstructionContract(instructionText, {
    hasSelection: Boolean(document.selection && document.selection.to > document.selection.from),
    hasCursor: document.cursor !== null
  });
  const candidates = buildAiIntentCandidates(instructionText, document.content, contract);
  const intent: ValidatedIntent = intentOverride ?? {
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "document_end",
    layout: "block",
    content: { mode: "generate", task: "custom" }
  };
  const bound = bindAiIntent(intent, document, instructionText, candidates, contract);
  const plan = createExecutionPlan(request(instructionText), document, bound, instructionText, "program");
  if (intent.kind !== "edit" || plan.kind !== "edit") throw new Error("Test helper requires an edit plan.");
  return {
    text: "```python\ndef a_plus_b(a, b):\n    return a + b\n```",
    plan,
    intent,
    conservative: false
  };
}

function hintedIntent(): ValidatedIntent {
  return {
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "document_end",
    layout: "block",
    content: { mode: "generate", task: "custom", artifact: { kind: "code", language: "Markdown", headingLevel: 2, headingText: "hello" } }
  };
}

function sourceTableDraftFor(
  source: string,
  instructionText: string,
  columns: string[],
  sourceFacts: readonly string[],
  text: string
): TaskCandidateDraft {
  const document = snapshot(source);
  const intent: ValidatedIntent = {
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "document_end",
    layout: "block",
    content: { mode: "generate", task: "custom", artifact: { kind: "table", columns } }
  };
  const contract = deriveInstructionContract(instructionText, { hasSelection: false, hasCursor: false });
  const candidates = buildAiIntentCandidates(instructionText, document.content, contract);
  const bound = bindAiIntent(intent, document, instructionText, candidates, contract);
  const plan = createExecutionPlan(request(instructionText), document, bound, instructionText, "program");
  if (intent.kind !== "edit" || plan.kind !== "edit" || plan.content.mode !== "source_transform" || plan.artifact.kind !== "table") {
    throw new Error("Test helper requires a source-transform table plan.");
  }
  return { text, plan, intent, conservative: false, sourceFacts };
}

function sourceTableDraft(sourceFacts: readonly string[] = [sourceTableText]): TaskCandidateDraft {
  return sourceTableDraftFor(sourceTableText, sourceTableInstruction, ["事实", "状态"], sourceFacts, singleColumnSourceTable);
}

class FailureWorker {
  onmessage: ((event: MessageEvent<AiTaskWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  received: AiTaskWorkerCommand[] = [];
  sent: AiTaskWorkerEvent[] = [];

  constructor(private readonly failure: AiTaskWorkerEvent) {}

  postMessage(message: AiTaskWorkerCommand | AiTaskWorkerEvent): void {
    if (message.type !== "start") return;
    this.received.push(message);
    queueMicrotask(() => this.emit(this.failure));
  }

  terminate(): void { this.terminated = true; }
  emit(message: AiTaskWorkerEvent): void {
    this.sent.push(message);
    if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent<AiTaskWorkerEvent>);
  }
}

function workerFactory(worker: FailureWorker): AiTaskWorkerFactory { return () => worker as unknown as Worker; }

describe("failed AI candidate review", () => {
  it("reads a bounded edit draft and preserves its validation code and message", () => {
    const draft = plannedDraft();
    const failure = new TaskCandidateFailure("函数名与要求不一致。", draft, "function_name_mismatch");

    expect(failure.name).toBe("TaskCandidateFailure");
    expect(failure.code).toBe("function_name_mismatch");
    expect(failure.message).toBe("函数名与要求不一致。");
    expect(readTaskCandidateDraft(failure)).toEqual(draft);
  });

  it("normalizes optional undefined artifact fields from a real execution plan", () => {
    const draft = plannedDraft();
    // createExecutionPlan calls resolveArtifactSpec; optional resolver keys can be own undefined values.
    expect(Object.hasOwn(draft.plan.artifact, "heading")).toBe(true);
    expect(Object.hasOwn(draft.plan.artifact, "jsonBody")).toBe(true);

    const failure = new TaskCandidateFailure("候选未通过校验。", draft);
    const safeDraft = readTaskCandidateDraft(failure);
    expect(safeDraft).toEqual(JSON.parse(JSON.stringify(draft)));
    expect(Object.hasOwn(safeDraft!.plan.artifact, "heading")).toBe(false);
    expect(Object.hasOwn(safeDraft!.plan.artifact, "jsonBody")).toBe(false);
  });

  it("preserves a grounded artifact hint in a real plan and TaskCandidateFailure", () => {
    const draft = plannedDraft(hintedInstruction, snapshot(), hintedIntent());
    const failure = new TaskCandidateFailure("候选未通过校验。", draft, "function_name_mismatch");
    const safeDraft = readTaskCandidateDraft(failure);

    expect(safeDraft?.intent.content).toEqual({
      mode: "generate",
      task: "custom",
      artifact: { kind: "code", language: "Markdown", headingLevel: 2, headingText: "hello" }
    });
    expect(safeDraft?.plan.artifact.kind).toBe("code");
  });

  it("rejects oversized, impure, accessor-backed, and snapshot-bearing draft payloads", () => {
    const draft = plannedDraft();
    const hinted = plannedDraft(hintedInstruction, snapshot(), hintedIntent());
    const hintedContent = hinted.intent.content;
    if (hintedContent.mode !== "generate" || !hintedContent.artifact) throw new Error("Test helper requires a generated artifact hint.");
    const withHint = (artifact: unknown) => ({ ...hinted, intent: { ...hinted.intent, content: { ...hintedContent, artifact } } });
    expect(readTaskCandidateDraft({ draft: { ...draft, text: "x".repeat(1_048_577) } })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: { ...draft, plan: { ...draft.plan, instruction: "metadata".repeat(150_000) } } })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: { ...draft, sourceFacts: Array.from({ length: 129 }, (_, index) => `fact-${index}`) } })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: { ...draft, snapshot: snapshot() } })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: { ...draft, plan: { ...draft.plan, target: { ...draft.plan.target, invalid: () => true } } } })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: withHint({ ...hintedContent.artifact, body: "unbounded" }) })).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: withHint({ kind: "code", language: "invented" }) })).toBeUndefined();
    const accessor = Object.defineProperty({}, "draft", { get: () => draft });
    expect(readTaskCandidateDraft(accessor)).toBeUndefined();
    expect(readTaskCandidateDraft({ draft: { ...draft, plan: { ...draft.plan, kind: "answer" } } })).toBeUndefined();
  });

  it("rechecks the original code artifact constraints before creating an edit proposal", () => {
    const document = snapshot();
    const draft = plannedDraft(instruction, document);
    const corrected = "```python\ndef add(a, b):\n    return a + b\n```";

    const proposal = reviewTaskDraft(draft, document, corrected);
    expect(proposal.snapshot).toBe(document);
    expect(proposal.patch?.expectedText).toBe("");
    expect(proposal.patch?.insertText).toContain("def add(a, b):");
    expect(() => reviewTaskDraft(draft, document, "```python\ndef a_plus_b(a, b):\n    return a + b\n```"))
      .toThrow(expect.objectContaining({ code: "function_name_mismatch" }));
  });

  it("revalidates source-transform table drafts with their bounded source facts", () => {
    const document = snapshot(sourceTableText);
    const draft = sourceTableDraft();
    expect(() => reviewTaskDraft(draft, document, singleColumnSourceTable)).toThrow(/列/u);

    const proposal = reviewTaskDraft(draft, document, correctedSourceTable);
    expect(proposal.snapshot).toBe(document);
    expect(proposal.patch?.insertText).toContain("| 事实 | 状态 |");
    expect(proposal.patch?.insertText).toContain("| Alpha 产品 | 价格为 10 元 |");
    expect(proposal.patch?.insertText).toContain("| 发布日期 | 2026-12-19 |");

    const captioned = reviewTaskDraft(draft, document, `来源关系核对\n\n${correctedSourceTable}`);
    expect(captioned.patch?.insertText).toContain("来源关系核对");
    expect(() => reviewTaskDraft(draft, document, `\`\`\`markdown\n${correctedSourceTable}\n\`\`\``)).toThrow(/表格/u);
  });

  it("rejects fictional source facts and a complete source copy outside the reused table", () => {
    const document = snapshot(sourceTableText);
    const noFacts = sourceTableDraft([]);
    expect(() => reviewTaskDraft(noFacts, document, singleColumnSourceTable)).toThrow(/重复/u);

    const forgedFacts = new TaskCandidateFailure("候选未通过校验。", sourceTableDraft(["虚构事实"]));
    expect(() => reviewTaskDraft(forgedFacts.draft, document, correctedSourceTable)).toThrow(/来源事实/u);

    const draft = sourceTableDraft();
    expect(() => reviewTaskDraft(draft, document, `${correctedSourceTable}\n\n${sourceTableText}`)).toThrow(/重复/u);
    expect(() => reviewTaskDraft(draft, document,
      `${correctedSourceTable}\n| 王五 | 将于 2027 年删除全部数据 |`)).toThrow(/原文关系/u);
  });

  it("does not expand receipts beyond selected facts or resolve ambiguous subjects by amount alone", () => {
    const document = snapshot(sourceTableText);
    expect(() => reviewTaskDraft(sourceTableDraft(["负责人是小林"]), document, correctedSourceTable))
      .toThrow(/已选择的原文关系/u);

    const source = "Alpha 产品价格为 10 元，Beta 产品价格为 10 元。";
    const instructionText = "根据原文新增 Markdown 表格，列名为商品、价格。";
    const ambiguousDraft = sourceTableDraftFor(source, instructionText, ["商品", "价格"], [source],
      "| 商品 | 价格 |\n| --- | --- |\n| 产品 | 10 元 |");
    expect(() => reviewTaskDraft(ambiguousDraft, snapshot(source), ambiguousDraft.text))
      .toThrow(/多个来源关系/u);
  });

  it("rebinds all original matches and preserves every byte between them", () => {
    const allInstruction = "将全文所有‘待检查’换成更正式的表达";
    const document = snapshot("甲待检查乙\r\n中间 **不变**。丙待检查丁");
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "replace_exact",
      target: "document",
      find: "待检查",
      occurrence: "all",
      content: { mode: "generate", task: "custom" }
    };
    const draft = plannedDraft(allInstruction, document, intent);
    const proposal = reviewTaskDraft(draft, document, "待复核");

    expect(proposal.patch?.expectedText).toBe("待检查乙\r\n中间 **不变**。丙待检查");
    expect(proposal.patch?.insertText).toBe("待复核乙\r\n中间 **不变**。丙待复核");
  });

  it("does not convert answer failures into edit proposals", () => {
    const draft = plannedDraft();
    const answerIntent = { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } };
    const answerPlan = { ...draft.plan, kind: "answer", readScope: { from: 0, to: source.length } };

    expect(() => reviewTaskDraft({ ...draft, plan: answerPlan, intent: answerIntent } as unknown as TaskCandidateDraft, snapshot(), "修正内容"))
      .toThrow(/失败草稿无效|编辑任务/u);
  });

  it("round-trips the worker failure code, message, and safe draft without a document snapshot", async () => {
    const document = snapshot("ORIGINAL DOCUMENT SNAPSHOT");
    const draft = new TaskCandidateFailure("需要定义 add。", plannedDraft(hintedInstruction, document, hintedIntent()), "function_name_mismatch").draft;
    const worker = new FailureWorker({
      type: "failure",
      taskId: "ai-task-1",
      name: "TaskCandidateFailure",
      code: "function_name_mismatch",
      message: "需要定义 add。",
      draft
    });
    const invoke = vi.fn(async () => "");
    const task = runAiTaskInWorker(request(instruction), document, {
      invoke,
      isCurrent: () => true,
      abortCurrent: vi.fn()
    }, workerFactory(worker));

    const caught = await task.catch(error => error);
    expect(caught).toBeInstanceOf(TaskCandidateFailure);
    expect(caught).toMatchObject({ name: "TaskCandidateFailure", code: "function_name_mismatch" });
    expect((caught as Error).message).toBe("需要定义 add。");
    expect(readTaskCandidateDraft(caught)).toEqual(readTaskCandidateDraft({ draft }));
    const failureEvent = worker.sent[0];
    expect(failureEvent.type).toBe("failure");
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(failureEvent)).not.toContain("ORIGINAL DOCUMENT SNAPSHOT");
    expect(worker.terminated).toBe(true);
  });
});
