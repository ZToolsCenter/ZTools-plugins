import { expect, test, type Page } from "playwright/test";
import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { SourceAppIconService } from "../../apps/ztools/preload/source-app-icons";

const base = "http://127.0.0.1:5179";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

async function open(page: Page, service: SourceAppIconService, sameSource = false): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("__getAppIcon", (source: { name?: string; bundleId?: string }) => service.getSourceAppIcon(source));
  await page.addInitScript(({ items, sameSource }) => {
    const noop = async () => undefined;
    const history = sameSource ? items.map(item => ({ ...item, sourceApp: { name: "Preview", bundleId: "com.apple.Preview" } })) : items;
    Object.defineProperty(window, "pasteboardPro", { value: {
      getHostCompatibility: () => ({ supported: true }),
      getPlatformCapabilities: () => ({ platform: "darwin" }),
      getWindowPreferences: noop, getPrivacySettings: noop, getSyncSettings: noop,
      getListOrders: async () => ({}), getPasteStack: noop,
      getItemThumbnails: async () => [], prepareNativeFileDrag: async () => false,
      listPinboards: async () => [], openPanel: () => undefined,
      searchHistory: async () => ({ items: history, total: history.length }),
      getSourceAppIcon: (source: { name?: string; bundleId?: string }) =>
        (window as unknown as { __getAppIcon(source: unknown): Promise<string | undefined> }).__getAppIcon(source),
    } });
  }, { items: structuredClone(historyFixture), sameSource });
  await page.goto(`${base}/?shelf=1&dock=bottom`, { waitUntil: "networkidle" });
  await expect(page.getByRole("option")).toHaveCount(5);
  return errors;
}

test("source icons load once per app and keep the existing 21px header layout", async ({ page }) => {
  const nativeReads = new Map<string, number>();
  const service = new SourceAppIconService({
    platform: "darwin",
    resolveApplicationPath: source => `/Applications/${source.name}.app`,
    getFileIcon: applicationPath => { nativeReads.set(applicationPath, (nativeReads.get(applicationPath) ?? 0) + 1); return png; },
  });
  const errors = await open(page, service, true);
  const icons = page.locator("img.modern-card-source__icon");
  await expect(icons).toHaveCount(5);
  await expect.poll(() => icons.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth === 1))).toBe(true);
  for (const icon of await icons.all()) {
    const box = (await icon.boundingBox())!;
    expect(box.width).toBe(21);
    expect(box.height).toBe(21);
  }
  // DEV seeds five distinct source apps before the host snapshot arrives.
  expect(nativeReads.get("/Applications/Preview.app")).toBe(1);
  expect([...nativeReads.values()].every(count => count === 1)).toBe(true);
  await page.locator(".search-bar").click();
  await page.getByRole("searchbox").fill("invoice");
  await expect(page.getByRole("option")).toHaveCount(3);
  // DEV seeds five distinct source apps before the host snapshot arrives.
  expect(nativeReads.get("/Applications/Preview.app")).toBe(1);
  expect([...nativeReads.values()].every(count => count === 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("unavailable, remote, broken and failed icons retain the source initial", async ({ page }) => {
  const service = new SourceAppIconService({
    platform: "darwin",
    resolveApplicationPath: source => {
      if (source.name === "TextEdit") throw new Error("fixture application missing");
      return `/Applications/${source.name}.app`;
    },
    getFileIcon: applicationPath => {
      if (applicationPath.includes("Preview")) return png;
      if (applicationPath.includes("Google Chrome")) return undefined;
      if (applicationPath.includes("Finder")) return "https://example.test/app-icon.png";
      return "data:image/png;base64,aGVsbG8=";
    },
  });
  const errors = await open(page, service);
  await expect(page.locator('[data-pb-item-id="image-new"] img.modern-card-source__icon')).toBeVisible();
  for (const [id, initial] of [["url-middle", "G"], ["files-item", "F"], ["color-item", "F"], ["text-old", "T"]]) {
    await expect(page.locator(`[data-pb-item-id="${id}"] span.modern-card-source__icon`)).toHaveText(initial!);
    await expect(page.locator(`[data-pb-item-id="${id}"] img.modern-card-source__icon`)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
