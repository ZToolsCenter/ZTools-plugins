import { expect, test } from "playwright/test";

test("100k full-text search stays off the UI thread and returns only 50 items", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/browser/history.html?shelf=1&dock=bottom");
  const cards = page.locator("[data-pb-item-id]");
  await expect(cards.first()).toHaveAttribute("aria-setsize", "100000");
  expect(await cards.count()).toBeLessThanOrEqual(50);
  const input = page.getByRole("searchbox");
  await input.fill("中文尾部命中");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-pb-item-id", "item-99999");
  await input.fill("Clipboard 9");
  await input.fill("no-such-result");
  await input.fill("中文尾部命中");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-pb-item-id", "item-99999");
  await page.evaluate(() => {
    (window as any).historyTest.longTasks = [];
    const observer = new PerformanceObserver(list => {
      (window as any).historyTest.longTasks.push(...list.getEntries().map(entry => entry.duration));
    });
    observer.observe({ type: "longtask" });
  });
  await input.fill("Clipboard");
  await expect(cards.first()).toHaveAttribute("aria-setsize", "99999");
  const track = page.locator(".timeline__track");
  await track.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => page.evaluate(() => (window as any).historyTest.requests.some((request: any) => request.cursor))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).historyTest.sizes.length)).toBeGreaterThan(3);
  const sizes = await page.evaluate(() => (window as any).historyTest.sizes as number[]);
  expect(sizes.every(size => size <= 50)).toBe(true);
  const longTasks = await page.evaluate(() => (window as any).historyTest.longTasks as number[]);
  expect(longTasks.filter(duration => duration > 100)).toEqual([]);
  expect(errors).toEqual([]);
});

test("100k paged shelf preserves keyboard focus and loaded pages after changes", async ({ page }) => {
  await page.goto("/tests/browser/history.html?shelf=1&dock=bottom");
  const cards = page.locator("[data-pb-item-id]");
  await expect(cards.first()).toHaveAttribute("aria-setsize", "100000");
  await page.getByRole("searchbox").press("ArrowLeft");
  for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-pb-item-id="item-60"]')).toBeFocused();
  await page.evaluate(() => {
    (window as any).historyTest.prepend = true;
    window.dispatchEvent(new CustomEvent("pasteboard-pro:history-changed"));
  });
  await expect(page.locator('[data-pb-item-id="item-60"]')).toHaveAttribute("aria-setsize", "100001");
  await expect(page.locator('[data-pb-item-id="item-60"]')).toBeFocused();
});
