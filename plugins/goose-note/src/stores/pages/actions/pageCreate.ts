import { v4 as uuidv4 } from "uuid";
import type { Page, JSONContent } from "@/types";
import { useNotebooks, DEFAULT_NOTEBOOK } from "../../useNotebooks";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import {
  ONBOARDING_PAGE_CONTENT,
  ONBOARDING_CHILD_PAGE_CONTENT,
  ONBOARDING_SECOND_CHILD_CONTENT,
} from "@/lib/onboarding";
import {
  clonePageContent as cloneBlockNotePageContent,
  createEmptyBlockNoteContent,
  createEmptyLocalPageContent,
  normalizePageContent,
} from "@/components/editor/utils/blocknote-content";
import { savePagesMeta } from "@/lib/storage/pageRepository";
import { buildLocalPageId } from "@/lib/local-folder-scanner";
import {
  readLocalPageIdMap,
  resolveOrCreateStableId,
  toRelativePath,
  writeLocalPageIdMap,
} from "@/lib/local-page-idmap";

import type { PagesState } from "../types";
import { persistPageSnapshot, persistPageSnapshots, syncLocalPageMetadataCache } from "../persistence";
import type { StoreSet, StoreGet } from "./hydrate";
import { flushEditorContent } from "./flushEditor";
import { requestPageTitleFocus } from "@/lib/page-title-focus";
import { useSettings } from "@/stores/useSettings";
import { UNTITLED_PAGE_TITLE } from "@/components/editor/utils/page-title";

const initialContent: JSONContent = createEmptyBlockNoteContent(
  UNTITLED_PAGE_TITLE,
);

/**
 * 新建页聚焦策略：
 * - 单标签：页头 SingleTabTitle 响应 requestPageTitleFocus
 * - 多标签 + 本地文件：正文上方 LocalFileTitle 响应 requestPageTitleFocus
 * - 多标签 + 内部页：focus-editor-start 把光标放到首块 H1 标题末尾
 */
function focusNewPage(pageId: string) {
  requestPageTitleFocus(pageId);
  if (useSettings.getState().singleTabMode) {
    return;
  }
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("goose-note:focus-editor-start"));
    }, 100);
  }
}

export function createDefaultPageContent(
  title = UNTITLED_PAGE_TITLE,
): JSONContent {
  return createEmptyBlockNoteContent(title);
}

export function clonePageContent(content?: JSONContent | null) {
  if (!content) {
    return cloneBlockNotePageContent(initialContent);
  }
  return cloneBlockNotePageContent(normalizePageContent(content));
}

// local-folder 页面标题由文件名（LocalFileTitle）承担，内容不存在
// 「首块必须是 H1」的约束，克隆时禁止 ensureFirstTitleHeading 注入空标题块。
export function cloneLocalPageContent(content?: JSONContent | null) {
  if (!content) {
    return cloneBlockNotePageContent(createEmptyLocalPageContent());
  }
  return cloneBlockNotePageContent(
    normalizePageContent(content, { ensureFirstTitle: false }),
  );
}

function generateLocalPageId(notebookId: string, filePath: string): string {
  const notebook = useNotebooks.getState().notebooks[notebookId];
  if (!notebook?.localPath) return uuidv4();
  const basePath = notebook.localPath;
  const relativePath = toRelativePath(basePath, filePath);
  const map = readLocalPageIdMap(notebookId);
  const { id, dirty } = resolveOrCreateStableId(notebookId, relativePath, map);
  if (dirty) {
    writeLocalPageIdMap(notebookId, map);
  }
  return id;
}

export const createOnboardingPagesAction = (set: StoreSet, get: StoreGet) => {
  let createdMainId: string | null = null;
  const workspaceId = DEFAULT_NOTEBOOK;

  set((state) => {
    const hasExistingOnboardingPage = Object.values(state.pages).some(
      (page) =>
        page.workspaceId === workspaceId &&
        !page.trashedAt &&
        extractTitleFromContent(page.content) === "鹅的笔记 · 新手指南",
    );

    if (state.onboardingCompleted || hasExistingOnboardingPage) {
      if (state.onboardingCompleted) return state;
      return { ...state, onboardingCompleted: true };
    }

    const mainId = uuidv4();
    const childId1 = uuidv4();
    const childId2 = uuidv4();
    const now = Date.now();

    createdMainId = mainId;

    const mainPage: Page = {
      id: mainId,
      workspaceId,
      parentId: undefined,
      content: ONBOARDING_PAGE_CONTENT,
      isFolder: false,
      isLocked: false,
      fontSize: "default",
      fontFamily: "default",
      createdAt: now,
      updatedAt: now,
      order: now,
    };

    const childPage1: Page = {
      id: childId1,
      workspaceId,
      parentId: mainId,
      content: ONBOARDING_CHILD_PAGE_CONTENT,
      isFolder: false,
      isLocked: false,
      fontSize: "default",
      fontFamily: "default",
      createdAt: now + 1,
      updatedAt: now + 1,
      order: now + 1,
    };

    const childPage2: Page = {
      id: childId2,
      workspaceId,
      parentId: mainId,
      content: ONBOARDING_SECOND_CHILD_CONTENT,
      isFolder: false,
      isLocked: false,
      fontSize: "default",
      fontFamily: "default",
      createdAt: now + 2,
      updatedAt: now + 2,
      order: now + 2,
    };

    return {
      ...state,
      pages: {
        ...state.pages,
        [mainId]: mainPage,
        [childId1]: childPage1,
        [childId2]: childPage2,
      },
      activePageId: mainId,
      onboardingCompleted: true,
      expandPageId: mainId,
    };
  });

  if (createdMainId) {
    useNotebooks.getState().setActiveNotebook(workspaceId);
    useNotebooks.getState().setLastActivePage(workspaceId, createdMainId);
    const currentPages = get().pages;
    persistPageSnapshots(currentPages, [createdMainId]);
    Object.values(currentPages)
      .filter((page) => page.parentId === createdMainId)
      .forEach((page) => persistPageSnapshot(page));
  }
  savePagesMeta({ onboardingCompleted: true });
};

export const createPageAction = (
  set: StoreSet,
  get: StoreGet,
  parentId?: string,
  workspaceId = DEFAULT_NOTEBOOK,
  id?: string,
): string => {
  flushEditorContent();

  const finalId = get().createPageRecord({
    workspaceId,
    parentId,
    id,
  });
  set({ activePageId: finalId });
  useNotebooks.getState().setLastActivePage(workspaceId, finalId);
  focusNewPage(finalId);

  return finalId;
};

export const createPageRecordAction = (
  set: StoreSet,
  get: StoreGet,
  options: {
    workspaceId: string;
    parentId?: string;
    id?: string;
  } & Partial<Page>,
): string => {
  const { workspaceId, parentId, id, content, ...extra } = options;
  const finalId = id || uuidv4();
  const now = Date.now();
  const newPage: Page = {
    id: finalId,
    workspaceId,
    parentId,
    content: clonePageContent(content),
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: now,
    updatedAt: now,
    order: now,
    ...extra,
  };

  set((state) => ({
    pages: { ...state.pages, [finalId]: newPage },
  }));

  persistPageSnapshot(get().pages[finalId]);
  return finalId;
};

export const createLocalPageAction = async (
  set: StoreSet,
  get: StoreGet,
  parentId?: string,
  workspaceId?: string,
): Promise<string | null> => {
  if (!workspaceId) return null;
  const id = await get().createLocalPageRecord({
    workspaceId,
    parentId,
    title: UNTITLED_PAGE_TITLE,
    content: createEmptyLocalPageContent(),
  });
  if (!id) return null;
  set({ activePageId: id });
  useNotebooks.getState().setLastActivePage(workspaceId, id);
  focusNewPage(id);

  return id;
};

export const createLocalPageRecordAction = async (
  set: StoreSet,
  get: StoreGet,
  { workspaceId, parentId, title, content }: {
    workspaceId: string;
    parentId?: string;
    title?: string;
    content?: JSONContent;
  },
): Promise<string | null> => {
  const notebook = useNotebooks.getState().notebooks[workspaceId];
  if (
    !notebook?.localPath ||
    typeof window === "undefined" ||
    !window.gooseFs
  ) {
    return null;
  }

  const resolveParentPath = () => {
    if (!parentId) return null;
    const parentPage = get().pages[parentId];
    // 优先从 page.localFilePath 取路径（稳定 id 后，路径永远在 localFilePath 字段）。
    if (parentPage?.localFilePath) return parentPage.localFilePath;
    // 兜底：页面不在 store 时，尝试从旧格式 id（local-{nb}-{encoded}）反解。
    // 注意：稳定 id 后 id 不再必然等于路径编码，此兜底仅供迁移过渡期使用。
    const prefix = `local-${workspaceId}-`;
    if (!parentId.startsWith(prefix)) return null;
    const encoded = parentId.slice(prefix.length);
    try {
      const relativePath = decodeURIComponent(encoded);
      return `${notebook.localPath}/${relativePath}`;
    } catch {
      return null;
    }
  };

  const now = Date.now();
  const normalizedTitle = (
    (title || UNTITLED_PAGE_TITLE).trim() || UNTITLED_PAGE_TITLE
  ).replace(/[\\/:*?"<>|]/g, "_");
  const parentPath = resolveParentPath();
  const parentPage = parentId ? get().pages[parentId] : undefined;
  const storedParentId =
    parentPage?.localFilePath && !parentPage.isFolder
      ? parentPage.parentId
      : parentId;
  const baseDir = parentPath
    ? parentPage?.isFolder
      ? parentPath
      : parentPath.replace(/[^\/\\]+$/, "")
    : notebook.localPath;
  const normalizedBaseDir = baseDir.replace(/[\/\\]$/, "");
  let filePath = `${normalizedBaseDir}/${normalizedTitle}.md`;

  const checkExists = async (path: string) => {
    if (window.gooseFs?.existsAsync) {
      return await window.gooseFs.existsAsync(path);
    }
    return window.gooseFs?.exists(path) ?? false;
  };

  if (await checkExists(filePath)) {
    let suffix = 1;
    while (
      await checkExists(`${normalizedBaseDir}/${normalizedTitle} (${suffix}).md`)
    ) {
      suffix++;
    }
    filePath = `${normalizedBaseDir}/${normalizedTitle} (${suffix}).md`;
  }

  if (window.gooseFs.writeFileAsync) {
    const ok = await window.gooseFs.writeFileAsync(filePath, ``);
    if (!ok) return null;
  } else {
    if (!window.gooseFs.writeFile(filePath, ``)) {
      return null;
    }
  }

  const id = generateLocalPageId(workspaceId, filePath);
  const newPage: Page = {
    id,
    workspaceId,
    parentId: storedParentId,
    content: cloneLocalPageContent(content),
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    localFilePath: filePath,
    createdAt: now,
    updatedAt: now,
    order: now,
  };

  set((state) => ({
    pages: { ...state.pages, [id]: newPage },
  }));

  syncLocalPageMetadataCache(id, null);
  const saved = await get().saveLocalPageContent(id, cloneLocalPageContent(newPage.content));
  if (!saved) {
    set((state) => {
      const nextPages = { ...state.pages };
      delete nextPages[id];
      return { pages: nextPages };
    });
    return null;
  }

  return id;
};

export const createLocalFolderRecordAction = async (
  set: StoreSet,
  get: StoreGet,
  { workspaceId, parentId, title }: {
    workspaceId: string;
    parentId?: string;
    title?: string;
  },
): Promise<string | null> => {
  const notebook = useNotebooks.getState().notebooks[workspaceId];
  if (
    !notebook?.localPath ||
    typeof window === "undefined" ||
    !window.gooseFs
  ) {
    return null;
  }

  const parentPage = parentId ? get().pages[parentId] : undefined;
  const baseDir =
    parentPage?.localFilePath && parentPage.isFolder
      ? parentPage.localFilePath
      : notebook.localPath;
  const normalizedBaseDir = baseDir.replace(/[\/\\]$/, "");
  const normalizedTitle =
    ((title || "新建文件夹").trim() || "新建文件夹").replace(/[\\/:*?"<>|]/g, "_");
  const folderPath = `${normalizedBaseDir}/${normalizedTitle}`;

  const exists = window.gooseFs.existsAsync
    ? await window.gooseFs.existsAsync(folderPath)
    : window.gooseFs.exists(folderPath);
  if (exists) return null;

  const created = window.gooseFs.mkdir
    ? await Promise.resolve(window.gooseFs.mkdir(folderPath))
    : false;
  if (!created) return null;

  const id = generateLocalPageId(workspaceId, folderPath);
  const now = Date.now();
  const newPage: Page = {
    id,
    workspaceId,
    parentId: parentPage?.isFolder ? parentId : undefined,
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: normalizedTitle }],
        },
      ],
    },
    isFolder: true,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    localFilePath: folderPath,
    createdAt: now,
    updatedAt: now,
    order: now,
  };

  set((state) => ({
    pages: { ...state.pages, [id]: newPage },
  }));

  syncLocalPageMetadataCache(id, null);
  return id;
};

export const duplicatePageAction = (
  set: StoreSet,
  get: StoreGet,
  id: string,
): string => {
  flushEditorContent();

  const sourcePage = get().pages[id];
  const notebook = sourcePage
    ? useNotebooks.getState().notebooks[sourcePage.workspaceId]
    : undefined;
  if (notebook?.source === "local-folder") {
    return id;
  }

  let newId = "";
  set((state) => {
    const page = state.pages[id];
    if (!page) return state;

    newId = uuidv4();
    const now = Date.now();

    const clonedContent = structuredClone(page.content);
    if (
      clonedContent.content?.[0]?.type === "heading" &&
      clonedContent.content[0].attrs?.level === 1
    ) {
      const titleNode = clonedContent.content[0];
      const titleText = extractTitleFromContent(page.content);
      titleNode.content = [{ type: "text", text: `${titleText}_副本` }];
    }

    const newPage: Page = {
      ...page,
      id: newId,
      content: clonedContent,
      updatedAt: now,
      createdAt: now,
      trashedAt: undefined,
      isFavorite: false,
      isPinned: false,
      pinnedAt: undefined,
      order: now,
    };

    return {
      pages: {
        ...state.pages,
        [newId]: newPage,
      },
    };
  });
  persistPageSnapshot(get().pages[newId]);
  return newId;
};
