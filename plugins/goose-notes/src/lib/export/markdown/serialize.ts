import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { isBlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { resolveCalloutIcon } from "@/components/editor/blocks/callout/calloutIcons";
import { sanitizeCssColor, wrapLocalBlockPropsMarkdown } from "./blockPropsMarker";

const CODE_BLOCK_META_PREFIX = "goose-note=";

function normalizeCodeBlockSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]+/g, " ").trim();
}

function serializeCodeFenceInfo(
  language: string,
  attrs?: Record<string, unknown>,
): string {
  const tokens: string[] = [];
  const normalizedLanguage =
    typeof language === "string" ? language.trim() : "";
  if (normalizedLanguage) {
    tokens.push(normalizedLanguage);
  }

  const summary = normalizeCodeBlockSummary(attrs?.summary);
  const collapsed = attrs?.collapsed === true;
  const metadata: Record<string, unknown> = {};

  if (summary) {
    metadata.summary = summary;
  }
  if (collapsed) {
    metadata.collapsed = true;
  }

  if (Object.keys(metadata).length > 0) {
    tokens.push(
      `${CODE_BLOCK_META_PREFIX}${encodeURIComponent(JSON.stringify(metadata))}`,
    );
  }

  return tokens.join(" ");
}

function serializeInlineText(
  text: string,
  styles: Record<string, any>,
): string {
  const hasUnderline = styles.underline === true;
  const textColor = sanitizeCssColor(styles.textColor);
  const backgroundColor = sanitizeCssColor(styles.backgroundColor);
  const hasColor = textColor && textColor !== "default";
  const hasBg = backgroundColor && backgroundColor !== "default";
  const isYellowHighlight = hasBg && backgroundColor === "yellow" && !hasColor;

  if (styles.bold) text = `**${text}**`;
  if (styles.italic) text = `*${text}*`;
  if (styles.strike) text = `~~${text}~~`;
  if (styles.code) text = `\`${text}\``;
  if (isYellowHighlight) {
    text = `==${text}==`;
  } else if (hasColor || hasBg) {
    const parts: string[] = [];
    if (hasColor) parts.push(`color:${textColor}`);
    if (hasBg) parts.push(`background-color:${backgroundColor}`);
    text = `<span style="${escapeHtmlAttribute(parts.join("; "))}">${text}</span>`;
  }
  return hasUnderline ? `<u>${text}</u>` : text;
}

function extractLinkText(linkContent: any): string {
  if (typeof linkContent === "string") return linkContent;
  if (!Array.isArray(linkContent)) return "";
  return linkContent
    .map((child: any) => {
      if (typeof child === "string") return child;
      return serializeInlineText(child?.text || "", child?.styles || {});
    })
    .join("");
}

function blockNoteInlineToText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  // BlockNote 0.50 TableCell 对象形态: { type: "tableCell", content: InlineContent[] | [Paragraph] }
  if (
    typeof content === "object" &&
    !Array.isArray(content) &&
    Array.isArray(content.content)
  ) {
    return blockNoteInlineToText(content.content);
  }
  if (!Array.isArray(content)) return "";
  return content
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (item == null) return "";
      // 嵌套 paragraph（markdown 导入时表格 cell 会包一层 paragraph）
      if (item.type === "paragraph" && Array.isArray(item.content)) {
        return blockNoteInlineToText(item.content);
      }
      if (item.type === "link") {
        const linkText = extractLinkText(item.content);
        return `[${linkText}](${item.href || ""})`;
      }
      return serializeInlineText(item.text || "", item.styles || {});
    })
    .join("");
}

function escapePipeInCell(value: string): string {
  // GFM 表格 cell 里的 | 必须转义，否则会被解析成列分隔符
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── 列表序列化（BlockNote 块格式：连续 *ListItem 顶层块组成一个列表）────────────

const LIST_ITEM_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

/** 这些类型在自身 case 内消化 children，不走通用 children 追加 */
const CHILDREN_CONSUMED_TYPES = new Set([
  "toggleListItem",
  "details",
  "bulletList",
  "orderedList",
  "taskList",
]);

/**
 * 序列化单个 BlockNote 列表项（含 children 子列表缩进递归）。
 * num: numberedListItem 的实际编号（由 serializeBlocks 的 run 计数器推得）。
 *
 * 子缩进按 CommonMark 标记宽度对齐：`- ` → 2 空格，`1. ` → 3，`10. ` → 4。
 * checkbox 的 `[x]` 属于内容而非标记，继续行对齐 `- ` 之后（2 空格）。
 */
function serializeListItemBlock(
  item: any,
  indent: string,
  num: number | null,
): string {
  const text = blockNoteInlineToText(item.content);
  let marker: string;
  let childIndentWidth: number;
  if (item.type === "checkListItem") {
    marker = `- [${item.props?.checked ? "x" : " "}] `;
    childIndentWidth = 2;
  } else if (item.type === "numberedListItem") {
    marker = `${num ?? 1}. `;
    childIndentWidth = marker.length;
  } else {
    marker = "- ";
    childIndentWidth = 2;
  }
  let line = wrapLocalBlockPropsMarkdown(item, `${indent}${marker}${text}`);
  if (Array.isArray(item.children) && item.children.length > 0) {
    const childMd = serializeBlocks(
      item.children,
      indent + " ".repeat(childIndentWidth),
    );
    if (childMd) line += "\n" + childMd;
  }
  return line;
}

/**
 * 序列化块数组（顶层或任意嵌套层）。
 * - 连续的列表项块合并为一个列表（"\n" 相接）；有序编号从 props.start（或 1）递增。
 * - 其余块之间以空行（"\n\n"）分隔。
 * - 空段落（spacer）会自然断开两段列表，对应 md 里的 loose list 空行。
 */
function serializeBlocks(blocks: any[], indent: string): string {
  const segments: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    if (!block || typeof block !== "object") {
      i++;
      continue;
    }

    if (LIST_ITEM_TYPES.has(block.type)) {
      const lines: string[] = [];
      let counter: number | null = null;
      while (i < blocks.length && LIST_ITEM_TYPES.has(blocks[i]?.type)) {
        const item = blocks[i];
        if (item.type === "numberedListItem") {
          const explicitStart = item.props?.start;
          counter =
            typeof explicitStart === "number"
              ? explicitStart
              : counter == null
                ? 1
                : counter + 1;
        } else {
          counter = null;
        }
        lines.push(serializeListItemBlock(item, indent, counter));
        i++;
      }
      segments.push(lines.join("\n"));
      continue;
    }

    const md = blockNoteBlockToMarkdown(block, indent);
    if (md !== "") segments.push(md);
    i++;
  }

  return segments.join("\n\n");
}

// ── legacy jsonContent 格式兼容（极旧存量数据：TipTap 容器节点）────────────────

function legacyItemInline(item: any): string {
  return blockNoteInlineToText(
    Array.isArray(item?.content) && item.content[0]?.type === "paragraph"
      ? item.content[0].content
      : item?.content,
  );
}

function serializeLegacyListItem(item: any, indent: string): string {
  if (!item || typeof item !== "object") return "";
  const childIndent = indent + "  ";
  const children: string[] = Array.isArray(item.children)
    ? item.children
        .map((c: any) => serializeLegacyListItem(c, childIndent))
        .filter(Boolean)
    : [];

  let line: string;
  if (item.type === "taskItem") {
    const checked =
      item?.attrs?.checked === true || item?.props?.checked === true;
    line = `${indent}- [${checked ? "x" : " "}] ${legacyItemInline(item)}`;
  } else if (item.type === "listItem") {
    if (item.attrs?.start != null) {
      line = `${indent}${item.attrs.start}. ${legacyItemInline(item)}`;
    } else {
      line = `${indent}- ${legacyItemInline(item)}`;
    }
  } else {
    line = `${indent}${blockNoteInlineToText(item.content)}`;
  }

  return children.length ? line + "\n" + children.join("\n") : line;
}

// ── 单块序列化（非列表项）──────────────────────────────────────────────────────

function blockNoteBlockToMarkdown(block: any, indent = ""): string {
  const text = blockNoteInlineToText(block.content);
  let result: string;

  switch (block.type) {
    case "heading":
      result = `${"#".repeat(block.props?.level || block.attrs?.level || 1)} ${text}`;
      break;

    case "quote": {
      // 多行引用：文本内 \n（hardBreak）逐行加 > 前缀
      result = text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      break;
    }

    case "codeBlock": {
      // 编辑器/新 parse 用 props，极旧存量数据用 attrs
      const codeProps = block.props ?? block.attrs ?? {};
      const lang = (codeProps.language || "").trim();
      if (lang === "math" || lang === "latex") {
        result = `$$\n${text}\n$$`;
      } else {
        result = `\`\`\`${serializeCodeFenceInfo(lang, codeProps)}\n${text}\n\`\`\``;
      }
      break;
    }

    case "image": {
      // BlockNote image：props { url, caption, previewWidth, textAlignment }
      // previewWidth → {width=N}，textAlignment(≠left) → {align=X}
      const p = block.props ?? block.attrs ?? {};
      const url = p.url || p.src || "";
      const caption = p.caption || p.alt || "";
      const meta: string[] = [];
      const width = p.previewWidth ?? p.width;
      if (width != null && Number.isFinite(Number(width))) {
        meta.push(`width=${width}`);
      }
      const align = p.textAlignment;
      if (typeof align === "string" && align && align !== "left") {
        meta.push(`align=${align}`);
      }
      result = `![${caption}](${url})${meta.length ? `{${meta.join(" ")}}` : ""}`;
      break;
    }

    case "imageResize": {
      // 极旧存量格式：attrs { src, alt, width, height, containerStyle }
      const attrs = block.attrs ?? block.props ?? {};
      const src = attrs.src || attrs.url || "";
      const alt = attrs.alt || attrs.caption || "";
      const meta: string[] = [];
      if (attrs.width != null && Number.isFinite(Number(attrs.width))) {
        meta.push(`width=${attrs.width}`);
      }
      if (attrs.height != null && Number.isFinite(Number(attrs.height))) {
        meta.push(`height=${attrs.height}`);
      }
      const containerStyle: string = attrs.containerStyle ?? "";
      let align: string | undefined;
      if (containerStyle.includes("margin: 0 auto 0 0")) align = "left";
      else if (containerStyle.includes("margin: 0 auto;")) align = "center";
      else if (containerStyle.includes("margin: 0 0 0 auto")) align = "right";
      if (align) meta.push(`align=${align}`);
      result = `![${alt}](${src})${meta.length ? `{${meta.join(" ")}}` : ""}`;
      break;
    }

    case "table": {
      // BlockNote 格式：content = { type:"tableContent", rows:[{cells:[…]}] }
      // 极旧 parse 格式：content = [tableRow, …]
      let tableRows: any[][];
      const rawContent = block.content;
      if (
        rawContent &&
        typeof rawContent === "object" &&
        !Array.isArray(rawContent) &&
        Array.isArray(rawContent.rows)
      ) {
        tableRows = rawContent.rows.map((row: any) =>
          Array.isArray(row?.cells) ? row.cells : [],
        );
      } else if (Array.isArray(rawContent)) {
        tableRows = rawContent.map((row: any) =>
          Array.isArray(row?.content) ? row.content : [],
        );
      } else {
        return "";
      }
      if (!tableRows.length) return "";
      const colCount = Math.max(...tableRows.map((r) => r.length), 1);
      const padRow = (cells: any[]) => {
        const out = cells.map((cell) =>
          escapePipeInCell(blockNoteInlineToText(cell)),
        );
        while (out.length < colCount) out.push("");
        return out;
      };
      const header = padRow(tableRows[0]);
      const separator = new Array(colCount).fill("---");
      const body = tableRows.slice(1).map(padRow);
      result = [
        `| ${header.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...body.map((row: string[]) => `| ${row.join(" | ")} |`),
      ].join("\n");
      break;
    }

    case "callout": {
      const icon = block.props?.icon ?? block.attrs?.emoji;
      result = text
        .split("\n")
        .map((line, index) => (
          index === 0
            ? `> [!INFO] ${resolveCalloutIcon(icon)} ${line}`
            : `> ${line}`
        ))
        .join("\n");
      break;
    }

    case "divider":
    case "horizontalRule":
      result = "---";
      break;

    case "file": {
      const p = block.props ?? block.attrs ?? {};
      result = `[📎 ${p.name || "文件"}](${p.url || ""})`;
      break;
    }

    case "video": {
      const p = block.props ?? block.attrs ?? {};
      const src = p.url || p.src || "";
      result = `<video src="${escapeHtmlAttribute(src)}" controls preload="metadata"></video>`;
      break;
    }

    case "audio": {
      const p = block.props ?? block.attrs ?? {};
      result = `[📎 ${p.name || "音频"}](${p.url || ""})`;
      break;
    }

    case "toggleListItem": {
      // BlockNote 折叠块 ↔ <details><summary>…</summary>…</details>
      const children: any[] = Array.isArray(block.children)
        ? block.children
        : [];
      const innerMd = children.length ? serializeBlocks(children, "") : "";
      result = innerMd
        ? `<details>\n<summary>${text}</summary>\n\n${innerMd}\n\n</details>`
        : `<details>\n<summary>${text}</summary>\n\n</details>`;
      break;
    }

    case "details": {
      // 极旧 parse 三件套格式：content = [detailsSummary, detailsContent]
      const contentArr: any[] = Array.isArray(block.content)
        ? block.content
        : [];
      const summaryBlock = contentArr.find(
        (c: any) => c?.type === "detailsSummary",
      );
      const contentBlock = contentArr.find(
        (c: any) => c?.type === "detailsContent",
      );
      const summaryText = summaryBlock
        ? blockNoteInlineToText(summaryBlock.content)
        : "详情";
      const innerBlocks: any[] = Array.isArray(contentBlock?.content)
        ? contentBlock.content
        : [];
      const innerMd = serializeBlocks(innerBlocks, "");
      result = `<details>\n<summary>${summaryText}</summary>\n\n${innerMd}\n\n</details>`;
      break;
    }

    case "detailsSummary":
    case "detailsContent":
      result = text;
      break;

    // ── 极旧 jsonContent 容器格式（TipTap 风格存量数据）────────────────────────
    case "bulletList":
    case "taskList": {
      const items: any[] = Array.isArray(block.content) ? block.content : [];
      result = items
        .map((item: any) => serializeLegacyListItem(item, indent))
        .filter(Boolean)
        .join("\n");
      break;
    }

    case "orderedList": {
      const items: any[] = Array.isArray(block.content) ? block.content : [];
      const startNum = block.attrs?.start ?? block.props?.start ?? 1;
      result = items
        .map((item: any, idx: number) => {
          const explicit = item?.attrs?.start;
          const num = explicit != null ? explicit : startNum + idx;
          const line = `${indent}${num}. ${legacyItemInline(item)}`;
          if (Array.isArray(item?.children) && item.children.length > 0) {
            const childMd = item.children
              .map((c: any) => serializeLegacyListItem(c, indent + "  "))
              .filter(Boolean)
              .join("\n");
            return childMd ? `${line}\n${childMd}` : line;
          }
          return line;
        })
        .join("\n");
      break;
    }

    case "blockquote": {
      const innerContent: any[] = Array.isArray(block.content)
        ? block.content
        : [];
      const quoteText = innerContent
        .map((b: any) => blockNoteInlineToText(b?.content ?? b))
        .join("\n");
      result = quoteText
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      break;
    }

    default:
      result = text;
  }

  result = wrapLocalBlockPropsMarkdown(block, result);

  // 通用 children 追加（如 isToggleable 折叠标题的子块）：
  // 用空行分隔保证 md → blocks → md 二轮收敛（子块重读后成为兄弟块，输出不再变化）
  if (
    !CHILDREN_CONSUMED_TYPES.has(block.type) &&
    Array.isArray(block.children) &&
    block.children.length > 0
  ) {
    const childMd = serializeBlocks(block.children, indent);
    if (childMd) {
      result += (result ? "\n\n" : "") + childMd;
    }
  }

  return result;
}

export function jsonContentToMarkdown(
  content: BlockNoteContent,
  skipFirstH1 = false,
): string {
  if (isBlockNoteContent(content)) {
    let blocks = content as any[];
    if (skipFirstH1 && blocks[0]?.type === "heading") {
      blocks = blocks.slice(1);
    }
    return serializeBlocks(blocks, "");
  }

  return "";
}
