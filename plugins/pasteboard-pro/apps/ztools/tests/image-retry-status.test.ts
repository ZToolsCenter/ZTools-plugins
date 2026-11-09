import { afterEach, describe, expect, it, vi } from "vitest";

import type { MirrorImageRetrySummary } from "../preload/mirror-image-retry-types";
import {
  createImageRetryStatusController,
  createImageRetryStatusState,
  imageRetryStatusPresentation,
  isMirrorImageRetrySummary,
  type ImageRetryStatusBridge,
} from "../src/image-retry-status";

const summary = (
  pending: number,
  failed: number,
  capacity = 4096,
): MirrorImageRetrySummary => ({ pending, failed, total: pending + failed, capacity });

function createHarness(bridge: ImageRetryStatusBridge | undefined) {
  const state = createImageRetryStatusState();
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const controller = createImageRetryStatusController(state, {
    getBridge: () => bridge,
    windowEvents,
    documentEvents,
  });
  return { state, windowEvents, documentEvents, controller };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("image retry status UI state", () => {
  it("uses a scoped no-work message and never claims every clipboard image was checked", async () => {
    const { state, controller } = createHarness({
      getImageRetryStatus: async () => summary(0, 0),
    });

    await controller.start();

    const view = imageRetryStatusPresentation(state);
    expect(view.message).toBe("当前没有待重试图片");
    expect(view.counts).toEqual([]);
    expect(view.canRetry).toBe(false);
    expect(view.message).not.toContain("所有");
    controller.dispose();
  });

  it("shows pending and failed counts with the original-image retry limitation", async () => {
    const { state, controller } = createHarness({
      getImageRetryStatus: async () => summary(2, 1),
      requestImageRetry: () => {},
    });

    await controller.start();

    const view = imageRetryStatusPresentation(state);
    expect(view.message).toBe("部分图片尚未保存，原图片仍可访问时可重试；重试不会恢复已失效的源图片");
    expect(view.counts).toEqual(["待重试 2 张", "保存失败 1 张"]);
    expect(view.detail).toBe("重试会按已保存的隐私规则处理。");
    expect(view.canRetry).toBe(true);
    controller.dispose();
  });

  it("reports failed-only counts and explains a missing request bridge", async () => {
    const { state, controller } = createHarness({
      getImageRetryStatus: async () => summary(0, 3),
    });

    await controller.start();

    const view = imageRetryStatusPresentation(state);
    expect(view.counts).toEqual(["待重试 0 张", "保存失败 3 张"]);
    expect(view.canRetry).toBe(false);
    expect(view.detail).toBe("当前版本暂不支持重试图片保存。");
    controller.dispose();
  });

  it("does not turn invalid counts or bridge errors into zero", async () => {
    const invalid = createHarness({
      getImageRetryStatus: async () => ({ pending: 2, failed: 1, total: 1, capacity: 16 }),
    });
    await invalid.controller.start();
    expect(invalid.state.readError).toBe(true);
    expect(imageRetryStatusPresentation(invalid.state).message).toBe("暂时无法读取图片保存状态，请稍后重试。");

    const failure = createHarness({
      getImageRetryStatus: async () => { throw new Error("/private/path/clipboard payload"); },
    });
    await failure.controller.start();
    const view = imageRetryStatusPresentation(failure.state);
    expect(view.message).toBe("暂时无法读取图片保存状态，请稍后重试。");
    expect(JSON.stringify(view)).not.toContain("/private/path/clipboard payload");
    expect(view.message).not.toContain("0 张");
    invalid.controller.dispose();
    failure.controller.dispose();
  });

  it("rejects zero capacity, totals beyond capacity, unsafe counts, and unknown/error statuses", () => {
    const tooLargeTotal = summary(2, 1, 2);
    const unsafeInteger = summary(Number.MAX_SAFE_INTEGER + 1, 0, Number.MAX_SAFE_INTEGER + 1);
    const unknownStatus = Object.assign(summary(1, 0), { state: "unknown" });
    const errorStatus = Object.assign(summary(1, 0), { status: "error" });
    const invalidSummaries: unknown[] = [
      summary(0, 0, 0),
      tooLargeTotal,
      { pending: 2, failed: 1, total: 1, capacity: 4096 },
      unsafeInteger,
      unknownStatus,
      errorStatus,
      { pending: -1, failed: 0, total: 0, capacity: 4096 },
    ];

    expect(isMirrorImageRetrySummary(summary(3, 2, 4096))).toBe(true);
    for (const invalid of invalidSummaries) {
      expect(isMirrorImageRetrySummary(invalid)).toBe(false);
    }
  });

  it("shows compatibility text instead of presenting an unsupported bridge as empty", async () => {
    const { state, controller } = createHarness(undefined);

    await controller.start();

    const view = imageRetryStatusPresentation(state);
    expect(view.message).toBe("当前版本暂不支持查看图片保存状态。");
    expect(view.message).not.toBe("当前没有待重试图片");
    controller.dispose();
  });

  it("explains when the status is available but the retry request API is missing", async () => {
    const { state, controller } = createHarness({
      getImageRetryStatus: async () => summary(0, 0),
    });

    await controller.start();

    const view = imageRetryStatusPresentation(state);
    expect(view.message).toBe("当前没有待重试图片");
    expect(view.detail).toBe("当前版本暂不支持重试图片保存。");
    controller.dispose();
  });

  it("only reports a retry request, then uses the next status read for counts", async () => {
    let resolveSecondRead: ((value: MirrorImageRetrySummary) => void) | undefined;
    const requestImageRetry = vi.fn();
    const getImageRetryStatus = vi.fn()
      .mockResolvedValueOnce(summary(2, 0))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecondRead = resolve; }));
    const { state, controller } = createHarness({ getImageRetryStatus, requestImageRetry });
    await controller.start();

    const retryPromise = controller.retry();
    expect(requestImageRetry).toHaveBeenCalledOnce();
    expect(imageRetryStatusPresentation(state).notice).toBe("已请求重试");
    expect(state.summary).toEqual(summary(2, 0));
    expect(imageRetryStatusPresentation(state).message).not.toContain("已保存");
    await controller.retry();
    expect(requestImageRetry).toHaveBeenCalledOnce();

    resolveSecondRead?.(summary(0, 0));
    await retryPromise;
    expect(imageRetryStatusPresentation(state).message).toBe("当前没有待重试图片");
    expect(imageRetryStatusPresentation(state).notice).toBe("已请求重试");
    controller.dispose();
  });

  it("uses a fixed local message when the owner rejects a retry request", async () => {
    const getImageRetryStatus = vi.fn(async () => summary(1, 0));
    const { state, controller } = createHarness({
      getImageRetryStatus,
      requestImageRetry: () => { throw new Error("private source path"); },
    });
    await controller.start();

    await controller.retry();

    const view = imageRetryStatusPresentation(state);
    expect(view.notice).toBe("无法请求重试，请稍后再试。");
    expect(JSON.stringify(view)).not.toContain("private source path");
    expect(getImageRetryStatus).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("coalesces history notifications and clears listeners and timers on disposal", async () => {
    vi.useFakeTimers();
    const getImageRetryStatus = vi.fn(async () => summary(1, 0));
    const { controller, windowEvents, documentEvents } = createHarness({ getImageRetryStatus });
    await controller.start();
    expect(getImageRetryStatus).toHaveBeenCalledOnce();

    windowEvents.dispatchEvent(new Event("pasteboard-pro:history-changed"));
    windowEvents.dispatchEvent(new Event("pasteboard-pro:history-mirrored"));
    await vi.advanceTimersByTimeAsync(80);
    expect(getImageRetryStatus).toHaveBeenCalledTimes(2);

    documentEvents.dispatchEvent(new Event("visibilitychange"));
    controller.dispose();
    await vi.advanceTimersByTimeAsync(80);
    windowEvents.dispatchEvent(new Event("focus"));
    expect(getImageRetryStatus).toHaveBeenCalledTimes(2);
  });

  it("fences a status result that arrives after unmount", async () => {
    let resolveRead: ((value: MirrorImageRetrySummary) => void) | undefined;
    const { state, controller } = createHarness({
      getImageRetryStatus: () => new Promise((resolve) => { resolveRead = resolve; }),
    });
    const startPromise = controller.start();
    const beforeDispose = { ...state };

    controller.dispose();
    resolveRead?.(summary(0, 0));
    await startPromise;

    expect(state).toEqual(beforeDispose);
  });
});
