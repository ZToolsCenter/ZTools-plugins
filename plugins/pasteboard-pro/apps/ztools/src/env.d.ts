/// <reference types="vite/client" />

import type {
  CapturePauseState,
  ClipboardWriteContent,
  DirectPasteResult,
  PrivacySettings,
} from "../preload/privacy";
import type { SaveSyncConfigurationInput } from "../preload/sync-config";
import type { SyncSettings } from "../preload/sync-store";
import type { WindowPreferences } from "../preload/window-preferences";
import type { PasteStackState } from "@pasteboard-pro/core";

declare global {
  interface Window {
    pasteboardPro?: Readonly<{
      searchHistory(
        query?: string,
        limit?: number,
      ): Promise<Readonly<{ items: unknown[]; total: number }>>;
      getPrivacySettings(): Promise<PrivacySettings>;
      savePrivacySettings(settings: PrivacySettings): Promise<PrivacySettings>;
      setCapturePause(pause: CapturePauseState): Promise<PrivacySettings>;
      pasteHostItem(hostItemId: string): Promise<DirectPasteResult>;
      pasteContent(content: ClipboardWriteContent): Promise<DirectPasteResult>;
      pasteItem(itemId: string, plainText?: boolean): Promise<DirectPasteResult>;
      copyItem(itemId: string, plainText?: boolean): Promise<void>;
      createTextItem(text: string, title?: string): Promise<unknown>;
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
      deletePinboard(id: string): Promise<{ id: string; unassignedItems: number }>;
      assignItemsToPinboard(
        itemIds: readonly string[],
        pinboardId: string | undefined,
      ): Promise<unknown[]>;
      getItemPreview(itemId: string): Promise<{ mediaType: string; dataBase64: string } | null>;
      getItemThumbnails(itemIds: readonly string[]): Promise<Array<{
        itemId: string;
        mediaType: string;
        dataBase64: string;
      }>>;
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
      getPasteStack(): Promise<PasteStackState>;
      savePasteStack(state: PasteStackState): Promise<PasteStackState>;
      openPanel(
        panel: "privacy" | "sync" | "preview" | "editor",
        params?: Readonly<Record<string, string>>,
      ): void;
    }>;
  }
}

export {};
