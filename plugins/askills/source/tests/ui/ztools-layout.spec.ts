import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { HostPage } from "../../src/lib/host";
import { installBackendFixture } from "./fixtures";

async function pluginFixture(page: Page, initialPage: HostPage, dark = false) {
  await installBackendFixture(page, { extraProject: true });
  await page.addInitScript(
    ({ initialPage, dark }) => {
      const backend = window.__TAURI_INTERNALS__.invoke;
      window.isTauri = false;
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
      const invoke = <T>(command: string, args?: Record<string, unknown>) =>
        backend(command, args ?? {}) as Promise<T>;
      window.askillsHost = {
        kind: "ztools",
        invoke,
        bindInvoke: () => invoke,
        onEnter(callback) {
          let subscribed = true;
          queueMicrotask(() => {
            if (subscribed) callback(initialPage);
          });
          return () => {
            subscribed = false;
          };
        },
        onOut: () => () => {},
        isDark: () => dark,
        onThemeChange: () => () => {},
      };
    },
    { initialPage, dark },
  );
}

async function expectBetween(first: Locator, detail: Locator, next: Locator) {
  const firstBox = await first.boundingBox();
  const detailBox = await detail.boundingBox();
  const nextBox = await next.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(Math.abs(firstBox!.x - nextBox!.x)).toBeLessThan(1);
  expect(detailBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height);
  expect(nextBox!.y).toBeGreaterThanOrEqual(detailBox!.y + detailBox!.height);
  expect(
    await detail.evaluate((element) =>
      element.parentElement?.classList.contains("selectable-item"),
    ),
  ).toBe(false);
}

test("插件宽屏列表保持单列，skill详情紧跟所选卡片并支持切换收起", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await pluginFixture(page, "library");
  await page.goto("/");
  const cards = page.locator(".skill-card");
  await expect(cards).toHaveCount(2);
  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(1);
  expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height);

  await cards.nth(0).click();
  const detail = page.locator(".detail-panel");
  await expect(
    detail.getByRole("heading", { name: "rust-async-patterns", exact: true }),
  ).toBeVisible();
  await expectBetween(cards.nth(0), detail, cards.nth(1));
  await detail
    .getByRole("heading", { name: "rust-async-patterns", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await cards.nth(0).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await cards.nth(1).click();
  await expect(
    detail.getByRole("heading", { name: "tauri-security", exact: true }),
  ).toBeVisible();
  await expect(detail).toHaveCount(1);
  expect(
    await detail.evaluate(
      (element) =>
        element.previousElementSibling?.querySelector("strong")?.textContent,
    ),
  ).toBe("tauri-security");
  await detail.getByRole("button", { name: "收起", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(cards.nth(1)).toHaveAttribute("aria-expanded", "false");
});

test("插件窄窗口的项目详情位于卡片之间，切换及再次点击收起", async ({
  page,
}) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await pluginFixture(page, "projects");
  await page.goto("/");
  const cards = page.locator(".project-card");
  await expect(cards).toHaveCount(2);
  await cards.nth(0).click();
  const detail = page.locator(".project-detail");
  await expect(
    detail.getByRole("heading", { name: "Askills 示例", exact: true }),
  ).toBeVisible();
  await expect(cards.nth(0)).toBeEnabled();
  await expectBetween(cards.nth(0), detail, cards.nth(1));
  await detail
    .getByRole("heading", { name: "Askills 示例", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);

  await cards.nth(1).click();
  await expect(
    detail.getByRole("heading", { name: "第二个项目", exact: true }),
  ).toBeVisible();
  expect(
    await detail.evaluate(
      (element) =>
        element.previousElementSibling?.querySelector("strong")?.textContent,
    ),
  ).toBe("第二个项目");
  await cards.nth(0).click();
  await expect(
    detail.getByRole("heading", { name: "Askills 示例", exact: true }),
  ).toBeVisible();
  await expectBetween(cards.nth(0), detail, cards.nth(1));
  await cards.nth(0).click();
  await expect(detail).toHaveCount(0);
});

test("桌面版保留宽屏双列skills及列表旁详情", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installBackendFixture(page, { extraProject: true });
  await page.goto("/");
  const cards = page.locator(".skill-card");
  await expect(cards).toHaveCount(2);
  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(secondBox!.x).toBeGreaterThan(firstBox!.x + firstBox!.width);
  await cards.nth(0).click();
  const detail = page.locator(".library-layout > .detail-panel");
  await expect(detail).toBeVisible();
  expect((await detail.boundingBox())!.x).toBeGreaterThan(
    (await page.locator(".skill-list").boundingBox())!.x,
  );
  await expect(page.locator(".skill-list > .detail-panel")).toHaveCount(0);
  await cards.nth(0).click();
  await expect(detail).toBeVisible();

  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^项目/ })
    .click();
  await page.locator(".project-card").first().click();
  await expect(
    page.locator(".projects-layout > .project-detail"),
  ).toBeVisible();
  await expect(page.locator(".project-list > .project-detail")).toHaveCount(0);
  await expect(
    page
      .locator(".project-detail")
      .getByRole("button", { name: "收起", exact: true }),
  ).toHaveCount(0);
});

for (const initialPage of ["library", "projects"] as const) {
  for (const dark of [false, true]) {
    const theme = dark ? "dark" : "light";
    test(`775×540插件${initialPage}展开：${theme}模拟宿主背景`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 775, height: 540 });
      await pluginFixture(page, initialPage, dark);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-host", "ztools");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const cards = page.locator(
        initialPage === "library" ? ".skill-card" : ".project-card",
      );
      const detail = page.locator(
        initialPage === "library" ? ".detail-panel" : ".project-detail",
      );
      await expect(cards).toHaveCount(2);
      await cards.first().click();
      await expect(detail).toBeVisible();
      await expect(cards.first()).toBeEnabled();
      await expectBetween(cards.first(), detail, cards.nth(1));

      // This gradient only simulates ZTools' backdrop for browser visual QA.
      // The product still uses a transparent canvas supplied by the real host.
      await page.evaluate(async (dark) => {
        await document.fonts.ready;
        document.documentElement.style.background = dark
          ? "radial-gradient(ellipse at 10% 20%, #42394f, transparent 70%), radial-gradient(ellipse at 85% 65%, #483742, transparent 65%), linear-gradient(135deg, #252d39, #302e3d)"
          : "radial-gradient(ellipse at 10% 20%, #e1d4ee, transparent 70%), radial-gradient(ellipse at 85% 65%, #f3dce7, transparent 65%), linear-gradient(135deg, #e2eaf1, #eee6f1)";
        document.documentElement.style.backgroundAttachment = "fixed";
      }, dark);
      await page.mouse.move(0, 0);

      expect(
        await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth,
        })),
      ).toEqual({ document: 775, body: 775, viewport: 775 });
      const backgroundAlpha = await detail.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      });
      expect(backgroundAlpha).toBeGreaterThan(0);
      expect(backgroundAlpha).toBeLessThan(1);
      // Check the complete ancestor chain: a transparent parent must not fade text.
      for (const text of [
        cards.first().locator("strong"),
        detail.locator("h2").first(),
      ]) {
        expect(
          await text.evaluate((element) => {
            let opacity = 1;
            for (
              let node: Element | null = element;
              node;
              node = node.parentElement
            )
              opacity *= Number(getComputedStyle(node).opacity);
            return opacity;
          }),
        ).toBe(1);
      }
      const screenshotDir = resolve(".askills/ztools-layout-visual");
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({
        path: resolve(
          screenshotDir,
          `${initialPage}-${theme}-simulated-host.png`,
        ),
      });
    });
  }
}
