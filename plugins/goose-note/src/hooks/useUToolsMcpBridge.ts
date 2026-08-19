import { useEffect } from "react";
import type { JSONContent, Page } from "@/types";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  extractPlainText,
  normalizePageContent,
} from "@/components/editor/utils/blocknote-content";
import {
  importFromMarkdown,
  importMarkdownFragment,
} from "@/lib/export/markdown/parse";
import { buildAiPageContent, normalizeAiMarkdown } from "@/lib/notebook-ai/markdown";
import {
  guardPageForAiWrite,
  writePageContentSafely,
  appendPageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import { reloadEditorIfActive } from "@/lib/notebook-ai/liveWriter";
import { readLocalPageIdMap } from "@/lib/local-page-idmap";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";

/**
 * uTools MCP 工具桥接（渲染层）
 * preload 通过 utools.registerTool 注册写入工具后，向本层派发
 * goose-note:mcp-tool-request，并等待 goose-note:mcp-tool-response。
 * 只读工具仍在 preload 直读，不走此桥。
 */

const MCP_TOOL_REQUEST_EVENT = "goose-note:mcp-tool-request";
const MCP_TOOL_RESPONSE_EVENT = "goose-note:mcp-tool-response";
const MCP_TOOL_READY_EVENT = "goose-note:mcp-tool-ready";

const MCP_TOOL_NAMES = [
  "list_notebooks",
  "list_notes",
  "search_notes",
  "get_note",
  "get_mcp_capabilities",
  "create_note",
  "append_note",
  "update_note",
  "rename_note",
  "delete_note",
  "restore_note",
  "create_notebook",
  "update_notebook",
  "delete_notebook",
] as const;

const MCP_TOOL_CAPABILITIES = {
  protocol: "utools-mcp-tools",
  version: "1.0",
  transport: "uTools plugin.json.tools + utools.registerTool",
  tools: MCP_TOOL_NAMES,
  writeSafety:
    "写入工具直接修改本地笔记库；调用方应在执行前取得用户确认。删除进入回收站，不是永久删除。",
} as const;

type ToolParams = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const extractMarkdownTitle = (markdown: string, fallback = "未命名"): string => {
  const match = String(markdown || "").match(/^\s*#\s+(.+?)\s*$/m);
  if (match?.[1]) return match[1].trim() || fallback;
  return fallback;
};

const getHeadingLevel = (block: any): number | undefined => {
  if (block?.type !== "heading") return undefined;
  const level = block?.props?.level ?? block?.attrs?.level;
  return typeof level === "number" ? level : undefined;
};

const getBlockText = (block: any): string => {
  if (!block) return "";
  return extractPlainText([block] as BlockNoteContent).trim();
};

const normalizeHeading = (value: string): string =>
  value.replace(/^#+\s*/, "").trim();

const replaceHeadingSection = (
  content: JSONContent,
  heading: string,
  markdown: string,
  ensureFirstTitle: boolean,
): JSONContent => {
  const blocks = normalizePageContent(content, { ensureFirstTitle });
  const target = normalizeHeading(heading);
  if (!target) throw new Error("heading 不能为空");

  let start = -1;
  let level = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const blockLevel = getHeadingLevel(blocks[i]);
    if (blockLevel == null) continue;
    if (normalizeHeading(getBlockText(blocks[i])) === target) {
      start = i;
      level = blockLevel;
      break;
    }
  }
  if (start < 0) throw new Error(`未找到标题「${target}」`);

  let end = blocks.length;
  for (let i = start + 1; i < blocks.length; i += 1) {
    const nextLevel = getHeadingLevel(blocks[i]);
    if (nextLevel != null && nextLevel <= level) {
      end = i;
      break;
    }
  }

  const addition = importMarkdownFragment(normalizeAiMarkdown(markdown).trim());
  if (!addition?.length) throw new Error("要写入的 Markdown 无法解析");
  return [...blocks.slice(0, start + 1), ...addition, ...blocks.slice(end)] as JSONContent;
};

const serializeNotebook = (notebook: {
  id: string;
  name: string;
  source?: string;
  localPath?: string;
}) => ({
  id: notebook.id,
  name: notebook.name,
  source: notebook.source === "local-folder" ? "local-folder" : "default",
  ...(notebook.source === "local-folder" && notebook.localPath
    ? { localPath: notebook.localPath }
    : {}),
});

const serializeNote = (page: Page) => {
  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  return {
    id: page.id,
    title: getPageTitle(page),
    notebookId: page.workspaceId,
    notebookName: notebook?.name || "未知记事本",
    sourceType: page.localFilePath ? "local-file" : "app-page",
    parentId: page.parentId,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    isFolder: page.isFolder === true,
    ...(typeof page.trashedAt === "number" ? { trashedAt: page.trashedAt } : {}),
    ...(page.localFilePath ? { localFilePath: page.localFilePath } : {}),
  };
};

const requireWritablePage = (pageId: string): Page => {
  const guard = guardPageForAiWrite(pageId);
  if (!guard.ok) throw new Error(guard.error);
  return guard.page;
};

async function ensurePageLoaded(noteId: string): Promise<Page> {
  const existing = usePages.getState().pages[noteId];
  if (existing) return existing;

  const notebooks = Object.values(useNotebooks.getState().notebooks);
  for (const notebook of notebooks) {
    if (notebook.source !== "local-folder" || !notebook.localPath) continue;
    const map = readLocalPageIdMap(notebook.id);
    const inMap = Object.values(map).includes(noteId);
    const byPrefix = noteId.startsWith(`local-${notebook.id}-`);
    if (!inMap && !byPrefix) continue;
    await usePages.getState().loadLocalFolderPages(notebook.id, notebook.localPath);
    const loaded = usePages.getState().pages[noteId];
    if (loaded) return loaded;
  }

  throw new Error("未找到对应笔记");
}

const requireParent = (parentId: string, notebookId: string): Page => {
  const parent = usePages.getState().pages[parentId];
  if (!parent) throw new Error("未找到父笔记");
  if (parent.workspaceId !== notebookId) {
    throw new Error("父笔记不属于目标记事本");
  }
  if (parent.trashedAt) throw new Error("不能把笔记建在回收站条目下");
  return parent;
};

const markdownToContent = (
  markdown: string,
  options?: { preserveStructure?: boolean },
): JSONContent => {
  const imported = importFromMarkdown(markdown, undefined, {
    preserveStructure: options?.preserveStructure === true,
  });
  if (!imported.success) {
    throw new Error(imported.error || "Markdown 解析失败");
  }
  return imported.content as JSONContent;
};

async function executeTool(tool: string, params: ToolParams): Promise<unknown> {
  switch (tool) {
    case "get_mcp_capabilities":
      return MCP_TOOL_CAPABILITIES;

    case "create_note": {
      const notebookId = str(params.notebook_id).trim();
      const title = str(params.title).trim();
      const markdown = str(params.markdown);
      const parentId = str(params.parent_id).trim() || undefined;
      if (!notebookId) throw new Error("notebook_id 不能为空");
      if (!title && !markdown.trim()) {
        throw new Error("title 与 markdown 至少需要提供一个");
      }

      const notebook = useNotebooks.getState().notebooks[notebookId];
      if (!notebook) throw new Error(`未找到记事本：${notebookId}`);
      if (parentId) requireParent(parentId, notebookId);

      const resolvedTitle = title || extractMarkdownTitle(markdown);
      let pageId: string | null;

      if (notebook.source === "local-folder") {
        if (notebook.localPath && !usePages.getState().pages[parentId || ""]) {
          await usePages.getState().loadLocalFolderPages(notebookId, notebook.localPath);
          if (parentId) requireParent(parentId, notebookId);
        }
        const content = markdown.trim()
          ? markdownToContent(markdown, { preserveStructure: true })
          : undefined;
        pageId = await usePages.getState().createLocalPageRecord({
          workspaceId: notebookId,
          parentId,
          title: resolvedTitle,
          content,
        });
      } else {
        const content = buildAiPageContent(resolvedTitle, markdown) as JSONContent;
        pageId = usePages.getState().createPageRecord({
          workspaceId: notebookId,
          parentId,
          content,
        });
      }

      if (!pageId) throw new Error("创建笔记失败");
      const page = usePages.getState().pages[pageId];
      if (!page) throw new Error("创建笔记失败");
      return serializeNote(page);
    }

    case "append_note": {
      const noteId = str(params.note_id).trim();
      const markdown = normalizeAiMarkdown(str(params.markdown)).trim();
      if (!noteId) throw new Error("note_id 不能为空");
      if (!markdown) throw new Error("markdown 不能为空");
      await ensurePageLoaded(noteId);
      requireWritablePage(noteId);

      const addition = importMarkdownFragment(markdown);
      if (!addition?.length) throw new Error("追加内容无法解析为 Markdown");
      const result = await appendPageContentSafely(noteId, addition as JSONContent);
      if (!result.ok) throw new Error(result.error);
      reloadEditorIfActive(noteId);
      const page = usePages.getState().pages[noteId];
      if (!page) throw new Error("追加后未找到笔记");
      return serializeNote(page);
    }

    case "update_note": {
      const noteId = str(params.note_id).trim();
      const markdown = str(params.markdown);
      const heading = str(params.heading).trim();
      if (!noteId) throw new Error("note_id 不能为空");
      if (!markdown.trim()) throw new Error("markdown 不能为空");
      await ensurePageLoaded(noteId);
      const page = requireWritablePage(noteId);
      const isLocal = Boolean(page.localFilePath);

      let nextContent: JSONContent;
      if (heading) {
        nextContent = replaceHeadingSection(
          page.content,
          heading,
          markdown,
          !isLocal,
        );
      } else if (isLocal) {
        nextContent = markdownToContent(markdown, { preserveStructure: true });
      } else {
        nextContent = buildAiPageContent(getPageTitle(page), markdown) as JSONContent;
      }

      const result = await writePageContentSafely(noteId, nextContent);
      if (!result.ok) throw new Error(result.error);
      reloadEditorIfActive(noteId);
      const updated = usePages.getState().pages[noteId];
      if (!updated) throw new Error("更新后未找到笔记");
      return serializeNote(updated);
    }

    case "rename_note": {
      const noteId = str(params.note_id).trim();
      const title = str(params.title).replace(/^#+\s*/, "").trim();
      if (!noteId) throw new Error("note_id 不能为空");
      if (!title) throw new Error("title 不能为空");
      await ensurePageLoaded(noteId);
      const page = requireWritablePage(noteId);

      if (page.localFilePath) {
        const nextPageId = await usePages.getState().renameLocalPageFile(noteId, title);
        const renamed = usePages.getState().pages[nextPageId];
        if (!renamed) throw new Error("重命名失败");
        reloadEditorIfActive(nextPageId);
        return serializeNote(renamed);
      }

      const [firstBlock, ...bodyBlocks] = normalizePageContent(page.content);
      const content = [
        {
          ...firstBlock,
          type: "heading",
          props: { ...firstBlock?.props, level: 1 },
          content: title,
        },
        ...bodyBlocks,
      ] as JSONContent;
      const result = await writePageContentSafely(noteId, content);
      if (!result.ok) throw new Error(result.error);
      reloadEditorIfActive(noteId);
      const updated = usePages.getState().pages[noteId];
      if (!updated) throw new Error("重命名失败");
      return serializeNote(updated);
    }

    case "delete_note": {
      const noteId = str(params.note_id).trim();
      if (!noteId) throw new Error("note_id 不能为空");
      const page = await ensurePageLoaded(noteId);
      if (page.isFolder) throw new Error("文件夹不能通过此工具删除");
      if (page.isLocked) throw new Error("页面已锁定，不能删除");
      if (page.trashedAt) throw new Error("笔记已在回收站中");
      if (page.localReadState === "error") {
        throw new Error(
          page.localReadError
            ? `本地文件读取失败：${page.localReadError}`
            : "本地文件读取失败，不能删除",
        );
      }

      const deleted = await usePages.getState().deletePage(noteId);
      if (!deleted) throw new Error("删除失败");
      return {
        ok: true,
        id: noteId,
        trashed: true,
        title: getPageTitle(page),
      };
    }

    case "restore_note": {
      const noteId = str(params.note_id).trim();
      if (!noteId) throw new Error("note_id 不能为空");
      const page = usePages.getState().pages[noteId];
      if (!page) {
        throw new Error("未找到对应笔记。本地文件删除后进入系统回收站，无法在应用内恢复。");
      }
      if (!page.trashedAt) throw new Error("该笔记不在回收站中");
      const result = usePages.getState().restorePage(noteId);
      if (!result.ok) throw new Error("恢复失败");
      const restored = usePages.getState().pages[noteId];
      return {
        ok: true,
        id: noteId,
        restoredCount: result.restoredCount ?? 1,
        ...(restored ? serializeNote(restored) : {}),
      };
    }

    case "create_notebook": {
      const name = str(params.name).trim();
      if (!name) throw new Error("name 不能为空");
      const id = useNotebooks.getState().createNotebook(name);
      const notebook = useNotebooks.getState().notebooks[id];
      if (!notebook) throw new Error("创建记事本失败");
      return serializeNotebook(notebook);
    }

    case "update_notebook": {
      const notebookId = str(params.notebook_id).trim();
      const name = str(params.name).trim();
      if (!notebookId) throw new Error("notebook_id 不能为空");
      if (!name) throw new Error("name 不能为空");
      const notebook = useNotebooks.getState().notebooks[notebookId];
      if (!notebook) throw new Error(`未找到记事本：${notebookId}`);
      useNotebooks.getState().updateNotebook(notebookId, { name });
      const updated = useNotebooks.getState().notebooks[notebookId];
      if (!updated) throw new Error("更新记事本失败");
      return serializeNotebook(updated);
    }

    case "delete_notebook": {
      const notebookId = str(params.notebook_id).trim();
      if (!notebookId) throw new Error("notebook_id 不能为空");
      const notebooks = useNotebooks.getState().notebooks;
      const notebook = notebooks[notebookId];
      if (!notebook) throw new Error(`未找到记事本：${notebookId}`);
      if (Object.keys(notebooks).length <= 1) {
        throw new Error("至少需要保留一本记事本");
      }
      const isLocal = notebook.source === "local-folder";
      useNotebooks.getState().deleteNotebook(notebookId);
      if (useNotebooks.getState().notebooks[notebookId]) {
        throw new Error("删除记事本失败");
      }
      return {
        ok: true,
        id: notebookId,
        unmounted: isLocal,
        deletedFromDisk: false,
      };
    }

    default:
      throw new Error(`未知的 MCP 工具：${tool}`);
  }
}

export function useUToolsMcpBridge() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.utools) return;

    const handleRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{ requestId?: string; tool?: string; params?: ToolParams }>
      ).detail;
      const requestId = detail?.requestId;
      const tool = detail?.tool;
      if (!requestId || !tool) return;

      void (async () => {
        try {
          const result = await executeTool(tool, detail?.params || {});
          window.dispatchEvent(
            new CustomEvent(MCP_TOOL_RESPONSE_EVENT, {
              detail: { requestId, ok: true, result },
            }),
          );
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent(MCP_TOOL_RESPONSE_EVENT, {
              detail: {
                requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
          );
        }
      })();
    };

    window.addEventListener(MCP_TOOL_REQUEST_EVENT, handleRequest);
    (window as unknown as { __gooseNoteMcpReady?: boolean }).__gooseNoteMcpReady = true;
    window.dispatchEvent(new CustomEvent(MCP_TOOL_READY_EVENT));

    return () => {
      window.removeEventListener(MCP_TOOL_REQUEST_EVENT, handleRequest);
    };
  }, []);
}
