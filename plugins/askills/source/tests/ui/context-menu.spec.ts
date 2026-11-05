import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function selectSkills(page: Page) {
  await page.locator(".skill-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page
    .getByRole("region", { name: "多选操作" })
    .getByRole("button", { name: "全选", exact: true })
    .click();
}

test("右键不会打开技能详情；重命名作用于右键目标，键盘可关闭菜单", async ({
  page,
}, info) => {
  await installBackendFixture(page);
  await page.goto("/");
  const card = page.locator(".skill-card").first();
  await card.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "skill 操作" })).toBeVisible();
  expect(await invocations(page, "get_document")).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("skill-menu.png") });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("显示名称", { exact: true }).fill("自定义 Rust");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(card).toContainText("自定义 Rust");
  expect(
    (await invocations(page, "set_skill_display_name"))[0].args.skillId,
  ).toBe("skill-rust");
  await card.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "删除", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("技能多选删除需确认，失败保留选择，重试成功后列表刷新", async ({
  page,
}) => {
  await installBackendFixture(page, { removalFailure: true });
  await page.goto("/");
  await selectSkills(page);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "不释放快照占用的磁盘空间",
  );
  expect(await invocations(page, "remove_library_skills")).toHaveLength(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".skill-card")).toHaveCount(2);
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await page.getByRole("button", { name: "确认删除（2）" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟删除保存失败");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "确认删除（2）" }).click();
  await expect(page.locator(".skill-card")).toHaveCount(0);
  expect(
    (await invocations(page, "remove_library_skills"))[1].args.skillIds,
  ).toEqual(["skill-rust", "skill-security"]);
});

test("批量添加预览后串行应用，失败项重试不会重复成功项", async ({ page }) => {
  await installBackendFixture(page, {
    extraProject: true,
    deploymentFailureSkill: "skill-security",
  });
  await page.goto("/");
  await selectSkills(page);
  await page
    .getByRole("region", { name: "多选操作" })
    .getByRole("button", { name: "添加到项目" })
    .click();
  const dialog = page.getByRole("dialog", { name: "添加到项目", exact: true });
  await dialog.getByLabel("目标项目").selectOption("project-second");
  await dialog.getByRole("button", { name: "预览变更" }).click();
  await expect(
    dialog.getByRole("button", { name: "确认添加（2）" }),
  ).toBeEnabled();
  expect(await invocations(page, "apply_deployment")).toHaveLength(0);
  expect(
    (await invocations(page, "preview_deployment")).map(
      (i) => i.args.projectId,
    ),
  ).toEqual(["project-second", "project-second"]);
  await dialog.getByRole("button", { name: "确认添加（2）" }).click();
  await expect(dialog).toContainText("模拟安装失败");
  await expect(dialog.getByLabel("目标项目")).toBeDisabled();
  await dialog.getByRole("button", { name: "重新预览未完成项" }).click();
  await dialog.getByRole("button", { name: "确认添加（1）" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await invocations(page, "apply_deployment")).toHaveLength(3);
  expect(
    (await invocations(page, "preview_deployment")).map(
      (i) => i.args.revisionId,
    ),
  ).toEqual(["revision-rust-1", "revision-security-1", "revision-security-1"]);
});

test("同名技能的重复目标不能批量写入", async ({ page }) => {
  await installBackendFixture(page, { duplicateSkillName: true });
  await page.goto("/");
  await selectSkills(page);
  await page
    .getByRole("region", { name: "多选操作" })
    .getByRole("button", { name: "添加到项目" })
    .click();
  await page.getByRole("button", { name: "预览变更" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "所选 skill 的安装路径重复",
  );
  await expect(
    page.getByRole("button", { name: "确认添加（0）" }),
  ).toBeDisabled();
  expect(await invocations(page, "apply_deployment")).toHaveLength(0);
});

test("项目备注名、右键添加技能和批量删除指向正确项目", async ({ page }) => {
  await installBackendFixture(page, { extraProject: true });
  await page.goto("/");
  await navigate(page, "项目");
  const second = page.locator(".project-card").nth(1);
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "备注项目名" }).click();
  await page.getByLabel("显示名称", { exact: true }).fill("我的项目备注");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(second).toContainText("我的项目备注");
  await expect(second).toContainText("D:/Example/Second");
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "添加 skills" }).click();
  const picker = page.getByRole("dialog", {
    name: "为 我的项目备注 添加 skills",
  });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".project-detail")).toContainText("我的项目备注");
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "多选", exact: true }).click();
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "项目文件和已安装 skill 保留",
  );
  await page.getByRole("button", { name: "确认删除（2）" }).click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await expect(page.locator(".project-detail")).toHaveCount(0);
  expect(
    (await invocations(page, "remove_projects"))[0].args.projectIds,
  ).toEqual(["project-askills", "project-second"]);
});

test("其他区域禁用默认菜单，英文菜单在小窗口边缘内且点击空白关闭", async ({
  page,
}, info) => {
  await installBackendFixture(page, {
    locale: "en",
    appearance: { mode: "dark", accentColor: "#005fb8" },
  });
  await page.goto("/");
  await page.setViewportSize({ width: 640, height: 480 });
  const card = page.locator(".skill-card").first();
  await card.evaluate((node) =>
    node.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 637,
        clientY: 478,
      }),
    ),
  );
  const menu = page.getByRole("menu", { name: "Skill actions" });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(640);
  expect(box.y + box.height).toBeLessThanOrEqual(480);
  await page.screenshot({ path: info.outputPath("menu-dark-small.png") });
  await page.getByRole("heading", { name: /^Library/ }).click();
  await expect(menu).toHaveCount(0);
  for (const name of ["Sources", "Settings"]) {
    await navigate(page, name);
    expect(
      await page.locator("main").evaluate(
        (node) =>
          !node.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
            }),
          ),
      ),
    ).toBe(true);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});
