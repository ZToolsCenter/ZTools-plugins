import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { syntheticBackdropDataUrl } from "./background-image-fixture";
import { assertSavedImageBackground, chooseAndApplyBackgroundImage } from "./background-image-picker";
import { installGroupHost, openGroupShelf } from "./group-popover-host";

const base = "http://127.0.0.1:5179";
const artifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "image-backdrop-results",
);

async function openAppearanceSettings(
  page: Page,
  colorScheme: "dark" | "light" = "dark",
  uiVersion: "modern" | "classic" = "modern",
): Promise<void> {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, uiVersion);
  await page.goto(`${base}/?visual=1&panel=privacy&tab=appearance`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
}

async function saveImageBackground(
  settings: Page,
  imageDataUrl: string,
  frosted = true,
): Promise<string> {
  await chooseAndApplyBackgroundImage(settings, imageDataUrl);
  await expect(settings.locator('input[name="background-type"][value="image"]')).toBeChecked();
  const frostedControl = settings.getByRole("checkbox", { name: "磨砂效果" });
  await expect(frostedControl).toBeVisible();
  if (frosted) await frostedControl.check();
  else await frostedControl.uncheck();
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  return assertSavedImageBackground(settings, frosted);
}

async function notifyPreferencesChanged(shelf: Page): Promise<void> {
  await shelf.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:window-preferences-changed"));
  });
}

async function saveSolidBackground(settings: Page, color: string): Promise<void> {
  await settings.locator('label:has(input[name="background-type"][value="color"])').click();
  await settings.getByLabel("选择背景颜色").fill(color);
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background;
  })).toEqual({ type: "color", color });
}

async function removeImageAndRestoreDefault(settings: Page): Promise<void> {
  await settings.locator('label:has(input[name="background-type"][value="default"])').click();
  await settings.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => settings.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background;
  })).toEqual({ type: "default" });
}

async function inspectImagePresentation(shelf: Page): Promise<{
  imageSourceOwners: number;
  markedPhotoCount: number;
  photoHasBlur: boolean;
  photoHasSource: boolean;
  photoHasDecorativeParent: boolean;
  decorativeParentHasScrim: boolean;
  contentHasFilterBlur: boolean;
  toolbarBackgroundAlpha: number;
  photoBackgroundSize: string;
  photoLayout: string | null;
  photoTransform: string;
  scrimBackgroundColor: string;
  scrimBackgroundImage: string;
}> {
  return shelf.locator(".stage").evaluate((stage) => {
    const imageSourceOwners: Element[] = [];
    const hasBlur = (value: string) => /blur\(\s*(?:\d+(?:\.\d*)?|\.\d+)px\s*\)/.test(value);
    for (const element of [stage, ...stage.querySelectorAll("*")]) {
      const computed = getComputedStyle(element);
      const pseudoHasImage = ["::before", "::after"].some((pseudo) =>
        getComputedStyle(element, pseudo).backgroundImage.includes("data:image/png;base64,"),
      );
      if (
        computed.backgroundImage.includes("data:image/png;base64,") ||
        pseudoHasImage
      ) imageSourceOwners.push(element);
    }

    const photo = stage.querySelector<HTMLElement>("[data-pb-image-backdrop]");
    const photoStyle = photo === null ? undefined : getComputedStyle(photo);
    const photoParent = photo?.parentElement;
    const photoHasDecorativeParent = photoParent !== undefined && photoParent !== null && (
      photoParent.getAttribute("aria-hidden") === "true" ||
      photoParent.getAttribute("role") === "presentation"
    );
    const parentStyles = photoParent === null || photoParent === undefined
      ? []
      : [
          getComputedStyle(photoParent),
          getComputedStyle(photoParent, "::before"),
          getComputedStyle(photoParent, "::after"),
        ];
    const decorativeParentHasScrim = parentStyles.some((style) => {
      const alpha = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      return style.backgroundImage.includes("linear-gradient") ||
        (alpha.length >= 4 && alpha[3]! > 0);
    });
    const toolbar = stage.querySelector<HTMLElement>(".modern-toolbar");
    if (toolbar === null) throw new Error("The modern Shelf toolbar is not visible");
    const toolbarColor = getComputedStyle(toolbar).backgroundColor;
    const colorChannels = toolbarColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const toolbarBackgroundAlpha = colorChannels.length >= 4
      ? colorChannels[3]!
      : 1;

    let contentHasFilterBlur = false;
    const textNodes = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let node = textNodes.nextNode(); node !== null; node = textNodes.nextNode()) {
      if (node.textContent?.trim().length === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (range.getClientRects().length === 0) continue;
      for (let current = node.parentElement; current !== null; current = current.parentElement) {
        if (hasBlur(getComputedStyle(current).filter)) contentHasFilterBlur = true;
        if (current === stage) break;
      }
      if (contentHasFilterBlur) break;
    }

    return {
      imageSourceOwners: imageSourceOwners.length,
      markedPhotoCount: photo === null ? 0 : 1,
      photoHasBlur: photoStyle === undefined ? false : hasBlur(photoStyle.filter),
      photoHasSource: photoStyle?.backgroundImage.includes("data:image/png;base64,") ?? false,
      photoHasDecorativeParent,
      decorativeParentHasScrim,
      contentHasFilterBlur,
      toolbarBackgroundAlpha,
      photoBackgroundSize: photoStyle?.backgroundSize ?? "none",
      photoLayout: photo?.getAttribute("data-pb-image-layout") ?? null,
      photoTransform: photoStyle?.transform ?? "none",
      scrimBackgroundColor: photoParent === null || photoParent === undefined
        ? "transparent"
        : getComputedStyle(photoParent, "::after").backgroundColor,
      scrimBackgroundImage: photoParent === null || photoParent === undefined
        ? "none"
        : getComputedStyle(photoParent, "::after").backgroundImage,
    };
  });
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("modern portrait image uses cover in an isolated softened backdrop", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1440, "dark", "modern");
  const settings = await context.newPage();
  await openAppearanceSettings(settings);

  const portrait = syntheticBackdropDataUrl("portrait");
  await saveImageBackground(settings, portrait);
  await notifyPreferencesChanged(shelf);
  await expect(shelf.locator(".shelf")).toBeVisible();
  await shelf.waitForTimeout(100);
  await shelf.screenshot({
    path: join(artifactPath, "modern-dark-portrait-wide.png"),
    animations: "disabled",
  });

  const presentation = await inspectImagePresentation(shelf);
  expect.soft(presentation.imageSourceOwners, JSON.stringify(presentation)).toBe(1);
  expect.soft(presentation.markedPhotoCount, JSON.stringify(presentation)).toBe(1);
  expect.soft(presentation.photoHasSource, JSON.stringify(presentation)).toBe(true);
  expect.soft(presentation.photoHasBlur, JSON.stringify(presentation)).toBe(true);
  expect.soft(presentation.photoHasDecorativeParent, JSON.stringify(presentation)).toBe(true);
  expect.soft(presentation.decorativeParentHasScrim, JSON.stringify(presentation)).toBe(true);
  expect.soft(presentation.contentHasFilterBlur, JSON.stringify(presentation)).toBe(false);
  expect.soft(presentation.toolbarBackgroundAlpha, JSON.stringify(presentation)).toBe(1);
  expect.soft(presentation.photoLayout, JSON.stringify(presentation)).toBe("cover");

  await shelf.setViewportSize({ width: 1920, height: 360 });
  const ultrawide = await inspectImagePresentation(shelf);
  expect(ultrawide.imageSourceOwners).toBe(1);
  expect(ultrawide.photoLayout).toBe("cover");
  expect(ultrawide.contentHasFilterBlur).toBe(false);
  await shelf.screenshot({
    path: join(artifactPath, "modern-dark-portrait-ultrawide.png"),
    animations: "disabled",
  });
  await shelf.setViewportSize({ width: 1440, height: 360 });


  await openAppearanceSettings(settings);
  await saveSolidBackground(settings, "#26364b");
  await notifyPreferencesChanged(shelf);
  const solidPresentation = await inspectImagePresentation(shelf);
  expect(solidPresentation.imageSourceOwners, JSON.stringify(solidPresentation)).toBe(0);
  expect(solidPresentation.markedPhotoCount, JSON.stringify(solidPresentation)).toBe(0);
  await shelf.screenshot({
    path: join(artifactPath, "modern-dark-solid-background.png"),
    animations: "disabled",
  });

  await openAppearanceSettings(settings);
  await removeImageAndRestoreDefault(settings);
  await notifyPreferencesChanged(shelf);
  const defaultPresentation = await inspectImagePresentation(shelf);
  expect(defaultPresentation.imageSourceOwners, JSON.stringify(defaultPresentation)).toBe(0);
  expect(defaultPresentation.markedPhotoCount, JSON.stringify(defaultPresentation)).toBe(0);
  await shelf.screenshot({
    path: join(artifactPath, "modern-dark-default-background.png"),
    animations: "disabled",
  });

  await openAppearanceSettings(settings);
  await saveImageBackground(settings, portrait);
  await removeImageAndRestoreDefault(settings);
  await notifyPreferencesChanged(shelf);
  const removedImagePresentation = await inspectImagePresentation(shelf);
  expect(removedImagePresentation.imageSourceOwners, JSON.stringify(removedImagePresentation)).toBe(0);
  expect(removedImagePresentation.markedPhotoCount, JSON.stringify(removedImagePresentation)).toBe(0);

  await context.close();
});

test("modern wide image remains softened in a narrow light Shelf", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 380, "light", "modern");
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "light", "modern");

  const wide = syntheticBackdropDataUrl("wide");
  await saveImageBackground(settings, wide);
  await notifyPreferencesChanged(shelf);
  await expect(shelf.locator(".shelf")).toBeVisible();
  await shelf.waitForTimeout(100);
  await shelf.screenshot({
    path: join(artifactPath, "modern-light-wide-image-narrow.png"),
    animations: "disabled",
  });
  const presentation = await inspectImagePresentation(shelf);
  expect(presentation.imageSourceOwners, JSON.stringify(presentation)).toBe(1);
  expect(presentation.markedPhotoCount, JSON.stringify(presentation)).toBe(1);
  expect(presentation.photoHasSource, JSON.stringify(presentation)).toBe(true);
  expect(presentation.photoHasBlur, JSON.stringify(presentation)).toBe(true);
  expect(presentation.photoHasDecorativeParent, JSON.stringify(presentation)).toBe(true);
  expect(presentation.decorativeParentHasScrim, JSON.stringify(presentation)).toBe(true);
  expect(presentation.contentHasFilterBlur, JSON.stringify(presentation)).toBe(false);
  expect(presentation.toolbarBackgroundAlpha, JSON.stringify(presentation)).toBe(1);
  expect(presentation.photoLayout, JSON.stringify(presentation)).toBe("cover");

  await context.close();
});

test("classic image background remains available", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings, "light", "classic");
  const image = syntheticBackdropDataUrl("portrait");
  await saveImageBackground(settings, image);

  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1440, "light", "classic");
  await expect(shelf.locator(".shelf--modern")).toHaveCount(0);
  await expect.poll(() => shelf.locator("[data-pb-image-backdrop]").evaluate((element) =>
    getComputedStyle(element).backgroundImage,
  )).toContain("data:image/png;base64,");
  await expect(shelf.locator("[data-pb-image-backdrop]")).toHaveAttribute("data-pb-image-layout", "cover");
  await shelf.screenshot({
    path: join(artifactPath, "classic-light-portrait-image.png"),
    animations: "disabled",
  });

  await context.close();
});
