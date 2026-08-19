import { jsonContentToMarkdown } from "@/lib/export";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import type { Page } from "@/types";

export type NoteToolMarkerType = "search" | "read" | "read-section";

export interface NoteToolMarker {
  type: NoteToolMarkerType;
  argument: string;
}

const NOTE_TOOL_MARKER_RE = /<!--\s*(search|read|read-section)\s*:\s*([\s\S]*?)\s*-->/i;

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function getReadablePages() {
  return Object.values(usePages.getState().pages).filter(
    (page) =>
      !page.trashedAt &&
      !page.isFolder &&
      !(page.localFilePath && page.localReadState === "error"),
  );
}

function getNotebookName(workspaceId: string) {
  return useNotebooks.getState().notebooks[workspaceId]?.name ?? "未知笔记本";
}

function buildPageMarkdown(page: Page) {
  const title = getPageTitle(page);
  const body = jsonContentToMarkdown(page.content, true).trim();
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

function buildSearchHaystack(page: Page) {
  return [getPageTitle(page), getNotebookName(page.workspaceId), buildPageMarkdown(page)]
    .join("\n")
    .toLowerCase();
}

function findPageByTitle(title: string, originNotebookId?: string | null) {
  const normalizedTitle = normalizeText(title);
  const pages = getReadablePages().filter(
    (page) => page.workspaceId === originNotebookId,
  );
  const exactMatches = pages.filter((page) => normalizeText(getPageTitle(page)) === normalizedTitle);
  if (exactMatches[0]) return exactMatches[0];

  const fuzzyMatches = pages.filter((page) =>
    normalizeText(getPageTitle(page)).includes(normalizedTitle),
  );
  return fuzzyMatches[0] ?? null;
}

function extractMarkdownSection(markdown: string, sectionTitle: string) {
  const lines = markdown.split(/\r?\n/);
  const normalizedSectionTitle = normalizeText(sectionTitle);
  let startIndex = -1;
  let startLevel = 7;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    if (normalizeText(match[2]) !== normalizedSectionTitle) continue;
    startIndex = index;
    startLevel = match[1].length;
    break;
  }

  if (startIndex === -1) return null;

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    if (match[1].length <= startLevel) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function executeSearchTool(argument: string, originNotebookId?: string | null) {
  const query = argument.replace(/\bscope:all\b/gi, "").trim();
  if (!query) {
    return "搜索失败：缺少查询关键词。";
  }

  const pages = getReadablePages()
    .filter((page) => page.workspaceId === originNotebookId)
    .filter((page) => buildSearchHaystack(page).includes(query.toLowerCase()))
    .slice(0, 5);

  if (!pages.length) {
    return `未找到与「${query}」相关的笔记。`;
  }

  return [
    `搜索到 ${pages.length} 条结果：`,
    ...pages.map((page, index) => {
      const markdown = buildPageMarkdown(page);
      const snippet = markdown.length > 240 ? `${markdown.slice(0, 240)}...` : markdown;
      return [
        `${index + 1}. ${getPageTitle(page)}`,
        `笔记本：${getNotebookName(page.workspaceId)}`,
        `内容预览：`,
        snippet,
      ].join("\n");
    }),
  ].join("\n\n");
}

function executeReadTool(argument: string, originNotebookId?: string | null) {
  const page = findPageByTitle(argument, originNotebookId);
  if (!page) {
    return `读取失败：未找到标题为「${argument}」的笔记。`;
  }

  return [
    `标题：${getPageTitle(page)}`,
    `笔记本：${getNotebookName(page.workspaceId)}`,
    "完整内容：",
    buildPageMarkdown(page),
  ].join("\n\n");
}

function executeReadSectionTool(argument: string, originNotebookId?: string | null) {
  const [rawTitle, rawSection] = argument.split("#");
  const title = rawTitle?.trim() ?? "";
  const section = rawSection?.trim() ?? "";

  if (!title || !section) {
    return "读取失败：read-section 需要使用“页面标题#段落标题”的格式。";
  }

  const page = findPageByTitle(title, originNotebookId);
  if (!page) {
    return `读取失败：未找到标题为「${title}」的笔记。`;
  }

  const sectionMarkdown = extractMarkdownSection(buildPageMarkdown(page), section);
  if (!sectionMarkdown) {
    return `读取失败：在「${title}」中未找到段落「${section}」。`;
  }

  return [
    `标题：${getPageTitle(page)}`,
    `段落：${section}`,
    "段落内容：",
    sectionMarkdown,
  ].join("\n\n");
}

export function parseNoteToolMarker(text: string): NoteToolMarker | null {
  const match = text.match(NOTE_TOOL_MARKER_RE);
  if (!match) return null;

  const type = match[1].toLowerCase() as NoteToolMarkerType;
  const argument = match[2].trim();
  if (!argument) return null;

  return { type, argument };
}

export function executeNoteToolMarker(
  marker: NoteToolMarker,
  options?: {
    originNotebookId?: string | null;
  },
) {
  switch (marker.type) {
    case "search":
      return executeSearchTool(marker.argument, options?.originNotebookId);
    case "read":
      return executeReadTool(marker.argument, options?.originNotebookId);
    case "read-section":
      return executeReadSectionTool(marker.argument, options?.originNotebookId);
  }
}

export function buildToolContinuationPrompt(toolResult: string) {
  return [
    "以下是你请求的笔记检索结果：",
    toolResult,
    "",
    "请基于这些结果继续回答用户上一条问题。",
    "如果信息已经足够，直接输出最终答案。",
    "只有在确实还缺信息时，才输出单个新的工具标记。",
    "不要原样重复任何工具标记。",
  ].join("\n");
}
