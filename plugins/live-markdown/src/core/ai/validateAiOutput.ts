import { validateMarkdownFragmentCompleteness } from "./markdownAstIntegrity";
import { decodeAiResponse } from "./aiResponseDecoder";
import type { AiOutputFormat } from "./aiOutputContract";

/** Rejects outputs whose Markdown AST indicates generation stopped mid-block. */
export function validateAiOutput(text: string, format: AiOutputFormat = "none", displaySource = false): string {
  const normalized = text.trim();
  if (!normalized) throw new Error("模型返回空结果，内容不可应用。");
  const decoded = decodeAiResponse(text, format, displaySource);
  validateMarkdownFragmentCompleteness(decoded.content);
  return decoded.text;
}
