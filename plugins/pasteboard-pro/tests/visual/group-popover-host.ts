import { expect, type Page } from "playwright/test";
import { historyFixture, pinboardFixture } from "@pasteboard-pro/contract-fixtures";

const base = "http://127.0.0.1:5179";
const initialGroups = structuredClone(pinboardFixture);

export type MutableGroup = {
  id: string;
  name: string;
  color: string;
  orderKey: string;
  createdAt: string;
  updatedAt: string;
  fieldClocks: Record<string, { wallMs: number; counter: number; deviceId: string }>;
};

export type GroupMetrics = {
  groups: MutableGroup[];
  created: string[];
  renamed: Array<{ id: string; name: string }>;
  colors: Array<{ id: string; color: string }>;
  moves: Array<{ id: string; beforeId?: string; afterId?: string }>;
  preferenceSaves: Array<string>;
  panels: Array<{ panel: string; params: Record<string, unknown> }>;
  closeCount: number;
};

export async function installGroupHost(
  page: Page,
  initialUiVersion: "modern" | "classic" = "modern",
): Promise<void> {
  await page.addInitScript(({ items, groups, initialUiVersion }) => {
    const mutableGroups = structuredClone(groups) as unknown as MutableGroup[];
    const defaultPreferences = {
      dockEdge: "bottom",
      uiVersion: initialUiVersion,
      multiPasteMode: "batch",
      theme: { accentColor: "#6f61ea", background: { type: "default" } },
    };
    const preferencesKey = "pb-test-window-preferences";
    const readPreferences = () => {
      try {
        const raw = localStorage.getItem(preferencesKey);
        if (raw === null) {
          localStorage.setItem(preferencesKey, JSON.stringify(defaultPreferences));
          return structuredClone(defaultPreferences);
        }
        return JSON.parse(raw);
      } catch {
        return structuredClone(defaultPreferences);
      }
    };
    const metrics = {
      groups: mutableGroups,
      created: [] as string[],
      renamed: [] as Array<{ id: string; name: string }>,
      colors: [] as Array<{ id: string; color: string }>,
      moves: [] as Array<{ id: string; beforeId?: string; afterId?: string }>,
      preferenceSaves: [] as string[],
      panels: [] as Array<{ panel: string; params: Record<string, unknown> }>,
      closeCount: 0,
    };
    Object.defineProperty(window, "__groupMetrics", { value: metrics });
    window.close = () => { metrics.closeCount += 1; };
    window.confirm = () => false;
    const host = {
      getHostCompatibility: () => ({ supported: true, minimumVersion: "2.4.0", supportsPluginData: true }),
      getPlatformCapabilities: () => ({ platform: "darwin", supportsGlobalPasteQueue: true, supportsScreenCapture: false }),
      getWindowPreferences: async () => readPreferences(),
      saveWindowPreferences: async (preferences: unknown) => {
        const next = structuredClone(preferences) as { uiVersion?: string };
        localStorage.setItem(preferencesKey, JSON.stringify(next));
        metrics.preferenceSaves.push(next.uiVersion ?? "");
        return next;
      },
      getPrivacySettings: async () => ({
        pause: { paused: false },
        rules: { ignoredBundleIds: [], blockLikelySecrets: true, contentRules: [] },
        retention: { days: 90, maxBlobBytes: 1024 * 1024 * 1024 },
        screenShareProtection: false,
      }),
      savePrivacySettings: async (settings: unknown) => settings,
      getSyncSettings: async () => ({
        enabled: false,
        baseUrl: "",
        username: "",
        intervalMinutes: 60,
        webdavCredentialAccount: "webdav",
        vaultKeyAccount: "vault-key",
        status: { state: "disabled", pendingObjects: 0 },
      }),
      getListOrders: async () => ({}),
      getPasteStack: async () => ({ direction: "forward", itemIds: [] }),
      searchHistory: async () => ({ items, total: items.length }),
      listPinboards: async () => structuredClone(metrics.groups),
      createPinboard: async (name: string, color: string) => {
        const id = `board-created-${metrics.created.length + 1}`;
        const now = new Date().toISOString();
        metrics.groups.push({
          id, name, color,
          orderKey: `z${metrics.groups.length}`,
          createdAt: now,
          updatedAt: now,
          fieldClocks: {
            name: { wallMs: Date.now(), counter: 0, deviceId: "visual-fixture" },
            color: { wallMs: Date.now(), counter: 1, deviceId: "visual-fixture" },
            orderKey: { wallMs: Date.now(), counter: 2, deviceId: "visual-fixture" },
          },
        });
        metrics.created.push(name);
        return structuredClone(metrics.groups.at(-1));
      },
      renamePinboard: async (id: string, name: string) => {
        const group = metrics.groups.find((value) => value.id === id);
        if (group) group.name = name;
        metrics.renamed.push({ id, name });
      },
      updatePinboardColor: async (id: string, color: string) => {
        const group = metrics.groups.find((value) => value.id === id);
        if (group) group.color = color;
        metrics.colors.push({ id, color });
      },
      movePinboard: async (id: string, beforeId?: string, afterId?: string) => {
        metrics.moves.push({ id, ...(beforeId ? { beforeId } : {}), ...(afterId ? { afterId } : {}) });
        const sourceIndex = metrics.groups.findIndex((value) => value.id === id);
        if (sourceIndex < 0) return;
        const [group] = metrics.groups.splice(sourceIndex, 1);
        const beforeIndex = beforeId ? metrics.groups.findIndex((value) => value.id === beforeId) : -1;
        const afterIndex = afterId ? metrics.groups.findIndex((value) => value.id === afterId) : -1;
        const insertAt = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : metrics.groups.length;
        metrics.groups.splice(insertAt, 0, group!);
      },
      deletePinboard: async (id: string) => {
        metrics.groups.splice(metrics.groups.findIndex((value) => value.id === id), 1);
        return { id, unassignedItems: 0 };
      },
      getItemThumbnails: async () => [],
      getItemPreview: async () => null,
      prepareNativeFileDrag: async () => false,
      startNativeFileDrag: () => false,
      openPanel: (panel: string, params: Record<string, unknown>) => { metrics.panels.push({ panel, params }); },
    };
    Object.defineProperty(window, "pasteboardPro", { value: host });
  }, { items: structuredClone(historyFixture), groups: initialGroups, initialUiVersion });
}

export async function openGroupShelf(
  page: Page,
  width: number,
  colorScheme: "dark" | "light",
  expectedUiVersion: "modern" | "classic" = "modern",
): Promise<void> {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.setViewportSize({ width, height: 360 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page);
  await page.goto(`${base}/?visual=1&shelf=1&dock=bottom&expectedUi=${expectedUiVersion}`, { waitUntil: "networkidle" });
  try {
    await expect(page.locator(expectedUiVersion === "modern" ? ".shelf--modern" : ".shelf:not(.shelf--modern)")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-pb-ui-version", expectedUiVersion);
  } catch (error) {
    throw new Error(`${String(error)}\nBrowser errors: ${browserErrors.join("\n")}`);
  }
  await expect(page.getByRole("navigation", { name: "分组", exact: true })).toBeVisible();
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    (window as unknown as { __groupMetrics: GroupMetrics }).__groupMetrics.panels.length = 0;
  });
}

export async function dragPinboardGroup(
  page: Page,
  sourceId: string,
  targetId: string,
  position: "before" | "after",
  cancel = false,
  dragScreenshotPath?: string,
): Promise<void> {
  const nav = page.getByRole("navigation", { name: "分组", exact: true });
  const source = page.locator(`[data-pb-pinboard-id="${sourceId}"]`);
  const handle = source.locator("button[data-pb-reorder-handle]");
  const target = page.locator(`[data-pb-pinboard-id="${targetId}"]`);
  await expect(handle).toHaveCount(1);
  await expect(handle).toHaveAttribute("aria-label", /^管理 /);
  await handle.hover();
  const handleBounds = await handle.boundingBox();
  const targetBounds = await target.boundingBox();
  expect(handleBounds).not.toBeNull();
  expect(targetBounds).not.toBeNull();

  const startX = handleBounds!.x + handleBounds!.width / 2;
  const startY = handleBounds!.y + handleBounds!.height / 2;
  const edgeInset = Math.max(3, Math.min(10, targetBounds!.width * 0.12));
  const targetX = position === "before"
    ? targetBounds!.x + edgeInset
    : targetBounds!.x + targetBounds!.width - edgeInset;
  const targetY = targetBounds!.y + targetBounds!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await expect(nav).toHaveAttribute("data-pb-reorder-active", "true");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(source).toHaveClass(/pinboard-chip--dragging/);
  await expect(page.locator('[data-pb-reorder-preview="true"]')).toBeVisible();
  await page.mouse.move(targetX, targetY, { steps: 16 });
  await expect(target).toHaveAttribute("data-pb-reorder-target", position);
  if (dragScreenshotPath !== undefined) {
    await page.screenshot({ path: dragScreenshotPath, animations: "disabled" });
  }
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(nav).not.toHaveAttribute("data-pb-reorder-active", "true");
  await expect(source).not.toHaveClass(/pinboard-chip--dragging/);
  await expect(page.locator('[data-pb-reorder-preview="true"]')).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
}

export async function readGroupMetrics(page: Page): Promise<GroupMetrics> {
  return page.evaluate(() => (window as unknown as { __groupMetrics: GroupMetrics }).__groupMetrics);
}

export async function expectInsideShelf(page: Page, selector: string, width: number): Promise<void> {
  const bounds = await page.locator(selector).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(361);
}
