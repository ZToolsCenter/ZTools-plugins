import { expect, test } from "playwright/test";

test("keeps a retryable save failure away from edited content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/quicknote.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "__restoreQuickNoteStorage", {
      configurable: true,
      value: () => {
        Storage.prototype.setItem = original;
      },
    });
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "goose-note:quicknote") {
        throw new DOMException("模拟容量不足", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });

  const editor = page.getByRole("textbox").first();
  await editor.fill("保存失败时正文仍然可见");

  const toast = page.locator("[data-sonner-toast]").filter({
    hasText: "速记暂未保存",
  });
  const retryButton = toast.getByRole("button", { name: "重试" });
  await expect(toast).toBeVisible();
  await expect(retryButton).toBeVisible();

  const layout = await page.evaluate(() => {
    const toastElement = document.querySelector<HTMLElement>(
      "[data-sonner-toast]",
    );
    const editedBlock = document.querySelector<HTMLElement>(
      ".quicknote-editor-surface .bn-block-outer",
    );
    if (!toastElement || !editedBlock) return null;
    const toastRect = toastElement.getBoundingClientRect();
    const editedRect = editedBlock.getBoundingClientRect();
    return {
      toastTop: toastRect.top,
      toastBottom: toastRect.bottom,
      editedTop: editedRect.top,
      editedBottom: editedRect.bottom,
      overlap:
        toastRect.left < editedRect.right &&
        toastRect.right > editedRect.left &&
        toastRect.top < editedRect.bottom &&
        toastRect.bottom > editedRect.top,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout!.toastTop).toBeGreaterThan(layout!.editedBottom);
  expect(layout!.overlap).toBe(false);
  expect(layout!.toastBottom).toBeLessThanOrEqual(640 - 30 + 1);
  expect(layout!.documentWidth).toBe(layout!.viewportWidth);

  await page.evaluate(() => {
    (
      window as Window & { __restoreQuickNoteStorage?: () => void }
    ).__restoreQuickNoteStorage?.();
  });
  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toast).toBeHidden();
  await expect(editor).toHaveText("保存失败时正文仍然可见");
});

test("stacks multiple save alerts inside a 320px safe area", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/quicknote.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.evaluate(async () => {
    const { toast } = await import("/src/components/ui/sonner.tsx");
    toast.warning("恢复提醒", { id: "stack-one", duration: 10_000 });
    toast.error("保存失败", { id: "stack-two", duration: 10_000 });
  });

  const toasts = page.locator("[data-sonner-toast]");
  await expect(toasts).toHaveCount(2);
  const boxes = await toasts.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        transform: getComputedStyle(element).transform,
      };
    }),
  );

  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(24);
    expect(box.right).toBeLessThanOrEqual(296);
    expect(box.transform).not.toBe("none");
  }
  expect(boxes[0].top).not.toBe(boxes[1].top);
});
