import { expect, test } from "playwright/test";
import { openShelf } from "./card-reorder-fixture";

test.use({ viewport: { width: 1440, height: 360 }, colorScheme: "dark" });

test("text body drops into another document while source blur waits for drag end", async ({ page }) => {
  await openShelf(page, "native-host");
  await page.evaluate(() => {
    const metric = { closes: 0, starts: 0, ends: 0 };
    Object.assign(window, { textDropMetric: metric });
    window.close = () => { metric.closes += 1; };
    window.addEventListener("dragstart", () => { metric.starts += 1; });
    window.addEventListener("dragend", () => { metric.ends += 1; });
    const frame = document.createElement("iframe");
    frame.id = "receiving-app";
    frame.title = "Receiving editor";
    frame.style.cssText = "position:fixed;top:4px;left:450px;width:500px;height:58px;z-index:20000;background:white";
    frame.srcdoc = '<textarea aria-label="Receiving text" style="width:96%;height:40px"></textarea>';
    document.body.append(frame);
  });
  const editor = page.frameLocator("#receiving-app").getByRole("textbox");
  await expect(editor).toBeVisible();
  const source = page.locator('[data-pb-item-id="text-old"] .modern-preview--text p');
  const content = await source.textContent();
  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await editor.boundingBox())!;
  await page.mouse.move(sourceBox.x + 40, sourceBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 65, sourceBox.y + 25, { steps: 4 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { textDropMetric: { starts: number } }).textDropMetric.starts)).toBe(1);
  // Host focus handoff seam: execute the real Shelf blur listener mid-drag.
  // This browser test verifies document transfer, not an OS app insertion.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await page.evaluate(() => (window as unknown as { textDropMetric: { closes: number } }).textDropMetric.closes)).toBe(0);
  await page.mouse.move(targetBox.x + 60, targetBox.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect(editor).toHaveValue(content!);
  await expect.poll(() => page.evaluate(() => (window as unknown as { textDropMetric: { ends: number } }).textDropMetric.ends)).toBe(1);
  await expect(page.locator("[data-pb-reorder-preview]")).toHaveCount(0);
  // Once the drag has ended a later blur resumes the normal Shelf lifecycle.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await page.evaluate(() => (window as unknown as { textDropMetric: { closes: number } }).textDropMetric.closes)).toBe(1);
});
