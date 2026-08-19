import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import type { Page } from "@/types";

const compareBySidebarOrder = (a: Page, b: Page) =>
  (a.order ?? a.createdAt) - (b.order ?? b.createdAt);

const isActiveNotebookPage = (page: Page | undefined, notebookId: string) =>
  !!page && page.workspaceId === notebookId && !page.trashedAt;

export function resolveNotebookLandingPageId(
  notebookId: string | null | undefined,
): string | null {
  if (!notebookId) return null;

  const notebooksStore = useNotebooks.getState();
  const notebook = notebooksStore.notebooks[notebookId];
  if (!notebook || notebook.source === "local-folder") return null;

  const pages = usePages.getState().pages;
  const lastPageId = notebooksStore.getLastActivePage(notebookId);
  const lastPage = lastPageId ? pages[lastPageId] : undefined;
  if (lastPageId && isActiveNotebookPage(lastPage, notebookId)) {
    return lastPageId;
  }

  const firstValidPage = Object.values(pages)
    .filter((page) => isActiveNotebookPage(page, notebookId))
    .sort(compareBySidebarOrder)[0];

  return firstValidPage?.id ?? null;
}

export async function activateNotebook(
  notebookId: string,
): Promise<string | null> {
  const notebooksStore = useNotebooks.getState();
  if (!notebooksStore.notebooks[notebookId]) return null;

  notebooksStore.setActiveNotebook(notebookId);
  const landingPageId = resolveNotebookLandingPageId(notebookId);
  await usePages.getState().setActivePage(landingPageId);
  useTabs.getState().syncActiveTabForPage(landingPageId);
  return landingPageId;
}
