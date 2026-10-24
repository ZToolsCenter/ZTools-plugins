import { test, expect, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import english from "../../src/app/i18n/en.json" with { type: "json" };
import chinese from "../../src/app/i18n/zh-CN.json" with { type: "json" };
import { translate } from "../../src/app/i18n/messages";
import packageManifest from "../../package.json" with { type: "json" };
import { installBackendFixture, invocations } from "./fixtures";

const RELEASE_LABEL = `V${packageManifest.version}`;

async function navigate(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}

test("中英文切换即时生效且重载保留，不覆盖主题与仓库历史", async ({
  page,
}, info) => {
  await installBackendFixture(page, {
    repositoryHistory: ["https://github.com/example/skills"],
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^skills 库/ })).toBeVisible();
  await expect(page).toHaveTitle("Askills · skills 管理");
  const footer = page.locator(".sidebar-bottom");
  await expect(footer.locator(".version")).toHaveText(
    `当前版本: ${RELEASE_LABEL}`,
  );
  const repository = footer.getByRole("link", { name: "GitHub 仓库" });
  await expect(repository).toHaveAttribute(
    "href",
    "https://github.com/Candquarzy/Askills",
  );
  await repository.click();
  expect(await invocations(page, "open_repository")).toHaveLength(1);
  await navigate(page, "设置");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "鸢尾紫", exact: true }).click();
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Askills · Skill Manager");
  await expect(footer.locator(".version")).toHaveText(
    `Current version: ${RELEASE_LABEL}`,
  );
  await expect(
    footer.getByRole("link", { name: "GitHub repository" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Interface language saved.",
  );
  await expect(
    page.getByRole("button", { name: "Iris purple", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    (await invocations(page, "set_locale")).map((x) => x.args.locale),
  ).toEqual(["en"]);
  await page.reload();
  await navigate(page, "Settings");
  await expect(
    page.getByLabel("Interface language", { exact: true }),
  ).toHaveValue("en");
  await expect(page.getByLabel("Appearance mode", { exact: true })).toHaveValue(
    "dark",
  );
  await expect(page.getByLabel("Custom color", { exact: true })).toHaveValue(
    "#744da9",
  );
  await page.screenshot({
    path: info.outputPath("settings-english-dark.png"),
    fullPage: true,
  });
  await navigate(page, "Sources");
  await expect(
    page
      .getByRole("region", { name: "History (last 10)" })
      .getByRole("button", { name: "example/skills", exact: true }),
  ).toHaveAttribute("title", "https://github.com/example/skills");
  await navigate(page, "Settings");
  await page
    .getByLabel("Interface language", { exact: true })
    .selectOption("zh-CN");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(
    (await invocations(page, "set_locale")).map((x) => x.args.locale),
  ).toEqual(["zh-CN"]);
});

test("英文界面保留技能原文与自定义名称，项目添加和确认流程可用", async ({
  page,
}) => {
  await installBackendFixture(page, { locale: "en" });
  await page.goto("/");
  await page.getByRole("button", { name: /rust-async-patterns 掌握/ }).click();
  await expect(page.locator(".markdown")).toContainText("Rust 异步技能");
  await page.getByRole("button", { name: "Raw Markdown", exact: true }).click();
  const original = await page.locator(".raw-document").innerText();
  expect(original).toContain("# Rust 异步技能");
  await page
    .getByRole("button", { name: "Edit display name", exact: true })
    .click();
  const rename = page.getByRole("dialog", { name: "Edit skill display name" });
  await rename
    .getByLabel("Display name", { exact: true })
    .fill("我的工具 {v0}");
  await rename.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的工具 {v0}", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".raw-document")).toHaveText(original);
  await navigate(page, "Projects");
  await page.locator(".project-card").first().click();
  await page.getByRole("button", { name: "Add skills", exact: true }).click();
  const picker = page.getByRole("dialog", { name: /Add skills to/ });
  for (const name of ["From library", "From cloud", "From local folder"])
    await expect(picker.getByRole("tab", { name, exact: true })).toBeVisible();
  await picker.getByRole("button", { name: /我的工具/ }).click();
  await picker.getByRole("button", { name: "Next", exact: true }).click();
  const install = page.getByRole("dialog", {
    name: "Add to project",
    exact: true,
  });
  await install
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Confirm project skill activation",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await invocations(page, "preview_deployment"))[0].args.revisionId,
  ).toBe("revision-rust-1");
});

test("英文来源页提供预览、下载、多选及英文进度通知", async ({ page }, info) => {
  await installBackendFixture(page, { locale: "en", downloadDelayMs: 1800 });
  await page.goto("/");
  await navigate(page, "Sources");
  await page.getByLabel("Repository URL", { exact: true }).fill("owner/repo");
  await page.getByRole("button", { name: "Find skills", exact: true }).click();
  const row = page.locator(".candidate-row");
  await expect(
    page.getByRole("heading", { name: "Skills found: 1", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", {
    name: "Preview skill",
    exact: true,
  });
  await expect(preview.locator(".markdown")).toContainText("Rust 异步技能");
  await preview.getByRole("button", { name: "Close dialog" }).click();
  await row.getByRole("button", { name: "Select", exact: true }).click();
  await page
    .getByRole("button", { name: "Download selected (1)", exact: true })
    .click();
  const toast = page.locator(".operation-toast[data-operation-state='busy']");
  await expect(toast).toContainText("Downloading skills to library: 1");
  await expect(
    toast.getByRole("progressbar", { name: "Operation progress" }),
  ).toHaveAttribute("value", "25");
  await expect(toast).toContainText("Downloading files");
  await expect(toast).toContainText("Files: 1 / 4 · 25%");
  await expect(
    row.getByRole("button", { name: "Downloaded", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Download finished. Skills saved: 1 / 1.",
  );
  await page.setViewportSize({ width: 640, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("sources-english-small.png"),
    fullPage: true,
  });
});

test("语言保存失败不会切换界面，重试后成功", async ({ page }) => {
  await installBackendFixture(page, { localeSaveFailure: true });
  await page.goto("/");
  await navigate(page, "设置");
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(page.getByRole("alert")).toContainText("模拟设置保存失败");
  await expect(page.getByLabel("界面语言", { exact: true })).toHaveValue(
    "zh-CN",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(
    page.getByLabel("Interface language", { exact: true }),
  ).toHaveValue("en");
});

test("英文翻译目录完整，插值不会翻译或再次展开用户内容", () => {
  const catalog = english as Record<string, string>;
  for (const file of readdirSync("src", { recursive: true }) as string[]) {
    if (!file.endsWith(".tsx") || file.includes(`${path.sep}i18n${path.sep}`))
      continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join("src", file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        expect(
          catalog[node.arguments[0].text],
          `${file}: ${node.arguments[0].text}`,
        ).toBeTruthy();
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [source, translated] of Object.entries(catalog))
    expect(placeholders(translated), source).toEqual(placeholders(source));
  for (const source of Object.keys(catalog)) {
    const translated = translate(source, "zh-CN");
    expect(translated, source).not.toContain("技能");
    expect(placeholders(translated), source).toEqual(placeholders(source));
  }
  for (const source of Object.keys(chinese))
    expect(catalog[source], source).toBeTruthy();
  expect(translate("技能库", "zh-CN")).toBe("skills 库");
  expect(
    translate("为 {project} 添加技能", "zh-CN", {
      project: "我的技能项目 {project}",
    }),
  ).toBe("为 我的技能项目 {project} 添加 skills");
  expect(translate("未知内容：我的技能", "zh-CN")).toBe("未知内容：我的技能");
  expect(translate("toString", "en")).toBe("toString");
  expect(translate("toString", "zh-CN")).toBe("toString");
  expect(
    translate("为 {project} 添加技能", "en", { project: "我的项目 {project}" }),
  ).toBe("Add skills to 我的项目 {project}");
});
