import { test, expect } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

test("技能搜索与 Markdown 阅读保留内容但不加载外部资源或执行 HTML", async ({
  page,
}, testInfo) => {
  await installBackendFixture(page);
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (/tracking\.invalid|example\.invalid/.test(request.url()))
      externalRequests.push(request.url());
  });
  await page.goto("/");
  const search = page.getByRole("textbox", { name: "搜索 skills" });
  await search.fill("异步");
  await expect(
    page.getByRole("button", { name: /rust-async-patterns 掌握/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /tauri-security 检查/ }),
  ).toHaveCount(0);
  await search.fill("");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(
    page.getByRole("heading", { name: "Rust 异步技能", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".markdown img, .markdown a, .markdown script"),
  ).toHaveCount(0);
  await expect(
    page.getByText("[图片：跟踪图片]", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__markdownExecuted)).toBeUndefined();
  expect(externalRequests).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("skill-library.png"),
    fullPage: true,
  });
});

test("导入必须确认；关闭预览释放暂存且不会写入技能库", async ({ page }) => {
  await installBackendFixture(page, { emptyLibrary: true });
  await page.goto("/");
  await page.getByRole("button", { name: "导入本地 skill" }).click();
  const dialog = page.getByRole("dialog", { name: "确认导入 skill" });
  await expect(dialog).toBeVisible();
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await invocations(page, "discard_import")).toHaveLength(1);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
  await page.getByRole("button", { name: "导入本地 skill" }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /rust-async-patterns 掌握/ }),
  ).toBeVisible();
  expect(await invocations(page, "finish_import")).toHaveLength(1);
});

test("导入失败留在弹窗中显示错误，可使用同一预览重试", async ({ page }) => {
  await installBackendFixture(page, { importFailures: 1 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入本地 skill" }).click();
  const dialog = page.getByRole("dialog", { name: "确认导入 skill" });
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟写入失败，请重试");
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(0);
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedImports),
  ).toBe(1);
  const imports = await invocations(page, "finish_import");
  expect(imports).toHaveLength(2);
  expect(imports[0].args.importId).toBe(imports[1].args.importId);
});

test("部署计划有冲突时禁止确认应用，不发送写入命令", async ({ page }) => {
  await installBackendFixture(page, { deploymentConflict: true });
  await page.goto("/");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await page.getByRole("button", { name: "添加到项目" }).click();
  await page
    .getByRole("dialog", { name: "添加到项目" })
    .getByRole("button", { name: "预览变更" })
    .click();
  const plan = page.getByRole("dialog", { name: "确认启用项目 skill" });
  await expect(
    plan.getByText("目标已有非 Askills 管理的目录，不能覆盖。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(plan.getByRole("button", { name: "确认应用" })).toBeDisabled();
  expect(await invocations(page, "apply_deployment")).toHaveLength(0);
  const preview = await invocations(page, "preview_deployment");
  expect(preview[0].args).toMatchObject({
    projectId: "project-askills",
    revisionId: "revision-rust-1",
    agent: "codex",
  });
});

test("发现项目部分登记失败后只重试失败项，不重放已消费授权", async ({
  page,
}) => {
  await installBackendFixture(page, { registrationFailure: true });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^项目/ })
    .click();
  await page.getByRole("button", { name: "扫描目录" }).click();
  const dialog = page.getByRole("dialog", { name: "选择要登记的项目" });
  await dialog.getByRole("checkbox", { name: /Alpha 项目/ }).check();
  await dialog.getByRole("checkbox", { name: /Beta 项目/ }).check();
  await dialog.getByRole("button", { name: "登记项目", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Beta 模拟登记失败");
  await dialog.getByRole("button", { name: "登记项目", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const registrations = await invocations(page, "register_project");
  expect(registrations.map((item) => item.args.selectionId)).toEqual([
    "discover-alpha",
    "discover-beta",
    "discover-beta",
  ]);
  await expect(page.getByRole("button", { name: /Alpha 项目/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Beta 项目/ })).toBeVisible();
});

test("新版本导入后清除旧详情，重新阅读可选最新版本", async ({ page }) => {
  await installBackendFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(page.getByLabel("阅读版本")).toHaveValue("revision-rust-1");
  await page.getByRole("button", { name: "导入本地 skill" }).click();
  await page
    .getByRole("dialog", { name: "确认导入 skill" })
    .getByRole("button", { name: "确认导入", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("阅读版本")).toHaveCount(0);
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(page.getByLabel("阅读版本")).toHaveValue("revision-rust-2");
  await expect(page.getByLabel("阅读版本").getByRole("option")).toHaveCount(2);
});

test("GitHub 分支单独传递，预览固定候选时不写入技能库", async ({ page }) => {
  await installBackendFixture(page);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "来源", exact: true })
    .click();
  await page.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await page
    .getByLabel("分支、标签或 commit（可选）")
    .fill("feature/rust-patterns");
  await page.getByRole("button", { name: "查找 skills" }).click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "预览 skill" })).toBeVisible();
  expect((await invocations(page, "resolve_github"))[0].args).toEqual({
    repository: "https://github.com/example/skills",
    reference: "feature/rust-patterns",
  });
  expect((await invocations(page, "prepare_github"))[0].args).toEqual({
    catalogId: "catalog-one",
    skillPath: "skills/rust",
    requestId: expect.any(String),
  });
  expect(await invocations(page, "finish_import")).toHaveLength(0);
});
