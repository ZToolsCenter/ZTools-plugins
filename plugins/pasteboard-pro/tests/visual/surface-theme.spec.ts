import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { syntheticBackdropDataUrl } from "./background-image-fixture";
import { chooseAndApplyBackgroundImage } from "./background-image-picker";
import { installGroupHost, openGroupShelf } from "./group-popover-host";

const base = "http://127.0.0.1:5179";
const artifactPath = join(process.cwd(), "artifacts", "pasteboardpro", "surface-theme");

type UiVersion = "modern" | "classic";
type ColorScheme = "dark" | "light";

async function openAppearanceSettings(
  page: Page,
  colorScheme: ColorScheme,
  uiVersion: UiVersion = "modern",
  width = 980,
): Promise<void> {
  await page.setViewportSize({ width, height: 760 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, uiVersion);
  await page.goto(`${base}/?visual=1&panel=privacy&tab=appearance`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
}

async function readTheme(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? {} : JSON.parse(raw).theme;
  });
}

async function saveSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
}

async function notifyShelf(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:window-preferences-changed"));
  });
}

async function inspectCard(page: Page): Promise<{
  background: string;
  backgroundImage: string;
  foreground: string;
  toolbarBackground: string;
  customBackgroundToken: string;
}> {
  return page.locator(".shelf .paste-card[data-pb-item-id]").first().evaluate((card) => {
    const text = card.querySelector<HTMLElement>(".modern-preview--text p, .modern-card-source__app span:last-child, header .kind");
    const toolbar = card.closest(".shelf")?.querySelector<HTMLElement>(".modern-toolbar");
    if (text === null || text === undefined || toolbar === null || toolbar === undefined) {
      throw new Error("Expected a card with readable text and the Shelf toolbar");
    }
    const cardStyle = getComputedStyle(card);
    return {
      background: cardStyle.backgroundColor,
      backgroundImage: cardStyle.backgroundImage,
      foreground: getComputedStyle(text).color,
      toolbarBackground: getComputedStyle(toolbar).backgroundColor,
      customBackgroundToken: cardStyle.getPropertyValue("--pb-theme-card-background").trim(),
    };
  });
}

async function inspectShelfSurface(page: Page): Promise<{
  surface: string;
  imageSource: string;
  photoBase: string;
  card: Awaited<ReturnType<typeof inspectCard>>;
}> {
  const shelf = page.locator(".shelf");
  return shelf.evaluate((element) => {
    const photo = element.querySelector<HTMLElement>("[data-pb-image-backdrop]");
    const card = element.querySelector<HTMLElement>(".paste-card[data-pb-item-id]");
    const toolbar = element.querySelector<HTMLElement>(".modern-toolbar, .toolbar");
    const text = card?.querySelector<HTMLElement>(".modern-preview--text p, .modern-card-source__app span:last-child, header .kind");
    if (card === null || card === undefined || toolbar === null || toolbar === undefined || text === null || text === undefined) {
      throw new Error("Expected the Shelf, a card, text, and toolbar");
    }
    const cardStyle = getComputedStyle(card);
    const photoStyle = photo === null ? undefined : getComputedStyle(photo);
    return {
      surface: getComputedStyle(element).backgroundColor,
      imageSource: photoStyle?.backgroundImage ?? "none",
      photoBase: photo?.parentElement === null || photo?.parentElement === undefined
        ? ""
        : getComputedStyle(photo.parentElement).backgroundColor,
      card: {
        background: cardStyle.backgroundColor,
        backgroundImage: cardStyle.backgroundImage,
        foreground: getComputedStyle(text).color,
        toolbarBackground: getComputedStyle(toolbar).backgroundColor,
        customBackgroundToken: cardStyle.getPropertyValue("--pb-theme-card-background").trim(),
      },
    };
  });
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string): number => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (channels?.length !== 3) throw new Error(`Cannot read RGB color ${color}`);
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function setRange(page: Page, label: string, value: number): Promise<void> {
  await page.getByRole("slider", { name: label }).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("card color is readable, scoped to cards, previewed as a draft, and resettable", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "dark");
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1440, "dark", "modern");

  const before = await inspectCard(shelf);
  const savedBefore = await readTheme(settings);
  await settings.getByRole("checkbox", { name: "自定义卡片底色" }).check();
  await settings.getByLabel("选择卡片底色").fill("#f4ead7");
  await setRange(settings, "卡片不透明度", 100);

  const unsaved = await inspectCard(shelf);
  expect(unsaved).toEqual(before);
  expect(await readTheme(settings)).toEqual(savedBefore);
  const draftPreview = settings.locator("[data-pb-theme-preview-card]").first();
  await expect(draftPreview).toBeVisible();
  await expect(draftPreview).toHaveCSS("background-color", "rgb(244, 234, 215)");

  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).toMatchObject({
    cardBackground: { color: "#f4ead7", opacity: 1 },
  });
  await notifyShelf(shelf);
  const applied = await inspectCard(shelf);
  expect(applied.background).toBe("rgb(244, 234, 215)");
  expect(applied.customBackgroundToken).toContain("244");
  expect(applied.toolbarBackground).toBe(before.toolbarBackground);
  expect(contrastRatio(applied.foreground, applied.background)).toBeGreaterThanOrEqual(4.5);

  await setRange(settings, "卡片不透明度", 55);
  await saveSettings(settings);
  await notifyShelf(shelf);
  const translucent = await inspectCard(shelf);
  expect(translucent.background).toMatch(/rgba?\(/);
  expect(translucent.background).not.toBe(applied.background);
  await shelf.screenshot({ path: join(artifactPath, "modern-dark-light-card.png"), animations: "disabled" });
  const handle = shelf.locator(".shelf .paste-card[data-pb-item-id] [data-pb-reorder-handle]").first();
  const handleBounds = await handle.boundingBox();
  if (handleBounds === null) throw new Error("Custom card reorder handle should be visible");
  await shelf.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await shelf.mouse.down();
  await shelf.mouse.move(handleBounds.x + 80, handleBounds.y + 30, { steps: 5 });
  const dragCard = shelf.locator("[data-pb-reorder-preview] .paste-card").first();
  await expect(dragCard).toBeVisible();
  await expect(dragCard).toHaveCSS("background-color", translucent.background);
  await shelf.keyboard.press("Escape");
  await shelf.mouse.up();
  await expect(shelf.locator("[data-pb-reorder-preview]")).toHaveCount(0);

  await settings.getByRole("button", { name: "恢复默认卡片底色" }).click();
  expect(await readTheme(settings)).toMatchObject({ cardBackground: { color: "#f4ead7", opacity: 0.55 } });
  await expect(settings.getByRole("checkbox", { name: "自定义卡片底色" })).not.toBeChecked();
  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).not.toHaveProperty("cardBackground");
  await notifyShelf(shelf);
  const restored = await inspectCard(shelf);
  expect(restored.customBackgroundToken).toBe("");
  expect(restored.background).not.toBe(translucent.background);
  await settings.emulateMedia({ colorScheme: "light" });
  await settings.getByRole("checkbox", { name: "自定义卡片底色" }).check();
  await expect(settings.getByLabel("选择卡片底色")).toHaveValue("#ffffff");

  await context.close();
});

test("image backgrounds ignore and hide a saved base color while cards remain independent", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "light");
  const wideImage = syntheticBackdropDataUrl("wide");

  await settings.getByRole("checkbox", { name: "自定义背景底色" }).check();
  await settings.getByLabel("选择背景底色").fill("#6c4255");
  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).toMatchObject({ backgroundBaseColor: "#6c4255" });

  await chooseAndApplyBackgroundImage(settings, wideImage);
  await expect(settings.getByLabel("图片渲染方式")).toHaveValue("cover");
  await settings.getByLabel("图片渲染方式").selectOption("contain");
  await expect(settings.getByRole("checkbox", { name: "自定义背景底色" })).toHaveCount(0);

  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).toMatchObject({
    background: { type: "image", layout: "contain" },
    backgroundBaseColor: "#6c4255",
  });
  const imageBefore = await readTheme(settings);

  const shelf = await context.newPage();
  await openGroupShelf(shelf, 380, "light", "modern");
  const before = await inspectShelfSurface(shelf);
  expect(before.imageSource).toContain("data:image/png;base64,");
  expect(before.surface).not.toBe("rgb(108, 66, 85)");
  expect(before.photoBase).not.toBe("rgb(108, 66, 85)");

  await settings.getByRole("checkbox", { name: "自定义卡片底色" }).check();
  await settings.getByLabel("选择卡片底色").fill("#142d35");
  await setRange(settings, "卡片不透明度", 100);

  const unsavedTheme = await readTheme(settings);
  expect(unsavedTheme).toEqual(imageBefore);
  expect(unsavedTheme).not.toHaveProperty("cardBackground");
  expect(unsavedTheme.backgroundBaseColor).toBe("#6c4255");
  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).toMatchObject({
    cardBackground: { color: "#142d35", opacity: 1 },
    backgroundBaseColor: "#6c4255",
    background: { type: "image" },
  });
  const cardTheme = await readTheme(settings);
  const cardThemeImage = (cardTheme.background as { imageDataUrl?: string }).imageDataUrl;
  expect(cardThemeImage).toMatch(/^data:image\/png;base64,/);
  expect(cardThemeImage).toBe((imageBefore.background as { imageDataUrl?: string }).imageDataUrl);
  await notifyShelf(shelf);

  const cardApplied = await inspectShelfSurface(shelf);
  expect(cardApplied.imageSource).toBe(before.imageSource);
  expect(cardApplied.imageSource).toContain("data:image/png;base64,");
  expect(cardApplied.surface).not.toBe("rgb(108, 66, 85)");
  expect(cardApplied.photoBase).not.toBe("rgb(108, 66, 85)");
  expect(cardApplied.card.background).toBe("rgb(20, 45, 53)");
  expect(cardApplied.card.toolbarBackground).toBe(before.card.toolbarBackground);
  expect(contrastRatio(cardApplied.card.foreground, cardApplied.card.background)).toBeGreaterThanOrEqual(4.5);

  await settings.locator('label:has(input[name="background-type"][value="default"])').click();
  await expect(settings.getByRole("checkbox", { name: "自定义背景底色" })).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "自定义背景底色" })).toBeChecked();
  await saveSettings(settings);
  await notifyShelf(shelf);
  const defaultWithBase = await inspectShelfSurface(shelf);
  expect(defaultWithBase.imageSource).toBe("none");
  expect(defaultWithBase.surface).toBe("rgb(108, 66, 85)");
  expect((await readTheme(settings)).backgroundBaseColor).toBe("#6c4255");
  await shelf.screenshot({ path: join(artifactPath, "modern-light-dark-card-default-base.png"), animations: "disabled" });

  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色", { exact: true }).fill("#e4d4bb");
  await saveSettings(settings);
  await notifyShelf(shelf);
  expect((await inspectShelfSurface(shelf)).surface).toBe("rgb(228, 212, 187)");
  expect((await readTheme(settings)).backgroundBaseColor).toBe("#6c4255");
  expect((await readTheme(settings)).background).toMatchObject({ type: "color", color: "#e4d4bb" });
  await expect(settings.getByRole("checkbox", { name: "自定义背景底色" })).toBeDisabled();
  await settings.locator('label:has(input[name="background-type"][value="default"])').click();
  await settings.getByRole("button", { name: "恢复默认背景底色" }).click();
  await saveSettings(settings);
  await expect.poll(() => readTheme(settings)).not.toHaveProperty("backgroundBaseColor");
  await notifyShelf(shelf);
  expect((await inspectShelfSurface(shelf)).surface).toBe("rgb(245, 246, 248)");
  expect((await readTheme(settings)).cardBackground).toEqual({ color: "#142d35", opacity: 1 });

  await context.close();
});

test("classic appearance exposes both saved surfaces and remains usable in a narrow window", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "dark", "classic", 520);
  await settings.getByRole("checkbox", { name: "自定义卡片底色" }).check();
  await settings.getByLabel("选择卡片底色").fill("#d8e6f1");
  await setRange(settings, "卡片不透明度", 100);
  await settings.getByRole("checkbox", { name: "自定义背景底色" }).check();
  await settings.getByLabel("选择背景底色").fill("#29233a");
  await saveSettings(settings);

  await expect.poll(() => readTheme(settings)).toMatchObject({
    cardBackground: { color: "#d8e6f1", opacity: 1 },
    backgroundBaseColor: "#29233a",
  });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 380, "dark", "classic");
  const surface = await inspectShelfSurface(shelf);
  expect(surface.surface).toBe("rgb(41, 35, 58)");
  expect(surface.card.background).toBe("rgb(216, 230, 241)");
  expect(contrastRatio(surface.card.foreground, surface.card.background)).toBeGreaterThanOrEqual(4.5);
  await shelf.screenshot({ path: join(artifactPath, "classic-narrow-custom-surfaces.png"), animations: "disabled" });
  await settings.reload({ waitUntil: "networkidle" });
  await expect(settings.getByLabel("选择卡片底色")).toHaveValue("#d8e6f1");
  await expect(settings.getByLabel("选择背景底色")).toHaveValue("#29233a");
  await context.close();
});
