import { expect, test, type Page } from "playwright/test";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });
const base = "http://127.0.0.1:5179";

async function openShelf(page: Page, mode: "queue" | "batch" = "queue", supportsGlobalQueue = true): Promise<void> {
  await page.addInitScript(({ mode, supportsGlobalQueue }) => {
    const noop = async () => undefined;
    const items = Array.from({ length: 4 }, (_, index) => ({
      id: `item-${index}`, kind: "text", title: `Record ${index}`,
      sourceDeviceId: "queue-test", copiedAt: new Date(1800000000000 - index).toISOString(),
      updatedAt: new Date(1800000000000 - index).toISOString(),
      contentFingerprint: `sha256:queue-test:${index}`,
      payload: { revision: `r${index}`, text: `Clipboard record ${index}` },
      pinned: false, fieldClocks: {},
    }));
    const metrics = {
      stack: { direction: "forward", itemIds: [] as string[] },
      saved: [] as { direction: string; itemIds: string[] }[],
      closes: 0,
      failNext: false,
      pasted: [] as string[],
      contents: [] as unknown[],
    };
    Object.defineProperty(window, "queueTest", { value: metrics });
    window.close = () => { metrics.closes += 1; };
    Object.defineProperty(window, "pasteboardPro", { value: {
      getHostCompatibility: () => ({ supported: true }),
      getPlatformCapabilities: () => ({ platform: "darwin", supportsGlobalPasteQueue: supportsGlobalQueue }),
      getWindowPreferences: async () => ({ dockEdge: "bottom", uiVersion: "modern", multiPasteMode: mode,
        theme: { accentColor: "#7961ed", background: { type: "default" } } }),
      getPrivacySettings: noop, getSyncSettings: noop, getListOrders: async () => ({}),
      getPasteStack: async () => structuredClone(metrics.stack),
      savePasteStack: async (next: typeof metrics.stack) => {
        if (metrics.failNext) { metrics.failNext = false; throw new Error("fixture queue save failed"); }
        metrics.stack = structuredClone(next);
        metrics.saved.push(structuredClone(next));
        return structuredClone(next);
      },
      listPinboards: async () => [], searchHistory: async () => ({ items, total: items.length }),
      getItemThumbnails: async () => [], prepareNativeFileDrag: async () => false,
      pasteItem: async (id: string) => { metrics.pasted.push(id); return { status: "pasted" }; },
      pasteContent: async (content: unknown) => { metrics.contents.push(content); return { status: "pasted" }; },
      openPanel: () => undefined,
    } });
  }, { mode, supportsGlobalQueue });
  await page.goto(`${base}/?shelf=1&dock=bottom`, { waitUntil: "networkidle" });
  await expect(page.getByRole("option")).toHaveCount(4);
}

test("multi-selection is reflected in the queue count before confirmation", async ({ page }) => {
  await openShelf(page);
  await page.locator('[data-pb-item-id="item-0"]').click();
  await page.locator('[data-pb-item-id="item-2"]').click({ modifiers: ["Meta"] });
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator(".modern-stack__count")).toHaveText("2");
});

type QueueMetrics = {
  stack: { direction: string; itemIds: string[] };
  saved: { direction: string; itemIds: string[] }[];
  closes: number;
  failNext: boolean;
  pasted: string[];
  contents: unknown[];
};
async function metrics(page: Page): Promise<QueueMetrics> {
  return page.evaluate(() => (window as unknown as { queueTest: QueueMetrics }).queueTest);
}
async function selectPair(page: Page): Promise<void> {
  await page.locator('[data-pb-item-id="item-0"]').click();
  await page.locator('[data-pb-item-id="item-2"]').click({ modifiers: ["Meta"] });
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator(".modern-stack__count")).toHaveText("2");
}

test("selection count follows toggle and range selection without arming a queue", async ({ page }) => {
  await openShelf(page);
  await selectPair(page);
  expect((await metrics(page)).saved).toEqual([]);
  await page.locator('[data-pb-item-id="item-2"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".modern-stack__count")).toHaveText("0");
  await page.locator('[data-pb-item-id="item-0"]').click();
  await page.locator('[data-pb-item-id="item-3"]').click({ modifiers: ["Shift"] });
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(4);
  await expect(page.locator(".modern-stack__count")).toHaveText("4");
  expect((await metrics(page)).saved).toEqual([]);
});

test("joining the queue persists the selection and chosen direction", async ({ page }) => {
  await openShelf(page, "batch");
  await selectPair(page);
  await page.getByRole("button", { name: /切换队列方向/ }).click();
  await expect.poll(async () => (await metrics(page)).stack.direction).toBe("reverse");
  await page.locator(".modern-stack__direction").click();
  await expect.poll(async () => (await metrics(page)).stack).toEqual({ direction: "reverse", itemIds: ["item-0", "item-2"] });
  await expect.poll(async () => (await metrics(page)).closes).toBe(1);
});

test("clear removes pending selection and the active queue", async ({ page }) => {
  await openShelf(page);
  await selectPair(page);
  await page.getByRole("button", { name: "清空粘贴队列", exact: true }).click();
  await expect(page.locator(".modern-stack__count")).toHaveText("0");
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
  await selectPair(page);
  await page.locator(".modern-stack__direction").click();
  await expect.poll(async () => (await metrics(page)).stack.itemIds.length).toBe(2);
  await page.getByRole("button", { name: "清空粘贴队列", exact: true }).click();
  await expect.poll(async () => (await metrics(page)).stack.itemIds).toEqual([]);
  await expect(page.locator(".modern-stack__count")).toHaveText("0");
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
});

test("a failed queue save keeps selection and the window open for retry", async ({ page }) => {
  await openShelf(page);
  await selectPair(page);
  await page.evaluate(() => { (window as unknown as { queueTest: QueueMetrics }).queueTest.failNext = true; });
  await page.locator(".modern-stack__direction").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("fixture queue save failed");
  expect((await metrics(page)).closes).toBe(0);
  expect((await metrics(page)).stack.itemIds).toEqual([]);
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2);
  await dialog.getByRole("button", { name: "创建 2 项队列", exact: true }).click();
  await expect.poll(async () => (await metrics(page)).stack.itemIds.length).toBe(2);
  await expect.poll(async () => (await metrics(page)).closes).toBe(1);
});

test("native consumption count wins over the original multi-selection", async ({ page }) => {
  await openShelf(page);
  await selectPair(page);
  await page.locator(".modern-stack__direction").click();
  await expect.poll(async () => (await metrics(page)).stack.itemIds.length).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pasteboard-pro:paste-stack-changed", { detail: { direction: "forward", itemIds: ["item-2"] } })));
  await expect(page.locator(".modern-stack__count")).toHaveText("1");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pasteboard-pro:paste-stack-changed", { detail: { direction: "forward", itemIds: [] } })));
  await expect(page.locator(".modern-stack__count")).toHaveText("0");
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
});

for (const mode of ["batch", "queue"] as const) {
  test(`${mode} Enter preserves the configured multi-paste behavior`, async ({ page }) => {
    await openShelf(page, mode);
    await selectPair(page);
    await page.keyboard.press("Enter");
    if (mode === "batch") {
      await expect.poll(async () => (await metrics(page)).contents.length).toBe(1);
      expect((await metrics(page)).saved).toEqual([]);
    } else {
      await expect.poll(async () => (await metrics(page)).stack.itemIds).toEqual(["item-0", "item-2"]);
      expect((await metrics(page)).contents).toEqual([]);
    }
  });
}

test("pending queue controls fit a narrow toolbar with expanded search", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 360 });
  await openShelf(page);
  await selectPair(page);
  await page.locator(".search-bar").click();
  await page.locator(".search-bar").evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  for (const control of [page.getByRole("button", { name: "更多操作", exact: true }), page.getByRole("button", { name: /切换队列方向/ }), page.getByRole("button", { name: "清空粘贴队列", exact: true })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(381);
  }
});

for (const action of ["join", "enter"] as const) {
  test(`non-global platform explains queue limits without pasting for ${action}`, async ({ page }) => {
    await openShelf(page, "queue", false);
    await selectPair(page);
    if (action === "join") await page.locator(".modern-stack__direction").click();
    else await page.locator('[data-pb-item-id="item-2"]').focus().then(() => page.keyboard.press("Enter"));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert").first()).toContainText("当前平台暂不支持逐项粘贴队列，请分次选择粘贴");
    await expect(dialog.getByRole("button", { name: /创建 .*项队列/ })).toHaveCount(0);
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2);
    expect((await metrics(page)).pasted).toEqual([]);
    expect((await metrics(page)).contents).toEqual([]);
    expect((await metrics(page)).closes).toBe(0);
    expect((await metrics(page)).stack.itemIds).toEqual([]);
  });
}
