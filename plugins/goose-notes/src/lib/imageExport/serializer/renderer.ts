import type { CardTheme } from "../themes";
import { resolveCalloutIcon } from "@/components/editor/blocks/callout/calloutIcons";
import {
  escapeHtml,
  BLOCKNOTE_TEXT_COLORS,
  BLOCKNOTE_BACKGROUND_COLORS,
  BLOCKNOTE_TEXT_COLORS_DARK,
  BLOCKNOTE_BACKGROUND_COLORS_DARK,
  resolveExportColor,
} from "./utils";

function textPalette(theme?: CardTheme) {
  return theme?.mode === "dark" ? BLOCKNOTE_TEXT_COLORS_DARK : BLOCKNOTE_TEXT_COLORS;
}

function bgPalette(theme?: CardTheme) {
  return theme?.mode === "dark" ? BLOCKNOTE_BACKGROUND_COLORS_DARK : BLOCKNOTE_BACKGROUND_COLORS;
}

/** 块级对齐 + 文字色 + 背景色 → style 属性字符串（含前导空格） */
function buildBlockStyleAttr(block: any, theme: CardTheme): string {
  const styles: string[] = [];
  const align = block.props?.textAlignment;
  if (align === "center" || align === "right" || align === "justify") {
    styles.push(`text-align:${align}`);
  }
  const tc = resolveExportColor(block.props?.textColor, textPalette(theme));
  if (tc) styles.push(`color:${tc}`);
  const bg = resolveExportColor(block.props?.backgroundColor, bgPalette(theme));
  if (bg) styles.push(`background-color:${bg}`);
  if (styles.length === 0) return "";
  return ` style="${styles.join(";")}"`;
}

function looksLikeImageUrl(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  const path = src.split("?")[0].split("#")[0].toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(path);
}

function extractCodeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (item.type === "hardBreak") return "\n";
      return typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

function renderTableCellContent(cell: any, theme: CardTheme): string {
  if (cell == null) return "";
  if (typeof cell === "string") return escapeHtml(cell).replace(/\n/g, "<br>");
  // BlockNote tableCell: { type, content: InlineContent[] | paragraph[] }
  if (typeof cell === "object" && !Array.isArray(cell) && Array.isArray(cell.content)) {
    return renderTableCellContent(cell.content, theme);
  }
  if (Array.isArray(cell)) {
    // 可能是 inline 数组，或内嵌 paragraph 块
    const hasParagraph = cell.some(
      (c: any) => c && typeof c === "object" && c.type === "paragraph",
    );
    if (hasParagraph) {
      return cell
        .map((c: any) => {
          if (c?.type === "paragraph") return renderInline(c.content, theme);
          return renderInline([c], theme);
        })
        .join("<br>");
    }
    return renderInline(cell, theme);
  }
  if (typeof cell === "object" && cell.text) {
    return escapeHtml(String(cell.text)).replace(/\n/g, "<br>");
  }
  return escapeHtml(extractCellTextForHtml(cell)).replace(/\n/g, "<br>");
}

// 渲染块的嵌套子块（block.children）
function renderChildren(block: any, theme: CardTheme, className = "nested-children"): string {
  const children = block?.children;
  if (!Array.isArray(children) || children.length === 0) return "";
  // 子块也可能是连续列表，走 renderBlocks 合并
  const inner = renderBlocks(children, theme);
  if (!inner) return "";
  return `<div class="${className}">${inner}</div>`;
}

/**
 * 将连续顶层 bullet/numbered 列表项合并为 ul/ol，避免裸 li。
 * checkListItem 保持独立 task-item，不并入 ul。
 */
export function renderBlocks(blocks: any[], theme: CardTheme): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block?.type === "bulletListItem") {
      const items: any[] = [];
      while (i < blocks.length && blocks[i]?.type === "bulletListItem") {
        items.push(blocks[i]);
        i += 1;
      }
      parts.push(
        `<ul class="bn-list">${items.map((item) => renderBlock(item, theme)).join("")}</ul>`,
      );
      continue;
    }
    if (block?.type === "numberedListItem") {
      const items: any[] = [];
      while (i < blocks.length && blocks[i]?.type === "numberedListItem") {
        items.push(blocks[i]);
        i += 1;
      }
      const start = Number(items[0]?.props?.start);
      const startAttr =
        Number.isInteger(start) && start > 1 ? ` start="${start}"` : "";
      parts.push(
        `<ol class="bn-list"${startAttr}>${items.map((item) => renderBlock(item, theme)).join("")}</ol>`,
      );
      continue;
    }
    parts.push(renderBlock(block, theme));
    i += 1;
  }
  return parts.join("\n");
}

export function renderBlock(block: any, theme: CardTheme): string {
  if (!block || typeof block !== "object") return "";

  const inlineHtml = renderInline(block.content, theme);
  const styleAttr = buildBlockStyleAttr(block, theme);

  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(block.props?.level) || 1, 1), 3);
      const isToggle = !!block.props?.isToggleable;
      const inner = isToggle
        ? `<span class="toggle-marker">▾</span><span>${inlineHtml}</span>`
        : inlineHtml;
      const heading = isToggle
        ? `<h${level}${styleAttr}><div class="toggle-summary">${inner}</div></h${level}>`
        : `<h${level}${styleAttr}>${inner}</h${level}>`;
      return `${heading}${renderChildren(block, theme)}`;
    }

    case "bulletListItem": {
      // 嵌套子列表：若 children 是列表项，由 renderBlocks 处理
      const children = block.children?.length
        ? renderBlocks(block.children, theme)
        : "";
      // 若 children 已是 ul/ol（renderBlocks 输出），直接挂；否则包一层
      const childHtml = children
        ? children.trimStart().startsWith("<ul") || children.trimStart().startsWith("<ol")
          ? children
          : `<div class="nested-children">${children}</div>`
        : "";
      return `<li${styleAttr}>${inlineHtml || ""}${childHtml}</li>`;
    }

    case "numberedListItem": {
      const children = block.children?.length
        ? renderBlocks(block.children, theme)
        : "";
      const childHtml = children
        ? children.trimStart().startsWith("<ul") || children.trimStart().startsWith("<ol")
          ? children
          : `<div class="nested-children">${children}</div>`
        : "";
      const value = Number(block.props?.start);
      const valueAttr =
        Number.isInteger(value) && value > 0 ? ` value="${value}"` : "";
      return `<li${valueAttr}${styleAttr}>${inlineHtml || ""}${childHtml}</li>`;
    }

    case "checkListItem": {
      const checked = !!block.props?.checked;
      const checkboxClass = checked ? "task-checkbox checked" : "task-checkbox";
      const itemClass = checked ? "task-item checked" : "task-item";
      const item = `<div class="${itemClass}"${styleAttr}><div class="task-checkbox-wrap"><div class="${checkboxClass}"></div></div><span class="task-text">${inlineHtml}</span></div>`;
      return `${item}${renderChildren(block, theme)}`;
    }

    case "codeBlock": {
      const lang = (block.props?.language || "").trim();
      const codeStr = escapeHtml(extractCodeText(block.content));
      const wrap = block.props?.wrap === true;
      const collapsed = block.props?.collapsed === true;
      const summary =
        typeof block.props?.summary === "string" ? block.props.summary.trim() : "";

      // mermaid/math 由上游管线转 image；若仍落到这里则当普通代码
      const showLang = lang && lang !== "text" && lang !== "plain";
      const preClass = wrap ? ' class="code-wrap"' : "";
      const dataAttrs = [
        lang ? ` data-lang="${escapeHtml(lang)}"` : "",
        collapsed ? ' data-collapsed="true"' : "",
      ].join("");
      const summaryHtml =
        collapsed && summary
          ? `<div class="code-summary">${escapeHtml(summary)}</div>`
          : "";
      const langHtml = showLang
        ? `<div class="code-lang">${escapeHtml(lang)}</div>`
        : "";
      return `<div class="code-block"${dataAttrs}>${langHtml}${summaryHtml}<pre${preClass}><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${codeStr}</code></pre></div>`;
    }

    case "quote": {
      return `<blockquote${styleAttr}>${inlineHtml}</blockquote>${renderChildren(block, theme)}`;
    }

    case "paragraph": {
      if (!inlineHtml) {
        return `<p class="empty-block" data-empty="true"${styleAttr}><br></p>${renderChildren(block, theme)}`;
      }
      return `<p${styleAttr}>${inlineHtml}</p>${renderChildren(block, theme)}`;
    }

    case "image":
    case "imageResize": {
      const src = block.props?.url || block.props?.src || "";
      const caption = block.props?.caption || block.props?.alt || "";
      if (!src) {
        return caption
          ? `<p class="media-fallback"${styleAttr}>${escapeHtml(caption)}</p>`
          : "";
      }
      const alignment = block.props?.textAlignment || block.props?.alignment;
      const imgAlignStyle =
        alignment === "center"
          ? "display:block;margin-left:auto;margin-right:auto;"
          : alignment === "right"
            ? "display:block;margin-left:auto;"
            : "";
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" style="${imgAlignStyle}" />`;
      if (caption) {
        return `<figure class="export-figure"${styleAttr}>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
      }
      return img;
    }

    case "file": {
      const src = block.props?.url || block.props?.src || "";
      const name = block.props?.name || block.props?.caption || "附件";
      const caption = block.props?.caption || "";
      if (src && looksLikeImageUrl(src)) {
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption || name)}" />`;
        if (caption || name) {
          return `<figure class="export-figure"${styleAttr}>${img}<figcaption>${escapeHtml(caption || name)}</figcaption></figure>`;
        }
        return img;
      }
      const nameHtml = src
        ? `<a class="file-name" href="${escapeHtml(src)}">${escapeHtml(name)}</a>`
        : `<span class="file-name">${escapeHtml(name)}</span>`;
      const capHtml =
        caption && caption !== name
          ? `<div class="file-caption">${escapeHtml(caption)}</div>`
          : "";
      return `<div class="file-card"${styleAttr}><span class="file-icon">📎</span><div class="file-body">${nameHtml}${capHtml}</div></div>`;
    }

    case "table": {
      const rows = block.content?.rows || [];
      if (!rows.length) return "";
      const headerRowsRaw = Number(block.content?.headerRows);
      const headerRows =
        Number.isFinite(headerRowsRaw) && headerRowsRaw >= 0 ? Math.floor(headerRowsRaw) : 1;
      const htmlRows = rows.map((row: any, i: number) => {
        const cells = row.cells || [];
        const tag = i < headerRows ? "th" : "td";
        return `<tr>${cells
          .map((cell: any) => `<${tag}>${renderTableCellContent(cell, theme)}</${tag}>`)
          .join("")}</tr>`;
      });
      return `<table><tbody>${htmlRows.join("")}</tbody></table>`;
    }

    case "divider": {
      return `<hr />`;
    }

    case "toggleListItem": {
      const summary = `<div class="toggle-summary"><span class="toggle-marker">▾</span><span>${inlineHtml}</span></div>`;
      const childrenHtml = renderChildren(block, theme, "toggle-children");
      return `<div class="toggle-block"${styleAttr}>${summary}${childrenHtml}</div>`;
    }

    case "callout": {
      const icon = resolveCalloutIcon(block.props?.icon || block.props?.emoji);
      const childrenHtml = renderChildren(block, theme);
      return `<div class="callout"${styleAttr}><div class="callout-icon">${escapeHtml(icon)}</div><div class="callout-text">${inlineHtml}${childrenHtml}</div></div>`;
    }

    case "bulletList": {
      const items = block.content || block.children || [];
      return `<ul class="bn-list">${(items as any[]).map((item: any) => renderBlock(item, theme)).join("")}</ul>`;
    }

    case "orderedList": {
      const items = block.content || block.children || [];
      const start = Number(block.props?.start ?? block.attrs?.start);
      const startAttr =
        Number.isInteger(start) && start > 1 ? ` start="${start}"` : "";
      return `<ol class="bn-list"${startAttr}>${(items as any[]).map((item: any) => renderBlock(item, theme)).join("")}</ol>`;
    }

    case "video": {
      const src = block.props?.url || block.props?.src || "";
      const name = block.props?.name || block.props?.caption || "视频";
      if (!src) {
        return `<p class="media-fallback"${styleAttr}>▶ ${escapeHtml(name)}</p>`;
      }
      return `<p class="media-fallback"${styleAttr}><a href="${escapeHtml(src)}">▶ ${escapeHtml(name)}</a></p>`;
    }

    case "audio": {
      const src = block.props?.url || block.props?.src || "";
      const name = block.props?.name || block.props?.caption || "音频";
      if (!src) {
        return `<p class="media-fallback"${styleAttr}>♪ ${escapeHtml(name)}</p>`;
      }
      return `<p class="media-fallback"${styleAttr}><a href="${escapeHtml(src)}">♪ ${escapeHtml(name)}</a></p>`;
    }

    default: {
      const body = inlineHtml ? `<p${styleAttr}>${inlineHtml}</p>` : "";
      return `${body}${renderChildren(block, theme)}`;
    }
  }
}

export function renderInline(content: unknown, theme?: CardTheme): string {
  if (typeof content === "string") return escapeHtml(content).replace(/\n/g, "<br>");
  if (!Array.isArray(content)) return "";

  return content
    .map((item: any) => {
      if (typeof item === "string") return escapeHtml(item).replace(/\n/g, "<br>");
      if (!item || typeof item !== "object") return "";

      if (item.type === "hardBreak") return "<br>";

      // 链接：BlockNote 标准形态 { type, href, content: InlineContent[] }
      if (item.type === "link") {
        const href = item.href || item.attrs?.href || "";
        const inner = renderInline(item.content, theme) || escapeHtml(item.text || href);
        if (!href) return inner;
        return `<a href="${escapeHtml(href)}">${inner}</a>`;
      }

      if (item.type === "image" && item.attrs?.src) {
        const src = item.attrs.src;
        const alt = item.attrs.alt || "";
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;vertical-align:middle;" />`;
      }

      if (item.type === "inlineMath" && item.attrs?.value) {
        return `<code class="inline-math">${escapeHtml(item.attrs.value)}</code>`;
      }

      let text = escapeHtml(item.text || "").replace(/\n/g, "<br>");
      const styles = item.styles || {};
      const marks = item.marks || [];

      let wrapper = text;

      if (styles.bold || marks.some((m: any) => m?.type === "bold")) {
        wrapper = `<strong>${wrapper}</strong>`;
      }
      if (styles.italic || marks.some((m: any) => m?.type === "italic")) {
        wrapper = `<em>${wrapper}</em>`;
      }
      if (styles.underline || marks.some((m: any) => m?.type === "underline")) {
        wrapper = `<u>${wrapper}</u>`;
      }
      if (styles.strike || marks.some((m: any) => m?.type === "strike")) {
        wrapper = `<del>${wrapper}</del>`;
      }
      if (styles.code || marks.some((m: any) => m?.type === "code")) {
        wrapper = `<code>${wrapper}</code>`;
      }

      const linkMark = marks.find((m: any) => m?.type === "link");
      if (linkMark?.attrs?.href) {
        wrapper = `<a href="${escapeHtml(linkMark.attrs.href)}">${wrapper}</a>`;
      }

      const textColor =
        styles.textColor ||
        marks.find((m: any) => m?.type === "textColor")?.attrs?.color ||
        marks.find((m: any) => m?.type === "textColor")?.attrs?.stringValue ||
        marks.find((m: any) => m?.type === "textStyle")?.attrs?.color ||
        styles.color;
      const resolvedTextColor = resolveExportColor(textColor, textPalette(theme));
      if (resolvedTextColor) {
        wrapper = `<span style="color:${escapeHtml(resolvedTextColor)}">${wrapper}</span>`;
      }

      const bgColor =
        styles.backgroundColor ||
        marks.find((m: any) => m?.type === "backgroundColor")?.attrs?.color ||
        marks.find((m: any) => m?.type === "backgroundColor")?.attrs?.stringValue ||
        marks.find((m: any) => m?.type === "highlight")?.attrs?.color;
      const resolvedBgColor = resolveExportColor(bgColor, bgPalette(theme));
      if (resolvedBgColor) {
        wrapper = `<span style="background-color:${escapeHtml(resolvedBgColor)};border-radius:2px;padding:0 2px;">${wrapper}</span>`;
      }

      return wrapper;
    })
    .join("");
}

export function extractInlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (item.type === "hardBreak") return "\n";
      if (item.type === "link") return extractInlineText(item.content) || item.text || "";
      if (item.type === "inlineMath" && item.attrs?.value) return item.attrs.value;
      return item.text || "";
    })
    .join("");
}

export function extractCellTextForHtml(cell: any): string {
  if (typeof cell === "string") return cell;
  if (Array.isArray(cell)) {
    return cell
      .map((c: any) => {
        if (typeof c === "string") return c;
        if (c?.type === "link") return extractInlineText(c.content) || c.text || "";
        if (c?.text) return c.text;
        if (c?.type === "paragraph") return extractInlineText(c.content);
        return "";
      })
      .join("");
  }
  if (cell?.text) return cell.text;
  if (cell?.content) {
    if (typeof cell.content === "string") return cell.content;
    if (Array.isArray(cell.content)) return extractCellTextForHtml(cell.content);
  }
  return "";
}
