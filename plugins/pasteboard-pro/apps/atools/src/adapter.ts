import { PasteItemSchema, PinboardSchema, searchPasteItems, type PasteItem, type Pinboard } from "@pasteboard-pro/core";

export type PasteboardPreferences = {
  retentionDays: number;
  blobBudgetBytes: number;
  privacyLiterals: string[];
  screenShareProtection: boolean;
};

function bridge() {
  const value = window.atools?.pasteboard;
  if (value === undefined) throw new Error("当前宿主未提供 PasteboardPro bridge");
  return value;
}

export const atoolsPasteboard = {
  async listItems(query: string, pinboardId?: string): Promise<PasteItem[]> {
    const structured = /(?:^|\s)(?:type|app|from|device|date|pinboard|board):/iu.test(query);
    const values = await bridge().listItems({
      query: structured ? "" : query,
      ...(pinboardId === undefined ? {} : { pinboardId }),
      limit: structured ? 10_000 : 500,
    });
    return searchPasteItems(values.map((value) => PasteItemSchema.parse(value)), query);
  },
  async listPinboards(): Promise<Pinboard[]> {
    return (await bridge().listPinboards()).map((value) => PinboardSchema.parse(value));
  },
  createPinboard(name: string, color = "#6F61EA"): Promise<Pinboard> {
    return bridge().createPinboard(name, color);
  },
  renamePinboard(id: string, name: string): Promise<Pinboard> {
    return bridge().renamePinboard(id, name);
  },
  updatePinboard(id: string, options: { name?: string; color?: string }): Promise<Pinboard> {
    return bridge().updatePinboard(id, options);
  },
  movePinboard(id: string, beforeId?: string, afterId?: string): Promise<Pinboard> {
    return bridge().movePinboard(id, beforeId, afterId);
  },
  deletePinboard(id: string): Promise<{ id: string; unassignedItems: number }> {
    return bridge().deletePinboard(id);
  },
  assignItems(itemIds: string[], pinboardId?: string): Promise<PasteItem[]> {
    return bridge().assignItems(itemIds, pinboardId);
  },
  createTextItem(text: string, title?: string): Promise<PasteItem> {
    return bridge().createTextItem(text, title);
  },
  updateTextItem(itemId: string, text: string, title?: string): Promise<PasteItem> {
    return bridge().updateTextItem(itemId, text, title);
  },
  updateItemTitle(itemId: string, title: string): Promise<PasteItem> {
    return bridge().updateItemTitle(itemId, title);
  },
  captureStatus: () => bridge().captureStatus(),
  setCapturePaused: (paused: boolean) => bridge().setCapturePaused(paused),
  preferences: (): Promise<PasteboardPreferences> => bridge().preferences(),
  savePreferences: (preferences: PasteboardPreferences): Promise<PasteboardPreferences> =>
    bridge().savePreferences(preferences),
  windowState: () => bridge().windowState(),
  startShelfDrag: () => bridge().startShelfDrag(),
  hideShelf: () => bridge().hideShelf(),
  itemPreview: (itemId: string) => bridge().itemPreview(itemId),
  recognizeItem: (itemId: string) => bridge().recognizeItem(itemId),
  rotateImage: (itemId: string, quarterTurns: -1 | 1) => bridge().rotateImage(itemId, quarterTurns),
  quickLookItem: (itemId: string) => bridge().quickLookItem(itemId),
  pasteItem: (itemId: string, plainText = false) => bridge().pasteItem(itemId, plainText),
  syncSettings: () => bridge().syncSettings(),
  syncNow: () => bridge().syncNow(),
  async copy(item: PasteItem, plainText = false): Promise<void> {
    await bridge().copyItem(item.id, plainText);
  },
  async paste(item: PasteItem, plainText = false): Promise<void> {
    const result = await bridge().pasteItem(item.id, plainText);
    if (result.warning) await window.utools?.showNotification(result.warning);
  },
};
