import type { Page } from "@/types";
import {
  clearPersistedPages,
  saveInternalPage,
  saveLocalPageMeta,
  savePagesMeta,
} from "./pageRepository";
import {
  getDbStorageItem,
  removeDbStorageItem,
  setDbStorageItem,
} from "./utoolsDbStorage";
import { UToolsAdapter } from "../utools";

const LEGACY_PAGES_KEY = "goose-note-storage";
const LEGACY_NOTEBOOKS_KEY = "goose-note-notebooks";
const LEGACY_SETTINGS_KEY = "goose-note-settings";
const LEGACY_MIGRATION_MARK_KEY = "goose-note:storage-migration:v2";
const DEFAULT_NOTEBOOK_ID = "default-notebook";

interface LegacyPersistEnvelope<T> {
  state?: T;
  version?: number;
}

interface LegacyNotebookRecord {
  id: string;
  source?: "default" | "local-folder";
  localPath?: string;
  [key: string]: unknown;
}

interface LegacyNotebooksState {
  notebooks?: Record<string, LegacyNotebookRecord>;
}

export interface LegacyPersistedPagesState {
  pages?: Record<string, Page>;
  onboardingCompleted?: boolean;
}

const readLegacyRaw = (key: string): string | null => {
  const doc = UToolsAdapter.db.get<string>(key);
  if (typeof doc?.data === "string") return doc.data;

  if (!UToolsAdapter.isUTools && typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  return null;
};

const parseLegacyEnvelope = <T>(raw: string | null): LegacyPersistEnvelope<T> | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LegacyPersistEnvelope<T>;
  } catch (error) {
    console.error("[storageMigration] parse legacy storage failed", error);
    return null;
  }
};

const isLegacyMigrated = () => getDbStorageItem(LEGACY_MIGRATION_MARK_KEY) === "1";

const writeLegacyMigrationMark = () => {
  setDbStorageItem(LEGACY_MIGRATION_MARK_KEY, "1");
};

const removeLegacyDoc = (id: string): void => {
  const current = UToolsAdapter.db.get(id);
  if (current) {
    const result = UToolsAdapter.db.remove(id);
    if (result.ok === false) {
      console.error("[storageMigration] remove legacy doc failed", id, result.error);
    }
  }

  if (!UToolsAdapter.isUTools && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(id);
    } catch {
      // ignore local fallback cleanup errors
    }
  }
};

const clearLegacyDocs = () => {
  removeLegacyDoc(LEGACY_PAGES_KEY);
  removeLegacyDoc(LEGACY_NOTEBOOKS_KEY);
  removeLegacyDoc(LEGACY_SETTINGS_KEY);
};

const buildNotebooksPersistPayload = (
  notebooks: Record<string, LegacyNotebookRecord>,
): string => {
  return JSON.stringify({
    state: {
      notebooks,
    },
  });
};

export const migrateLegacyStorage = async (): Promise<void> => {
  if (isLegacyMigrated()) return;

  const legacyPagesRaw = readLegacyRaw(LEGACY_PAGES_KEY);
  const legacyNotebooksRaw = readLegacyRaw(LEGACY_NOTEBOOKS_KEY);
  const legacySettingsRaw = readLegacyRaw(LEGACY_SETTINGS_KEY);

  if (!legacyPagesRaw && !legacyNotebooksRaw && !legacySettingsRaw) {
    writeLegacyMigrationMark();
    return;
  }

  const legacyPagesEnvelope =
    parseLegacyEnvelope<LegacyPersistedPagesState>(legacyPagesRaw);
  const legacyNotebooksEnvelope =
    parseLegacyEnvelope<LegacyNotebooksState>(legacyNotebooksRaw);

  if (legacySettingsRaw) {
    setDbStorageItem(LEGACY_SETTINGS_KEY, legacySettingsRaw);
  }

  const legacyNotebooks = legacyNotebooksEnvelope?.state?.notebooks;
  const migratedPages = legacyPagesEnvelope?.state?.pages ?? {};
  const nextNotebooks: Record<string, LegacyNotebookRecord> = legacyNotebooks
    ? { ...legacyNotebooks }
    : {};

  if (Object.keys(nextNotebooks).length === 0) {
    nextNotebooks[DEFAULT_NOTEBOOK_ID] = {
      id: DEFAULT_NOTEBOOK_ID,
      name: "Note",
      icon: "📓",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  Object.values(migratedPages).forEach((page) => {
    if (nextNotebooks[page.workspaceId]) return;
    nextNotebooks[page.workspaceId] = {
      id: page.workspaceId,
      name: "Note",
      icon: "📓",
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };
  });

  setDbStorageItem(
    LEGACY_NOTEBOOKS_KEY,
    buildNotebooksPersistPayload(nextNotebooks),
  );

  clearPersistedPages();

  Object.values(migratedPages).forEach((page) => {
    const notebook = nextNotebooks[page.workspaceId];
    const isLocalFolderPage =
      notebook?.source === "local-folder" || Boolean(page.localFilePath);

    if (isLocalFolderPage) {
      saveLocalPageMeta({
        id: page.id,
        workspaceId: page.workspaceId,
        updatedAt: page.updatedAt,
        isFavorite: page.isFavorite,
        favoriteOrder: page.favoriteOrder,
        icon: page.icon,
        isPinned: page.isPinned,
        pinnedAt: page.pinnedAt,
      });
      return;
    }

    saveInternalPage(page);
  });

  savePagesMeta({
    onboardingCompleted: Boolean(
      legacyPagesEnvelope?.state?.onboardingCompleted,
    ),
  });

  clearLegacyDocs();
  writeLegacyMigrationMark();
};

export const clearLegacyStorage = (): void => {
  clearLegacyDocs();
  removeDbStorageItem(LEGACY_MIGRATION_MARK_KEY);
};
