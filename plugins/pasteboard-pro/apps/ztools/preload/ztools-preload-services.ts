import path from "node:path";
import { HistoryRpcClient, HISTORY_QUERY_CHANNEL, HISTORY_RESULT_CHANNEL, type HistoryReply } from "./history-rpc";
import { HistorySearchService } from "./history-search";
import { ZToolsCanonicalClipboardStore } from "./clipboard-store";
import type { ClipboardWindowRole } from "./clipboard-window-role";
import { createOcrClient, createTesseractOcrClient } from "./ocr";
import { NativeFileDragService } from "./native-file-drag";
import { SourceAppIconService, resolveMacApplicationPath } from "./source-app-icons";
import { ApplicationCatalogService } from "./application-catalog";
import { migratePasteboardProPluginData } from "./plugin-data-migration";
import { resolvePasteboardProDataPaths } from "./plugin-data";
import {
  createKeychainSecretStore,
  createPortableSecretStore,
} from "./keychain";
import { withRichClipboard } from "./paste-item";
import { ZToolsPrivacySettingsStore } from "./privacy";
import { ZToolsPinboardStore } from "./pinboard-store";
import {
  createZToolsGlobalPasteHook,
  PasteStackRuntime,
} from "./paste-stack-runtime";
import { ZToolsPasteStackStore } from "./paste-stack-store";
import { ZToolsListOrderStore } from "./list-order-store";
import { ZToolsSyncStore } from "./sync-store";
import { ZToolsSyncEntityRepository } from "./sync-repository";
import { ThumbnailService } from "./thumbnail";
import { ZToolsWindowPreferencesStore } from "./window-preferences";
import { PanelWindowManager, ShelfWindowManager } from "./window";
import { createCheckedZToolsDocumentDatabase } from "./clipboard-document-database";
import type { PreloadEnvironment, ZToolsHost } from "./ztools-preload-contracts";

export type SupportedPreloadServices = ReturnType<typeof createSupportedPreloadServices>;

export function createSupportedPreloadServices(input: Readonly<{
  ztools: ZToolsHost;
  environment: PreloadEnvironment;
  window: Window;
  role: ClipboardWindowRole;
  platform: NodeJS.Platform;
}>): Readonly<{
  database: ReturnType<typeof createCheckedZToolsDocumentDatabase>;
  dataMigration: Promise<void>;
  dataPaths: ReturnType<typeof resolvePasteboardProDataPaths>;
  isPrimaryWindow: boolean;
  isShelfWindow: boolean;
  isPanelWindow: boolean;
  store: ZToolsCanonicalClipboardStore;
  privacyStore: ZToolsPrivacySettingsStore;
  windowPreferencesStore: ZToolsWindowPreferencesStore;
  listOrderStore: ZToolsListOrderStore;
  pasteStackStore: ZToolsPasteStackStore;
  pinboardStore: ZToolsPinboardStore;
  syncStore: ZToolsSyncStore;
  keychain: ReturnType<typeof createKeychainSecretStore> | ReturnType<typeof createPortableSecretStore> | Readonly<{
    save(value: string): Promise<void>;
    load(): Promise<string | undefined>;
    delete(): Promise<void>;
  }>;
  syncRepository: ZToolsSyncEntityRepository;
  shelfWindows: ShelfWindowManager;
  panelWindows: PanelWindowManager;
  thumbnailService: ThumbnailService;
  nativeFileDragService: NativeFileDragService;
  applicationCatalog: ApplicationCatalogService;
  sourceAppIcons: SourceAppIconService;
  historySearch: HistorySearchService;
  historyRpc: HistoryRpcClient | undefined;
  ocrClient: ReturnType<typeof createOcrClient> | ReturnType<typeof createTesseractOcrClient>;
  canonicalClipboardHost: ReturnType<typeof withRichClipboard>;
  pasteStackRuntime: PasteStackRuntime | undefined;
}> {
  const { ztools, environment, window, role, platform } = input;
  const { clipboard, ipcRenderer, nativeImage, safeStorage } = environment;
  const isPrimaryWindow = role === "primary";
  const isShelfWindow = role === "shelf";
  const isPanelWindow = role === "panel";

  // Keep one checked adapter identity for migration, stores, repositories, and record-index.
  const database = createCheckedZToolsDocumentDatabase(ztools.db.promises);
  const dataPaths = resolvePasteboardProDataPaths(ztools);
  const dataMigration = isPrimaryWindow
    ? migratePasteboardProPluginData(database, dataPaths)
    : Promise.resolve();
  dataMigration.catch((error) => console.error("[pasteboard-pro] pluginData migration failed", error));

  const deviceId = ztools.getNativeId();
  const store = new ZToolsCanonicalClipboardStore(database, {
    deviceId,
    ready: dataMigration,
  });
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, { deviceId });
  const listOrderStore = new ZToolsListOrderStore(database);
  const pasteStackStore = new ZToolsPasteStackStore(database);
  const pinboardStore = new ZToolsPinboardStore(database, { deviceId });
  const syncStore = new ZToolsSyncStore(database);
  const keychain = platform === "darwin"
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
      : createPortableSecretStore({ database, safeStorage });
  const syncRepository = new ZToolsSyncEntityRepository(
    database,
    deviceId,
    dataPaths.blobRoot,
    dataPaths.legacyBlobRoots,
    dataMigration,
  );

  const shelfWindows = new ShelfWindowManager(ztools);
  const panelWindows = new PanelWindowManager(ztools);
  const thumbnailService = new ThumbnailService(store, nativeImage);
  const nativeFileDragService = new NativeFileDragService(store, ztools);
  const applicationCatalog = new ApplicationCatalogService();
  const sourceAppIcons = new SourceAppIconService({
    getFileIcon: (applicationPath) => ztools.getFileIcon?.(applicationPath),
    resolveApplicationPath: (sourceApp) =>
      applicationCatalog.getCachedApplicationPath(sourceApp.bundleId) ?? resolveMacApplicationPath(sourceApp),
  });
  const historySearch = new HistorySearchService(path.join(__dirname, "history-worker.cjs"), {
    all: () => store.readHistoryDocuments(),
    changed: (ids) => store.readHistoryChanges(ids),
  });
  const historyRpc = !isPrimaryWindow && ztools.sendToParent !== undefined
    ? new HistoryRpcClient(
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        (id, request) => ztools.sendToParent!(HISTORY_QUERY_CHANNEL, id, request),
      )
    : undefined;
  window.addEventListener(HISTORY_RESULT_CHANNEL, (event) =>
    historyRpc?.receive((event as CustomEvent<HistoryReply>).detail),
  );
  window.addEventListener("beforeunload", () => {
    historySearch.dispose();
    historyRpc?.dispose();
  });
  window.addEventListener("pasteboard-pro:history-changed", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    historySearch.invalidate(
      Array.isArray(detail) && detail.every((id) => typeof id === "string") ? detail : undefined,
    );
  });

  const ocrClient = platform === "darwin"
    ? createOcrClient({ helperPath: path.join(__dirname, "pasteboard-vision") })
    : createTesseractOcrClient({ platform });
  const canonicalClipboardHost = withRichClipboard(ztools.clipboard, {
    write: (data) => clipboard.write(data),
    leavePlugin: () => ztools.outPlugin(),
    simulatePaste: () => {
      if (ztools.simulateKeyboardTap === undefined) {
        throw new Error("当前 ZTools 版本不支持模拟粘贴");
      }
      return ztools.simulateKeyboardTap("v", platform === "darwin" ? "meta" : "ctrl");
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

  return {
    database,
    dataMigration,
    dataPaths,
    isPrimaryWindow,
    isShelfWindow,
    isPanelWindow,
    store,
    privacyStore,
    windowPreferencesStore,
    listOrderStore,
    pasteStackStore,
    pinboardStore,
    syncStore,
    keychain,
    syncRepository,
    shelfWindows,
    panelWindows,
    thumbnailService,
    nativeFileDragService,
    applicationCatalog,
    sourceAppIcons,
    historySearch,
    historyRpc,
    ocrClient,
    canonicalClipboardHost,
    pasteStackRuntime,
  };
}
