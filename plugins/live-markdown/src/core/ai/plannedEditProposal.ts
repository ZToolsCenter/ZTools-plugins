import type { AiDocumentSnapshot, AiEditProposal } from "../../types/aiEditing";
import { buildBoundIntentPatch, type BoundIntent } from "./intentBinder";
import { deriveMarkdownMutationPolicy } from "./markdownMutationPolicy";
import { validateMarkdownAppendIntegrity, validateMarkdownAstIntegrity, validateMarkdownFragmentCompleteness } from "./markdownAstIntegrity";

/** One final, range-owned proposal after generated or explicitly edited draft validation. */
export function createPlannedEditProposal(bound: BoundIntent, snapshot: AiDocumentSnapshot, text: string, conservative: boolean): AiEditProposal {
  if (bound.intent.kind !== "edit") throw new Error("回答计划不能写入文档。");
  const intent = bound.intent;
  const patch = buildBoundIntentPatch(bound, text);
  if (patch.expectedText === patch.insertText) throw new Error("本次计划没有改变原文，未生成可应用的修改。请检查替换前后的内容。");
  const content = snapshot.content.slice(0, patch.from) + patch.insertText + snapshot.content.slice(patch.to);
  if (new TextEncoder().encode(content).byteLength > 1_048_576) throw new Error("最终文档超过 1 MiB 安全上限，原文未修改。");
  const mutationPolicy = intent.operation === "replace_exact" && intent.content.mode === "literal" && bound.literalText !== undefined && bound.matches
    ? deriveMarkdownMutationPolicy(snapshot.content, {
      operation: intent.operation, contentMode: intent.content.mode, matchesBound: true,
      changes: bound.matches.map(({ from, to }) => ({ from, to, matchedText: snapshot.content.slice(from, to), insertText: text }))
    }) ?? undefined : undefined;
  if (intent.operation === "rewrite") validateMarkdownAstIntegrity(bound.source, text, conservative);
  if (intent.operation === "insert" && patch.from === snapshot.content.length) {
    validateMarkdownAppendIntegrity(snapshot.content, patch.insertText);
  } else {
    validateMarkdownFragmentCompleteness(snapshot.content);
    validateMarkdownAstIntegrity(snapshot.content, content, intent.operation === "rewrite" && conservative, mutationPolicy);
  }
  return { snapshot, patch, text: patch.insertText, summary: bound.summary, dependency: bound.dependency,
    mode: intent.operation === "insert" ? intent.target === "document_end" ? "append" : "insert" : "replace" };
}
