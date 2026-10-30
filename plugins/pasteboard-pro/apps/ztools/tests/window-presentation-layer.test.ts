import { describe, expect, it, vi } from "vitest";

import {
  buildShelfWindowOptions,
  PanelWindowManager,
  ShelfWindowManager,
  type BrowserWindowHandle,
  type ShelfWindowHost,
} from "../preload/window";
import { waitForWindowReadyScript } from "../window-ready";

const primaryDisplay = {
  id: "primary",
  workArea: { x: 0, y: 24, width: 1440, height: 876 },
};

describe("ZTools modern shelf geometry", () => {
  it("pins a modern bottom shelf to physical display bounds and uses 360px height", () => {
    const display = {
      id: "primary",
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 24, width: 1440, height: 800 },
    };

    expect(buildShelfWindowOptions(display, "bottom", "preload.js", "modern"))
      .toMatchObject({ x: 0, y: 540, width: 1440, height: 360 });
  });

  it("falls back to the work area when modern display bounds are unavailable", () => {
    expect(buildShelfWindowOptions(primaryDisplay, "bottom", "preload.js", "modern"))
      .toMatchObject({ x: 0, y: 540, width: 1440, height: 360 });
  });

  it("uses the modern height for a top horizontal shelf", () => {
    expect(buildShelfWindowOptions(primaryDisplay, "top", "preload.js", "modern"))
      .toMatchObject({ x: 0, y: 24, width: 1440, height: 360 });
  });

  it("keeps modern bottom geometry on a negative-coordinate display", () => {
    const display = {
      id: "secondary",
      bounds: { x: -1920, y: -100, width: 1920, height: 1180 },
      workArea: { x: -1920, y: -76, width: 1920, height: 1056 },
    };

    expect(buildShelfWindowOptions(display, "bottom", "preload.js", "modern"))
      .toMatchObject({ x: -1920, y: 720, width: 1920, height: 360 });
  });

  it("clamps modern shelves to small physical display bounds", () => {
    const display = {
      id: "small",
      bounds: { x: -600, y: -200, width: 260, height: 220 },
      workArea: { x: -590, y: -190, width: 250, height: 200 },
    };

    expect(buildShelfWindowOptions(display, "bottom", "preload.js", "modern"))
      .toMatchObject({ x: -600, y: -200, width: 260, height: 220 });
  });

});

describe("ZTools application window layer", () => {
  it("applies the highest layer on creation and each intentional reveal", async () => {
    const calls: string[] = [];
    let onReady: (() => void) | undefined;
    let contentReady!: () => void;
    const ready = new Promise<void>((resolve) => { contentReady = resolve; });
    const handle: BrowserWindowHandle = {
      isDestroyed: () => false,
      webContents: { executeJavaScript: vi.fn(() => ready) },
      setAlwaysOnTop: (enabled, level) => calls.push("layer:" + enabled + ":" + level),
      moveTop: () => calls.push("moveTop"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
      setBounds: () => {},
      close: () => {},
      setContentProtection: () => {},
    };
    const host: ShelfWindowHost = {
      createBrowserWindow(_url, options, callback) {
        expect(options.alwaysOnTop).toBe(true);
        onReady = callback;
        return handle;
      },
      hideMainWindow() {},
    };
    const manager = new ShelfWindowManager(host);

    manager.open(primaryDisplay, { edge: "bottom", contentProtection: false });
    expect(calls).toEqual(["layer:true:screen-saver"]);
    onReady?.();
    await Promise.resolve();
    contentReady();
    await vi.waitFor(() => expect(calls).toContain("show"));

    manager.open(primaryDisplay, { edge: "bottom", contentProtection: false });
    expect(calls.filter((call) =>
      call.startsWith("layer:") || call === "show" ||
      call === "focus" || call === "moveTop"
    )).toEqual([
      "layer:true:screen-saver",
      "layer:true:screen-saver", "show", "focus", "moveTop",
      "layer:true:screen-saver", "show", "focus", "moveTop",
    ]);
  });

  it("falls back safely when a host rejects the screen-saver level", () => {
    const calls: string[] = [];
    const handle: BrowserWindowHandle = {
      isDestroyed: () => false,
      webContents: { async executeJavaScript() {} },
      setAlwaysOnTop: (_enabled, level) => {
        calls.push(String(level ?? "default"));
        if (level === "screen-saver") throw new Error("unsupported level");
      },
      show() {},
      focus() {},
      setBounds() {},
      close() {},
      setContentProtection() {},
    };
    const host: ShelfWindowHost = {
      createBrowserWindow(_url, options) {
        expect(options.alwaysOnTop).toBe(true);
        return handle;
      },
      hideMainWindow() {},
    };

    new ShelfWindowManager(host).open(primaryDisplay, {
      edge: "bottom",
      contentProtection: false,
    });
    expect(calls).toEqual(["screen-saver", "default"]);
  });

  it("lets a ready auxiliary panel move above the shelf at the same top layer", async () => {
    const calls: string[] = [];
    const callbacks: (() => void)[] = [];
    const readyResolvers: (() => void)[] = [];
    const host: ShelfWindowHost = {
      createBrowserWindow(_url, options, onReady) {
        expect(options.alwaysOnTop).toBe(true);
        const index = callbacks.length;
        callbacks.push(onReady ?? (() => {}));
        let resolveReady!: () => void;
        const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
        readyResolvers.push(resolveReady);
        return {
          isDestroyed: () => false,
          webContents: { executeJavaScript: vi.fn(() => ready) },
          setAlwaysOnTop: (_enabled, level) => calls.push("layer:" + index + ":" + level),
          moveTop: () => calls.push("moveTop:" + index),
          show: () => calls.push("show:" + index),
          focus: () => calls.push("focus:" + index),
          setBounds() {},
          close() {},
          setContentProtection() {},
        };
      },
      hideMainWindow() {},
    };
    const shelf = new ShelfWindowManager(host);
    const panels = new PanelWindowManager(host);

    shelf.open(primaryDisplay, { edge: "bottom", contentProtection: false });
    callbacks[0]!();
    await Promise.resolve();
    readyResolvers[0]!();
    await vi.waitFor(() => expect(calls).toContain("show:0"));

    panels.open(primaryDisplay, { panel: "privacy" });
    callbacks[1]!();
    await Promise.resolve();
    readyResolvers[1]!();
    await vi.waitFor(() => expect(calls).toContain("show:1"));

    const panelShowIndex = calls.indexOf("show:1");
    expect(panelShowIndex).toBeGreaterThan(0);
    expect(calls.slice(panelShowIndex - 1, panelShowIndex + 3)).toEqual([
      "layer:1:screen-saver",
      "show:1",
      "focus:1",
      "moveTop:1",
    ]);
  });

  it("retains constructor alwaysOnTop when optional layer APIs are missing", async () => {
    let onReady: (() => void) | undefined;
    let contentReady!: () => void;
    const ready = new Promise<void>((resolve) => { contentReady = resolve; });
    const handle: BrowserWindowHandle = {
      isDestroyed: () => false,
      webContents: { executeJavaScript: vi.fn(() => ready) },
      show: vi.fn(),
      focus: vi.fn(),
      setBounds: vi.fn(),
      close: vi.fn(),
      setContentProtection: vi.fn(),
    };
    const host: ShelfWindowHost = {
      createBrowserWindow(_url, options, callback) {
        expect(options.alwaysOnTop).toBe(true);
        onReady = callback;
        return handle;
      },
      hideMainWindow() {},
    };

    new ShelfWindowManager(host).open(primaryDisplay, {
      edge: "bottom",
      contentProtection: false,
    });
    onReady?.();
    await Promise.resolve();
    contentReady();
    await vi.waitFor(() => expect(handle.show).toHaveBeenCalledTimes(1));
    expect(handle.focus).toHaveBeenCalledTimes(1);
  });
});

describe.each(["shelf", "panel"] as const)("%s first reveal", (kind) => {
  function setup(synchronousCallback = false) {
    const windows: {
      handle: BrowserWindowHandle;
      domReady: () => void;
      contentReady: () => void;
      fail: (error: Error) => void;
    }[] = [];
    const host: ShelfWindowHost = {
      hideMainWindow: vi.fn(),
      createBrowserWindow(_url, options, onReady) {
        expect(options.show).toBe(false);
        let destroyed = false;
        let contentReady!: () => void;
        let fail!: (error: Error) => void;
        const ready = new Promise<void>((resolve, reject) => {
          contentReady = resolve;
          fail = reject;
        });
        const handle: BrowserWindowHandle = {
          isDestroyed: () => destroyed,
          webContents: { executeJavaScript: vi.fn(() => ready) },
          show: vi.fn(), focus: vi.fn(), setBounds: vi.fn(),
          setContentProtection: vi.fn(),
          close: vi.fn(() => { destroyed = true; }),
        };
        windows.push({ handle, domReady: () => onReady?.(), contentReady, fail });
        if (synchronousCallback) onReady?.();
        return handle;
      },
    };
    const shelf = new ShelfWindowManager(host);
    const panel = new PanelWindowManager(host);
    const open = (replace = false) => kind === "shelf"
      ? shelf.open(primaryDisplay, { edge: replace ? "left" : "bottom", contentProtection: true })
      : panel.open(primaryDisplay, { panel: replace ? "sync" : "privacy" });
    return { windows, open, shelf };
  }

  it.each([false, true])("stays hidden through DOM readiness (synchronous callback: %s)", async (sync) => {
    const { windows, open } = setup(sync);
    const handle = open();
    expect(handle.show).not.toHaveBeenCalled();
    windows[0]!.domReady();
    await Promise.resolve();
    expect(handle.webContents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(waitForWindowReadyScript);
    expect(handle.show).not.toHaveBeenCalled();
    // Reopening the same window while loading must not bypass readiness.
    expect(open()).toBe(handle);
    expect(handle.show).not.toHaveBeenCalled();
    windows[0]!.contentReady();
    await vi.waitFor(() => expect(handle.show).toHaveBeenCalledTimes(1));
    expect(handle.focus).toHaveBeenCalledTimes(1);
    windows[0]!.domReady();
    await Promise.resolve();
    expect(handle.show).toHaveBeenCalledTimes(1);
    expect(open()).toBe(handle);
    expect(handle.show).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a closed window, and the next window can open", async () => {
    const { windows, open } = setup();
    const first = open();
    windows[0]!.domReady();
    await Promise.resolve();
    first.close();
    const second = open();
    windows[0]!.contentReady();
    windows[1]!.domReady();
    await Promise.resolve();
    windows[1]!.contentReady();
    await vi.waitFor(() => expect(second.show).toHaveBeenCalledTimes(1));
    expect(first.show).not.toHaveBeenCalled();
    expect(first.focus).not.toHaveBeenCalled();
  });

  it("keeps a replaced window hidden even if its content finishes late", async () => {
    const { windows, open } = setup();
    const first = open();
    windows[0]!.domReady();
    await Promise.resolve();
    const second = open(true);
    windows[0]!.contentReady();
    windows[1]!.domReady();
    await Promise.resolve();
    windows[1]!.contentReady();
    await vi.waitFor(() => expect(second.show).toHaveBeenCalledTimes(1));
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(first.show).not.toHaveBeenCalled();
  });

  it("corrects the native show/focus offset before restoring opacity", async () => {
    const { windows, open } = setup();
    const handle = open();
    const expected = kind === "shelf"
      ? { x: 0, y: 620, width: 1440, height: 280 }
      : { x: 370, y: 132, width: 700, height: 660 };
    let bounds = { ...expected };
    let opacity = 1;
    const order: string[] = [];
    handle.setOpacity = vi.fn(value => {
      opacity = value;
      order.push(`opacity:${value}`);
      if (value === 1) expect(bounds).toEqual(expected);
    });
    handle.getBounds = () => bounds;
    vi.mocked(handle.show).mockImplementation(() => {
      expect(opacity).toBe(0);
      order.push("show");
      bounds = { ...bounds, x: 14 }; // Observed native show() relocation.
    });
    vi.mocked(handle.focus).mockImplementation(() => { order.push("focus"); });
    vi.mocked(handle.setBounds).mockImplementation((next, animate) => {
      expect(opacity).toBe(0);
      expect(animate).toBe(false);
      order.push("bounds");
      bounds = { ...next };
    });
    windows[0]!.domReady();
    await Promise.resolve();
    windows[0]!.contentReady();
    await vi.waitFor(() => expect(handle.setOpacity).toHaveBeenLastCalledWith(1));
    expect(order).toEqual(["opacity:0", "show", "focus", "bounds", "opacity:1"]);
    expect(bounds).toEqual(expected);
  });

  it("closes a failed renderer so a subsequent activation can retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { windows, open } = setup();
      const first = open();
      windows[0]!.domReady();
      await Promise.resolve();
      windows[0]!.fail(new Error("Window destroyed while executing script"));
      await vi.waitFor(() => expect(first.close).toHaveBeenCalledTimes(1));
      expect(first.show).not.toHaveBeenCalled();
      expect(open()).not.toBe(first);
    } finally {
      log.mockRestore();
    }
  });
});
