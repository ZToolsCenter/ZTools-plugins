import { parseInlineMarkdown } from "./inline";
import {
  isLegacyCodeBlockMetaComment,
  parseCodeFenceInfo,
  parseTableBlock,
} from "./blockHelpers";

/**
 * markdownToJsonContent 输出 **BlockNote PartialBlock[]**（数组，非 {type:"doc"}）。
 *
 * 为什么是 BlockNote 格式而不是 TipTap doc：
 * normalizePageContent 对数组输入走 normalizeBlocks（children 递归、attrs→props、
 * VALID_BLOCK_TYPES 直通），而对 {type:"doc"} 输入走 legacyNodeToBlocks——后者会
 * 丢弃 listItem.children（嵌套拍平）、orderedList start、imageResize 宽高对齐，
 * 并把 details/video/file 压成纯文本或直接丢掉。直接输出 BlockNote 格式可彻底
 * 绕开这条有损路径，保证 scanner 读入的 page.content 与磁盘 md 零损对应。
 */

/** 计算行的缩进空格数（tab 记 2） */
function indentLevel(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count++;
    else if (ch === "\t") count += 2;
    else break;
  }
  return count;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * 解析嵌套列表（bullet / ordered / checkbox 混嵌），输出 BlockNote 块格式：
 * { type: "bulletListItem"|"numberedListItem"|"checkListItem", props?, content, children? }
 *
 * 有序编号约定（与 BlockNote 一致）：仅每段连续 numbered run 的首项在编号 ≠ 1 时
 * 写 props.start；后续项编号由序列化时递增推得。
 *
 * 空行结束当前列表（loose list 的空行由外层主循环补 spacer 段落，
 * 序列化时 spacer 会把两段列表隔开，保住原文的空行）。
 */
function parseNestedList(
  lines: string[],
  startI: number,
  baseIndent: number,
  parseInline: (t: string) => any[],
): { items: any[]; nextIndex: number } {
  const items: any[] = [];
  let i = startI;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break; // 空行结束本层列表
    const lvl = indentLevel(line);
    if (lvl < baseIndent) break;
    if (lvl > baseIndent) {
      // 理论上子层已被 collectChildren 消耗；防御性交还外层处理，不丢行
      break;
    }

    const stripped = line.slice(lvl);

    const taskM = stripped.match(/^-\s+\[([ xX])\](?:\s+(.*))?$/);
    const orderedM = !taskM && stripped.match(/^(\d+)\.\s+(.+)$/);
    const bulletM = !taskM && !orderedM && stripped.match(/^[-*+]\s+(.+)$/);

    if (!taskM && !orderedM && !bulletM) break;

    let item: any;
    if (taskM) {
      item = {
        type: "checkListItem",
        props: { checked: taskM[1].toLowerCase() === "x" },
        content: parseInline(taskM[2] ?? ""),
      };
    } else if (orderedM) {
      const num = parseInt(orderedM[1], 10);
      item = { type: "numberedListItem", content: parseInline(orderedM[2]) };
      const prevType = items[items.length - 1]?.type;
      if (num !== 1 && prevType !== "numberedListItem") {
        item.props = { start: num };
      }
    } else {
      item = {
        type: "bulletListItem",
        content: parseInline((bulletM as RegExpMatchArray)[1]),
      };
    }
    i++;

    const sub = collectChildren(lines, i, lvl + 1, parseInline);
    if (sub.items.length) {
      item.children = sub.items;
      i = sub.nextIndex;
    }

    items.push(item);
  }

  return { items, nextIndex: i };
}

/** 收集缩进比 minIndent 更深的行作为子列表 */
function collectChildren(
  lines: string[],
  startI: number,
  minIndent: number,
  parseInline: (t: string) => any[],
): { items: any[]; nextIndex: number } {
  const i = startI;
  if (i >= lines.length || !lines[i].trim())
    return { items: [], nextIndex: startI };
  const childIndent = indentLevel(lines[i]);
  if (childIndent < minIndent) return { items: [], nextIndex: startI };
  return parseNestedList(lines, i, childIndent, parseInline);
}

// 返回类型标 any（运行时恒为 PartialBlock[] 数组）：调用方 entry.ts 仍有
// `Array.isArray(parsed) ? parsed : parsed?.content` 的双形状兼容分支，
// 标 any[] 会让 else 分支被 narrow 成 never 报 TS2339。
export function markdownToJsonContent(markdown: string): any {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const content: any[] = [];
  let i = 0;

  if (lines.length > 0 && lines[0].trim() === "---") {
    const frontmatterLines: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== "---") {
      frontmatterLines.push(lines[i]);
      i++;
    }
    if (i < lines.length && lines[i].trim() === "---") {
      content.push({
        type: "codeBlock",
        props: { language: "yaml-frontmatter" },
        content: frontmatterLines.join("\n"),
      });
      i++;
    } else {
      i = 0;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (isLegacyCodeBlockMetaComment(trimmedLine)) {
      i++;
      continue;
    }

    // ── video 块（serialize 写出的 <video src="…" controls ...></video> 单行）
    // video 在 raw-guard allowlist 中不会被包成 goose-raw-block，这里映射回 video 块
    const videoLineMatch = trimmedLine.match(
      /^<video\s+src="([^"]*)"[^>]*>\s*<\/video>$/i,
    );
    if (videoLineMatch) {
      content.push({
        type: "video",
        props: { url: decodeHtmlAttribute(videoLineMatch[1]) },
      });
      i++;
      continue;
    }

    // ── details 折叠块 → BlockNote toggleListItem（editor schema 没有 details 块，
    // toggleListItem 是「可折叠 + summary 行 + 子块」的对称表示）
    if (trimmedLine.startsWith("<details>")) {
      const detailsLines: string[] = [];
      let summaryText = "详情";
      i++;
      while (i < lines.length && !lines[i].trim().includes("</details>")) {
        const l = lines[i].trim();
        if (l.startsWith("<summary>") && l.endsWith("</summary>")) {
          summaryText = l.replace("<summary>", "").replace("</summary>", "");
        } else {
          detailsLines.push(lines[i]);
        }
        i++;
      }

      const childBlocks = markdownToJsonContent(detailsLines.join("\n"));
      content.push({
        type: "toggleListItem",
        content: parseInlineMarkdown(summaryText),
        ...(childBlocks.length ? { children: childBlocks } : {}),
      });
      i++;
      continue;
    }

    if (trimmedLine === "$$") {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      content.push({
        type: "codeBlock",
        props: { language: "math" },
        content: mathLines.join("\n"),
      });
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const fenceInfo = parseCodeFenceInfo(line.slice(3).trim());
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeBlockProps: Record<string, unknown> = {
        language: fenceInfo.language,
      };
      if (fenceInfo.summary) {
        codeBlockProps.summary = fenceInfo.summary;
      }
      if (fenceInfo.collapsed) {
        codeBlockProps.collapsed = true;
      }
      content.push({
        type: "codeBlock",
        props: codeBlockProps,
        content: codeLines.join("\n"),
      });
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        props: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2]),
      });
      i++;
      continue;
    }

    // setext 标题：当前行是普通文本，下一行是 ===+（H1）或 ---+（H2）
    if (
      trimmedLine &&
      !trimmedLine.startsWith(">") &&
      !trimmedLine.startsWith("-") &&
      !trimmedLine.startsWith("#") &&
      !trimmedLine.startsWith("<") &&
      !trimmedLine.startsWith("|") &&
      i + 1 < lines.length
    ) {
      const nextTrimmed = lines[i + 1].trim();
      if (/^={2,}$/.test(nextTrimmed)) {
        content.push({
          type: "heading",
          props: { level: 1 },
          content: parseInlineMarkdown(trimmedLine),
        });
        i += 2;
        continue;
      }
      if (/^-{2,}$/.test(nextTrimmed)) {
        content.push({
          type: "heading",
          props: { level: 2 },
          content: parseInlineMarkdown(trimmedLine),
        });
        i += 2;
        continue;
      }
    }

    if (line.match(/^---+$/)) {
      // editor schema 的 divider 不在 VALID_BLOCK_TYPES，会被 normalize 丢弃；
      // 沿用既有行为：水平线落为字面量段落，序列化时原样写回 ---
      content.push({ type: "paragraph", content: "---" });
      i++;
      continue;
    }

    if (trimmedLine.startsWith(">")) {
      const firstLine = trimmedLine.slice(1).trim();

      const calloutMatch = firstLine.match(
        /^\[!INFO\]\s+(?:([\uD800-\uDBFF][\uDC00-\uDFFF]|\S))\s+(.+)$/i,
      );

      if (calloutMatch) {
        const calloutLines: string[] = [calloutMatch[2]];
        i++;
        // 本地文件夹的块级 wrapper 会让多行 callout 的后续行保持 `> ` 前缀；
        // 与普通多行引用一致地合并，避免第二行被拆成独立 quote 块。
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          calloutLines.push(lines[i].trim().slice(1).trim());
          i++;
        }
        content.push({
          type: "callout",
          props: { icon: calloutMatch[1] },
          content: parseInlineMarkdown(calloutLines.join("\n")),
        });
        continue;
      }

      // 多行引用：连续 > 行用 \n 连接（BlockNote 文本内 \n = hardBreak，编辑器可保真）
      const quoteLines: string[] = [firstLine];
      i++;
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().slice(1).trim());
        i++;
      }
      content.push({
        type: "quote",
        content: parseInlineMarkdown(quoteLines.join("\n")),
      });
      continue;
    }

    // Try parsing table
    const tableResult = parseTableBlock(lines, i, parseInlineMarkdown);
    if (tableResult) {
      content.push(tableResult.block);
      i = tableResult.nextIndex;
      continue;
    }

    // 文件附件（旧 serializer 写出的 [📎 name](url) 形式）→ BlockNote file 块
    const fileMatch = trimmedLine.match(/^\[📎\s+([^\]]*)\]\(([^)]*)\)$/);
    if (fileMatch) {
      content.push({
        type: "file",
        props: {
          name: fileMatch[1].trim(),
          url: fileMatch[2],
        },
      });
      i++;
      continue;
    }

    // 嵌套列表（task / bullet / ordered）
    const baseIndent = indentLevel(line);
    const stripped = line.slice(baseIndent);
    if (
      stripped.match(/^-\s+\[[ xX]\](?:\s+.*)?$/) ||
      stripped.match(/^[-*+]\s+\S/) ||
      stripped.match(/^\d+\.\s+\S/)
    ) {
      const { items, nextIndex } = parseNestedList(
        lines,
        i,
        baseIndent,
        parseInlineMarkdown,
      );
      if (items.length) {
        content.push(...items);
        i = nextIndex;
        continue;
      }
    }

    // 图片：![alt](url){width=N align=X}（width → previewWidth，align → textAlignment）
    const imgMatch = trimmedLine.match(
      /^!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]+)\})?$/,
    );
    if (imgMatch) {
      const metaRaw = imgMatch[3] || "";
      const metaMap = new Map<string, string>();
      metaRaw
        .split(/\s+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .forEach((chunk) => {
          const [key, value] = chunk.split("=");
          if (key && value) metaMap.set(key, value);
        });

      const width = metaMap.get("width");
      const widthValue = width ? Number(width) : undefined;
      const align = metaMap.get("align");
      content.push({
        type: "image",
        props: {
          url: imgMatch[2],
          caption: imgMatch[1],
          ...(Number.isFinite(widthValue) ? { previewWidth: widthValue } : {}),
          ...(align && align !== "left" ? { textAlignment: align } : {}),
        },
      });
      i++;
      continue;
    }

    if (line.trim()) {
      const paragraphLines: string[] = [];

      while (i < lines.length) {
        const currentLine = lines[i];
        const trimmed = currentLine.trim();

        if (!trimmed) break;

        if (paragraphLines.length > 0) {
          if (
            currentLine.startsWith("#") ||
            currentLine.startsWith(">") ||
            currentLine.startsWith("```") ||
            currentLine.startsWith("$$") ||
            currentLine.match(/^-\s+\[[ xX]\]/) ||
            currentLine.match(/^[-*+]\s+/) ||
            currentLine.match(/^\d+\.\s+/) ||
            currentLine.match(/^---+$/) ||
            currentLine.match(/^\|/) ||
            currentLine.match(/^\[📎/) ||
            trimmed.match(/^<video\s+src=/) ||
            trimmed.startsWith("<details>")
          ) {
            break;
          }
          // 下一行是 setext 下划线 → 当前行是 setext 标题文本，停止收集
          const nextTrimmed = lines[i + 1]?.trim() ?? "";
          if (/^={2,}$/.test(nextTrimmed) || /^-{2,}$/.test(nextTrimmed)) {
            break;
          }
        }

        paragraphLines.push(currentLine);
        i++;
      }

      if (paragraphLines.length > 0) {
        // 软换行保真：段内换行用 \n 保留（BlockNote 文本内 \n = hardBreak）
        const combinedText = paragraphLines.join("\n");
        const inline = parseInlineMarkdown(combinedText);
        content.push(
          inline.length > 0
            ? { type: "paragraph", content: inline }
            : { type: "paragraph" },
        );
        continue;
      }
    } else if (
      content.length > 0 &&
      ["bulletListItem", "numberedListItem", "checkListItem"].includes(
        content[content.length - 1].type,
      )
    ) {
      content.push({ type: "paragraph" });
    }
    i++;
  }

  return content;
}
