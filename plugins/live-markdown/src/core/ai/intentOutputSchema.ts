import type { IntentCandidates, IntentOccurrence, IntentTask, IntentReason } from "./intentTypes";
import { deriveInstructionContract } from "./instructionConstraints";
import type { InstructionContract } from "./intentContract";
import { isCompleteLiteralArtifact, requestsStructuredArtifact } from "./intentArtifactContent";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import type { ArtifactSpec } from "./artifactSpec";
import { groundedArtifactHintOptions } from "./intentArtifactHint";
import { resolveGenerationRequirements } from "./generationRequirements";
import { scanInstructionQuotes } from "./instructionLiteralEvidence";

type Schema = Record<string, unknown>;
const fixed = (value: unknown): Schema => ({ const: value });
const choice = (values: readonly unknown[]): Schema => ({ enum: values });
const text = { type: "string", minLength: 1, maxLength: 256 };
const object = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const tasks: IntentTask[] = ["polish", "proofread", "academic-polish", "summarize", "continue", "restructure", "custom", "diagram", "tech-spec"];
const reasons: IntentReason[] = ["missing_operation", "missing_target", "missing_content", "ambiguous_anchor", "scope_conflict", "compound", "conflicting_constraints", "unsupported_operation"];
function artifactHintSchema(spec: ArtifactSpec, instruction: string): Schema | undefined {
  const options = groundedArtifactHintOptions(spec, instruction);
  if (!options) return undefined;
  const properties: Record<string, Schema> = { kind: fixed(options.kind) };
  for (const [field, values] of Object.entries(options.fields)) {
    if (!values?.length) continue;
    properties[field] = values.length === 1 ? fixed(values[0]) : choice(values);
  }
  return { anyOf: [object(properties, ["kind"])] };
}

/** Projects the same source-grounded occurrence evidence consumed by parsing and binding. */
export function intentOccurrenceChoices(instruction: string, _candidates: IntentCandidates, contract = deriveInstructionContract(instruction)): IntentOccurrence[] {
  if (contract.occurrence.state === "explicit") return [contract.occurrence.value];
  // "single" is a uniqueness precondition, not a guessed ordinal. Binding still rejects duplicates.
  return ["single"];
}

function schemaValues(schema: Schema): unknown[] {
  return Array.isArray(schema.enum) ? schema.enum : Object.hasOwn(schema, "const") ? [schema.const] : [];
}

function constrainProperty(properties: Record<string, Schema>, key: string, allowed: unknown[]): boolean {
  const previous = properties[key];
  if (!previous) return true;
  const retained = schemaValues(previous).filter((value) => allowed.includes(value));
  if (!retained.length) return false;
  properties[key] = retained.length === 1 ? fixed(retained[0]) : choice(retained);
  return true;
}

function projectContract(
  branches: Schema[],
  contract: InstructionContract,
  candidates: IntentCandidates,
  structuredArtifact: boolean,
  artifactSpec: ArtifactSpec,
  instruction: string
): Schema[] {
  const write = contract.literals.filter((literal) => literal.role === "write");
  const find = contract.literals.filter((literal) => literal.role === "find");
  const ambiguous = contract.issues.length > 0 || [contract.effect, contract.operation, contract.target, contract.scope, contract.occurrence]
    .some((condition) => condition.state === "ambiguous" || condition.state === "conflict");
  return branches.filter((branch) => {
    const properties = branch.properties as Record<string, Schema>;
    const kind = properties.kind.const;
    const branchKinds = schemaValues(properties.kind);
    if (properties.reason && branchKinds.some((value) => value === "clarify" || value === "unsupported")) {
      if (contract.issues.length === 1 && !constrainProperty(properties, "reason", [contract.issues[0].code])) return false;
      const missingScope = contract.preconditions.selectionRequired && !contract.preconditions.selectionAvailable ||
        contract.preconditions.cursorRequired && !contract.preconditions.cursorAvailable;
      if (!ambiguous && !missingScope && contract.effect.state === "explicit" && contract.effect.value === "answer") {
        // The read operation and scope are already bound. A supplied quoted subject also
        // proves this is not an empty request; otherwise a content clarification remains.
        if (scanInstructionQuotes(instruction).some(quote => instruction.slice(quote.from, quote.to).trim())) return false;
        return constrainProperty(properties, "reason", ["missing_content"]);
      }
      return true;
    }
    // This grammar is only sent when a model is asked to interpret an intent.
    // Complete lexical fields cannot prove that free-form language is understood.
    if (kind !== "edit" && kind !== "answer") return true;
    if (ambiguous || contract.effect.state === "explicit" && contract.effect.value === "no_edit") return false;
    if (contract.effect.state === "explicit" && contract.effect.value !== kind) return false;
    if (kind === "edit" && contract.operation.state === "explicit" && !constrainProperty(properties, "operation", [contract.operation.value])) return false;
    if (contract.target.state === "explicit" && !constrainProperty(properties, "target", [contract.target.value])) return false;
    if (contract.scope.state === "explicit") {
      if (properties.matchScope && !constrainProperty(properties, "matchScope", [contract.scope.value])) return false;
      if (schemaValues(properties.target).some((value) => value === "document" || value === "selection") && !constrainProperty(properties, "target", [contract.scope.value])) return false;
    }
    if (contract.layout.state === "explicit" && !constrainProperty(properties, "layout", [contract.layout.value])) return false;
    if (properties.targetId && contract.heading.state === "explicit") {
      const heading = contract.heading.value;
      const matching = candidates.headings.filter((candidate) => candidate.text.replace(/[*_`]/gu, "").trim().toLowerCase() === heading.text.replace(/[*_`]/gu, "").trim().toLowerCase());
      // Global ordinals were resolved against the full source AST by candidate construction;
      // never reinterpret them as an index into a truncated/relevant candidate list.
      const selected = heading.ordinalScope === "global" ? candidates.headings : heading.ordinal === undefined ? matching : matching.slice(heading.ordinal - 1, heading.ordinal);
      if (!constrainProperty(properties, "targetId", selected.map(({ id }) => id))) return false;
    }
    if (kind === "edit" && find.length === 1 && properties.operation.const === "replace_exact") {
      if (properties.findId && !constrainProperty(properties, "findId", candidates.literals.filter(({ text }) => text === find[0].value).map(({ id }) => id))) return false;
      if (properties.find) {
        if (new TextEncoder().encode(find[0].value).byteLength > 256) return false;
        properties.find = fixed(find[0].value);
      }
    }
    if (contract.generationTasks?.state === "explicit") {
      const content = properties.content;
      const alternatives = (content.anyOf ?? [content]) as Schema[];
      const retained = alternatives.filter((alternative) => {
        const fields = alternative.properties as Record<string, Schema>;
        return fields.mode.const !== "generate" || constrainProperty(fields, "task", contract.generationTasks!.state === "explicit" ? contract.generationTasks!.value : []);
      });
      if (!retained.length) return false;
      properties.content = content.anyOf ? { anyOf: retained } : retained[0];
    }
    if (kind === "edit" && write.length === 1 &&
        (!structuredArtifact || isCompleteLiteralArtifact(artifactSpec, write[0].value))) {
      const alternatives = (properties.content.anyOf as Schema[]).filter((content) => {
        const fields = content.properties as Record<string, Schema>;
        if (fields.mode.const !== "literal") return false;
        if (fields.literalId) return constrainProperty(fields, "literalId", candidates.literals.filter(({ text }) => text === write[0].value).map(({ id }) => id));
        if (new TextEncoder().encode(write[0].value).byteLength > 256) return false;
        fields.text = fixed(write[0].value);
        return true;
      });
      if (!alternatives.length) return false;
      properties.content = { anyOf: alternatives };
    }
    return true;
  });
}

/** Closed per-request wire grammar for local managed inference, followed by the normal parser. */
export function buildIntentOutputSchema(instruction: string, selected: boolean, candidates: IntentCandidates, contract: InstructionContract = deriveInstructionContract(instruction)): Schema {
  const ids = candidates.literals.map(({ id }) => id);
  const effect = contract.effect.state === "explicit" && contract.effect.value === "answer" ? "answer" : "edit";
  const operation = contract.operation.state === "explicit" ? contract.operation.value : "insert";
  const artifactSpec = resolveArtifactSpec(instruction, resolveGenerationRequirements(instruction), {
    effect, ...(effect === "edit" ? { operation } : {})
  });
  const structuredArtifact = requestsStructuredArtifact(instruction, artifactSpec);
  const completeArtifacts = structuredArtifact
    ? candidates.literals.filter(({ text }) => isCompleteLiteralArtifact(artifactSpec, text)) : [];
  const artifact = artifactHintSchema(artifactSpec, instruction);
  const generated = object({ mode: fixed("generate"), task: choice(tasks), ...(artifact ? { artifact } : {}) }, ["mode", "task"]);
  const literal = object({ mode: fixed("literal"), text });
  const contentFor = (literalIds: string[]): Schema => {
    const allowedIds = structuredArtifact
      ? literalIds.filter((id) => completeArtifacts.some((candidate) => candidate.id === id)) : literalIds;
    return { anyOf: [
      ...(allowedIds.length ? [object({ mode: fixed("literal"), literalId: choice(allowedIds) })] : []),
      ...(!structuredArtifact ? [literal] : completeArtifacts.length
        ? [object({ mode: fixed("literal"), text: choice(completeArtifacts.map(({ text }) => text)) })] : []), generated
    ] };
  };
  const content = contentFor(ids);
  const base = { version: fixed(1), kind: fixed("edit") };
  const scope = choice(contract.scope.state === "explicit" ? [contract.scope.value] : selected ? ["selection"] : ["document"]);
  const branches: Schema[] = [
    object({ ...base, operation: fixed("insert"), target: choice(selected ? ["document_end", "body_start", "cursor", "selection_end"] : ["document_end", "body_start", "cursor"]), layout: choice(["block", "inline"]), content }),
    object({ ...base, operation: fixed("rewrite"), target: scope, content }),
    object({ version: fixed(1), kind: fixed("answer"), target: scope, content: generated }),
    object({ version: fixed(1), kind: choice(["clarify", "unsupported"]), reason: choice(reasons) })
  ];
  const occurrence = choice(intentOccurrenceChoices(instruction, candidates, contract));
  for (const id of ids) branches.push(object({
    ...base, operation: fixed("replace_exact"), target: scope, findId: fixed(id), occurrence,
    content: contentFor(ids.filter((candidate) => candidate !== id))
  }));
  branches.push(object({ ...base, operation: fixed("replace_exact"), target: scope, find: text, occurrence, content }));
  if (candidates.headings.length) branches.push(object({
    ...base, operation: fixed("insert"), target: choice(["heading_end", "section_end"]),
    targetId: choice(candidates.headings.map(({ id }) => id)), layout: choice(["block", "inline"]), content
  }));
  const insertOccurrences = intentOccurrenceChoices(instruction, candidates, contract).filter((value) => value !== "last" && value !== "all");
  if (insertOccurrences.length) branches.push(object({
    ...base, operation: fixed("insert"), target: fixed("exact_match"), find: text,
    occurrence: choice(insertOccurrences), matchScope: scope, layout: choice(["block", "inline"]), content
  }));
  return { anyOf: projectContract(branches, contract, candidates, structuredArtifact, artifactSpec, instruction) };
}
