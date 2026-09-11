/**
 * 自动界面导览：hasApiKey + phase=pending + 非 streaming + idle 延迟后播 1 次。
 * 无顶栏/主表面手动入口假设；resetOnboardingTour 是再触发路径。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_PREFIX } from "@/lib/storage";
import {
  markTourFinished,
  resetOnboardingTour,
  setTourPhase,
  TOUR_STORAGE_KEY,
} from "@/lib/onboarding/tourState";

const startInterfaceTour = vi.fn();
const isTourActive = vi.fn(() => false);
const isWorkbenchTourReady = vi.fn(() => true);

/** 可切换；hook 只看 hasConfiguredApiKey 闸自动播 */
let mockHasApiKey = true;

const mockAi = { enabled: true };

vi.mock("@/lib/onboarding/runTour", () => ({
  startInterfaceTour: (...args: unknown[]) => startInterfaceTour(...args),
  isTourActive: () => isTourActive(),
  isWorkbenchTourReady: () => isWorkbenchTourReady(),
}));

vi.mock("@/lib/onboarding/checklist", () => ({
  hasConfiguredApiKey: () => mockHasApiKey,
}));

vi.mock("@/stores/settings", () => {
  const useSettings = Object.assign(
    (sel: (s: { ai: typeof mockAi }) => unknown) => sel({ ai: mockAi }),
    { getState: () => ({ ai: mockAi }) },
  );
  return { useSettings };
});

import {
  AUTO_TOUR_DELAY_MS,
  useOnboardingTour,
} from "../useOnboardingTour";

const PHYSICAL = `${STORAGE_PREFIX}${TOUR_STORAGE_KEY}`;

describe("useOnboardingTour auto-start (hasApiKey + pending)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(PHYSICAL);
    mockHasApiKey = true;
    startInterfaceTour.mockClear();
    isTourActive.mockReturnValue(false);
    isWorkbenchTourReady.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(PHYSICAL);
  });

  it("auto-starts once when pending + hasApiKey", async () => {
    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);
    expect(startInterfaceTour).toHaveBeenCalledWith({ persistResult: true });
  });

  it("does not auto-start again after done until resetOnboardingTour", async () => {
    const { rerender } = renderHook(
      ({ streaming }: { streaming: boolean }) => useOnboardingTour(streaming),
      { initialProps: { streaming: false } },
    );

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);

    markTourFinished({ completed: true });
    startInterfaceTour.mockClear();

    await act(async () => {
      rerender({ streaming: false });
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();

    // 真实 shipped reset：写 storage + 派发 tour-reset → resetEpoch → 再调度
    await act(async () => {
      resetOnboardingTour();
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);
    expect(startInterfaceTour).toHaveBeenCalledWith({ persistResult: true });
  });

  it("does not auto-start when phase is already done", async () => {
    setTourPhase("done");

    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();
  });

  it("does not auto-start when phase is skipped", async () => {
    markTourFinished({ completed: false });

    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();
  });

  it("resetOnboardingTour re-enables auto after skipped", async () => {
    markTourFinished({ completed: false });

    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();

    await act(async () => {
      resetOnboardingTour();
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);
    expect(startInterfaceTour).toHaveBeenCalledWith({ persistResult: true });
  });

  it("does not auto-start when hasApiKey is false", async () => {
    mockHasApiKey = false;

    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();
  });

  it("waits until streaming ends before auto-start", async () => {
    const { rerender } = renderHook(
      ({ streaming }: { streaming: boolean }) => useOnboardingTour(streaming),
      { initialProps: { streaming: true } },
    );

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();

    // 先让 isStreaming=false 的 effect 排程 setTimeout，再推进假时钟
    await act(async () => {
      rerender({ streaming: false });
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);
  });

  it("retries when workbench is hidden then starts once ready", async () => {
    isWorkbenchTourReady.mockReturnValue(false);

    renderHook(() => useOnboardingTour(false));

    await act(async () => {
      vi.advanceTimersByTime(AUTO_TOUR_DELAY_MS + 10);
    });
    expect(startInterfaceTour).not.toHaveBeenCalled();

    isWorkbenchTourReady.mockReturnValue(true);
    await act(async () => {
      // TOUR_READY_RETRY_MS = 400（hook 内常量）
      vi.advanceTimersByTime(400 + 10);
    });
    expect(startInterfaceTour).toHaveBeenCalledTimes(1);
  });
});
