import { describe, expect, it } from "vitest";

import {
  buildPanelWindowOptions,
  buildShelfWindowOptions,
  PanelWindowManager,
  resolveShelfPlacement,
  ShelfWindowManager,
  type BrowserWindowHandle,
  type ShelfWindowHost,
} from "../preload/window";

const primaryDisplay = {
  id: "primary",
  workArea: { x: 0, y: 24, width: 1440, height: 876 },
};

describe("ZTools shelf window geometry", () => {
  it("builds a frameless bottom shelf against the visible work area", () => {
    expect(buildShelfWindowOptions(primaryDisplay, "bottom")).toMatchObject({
      x: 0,
      y: 620,
      width: 1440,
      height: 280,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      webPreferences: { preload: "preload.js" },
    });
  });

  it("centers independent settings panels in the visible work area", () => {
    expect(buildPanelWindowOptions(primaryDisplay, "privacy")).toMatchObject({
      x: 370,
      y: 132,
      width: 700,
      height: 660,
      transparent: false,
      backgroundColor: "#F7F7FB",
      frame: false,
      hasShadow: true,
      alwaysOnTop: true,
      webPreferences: { preload: "preload.js" },
    });
  });

  it("builds a full-width top shelf against the visible work area", () => {
    expect(buildShelfWindowOptions(primaryDisplay, "top")).toMatchObject({
      x: 0,
      y: 24,
      width: 1440,
      height: 280,
    });
  });

  it("places side shelves on negative-coordinate displays", () => {
    const secondary = {
      id: "secondary",
      workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
    };

    expect(buildShelfWindowOptions(secondary, "left")).toMatchObject({
      x: -1920,
      y: 0,
      width: 380,
      height: 1080,
    });
    expect(buildShelfWindowOptions(secondary, "right")).toMatchObject({
      x: -380,
      y: 0,
      width: 380,
      height: 1080,
    });
  });

  it("passes an absolute preload path to the shelf window", () => {
    expect(
      buildShelfWindowOptions(
        primaryDisplay,
        "bottom",
        "/plugins/pasteboard-pro/preload.js",
      ),
    ).toMatchObject({
      webPreferences: { preload: "/plugins/pasteboard-pro/preload.js" },
    });
  });

  it("restores a saved display when present and falls back safely when removed", () => {
    const secondary = {
      id: 2,
      workArea: { x: 1440, y: 0, width: 1920, height: 1080 },
    };

    expect(
      resolveShelfPlacement(
        [primaryDisplay, secondary],
        { displayId: 2, edge: "right" },
        "primary",
      ),
    ).toMatchObject({ display: secondary, edge: "right" });
    expect(
      resolveShelfPlacement(
        [primaryDisplay],
        { displayId: 2, edge: "right" },
        "primary",
      ),
    ).toMatchObject({ display: primaryDisplay, edge: "floating" });
  });
});

describe("ZTools shelf lifecycle", () => {
  it("toggles an active shelf closed on the next plugin activation", () => {
    let destroyed = false;
    let created = 0;
    let closed = 0;
    const host: ShelfWindowHost = {
      createBrowserWindow() {
        created += 1;
        destroyed = false;
        return {
          isDestroyed: () => destroyed,
          webContents: { async executeJavaScript() {} },
          show() {},
          focus() {},
          setBounds() {},
          close() {
            closed += 1;
            destroyed = true;
          },
          setContentProtection() {},
        };
      },
      hideMainWindow() {},
    };
    const manager = new ShelfWindowManager(host);

    expect(
      manager.toggle(primaryDisplay, {
        edge: "bottom",
        contentProtection: false,
      }),
    ).toBeDefined();
    expect(manager.isOpen()).toBe(true);
    expect(
      manager.toggle(primaryDisplay, {
        edge: "bottom",
        contentProtection: false,
      }),
    ).toBeUndefined();
    expect(manager.isOpen()).toBe(false);
    expect(created).toBe(1);
    expect(closed).toBe(1);
  });

  it("creates one shelf, applies content protection, and repositions it across displays", () => {
    const calls: string[] = [];
    let readyCallback: (() => void) | undefined;
    const windowHandle: BrowserWindowHandle = {
      isDestroyed: () => false,
      webContents: {
        async executeJavaScript(script) {
          calls.push(`script:${script}`);
          readyCallback?.();
        },
      },
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
      close: () => calls.push("close"),
      setBounds: (bounds) =>
        calls.push(`bounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`),
      setContentProtection: (enabled) => calls.push(`protect:${enabled}`),
    };
    const host: ShelfWindowHost = {
      createBrowserWindow(url, options, onReady) {
        calls.push(`create:${url}`);
        expect(options).toMatchObject({ x: 0, y: 620, width: 1440 });
        readyCallback = onReady;
        onReady?.();
        return windowHandle;
      },
      hideMainWindow(restorePreviousWindow) {
        calls.push(`hide:${restorePreviousWindow}`);
      },
    };
    const manager = new ShelfWindowManager(host);

    expect(
      manager.open(primaryDisplay, {
        edge: "bottom",
        contentProtection: true,
      }),
    ).toBe(windowHandle);
    expect(
      manager.open(
        {
          id: "secondary",
          workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
        },
        {
          edge: "bottom",
          contentProtection: true,
        },
      ),
    ).toBe(windowHandle);

    expect(calls[0]).toBe("hide:false");
    expect(calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(calls).toContain("protect:true");
    expect(calls).toContain("bounds:0,620,1440,280");
    expect(calls).toContain("bounds:-1920,800,1920,280");
    expect(calls).toContain("script:window.location.reload()");
    expect(calls).toContain("hide:false");
    expect(calls.slice(-2)).toEqual(["show", "focus"]);
    manager.setContentProtection(false);
    expect(calls.at(-1)).toBe("protect:false");
  });

  it("recreates a destroyed shelf and can close the active handle", () => {
    let destroyed = false;
    let created = 0;
    let closed = 0;
    const host: ShelfWindowHost = {
      createBrowserWindow() {
        created += 1;
        destroyed = false;
        return {
          isDestroyed: () => destroyed,
          webContents: { async executeJavaScript() {} },
          show() {},
          focus() {},
          setBounds() {},
          close() {
            closed += 1;
            destroyed = true;
          },
          setContentProtection() {},
        };
      },
      hideMainWindow() {},
    };
    const manager = new ShelfWindowManager(host);

    manager.open(primaryDisplay, { edge: "floating", contentProtection: false });
    destroyed = true;
    manager.open(primaryDisplay, { edge: "floating", contentProtection: false });
    manager.close();

    expect(created).toBe(2);
    expect(closed).toBe(1);
  });
});

describe("ZTools settings panel lifecycle", () => {
  it("centers, reloads, reuses, and replaces independent panels", () => {
    const calls: string[] = [];
    let activeReady: (() => void) | undefined;
    const handles: BrowserWindowHandle[] = [];
    const host: ShelfWindowHost = {
      createBrowserWindow(url, options, onReady) {
        calls.push(`create:${url}`);
        expect(options).toMatchObject({ x: 370, y: 132, width: 700, height: 660 });
        let destroyed = false;
        activeReady = onReady;
        const handle: BrowserWindowHandle = {
          isDestroyed: () => destroyed,
          webContents: {
            async executeJavaScript(script) {
              calls.push(`script:${script}`);
              activeReady?.();
            },
          },
          show: () => calls.push("show"),
          focus: () => calls.push("focus"),
          setBounds: (bounds) =>
            calls.push(`bounds:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`),
          close() {
            calls.push("close");
            destroyed = true;
          },
          setContentProtection() {},
        };
        handles.push(handle);
        onReady?.();
        return handle;
      },
      hideMainWindow() {},
    };
    const manager = new PanelWindowManager(host);

    expect(manager.open(primaryDisplay, { panel: "privacy" })).toBe(handles[0]);
    expect(manager.open(primaryDisplay, { panel: "privacy" })).toBe(handles[0]);
    expect(manager.open(primaryDisplay, { panel: "sync" })).toBe(handles[1]);

    expect(calls.filter((call) => call.startsWith("create:"))).toEqual([
      "create:index.html?panel=privacy&display=primary",
      "create:index.html?panel=sync&display=primary",
    ]);
    expect(calls).toContain("script:window.location.reload()");
    expect(calls).toContain("close");
  });
});
