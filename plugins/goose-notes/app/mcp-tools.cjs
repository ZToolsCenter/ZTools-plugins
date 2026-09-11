"use strict";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractTextFromPageContent(content) {
  if (!content || typeof content !== "object") return "";

  const texts = [];

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string" && node.text) {
      texts.push(node.text);
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };

  walk(content);
  return normalizeWhitespace(texts.join(" "));
}

function extractTitleFromPageContent(content) {
  const firstNode = Array.isArray(content?.content) ? content.content[0] : null;
  if (firstNode?.type === "heading" && firstNode?.attrs?.level === 1) {
    const title = extractTextFromPageContent(firstNode);
    return title || "无标题";
  }

  const firstBlock = Array.isArray(content) ? content[0] : null;
  if (firstBlock?.type === "heading") {
    const title = extractTextFromPageContent(firstBlock);
    return title || "无标题";
  }

  return "无标题";
}

function stripMarkdownSyntax(markdown) {
  const text = String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .split("\n")
        .slice(1, -1)
        .join("\n"),
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[(?: |x|X)\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{2,}/g, "\n");

  return normalizeWhitespace(text);
}

function extractMarkdownTitle(markdown, fallbackTitle = "无标题") {
  const match = String(markdown || "").match(/^\s*#\s+(.+?)\s*$/m);
  if (match?.[1]) {
    return normalizeWhitespace(match[1]);
  }
  return fallbackTitle;
}

function createSnippet(text, query = "", maxLength = 160) {
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText) return "";

  const safeLength = Math.max(20, Number(maxLength) || 160);
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return normalizedText.length <= safeLength
      ? normalizedText
      : `${normalizedText.slice(0, safeLength).trim()}...`;
  }

  const haystack = normalizedText.toLowerCase();
  const index = haystack.indexOf(normalizedQuery);
  if (index < 0) {
    return normalizedText.length <= safeLength
      ? normalizedText
      : `${normalizedText.slice(0, safeLength).trim()}...`;
  }

  const half = Math.floor(safeLength / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(normalizedText.length, start + safeLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedText.length ? "..." : "";
  return `${prefix}${normalizedText.slice(start, end).trim()}${suffix}`;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildLocalPageId(notebookId, basePath, filePath) {
  const normalizedBase = normalizePath(basePath);
  const normalizedPath = normalizePath(filePath);
  let relativePath = normalizedPath;

  if (normalizedBase && normalizedPath.startsWith(`${normalizedBase}/`)) {
    relativePath = normalizedPath.slice(normalizedBase.length + 1);
  } else if (normalizedBase && normalizedPath === normalizedBase) {
    relativePath = "";
  }

  return `local-${notebookId}-${encodeURIComponent(relativePath)}`;
}

function parsePersistedNotebooks(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) return [];

  try {
    const parsed = JSON.parse(rawValue);
    const notebooks =
      parsed?.state?.notebooks && typeof parsed.state.notebooks === "object"
        ? parsed.state.notebooks
        : parsed?.notebooks && typeof parsed.notebooks === "object"
          ? parsed.notebooks
          : null;

    if (!notebooks) return [];

    return Object.values(notebooks).filter(
      (notebook) =>
        notebook &&
        typeof notebook === "object" &&
        typeof notebook.id === "string" &&
        typeof notebook.name === "string",
    );
  } catch {
    return [];
  }
}

function sortNoteItems(items, sortBy) {
  const nextItems = [...items];
  nextItems.sort((a, b) => {
    if (sortBy === "updated_at_asc") {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.title.localeCompare(b.title, "zh-CN", { numeric: true });
    }

    if (sortBy === "title_asc") {
      const titleCompare = a.title.localeCompare(b.title, "zh-CN", { numeric: true });
      if (titleCompare !== 0) return titleCompare;
      return b.updatedAt - a.updatedAt;
    }

    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.title.localeCompare(b.title, "zh-CN", { numeric: true });
  });
  return nextItems;
}

function getNextOffset(total, offset, returnedCount) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeReturnedCount = Math.max(0, Math.floor(Number(returnedCount) || 0));
  const nextOffset = safeOffset + safeReturnedCount;

  return nextOffset < safeTotal ? nextOffset : null;
}

function searchNoteItems(items, query) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) return [];

  const scored = [];
  for (const item of items) {
    const matchedFields = [];
    const title = String(item.title || "").toLowerCase();
    const contentText = String(item.contentText || "").toLowerCase();

    if (title.includes(normalizedQuery)) {
      matchedFields.push("title");
    }
    if (contentText.includes(normalizedQuery)) {
      matchedFields.push("content");
    }
    if (matchedFields.length === 0) continue;

    const score =
      (matchedFields.includes("title") ? 2 : 0) +
      (matchedFields.includes("content") ? 1 : 0);

    scored.push({
      ...item,
      score,
      matchedFields,
      snippet: createSnippet(item.contentText || "", normalizedQuery),
    });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.title.localeCompare(b.title, "zh-CN", { numeric: true });
  });

  return scored;
}

module.exports = {
  buildLocalPageId,
  createSnippet,
  extractMarkdownTitle,
  extractTextFromPageContent,
  extractTitleFromPageContent,
  getNextOffset,
  parsePersistedNotebooks,
  searchNoteItems,
  sortNoteItems,
  stripMarkdownSyntax,
};
