import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "playwright/test";

import {
  dragPinboardGroup,
  expectInsideShelf,
  installGroupHost,
  openGroupShelf,
  readGroupMetrics,
} from "./group-popover-host";

const groupArtifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "group-version-results",
);

test.beforeEach(async () => {
  await mkdir(groupArtifactPath, { recursive: true });
});

async function pinboardOrder(page: import("playwright/test").Page): Promise<string[]> {
  return page.locator(".pinboard-chip").evaluateAll((chips) =>
    chips.flatMap((chip) => {
      const id = (chip as HTMLElement).dataset.pbPinboardId;
      return id === undefined ? [] : [id];
    }),
  );
}

test("new group dialog validates, ignores IME Enter and returns focus after Escape", async ({ page }) => {
  await openGroupShelf(page, 380, "dark");
  const add = page.getByRole("button", { name: "新建分组", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "新建分组" });
  const input = page.getByRole("textbox", { name: "新建分组", exact: true });
  await expect(input).toBeFocused();
  await expectInsideShelf(page, ".pinboard-name-dialog", 380);
  await page.screenshot({
    path: join(groupArtifactPath, "modern-new-group-dialog-dark-380x360.png"),
    animations: "disabled",
  });

  await input.evaluate((element) => {
    for (const key of ["f", "n"]) {
      element.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    }
  });
  await expect(input).toBeFocused();
  expect((await readGroupMetrics(page)).panels).toEqual([]);

  const create = dialog.getByRole("button", { name: "创建", exact: true });
  await input.fill("   ");
  await expect(create).toBeDisabled();
  await input.fill("Work draft");
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true }));
    (element.closest("form") as HTMLFormElement).requestSubmit();
  });
  await expect(dialog).toBeVisible();
  expect((await readGroupMetrics(page)).created).toEqual([]);

  await input.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.locator(".shelf--modern")).toBeVisible();
  expect((await readGroupMetrics(page)).closeCount).toBe(0);
});

test("create, rename, color and pointer-reorder groups without menu move controls", async ({ page }) => {
  const wideName = "The Really Wide Research Collection";
  await openGroupShelf(page, 1500, "dark");

  for (const name of ["Ideas", wideName]) {
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建分组" });
    await page.getByRole("textbox", { name: "新建分组", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  expect((await readGroupMetrics(page)).created).toEqual(["Ideas", wideName]);

  const ideas = page.getByRole("button", { name: "Ideas", exact: true });
  await ideas.dblclick();
  const renameDialog = page.getByRole("dialog", { name: "重命名分组" });
  const renameInput = page.getByRole("textbox", { name: "重命名分组", exact: true });
  await expect(renameInput).toBeFocused();
  await renameInput.fill("Ideas & Notes");
  await renameDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ideas & Notes", exact: true })).toBeVisible();
  expect((await readGroupMetrics(page)).renamed).toEqual([{ id: "board-created-1", name: "Ideas & Notes" }]);

  await page.getByRole("button", { name: "管理 Ideas & Notes", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Ideas & Notes 管理选项" });
  await expect(menu).toBeVisible();
  await expectInsideShelf(page, ".pinboard-manage-menu", 1500);
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(47, 52, 59)");
  await expect(menu.getByRole("menuitem", { name: /移到左侧|移到右侧/ })).toHaveCount(0);
  await page.screenshot({
    path: join(groupArtifactPath, "modern-group-menu-graphite-dark.png"),
    animations: "disabled",
  });

  const color = menu.getByRole("menuitem", { name: "分组颜色" });
  await color.fill("#445566");
  await expect(menu).toBeHidden();
  expect((await readGroupMetrics(page)).colors).toEqual([{ id: "board-created-1", color: "#445566" }]);
  await page.getByRole("button", { name: "管理 Ideas & Notes", exact: true }).click();
  const reopenedMenu = page.getByRole("menu", { name: "Ideas & Notes 管理选项" });
  await expect(reopenedMenu).toBeVisible();
  await dragPinboardGroup(page, "board-created-1", "board-reference", "before");
  await expect(reopenedMenu).toBeHidden();
  expect((await readGroupMetrics(page)).moves).toEqual([{
    id: "board-created-1",
    beforeId: "board-work",
    afterId: "board-reference",
  }]);

  const wideChip = page.locator('[data-pb-pinboard-id="board-created-2"]');
  const originalOrder = ["board-work", "board-created-1", "board-reference", "board-created-2"];
  await expect.poll(() => pinboardOrder(page)).toEqual(originalOrder);
  const wideBounds = await wideChip.boundingBox();
  const workBounds = await page.locator('[data-pb-pinboard-id="board-work"]').boundingBox();
  expect(wideBounds).not.toBeNull();
  expect(workBounds).not.toBeNull();
  expect(wideBounds!.width - workBounds!.width).toBeGreaterThan(100);
  await wideChip.getByRole("button", { name: wideName, exact: true }).click();
  await expect(wideChip).toHaveClass(/pinboard-chip--active/);
  const smartPinboards = await page.locator(".smart-pinboard").allTextContents();

  await dragPinboardGroup(page, "board-created-2", "board-work", "before", true);
  expect((await readGroupMetrics(page)).moves).toHaveLength(1);
  await expect.poll(() => pinboardOrder(page)).toEqual(originalOrder);
  await expect(wideChip).toHaveClass(/pinboard-chip--active/);

  await dragPinboardGroup(
    page,
    "board-created-2",
    "board-work",
    "before",
    false,
    join(groupArtifactPath, "modern-group-drag-in-progress.png"),
  );
  await expect.poll(() => pinboardOrder(page)).toEqual([
    "board-created-2", "board-work", "board-created-1", "board-reference",
  ]);
  expect((await readGroupMetrics(page)).moves).toEqual([
    { id: "board-created-1", beforeId: "board-work", afterId: "board-reference" },
    { id: "board-created-2", afterId: "board-work" },
  ]);
  await expect(wideChip).toHaveClass(/pinboard-chip--active/);
  expect(await page.locator(".smart-pinboard").allTextContents()).toEqual(smartPinboards);

  await dragPinboardGroup(page, "board-created-2", "board-reference", "after");
  await expect.poll(() => pinboardOrder(page)).toEqual([
    "board-work", "board-created-1", "board-reference", "board-created-2",
  ]);
  expect((await readGroupMetrics(page)).moves).toEqual([
    { id: "board-created-1", beforeId: "board-work", afterId: "board-reference" },
    { id: "board-created-2", afterId: "board-work" },
    { id: "board-created-2", beforeId: "board-reference" },
  ]);
  await expect(wideChip).toHaveClass(/pinboard-chip--active/);
  expect(await page.locator(".smart-pinboard").allTextContents()).toEqual(smartPinboards);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({
    path: join(groupArtifactPath, "modern-group-order-after-pointer-drag.png"),
    animations: "disabled",
  });
});

test("light popover avoids window edges at compact width and shelf height", async ({ page }) => {
  await openGroupShelf(page, 320, "light");
  await page.getByRole("button", { name: "管理 Reference", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Reference 管理选项" });
  await expect(menu).toBeVisible();
  await expectInsideShelf(page, ".pinboard-manage-menu", 320);
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  await page.screenshot({
    path: join(groupArtifactPath, "modern-group-menu-light-320x360.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "管理 Reference", exact: true })).toBeFocused();
  await expect(page.locator(".shelf--modern")).toBeVisible();
  expect((await readGroupMetrics(page)).closeCount).toBe(0);
});


test("card assignment menu stays inside the right edge and Escape returns to its card", async ({ page }) => {
  await openGroupShelf(page, 320, "dark");
  const card = page.getByRole("option").first();
  const bounds = (await card.boundingBox())!;
  await card.click({ button: "right", position: { x: bounds.width - 3, y: 60 } });
  const menu = page.getByRole("menu", { name: "添加到分组", exact: true });
  await expect(menu).toBeVisible();
  await expectInsideShelf(page, ".pinboard-context-menu", 320);
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(47, 52, 59)");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(card).toBeFocused();
  expect((await readGroupMetrics(page)).closeCount).toBe(0);
});
