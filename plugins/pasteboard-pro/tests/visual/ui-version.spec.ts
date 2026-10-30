import { CURRENT_APP_VERSION } from "../../apps/ztools/src/whats-new";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "playwright/test";

import { settingsTestBaseUrl } from "./settings-test-host";
import {
  dragPinboardGroup,
  installGroupHost,
  openGroupShelf,
  readGroupMetrics,
} from "./group-popover-host";

const artifactPath = join(
  process.cwd(),
  "artifacts",
  "pasteboardpro",
  "group-version-results",
);

async function openStandaloneSettings(
  page: Page,
  version: "modern" | "classic",
): Promise<void> {
  await page.setViewportSize({ width: 980, height: 760 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installGroupHost(page, version);
  await page.goto(
    `${settingsTestBaseUrl}/?visual=1&panel=privacy&tab=appearance`,
    { waitUntil: "networkidle" },
  );
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-pb-ui-version", version);
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", version);
}

async function selectVersion(page: Page, label: "新版" | "经典版"): Promise<void> {
  const radio = page.getByRole("radiogroup", { name: "界面版本" }).getByRole("radio", { name: label });
  await radio.locator("xpath=..").click();
  await expect(radio).toBeChecked();
}

async function saveSettings(page: Page, expectedVersion: "modern" | "classic"): Promise<void> {
  const invalidFields = await page.locator("form.settings-shell").evaluate((form) =>
    [...form.querySelectorAll<HTMLInputElement>(":invalid")].map((input) => ({
      type: input.type,
      value: input.value,
      label: input.labels?.[0]?.textContent?.trim(),
      disabled: input.disabled,
    })),
  );
  expect(invalidFields).toEqual([]);
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  try {
    await expect.poll(() => page.evaluate(() => {
      const saved = localStorage.getItem("pb-test-window-preferences");
      return saved === null ? undefined : JSON.parse(saved).uiVersion;
    })).toBe(expectedVersion);
  } catch (error) {
    const state = await page.evaluate(() => ({
      preferences: localStorage.getItem("pb-test-window-preferences"),
      panelBusy: document.querySelector<HTMLElement>(".settings-panel")?.getAttribute("aria-busy"),
      saveError: document.querySelector<HTMLElement>(".settings-error")?.textContent,
      preferenceWrites: (window as unknown as { __groupMetrics: { preferenceSaves: string[] } }).__groupMetrics.preferenceSaves,
      closeCount: (window as unknown as { __groupMetrics: { closeCount: number } }).__groupMetrics.closeCount,
    }));
    throw new Error(`${String(error)}\nSettings save state: ${JSON.stringify(state)}`);
  }
  expect((await readGroupMetrics(page)).closeCount).toBe(1);
}

test.beforeEach(async () => {
  await mkdir(artifactPath, { recursive: true });
});

test("modern is the default; classic and modern settings persist across standalone pages and shelf", async ({ page }) => {
  const context = page.context();

  await openStandaloneSettings(page, "modern");
  const modernSettingsTabs = page.locator(".settings-tabs");
  await expect(modernSettingsTabs).toHaveCSS("flex-direction", "column");
  await expect(page.getByRole("radio", { name: "新版" })).toBeChecked();
  await page.screenshot({
    path: join(artifactPath, "settings-modern-graphite-sidebar.png"),
    animations: "disabled",
  });

  await selectVersion(page, "经典版");
  await saveSettings(page, "classic");

  const classicSettings = await context.newPage();
  await openStandaloneSettings(classicSettings, "classic");
  await expect(classicSettings.locator(".settings-tabs")).toHaveCSS("flex-direction", "row");
  await expect(classicSettings.getByRole("radio", { name: "经典版" })).toBeChecked();
  await classicSettings.screenshot({
    path: join(artifactPath, "settings-classic-purple-tabs.png"),
    animations: "disabled",
  });

  const classicShelf = await context.newPage();
  await openGroupShelf(classicShelf, 1120, "dark", "classic");
  await expect(classicShelf.locator(".shelf--modern")).toHaveCount(0);
  await classicShelf.screenshot({
    path: join(artifactPath, "shelf-classic-default-groups.png"),
    animations: "disabled",
  });

  await classicShelf.getByRole("button", { name: "新建分组", exact: true }).click();
  const createInput = classicShelf.getByRole("textbox", { name: "新建分组", exact: true });
  await expect(createInput).toBeVisible();
  await expect(createInput).toBeFocused();
  await expect(classicShelf.locator(".pinboard-name-dialog")).toHaveCount(0);
  await createInput.fill("Discard this group");
  await createInput.press("Escape");
  await expect(createInput).toBeHidden();
  await expect(classicShelf.getByRole("button", { name: "新建分组", exact: true })).toBeFocused();
  expect((await readGroupMetrics(classicShelf)).created).toEqual([]);

  await classicShelf.getByRole("button", { name: "新建分组", exact: true }).click();
  await expect(createInput).toBeFocused();
  await createInput.fill("Side project");
  await createInput.press("Enter");
  await expect(classicShelf.getByRole("button", { name: "Side project", exact: true })).toBeVisible();
  expect((await readGroupMetrics(classicShelf)).created).toEqual(["Side project"]);

  const reference = classicShelf.getByRole("button", { name: "Reference", exact: true });
  await reference.dblclick();
  const renameInput = classicShelf.getByRole("textbox", { name: "重命名分组", exact: true });
  await expect(renameInput).toBeVisible();
  await expect(renameInput).toBeFocused();
  await renameInput.fill("Discard this rename");
  await renameInput.press("Escape");
  await expect(renameInput).toBeHidden();
  expect((await readGroupMetrics(classicShelf)).renamed).toEqual([]);

  await reference.dblclick();
  await expect(renameInput).toBeFocused();
  await renameInput.fill("Reference notes");
  await renameInput.press("Enter");
  await expect(classicShelf.getByRole("button", { name: "Reference notes", exact: true })).toBeVisible();
  expect((await readGroupMetrics(classicShelf)).renamed).toEqual([
    { id: "board-reference", name: "Reference notes" },
  ]);

  const referenceChip = classicShelf.locator('[data-pb-pinboard-id="board-reference"]');
  await referenceChip.getByRole("button", { name: "管理 Reference notes", exact: true }).click();
  const classicMenu = classicShelf.getByRole("menu", { name: "Reference notes 管理选项" });
  await expect(classicMenu).toBeVisible();
  await expect(classicMenu.getByRole("menuitem", { name: /移到左侧|移到右侧/ })).toHaveCount(0);
  const classicMenuStyle = await classicMenu.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, backdrop: style.backdropFilter, radius: style.borderRadius };
  });
  expect(classicMenuStyle.background).not.toBe("rgb(47, 52, 59)");
  expect(classicMenuStyle.backdrop).toContain("blur(24px)");
  expect(classicMenuStyle.radius).toBe("16px");
  await classicShelf.screenshot({
    path: join(artifactPath, "shelf-classic-purple-management-menu.png"),
    animations: "disabled",
  });
  await classicShelf.keyboard.press("Escape");
  await expect(classicMenu).toBeHidden();

  await dragPinboardGroup(
    classicShelf,
    "board-created-1",
    "board-work",
    "before",
    false,
    join(artifactPath, "classic-group-drag-in-progress.png"),
  );
  await expect.poll(async () => (await readGroupMetrics(classicShelf)).moves).toEqual([
    { id: "board-created-1", afterId: "board-work" },
  ]);
  await expect(referenceChip.getByRole("button", { name: "管理 Reference notes", exact: true })).toBeVisible();

  await selectVersion(classicSettings, "新版");
  await saveSettings(classicSettings, "modern");

  const modernShelf = await context.newPage();
  await openGroupShelf(modernShelf, 1120, "dark", "modern");
  await expect(modernShelf.locator(".shelf--modern")).toBeVisible();
  await modernShelf.getByRole("button", { name: "新建分组", exact: true }).click();
  await expect(modernShelf.getByRole("dialog", { name: "新建分组" })).toBeVisible();
  await expect(modernShelf.getByRole("textbox", { name: "新建分组", exact: true })).toBeFocused();
  await modernShelf.keyboard.press("Escape");
  await expect(modernShelf.getByRole("dialog", { name: "新建分组" })).toBeHidden();

  await modernShelf.getByRole("button", { name: "管理 Reference", exact: true }).click();
  const modernMenu = modernShelf.getByRole("menu", { name: "Reference 管理选项" });
  await expect(modernMenu).toBeVisible();
  expect(await modernMenu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(47, 52, 59)");
  await modernShelf.screenshot({
    path: join(artifactPath, "shelf-modern-graphite-management-menu.png"),
    animations: "disabled",
  });

  const reopenedModernSettings = await context.newPage();
  await openStandaloneSettings(reopenedModernSettings, "modern");
  await expect(reopenedModernSettings.locator(".settings-tabs")).toHaveCSS("flex-direction", "column");
  await expect(reopenedModernSettings.getByRole("radio", { name: "新版" })).toBeChecked();
  await reopenedModernSettings.screenshot({
    path: join(artifactPath, "settings-modern-after-classic-roundtrip.png"),
    animations: "disabled",
  });
});

for (const version of ["modern", "classic"] as const) {
  const expectedBackground = version === "modern" ? "rgb(36, 40, 46)" : "rgb(36, 33, 45)";
  for (const surface of ["editor", "preview", "whatsnew"] as const) {
    test(`${version} saved preference themes the standalone ${surface} panel`, async ({ page }) => {
      await page.setViewportSize({ width: 920, height: 680 });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await installGroupHost(page, version);

      const query = surface === "editor"
        ? "panel=editor&mode=create"
        : surface === "preview"
          ? "panel=preview&itemId=text-old"
          : "panel=whatsnew";
      await page.goto(`${settingsTestBaseUrl}/?visual=1&${query}`, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("data-pb-ui-version", version);

      const surfaceSelector = surface === "editor"
        ? ".editor-backdrop--standalone .editor"
        : surface === "preview"
          ? ".preview.preview--standalone"
          : ".whats-new-modal.whats-new-modal--standalone";
      const panel = page.locator(surfaceSelector);
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(expectedBackground);
      if (surface === "preview") await expect(panel).toContainText("Invoice #1042");
      if (surface === "editor") await expect(panel).toContainText("新建文本");
      if (surface === "whatsnew") {
        await expect(panel.getByRole("heading", { name: "新版界面与使用体验优化", exact: true })).toBeVisible();
        await expect(panel).toContainText(`版本更新 ${CURRENT_APP_VERSION}`);
      }
    });
  }
}
