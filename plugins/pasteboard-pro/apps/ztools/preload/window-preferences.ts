import type { DockEdge } from "@pasteboard-pro/design-tokens";

import type { ZToolsDocumentDatabase } from "./clipboard-store";
import {
  defaultThemePreferences,
  parseThemePreferences,
  validateThemePreferences,
  type ThemePreferences,
} from "./window-theme-preferences";
import {
  parseSyncedWindowPreferencesValue,
  WindowPreferencesSyncStore,
  type SyncedWindowPreferences,
  type WindowPreferencesStoreOptions,
} from "./window-preferences-sync";

export type { ThemeBackground, ThemePreferences } from "./window-theme-preferences";
export { isThemeColor, isThemeImageDataUrl } from "./window-theme-preferences";
export type { SyncedWindowPreferences } from "./window-preferences-sync";

export type ShelfDockEdge = Exclude<DockEdge, "floating">;
export type MultiPasteMode = "batch" | "queue";

export type WindowPreferences = Readonly<{
  dockEdge: ShelfDockEdge;
  multiPasteMode: MultiPasteMode;
  theme: ThemePreferences;
}>;

export const defaultWindowPreferences: WindowPreferences = {
  dockEdge: "bottom",
  multiPasteMode: "batch",
  theme: defaultThemePreferences,
};

const WINDOW_PREFERENCES_ID = "pasteboard-pro:settings:window";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

function isShelfDockEdge(value: unknown): value is ShelfDockEdge {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

function isMultiPasteMode(value: unknown): value is MultiPasteMode {
  return value === "batch" || value === "queue";
}

function parseWindowPreferences(value: unknown): WindowPreferences | undefined {
  if (!isRecord(value) || !isRecord(value.settings)) return undefined;
  return isShelfDockEdge(value.settings.dockEdge)
    ? {
        dockEdge: value.settings.dockEdge,
        multiPasteMode: isMultiPasteMode(value.settings.multiPasteMode)
          ? value.settings.multiPasteMode
          : defaultWindowPreferences.multiPasteMode,
        theme: parseThemePreferences(value.settings.theme),
      }
    : undefined;
}

export function parseSyncedWindowPreferences(
  value: unknown,
): SyncedWindowPreferences {
  return parseSyncedWindowPreferencesValue(value, parseWindowPreferences);
}

export class ZToolsWindowPreferencesStore {
  private readonly syncStore: WindowPreferencesSyncStore;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    options: WindowPreferencesStoreOptions = {},
  ) {
    this.syncStore = new WindowPreferencesSyncStore(
      database,
      WINDOW_PREFERENCES_ID,
      parseWindowPreferences,
      options,
    );
  }

  async get(): Promise<WindowPreferences> {
    try {
      return (
        parseWindowPreferences(await this.database.get(WINDOW_PREFERENCES_ID)) ??
        structuredClone(defaultWindowPreferences)
      );
    } catch (error) {
      if (isDatabaseStatus(error, 404)) {
        return structuredClone(defaultWindowPreferences);
      }
      throw error;
    }
  }

  async put(settings: WindowPreferences): Promise<void> {
    if (!isShelfDockEdge(settings.dockEdge)) {
      throw new TypeError("Shelf dock edge must be top, bottom, left, or right");
    }
    if (!isMultiPasteMode(settings.multiPasteMode)) {
      throw new TypeError("Multi-paste mode must be batch or queue");
    }
    validateThemePreferences(settings.theme);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(WINDOW_PREFERENCES_ID);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      const sync = this.syncStore.createEntity(current, settings);
      try {
        await this.database.put({
          _id: WINDOW_PREFERENCES_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-window-preferences",
          settings: structuredClone(settings),
          sync,
        });
        return;
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  getSyncEntity(): Promise<SyncedWindowPreferences | undefined> {
    return this.syncStore.get();
  }

  putSynced(entity: SyncedWindowPreferences): Promise<void> {
    return this.syncStore.put(entity);
  }
}
