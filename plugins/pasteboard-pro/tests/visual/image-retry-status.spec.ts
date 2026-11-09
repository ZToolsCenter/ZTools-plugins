import { expect, test, type Browser, type Page } from "playwright/test";

import type { MirrorImageRetrySummary } from "../../apps/ztools/preload/mirror-image-retry-types";
import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../../apps/ztools/preload/window-preferences";
import {
  attachSettingsHost,
  MemoryZToolsDatabase,
  openSettingsTab,
  settingsTestBaseUrl,
} from "./settings-test-host";

type RetryMode = "live" | "deferred" | "reject";

type RetryBrowserState = {
  __imageRetrySummary?: MirrorImageRetrySummary;
  __imageRetryMode?: RetryMode;
  __imageRetryError?: string;
  __imageRetryResolve?: (summary: MirrorImageRetrySummary) => void;
  __imageRetryRequests?: number;
};

const summary = (
  pending: number,
  failed: number,
): MirrorImageRetrySummary => ({ pending, failed, total: pending + failed, capacity: 4096 });

async function openPrivacyPanel(
  browser: Browser,
  uiVersion: "modern" | "classic",
): Promise<Readonly<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }>> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const database = new MemoryZToolsDatabase();
  const preferences = new ZToolsWindowPreferencesStore(database, {
    deviceId: `image-retry-status-${uiVersion}`,
  });
  await preferences.put({ ...defaultWindowPreferences, uiVersion });
  await attachSettingsHost(page, database, preferences);
  await openSettingsTab(page, "privacy");
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
  return { context, page };
}

async function installRetryBridge(
  page: Page,
  initialSummary: MirrorImageRetrySummary,
): Promise<void> {
  await page.evaluate((value) => {
    const host = window as unknown as { pasteboardPro?: Record<string, unknown> };
    const state = window as unknown as RetryBrowserState;
    if (host.pasteboardPro === undefined) {
      throw new Error("Settings test host bridge is missing");
    }
    state.__imageRetrySummary = value;
    state.__imageRetryMode = "live";
    state.__imageRetryRequests = 0;
    Object.assign(host.pasteboardPro, {
      getImageRetryStatus: async (): Promise<MirrorImageRetrySummary> => {
        if (state.__imageRetryMode === "reject") {
          throw new Error(state.__imageRetryError ?? "fixture status error");
        }
        if (state.__imageRetryMode === "deferred") {
          return new Promise((resolve) => { state.__imageRetryResolve = resolve; });
        }
        return state.__imageRetrySummary ?? { pending: 0, failed: 0, total: 0, capacity: 4096 };
      },
      requestImageRetry: () => {
        state.__imageRetryRequests = (state.__imageRetryRequests ?? 0) + 1;
      },
    });
  }, initialSummary);
}

async function changeRetryState(
  page: Page,
  state: Readonly<{
    mode: RetryMode;
    summary?: MirrorImageRetrySummary;
    error?: string;
    notify?: boolean;
  }>,
): Promise<void> {
  await page.evaluate((next) => {
    const testWindow = window as unknown as RetryBrowserState;
    testWindow.__imageRetryMode = next.mode;
    if (next.error === undefined) delete testWindow.__imageRetryError;
    else testWindow.__imageRetryError = next.error;
    if (next.summary !== undefined) testWindow.__imageRetrySummary = next.summary;
    if (next.notify !== false) {
      window.dispatchEvent(new Event("pasteboard-pro:history-changed"));
    }
  }, state);
}

async function resolveDeferredStatus(
  page: Page,
  next: MirrorImageRetrySummary,
): Promise<void> {
  await page.evaluate((value) => {
    const testWindow = window as unknown as RetryBrowserState;
    testWindow.__imageRetryResolve?.(value);
    delete testWindow.__imageRetryResolve;
  }, next);
}

for (const uiVersion of ["modern", "classic"] as const) {
  test(`${uiVersion} privacy panel renders image retry states and waits for owner completion`, async ({ browser }) => {
    const { context, page } = await openPrivacyPanel(browser, uiVersion);
    const card = page.locator(".image-retry-status");
    const liveStatus = card.locator(".image-retry-status__summary");
    const privateFailure = "/private/source/path and clipboard body";

    try {
      await expect(liveStatus).toHaveAttribute("role", "status");
      await expect(liveStatus).toHaveAttribute("aria-live", "polite");
      await expect(liveStatus).toHaveAttribute("aria-busy", "false");
      await expect(liveStatus).toContainText("当前版本暂不支持查看图片保存状态。");

      await installRetryBridge(page, summary(2, 1));
      await page.evaluate(() => window.dispatchEvent(new Event("pasteboard-pro:history-changed")));
      await expect(liveStatus).toContainText("待重试 2 张");
      await expect(liveStatus).toContainText("保存失败 1 张");
      await expect(liveStatus).toContainText("原图片仍可访问时可重试");
      await expect(liveStatus).toContainText("重试不会恢复已失效的源图片");
      await expect(liveStatus).toContainText("重试会按已保存的隐私规则处理。");
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/pasteboardpro/image-retry-status-ui/image-retry-${uiVersion}.png`,
        fullPage: true,
        animations: "disabled",
      });

      await changeRetryState(page, { mode: "deferred", notify: false });
      const contentRules = page.locator("#privacy-panel textarea");
      await contentRules.focus();
      await page.keyboard.press("Tab");
      const retryButton = card.getByRole("button", { name: "重试保存", exact: true });
      await expect(retryButton).toBeFocused();
      expect(await retryButton.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
      await expect(retryButton).toHaveCSS("outline-style", "solid");

      await page.keyboard.press("Enter");
      await expect(card).toContainText("已请求重试");
      await expect(liveStatus).toContainText("正在刷新图片保存状态…");
      await expect(liveStatus).toHaveAttribute("aria-busy", "true");
      await expect(retryButton).toBeDisabled();
      await expect(card).toContainText("正在读取最新状态，请稍候。");
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as RetryBrowserState).__imageRetryRequests,
      )).toBe(1);
      expect(await page.evaluate(() =>
        (window as unknown as RetryBrowserState).__imageRetrySummary,
      )).toEqual(summary(2, 1));
      await expect(card).not.toContainText(/已保存/);

      await changeRetryState(page, { mode: "live", summary: summary(0, 0) });
      await expect(liveStatus).toContainText("当前没有待重试图片");
      await expect(liveStatus).toHaveAttribute("aria-busy", "false");
      await expect(card.getByRole("button", { name: "重试保存" })).toHaveCount(0);

      await resolveDeferredStatus(page, summary(2, 1));
      await expect(liveStatus).toContainText("当前没有待重试图片");
      await expect(liveStatus).not.toContainText("待重试 2 张");
      await expect(card).toContainText("已请求重试");
      await expect(card).not.toContainText(/已保存/);

      await changeRetryState(page, { mode: "live", summary: summary(1, 1) });
      await expect(liveStatus).toContainText("待重试 1 张");
      await expect(liveStatus).toContainText("保存失败 1 张");
      await changeRetryState(page, { mode: "live", summary: summary(0, 0) });
      await expect(liveStatus).toContainText("当前没有待重试图片");

      await changeRetryState(page, { mode: "reject", error: privateFailure });
      await expect(liveStatus).toContainText("暂时无法读取图片保存状态，请稍后重试。");
      await expect(liveStatus).not.toContainText(privateFailure);
      await expect(liveStatus).not.toContainText("当前没有待重试图片");
    } finally {
      await context.close();
    }
  });
}
