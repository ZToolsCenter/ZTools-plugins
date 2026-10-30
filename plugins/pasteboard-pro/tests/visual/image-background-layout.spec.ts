import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { syntheticBackdropDataUrl } from "./background-image-fixture";
import { assertSavedImageBackground, chooseAndApplyBackgroundImage } from "./background-image-picker";
import { installGroupHost, openGroupShelf } from "./group-popover-host";

const base = "http://127.0.0.1:5179";
const artifactPath = join(process.cwd(), "artifacts", "pasteboardpro", "image-background-layout");

type Layout = "cover" | "contain" | "tile" | "repeat-x";

type CellInspection = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundSize: string;
  backgroundRepeat: string;
  filter: string;
  hasImage: boolean;
}>;

type BackdropInspection = Readonly<{
  layout: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
  filter: string;
  hasImage: boolean;
  cells: readonly CellInspection[];
}>;

async function openAppearanceSettings(page: Page, colorScheme: "dark" | "light"): Promise<void> {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, "modern");
  await page.goto(`${base}/?visual=1&panel=privacy&tab=appearance`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", "modern");
}

async function chooseAndSaveImage(page: Page, imageDataUrl: string): Promise<void> {
  await chooseAndApplyBackgroundImage(page, imageDataUrl);
  await expect(page.locator('input[name="background-type"][value="image"]')).toBeChecked();
  await expect(page.getByLabel("图片渲染方式")).toHaveValue("cover");
  await expect(page.getByRole("checkbox", { name: "自定义背景底色" })).toHaveCount(0);
  await expect(page.getByText("背景底色", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await assertSavedImageBackground(page, false);
}

async function readSavedBackground(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    const theme = raw === null ? undefined : JSON.parse(raw).theme;
    return theme?.background ?? {};
  });
}

async function saveLayout(page: Page, layout: Layout, count?: number): Promise<void> {
  await page.getByLabel("图片渲染方式").selectOption(layout);
  const countInput = page.getByLabel("每行图片数量");
  if (layout === "tile" || layout === "repeat-x") {
    await expect(countInput).toBeVisible();
    await countInput.fill(String(count ?? 3));
    await countInput.blur();
  } else {
    await expect(countInput).toHaveCount(0);
  }

  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect.poll(() => readSavedBackground(page)).toMatchObject({
    type: "image",
    layout,
    ...((layout === "tile" || layout === "repeat-x") ? { tilesPerRow: count ?? 3 } : {}),
  });

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("图片渲染方式")).toHaveValue(layout);
  if (layout === "tile" || layout === "repeat-x") {
    await expect(page.getByLabel("每行图片数量")).toHaveValue(String(count ?? 3));
  }
}

async function notifyShelf(shelf: Page): Promise<void> {
  await shelf.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:window-preferences-changed"));
  });
}

async function inspectBackdrop(shelf: Page): Promise<BackdropInspection> {
  const backdrop = shelf.locator(".stage [data-pb-image-backdrop]");
  await expect(backdrop).toHaveCount(1);
  return backdrop.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const cells = [...element.querySelectorAll<HTMLElement>("[data-pb-image-repeat-cell]")]
      .map((cell) => {
        const cellStyle = getComputedStyle(cell);
        const cellBounds = cell.getBoundingClientRect();
        return {
          x: cellBounds.x,
          y: cellBounds.y,
          width: cellBounds.width,
          height: cellBounds.height,
          backgroundSize: cellStyle.backgroundSize,
          backgroundRepeat: cellStyle.backgroundRepeat,
          filter: cellStyle.filter,
          hasImage: cellStyle.backgroundImage.includes("data:image/png;base64,"),
        };
      });

    return {
      layout: element.getAttribute("data-pb-image-layout"),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      backgroundSize: style.backgroundSize,
      backgroundRepeat: style.backgroundRepeat,
      backgroundPosition: style.backgroundPosition,
      filter: style.filter,
      hasImage: style.backgroundImage.includes("data:image/png;base64,"),
      cells,
    };
  });
}

function assertRepeatCells(
  backdrop: BackdropInspection,
  count: number,
  frosted: boolean,
): void {
  expect(backdrop.layout).toBe("repeat-x");
  expect(backdrop.cells).toHaveLength(count);
  expect(backdrop.width).toBeGreaterThan(0);
  expect(backdrop.filter).toContain(frosted ? "blur(22px)" : "none");
  for (const [index, cell] of backdrop.cells.entries()) {
    expect(cell.hasImage).toBe(true);
    expect(cell.backgroundSize).toBe("cover");
    expect(cell.backgroundRepeat).toBe("no-repeat");
    expect(cell.filter).toBe("none");
    expect(Math.abs(cell.y - backdrop.y)).toBeLessThan(1);
    expect(cell.width).toBeCloseTo(backdrop.width / count, 0);
    expect(cell.height).toBeCloseTo(backdrop.height, 0);
    expect(Math.abs(cell.x - (backdrop.x + (backdrop.width / count) * index))).toBeLessThan(1);
  }
  expect(backdrop.cells.reduce((width, cell) => width + cell.width, 0)).toBeCloseTo(backdrop.width, 0);
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("image layout modes render independently, persist after reload, and tile counts form one row", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const settings = await context.newPage();
  const shelf = await context.newPage();
  const image = syntheticBackdropDataUrl("wide");

  try {
    await openAppearanceSettings(settings, "dark");
    await chooseAndSaveImage(settings, image);

    // Simulate a saved image preference from before the layout field existed.
    await settings.evaluate(() => {
      const key = "pb-test-window-preferences";
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (stored.theme?.background) delete stored.theme.background.layout;
      localStorage.setItem(key, JSON.stringify(stored));
    });
    await settings.reload({ waitUntil: "networkidle" });
    await expect(settings.getByLabel("图片渲染方式")).toHaveValue("cover");

    await saveLayout(settings, "cover");
    await openGroupShelf(shelf, 1440, "dark", "modern");
    let backdrop = await inspectBackdrop(shelf);
    expect(backdrop.layout).toBe("cover");
    expect(backdrop.hasImage).toBe(true);
    expect(backdrop.backgroundSize).toBe("cover");
    expect(backdrop.backgroundRepeat).toBe("no-repeat");
    expect(backdrop.cells).toHaveLength(0);
    await shelf.screenshot({ path: join(artifactPath, "modern-dark-cover.png"), animations: "disabled" });

    await saveLayout(settings, "contain");
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    expect(backdrop.layout).toBe("contain");
    expect(backdrop.backgroundSize).toBe("contain");
    expect(backdrop.backgroundRepeat).toBe("no-repeat");
    expect(backdrop.hasImage).toBe(true);
    await shelf.emulateMedia({ colorScheme: "light" });
    await shelf.screenshot({ path: join(artifactPath, "modern-light-contain.png"), animations: "disabled" });

    await saveLayout(settings, "tile", 3);
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    expect(backdrop.layout).toBe("tile");
    expect(backdrop.hasImage).toBe(true);
    expect(backdrop.backgroundPosition).toBe("0% 0%");
    expect(backdrop.backgroundRepeat).toBe("repeat");
    expect(backdrop.cells).toHaveLength(0);
    expect(backdrop.backgroundSize).toMatch(/% auto$/);
    expect(Number.parseFloat(backdrop.backgroundSize)).toBeCloseTo(100 / 3, 1);
    await shelf.screenshot({ path: join(artifactPath, "modern-light-tile-3.png"), animations: "disabled" });

    await saveLayout(settings, "repeat-x", 3);
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    assertRepeatCells(backdrop, 3, false);
    await shelf.screenshot({ path: join(artifactPath, "modern-light-repeat-x-3.png"), animations: "disabled" });

    await saveLayout(settings, "tile", 3);
    await settings.getByRole("checkbox", { name: "磨砂效果" }).check();
    await settings.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect.poll(() => readSavedBackground(settings)).toMatchObject({
      type: "image",
      layout: "tile",
      tilesPerRow: 3,
      frosted: true,
    });
    await settings.reload({ waitUntil: "networkidle" });
    await expect(settings.getByLabel("图片渲染方式")).toHaveValue("tile");
    await expect(settings.getByRole("checkbox", { name: "磨砂效果" })).toBeChecked();
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    expect(backdrop.layout).toBe("tile");
    expect(backdrop.backgroundRepeat).toBe("repeat");
    expect(backdrop.filter).toContain("blur(22px)");

    await saveLayout(settings, "repeat-x", 3);
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    assertRepeatCells(backdrop, 3, true);
    await shelf.screenshot({ path: join(artifactPath, "modern-light-repeat-x-3-frosted.png"), animations: "disabled" });

    await saveLayout(settings, "repeat-x", 5);
    await notifyShelf(shelf);
    backdrop = await inspectBackdrop(shelf);
    assertRepeatCells(backdrop, 5, true);
    await shelf.setViewportSize({ width: 380, height: 360 });
    await expect(shelf.locator(".shelf--modern")).toBeVisible();
    await shelf.screenshot({ path: join(artifactPath, "modern-light-repeat-x-5-narrow.png"), animations: "disabled" });

    await saveLayout(settings, "repeat-x", 3);
    await settings.getByRole("checkbox", { name: "磨砂效果" }).uncheck();
    await settings.getByRole("radiogroup", { name: "界面版本" })
      .getByRole("radio", { name: "经典版" })
      .locator("xpath=..")
      .click();
    await settings.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect.poll(() => settings.evaluate(() => {
      const raw = localStorage.getItem("pb-test-window-preferences");
      return raw === null ? undefined : JSON.parse(raw);
    })).toMatchObject({
      uiVersion: "classic",
      theme: { background: { type: "image", layout: "repeat-x", tilesPerRow: 3, frosted: false } },
    });
    await settings.reload({ waitUntil: "networkidle" });
    await expect(settings.locator(".settings-panel")).toHaveAttribute("data-ui-version", "classic");
    await expect(settings.getByLabel("图片渲染方式")).toHaveValue("repeat-x");
    await expect(settings.getByLabel("每行图片数量")).toHaveValue("3");
    await expect(settings.getByRole("checkbox", { name: "磨砂效果" })).not.toBeChecked();

    const classicShelf = await context.newPage();
    await openGroupShelf(classicShelf, 1440, "light", "classic");
    const classicBackdrop = await inspectBackdrop(classicShelf);
    assertRepeatCells(classicBackdrop, 3, false);
    await classicShelf.screenshot({
      path: join(artifactPath, "classic-light-repeat-x-3.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});
