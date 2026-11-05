import { expect, test } from "playwright/test";

import {
  cardCases,
  cardOrder,
  dragFromPreview,
  openShelf,
  reorderPlan,
  selectedCardIds,
  type HostMode,
} from "./card-reorder-fixture";
import {
  beginPointerReorder,
  finishPointerReorder,
  movePointerReorder,
  readPointerReorderState,
  reorderWithPointer,
  savedCardOrders,
  windowCloseCallCount,
} from "./card-reorder-pointer";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

for (const mode of ["native-host", "legacy-host"] as const) {
  for (const cardCase of cardCases) {
    test(mode + ": single " + cardCase.name + " card sorts from its visible handle with pointer input", async ({ page }) => {
      await openShelf(page, mode);
      const initialOrder = await cardOrder(page);
      const plan = reorderPlan(initialOrder, [cardCase.id]);
      await page.locator(`[data-pb-item-id="${cardCase.id}"]`).click();

      const drag = await reorderWithPointer(page, cardCase.id, plan.targetId, plan.position);
      expect(drag.startState).toMatchObject({
        active: true,
        sourceCount: 1,
        sourceIds: [cardCase.id],
        previewCount: 1,
        previewOptionCount: 0,
        previewItemIdentityCount: 0,
      });
      expect(drag.targetState).toMatchObject({
        active: true,
        sourceIds: [cardCase.id],
        targetId: plan.targetId,
        targetPosition: plan.position,
        previewCount: 1,
      });
      expect(drag.order, "the user-visible pointer reorder must change the card order")
        .toEqual(plan.expectedOrder);
      expect(drag.savedOrders).toContainEqual({ scope: "all", itemIds: plan.expectedOrder });
      expect(drag.nativeStartResults, "internal handle sorting must not start an external drag").toEqual([]);
      expect(drag.selection).toEqual([cardCase.id]);
      expect(await selectedCardIds(page)).toEqual([cardCase.id]);
    });

    test(mode + ": multi-selection keeps " + cardCase.name + " handle sorting and selection", async ({ page }) => {
      await openShelf(page, mode);
      const initialOrder = await cardOrder(page);
      const secondId = cardCase.id === "text-old" ? "url-middle" : cardCase.id;
      const selected = [...new Set(["text-old", secondId])];
      const plan = reorderPlan(initialOrder, selected);
      await page.locator('[data-pb-item-id="text-old"]').click();
      await page.locator(`[data-pb-item-id="${secondId}"]`).click({ modifiers: ["Meta"] });

      expect(await selectedCardIds(page)).toEqual(plan.selectedInDomOrder);
      const drag = await reorderWithPointer(page, cardCase.id, plan.targetId, plan.position);
      expect(drag.startState).toMatchObject({
        active: true,
        sourceCount: plan.selectedInDomOrder.length,
        sourceIds: plan.selectedInDomOrder,
        previewCount: 1,
        previewOptionCount: 0,
        previewItemIdentityCount: 0,
      });
      expect(drag.targetState).toMatchObject({
        active: true,
        sourceIds: plan.selectedInDomOrder,
        targetId: plan.targetId,
        targetPosition: plan.position,
        previewCount: 1,
      });
      expect(drag.order).toEqual(plan.expectedOrder);
      expect(drag.savedOrders).toContainEqual({ scope: "all", itemIds: plan.expectedOrder });
      expect(drag.nativeStartResults).toEqual([]);
      expect(drag.selection).toEqual(plan.selectedInDomOrder);
      expect(await selectedCardIds(page)).toEqual(plan.selectedInDomOrder);
    });
  }
}

for (const mode of ["native-host", "legacy-host"] as const) {
  for (const cardCase of cardCases.filter((candidate) => candidate.id !== "text-old")) {
    test(mode + ": body drag exports " + cardCase.name + " directly without a modifier", async ({ page }) => {
      await openShelf(page, mode);
      const initialOrder = await cardOrder(page);
      await page.locator(`[data-pb-item-id="${cardCase.id}"]`).click();
      const plan = reorderPlan(initialOrder, [cardCase.id]);
      const drag = await dragFromPreview(page, cardCase, plan.targetId, plan.position);

      expect(drag.hit).toMatchObject({ itemId: cardCase.id });
      expect.soft(drag.metrics.nativeStartResults).toContainEqual({
        itemId: cardCase.id,
        started: mode === "native-host",
      });
      expect.soft(drag.metrics.dataWrites).not.toContainEqual({
        sourceId: cardCase.id,
        type: "application/x-pasteboard-pro-reorder",
      });
      if (mode === "legacy-host") {
        expect.soft(drag.metrics.dataWrites).toContainEqual({
          sourceId: cardCase.id,
          type: "application/x-pasteboard-pro-item",
        });
      }
      expect.soft(await cardOrder(page)).toEqual(initialOrder);
      expect.soft(drag.metrics.savedOrders).toEqual([]);
    });
  }
}

for (const mode of ["native-host", "legacy-host"] as const) {
  for (const cardCase of cardCases.filter((candidate) => candidate.id !== "text-old")) {
    test(mode + ": source drag remains available when list reorder is disabled for " + cardCase.name, async ({ page }) => {
      await openShelf(page, mode);
      const search = page.locator(".search-bar");
      await search.click();
      await page.getByRole("searchbox").fill(cardCase.id === "image-new" ? "scanned" : "quarterly");
      await expect(page.getByRole("option")).toHaveCount(1);
      await expect(page.locator(`[data-pb-item-id="${cardCase.id}"]`)).toBeVisible();
      const initialOrder = await cardOrder(page);
      const drag = await dragFromPreview(page, cardCase, cardCase.id, "after");

      expect(drag.hit).toMatchObject({ itemId: cardCase.id });
      expect.soft(drag.metrics.nativeStartResults).toContainEqual({
        itemId: cardCase.id,
        started: mode === "native-host",
      });
      expect.soft(drag.metrics.dataWrites).not.toContainEqual({
        sourceId: cardCase.id,
        type: "application/x-pasteboard-pro-reorder",
      });
      if (mode === "legacy-host") {
        expect.soft(drag.metrics.dataWrites).toContainEqual({
          sourceId: cardCase.id,
          type: "application/x-pasteboard-pro-item",
        });
      }
      expect.soft(await cardOrder(page)).toEqual(initialOrder);
      expect.soft(drag.metrics.savedOrders).toEqual([]);
    });
  }
}

test("a handle tap keeps the current multi-selection and does not start a reorder", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  await page.locator('[data-pb-item-id="text-old"]').click();
  await page.locator('[data-pb-item-id="url-middle"]').click({ modifiers: ["Meta"] });
  const selectionBeforeTap = await selectedCardIds(page);

  await page.locator('[data-pb-item-id="text-old"] [data-pb-reorder-handle]').click();

  expect(await selectedCardIds(page)).toEqual(selectionBeforeTap);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect(await savedCardOrders(page)).toEqual([]);
  await expect(page.locator('[data-pb-reorder-active="true"]')).toHaveCount(0);
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
});

test("Escape cancels pointer sorting and restores the source without saving an order", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  const sourceId = "image-new";
  const plan = reorderPlan(initialOrder, [sourceId]);
  await page.locator(`[data-pb-item-id="${sourceId}"]`).click();
  const session = await beginPointerReorder(page, sourceId);
  const targetState = await movePointerReorder(session, plan.targetId, plan.position);
  expect(targetState.active).toBe(true);

  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  await expect(page.locator('[data-pb-reorder-active="true"]')).toHaveCount(0);
  expect(await savedCardOrders(page)).toEqual([]);
  expect(await cardOrder(page)).toEqual(initialOrder);

  await page.locator('[data-pb-item-id="text-old"]').click();
  expect(await selectedCardIds(page)).toEqual(["text-old"]);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect(await savedCardOrders(page)).toEqual([]);
});

test("window blur cancels pointer reorder without closing the shelf and allows a new drag", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  const closeCallsBefore = await windowCloseCallCount(page);

  const blurSession = await beginPointerReorder(page, "image-new");
  expect(blurSession.startState.active).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  await expect(page.locator('[data-pb-reorder-active="true"]')).toHaveCount(0);
  expect(await windowCloseCallCount(page)).toBe(closeCallsBefore);
  expect(await savedCardOrders(page)).toEqual([]);
  expect(await cardOrder(page)).toEqual(initialOrder);

  const retryPlan = reorderPlan(initialOrder, ["image-new"]);
  const retry = await reorderWithPointer(page, "image-new", retryPlan.targetId, retryPlan.position);
  expect(retry.order).toEqual(retryPlan.expectedOrder);
  expect(retry.savedOrders).toContainEqual({ scope: "all", itemIds: retryPlan.expectedOrder });
});

test("hidden visibility cancels the active pointer session without saving", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  const visibilitySession = await beginPointerReorder(page, "image-new");
  expect(visibilitySession.startState.active).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.mouse.up();
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  await expect(page.locator('[data-pb-reorder-active="true"]')).toHaveCount(0);
  expect(await cardOrder(page)).toEqual(initialOrder);
  expect(await savedCardOrders(page)).toEqual([]);
});

test("search results hide the reorder handle while keeping body export available", async ({ page }) => {
  await openShelf(page, "native-host");
  const search = page.locator(".search-bar");
  await search.click();
  await page.getByRole("searchbox").fill("scanned");
  await expect(page.getByRole("option")).toHaveCount(1);
  const source = page.locator('[data-pb-item-id="image-new"]');
  await expect(source).toBeVisible();
  await expect(source.locator("[data-pb-reorder-handle]")).toHaveCount(0);

  const orderBefore = await cardOrder(page);
  const drag = await dragFromPreview(page, cardCases.find((card) => card.id === "image-new")!, "image-new", "after");
  expect(drag.metrics.nativeStartResults).toContainEqual({ itemId: "image-new", started: true });
  expect(drag.metrics.dataWrites).not.toContainEqual({
    sourceId: "image-new",
    type: "application/x-pasteboard-pro-reorder",
  });
  expect(await cardOrder(page)).toEqual(orderBefore);
  expect(await savedCardOrders(page)).toEqual([]);
});

test("real pointer reorder shows a visible preview and a source placeholder", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  const plan = reorderPlan(initialOrder, ["text-old"]);
  await page.locator('[data-pb-item-id="text-old"]').click();
  const session = await beginPointerReorder(page, "text-old");
  const activeState = await movePointerReorder(session, plan.targetId, plan.position);

  expect(activeState.active).toBe(true);
  expect(activeState.sourceIds).toEqual(["text-old"]);
  expect(activeState.previewCount).toBe(1);
  expect(activeState.previewOptionCount).toBe(0);
  expect(activeState.previewItemIdentityCount).toBe(0);
  const bounds = activeState.previewBounds;
  expect(bounds, "the active pointer reorder must render a DOM preview").not.toBeNull();
  const visibleWidth = Math.max(0, Math.min(bounds!.x + bounds!.width, activeState.viewport.width) - Math.max(0, bounds!.x));
  const visibleHeight = Math.max(0, Math.min(bounds!.y + bounds!.height, activeState.viewport.height) - Math.max(0, bounds!.y));
  expect(visibleWidth, "the cursor preview should remain visible horizontally").toBeGreaterThanOrEqual(80);
  expect(visibleHeight, "the cursor preview should remain visible vertically").toBeGreaterThanOrEqual(80);
  expect(Number(activeState.previewOpacity)).toBeGreaterThan(0);
  expect(Number(activeState.sourceOpacity), "the source placeholder should remain visible").toBeGreaterThan(0);
  expect(activeState.shiftedCount).toBeGreaterThan(0);
  expect(activeState.shiftedTransitionProperty).toContain("transform");

  const result = await finishPointerReorder(session, activeState);
  expect(result.order).toEqual(plan.expectedOrder);
  expect(result.savedOrders).toContainEqual({ scope: "all", itemIds: plan.expectedOrder });
});

test("text card body exports text directly without starting list reorder", async ({ page }) => {
  await openShelf(page, "native-host");
  const initialOrder = await cardOrder(page);
  const drag = await dragFromPreview(page, cardCases[0]!, "image-new", "after");
  expect(drag.metrics.dataWrites).toContainEqual({ sourceId: "text-old", type: "application/x-pasteboard-pro-item" });
  expect(drag.metrics.dataWrites).toContainEqual({ sourceId: "text-old", type: "text/plain" });
  expect(drag.metrics.dataWrites).not.toContainEqual({ sourceId: "text-old", type: "application/x-pasteboard-pro-reorder" });
  expect(drag.metrics.savedOrders).toEqual([]);
  expect(await cardOrder(page)).toEqual(initialOrder);
});

test("classic UI keeps sorting on its explicit handle", async ({ page }) => {
  await openShelf(page, "native-host", "classic");
  const initialOrder = await cardOrder(page);
  const plan = reorderPlan(initialOrder, ["text-old"]);
  await page.locator('[data-pb-item-id="text-old"]').click();
  const drag = await reorderWithPointer(page, "text-old", plan.targetId, plan.position);
  expect(drag.startState).toMatchObject({ active: true, sourceIds: ["text-old"], previewCount: 1 });
  expect(drag.order).toEqual(plan.expectedOrder);
  expect(drag.savedOrders).toContainEqual({ scope: "all", itemIds: plan.expectedOrder });
});
