import { test, expect } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

test("切换来源方式清除旧候选，本地 Git 检测和预览不直接入库", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await page.getByLabel("分支、标签或 commit（可选）").fill("feature/skills");
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  await page.getByRole("button", { name: "本地 Git", exact: true }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(0);
  await expect(page.getByLabel("仓库地址")).toHaveValue(
    "https://github.com/example/skills",
  );
  await page.getByRole("button", { name: "检查 Git 安装" }).click();
  await expect(page.getByText("git version 2.55.0.windows.3")).toBeVisible();
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  expect((await invocations(page, "resolve_git"))[0].args).toEqual({
    repository: "https://github.com/example/skills",
    reference: "feature/skills",
  });
  await page.screenshot({
    path: testInfo.outputPath("local-git-source.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "预览 skill" })).toBeVisible();
  expect((await invocations(page, "prepare_github"))[0].args.catalogId).toBe(
    "catalog-git",
  );
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "GitHub API", exact: true }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(0);
});

test("没有安装 Git 时显示错误，仍可切回 API 查找", async ({ page }) => {
  await installBackendFixture(page, { gitUnavailable: true });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByRole("button", { name: "本地 Git", exact: true }).click();
  await page.getByRole("button", { name: "检查 Git 安装" }).click();
  await expect(page.getByRole("alert")).toContainText("未找到本机 Git");
  await page.getByLabel("仓库地址").fill("example/skills");
  await page.getByRole("button", { name: "GitHub API", exact: true }).click();
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(page.locator(".candidate-row")).toHaveCount(1);
  expect(await invocations(page, "resolve_git")).toHaveLength(0);
});
