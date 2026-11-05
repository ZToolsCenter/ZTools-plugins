import { expect, test, type BrowserContext, type Page } from "playwright/test";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

const base = "http://127.0.0.1:5179";
const itemCount = 100;

type StackSnapshot = {
  direction: "forward" | "reverse";
  itemIds: string[];
};

type FixtureOptions = {
  itemKind?: "mixed" | "text";
  multiPasteMode?: "batch" | "queue";
  supportsGlobalQueue?: boolean;
  initialStack?: StackSnapshot;
  saveFailure?: "none" | "partial" | "reject";
};

type MixedBatchMetrics = {
  historyRequests: { cursor?: string; limit?: number }[];
  itemReads: string[];
  pasteItems: { id: string; kind: string }[];
  pasteContents: unknown[];
  blurEvents: number;
  stackRequests: StackSnapshot[];
  stackResults: StackSnapshot[];
  persistedStack: StackSnapshot;
  holdFirstSave: boolean;
  saveGate: SaveGate;
};

type SaveGate = {
  started: Promise<void>;
  signalStarted(): void;
  released: Promise<void>;
  release(): void;
};

function createSaveGate(): SaveGate {
  let signalStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { started, signalStarted, released, release };
}

const emptyStack = (): StackSnapshot => ({ direction: "forward", itemIds: [] });
const selectedIds = () =>
  Array.from({ length: itemCount }, (_, index) => "mixed-" + String(index).padStart(3, "0"));

function createMetrics(initialStack: StackSnapshot, holdFirstSave = false): MixedBatchMetrics {
  return {
    historyRequests: [],
    itemReads: [],
    pasteItems: [],
    pasteContents: [],
    blurEvents: 0,
    stackRequests: [],
    stackResults: [],
    persistedStack: structuredClone(initialStack),
    holdFirstSave,
    saveGate: createSaveGate(),
  };
}

async function openMixedShelf(
  page: Page,
  context: BrowserContext,
  metrics: MixedBatchMetrics,
  options: FixtureOptions = {},
): Promise<Page> {
  const fixtureOptions = {
    itemKind: options.itemKind ?? "mixed",
    multiPasteMode: options.multiPasteMode ?? "batch",
    supportsGlobalQueue: options.supportsGlobalQueue ?? true,
    initialStack: structuredClone(options.initialStack ?? emptyStack()),
    saveFailure: options.saveFailure ?? "none",
  };

  await context.exposeBinding(
    "__mixedBatchRecord",
    async (_source, action: string, value: unknown) => {
      if (action === "history") {
        metrics.historyRequests.push(value as MixedBatchMetrics["historyRequests"][number]);
      } else if (action === "read") {
        metrics.itemReads.push(value as string);
      } else if (action === "paste-item") {
        metrics.pasteItems.push(value as MixedBatchMetrics["pasteItems"][number]);
      } else if (action === "paste-content") {
        metrics.pasteContents.push(value);
      } else if (action === "blur") {
        metrics.blurEvents += 1;
      } else if (action === "stack-request") {
        metrics.stackRequests.push(structuredClone(value as StackSnapshot));
        if (metrics.holdFirstSave && metrics.stackRequests.length === 1) {
          metrics.saveGate.signalStarted();
          await metrics.saveGate.released;
        }
      } else if (action === "stack-result") {
        const saved = structuredClone(value as StackSnapshot);
        metrics.stackResults.push(saved);
        metrics.persistedStack = saved;
      }
    },
  );

  await context.addInitScript((config: typeof fixtureOptions) => {
    if (new URLSearchParams(window.location.search).get("shelf") !== "1") return;

    const record = (action: string, value: unknown) =>
      (window as unknown as {
        __mixedBatchRecord: (action: string, value: unknown) => Promise<void>;
      }).__mixedBatchRecord(action, value);
    const kinds = config.itemKind === "text" ? ["text"] as const : ["text", "url", "image", "files"] as const;
    const items = Array.from({ length: 100 }, (_, index) => {
      const id = "mixed-" + String(index).padStart(3, "0");
      const kind = kinds[index % kinds.length]!;
      const revision = "revision:" + id;
      const payload = kind === "image"
        ? { revision, blobId: "blob:" + id, mediaType: "image/png" }
        : kind === "files"
          ? { revision, filePaths: ["/tmp/" + id + ".txt"] }
          : {
              revision,
              text: kind === "url"
                ? "https://example.test/record/" + index
                : "Mixed text record " + index,
            };
      return {
        id,
        kind,
        title: "Mixed record " + index,
        sourceDeviceId: "mixed-batch-test",
        copiedAt: new Date(1_800_000_000_000 - index).toISOString(),
        updatedAt: new Date(1_800_000_000_000 - index).toISOString(),
        contentFingerprint: "sha256:mixed-batch-test:" + index,
        payload,
        pinned: false,
        fieldClocks: {},
      };
    });
    const byId = new Map(items.map(item => [item.id, item]));
    let persistedStack = structuredClone(config.initialStack);
    let saveCount = 0;

    window.addEventListener("blur", () => { void record("blur", undefined); });
    Object.defineProperty(window, "pasteboardPro", {
      value: {
        getHostCompatibility: () => ({ supported: true }),
        getPlatformCapabilities: () => ({
          platform: "darwin",
          supportsGlobalPasteQueue: config.supportsGlobalQueue,
        }),
        getWindowPreferences: async () => ({
          dockEdge: "bottom",
          uiVersion: "modern",
          multiPasteMode: config.multiPasteMode,
          theme: { accentColor: "#7961ed", background: { type: "default" } },
        }),
        getPrivacySettings: async () => undefined,
        getSyncSettings: async () => undefined,
        getListOrders: async () => ({}),
        getPasteStack: async () => structuredClone(persistedStack),
        savePasteStack: async (snapshot: StackSnapshot) => {
          const attempt = saveCount++;
          await record("stack-request", snapshot);
          if (attempt === 0 && config.saveFailure === "reject") {
            throw new Error("fixture queue save failed");
          }
          const saved = attempt === 0 && config.saveFailure === "partial"
            ? { ...structuredClone(snapshot), itemIds: snapshot.itemIds.slice(0, -1) }
            : structuredClone(snapshot);
          persistedStack = saved;
          await record("stack-result", saved);
          return structuredClone(saved);
        },
        listPinboards: async () => [],
        searchHistoryPage: async (request: { cursor?: string; limit?: number }) => {
          await record("history", {
            ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          });
          const start = request.cursor === undefined ? 0 : Number(request.cursor);
          const end = Math.min(start + (request.limit ?? 50), items.length);
          return {
            items: structuredClone(items.slice(start, end)),
            total: items.length,
            ...(end < items.length ? { nextCursor: String(end) } : {}),
          };
        },
        getHistoryItem: async (id: string) => {
          await record("read", id);
          const item = byId.get(id);
          if (item === undefined) throw new RangeError("Missing fixture item: " + id);
          return structuredClone(item);
        },
        getItemThumbnails: async () => [],
        prepareNativeFileDrag: async () => false,
        pasteItem: async (id: string) => {
          const item = byId.get(id);
          if (item === undefined) throw new RangeError("Missing fixture item: " + id);
          await record("paste-item", { id, kind: item.kind });
          return { status: "pasted" };
        },
        pasteContent: async (content: unknown) => {
          await record("paste-content", content);
          return { status: "pasted" };
        },
        openPanel: () => undefined,
      },
    });
  }, fixtureOptions);

  await page.goto(base + "/?visual=1", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "open-mixed-test-shelf";
    button.textContent = "Open mixed test shelf";
    button.style.cssText = "position:fixed;right:8px;top:8px;z-index:2147483647";
    button.onclick = () => window.open("about:blank", "_blank");
    document.body.append(button);
  });

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mixed test shelf" }).click();
  const popup = await popupPromise;
  await popup.goto(base + "/?shelf=1&dock=bottom", { waitUntil: "networkidle" });
  await popup.waitForLoadState("networkidle");
  await expect(popup.locator(".timeline__track")).toBeVisible();
  await expect.poll(() => metrics.historyRequests.length).toBe(1);
  await expect.poll(() => popup.evaluate(() => document.hasFocus())).toBe(true);
  return popup;
}

async function loadAllAndSelect(
  shelf: Page,
  metrics: MixedBatchMetrics,
  hasExistingStack = false,
): Promise<void> {
  const track = shelf.locator(".timeline__track");
  await track.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => metrics.historyRequests.length).toBe(2);
  expect(metrics.historyRequests[1]).toMatchObject({ cursor: "50", limit: 50 });

  await track.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event("scroll"));
  });
  const lastCard = shelf.locator('[data-pb-item-id="mixed-099"]');
  await expect(lastCard).toBeVisible();
  await lastCard.focus();
  await shelf.keyboard.press("Meta+A");
  if (!hasExistingStack) {
    await expect(shelf.locator(".modern-stack__count")).toHaveText(String(itemCount));
  }
}

function expectNoPasteWrites(metrics: MixedBatchMetrics): void {
  expect(metrics.pasteItems).toEqual([]);
  expect(metrics.pasteContents).toEqual([]);
}

async function openMixedNotice(
  shelf: Page,
  metrics: MixedBatchMetrics,
): Promise<void> {
  const blurBefore = metrics.blurEvents;
  await shelf.keyboard.press("Enter");
  await expect(shelf.getByRole("dialog")).toBeVisible();
  await expect(shelf.getByRole("heading", { name: "100 项内容需要逐项粘贴" })).toBeVisible();
  await expect.poll(() => metrics.itemReads.length).toBe(itemCount);
  expectNoPasteWrites(metrics);
  expect(metrics.stackRequests).toEqual([]);
  expect(metrics.blurEvents).toBe(blurBefore);
  await expect.poll(() => shelf.isClosed()).toBe(false);
}

test("mixed 100 selection opens a notice and creates the full queue only on confirmation", async ({ page, context }) => {
  const recorded = createMetrics(emptyStack());
  const shelf = await openMixedShelf(page, context, recorded);
  await loadAllAndSelect(shelf, recorded);
  await openMixedNotice(shelf, recorded);

  await expect(shelf.getByRole("dialog")).toContainText("每按一次 ⌘V");
  await shelf.getByRole("button", { name: "创建 100 项队列", exact: true }).click();
  await expect.poll(() => recorded.stackRequests.length).toBe(1);
  await expect.poll(() => shelf.isClosed()).toBe(true);
  expect(recorded.stackRequests[0]).toEqual({
    direction: "forward",
    itemIds: selectedIds(),
  });
  expect(recorded.stackResults[0]).toEqual(recorded.stackRequests[0]);
  expect(recorded.persistedStack).toEqual(recorded.stackRequests[0]);
  expectNoPasteWrites(recorded);
});

test("busy queue save blocks Shelf actions and closes only after all 100 items are saved", async ({ page, context }) => {
  const recorded = createMetrics(emptyStack(), true);
  const shelf = await openMixedShelf(page, context, recorded);
  await loadAllAndSelect(shelf, recorded);
  await openMixedNotice(shelf, recorded);

  await shelf.getByRole("button", { name: "创建 100 项队列", exact: true }).click();
  await recorded.saveGate.started;
  const dialog = shelf.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "返回选择", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "正在保存队列…", exact: true })).toBeDisabled();

  const toolbarButton = shelf.locator(".modern-stack__direction");
  const toolbarBounds = await toolbarButton.boundingBox();
  if (toolbarBounds === null) throw new Error("Queue toolbar control is not visible");
  const backdropCoversToolbar = await shelf.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest(".selection-paste-backdrop") !== null,
  {
    x: toolbarBounds.x + toolbarBounds.width / 2,
    y: toolbarBounds.y + toolbarBounds.height / 2,
  });
  expect(backdropCoversToolbar).toBe(true);

  const blurBefore = recorded.blurEvents;
  await shelf.keyboard.press("Escape");
  await expect(shelf.getByRole("dialog")).toBeVisible();
  await shelf.evaluate(() => { window.dispatchEvent(new Event("blur")); });
  await expect.poll(() => recorded.blurEvents).toBe(blurBefore + 1);
  await expect.poll(() => shelf.isClosed()).toBe(false);
  expect(recorded.stackRequests).toEqual([{ direction: "forward", itemIds: selectedIds() }]);
  expect(recorded.stackResults).toEqual([]);
  expect(recorded.persistedStack).toEqual(emptyStack());
  expectNoPasteWrites(recorded);

  recorded.saveGate.release();
  await expect.poll(() => recorded.stackResults.length).toBe(1);
  await expect.poll(() => shelf.isClosed()).toBe(true);
  expect(recorded.stackResults[0]).toEqual({ direction: "forward", itemIds: selectedIds() });
  expect(recorded.persistedStack).toEqual(recorded.stackResults[0]);
  expectNoPasteWrites(recorded);
});

for (const action of ["return", "escape"] as const) {
  test("mixed paste notice " + action + " keeps all selected items and the Shelf open", async ({ page, context }) => {
    const recorded = createMetrics(emptyStack());
    const shelf = await openMixedShelf(page, context, recorded);
    await loadAllAndSelect(shelf, recorded);
    await openMixedNotice(shelf, recorded);

    if (action === "return") {
      await shelf.getByRole("button", { name: "返回选择", exact: true }).click();
    } else {
      await shelf.keyboard.press("Escape");
    }
    await expect(shelf.getByRole("dialog")).toHaveCount(0);
    await expect(shelf.locator(".modern-stack__count")).toHaveText(String(itemCount));
    await expect.poll(() => shelf.isClosed()).toBe(false);
    expectNoPasteWrites(recorded);
    expect(recorded.stackRequests).toEqual([]);
  });
}

test("platform without global queue support shows the limitation without queue action", async ({ page, context }) => {
  const recorded = createMetrics(emptyStack());
  const shelf = await openMixedShelf(page, context, recorded, { supportsGlobalQueue: false });
  await loadAllAndSelect(shelf, recorded);
  await openMixedNotice(shelf, recorded);

  await expect(shelf.getByRole("alert")).toContainText("当前平台暂不支持逐项粘贴队列");
  await expect(shelf.getByRole("dialog").getByRole("button")).toHaveCount(1);
  await expect(shelf.locator(".modern-stack__count")).toHaveText(String(itemCount));
  await expect.poll(() => shelf.isClosed()).toBe(false);
  expectNoPasteWrites(recorded);
  expect(recorded.stackRequests).toEqual([]);
});

for (const saveFailure of ["partial", "reject"] as const) {
  test("queue " + saveFailure + " failure keeps the Shelf open and restores the prior empty queue", async ({ page, context }) => {
    const initialStack: StackSnapshot = {
      direction: "reverse",
      itemIds: [],
    };
    const recorded = createMetrics(initialStack);
    const shelf = await openMixedShelf(page, context, recorded, {
      multiPasteMode: "queue",
      initialStack,
      saveFailure,
    });
    await loadAllAndSelect(shelf, recorded);
    const blurBefore = recorded.blurEvents;

    await shelf.keyboard.press("Enter");
    await expect(shelf.getByRole("dialog")).toBeVisible();
    await expect(shelf.getByRole("alert")).toContainText(
      saveFailure === "partial" ? "队列保存不完整" : "fixture queue save failed",
    );
    await expect.poll(() => recorded.stackRequests.length).toBe(2);
    await expect.poll(() => shelf.isClosed()).toBe(false);

    expect(recorded.stackRequests[0]).toEqual({
      direction: "reverse",
      itemIds: selectedIds(),
    });
    expect(recorded.stackRequests[1]).toEqual(initialStack);
    if (saveFailure === "partial") {
      expect(recorded.stackResults[0]?.itemIds).toHaveLength(itemCount - 1);
      expect(recorded.stackResults[1]).toEqual(initialStack);
    } else {
      expect(recorded.stackResults).toEqual([initialStack]);
    }
    expect(recorded.persistedStack).toEqual(initialStack);
    await expect(shelf.locator(".modern-stack__count")).toHaveText(String(itemCount));
    await expect(shelf.getByRole("button", { name: "创建 100 项队列", exact: true })).toBeVisible();
    expect(recorded.blurEvents).toBe(blurBefore);
    expectNoPasteWrites(recorded);
  });
}

test("batch pastes 100 text items with one pasteContent call", async ({ page, context }) => {
  const recorded = createMetrics(emptyStack());
  const shelf = await openMixedShelf(page, context, recorded, { itemKind: "text" });
  await loadAllAndSelect(shelf, recorded);
  await shelf.keyboard.press("Enter");

  await expect.poll(() => recorded.itemReads.length).toBe(itemCount);
  await expect.poll(() => recorded.pasteContents.length).toBe(1);
  await expect.poll(() => shelf.isClosed()).toBe(true);
  expect(recorded.pasteContents).toEqual([{
    type: "text",
    content: Array.from({ length: itemCount }, (_, index) => "Mixed text record " + index).join("\n"),
  }]);
  expect(recorded.pasteItems).toEqual([]);
});
