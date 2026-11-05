import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "playwright/test";

import { installGroupHost, openGroupShelf } from "./group-popover-host";

const base = "http://127.0.0.1:5179";
const artifactPath = join(process.cwd(), "artifacts", "pasteboardpro", "color-picker-layer");

type PickerField = Readonly<{
  label: string;
  trigger: string;
  preparation?: (page: Page) => Promise<void>;
}>;

const themePickerField: PickerField = { label: "选择主题色", trigger: "主题色调色板" };
const pickerFields: readonly PickerField[] = [
  themePickerField,
  {
    label: "选择背景颜色",
    trigger: "背景颜色调色板",
    preparation: async (page: Page) => {
      await page.locator('label:has(input[name="background-type"][value="color"])').click();
    },
  },
  {
    label: "选择卡片底色",
    trigger: "卡片底色调色板",
    preparation: async (page: Page) => {
      await page.getByRole("checkbox", { name: "自定义卡片底色" }).check();
    },
  },
  {
    label: "选择背景底色",
    trigger: "背景底色调色板",
    preparation: async (page: Page) => {
      await page.locator('label:has(input[name="background-type"][value="default"])').click();
      await page.getByRole("checkbox", { name: "自定义背景底色" }).check();
    },
  },
];

async function openAppearanceSettings(
  page: Page,
  options: Readonly<{
    colorScheme?: "dark" | "light";
    uiVersion?: "modern" | "classic";
    width?: number;
    height?: number;
  }> = {},
): Promise<void> {
  const { colorScheme = "dark", uiVersion = "modern", width = 980, height = 760 } = options;
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await installGroupHost(page, uiVersion);
  await page.goto(`${base}/?visual=1&panel=privacy&tab=appearance`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: "Paste剪切板设置" })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveAttribute("data-ui-version", uiVersion);
}

async function openPicker(page: Page, field: PickerField): Promise<{
  trigger: Locator;
  picker: Locator;
}> {
  await field.preparation?.(page);
  const trigger = page.getByRole("button", { name: field.trigger, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const picker = page.getByRole("dialog", { name: field.trigger, exact: true });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("open", "");
  await expect(picker.locator("[data-pb-color-plane]")).toBeVisible();
  await expect(picker.getByRole("slider", { name: "色相" })).toBeVisible();
  const layer = await picker.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    const topHit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      modal: dialog.matches(":modal"),
      topmostAtCenter: topHit !== null && (topHit === dialog || dialog.contains(topHit)),
    };
  });
  expect(layer.modal).toBe(true);
  expect(layer.topmostAtCenter).toBe(true);
  return { trigger, picker };
}

async function readTheme(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pb-test-window-preferences");
    return raw === null ? {} : JSON.parse(raw).theme;
  });
}

async function readShelfAccent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--pb-violet");
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

async function notifyShelf(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("pasteboard-pro:window-preferences-changed"));
  });
}

async function expectFocusInside(picker: Locator): Promise<void> {
  expect(await picker.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
}

test("all four color pickers sit in the modal top layer and contain keyboard focus", async ({ page }) => {
  await openAppearanceSettings(page);
  const settings = page.getByRole("dialog", { name: "Paste剪切板设置" });

  for (const field of pickerFields) {
    const { trigger, picker } = await openPicker(page, field);
    await expect(page.getByLabel(field.label)).toHaveAttribute("type", "text");
    await expect(picker.getByLabel("颜色代码")).toBeFocused();

    if (field.trigger === themePickerField.trigger) {
      await page.getByRole("button", { name: "保存设置", exact: true }).focus();
      await expectFocusInside(picker);
      await picker.getByLabel("颜色代码").focus();
      for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press("Tab");
        await expectFocusInside(picker);
      }
      for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press("Shift+Tab");
        await expectFocusInside(picker);
      }
      await expect(settings).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(trigger).toBeFocused();
  }
});

test("cancel preserves the draft and applying a hue change waits for Save before updating Shelf", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const settings = await context.newPage();
  await openAppearanceSettings(settings);
  const shelf = await context.newPage();
  await openGroupShelf(shelf, 1440, "dark", "modern");

  try {
    const savedBefore = await readTheme(settings);
    const themeInput = settings.getByLabel("选择主题色");
    const originalDraft = await themeInput.inputValue();
    const originalShelfAccent = await readShelfAccent(shelf);

    const cancelled = await openPicker(settings, themePickerField);
    await cancelled.picker.getByLabel("颜色代码").fill("#123456");
    await cancelled.picker.getByRole("button", { name: "取消", exact: true }).click();
    await expect(cancelled.picker).toBeHidden();
    await expect(themeInput).toHaveValue(originalDraft);
    expect(await readTheme(settings)).toEqual(savedBefore);

    const applied = await openPicker(settings, themePickerField);
    const colorCode = applied.picker.getByLabel("颜色代码");
    const beforeHueChange = await colorCode.inputValue();
    const hue = applied.picker.getByRole("slider", { name: "色相" });
    await hue.focus();
    await pageKeyboardHome(settings);
    await expect(colorCode).not.toHaveValue(beforeHueChange);
    const changedColor = (await colorCode.inputValue()).toLowerCase();
    expect(changedColor).toMatch(/^#[\da-f]{6}$/);
    expect(changedColor).not.toBe(beforeHueChange.toLowerCase());

    await applied.picker.getByRole("button", { name: "应用颜色", exact: true }).click();
    await expect(applied.picker).toBeHidden();
    await expect(themeInput).toHaveValue(changedColor);
    expect(await readTheme(settings)).toEqual(savedBefore);
    expect(await readShelfAccent(shelf)).toBe(originalShelfAccent);

    await settings.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect.poll(async () => String((await readTheme(settings)).accentColor).toLowerCase()).toBe(changedColor);
    expect(await readShelfAccent(shelf)).toBe(originalShelfAccent);
    await notifyShelf(shelf);
    const hueSavedAccent = await readShelfAccent(shelf);
    expect(hueSavedAccent).not.toBe(originalShelfAccent);

    const validation = await openPicker(settings, themePickerField);
    const validationCode = validation.picker.getByLabel("颜色代码");
    const applyButton = validation.picker.getByRole("button", { name: "应用颜色", exact: true });
    await validationCode.fill("#12zz");
    await expect(applyButton).toBeDisabled();
    await validationCode.fill("#A1B2C3");
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(validation.picker).toBeHidden();
    await expect(themeInput).toHaveValue("#a1b2c3");
    await expect.poll(async () => String((await readTheme(settings)).accentColor).toLowerCase()).toBe(changedColor);

    await settings.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect.poll(async () => String((await readTheme(settings)).accentColor).toLowerCase()).toBe("#a1b2c3");
    expect(await readShelfAccent(shelf)).toBe(hueSavedAccent);
    await notifyShelf(shelf);
    await expect.poll(() => readShelfAccent(shelf)).not.toBe(hueSavedAccent);
  } finally {
    await context.close();
  }
});

async function pageKeyboardHome(page: Page): Promise<void> {
  await page.keyboard.press("Home");
}

test("color picker remains visible in light, dark, classic, and narrow settings windows", async ({ browser }) => {
  await mkdir(artifactPath, { recursive: true });
  const cases = [
    { colorScheme: "light", uiVersion: "modern", width: 980, height: 760, name: "light-modern" },
    { colorScheme: "dark", uiVersion: "modern", width: 980, height: 760, name: "dark-modern" },
    { colorScheme: "dark", uiVersion: "classic", width: 980, height: 760, name: "dark-classic" },
    { colorScheme: "dark", uiVersion: "modern", width: 380, height: 360, name: "narrow-380x360" },
  ] as const;

  for (const scenario of cases) {
    const context = await browser.newContext({ colorScheme: scenario.colorScheme });
    const page = await context.newPage();
    try {
      await openAppearanceSettings(page, scenario);
      const { trigger, picker } = await openPicker(page, themePickerField);
      const bounds = await picker.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(scenario.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(scenario.height + 1);
      await page.screenshot({
        path: join(artifactPath, `${scenario.name}.png`),
        animations: "disabled",
      });
      if (scenario.width === 380) {
        const applyButton = picker.getByRole("button", { name: "应用颜色", exact: true });
        await expect(applyButton).toBeVisible();
        const actionBounds = await applyButton.boundingBox();
        expect(actionBounds).not.toBeNull();
        expect(actionBounds!.x).toBeGreaterThanOrEqual(0);
        expect(actionBounds!.y).toBeGreaterThanOrEqual(0);
        expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(scenario.width + 1);
        expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(scenario.height + 1);
        expect(await applyButton.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const topHit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          return topHit === button || (topHit !== null && button.contains(topHit));
        })).toBe(true);
        await applyButton.click();
        await expect(picker).toBeHidden();
        await expect(trigger).toBeFocused();
      } else {
        await page.keyboard.press("Escape");
        await expect(picker).toBeHidden();
      }
    } finally {
      await context.close();
    }
  }
});
