import { expect, test } from "playwright/test";

import {
  attachSettingsHost,
  MemoryZToolsDatabase,
  openSettingsTab,
  settingsTestBaseUrl,
  type SettingsTestWindow,
} from "./settings-test-host";
import {
  ZToolsPrivacySettingsStore,
  type PrivacySettings,
} from "../../apps/ztools/preload/privacy";
import { ZToolsWindowPreferencesStore } from "../../apps/ztools/preload/window-preferences";

test("screen sharing protection defaults off and saved choices survive failure and reopen", async ({
  browser,
}) => {
  const database = new MemoryZToolsDatabase();
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "privacy-save-regression",
  });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const primary = await context.newPage();
  const firstPanel = await context.newPage();
  await attachSettingsHost(primary, database, windowPreferencesStore);
  await attachSettingsHost(firstPanel, database, windowPreferencesStore);

  try {
    await primary.goto(`${settingsTestBaseUrl}/?visual=1`, { waitUntil: "networkidle" });
    await openSettingsTab(firstPanel, "privacy");

    const firstToggle = firstPanel.getByRole("checkbox", {
      name: "屏幕共享时隐藏浮窗",
    });
    await expect(firstToggle).not.toBeChecked();
    await firstToggle.check();
    await firstPanel
      .getByRole("button", { name: "保存设置", exact: true })
      .click();
    await expect
      .poll(() =>
        firstPanel.evaluate(() =>
          (window as unknown as SettingsTestWindow).__privacySaveCalls,
        ),
      )
      .toBe(1);
    expect(
      await firstPanel.evaluate(() =>
        (window as unknown as SettingsTestWindow).__privacySaveValues,
      ),
    ).toEqual([true]);

    await expect
      .poll(async () => (await privacyStore.get()).screenShareProtection)
      .toBe(true);
    await expect
      .poll(async () =>
        (
          await primary.evaluate(async () =>
            (window as unknown as Window & {
              pasteboardPro: {
                getPrivacySettings(): Promise<PrivacySettings>;
              };
            }).pasteboardPro.getPrivacySettings(),
          )
        ).screenShareProtection,
      )
      .toBe(true);

    const reopenedPanel = await context.newPage();
    await attachSettingsHost(reopenedPanel, database, windowPreferencesStore);
    await openSettingsTab(reopenedPanel, "privacy");
    const reopenedToggle = reopenedPanel.getByRole("checkbox", {
      name: "屏幕共享时隐藏浮窗",
    });
    await expect(reopenedToggle).toBeChecked();

    await reopenedToggle.uncheck();
    await reopenedPanel.setViewportSize({ width: 380, height: 760 });
    database.failNextPutFor(
      "pasteboard-pro:settings:privacy",
      "controlled privacy database save failure",
    );
    await reopenedPanel
      .getByRole("button", { name: "保存设置", exact: true })
      .click();
    const saveError = reopenedPanel.getByRole("alert");
    await expect(saveError).toBeVisible();
    await expect(saveError).toContainText(
      "controlled privacy database save failure",
    );
    await expect(reopenedToggle).not.toBeChecked();
    await expect
      .poll(async () => (await privacyStore.get()).screenShareProtection)
      .toBe(true);

    await reopenedPanel
      .getByRole("button", { name: "保存设置", exact: true })
      .click();
    await expect
      .poll(async () => (await privacyStore.get()).screenShareProtection)
      .toBe(false);
    await expect
      .poll(async () =>
        (
          await primary.evaluate(async () =>
            (window as unknown as Window & {
              pasteboardPro: {
                getPrivacySettings(): Promise<PrivacySettings>;
              };
            }).pasteboardPro.getPrivacySettings(),
          )
        ).screenShareProtection,
      )
      .toBe(false);

    const finalPanel = await context.newPage();
    await attachSettingsHost(finalPanel, database, windowPreferencesStore);
    await openSettingsTab(finalPanel, "privacy");
    await expect(
      finalPanel.getByRole("checkbox", { name: "屏幕共享时隐藏浮窗" }),
    ).not.toBeChecked();
  } finally {
    await context.close();
  }
});
