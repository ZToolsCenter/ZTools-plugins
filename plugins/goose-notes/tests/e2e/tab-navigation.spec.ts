import { expect, test } from "playwright/test";

async function waitForHydration(page: import("playwright/test").Page) {
  await page.waitForFunction(() => {
    const bridge = (window as Window & { __GOOSE_TEST__?: { getPagesState: () => { hydrated: boolean } } })
      .__GOOSE_TEST__;
    return Boolean(bridge?.getPagesState().hydrated);
  });
}

async function seedTwoPages(page: import("playwright/test").Page) {
  await page.evaluate(() => {
    const bridge = (window as Window & {
      __GOOSE_TEST__?: {
        resetTabs: () => void;
        createPage: (parentId?: string, workspaceId?: string) => string;
        getNotebooksState: () => { activeNotebookId: string | null };
        setCloseTabShortcut: (shortcut: string) => void;
      };
    }).__GOOSE_TEST__;
    if (!bridge) throw new Error("Test bridge unavailable");
    bridge.resetTabs();
    bridge.setCloseTabShortcut("Alt+W");
  });

  return page.evaluate(() => {
    const bridge = (window as Window & {
      __GOOSE_TEST__?: {
        createPage: (parentId?: string, workspaceId?: string) => string;
        getNotebooksState: () => { activeNotebookId: string | null };
      };
    }).__GOOSE_TEST__;
    if (!bridge) throw new Error("Test bridge unavailable");
    const notebookId =
      bridge.getNotebooksState().activeNotebookId ?? "default-notebook";
    const a = bridge.createPage(undefined, notebookId);
    const b = bridge.createPage(undefined, notebookId);
    return { a, b };
  });
}

test.describe("VSCode-style tab navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __GOOSE_E2E__?: boolean }).__GOOSE_E2E__ = true;
    });
    await page.goto("/");
    await waitForHydration(page);
  });

  test("pinned tab stays intact when preview-opening another page", async ({
    page,
  }) => {
    const { a, b } = await seedTwoPages(page);

    await page.evaluate(
      ({ pageA, pageB }) => {
        const bridge = (window as Window & {
          __GOOSE_TEST__?: {
            openPermanentTab: (pageId: string, pin?: boolean) => void;
            openPreviewTab: (pageId: string) => void;
          };
        }).__GOOSE_TEST__;
        if (!bridge) throw new Error("Test bridge unavailable");
        bridge.openPermanentTab(pageA, true);
        bridge.openPreviewTab(pageB);
      },
      { pageA: a, pageB: b },
    );

    const tabs = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          getTabsState: () => {
            openTabs: Array<{
              id: string;
              pageId: string;
              pinned?: boolean;
              preview?: boolean;
            }>;
            activeTabId: string | null;
          };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      return bridge.getTabsState();
    });

    expect(tabs.openTabs).toHaveLength(2);
    const pinned = tabs.openTabs.find((tab) => tab.pageId === a);
    const preview = tabs.openTabs.find((tab) => tab.pageId === b);
    expect(pinned?.pinned).toBe(true);
    expect(preview?.preview).toBe(true);
    expect(preview?.id).toBe(tabs.activeTabId);
    expect(pinned?.pageId).toBe(a);
  });

  test("preview slot is reused for subsequent preview opens", async ({
    page,
  }) => {
    const { a, b } = await seedTwoPages(page);
    const c = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          createPage: (parentId?: string, workspaceId?: string) => string;
          getNotebooksState: () => { activeNotebookId: string | null };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      const notebookId =
        bridge.getNotebooksState().activeNotebookId ?? "default-notebook";
      return bridge.createPage(undefined, notebookId);
    });

    await page.evaluate(
      ({ pageA, pageB, pageC }) => {
        const bridge = (window as Window & {
          __GOOSE_TEST__?: {
            openPermanentTab: (pageId: string) => void;
            openPreviewTab: (pageId: string) => void;
          };
        }).__GOOSE_TEST__;
        if (!bridge) throw new Error("Test bridge unavailable");
        bridge.openPermanentTab(pageA);
        bridge.openPreviewTab(pageB);
        bridge.openPreviewTab(pageC);
      },
      { pageA: a, pageB: b, pageC: c },
    );

    const state = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          getTabsState: () => {
            openTabs: Array<{ preview?: boolean; pageId: string }>;
          };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      return bridge.getTabsState();
    });

    expect(state.openTabs).toHaveLength(2);
    expect(state.openTabs.filter((tab) => tab.preview)).toHaveLength(1);
    const preview = state.openTabs.find((tab) => tab.preview);
    expect(preview?.pageId).toBe(c);
  });

  test("sidebar single click opens preview without replacing pinned tab", async ({
    page,
  }) => {
    const { a, b } = await seedTwoPages(page);

    await page.evaluate(
      ({ pageA }) => {
        const bridge = (window as Window & {
          __GOOSE_TEST__?: {
            openPermanentTab: (pageId: string, pin?: boolean) => void;
          };
        }).__GOOSE_TEST__;
        if (!bridge) throw new Error("Test bridge unavailable");
        bridge.openPermanentTab(pageA, true);
      },
      { pageA: a },
    );

    const rowB = page.locator(`[data-rct-item-id="${b}"]`).first();
    await expect(rowB).toBeVisible({ timeout: 15_000 });
    await rowB.click();

    const state = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          getTabsState: () => {
            openTabs: Array<{
              id: string;
              pageId: string;
              pinned?: boolean;
              preview?: boolean;
            }>;
            activeTabId: string | null;
          };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      return bridge.getTabsState();
    });

    const pinned = state.openTabs.find((tab) => tab.pageId === a);
    const preview = state.openTabs.find((tab) => tab.pageId === b);
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.pageId).toBe(a);
    expect(preview?.preview).toBe(true);
    expect(state.activeTabId).toBe(preview?.id);
  });

  test("preview tab shows italic marker in tab bar", async ({ page }) => {
    const { a } = await seedTwoPages(page);

    await page.evaluate(
      ({ pageA }) => {
        const bridge = (window as Window & {
          __GOOSE_TEST__?: {
            openPreviewTab: (pageId: string) => void;
          };
        }).__GOOSE_TEST__;
        if (!bridge) throw new Error("Test bridge unavailable");
        bridge.openPreviewTab(pageA);
      },
      { pageA: a },
    );

    const previewTab = page.locator(
      `[data-tab-page-id="${a}"][data-tab-preview="true"]`,
    );
    await expect(previewTab).toBeVisible();
    await expect(previewTab.locator("span.truncate")).toHaveClass(/italic/);
  });

  test("notebook switch activates and scopes the tab bar to the selected notebook", async ({
    page,
  }) => {
    const ids = await page.evaluate(async () => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          resetTabs: () => void;
          createNotebook: (name?: string, icon?: string) => string;
          createPage: (parentId?: string, workspaceId?: string) => string;
          openPermanentTab: (pageId: string) => void;
          activateNotebook: (notebookId: string) => Promise<string | null>;
          getNotebooksState: () => { activeNotebookId: string | null };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");

      bridge.resetTabs();
      const noteNotebookId =
        bridge.getNotebooksState().activeNotebookId ?? "default-notebook";
      const notePage = bridge.createPage(undefined, noteNotebookId);
      const devNotebookId = bridge.createNotebook("Dev");
      const devPage = bridge.createPage(undefined, devNotebookId);

      bridge.openPermanentTab(notePage);
      bridge.openPermanentTab(devPage);

      await bridge.activateNotebook(noteNotebookId);
      return { noteNotebookId, notePage, devNotebookId, devPage };
    });

    const afterNoteSwitch = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          getTabsState: () => {
            openTabs: Array<{ id: string; pageId: string }>;
            activeTabId: string | null;
          };
          getPagesState: () => { activePageId: string | null };
          getNotebooksState: () => { activeNotebookId: string | null };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      const tabs = bridge.getTabsState();
      const activeTab = tabs.openTabs.find(
        (tab) => tab.id === tabs.activeTabId,
      );
      return {
        activeNotebookId: bridge.getNotebooksState().activeNotebookId,
        activePageId: bridge.getPagesState().activePageId,
        activeTabPageId: activeTab?.pageId ?? null,
      };
    });

    expect(afterNoteSwitch.activeNotebookId).toBe(ids.noteNotebookId);
    expect(afterNoteSwitch.activePageId).toBe(ids.notePage);
    expect(afterNoteSwitch.activeTabPageId).toBe(ids.notePage);

    await page.evaluate(async (devNotebookId) => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          activateNotebook: (notebookId: string) => Promise<string | null>;
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      await bridge.activateNotebook(devNotebookId);
    }, ids.devNotebookId);

    const devTab = page.locator(`[data-tab-page-id="${ids.devPage}"]`);
    await expect(devTab).toBeVisible();
    await expect(devTab).toHaveAttribute("data-tab-active", "true");
    await expect(page.locator(`[data-tab-page-id="${ids.notePage}"]`)).toHaveCount(0);
  });

  test("configured close-tab shortcut works while editor content is focused", async ({
    page,
  }) => {
    const { a, b } = await seedTwoPages(page);

    await page.evaluate(
      ({ pageA, pageB }) => {
        const bridge = (window as Window & {
          __GOOSE_TEST__?: {
            openPermanentTab: (pageId: string) => void;
            setCloseTabShortcut: (shortcut: string) => void;
          };
        }).__GOOSE_TEST__;
        if (!bridge) throw new Error("Test bridge unavailable");
        bridge.setCloseTabShortcut("Ctrl+W");
        bridge.openPermanentTab(pageA);
        bridge.openPermanentTab(pageB);
      },
      { pageA: a, pageB: b },
    );

    await page.evaluate(() => {
      const editorTarget = document.createElement("div");
      editorTarget.className = "bn-editor";
      editorTarget.contentEditable = "true";
      editorTarget.tabIndex = 0;
      document.body.appendChild(editorTarget);
      editorTarget.focus();
      editorTarget.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          code: "KeyW",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const state = await page.evaluate(() => {
      const bridge = (window as Window & {
        __GOOSE_TEST__?: {
          getTabsState: () => {
            openTabs: Array<{ pageId: string }>;
            activeTabId: string | null;
          };
        };
      }).__GOOSE_TEST__;
      if (!bridge) throw new Error("Test bridge unavailable");
      return bridge.getTabsState();
    });

    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0].pageId).toBe(a);
  });

  test("global search shortcut works repeatedly while editor content is focused", async ({
    page,
  }) => {
    const openCount = await page.evaluate(() => {
      let count = 0;
      window.addEventListener("goose-note:open-search", () => {
        count += 1;
      });

      const editorTarget = document.createElement("div");
      editorTarget.className = "bn-editor";
      editorTarget.contentEditable = "true";
      editorTarget.tabIndex = 0;
      document.body.appendChild(editorTarget);
      editorTarget.focus();

      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const pressSearchShortcut = () => {
        editorTarget.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            code: "KeyK",
            ctrlKey: !isMac,
            metaKey: isMac,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      pressSearchShortcut();
      pressSearchShortcut();
      return count;
    });

    expect(openCount).toBe(2);
  });
});
