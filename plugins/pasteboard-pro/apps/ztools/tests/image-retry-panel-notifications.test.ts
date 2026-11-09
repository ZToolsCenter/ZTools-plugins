import { describe, expect, it, vi } from "vitest";
import { PanelWindowManager, type BrowserWindowHandle } from "../preload/window";

const display = { id: "fixture", workArea: { x: 0, y: 0, width: 1200, height: 800 } };
const notification = "window.dispatchEvent(new CustomEvent('pasteboard-pro:history-changed'))";

describe("independent panel image retry refresh", () => {
  it("sends a content-free history change and skips destroyed or absent windows", async () => {
    vi.useFakeTimers();
    try {
      let destroyed = false;
      const execute = vi.fn(async (_script: string) => undefined);
      const handle: BrowserWindowHandle = {
        isDestroyed: () => destroyed, webContents: { executeJavaScript: execute },
        show() {}, focus() {}, setBounds() {}, close() {}, setContentProtection() {},
      };
      const manager = new PanelWindowManager({ createBrowserWindow: () => handle, hideMainWindow() {} });
      manager.notifyHistoryChanged(); expect(execute).not.toHaveBeenCalled();
      manager.open(display, { panel: "privacy" });
      manager.notifyHistoryChanged();
      expect(execute).toHaveBeenLastCalledWith(notification);
      execute.mockRejectedValueOnce(new Error("synthetic closed panel"));
      manager.notifyHistoryChanged(); await Promise.resolve();
      destroyed = true; const count = execute.mock.calls.length;
      manager.notifyHistoryChanged(); expect(execute).toHaveBeenCalledTimes(count);
      expect(execute.mock.calls.filter(([script]) => script.includes("history-changed"))).toEqual([[notification], [notification]]);
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
});
