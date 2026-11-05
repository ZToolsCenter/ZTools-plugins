import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

async function openSources(page: Page) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await page.getByRole("button", { name: "查找 skills" }).click();
}

test("候选提供独立下载、预览、多选；关闭预览释放暂存且不入库", async ({
  page,
}) => {
  await installBackendFixture(page, { emptyLibrary: true });
  await openSources(page);
  const row = page.locator(".candidate-row");
  for (const name of ["下载", "预览", "多选"])
    await expect(row.getByRole("button", { name, exact: true })).toBeVisible();
  await row.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "预览 skill", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "翻译为简体中文" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "下载到 skills 库", exact: true }),
  ).toBeVisible();
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await invocations(page, "discard_import")).toHaveLength(1);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(0);
  await row.getByRole("button", { name: "预览", exact: true }).click();
  await dialog
    .getByRole("button", { name: "下载到 skills 库", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "来源", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(1);
});

test("直接下载立即显示顶部悬浮通知与真实文件进度，滚动页面仍可见", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page, {
    emptyLibrary: true,
    sourceCandidateCount: 12,
    downloadDelayMs: 4000,
  });
  await page.setViewportSize({ width: 1200, height: 700 });
  await openSources(page);
  const row = page.locator(".candidate-row").last();
  await row.getByRole("button", { name: "下载", exact: true }).click();
  const toast = page.locator(".operation-toast[data-operation-state='busy']");
  await expect(toast).toContainText("正在下载 1 个 skill 到 skills 库");
  await expect(toast).toBeInViewport();
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const region = page.locator(".operation-toast-region");
  expect(
    await region.evaluate((element) => getComputedStyle(element).position),
  ).toBe("fixed");
  const firstBox = await region.boundingBox();
  expect(firstBox!.y).toBeLessThan(30);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(toast).toBeInViewport();
  expect((await region.boundingBox())!.y).toBeCloseTo(firstBox!.y, 1);
  const bar = toast.getByRole("progressbar", { name: "操作进度" });
  await expect(bar).toHaveAttribute("value", "25");
  await expect(toast).toContainText("1 / 4 个文件 · 25%");
  await expect(toast).toContainText("1.0 KB / 4.0 KB");
  await expect(toast).toContainText("SKILL.md");
  const prepare = (await invocations(page, "prepare_github"))[0];
  const polls = await invocations(page, "get_download_progress");
  expect(polls.length).toBeGreaterThan(0);
  expect(
    polls.every((item) => item.args.requestId === prepare.args.requestId),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("source-download-progress.png"),
  });
  await expect(
    row.getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "来源", exact: true }),
  ).toBeVisible();
  expect(await invocations(page, "finish_import")).toHaveLength(1);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedSkillPaths),
  ).toEqual(["skills/example-12"]);
});

test("批量部分失败可只重试失败项，成功技能不会重复下载或入库", async ({
  page,
}) => {
  await installBackendFixture(page, {
    emptyLibrary: true,
    sourceCandidateCount: 3,
    downloadFailures: { "skills/tauri-security": 1 },
  });
  await openSources(page);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page
    .getByRole("button", { name: "下载所选（3）", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已保存 2 / 3 个 skill");
  const rows = page.locator(".candidate-row");
  await expect(
    rows.nth(0).getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  await expect(
    rows.nth(2).getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  await expect(rows.nth(1)).toContainText("模拟下载失败，请重试");
  await expect(
    rows.nth(1).getByRole("button", { name: "取消选择", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "下载所选（1）", exact: true })
    .click();
  await expect(
    rows.getByRole("button", { name: "已下载", exact: true }),
  ).toHaveCount(3);
  expect(
    (await invocations(page, "prepare_github")).map(
      (item) => item.args.skillPath,
    ),
  ).toEqual([
    "skills/rust",
    "skills/tauri-security",
    "skills/example-3",
    "skills/tauri-security",
  ]);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedSkillPaths),
  ).toEqual(["skills/rust", "skills/example-3", "skills/tauri-security"]);
  expect(await invocations(page, "finish_import")).toHaveLength(3);
  await expect(
    page.getByRole("button", { name: "下载所选（0）", exact: true }),
  ).toBeDisabled();
});

test("直接下载保存失败时释放旧预览，重试创建新预览且只入库一次", async ({
  page,
}) => {
  await installBackendFixture(page, { importFailures: 1, emptyLibrary: true });
  await openSources(page);
  const row = page.locator(".candidate-row");
  await row.getByRole("button", { name: "下载", exact: true }).click();
  await expect(row).toContainText("模拟写入失败，请重试");
  await expect(page.getByRole("alert")).toContainText("已保存 0 / 1 个 skill");
  expect(await invocations(page, "discard_import")).toHaveLength(1);
  await row.getByRole("button", { name: "下载", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  const finishes = await invocations(page, "finish_import");
  expect(finishes).toHaveLength(2);
  expect(finishes[0].args.importId).not.toBe(finishes[1].args.importId);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(1);
});

test("取消批量下载会停止当前项并阻止后续技能开始下载", async ({ page }) => {
  await installBackendFixture(page, {
    emptyLibrary: true,
    sourceCandidateCount: 3,
    downloadDelayMs: 4000,
  });
  await openSources(page);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page
    .getByRole("button", { name: "下载所选（3）", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "操作进度" }),
  ).toHaveAttribute("value", "25");
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("下载已停止");
  await expect(page.getByRole("status")).toContainText("已保存 0 / 3 个 skill");
  expect(await invocations(page, "cancel_operation")).toHaveLength(1);
  expect(
    (await invocations(page, "prepare_github")).map(
      (item) => item.args.skillPath,
    ),
  ).toEqual(["skills/rust"]);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("API 与 Git 切换后清空选择及下载结果，并重新绑定当前来源目录", async ({
  page,
}) => {
  await installBackendFixture(page, { sourceCandidateCount: 2 });
  await openSources(page);
  const rows = page.locator(".candidate-row");
  await rows.nth(0).getByRole("button", { name: "下载", exact: true }).click();
  await expect(
    rows.nth(0).getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  await rows.nth(1).getByRole("button", { name: "多选", exact: true }).click();
  await expect(page.getByText("已选择 1 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "本地 Git", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("已选择 0 项", { exact: true })).toBeVisible();
  await expect(
    rows.getByRole("button", { name: "已下载", exact: true }),
  ).toHaveCount(0);
  await rows.nth(1).getByRole("button", { name: "下载", exact: true }).click();
  await expect(
    rows.nth(1).getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  expect(
    (await invocations(page, "prepare_github")).map(
      (item) => item.args.catalogId,
    ),
  ).toEqual(["catalog-one", "catalog-git"]);
  await page.getByRole("button", { name: "GitHub API", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "查找 skills" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("已选择 0 项", { exact: true })).toBeVisible();
  await expect(
    rows.getByRole("button", { name: "已下载", exact: true }),
  ).toHaveCount(0);
});
