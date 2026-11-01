import type { PasteStackState } from "@pasteboard-pro/core";
import type { ListReorderRequest } from "../src/list-order";
import type { HistoryPage, HistoryRequest } from "./history-page";
import type { RawZToolsDocumentDatabase } from "./clipboard-document-database";
import type { HostClipboardApi } from "./clipboard-store";
import type { ZToolsHostCompatibility } from "./host-compatibility";
import type { ScreenCaptureImportResult } from "./screenshot-import";
import type {
  CapturePauseState,
  ClipboardPasteHost,
  ClipboardWriteContent,
  DirectPasteResult,
  PrivacySettings,
} from "./privacy";
import type { ClipboardWriter } from "./paste-stack-runtime";
import type { ListOrders } from "./list-order-store";
import type { ClearClipboardHistoryResult } from "./clear-history";
import type { SaveSyncConfigurationInput } from "./sync-config";
import type { SyncSettings } from "./sync-store";
import type { ItemThumbnail, NativeImageApi } from "./thumbnail";
import type { WindowPreferences } from "./window-preferences";
import type {
  AuxiliaryPanel,
  BrowserWindowHandle,
  BrowserWindowOptions,
  PanelRequest,
  ShelfDisplay,
} from "./window";
import type { SafeStorageLike } from "./keychain";
import type { ApplicationCatalogResult } from "./application-catalog";
import type { SourceAppIdentity } from "./source-app-icons";

export type IpcRendererLike = Readonly<{
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}>;

export type ElectronClipboard = ClipboardWriter &
  Readonly<{
    clear(): void;
    read?(type?: string): unknown;
    readImage?(): unknown;
    readBuffer?(type: string): unknown;
    has?(type: string): boolean;
  }>;

export type ZToolsDisplay = Readonly<{
  id: string | number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  workArea: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

export type ZToolsHost = Readonly<{
  getAppVersion?(): unknown;
  getPath?(name: string): unknown;
  getFileIcon?(applicationPath: string): unknown;
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
    promises: RawZToolsDocumentDatabase;
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

export type PasteboardProCapabilities = Readonly<{
  platform: NodeJS.Platform;
  supportsGlobalPasteQueue: boolean;
  supportsQuickLook: boolean;
  supportsSystemOcr: boolean;
  supportsImageRotation: boolean;
  supportsNativeFileDrag: boolean;
  supportsScreenCapture: boolean;
}>;

export type PasteboardProBridge = Readonly<{
  getHostCompatibility(): ZToolsHostCompatibility;
  getPlatformCapabilities(): PasteboardProCapabilities;
  getSourceAppIcon(sourceApp: SourceAppIdentity): Promise<string | undefined>;
  listApplications(refresh?: boolean): Promise<ApplicationCatalogResult>;
  captureScreenshot(): Promise<ScreenCaptureImportResult>;
  searchHistory(query?: string, limit?: number): Promise<Readonly<{ items: unknown[]; total: number }>>;
  searchHistoryPage(request: HistoryRequest): Promise<HistoryPage>;
  getHistoryItem(itemId: string, fingerprint?: string): Promise<unknown>;
  reorderHistory(request: ListReorderRequest, pinboardId?: string): Promise<ListOrders>;
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
  movePinboard(id: string, beforeId?: string, afterId?: string): Promise<unknown>;
  deletePinboard(id: string): Promise<Readonly<{ id: string; unassignedItems: number }>>;
  assignItemsToPinboard(itemIds: readonly string[], pinboardId: string | undefined): Promise<unknown[]>;
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

export type PreloadEnvironment = Readonly<{
  clipboard: ElectronClipboard;
  ipcRenderer: IpcRendererLike;
  nativeImage: NativeImageApi;
  safeStorage?: SafeStorageLike;
}>;
