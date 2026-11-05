import { randomUUID } from "node:crypto";
import { clearClipboardHistory as clearStoredClipboardHistory } from "./clear-history";
import {
  CLEAR_HISTORY_REQUEST_CHANNEL, CLEAR_HISTORY_RESULT_CHANNEL,
  HistoryClearRpcClient, createHistoryClearRequestHandler,
} from "./history-clear-rpc";
import {
  mirrorHostHistory,
  type MirrorHostHistoryResult,
} from "./clipboard-store";
import {
  ownsClipboardHistoryMirror,
  type ClipboardWindowRole,
} from "./clipboard-window-role";
import { ensureZToolsAutoStart } from "./auto-start";
import { HISTORY_QUERY_CHANNEL } from "./history-rpc";
import type { HistoryRequest } from "./history-page";
import { takeRecordChanges } from "./record-index";
import { localizeMirroredImage } from "./mirrored-image";
import { readBoundedImageBytes } from "./sync-blob-files";
import {
  isCapturePaused,
  shouldPersistClipboard,
  type ClipboardPrivacyInput,
} from "./privacy";
import { normalizePasteStackState } from "./paste-stack-store";
import { executeRetentionPrune } from "./retention";
import { runConfiguredVaultSync } from "./sync-controller";
import { DEFAULT_SYNC_INTERVAL_MINUTES, type SyncSettings } from "./sync-store";
import { createSearchHistoryHandler } from "./tools";
import type { AuxiliaryPanel, PanelRequest } from "./window";
import type {
  ElectronClipboard,
  IpcRendererLike,
  ZToolsHost,
} from "./ztools-preload-contracts";
import type { SupportedPreloadServices } from "./ztools-preload-services";

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const PANEL_REQUEST_CHANNEL = "pasteboard-pro:open-panel";
const SCREEN_PROTECTION_CHANNEL = "pasteboard-pro:set-screen-protection";
const SHELF_EDGE_CHANNEL = "pasteboard-pro:set-shelf-edge";
const HISTORY_CHANGED_CHANNEL = "pasteboard-pro:history-changed";
const WINDOW_PREFERENCES_CHANGED_CHANNEL = "pasteboard-pro:window-preferences-changed";
const PASTE_STACK_CHANGED_CHANNEL = "pasteboard-pro:paste-stack-changed";
const SYNC_SETTINGS_CHANGED_CHANNEL = "pasteboard-pro:sync-settings-changed";
const REQUEST_HISTORY_MIRROR_CHANNEL = "pasteboard-pro:request-history-mirror";

export type HistoryCoordinatorEnvironment = Readonly<{
  ztools: ZToolsHost;
  clipboard: ElectronClipboard;
  ipcRenderer: IpcRendererLike;
  window: Window;
  role: ClipboardWindowRole;
  services: SupportedPreloadServices;
}>;

export type ZToolsHistoryCoordinator = ReturnType<typeof createZToolsHistoryCoordinator>;

export function createZToolsHistoryCoordinator(environment: HistoryCoordinatorEnvironment) {
  const { ztools, clipboard, ipcRenderer, window, role, services } = environment;
  const {
    database,
    historySearch,
    isPrimaryWindow,
    isShelfWindow,
    listOrderStore,
    pasteStackRuntime,
    panelWindows,
    privacyStore,
    shelfWindows,
    store,
    syncRepository,
    syncStore,
    thumbnailService,
    windowPreferencesStore,
  } = services;

  let synchronization: Promise<unknown> = Promise.resolve();
  let vaultSynchronization: Promise<SyncSettings> | undefined;
  let vaultSyncRequested = false;
  let shelfActivation = Promise.resolve();
  let shelfRefreshTimer: number | undefined;
  let lastRetentionRun = 0;
  let vaultSyncIntervalTimer: NodeJS.Timeout | undefined;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function privacyInput(rawItem: unknown, text: string | undefined): ClipboardPrivacyInput {
    if (!isRecord(rawItem)) return text === undefined ? {} : { text };
    const sourceBundleId = typeof rawItem.appBundleId === "string"
      ? rawItem.appBundleId
      : typeof rawItem.bundleId === "string"
        ? rawItem.bundleId
        : undefined;
    return {
      ...(sourceBundleId === undefined ? {} : { sourceBundleId }),
      ...(text === undefined ? {} : { text }),
      ...(rawItem.transient === true || rawItem.isTransient === true ? { transient: true } : {}),
      ...(rawItem.confidential === true || rawItem.isConfidential === true ? { confidential: true } : {}),
    };
  }

  function activeDisplay() {
    const display = ztools.getDisplayNearestPoint(ztools.getCursorScreenPoint());
    return { id: display.id, bounds: { ...display.bounds }, workArea: { ...display.workArea } };
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

  function isShelfDockEdge(value: unknown): value is "top" | "bottom" | "left" | "right" {
    return value === "top" || value === "bottom" || value === "left" || value === "right";
  }

  function parsedPanelRequest(value: unknown): PanelRequest | undefined {
    if (!isRecord(value)) return undefined;
    const panel = value.panel;
    if (
      panel !== "privacy" && panel !== "sync" && panel !== "preview" &&
      panel !== "editor" && panel !== "whatsnew"
    ) return undefined;
    if (value.params === undefined) return { panel: panel as AuxiliaryPanel };
    if (
      !isRecord(value.params) ||
      !Object.values(value.params).every((entry) => typeof entry === "string")
    ) return undefined;
    return { panel: panel as AuxiliaryPanel, params: value.params as Record<string, string> };
  }

  async function repositionShelf(edge: "top" | "bottom" | "left" | "right"): Promise<void> {
    const [privacy, preferences] = await Promise.all([privacyStore.get(), windowPreferencesStore.get()]);
    shelfWindows.open(activeDisplay(), {
      edge,
      uiVersion: preferences.uiVersion,
      contentProtection: privacy.screenShareProtection,
    });
  }

  function requestShelfEdge(edge: "top" | "bottom" | "left" | "right"): void {
    if (isPrimaryWindow) {
      void repositionShelf(edge).catch(reportSynchronizationError);
      return;
    }
    if (ztools.sendToParent !== undefined) ztools.sendToParent(SHELF_EDGE_CHANNEL, edge);
  }

  function broadcastHistoryChanged(): void {
    thumbnailService.invalidateRecordIndex();
    const changes = takeRecordChanges(database);
    window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_CHANNEL, { detail: changes }));
    if (isPrimaryWindow) {
      shelfWindows.notifyHistoryChanged(changes);
      return;
    }
    ztools.sendToParent?.(HISTORY_CHANGED_CHANNEL, changes);
  }

  function broadcastWindowPreferencesChanged(): void {
    window.dispatchEvent(new CustomEvent(WINDOW_PREFERENCES_CHANGED_CHANNEL));
    if (isPrimaryWindow) {
      shelfWindows.notifyWindowPreferencesChanged();
      return;
    }
    ztools.sendToParent?.(WINDOW_PREFERENCES_CHANGED_CHANNEL);
  }

  function configureVaultSyncInterval(settings: SyncSettings): void {
    if (vaultSyncIntervalTimer !== undefined) {
      clearInterval(vaultSyncIntervalTimer);
      vaultSyncIntervalTimer = undefined;
    }
    if (!settings.enabled) return;
    const intervalMinutes = Math.max(1, settings.intervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES);
    vaultSyncIntervalTimer = setInterval(() => {
      void scheduleVaultSync().catch(reportSynchronizationError);
    }, intervalMinutes * 60 * 1_000);
  }

  function broadcastSyncSettingsChanged(settings: SyncSettings): void {
    window.dispatchEvent(new CustomEvent(SYNC_SETTINGS_CHANGED_CHANNEL, { detail: settings }));
    if (isPrimaryWindow) {
      configureVaultSyncInterval(settings);
      return;
    }
    ztools.sendToParent?.(SYNC_SETTINGS_CHANGED_CHANNEL, settings);
  }

  function reportSynchronizationError(error: unknown): void {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:sync-error", {
      detail: error instanceof Error ? error.message : String(error),
    }));
  }

  function triggerFastHistoryMirror(attempts = 4, intervalMs = 250): void {
    void scheduleHistoryMirror()
      .then((result) => {
        if (result.imported > 0 || attempts <= 1) return;
        window.setTimeout(() => triggerFastHistoryMirror(attempts - 1, intervalMs), intervalMs);
      })
      .catch(reportSynchronizationError);
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
          keychain: services.keychain,
          repository: syncRepository,
        });
        window.dispatchEvent(new CustomEvent("pasteboard-pro:vault-synced", { detail: settings }));
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
    if (now - lastRetentionRun < RETENTION_INTERVAL_MS) return;
    try {
      const settings = await privacyStore.get();
      const result = await executeRetentionPrune(store, {
        days: settings.retention.days,
        maxBlobBytes: settings.retention.maxBlobBytes,
        now,
      }, {
        delete: (input) => syncRepository.deleteLocalBlob(input),
      });
      window.dispatchEvent(new CustomEvent("pasteboard-pro:retention-completed", { detail: result }));
      lastRetentionRun = now;
    } catch (error) {
      lastRetentionRun = now - RETENTION_INTERVAL_MS + 5 * 60 * 1_000;
      window.dispatchEvent(new CustomEvent("pasteboard-pro:retention-error", {
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function runHistoryMutation<T>(action: () => Promise<T>): Promise<T> {
    const next = synchronization.then(action);
    synchronization = next.catch(reportSynchronizationError);
    return next;
  }

  const clearRpc = !isPrimaryWindow && ztools.sendToParent !== undefined
    ? new HistoryClearRpcClient(randomUUID(), (id) => ztools.sendToParent!(CLEAR_HISTORY_REQUEST_CHANNEL, id))
    : undefined;
  window.addEventListener(CLEAR_HISTORY_RESULT_CHANNEL, (event) =>
    clearRpc?.receive((event as CustomEvent<unknown>).detail),
  );
  window.addEventListener("beforeunload", () => clearRpc?.dispose());

  async function clearClipboardHistory() {
    if (!isPrimaryWindow) {
      if (clearRpc !== undefined) return clearRpc.request();
      throw new Error("当前窗口无法确认历史清理，请从主窗口重试");
    }
    return runHistoryMutation(async () => {
      const result = await clearStoredClipboardHistory(
        store, { delete: (blob) => syncRepository.deleteLocalBlob(blob) }, clipboard, ztools.clipboard,
      );
      await pasteStackRuntime?.replace({ itemIds: [], direction: "forward" }, true);
      broadcastHistoryChanged();
      void scheduleVaultSync().catch(reportSynchronizationError);
      return result;
    });
  }

  const handleClearRequest = createHistoryClearRequestHandler(clearClipboardHistory, (reply) => {
    shelfWindows.notifyClearHistoryResult(reply);
    panelWindows.notifyClearHistoryResult(reply);
  });

  function scheduleHistoryMirror(): Promise<MirrorHostHistoryResult> {
    return runHistoryMutation(async (): Promise<MirrorHostHistoryResult> => {
      const privacy = await privacyStore.get();
      let result: MirrorHostHistoryResult;
      try {
        result = await mirrorHostHistory(ztools.clipboard, store, {
          deviceId: ztools.getNativeId(),
          pageSize: 100,
          shouldPersist: (rawItem, record) =>
            !isCapturePaused(privacy.pause) &&
            shouldPersistClipboard(privacyInput(rawItem, record?.item.payload.text), privacy.rules),
          prepareRecord: async (_rawItem, record) => {
            return localizeMirroredImage(record, {
              readFile: readBoundedImageBytes,
              storeLocalBlob: (bytes, mediaType) => syncRepository.storeLocalBlob(bytes, mediaType),
            });
          },
        });
      } catch (error) {
        try {
          broadcastHistoryChanged();
        } catch {
          // A refresh failure must not replace the original persistence error.
        }
        throw error;
      }
      window.dispatchEvent(new CustomEvent("pasteboard-pro:history-mirrored", { detail: result }));
      await runRetentionIfDue();
      broadcastHistoryChanged();
      void scheduleVaultSync().catch(reportSynchronizationError);
      return result;
    });
  }

  function install(): void {
    if (ownsClipboardHistoryMirror(role)) {
      ipcRenderer.on(CLEAR_HISTORY_REQUEST_CHANNEL, (_event, id) => handleClearRequest(id));
      void ensureZToolsAutoStart(ipcRenderer).catch((error: unknown) => {
        console.warn("Paste剪切板自动启动登记失败", error);
      });

      ipcRenderer.on(PANEL_REQUEST_CHANNEL, (_event, value) => {
        const request = parsedPanelRequest(value);
        if (request !== undefined) panelWindows.open(activeDisplay(), request);
      });
      ipcRenderer.on(SCREEN_PROTECTION_CHANNEL, (_event, enabled) => {
        if (typeof enabled === "boolean") shelfWindows.setContentProtection(enabled);
      });
      ipcRenderer.on(SHELF_EDGE_CHANNEL, (_event, edge) => {
        if (isShelfDockEdge(edge)) void repositionShelf(edge).catch(reportSynchronizationError);
      });
      ipcRenderer.on(HISTORY_QUERY_CHANNEL, (_event, id, request) => {
        if (typeof id !== "string" || id.length > 128 || !isRecord(request)) return;
        void historySearch.page(request as HistoryRequest).then(
          (page) => shelfWindows.notifyHistoryResult({ id, page }),
          (error) => shelfWindows.notifyHistoryResult({
            id,
            error: error instanceof Error ? error.message : "历史查询失败",
          }),
        );
      });
      ipcRenderer.on(HISTORY_CHANGED_CHANNEL, (_event, detail) => {
        const changes = Array.isArray(detail) && detail.every((id) => typeof id === "string")
          ? detail
          : undefined;
        historySearch.invalidate(changes);
        thumbnailService.invalidateRecordIndex();
        shelfWindows.notifyHistoryChanged(changes);
      });
      ipcRenderer.on(WINDOW_PREFERENCES_CHANGED_CHANNEL, () => {
        shelfWindows.notifyWindowPreferencesChanged();
      });
      ipcRenderer.on(REQUEST_HISTORY_MIRROR_CHANNEL, () => triggerFastHistoryMirror(4, 250));
      ipcRenderer.on(SYNC_SETTINGS_CHANGED_CHANNEL, (_event, settings) => {
        if (isRecord(settings)) configureVaultSyncInterval(settings as unknown as SyncSettings);
      });
      void syncStore.getSettings().then((settings) => {
        configureVaultSyncInterval(settings);
        if (settings.enabled) {
          const lastSyncedTime = settings.status.lastSyncedAt
            ? new Date(settings.status.lastSyncedAt).getTime()
            : 0;
          const intervalMs = (settings.intervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES) * 60 * 1_000;
          if (Date.now() - lastSyncedTime >= intervalMs) {
            void scheduleVaultSync().catch(reportSynchronizationError);
          }
        }
      }).catch(reportSynchronizationError);
      ipcRenderer.on(PASTE_STACK_CHANGED_CHANNEL, (_event, value) => {
        void pasteStackRuntime?.replace(normalizePasteStackState(value), false)
          .catch(reportSynchronizationError);
      });
      void pasteStackRuntime?.initialize().catch(reportSynchronizationError);

      ztools.onPluginEnter((parameter) => {
        ztools.hideMainWindow(false);
        pasteStackRuntime?.retryGlobalHook();
        window.dispatchEvent(new CustomEvent("pasteboard-pro:host-enter", { detail: parameter }));
        scheduleHistoryMirror();
        shelfActivation = shelfActivation.then(async () => {
          const [settings, windowPreferences] = await Promise.all([
            privacyStore.get(),
            windowPreferencesStore.get(),
          ]);
          shelfWindows.toggle(activeDisplay(), {
            edge: windowPreferences.dockEdge,
            uiVersion: windowPreferences.uiVersion,
            contentProtection: settings.screenShareProtection,
          });
          ztools.outPlugin();
        }).catch(reportSynchronizationError);
      });

      ztools.clipboard.onChange(scheduleHistoryMirror);
      scheduleHistoryMirror();

      ztools.setSubInput?.((details) => {
        window.dispatchEvent(new CustomEvent("pasteboard-pro:host-search", { detail: details }));
      }, "搜索剪贴板历史");
    } else if (isShelfWindow) {
      ztools.clipboard.onChange(() => {
        thumbnailService.invalidateRecordIndex();
        if (shelfRefreshTimer !== undefined) window.clearTimeout(shelfRefreshTimer);
        shelfRefreshTimer = window.setTimeout(() => {
          shelfRefreshTimer = undefined;
          window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed"));
        }, 250);
      });
    }

    if (services.isPrimaryWindow) {
      ztools.registerTool("search_history", createSearchHistoryHandler(store));
    }
  }

  return {
    install,
    isPrimaryWindow,
    activeDisplay,
    applyShelfContentProtection,
    requestShelfEdge,
    broadcastHistoryChanged,
    broadcastWindowPreferencesChanged,
    broadcastSyncSettingsChanged,
    reportSynchronizationError,
    triggerFastHistoryMirror,
    scheduleVaultSync,
    scheduleHistoryMirror,
    clearClipboardHistory,
  };
}
