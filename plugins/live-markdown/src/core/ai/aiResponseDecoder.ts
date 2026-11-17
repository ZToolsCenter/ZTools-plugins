import { parser as markdownParser } from "@lezer/markdown";
import type { AiOutputFormat } from "./aiOutputContract";

export interface DecodedAiResponse {
  text: string;
  content: string;
  wrapped: boolean;
}

interface FencedCodeBlock {
  marker: string;
  language: string;
  body: string;
  closed: boolean;
}

function readSingleFencedCodeBlock(source: string): FencedCodeBlock | null {
  // Use the Markdown tree to recognize one complete top-level block, not a delimiter substring.
  const cursor = markdownParser.parse(source).cursor();
  if (!cursor.firstChild()) return null;
  if (cursor.name !== "FencedCode" || cursor.from !== 0 || cursor.to !== source.length || cursor.nextSibling()) return null;

  let marker = "";
  let closingMarker = "";
  let info = "";
  let body = "";
  if (!cursor.firstChild()) return null;
  do {
    const childName = cursor.name as string;
    if (childName === "CodeMark") {
      const value = source.slice(cursor.from, cursor.to);
      if (!marker) marker = value;
      else closingMarker = value;
    } else if (childName === "CodeInfo") {
      info = source.slice(cursor.from, cursor.to).trim();
    } else if (childName === "CodeText") {
      body = source.slice(cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());

  const language = info.split(/\s+/u)[0]?.toLowerCase() ?? "";
  const sameFence = marker.length > 0 && marker[0] === closingMarker[0];
  return {
    marker,
    language,
    body,
    closed: sameFence && closingMarker.length >= marker.length
  };
}

function containsFencedCodeBlock(source: string): boolean {
  const cursor = markdownParser.parse(source).cursor();
  let visited = 0;
  do {
    if (++visited > 50000) throw new Error("AI 代码片段结构超过解析上限，结果未写入文档。");
    if (cursor.name === "FencedCode") return true;
  } while (cursor.next());
  return false;
}

function isMarkdownLanguage(language: string): boolean {
  return language === "markdown" || language === "md";
}

function decodeCodeFence(raw: string, source: string, displaySource: boolean): DecodedAiResponse {
  // A Markdown/md fence is itself a code artifact; only a complete shorter fence inside a longer
  // matching fence is an unambiguous transport wrapper.
  const outer = readSingleFencedCodeBlock(source);
  if (!outer || !outer.closed) throw new Error("AI 响应的 Markdown 外包装不完整或存在歧义，结果未写入文档。");

  const innerSource = outer.body.trim();
  const inner = readSingleFencedCodeBlock(innerSource);
  if (!inner) {
    if (containsFencedCodeBlock(innerSource)) {
      throw new Error("AI 响应包含多个或不完整的代码围栏，结果未写入文档。");
    }
    return { text: raw, content: raw, wrapped: false };
  }
  if (!inner.closed || !inner.language || !inner.body.trim()) {
    throw new Error("AI 响应包含不完整的内层代码围栏，结果未写入文档。");
  }

  const sameFence = outer.marker[0] === inner.marker[0];
  if (!sameFence) return { text: raw, content: raw, wrapped: false };
  if (outer.marker.length <= inner.marker.length) {
    throw new Error("AI 响应的内外代码围栏无法明确区分，结果未写入文档。");
  }
  if (isMarkdownLanguage(inner.language) && containsFencedCodeBlock(inner.body)) {
    throw new Error("AI 响应包含多层 Markdown 代码围栏，结果未写入文档。");
  }

  return { text: displaySource ? raw : innerSource, content: innerSource, wrapped: true };
}

/** Decode a single transport envelope, never repair or recursively clean Markdown. */
export function decodeAiResponse(raw: string, format: AiOutputFormat, displaySource = false): DecodedAiResponse {
  const source = raw.trim();
  if (format === "none" || format === "markdown") return { text: raw, content: raw, wrapped: false };
  const start = /^(\x60{3,}|~{3,})(?:markdown|md)[ \t]*\r?\n/iu.exec(source);
  if (!start) return { text: raw, content: raw, wrapped: false };
  if (format === "code") return decodeCodeFence(raw, source, displaySource);

  const end = /\r?\n(\x60{3,}|~{3,})[ \t]*$/u.exec(source);
  if (!end || end.index < start[0].length || end[1][0] !== start[1][0] || end[1].length < start[1].length) {
    throw new Error("AI 响应的 Markdown 外包装不完整，结果未写入文档。");
  }
  const content = source.slice(start[0].length, end.index);
  if (/^(?:\x60{3,}|~{3,})(?:markdown|md)[ \t]*\r?\n/iu.test(content)) {
    throw new Error("AI 响应包含多层 Markdown 外包装，结果未写入文档。");
  }
  return { text: displaySource ? raw : content, content, wrapped: true };
}

