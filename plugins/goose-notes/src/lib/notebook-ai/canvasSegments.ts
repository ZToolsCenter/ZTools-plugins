/**
 * 把 AI 正文里的 SVG / xml 画布从 markdown 里拆出来。
 * 流式未闭合围栏不进入可见文本，避免用户看到源码。
 */

export type CanvasChatSegment =
  | { type: "markdown"; content: string }
  | { type: "svg"; content: string }
  | { type: "pending" };

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;
const INCOMPLETE_FENCE_RE = /```([^\n`]*)\n([\s\S]*)$/;
const SVG_BLOCK_RE = /<svg\b[\s\S]*<\/svg>/i;

export function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

export function extractSvgMarkup(content: string): string | null {
  const match = content.match(SVG_BLOCK_RE);
  return match?.[0] ?? null;
}

export function isCanvasFenceLanguage(lang: string): boolean {
  return lang === "svg" || lang === "xml";
}

export function looksLikeCanvasSource(lang: string | undefined, body: string): boolean {
  const language = (lang ?? "").toLowerCase();
  if (language === "svg") return true;
  if (extractSvgMarkup(body)) return true;
  return language === "xml" && /<svg\b/i.test(body);
}

function pushMarkdown(segments: CanvasChatSegment[], content: string) {
  const trimmed = content.trim();
  if (trimmed) segments.push({ type: "markdown", content: trimmed });
}

function reconstructFence(info: string, body: string) {
  return `\`\`\`${info}\n${body}\`\`\``;
}

export function parseCanvasAwareSegments(
  text: string,
  streaming = false,
): CanvasChatSegment[] {
  const segments: CanvasChatSegment[] = [];
  const source = text ?? "";
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(source)) !== null) {
    pushMarkdown(segments, source.slice(lastIndex, match.index));
    const info = match[1] ?? "";
    const body = match[2] ?? "";
    const lang = fenceLanguage(info);
    const svg = looksLikeCanvasSource(lang, body) ? extractSvgMarkup(body) : null;
    if (svg) {
      segments.push({ type: "svg", content: svg });
    } else if (isCanvasFenceLanguage(lang) && streaming) {
      segments.push({ type: "pending" });
    } else {
      pushMarkdown(segments, reconstructFence(info, body));
    }
    lastIndex = match.index + match[0].length;
  }

  const remaining = source.slice(lastIndex);
  const incomplete = remaining.match(INCOMPLETE_FENCE_RE);
  if (incomplete) {
    pushMarkdown(segments, remaining.slice(0, incomplete.index ?? 0));
    const info = incomplete[1] ?? "";
    const body = incomplete[2] ?? "";
    const lang = fenceLanguage(info);
    if (streaming && looksLikeCanvasSource(lang, body)) {
      segments.push({ type: "pending" });
      return mergePending(segments);
    }
    if (!streaming) {
      const svg = extractSvgMarkup(body);
      if (svg) {
        segments.push({ type: "svg", content: svg });
        return segments;
      }
    }
    if (streaming && isCanvasFenceLanguage(lang)) {
      segments.push({ type: "pending" });
      return mergePending(segments);
    }
    pushMarkdown(segments, remaining);
    return splitBareSvg(segments, streaming);
  }

  pushMarkdown(segments, remaining);
  return splitBareSvg(segments, streaming);
}

function mergePending(segments: CanvasChatSegment[]): CanvasChatSegment[] {
  const hasPending = segments.some((segment) => segment.type === "pending");
  if (!hasPending) return segments;
  return [
    ...segments.filter((segment) => segment.type !== "pending"),
    { type: "pending" },
  ];
}

/** 无围栏的裸 <svg>：完整则渲染，流式未闭合则藏源码。 */
function splitBareSvg(
  segments: CanvasChatSegment[],
  streaming: boolean,
): CanvasChatSegment[] {
  const next: CanvasChatSegment[] = [];
  for (const segment of segments) {
    if (segment.type !== "markdown") {
      next.push(segment);
      continue;
    }
    next.push(...splitMarkdownSvg(segment.content, streaming));
  }
  return mergePending(next);
}

function splitMarkdownSvg(content: string, streaming: boolean): CanvasChatSegment[] {
  const segments: CanvasChatSegment[] = [];
  let cursor = 0;
  const source = content;
  const openRe = /<svg\b/gi;
  let open: RegExpExecArray | null;

  while ((open = openRe.exec(source)) !== null) {
    const start = open.index;
    const close = source.slice(start).search(/<\/svg>/i);
    pushMarkdown(segments, source.slice(cursor, start));
    if (close === -1) {
      if (streaming) segments.push({ type: "pending" });
      return segments;
    }
    const end = start + close + "</svg>".length;
    segments.push({ type: "svg", content: source.slice(start, end) });
    cursor = end;
    openRe.lastIndex = end;
  }

  pushMarkdown(segments, source.slice(cursor));
  return segments;
}

export function textHasPendingCanvas(text: string, streaming: boolean): boolean {
  if (!streaming) return false;
  return parseCanvasAwareSegments(text, true).some(
    (segment) => segment.type === "pending",
  );
}
