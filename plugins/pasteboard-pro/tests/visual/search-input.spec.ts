import { expect, test, type Page } from "playwright/test";
import { historyFixture, pinboardFixture } from "@pasteboard-pro/contract-fixtures";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark", contextOptions: { reducedMotion: "reduce" } });
const base = "http://127.0.0.1:5179";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", error => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

type Metrics = { requests: { query: string; pinboardId?: string }[]; copies: string[]; failNext: boolean };
async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => (window as unknown as { searchMetrics: Metrics }).searchMetrics);
}
async function open(page: Page, paged = true, delay = 0): Promise<void> {
  await page.addInitScript(({ items, pinboards, paged, delay }) => {
    const noop = async () => undefined;
    const requests: { query: string; pinboardId?: string }[] = [];
    const metrics = { requests, copies: [] as string[], failNext: false };
    Object.defineProperty(window, "searchMetrics", { value: metrics });
    window.close = () => undefined;
    const host = {
      getHostCompatibility: () => ({ supported: true }),
      getPlatformCapabilities: () => ({ platform: "darwin" }),
      getWindowPreferences: noop, getPrivacySettings: noop, getSyncSettings: noop,
      getListOrders: async () => ({}), getPasteStack: noop,
      getItemThumbnails: async () => [], prepareNativeFileDrag: async () => false,
      listPinboards: async () => pinboards, openPanel: () => undefined,
      copyItem: async (id: string) => { metrics.copies.push(id); },
      searchHistory: async () => { requests.push({ query: "" }); return { items, total: items.length }; },
      ...(paged ? { searchHistoryPage: async (request: { query?: string; pinboardId?: string }) => {
        const query = request.query ?? "";
        requests.push({ query, ...(request.pinboardId ? { pinboardId: request.pinboardId } : {}) });
        if (metrics.failNext) { metrics.failNext = false; throw new Error("fixture search failed"); }
        if (delay && query) await new Promise(resolve => setTimeout(resolve, delay));
        const matches = items.filter(item =>
          (!request.pinboardId || item.pinboardId === request.pinboardId) &&
          [item.title, item.payload.text, item.ocrText].join(" ").toLowerCase().includes(query.toLowerCase()),
        );
        return { items: matches, total: matches.length };
      } } : {}),
    };
    Object.defineProperty(window, "pasteboardPro", { value: host });
  }, { items: structuredClone(historyFixture), pinboards: structuredClone(pinboardFixture), paged, delay });
  await page.goto(`${base}/?shelf=1&dock=bottom`, { waitUntil: "networkidle" });
  await expect(page.getByRole("option")).toHaveCount(5);
  await page.locator(".search-bar").click();
}
async function freeze(page: Page): Promise<void> {
  const time = new Date("2026-10-25T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
}

test("300ms debounce keeps input immediate and merges duplicate input events", async ({ page }) => {
  await open(page);
  await freeze(page);
  const input = page.getByRole("searchbox");
  for (const query of ["i", "inv", "invoice"]) {
    await input.fill(query);
    await expect(input).toHaveValue(query);
    await page.clock.runFor(100);
  }
  expect((await metrics(page)).requests).toHaveLength(1);
  await page.clock.runFor(199);
  expect((await metrics(page)).requests).toHaveLength(1);
  await page.clock.runFor(1);
  expect((await metrics(page)).requests.map(request => request.query)).toEqual(["", "invoice"]);
  await input.dispatchEvent("input");
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(2);
});

test("continuous typing is bounded by the 1000ms maximum wait", async ({ page }) => {
  await open(page);
  await freeze(page);
  for (let index = 0; index < 10; index++) {
    await page.getByRole("searchbox").fill(`invoice ${index}`);
    await page.clock.runFor(100);
  }
  expect((await metrics(page)).requests.map(request => request.query)).toEqual(["", "invoice 9"]);
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(2);
});

test("collection and history refresh consume the pending search once", async ({ page }) => {
  await open(page);
  await freeze(page);
  await page.getByRole("searchbox").fill("invoice");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toEqual([{ query: "" }, { query: "invoice", pinboardId: "board-work" }]);
  await page.getByRole("searchbox").fill("Accounts");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed")));
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(3);
  expect((await metrics(page)).requests.at(-1)?.query).toBe("Accounts");
});

test("clearing restores results immediately and cancels delayed work", async ({ page }) => {
  await open(page);
  await freeze(page);
  await page.getByRole("searchbox").fill("invoice");
  await page.clock.runFor(100);
  await page.getByRole("searchbox").fill("");
  await expect(page.getByRole("option")).toHaveCount(5);
  expect((await metrics(page)).requests.map(request => request.query)).toEqual(["", ""]);
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(2);
});

for (const paged of [true, false]) {
  test(`${paged ? "paged" : "local"} keyboard navigation flushes the latest query`, async ({ page }) => {
    await open(page, paged);
    await freeze(page);
    await page.getByRole("searchbox").fill("Accounts");
    await expect(page.getByRole("option")).toHaveCount(0);
    await page.getByRole("searchbox").press("ArrowLeft");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.locator('[data-pb-item-id="text-old"]')).toBeFocused();
    await page.clock.runFor(1_000);
    expect((await metrics(page)).requests).toHaveLength(paged ? 2 : 1);
  });
}

test("navigation waits for an in-flight IPC without reissuing the search", async ({ page }) => {
  await open(page, true, 500);
  await freeze(page);
  const input = page.getByRole("searchbox");
  await input.fill("Accounts");
  await page.clock.runFor(300);
  expect((await metrics(page)).requests).toHaveLength(2);
  await input.press("ArrowLeft");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.clock.runFor(500);
  await expect(page.locator('[data-pb-item-id="text-old"]')).toBeFocused();
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(2);
});

test("local pending queries clear old selection before copy shortcuts", async ({ page }) => {
  await open(page, false);
  await freeze(page);
  await page.getByRole("searchbox").fill("Accounts");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.locator("main").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Meta+c");
  expect((await metrics(page)).copies).toEqual([]);
  await page.clock.runFor(300);
  await expect(page.getByRole("option")).toHaveCount(1);
});

test("an interrupted query leaves the busy state when explicit refresh fails", async ({ page }) => {
  await open(page);
  await freeze(page);
  await page.getByRole("searchbox").fill("invoice");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => {
    (window as unknown as { searchMetrics: Metrics }).searchMetrics.failNext = true;
    window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed"));
  });
  await expect(page.locator(".status")).toContainText("fixture search failed");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(2);
  await page.getByRole("searchbox").fill("");
  await expect(page.getByRole("option")).toHaveCount(5);
});

test("reduced motion skips the transition", async ({ page }) => {
  await open(page);
  const search = page.locator(".search-bar");
  expect(await search.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect((await search.boundingBox())!.width).toBeCloseTo(340, 0);
  await page.getByRole("searchbox").press("Escape");
  expect((await search.boundingBox())!.width).toBeCloseTo(80, 0);
});

test("IME draft survives parent refresh and submits only the committed value", async ({ page }) => {
  await open(page);
  await freeze(page);
  const input = page.getByRole("searchbox");
  await input.dispatchEvent("compositionstart");
  await input.evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = "zhong";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed")));
  await expect(input).toHaveValue("zhong");
  await input.evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = "中文";
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: false }));
  });
  await expect(input).toHaveValue("中文");
  await page.clock.runFor(300);
  expect((await metrics(page)).requests.map(request => request.query)).toEqual(["", "", "中文"]);
  await page.clock.runFor(1_000);
  expect((await metrics(page)).requests).toHaveLength(3);
});

test("search width transitions in both directions for 300ms", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  const search = page.locator(".search-bar");
  const sample = async (time: number) => search.evaluate((element, time) => {
    const animations = element.getAnimations().filter(animation =>
      animation instanceof CSSTransition && ["width", "min-width", "flex-basis", "grid-template-columns", "gap"].includes(animation.transitionProperty),
    );
    for (const animation of animations) { animation.pause(); animation.currentTime = time; }
    return { width: element.getBoundingClientRect().width, durations: animations.map(animation => animation.effect?.getTiming().duration) };
  }, time);
  const middle = await sample(100);
  const end = await sample(300);
  expect(middle.durations).toContain(300);
  expect(middle.width).toBeGreaterThan(80);
  expect(middle.width).toBeLessThan(end.width);
  expect(end.width).toBeCloseTo(340, 0);
  await page.getByRole("searchbox").press("Escape");
  const shrinking = await sample(100);
  const collapsed = await sample(300);
  expect(shrinking.width).toBeGreaterThan(collapsed.width);
  expect(shrinking.width).toBeLessThan(end.width);
  expect(collapsed.width).toBeCloseTo(80, 0);
});
