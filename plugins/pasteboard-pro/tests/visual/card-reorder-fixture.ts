import { expect, type Page } from "playwright/test";

const base = "http://127.0.0.1:5179";
export const itemIds = ["text-old", "image-new", "url-middle", "files-item", "color-item"] as const;
const imageThumbnail =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/H14AAAAASUVORK5CYII=";

export type HostMode = "native-host" | "legacy-host";
export type DropPosition = "before" | "after";
export type CardCase = Readonly<{
  id: "text-old" | "image-new" | "files-item";
  name: string;
  previewSelector: string;
}>;
export type ReorderMetrics = {
  prepared: string[];
  started: string[];
  nativeStartResults: Array<{ itemId: string; started: boolean }>;
  windowCloseCalls: number;
  dataWrites: Array<{ sourceId: string | null; type: string }>;
  dragStarts: Array<{
    sourceId: string | null;
    types: string[];
    defaultPrevented: boolean;
    targetTag: string | null;
    handleAncestor: boolean;
  }>;
  dragOvers: Array<{ targetId: string | null; defaultPrevented: boolean; types: string[]; targetTag: string | null; inTimeline: boolean }>;
  dragOversAfterBubble: Array<{ targetId: string | null; defaultPrevented: boolean; types: string[] }>;
  drops: Array<{ targetId: string | null; defaultPrevented: boolean; types: string[] }>;
  savedOrders: Array<{ scope: string; itemIds: string[] }>;
  persistenceErrors: string[];
};

export const cardCases: readonly CardCase[] = [
  { id: "text-old", name: "text", previewSelector: ".modern-preview--text p" },
  { id: "image-new", name: "image", previewSelector: ".image-preview img" },
  { id: "files-item", name: "file", previewSelector: ".modern-preview--file" },
];


async function installHostBoundary(page: Page, mode: HostMode, uiVersion: "modern" | "classic"): Promise<void> {
  await page.addInitScript(({ nativeHostDrag, thumbnailBase64, uiVersion }) => {
    const metrics = {
      prepared: [] as string[],
      started: [] as string[],
      nativeStartResults: [] as Array<{ itemId: string; started: boolean }>,
      windowCloseCalls: 0,
      dataWrites: [] as Array<{ sourceId: string | null; type: string }>,
      dragStarts: [] as Array<{
        sourceId: string | null;
        types: string[];
        defaultPrevented: boolean;
        targetTag: string | null;
        handleAncestor: boolean;
      }>,
      dragOvers: [] as Array<{ targetId: string | null; defaultPrevented: boolean; types: string[]; targetTag: string | null; inTimeline: boolean }>,
      dragOversAfterBubble: [] as Array<{ targetId: string | null; defaultPrevented: boolean; types: string[] }>,
      drops: [] as Array<{ targetId: string | null; defaultPrevented: boolean; types: string[] }>,
      savedOrders: [] as Array<{ scope: string; itemIds: string[] }>,
      persistenceErrors: [] as string[],
    };

    const itemIdFor = (target: EventTarget | null): string | null =>
      target instanceof Element
        ? target.closest<HTMLElement>("[data-pb-item-id]")?.dataset.pbItemId ?? null
        : null;

    let activeSourceId: string | null = null;
    const nativeSetData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (type: string, data: string): void {
      metrics.dataWrites.push({ sourceId: activeSourceId, type });
      nativeSetData.call(this, type, data);
    };

    document.addEventListener(
      "dragstart",
      (event) => {
        activeSourceId = itemIdFor(event.target);
      },
      true,
    );
    document.addEventListener("dragend", () => { activeSourceId = null; }, true);
    document.addEventListener(
      "dragover",
      (event) => {
        const types = [...(event.dataTransfer?.types ?? [])];
        queueMicrotask(() => {
          metrics.dragOvers.push({
            targetId: itemIdFor(event.target),
            defaultPrevented: event.defaultPrevented,
            types,
            targetTag: event.target instanceof Element ? event.target.tagName : null,
            inTimeline: event.target instanceof Element && event.target.closest(".timeline__track") !== null,
          });
        });
      },
      true,
    );
    document.addEventListener("dragover", (event) => {
      metrics.dragOversAfterBubble.push({
        targetId: itemIdFor(event.target),
        defaultPrevented: event.defaultPrevented,
        types: [...(event.dataTransfer?.types ?? [])],
      });
    });
    document.addEventListener(
      "drop",
      (event) => {
        const types = [...(event.dataTransfer?.types ?? [])];
        queueMicrotask(() => {
          metrics.drops.push({
            targetId: itemIdFor(event.target),
            defaultPrevented: event.defaultPrevented,
            types,
          });
        });
      },
      true,
    );

    Object.defineProperty(window, "__cardReorderMetrics", { value: metrics });
    // Prevent shelf blur from closing the test window while leaving drag events intact.
    window.close = () => { metrics.windowCloseCalls += 1; };

    Object.defineProperty(window, "pasteboardPro", {
      value: {
        getHostCompatibility: () => ({
          supported: true,
          minimumVersion: "2.4.0",
          supportsPluginData: true,
          supportsNativeFileDrag: nativeHostDrag,
          supportsScreenCapture: false,
        }),
        getPlatformCapabilities: () => ({
          platform: "darwin",
          supportsGlobalPasteQueue: true,
          supportsQuickLook: true,
          supportsSystemOcr: true,
          supportsImageRotation: true,
          supportsNativeFileDrag: nativeHostDrag,
          supportsScreenCapture: false,
        }),
        getWindowPreferences: async () => uiVersion === "modern" ? undefined : ({
          dockEdge: "bottom",
          uiVersion,
          multiPasteMode: "batch",
          theme: { accentColor: "#6f61ea", background: { type: "default" } },
        }),
        getPrivacySettings: async () => undefined,
        getSyncSettings: async () => undefined,
        getListOrders: async () =>
          JSON.parse(localStorage.getItem("pb-card-reorder-list-orders") ?? "{}"),
        getPasteStack: async () => ({ direction: "forward", itemIds: [] }),
        savePasteStack: async (value: unknown) => value,
        searchHistory: async () => undefined,
        listPinboards: async () => [],
        getItemThumbnails: async (ids: readonly string[]) =>
          ids.includes("image-new")
            ? [{
                itemId: "image-new",
                mediaType: "image/png",
                dataBase64: thumbnailBase64,
                originalWidth: 1,
                originalHeight: 1,
              }]
            : [],
        prepareNativeFileDrag: async (itemId: string) => {
          metrics.prepared.push(itemId);
          // Legacy hosts keep the plugin bridge but lack ZTools host.startDrag.
          return nativeHostDrag;
        },
        startNativeFileDrag: (itemId: string) => {
          metrics.started.push(itemId);
          // Count the host request without starting an OS drag or moving a real file.
          metrics.nativeStartResults.push({ itemId, started: nativeHostDrag });
          return nativeHostDrag;
        },
        saveListOrder: async (scope: string, ids: readonly string[]) => {
          try {
            // Clone inside the browser boundary, matching the structured-clone persistence path.
            const snapshot = structuredClone([...ids]);
            metrics.savedOrders.push({ scope, itemIds: snapshot });
            const orders = JSON.parse(
              localStorage.getItem("pb-card-reorder-list-orders") ?? "{}",
            ) as Record<string, string[]>;
            const next = { ...orders, [scope]: snapshot };
            localStorage.setItem("pb-card-reorder-list-orders", JSON.stringify(next));
            return structuredClone(next);
          } catch (error) {
            metrics.persistenceErrors.push(
              error instanceof Error ? error.message : String(error),
            );
            throw error;
          }
        },
        openPanel: () => undefined,
      },
    });
  }, { nativeHostDrag: mode === "native-host", thumbnailBase64: imageThumbnail, uiVersion });
}

export async function openShelf(page: Page, mode: HostMode, uiVersion: "modern" | "classic" = "modern"): Promise<void> {
  await installHostBoundary(page, mode, uiVersion);
  await page.goto(base + "/?visual=1&shelf=1&dock=bottom", { waitUntil: "networkidle" });
  if (uiVersion === "modern") await expect(page.locator(".shelf--modern")).toBeVisible();
  else await expect(page.locator(".shelf:not(.shelf--modern)")).toBeVisible();
  await expect(page.locator("[data-pb-reorder-handle]")).toHaveCount(itemIds.length);
  await expect(page.locator("[data-pb-reorder-handle]").first()).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(itemIds.length);
}

export async function cardOrder(page: Page): Promise<string[]> {
  return page.getByRole("option").evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-pb-item-id") ?? ""),
  );
}

export async function selectedCardIds(page: Page): Promise<string[]> {
  return page.getByRole("option").evaluateAll((cards) =>
    cards
      .filter((card) => card.getAttribute("aria-selected") === "true")
      .map((card) => card.getAttribute("data-pb-item-id") ?? ""),
  );
}

export function reorderPlan(
  initialOrder: readonly string[],
  selected: readonly string[],
  override?: Readonly<{ targetId: string; position: DropPosition }>,
): { targetId: string; position: DropPosition; expectedOrder: string[]; selectedInDomOrder: string[] } {
  const selectedSet = new Set(selected);
  const selectedInDomOrder = initialOrder.filter((itemId) => selectedSet.has(itemId));
  const firstSelectedIndex = initialOrder.findIndex((itemId) => selectedSet.has(itemId));
  const movingToStart = firstSelectedIndex > 0;
  const defaultTargetId = movingToStart
    ? initialOrder.find((itemId) => !selectedSet.has(itemId))
    : [...initialOrder].reverse().find((itemId) => !selectedSet.has(itemId));
  const targetId = override?.targetId ?? defaultTargetId;
  if (targetId === undefined || selectedSet.has(targetId) || !initialOrder.includes(targetId)) {
    throw new Error("No unselected reorder target");
  }

  const position = override?.position ?? (movingToStart ? "before" : "after");
  const rest = initialOrder.filter((itemId) => !selectedSet.has(itemId));
  const insertionIndex = rest.indexOf(targetId) + (position === "after" ? 1 : 0);
  rest.splice(insertionIndex, 0, ...selectedInDomOrder);
  return { targetId, position, expectedOrder: rest, selectedInDomOrder };
}

export async function dragFromPreview(
  page: Page,
  source: CardCase,
  targetId: string,
  position: DropPosition,
): Promise<{ hit: unknown; metrics: ReorderMetrics }> {
  const preview = page.locator('[data-pb-item-id="' + source.id + '"] ' + source.previewSelector);
  const sourceBounds = await preview.boundingBox();
  const targetBounds = await page.locator('[data-pb-item-id="' + targetId + '"]').boundingBox();
  if (sourceBounds === null || targetBounds === null) {
    throw new Error("Missing drag bounds for " + source.id + " or " + targetId);
  }

  const start = {
    x: sourceBounds.x + sourceBounds.width / 2,
    y: sourceBounds.y + sourceBounds.height / 2,
  };
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const card = element?.closest<HTMLElement>("[data-pb-item-id]");
    const draggable = element?.closest<HTMLElement>('[draggable="true"]');
    return {
      tagName: element?.tagName ?? null,
      className: element instanceof HTMLElement ? element.className : null,
      itemId: card?.dataset.pbItemId ?? null,
      draggableTagName: draggable?.tagName ?? null,
      draggableClassName: draggable?.className ?? null,
      inTimeline: element?.closest(".timeline__track") !== null,
    };
  }, start);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 8, { steps: 3 });
  await page.waitForTimeout(40);
  const end = {
    x: targetBounds.x + targetBounds.width * (position === "before" ? 0.1 : 0.9),
    y: targetBounds.y + targetBounds.height / 2,
  };
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  const metrics = await page.evaluate(
    () => (window as unknown as { __cardReorderMetrics: ReorderMetrics }).__cardReorderMetrics,
  );
  return { hit, metrics };
}
