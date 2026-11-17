import type { MarkdownAiChunk } from "./markdownChunker";
import { validateMarkdownAstIntegrity } from "./markdownAstIntegrity";
export { validateMarkdownAstIntegrity } from "./markdownAstIntegrity";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokensIn(text: string, mask: string): string[] {
  return text.match(new RegExp(`${escapeRegExp(mask)}\\d+__`, "g")) ?? [];
}

function normalizeQuotedTokens(text: string, mask: string): string {
  const marker = `(${escapeRegExp(mask)}\\d+__)`;
  return text.replace(new RegExp("(\\x60+)" + marker + "(\\x60+)", "g"), (whole, left: string, token: string, right: string) => left === right ? token : whole);
}

function verifyProtectedTokens(text: string, chunk: MarkdownAiChunk): string {
  const output = normalizeQuotedTokens(text, chunk.mask);
  const expected = tokensIn(chunk.text, chunk.mask);
  const received = tokensIn(output, chunk.mask);
  if (received.length !== expected.length || received.some((token, index) => token !== expected[index])) {
    throw new Error("AI 输出移动、重排或遗漏了受保护的 Markdown 结构，请修改指令或缩小处理范围。");
  }
  if (output.replace(new RegExp(`${escapeRegExp(chunk.mask)}\\d+__`, "g"), "").includes(chunk.mask)) {
    throw new Error("AI 输出包含无效的受保护区域标记，请修改指令后重新生成。");
  }
  return output;
}

function plainText(text: string, chunk: MarkdownAiChunk): string {
  return text
    .replace(new RegExp(`${escapeRegExp(chunk.mask)}\\d+__`, "g"), " ")
    .replace(/[\s`*_~>#|\[\]()!\\]/g, "")
    .trim();
}

function proseParagraphs(text: string, chunk: MarkdownAiChunk): string[] {
  const prose = text.split(/\r\n|\r|\n/).filter((line) => !/^\s{0,3}#{1,6}\s+/.test(line)).join("\n");
  return prose.split(/\n[ \t]*\n+/)
    .map((part) => plainText(part, chunk))
    .filter((part) => part.length > 0);
}

function sectionBodyLengths(text: string, chunk: MarkdownAiChunk): number[] {
  const lengths: number[] = [];
  let body: string[] | null = null;
  const finish = () => {
    if (body) lengths.push(plainText(body.join("\n"), chunk).length);
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      finish();
      body = [];
    } else if (body) body.push(line);
  }
  finish();
  return lengths;
}

function verifyConservativeCoverage(source: string, output: string, chunk: MarkdownAiChunk): void {
  const sourceText = plainText(source, chunk);
  const outputText = plainText(output, chunk);
  if (!sourceText) return;
  const sourceParagraphs = proseParagraphs(source, chunk);
  const outputParagraphs = proseParagraphs(output, chunk);
  if (sourceParagraphs.length && outputParagraphs.length < sourceParagraphs.length) {
    throw new Error("AI 输出似乎遗漏了原文段落，未生成可应用的修改。");
  }

  const minimumChars = Math.ceil(sourceText.length * 0.5);
  if (outputText.length < minimumChars) {
    throw new Error("AI 输出比原文短得过多，可能遗漏了内容，未生成可应用的修改。");
  }
  if (outputText.length > sourceText.length * 4 + 240) {
    throw new Error("AI 输出异常扩张，可能重复了内容，未生成可应用的修改。");
  }

  const sourceSections = sectionBodyLengths(source, chunk);
  const outputSections = sectionBodyLengths(output, chunk);
  if (sourceSections.length && outputSections.length === sourceSections.length &&
    sourceSections.some((length, index) => length > 0 && outputSections[index] < Math.ceil(length * 0.5))) {
    throw new Error("AI 输出遗漏或大幅缩短了标题下的正文内容，未生成可应用的修改。");
  }

  const numbers = (value: string) => value.match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
  if (numbers(source).join("\u0000") !== numbers(output).join("\u0000")) {
    throw new Error("AI 输出改动了原文数字，请检查数字并调整指令。");
  }
  const checkboxStates = (value: string) => [...value.matchAll(/^\s{0,3}[-+*]\s+\[([ xX])\]/gm)].map((match) => match[1].toLowerCase());
  if (checkboxStates(source).join("") !== checkboxStates(output).join("")) {
    throw new Error("AI 输出改动了任务清单的完成状态，请调整指令。");
  }
  const emoji = (value: string) => value.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu) ?? [];
  if (emoji(source).join("\u0000") !== emoji(output).join("\u0000")) {
    throw new Error("AI 输出改动了原文图标或 emoji，请调整指令。");
  }
}

function restoreChunkProtectedValues(text: string, chunk: MarkdownAiChunk): string {
  return text.replace(new RegExp(`${escapeRegExp(chunk.mask)}\\d+__`, "g"), (token) => {
    const rawIndex = token.slice(chunk.mask.length, -2);
    const value = chunk.protectedValues[Number(rawIndex)];
    if (value === undefined) throw new Error("AI 输出包含未知的受保护区域标记，未生成可应用的修改。");
    return value;
  });
}

/** Rejects incomplete or cross-chunk model edits before chunks are combined. */
export function validateAiChunkOutput(text: string, chunk: MarkdownAiChunk, conservative: boolean): string {
  const output = verifyProtectedTokens(text, chunk);
  validateMarkdownAstIntegrity(
    restoreChunkProtectedValues(chunk.text, chunk),
    restoreChunkProtectedValues(output, chunk),
    conservative
  );
  if (conservative) verifyConservativeCoverage(chunk.text, output, chunk);
  return output;
}
