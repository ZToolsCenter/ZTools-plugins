import { describe, expect, it, vi } from "vitest";
import { createZToolsPreloadBridge } from "../preload/ztools-preload-bridge";

function fixture(primary: boolean, parent = true) {
  const readSummary = vi.fn(async () => ({ pending: 2, failed: 1, total: 3, capacity: 4096,
    sourcePath: "/private/synthetic-sentinel.png", identity: "synthetic-identity-sentinel" }));
  const requestHistoryMirror = vi.fn();
  const sendToParent = vi.fn();
  const bridge = createZToolsPreloadBridge({
    ztools: parent ? { sendToParent } : {}, clipboard: {}, nativeImage: {},
    platformCapabilities: {}, hostCompatibility: {},
    services: { isPrimaryWindow: primary, store: { imageRetries: { readSummary } } },
    coordinator: { requestHistoryMirror },
  } as never);
  return { bridge, readSummary, requestHistoryMirror, sendToParent };
}

describe("safe image retry bridge", () => {
  it("exposes only four counts and does not treat a read failure as zero", async () => {
    const f = fixture(true);
    expect(await f.bridge.getImageRetryStatus()).toEqual({ pending: 2, failed: 1, total: 3, capacity: 4096 });
    const failure = new Error("Storage operation failed");
    f.readSummary.mockRejectedValueOnce(failure);
    await expect(f.bridge.getImageRetryStatus()).rejects.toBe(failure);
  });

  it("primary requests the coordinator and returns no completion acknowledgement", () => {
    const f = fixture(true);
    expect(f.bridge.requestImageRetry()).toBeUndefined();
    expect(f.requestHistoryMirror).toHaveBeenCalledTimes(1);
    expect(f.sendToParent).not.toHaveBeenCalled();
  });

  it("auxiliary request forwards only to the existing primary channel", () => {
    const f = fixture(false);
    expect(f.bridge.requestImageRetry()).toBeUndefined();
    expect(f.sendToParent).toHaveBeenCalledExactlyOnceWith("pasteboard-pro:request-history-mirror", "image-retry");
    expect(f.requestHistoryMirror).not.toHaveBeenCalled();
  });

  it("auxiliary without a parent fails and never starts a second owner", () => {
    const f = fixture(false, false);
    expect(() => f.bridge.requestImageRetry()).toThrow("当前窗口无法请求图片重试，请从主窗口重试");
    expect(f.requestHistoryMirror).not.toHaveBeenCalled();
    expect(f.sendToParent).not.toHaveBeenCalled();
  });
});
