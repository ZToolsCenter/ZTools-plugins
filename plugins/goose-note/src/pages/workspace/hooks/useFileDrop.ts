import { useState, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { usePages } from "@/stores/usePages";
import { useNotebooks, DEFAULT_NOTEBOOK } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import { activateNotebook } from "@/lib/notebookNavigation";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";

type WorkspaceDragIntent = "folder" | "text-file" | "file";

function getFileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedTextImportFile(file: File) {
  const ext = getFileExtension(file.name);
  return ext === "md" || ext === "markdown" || ext === "txt";
}

function getWorkspaceDragIntent(dataTransfer: DataTransfer): WorkspaceDragIntent {
  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) return "folder";
  }

  const files = Array.from(dataTransfer.files || []);
  if (files.some(isSupportedTextImportFile)) return "text-file";

  if (
    items.some(
      (item) =>
        item.kind === "file" &&
        (item.type === "text/markdown" || item.type === "text/plain"),
    )
  ) {
    return "text-file";
  }

  return items.some((item) => item.kind === "file") ? "text-file" : "file";
}

export function useFileDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const [dragIntent, setDragIntent] = useState<WorkspaceDragIntent>("file");
  const dragCounter = useRef(0);

  const isExternalFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes("Files");

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isExternalFileDrag(e)) return;
    dragCounter.current++;
    setDragIntent(getWorkspaceDragIntent(e.dataTransfer));
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isExternalFileDrag(e)) return;
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isExternalFileDrag(e)) return;
    setDragIntent(getWorkspaceDragIntent(e.dataTransfer));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!isExternalFileDrag(e)) return;
    setIsDragging(false);
    dragCounter.current = 0;

    const items = Array.from(e.dataTransfer.items);
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.();
      if (!entry || !entry.isDirectory) continue;

      const file = item.getAsFile?.();
      const folderPath =
        file && typeof (file as any).path === "string"
          ? (file as any).path
          : null;
      if (!folderPath) continue;

      const folderName = folderPath.split(/[\\/]/).pop() || "Unknown";
      const notebookId = useNotebooks
        .getState()
        .createLocalFolderNotebook(folderName, folderPath);
      await usePages
        .getState()
        .loadLocalFolderPages(notebookId, folderPath, { showWelcome: true });
      toast.success("文件夹已打开");
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter(isSupportedTextImportFile);
    if (files.length === 0) {
      toast.error("暂不支持这种文件", {
        description: "可以拖入 .md、.markdown 或 .txt 文本文件。",
      });
      return;
    }

    const currentNotebookId = useNotebooks.getState().activeNotebookId;
    const currentNotebook = currentNotebookId
      ? useNotebooks.getState().notebooks[currentNotebookId]
      : null;
    const targetNotebookId =
      currentNotebookId && currentNotebook?.source !== "local-folder"
        ? currentNotebookId
        : DEFAULT_NOTEBOOK;
    const createdPageIds: string[] = [];

    let importFromMarkdown: ((text: string, filename: string) => any) | undefined;
    try {
      ({ importFromMarkdown } = await import("@/lib/export"));
    } catch {
      toast.error("导入失败", { description: "导入模块加载失败，请重试。" });
      return;
    }

    for (const file of files) {
      const text = await file.text();
      const filename = file.name.replace(/\.[^/.]+$/, "");
      const result = importFromMarkdown!(text, filename);
      if (!result.success) continue;

      const pageId = usePages.getState().createPage(undefined, targetNotebookId);
      usePages.getState().updatePage(pageId, {
        content: [
          { type: "heading", props: { level: 1 }, content: result.title },
          ...result.content,
        ] as any,
      });
      createdPageIds.push(pageId);
    }

    const firstPageId = createdPageIds[0];
    if (!firstPageId) {
      toast.error("导入失败", {
        description: "文件内容无法解析为笔记。",
      });
      return;
    }

    closeNotebookAiIfFullscreen();
    await activateNotebook(targetNotebookId);
    useTabs.getState().openTab(firstPageId);
    await usePages.getState().setActivePage(firstPageId);
    toast.success("文本文件已导入", {
      description:
        createdPageIds.length === 1
          ? files[0].name
          : `已导入 ${createdPageIds.length} 个文件`,
    });
  };

  return {
    isDragging,
    dragIntent,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
