import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { syntheticBackdropDataUrl } from "./background-image-fixture";
import {
  assertSavedImageBackground,
  selectBackgroundFile,
} from "./background-image-picker";
import { installGroupHost } from "./group-popover-host";
import { settingsTestBaseUrl } from "./settings-test-host";

const artifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "image-background-editor",
);

async function openAppearanceSettings(
  page: Page,
  uiVersion: "modern" | "classic" = "modern",
  width = 980,
  height = 760,
  colorScheme: "dark" | "light" = "dark",
): Promise<void> {
  await mkdir(artifactPath, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, uiVersion);
  await page.goto(`${settingsTestBaseUrl}/?visual=1&panel=privacy&tab=appearance`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
}

function pngDimensions(dataUrl: string): Readonly<{ width: number; height: number }> {
  const match = /^data:image\/png;base64,([\da-z+/]+=*)$/i.exec(dataUrl);
  if (match === null) throw new Error("Edited image should be a PNG data URL");
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length < 24) throw new Error("Edited PNG is truncated");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function saveSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
}

test("settings-owned file selection opens the editor above the settings window", async ({ page }) => {
  await openAppearanceSettings(page);
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __legacyOpenCalls?: number;
      ztools?: { showOpenDialog?: () => never };
    };
    testWindow.__legacyOpenCalls = 0;
    Object.defineProperty(testWindow, "ztools", {
      configurable: true,
      value: { showOpenDialog: () => { testWindow.__legacyOpenCalls! += 1; throw new Error("legacy host chooser must not be called"); } },
    });
  });
  const image = syntheticBackdropDataUrl("wide");
  await selectBackgroundFile(page, image);

  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  const layers = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(".background-image-editor");
    const settings = document.querySelector<HTMLElement>(".settings-panel");
    if (editor === null || settings === null) throw new Error("Both settings layers should be mounted");
    const editorBounds = editor.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      editorBounds.left + editorBounds.width / 2,
      editorBounds.top + editorBounds.height / 2,
    );
    return {
      editorZ: Number.parseInt(getComputedStyle(editor.parentElement!).zIndex, 10),
      settingsZ: Number.parseInt(getComputedStyle(settings).zIndex, 10) || 0,
      editorIsTop: topElement?.closest(".background-image-editor") !== null,
      editorBackground: getComputedStyle(editor).backgroundColor,
      cropRatio: getComputedStyle(document.querySelector("[data-pb-image-crop]" )!).width,
    };
  });
  expect(layers.editorZ).toBeGreaterThan(layers.settingsZ);
  expect(layers.editorIsTop).toBe(true);
  expect(layers.editorBackground).toBe("rgb(36, 40, 46)");
  expect(layers.cropRatio).toBeTruthy();
  await expect.poll(() => page.evaluate(() => (window as Window & { __legacyOpenCalls?: number }).__legacyOpenCalls)).toBe(0);
  await expect(editor.locator("select")).toHaveValue("original");
  await expect(editor.getByLabel("输出宽度")).toHaveValue("1600");
  await expect(editor.locator("[data-pb-crop-handle]")).toHaveCount(4);
  await page.screenshot({
    path: join(artifactPath, "image-editor-layer-and-full-image.png"),
    animations: "disabled",
  });
});


test("modern light editor follows the appearance theme", async ({ page }) => {
  await openAppearanceSettings(page, "modern", 980, 760, "light");
  await selectBackgroundFile(page, syntheticBackdropDataUrl("wide"));
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await expect(editor).toHaveCSS("background-color", "rgb(245, 246, 248)");
  await page.screenshot({
    path: join(artifactPath, "modern-light-image-editor.png"),
    animations: "disabled",
  });
});

test("crop handles, ratio lock, and output resizing export the selected pixels", async ({ page }) => {
  await openAppearanceSettings(page);
  await selectBackgroundFile(page, syntheticBackdropDataUrl("wide"));
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  const crop = editor.locator("[data-pb-image-crop]");
  await editor.locator("select").selectOption("1:1");
  const before = await crop.boundingBox();
  const handle = editor.locator('[data-pb-crop-handle="ne"]');
  const handleBounds = await handle.boundingBox();
  if (before === null || handleBounds === null) throw new Error("Crop control should have visible bounds");
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBounds.x + handleBounds.width / 2 - 22, handleBounds.y + handleBounds.height / 2);
  await page.mouse.up();
  const after = await crop.boundingBox();
  if (after === null) throw new Error("Crop selection should remain visible");
  expect(after.width).toBeLessThan(before.width);
  expect(after.height).toBeLessThan(before.height);
  expect(Math.abs(after.width - after.height)).toBeLessThan(3);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThan(1.5);

  await editor.getByLabel("输出宽度").fill("420");
  await expect(editor.getByLabel("输出高度")).toHaveValue("420");
  await editor.getByRole("button", { name: "应用图片" }).click();
  await expect(editor).toHaveCount(0);
  await saveSettings(page);
  const edited = await assertSavedImageBackground(page, false);
  expect(pngDimensions(edited)).toEqual({ width: 420, height: 420 });
});

test("rotation updates output size and preserves the four image quadrants", async ({ page }) => {
  await openAppearanceSettings(page);
  const quadrants = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 60, 40);
    context.fillStyle = "#00ff00";
    context.fillRect(60, 0, 60, 40);
    context.fillStyle = "#0000ff";
    context.fillRect(0, 40, 60, 40);
    context.fillStyle = "#ffff00";
    context.fillRect(60, 40, 60, 40);
    return canvas.toDataURL("image/png");
  });
  await selectBackgroundFile(page, quadrants);
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  const preview = editor.locator("[data-pb-image-editor-preview]");
  await expect(preview).toHaveJSProperty("width", 120);
  await expect(preview).toHaveJSProperty("height", 80);

  await editor.getByRole("button", { name: "向右旋转" }).click();
  await expect(preview).toHaveJSProperty("width", 80);
  await expect(preview).toHaveJSProperty("height", 120);
  await editor.getByLabel("输出宽度").fill("80");
  await expect(editor.getByLabel("输出高度")).toHaveValue("120");
  await editor.getByRole("button", { name: "应用图片" }).click();
  await saveSettings(page);
  const rotated = await assertSavedImageBackground(page, false);
  expect(pngDimensions(rotated)).toEqual({ width: 80, height: 120 });
  const pixels = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const sample = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    return {
      topLeft: sample(5, 5),
      topRight: sample(canvas.width - 6, 5),
      bottomLeft: sample(5, canvas.height - 6),
      bottomRight: sample(canvas.width - 6, canvas.height - 6),
    };
  }, rotated);
  expect(pixels).toEqual({
    topLeft: [0, 0, 255],
    topRight: [255, 0, 0],
    bottomLeft: [255, 255, 0],
    bottomRight: [0, 255, 0],
  });

  await page.getByRole("button", { name: "编辑图片", exact: true }).click();
  const resetEditor = page.getByRole("dialog", { name: "编辑背景图片" });
  await resetEditor.getByRole("button", { name: "向左旋转" }).click();
  await expect(resetEditor.locator("[data-pb-image-editor-preview]")).toHaveJSProperty("width", 120);
  await expect(resetEditor.locator("[data-pb-image-editor-preview]")).toHaveJSProperty("height", 80);
  await resetEditor.getByRole("button", { name: "重置图片" }).click();
  await expect(resetEditor.locator("select")).toHaveValue("original");
  await expect(resetEditor.locator("[data-pb-image-editor-preview]")).toHaveJSProperty("width", 80);
  await expect(resetEditor.locator("[data-pb-image-editor-preview]")).toHaveJSProperty("height", 120);
});


test("JPEG images retain their format after crop processing", async ({ page }) => {
  await openAppearanceSettings(page);
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 120, 80);
    gradient.addColorStop(0, "#20487a");
    gradient.addColorStop(1, "#dc8f42");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 120, 80);
    return canvas.toDataURL("image/jpeg", 0.98);
  });
  await selectBackgroundFile(page, jpeg);
  await page.getByRole("dialog", { name: "编辑背景图片" })
    .getByRole("button", { name: "应用图片" }).click();
  await saveSettings(page);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background?.imageDataUrl as string | undefined;
  });
  expect(saved).toMatch(/^data:image\/jpeg;base64,/);
  const dimensions = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl!;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, saved);
  expect(dimensions).toEqual({ width: 120, height: 80 });
});

test("cancel and Escape leave the current saved image intact and return focus", async ({ page }) => {
  const original = syntheticBackdropDataUrl("wide");
  await openAppearanceSettings(page);
  await selectBackgroundFile(page, original);
  let editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await editor.getByRole("button", { name: "应用图片" }).click();
  await saveSettings(page);
  const originalSaved = await assertSavedImageBackground(page, false);

  await page.getByRole("button", { name: "编辑图片", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "编辑背景图片" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑图片", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "编辑图片", exact: true }).click();
  editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await editor.getByRole("button", { name: "取消" }).click();
  await saveSettings(page);
  const afterCancel = await assertSavedImageBackground(page, false);
  expect(afterCancel).toBe(originalSaved);
});

test("file validation, narrow layout, and classic editor stay usable", async ({ page }) => {
  await openAppearanceSettings(page, "classic", 380, 360);
  const input = page.locator('input[type="file"][accept*="image"]');
  await page.getByRole("button", { name: "选择图片", exact: true }).click();
  await input.setInputFiles({ name: "unsupported.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByRole("alert")).toContainText("仅支持 PNG、JPEG 和 WebP");

  await page.getByRole("button", { name: "选择图片", exact: true }).click();
  await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("不超过 8 MB");

  await selectBackgroundFile(page, syntheticBackdropDataUrl("portrait"));
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("select")).toBeVisible();
  await expect(editor.getByRole("button", { name: "应用图片" })).toBeVisible();
  await expect(editor).toHaveCSS("background-color", "rgb(40, 37, 54)");
  await page.screenshot({
    path: join(artifactPath, "classic-narrow-editor.png"),
    animations: "disabled",
  });
});
