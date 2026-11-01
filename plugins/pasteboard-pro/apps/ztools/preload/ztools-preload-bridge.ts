import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reorderItemGroupIds, listOrderScope } from "../src/list-order";
import { rememberRecord } from "./record-index";
import {
  importScreenCapture,
  type ScreenshotNativeImageApi,
} from "./screenshot-import";
import { openQuickLook } from "./quick-look";
import { rotateImageFile } from "./image-rotation";
import {
  copyCanonicalRecord,
  pasteCanonicalRecord,
} from "./paste-item";
import { isCapturePaused, performDirectPaste } from "./privacy";
import { loadThemeBackgroundImage } from "./theme-background";
import { saveSyncConfiguration } from "./sync-config";
import type { NativeImageApi } from "./thumbnail";
import type {
  AuxiliaryPanel,
  PanelRequest,
} from "./window";
import type {
  ElectronClipboard,
  PasteboardProBridge,
  PasteboardProCapabilities,
  ZToolsHost,
} from "./ztools-preload-contracts";
import type { ZToolsHostCompatibility } from "./host-compatibility";
import type { SupportedPreloadServices } from "./ztools-preload-services";
import type { ZToolsHistoryCoordinator } from "./ztools-history-coordinator";

const PANEL_REQUEST_CHANNEL = "pasteboard-pro:open-panel";
const PASTE_STACK_CHANGED_CHANNEL = "pasteboard-pro:paste-stack-changed";
const REQUEST_HISTORY_MIRROR_CHANNEL = "pasteboard-pro:request-history-mirror";

export function createZToolsPreloadBridge(input: Readonly<{
  ztools: ZToolsHost;
  clipboard: ElectronClipboard;
  nativeImage: NativeImageApi;
  platformCapabilities: PasteboardProCapabilities;
  hostCompatibility: ZToolsHostCompatibility;
  services: SupportedPreloadServices;
  coordinator: ZToolsHistoryCoordinator;
}>): PasteboardProBridge {
  const { ztools, clipboard, nativeImage, platformCapabilities, hostCompatibility, services, coordinator } = input;
  const {
    isPrimaryWindow,
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
  } = services;
  const {
    activeDisplay,
    applyShelfContentProtection,
    requestShelfEdge,
    broadcastHistoryChanged,
    broadcastWindowPreferencesChanged,
    broadcastSyncSettingsChanged,
    reportSynchronizationError,
    triggerFastHistoryMirror,
    scheduleVaultSync,
    clearClipboardHistory: clearHistoryWithOwner,
  } = coordinator;

  const bridge: PasteboardProBridge = {
    getHostCompatibility: () => hostCompatibility,
    getPlatformCapabilities: () => platformCapabilities,
    getSourceAppIcon: (sourceApp) => sourceAppIcons.getSourceAppIcon(sourceApp),
    listApplications: (refresh) => applicationCatalog.listApplications(refresh),
    captureScreenshot: async () => {
      const result = await importScreenCapture(
        ztools,
        nativeImage as NativeImageApi & ScreenshotNativeImageApi,
        clipboard,
        {
          canImport: async () => {
            const privacy = await privacyStore.get();
            return !isCapturePaused(privacy.pause);
          },
        },
      );
      if (isPrimaryWindow) {
        triggerFastHistoryMirror(4, 250);
      } else {
        ztools.sendToParent?.(REQUEST_HISTORY_MIRROR_CHANNEL);
      }
      return result;
    },
    async searchHistory(query = "", limit = 1_000) {
      const normalizedLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
      const { result, records } = await store.searchWithRecords(query, normalizedLimit);
      nativeFileDragService.refresh(records);
      return result;
    },
    async searchHistoryPage(request) {
      const page = await (historyRpc === undefined ? historySearch.page(request) : historyRpc.page(request));
      for (const item of page.items) {
        rememberRecord(services.database, item.id, `pasteboard-pro:record:${item.contentFingerprint}`);
      }
      return page;
    },
    async getHistoryItem(itemId, fingerprint) {
      if (fingerprint !== undefined) {
        rememberRecord(services.database, itemId, `pasteboard-pro:record:${fingerprint}`);
      }
      return (await store.findRecordByItemId(itemId))?.item;
    },
    async reorderHistory(request, pinboardId) {
      const scope = listOrderScope(pinboardId);
      const orders = await listOrderStore.get();
      const ids = await historySearch.order({
        ...(pinboardId === undefined ? {} : { pinboardId }),
        orderedIds: orders[scope] ?? [],
      });
      return listOrderStore.put(
        scope,
        reorderItemGroupIds(ids, request.sourceIds, request.targetId, request.position),
      );
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
    pasteHostItem: (hostItemId) => performDirectPaste({ type: "host", hostItemId }, ztools.clipboard),
    pasteContent: (content) => performDirectPaste({ type: "content", content }, canonicalClipboardHost),
    async pasteItem(itemId, plainText = false) {
      const record = await store.findRecordByItemId(itemId);
      if (record === undefined) throw new RangeError("Clipboard item no longer exists");
      return pasteCanonicalRecord(record, canonicalClipboardHost, plainText);
    },
    async copyItem(itemId, plainText = false) {
      const record = await store.findRecordByItemId(itemId);
      if (record === undefined) throw new RangeError("Clipboard item no longer exists");
      await copyCanonicalRecord(record, canonicalClipboardHost, plainText);
    },
    async createTextItem(text, title, pinboardId) {
      if (
        pinboardId !== undefined &&
        !(await pinboardStore.list()).some((pinboard) => pinboard.id === pinboardId)
      ) throw new RangeError("Pinboard does not exist");
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
      const records = (await store.listRecords()).filter((record) => record.item.pinboardId === id);
      if (records.length > 0) {
        await store.assignToPinboard(records.map((record) => record.item.id), undefined);
      }
      try {
        await pinboardStore.delete(id);
      } catch (error) {
        if (records.length > 0) {
          try {
            await store.restoreRecords(records);
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "删除分组失败，且无法完整恢复原分组内容");
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
      ) throw new RangeError("Pinboard does not exist");
      const result = await store.assignToPinboard(itemIds, pinboardId);
      void scheduleVaultSync().catch(reportSynchronizationError);
      return result;
    },
    async getItemPreview(itemId) {
      const record = await store.findRecordByItemId(itemId);
      const imagePath = record?.origin.imagePath;
      const mediaType = record?.item.payload.mediaType;
      if (
        record === undefined || imagePath === undefined || mediaType === undefined ||
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
      if (record === undefined) throw new RangeError("Clipboard item no longer exists");
      const filePath = record.origin.imagePath ?? record.item.payload.filePaths?.find((value) => value.length > 0);
      if (filePath === undefined) throw new RangeError("该记录没有可供 Quick Look 打开的本地文件");
      await openQuickLook(filePath);
    },
    getSyncSettings: () => syncStore.getSettings(),
    async saveSyncSettings(input) {
      const settings = await saveSyncConfiguration(syncStore, keychain, input);
      broadcastSyncSettingsChanged(settings);
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
      const selected = await Promise.resolve(ztools.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      }));
      const filePath = selected?.[0];
      if (filePath === undefined) return undefined;
      return loadThemeBackgroundImage(filePath, { fileSystem: { readFile, stat }, nativeImage });
    },
    clearClipboardHistory: () => clearHistoryWithOwner(),
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
      const request: PanelRequest = { panel, ...(params === undefined ? {} : { params }) };
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

  return bridge;
}
