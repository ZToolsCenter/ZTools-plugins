import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";
import {
  ACCENT_PRESETS,
  accentPalette,
  contrastRatio,
} from "../../src/app/appearance";

async function settings(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
}
async function accent(page: Page) {
  return page
    .locator("html")
    .evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--accent").trim(),
    );
}

test("预设与自定义主题色保存、重载后恢复，非法颜色不提交且可重置", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page);
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "鸢尾紫", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "鸢尾紫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await accent(page)).toBe("#744da9");
  await page.getByLabel("自定义颜色", { exact: true }).fill("#FFCC00");
  await page.getByRole("button", { name: "应用自定义颜色" }).click();
  await expect(page.getByLabel("自定义颜色", { exact: true })).toHaveValue(
    "#ffcc00",
  );
  expect(await accent(page)).toBe("#ffcc00");
  expect(
    await page
      .locator("html")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--on-accent").trim(),
      ),
  ).toBe("#000000");
  await page.reload();
  await settings(page);
  await expect(page.getByLabel("自定义颜色", { exact: true })).toHaveValue(
    "#ffcc00",
  );
  const before = (await invocations(page, "set_appearance")).length;
  await page.getByLabel("自定义颜色", { exact: true }).fill("#zzzzzz");
  await expect(
    page.getByRole("button", { name: "应用自定义颜色" }),
  ).toBeDisabled();
  expect(await invocations(page, "set_appearance")).toHaveLength(before);
  expect(await accent(page)).toBe("#ffcc00");
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "默认蓝", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("自定义颜色", { exact: true })).toHaveValue(
    "#005fb8",
  );
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue(
    "system",
  );
  await page.getByRole("button", { name: "关闭成功提示" }).click();
  await page.screenshot({
    path: testInfo.outputPath("winui-settings-light.png"),
    fullPage: true,
  });
});

test("浅色深色覆盖系统设置，跟随系统实时响应且不重复写入", async ({ page }) => {
  await installBackendFixture(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await settings(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("外观模式", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("外观模式", { exact: true }).selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const before = (await invocations(page, "set_appearance")).length;
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await invocations(page, "set_appearance")).toHaveLength(before);
});

test("保存失败保留已应用主题，重试成功才切换", async ({ page }) => {
  await installBackendFixture(page, { appearanceSaveFailure: true });
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "鸢尾紫", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟设置保存失败");
  expect(await accent(page)).toBe("#005fb8");
  await expect(
    page.getByRole("button", { name: "默认蓝", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "鸢尾紫", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "鸢尾紫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await accent(page)).toBe("#744da9");
});

test("深色来源与弹窗使用统一主题，小窗口设置不会横向溢出", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page, {
    appearance: { mode: "dark", accentColor: "#744da9" },
  });
  await page.goto("/");
  await settings(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: testInfo.outputPath("winui-settings-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByLabel("仓库地址").fill("owner/repo");
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  expect(
    await page
      .locator(".catalog")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(44, 44, 44)");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "预览 skill", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(44, 44, 44)");
  await page.screenshot({
    path: testInfo.outputPath("winui-preview-dark.png"),
  });
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await page.setViewportSize({ width: 640, height: 720 });
  await settings(page);
  await page
    .getByRole("button", { name: "应用自定义颜色" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "应用自定义颜色" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("预设与极端自定义颜色在两种模式下保持按钮和强调文字对比度", () => {
  const colors = [
    ...ACCENT_PRESETS.map((item) => item.color),
    "#ffffff",
    "#000000",
    "#808080",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#123456",
  ];
  for (const dark of [false, true])
    for (const color of colors) {
      const palette = accentPalette(color, dark);
      for (const background of [palette.accent, palette.hover, palette.pressed])
        expect(
          contrastRatio(palette.foreground, background),
        ).toBeGreaterThanOrEqual(4.5);
      for (const background of [
        palette.soft,
        dark ? "#2c2c2c" : "#ffffff",
        dark ? "#202020" : "#f3f3f3",
      ])
        expect(
          contrastRatio(palette.readable, background),
        ).toBeGreaterThanOrEqual(4.5);
    }
});
