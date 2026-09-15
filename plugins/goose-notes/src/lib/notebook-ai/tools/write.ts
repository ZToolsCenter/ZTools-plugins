import { tool } from "ai";
import { z } from "zod";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  createAndFinalizePage,
  reloadEditorIfActive,
} from "@/lib/notebook-ai/liveWriter";
import { buildAiPageContent } from "@/lib/notebook-ai/markdown";
import { normalizeAiMarkdown } from "@/lib/notebook-ai/markdown";
import { importMarkdownFragment } from "@/lib/export/markdown/parse";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";
import {
  guardPageForAiWrite,
  writePageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import { blocksToMarkdown } from "@/lib/export/blocknoteSerializer";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { NotebookAiAgentContext } from "../types";
import type { JSONContent } from "@/types";

// ----------------------------------------------------------------
// createPage
// ----------------------------------------------------------------
export const createPage = tool({
  description:
    "在当前绑定笔记本新建一篇文章并打开它。markdown 参数需包含完整正文内容（首行不要重复标题）；写作类任务必须用这个工具，且 markdown 参数要输出完整文章。",
  inputSchema: z.object({
    title: z.string().describe("文章标题（不含 # 前缀）"),
    markdown: z
      .string()
      .describe(
        "文章正文，标准 Markdown 格式，首行不要重复标题。待办/进度/清单类内容必须用任务列表语法：`- [ ] 内容`（未完成）/ `- [x] 内容`（已完成），列表项之间不留空行；禁止使用 emoji 和裸 `[x]` 文本。",
      ),
  }),
  execute: async (input, { experimental_context, toolCallId }) => {
    const { notebookId } = experimental_context as NotebookAiAgentContext;
    const result = await createAndFinalizePage({
      toolCallId,
      notebookId,
      title: input.title,
      markdown: input.markdown,
    });
    return result.ok
      ? { pageId: result.pageId, title: input.title, ok: true }
      : { ok: false, error: result.error };
  },
});

// ----------------------------------------------------------------
// updatePage
// ----------------------------------------------------------------
export const updatePage = tool({
  description:
    "用新 Markdown 内容整体替换页面正文（保留页面标题）。用于精简、润色、总结、删除当前页区块等当前页编辑任务；这类任务不要先搜索笔记。pageId 省略时默认更新当前打开页面。markdown 参数为完整正文，首行不要包含标题。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("要更新的页面 id；省略则更新当前打开页面"),
    markdown: z
      .string()
      .describe(
        "新的正文内容（Markdown），首行不要包含 # 标题。待办/进度/清单类内容必须用任务列表语法：`- [ ] 内容` / `- [x] 内容`，列表项之间不留空行；禁止使用 emoji 和裸 `[x]` 文本。",
      ),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) return { pageId, ok: false, error: guard.error };
    if (!input.markdown.trim()) {
      return {
        pageId,
        ok: false,
        needsMarkdown: true,
        message:
          "缺少新的页面正文。请先 readPage，再用完整 markdown 调用 updatePage。",
      };
    }

    const title = getPageTitle(guard.page);
    const content = buildAiPageContent(title, input.markdown);

    const result = await writePageContentSafely(
      pageId,
      content as JSONContent,
      { expectedNotebookId: notebookId },
    );
    if (!result.ok) return { pageId, title, ok: false, error: result.error };

    return { pageId, title, ok: true };
  },
});

// ----------------------------------------------------------------
// replaceInPage
// ----------------------------------------------------------------
export const replaceInPage = tool({
  description:
    "在页面中精确替换所有匹配文本。pageId 省略时默认修改当前打开页面。找不到时返回 replacedCount=0 而非报错。批量修改任务应逐页调用，并汇报每页替换结果。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("要修改的页面 id；省略则修改当前打开页面"),
    find: z
      .string()
      .optional()
      .default("")
      .describe("要查找的原始文本（精确匹配）"),
    replace: z
      .string()
      .optional()
      .default("")
      .describe("替换后的文本；省略表示删除匹配文本"),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) {
      return { pageId, replacedCount: 0, ok: false, error: guard.error };
    }
    const title = getPageTitle(guard.page);
    if (!input.find.trim()) {
      return {
        pageId,
        title,
        replacedCount: 0,
        skipped: true,
        message:
          "缺少要精确替换的 find 文本。结构性编辑当前页时，请先 readPage，再调用 updatePage 写入完整正文。",
      };
    }

    // 先序列化为 markdown，做字符串替换，再写回
    const expectedRevision = {
      updatedAt: guard.updatedAt,
      contentSignature: guard.contentSignature,
    };
    const currentMd = await blocksToMarkdown(
      guard.page.content as BlockNoteContent,
    );
    const afterSerializeGuard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
      expectedRevision,
    });
    if (!afterSerializeGuard.ok) {
      return {
        pageId,
        title,
        replacedCount: 0,
        ok: false,
        error: afterSerializeGuard.error,
      };
    }
    const count = currentMd.split(input.find).length - 1;
    if (count === 0) return { pageId, title, replacedCount: 0 };

    const newMd = currentMd.split(input.find).join(input.replace);
    const newContent = buildAiPageContent(title, newMd);

    const result = await writePageContentSafely(
      pageId,
      newContent as JSONContent,
      { expectedNotebookId: notebookId, expectedRevision },
    );
    if (!result.ok) {
      return {
        pageId,
        title,
        replacedCount: 0,
        ok: false,
        error: result.error,
      };
    }
    reloadEditorIfActive(pageId);

    return { pageId, title, replacedCount: count, ok: true };
  },
});

// ----------------------------------------------------------------
// appendToPage
// ----------------------------------------------------------------
export const appendToPage = tool({
  description:
    "在页面正文末尾追加 Markdown，不改动已有内容和标题。pageId 省略时默认追加到当前打开页面。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("目标页面 id；省略则使用当前打开页面"),
    markdown: z
      .string()
      .describe(
        "要追加的 Markdown 内容。待办/进度/清单必须使用 `- [ ]` / `- [x]`，列表项之间不留空行。",
      ),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) return { pageId, ok: false, error: guard.error };

    const markdown = normalizeAiMarkdown(input.markdown).trim();
    if (!markdown) {
      return { pageId, ok: false, error: "要追加的内容不能为空" };
    }

    const addition = importMarkdownFragment(markdown);
    if (!addition?.length) {
      return { pageId, ok: false, error: "追加内容无法解析为 Markdown" };
    }

    const expectedRevision = {
      updatedAt: guard.updatedAt,
      contentSignature: guard.contentSignature,
    };
    const currentContent = normalizePageContent(guard.page.content, {
      ensureFirstTitle: !guard.page.localFilePath,
    });
    const title = getPageTitle(guard.page);
    const content = [...currentContent, ...addition] as JSONContent;
    const result = await writePageContentSafely(
      pageId,
      content as JSONContent,
      { expectedNotebookId: notebookId, expectedRevision },
    );
    if (!result.ok) return { pageId, title, ok: false, error: result.error };

    reloadEditorIfActive(pageId);
    return { pageId, title, ok: true };
  },
});

// ----------------------------------------------------------------
// renamePage
// ----------------------------------------------------------------
export const renamePage = tool({
  description: "重命名页面，不改动正文。pageId 省略时默认重命名当前打开页面。",
  inputSchema: z.object({
    pageId: z
      .string()
      .optional()
      .describe("目标页面 id；省略则使用当前打开页面"),
    title: z.string().min(1).describe("新标题，不含 # 前缀"),
  }),
  execute: async (input, { experimental_context }) => {
    const { currentPageId, notebookId } =
      experimental_context as NotebookAiAgentContext;
    const pageId =
      input.pageId ?? currentPageId ?? usePages.getState().activePageId ?? "";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: notebookId,
    });
    if (!guard.ok) return { pageId, ok: false, error: guard.error };

    const title = input.title.replace(/^#+\s*/, "").trim();
    if (!title) return { pageId, ok: false, error: "新标题不能为空" };

    if (guard.page.localFilePath) {
      try {
        const nextPageId = await usePages
          .getState()
          .renameLocalPageFile(pageId, title);
        return { pageId: nextPageId, title, ok: true };
      } catch (error) {
        return {
          pageId,
          ok: false,
          error: error instanceof Error ? error.message : "页面重命名失败",
        };
      }
    }

    const expectedRevision = {
      updatedAt: guard.updatedAt,
      contentSignature: guard.contentSignature,
    };
    const [firstBlock, ...bodyBlocks] = normalizePageContent(
      guard.page.content,
    );
    const content = [
      {
        ...firstBlock,
        type: "heading",
        props: { ...firstBlock?.props, level: 1 },
        content: title,
      },
      ...bodyBlocks,
    ] as JSONContent;
    const result = await writePageContentSafely(
      pageId,
      content as JSONContent,
      { expectedNotebookId: notebookId, expectedRevision },
    );
    if (!result.ok) return { pageId, title, ok: false, error: result.error };

    reloadEditorIfActive(pageId);
    return { pageId, title, ok: true };
  },
});

// ----------------------------------------------------------------
// deletePages
// ----------------------------------------------------------------
export const deletePages = tool({
  description:
    "删除当前绑定笔记本中的一个或多个页面。应用内页面移入垃圾箱，本地文件夹页面移入系统回收站；不会永久删除。删除父页面会同时删除其子页面。",
  inputSchema: z.object({
    pageIds: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe(
        "要删除的页面 id 列表，必须来自当前上下文、listPages 或 searchNotes",
      ),
  }),
  execute: async (input, { experimental_context }) => {
    const { notebookId } = experimental_context as NotebookAiAgentContext;
    const pages = usePages.getState().pages;
    const pageIds = [
      ...new Set(input.pageIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (pageIds.length === 0) {
      return { ok: false, error: "至少需要一个有效的页面 id" };
    }

    for (const pageId of pageIds) {
      const page = pages[pageId];
      if (!page) return { ok: false, error: `页面 ${pageId} 不存在` };
      if (page.workspaceId !== notebookId) {
        return { ok: false, error: "AI 只能删除当前绑定笔记本中的页面" };
      }
      if (page.trashedAt) {
        return {
          ok: false,
          error: `页面《${getPageTitle(page)}》已在垃圾箱中`,
        };
      }
      if (page.isFolder) {
        return {
          ok: false,
          error: `不能通过 AI 删除文件夹《${getPageTitle(page)}》`,
        };
      }
      if (page.isLocked) {
        return { ok: false, error: `页面《${getPageTitle(page)}》已锁定` };
      }
    }

    const requestedIds = new Set(pageIds);
    const rootPageIds = pageIds.filter((pageId) => {
      let parentId = pages[pageId]?.parentId;
      while (parentId) {
        if (requestedIds.has(parentId)) return false;
        parentId = pages[parentId]?.parentId;
      }
      return true;
    });

    const affectedIds = new Set<string>();
    const collectTree = (rootId: string) => {
      const stack = [rootId];
      while (stack.length) {
        const currentId = stack.pop()!;
        if (affectedIds.has(currentId)) continue;
        affectedIds.add(currentId);
        Object.values(pages).forEach((page) => {
          if (
            page.workspaceId === notebookId &&
            !page.trashedAt &&
            page.parentId === currentId
          ) {
            stack.push(page.id);
          }
        });
      }
    };
    rootPageIds.forEach(collectTree);

    const deletedRoots: Array<{ pageId: string; title: string }> = [];
    for (const pageId of rootPageIds) {
      const page = usePages.getState().pages[pageId];
      if (!page) continue;
      const title = getPageTitle(page);
      const deleted = await usePages.getState().deletePage(pageId);
      if (!deleted) {
        return {
          ok: false,
          deletedRoots,
          error: `删除《${title}》失败，已停止后续删除`,
        };
      }
      deletedRoots.push({ pageId, title });
      affectedIds.forEach((affectedPageId) => {
        let currentId: string | undefined = affectedPageId;
        while (currentId && currentId !== pageId) {
          currentId = pages[currentId]?.parentId;
        }
        if (currentId === pageId) {
          useTabs.getState().removeDeletedPage(affectedPageId);
        }
      });
    }

    return {
      ok: true,
      deletedCount: affectedIds.size,
      deletedRoots,
    };
  },
});
