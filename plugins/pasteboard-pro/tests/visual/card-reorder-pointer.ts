import { expect, type Page } from "playwright/test";

import { cardOrder, selectedCardIds } from "./card-reorder-fixture";

export type PointerDropPosition = "before" | "after";

export type PointerReorderState = Readonly<{
  active: boolean;
  sourceCount: number;
  sourceIds: string[];
  targetId: string | null;
  targetPosition: PointerDropPosition | null;
  previewCount: number;
  previewOptionCount: number;
  previewItemIdentityCount: number;
  previewBounds: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  previewOpacity: string | null;
  sourceOpacity: string | null;
  sourceOutlineStyle: string | null;
  shiftedCount: number;
  shiftedTransitionProperty: string | null;
  viewport: Readonly<{ width: number; height: number }>;
}>;

export type PointerReorderSession = Readonly<{
  page: Page;
  sourceId: string;
  startState: PointerReorderState;
}>;

export type PointerReorderResult = Readonly<{
  startState: PointerReorderState;
  targetState: PointerReorderState;
  order: string[];
  selection: string[];
  savedOrders: Array<{ scope: string; itemIds: string[] }>;
  nativeStartResults: Array<{ itemId: string; started: boolean }>;
}>;

export async function readPointerReorderState(page: Page): Promise<PointerReorderState> {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(".timeline__track");
    const sources = [...document.querySelectorAll<HTMLElement>(".paste-card--dragging[data-pb-item-id]")];
    const preview = document.querySelector<HTMLElement>("[data-pb-reorder-preview]");
    const bounds = preview?.getBoundingClientRect();
    const shifted = [...document.querySelectorAll<HTMLElement>(
      ".paste-card--shift-backward, .paste-card--shift-forward",
    )];
    const source = sources[0];
    const sourceCount = Number.parseInt(track?.dataset.pbReorderSourceCount ?? "0", 10);
    const targetPosition = track?.dataset.pbReorderTargetPosition;
    return {
      active: track?.dataset.pbReorderActive === "true",
      sourceCount: Number.isFinite(sourceCount) ? sourceCount : 0,
      sourceIds: sources.map((card) => card.dataset.pbItemId ?? ""),
      targetId: track?.dataset.pbReorderTargetId ?? null,
      targetPosition: targetPosition === "before" || targetPosition === "after" ? targetPosition : null,
      previewCount: document.querySelectorAll("[data-pb-reorder-preview]").length,
      previewOptionCount: preview?.querySelectorAll('[role="option"]').length ?? 0,
      previewItemIdentityCount: preview?.querySelectorAll("[data-pb-item-id]").length ?? 0,
      previewBounds: bounds === undefined ? null : {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      previewOpacity: preview === null ? null : getComputedStyle(preview).opacity,
      sourceOpacity: source === undefined ? null : getComputedStyle(source).opacity,
      sourceOutlineStyle: source === undefined ? null : getComputedStyle(source).outlineStyle,
      shiftedCount: shifted.length,
      shiftedTransitionProperty: shifted[0] === undefined
        ? null
        : getComputedStyle(shifted[0]).transitionProperty,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

export async function beginPointerReorder(page: Page, sourceId: string): Promise<PointerReorderSession> {
  const runtimeErrors: string[] = [];
  const onPageError = (error: Error): void => {
    runtimeErrors.push(`pageerror: ${error.message}`);
  };
  const onConsole = (message: { type(): string; text(): string }): void => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  const handle = page.locator(`[data-pb-item-id="${sourceId}"] [data-pb-reorder-handle]`);
  await handle.scrollIntoViewIfNeeded();
  await handle.hover();
  await page.waitForTimeout(180);
  const bounds = await handle.boundingBox();
  if (bounds === null) throw new Error(`Missing reorder handle bounds for ${sourceId}`);
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  await page.evaluate(() => {
    const scope = window as unknown as {
      __pointerReorderAudit?: Array<Record<string, unknown>>;
      __pointerReorderAuditAttached?: boolean;
    };
    scope.__pointerReorderAudit = [];
    if (scope.__pointerReorderAuditAttached) return;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) {
      document.addEventListener(type, (event) => {
        if (!(event instanceof PointerEvent)) return;
        const target = event.target instanceof Element ? event.target : undefined;
        scope.__pointerReorderAudit!.push({
          type,
          pointerId: event.pointerId,
          isPrimary: event.isPrimary,
          button: event.button,
          buttons: event.buttons,
          targetTag: target?.tagName ?? null,
          targetClass: target instanceof HTMLElement ? target.className : null,
          handle: (target?.closest("[data-pb-reorder-handle]") ?? null) !== null,
          itemId: target?.closest<HTMLElement>("[data-pb-item-id]")?.dataset.pbItemId ?? null,
          x: event.clientX,
          y: event.clientY,
        });
      }, true);
    }
    scope.__pointerReorderAuditAttached = true;
  });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 8, { steps: 3 });
  try {
    await expect(page.locator('.timeline__track[data-pb-reorder-active="true"]'))
      .toBeVisible({ timeout: 1500 });
  } catch {
    const [state, events, componentDebug] = await Promise.all([
      readPointerReorderState(page),
      page.evaluate(() => (window as unknown as { __pointerReorderAudit: unknown[] }).__pointerReorderAudit),
      page.evaluate((itemId) => {
        type VueInstanceDebug = {
          props?: Record<string, unknown>;
          vnode?: { props?: Record<string, unknown> | null };
          setupState?: Record<string, unknown>;
        };
        type VueElementDebug = HTMLElement & { __vueParentComponent?: VueInstanceDebug };
        const track = document.querySelector<HTMLElement>(".timeline__track") as VueElementDebug | null;
        const source = document.querySelector<HTMLElement>(`[data-pb-item-id="${itemId}"]`) as VueElementDebug | null;
        const trackProps = track?.__vueParentComponent?.props;
        const sourceInstance = source?.__vueParentComponent;
        const sourceVNodeProps = sourceInstance?.vnode?.props;
        const sourceSetup = sourceInstance?.setupState;
        return {
          reorderEnabled: trackProps?.reorderEnabled,
          reorderScope: trackProps?.reorderScope,
          itemCount: Array.isArray(trackProps?.items) ? trackProps.items.length : null,
          sourceParentPropKeys: Object.keys(sourceVNodeProps ?? {}),
          sourcePointerHandler: typeof sourceSetup?.handleCardPointerDown,
          eventTypes: (window as unknown as { __pointerReorderAudit: Array<{ type: string }> })
            .__pointerReorderAudit.map((event) => event.type),
        };
      }, sourceId),
    ]);
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    await page.mouse.up();
    throw new Error(`Pointer reorder did not start: ${JSON.stringify({ state, events, componentDebug, runtimeErrors })}`);
  }
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(1);
  page.off("pageerror", onPageError);
  page.off("console", onConsole);

  return { page, sourceId, startState: await readPointerReorderState(page) };
}

export async function movePointerReorder(
  session: PointerReorderSession,
  targetId: string,
  position: PointerDropPosition,
): Promise<PointerReorderState> {
  const { page } = session;
  const target = page.locator(`[data-pb-item-id="${targetId}"]`);
  const targetSlot = target.locator("xpath=..");
  // Reorder renders cards as transformed children of fixed slots. Hit-test the
  // frozen slot geometry, never chase a card as animation moves it away.
  await targetSlot.scrollIntoViewIfNeeded();
  const bounds = await targetSlot.boundingBox();
  if (bounds === null) throw new Error(`Missing pointer reorder target slot bounds for ${targetId}`);
  const end = {
    x: bounds.x + bounds.width * (position === "before" ? 0.2 : 0.8),
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(90);
  const state = await readPointerReorderState(page);
  if (state.targetId !== targetId || state.targetPosition !== position) {
    throw new Error(
      `Pointer reorder missed frozen slot ${targetId} (${position}); state=${JSON.stringify(state)}`,
    );
  }
  return state;
}

export async function finishPointerReorder(
  session: PointerReorderSession,
  targetState: PointerReorderState,
): Promise<PointerReorderResult> {
  const { page } = session;
  await page.mouse.up();
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  await expect(page.locator(".paste-card--dragging")).toHaveCount(0);
  await expect(page.locator('.timeline__track[data-pb-reorder-active="true"]')).toHaveCount(0);
  const persistence = await page.evaluate(() =>
    (window as unknown as {
      __cardReorderMetrics: {
        savedOrders: Array<{ scope: string; itemIds: string[] }>;
        nativeStartResults: Array<{ itemId: string; started: boolean }>;
      };
    }).__cardReorderMetrics,
  );
  return {
    startState: session.startState,
    targetState,
    order: await cardOrder(page),
    selection: await selectedCardIds(page),
    savedOrders: persistence.savedOrders,
    nativeStartResults: persistence.nativeStartResults,
  };
}

export async function savedCardOrders(page: Page): Promise<Array<{ scope: string; itemIds: string[] }>> {
  return page.evaluate(() =>
    (window as unknown as {
      __cardReorderMetrics: { savedOrders: Array<{ scope: string; itemIds: string[] }> };
    }).__cardReorderMetrics.savedOrders,
  );
}

export async function windowCloseCallCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __cardReorderMetrics: { windowCloseCalls: number } })
      .__cardReorderMetrics.windowCloseCalls,
  );
}

export async function reorderWithPointer(
  page: Page,
  sourceId: string,
  targetId: string,
  position: PointerDropPosition,
): Promise<PointerReorderResult> {
  const session = await beginPointerReorder(page, sourceId);
  const targetState = await movePointerReorder(session, targetId, position);
  return finishPointerReorder(session, targetState);
}
