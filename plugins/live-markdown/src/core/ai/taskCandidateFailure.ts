import type { ActiveExecutionPlan } from "./executionPlan";
import { parseIntentArtifactHint } from "./intentArtifactHint";
import type { ValidatedIntent } from "./intentTypes";

export const TASK_CANDIDATE_DRAFT_MAX_BYTES = 1_048_576;
const TASKS = new Set(["polish", "proofread", "academic-polish", "summarize", "continue", "restructure", "custom", "diagram", "tech-spec"]);
const MAX_DRAFT_SOURCE_FACTS = 128;

export interface TaskCandidateDraft {
  readonly text: string;
  readonly plan: Extract<ActiveExecutionPlan, { kind: "edit" }>;
  readonly intent: Extract<ValidatedIntent, { kind: "edit" }>;
  readonly conservative: boolean;
  readonly sourceFacts?: readonly string[];
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length;) {
    const point = value.codePointAt(index)!;
    bytes += point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1;
    if (bytes > TASK_CANDIDATE_DRAFT_MAX_BYTES) return bytes;
    index += point > 0xffff ? 2 : 1;
  }
  return bytes;
}

function clonePureJson(value: unknown, active = new Set<object>(), depth = 0, budget = { nodes: 0, bytes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 100_000 || depth > 64) throw new TypeError("失败草稿嵌套或节点数超过限制。");
  if (typeof value === "string") {
    budget.bytes += utf8ByteLength(value);
    if (budget.bytes > TASK_CANDIDATE_DRAFT_MAX_BYTES) throw new TypeError("失败草稿超过 1 MiB 安全上限。");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("失败草稿包含非有限数值。");
    return value;
  }
  if (!value || typeof value !== "object" || active.has(value)) throw new TypeError("失败草稿包含循环或非 JSON 数据。");
  try {
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.getPrototypeOf(value) === null ? null : Object.prototype) ||
        Object.getOwnPropertySymbols(value).length) throw new TypeError("失败草稿必须只包含普通对象和数组。");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (array) {
      if (keys.some((key) => key !== "length" && !/^\d+$/u.test(key)) || keys.filter((key) => /^\d+$/u.test(key)).length !== value.length) {
        throw new TypeError("失败草稿数组不连续或包含自定义属性。");
      }
      const copy: unknown[] = [];
      active.add(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value === undefined) throw new TypeError("失败草稿数组不能包含空项或 undefined。");
        copy.push(clonePureJson(descriptor.value, active, depth + 1, budget));
      }
      active.delete(value);
      return copy;
    }
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    active.add(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError("失败草稿不能包含访问器或非枚举属性。");
      budget.bytes += utf8ByteLength(key);
      if (budget.bytes > TASK_CANDIDATE_DRAFT_MAX_BYTES) throw new TypeError("失败草稿超过 1 MiB 安全上限。");
      // JSON.stringify omits optional own properties whose data value is undefined.
      if (descriptor.value !== undefined) copy[key] = clonePureJson(descriptor.value, active, depth + 1, budget);
    }
    active.delete(value);
    return copy;
  } catch (error) {
    active.delete(value);
    throw error;
  }
}

function stringField(value: unknown): boolean {
  return record(value) && hasExactKeys(value, ["value", "evidence"]) && typeof value.value === "string" && spans(value.evidence);
}

function numberField(value: unknown): boolean {
  return record(value) && hasExactKeys(value, ["value", "evidence"]) && Number.isFinite(value.value) && spans(value.evidence);
}

function anyField(value: unknown): boolean {
  return record(value) && hasExactKeys(value, ["value", "evidence"]) && spans(value.evidence);
}

function spans(value: unknown): boolean {
  return Array.isArray(value) && value.every((span) => record(span) && hasExactKeys(span, ["from", "to", "raw"]) &&
    Number.isSafeInteger(span.from) && (span.from as number) >= 0 && Number.isSafeInteger(span.to) && (span.to as number) >= (span.from as number) && typeof span.raw === "string");
}

function heading(value: unknown): boolean {
  if (!record(value) || !hasExactKeys(value, [], ["level", "text"])) return false;
  return (!Object.hasOwn(value, "level") || numberField(value.level) && Number.isInteger((value.level as { value: number }).value) && (value.level as { value: number }).value >= 1 && (value.level as { value: number }).value <= 6) &&
    (!Object.hasOwn(value, "text") || stringField(value.text));
}

function artifactSpec(value: unknown): boolean {
  if (!record(value) || typeof value.kind !== "string" || typeof value.displaySource !== "boolean" ||
      typeof value.sourceDependent !== "boolean" || !Array.isArray(value.issues) || !value.issues.every((issue) => typeof issue === "string") ||
      value.composition !== undefined && value.composition !== "complete" && value.composition !== "partial") return false;
  const base = ["kind", "displaySource", "sourceDependent", "issues"];
  const optionalBase = ["composition"];
  if (value.kind === "none" || value.kind === "markdown") return hasExactKeys(value, base, optionalBase);
  if (value.kind === "heading") return hasExactKeys(value, [...base, "heading"], optionalBase) && heading(value.heading);
  if (value.kind === "code") return hasExactKeys(value, base, [...optionalBase, "language", "heading", "prefixHeading", "literalBody", "jsonBody", "functionName"]) &&
    (!Object.hasOwn(value, "language") || stringField(value.language)) && (!Object.hasOwn(value, "heading") || heading(value.heading)) &&
    (!Object.hasOwn(value, "prefixHeading") || heading(value.prefixHeading)) &&
    (!Object.hasOwn(value, "literalBody") || stringField(value.literalBody)) && (!Object.hasOwn(value, "jsonBody") || anyField(value.jsonBody)) &&
    (!Object.hasOwn(value, "functionName") || stringField(value.functionName));
  if (value.kind === "table") return hasExactKeys(value, base, [...optionalBase, "columns", "rows"]) &&
    (!Object.hasOwn(value, "columns") || Array.isArray(value.columns) && value.columns.every(stringField)) &&
    (!Object.hasOwn(value, "rows") || Array.isArray(value.rows) && value.rows.every((row) => Array.isArray(row) && row.every(stringField)));
  if (value.kind === "list") return hasExactKeys(value, [...base, "ordered"], [...optionalBase, "items", "count"]) && typeof value.ordered === "boolean" &&
    (!Object.hasOwn(value, "items") || Array.isArray(value.items) && value.items.every(stringField)) &&
    (!Object.hasOwn(value, "count") || numberField(value.count));
  if (value.kind === "math") return hasExactKeys(value, [...base, "display"], [...optionalBase, "equation"]) && typeof value.display === "boolean" &&
    (!Object.hasOwn(value, "equation") || stringField(value.equation));
  if (value.kind === "mermaid") {
    if (!hasExactKeys(value, base, [...optionalBase, "graph"])) return false;
    if (!Object.hasOwn(value, "graph")) return true;
    const graph = value.graph;
    return record(graph) && hasExactKeys(graph, ["direction", "nodes", "edges"]) && (graph.direction === "LR" || graph.direction === "TD") &&
      Array.isArray(graph.nodes) && graph.nodes.every(stringField) && Array.isArray(graph.edges) && graph.edges.every((edge) => record(edge) &&
        hasExactKeys(edge, ["from", "to"]) && Number.isSafeInteger(edge.from) && Number.isSafeInteger(edge.to));
  }
  return false;
}

function content(value: unknown, instruction: string): boolean {
  if (!record(value) || typeof value.mode !== "string") return false;
  if (value.mode === "literal") return hasExactKeys(value, ["mode"], ["text", "literalId"]) &&
    (typeof value.text === "string" && value.text.length > 0 || typeof value.literalId === "string" && value.literalId.length > 0) &&
    !(Object.hasOwn(value, "text") && Object.hasOwn(value, "literalId"));
  if (value.mode === "generate") {
    if (!hasExactKeys(value, ["mode", "task"], ["artifact"]) || typeof value.task !== "string" || !TASKS.has(value.task)) return false;
    if (Object.hasOwn(value, "artifact")) {
      const hint = value.artifact;
      if (!record(hint)) return false;
      // The pure-data clone uses null-prototype records; adapt its already-sanitized flat hint for the shared parser.
      parseIntentArtifactHint(Object.fromEntries(Object.entries(hint)), instruction);
    }
    return true;
  }
  return false;
}

function instructionConstraint(value: unknown, choices?: readonly string[]): boolean {
  if (!record(value) || typeof value.state !== "string") return false;
  if (value.state === "unknown") return hasExactKeys(value, ["state"]);
  if (value.state === "explicit") return hasExactKeys(value, ["state", "value", "evidence"]) && typeof value.value === "string" &&
    (!choices || choices.includes(value.value)) && spans(value.evidence);
  if (value.state === "ambiguous" || value.state === "conflict") return hasExactKeys(value, ["state", "alternatives", "evidence"]) &&
    Array.isArray(value.alternatives) && value.alternatives.every((item) => typeof item === "string" && (!choices || choices.includes(item))) && spans(value.evidence);
  return false;
}

function generationRequirements(value: unknown): boolean {
  return record(value) && hasExactKeys(value, ["artifact", "display", "factPolicy", "requiredHeadings", "constraints", "contentInstruction"]) &&
    instructionConstraint(value.artifact, ["markdown", "table", "code", "math", "mermaid"]) &&
    instructionConstraint(value.display, ["rendered", "source"]) &&
    (value.factPolicy === "preserve" || value.factPolicy === "source_bound" || value.factPolicy === "allow_suggestions") &&
    typeof value.contentInstruction === "string" && Array.isArray(value.requiredHeadings) && value.requiredHeadings.every((item) => record(item) &&
      hasExactKeys(item, ["text", "evidence"]) && typeof item.text === "string" && spans(item.evidence)) &&
    Array.isArray(value.constraints) && value.constraints.every((item) => record(item) && hasExactKeys(item, ["text", "kind", "evidence"]) &&
      typeof item.text === "string" && ["preserve", "forbid", "require"].includes(String(item.kind)) && spans(item.evidence));
}

function occurrence(value: unknown): boolean {
  return value === "single" || value === "all" || value === "last" || Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1000;
}

function editIntent(value: unknown, instruction: string): value is Extract<ValidatedIntent, { kind: "edit" }> {
  if (!record(value) || value.version !== 1 || value.kind !== "edit" || !content(value.content, instruction) || typeof value.operation !== "string") return false;
  if (value.operation === "insert") {
    const targets = ["body_start", "document_end", "selection_end", "cursor", "heading_end", "section_end", "exact_match"];
    if (!hasExactKeys(value, ["version", "kind", "operation", "target", "layout", "content"], ["targetId", "find", "occurrence", "matchScope"]) ||
        !targets.includes(String(value.target)) || value.layout !== "block" && value.layout !== "inline") return false;
    if (value.targetId !== undefined && typeof value.targetId !== "string" || value.find !== undefined && typeof value.find !== "string" ||
        value.occurrence !== undefined && !occurrence(value.occurrence) || value.matchScope !== undefined && value.matchScope !== "document" && value.matchScope !== "selection") return false;
    return value.target !== "exact_match" || typeof value.find === "string" && Boolean(value.find) && occurrence(value.occurrence) &&
      (value.matchScope === "document" || value.matchScope === "selection");
  }
  if (value.operation === "rewrite") return hasExactKeys(value, ["version", "kind", "operation", "target", "content"]) && (value.target === "document" || value.target === "selection");
  if (value.operation === "replace_exact") return hasExactKeys(value, ["version", "kind", "operation", "target", "content", "find", "occurrence"]) &&
    (value.target === "document" || value.target === "selection") && typeof value.find === "string" && Boolean(value.find) && occurrence(value.occurrence);
  return false;
}

function activeEditPlan(value: unknown): value is Extract<ActiveExecutionPlan, { kind: "edit" }> {
  if (!record(value) || value.version !== 2 || value.kind !== "edit" || typeof value.instruction !== "string" ||
      !artifactSpec(value.artifact) || !generationRequirements(value.requirements) || typeof value.task !== "string" || !TASKS.has(value.task) ||
      value.planningMode !== "program" && value.planningMode !== "model" ||
      value.operation !== "insert" && value.operation !== "rewrite" && value.operation !== "replace_exact" ||
      !record(value.target) || !hasExactKeys(value, ["version", "kind", "instruction", "artifact", "requirements", "content", "task", "planningMode", "operation", "target"])) return false;
  if (!hasExactKeys(value.target, ["documentId", "revision", "from", "to", "dependency"]) || typeof value.target.documentId !== "string" ||
      !Number.isSafeInteger(value.target.revision) || !Number.isSafeInteger(value.target.from) || !Number.isSafeInteger(value.target.to) ||
      (value.target.from as number) < 0 || (value.target.to as number) < (value.target.from as number) ||
      value.target.dependency !== "document" && value.target.dependency !== "selection" && value.target.dependency !== "cursor") return false;
  if (!record(value.content) || typeof value.content.mode !== "string") return false;
  if (value.content.mode === "literal") return hasExactKeys(value.content, ["mode", "text", "evidence"]) && typeof value.content.text === "string" && spans(value.content.evidence);
  if (value.content.mode === "compose") return hasExactKeys(value.content, ["mode", "text"]) && typeof value.content.text === "string";
  return ["source_transform", "generate", "prose_slots", "summary_ledger"].includes(value.content.mode) && hasExactKeys(value.content, ["mode"]);
}

// The cap covers the serialized draft as a whole (text plus plan/intent metadata), not just candidate text.
function normalizeDraft(value: unknown): TaskCandidateDraft | undefined {
  try {
    const cloned = clonePureJson(value);
    if (!record(cloned) || !hasExactKeys(cloned, ["text", "plan", "intent", "conservative"], ["sourceFacts"]) || typeof cloned.text !== "string" ||
        utf8ByteLength(cloned.text) > TASK_CANDIDATE_DRAFT_MAX_BYTES || typeof cloned.conservative !== "boolean" ||
        Object.hasOwn(cloned, "sourceFacts") && (!Array.isArray(cloned.sourceFacts) || cloned.sourceFacts.length > MAX_DRAFT_SOURCE_FACTS ||
          !cloned.sourceFacts.every((fact) => typeof fact === "string" && Boolean(fact.trim()))) ||
        !activeEditPlan(cloned.plan)) return undefined;
    if (!editIntent(cloned.intent, cloned.plan.instruction) || cloned.plan.operation !== cloned.intent.operation) return undefined;
    const json = JSON.stringify(cloned);
    if (json === undefined || utf8ByteLength(json) > TASK_CANDIDATE_DRAFT_MAX_BYTES) return undefined;
    return JSON.parse(json) as TaskCandidateDraft;
  } catch { return undefined; }
}

/** A complete edit candidate that failed validation and can be manually corrected on the main thread. */
export class TaskCandidateFailure extends Error {
  readonly code: string;
  readonly draft: TaskCandidateDraft;

  constructor(message: string, draft: TaskCandidateDraft, code = "candidate_validation_failed") {
    super(message);
    this.name = "TaskCandidateFailure";
    this.code = typeof code === "string" && code.length <= 128 ? code : "candidate_validation_failed";
    const normalized = normalizeDraft(draft);
    if (!normalized) throw new TypeError("失败草稿包含无效、超限或非纯数据字段。");
    this.draft = normalized;
  }
}

/** Safely reads a plain, bounded draft from an Error or a structured worker failure payload. */
export function readTaskCandidateDraft(error: unknown): TaskCandidateDraft | undefined {
  try {
    if (!error || typeof error !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "draft");
    return descriptor && "value" in descriptor ? normalizeDraft(descriptor.value) : undefined;
  } catch { return undefined; }
}
