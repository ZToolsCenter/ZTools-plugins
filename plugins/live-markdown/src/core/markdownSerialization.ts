import { MarkdownBlock } from "../types/typora";
import { prettifyMarkdownTable } from "./markdownTable";

export function serializeBlockToRaw(block: MarkdownBlock): string {
  switch (block.type) {
    case "frontmatter":
      return `---\n${block.text ?? ""}\n---`;
    case "heading": {
      const level = block.headingLevel || 1;
      const hashes = "#".repeat(level);
      return `${hashes} ${block.text ?? ""}`;
    }
    case "toc":
      return "[TOC]";
    case "hr":
      return "---";
    case "code":
      return `\`\`\`${block.language || ""}\n${block.code ?? ""}\n\`\`\``;
    case "diagram":
      return `\`\`\`${block.diagramType || "mermaid"}\n${block.code ?? ""}\n\`\`\``;
    case "math":
      return `$$\n${block.mathTex ?? ""}\n$$`;
    case "alert": {
      const kind = block.alertKind || "NOTE";
      const bodyLines = String(block.text ?? "")
        .split("\n")
        .map((l) => `> ${l}`);
      return [`> [!${kind}]`, ...bodyLines].join("\n");
    }
    case "blockquote":
      return String(block.text ?? "")
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "list": {
      if (!block.items || block.items.length === 0) {
        return block.raw;
      }
      return block.items
        .map((item, idx) => {
          const pad = " ".repeat(item.indent || 0);
          if (block.listType === "task" || item.checked !== undefined) {
            const box = item.checked ? "[x]" : "[ ]";
            return `${pad}- ${box} ${item.text}`;
          }
          if (block.listType === "ol") {
            const num = (block.listStart || 1) + idx;
            return `${pad}${num}. ${item.text}`;
          }
          return `${pad}${item.marker || "-"} ${item.text}`;
        })
        .join("\n");
    }
    case "table": {
      return prettifyMarkdownTable(
        block.headers || ["Column 1", "Column 2"],
        block.alignments || [null, null],
        block.rows || [["", ""]]
      );
    }
    case "footnote_def":
      return `[^${block.footnoteId || "1"}]: ${block.footnoteContent ?? block.text ?? ""}`;
    case "paragraph":
    default:
      return block.text ?? block.raw;
  }
}

export function serializeBlocksToMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map((b) => serializeBlockToRaw(b)).join("\n\n");
}
