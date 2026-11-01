import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "playwright/test";

import {
  attachSettingsHost,
  MemoryZToolsDatabase,
  openSettingsTab,
  settingsTestBaseUrl,
  type SettingsTabId,
  type SettingsTestWindow,
} from "./settings-test-host";
import { ZToolsPrivacySettingsStore } from "../../apps/ztools/preload/privacy";
import { ZToolsWindowPreferencesStore } from "../../apps/ztools/preload/window-preferences";

const settingsTabs: readonly Readonly<{ id: SettingsTabId; label: string }>[] = [
  { id: "general", label: "通用" },
  { id: "appearance", label: "外观" },
  { id: "privacy", label: "隐私" },
  { id: "sync", label: "同步" },
];

const settingsArtifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "settings",
);

async function chooseRadio(radio: Locator): Promise<void> {
  await radio.locator("xpath=..").click();
  await expect(radio).toBeChecked();
}

async function assertPanelLayout(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".settings-panel");
    const titlebar = document.querySelector<HTMLElement>(".settings-titlebar");
    const footer = document.querySelector<HTMLElement>(".settings-footer");
    if (!panel || !titlebar || !footer) {
      throw new Error("Settings panel, titlebar, or footer is missing");
    }
    const title = titlebar.getBoundingClientRect();
    const actions = footer.getBoundingClientRect();
    return {
      documentHasHorizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1,
      panelHasHorizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
      title: { x: title.x, y: title.y, bottom: title.bottom },
      footer: { x: actions.x, y: actions.y, bottom: actions.bottom },
      viewportHeight: window.innerHeight,
    };
  });

  expect(geometry.documentHasHorizontalOverflow).toBe(false);
  expect(geometry.panelHasHorizontalOverflow).toBe(false);
  expect(geometry.title.x).toBeGreaterThanOrEqual(0);
  expect(geometry.title.y).toBeGreaterThanOrEqual(0);
  expect(geometry.footer.x).toBeGreaterThanOrEqual(0);
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);

  const before = {
    title: await page.locator(".settings-titlebar").boundingBox(),
    footer: await page.locator(".settings-footer").boundingBox(),
  };
  await page.locator(".settings-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const after = {
    title: await page.locator(".settings-titlebar").boundingBox(),
    footer: await page.locator(".settings-footer").boundingBox(),
  };
  expect(after.title?.y).toBe(before.title?.y);
  expect(after.footer?.y).toBe(before.footer?.y);
  await page.locator(".settings-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
}

test("Paste settings remain readable across themes, tabs, and constrained windows", async ({
  browser,
}) => {
  await mkdir(settingsArtifactPath, { recursive: true });
  const database = new MemoryZToolsDatabase();
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "settings-style-visual",
  });

  for (const theme of ["dark", "light"] as const) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 680 },
      colorScheme: theme,
    });
    const page = await context.newPage();
    await attachSettingsHost(page, database, windowPreferencesStore);

    try {
      await openSettingsTab(page, "general");
      const dialog = page.getByRole("dialog", { name: "Paste剪切板设置" });
      await expect(dialog).toBeVisible();
      await expect(page.locator(".settings-brand img")).toBeVisible();
      await expect(
        page.getByRole("tablist", { name: "设置分类" }).getByRole("tab"),
      ).toHaveCount(4);

      for (const tab of settingsTabs) {
        const tabButton = page.getByRole("tab", { name: tab.label });
        if (tab.id !== "general") await tabButton.click();
        await expect(tabButton).toHaveAttribute("aria-selected", "true");
        await expect(
          page.getByRole("tabpanel", { name: tab.label }),
        ).toBeVisible();
        await expect(page.locator(".settings-titlebar")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "保存设置", exact: true }),
        ).toBeVisible();
        await assertPanelLayout(page);
        await page.screenshot({
          path: join(settingsArtifactPath, `${theme}-${tab.id}.png`),
          animations: "disabled",
        });
      }
    } finally {
      await context.close();
    }
  }

  const narrowContext = await browser.newContext({
    viewport: { width: 380, height: 640 },
    colorScheme: "dark",
  });
  const narrowPage = await narrowContext.newPage();
  await attachSettingsHost(narrowPage, database, windowPreferencesStore);
  try {
    await openSettingsTab(narrowPage, "privacy");
    await expect(narrowPage.getByRole("tabpanel", { name: "隐私" })).toBeVisible();
    await assertPanelLayout(narrowPage);
    await narrowPage.screenshot({
      path: join(settingsArtifactPath, "narrow.png"),
      animations: "disabled",
    });
  } finally {
    await narrowContext.close();
  }

  const shortContext = await browser.newContext({
    viewport: { width: 800, height: 360 },
    colorScheme: "dark",
  });
  const shortPage = await shortContext.newPage();
  await attachSettingsHost(shortPage, database, windowPreferencesStore);
  try {
    await openSettingsTab(shortPage, "privacy");
    await expect(shortPage.getByRole("tabpanel", { name: "隐私" })).toBeVisible();
    await assertPanelLayout(shortPage);
    await shortPage.screenshot({
      path: join(settingsArtifactPath, "short.png"),
      animations: "disabled",
    });
  } finally {
    await shortContext.close();
  }
});

test("settings keep cross-tab drafts, keyboard switches, and saved preferences", async ({
  browser,
}) => {
  const database = new MemoryZToolsDatabase();
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "settings-style-roundtrip",
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 680 } });
  const page = await context.newPage();
  await attachSettingsHost(page, database, windowPreferencesStore);

  try {
    await openSettingsTab(page, "general");
    const generalTab = page.getByRole("tab", { name: "通用" });
    const appearanceTab = page.getByRole("tab", { name: "外观" });
    await generalTab.focus();
    await page.keyboard.press("ArrowDown");
    await expect(appearanceTab).toBeFocused();
    await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(generalTab).toBeFocused();
    await expect(generalTab).toHaveAttribute("aria-selected", "true");
    await chooseRadio(page.getByRole("radio", { name: "左侧" }));
    await chooseRadio(page.getByRole("radio", { name: "逐一粘贴队列" }));

    await page.getByRole("tab", { name: "外观" }).click();
    const versionGroup = page.getByRole("radiogroup", { name: "界面版本" });
    await expect(versionGroup.getByRole("radio", { name: "新版" })).toBeVisible();
    const classicVersion = versionGroup.getByRole("radio", { name: "经典版" });
    await chooseRadio(classicVersion);

    await page.getByRole("tab", { name: "隐私" }).click();
    const screenShareToggle = page.getByRole("checkbox", {
      name: "屏幕共享时隐藏浮窗",
    });
    await expect(screenShareToggle).toHaveAttribute("type", "checkbox");
    await expect(screenShareToggle).not.toBeChecked();
    await screenShareToggle.focus();
    await page.keyboard.press("Space");
    await expect(screenShareToggle).toBeChecked();
    await page.keyboard.press("Space");
    await expect(screenShareToggle).not.toBeChecked();
    const retentionDays = page.getByLabel("普通历史保留天数");
    await retentionDays.fill("45");

    await page.getByRole("tab", { name: "同步" }).click();
    const syncEnabled = page.getByRole("checkbox", { name: "启用加密同步" });
    await syncEnabled.check();
    const syncUrl = page.getByLabel("WebDAV 地址");
    const draftUrl = "https://example.test/PasteboardPro/v1/";
    await syncUrl.fill(draftUrl);
    await page.getByRole("tab", { name: "通用" }).click();
    await page.getByRole("tab", { name: "同步" }).click();
    await expect(syncUrl).toHaveValue(draftUrl);

    await syncUrl.fill("");
    await syncEnabled.uncheck();
    await page.getByRole("tab", { name: "隐私" }).click();
    await expect(retentionDays).toHaveValue("45");
    await page.getByRole("tab", { name: "外观" }).click();
    await expect(classicVersion).toBeChecked();
    await page.getByRole("tab", { name: "通用" }).click();
    await expect(page.getByRole("radio", { name: "左侧" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "逐一粘贴队列" })).toBeChecked();

    expect((await privacyStore.get()).retention.days).toBe(90);
    expect((await windowPreferencesStore.get()).dockEdge).toBe("bottom");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(async () => (await privacyStore.get()).retention.days)
      .toBe(45);
    await expect
      .poll(async () => (await windowPreferencesStore.get()).dockEdge)
      .toBe("left");
    expect((await windowPreferencesStore.get()).multiPasteMode).toBe("queue");
    expect((await windowPreferencesStore.get()).uiVersion).toBe("classic");

    const reopened = await context.newPage();
    await attachSettingsHost(reopened, database, windowPreferencesStore);
    await openSettingsTab(reopened, "appearance");
    const reopenedVersionGroup = reopened.getByRole("radiogroup", {
      name: "界面版本",
    });
    await expect(
      reopenedVersionGroup.getByRole("radio", { name: "经典版" }),
    ).toBeChecked();
    await reopened.getByRole("tab", { name: "隐私" }).click();
    await expect(reopened.getByLabel("普通历史保留天数")).toHaveValue("45");
    await reopened.getByRole("tab", { name: "通用" }).click();
    await expect(reopened.getByRole("radio", { name: "左侧" })).toBeChecked();
    await expect(
      reopened.getByRole("radio", { name: "逐一粘贴队列" }),
    ).toBeChecked();
    await reopened.getByRole("tab", { name: "外观" }).click();
    await chooseRadio(reopened.getByRole("radio", { name: "新版" }));
    await reopened.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect
      .poll(async () => (await windowPreferencesStore.get()).uiVersion)
      .toBe("modern");
  } finally {
    await context.close();
  }
});


test("settings stay open during a pending save and recover from a write failure", async ({
  browser,
}) => {
  const database = new MemoryZToolsDatabase();
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "settings-save-pending",
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 680 } });
  const page = await context.newPage();
  await attachSettingsHost(page, database, windowPreferencesStore);

  try {
    await openSettingsTab(page, "privacy");
    const dialog = page.getByRole("dialog", { name: "Paste剪切板设置" });
    const toggle = page.getByRole("checkbox", {
      name: "屏幕共享时隐藏浮窗",
    });
    const saveButton = page.locator(".settings-footer button.primary");
    await toggle.check();
    const gate = database.gateNextPutFor(
      "pasteboard-pro:settings:privacy",
      "controlled pending-save failure",
    );

    await saveButton.click();
    await gate.started;
    await expect(saveButton).toHaveText("正在保存…");
    await expect(saveButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "关闭设置" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
    ).toBe(true);
    await page.locator(".settings-backdrop").dispatchEvent("click");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as unknown as SettingsTestWindow).__closeCalls,
      ),
    ).toBe(0);

    gate.release();
    const saveError = page.getByRole("alert");
    await expect(saveError).toContainText("controlled pending-save failure");
    await expect(toggle).toBeChecked();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect
      .poll(async () => (await privacyStore.get()).screenShareProtection)
      .toBe(true);
    await expect(saveError).not.toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (window as unknown as SettingsTestWindow).__closeCalls,
        ),
      )
      .toBe(1);
  } finally {
    await context.close();
  }
});
