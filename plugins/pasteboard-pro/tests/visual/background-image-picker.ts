import { expect, type Page } from "playwright/test";

/** Exercises Chromium's per-window chooser and waits for the top-layer editor. */
export async function selectBackgroundFile(
  page: Page,
  dataUrl: string,
  buttonName = "选择图片",
): Promise<void> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/]+=*)$/i.exec(dataUrl);
  if (match === null) throw new TypeError("Visual image fixture must be a supported base64 data URL");
  const mimeType = match[1]!;
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  const input = page.locator('input[type="file"][accept*="image"]');
  await expect(input).toHaveCount(1);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: buttonName, exact: true }).click(),
  ]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({
    name: `background.${extension}`,
    mimeType,
    buffer: Buffer.from(match[2]!, "base64"),
  });
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[data-pb-image-editor-preview]")).toBeVisible();
}

export async function chooseAndApplyBackgroundImage(
  page: Page,
  dataUrl: string,
  buttonName = "选择图片",
): Promise<void> {
  await selectBackgroundFile(page, dataUrl, buttonName);
  const editor = page.getByRole("dialog", { name: "编辑背景图片" });
  await editor.getByRole("button", { name: "应用图片" }).click();
  await expect(editor).toHaveCount(0);
}

export async function assertSavedImageBackground(
  page: Page,
  frosted: boolean,
): Promise<string> {
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background;
  })).toMatchObject({ type: "image", frosted });
  const background = await page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? undefined : JSON.parse(raw).theme?.background;
  }) as { imageDataUrl?: string } | undefined;
  if (!background?.imageDataUrl || !/^data:image\/(?:png|jpeg);base64,/i.test(background.imageDataUrl)) {
    throw new Error("Saved background should contain the editor's exported PNG or JPEG data URL");
  }
  return background.imageDataUrl;
}
