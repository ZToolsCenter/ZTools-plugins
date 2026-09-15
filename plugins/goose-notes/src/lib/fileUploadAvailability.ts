import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";

function resolveCurrentNotebookSource(): "default" | "local-folder" | "unknown" {
  const { activePageId, pages } = usePages.getState();
  const pageWorkspaceId = activePageId ? pages[activePageId]?.workspaceId : null;
  const notebookId = pageWorkspaceId ?? useNotebooks.getState().activeNotebookId;

  if (!notebookId) return "unknown";
  const notebook = useNotebooks.getState().notebooks[notebookId];
  return notebook?.source === "local-folder" ? "local-folder" : "default";
}

export function getFileUploadAvailability(): {
  enabled: boolean;
  reason?: string;
} {
  if (resolveCurrentNotebookSource() === "local-folder") {
    return {
      enabled: false,
      reason: "本地文件夹记事本暂不支持附件上传",
    };
  }

  return { enabled: true };
}
