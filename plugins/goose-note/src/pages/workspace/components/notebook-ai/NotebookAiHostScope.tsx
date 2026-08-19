/**
 * 为不在页面编辑器树内的 AI 面板（独立标签 / 欢迎页侧栏）注入 EditorHost 上下文。
 * Composer / AiComposerInput 依赖 useEditorPageContext（onOpenPage、@ 引用搜索）。
 */
import { useMemo, type ReactNode } from "react";
import type { Page } from "@/types";
import { usePages } from "@/stores/usePages";
import { EditorHostBridge } from "@/pages/workspace/components/editor-host/EditorHostBridge";

function createSyntheticAiHostPage(notebookId: string): Page {
  const now = Date.now();
  return {
    id: `__notebook-ai-host__${notebookId}`,
    workspaceId: notebookId,
    content: { type: "doc", content: [] },
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: now,
    updatedAt: now,
  };
}

interface NotebookAiHostScopeProps {
  notebookId: string;
  children: ReactNode;
}

export function NotebookAiHostScope({
  notebookId,
  children,
}: NotebookAiHostScopeProps) {
  const activePageId = usePages((s) => s.activePageId);
  const pages = usePages((s) => s.pages);

  const hostPage = useMemo(() => {
    const active = activePageId ? pages[activePageId] : undefined;
    if (active && active.workspaceId === notebookId && !active.trashedAt) {
      return active;
    }
    return createSyntheticAiHostPage(notebookId);
  }, [activePageId, pages, notebookId]);

  return (
    <EditorHostBridge
      page={hostPage}
      isEditorFullWidth
      // AI shell 不经由 host 写页内容（写入走 liveWriter / editorRef）
      onContentChangeOverride={() => {}}
    >
      {children}
    </EditorHostBridge>
  );
}
