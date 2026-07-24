import type { PasteItem, Pinboard } from "@pasteboard-pro/core";

declare module "*.svelte" {
  import type { Component } from "svelte";

  const component: Component<Record<string, unknown>>;
  export default component;
}

type SyncSettings = {
  enabled: boolean;
  state: string;
  pendingObjects: number;
  lastSyncedAt?: string | null;
};

type PasteboardPreferences = {
  retentionDays: number;
  blobBudgetBytes: number;
  privacyLiterals: string[];
  screenShareProtection: boolean;
};

declare global {
  interface Window {
    atools?: {
      pasteboard: {
        listItems(options?: { query?: string; pinboardId?: string; limit?: number }): Promise<PasteItem[]>;
        listPinboards(): Promise<Pinboard[]>;
        createPinboard(name: string, color: string): Promise<Pinboard>;
        renamePinboard(id: string, name: string): Promise<Pinboard>;
        updatePinboard(id: string, options: { name?: string; color?: string }): Promise<Pinboard>;
        movePinboard(id: string, beforeId?: string, afterId?: string): Promise<Pinboard>;
        deletePinboard(id: string): Promise<{ id: string; unassignedItems: number }>;
        assignItems(itemIds: string[], pinboardId?: string): Promise<PasteItem[]>;
        createTextItem(text: string, title?: string): Promise<PasteItem>;
        updateTextItem(itemId: string, text: string, title?: string): Promise<PasteItem>;
        updateItemTitle(itemId: string, title: string): Promise<PasteItem>;
        captureStatus(): Promise<{ paused: boolean; retentionDays: number; itemCount: number }>;
        setCapturePaused(paused: boolean): Promise<{ paused: boolean; retentionDays: number; itemCount: number }>;
        preferences(): Promise<PasteboardPreferences>;
        savePreferences(preferences: PasteboardPreferences): Promise<PasteboardPreferences>;
        windowState(): Promise<{ edge: "floating" | "top" | "bottom" | "left" | "right"; monitorName?: string | null; x: number; y: number; width: number; height: number }>;
        startShelfDrag(): Promise<void>;
        hideShelf(): Promise<void>;
        itemPreview(itemId: string): Promise<{ mediaType: string; dataBase64: string } | null>;
        recognizeItem(itemId: string): Promise<string>;
        rotateImage(itemId: string, quarterTurns: -1 | 1): Promise<PasteItem>;
        quickLookItem(itemId: string): Promise<void>;
        pasteItem(itemId: string, plainText?: boolean): Promise<{ status: string; warning?: string | null }>;
        copyItem(itemId: string, plainText?: boolean): Promise<{ status: string; warning?: string | null }>;
        syncSettings(): Promise<SyncSettings>;
        syncNow(): Promise<{ status: string; pulledObjects: number; pushedObjects: number; failedObjectIds: string[] }>;
      };
    };
    utools?: {
      copyText(text: string): Promise<unknown>;
      hideMainWindowPasteText(text: string): Promise<unknown>;
      hideMainWindowPasteFile(file: string | string[]): Promise<unknown>;
      showNotification(message: string): Promise<unknown>;
    };
  }
}

export {};
