import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { installGroupHost, openGroupShelf } from "./group-popover-host";
import { assertSavedImageBackground, chooseAndApplyBackgroundImage } from "./background-image-picker";

const base = "http://127.0.0.1:5179";
const artifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "theme-results",
);
const imageFixture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function openAppearanceSettings(
  page: Page,
  uiVersion: "modern" | "classic" = "modern",
  colorScheme: "light" | "dark" = "dark",
): Promise<void> {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, uiVersion);
  await navigateAppearanceSettings(page, uiVersion);
}

async function navigateAppearanceSettings(
  page: Page,
  uiVersion: "modern" | "classic",
): Promise<void> {
  await page.goto(`${base}/?visual=1&panel=privacy&tab=appearance`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-pb-ui-version", uiVersion);
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
}

async function saveThemeSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme;
  })).not.toBeUndefined();
}

async function notifyPreferencesChanged(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:window-preferences-changed"));
  });
}

async function readShelfTheme(page: Page): Promise<{
  accent: string;
  selectedGroup: string;
  backgroundColor: string;
  backgroundImage: string;
}> {
  return page.locator(".shelf").evaluate((shelf) => {
    const normalize = (color: string) => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.append(probe);
      const normalized = getComputedStyle(probe).color;
      probe.remove();
      return normalized;
    };
    const activeGroup = shelf.querySelector<HTMLElement>('[aria-label="分组"] > button.active');
    if (activeGroup === null) throw new Error("The visible shelf has no selected group tab");
    const imageSource = shelf.querySelector<HTMLElement>("[data-pb-image-backdrop]") ?? shelf;
    return {
      accent: normalize(getComputedStyle(document.documentElement).getPropertyValue("--pb-violet")),
      selectedGroup: getComputedStyle(activeGroup).color,
      backgroundColor: getComputedStyle(shelf).backgroundColor,
      backgroundImage: getComputedStyle(imageSource).backgroundImage,
    };
  });
}

async function readReadableSurfaces(page: Page): Promise<{
  toolbarBackground: string;
  toolbarTextContrast: number;
  emptyStateBackground: string;
  emptyStateTextContrasts: number[];
}> {
  return page.locator(".shelf--modern").evaluate((shelf) => {
    const toolbar = shelf.querySelector<HTMLElement>(".modern-toolbar");
    const emptyState = shelf.querySelector<HTMLElement>(".empty-state");
    const toolbarText = toolbar?.querySelector<HTMLElement>(".modern-toolbar__identity");
    if (toolbar === null || toolbarText === null || toolbarText === undefined || emptyState === null) {
      throw new Error("Expected the modern toolbar and empty-state plate to be visible");
    }
    const luminance = (color: string): number => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (channels?.length !== 3) throw new Error(`Cannot parse computed RGB color ${color}`);
      const [red, green, blue] = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (foreground: string, background: string): number => {
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const toolbarBackground = getComputedStyle(toolbar).backgroundColor;
    const toolbarForeground = getComputedStyle(toolbarText).color;
    const emptyStateBackground = getComputedStyle(emptyState).backgroundColor;
    const emptyStateTextContrasts = [...emptyState.querySelectorAll<HTMLElement>("span, strong, p")]
      .map((element) => contrast(getComputedStyle(element).color, emptyStateBackground));
    return {
      toolbarBackground,
      toolbarTextContrast: contrast(toolbarForeground, toolbarBackground),
      emptyStateBackground,
      emptyStateTextContrasts,
    };
  });
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("modern applies a saved accent to visible settings actions", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings);

  await settings.getByLabel("选择主题色").fill("#26906f");
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.accentColor;
  })).toBe("#26906f");

  const reopenedSettings = await context.newPage();
  await openAppearanceSettings(reopenedSettings);
  await expect(reopenedSettings.getByLabel("选择主题色")).toHaveValue("#26906f");

  const visibleTheme = reopenedSettings.getByRole("dialog", { name: "Paste剪切板设置" });
  const colors = await visibleTheme.evaluate((dialog) => {
    const selectedTab = dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const primaryButton = dialog.querySelector<HTMLElement>(".settings-footer .primary");
    if (selectedTab === null || primaryButton === null) {
      throw new Error("Expected the selected settings tab and primary save button to be visible");
    }
    const normalize = (color: string) => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.append(probe);
      const normalized = getComputedStyle(probe).color;
      probe.remove();
      return normalized;
    };
    const configuredAccent = getComputedStyle(document.documentElement)
      .getPropertyValue("--pb-violet")
      .trim();
    return {
      configuredAccent: normalize(configuredAccent),
      selectedTab: getComputedStyle(selectedTab).color,
      primaryButton: getComputedStyle(primaryButton).backgroundColor,
    };
  });
  await reopenedSettings.screenshot({
    path: join(artifactPath, "modern-custom-accent-settings.png"),
    animations: "disabled",
  });

  expect(colors.configuredAccent).not.toBe("rgb(121, 173, 255)");
  expect(colors.selectedTab).toBe(colors.configuredAccent);
  expect(colors.primaryButton).toBe(colors.configuredAccent);

  await context.close();
});

test("saved solid background reaches the visible shelf in an already-open window", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "dark", "modern");
  const initialBackground = await shelf.locator(".shelf--modern").evaluate((element) =>
    getComputedStyle(element).backgroundColor,
  );

  const settings = await context.newPage();
  await openAppearanceSettings(settings);
  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色").fill("#1f3348");
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    if (raw === null) return undefined;
    return JSON.parse(raw).theme?.background;
  })).toEqual({ type: "color", color: "#1f3348" });

  await notifyPreferencesChanged(shelf);
  const updatedShelf = shelf.locator(".shelf--modern");
  await expect.poll(() => updatedShelf.evaluate((element) =>
    getComputedStyle(element).backgroundColor,
  )).toBe("rgb(31, 51, 72)");
  await shelf.screenshot({
    path: join(artifactPath, "modern-solid-background-live-shelf.png"),
    animations: "disabled",
  });
  expect(initialBackground).not.toBe("rgb(31, 51, 72)");

  await context.close();
});

test("image background is selected, applied to the shelf, and cleared back to default", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "dark", "modern");
  const settings = await context.newPage();
  await openAppearanceSettings(settings);

  await chooseAndApplyBackgroundImage(settings, imageFixture);
  await expect(settings.locator('input[name="background-type"][value="image"]')).toBeChecked();
  await saveThemeSettings(settings);
  const savedImage = await assertSavedImageBackground(settings, false);

  await notifyPreferencesChanged(shelf);
  await expect.poll(async () => (await readShelfTheme(shelf)).backgroundImage)
    .toContain("data:image/png;base64,");
  const imageBackground = await readShelfTheme(shelf);
  expect(imageBackground.backgroundImage).toContain(savedImage);
  await shelf.screenshot({
    path: join(artifactPath, "modern-image-background-live-shelf.png"),
    animations: "disabled",
  });

  await navigateAppearanceSettings(settings, "modern");
  await expect(settings.locator('input[name="background-type"][value="image"]')).toBeChecked();
  await settings.getByRole("button", { name: "移除", exact: true }).click();
  await saveThemeSettings(settings);
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    if (raw === null) return undefined;
    return JSON.parse(raw).theme?.background;
  })).toEqual({ type: "default" });

  await notifyPreferencesChanged(shelf);
  await expect.poll(async () => (await readShelfTheme(shelf)).backgroundImage)
    .not.toContain(savedImage);
  const defaultBackground = await readShelfTheme(shelf);
  expect(defaultBackground.backgroundColor).not.toBe("rgb(31, 51, 72)");
  await shelf.screenshot({
    path: join(artifactPath, "modern-default-background-restored.png"),
    animations: "disabled",
  });

  await context.close();
});

test("explicit modern default purple stays purple in the shelf and popovers", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "dark", "modern");
  const settings = await context.newPage();
  await openAppearanceSettings(settings);

  await settings.getByLabel("选择主题色").fill("#6f61ea");
  await saveThemeSettings(settings);
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.accentColor;
  })).toBe("#6f61ea");
  await notifyPreferencesChanged(shelf);

  await navigateAppearanceSettings(settings, "modern");
  await expect(settings.getByLabel("选择主题色")).toHaveValue("#6f61ea");
  const shelfTheme = await readShelfTheme(shelf);
  const expectedAccent = shelfTheme.accent;
  expect.soft(shelfTheme.selectedGroup).toBe(expectedAccent);
  expect.soft(shelfTheme.selectedGroup).not.toBe("rgb(121, 173, 255)");

  const firstGroup = shelf.locator(".pinboard-chip").first();
  await firstGroup.locator(".manage-button").click();
  const managementMenu = shelf.getByRole("menu").first();
  await expect(managementMenu).toBeVisible();
  const managementAccent = await managementMenu.evaluate((menu) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(menu).getPropertyValue("--popover-accent");
    document.body.append(probe);
    const normalized = getComputedStyle(probe).color;
    probe.remove();
    return normalized;
  });
  expect.soft(managementAccent).toBe(expectedAccent);
  await shelf.screenshot({
    path: join(artifactPath, "modern-default-purple-management-menu.png"),
    animations: "disabled",
  });

  await managementMenu.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = shelf.getByRole("dialog", { name: "重命名分组" });
  await expect(renameDialog).toBeVisible();
  const renameAction = renameDialog.getByRole("button", { name: "保存", exact: true });
  expect.soft(await renameAction.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe(expectedAccent);
  await renameDialog.getByRole("textbox", { name: "重命名分组" }).press("Escape");

  await shelf.getByRole("button", { name: "新建分组", exact: true }).click();
  const createDialog = shelf.getByRole("dialog", { name: "新建分组" });
  await expect(createDialog).toBeVisible();
  const createAction = createDialog.getByRole("button", { name: "创建", exact: true });
  expect.soft(await createAction.evaluate((button) => getComputedStyle(button).backgroundColor))
    .toBe(expectedAccent);

  await context.close();
});

test("classic light keeps its saved accent and solid background on the shelf", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "classic", "light");
  await expect(settings.getByRole("radio", { name: "经典版" })).toBeChecked();
  await settings.getByLabel("选择主题色").fill("#26906f");
  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色").fill("#f4e7d2");
  await saveThemeSettings(settings);
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).uiVersion;
  })).toBe("classic");

  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "light", "classic");
  await expect(shelf.locator(".shelf--modern")).toHaveCount(0);
  const shelfTheme = await readShelfTheme(shelf);
  expect(shelfTheme.backgroundColor).toBe("rgb(244, 231, 210)");
  expect(shelfTheme.selectedGroup).toBe(shelfTheme.accent);
  await shelf.screenshot({
    path: join(artifactPath, "classic-light-custom-theme.png"),
    animations: "disabled",
  });

  await navigateAppearanceSettings(settings, "classic");
  await expect(settings.getByLabel("选择主题色")).toHaveValue("#26906f");
  await expect(settings.getByLabel("选择背景颜色")).toHaveValue("#f4e7d2");
  await chooseAndApplyBackgroundImage(settings, imageFixture);
  await expect(settings.locator('input[name="background-type"][value="image"]')).toBeChecked();
  await saveThemeSettings(settings);
  const savedImage = await assertSavedImageBackground(settings, false);
  await notifyPreferencesChanged(shelf);

  await expect(shelf.locator(".shelf")).toHaveClass(/shelf--theme-background-image/);
  const imageShelfTheme = await readShelfTheme(shelf);
  expect(imageShelfTheme.backgroundColor).toBe("rgb(247, 247, 251)");
  expect(imageShelfTheme.backgroundImage).toContain(savedImage);
  expect(imageShelfTheme.backgroundImage).not.toContain("linear-gradient");
  await expect(shelf.locator("[data-pb-image-backdrop]")).toHaveCSS("background-size", "cover");
  await shelf.screenshot({
    path: join(artifactPath, "classic-light-image-over-glass.png"),
    animations: "disabled",
  });

  await navigateAppearanceSettings(settings, "classic");
  await expect(settings.locator('input[name="background-type"][value="image"]')).toBeChecked();
  await settings.getByRole("button", { name: "移除", exact: true }).click();
  await saveThemeSettings(settings);
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    if (raw === null) return undefined;
    return JSON.parse(raw).theme?.background;
  })).toEqual({ type: "default" });
  await notifyPreferencesChanged(shelf);
  await expect(shelf.locator(".shelf")).not.toHaveClass(/shelf--theme-background/);
  const resetShelfTheme = await readShelfTheme(shelf);
  expect(resetShelfTheme.backgroundImage).toContain("linear-gradient");
  expect(resetShelfTheme.backgroundImage).not.toContain(savedImage);
  await shelf.screenshot({
    path: join(artifactPath, "classic-light-default-glass-restored.png"),
    animations: "disabled",
  });

  await context.close();
});

test("modern dark toolbar and empty state stay readable over a white custom background", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "dark", "modern");
  const initialCardBackground = await shelf.locator(".paste-card").first().evaluate((card) =>
    getComputedStyle(card).backgroundColor,
  );

  const settings = await context.newPage();
  await openAppearanceSettings(settings, "modern", "dark");
  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色").fill("#ffffff");
  await saveThemeSettings(settings);
  await notifyPreferencesChanged(shelf);
  await expect(shelf.locator(".shelf--theme-background")).toBeVisible();
  expect((await readShelfTheme(shelf)).backgroundColor).toBe("rgb(255, 255, 255)");
  expect(await shelf.locator(".paste-card").first().evaluate((card) =>
    getComputedStyle(card).backgroundColor,
  )).toBe(initialCardBackground);

  await shelf.locator(".search-bar").click();
  await shelf.getByRole("searchbox", { name: "搜索剪贴板历史" }).fill("theme-background-no-matches");
  await expect(shelf.locator(".empty-state")).toBeVisible();
  const surfaces = await readReadableSurfaces(shelf);
  expect(surfaces.toolbarBackground).toBe("rgb(47, 52, 59)");
  expect(surfaces.toolbarTextContrast).toBeGreaterThanOrEqual(4.5);
  expect(surfaces.emptyStateBackground).toBe("rgb(47, 52, 59)");
  expect(surfaces.emptyStateTextContrasts.length).toBe(3);
  for (const contrast of surfaces.emptyStateTextContrasts) {
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await shelf.screenshot({
    path: join(artifactPath, "modern-dark-white-background-readable.png"),
    animations: "disabled",
  });

  await context.close();
});

test("modern light toolbar and empty state stay readable over a black custom background", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1120, "light", "modern");
  const initialCardBackground = await shelf.locator(".paste-card").first().evaluate((card) =>
    getComputedStyle(card).backgroundColor,
  );

  const settings = await context.newPage();
  await openAppearanceSettings(settings, "modern", "light");
  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色").fill("#000000");
  await saveThemeSettings(settings);
  await notifyPreferencesChanged(shelf);
  await expect(shelf.locator(".shelf--theme-background")).toBeVisible();
  expect((await readShelfTheme(shelf)).backgroundColor).toBe("rgb(0, 0, 0)");
  expect(await shelf.locator(".paste-card").first().evaluate((card) =>
    getComputedStyle(card).backgroundColor,
  )).toBe(initialCardBackground);

  await shelf.locator(".search-bar").click();
  await shelf.getByRole("searchbox", { name: "搜索剪贴板历史" }).fill("theme-background-no-matches");
  await expect(shelf.locator(".empty-state")).toBeVisible();
  const surfaces = await readReadableSurfaces(shelf);
  expect(surfaces.toolbarBackground).toBe("rgb(255, 255, 255)");
  expect(surfaces.toolbarTextContrast).toBeGreaterThanOrEqual(4.5);
  expect(surfaces.emptyStateBackground).toBe("rgb(255, 255, 255)");
  expect(surfaces.emptyStateTextContrasts.length).toBe(3);
  for (const contrast of surfaces.emptyStateTextContrasts) {
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await shelf.screenshot({
    path: join(artifactPath, "modern-light-black-background-readable.png"),
    animations: "disabled",
  });

  await context.close();
});
