import type { ValidatedIntent } from "./intentTypes";
import { resolveGenerationRequirements } from "./generationRequirements";
import { shouldOmitArtifactGenerationSource } from "./artifactGenerationContext";
import { createLiteralMarkdownArtifact } from "./literalMarkdownArtifact";

// Whole-command grammars only. A task word inside unrestricted prose is not a
// complete interpretation of the user's request, even if its fields look full.
const SHORT_TASK_COMMAND = /^(?:(?:请(?:帮我)?|帮我)\s*)?(?:润色|校对|总结|续写)(?:一下)?\s*(?:全文|整篇|文档|文章|当前选区|选区|所选内容)?\s*[。！!]?$/u;
const SHORT_ENGLISH_TASK = /^(?:please\s+)?(?:polish|proofread|summari[sz]e|continue)(?:\s+(?:the\s+)?(?:document|article|selection|selected\s+text))?\s*[.!]?$/iu;

/** Rules may execute literals and closed templates; free-form creation is planned by the model. */
export function canResolveIntentProgrammatically(instruction: string, intent: ValidatedIntent): boolean {
  if (intent.kind !== "edit" && intent.kind !== "answer") return false;
  if (intent.content.mode === "literal") return true;
  const trimmed = instruction.trim();
  if (SHORT_TASK_COMMAND.test(trimmed) || SHORT_ENGLISH_TASK.test(trimmed)) return true;
  if (intent.kind !== "edit" || intent.operation !== "insert" || intent.target !== "document_end" || intent.layout !== "block") return false;
  const requirements = resolveGenerationRequirements(instruction, intent.content.task);
  if (requirements.artifact.state !== "explicit" || requirements.artifact.value !== "code") return false;
  return shouldOmitArtifactGenerationSource({ instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document" })
    && createLiteralMarkdownArtifact(requirements.contentInstruction) !== undefined;
}
