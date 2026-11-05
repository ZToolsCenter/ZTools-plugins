import { expect, test } from "playwright/test";
import { historyFixture } from "@pasteboard-pro/contract-fixtures";

import { cardOrder, openShelf, reorderPlan, selectedCardIds } from "./card-reorder-fixture";
import {
  beginPointerReorder,
  finishPointerReorder,
  movePointerReorder,
  readPointerReorderState,
  reorderWithPointer,
} from "./card-reorder-pointer";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

test("history refresh during handle reorder commits against the newest snapshot and can be repeated", async ({ page }) => {
  await openShelf(page, "native-host");

  const sourceId = "text-old";
  const initialOrder = await cardOrder(page);
  const originalPlan = reorderPlan(initialOrder, [sourceId]);
  await page.locator(`[data-pb-item-id="${sourceId}"]`).click();
  const session = await beginPointerReorder(page, sourceId);
  const targetState = await movePointerReorder(session, originalPlan.targetId, originalPlan.position);

  expect(session.startState).toMatchObject({ active: true, sourceCount: 1, sourceIds: [sourceId], previewCount: 1 });
  expect(targetState).toMatchObject({
    active: true,
    sourceIds: [sourceId],
    targetId: originalPlan.targetId,
    targetPosition: originalPlan.position,
    previewCount: 1,
    previewOptionCount: 0,
    previewItemIdentityCount: 0,
  });

  const refreshedImage = {
    ...structuredClone(historyFixture.find((item) => item.id === "image-new")!),
    id: "history-refresh-image",
    title: "Screenshot captured during card sorting",
    copiedAt: "2026-10-26T13:00:00.000Z",
    updatedAt: "2026-10-26T13:00:00.000Z",
    contentFingerprint: "sha256:history-refresh-image:v1",
  };
  const refreshedItems = [refreshedImage, ...structuredClone(historyFixture)];

  let released = false;
  try {
    // Simulate the host's history-changed notification and updated snapshot.
    // The application listener and ordinary history replacement path stay live.
    await page.evaluate((items) => {
      const bridge = (window as unknown as {
        pasteboardPro: {
          searchHistory: (...args: unknown[]) => Promise<unknown>;
        };
      }).pasteboardPro;
      bridge.searchHistory = async () => ({ items, total: items.length });
      window.dispatchEvent(new Event("pasteboard-pro:history-changed"));
    }, refreshedItems);
    await expect(page.locator(".status")).toContainText("已载入 6 条记录");
    await expect(page.locator('[data-pb-item-id="history-refresh-image"]')).toHaveCount(0);

    const activeAfterRefresh = await readPointerReorderState(page);
    expect.soft(
      activeAfterRefresh,
      "history replacement must preserve the in-flight source, target slot, and preview",
    ).toMatchObject({
      active: true,
      sourceIds: [sourceId],
      targetId: originalPlan.targetId,
      targetPosition: originalPlan.position,
      previewCount: 1,
      sourceCount: 1,
    });
    await page.screenshot({
      path: "artifacts/pasteboardpro/card-reorder-pointer-during-history-refresh.png",
      animations: "disabled",
    });

    const refreshedOrder = [refreshedImage.id, ...initialOrder];
    const expectedPlan = reorderPlan(
      refreshedOrder,
      [sourceId],
      { targetId: originalPlan.targetId, position: originalPlan.position },
    );
    const committed = await finishPointerReorder(session, activeAfterRefresh);
    released = true;

    expect(committed.order, "the history refresh item must remain in the persisted order")
      .toEqual(expectedPlan.expectedOrder);
    await expect(page.locator('[data-pb-item-id="history-refresh-image"]')).toBeVisible();
    await page.screenshot({
      path: "artifacts/pasteboardpro/card-reorder-pointer-after-history-refresh.png",
      animations: "disabled",
    });
    expect(committed.savedOrders).toContainEqual({ scope: "all", itemIds: expectedPlan.expectedOrder });
    expect(committed.selection).toEqual([sourceId]);
  } finally {
    if (!released) await page.mouse.up();
  }

  const afterFirstDrop = await cardOrder(page);
  const secondPlan = reorderPlan(afterFirstDrop, [sourceId]);
  const secondDrag = await reorderWithPointer(page, sourceId, secondPlan.targetId, secondPlan.position);
  expect(secondDrag.order).toEqual(secondPlan.expectedOrder);
  expect(secondDrag.savedOrders).toContainEqual({ scope: "all", itemIds: secondPlan.expectedOrder });
  expect(secondDrag.selection).toEqual([sourceId]);
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  await expect(page.locator('.timeline__track[data-pb-reorder-active="true"]')).toHaveCount(0);
  expect(await selectedCardIds(page)).toEqual([sourceId]);
});
