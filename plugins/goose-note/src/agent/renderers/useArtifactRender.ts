import { useMemo } from "react";

export type Segment =
  | { type: "markdown"; content: string }
  | { type: "echarts"; content: string }
  | { type: "html"; content: string }
  | { type: "json-render"; content: string };

const HTML_FRAGMENT_RE =
  /<(div|section|article|main|aside|header|footer|svg|canvas|table|style|script)\b/i;
const STREAMING_HTML_START_RE =
  /<(?:!DOCTYPE\s+html|html|body|div|section|article|main|aside|header|footer|svg|canvas|table|style)\b/i;
const HTML_CONTROL_ATTR_RE =
  /\b(class|style|onclick|oninput|data-[\w-]+|id)=["'][^"']*["']/i;

export function looksLikeStandaloneHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("```")) return false;
  if (!HTML_FRAGMENT_RE.test(trimmed)) return false;
  return (
    HTML_CONTROL_ATTR_RE.test(trimmed) ||
    /<\/(div|section|article|main|aside|header|footer|svg|canvas|table|style|script)>/i.test(trimmed) ||
    /<(script|style)\b/i.test(trimmed)
  );
}

export function splitStreamingHtmlStart(text: string) {
  const match = text.match(STREAMING_HTML_START_RE);
  if (!match || match.index === undefined) return null;

  const before = text.slice(0, match.index).trim();
  const html = text.slice(match.index).trim();
  if (!html) return null;

  return { before, html };
}

export function parseDatavizSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fenceRe = /```(echarts|html|json-render)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "markdown", content: before });
    }
    const lang = match[1] as "echarts" | "html" | "json-render";
    segments.push({ type: lang, content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim();
    if (tail) segments.push({ type: "markdown", content: tail });
  }

  if (segments.length === 1 && segments[0]?.type === "markdown") {
    const mixedHtml = splitStreamingHtmlStart(segments[0].content);
    if (mixedHtml) {
      return [
        ...(mixedHtml.before ? [{ type: "markdown" as const, content: mixedHtml.before }] : []),
        { type: "html" as const, content: mixedHtml.html },
      ];
    }
  }

  if (segments.length === 0 && looksLikeStandaloneHtml(text)) {
    return [{ type: "html", content: text.trim() }];
  }

  if (
    segments.length === 1 &&
    segments[0]?.type === "markdown" &&
    looksLikeStandaloneHtml(segments[0].content)
  ) {
    return [{ type: "html", content: segments[0].content.trim() }];
  }

  return segments;
}

/** 流式场景：额外检测尾部未闭合的 dataviz 围栏 */
export function parseStreamingSegments(text: string, streaming: boolean) {
  const segments: Segment[] = [];
  const fenceRe = /```(echarts|html|json-render)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "markdown", content: before });
    }
    segments.push({
      type: match[1] as "echarts" | "html" | "json-render",
      content: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  const incompleteRe = /```(echarts|html|json-render)\s*\n([\s\S]*)$/;
  const incompleteMatch = remaining.match(incompleteRe);

  if (incompleteMatch) {
    const before = remaining.slice(0, incompleteMatch.index!).trim();
    if (before) segments.push({ type: "markdown", content: before });
    return {
      segments,
      hasIncompleteBlock: true,
      incompleteBlockType: incompleteMatch[1] as "echarts" | "html" | "json-render",
      incompleteContent: incompleteMatch[2],
    };
  }

  const trimmedRemaining = remaining.trim();
  const streamingHtml = streaming ? splitStreamingHtmlStart(trimmedRemaining) : null;
  if (streamingHtml) {
    if (streamingHtml.before) {
      segments.push({ type: "markdown", content: streamingHtml.before });
    }
    return {
      segments,
      hasIncompleteBlock: true,
      incompleteBlockType: "html" as const,
      incompleteContent: streamingHtml.html,
    };
  }

  if (trimmedRemaining) {
    segments.push({ type: "markdown", content: trimmedRemaining });
  }

  if (!streaming && segments.length === 0 && looksLikeStandaloneHtml(text)) {
    return {
      segments: [{ type: "html", content: text.trim() } satisfies Segment],
      hasIncompleteBlock: false,
      incompleteBlockType: undefined,
      incompleteContent: undefined,
    };
  }

  if (
    !streaming &&
    segments.length === 1 &&
    segments[0]?.type === "markdown" &&
    looksLikeStandaloneHtml(segments[0].content)
  ) {
    return {
      segments: [{ type: "html", content: segments[0].content.trim() } satisfies Segment],
      hasIncompleteBlock: false,
      incompleteBlockType: undefined,
      incompleteContent: undefined,
    };
  }

  return { segments, hasIncompleteBlock: false, incompleteBlockType: undefined, incompleteContent: undefined };
}

/**
 * Returns true when the text contains dataviz fenced blocks (```echarts / ```html)
 * or looks like standalone HTML.
 */
export function textHasDataviz(text: string | undefined | null): boolean {
  if (!text) return false;
  if (/```(?:echarts|html|json-render)\s*\n/.test(text)) return true;
  return looksLikeStandaloneHtml(text);
}

export function useDatavizSegments(text: string) {
  return useMemo(() => parseDatavizSegments(text), [text]);
}

export function useStreamingSegments(text: string, streaming: boolean) {
  return useMemo(() => parseStreamingSegments(text, streaming), [streaming, text]);
}
