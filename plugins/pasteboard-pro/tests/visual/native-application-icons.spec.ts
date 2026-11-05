import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "playwright/test";

import { ApplicationCatalogService } from "../../apps/ztools/preload/application-catalog";
import { SourceAppIconService } from "../../apps/ztools/preload/source-app-icons";
import { defaultPrivacySettings, ZToolsPrivacySettingsStore } from "../../apps/ztools/preload/privacy";
import { ZToolsWindowPreferencesStore } from "../../apps/ztools/preload/window-preferences";
import { attachSettingsHost, MemoryZToolsDatabase, openSettingsTab } from "./settings-test-host";

const addonPath = process.env.PASTEBOARD_PRO_NATIVE_ICON_ADDON;
test.skip(process.platform !== "darwin" || !addonPath, "Opt in with the ZTools macOS native icon addon path.");

test("renders real macOS system application icons through the picker", async ({ browser }) => {
  const requireAddon = createRequire(join(process.cwd(), "package.json"));
  const native = requireAddon(addonPath!) as { getFileIcon(path: string): Promise<Buffer> };
  const catalog = new ApplicationCatalogService();
  const inventory = await catalog.listApplications();
  const systemIds = new Set(["com.apple.preview", "com.apple.textedit", "com.apple.calculator", "com.apple.terminal"]);
  const applications = inventory.applications.filter(app => systemIds.has(app.bundleId.toLowerCase()));
  expect(applications.length).toBeGreaterThanOrEqual(3);

  const imageHashes = new Set<string>();
  const extractedPaths = new Set<string>();
  const icons = new SourceAppIconService({
    platform: "darwin",
    resolveApplicationPath: identity => catalog.getCachedApplicationPath(identity.bundleId),
    getFileIcon: async applicationPath => {
      const png = await native.getFileIcon(applicationPath);
      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      imageHashes.add(createHash("sha256").update(png).digest("hex"));
      extractedPaths.add(applicationPath);
      return `data:image/png;base64,${png.toString("base64")}`;
    },
  });
  const database = new MemoryZToolsDatabase();
  await new ZToolsPrivacySettingsStore(database).put({
    ...structuredClone(defaultPrivacySettings),
    rules: { ...structuredClone(defaultPrivacySettings.rules), ignoredBundleIds: applications.slice(0, 2).map(app => app.bundleId) },
  });
  const preferences = new ZToolsWindowPreferencesStore(database, { deviceId: "native-icon-probe" });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  try {
    await attachSettingsHost(page, database, preferences, {
      listApplications: async () => ({ supported: true, applications }),
      getSourceAppIcon: sourceApp => icons.getSourceAppIcon(sourceApp),
    });
    await openSettingsTab(page, "privacy");
    await expect(page.locator(".blocked-app-select__chips img")).toHaveCount(2);
    await page.getByRole("combobox", { name: "搜索应用" }).click();
    const list = page.getByRole("listbox", { name: "可屏蔽应用" });
    await expect(list).toBeVisible();
    for (const application of applications) {
      const row = list.getByRole("option", { name: `${application.name}, ${application.bundleId}`, exact: true });
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator("img")).toBeVisible();
    }
    await expect.poll(() => extractedPaths.size).toBe(applications.length);
    await expect(list.locator("img")).toHaveCount(applications.length);
    expect(imageHashes.size).toBe(applications.length);
    await expect.poll(() => page.locator(".blocked-app-select img").evaluateAll(images => images.every(image =>
      image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    await list.evaluate(element => { element.scrollTop = 0; });
    await mkdir("artifacts/pasteboardpro/settings", { recursive: true });
    await page.screenshot({ path: "artifacts/pasteboardpro/settings/blocked-applications-native-icons.png", animations: "disabled" });
    console.info(`native icon probe: apps=${applications.length}; icons=${extractedPaths.size}; distinct=${imageHashes.size}`);
  } finally {
    await context.close();
  }
});
