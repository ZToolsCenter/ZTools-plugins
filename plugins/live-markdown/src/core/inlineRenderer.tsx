import React from "react";
import { isRawHardBreak, needsWordSpace } from "./softBreakPolicy";
import { resolveEmojiShortcode } from "./emojiDictionary";
import { MathFormulaView } from "./mathAndDiagramRenderer";

export interface InlineRenderContext {
  docPath?: string | null;
  rootUrlFromYaml?: string;
  refLinks?: Record<string, { url: string; title?: string }>;
  footnotes?: Record<string, string>;
  searchHighlight?: string;
  enableInlineMath?: boolean;
  enableHighlight?: boolean;
  enableSubSup?: boolean;
  onOpenLink?: (url: string) => void;
  onZoomImage?: (rawSrc: string, zoomPercent: number) => void;
}

function highlightPlainText(
  text: string,
  searchQuery: string | undefined,
  keyPrefix: string
): React.ReactNode {
  if (!searchQuery || !searchQuery.trim()) {
    return text;
  }
  const q = searchQuery.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark key={`${keyPrefix}-hl-${idx}`} className="md-search-hit">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function sanitizeLinkHref(rawUrl: string): string {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("#")) return trimmed;
  // Block dangerous schemes (javascript:, vbscript:, data:, file:, etc.)
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "http" || scheme === "https" || scheme === "mailto") {
      return trimmed;
    }
    return "#";
  }
  return trimmed;
}

function resolveImgSrc(
  rawSrc: string,
  docPath?: string | null,
  rootUrlFromYaml?: string
): string {
  if (typeof window !== "undefined" && window.typoraBridge?.resolveImageUrl) {
    return window.typoraBridge.resolveImageUrl(
      docPath || null,
      rawSrc,
      rootUrlFromYaml
    );
  }
  return rawSrc;
}

const TOKEN_PATTERN_SOURCE = [
  // LF/CRLF is interpreted only outside complete code, link, math and image tokens.
  String.raw`( {2,}\r?\n|\\\r?\n|\r?\n)`,
  // 0. CommonMark backslash escape of one ASCII punctuation character
  String.raw`(\\[!"#$%&'()*+,\-./:;<=>?@\[\]\\^_\x60{|}~])`,
  // 1. HTML <img ...>
  "(<img\\s+[^>]*?>)",
  // 2. Markdown Image ![alt](src "title")
  "(!\\[[^\\]]*\\]\\([^)]+\\))",
  // 3. Inline code `code`
  "(`[^`]+`)",
  // 4. Inline math $math$
  "(\\$[^$\\n]+?\\$)",
  // 5. Footnote ref [^id]
  "(\\[\\^[^\\]]+\\])",
  // 6. Markdown Link [text](url "title")
  "(\\[[^\\]]+\\]\\([^)]+\\))",
  // 7. Reference Link [text][ref]
  "(\\[[^\\]]+\\]\\[[^\\]]*\\])",
  // 8. HTML <u>...</u>
  "(<u>[\\s\\S]*?<\\/u>)",
  // 9. Bold+Italic ***text***
  "(\\*\\*\\*[^*]+\\*\\*\\*)",
  // 10. Bold **text** or __text__
  "(\\*\\*[^*]+\\*\\*|__[^_]+__)",
  // 11. Italic *text* or _text_
  "(\\*[^*\\n]+\\*|_[^_\\n]+_)",
  // 12. Strikethrough ~~text~~
  "(~~[^~]+~~)",
  // 13. Highlight ==text==
  "(==[^=\\n]+==)",
  // 14. Superscript ^text^
  "(\\^[^^\\s]+\\^)",
  // 15. Subscript ~text~
  "(~[^~\\s]+~)",
  // 16. Emoji :shortcode:
  "(:[a-zA-Z0-9_+\\-]+:)",
  // 17. Autolink <https://...>
  "(<https?:\\/\\/[^>\\s]+>)"
].join("|");

export function renderInlineMarkdown(
  text: string,
  ctx: InlineRenderContext = {},
  keyPrefix = "in"
): React.ReactNode[] {
  const input = String(text ?? "");
  if (!input) return [];

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let seq = 0;
  const nextKey = () => `${keyPrefix}-${(seq += 1)}`;

  const tokenPattern = new RegExp(TOKEN_PATTERN_SOURCE, "g");
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const plain = input.slice(lastIndex, match.index);
      result.push(
        <span key={nextKey()} data-raw-start={lastIndex} data-marker-len={0}>
          {highlightPlainText(plain, ctx.searchHighlight, nextKey())}
        </span>
      );
    }

    const token = match[0];
    const tokenEnd = match.index + token.length;
    lastIndex = tokenEnd;

    if (token.endsWith("\n")) {
      const newline = tokenEnd - 1;
      const lineStart = input.lastIndexOf("\n", match.index - 1) + 1;
      const left = input.slice(lineStart, newline).replace(/\r$/, "");
      const nextBreak = input.indexOf("\n", tokenEnd);
      const right = input.slice(tokenEnd, nextBreak < 0 ? input.length : nextBreak);
      result.push(isRawHardBreak(left)
        ? <br key={nextKey()} />
        : needsWordSpace(left, right) ? " " : "");
      continue;
    }

    // CommonMark escapes remove only the leading slash. Consume the whole
    // token so escaped delimiters cannot activate another inline renderer.
    if (token.length === 2 && token[0] === "\\") {
      result.push(
        <span key={nextKey()} data-raw-start={match.index} data-marker-len={1}>
          {highlightPlainText(token[1]!, ctx.searchHighlight, nextKey())}
        </span>
      );
      continue;
    }

    // 1. HTML <img ...>
    if (token.toLowerCase().startsWith("<img")) {
      const srcMatch = token.match(/src=["']([^"']+)["']/i);
      const altMatch = token.match(/alt=["']([^"']*)["']/i);
      const zoomMatch = token.match(/zoom\s*:\s*(\d+)%/i);
      const rawSrc = srcMatch ? srcMatch[1] : "";
      const alt = altMatch ? altMatch[1] : "";
      const zoom = zoomMatch ? parseInt(zoomMatch[1], 10) : 100;
      const resolvedSrc = resolveImgSrc(rawSrc, ctx.docPath, ctx.rootUrlFromYaml);
      result.push(
        <span key={nextKey()} className="md-image md-img-loaded">
          <img
            src={resolvedSrc}
            alt={alt}
            style={zoom !== 100 ? { zoom: `${zoom}%` } : undefined}
          />
          {alt && <span className="md-image-caption">{alt}</span>}
        </span>
      );
      continue;
    }

    // 2. Markdown Image ![alt](src "title")
    if (token.startsWith("![")) {
      const imgMatch = token.match(
        /^!\[([^\]]*)\]\(\s*([^\s")]+)(?:\s+["']([^"']*)["'])?\s*\)$/
      );
      if (imgMatch) {
        const alt = imgMatch[1];
        const rawSrc = imgMatch[2];
        const title = imgMatch[3] || alt;
        const resolvedSrc = resolveImgSrc(
          rawSrc,
          ctx.docPath,
          ctx.rootUrlFromYaml
        );
        result.push(
          <span key={nextKey()} className="md-image md-img-loaded">
            <img src={resolvedSrc} alt={alt} title={title} />
            {alt && <span className="md-image-caption">{alt}</span>}
          </span>
        );
        continue;
      }
    }

    // 3. Inline code `code`
    if (token.startsWith("`") && token.endsWith("`")) {
      const codeContent = token.slice(1, -1);
      result.push(
        <code key={nextKey()} className="md-codespan" data-raw-start={match.index} data-marker-len={1}>
          {highlightPlainText(codeContent, ctx.searchHighlight, nextKey())}
        </code>
      );
      continue;
    }

    // 4. Inline Math $...$
    if (
      token.startsWith("$") &&
      token.endsWith("$") &&
      ctx.enableInlineMath !== false
    ) {
      const tex = token.slice(1, -1);
      result.push(
        <span key={nextKey()} className="md-inline-math" data-raw-start={match.index} data-marker-len={1}>
          <MathFormulaView tex={tex} displayMode={false} />
        </span>
      );
      continue;
    }

    // 5. Footnote reference [^id]
    if (token.startsWith("[^") && token.endsWith("]")) {
      const fnId = token.slice(2, -1);
      const fnTip = ctx.footnotes?.[fnId] || `Footnote ${fnId}`;
      result.push(
        <sup
          key={nextKey()}
          className="md-footnote"
          title={fnTip}
        >
          [{fnId}]
        </sup>
      );
      continue;
    }

    // 6. Markdown Link [text](url "title")
    if (token.startsWith("[") && token.includes("](")) {
      const linkMatch = token.match(
        /^\[([^\]]+)\]\(\s*([^\s")]+)(?:\s+["']([^"']*)["'])?\s*\)$/
      );
      if (linkMatch) {
        const label = linkMatch[1];
        const rawUrl = linkMatch[2];
        const safeUrl = sanitizeLinkHref(rawUrl);
        const title = linkMatch[3] || `${rawUrl} (Cmd/Ctrl + Click 打开)`;
        result.push(
          <a
            key={nextKey()}
            href={safeUrl}
            title={title}
            className="md-link"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (safeUrl !== "#") {
                ctx.onOpenLink?.(safeUrl);
              }
            }}
          >
            {renderInlineMarkdown(label, ctx, nextKey())}
          </a>
        );
        continue;
      }
    }

    // 7. Reference Link [text][ref]
    if (token.startsWith("[") && token.includes("][")) {
      const refMatch = token.match(/^\[([^\]]+)\]\[([^\]]*)\]$/);
      if (refMatch) {
        const label = refMatch[1];
        const refKey = (refMatch[2] || label).toLowerCase();
        const resolved = ctx.refLinks?.[refKey];
        const rawUrl = resolved?.url || "#";
        const safeUrl = sanitizeLinkHref(rawUrl);
        result.push(
          <a
            key={nextKey()}
            href={safeUrl}
            title={resolved?.title || rawUrl}
            className="md-link md-ref-link"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (safeUrl !== "#") ctx.onOpenLink?.(safeUrl);
            }}
          >
            {renderInlineMarkdown(label, ctx, nextKey())}
          </a>
        );
        continue;
      }
    }

    // 8. HTML <u>...</u>
    if (token.toLowerCase().startsWith("<u>")) {
      const inner = token.slice(3, -4);
      result.push(
        <u key={nextKey()}>{renderInlineMarkdown(inner, ctx, nextKey())}</u>
      );
      continue;
    }

    // 9. Bold + Italic ***...***
    if (token.startsWith("***") && token.endsWith("***")) {
      const inner = token.slice(3, -3);
      result.push(
        <strong key={nextKey()}>
          <em>{renderInlineMarkdown(inner, ctx, nextKey())}</em>
        </strong>
      );
      continue;
    }

    // 10. Bold **...** or __...__
    if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      const inner = token.slice(2, -2);
      result.push(
        <strong key={nextKey()}>
          {renderInlineMarkdown(inner, ctx, nextKey())}
        </strong>
      );
      continue;
    }

    // 11. Italic *...* or _..._
    if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      const inner = token.slice(1, -1);
      result.push(
        <em key={nextKey()}>{renderInlineMarkdown(inner, ctx, nextKey())}</em>
      );
      continue;
    }

    // 12. Strikethrough ~~...~~
    if (token.startsWith("~~") && token.endsWith("~~")) {
      const inner = token.slice(2, -2);
      result.push(
        <del key={nextKey()} data-raw-start={match.index} data-marker-len={2}>{renderInlineMarkdown(inner, ctx, nextKey())}</del>
      );
      continue;
    }

    // 13. Highlight ==...==
    if (
      token.startsWith("==") &&
      token.endsWith("==") &&
      ctx.enableHighlight !== false
    ) {
      const inner = token.slice(2, -2);
      result.push(
        <mark key={nextKey()} className="md-highlight" data-raw-start={match.index} data-marker-len={2}>
          {renderInlineMarkdown(inner, ctx, nextKey())}
        </mark>
      );
      continue;
    }

    // 14. Superscript ^...^
    if (
      token.startsWith("^") &&
      token.endsWith("^") &&
      ctx.enableSubSup !== false
    ) {
      result.push(<sup key={nextKey()}>{token.slice(1, -1)}</sup>);
      continue;
    }

    // 15. Subscript ~...~
    if (
      token.startsWith("~") &&
      token.endsWith("~") &&
      ctx.enableSubSup !== false
    ) {
      result.push(<sub key={nextKey()}>{token.slice(1, -1)}</sub>);
      continue;
    }

    // 16. Emoji :shortcode:
    if (token.startsWith(":") && token.endsWith(":")) {
      const emoji = resolveEmojiShortcode(token);
      if (emoji) {
        result.push(
          <span key={nextKey()} className="md-emoji" title={token}>
            {emoji}
          </span>
        );
        continue;
      }
    }

    // 17. Autolink <https://...>
    if (token.startsWith("<http") && token.endsWith(">")) {
      const url = token.slice(1, -1);
      result.push(
        <a
          key={nextKey()}
          href={url}
          className="md-link"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctx.onOpenLink?.(url);
          }}
        >
          {url}
        </a>
      );
      continue;
    }

    result.push(highlightPlainText(token, ctx.searchHighlight, nextKey()));
  }

  if (lastIndex < input.length) {
    result.push(
      highlightPlainText(input.slice(lastIndex), ctx.searchHighlight, nextKey())
    );
  }

  return result;
}
