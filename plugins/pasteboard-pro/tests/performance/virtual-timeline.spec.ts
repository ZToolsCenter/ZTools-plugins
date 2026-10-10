import { expect, test, type Page } from "playwright/test";

const api = async (page: Page, method: string, ...args: unknown[]) => page.evaluate(
  async ({ method, args }) => (window as any).timelineTest[method](...args), { method, args },
);
const cards = (page: Page) => page.locator('.timeline__track [role="option"]');
async function open(page: Page, query = "") {
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));
  page.on("console", (message) => { if (message.type() === "error") console.log(message.text()); });
  await page.goto(`/tests/browser/timeline.html?${query}`);
  await expect.poll(() => page.evaluate(() => (window as any).timelineTest?.ready)).toBe(true);
}
async function scrollTo(page: Page, value: number, vertical = false) {
  await page.locator('.timeline__track').evaluate((node, { value, vertical }) => {
    if (vertical) node.scrollTop = value; else node.scrollLeft = value;
  }, { value, vertical });
  await page.waitForTimeout(50);
}
async function visibleAnchor(page: Page, vertical: boolean) {
  return page.locator('.timeline__track').evaluate((node, vertical) => {
    const bounds = node.getBoundingClientRect();
    for (const card of node.querySelectorAll<HTMLElement>('[data-pb-item-id]')) {
      const box = card.getBoundingClientRect();
      if (vertical ? box.bottom > bounds.top && box.top < bounds.bottom : box.right > bounds.left && box.left < bounds.right) {
        return { id: card.dataset.pbItemId, offset: vertical ? box.top - bounds.top : box.left - bounds.left };
      }
    }
    return undefined;
  }, vertical);
}

for (const vertical of [false, true]) {
  for (const compact of [false, true]) {
    test(`10,000 cards: ${vertical ? 'vertical' : 'horizontal'} ${compact ? 'compact' : 'expanded'}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page, `vertical=${+vertical}&compact=${+compact}`);
      expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
      await expect(cards(page).first()).toHaveAttribute('aria-setsize', '10000');
      const stride = vertical ? (compact ? 116 : 154) : (compact ? 192 : 252);
      await scrollTo(page, 5000 * stride + 25, vertical);
      const anchor = await visibleAnchor(page, vertical);
      expect(anchor?.id).toBe('item-5000');
      expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
      await api(page, 'prepend');
      await expect.poll(async () => (await visibleAnchor(page, vertical))?.id).toBe(anchor?.id);
      expect(Math.abs((await visibleAnchor(page, vertical))!.offset - anchor!.offset)).toBeLessThan(2);
      await api(page, 'remove', 'item--1');
      await expect.poll(async () => (await visibleAnchor(page, vertical))?.id).toBe(anchor?.id);
      await api(page, 'focus', 9999);
      await expect(page.locator('[data-pb-item-id="item-9999"]')).toBeFocused();
      expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
      await api(page, 'focus', 0);
      await expect(page.locator('[data-pb-item-id="item-0"]')).toBeFocused();
      await api(page, 'focus', 1000);
      await api(page, 'replace', 2);
      await expect(cards(page)).toHaveCount(2);
      await expect(cards(page).first()).toBeInViewport();
      await api(page, 'replace', 0);
      await expect(cards(page)).toHaveCount(0);
      await api(page, 'replace', 10000);
      await expect(cards(page).first()).toHaveAttribute('data-pb-item-id', 'item-0');
      await api(page, 'density', !compact);
      await api(page, 'focus', 5000);
      await expect(page.locator('[data-pb-item-id="item-5000"]')).toBeFocused();
      expect(errors).toEqual([]);
      console.log(JSON.stringify({ vertical, compact, mounted: await cards(page).count(), mountMs: await page.evaluate(() => (window as any).timelineTest.mountMs) }));
    });
  }
}

test('image thumbnails load only near the viewport', async ({ page }) => {
  await open(page, 'images=1');
  await expect.poll(() => page.evaluate(() => (window as any).timelineTest.thumbnailIds.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).timelineTest.thumbnailIds.length)).toBeLessThan(20);
  await api(page, 'focus', 5000);
  await expect.poll(() => page.evaluate(() => (window as any).timelineTest.thumbnailIds.includes('item-5000'))).toBe(true);
  expect(await page.evaluate(() => (window as any).timelineTest.thumbnailIds.length)).toBeLessThan(40);
});

test('dragging preserves source DOM across virtualization and moves offscreen selections', async ({ page }) => {
  await open(page);
  await api(page, 'select', ['item-0', 'item-2', 'item-5000']);
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('[data-pb-item-id="item-0"]')!;
    const transfer = new DataTransfer();
    (window as any).dragTest = { source, transfer };
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await scrollTo(page, 1000 * 252);
  expect(await page.evaluate(() => (window as any).dragTest.source.isConnected)).toBe(true);
  expect(await cards(page).count()).toBeLessThanOrEqual(50);
  await page.evaluate(async () => {
    const { source, transfer } = (window as any).dragTest;
    const target = document.querySelector<HTMLElement>('[data-pb-item-id="item-1002"]')!;
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: bounds.right - 2, clientY: bounds.top + 50,
    }));
    await new Promise(requestAnimationFrame);
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  });
  const ids = await api(page, 'ids') as string[];
  const index = ids.indexOf('item-1002');
  expect(ids.slice(index + 1, index + 4)).toEqual(['item-0', 'item-2', 'item-5000']);
  expect(await api(page, 'selected')).toEqual(['item-0', 'item-2', 'item-5000']);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
});

test('real shelf: keyboard navigation, search and refresh keep virtualization intact', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const makeItem = (index: number) => ({
      id: `item-${index}`, kind: 'text', title: index === 9999 ? 'needle-last' : `Record ${index}`,
      sourceDeviceId: 'test', copiedAt: new Date(1800000000000 - index).toISOString(),
      updatedAt: new Date(1800000000000 - index).toISOString(),
      contentFingerprint: `sha256:${index}`, payload: { revision: String(index), text: `Clipboard record ${index}` },
      pinned: false, fieldClocks: {},
    });
    const history = Array.from({ length: 10000 }, (_, i) => makeItem(i));
    const metrics = { calls: 0, prepend: () => { history.unshift(makeItem(-1)); } };
    (window as any).shelfTest = metrics;
    (window as any).pasteboardPro = {
      getHostCompatibility: () => ({ supported: true }),
      getPlatformCapabilities: () => ({ platform: 'darwin' }),
      getWindowPreferences: async () => undefined,
      getPrivacySettings: async () => ({ pause: { paused: false } }),
      getListOrders: async () => ({}),
      getPasteStack: async () => undefined,
      getItemThumbnails: async () => [],
      prepareNativeFileDrag: async () => false,
      listPinboards: async () => [],
      searchHistory: async () => {
        metrics.calls++;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { items: structuredClone(history), total: history.length };
      },
    };
  });
  await page.goto('/?shelf=1&dock=bottom');
  await expect(cards(page).first()).toHaveAttribute('aria-setsize', '10000');
  expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
  const search = page.getByRole('searchbox');
  await search.focus();
  await search.press('ArrowLeft');
  await expect(page.locator('[data-pb-item-id="item-0"]')).toBeFocused();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-pb-item-id="item-30"]')).toBeFocused();
  expect(await cards(page).count()).toBeGreaterThanOrEqual(30);
      expect(await cards(page).count()).toBeLessThanOrEqual(50);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('[data-pb-item-id="item-30"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-pb-item-id="item-31"]')).toHaveAttribute('aria-selected', 'true');
  await search.fill('needle-last');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute('data-pb-item-id', 'item-9999');
  await expect(cards(page).first()).toHaveAttribute('draggable', 'false');
  // Broad search still includes all 10,000 matches, even though only a window
  // of result cards is mounted. The last record remains reachable.
  await search.fill('Clipboard record');
  await expect(cards(page).first()).toHaveAttribute('aria-setsize', '10000');
  expect(await cards(page).count()).toBeLessThanOrEqual(50);
  await search.fill('needle-last');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute('data-pb-item-id', 'item-9999');
  await search.fill('');
  await expect(cards(page).first()).toHaveAttribute('aria-setsize', '10000');
  await page.locator('.timeline__track').evaluate(node => {
    const width = Number.parseFloat(getComputedStyle(node).getPropertyValue('--pb-card-width'));
    node.scrollLeft = 5000 * (width + 12) + 25;
  });
  await expect.poll(async () => (await visibleAnchor(page, false))?.id).toBe('item-5000');
  const anchor = await visibleAnchor(page, false);
  await page.evaluate(() => {
    (window as any).shelfTest.prepend();
    for (let i = 0; i < 25; i++) window.dispatchEvent(new CustomEvent('pasteboard-pro:history-changed'));
  });
  await expect(cards(page).first()).toHaveAttribute('aria-setsize', '10001');
  await expect.poll(async () => (await visibleAnchor(page, false))?.id).toBe(anchor?.id);
  expect(await page.evaluate(() => (window as any).shelfTest.calls)).toBe(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/virtual-timeline/shelf-10000.png" });
});
