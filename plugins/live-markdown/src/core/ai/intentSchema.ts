import type { IntentCandidates, IntentContent, IntentOccurrence, IntentReason, IntentTask, IntentTarget, ValidatedIntent } from "./intentTypes";
import { IntentProtocolError } from "./intentTypes";
import { hasGroundedIntentLiteral } from "./intentOccurrenceGrounding";
import { deriveInstructionContract } from "./instructionConstraints";
import type { InstructionContract } from "./intentContract";
import { unwrapJsonResponseEnvelope } from "./jsonResponseEnvelope";
import { parseIntentArtifactHint } from "./intentArtifactHint";

const MAX_OUTPUT_BYTES = 4 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const targets = new Set<IntentTarget>(["document", "body_start", "document_end", "selection", "selection_end", "cursor", "heading_end", "section_end", "exact_match"]);
const tasks = new Set<IntentTask>(["polish", "proofread", "academic-polish", "summarize", "continue", "restructure", "custom", "diagram", "tech-spec"]);
const reasons = new Set<IntentReason>(["missing_operation", "missing_target", "missing_content", "ambiguous_anchor", "scope_conflict", "compound", "conflicting_constraints", "unsupported_operation"]);

function fail(): never {
  throw new IntentProtocolError("invalid_output");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail();
}

function stringValue(value: unknown, maxBytes = 4096): value is string {
  return typeof value === "string" && encoder.encode(value).byteLength <= maxBytes;
}

function scanJsonForDuplicateKeys(source: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "")) index += 1; };
  const parseString = (): string => {
    const start = index;
    if (source[index++] !== '"') fail();
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, index)) as string; } catch { return fail(); }
      }
      if (char === "\\") index += 1;
      else if (char.charCodeAt(0) < 0x20) fail();
    }
    return fail();
  };
  const parseValue = (depth: number): void => {
    if (depth > 16) fail();
    whitespace();
    if (source[index] === '"') { parseString(); return; }
    if (source[index] === "{") {
      index += 1; whitespace();
      const keys = new Set<string>();
      if (source[index] === "}") { index += 1; return; }
      while (index < source.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) fail();
        keys.add(key); whitespace();
        if (source[index++] !== ":") fail();
        parseValue(depth + 1); whitespace();
        const delimiter = source[index++];
        if (delimiter === "}") return;
        if (delimiter !== ",") fail();
      }
      return fail();
    }
    if (source[index] === "[") {
      index += 1; whitespace();
      if (source[index] === "]") { index += 1; return; }
      while (index < source.length) {
        parseValue(depth + 1); whitespace();
        const delimiter = source[index++];
        if (delimiter === "]") return;
        if (delimiter !== ",") fail();
      }
      return fail();
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index += 1;
    if (start === index) fail();
  };
  parseValue(0);
  whitespace();
  if (index !== source.length) fail();
}

function validateCandidates(candidates: IntentCandidates): void {
  if (!candidates || !Array.isArray(candidates.headings) || !Array.isArray(candidates.literals) ||
      (candidates.incomplete !== undefined && typeof candidates.incomplete !== "boolean") ||
      candidates.headings.length > 256 || candidates.literals.length > 256) fail();
  const headingIds = new Set<string>();
  for (const heading of candidates.headings) {
    if (!isRecord(heading) || !stringValue(heading.id, 128) || !heading.id || headingIds.has(heading.id) ||
        !stringValue(heading.text, 2048) || !Number.isInteger(heading.level) || heading.level < 1 || heading.level > 6) fail();
    headingIds.add(heading.id);
  }
  const literalIds = new Set<string>();
  for (const literal of candidates.literals) {
    if (!isRecord(literal) || !stringValue(literal.id, 128) || !literal.id || literalIds.has(literal.id) || !stringValue(literal.text, MAX_INPUT_BYTES)) fail();
    literalIds.add(literal.id);
  }
}

function parseContent(value: unknown, instruction: string, candidates: IntentCandidates): IntentContent {
  if (!isRecord(value) || typeof value.mode !== "string") return fail();
  if (value.mode === "literal") {
    if (Object.hasOwn(value, "text")) {
      exactKeys(value, ["mode", "text"]);
      if (!stringValue(value.text, 256) || !value.text || !hasGroundedIntentLiteral(instruction, value.text)) fail();
      return { mode: "literal", text: value.text };
    }
    exactKeys(value, ["mode", "literalId"]);
    if (!stringValue(value.literalId, 128) || !value.literalId) fail();
    const candidate = candidates.literals.find((item) => item.id === value.literalId);
    if (!candidate || !candidate.text || !hasGroundedIntentLiteral(instruction, candidate.text)) fail();
    return { mode: "literal", literalId: value.literalId };
  }
  if (value.mode === "generate") {
    exactKeys(value, ["mode", "task", "artifact"], ["mode", "task"]);
    if (typeof value.task !== "string" || !tasks.has(value.task as IntentTask)) fail();
    const artifact = Object.hasOwn(value, "artifact") ? parseIntentArtifactHint(value.artifact, instruction) : undefined;
    return { mode: "generate", task: value.task as IntentTask, ...(artifact ? { artifact } : {}) };
  }
  return fail();
}

function parseOccurrence(value: unknown, operation: string, contract: InstructionContract): IntentOccurrence {
  if (value === "single") return value;
  if (value === "last") {
    if (operation !== "replace_exact" || contract.occurrence.state !== "explicit" || contract.occurrence.value !== value) fail();
    return value;
  }
  if (value === "all") {
    if (operation !== "replace_exact" || contract.occurrence.state !== "explicit" || contract.occurrence.value !== value) fail();
    return value;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1000 || contract.occurrence.state !== "explicit" || contract.occurrence.value !== value) fail();
  return value;
}

function requireGroundedFind(value: unknown, instruction: string): string {
  if (!stringValue(value, 256) || !value || !hasGroundedIntentLiteral(instruction, value)) fail();
  return value;
}

function resolveFind(value: Record<string, unknown>, instruction: string, candidates: IntentCandidates): string {
  const hasFind = Object.hasOwn(value, "find");
  const hasFindId = Object.hasOwn(value, "findId");
  if (hasFind === hasFindId) fail();
  if (hasFind) return requireGroundedFind(value.find, instruction);
  if (!stringValue(value.findId, 128) || !value.findId) fail();
  const candidate = candidates.literals.find((item) => item.id === value.findId);
  if (!candidate || !candidate.text || !hasGroundedIntentLiteral(instruction, candidate.text)) fail();
  return candidate.text;
}

function parseIntent(value: unknown, instruction: string, candidates: IntentCandidates, contract: InstructionContract, sourceText?: string): ValidatedIntent {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") return fail();
  if (value.kind === "clarify" || value.kind === "unsupported") {
    exactKeys(value, ["version", "kind", "reason"]);
    if (typeof value.reason !== "string" || !reasons.has(value.reason as IntentReason)) fail();
    return { version: 1, kind: value.kind, reason: value.reason as IntentReason };
  }
  if (value.kind === "answer") {
    exactKeys(value, ["version", "kind", "target", "content"]);
    if (value.target !== "document" && value.target !== "selection") fail();
    const content = parseContent(value.content, instruction, candidates);
    if (content.mode !== "generate") fail();
    return { version: 1, kind: "answer", target: value.target, content };
  }
  if (value.kind !== "edit") return fail();

  if (value.operation === "insert") {
    exactKeys(value, ["version", "kind", "operation", "target", "targetId", "layout", "content", "find", "occurrence", "matchScope"], ["version", "kind", "operation", "target", "layout", "content"]);
    if (typeof value.target !== "string" || !targets.has(value.target as IntentTarget) || value.target === "document" || value.target === "selection") fail();
    if (value.layout !== "block" && value.layout !== "inline") fail();
    let targetId: string | undefined;
    if (value.target === "heading_end" || value.target === "section_end") {
      if (!stringValue(value.targetId, 128) || !candidates.headings.some((item) => item.id === value.targetId)) fail();
      targetId = value.targetId;
    } else if (Object.hasOwn(value, "targetId")) fail();
    const content = parseContent(value.content, instruction, candidates);
    if (value.target === "exact_match") {
      if (!Object.hasOwn(value, "find") || !Object.hasOwn(value, "occurrence") || (value.matchScope !== "document" && value.matchScope !== "selection")) fail();
      const find = typeof sourceText === "string" && stringValue(value.find, 256) && value.find && sourceText.includes(value.find)
        ? value.find
        : requireGroundedFind(value.find, instruction);
      const occurrence = parseOccurrence(value.occurrence, "insert", contract);
      return { version: 1, kind: "edit", operation: "insert", target: "exact_match", layout: value.layout, content, find, occurrence, matchScope: value.matchScope, ...(targetId ? { targetId } : {}) };
    }
    if (Object.hasOwn(value, "find") || Object.hasOwn(value, "occurrence") || Object.hasOwn(value, "matchScope")) fail();
    return { version: 1, kind: "edit", operation: "insert", target: value.target as Exclude<IntentTarget, "document" | "selection">, layout: value.layout, content, ...(targetId ? { targetId } : {}) };
  }

  if (value.operation === "rewrite" || value.operation === "replace_exact") {
    const required = value.operation === "replace_exact"
      ? ["version", "kind", "operation", "target", "content", "occurrence"]
      : ["version", "kind", "operation", "target", "content"];
    const allowed = value.operation === "replace_exact"
      ? ["version", "kind", "operation", "target", "content", "find", "findId", "occurrence"]
      : ["version", "kind", "operation", "target", "content"];
    exactKeys(value, allowed, required);
    if (value.target !== "document" && value.target !== "selection") fail();
    const content = parseContent(value.content, instruction, candidates);
    if (value.operation === "replace_exact") {
      const find = resolveFind(value, instruction, candidates);
      const occurrence = parseOccurrence(value.occurrence, "replace_exact", contract);
      return { version: 1, kind: "edit", operation: "replace_exact", target: value.target, content, find, occurrence };
    }
    return { version: 1, kind: "edit", operation: "rewrite", target: value.target, content };
  }
  return fail();
}

/** Parses exactly one closed v1 JSON object and rejects ambiguous or ungrounded fields. */
export function parseIntentOutput(output: string, instruction: string, candidates: IntentCandidates, contract?: InstructionContract, sourceText?: string): ValidatedIntent {
  if (!stringValue(output, MAX_OUTPUT_BYTES) || !output.trim() || !stringValue(instruction, MAX_INPUT_BYTES) || !instruction.trim()) fail();
  validateCandidates(candidates);
  let json: string;
  try { json = unwrapJsonResponseEnvelope(output); } catch { return fail(); }
  scanJsonForDuplicateKeys(json);
  let parsed: unknown;
  try { parsed = JSON.parse(json) as unknown; } catch { return fail(); }
  return parseIntent(parsed, instruction, candidates, contract ?? deriveInstructionContract(instruction), sourceText);
}
