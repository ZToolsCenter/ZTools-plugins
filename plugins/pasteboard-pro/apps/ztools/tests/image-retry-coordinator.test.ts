import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZToolsHistoryCoordinator, type HistoryCoordinatorEnvironment } from "../preload/ztools-history-coordinator";
import { mirrorHostHistory } from "../preload/clipboard-store";
import { clearClipboardHistory } from "../preload/clear-history";
import { MirroredImagePersistenceError } from "../preload/mirrored-image";
import { defaultPrivacySettings } from "../preload/privacy";
import { PanelWindowManager, type BrowserWindowHandle } from "../preload/window";
import { createZToolsPreloadBridge } from "../preload/ztools-preload-bridge";

vi.mock("../preload/clipboard-store", () => ({ mirrorHostHistory: vi.fn() }));
vi.mock("../preload/clear-history", () => ({ clearClipboardHistory: vi.fn(async () => ({ deleted: 0, failed: 0, blobFailures: 0 })) }));
vi.mock("../preload/auto-start", () => ({ ensureZToolsAutoStart: vi.fn(async () => undefined) }));
vi.mock("../preload/retention", () => ({ executeRetentionPrune: vi.fn(async () => ({})) }));
vi.mock("../preload/sync-controller", () => ({ runConfiguredVaultSync: vi.fn(async () => ({ enabled: false, status: {} })) }));

const flush = async () => { for (let step = 0; step < 20; step += 1) await Promise.resolve(); };
const imageError = new MirroredImagePersistenceError("image-read-failed");
const result = { imported: 0, skipped: 0, pages: 1 };

function environment(primary = true, panelWindows: unknown = { notifyHistoryChanged: vi.fn() }) {
  const events = new EventTarget();
  const changes: Array<() => void> = [];
  const enter: Array<(value: unknown) => void> = [];
  const ipc = new Map<string, (...args: unknown[]) => void>();
  let privacy = structuredClone(defaultPrivacySettings);
  const privacyGet = vi.fn(async () => structuredClone(privacy));
  const summary = vi.fn(async () => ({ pending: 0, failed: 1, total: 1, capacity: 4096 }));
  const services = {
    database: {}, store: { imageRetries: { readSummary: summary } },
    privacyStore: { get: privacyGet }, isPrimaryWindow: primary, isShelfWindow: !primary,
    syncStore: { getSettings: vi.fn(async () => ({ enabled: false, status: {} })) },
    thumbnailService: { invalidateRecordIndex: vi.fn() },
    historySearch: { invalidate: vi.fn() },
    shelfWindows: { notifyHistoryChanged: vi.fn(), toggle: vi.fn() },
    panelWindows, syncRepository: {}, dataPaths: { blobRoot: "/owned/synthetic" },
    windowPreferencesStore: { get: vi.fn(async () => ({ uiVersion: "refined", dockEdge: "bottom" })) },
  };
  const window = {
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  };
  const ztools = {
    getNativeId: () => "image-retry-coordinator-fixture", clipboard: { onChange: (callback: () => void) => changes.push(callback), getHistory: async () => ({ items: [], total: 0 }) },
    onPluginEnter: (callback: (value: unknown) => void) => enter.push(callback), registerTool: vi.fn(),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, bounds: {}, workArea: {} }),
    hideMainWindow: vi.fn(), outPlugin: vi.fn(),
  };
  const input = { ztools, clipboard: { clear: vi.fn() },
    ipcRenderer: { on: (name: string, callback: (...args: unknown[]) => void) => ipc.set(name, callback) },
    window, role: primary ? "primary" : "shelf", services,
  } as unknown as HistoryCoordinatorEnvironment;
  return { coordinator: createZToolsHistoryCoordinator(input), events, changes, enter, ipc, privacyGet, summary,
    services,
    setPaused: (paused: boolean) => { privacy = { ...privacy, pause: { paused } }; } };
}

describe("production coordinator image retry ownership", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(mirrorHostHistory).mockRejectedValue(imageError); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("primary startup resumes durable failures and every retry reads current privacy", async () => {
    const f = environment();
    const decisions: boolean[] = [];
    vi.mocked(mirrorHostHistory).mockImplementation(async (_host, _store, options) => {
      decisions.push(await options.shouldPersist!({ bundleId: "example.public" }, null));
      throw imageError;
    });
    f.coordinator.install(); await flush();
    expect(decisions).toEqual([true]);
    f.setPaused(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(decisions).toEqual([true, false]);
    expect(f.privacyGet).toHaveBeenCalledTimes(2);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("automatic retries stop after the finite session and manual requests restart it", async () => {
    const f = environment(); f.coordinator.install(); await flush();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(6);
    f.coordinator.requestHistoryMirror(); await flush();
    expect(mirrorHostHistory).toHaveBeenCalledTimes(7);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("clear cancels a pending timer and its completion never recreates a session", async () => {
    const f = environment(); f.coordinator.install(); await flush();
    await f.coordinator.clearClipboardHistory();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(1);
    expect(clearClipboardHistory).toHaveBeenCalledTimes(1);
  });

  it("clear also fences an already queued mirror before it reaches privacy or host reads", async () => {
    const f = environment();
    const queued = f.coordinator.scheduleHistoryMirror();
    const cleared = f.coordinator.clearClipboardHistory();
    await expect(queued).rejects.toThrow("cancelled");
    await cleared;
    expect(f.privacyGet).not.toHaveBeenCalled();
    expect(mirrorHostHistory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).not.toHaveBeenCalled();
  });

  it("clear during privacy await prevents a late mirror from beginning payload work", async () => {
    const f = environment();
    let resolve!: (value: typeof defaultPrivacySettings) => void;
    f.privacyGet.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const request = f.coordinator.scheduleHistoryMirror(); await flush();
    const cleared = f.coordinator.clearClipboardHistory();
    resolve(structuredClone(defaultPrivacySettings));
    await expect(request).rejects.toThrow("cancelled"); await cleared;
    expect(mirrorHostHistory).not.toHaveBeenCalled();
  });

  it("beforeunload cancels retries and rejects future primary requests", async () => {
    const f = environment(); f.coordinator.install(); await flush();
    f.events.dispatchEvent(new Event("beforeunload"));
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(f.coordinator.scheduleHistoryMirror()).rejects.toThrow("unavailable");
    expect(mirrorHostHistory).toHaveBeenCalledTimes(1);
  });

  it("database failure stops automatic retries instead of becoming an empty summary", async () => {
    const f = environment(); const error = new Error("Storage operation failed");
    f.summary.mockRejectedValue(error);
    f.coordinator.install(); await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(1);
    expect(f.summary).toHaveBeenCalledTimes(1);
  });

  it("auxiliary windows never register a history owner or execute the scheduler", async () => {
    const f = environment(false); f.coordinator.install(); await flush();
    expect(f.enter).toHaveLength(0);
    expect(f.ipc.has("pasteboard-pro:request-history-mirror")).toBe(false);
    await expect(f.coordinator.scheduleHistoryMirror()).rejects.toThrow("primary owner");
    f.changes[0]!(); await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).not.toHaveBeenCalled();
    expect(f.privacyGet).not.toHaveBeenCalled();
  });

  it("primary mirror failures and clear notify the actual independent panel manager", async () => {
    const scripts: string[] = [];
    const handle = { isDestroyed: () => false,
      webContents: { executeJavaScript: vi.fn(async (script: string) => { scripts.push(script); }) },
      show() {}, focus() {}, setBounds() {}, close() {}, setContentProtection() {},
    } satisfies BrowserWindowHandle;
    const panel = new PanelWindowManager({ createBrowserWindow: () => handle, hideMainWindow() {} });
    panel.open({ id: "fixture", workArea: { x: 0, y: 0, width: 1200, height: 800 } }, { panel: "privacy" });
    const f = environment(true, panel); f.coordinator.install(); await flush();
    const changed = "window.dispatchEvent(new CustomEvent('pasteboard-pro:history-changed'))";
    expect(scripts.filter((script) => script === changed)).toHaveLength(1);
    await f.coordinator.clearClipboardHistory();
    expect(scripts.filter((script) => script === changed).length).toBeGreaterThanOrEqual(2);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("auxiliary screenshot reaches primary fast polling until delayed history is visible", async () => {
    const f = environment();
    f.summary.mockResolvedValue({ pending: 0, failed: 0, total: 0, capacity: 4096 });
    let historyVisible = false;
    vi.mocked(mirrorHostHistory).mockImplementation(async () => ({ ...result, imported: historyVisible ? 1 : 0 }));
    f.coordinator.install(); await flush();
    const sendToParent = vi.fn((channel: string, ...args: unknown[]) => f.ipc.get(channel)!(undefined, ...args));
    const writeImage = vi.fn();
    const auxiliary = createZToolsPreloadBridge({
      ztools: { sendToParent, screenCapture: (callback: (image: unknown) => void) => callback({ isEmpty: () => false }) },
      clipboard: { writeImage }, nativeImage: {}, platformCapabilities: {}, hostCompatibility: {},
      services: { isPrimaryWindow: false, privacyStore: { get: async () => structuredClone(defaultPrivacySettings) } }, coordinator: {},
    } as never);
    setTimeout(() => { historyVisible = true; }, 200);
    await auxiliary.captureScreenshot(); await flush();
    expect(sendToParent).toHaveBeenCalledExactlyOnceWith("pasteboard-pro:request-history-mirror");
    expect(writeImage).toHaveBeenCalledTimes(1);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(3);
    await expect(vi.mocked(mirrorHostHistory).mock.results.at(-1)?.value).resolves.toMatchObject({ imported: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(3);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("only the strict image-retry purpose requests a normal session", async () => {
    const f = environment();
    f.summary.mockResolvedValue({ pending: 0, failed: 0, total: 0, capacity: 4096 });
    vi.mocked(mirrorHostHistory).mockResolvedValue(result);
    f.coordinator.install(); await flush();
    const receive = f.ipc.get("pasteboard-pro:request-history-mirror")!;
    receive(undefined, "unknown"); receive(undefined, { purpose: "image-retry" });
    receive(undefined, "image-retry", "extra"); await flush();
    expect(mirrorHostHistory).toHaveBeenCalledTimes(1);
    receive(undefined, "image-retry"); await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(2);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("failed clear refreshes the actual panel after the journal cleared but boundary reset failed", async () => {
    const scripts: string[] = [];
    const handle = { isDestroyed: () => false,
      webContents: { executeJavaScript: vi.fn(async (script: string) => { scripts.push(script); }) },
      show() {}, focus() {}, setBounds() {}, close() {}, setContentProtection() {},
    } satisfies BrowserWindowHandle;
    const panel = new PanelWindowManager({ createBrowserWindow: () => handle, hideMainWindow() {} });
    panel.open({ id: "fixture", workArea: { x: 0, y: 0, width: 1200, height: 800 } }, { panel: "privacy" });
    const f = environment(true, panel); f.coordinator.install(); await flush();
    const failure = new Error("Storage operation failed");
    Object.assign(f.services.store.imageRetries, {
      readClearBoundary: async () => undefined,
      clear: async () => { f.summary.mockResolvedValue({ pending: 0, failed: 0, total: 0, capacity: 4096 }); },
    });
    Object.assign(f.services.store, { setImageRetryBoundary: async () => { throw failure; } });
    const actual = await vi.importActual<typeof import("../preload/clear-history")>("../preload/clear-history");
    vi.mocked(clearClipboardHistory).mockImplementationOnce(actual.clearClipboardHistory);
    await expect(f.coordinator.clearClipboardHistory()).rejects.toBe(failure);
    expect(await f.summary()).toMatchObject({ total: 0 });
    const changed = "window.dispatchEvent(new CustomEvent('pasteboard-pro:history-changed'))";
    expect(scripts.filter((script) => script === changed)).toHaveLength(2);
    f.events.dispatchEvent(new Event("beforeunload"));
  });

  it("screenshot fast polling shares the clear fence", async () => {
    const f = environment();
    f.summary.mockResolvedValue({ pending: 0, failed: 0, total: 0, capacity: 4096 });
    vi.mocked(mirrorHostHistory).mockResolvedValue(result);
    f.coordinator.triggerFastHistoryMirror(); await flush();
    await f.coordinator.clearClipboardHistory();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mirrorHostHistory).toHaveBeenCalledTimes(1);
  });
});
