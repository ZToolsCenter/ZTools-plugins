import { validateCodeArtifactShape } from "./aiOutputContract";
import type { ArtifactSpec } from "./artifactSpec";
import { validateArtifactCandidate } from "./artifactValidation";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "./generationRequirements";

function resolveInsertedArtifact(instruction: string): ArtifactSpec {
  return resolveArtifactSpec(instruction, resolveGenerationRequirements(instruction), { effect: "edit", operation: "insert" });
}

function isStructuredSpec(spec: ArtifactSpec): boolean {
  return spec.kind !== "none" && spec.kind !== "markdown";
}

/** True when the instruction requests a code, table, math, diagram, heading, or list structure. */
export function requestsStructuredArtifact(instruction: string, resolved?: ArtifactSpec): boolean {
  return isStructuredSpec(resolved ?? resolveInsertedArtifact(instruction));
}

/** A structured literal is complete only if it satisfies the resolved artifact fields. */
export function isCompleteLiteralArtifact(spec: ArtifactSpec, text: string): boolean {
  if (!isStructuredSpec(spec) || spec.issues.length) return false;
  try {
    validateArtifactCandidate(spec, text);
    return true;
  } catch {
    return false;
  }
}

/** A single parameter is not a complete literal for an explicitly requested structure. */
export function isPartialArtifactPayload(instruction: string, text: string, resolved?: ArtifactSpec): boolean {
  const spec = resolved ?? resolveInsertedArtifact(instruction);
  return requestsStructuredArtifact(instruction, spec) && !isCompleteLiteralArtifact(spec, text);
}

/** An explicit code artifact is a structured output, not any literal word mentioned alongside it. */
export function requestsCodeArtifact(instruction: string): boolean {
  const artifact = resolveGenerationRequirements(instruction).artifact;
  return artifact.state === "explicit" && artifact.value === "code";
}

/** Literal plans may carry an already complete artifact; partial payloads need its surrounding structure. */
export function isCompleteLiteralCodeArtifact(text: string): boolean {
  if (!/^ {0,3}(?:`{3,}|~{3,})[\t ]*[^\s`~][^\r\n]*$/mu.test(text)) return false;
  try {
    validateCodeArtifactShape(text);
    return true;
  } catch {
    return false;
  }
}

export function isPartialCodeArtifactPayload(instruction: string, text: string): boolean {
  return requestsCodeArtifact(instruction) && !isCompleteLiteralCodeArtifact(text);
}
