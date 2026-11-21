import { AlertKind, MarkdownBlock, MarkdownListItem } from "../types/typora";
import { slugifyHeading } from "./markdownHeadings";
import {
  isMarkdownTableDelimiterRow,
  parseMarkdownTableAlignments,
  splitMarkdownTableRow
} from "./markdownTable";

export interface ParsedMarkdownDocument {
  blocks: MarkdownBlock[];
  yamlMeta: Record<string, string>;
  refLinks: Record<string, { url: string; title?: string }>;
  footnotes: Record<string, string>;
}

export function parseMarkdownToBlocks(markdown: string): ParsedMarkdownDocument {
  const normalized = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  const yamlMeta: Record<string, string> = {};
  const refLinks: Record<string, { url: string; title?: string }> = {};
  const footnotes: Record<string, string> = {};

  let i = 0;
  let blockSeq = 0;
  const nextId = (_prefix: string, _startLine: number) =>
    `block-${(blockSeq += 1)}`;

  // 1. YAML Front Matter at top of file
  if (lines.length > 0 && lines[0].trim() === "---") {
    let endIdx = -1;
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j].trim() === "---" || lines[j].trim() === "...") {
        endIdx = j;
        break;
      }
    }
    if (endIdx > 0) {
      const yamlLines = lines.slice(1, endIdx);
      for (const yLine of yamlLines) {
        const kv = yLine.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (kv) {
          yamlMeta[kv[1].trim()] = kv[2].trim().replace(/^['"]|['"]$/g, "");
        }
      }
      const raw = lines.slice(0, endIdx + 1).join("\n");
      blocks.push({
        id: nextId("frontmatter", 1),
        type: "frontmatter",
        raw,
        startLine: 1,
        endLine: endIdx + 1,
        text: yamlLines.join("\n"),
        yamlMeta: { ...yamlMeta }
      });
      i = endIdx + 1;
    }
  }

  // First pass to collect reference links and footnote definitions
  for (let lineIdx = i; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    const refMatch = line.match(
      /^\[([^\]^]+)\]:\s*(\S+)(?:\s+["'(]([^"')]+)["')])?\s*$/
    );
    if (refMatch) {
      refLinks[refMatch[1].toLowerCase()] = {
        url: refMatch[2],
        title: refMatch[3]
      };
    }
    const fnMatch = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
    if (fnMatch) {
      footnotes[fnMatch[1]] = fnMatch[2].trim();
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 2. TOC Block: [TOC] or [toc]
    if (/^\[toc\]$/i.test(trimmed)) {
      blocks.push({
        id: nextId("toc", i + 1),
        type: "toc",
        raw: line,
        startLine: i + 1,
        endLine: i + 1,
        text: "[TOC]"
      });
      i += 1;
      continue;
    }

    // 3. Fenced Code Block or Diagram Block (``` or ~~~)
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`~]*).*$/);
    if (fenceMatch) {
      const fenceChars = fenceMatch[2];
      const fenceChar = fenceChars[0];
      const closingFenceRegex = new RegExp(
        `^\\s*${fenceChar}{${fenceChars.length},}\\s*$`
      );
      const lang = (fenceMatch[3] || "").trim();
      const startIdx = i;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length) {
        const candidate = lines[i];
        if (closingFenceRegex.test(candidate)) {
          i += 1;
          break;
        }
        // Prevent an unclosed fence from swallowing a subsequent fenced block with a language tag
        if (
          codeLines.length > 0 &&
          /^\s*(`{3,}|~{3,})\s*[A-Za-z0-9_-]+\s*$/.test(candidate)
        ) {
          break;
        }
        codeLines.push(candidate);
        i += 1;
      }
      const raw = lines.slice(startIdx, i).join("\n");
      const code = codeLines.join("\n");
      const lowerLang = lang.toLowerCase();

      if (
        lowerLang === "mermaid" ||
        lowerLang === "flow" ||
        lowerLang === "flowchart" ||
        lowerLang === "sequence" ||
        lowerLang === "gantt" ||
        lowerLang === "pie"
      ) {
        const diagramKind: "mermaid" | "flow" | "sequence" =
          lowerLang === "flow" || lowerLang === "flowchart"
            ? "flow"
            : lowerLang === "sequence"
            ? "sequence"
            : "mermaid";
        blocks.push({
          id: nextId("diagram", startIdx + 1),
          type: "diagram",
          raw,
          startLine: startIdx + 1,
          endLine: i,
          language: lowerLang,
          diagramType: diagramKind,
          code
        });
      } else {
        blocks.push({
          id: nextId("code", startIdx + 1),
          type: "code",
          raw,
          startLine: startIdx + 1,
          endLine: i,
          language: lang,
          code
        });
      }
      continue;
    }

    // 4. Math Block ($$ ... $$)
    if (trimmed.startsWith("$$")) {
      const startIdx = i;
      if (trimmed.length > 2 && trimmed.endsWith("$$") && trimmed !== "$$") {
        const mathTex = trimmed.slice(2, -2).trim();
        blocks.push({
          id: nextId("math", startIdx + 1),
          type: "math",
          raw: line,
          startLine: startIdx + 1,
          endLine: startIdx + 1,
          mathTex
        });
        i += 1;
        continue;
      }
      i += 1;
      const mathLines: string[] = [];
      if (trimmed.length > 2) {
        mathLines.push(trimmed.slice(2));
      }
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        if (curTrim === "$$" || curTrim.endsWith("$$")) {
          if (curTrim !== "$$" && curTrim.endsWith("$$")) {
            mathLines.push(curTrim.slice(0, -2));
          }
          i += 1;
          break;
        }
        mathLines.push(lines[i]);
        i += 1;
      }
      const raw = lines.slice(startIdx, i).join("\n");
      blocks.push({
        id: nextId("math", startIdx + 1),
        type: "math",
        raw,
        startLine: startIdx + 1,
        endLine: i,
        mathTex: mathLines.join("\n").trim()
      });
      continue;
    }

    // 5. ATX Heading (# .. ######)
    const atxMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
    if (atxMatch) {
      const level = atxMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = atxMatch[2].trim();
      blocks.push({
        id: nextId("heading", i + 1),
        type: "heading",
        raw: line,
        startLine: i + 1,
        endLine: i + 1,
        headingLevel: level,
        headingStyle: "atx",
        text,
        slug: slugifyHeading(text)
      });
      i += 1;
      continue;
    }

    // 6. Horizontal Rule (---, ***, ___)
    if (/^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/.test(trimmed)) {
      blocks.push({
        id: nextId("hr", i + 1),
        type: "hr",
        raw: line,
        startLine: i + 1,
        endLine: i + 1
      });
      i += 1;
      continue;
    }

    // 7. GFM Table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isMarkdownTableDelimiterRow(lines[i + 1])
    ) {
      const startIdx = i;
      const headers = splitMarkdownTableRow(lines[i]);
      const alignments = parseMarkdownTableAlignments(lines[i + 1], headers.length);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const rowCells = splitMarkdownTableRow(lines[i]);
        while (rowCells.length < headers.length) {
          rowCells.push("");
        }
        rows.push(rowCells.slice(0, headers.length));
        i += 1;
      }
      const raw = lines.slice(startIdx, i).join("\n");
      blocks.push({
        id: nextId("table", startIdx + 1),
        type: "table",
        raw,
        startLine: startIdx + 1,
        endLine: i,
        headers,
        alignments,
        rows
      });
      continue;
    }

    // 8. Blockquote or GitHub Alert (> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION])
    if (trimmed.startsWith(">")) {
      const startIdx = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const raw = lines.slice(startIdx, i).join("\n");
      const firstLine = (quoteLines[0] || "").trim();
      const alertMatch = firstLine.match(
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i
      );
      if (alertMatch) {
        const alertKind = alertMatch[1].toUpperCase() as AlertKind;
        const bodyLines = [
          alertMatch[2] ? alertMatch[2] : "",
          ...quoteLines.slice(1)
        ].filter((l, idx) => !(idx === 0 && !l));
        blocks.push({
          id: nextId("alert", startIdx + 1),
          type: "alert",
          raw,
          startLine: startIdx + 1,
          endLine: i,
          alertKind,
          text: bodyLines.join("\n")
        });
      } else {
        blocks.push({
          id: nextId("blockquote", startIdx + 1),
          type: "blockquote",
          raw,
          startLine: startIdx + 1,
          endLine: i,
          text: quoteLines.join("\n")
        });
      }
      continue;
    }

    // 9. Lists (Unordered, Ordered, Task List)
    const listMatch = line.match(
      /^(\s*)([-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.*)$/
    );
    if (listMatch) {
      const startIdx = i;
      const items: MarkdownListItem[] = [];
      let hasTask = false;
      let isOrdered = /^\d+\.$/.test(listMatch[2]);
      const listStart = isOrdered ? parseInt(listMatch[2], 10) || 1 : 1;

      while (i < lines.length) {
        const curLine = lines[i];
        const itemMatch = curLine.match(
          /^(\s*)([-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.*)$/
        );
        if (!itemMatch) break;
        const indent = itemMatch[1].length;
        const marker = itemMatch[2];
        const taskCheck = itemMatch[3];
        const itemText = itemMatch[4];
        if (taskCheck !== undefined) {
          hasTask = true;
        }
        items.push({
          id: `item-${startIdx + 1}-${items.length + 1}`,
          text: itemText,
          checked:
            taskCheck !== undefined ? taskCheck.toLowerCase() === "x" : undefined,
          indent,
          marker
        });
        i += 1;
      }

      const raw = lines.slice(startIdx, i).join("\n");
      blocks.push({
        id: nextId("list", startIdx + 1),
        type: "list",
        raw,
        startLine: startIdx + 1,
        endLine: i,
        listType: hasTask ? "task" : isOrdered ? "ol" : "ul",
        listStart,
        items
      });
      continue;
    }

    // 10. Footnote Definition ([^id]: content)
    const fnDefMatch = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/);
    if (fnDefMatch) {
      blocks.push({
        id: nextId("footnote", i + 1),
        type: "footnote_def",
        raw: line,
        startLine: i + 1,
        endLine: i + 1,
        footnoteId: fnDefMatch[1],
        footnoteContent: fnDefMatch[2].trim(),
        text: fnDefMatch[2].trim()
      });
      i += 1;
      continue;
    }

    // 11. Setext Heading (Paragraph followed by === or ---)
    if (
      i + 1 < lines.length &&
      /^(?:=+|-+)\s*$/.test(lines[i + 1].trim()) &&
      lines[i + 1].trim().length >= 2
    ) {
      const level = lines[i + 1].trim().startsWith("=") ? 1 : 2;
      const text = trimmed;
      const raw = `${lines[i]}\n${lines[i + 1]}`;
      blocks.push({
        id: nextId("heading", i + 1),
        type: "heading",
        raw,
        startLine: i + 1,
        endLine: i + 2,
        headingLevel: level,
        headingStyle: "setext",
        text,
        slug: slugifyHeading(text)
      });
      i += 2;
      continue;
    }

    // 12. Standard Paragraph (collect consecutive non-special lines)
    const startIdx = i;
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrim = nextLine.trim();
      if (
        !nextTrim ||
        /^\[toc\]$/i.test(nextTrim) ||
        /^(\s*)(`{3,}|~{3,})/.test(nextLine) ||
        nextTrim.startsWith("$$") ||
        /^(#{1,6})\s+/.test(nextLine) ||
        /^(?:-\s*){3,}$|^(?:\*\s*){3,}$|^(?:_\s*){3,}$/.test(nextTrim) ||
        nextTrim.startsWith(">") ||
        /^(\s*)([-*+]|\d+\.)\s+/.test(nextLine) ||
        /^\[\^([^\]]+)\]:\s*/.test(nextLine) ||
        (nextTrim.includes("|") &&
          i + 1 < lines.length &&
          isMarkdownTableDelimiterRow(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(nextLine);
      i += 1;
    }

    const raw = paraLines.join("\n");
    blocks.push({
      id: nextId("paragraph", startIdx + 1),
      type: "paragraph",
      raw,
      startLine: startIdx + 1,
      endLine: i,
      text: raw
    });
  }

  return {
    blocks,
    yamlMeta,
    refLinks,
    footnotes
  };
}
