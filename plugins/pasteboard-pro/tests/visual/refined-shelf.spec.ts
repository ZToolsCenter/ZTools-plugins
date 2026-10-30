import { expect, test, type Page } from "playwright/test";

const base = "http://127.0.0.1:5179";
test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

// Mock only the host boundary: render the real application and its persistence UI.
async function hostFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const noop = async () => undefined;
    const dragCalls = { prepared: [] as string[], started: [] as string[] };
    Object.defineProperty(window, "__dragCalls", { value: dragCalls });
    Object.defineProperty(window, "__closeCount", { value: 0, writable: true });
    window.close = () => { (window as unknown as { __closeCount: number }).__closeCount += 1; };
    Object.defineProperty(window, "pasteboardPro", { value: {
      getHostCompatibility: () => ({ supported: true }),
      getPlatformCapabilities: () => ({ platform: "darwin", supportsGlobalPasteQueue: true, supportsScreenCapture: false }),
      getWindowPreferences: async () => JSON.parse(localStorage.getItem("pb-refined-prefs") ?? "null") ?? undefined,
      saveWindowPreferences: async (value: unknown) => { localStorage.setItem("pb-refined-prefs", JSON.stringify(value)); return value; },
      getPrivacySettings: noop, getSyncSettings: noop, getListOrders: async () => ({}),
      getPasteStack: async () => ({ direction: "forward", itemIds: [] }),
      searchHistory: noop, listPinboards: noop, openPanel: () => undefined,
      getItemThumbnails: async () => [], savePrivacySettings: async (value: unknown) => value,
      saveSyncSettings: noop, prepareNativeFileDrag: async (id: string) => { dragCalls.prepared.push(id); return true; },
      startNativeFileDrag: (id: string) => { dragCalls.started.push(id); return true; },
    } });
  });
}

async function openShelf(page: Page, dock = "bottom"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await hostFixture(page);
  await page.goto(`${base}/?shelf=1&dock=${dock}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("option")).toHaveCount(5);
  return errors;
}

async function chooseUi(page: Page, name: "新版" | "经典版"): Promise<void> {
  await page.goto(`${base}/?panel=privacy&tab=appearance`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "外观" }).click();
  await page.locator(".ui-version-field__options label").filter({ hasText: name }).click();
  await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pb-refined-prefs") ?? "{}").uiVersion)).toBe(name === "新版" ? "modern" : "classic");
}

test("compact search, logo and collections share a row without a footer", async ({ page }) => {
  const errors = await openShelf(page);
  const search = page.locator(".search-bar");
  const brand = page.locator(".modern-toolbar__identity");
  const groups = page.getByRole("navigation", { name: "分组", exact: true });
  await expect(brand.getByText("Paste", { exact: true })).toBeVisible();
  const sb = (await search.boundingBox())!, gb = (await groups.boundingBox())!, bb = (await brand.boundingBox())!;
  expect(sb.width).toBeLessThanOrEqual(82);
  expect(bb.x).toBeLessThan(sb.x);
  expect(sb.x + sb.width).toBeLessThanOrEqual(gb.x);
  expect(Math.abs(sb.y + sb.height / 2 - gb.y - gb.height / 2)).toBeLessThan(5);
  await expect(page.locator(".pinboards__hint")).toBeHidden();
  await expect(page.locator(".status")).toHaveClass(/visually-hidden/);
  const box = (await page.locator(".shelf").boundingBox())!;
  expect(box.y + box.height).toBe(360);
  await page.screenshot({ path: "artifacts/pasteboardpro/refined-dark.png" });
  expect(errors).toEqual([]);
});

test("search expands, filters content and consumes Escape before closing the shelf", async ({ page }) => {
  const errors = await openShelf(page);
  await page.locator(".search-bar").click();
  const input = page.getByRole("searchbox");
  await expect(input).toBeFocused();
  await input.fill("invoice");
  await expect(page.getByRole("option")).toHaveCount(3);
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true, bubbles: true });
  await expect(input).toHaveValue("invoice");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(5);
  await input.press("Escape");
  await expect(page.locator(".search-bar")).not.toHaveClass(/search-bar--expanded/);
  expect(await page.evaluate(() => (window as unknown as { __closeCount: number }).__closeCount)).toBe(0);
  await page.keyboard.press("Meta+f");
  await expect(input).toBeFocused();
  await expect(page.locator(".search-bar")).toHaveClass(/search-bar--expanded/);
  expect(errors).toEqual([]);
});

test("an empty expanded search keeps collection clicks stable while collapsing", async ({ page }) => {
  const errors = await openShelf(page);
  await page.locator(".search-bar").click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.locator(".search-bar")).not.toHaveClass(/search-bar--expanded/);
  expect(errors).toEqual([]);
});

test("filter popover is inside the window, preserves free text and dismisses cleanly", async ({ page }) => {
  const errors = await openShelf(page);
  await page.locator(".search-bar").click();
  await page.getByRole("searchbox").fill("invoice");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "筛选剪贴板历史" });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(361);
  await dialog.getByRole("button", { name: "图片", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue(/invoice.*type:image/);
  await dialog.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("invoice");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("Dragging modern file previews directly exports without reordering", async ({ page }) => {
  const errors = await openShelf(page);
  const preview = page.locator('.modern-preview--file');
  await expect(preview).toHaveAttribute("draggable", "true");
  await preview.dispatchEvent("pointerdown");
  const prevented = await preview.evaluate(element => {
    const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const calls = await page.evaluate(() => (window as unknown as { __dragCalls: { prepared: string[]; started: string[] } }).__dragCalls);
  expect(calls.prepared).toContain("files-item");
  expect(calls.started).toEqual(["files-item"]);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("settings persists classic and modern modes across reloads", async ({ page }) => {
  const errors = await openShelf(page);
  await chooseUi(page, "经典版");
  await page.goto(`${base}/?shelf=1&dock=bottom`, { waitUntil: "networkidle" });
  await expect(page.locator(".shelf--modern")).toHaveCount(0);
  await expect(page.locator(".toolbar .brand")).toBeVisible();
  await expect(page.locator(".pinboards__hint")).toBeVisible();
  await page.screenshot({ path: "artifacts/pasteboardpro/classic-dark.png" });
  await chooseUi(page, "新版");
  await page.goto(`${base}/?shelf=1&dock=bottom`, { waitUntil: "networkidle" });
  await expect(page.locator(".shelf--modern")).toBeVisible();
  await expect(page.locator(".modern-toolbar")).toBeVisible();
  await expect(page.locator(".pinboards__hint")).toBeHidden();
  expect(errors).toEqual([]);
});

for (const width of [380, 800]) {
  test(`controls stay in view at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 360 });
    const errors = await openShelf(page);
    for (const locator of [page.locator(".modern-toolbar__identity img"), page.getByRole("button", { name: "更多操作", exact: true }), page.locator(".modern-filter-button")]) {
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await page.locator(".search-bar").click();
    await expect.poll(async () => {
      const more = (await page.getByRole("button", { name: "更多操作", exact: true }).boundingBox())!;
      return more.x + more.width;
    }).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `artifacts/pasteboardpro/refined-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test("light mode and vertical dock retain usable cards", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 720 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const errors = await openShelf(page, "left");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("button", { name: "Work", exact: true }).click({ button: "right" });
  const boardMenu = page.getByRole("menu", { name: "Work 管理选项" });
  await expect(boardMenu).toBeVisible();
  await boardMenu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "重命名分组", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "重命名分组", exact: true }).press("Escape");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.getByRole("menu", { name: "更多操作" })).toBeVisible();
  await page.screenshot({ path: "artifacts/pasteboardpro/refined-side-light.png" });
  expect(errors).toEqual([]);
});
