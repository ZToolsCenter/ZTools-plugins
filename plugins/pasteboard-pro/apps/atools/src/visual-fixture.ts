import { historyFixture, pinboardFixture } from "@pasteboard-pro/contract-fixtures";
import {
  PasteItemSchema,
  PinboardSchema,
  searchPasteItems,
  type PasteItem,
  type Pinboard,
} from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

const previewPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export function installAtoolsVisualFixture(): void {
  if (!import.meta.env.DEV) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("visual") !== "1") return;

  let items: PasteItem[] = historyFixture.map((item) => PasteItemSchema.parse(item));
  let pinboards: Pinboard[] = pinboardFixture.map((pinboard) => PinboardSchema.parse(pinboard));
  let paused = false;
  let preferences = {
    retentionDays: 90,
    blobBudgetBytes: 1_073_741_824,
    privacyLiterals: [] as string[],
    screenShareProtection: true,
  };
  const dock = visualDock(params.get("dock"));

  const item = (id: string): PasteItem => {
    const value = items.find((candidate) => candidate.id === id);
    if (value === undefined) throw new Error(`Visual fixture item does not exist: ${id}`);
    return value;
  };
  const nextClock = (deviceId: string) => ({
    wallMs: Date.now(),
    counter: 0,
    deviceId,
  });

  window.atools = {
    pasteboard: {
      async listItems(options = {}) {
        const queried = searchPasteItems(items, options.query ?? "");
        return queried
          .filter((candidate) =>
            options.pinboardId === undefined || candidate.pinboardId === options.pinboardId,
          )
          .slice(0, options.limit ?? 500)
          .map((candidate) => structuredClone(candidate));
      },
      async listPinboards() {
        return pinboards.map((pinboard) => structuredClone(pinboard));
      },
      async createPinboard(name, color) {
        const created: Pinboard = {
          id: `visual-board-${pinboards.length + 1}`,
          name,
          color,
          orderKey: `z${pinboards.length}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          fieldClocks: {},
        };
        pinboards = [...pinboards, created];
        return structuredClone(created);
      },
      async renamePinboard(id, name) {
        const current = pinboards.find((candidate) => candidate.id === id);
        if (current === undefined) throw new Error("Visual fixture Pinboard is missing");
        const updated = { ...current, name, updatedAt: new Date().toISOString() };
        pinboards = pinboards.map((candidate) => candidate.id === id ? updated : candidate);
        return structuredClone(updated);
      },
      async updatePinboard(id, options) {
        const current = pinboards.find((candidate) => candidate.id === id);
        if (current === undefined) throw new Error("Visual fixture Pinboard is missing");
        const updated: Pinboard = {
          ...current,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.color === undefined ? {} : { color: options.color }),
          updatedAt: new Date().toISOString(),
        };
        pinboards = pinboards.map((candidate) => candidate.id === id ? updated : candidate);
        return structuredClone(updated);
      },
      async movePinboard(id, beforeId, afterId) {
        const current = pinboards.find((candidate) => candidate.id === id);
        if (current === undefined) throw new Error("Visual fixture Pinboard is missing");
        const remaining = pinboards.filter((candidate) => candidate.id !== id);
        const index = afterId === undefined
          ? remaining.length
          : Math.max(0, remaining.findIndex((candidate) => candidate.id === afterId));
        remaining.splice(index, 0, current);
        pinboards = remaining.map((candidate, candidateIndex) => ({
          ...candidate,
          orderKey: `v${candidateIndex}`,
        }));
        return structuredClone(pinboards.find((candidate) => candidate.id === id)!);
      },
      async deletePinboard(id) {
        const affected = items.filter((candidate) => candidate.pinboardId === id).length;
        pinboards = pinboards.filter((candidate) => candidate.id !== id);
        items = items.map((candidate) => {
          if (candidate.pinboardId !== id) return candidate;
          const { pinboardId: _pinboardId, pinboardOrderKey: _orderKey, ...unassigned } = candidate;
          return unassigned;
        });
        return { id, unassignedItems: affected };
      },
      async assignItems(itemIds, pinboardId) {
        const selected = new Set(itemIds);
        items = items.map((candidate) => {
          if (!selected.has(candidate.id)) return candidate;
          if (pinboardId !== undefined) {
            return { ...candidate, pinboardId, pinboardOrderKey: `v${candidate.id}` };
          }
          const { pinboardId: _pinboardId, pinboardOrderKey: _orderKey, ...unassigned } = candidate;
          return unassigned;
        });
        return items.filter((candidate) => selected.has(candidate.id)).map((value) => structuredClone(value));
      },
      async createTextItem(text, title) {
        const now = new Date().toISOString();
        const created: PasteItem = {
          id: `visual-item-${items.length + 1}`,
          kind: "text",
          ...(title === undefined ? {} : { title }),
          sourceDeviceId: "visual-fixture",
          copiedAt: now,
          updatedAt: now,
          contentFingerprint: `visual-${items.length + 1}`,
          payload: { revision: `visual-r${items.length + 1}`, text },
          pinned: false,
          fieldClocks: {},
        };
        items = [created, ...items];
        return structuredClone(created);
      },
      async updateTextItem(itemId, text, title) {
        const current = item(itemId);
        const updated: PasteItem = {
          ...current,
          ...(title === undefined ? {} : { title }),
          updatedAt: new Date().toISOString(),
          payload: { ...current.payload, revision: `${current.payload.revision}-edit`, text },
          fieldClocks: { ...current.fieldClocks, payload: nextClock("visual-edit") },
        };
        items = items.map((candidate) => candidate.id === itemId ? updated : candidate);
        return structuredClone(updated);
      },
      async updateItemTitle(itemId, title) {
        const current = item(itemId);
        const updated = {
          ...current,
          title,
          updatedAt: new Date().toISOString(),
          fieldClocks: { ...current.fieldClocks, title: nextClock("visual-rename") },
        };
        items = items.map((candidate) => candidate.id === itemId ? updated : candidate);
        return structuredClone(updated);
      },
      async captureStatus() {
        return { paused, retentionDays: preferences.retentionDays, itemCount: items.length };
      },
      async setCapturePaused(next) {
        paused = next;
        return { paused, retentionDays: preferences.retentionDays, itemCount: items.length };
      },
      async preferences() {
        return structuredClone(preferences);
      },
      async savePreferences(next) {
        preferences = structuredClone(next);
        return structuredClone(preferences);
      },
      async windowState() {
        return { edge: dock, monitorName: "Visual Fixture", x: 0, y: 0, width: 1280, height: 420 };
      },
      async startShelfDrag() {},
      async hideShelf() {},
      async itemPreview(itemId) {
        return item(itemId).kind === "image"
          ? { mediaType: "image/png", dataBase64: previewPng }
          : null;
      },
      async recognizeItem(itemId) {
        return item(itemId).ocrText ?? "";
      },
      async rotateImage(itemId) {
        return structuredClone(item(itemId));
      },
      async quickLookItem() {},
      async pasteItem() {
        return { status: "pasted", warning: null };
      },
      async copyItem() {
        return { status: "copied", warning: null };
      },
      async syncSettings() {
        return { enabled: true, state: "success", pendingObjects: 0, lastSyncedAt: new Date().toISOString() };
      },
      async syncNow() {
        return { status: "success", pulledObjects: 0, pushedObjects: 0, failedObjectIds: [] };
      },
    },
  };
  window.utools = {
    async copyText() {},
    async hideMainWindowPasteText() {},
    async hideMainWindowPasteFile() {},
    async showNotification() {},
  };
}

function visualDock(value: string | null): DockEdge {
  return value === "bottom" || value === "left" || value === "right"
    ? value
    : "floating";
}
