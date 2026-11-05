import { expect, test, type Page } from "@playwright/test";
import type { HostPage } from "../../src/lib/host";
import { installBackendFixture, invocations } from "./fixtures";

declare global {
  interface Window {
    __ZTOOLS_TEST__: {
      enter(page: HostPage): void;
      out(): void;
      theme(dark: boolean): void;
      holdNextResponse(command: string): void;
      responseHeld(): boolean;
      releaseResponse(): void;
    };
  }
}

async function installPluginFixture(page: Page, initialPage: HostPage) {
  await installBackendFixture(page);
  await page.addInitScript((initialPage) => {
    // Use the existing backend fixture through the plugin transport only.
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.isTauri = false;
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    let active = true;
    let generation = 1;
    let currentPage = initialPage;
    let dark = false;
    const enter = new Set<(page: HostPage) => void>();
    const out = new Set<() => void>();
    const theme = new Set<() => void>();
    const pending = new Set<(reason: Error) => void>();
    let heldCommand = "";
    let heldGate: Promise<void> | undefined;
    let releaseHeld = () => {};
    let responseHeld = false;
    const inactive = () =>
      Object.assign(new Error("HostInactive"), { code: "HostInactive" });
    const invalidate = () => {
      generation++;
      for (const reject of pending) reject(inactive());
      pending.clear();
    };
    async function invokeVisit<T>(
      expected: number,
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> {
      if (!active || generation !== expected) throw inactive();
      const held = command === heldCommand ? heldGate : undefined;
      if (held) heldCommand = "";
      let rejectExit: (error: Error) => void = () => {};
      const exited = new Promise<never>((_resolve, reject) => {
        rejectExit = reject;
        pending.add(reject);
      });
      try {
        const result = await Promise.race([
          invoke(command, args ?? {}).then(async (value) => {
            if (held) {
              responseHeld = true;
              await held;
            }
            return value;
          }),
          exited,
        ]);
        if (!active || generation !== expected) throw inactive();
        return result as T;
      } finally {
        pending.delete(rejectExit);
      }
    }
    window.askillsHost = {
      kind: "ztools",
      invoke: (command, args) => invokeVisit(generation, command, args),
      bindInvoke: () => {
        const expected = generation;
        return (command, args) => invokeVisit(expected, command, args);
      },
      onEnter: (callback) => {
        enter.add(callback);
        queueMicrotask(() => {
          if (active && enter.has(callback)) callback(currentPage);
        });
        return () => {
          enter.delete(callback);
        };
      },
      onOut: (callback) => {
        out.add(callback);
        return () => {
          out.delete(callback);
        };
      },
      isDark: () => dark,
      onThemeChange: (callback) => {
        theme.add(callback);
        return () => {
          theme.delete(callback);
        };
      },
    };
    window.__ZTOOLS_TEST__ = {
      enter: (page) => {
        invalidate();
        active = true;
        currentPage = page;
        enter.forEach((callback) => callback(page));
      },
      out: () => {
        active = false;
        invalidate();
        out.forEach((callback) => callback());
      },
      theme: (value) => {
        dark = value;
        theme.forEach((callback) => callback());
      },
      holdNextResponse: (command) => {
        heldCommand = command;
        responseHeld = false;
        heldGate = new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
      },
      responseHeld: () => responseHeld,
      releaseResponse: () => releaseHeld(),
    };
  }, initialPage);
}

test("插件通过自身桥接启用本地功能并打开指定页面", async ({ page }) => {
  await installPluginFixture(page, "projects");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /^项目/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("当前为浏览器预览。运行")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "skills 库", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "导入本地 skill" }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "GitHub 仓库" }).click();
  expect(await invocations(page, "open_repository")).toHaveLength(1);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__)).toBeUndefined();
});

test("退出重入会清除旧预览并重新读取数据", async ({ page }) => {
  await installPluginFixture(page, "library");
  await page.goto("/");
  await page.getByRole("button", { name: "导入本地 skill" }).click();
  await expect(
    page.getByRole("dialog", { name: "确认导入 skill" }),
  ).toBeVisible();
  await page.evaluate(() => window.__ZTOOLS_TEST__.out());
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.evaluate(() => window.__ZTOOLS_TEST__.enter("sources"));
  await expect(
    page.getByRole("heading", { name: "来源", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await invocations(page, "get_snapshot")).length)
    .toBe(2);
  expect(await invocations(page, "finish_import")).toHaveLength(0);
});

test("跟随系统使用ZTools主题，手动外观选择优先", async ({ page }) => {
  await installPluginFixture(page, "settings");
  await page.goto("/");
  await expect(page.getByLabel("外观模式", { exact: true })).toBeEnabled();
  await page.evaluate(() => window.__ZTOOLS_TEST__.theme(true));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("外观模式", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => window.__ZTOOLS_TEST__.theme(true));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("快速退出重入后旧登记任务的错误刷新不会调用新会话", async ({ page }) => {
  await installPluginFixture(page, "projects");
  await page.goto("/");
  await page.getByRole("button", { name: "扫描目录" }).click();
  const dialog = page.getByRole("dialog", { name: "选择要登记的项目" });
  await dialog.getByRole("checkbox", { name: /Alpha 项目/ }).check();
  await dialog.getByRole("checkbox", { name: /Beta 项目/ }).check();
  await page.evaluate(() =>
    window.__ZTOOLS_TEST__.holdNextResponse("register_project"),
  );
  await dialog.getByRole("button", { name: "登记项目", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ZTOOLS_TEST__.responseHeld()))
    .toBe(true);
  // Reject the old await and enter again in the same task, before React can
  // clean up the old view. Its catch attempts reload using its captured call.
  await page.evaluate(() => {
    window.__ZTOOLS_TEST__.out();
    window.__ZTOOLS_TEST__.enter("projects");
    window.__ZTOOLS_TEST__.releaseResponse();
  });
  await expect(page.getByRole("button", { name: "扫描目录" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await invocations(page, "get_snapshot")).toHaveLength(2);
  expect(await invocations(page, "register_project")).toHaveLength(1);
  await expect(page.getByText("模拟后端拒绝并发 IPC 操作")).toHaveCount(0);
});
