import type { AiTaskResult } from "./aiTaskRunner";
import type { AiDocumentSnapshot } from "../../types/aiEditing";
import { requestedOutputFormat, validateTaskCandidate } from "./aiOutputContract";
import { prepareMarkdownAppend } from "./aiAppendIntent";
import { validateMarkdownAppendIntegrity, validateMarkdownAstIntegrity } from "./markdownAstIntegrity";

/** Final gate runs after restoration/formatting, before any applicable proposal exists. */
export function finalizeAiTaskOutput(source: string, output: string, task: AiTaskResult, snapshot?: AiDocumentSnapshot, instruction = ""): string {
  output = validateTaskCandidate({ mode: task.literalAppend ? "literal" : task.outputMode ?? (task.semanticAction === "summarize" ? "summary" : task.editAction ? "rewrite" : "fragment"), source, raw: output, instruction, format: task.literalAppend ? "none" : requestedOutputFormat(instruction, task.semanticAction), sourceFacts: task.sourceFacts }).text;
  if (task.proposalMode === "append") {
    const text = prepareMarkdownAppend(source, output);
    validateMarkdownAppendIntegrity(source, text);
    return text;
  }
  if (task.editAction) {
    validateMarkdownAstIntegrity(source, output, task.conservative);
    if (snapshot?.selection) {
      const { from, to } = snapshot.selection;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > snapshot.content.length || snapshot.content.slice(from, to) !== source) {
        throw new Error("无法校验当前选区的完整 Markdown 结构，原文未修改。");
      }
      const candidate = snapshot.content.slice(0, from) + output + snapshot.content.slice(to);
      validateMarkdownAstIntegrity(snapshot.content, candidate, task.conservative);
    }
  }
  return output;
}
