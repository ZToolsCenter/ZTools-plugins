import { AlertKind, InlineFormatAction, MarkdownBlock, MarkdownListItem } from "../types/typora";
import { slugifyHeading } from "./markdownHeadings";
import { serializeBlockToRaw } from "./markdownSerialization";

export function convertBlockType(
  block: MarkdownBlock,
  targetType:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "alert"
    | "ul"
    | "ol"
    | "task"
    | "code"
    | "math",
  options: { headingLevel?: 1 | 2 | 3 | 4 | 5 | 6; alertKind?: AlertKind } = {}
): MarkdownBlock {
  const plainText =
    block.text ??
    block.code ??
    block.mathTex ??
    (block.items ? block.items.map((i) => i.text).join("\n") : "") ??
    block.raw.replace(/^#{1,6}\s+/, "");

  if (targetType === "paragraph") {
    const raw = plainText;
    return {
      ...block,
      type: "paragraph",
      text: raw,
      raw
    };
  }

  if (targetType === "heading") {
    const level = options.headingLevel || 1;
    const singleLine = plainText.split("\n")[0] || "Heading";
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "heading",
      headingLevel: level,
      headingStyle: "atx",
      text: singleLine,
      slug: slugifyHeading(singleLine),
      raw: `${"#".repeat(level)} ${singleLine}`
    };
    return nextBlock;
  }

  if (targetType === "blockquote") {
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "blockquote",
      text: plainText,
      raw: plainText
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")
    };
    return nextBlock;
  }

  if (targetType === "alert") {
    const alertKind = options.alertKind || "NOTE";
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "alert",
      alertKind,
      text: plainText,
      raw: ""
    };
    nextBlock.raw = serializeBlockToRaw(nextBlock);
    return nextBlock;
  }

  if (targetType === "ul" || targetType === "ol" || targetType === "task") {
    const lines = plainText.split("\n").filter(Boolean);
    const items: MarkdownListItem[] = (lines.length ? lines : ["List item"]).map(
      (line, idx) => ({
        id: `${block.id}-item-${idx + 1}`,
        text: line.replace(/^([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/, ""),
        checked: targetType === "task" ? false : undefined,
        indent: 0,
        marker: targetType === "ol" ? `${idx + 1}.` : "-"
      })
    );
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "list",
      listType: targetType,
      listStart: 1,
      items,
      raw: ""
    };
    nextBlock.raw = serializeBlockToRaw(nextBlock);
    return nextBlock;
  }

  if (targetType === "code") {
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "code",
      language: block.language || "typescript",
      code: plainText,
      raw: ""
    };
    nextBlock.raw = serializeBlockToRaw(nextBlock);
    return nextBlock;
  }

  if (targetType === "math") {
    const nextBlock: MarkdownBlock = {
      ...block,
      type: "math",
      mathTex: plainText || "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}",
      raw: ""
    };
    nextBlock.raw = serializeBlockToRaw(nextBlock);
    return nextBlock;
  }

  return block;
}

export function applyInlineFormatToText(
  text: string,
  selStart: number,
  selEnd: number,
  action: InlineFormatAction
): { text: string; nextStart: number; nextEnd: number } {
  const safeStart = Math.max(0, Math.min(selStart, text.length));
  const safeEnd = Math.max(safeStart, Math.min(selEnd, text.length));
  const before = text.slice(0, safeStart);
  const selected = text.slice(safeStart, safeEnd);
  const after = text.slice(safeEnd);

  const wrapWith = (prefix: string, suffix: string, placeholder: string) => {
    if (
      selected.startsWith(prefix) &&
      selected.endsWith(suffix) &&
      selected.length >= prefix.length + suffix.length
    ) {
      const unwrapped = selected.slice(
        prefix.length,
        selected.length - suffix.length
      );
      return {
        text: `${before}${unwrapped}${after}`,
        nextStart: safeStart,
        nextEnd: safeStart + unwrapped.length
      };
    }
    if (
      before.endsWith(prefix) &&
      after.startsWith(suffix)
    ) {
      const trimmedBefore = before.slice(0, before.length - prefix.length);
      const trimmedAfter = after.slice(suffix.length);
      return {
        text: `${trimmedBefore}${selected}${trimmedAfter}`,
        nextStart: trimmedBefore.length,
        nextEnd: trimmedBefore.length + selected.length
      };
    }
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    return {
      text: `${before}${replacement}${after}`,
      nextStart: safeStart + prefix.length,
      nextEnd: safeStart + prefix.length + content.length
    };
  };

  switch (action) {
    case "bold":
      return wrapWith("**", "**", "粗体文本");
    case "italic":
      return wrapWith("*", "*", "斜体文本");
    case "underline":
      return wrapWith("<u>", "</u>", "下划线文本");
    case "strike":
      return wrapWith("~~", "~~", "删除线");
    case "highlight":
      return wrapWith("==", "==", "高亮文本");
    case "code":
      return wrapWith("`", "`", "code");
    case "math":
      return wrapWith("$", "$", "E = mc^2");
    case "sub":
      return wrapWith("~", "~", "2");
    case "sup":
      return wrapWith("^", "^", "2");
    case "link": {
      const label = selected || "链接文字";
      const inserted = `[${label}](https://)`;
      return {
        text: `${before}${inserted}${after}`,
        nextStart: safeStart + label.length + 3,
        nextEnd: safeStart + inserted.length - 1
      };
    }
    case "image": {
      const alt = selected || "图片描述";
      const inserted = `![${alt}](./assets/image.png)`;
      return {
        text: `${before}${inserted}${after}`,
        nextStart: safeStart + alt.length + 4,
        nextEnd: safeStart + inserted.length - 1
      };
    }
    case "clear": {
      const target = selected || text;
      const cleaned = target
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .replace(/==([^=]+)==/g, "$1")
        .replace(/<u>([\s\S]*?)<\/u>/gi, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      if (selected) {
        return {
          text: `${before}${cleaned}${after}`,
          nextStart: safeStart,
          nextEnd: safeStart + cleaned.length
        };
      }
      return {
        text: cleaned,
        nextStart: 0,
        nextEnd: cleaned.length
      };
    }
    default:
      return { text, nextStart: safeStart, nextEnd: safeEnd };
  }
}

export function htmlToMarkdownSmartPaste(
  html: string,
  fallbackPlainText = ""
): string {
  if (!html || !html.trim()) {
    return fallbackPlainText;
  }

  let md = html
    .replace(/\r\n/g, "\n")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<(del|s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, "==$1==")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, "![$2]($1)")
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "![]($1)")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return md || fallbackPlainText;
}
