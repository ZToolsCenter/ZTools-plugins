import { expect, test } from "playwright/test";

async function openCleanQuickNote(page: import("playwright/test").Page) {
  await page.goto("/quicknote.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("radio", { name: "便签 1，空白" })).toBeChecked();
}

test.describe("quick-note draft safety", () => {
  test("keeps a fixed titlebar without handle and leaves editor below it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 408, height: 759 });
    await openCleanQuickNote(page);

    const layout = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".quicknote-root");
      const topbar = document.querySelector<HTMLElement>(".quicknote-titlebar");
      const zone = document.querySelector<HTMLElement>(
        ".quicknote-titlebar-reveal-zone",
      );
      const switcher = document.querySelector<HTMLElement>(
        ".quicknote-slot-switcher",
      );
      const editor = document.querySelector<HTMLElement>(
        ".page-scroll-container",
      );
      const handle = document.querySelector<HTMLElement>(
        ".quicknote-titlebar-handle",
      );
      const trigger = document.querySelector<HTMLElement>(
        ".quicknote-titlebar-trigger",
      );
      if (!root || !topbar || !zone || !switcher || !editor) {
        return null;
      }

      const rootRect = root.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      const zoneRect = zone.getBoundingClientRect();
      const switcherRect = switcher.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();

      return {
        topbarHeight: topbarRect.height,
        zoneHeight: zoneRect.height,
        titlebarOpacity: getComputedStyle(topbar).opacity,
        titlebarPointerEvents: getComputedStyle(topbar).pointerEvents,
        hasHandle: !!handle,
        hasTrigger: !!trigger,
        switcherWidth: switcherRect.width,
        switcherHeight: switcherRect.height,
        switcherCenterDelta:
          switcherRect.left +
          switcherRect.width / 2 -
          (rootRect.left + rootRect.width / 2),
        editorTop: editorRect.top,
        zoneBottom: zoneRect.bottom,
        editorStartsBelowTitlebar: Math.abs(editorRect.top - zoneRect.bottom) < 1,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.topbarHeight).toBe(30);
    expect(layout!.zoneHeight).toBe(30);
    expect(layout!.titlebarOpacity).toBe("1");
    expect(layout!.titlebarPointerEvents).toBe("auto");
    expect(layout!.hasHandle).toBe(false);
    expect(layout!.hasTrigger).toBe(false);
    expect(layout!.switcherWidth).toBe(104);
    expect(layout!.switcherHeight).toBe(22);
    expect(Math.abs(layout!.switcherCenterDelta)).toBeLessThan(1);
    expect(layout!.editorStartsBelowTitlebar).toBe(true);

    const titlebar = page.locator(".quicknote-titlebar");
    const switcherInteractive = page.locator(
      ".quicknote-slot-switcher-interactive",
    );
    const helpTrigger = page.getByRole("button", { name: "使用说明" });

    await expect(titlebar).toBeVisible();
    await expect(helpTrigger).toBeVisible();
    await expect(switcherInteractive).toHaveCSS("pointer-events", "auto");

    const actionLayout = await page
      .locator(".quicknote-titlebar-actions")
      .evaluate((actions) => {
        const info = actions.querySelector<HTMLElement>(
          ".quicknote-help-trigger",
        );
        const close = actions.querySelector<HTMLElement>(
          ".quicknote-close-btn",
        );
        if (!info || !close) return null;
        const infoRect = info.getBoundingClientRect();
        const closeRect = close.getBoundingClientRect();
        return {
          infoRight: infoRect.right,
          closeLeft: closeRect.left,
          gap: closeRect.left - infoRect.right,
          centerDelta:
            infoRect.top +
            infoRect.height / 2 -
            (closeRect.top + closeRect.height / 2),
        };
      });
    expect(actionLayout).not.toBeNull();
    expect(actionLayout!.infoRight).toBeLessThanOrEqual(
      actionLayout!.closeLeft,
    );
    expect(actionLayout!.gap).toBeGreaterThanOrEqual(0);
    expect(actionLayout!.gap).toBeLessThanOrEqual(4);
    expect(Math.abs(actionLayout!.centerDelta)).toBeLessThan(1);

    // 离开标题栏后仍常驻可见
    await page.mouse.move(200, 120);
    await expect(titlebar).toHaveCSS("opacity", "1");
    await expect(helpTrigger).toBeVisible();

    await helpTrigger.click();
    const helpIntro = page.getByText(
      "内容只保留在当前便签，不会自动进入笔记本。",
    );
    await expect(helpIntro).toBeVisible();
    const helpBounds = await page
      .locator(".quicknote-help-popover")
      .evaluate((popover) => {
        const rect = popover.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
    expect(helpBounds.left).toBeGreaterThanOrEqual(8);
    expect(helpBounds.right).toBeLessThanOrEqual(400);
    await page.keyboard.press("Escape");
    await expect(helpIntro).toBeHidden();
    await page.getByRole("textbox").first().focus();
    await expect(titlebar).toHaveCSS("opacity", "1");

    await page.keyboard.press("Control+2");
    await expect(
      page.getByRole("radio", { name: "便签 2，空白" }),
    ).toBeChecked();
    await expect(
      page.locator("[data-sonner-toast].quicknote-slot-switch-toast"),
    ).toHaveCount(0);
    await expect(titlebar).toHaveCSS("opacity", "1");
    await expect(helpTrigger).toBeVisible();

    const activeBackground = await page
      .getByRole("radio", { name: "便签 2，空白" })
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(activeBackground).toBe("rgb(255, 255, 255)");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotion = await page
      .locator(".quicknote-slot-name-text")
      .evaluate((element) => ({
        animationName: getComputedStyle(element).animationName,
        transitionDuration: getComputedStyle(
          document.querySelector(".quicknote-slot-switcher")!,
        ).transitionDuration,
      }));
    expect(reducedMotion.animationName).toBe("none");
    expect(reducedMotion.transitionDuration).toBe("0s");
  });

  test("fills the remaining viewport without a focus outline", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.focus();

    const layout = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".quicknote-root");
      const container = document.querySelector<HTMLElement>(".bn-container");
      const editable = document.querySelector<HTMLElement>(".bn-editor");
      if (!root || !container || !editable) return null;

      const rootRect = root.getBoundingClientRect();
      const scrollContainer = root.querySelector<HTMLElement>(
        ".page-scroll-container",
      );
      const containerRect = container.getBoundingClientRect();
      const editorRect = editable.getBoundingClientRect();
      const editorStyle = getComputedStyle(editable);
      return {
        viewportHeight: window.innerHeight,
        rootHeight: rootRect.height,
        scrollClientHeight: scrollContainer?.clientHeight,
        scrollHeight: scrollContainer?.scrollHeight,
        containerBottom: containerRect.bottom,
        editorBottom: editorRect.bottom,
        outlineStyle: editorStyle.outlineStyle,
      };
    });

    expect(layout).not.toBeNull();
    expect(Math.abs(layout!.rootHeight - layout!.viewportHeight)).toBeLessThan(
      1,
    );
    expect(layout!.scrollHeight).toBe(layout!.scrollClientHeight);
    expect(
      Math.abs(layout!.editorBottom - layout!.containerBottom),
    ).toBeLessThan(1);
    expect(layout!.outlineStyle).toBe("none");
  });


  test("scrolls only after the content exceeds the viewport", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.click();
    for (let index = 0; index < 45; index += 1) {
      await page.keyboard.type(`第 ${index + 1} 行`);
      await page.keyboard.press("Enter");
    }

    const overflow = await page
      .locator(".page-scroll-container")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  });

  test("keeps the fixed titlebar above editor content at minimum zoom", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.focus();
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Control+-");
    }

    const layout = await page.evaluate(() => {
      const titleRow = document.querySelector<HTMLElement>(
        ".quicknote-titlebar-reveal-zone",
      );
      const firstBlock = document.querySelector<HTMLElement>(
        ".quicknote-editor-surface .bn-block-outer",
      );
      const surface = document.querySelector<HTMLElement>(
        ".quicknote-editor-surface",
      );
      if (!titleRow || !firstBlock || !surface) return null;
      return {
        titleBottom: titleRow.getBoundingClientRect().bottom,
        firstBlockTop: firstBlock.getBoundingClientRect().top,
        surfaceTop: surface.getBoundingClientRect().top,
        zoom: getComputedStyle(surface).zoom,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout!.zoom).toBe("0.7");
    // 标题栏占布局，正文 surface 紧贴标题栏下方
    expect(layout!.surfaceTop).toBe(layout!.titleBottom);
    expect(layout!.firstBlockTop).toBeGreaterThanOrEqual(layout!.titleBottom);
  });

  test("scrolls the help content when the window is too short", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 160 });
    await openCleanQuickNote(page);

    await page.getByRole("button", { name: "使用说明" }).click();

    const overflow = await page
      .locator(".quicknote-help-list")
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.overflowY).toBe("auto");
  });

  test("renames the active slot from its title and the help menu", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    await page.getByRole("button", { name: "修改标签名称" }).click();
    const renameInput = page.getByRole("textbox", { name: "重命名便签 1" });
    await expect(renameInput).toBeVisible();
    await expect(page.locator(".quicknote-titlebar")).toBeHidden();
    const renameLayout = await renameInput.evaluate((input) => {
      const inputRect = input.getBoundingClientRect();
      const zoneRect = input.parentElement!.getBoundingClientRect();
      return {
        leftGap: inputRect.left - zoneRect.left,
        rightGap: zoneRect.right - inputRect.right,
        width: inputRect.width,
        availableWidth: zoneRect.width,
      };
    });
    expect(renameLayout.leftGap).toBeCloseTo(6, 0);
    expect(renameLayout.rightGap).toBeCloseTo(6, 0);
    expect(renameLayout.width).toBeCloseTo(renameLayout.availableWidth - 12, 0);
    await renameInput.fill("工作");
    await renameInput.press("Enter");

    await page.locator(".page-scroll-container").hover({
      position: { x: 120, y: 120 },
    });
    const slotName = page.locator(".quicknote-slot-name-display");
    await expect(slotName).toHaveText("工作");
    await expect(slotName).toBeVisible();
    const nameStyle = await slotName.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        animationName: getComputedStyle(
          element.querySelector(".quicknote-slot-name-text")!,
        ).animationName,
      };
    });
    expect(nameStyle.opacity).toBe("1");
    expect(nameStyle.animationName).toBe("quicknote-slot-content-in");

    await page.reload();
    await expect(slotName).toHaveText("工作");

    await page.getByRole("button", { name: "使用说明" }).click();
    await page.getByRole("button", { name: "重命名当前便签" }).click();
    await expect(renameInput).toBeVisible();
    await renameInput.fill("灵感");
    await renameInput.press("Enter");
    await expect(slotName).toHaveText("灵感");
  });

  test("keeps immediate edits across slot changes, undo, popovers, and reload", async ({
    page,
  }) => {
    await openCleanQuickNote(page);

    const editor = page.getByRole("textbox").first();
    await editor.click();
    await editor.pressSequentially("速记切换不会丢失");

    // 不等待编辑器 debounce，立即切换并切回；最新输入必须同步提交。
    await page.keyboard.press("Control+2");
    await expect(
      page.getByRole("radio", { name: "便签 1，有内容" }),
    ).not.toBeChecked();
    await page.keyboard.press("Control+1");
    await expect(editor).toHaveText("速记切换不会丢失");

    // 新输入后立刻走持久化撤销栈，不能被编辑器自身的 debounce 吞掉。
    await editor.pressSequentially("马上撤销");
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveText("速记切换不会丢失");

    await expect(page.locator(".quicknote-titlebar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "使用说明" }),
    ).toBeVisible();

    // Escape 应先关闭帮助弹层，不能同时收起整个速记窗口。
    await page.getByRole("button", { name: "使用说明" }).click();
    await expect(page.getByText("速记便签", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("速记便签", { exact: true })).toBeHidden();
    await expect(editor).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox").first()).toHaveText(
      "速记切换不会丢失",
    );
    await expect(
      page.getByRole("radio", { name: "便签 1，有内容" }),
    ).toBeChecked();
  });
});
