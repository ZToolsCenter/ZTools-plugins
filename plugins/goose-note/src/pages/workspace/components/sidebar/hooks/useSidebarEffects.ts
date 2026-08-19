import { deletePageWithUndo } from "@/lib/page-delete-actions";
import { usePages } from "@/stores/usePages";
import { useSidebarView } from "@/stores/useSidebarView";

interface UseSidebarEffectsOptions {
  activePageId?: string | null | undefined;
  activeNotebookId?: string | null | undefined;
  currentView: string;
  onOpenSettings: (tab?: "general" | "appearance" | "ai" | "data") => void;
}

export function useSidebarEffects({
  activeNotebookId,
  currentView,
  onOpenSettings,
}: UseSidebarEffectsOptions) {
  const resolveDeleteTargetPageId = useCallback(
    (target: Element | null) => {
      const activePageId = usePages.getState().activePageId;
      const isInSidebarTree = !!target?.closest(".rct-main-tree");
      if (!isInSidebarTree || !activeNotebookId) return activePageId;

      const view = useSidebarView.getState();
      const candidateIds = [
        view.focusedByNotebook[activeNotebookId] ?? null,
        view.selectedByNotebook[activeNotebookId] ?? null,
        activePageId,
      ];

      for (const candidateId of candidateIds) {
        if (!candidateId || candidateId === "root") continue;
        const page = usePages.getState().pages[candidateId];
        if (!page || page.trashedAt) continue;
        if (page.workspaceId !== activeNotebookId) continue;
        return candidateId;
      }

      return activePageId;
    },
    [activeNotebookId],
  );

  const handleDeleteShortcut = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isInEditor =
        (target instanceof HTMLElement && target.isContentEditable) ||
        !!target?.closest(".bn-editor") ||
        !!target?.closest("[data-ai-composer-editor]") ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        const deleteTargetPageId = resolveDeleteTargetPageId(target);
        if (deleteTargetPageId && !isInEditor && currentView === "pages") {
          e.preventDefault();
          void deletePageWithUndo(deleteTargetPageId);
        }
      }
    },
    [currentView, resolveDeleteTargetPageId],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleDeleteShortcut);
    return () => {
      document.removeEventListener("keydown", handleDeleteShortcut);
    };
  }, [handleDeleteShortcut]);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: "general" | "appearance" | "ai" | "data" }>;
      onOpenSettings(customEvent.detail?.tab);
      if (customEvent.detail?.tab) {
        window.dispatchEvent(
          new CustomEvent("goose-note:settings-tab-change", {
            detail: { tab: customEvent.detail.tab },
          }),
        );
      }
    };

    window.addEventListener("goose-note:open-settings", handleOpenSettings);
    return () => {
      window.removeEventListener("goose-note:open-settings", handleOpenSettings);
    };
  }, [onOpenSettings]);
}
