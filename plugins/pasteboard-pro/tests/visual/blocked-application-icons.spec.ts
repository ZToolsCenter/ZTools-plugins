import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "playwright/test";

import type { ApplicationCatalogResult } from "../../apps/ztools/preload/application-catalog";
import type { SourceAppIdentity } from "../../apps/ztools/preload/source-app-icons";
import {
  attachSettingsHost,
  MemoryZToolsDatabase,
  openSettingsTab,
  type SettingsTestWindow,
} from "./settings-test-host";
import {
  defaultPrivacySettings,
  ZToolsPrivacySettingsStore,
} from "../../apps/ztools/preload/privacy";
import { ZToolsWindowPreferencesStore } from "../../apps/ztools/preload/window-preferences";

const artifactDirectory = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "settings",
);

// This tiny PNG is a deterministic browser fixture, not evidence of native icon extraction.
const fixturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

type IconHarnessOptions = Readonly<{
  ignoredBundleIds: readonly string[];
  applications: ApplicationCatalogResult["applications"];
  getSourceAppIcon: (sourceApp: SourceAppIdentity) => Promise<string | undefined>;
  viewport?: Readonly<{ width: number; height: number }>;
}>;

async function createIconHarness(
  browser: Browser,
  options: IconHarnessOptions,
): Promise<Readonly<{
  context: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  privacyStore: ZToolsPrivacySettingsStore;
}>> {
  const database = new MemoryZToolsDatabase();
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  await privacyStore.put({
    ...defaultPrivacySettings,
    rules: {
      ...defaultPrivacySettings.rules,
      ignoredBundleIds: [...options.ignoredBundleIds],
    },
  });
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "blocked-application-icons-visual-test",
  });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1100, height: 800 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await attachSettingsHost(page, database, windowPreferencesStore, {
    listApplications: async () => ({
      supported: true,
      applications: [...options.applications],
    }),
    getSourceAppIcon: options.getSourceAppIcon,
  });
  await openSettingsTab(page, "privacy");
  return { context, page, privacyStore };
}

async function iconRequests(page: Page): Promise<SourceAppIdentity[]> {
  return page.evaluate(() =>
    (window as unknown as SettingsTestWindow).__sourceAppIconCalls,
  );
}

function requestedBundleIds(requests: readonly SourceAppIdentity[]): string[] {
  return requests.flatMap(({ bundleId }) => bundleId === undefined ? [] : [bundleId]);
}

async function expandApplications(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "搜索应用" }).click();
  await expect(page.getByRole("listbox", { name: "可屏蔽应用" })).toBeVisible();
}

async function closeApplications(page: Page): Promise<void> {
  await page.getByRole("button", { name: "收起应用列表" }).click();
  await expect(page.getByRole("listbox", { name: "可屏蔽应用" })).toHaveCount(0);
}

test("mocked saved-app icons render before the app catalog is opened", async ({ browser }) => {
  const selected = ["com.fixture.editor", "com.fixture.mail"];
  const { context, page } = await createIconHarness(browser, {
    ignoredBundleIds: selected,
    applications: selected.map((bundleId, index) => ({
      bundleId,
      name: index === 0 ? "Fixture Editor" : "Fixture Mail",
    })),
    getSourceAppIcon: async () => fixturePng,
  });
  try {
    await expect(page.locator(".blocked-app-select__chip")).toHaveCount(2);
    const chips = page.locator(".blocked-app-select__chip");
    await expect.poll(async () =>
      chips.locator("img.modern-card-source__icon").count(),
    ).toBe(2);
    await expect.poll(async () =>
      requestedBundleIds(await iconRequests(page)).sort(),
    ).toEqual([...selected].sort());
    expect(await page.evaluate(() =>
      (window as unknown as SettingsTestWindow).__applicationListCalls.length,
    )).toBe(0);
    await expect.poll(async () =>
      chips.locator("img.modern-card-source__icon").evaluateAll((icons) =>
        icons.every((node) => (node as HTMLImageElement).naturalWidth === 1),
      ),
    ).toBe(true);

    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({
      path: join(artifactDirectory, "blocked-application-icons.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});

test("selected icons lazy-load through a scrolled chip list beyond eight entries", async ({ browser }) => {
  const selected = Array.from({ length: 24 }, (_value, index) =>
    `com.fixture.app-${String(index + 1).padStart(2, "0")}`,
  );
  const { context, page } = await createIconHarness(browser, {
    ignoredBundleIds: selected,
    applications: selected.map((bundleId, index) => ({
      bundleId,
      name: `Fixture App ${String(index + 1).padStart(2, "0")}`,
    })),
    getSourceAppIcon: async () => fixturePng,
    viewport: { width: 880, height: 760 },
  });
  try {
    await expect(page.locator(".blocked-app-select__chip")).toHaveCount(selected.length);
    const geometry = await page.locator(".blocked-app-select__chips").evaluate((container) => {
      const chips = [...container.querySelectorAll<HTMLElement>(".blocked-app-select__chip")];
      const bounds = container.getBoundingClientRect();
      return {
        visibleIndexes: chips.flatMap((chip, index) => {
          const box = chip.getBoundingClientRect();
          return box.bottom > bounds.top && box.top < bounds.bottom &&
            box.right > bounds.left && box.left < bounds.right ? [index] : [];
        }),
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      };
    });
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.visibleIndexes.length).toBeGreaterThan(0);

    await expect.poll(async () => {
      const requested = new Set(requestedBundleIds(await iconRequests(page)));
      return geometry.visibleIndexes.every((index) => requested.has(selected[index]!));
    }).toBe(true);
    const initialRequests = requestedBundleIds(await iconRequests(page));
    expect(initialRequests).not.toContain(selected.at(-1));
    expect(await page.evaluate(() =>
      (window as unknown as SettingsTestWindow).__applicationListCalls.length,
    )).toBe(0);

    const targetIndex = 20;
    await page.locator(".blocked-app-select__chips").evaluate((container, index) => {
      const chip = container.querySelectorAll<HTMLElement>(".blocked-app-select__chip")[index];
      if (chip === undefined) throw new Error(`Missing selected chip ${index}`);
      container.scrollTop = chip.offsetTop - (container as HTMLElement).offsetTop;
    }, targetIndex);
    const targetChip = page.locator(".blocked-app-select__chip").nth(targetIndex);
    await expect(targetChip.locator("img.modern-card-source__icon")).toBeVisible();
    await expect.poll(async () =>
      requestedBundleIds(await iconRequests(page)).includes(selected[targetIndex]!),
    ).toBe(true);
    await expect(targetChip.locator("img.modern-card-source__icon")).toHaveJSProperty("naturalWidth", 1);
  } finally {
    await context.close();
  }
});

test("virtualized app rows route icon requests by bundle ID and skip distant rows", async ({ browser }) => {
  const applications = Array.from({ length: 40 }, (_value, index) => ({
    bundleId: `com.catalog.fixture-${String(index + 1).padStart(2, "0")}`,
    name: `Catalog Fixture ${String(index + 1).padStart(2, "0")}`,
  }));
  const { context, page } = await createIconHarness(browser, {
    ignoredBundleIds: [],
    applications,
    getSourceAppIcon: async () => fixturePng,
  });
  try {
    await expandApplications(page);
    const listbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    const firstOption = listbox.getByRole("option", {
      name: "Catalog Fixture 01, com.catalog.fixture-01",
    });
    await expect(firstOption.locator("img.modern-card-source__icon")).toBeVisible();
    await expect(firstOption.locator("img.modern-card-source__icon")).toHaveJSProperty("naturalWidth", 1);
    await expect.poll(async () =>
      requestedBundleIds(await iconRequests(page)).includes("com.catalog.fixture-01"),
    ).toBe(true);
    expect(requestedBundleIds(await iconRequests(page))).not.toContain("com.catalog.fixture-40");

    await listbox.evaluate((list) => { list.scrollTop = 29 * 56; });
    const distantOption = listbox.getByRole("option", {
      name: "Catalog Fixture 30, com.catalog.fixture-30",
    });
    await expect(distantOption).toBeVisible();
    await expect(distantOption.locator("img.modern-card-source__icon")).toBeVisible();
    await expect(distantOption.locator("img.modern-card-source__icon")).toHaveJSProperty("naturalWidth", 1);
    await expect.poll(async () =>
      requestedBundleIds(await iconRequests(page)).includes("com.catalog.fixture-30"),
    ).toBe(true);
    expect(requestedBundleIds(await iconRequests(page))).not.toContain("com.catalog.fixture-40");
  } finally {
    await context.close();
  }
});

test("unknown and invalid app icons use the generic glyph without dropping saved rules", async ({ browser }) => {
  const selected = [
    "com.fixture.missing",
    "com.fixture.null",
    "com.fixture.reject",
    "com.fixture.broken",
    "com.fixture.remote",
  ];
  const applications = selected.slice(1).map((bundleId) => ({
    bundleId,
    name: `Fixture ${bundleId.slice("com.fixture.".length)}`,
  }));
  const { context, page, privacyStore } = await createIconHarness(browser, {
    ignoredBundleIds: selected,
    applications,
    getSourceAppIcon: async ({ bundleId }) => {
      if (bundleId === selected[0]) return undefined;
      if (bundleId === selected[1]) return null as unknown as string;
      if (bundleId === selected[2]) throw new Error("fixture icon lookup failed");
      if (bundleId === selected[3]) return "data:image/png;base64,aGVsbG8=";
      if (bundleId === selected[4]) return "https://fixture.invalid/icon.png";
      return undefined;
    },
  });
  try {
    await expandApplications(page);
    await closeApplications(page);
    const chips = page.locator(".blocked-app-select__chip");
    await expect(chips).toHaveCount(selected.length);
    for (const chip of await chips.all()) {
      await expect(chip.locator('svg[data-icon-fallback="application"]')).toBeVisible();
      await expect(chip.locator(".modern-card-source__icon")).toHaveText("");
    }
    expect([...(await privacyStore.get()).rules.ignoredBundleIds]).toEqual(selected);
    expect(requestedBundleIds(await iconRequests(page))).toEqual(expect.arrayContaining(selected));
  } finally {
    await context.close();
  }
});
