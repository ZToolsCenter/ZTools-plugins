import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "./emptyContent";
import { createEmptyLocalPageContent } from "./emptyContent";
import { hasStructuredBlocks, simpleExtractText } from "./normalize";

type BlockSpecLike = {
  config?: {
    content?: string;
    propSchema?: Record<string, PropSpecLike>;
  };
};

type EditorSchemaLike = {
  blockSpecs?: Record<string, BlockSpecLike>;
};

type PropSpecLike = {
  default?: boolean | number | string;
  type?: "boolean" | "number" | "string";
  values?: readonly unknown[];
};

function getBlockSpecs(schema: unknown): Record<string, BlockSpecLike> {
  const specs = (schema as EditorSchemaLike | undefined)?.blockSpecs;
  return specs && typeof specs === "object" ? specs : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStyles(value: unknown): Record<string, boolean | string> {
  if (!isPlainObject(value)) return {};
  const next: Record<string, boolean | string> = {};
  for (const [key, styleValue] of Object.entries(value)) {
    if (typeof styleValue === "boolean" || typeof styleValue === "string") {
      next[key] = styleValue;
    }
  }
  return next;
}

function sanitizeStyledText(value: unknown): {
  type: "text";
  text: string;
  styles: Record<string, boolean | string>;
} | null {
  if (typeof value === "string") {
    return { type: "text", text: value, styles: {} };
  }
  if (!isPlainObject(value)) return null;
  const text = value.text;
  if (typeof text !== "string") return null;
  return {
    type: "text",
    text,
    styles: sanitizeStyles(value.styles),
  };
}

function sanitizeLinkContent(content: unknown):
  | string
  | Array<{
      type: "text";
      text: string;
      styles: Record<string, boolean | string>;
    }> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return simpleExtractText({ content });

  const nodes: Array<{
    type: "text";
    text: string;
    styles: Record<string, boolean | string>;
  }> = [];

  for (const item of content) {
    const text = sanitizeStyledText(item);
    if (text) {
      nodes.push(text);
      continue;
    }
    const fallbackText = simpleExtractText({ content: [item] });
    if (fallbackText) {
      nodes.push({ type: "text", text: fallbackText, styles: {} });
    }
  }

  return nodes.length > 0 ? nodes : "";
}

function sanitizeInlineArray(
  content: unknown[],
): NonNullable<PartialBlock["content"]> {
  const nodes: unknown[] = [];

  for (const item of content) {
    if (typeof item === "string") {
      nodes.push(item);
      continue;
    }

    if (!isPlainObject(item)) continue;

    if (item.type === "link") {
      const href =
        typeof item.href === "string"
          ? item.href
          : typeof item.url === "string"
            ? item.url
            : "";
      const linkContent = sanitizeLinkContent(item.content);
      const text =
        typeof linkContent === "string"
          ? linkContent
          : linkContent.map((node) => node.text).join("");
      if (href || text) {
        nodes.push({
          type: "link",
          href,
          content: linkContent,
        });
      }
      continue;
    }

    const text = sanitizeStyledText(item);
    if (text) {
      nodes.push(text);
      continue;
    }

    const fallbackText = simpleExtractText({ content: [item] });
    if (fallbackText) nodes.push(fallbackText);
  }

  return nodes.length > 0
    ? (nodes as NonNullable<PartialBlock["content"]>)
    : "";
}

function normalizeInlineContent(content: unknown): PartialBlock["content"] {
  if (typeof content === "string") return content;
  if (Array.isArray(content) && !hasStructuredBlocks(content)) {
    return sanitizeInlineArray(content);
  }
  return simpleExtractText({ content });
}

function sanitizePropValue(
  value: unknown,
  spec: PropSpecLike,
): boolean | number | string | undefined {
  const valueType = spec.type ?? typeof spec.default;
  let next: boolean | number | string | undefined;

  if (valueType === "boolean") {
    if (typeof value === "boolean") {
      next = value;
    } else if (value === "true") {
      next = true;
    } else if (value === "false") {
      next = false;
    }
  } else if (valueType === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numberValue)) next = numberValue;
  } else if (valueType === "string") {
    if (typeof value === "string") {
      next = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      next = String(value);
    }
  }

  if (next === undefined) return undefined;

  if (Array.isArray(spec.values) && spec.values.length > 0) {
    return spec.values.includes(next) ? next : spec.default;
  }

  return next;
}

function sanitizeProps(
  type: string,
  props: unknown,
  spec: BlockSpecLike | undefined,
): PartialBlock["props"] | undefined {
  if (!isPlainObject(props)) return undefined;

  const propSchema = spec?.config?.propSchema;
  const allowedKeys =
    propSchema && typeof propSchema === "object"
      ? new Set(Object.keys(propSchema))
      : null;
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (value == null) continue;
    const propSpec = propSchema?.[key];
    if (!propSpec) {
      next[key] = value;
      continue;
    }
    const sanitized = sanitizePropValue(value, propSpec);
    if (sanitized !== undefined) next[key] = sanitized;
  }

  if (type === "heading") {
    const level = Number(next.level);
    next.level = Number.isFinite(level) ? Math.min(Math.max(level, 1), 3) : 1;
  }

  return Object.keys(next).length > 0
    ? (next as PartialBlock["props"])
    : undefined;
}

function sanitizeTableCellProps(
  props: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(props)) return undefined;
  const next: Record<string, unknown> = {};
  for (const key of ["backgroundColor", "textColor", "textAlignment"]) {
    const value = props[key];
    if (typeof value === "string") next[key] = value;
  }
  for (const key of ["colspan", "rowspan"]) {
    const value = Number(props[key]);
    if (Number.isFinite(value) && value > 0) next[key] = Math.floor(value);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeTableCell(cell: unknown): unknown {
  if (isPlainObject(cell) && cell.type === "tableCell") {
    const content = normalizeInlineContent(cell.content);
    const props = sanitizeTableCellProps(cell.props);
    return {
      type: "tableCell",
      ...(props ? { props } : {}),
      ...(content !== "" ? { content } : {}),
    };
  }
  return normalizeInlineContent(cell);
}

function sanitizeTableContent(
  content: unknown,
): PartialBlock["content"] | null {
  const rows = (content as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) return null;

  const sanitizedRows: Array<{ cells: unknown[] }> = [];
  for (const row of rows) {
    const cells = (row as { cells?: unknown } | undefined)?.cells;
    if (!Array.isArray(cells)) continue;
    const sanitizedCells = cells.map(sanitizeTableCell);
    if (sanitizedCells.length > 0) {
      sanitizedRows.push({ cells: sanitizedCells });
    }
  }

  if (sanitizedRows.length === 0) return null;

  const tableContent = content as {
    columnWidths?: unknown;
    headerRows?: unknown;
    headerCols?: unknown;
  };
  const columnWidths = Array.isArray(tableContent.columnWidths)
    ? tableContent.columnWidths.map((width) => {
        const numberWidth = Number(width);
        return Number.isFinite(numberWidth) && numberWidth > 0
          ? numberWidth
          : undefined;
      })
    : undefined;
  const headerRows = Number(tableContent.headerRows);
  const headerCols = Number(tableContent.headerCols);

  return {
    type: "tableContent",
    ...(columnWidths ? { columnWidths } : {}),
    ...(Number.isFinite(headerRows) && headerRows > 0
      ? { headerRows: Math.floor(headerRows) }
      : {}),
    ...(Number.isFinite(headerCols) && headerCols > 0
      ? { headerCols: Math.floor(headerCols) }
      : {}),
    rows: sanitizedRows,
  } as PartialBlock["content"];
}

function fallbackBlocksFromUnsupported(
  block: Record<string, unknown>,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  const nested = [
    ...(hasStructuredBlocks(block.content) ? block.content : []),
    ...(Array.isArray(block.children) ? block.children : []),
  ];
  const children = sanitizeBlocks(nested, specs);
  const text =
    simpleExtractText(block).trim() ||
    String(
      (block.props as Record<string, unknown> | undefined)?.url ?? "",
    ).trim();

  if (!text) return children;

  return [
    {
      type: "paragraph",
      content: text,
      ...(children.length > 0 ? { children } : {}),
    } as PartialBlock,
  ];
}

function sanitizeBlock(
  block: unknown,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  if (!isPlainObject(block)) return [];

  const rawType = typeof block.type === "string" ? block.type : "";
  const spec = specs[rawType];
  if (!rawType || !spec) {
    return fallbackBlocksFromUnsupported(block, specs);
  }

  const contentKind = spec.config?.content;
  const next = { type: rawType } as PartialBlock;
  const props = sanitizeProps(rawType, block.props ?? block.attrs, spec);
  if (props) next.props = props;

  if (contentKind === "table") {
    const tableContent = sanitizeTableContent(block.content);
    if (!tableContent) return fallbackBlocksFromUnsupported(block, specs);
    next.content = tableContent;
  } else if (contentKind !== "none" && block.content !== undefined) {
    next.content =
      rawType === "codeBlock"
        ? simpleExtractText(block)
        : normalizeInlineContent(block.content);
  }

  const children = sanitizeBlocks(block.children, specs);
  if (children.length > 0) next.children = children;

  return [next];
}

function sanitizeBlocks(
  blocks: unknown,
  specs: Record<string, BlockSpecLike>,
): PartialBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block) => sanitizeBlock(block, specs));
}

export function createEditorSafeContent(
  content: unknown,
  schema: unknown,
): BlockNoteContent {
  const sanitized = sanitizeBlocks(content, getBlockSpecs(schema));
  return sanitized.length > 0
    ? (sanitized as BlockNoteContent)
    : createEmptyLocalPageContent();
}
