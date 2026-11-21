import type { IntentArtifactHint } from "./intentArtifactHint";

export type IntentTarget =
  | "document"
  | "body_start"
  | "document_end"
  | "selection"
  | "selection_end"
  | "cursor"
  | "heading_end"
  | "section_end"
  | "exact_match";

export type IntentTask =
  | "polish"
  | "proofread"
  | "academic-polish"
  | "summarize"
  | "continue"
  | "restructure"
  | "custom"
  | "diagram"
  | "tech-spec";

export type IntentReason =
  | "missing_operation"
  | "missing_target"
  | "missing_content"
  | "ambiguous_anchor"
  | "scope_conflict"
  | "compound"
  | "conflicting_constraints"
  | "unsupported_operation";

export type IntentOccurrence = "single" | "all" | "last" | number;
export type IntentMatchScope = "document" | "selection";

export interface IntentCandidates {
  headings: Array<{ id: string; text: string; level: number }>;
  literals: Array<{ id: string; text: string }>;
  incomplete?: boolean;
}

export type IntentContent =
  | { mode: "literal"; text: string }
  | { mode: "literal"; literalId: string }
  | { mode: "generate"; task: IntentTask; artifact?: IntentArtifactHint };

export type IntentEdit =
  | {
      version: 1;
      kind: "edit";
      operation: "insert";
      target: Exclude<IntentTarget, "document" | "selection">;
      targetId?: string;
      layout: "block" | "inline";
      content: IntentContent;
      find?: string;
      occurrence?: IntentOccurrence;
      matchScope?: IntentMatchScope;
    }
  | {
      version: 1;
      kind: "edit";
      operation: "rewrite";
      target: "document" | "selection";
      content: IntentContent;
    }
  | {
      version: 1;
      kind: "edit";
      operation: "replace_exact";
      target: "document" | "selection";
      content: IntentContent;
      find: string;
      occurrence: IntentOccurrence;
    };

export type ValidatedIntent =
  | IntentEdit
  | {
      version: 1;
      kind: "answer";
      target: "document" | "selection";
      content: { mode: "generate"; task: IntentTask; artifact?: IntentArtifactHint };
    }
  | { version: 1; kind: "clarify"; reason: IntentReason }
  | { version: 1; kind: "unsupported"; reason: IntentReason };

export type IntentInvoke = ((prompt: string, systemPrompt: string, maxTokens: number, outputSchema?: Record<string, unknown>) => Promise<string>) & {
  abort?: () => void;
};

export class IntentProtocolError extends Error {
  readonly code: "invalid_output" | "budget_exceeded" | "timeout" | "selection_required" | "scope_mismatch";

  constructor(code: IntentProtocolError["code"] = "invalid_output") {
    const messages = {
      invalid_output: "未能形成明确编辑计划，请补充操作、目标或新增内容后重新发送。原指令仍可修改。",
      budget_exceeded: "这条指令或可选目标过长，无法安全规划。请缩短指令或明确目标后重新发送。",
      timeout: "等待模型返回编辑计划超时，文档没有修改。可修改指令或更换模型后重新发送。",
      selection_required: "当前没有选区，请先选择要处理的内容，或明确改为处理全文。原文未修改。",
      scope_mismatch: "模型生成了与当前文档范围不一致的计划，原文未修改。请修改指令后重新发送。"
    };
    super(messages[code]);
    this.name = "IntentProtocolError";
    this.code = code;
  }
}

