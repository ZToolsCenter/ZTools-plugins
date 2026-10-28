import { test, expect } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

for (const [source, git] of [
  ["从 skills 库", false],
  ["从本地", false],
  ["从云端", false],
  ["从云端", true],
] as const) {
  test(`项目内${source}${git ? "（本地 Git）" : ""}添加时始终绑定所选项目，确认前不部署`, async ({
    page,
  }) => {
    await installBackendFixture(page, { extraProject: true });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^项目/ })
      .click();
    await page.getByRole("button", { name: /第二个项目 D:/ }).click();
    await page
      .getByRole("button", { name: "添加 skills", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "为 第二个项目 添加 skills",
    });
    await picker.getByRole("tab", { name: source, exact: true }).click();
    if (source === "从 skills 库") {
      await picker.getByRole("button", { name: /rust-async-patterns/ }).click();
      await picker.getByRole("button", { name: "下一步" }).click();
    } else {
      if (source === "从本地")
        await picker.getByRole("button", { name: "选择本地 skill" }).click();
      else {
        if (git)
          await picker
            .getByRole("button", { name: "本地 Git", exact: true })
            .click();
        await picker
          .getByLabel("仓库地址")
          .fill("https://github.com/example/skills");
        await picker.getByRole("button", { name: "查找 skills" }).click();
        await picker.getByRole("button", { name: "预览", exact: true }).click();
      }
      expect(await invocations(page, "apply_deployment")).toHaveLength(0);
      await page.getByRole("button", { name: "导入并继续" }).click();
    }
    const install = page.getByRole("dialog", {
      name: "添加到项目",
      exact: true,
    });
    await expect(install.getByLabel("目标项目")).toHaveValue("project-second");
    await expect(install.getByLabel("目标项目")).toBeDisabled();
    await install.getByRole("button", { name: "预览变更" }).click();
    expect(
      (await invocations(page, "preview_deployment"))[0].args.projectId,
    ).toBe("project-second");
    expect(await invocations(page, "apply_deployment")).toHaveLength(0);
    await page.getByRole("button", { name: "确认应用", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".project-detail")).toContainText("第二个项目");
    await expect(page.locator(".deployment-row")).toContainText(
      "rust-async-patterns",
    );
  });
}

test("项目云端直接下载单个技能后进入当前项目安装预览", async ({ page }) => {
  await installBackendFixture(page, {
    extraProject: true,
    downloadDelayMs: 400,
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^项目/ })
    .click();
  await page.getByRole("button", { name: /第二个项目 D:/ }).click();
  await page.getByRole("button", { name: "添加 skills", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "为 第二个项目 添加 skills",
  });
  await picker.getByRole("tab", { name: "从云端", exact: true }).click();
  await picker.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await picker.getByRole("button", { name: "查找 skills" }).click();
  await picker.getByRole("button", { name: "下载", exact: true }).click();
  await expect(picker.getByRole("status")).toContainText("正在下载 1 个 skill");
  const install = page.getByRole("dialog", { name: "添加到项目", exact: true });
  await expect(install).toBeVisible();
  await expect(install.getByLabel("目标项目")).toHaveValue("project-second");
  await expect(install.getByLabel("目标项目")).toBeDisabled();
  expect(await invocations(page, "finish_import")).toHaveLength(1);
  expect(await invocations(page, "apply_deployment")).toHaveLength(0);
  await install.getByRole("button", { name: "预览变更" }).click();
  expect(
    (await invocations(page, "preview_deployment"))[0].args.projectId,
  ).toBe("project-second");
});

test("项目内批量下载只有一项成功时保留列表与失败选择，不跳转安装", async ({
  page,
}) => {
  await installBackendFixture(page, {
    extraProject: true,
    sourceCandidateCount: 2,
    downloadFailures: { "skills/tauri-security": 1 },
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^项目/ })
    .click();
  await page.getByRole("button", { name: /第二个项目 D:/ }).click();
  await page.getByRole("button", { name: "添加 skills", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "为 第二个项目 添加 skills",
  });
  await picker.getByRole("tab", { name: "从云端", exact: true }).click();
  await picker.getByLabel("仓库地址").fill("https://github.com/example/skills");
  await picker.getByRole("button", { name: "查找 skills" }).click();
  await picker.getByRole("button", { name: "全选", exact: true }).click();
  await picker
    .getByRole("button", { name: "下载所选（2）", exact: true })
    .click();
  await expect(picker.getByRole("status")).toContainText(
    "已保存 1 / 2 个 skill",
  );
  await expect(picker).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "添加到项目", exact: true }),
  ).toHaveCount(0);
  const rows = picker.locator(".candidate-row");
  await expect(
    rows.nth(0).getByRole("button", { name: "已下载", exact: true }),
  ).toBeDisabled();
  await expect(rows.nth(1)).toContainText("模拟下载失败，请重试");
  await expect(
    rows.nth(1).getByRole("button", { name: "取消选择", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    picker.getByRole("button", { name: "下载所选（1）", exact: true }),
  ).toBeEnabled();
  expect(await invocations(page, "get_revisions")).toHaveLength(0);
  expect(await invocations(page, "preview_deployment")).toHaveLength(0);
  expect(await invocations(page, "apply_deployment")).toHaveLength(0);
  expect(
    await page.evaluate(() => window.__ASKILLS_TEST__.committedSkillPaths),
  ).toEqual(["skills/rust"]);
});
