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
  "image-background-options",
);

async function openAppearanceSettings(
  page: Page,
  colorScheme: "dark" | "light",
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

async function chooseImage(
  page: Page,
  imageDataUrl: string,
  layout?: "cover" | "contain" | "tile" | "repeat-x",
): Promise<void> {
  await chooseAndApplyBackgroundImage(page, imageDataUrl);
  await expect(page.locator('input[name="background-type"][value="image"]')).toBeChecked();
  if (layout !== undefined) {
    await page.getByLabel("图片渲染方式").selectOption(layout);
  }
}

async function saveImage(page: Page, imageDataUrl: string, frosted: boolean): Promise<void> {
  await page.getByRole("checkbox", { name: "磨砂效果" }).setChecked(frosted);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  const saved = await assertSavedImageBackground(page, frosted);
  expect(saved).toMatch(/^data:image\/png;base64,/);
}

async function readPhotoLayer(
  page: Page,
  selector: string,
): Promise<{ backgroundSize: string; filter: string; backgroundImage: string }> {
  const photo = page.locator(selector);
  await expect(photo).toHaveCount(1);
  return photo.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundSize: style.backgroundSize,
      filter: style.filter,
      backgroundImage: style.backgroundImage,
    };
  });
}

async function inspectPhoto(page: Page): Promise<{
  sourceCount: number;
  layout: string | null;
  backgroundSize: string;
  backgroundPosition: string;
  filter: string;
  transform: string;
  scrimColor: string;
  scrimImage: string;
}> {
  return page.locator(".stage").evaluate((stage) => {
    const imageUrl = "data:image/png;base64,";
    const sourceCount = [stage, ...stage.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return style.backgroundImage.includes(imageUrl) ||
        getComputedStyle(element, "::before").backgroundImage.includes(imageUrl) ||
        getComputedStyle(element, "::after").backgroundImage.includes(imageUrl);
    }).length;
    const photo = stage.querySelector<HTMLElement>("[data-pb-image-backdrop]");
    if (photo === null) throw new Error("Image backdrop layer is missing");
    const parent = photo.parentElement;
    if (parent === null) throw new Error("Image backdrop presentation wrapper is missing");
    const style = getComputedStyle(photo);
    const scrim = getComputedStyle(parent, "::after");
    return {
      sourceCount,
      layout: photo.getAttribute("data-pb-image-layout"),
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      filter: style.filter,
      transform: style.transform,
      scrimColor: scrim.backgroundColor,
      scrimImage: scrim.backgroundImage,
    };
  });
}

async function assertImagePresentation(
  page: Page,
  layout: "cover" | "contain",
): Promise<void> {
  const photo = await inspectPhoto(page);
  expect(photo.sourceCount, JSON.stringify(photo)).toBe(1);
  expect(photo.layout, JSON.stringify(photo)).toBe(layout);
  expect(photo.backgroundSize, JSON.stringify(photo)).toBe(layout);
  expect(photo.backgroundPosition, JSON.stringify(photo)).toBe("50% 50%");
  expect(photo.filter, JSON.stringify(photo)).toBe("none");
  expect(photo.transform, JSON.stringify(photo)).toBe("none");
  expect(photo.scrimImage, JSON.stringify(photo)).toBe("none");
  expect(photo.scrimColor, JSON.stringify(photo)).toBe("rgba(0, 0, 0, 0)");
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("modern image backgrounds default to cover and persist the independent frosted effect", async ({ page }) => {
  const portrait = syntheticBackdropDataUrl("portrait");
  await openAppearanceSettings(page, "dark");
  await chooseImage(page, portrait);

  await expect(page.getByLabel("图片渲染方式")).toHaveValue("cover");
  const frostedControl = page.getByRole("checkbox", { name: "磨砂效果" });
  await expect(frostedControl).toBeVisible();
  await expect(frostedControl).not.toBeChecked();
  await saveImage(page, portrait, false);
  await openGroupShelf(page, 1920, "dark", "modern");
  await assertImagePresentation(page, "cover");
  await page.screenshot({
    path: join(artifactPath, "modern-dark-clear-portrait-ultrawide.png"),
    animations: "disabled",
  });

  await openAppearanceSettings(page, "dark");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "磨砂效果" }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background?.frosted;
  })).toBe(true);

  await openGroupShelf(page, 1920, "dark", "modern");
  const frosted = await inspectPhoto(page);
  expect(frosted.sourceCount, JSON.stringify(frosted)).toBe(1);
  expect(frosted.backgroundSize, JSON.stringify(frosted)).toBe("cover");
  expect(frosted.filter, JSON.stringify(frosted)).toContain("blur(22px)");
  expect(frosted.transform, JSON.stringify(frosted)).toBe("none");
  expect(frosted.scrimColor, JSON.stringify(frosted)).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: join(artifactPath, "modern-dark-frosted-portrait-ultrawide.png"),
    animations: "disabled",
  });

  await openAppearanceSettings(page, "dark");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).toBeChecked();
});

test("modern light image keeps its full ratio in a narrow Shelf", async ({ page }) => {
  const wide = syntheticBackdropDataUrl("wide");
  await openAppearanceSettings(page, "light");
  await chooseImage(page, wide, "contain");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  await saveImage(page, wide, false);
  await openGroupShelf(page, 380, "light", "modern");

  await assertImagePresentation(page, "contain");
  await page.screenshot({
    path: join(artifactPath, "modern-light-clear-wide-narrow.png"),
    animations: "disabled",
  });
});

test("standalone Settings applies saved image frosted state while the preview follows draft state", async ({ page }) => {
  const portrait = syntheticBackdropDataUrl("portrait");
  const stageImage = ".stage > .shelf__image-backdrop [data-pb-image-backdrop]";
  const previewImage = ".theme-preview .shelf__image-backdrop [data-pb-image-backdrop]";

  await openAppearanceSettings(page, "dark");
  await chooseImage(page, portrait);
  await expect(page.getByLabel("图片渲染方式")).toHaveValue("cover");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  await saveImage(page, portrait, false);
  let stage = await readPhotoLayer(page, stageImage);
  let preview = await readPhotoLayer(page, previewImage);
  expect(stage.backgroundSize, JSON.stringify(stage)).toBe("cover");
  expect(stage.filter, JSON.stringify(stage)).toBe("none");
  expect(preview.backgroundSize, JSON.stringify(preview)).toBe("cover");
  expect(preview.filter, JSON.stringify(preview)).toBe("none");
  await page.screenshot({
    path: join(artifactPath, "settings-stage-clear-image.png"),
    animations: "disabled",
  });

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  stage = await readPhotoLayer(page, stageImage);
  expect(stage.backgroundSize, JSON.stringify(stage)).toBe("cover");
  expect(stage.filter, JSON.stringify(stage)).toBe("none");

  await page.getByRole("checkbox", { name: "磨砂效果" }).check();
  await expect.poll(() => readPhotoLayer(page, previewImage)).toMatchObject({
    backgroundSize: "cover",
  });
  preview = await readPhotoLayer(page, previewImage);
  expect(preview.filter, JSON.stringify(preview)).toContain("blur(22px)");
  stage = await readPhotoLayer(page, stageImage);
  expect(stage.filter, JSON.stringify(stage)).toBe("none");

  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background?.frosted;
  })).toBe(true);
  await expect.poll(() => readPhotoLayer(page, stageImage)).toMatchObject({
    backgroundSize: "cover",
  });
  stage = await readPhotoLayer(page, stageImage);
  expect(stage.filter, JSON.stringify(stage)).toContain("blur(22px)");
  await page.screenshot({
    path: join(artifactPath, "settings-stage-frosted-image.png"),
    animations: "disabled",
  });

  await openAppearanceSettings(page, "dark");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).toBeChecked();
  await page.getByRole("checkbox", { name: "磨砂效果" }).uncheck();
  preview = await readPhotoLayer(page, previewImage);
  expect(preview.backgroundSize, JSON.stringify(preview)).toBe("cover");
  expect(preview.filter, JSON.stringify(preview)).toBe("none");
  stage = await readPhotoLayer(page, stageImage);
  expect(stage.filter, JSON.stringify(stage)).toContain("blur(22px)");

  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background?.frosted;
  })).toBe(false);
  await expect.poll(() => readPhotoLayer(page, stageImage)).toMatchObject({
    backgroundSize: "cover",
  });
  stage = await readPhotoLayer(page, stageImage);
  expect(stage.filter, JSON.stringify(stage)).toBe("none");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  stage = await readPhotoLayer(page, stageImage);
  preview = await readPhotoLayer(page, previewImage);
  expect(stage.backgroundSize, JSON.stringify(stage)).toBe("cover");
  expect(stage.filter, JSON.stringify(stage)).toBe("none");
  expect(preview.backgroundSize, JSON.stringify(preview)).toBe("cover");
  expect(preview.filter, JSON.stringify(preview)).toBe("none");
  await page.screenshot({
    path: join(artifactPath, "settings-stage-clear-image-after-reload.png"),
    animations: "disabled",
  });
});

test("classic UI keeps image layout controls available with full image explicitly selected", async ({ page }) => {
  const portrait = syntheticBackdropDataUrl("portrait");
  await openAppearanceSettings(page, "light", "classic");
  await chooseImage(page, portrait, "contain");
  await expect(page.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();
  await saveImage(page, portrait, false);
  await openGroupShelf(page, 1440, "light", "classic");

  await expect(page.locator(".shelf--modern")).toHaveCount(0);
  await assertImagePresentation(page, "contain");
  await page.screenshot({
    path: join(artifactPath, "classic-light-clear-image.png"),
    animations: "disabled",
  });
});
