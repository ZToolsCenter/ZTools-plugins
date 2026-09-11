import "./styles/index.css";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { type EditorRef } from "@/components/editor/core/Editor";
import { useWorkspaceEvents } from "./hooks/useWorkspaceEvents";
import { useLocalFolderWatch } from "./hooks/useLocalFolderWatch";
import { useScrollRestoration } from "./hooks/useScrollRestoration";
import { useFileDrop } from "./hooks/useFileDrop";
import { useHistoryRecorder } from "@/hooks/useHistoryRecorder";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import { WorkspaceLayout } from "./WorkspaceLayout";

export function WorkspacePage() {
  const { activePageId, getPage } = usePages(useShallow((s) => ({ activePageId: s.activePageId, getPage: s.getPage })));
  const { activeNotebookId, notebooks } = useNotebooks(useShallow((s) => ({ activeNotebookId: s.activeNotebookId, notebooks: s.notebooks })));

  const page = activePageId ? getPage(activePageId) : undefined;
  const notebook = activeNotebookId ? notebooks[activeNotebookId] : undefined;

  const editorRef = useRef<EditorRef>(null);
  useEffect(() => {
    document.documentElement.classList.add("is-utools");
  }, []);

  // Hooks
  useWorkspaceEvents({ activePageId, page });
  useLocalFolderWatch({ notebook, activePageId, page });
  const scrollContainerRef = useScrollRestoration(activePageId);

  const historyContentSig = useMemo(
    () => (page ? getContentSignature(page.content) : ""),
    [page],
  );
  useHistoryRecorder({
    pageId: activePageId ?? null,
    workspaceId: page?.workspaceId ?? null,
    content: page?.content,
    signature: historyContentSig,
  });

  const {
    isDragging,
    dragIntent,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useFileDrop();

  return (
    <WorkspaceLayout
      isDragging={isDragging}
      dragIntent={dragIntent}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      editorRef={editorRef}
      scrollContainerRef={scrollContainerRef}
    />
  );
}
