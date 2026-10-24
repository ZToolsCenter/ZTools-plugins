import { test, expect } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

test("显示名称可搜索和恢复，部署仍使用原技能版本", async ({ page }) => {
  await installBackendFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await page.getByRole("button", { name: "编辑显示名称" }).click();
  await page
    .getByRole("textbox", { name: "显示名称", exact: true })
    .fill("我的异步工具");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(
    page.getByRole("heading", { name: "我的异步工具", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索 skills" }).fill("我的异步工具");
  await expect(page.locator(".skill-card")).toHaveCount(1);
  await page.getByRole("button", { name: "添加到项目", exact: true }).click();
  await page.getByRole("button", { name: "预览变更" }).click();
  await expect(page.getByRole("dialog")).toContainText("rust-async-patterns");
  expect(
    (await invocations(page, "preview_deployment"))[0].args.revisionId,
  ).toBe("revision-rust-1");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "编辑显示名称" }).click();
  await page.getByRole("button", { name: "恢复原名" }).click();
  await expect(
    page.getByRole("heading", { name: "rust-async-patterns", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".skill-card")).toHaveCount(0);
});
