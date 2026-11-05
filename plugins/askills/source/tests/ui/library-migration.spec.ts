import { test, expect, type Page } from "@playwright/test";
import { installBackendFixture, invocations } from "./fixtures";
import { nativeError } from "../../src/app/i18n/diagnostics";

async function openSettings(page: Page, english = false) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", {
      name: english ? "Settings" : "设置",
      exact: true,
    })
    .click();
}

test("已有 skills 的库可预览迁移，确认前不写入，成功刷新位置并保留内容", async ({
  page,
}, info) => {
  await installBackendFixture(page, { migrationDelayMs: 650 });
  await openSettings(page);
  const settings = page.getByRole("region", { name: "本地 skills 库" });
  const choose = settings.getByRole("button", { name: "选择 skills 库位置" });
  await expect(choose).toBeEnabled();
  await choose.click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("D:/Example/Askills Library");
  await expect(dialog).toContainText("D:/Example/library");
  await expect(dialog).toContainText("2 个 skill");
  await expect(dialog).toContainText("2 个版本");
  await expect(dialog).toContainText("8.0 KB");
  await expect(dialog).toContainText("原目录会保留作备份");
  expect(await invocations(page, "set_library_root")).toEqual([]);
  await page.screenshot({
    path: info.outputPath("library-migration-preview.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "确认迁移", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "确认迁移", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("迁移并校验 skills 库");
  await expect(
    page.getByRole("progressbar", { name: "操作进度" }),
  ).not.toHaveAttribute("value");
  await expect(dialog).not.toBeVisible();
  await expect(settings.locator(".path")).toHaveText("D:/Example/library");
  await expect(page.getByRole("status")).toContainText(
    "原目录保留在 D:/Example/Askills Library",
  );
  const selection = (await invocations(page, "preview_library_migration"))[0]
    .args.selectionId;
  expect(await invocations(page, "set_library_root")).toEqual([
    { command: "set_library_root", args: { selectionId: selection } },
  ]);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "skills 库", exact: true })
    .click();
  await expect(page.locator(".skill-card")).toHaveCount(2);
  await page.locator(".skill-card").first().click();
  await expect(page.locator(".markdown")).toContainText("Rust 异步技能");
});

test("取消目录选择或关闭迁移预览不会更改库，关闭会释放目录令牌", async ({
  page,
}) => {
  await installBackendFixture(page);
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await invocations(page, "set_library_root")).toEqual([]);
  const preview = (await invocations(page, "preview_library_migration"))[0];
  expect((await invocations(page, "discard_selections"))[0].args).toEqual({
    selectionIds: [preview.args.selectionId],
  });
  await expect(
    page.getByRole("region", { name: "本地 skills 库" }).locator(".path"),
  ).toHaveText("D:/Example/Askills Library");
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await invocations(page, "discard_selections")).toHaveLength(2);
});

test("原生目录选择取消时不创建迁移预览", async ({ page }) => {
  await installBackendFixture(page, { librarySelectionCancelled: true });
  await openSettings(page);
  const choose = page.getByRole("button", { name: "选择 skills 库位置" });
  await choose.click();
  await expect(choose).toBeEnabled();
  expect(await invocations(page, "preview_library_migration")).toEqual([]);
  expect(await invocations(page, "set_library_root")).toEqual([]);
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("迁移失败保留当前库和预览，可用同一目录令牌重试", async ({ page }) => {
  await installBackendFixture(page, { migrationFailure: true });
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟迁移失败，请重试");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("region", { name: "本地 skills 库" }).locator(".path"),
  ).toHaveText("D:/Example/Askills Library");
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(dialog).not.toBeVisible();
  const attempts = await invocations(page, "set_library_root");
  expect(attempts).toHaveLength(2);
  expect(attempts[0].args).toEqual(attempts[1].args);
  expect(await invocations(page, "preview_library_migration")).toHaveLength(1);
  await expect(
    page.getByRole("region", { name: "本地 skills 库" }).locator(".path"),
  ).toHaveText("D:/Example/library");
});

test("复制期间可通过浮动通知取消，失败弹窗可关闭并继续使用旧库", async ({
  page,
}) => {
  await installBackendFixture(page, { migrationDelayMs: 1400 });
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("迁移已取消");
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "本地 skills 库" }).locator(".path"),
  ).toHaveText("D:/Example/Askills Library");
  expect(await invocations(page, "cancel_operation")).toHaveLength(1);
});

test("当前目录无需迁移，无效目标提示错误且不保留目录令牌", async ({
  page,
  context,
}) => {
  await installBackendFixture(page, { librarySamePath: true });
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  await expect(page.getByRole("status")).toContainText(
    "选择的目录已是当前 skills 库位置",
  );
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await invocations(page, "discard_selections")).toHaveLength(1);
  expect(await invocations(page, "set_library_root")).toEqual([]);
  const invalidPage = await context.newPage();
  await installBackendFixture(invalidPage, { migrationPreviewFailure: true });
  await openSettings(invalidPage);
  await invalidPage.getByRole("button", { name: "选择 skills 库位置" }).click();
  await expect(invalidPage.getByRole("alert")).toContainText(
    "目标目录包含已有文件",
  );
  await expect(invalidPage.getByRole("dialog")).not.toBeVisible();
  expect(await invocations(invalidPage, "discard_selections")).toHaveLength(1);
  expect(await invocations(invalidPage, "set_library_root")).toEqual([]);
});

test("英文空库迁移确认和成功通知完整可读", async ({ page }, info) => {
  await installBackendFixture(page, { locale: "en", emptyLibrary: true });
  await openSettings(page, true);
  await page.getByRole("button", { name: "Choose library location" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Change skills library location",
  });
  await expect(dialog).toContainText("Current location");
  await expect(dialog).toContainText("New location");
  await expect(dialog).toContainText("Skills: 0");
  await expect(dialog).toContainText("Versions: 0");
  await expect(dialog).toContainText("Project installations: 0");
  await expect(dialog).toContainText("kept as a backup");
  await page.screenshot({
    path: info.outputPath("library-migration-english.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Confirm move" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Library location updated.",
  );
  await expect(
    page.getByRole("region", { name: "Local skill library" }).locator(".path"),
  ).toHaveText("D:/Example/library");
});

test("恢复后重试返回当前库时，备份提示仍指向预览中的旧库", async ({ page }) => {
  await installBackendFixture(page, {
    migrationFailure: true,
    migrationRecoveredBeforeRetry: true,
  });
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟迁移失败");
  await dialog.getByRole("button", { name: "确认迁移" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "原目录保留在 D:/Example/Askills Library",
  );
  await expect(page.getByRole("status")).not.toContainText(
    "原目录保留在 D:/Example/library",
  );
  await expect(
    page.getByRole("region", { name: "本地 skills 库" }).locator(".path"),
  ).toHaveText("D:/Example/library");
});

test("恢复错误阻止授权清理时仍可关闭预览并离开设置", async ({ page }) => {
  await installBackendFixture(page, { discardSelectionFailure: true });
  await openSettings(page);
  await page.getByRole("button", { name: "选择 skills 库位置" }).click();
  const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
  await dialog.getByRole("button", { name: "关闭对话框" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("alert")).toContainText("迁移目标需要恢复");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "skills 库", exact: true })
    .click();
  await expect(page.locator(".skill-card")).toHaveCount(2);
  expect(await invocations(page, "set_library_root")).toEqual([]);
});

for (const locale of ["zh-CN", "en"] as const) {
  test(`迁移成功但刷新失败仍说明已迁移和备份，手动刷新可恢复（${locale}）`, async ({
    page,
  }) => {
    const english = locale === "en";
    await installBackendFixture(page, {
      locale,
      migrationSnapshotFailure: true,
    });
    await openSettings(page, english);
    await page
      .getByRole("button", {
        name: english ? "Choose library location" : "选择 skills 库位置",
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: english ? "Confirm move" : "确认迁移" })
      .click();
    await expect(dialog).not.toBeVisible();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      english ? "Library location updated." : "skills 库位置已更新。",
    );
    await expect(alert).toContainText("D:/Example/Askills Library");
    await expect(alert).toContainText(
      english ? "Refresh failed:" : "数据刷新失败：",
    );
    await expect(
      page
        .getByRole("region", {
          name: english ? "Local skill library" : "本地 skills 库",
        })
        .locator(".path"),
    ).toHaveText("D:/Example/library");
    await page
      .getByRole("button", { name: english ? "Refresh" : "刷新", exact: true })
      .click();
    await expect(alert).not.toBeVisible();
    await expect(
      page.getByRole("button", {
        name: english ? "Choose library location" : "选择 skills 库位置",
      }),
    ).toBeEnabled();
    expect(await invocations(page, "set_library_root")).toHaveLength(1);
    expect(await invocations(page, "get_snapshot")).toHaveLength(3);
  });
}

for (const startNextOperation of [false, true]) {
  test(`Ready 阶段取消后成功，延迟取消回复不覆盖${startNextOperation ? "下一次操作" : "成功通知"}`, async ({
    page,
  }) => {
    await installBackendFixture(page, {
      migrationDelayMs: 400,
      migrationReadyBeforeCancel: true,
      cancellationReplyDelayMs: 1200,
      laterRefreshDelayMs: startNextOperation ? 1600 : 0,
    });
    await openSettings(page);
    await page.getByRole("button", { name: "选择 skills 库位置" }).click();
    const dialog = page.getByRole("dialog", { name: "更改 skills 库位置" });
    await dialog.getByRole("button", { name: "确认迁移" }).click();
    await page.getByRole("button", { name: "取消操作", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status")).toContainText("skills 库位置已更新");
    if (startNextOperation) {
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("刷新数据");
    }
    await expect
      .poll(() =>
        page.evaluate(() => window.__ASKILLS_TEST__.completedCancellations),
      )
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "选择 skills 库位置" }),
    ).toBeEnabled();
    if (startNextOperation)
      await expect(page.getByRole("status")).not.toBeVisible();
    else
      await expect(page.getByRole("status")).toContainText(
        "skills 库位置已更新",
      );
    await expect(
      page.getByText("已请求取消；正在完成当前安全步骤。", { exact: true }),
    ).not.toBeVisible();
  });
}

test("非空目标错误提供英文摘要并保留原始诊断", () => {
  expect(
    nativeError("DirectoryNotEmpty", "目标目录包含已有文件", "en"),
  ).toContain("Choose an empty destination folder");
  expect(
    nativeError("DirectoryNotEmpty", "目标目录包含已有文件", "en"),
  ).toContain("目标目录包含已有文件");
});
