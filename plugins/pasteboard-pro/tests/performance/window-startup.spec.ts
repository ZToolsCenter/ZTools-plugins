import { expect, test } from "playwright/test";
import { waitForWindowReadyScript } from "../../apps/ztools/window-ready";

for (const mode of ["history", "empty", "history-error", "preferences-error", "editor"] as const) {
  test(`production window waits for initial content: ${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ mode, readyScript }) => {
      const w = window as any;
      let releasePreferences!: () => void;
      let releaseHistory!: () => void;
      const preferences = new Promise<void>(resolve => { releasePreferences = resolve; });
      const history = new Promise<void>(resolve => { releaseHistory = resolve; });
      w.startupTest = { releasePreferences, releaseHistory, historyRequested: false, reveals: [] };
      window.addEventListener("pasteboard-pro:window-ready", () => {
        w.startupTest.reveals.push({
          cards: document.querySelectorAll('.timeline__track [role="option"]').length,
          background: document.querySelector(".stage")?.getAttribute("style"),
          alert: document.querySelector('[role="alert"]')?.textContent,
          editor: document.querySelector("textarea") !== null,
        });
      });
      // The same script used by the native window manager, registered before Vue.
      document.addEventListener("DOMContentLoaded", () => {
        void eval(readyScript).then(() => { w.startupTest.hostReady = true; });
      });
      w.pasteboardPro = {
        getHostCompatibility: () => ({ supported: true }),
        getPlatformCapabilities: () => ({ platform: "darwin" }),
        getWindowPreferences: async () => {
          await preferences;
          if (mode === "preferences-error") throw new Error("preferences unavailable");
          return { dockEdge: "bottom", multiPasteMode: "batch", theme: {
            accentColor: "#6f61ea", background: { type: "color", color: "#123456" },
          } };
        },
        getPrivacySettings: async () => ({ pause: { paused: false } }),
        getListOrders: async () => ({}), getPasteStack: async () => undefined,
        getItemThumbnails: async () => [], prepareNativeFileDrag: async () => false,
        listPinboards: async () => [],
        searchHistory: async () => {
          w.startupTest.historyRequested = true;
          await history;
          if (mode === "history-error") throw new Error("history unavailable");
          const items = mode === "empty" ? [] : Array.from({ length: 10000 }, (_, index) => ({
            id: `item-${index}`, kind: "text", title: index === 9999 ? "needle-last" : `Record ${index}`,
            sourceDeviceId: "test", copiedAt: new Date(1800000000000 - index).toISOString(),
            updatedAt: new Date(1800000000000 - index).toISOString(),
            contentFingerprint: `sha256:${index}`, payload: { revision: String(index), text: `Clipboard record ${index}` },
            pinned: false, fieldClocks: {},
          }));
          return { items, total: items.length };
        },
      };
    }, { mode, readyScript: waitForWindowReadyScript });
    await page.goto(`/dist/index.html?${mode === "editor" ? "panel=editor&mode=create" : "shelf=1&dock=bottom"}`);
    await expect(page.locator(".stage")).toBeAttached();
    expect(await page.evaluate(() => (window as any).startupTest.hostReady)).toBeUndefined();
    expect(await page.evaluate(() => (window as any).startupTest.reveals)).toEqual([]);
    await page.evaluate(() => (window as any).startupTest.releasePreferences());
    if (mode !== "editor" && mode !== "preferences-error") {
      await expect.poll(() => page.evaluate(() => (window as any).startupTest.historyRequested)).toBe(true);
      expect(await page.evaluate(() => (window as any).startupTest.hostReady)).toBeUndefined();
      await page.evaluate(() => (window as any).startupTest.releaseHistory());
    }
    await expect.poll(() => page.evaluate(() => (window as any).startupTest.hostReady)).toBe(true);
    const reveals = await page.evaluate(() => (window as any).startupTest.reveals);
    expect(reveals).toHaveLength(1);
    if (mode.endsWith("error")) {
      expect(reveals[0].alert).toContain("加载失败");
    } else {
      expect(reveals[0].background).toContain("#123456");
      if (mode === "history") {
        expect(reveals[0].cards).toBeGreaterThanOrEqual(30);
        expect(reveals[0].cards).toBeLessThanOrEqual(50);
        await page.getByRole("searchbox").fill("needle-last");
        await expect(page.locator('.timeline__track [role="option"]')).toHaveCount(1);
        await expect(page.locator('[data-pb-item-id="item-9999"]')).toBeVisible();
      } else if (mode === "empty") expect(reveals[0].cards).toBe(0);
      else expect(reveals[0].editor).toBe(true);
    }
    // A host whose callback arrives after Vue is ready must not miss the signal.
    expect(await page.evaluate(waitForWindowReadyScript)).toBe(true);
    expect(errors).toEqual([]);
  });
}
