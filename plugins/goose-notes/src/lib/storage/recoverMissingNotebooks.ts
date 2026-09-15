import { getPageTitle } from "@/components/editor/utils/page-title";
import type { Notebook } from "@/stores/useNotebooks";
import type { Page } from "@/types";

const DEFAULT_NOTEBOOK_ID = "default-notebook";
const DEFAULT_NOTEBOOK_NAME = "Note";
const DEFAULT_NOTEBOOK_ICON = "📓";
const RECOVERED_NOTEBOOK_NAME = "恢复的记事本";

interface RecoveryResult {
  notebooks: Record<string, Notebook>;
  recoveredCount: number;
  recoveredNotebookIds: string[];
}

const comparePages = (a: Page, b: Page) => {
  const rootDelta = Number(Boolean(a.parentId)) - Number(Boolean(b.parentId));
  if (rootDelta !== 0) return rootDelta;

  const orderA = a.order ?? a.createdAt;
  const orderB = b.order ?? b.createdAt;
  if (orderA !== orderB) return orderA - orderB;

  return a.id.localeCompare(b.id);
};

const normalizeNotebookName = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const buildUniqueNotebookName = (baseName: string, usedNames: Set<string>) => {
  let nextName = baseName;
  let suffix = 2;

  while (usedNames.has(nextName.toLocaleLowerCase("zh-CN"))) {
    nextName = `${baseName}(${suffix})`;
    suffix += 1;
  }

  usedNames.add(nextName.toLocaleLowerCase("zh-CN"));
  return nextName;
};

const resolveRecoveredNotebookName = (workspaceId: string, pages: Page[]) => {
  if (workspaceId === DEFAULT_NOTEBOOK_ID) {
    return DEFAULT_NOTEBOOK_NAME;
  }

  const candidatePage = pages
    .filter((page) => !page.trashedAt)
    .sort(comparePages)[0];

  const candidateName = normalizeNotebookName(
    candidatePage ? getPageTitle(candidatePage) : null,
  );

  return candidateName ?? RECOVERED_NOTEBOOK_NAME;
};

export const recoverMissingNotebooksFromPages = ({
  notebooks,
  pages,
}: {
  notebooks: Record<string, Notebook>;
  pages: Record<string, Page>;
}): RecoveryResult | null => {
  const usedNames = new Set(
    Object.values(notebooks).map((notebook) =>
      notebook.name.toLocaleLowerCase("zh-CN"),
    ),
  );
  const pagesByWorkspace = new Map<string, Page[]>();

  Object.values(pages).forEach((page) => {
    if (page.localFilePath) return;

    const existing = pagesByWorkspace.get(page.workspaceId) ?? [];
    existing.push(page);
    pagesByWorkspace.set(page.workspaceId, existing);
  });

  const nextNotebooks = { ...notebooks };
  const recoveredNotebookIds: string[] = [];

  Array.from(pagesByWorkspace.entries())
    .sort(([, pagesA], [, pagesB]) => {
      const createdAtA = Math.min(...pagesA.map((page) => page.createdAt));
      const createdAtB = Math.min(...pagesB.map((page) => page.createdAt));
      return createdAtA - createdAtB;
    })
    .forEach(([workspaceId, workspacePages]) => {
      if (nextNotebooks[workspaceId]) return;

      const name = buildUniqueNotebookName(
        resolveRecoveredNotebookName(workspaceId, workspacePages),
        usedNames,
      );

      nextNotebooks[workspaceId] = {
        id: workspaceId,
        name,
        icon: DEFAULT_NOTEBOOK_ICON,
        createdAt: Math.min(...workspacePages.map((page) => page.createdAt)),
        updatedAt: Math.max(...workspacePages.map((page) => page.updatedAt)),
      };
      recoveredNotebookIds.push(workspaceId);
    });

  if (recoveredNotebookIds.length === 0) return null;

  return {
    notebooks: nextNotebooks,
    recoveredCount: recoveredNotebookIds.length,
    recoveredNotebookIds,
  };
};
