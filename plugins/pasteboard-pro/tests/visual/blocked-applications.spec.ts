import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "playwright/test";

import type { ApplicationCatalogResult } from "../../apps/ztools/preload/application-catalog";
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

const sampleApplications = [
  { name: "Code Editor", bundleId: "com.example.code" },
  { name: "Design Studio", bundleId: "com.example.design" },
  { name: "Mail Client", bundleId: "com.example.mail" },
  { name: "Terminal", bundleId: "com.example.terminal" },
] as const;

type HarnessOptions = Readonly<{
  viewport?: Readonly<{ width: number; height: number }>;
  applications?: ApplicationCatalogResult;
  listApplications?: (refresh?: boolean) => Promise<ApplicationCatalogResult>;
  ignoredBundleIds?: readonly string[];
}>;

async function createSettingsHarness(
  browser: Browser,
  options: HarnessOptions = {},
): Promise<Readonly<{
  context: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  database: MemoryZToolsDatabase;
  privacyStore: ZToolsPrivacySettingsStore;
}>> {
  const database = new MemoryZToolsDatabase();
  const privacyStore = new ZToolsPrivacySettingsStore(database);
  if (options.ignoredBundleIds !== undefined) {
    await privacyStore.put({
      ...defaultPrivacySettings,
      rules: {
        ...defaultPrivacySettings.rules,
        ignoredBundleIds: [...options.ignoredBundleIds],
      },
    });
  }
  const windowPreferencesStore = new ZToolsWindowPreferencesStore(database, {
    deviceId: "blocked-applications-visual-test",
  });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1100, height: 800 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const listApplications = options.listApplications ?? (async () =>
    options.applications ?? {
      supported: true,
      applications: [...sampleApplications],
    });
  await attachSettingsHost(page, database, windowPreferencesStore, {
    listApplications,
  });
  await openSettingsTab(page, "privacy");
  return { context, page, database, privacyStore };
}

async function catalogCallCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as SettingsTestWindow).__applicationListCalls.length,
  );
}

async function getIgnoredBundleIds(
  store: ZToolsPrivacySettingsStore,
): Promise<string[]> {
  return [...(await store.get()).rules.ignoredBundleIds];
}

async function saveSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
}

async function assertMenuInsideViewport(page: Page): Promise<void> {
  const geometry = await page.getByRole("listbox", { name: "可屏蔽应用" }).evaluate((list) => {
    const menu = list.closest<HTMLElement>(".blocked-app-select__menu");
    if (menu === null) throw new Error("Application menu is not attached");
    const bounds = menu.getBoundingClientRect();
    const footer = menu.closest(".settings-panel")?.querySelector<HTMLElement>(".settings-footer");
    const footerBounds = footer?.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const probe = document.elementFromPoint(
      bounds.left + Math.min(bounds.width / 2, 20),
      bounds.top + Math.min(bounds.height / 2, 20),
    );
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      viewport,
      position: getComputedStyle(menu).position,
      probeInsideMenu: probe !== null && menu.contains(probe),
      overlapsFooter: footerBounds !== undefined &&
        bounds.left < footerBounds.right && bounds.right > footerBounds.left &&
        bounds.top < footerBounds.bottom && bounds.bottom > footerBounds.top,
    };
  });
  expect(geometry.position).toBe("fixed");
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  expect(geometry.probeInsideMenu).toBe(true);
  expect(geometry.overlapsFooter).toBe(false);
}

test("application catalog is lazy, cached, and searched locally", async ({ browser }) => {
  const { context, page } = await createSettingsHarness(browser);
  try {
    await openSettingsTab(page, "general");
    expect(await catalogCallCount(page)).toBe(0);
    await page.getByRole("tab", { name: "隐私" }).click();
    expect(await catalogCallCount(page)).toBe(0);

    const search = page.getByRole("combobox", { name: "搜索应用" });
    await search.click();
    const listbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option", { name: "Code Editor, com.example.code" })).toBeVisible();
    expect(await catalogCallCount(page)).toBe(1);

    await search.fill("com.example.design");
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await expect(listbox.getByRole("option", { name: "Design Studio, com.example.design" })).toBeVisible();
    await search.fill("");
    await listbox.getByRole("option", { name: "Code Editor, com.example.code" }).click();
    await expect(listbox.getByRole("option", { name: "Code Editor, com.example.code" })).toHaveAttribute("aria-selected", "true");
    await search.press("Escape");
    await expect(listbox).toHaveCount(0);
    await search.click();
    await expect(listbox).toBeVisible();
    expect(await catalogCallCount(page)).toBe(1);

    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({
      path: join(artifactDirectory, "blocked-applications-dark.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});

test("legacy IDs and selections persist only after save", async ({ browser }) => {
  const knownId = "COM.EXAMPLE.CODE";
  const newId = "com.example.design";
  const legacyId = "com.legacy.retired";
  const { context, page, privacyStore } = await createSettingsHarness(browser, {
    ignoredBundleIds: [knownId, legacyId],
  });
  try {
    const search = page.getByRole("combobox", { name: "搜索应用" });
    await search.click();
    await expect(page.getByRole("listbox", { name: "可屏蔽应用" })).toBeVisible();
    const listbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    const knownOption = listbox.getByRole("option", { name: "Code Editor, com.example.code" });
    await expect(knownOption).toHaveAttribute("aria-selected", "true");
    await knownOption.click();
    await listbox.getByRole("option", { name: "Design Studio, com.example.design" }).click();
    expect(await getIgnoredBundleIds(privacyStore)).toEqual([knownId, legacyId]);
    await expect(page.getByRole("button", { name: "移除屏蔽应用 com.legacy.retired" })).toBeVisible();

    await saveSettings(page);
    await expect.poll(() => getIgnoredBundleIds(privacyStore)).toEqual([legacyId, newId]);
    await openSettingsTab(page, "privacy");
    const reopenedSearch = page.getByRole("combobox", { name: "搜索应用" });
    await reopenedSearch.click();
    const reopenedListbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    await expect(reopenedListbox.getByRole("option", { name: "Design Studio, com.example.design" })).toHaveAttribute("aria-selected", "true");
    await expect(reopenedListbox.getByRole("option", { name: "Code Editor, com.example.code" })).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("button", { name: "移除屏蔽应用 com.legacy.retired" })).toBeVisible();
    await page.getByRole("button", { name: "移除屏蔽应用 com.legacy.retired" }).click();
    expect(await getIgnoredBundleIds(privacyStore)).toEqual([legacyId, newId]);
    await saveSettings(page);
    await expect.poll(() => getIgnoredBundleIds(privacyStore)).toEqual([newId]);
  } finally {
    await context.close();
  }
});

test("catalog loading, retry, empty, and unsupported states are explicit", async ({ browser }) => {
  let rejectCatalog!: (error: Error) => void;
  const pendingCatalog = new Promise<ApplicationCatalogResult>((_resolve, reject) => {
    rejectCatalog = reject;
  });
  let request = 0;
  const { context, page } = await createSettingsHarness(browser, {
    listApplications: async () => {
      request += 1;
      if (request === 1) return pendingCatalog;
      return { supported: true, applications: [...sampleApplications] };
    },
  });
  try {
    await page.getByRole("combobox", { name: "搜索应用" }).click();
    await expect(page.getByText("正在读取应用列表…")).toBeVisible();
    rejectCatalog(new Error("catalog unavailable for this test"));
    await expect(page.getByRole("alert")).toContainText("catalog unavailable for this test");
    await page.getByRole("button", { name: "重试读取应用列表" }).click();
    await expect(page.getByRole("listbox", { name: "可屏蔽应用" })).toBeVisible();
    expect(await catalogCallCount(page)).toBe(2);
  } finally {
    await context.close();
  }

  const catalogStates: Array<Readonly<{
    result: ApplicationCatalogResult;
    message: string;
  }>> = [
    {
      result: { supported: false, applications: [] },
      message: "旧版宿主或当前平台无法读取应用目录",
    },
    {
      result: { supported: true, applications: [] },
      message: "当前没有可选应用。已有屏蔽项仍会保留，可逐项移除。",
    },
  ];
  for (const scenario of catalogStates) {
    const state = await createSettingsHarness(browser, { applications: scenario.result });
    try {
      await state.page.getByRole("combobox", { name: "搜索应用" }).click();
      await expect(state.page.getByText(scenario.message)).toBeVisible();
      expect(await catalogCallCount(state.page)).toBe(1);
    } finally {
      await state.context.close();
    }
  }

});

test("keyboard, IME input, Escape, and outside click follow combobox behavior", async ({ browser }) => {
  const { context, page } = await createSettingsHarness(browser);
  try {
    const search = page.getByRole("combobox", { name: "搜索应用" });
    await search.focus();
    const listbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    await expect(listbox).toBeVisible();
    await expect.poll(() => catalogCallCount(page)).toBe(1);
    await search.press("Enter");
    await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
    const saveCalls = () => page.evaluate(() =>
      (window as unknown as SettingsTestWindow).__privacySaveCalls,
    );
    await expect.poll(saveCalls).toBe(0);
    await search.evaluate((element) => {
      const input = element as HTMLInputElement;
      const markNextEnterComposing = (event: KeyboardEvent) => {
        if (event.target !== input || event.key !== "Enter") return;
        Object.defineProperties(event, {
          isComposing: { value: true },
          keyCode: { value: 229 },
        });
        document.removeEventListener("keydown", markNextEnterComposing, true);
      };
      // This runs before SettingsPanel's form capture guard and emulates the
      // browser-supplied composition flags on the trusted Playwright key event.
      document.addEventListener("keydown", markNextEnterComposing, true);
    });
    await search.press("Enter");
    await expect.poll(saveCalls).toBe(0);
    await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();

    await search.press("ArrowDown");
    const firstOption = listbox.getByRole("option").first();
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      await firstOption.getAttribute("id") ?? "",
    );
    await search.press("Enter");
    await expect(firstOption).toHaveAttribute("aria-selected", "true");
    await search.press("ArrowDown");
    const secondOption = listbox.getByRole("option").nth(1);
    await search.press("Space");
    await expect(secondOption).toHaveAttribute("aria-selected", "true");

    await search.fill("");
    await search.press("ArrowDown");
    await search.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "Code";
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "Code",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        keyCode: 229,
        isComposing: true,
      }));
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
        isComposing: true,
      }));
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "Code" }));
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "Code",
        inputType: "insertText",
      }));
    });
    await expect(search).toHaveValue("Code");
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await expect(listbox.getByRole("option", { name: "Code Editor, com.example.code" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();

    await page.getByRole("tabpanel", { name: "隐私" }).locator(".settings-page__intro").click();
    await expect(listbox).toHaveCount(0);
    await search.click();
    await expect(listbox).toBeVisible();
    await search.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
    await search.press("Escape");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as SettingsTestWindow).__closeCalls,
    )).toBe(1);
    expect(await catalogCallCount(page)).toBe(1);
  } finally {
    await context.close();
  }
});

test("dropdown stays visible and scrollable in narrow and short windows, then becomes inert while saving", async ({ browser }) => {
  const applications = Array.from({ length: 28 }, (_, index) => ({
    name: `Visual App ${String(index + 1).padStart(2, "0")}`,
    bundleId: `com.visual.app${String(index + 1).padStart(2, "0")}`,
  }));
  const { context, page, database, privacyStore } = await createSettingsHarness(browser, {
    viewport: { width: 380, height: 640 },
    applications: { supported: true, applications },
  });
  try {
    const search = page.getByRole("combobox", { name: "搜索应用" });
    await search.click();
    const listbox = page.getByRole("listbox", { name: "可屏蔽应用" });
    await expect(listbox).toBeVisible();
    await assertMenuInsideViewport(page);
    const initialScrollTop = await listbox.evaluate((list) => list.scrollTop);
    await listbox.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => listbox.evaluate((list) => list.scrollTop)).toBeGreaterThan(initialScrollTop);
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: join(artifactDirectory, "narrow.png"), animations: "disabled" });

    await search.press("Escape");
    await page.setViewportSize({ width: 800, height: 360 });
    await search.click();
    await expect(listbox).toBeVisible();
    await assertMenuInsideViewport(page);
    await page.screenshot({ path: join(artifactDirectory, "short.png"), animations: "disabled" });

    await search.press("Escape");
    await page.setViewportSize({ width: 380, height: 360 });
    await search.click();
    await expect(listbox).toBeVisible();
    await assertMenuInsideViewport(page);
    expect((await listbox.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await page.screenshot({ path: join(artifactDirectory, "compact.png"), animations: "disabled" });

    await listbox.getByRole("option", { name: "Visual App 01, com.visual.app01" }).click();
    const gate = database.gateNextPutFor("pasteboard-pro:settings:privacy", "controlled save gate");
    await saveSettings(page);
    await gate.started;
    await expect(search).toBeDisabled();
    await expect(listbox).toHaveCount(0);
    expect(await getIgnoredBundleIds(privacyStore)).toEqual(defaultPrivacySettings.rules.ignoredBundleIds);
    gate.release();
    await expect(page.getByRole("alert")).toContainText("controlled save gate");
  } finally {
    await context.close();
  }
});
