import type { ArtifactField, ArtifactSpec, HeadingLevel } from "./artifactSpec";
import { artifactFieldIsGrounded } from "./artifactSpec";
import { extractExplicitArtifactLanguages, normalizeArtifactLanguage } from "./artifactLanguageEvidence";
import { hasGroundedIntentLiteral } from "./intentOccurrenceGrounding";
import { headingTokens } from "./artifactInstructionEvidence";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { IntentProtocolError } from "./intentTypes";

/** Small parameter-only hint from the single planner call. It never carries body text or offsets. */
export type IntentArtifactHint =
  | { kind: "code"; language?: string; headingLevel?: HeadingLevel; headingText?: string; functionName?: string }
  | { kind: "heading"; headingLevel?: HeadingLevel; headingText?: string }
  | { kind: "table"; columns?: string[] }
  | { kind: "math"; equation?: string }
  | { kind: "list"; items?: string[] }
  | { kind: "mermaid" };

export type IntentArtifactHintField = "language" | "headingLevel" | "headingText" | "functionName" | "columns" | "equation" | "items";
export interface GroundedArtifactHintOptions {
  readonly kind: IntentArtifactHint["kind"];
  readonly fields: Partial<Record<IntentArtifactHintField, readonly unknown[]>>;
}

const MAX_HINT_STRING_BYTES = 128;
const MAX_HINT_ITEMS = 12;

function fail(): never {
  throw new IntentProtocolError("invalid_output");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || !Object.hasOwn(value, "kind")) fail();
}

function groundedString(value: unknown, instruction: string): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    new TextEncoder().encode(value).byteLength <= MAX_HINT_STRING_BYTES &&
    hasGroundedIntentLiteral(instruction, value);
}

function parseTextArray(value: unknown, instruction: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HINT_ITEMS ||
      value.some((item) => !groundedString(item, instruction))) return fail();
  return value as string[];
}

function languageRoleValues(instruction: string): ArtifactField<string>[] {
  const evidence = extractExplicitArtifactLanguages(instruction);
  const normalized = new Set(evidence.map(({ value }) => value));
  return normalized.size === 1 ? evidence : [];
}

function groundedValue<T>(instruction: string, value: ArtifactField<T> | undefined): readonly unknown[] | undefined {
  if (!value || !artifactFieldIsGrounded(instruction, value)) return undefined;
  if (typeof value.value === "string" && new TextEncoder().encode(value.value).byteLength > MAX_HINT_STRING_BYTES) return undefined;
  return [value.value];
}

function groundedList<T extends string>(instruction: string, fields: readonly ArtifactField<T>[] | undefined): readonly unknown[] | undefined {
  if (!fields?.length || fields.length > MAX_HINT_ITEMS || !fields.every((field) =>
    artifactFieldIsGrounded(instruction, field) && new TextEncoder().encode(field.value).byteLength <= MAX_HINT_STRING_BYTES)) return undefined;
  return [fields.map(({ value }) => value)];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Returns only parameter values independently grounded by the resolved artifact and source roles. */
export function groundedArtifactHintOptions(spec: ArtifactSpec, instruction: string): GroundedArtifactHintOptions | undefined {
  const fields: Partial<Record<IntentArtifactHintField, readonly unknown[]>> = {};
  if (spec.kind === "code") {
    const roleLanguages = languageRoleValues(instruction);
    const knownLanguage = spec.language && artifactFieldIsGrounded(instruction, spec.language)
      ? roleLanguages.filter(({ value, evidence }) => value === spec.language!.value &&
        evidence.some((roleEvidence) => spec.language!.evidence.some((fieldEvidence) =>
          fieldEvidence.from === roleEvidence.from && fieldEvidence.to === roleEvidence.to && fieldEvidence.raw === roleEvidence.raw)))
        .map(({ evidence }) => evidence[0].raw)
      : [];
    const languageOptions = spec.language
      ? uniqueStrings(knownLanguage)
      : spec.issues.includes("conflicting_code_languages") ? [] : uniqueStrings(roleLanguages.map(({ evidence }) => evidence[0].raw));
    if (languageOptions.length) fields.language = languageOptions;
    const headingLevel = groundedValue(instruction, spec.heading?.level);
    const headingText = groundedValue(instruction, spec.heading?.text);
    const functionName = groundedValue(instruction, spec.functionName);
    if (headingLevel) fields.headingLevel = headingLevel;
    if (headingText) fields.headingText = headingText;
    if (functionName) fields.functionName = functionName;
    return { kind: "code", fields };
  }
  if (spec.kind === "heading") {
    const headingLevel = groundedValue(instruction, spec.heading.level);
    const headingText = groundedValue(instruction, spec.heading.text);
    if (headingLevel) fields.headingLevel = headingLevel;
    if (headingText) fields.headingText = headingText;
    return { kind: "heading", fields };
  }
  if (spec.kind === "table") {
    const columns = groundedList(instruction, spec.columns);
    if (columns) fields.columns = columns;
    return { kind: "table", fields };
  }
  if (spec.kind === "math") {
    const equation = groundedValue(instruction, spec.equation);
    if (equation) fields.equation = equation;
    return { kind: "math", fields };
  }
  if (spec.kind === "list") {
    const items = groundedList(instruction, spec.items);
    if (items) fields.items = items;
    return { kind: "list", fields };
  }
  if (spec.kind === "mermaid") return { kind: "mermaid", fields };
  return undefined;
}

function hasHeadingLevelEvidence(instruction: string, level: number): boolean {
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  return headingTokens(masked).some((token) => token.level === level);
}

/** Validates a planner hint without accepting model-provided offsets or normalized strings. */
export function parseIntentArtifactHint(value: unknown, instruction: string): IntentArtifactHint {
  if (!isRecord(value) || typeof value.kind !== "string") return fail();
  const kind = value.kind;
  const fieldsByKind: Record<string, readonly string[]> = {
    code: ["kind", "language", "headingLevel", "headingText", "functionName"],
    heading: ["kind", "headingLevel", "headingText"],
    table: ["kind", "columns"],
    math: ["kind", "equation"],
    list: ["kind", "items"],
    mermaid: ["kind"]
  };
  const allowed = fieldsByKind[kind];
  if (!allowed) return fail();
  exactKeys(value, allowed);

  for (const key of ["headingText", "functionName", "equation"] as const) {
    if (Object.hasOwn(value, key) && !groundedString(value[key], instruction)) fail();
  }
  if (Object.hasOwn(value, "language") &&
      (typeof value.language !== "string" || !explicitLanguageField(instruction, value.language))) fail();
  for (const key of ["columns", "items"] as const) {
    if (Object.hasOwn(value, key)) parseTextArray(value[key], instruction);
  }
  if (Object.hasOwn(value, "headingLevel") &&
      (!Number.isInteger(value.headingLevel) || Number(value.headingLevel) < 1 || Number(value.headingLevel) > 6 ||
        !hasHeadingLevelEvidence(instruction, Number(value.headingLevel)))) fail();

  return value as unknown as IntentArtifactHint;
}

function withIssue(spec: ArtifactSpec, issue: string): ArtifactSpec {
  return spec.issues.includes(issue) ? spec : { ...spec, issues: [...spec.issues, issue] };
}

function equalGroundedField<T>(instruction: string, field: ArtifactField<T> | undefined, value: T, normalize: (input: T) => unknown = input => input): boolean | undefined {
  if (!field || !artifactFieldIsGrounded(instruction, field)) return undefined;
  return normalize(field.value) === normalize(value);
}

function equalsGroundedFields(instruction: string, fields: readonly ArtifactField<string>[] | undefined, values: readonly string[] | undefined): boolean | undefined {
  if (!fields || !values || !fields.length) return undefined;
  if (!fields.every((field) => artifactFieldIsGrounded(instruction, field))) return undefined;
  return fields.length === values.length && fields.every((field, index) => field.value === values[index]);
}

function explicitLanguageField(instruction: string, value: string): ArtifactField<string> | undefined {
  if (!/^[A-Za-z][A-Za-z0-9_+#.-]{0,31}$/u.test(value)) return undefined;
  const roles = languageRoleValues(instruction);
  const matching = roles.filter(({ value: language, evidence }) => language === normalizeArtifactLanguage(value) &&
    evidence[0]?.raw.toLowerCase() === value.toLowerCase());
  if (!matching.length) return undefined;
  return {
    value: normalizeArtifactLanguage(value),
    evidence: matching.flatMap(({ evidence }) => evidence)
  };
}

function hasKnownConflict(spec: ArtifactSpec, hint: IntentArtifactHint, instruction: string): boolean {
  if (spec.kind !== hint.kind) return true;
  if (spec.kind === "code" && hint.kind === "code") {
    if (hint.language !== undefined && (!explicitLanguageField(instruction, hint.language) ||
        spec.language && equalGroundedField(instruction, spec.language, hint.language, normalizeArtifactLanguage) !== true)) return true;
    return hint.functionName !== undefined && equalGroundedField(instruction, spec.functionName, hint.functionName) !== true ||
      hint.headingLevel !== undefined && equalGroundedField(instruction, spec.heading?.level, hint.headingLevel) !== true ||
      hint.headingText !== undefined && equalGroundedField(instruction, spec.heading?.text, hint.headingText) !== true;
  }
  if (spec.kind === "heading" && hint.kind === "heading") {
    return hint.headingLevel !== undefined && equalGroundedField(instruction, spec.heading.level, hint.headingLevel) !== true ||
      hint.headingText !== undefined && equalGroundedField(instruction, spec.heading.text, hint.headingText) !== true;
  }
  if (spec.kind === "table" && hint.kind === "table") {
    return hint.columns !== undefined && equalsGroundedFields(instruction, spec.columns, hint.columns) !== true;
  }
  if (spec.kind === "math" && hint.kind === "math") {
    return hint.equation !== undefined && equalGroundedField(instruction, spec.equation, hint.equation) !== true;
  }
  if (spec.kind === "list" && hint.kind === "list") {
    return hint.items !== undefined && equalsGroundedFields(instruction, spec.items, hint.items) !== true;
  }
  return false;
}

/** Adds a conflict issue while keeping deterministic fields, source dependency, and completeness authoritative. */
export function mergeArtifactPlanHint(spec: ArtifactSpec, hint: IntentArtifactHint | undefined, instruction: string): ArtifactSpec {
  if (!hint) return spec;
  let parsed: IntentArtifactHint;
  try {
    parsed = parseIntentArtifactHint(hint, instruction);
  } catch {
    return withIssue(spec, "artifact_hint_conflict");
  }
  if (hasKnownConflict(spec, parsed, instruction)) return withIssue(spec, "artifact_hint_conflict");
  if (spec.kind === "code" && parsed.kind === "code" && !spec.language && parsed.language &&
      !spec.issues.includes("conflicting_code_languages")) {
    const language = explicitLanguageField(instruction, parsed.language);
    if (language) return { ...spec, language };
  }
  // Hints only confirm fields the source parser can independently ground. Unbound values remain model-generation requirements.
  return spec;
}
