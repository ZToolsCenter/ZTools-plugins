import type { IntentOccurrence, IntentReason, IntentTarget, IntentTask } from "./intentTypes";

export interface InstructionSpan {
  /** UTF-16 half-open offsets into the exact instruction string. */
  from: number;
  to: number;
  raw: string;
}

export type InstructionConstraint<T> =
  | { state: "explicit"; value: T; evidence: InstructionSpan[] }
  | { state: "unknown" }
  | { state: "ambiguous" | "conflict"; alternatives: T[]; evidence: InstructionSpan[] };

export interface InstructionLiteralEvidence extends InstructionSpan {
  role: "find" | "write" | "unknown";
  /** Raw payload text, with source whitespace and Unicode code units unchanged. */
  value: string;
}

export interface InstructionHeadingEvidence {
  text: string;
  ordinal?: number;
  ordinalScope?: "global" | "same_title";
  relation: "heading_end" | "section_end";
}

export interface InstructionContractContext {
  /** Whether an actual, valid editor selection is available for this request. */
  hasSelection?: boolean;
  /** Whether an actual, safe editor cursor is available for this request. */
  hasCursor?: boolean;
}

export interface InstructionContract {
  effect: InstructionConstraint<"edit" | "answer" | "no_edit">;
  operation: InstructionConstraint<"insert" | "replace_exact" | "rewrite">;
  target: InstructionConstraint<IntentTarget>;
  scope: InstructionConstraint<"document" | "selection">;
  occurrence: InstructionConstraint<IntentOccurrence>;
  layout: InstructionConstraint<"inline" | "block">;
  /** Explicit task words constrain generation without weakening literal or range checks. */
  generationTasks?: InstructionConstraint<IntentTask[]>;
  literals: InstructionLiteralEvidence[];
  heading: InstructionConstraint<InstructionHeadingEvidence>;
  issues: Array<{ code: IntentReason; evidence: InstructionSpan[] }>;
  preconditions: {
    selectionRequired: boolean;
    selectionAvailable?: boolean;
    cursorRequired: boolean;
    cursorAvailable?: boolean;
  };
}
