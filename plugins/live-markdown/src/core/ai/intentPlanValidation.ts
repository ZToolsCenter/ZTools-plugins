import type { AiDocumentSnapshot } from "../../types/aiEditing";
import { extractIntentLiterals } from "./intentLiterals";
import { getMarkdownBodyStart, isSafeMarkdownBoundary, readIntentHeadingRanges } from "./intentTargets";
import type { IntentCandidates, IntentEdit, ValidatedIntent } from "./intentTypes";
import type { InstructionConstraint, InstructionContract, InstructionSpan } from "./intentContract";
import { isPartialArtifactPayload } from "./intentArtifactContent";

export type PlanValidationCode =
  | "invalid_evidence"
  | "ambiguous_instruction"
  | "effect_mismatch"
  | "operation_mismatch"
  | "task_mismatch"
  | "target_mismatch"
  | "scope_mismatch"
  | "layout_mismatch"
  | "selection_required"
  | "cursor_required"
  | "snapshot_mismatch"
  | "read_only"
  | "literal_mismatch"
  | "artifact_content_mismatch"
  | "find_mismatch"
  | "missing_match"
  | "ambiguous_match"
  | "occurrence_mismatch"
  | "occurrence_unavailable"
  | "match_limit_exceeded"
  | "missing_heading"
  | "ambiguous_heading"
  | "heading_mismatch"
  | "unsafe_target";

const MESSAGES: Record<PlanValidationCode, string> = {
  invalid_evidence: "指令证据与当前指令不一致，尚未修改文档。请修改指令后重新发送。",
  ambiguous_instruction: "指令中有未解决的范围或操作歧义，尚未修改文档。请明确操作和目标后重新发送。",
  effect_mismatch: "AI 计划与您要求的操作类型不一致，尚未修改文档。请修改指令后重新发送。",
  task_mismatch: "AI 计划的任务与您指定的要求不一致，尚未修改文档。请修改指令后重新发送。",
  operation_mismatch: "AI 计划使用了不同的编辑操作，尚未修改文档。请修改指令后重新发送。",
  target_mismatch: "AI 计划的位置与您指定的位置不一致，尚未修改文档。请修改指令后重新发送。",
  scope_mismatch: "AI 计划的处理范围与您指定的范围不一致，尚未修改文档。请明确处理全文还是选区。",
  layout_mismatch: "AI 计划没有保留您指定的行内或段落格式，尚未修改文档。请修改指令后重新发送。",
  selection_required: "这条指令要求处理当前选区，但没有可用的有效选区。请重新选择内容或明确改为处理全文。",
  cursor_required: "这条指令要求在当前光标处插入，但无法读取有效光标位置。请先在文档中放置光标。",
  snapshot_mismatch: "指令范围信息与当前文档状态不一致，请重新发送指令。原文未修改。",
  read_only: "当前文档为只读状态，不能创建编辑计划。",
  literal_mismatch: "AI 计划没有逐字保留您提供的新增内容，尚未修改文档。请检查引用文字后重新发送。",
  artifact_content_mismatch: "AI 计划把结构产物参数当成了完整文字，尚未修改文档。请生成完整产物或修改指令后重新发送。",
  find_mismatch: "AI 计划查找的原文与您指定的文字不一致，尚未修改文档。请检查引用内容后重新发送。",
  missing_match: "没有在指定范围找到要替换的原文，尚未修改文档。请检查引用文字或范围。",
  ambiguous_match: "指定范围中有多处匹配，无法确定要修改哪一处。请说明全部、最后一处或具体序号。",
  occurrence_mismatch: "AI 计划选择的出现位置与您指定的位置不一致，尚未修改文档。",
  match_limit_exceeded: "匹配数量超过 1000 处的安全上限，请缩小替换范围。原文未修改。",
  occurrence_unavailable: "指定序号超出了当前范围内的匹配数量，尚未修改文档。",
  missing_heading: "文档中找不到您指定的标题，尚未修改文档。请检查标题名称。",
  ambiguous_heading: "文档中有多个同名标题，无法确定目标章节。请指定第几个同名标题。",
  heading_mismatch: "AI 计划选择的标题与您指定的标题或序号不一致，尚未修改文档。",
  unsafe_target: "AI 计划的位置无法安全映射到 Markdown 源码，尚未修改文档。请明确目标位置。"
};

/** A rejected plan carries a stable code and concise text suitable for assistant UI. */
export class PlanValidationError extends Error {
  constructor(readonly code: PlanValidationCode) {
    super(MESSAGES[code]);
    this.name = "PlanValidationError";
  }
}

function fail(code: PlanValidationCode): never {
  throw new PlanValidationError(code);
}

function validateSpan(span: InstructionSpan, instruction: string): void {
  if (!Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < 0 || span.to < span.from || span.to > instruction.length ||
      !isSafeMarkdownBoundary(instruction, span.from) || !isSafeMarkdownBoundary(instruction, span.to) || instruction.slice(span.from, span.to) !== span.raw) {
    fail("invalid_evidence");
  }
}

function validateConstraint<T>(constraint: InstructionConstraint<T>, instruction: string): void {
  if (constraint.state === "unknown") return;
  if (!constraint.evidence.length) fail("invalid_evidence");
  constraint.evidence.forEach((evidence) => validateSpan(evidence, instruction));
}

function validateContractEvidence(contract: InstructionContract, instruction: string): void {
  validateConstraint(contract.effect, instruction);
  validateConstraint(contract.operation, instruction);
  validateConstraint(contract.target, instruction);
  validateConstraint(contract.scope, instruction);
  validateConstraint(contract.occurrence, instruction);
  validateConstraint(contract.layout, instruction);
  validateConstraint(contract.heading, instruction);
  if (contract.generationTasks) validateConstraint(contract.generationTasks, instruction);
  contract.literals.forEach((literal) => {
    validateSpan(literal, instruction);
    if (literal.raw !== literal.value) fail("invalid_evidence");
  });
  contract.issues.forEach(({ evidence }) => evidence.forEach((span) => validateSpan(span, instruction)));
}

function explicitValue<T>(constraint: InstructionConstraint<T>): T | undefined {
  return constraint.state === "explicit" ? constraint.value : undefined;
}

function isActionable(intent: ValidatedIntent): intent is Extract<ValidatedIntent, { kind: "edit" | "answer" }> {
  return intent.kind === "edit" || intent.kind === "answer";
}

function selectionIsAvailable(snapshot: AiDocumentSnapshot): boolean {
  const selection = snapshot.selection;
  if (!selection || snapshot.selectionValid === false) return false;
  return Number.isInteger(selection.from) && Number.isInteger(selection.to) && selection.from < selection.to &&
    isSafeMarkdownBoundary(snapshot.content, selection.from) && isSafeMarkdownBoundary(snapshot.content, selection.to);
}

function cursorIsAvailable(snapshot: AiDocumentSnapshot): boolean {
  return snapshot.cursor !== null && isSafeMarkdownBoundary(snapshot.content, snapshot.cursor);
}

function validateSnapshotPreconditions(contract: InstructionContract, intent: ValidatedIntent, snapshot: AiDocumentSnapshot): void {
  const target = intent.kind === "edit" || intent.kind === "answer" ? intent.target : undefined;
  const scope = explicitValue(contract.scope);
  const selectionNeeded = contract.preconditions.selectionRequired || scope === "selection" || target === "selection" || target === "selection_end" ||
    (intent.kind === "edit" && intent.operation === "insert" && intent.target === "exact_match" && intent.matchScope === "selection");
  const selectionAvailable = selectionIsAvailable(snapshot);
  const cursorNeeded = contract.preconditions.cursorRequired || target === "cursor";
  const cursorAvailable = cursorIsAvailable(snapshot);

  if (contract.preconditions.selectionAvailable !== undefined && contract.preconditions.selectionAvailable !== selectionAvailable) fail("snapshot_mismatch");
  if (contract.preconditions.cursorAvailable !== undefined && contract.preconditions.cursorAvailable !== cursorAvailable) fail("snapshot_mismatch");
  if (selectionNeeded && isActionable(intent) && !selectionAvailable) fail("selection_required");
  if (cursorNeeded && isActionable(intent) && !cursorAvailable) fail("cursor_required");
}

function plannedScope(intent: ValidatedIntent): "document" | "selection" | undefined {
  if (intent.kind === "answer") return intent.target;
  if (intent.kind !== "edit") return undefined;
  if (intent.operation === "rewrite" || intent.operation === "replace_exact") return intent.target;
  if (intent.target === "selection_end") return "selection";
  if (intent.target === "exact_match") return intent.matchScope;
  return "document";
}

function validateEffectAndConstraints(intent: ValidatedIntent, contract: InstructionContract): void {
  if (!isActionable(intent)) return;
  if (contract.effect.state === "explicit" && contract.effect.value === "no_edit" && intent.kind === "edit") fail("effect_mismatch");
  if (contract.effect.state === "conflict" || contract.effect.state === "ambiguous" ||
      contract.operation.state === "conflict" || contract.operation.state === "ambiguous" ||
      contract.target.state === "conflict" || contract.target.state === "ambiguous" ||
      contract.scope.state === "conflict" || contract.scope.state === "ambiguous" ||
      contract.occurrence.state === "conflict" || contract.occurrence.state === "ambiguous" ||
      contract.layout.state === "conflict" || contract.layout.state === "ambiguous" ||
      contract.heading.state === "conflict" || contract.heading.state === "ambiguous" || contract.issues.length > 0) {
    fail("ambiguous_instruction");
  }

  const effect = explicitValue(contract.effect);
  if ((effect === "answer" && intent.kind !== "answer") || (effect === "edit" && intent.kind !== "edit") || effect === "no_edit") {
    fail("effect_mismatch");
  }
  const operation = explicitValue(contract.operation);
  if (operation && (intent.kind !== "edit" || intent.operation !== operation)) fail("operation_mismatch");

  if (contract.generationTasks?.state === "explicit" && intent.content.mode === "generate" && !contract.generationTasks.value.includes(intent.content.task)) fail("task_mismatch");
  const target = explicitValue(contract.target);
  if (target && (intent.kind !== "edit" && intent.kind !== "answer" || intent.target !== target)) fail("target_mismatch");
  const scope = explicitValue(contract.scope);
  if (scope && plannedScope(intent) !== scope) fail("scope_mismatch");
  const layout = explicitValue(contract.layout);
  if (layout && (intent.kind !== "edit" || intent.operation !== "insert" || intent.layout !== layout)) fail("layout_mismatch");

  if (intent.kind === "edit" && intent.operation === "insert" && (intent.target === "heading_end" || intent.target === "section_end") && contract.heading.state === "unknown") {
    fail("ambiguous_heading");
  }
}

function uniqueLiteralValue(contract: InstructionContract, role: "find" | "write"): string | undefined {
  const values = [...new Set(contract.literals.filter((literal) => literal.role === role).map(({ value }) => value))];
  if (values.length > 1) fail("ambiguous_instruction");
  return values[0];
}

function resolveLiteral(intent: IntentEdit, candidates: IntentCandidates): string | undefined {
  if (intent.content.mode !== "literal") return undefined;
  if ("text" in intent.content) return intent.content.text;
  return candidates.literals.find(({ id }) => id === ("literalId" in intent.content ? intent.content.literalId : ""))?.text;
}

function validateLiteralAndFind(
  intent: IntentEdit,
  contract: InstructionContract,
  candidates: IntentCandidates,
  instruction: string,
  snapshot: AiDocumentSnapshot
): void {
  const expectedWrite = uniqueLiteralValue(contract, "write");
  const actualWrite = resolveLiteral(intent, candidates);
  if (actualWrite !== undefined && isPartialArtifactPayload(instruction, actualWrite)) fail("artifact_content_mismatch");
  if (expectedWrite !== undefined && !isPartialArtifactPayload(instruction, expectedWrite)) {
    if (intent.content.mode !== "literal" || actualWrite !== expectedWrite) fail("literal_mismatch");
  } else if (intent.content.mode === "literal") {
    const groundedValues = extractIntentLiterals(instruction).map(({ text }) => text);
    if (actualWrite === undefined || !groundedValues.includes(actualWrite)) fail("literal_mismatch");
  }

  const expectedFind = uniqueLiteralValue(contract, "find");
  if (intent.operation === "replace_exact" || (intent.operation === "insert" && intent.target === "exact_match")) {
    const find = "find" in intent ? intent.find : undefined;
    const groundedValues = extractIntentLiterals(instruction).map(({ text }) => text);
    const sourceGroundedExactMatch = intent.operation === "insert" && intent.target === "exact_match" &&
      typeof find === "string" && find.length > 0 && snapshot.content.includes(find);
    if (!find || (expectedFind !== undefined ? find !== expectedFind : (!groundedValues.includes(find) && !sourceGroundedExactMatch))) fail("find_mismatch");
    validateOccurrence(intent, contract, snapshot);
  }
}

function countSourceMatches(source: string, from: number, to: number, find: string, stopAfter = Number.POSITIVE_INFINITY): number {
  if (!find) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= to - from - find.length) {
    const local = source.indexOf(find, from + offset);
    if (local < 0 || local + find.length > to) break;
    if (!isSafeMarkdownBoundary(source, local) || !isSafeMarkdownBoundary(source, local + find.length)) fail("unsafe_target");
    count += 1;
    if (count >= stopAfter) break;
    offset = local - from + find.length;
  }
  return count;
}

function matchRange(intent: IntentEdit, snapshot: AiDocumentSnapshot): { from: number; to: number } {
  if (intent.operation === "replace_exact") {
    if (intent.target === "document") return { from: 0, to: snapshot.content.length };
    if (!selectionIsAvailable(snapshot)) fail("selection_required");
    return snapshot.selection!;
  }
  if (intent.target === "exact_match") {
    if (intent.matchScope === "selection") {
      if (!selectionIsAvailable(snapshot)) fail("selection_required");
      return snapshot.selection!;
    }
    return { from: 0, to: snapshot.content.length };
  }
  return { from: 0, to: snapshot.content.length };
}

function validateOccurrence(intent: IntentEdit, contract: InstructionContract, snapshot: AiDocumentSnapshot): void {
  const occurrence = intent.operation === "replace_exact" || intent.target === "exact_match" ? intent.occurrence : undefined;
  const find = "find" in intent ? intent.find : undefined;
  if (!find) fail("find_mismatch");
  if (occurrence === undefined) fail("occurrence_mismatch");
  const expected = explicitValue(contract.occurrence);
  if (expected !== undefined && expected !== occurrence) fail("occurrence_mismatch");
  const range = matchRange(intent, snapshot);
  if (occurrence === "all" && expected !== "all") fail("occurrence_mismatch");
  // Count only as far as needed to prove uniqueness, availability or the bounded all-match limit.
  const stopAfter = occurrence === "all" ? 1001 : occurrence === "last" && expected === "last" ? 1
    : occurrence === "single" ? 2
      : typeof occurrence === "number" ? expected === undefined ? 2 : occurrence
        : expected === undefined ? 2 : 1;
  const matches = countSourceMatches(snapshot.content, range.from, range.to, find, stopAfter);
  if (!matches) fail("missing_match");
  if (occurrence === "all" && matches > 1000) fail("match_limit_exceeded");
  if (expected === undefined && matches > 1) fail("ambiguous_match");
  if (occurrence === "single" && matches !== 1) fail("ambiguous_match");
  if (typeof occurrence === "number" && (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches)) fail("occurrence_unavailable");
}

function normalizeHeading(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function validateHeading(intent: IntentEdit, contract: InstructionContract, snapshot: AiDocumentSnapshot, candidates: IntentCandidates): void {
  if (intent.operation !== "insert" || (intent.target !== "heading_end" && intent.target !== "section_end")) return;
  if (contract.heading.state !== "explicit") fail("ambiguous_heading");
  const requested = contract.heading.value;
  if (requested.relation !== intent.target) fail("target_mismatch");

  const headings = readIntentHeadingRanges(snapshot.content);
  const wantedName = normalizeHeading(requested.text);
  const sameName = wantedName ? headings.filter(({ text }) => normalizeHeading(text) === wantedName) : [];
  let chosen: (typeof headings)[number] | undefined;
  if (requested.ordinal !== undefined) {
    const ordinalScope = requested.ordinalScope ?? "same_title";
    if (ordinalScope === "same_title" && !wantedName) fail("ambiguous_heading");
    const sequence = ordinalScope === "global" ? headings : sameName;
    const indexed = sequence[requested.ordinal - 1];
    if (!Number.isInteger(requested.ordinal) || requested.ordinal < 1 || !indexed) fail("missing_heading");
    if (wantedName && normalizeHeading(indexed.text) !== wantedName) fail("heading_mismatch");
    chosen = indexed;
  } else {
    if (!wantedName) fail("ambiguous_heading");
    if (!sameName.length) fail("missing_heading");
    if (sameName.length > 1) fail("ambiguous_heading");
    chosen = sameName[0];
  }
  if (!chosen) fail("missing_heading");

  const candidate = candidates.headings.find(({ id }) => id === chosen.id);
  if (!candidate || candidate.text !== chosen.text || candidate.level !== chosen.level) fail("missing_heading");
  if (intent.targetId !== chosen.id) fail("heading_mismatch");
}

function validateInsertionLocation(intent: IntentEdit, snapshot: AiDocumentSnapshot): void {
  if (intent.operation !== "insert") return;
  if (intent.target === "body_start") {
    try { getMarkdownBodyStart(snapshot.content); } catch { fail("unsafe_target"); }
  }
  if (intent.target === "cursor") {
    if (!cursorIsAvailable(snapshot)) fail("cursor_required");
  }
  if (intent.target === "selection_end") {
    if (!selectionIsAvailable(snapshot)) fail("selection_required");
  }
  if (intent.target === "exact_match" && !intent.find) fail("find_mismatch");
}

/** Validates a model plan against original instruction evidence and the immutable Markdown snapshot. */
export function validatePlannedIntent(
  intent: ValidatedIntent,
  contract: InstructionContract,
  snapshot: AiDocumentSnapshot,
  candidates: IntentCandidates,
  instruction: string
): void {
  validateContractEvidence(contract, instruction);
  if (!isActionable(intent)) return;
  validateSnapshotPreconditions(contract, intent, snapshot);
  if (intent.kind === "answer" && contract.scope.state === "unknown" && selectionIsAvailable(snapshot) && intent.target !== "selection") fail("scope_mismatch");
  validateEffectAndConstraints(intent, contract);

  if (intent.kind === "answer") return;
  if (snapshot.readOnly) fail("read_only");

  validateInsertionLocation(intent, snapshot);
  validateLiteralAndFind(intent, contract, candidates, instruction, snapshot);
  validateHeading(intent, contract, snapshot, candidates);
}
