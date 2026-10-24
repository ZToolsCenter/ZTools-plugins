import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture } from "./fixtures";

async function settings(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(page.getByLabel("界面字体", { exact: true })).toBeEnabled();
}

test("默认微软雅黑，不下载字体文件，所有控件使用同一字体", async ({ page }) => {
  await installBackendFixture(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\.(ttf|otf|woff2?)(\?|$)/i.test(request.url()))
      requests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(page.locator(".markdown code").first()).toBeVisible();
  for (const selector of [
    "button",
    "input",
    "select",
    ".path",
    ".markdown code",
    ".markdown pre",
  ]) {
    const families = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).fontFamily),
      );
    expect(families.length).toBeGreaterThan(0);
    expect(
      families.every((value) => value.startsWith('"Microsoft YaHei"')),
    ).toBe(true);
  }
  await settings(page);
  await expect(page.getByLabel("界面字体", { exact: true })).toHaveValue(
    "Microsoft YaHei",
  );
  expect(requests).toEqual([]);
});

test("搜索并选择本机字体，保存后重载、中英文切换和恢复默认", async ({
  page,
}, info) => {
  await installBackendFixture(page);
  await page.goto("/");
  await settings(page);
  await page.getByLabel("搜索本机字体").fill("ari");
  const select = page.getByLabel("界面字体", { exact: true });
  await expect(select.locator("option")).toHaveCount(2);
  await select.selectOption("Arial");
  await expect(select).toHaveValue("Arial");
  await expect(page.locator(".font-preview")).toHaveCSS("font-family", /Arial/);
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await page.reload();
  await settings(page);
  await expect(select).toHaveValue("Arial");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("搜索本机字体").fill("does-not-exist");
  await expect(
    page.getByText("没有匹配的字体，已保留当前字体和默认选项。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(select).toHaveValue("Arial");
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(page.getByLabel("Interface font", { exact: true })).toHaveValue(
    "Arial",
  );
  await page.setViewportSize({ width: 775, height: 540 });
  await page.locator(".font-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("fonts-dark-en.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await expect(page.getByLabel("Interface font", { exact: true })).toHaveValue(
    "Microsoft YaHei",
  );
});

test("字体读取失败可刷新重试，保存失败保留已应用字体", async ({ page }) => {
  await installBackendFixture(page, {
    fontListFailure: true,
    appearanceSaveFailure: true,
  });
  await page.goto("/");
  await settings(page);
  await expect(page.getByRole("alert")).toContainText("无法读取本机字体");
  await page.evaluate(() => {
    window.__ASKILLS_TEST__.fontListFailure = false;
  });
  await page.getByRole("button", { name: "刷新字体列表" }).click();
  const select = page.getByLabel("界面字体", { exact: true });
  await expect(select.locator('option[value="Arial"]')).toHaveCount(1);
  await select.selectOption("Arial");
  await expect(page.getByRole("alert")).toContainText("模拟设置保存失败");
  await expect(select).toHaveValue("Microsoft YaHei");
  await select.selectOption("Arial");
  await expect(select).toHaveValue("Arial");
});

test("已卸载字体保留设置并回退，特殊字体名称不会注入CSS", async ({ page }) => {
  const family = 'Removed", serif; color: red; "Font';
  await installBackendFixture(page, {
    appearance: { fontFamily: family, mode: "dark", accentColor: "#744da9" },
  });
  await page.goto("/");
  await settings(page);
  await expect(
    page.getByText("当前字体未安装，已自动使用默认字体显示。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("界面字体", { exact: true })).toHaveValue(
    family,
  );
  const style = await page.locator(".font-preview").evaluate((element) => ({
    family: getComputedStyle(element).fontFamily,
    color: (element as HTMLElement).style.color,
  }));
  expect(style.family).toContain("Microsoft YaHei");
  expect(style.color).toBe("");
});
