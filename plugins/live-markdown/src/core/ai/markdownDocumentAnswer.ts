import { readIntentHeadingRanges } from "./intentTargets";
import { headingTokens } from "./artifactInstructionEvidence";
import type { ThinTaskOutput } from "./thinTaskOutput";

export function isDocumentHeadingQuery(instruction: string): boolean {
  if (!/标题|\bheadings?\b/iu.test(instruction) ||
      !/有哪些|列出|列举|列一下|哪些|是什么|\b(?:list|which|what)\b/iu.test(instruction) ||
      /如何|怎么|怎样|总结|预算|负责人|包含|相关|匹配|开头|\b(?:how|summari[sz]e|related|matching|containing|and)\b/iu.test(instruction)) return false;
  const levels = [...new Set(headingTokens(instruction).map(({ level }) => level))];
  return levels.length <= 1 && (!/是什么/u.test(instruction) || levels.length === 1);
}

/** Closed structural query: the AST, rather than a model, owns which headings exist. */
export function answerDocumentHeadings(instruction: string, document: string,
  scope: { from: number; to: number }): ThinTaskOutput | undefined {
  if (!isDocumentHeadingQuery(instruction)) return undefined;
  const levels = [...new Set(headingTokens(instruction).map(({ level }) => level))];
  const headings = readIntentHeadingRanges(document).filter(heading => heading.from >= scope.from && heading.to <= scope.to &&
    (!levels.length || heading.level === levels[0]));
  const sourceFacts = headings.map(({ from, to }) => document.slice(from, to));
  return {
    text: headings.length ? `当前处理范围的标题：\n\n${headings.map(({ level, text }) => `- ${"#".repeat(level)} ${text}`).join("\n")}`
      : "当前处理范围没有匹配的 Markdown 标题。",
    warnings: [], sourceFacts, executor: "evidence",
    coverage: { totalChunks: 1, processedChunks: 1, requiredFacts: headings.length, selectedFacts: headings.length, missingFields: [] }
  };
}
