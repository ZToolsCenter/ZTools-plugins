/**
 * 聊天行内 @ 引用导航。复用宿主 onOpenPage
 * （EditorHostBridge 内会 closeNotebookAiIfFullscreen + openTab）。
 */
export function navigateNotebookAiReference(
  pageId: string | undefined | null,
  openPage: (pageId: string) => void,
): boolean {
  const id = typeof pageId === "string" ? pageId.trim() : "";
  if (!id) return false;
  openPage(id);
  return true;
}
