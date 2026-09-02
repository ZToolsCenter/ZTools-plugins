import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  mirrorHostHistory,
  ZToolsCanonicalClipboardStore,
  type HostClipboardApi,
  type ZToolsDocumentDatabase,
} from "./clipboard-store";
import {
  clipboardWindowRole,
  ownsClipboardHistoryMirror,
} from "./clipboard-window-role";
import { ensureZToolsAutoStart } from "./auto-start";
import type { PasteStackState } from "@pasteboard-pro/core";
import { createOcrClient, createTesseractOcrClient } from "./ocr";
import { NativeFileDragService } from "./native-file-drag";
import {
  inspectHostCompatibility,
  type ZToolsHostCompatibility,
} from "./host-compatibility";
import { migratePasteboardProPluginData } from "./plugin-data-migration";
import { resolvePasteboardProDataPaths } from "./plugin-data";
import {
  importScreenCapture,
  type ScreenCaptureImportResult,
  type ScreenshotNativeImageApi,
} from "./screenshot-import";
import { localizeMirroredImage } from "./mirrored-image";
import { openQuickLook } from "./quick-look";
import { rotateImageFile } from "./image-rotation";
import {
  createKeychainSecretStore,
  createPortableSecretStore,
  type SafeStorageLike,
} from "./keychain";
import {
  copyCanonicalRecord,
  pasteCanonicalRecord,
  withRichClipboard,
} from "./paste-item";
import {
  isCapturePaused,
  performDirectPaste,
  shouldPersistClipboard,
  ZToolsPrivacySettingsStore,
  type CapturePauseState,
  type ClipboardPasteHost,
  type ClipboardPrivacyInput,
  type ClipboardWriteContent,
  type DirectPasteResult,
  type PrivacySettings,
} from "./privacy";
import { ZToolsPinboardStore } from "./pinboard-store";
import {
  createZToolsGlobalPasteHook,
  PasteStackRuntime,
  type ClipboardWriter,
} from "./paste-stack-runtime";
import {
  normalizePasteStackState,
  ZToolsPasteStackStore,
} from "./paste-stack-store";
import { executeRetentionPrune } from "./retention";
import { ZToolsListOrderStore, type ListOrders } from "./list-order-store";
import { loadThemeBackgroundImage } from "./theme-background";
import {
  clearClipboardHistory as clearStoredClipboardHistory,
  type ClearClipboardHistoryResult,
} from "./clear-history";
import { runConfiguredVaultSync } from "./sync-controller";
import {
  saveSyncConfiguration,
  type SaveSyncConfigurationInput,
} from "./sync-config";
import { ZToolsSyncStore, type SyncSettings } from "./sync-store";
import { ZToolsSyncEntityRepository } from "./sync-repository";
import { createSearchHistoryHandler } from "./tools";
import {
  ThumbnailService,
  type ItemThumbnail,
  type NativeImageApi,
} from "./thumbnail";
import {
  ZToolsWindowPreferencesStore,
  type ShelfDockEdge,
  type WindowPreferences,
} from "./window-preferences";
import {
  PanelWindowManager,
  ShelfWindowManager,
  type AuxiliaryPanel,
  type BrowserWindowHandle,
  type BrowserWindowOptions,
  type PanelRequest,
  type ShelfDisplay,
} from "./window";

type IpcRendererLike = Readonly<{
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}>;

const { clipboard, ipcRenderer, nativeImage, safeStorage } = require("electron") as {
  clipboard: ClipboardWriter & Readonly<{ clear(): void }>;
  ipcRenderer: IpcRendererLike;
  nativeImage: NativeImageApi;
  safeStorage?: SafeStorageLike;
};

type ZToolsDisplay = Readonly<{
  id: string | number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  workArea: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

type ZToolsHost = Readonly<{
  getAppVersion?(): unknown;
  getPath?(name: string): unknown;
  onPluginEnter(callback: (parameter: unknown) => void): void;
  registerTool(
    name: string,
    handler: (input?: unknown) => Promise<unknown>,
  ): void;
  getNativeId(): string;
  startDrag?(file: string | string[]): void;
  screenCapture?(
    callback: (image: unknown, bounds?: unknown) => void,
    autoConfirm?: boolean,
  ): void | Promise<unknown>;
  clipboard: HostClipboardApi &
    ClipboardPasteHost &
    Readonly<{
      onChange(callback: () => void): void;
    }>;
  db: Readonly<{
    promises: ZToolsDocumentDatabase;
  }>;
  setSubInput?(callback: (details: unknown) => void, placeholder: string): void;
  getCursorScreenPoint(): Readonly<{ x: number; y: number }>;
  getDisplayNearestPoint(point: Readonly<{ x: number; y: number }>): ZToolsDisplay;
  createBrowserWindow(
    url: string,
    options: BrowserWindowOptions,
    onReady?: () => void,
  ): BrowserWindowHandle;
  hideMainWindow(restorePreviousWindow?: boolean): void;
  outPlugin(): void;
  simulateKeyboardTap?(key: string, ...modifiers: string[]): unknown;
  sendToParent?(channel: string, ...args: unknown[]): void;
  showOpenDialog?(options: Readonly<{
    properties: readonly ["openFile"];
    filters: readonly Readonly<{ name: string; extensions: readonly string[] }>[];
  }>): string[] | undefined | Promise<string[] | undefined>;
}>;

type PasteboardProBridge = Readonly<{
  getHostCompatibility(): ZToolsHostCompatibility;
  getPlatformCapabilities(): Readonly<{
    platform: NodeJS.Platform;
    supportsGlobalPasteQueue: boolean;
    supportsQuickLook: boolean;
    supportsSystemOcr: boolean;
    supportsImageRotation: boolean;
    supportsNativeFileDrag: boolean;
    supportsScreenCapture: boolean;
  }>;
  captureScreenshot(): Promise<ScreenCaptureImportResult>;
  searchHistory(query?: string, limit?: number): Promise<Readonly<{ items: unknown[]; total: number }>>;
  getPrivacySettings(): Promise<PrivacySettings>;
  savePrivacySettings(settings: PrivacySettings): Promise<PrivacySettings>;
  setCapturePause(pause: CapturePauseState): Promise<PrivacySettings>;
  pasteHostItem(hostItemId: string): Promise<DirectPasteResult>;
  pasteContent(content: ClipboardWriteContent): Promise<DirectPasteResult>;
  pasteItem(itemId: string, plainText?: boolean): Promise<DirectPasteResult>;
  copyItem(itemId: string, plainText?: boolean): Promise<void>;
  createTextItem(text: string, title?: string, pinboardId?: string): Promise<unknown>;
  updateTextItem(itemId: string, text: string, title?: string): Promise<unknown>;
  updateItemTitle(itemId: string, title: string): Promise<unknown>;
  listPinboards(): Promise<unknown[]>;
  createPinboard(name: string, color: string): Promise<unknown>;
  renamePinboard(id: string, name: string): Promise<unknown>;
  updatePinboardColor(id: string, color: string): Promise<unknown>;
  movePinboard(
    id: string,
    beforeId?: string,
    afterId?: string,
  ): Promise<unknown>;
  deletePinboard(
    id: string,
  ): Promise<Readonly<{ id: string; unassignedItems: number }>>;
  assignItemsToPinboard(
    itemIds: readonly string[],
    pinboardId: string | undefined,
  ): Promise<unknown[]>;
  getItemPreview(itemId: string): Promise<Readonly<{ mediaType: string; dataBase64: string }> | null>;
  getItemThumbnails(itemIds: readonly string[]): Promise<ItemThumbnail[]>;
  prepareNativeFileDrag(itemId: string): Promise<boolean>;
  startNativeFileDrag(itemId: string): boolean;
  recognizeItem(itemId: string): Promise<string>;
  rotateImage(itemId: string, quarterTurns: -1 | 1): Promise<unknown>;
  quickLookItem(itemId: string): Promise<void>;
  getSyncSettings(): Promise<SyncSettings>;
  saveSyncSettings(input: SaveSyncConfigurationInput): Promise<SyncSettings>;
  retrySync(): Promise<SyncSettings>;
  getWindowPreferences(): Promise<WindowPreferences>;
  saveWindowPreferences(settings: WindowPreferences): Promise<WindowPreferences>;
  selectThemeBackgroundImage(): Promise<string | undefined>;
  clearClipboardHistory(): Promise<ClearClipboardHistoryResult>;
  getListOrders(): Promise<ListOrders>;
  saveListOrder(scope: string, itemIds: readonly string[]): Promise<ListOrders>;
  getPasteStack(): Promise<PasteStackState>;
  savePasteStack(state: PasteStackState): Promise<PasteStackState>;
  openPanel(panel: AuxiliaryPanel, params?: Readonly<Record<string, string>>): void;
}>;

const host = (window as Window & { ztools?: ZToolsHost }).ztools;

if (host === undefined) {
  throw new Error("PasteboardPro must run inside ZTools");
}

const ztools: ZToolsHost = host;
const hostCompatibility = inspectHostCompatibility(ztools);
const platformCapabilities = {
  platform: process.platform,
  supportsGlobalPasteQueue: process.platform === "darwin",
  supportsQuickLook:
    process.platform === "darwin" ||
    process.platform === "win32" ||
    process.platform === "linux",
  supportsSystemOcr: true,
  supportsImageRotation:
    process.platform === "darwin" ||
    process.platform === "win32" ||
    process.platform === "linux",
  supportsNativeFileDrag: hostCompatibility.supportsNativeFileDrag,
  supportsScreenCapture: hostCompatibility.supportsScreenCapture,
} as const;

if (!hostCompatibility.supported) {
  const compatibilityBridge = {
    getHostCompatibility: () => hostCompatibility,
    getPlatformCapabilities: () => platformCapabilities,
  } as PasteboardProBridge;
  (window as Window & { pasteboardPro?: PasteboardProBridge }).pasteboardPro =
    compatibilityBridge;
} else {
const windowParams = new URLSearchParams(window.location.search);
const windowRole = clipboardWindowRole(windowParams);
const isShelfWindow = windowRole === "shelf";
const isPanelWindow = windowRole === "panel";
const isPrimaryWindow = windowRole === "primary";
const dataPaths = resolvePasteboardProDataPaths(ztools);
const dataMigration = isPrimaryWindow
  ? migratePasteboardProPluginData(ztools.db.promises, dataPaths)
  : Promise.resolve();
dataMigration.catch((error) => console.error("[pasteboard-pro] pluginData migration failed", error));
const store = new ZToolsCanonicalClipboardStore(ztools.db.promises, {
  deviceId: ztools.getNativeId(),
  ready: dataMigration,
});
const privacyStore = new ZToolsPrivacySettingsStore(ztools.db.promises);
const windowPreferencesStore = new ZToolsWindowPreferencesStore(ztools.db.promises, {
  deviceId: ztools.getNativeId(),
});
const listOrderStore = new ZToolsListOrderStore(ztools.db.promises);
const pasteStackStore = new ZToolsPasteStackStore(ztools.db.promises);
const pinboardStore = new ZToolsPinboardStore(ztools.db.promises, {
  deviceId: ztools.getNativeId(),
});
const syncStore = new ZToolsSyncStore(ztools.db.promises);
const keychain =
  process.platform === "darwin"
    ? createKeychainSecretStore()
    : safeStorage === undefined
      ? {
          save: async () => {
            throw new Error("当前平台没有可用的系统安全存储，无法保存同步密码");
          },
          load: async () => {
            throw new Error("当前平台没有可用的系统安全存储，无法读取同步密码");
          },
          delete: async () => undefined,
        }
      : createPortableSecretStore({
          database: ztools.db.promises,
          safeStorage,
        });
const syncRepository = new ZToolsSyncEntityRepository(
  ztools.db.promises,
  ztools.getNativeId(),
  dataPaths.blobRoot,
  dataPaths.legacyBlobRoots,
  dataMigration,
);
const shelfWindows = new ShelfWindowManager(ztools);
const panelWindows = new PanelWindowManager(ztools);
const thumbnailService = new ThumbnailService(store, nativeImage);
const nativeFileDragService = new NativeFileDragService(store, ztools);
const ocrClient =
  process.platform === "darwin"
    ? createOcrClient({
        helperPath: path.join(__dirname, "pasteboard-vision"),
      })
    : createTesseractOcrClient({ platform: process.platform });
let synchronization = Promise.resolve();
let vaultSynchronization: Promise<SyncSettings> | undefined;
let vaultSyncRequested = false;
let shelfActivation = Promise.resolve();
let shelfRefreshTimer: number | undefined;
let lastRetentionRun = 0;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const PANEL_REQUEST_CHANNEL = "pasteboard-pro:open-panel";
const SCREEN_PROTECTION_CHANNEL = "pasteboard-pro:set-screen-protection";
const SHELF_EDGE_CHANNEL = "pasteboard-pro:set-shelf-edge";
const HISTORY_CHANGED_CHANNEL = "pasteboard-pro:history-changed";
const WINDOW_PREFERENCES_CHANGED_CHANNEL = "pasteboard-pro:window-preferences-changed";
const PASTE_STACK_CHANGED_CHANNEL = "pasteboard-pro:paste-stack-changed";

const canonicalClipboardHost = withRichClipboard(ztools.clipboard, {
  write: (data) => clipboard.write(data),
  leavePlugin: () => ztools.outPlugin(),
  simulatePaste: () => {
    if (ztools.simulateKeyboardTap === undefined) {
      throw new Error("当前 ZTools 版本不支持模拟粘贴");
    }
    return ztools.simulateKeyboardTap(
      "v",
      process.platform === "darwin" ? "meta" : "ctrl",
    );
  },
  waitForTarget: () => new Promise((resolve) => globalThis.setTimeout(resolve, 20)),
});

const pasteStackRuntime = isPrimaryWindow
  ? new PasteStackRuntime(
      pasteStackStore,
      store,
      clipboard,
      nativeImage,
      createZToolsGlobalPasteHook({
        simulatePaste: () => ztools.simulateKeyboardTap?.("v", "meta"),
      }),
      (state) => shelfWindows.notifyPasteStackChanged(state),
    )
  : undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function privacyInput(
  rawItem: unknown,
  text: string | undefined,
): ClipboardPrivacyInput {
  if (!isRecord(rawItem)) {
    return text === undefined ? {} : { text };
  }
  const sourceBundleId =
    typeof rawItem.appBundleId === "string"
      ? rawItem.appBundleId
      : typeof rawItem.bundleId === "string"
        ? rawItem.bundleId
        : undefined;
  return {
    ...(sourceBundleId === undefined ? {} : { sourceBundleId }),
    ...(text === undefined ? {} : { text }),
    ...(rawItem.transient === true || rawItem.isTransient === true
      ? { transient: true }
      : {}),
    ...(rawItem.confidential === true || rawItem.isConfidential === true
      ? { confidential: true }
      : {}),
  };
}

function activeDisplay(): ShelfDisplay {
  const display = ztools.getDisplayNearestPoint(ztools.getCursorScreenPoint());
  return { id: display.id, workArea: { ...display.workArea } };
}

function applyShelfContentProtection(enabled: boolean): void {
  if (isPrimaryWindow) {
    shelfWindows.setContentProtection(enabled);
    return;
  }
  if (ztools.sendToParent !== undefined) {
    ztools.sendToParent(SCREEN_PROTECTION_CHANNEL, enabled);
    return;
  }
  shelfWindows.setContentProtection(enabled);
}

function isShelfDockEdge(value: unknown): value is ShelfDockEdge {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

function parsedPanelRequest(value: unknown): PanelRequest | undefined {
  if (!isRecord(value)) return undefined;
  const panel = value.panel;
  if (
    panel !== "privacy" &&
    panel !== "sync" &&
    panel !== "preview" &&
    panel !== "editor"
  ) return undefined;
  if (value.params === undefined) return { panel };
  if (
    !isRecord(value.params) ||
    !Object.values(value.params).every((entry) => typeof entry === "string")
  ) return undefined;
  return { panel, params: value.params as Record<string, string> };
}

async function repositionShelf(edge: ShelfDockEdge): Promise<void> {
  const privacy = await privacyStore.get();
  shelfWindows.open(activeDisplay(), {
    edge,
    contentProtection: privacy.screenShareProtection,
  });
}

function requestShelfEdge(edge: ShelfDockEdge): void {
  if (isPrimaryWindow) {
    void repositionShelf(edge).catch(reportSynchronizationError);
    return;
  }
  if (ztools.sendToParent !== undefined) {
    ztools.sendToParent(SHELF_EDGE_CHANNEL, edge);
  }
}

function broadcastHistoryChanged(): void {
  thumbnailService.invalidateRecordIndex();
  window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_CHANNEL));
  if (isPrimaryWindow) {
    shelfWindows.notifyHistoryChanged();
    return;
  }
  ztools.sendToParent?.(HISTORY_CHANGED_CHANNEL);
}

function broadcastWindowPreferencesChanged(): void {
  window.dispatchEvent(new CustomEvent(WINDOW_PREFERENCES_CHANGED_CHANNEL));
  if (isPrimaryWindow) {
    shelfWindows.notifyWindowPreferencesChanged();
    return;
  }
  ztools.sendToParent?.(WINDOW_PREFERENCES_CHANGED_CHANNEL);
}

function reportSynchronizationError(error: unknown): void {
  window.dispatchEvent(
    new CustomEvent("pasteboard-pro:sync-error", {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}

function scheduleVaultSync(): Promise<SyncSettings> {
  vaultSyncRequested = true;
  if (vaultSynchronization !== undefined) return vaultSynchronization;
  vaultSynchronization = (async () => {
    let settings = await syncStore.getSettings();
    do {
      vaultSyncRequested = false;
      settings = await runConfiguredVaultSync({
        store: syncStore,
        keychain,
        repository: syncRepository,
      });
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:vault-synced", { detail: settings }),
      );
      broadcastHistoryChanged();
    } while (vaultSyncRequested);
    return settings;
  })().finally(() => {
    vaultSynchronization = undefined;
  });
  return vaultSynchronization;
}

async function runRetentionIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionRun < RETENTION_INTERVAL_MS) {
    return;
  }
  try {
    const settings = await privacyStore.get();
    const result = await executeRetentionPrune(store, {
      days: settings.retention.days,
      maxBlobBytes: settings.retention.maxBlobBytes,
      now,
    }, {
      delete: (input) => syncRepository.deleteLocalBlob(input),
    });
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:retention-completed", { detail: result }),
    );
    lastRetentionRun = now;
  } catch (error) {
    lastRetentionRun = now - RETENTION_INTERVAL_MS + 5 * 60 * 1_000;
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:retention-error", {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function scheduleHistoryMirror(): Promise<void> {
  const nextSynchronization = synchronization
    .then(async () => {
      const privacy = await privacyStore.get();
      const result = await mirrorHostHistory(ztools.clipboard, store, {
        deviceId: ztools.getNativeId(),
        pageSize: 100,
        shouldPersist: (rawItem, record) =>
          !isCapturePaused(privacy.pause) &&
          shouldPersistClipboard(
            privacyInput(rawItem, record.item.payload.text),
            privacy.rules,
          ),
        prepareRecord: async (_rawItem, record) => {
          try {
            return await localizeMirroredImage(record, {
              readFile,
              storeLocalBlob: (bytes, mediaType) =>
                syncRepository.storeLocalBlob(bytes, mediaType),
            });
          } catch {
            return record;
          }
        },
      });
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:history-mirrored", { detail: result }),
      );
      await runRetentionIfDue();
      broadcastHistoryChanged();
      void scheduleVaultSync().catch(reportSynchronizationError);
    });
  synchronization = nextSynchronization.catch(reportSynchronizationError);
  return nextSynchronization;
}

if (ownsClipboardHistoryMirror(windowRole)) {
  void ensureZToolsAutoStart(ipcRenderer).catch((error: unknown) => {
    console.warn("Paste剪切板自动启动登记失败", error);
  });

  ipcRenderer.on(PANEL_REQUEST_CHANNEL, (_event, value) => {
    const request = parsedPanelRequest(value);
    if (request !== undefined) panelWindows.open(activeDisplay(), request);
  });
  ipcRenderer.on(SCREEN_PROTECTION_CHANNEL, (_event, enabled) => {
    if (typeof enabled === "boolean") {
      shelfWindows.setContentProtection(enabled);
    }
  });
  ipcRenderer.on(SHELF_EDGE_CHANNEL, (_event, edge) => {
    if (isShelfDockEdge(edge)) {
      void repositionShelf(edge).catch(reportSynchronizationError);
    }
  });
  ipcRenderer.on(HISTORY_CHANGED_CHANNEL, () => {
    shelfWindows.notifyHistoryChanged();
  });
  ipcRenderer.on(WINDOW_PREFERENCES_CHANGED_CHANNEL, () => {
    shelfWindows.notifyWindowPreferencesChanged();
  });
  ipcRenderer.on(PASTE_STACK_CHANGED_CHANNEL, (_event, value) => {
    void pasteStackRuntime
      ?.replace(normalizePasteStackState(value), false)
      .catch(reportSynchronizationError);
  });
  void pasteStackRuntime
    ?.initialize()
    .catch(reportSynchronizationError);

  ztools.onPluginEnter((parameter) => {
    ztools.hideMainWindow(false);
    pasteStackRuntime?.retryGlobalHook();
    window.dispatchEvent(
      new CustomEvent("pasteboard-pro:host-enter", { detail: parameter }),
    );
    scheduleHistoryMirror();
    shelfActivation = shelfActivation
      .then(async () => {
        const [settings, windowPreferences] = await Promise.all([
          privacyStore.get(),
          windowPreferencesStore.get(),
        ]);
        shelfWindows.toggle(activeDisplay(), {
          edge: windowPreferences.dockEdge,
          contentProtection: settings.screenShareProtection,
        });
        ztools.outPlugin();
      })
      .catch(reportSynchronizationError);
  });

  ztools.clipboard.onChange(scheduleHistoryMirror);
  scheduleHistoryMirror();

  ztools.setSubInput?.(
    (details) => {
      window.dispatchEvent(
        new CustomEvent("pasteboard-pro:host-search", { detail: details }),
      );
    },
    "搜索剪贴板历史",
  );
} else if (isShelfWindow) {
  ztools.clipboard.onChange(() => {
    thumbnailService.invalidateRecordIndex();
    if (shelfRefreshTimer !== undefined) {
      window.clearTimeout(shelfRefreshTimer);
    }
    shelfRefreshTimer = window.setTimeout(() => {
      shelfRefreshTimer = undefined;
      window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed"));
    }, 250);
  });
}

if (isPrimaryWindow) {
  ztools.registerTool("search_history", createSearchHistoryHandler(store));
}

const bridge: PasteboardProBridge = {
  getHostCompatibility: () => hostCompatibility,
  getPlatformCapabilities: () => platformCapabilities,
  captureScreenshot: () =>
    importScreenCapture(
      ztools,
      nativeImage as NativeImageApi & ScreenshotNativeImageApi,
      clipboard,
      {
        canImport: async () => {
          const privacy = await privacyStore.get();
          return !isCapturePaused(privacy.pause);
        },
      },
    ),
  async searchHistory(query = "", limit = 1_000) {
    const normalizedLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
    const [result, records] = await Promise.all([
      store.search(query, normalizedLimit),
      store.listRecords(),
    ]);
    nativeFileDragService.refresh(records);
    return result;
  },
  getPrivacySettings: () => privacyStore.get(),
  async savePrivacySettings(settings) {
    await privacyStore.put(settings);
    applyShelfContentProtection(settings.screenShareProtection);
    return privacyStore.get();
  },
  async setCapturePause(pause) {
    const current = await privacyStore.get();
    const updated = { ...current, pause };
    await privacyStore.put(updated);
    return updated;
  },
  pasteHostItem: (hostItemId) =>
    performDirectPaste({ type: "host", hostItemId }, ztools.clipboard),
  pasteContent: (content) =>
    performDirectPaste({ type: "content", content }, canonicalClipboardHost),
  async pasteItem(itemId, plainText = false) {
    const record = await store.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item no longer exists");
    }
    return pasteCanonicalRecord(record, canonicalClipboardHost, plainText);
  },
  async copyItem(itemId, plainText = false) {
    const record = await store.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item no longer exists");
    }
    await copyCanonicalRecord(record, canonicalClipboardHost, plainText);
  },
  async createTextItem(text, title, pinboardId) {
    if (
      pinboardId !== undefined &&
      !(await pinboardStore.list()).some((pinboard) => pinboard.id === pinboardId)
    ) {
      throw new RangeError("Pinboard does not exist");
    }
    const record = await store.createTextItem(text, title, pinboardId);
    void scheduleVaultSync().catch(reportSynchronizationError);
    broadcastHistoryChanged();
    return record.item;
  },
  async updateTextItem(itemId, text, title) {
    const record = await store.updateTextItem(itemId, text, title);
    void scheduleVaultSync().catch(reportSynchronizationError);
    broadcastHistoryChanged();
    return record.item;
  },
  async updateItemTitle(itemId, title) {
    const record = await store.updateItemTitle(itemId, title);
    void scheduleVaultSync().catch(reportSynchronizationError);
    broadcastHistoryChanged();
    return record.item;
  },
  listPinboards: () => pinboardStore.list(),
  async createPinboard(name, color) {
    const result = await pinboardStore.create(name, color);
    void scheduleVaultSync().catch(reportSynchronizationError);
    return result;
  },
  async renamePinboard(id, name) {
    const result = await pinboardStore.rename(id, name);
    void scheduleVaultSync().catch(reportSynchronizationError);
    return result;
  },
  async updatePinboardColor(id, color) {
    const result = await pinboardStore.updateColor(id, color);
    void scheduleVaultSync().catch(reportSynchronizationError);
    return result;
  },
  async movePinboard(id, beforeId, afterId) {
    const result = await pinboardStore.moveBetween(id, beforeId, afterId);
    void scheduleVaultSync().catch(reportSynchronizationError);
    return result;
  },
  async deletePinboard(id) {
    const records = (await store.listRecords()).filter(
      (record) => record.item.pinboardId === id,
    );
    if (records.length > 0) {
      await store.assignToPinboard(
        records.map((record) => record.item.id),
        undefined,
      );
    }
    try {
      await pinboardStore.delete(id);
    } catch (error) {
      if (records.length > 0) {
        try {
          await store.restoreRecords(records);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "删除分组失败，且无法完整恢复原分组内容",
          );
        }
      }
      throw error;
    }
    void scheduleVaultSync().catch(reportSynchronizationError);
    return { id, unassignedItems: records.length };
  },
  async assignItemsToPinboard(itemIds, pinboardId) {
    if (
      pinboardId !== undefined &&
      !(await pinboardStore.list()).some((pinboard) => pinboard.id === pinboardId)
    ) {
      throw new RangeError("Pinboard does not exist");
    }
    const result = await store.assignToPinboard(itemIds, pinboardId);
    void scheduleVaultSync().catch(reportSynchronizationError);
    return result;
  },
  async getItemPreview(itemId) {
    const record = await store.findRecordByItemId(itemId);
    const imagePath = record?.origin.imagePath;
    const mediaType = record?.item.payload.mediaType;
    if (
      record === undefined ||
      imagePath === undefined ||
      mediaType === undefined ||
      (!mediaType.startsWith("image/") && mediaType !== "application/pdf")
    ) return null;
    const maximumPreviewBytes = 25 * 1_024 * 1_024;
    const file = await stat(imagePath);
    if (file.size > maximumPreviewBytes) {
      throw new RangeError("PasteboardPro preview is limited to 25 MiB");
    }
    const bytes = await readFile(imagePath);
    if (bytes.byteLength > maximumPreviewBytes) {
      throw new RangeError("PasteboardPro preview is limited to 25 MiB");
    }
    return { mediaType, dataBase64: bytes.toString("base64") };
  },
  getItemThumbnails: (itemIds) => thumbnailService.get(itemIds),
  prepareNativeFileDrag: (itemId) => nativeFileDragService.prepare(itemId),
  startNativeFileDrag: (itemId) => nativeFileDragService.start(itemId),
  async recognizeItem(itemId) {
    const record = await store.findRecordByItemId(itemId);
    const imagePath = record?.origin.imagePath;
    if (record === undefined || imagePath === undefined) {
      throw new RangeError("该记录没有可识别的本地图片");
    }
    const text = await ocrClient.recognize(imagePath);
    await store.updateOcrText(itemId, text);
    void scheduleVaultSync().catch(reportSynchronizationError);
    broadcastHistoryChanged();
    return text;
  },
  async rotateImage(itemId, quarterTurns) {
    const record = await store.findRecordByItemId(itemId);
    const imagePath = record?.origin.imagePath;
    if (record === undefined || record.item.kind !== "image" || imagePath === undefined) {
      throw new RangeError("该记录没有可旋转的本地图片");
    }
    const destinationPath = path.join(
      os.tmpdir(),
      `pasteboard-pro-rotate-${process.pid}-${crypto.randomUUID()}.png`,
    );
    try {
      await rotateImageFile({ sourcePath: imagePath, destinationPath, quarterTurns });
      const bytes = await readFile(destinationPath);
      const blob = await syncRepository.storeLocalBlob(bytes, "image/png");
      const updated = await store.updateImagePayload(itemId, {
        blobId: blob.id,
        revision: `sha256:${blob.id.slice("blob-".length)}`,
        imagePath: blob.imagePath,
        blobBytes: blob.blobBytes,
        mediaType: "image/png",
      });
      void scheduleVaultSync().catch(reportSynchronizationError);
      broadcastHistoryChanged();
      return updated.item;
    } finally {
      await rm(destinationPath, { force: true });
    }
  },
  async quickLookItem(itemId) {
    const record = await store.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item no longer exists");
    }
    const filePath =
      record.origin.imagePath ?? record.item.payload.filePaths?.find((value) => value.length > 0);
    if (filePath === undefined) {
      throw new RangeError("该记录没有可供 Quick Look 打开的本地文件");
    }
    await openQuickLook(filePath);
  },
  getSyncSettings: () => syncStore.getSettings(),
  async saveSyncSettings(input) {
    const settings = await saveSyncConfiguration(syncStore, keychain, input);
    return settings.enabled ? await scheduleVaultSync() : settings;
  },
  retrySync: () => scheduleVaultSync(),
  getWindowPreferences: () => windowPreferencesStore.get(),
  async saveWindowPreferences(settings) {
    await windowPreferencesStore.put(settings);
    requestShelfEdge(settings.dockEdge);
    broadcastWindowPreferencesChanged();
    void scheduleVaultSync().catch(reportSynchronizationError);
    return windowPreferencesStore.get();
  },
  async selectThemeBackgroundImage() {
    if (ztools.showOpenDialog === undefined) {
      throw new Error("当前 ZTools 版本不支持选择主题背景图片");
    }
    const selected = await Promise.resolve(
      ztools.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] },
        ],
      }),
    );
    const filePath = selected?.[0];
    if (filePath === undefined) return undefined;
    return loadThemeBackgroundImage(filePath, {
      fileSystem: { readFile, stat },
      nativeImage,
    });
  },
  async clearClipboardHistory() {
    const result = await clearStoredClipboardHistory(
      store,
      { delete: (input) => syncRepository.deleteLocalBlob(input) },
      clipboard,
    );
    await pasteStackRuntime?.replace(
      { itemIds: [], direction: "forward" },
      true,
    );
    void scheduleVaultSync().catch(reportSynchronizationError);
    broadcastHistoryChanged();
    return result;
  },
  getListOrders: () => listOrderStore.get(),
  saveListOrder: (scope, itemIds) => listOrderStore.put(scope, itemIds),
  getPasteStack: () => pasteStackStore.get(),
  async savePasteStack(state) {
    const saved = await pasteStackStore.put(state);
    if (isPrimaryWindow) {
      await pasteStackRuntime?.replace(saved, false);
    } else {
      ztools.sendToParent?.(PASTE_STACK_CHANGED_CHANNEL, saved);
    }
    return saved;
  },
  openPanel(panel, params) {
    const request: PanelRequest = {
      panel,
      ...(params === undefined ? {} : { params }),
    };
    if (isPrimaryWindow) {
      panelWindows.open(activeDisplay(), request);
      return;
    }
    if (ztools.sendToParent !== undefined) {
      ztools.sendToParent(PANEL_REQUEST_CHANNEL, request);
      return;
    }
    panelWindows.open(activeDisplay(), request);
  },
};

(window as Window & { pasteboardPro?: PasteboardProBridge }).pasteboardPro = bridge;
}
