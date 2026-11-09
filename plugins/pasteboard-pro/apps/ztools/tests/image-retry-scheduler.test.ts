import { describe, expect, it, vi } from "vitest";
import { createImageRetryScheduler, MAX_AUTOMATIC_IMAGE_RETRY_ROUNDS } from "../preload/image-retry-scheduler";

const pending = { pending: 0, failed: 1, total: 1, capacity: 4096 };
const empty = { pending: 0, failed: 0, total: 0, capacity: 4096 };
const retryable = Object.assign(new Error("fixed image failure"), { code: "image-read-failed" });
const flush = async () => { for (let step = 0; step < 12; step += 1) await Promise.resolve(); };

function fixture(input: { run?: (isCurrent: () => boolean) => Promise<number>; summary?: () => Promise<typeof pending> } = {}) {
  const timers: Array<{ callback: () => void; delay: number; cancelled: boolean; fired: boolean }> = [];
  const run = vi.fn(input.run ?? (async () => { throw retryable; }));
  const readSummary = vi.fn(input.summary ?? (async () => pending));
  const reportError = vi.fn();
  const scheduler = createImageRetryScheduler({
    run, readSummary, reportError,
    isRetryable: (error) => error === retryable,
    retryEmptyResult: (result) => result === 0,
    schedule(callback, delay) {
      const timer = { callback, delay, cancelled: false, fired: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  const activeTimers = () => timers.filter((timer) => !timer.cancelled && !timer.fired);
  const fire = async () => {
    const timer = activeTimers()[0];
    if (timer === undefined) throw new Error("No active synthetic timer");
    timer.fired = true;
    timer.callback();
    await flush();
  };
  return { scheduler, timers, activeTimers, fire, run, readSummary, reportError };
}

describe("bounded primary image retry scheduler", () => {
  it("backs off one timer at a time and stops after five automatic rounds", async () => {
    const f = fixture();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    for (let round = 0; round < MAX_AUTOMATIC_IMAGE_RETRY_ROUNDS; round += 1) {
      expect(f.activeTimers()).toHaveLength(1);
      await f.fire();
    }
    expect(f.run).toHaveBeenCalledTimes(6);
    expect(f.timers.map(({ delay }) => delay)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("a fresh external request can start a new bounded session", async () => {
    const f = fixture();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    for (let round = 0; round < 5; round += 1) await f.fire();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    expect(f.activeTimers().map(({ delay }) => delay)).toEqual([1000]);
    f.scheduler.dispose();
  });

  it("does not automatically retry unknown or database failures", async () => {
    const error = new Error("Storage operation failed");
    const f = fixture({ run: async () => { throw error; } });
    await expect(f.scheduler.request()).rejects.toBe(error);
    expect(f.readSummary).not.toHaveBeenCalled();
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("a failed summary read is not zero pending and preserves the original error", async () => {
    const error = new Error("Storage operation failed");
    const f = fixture({ summary: async () => { throw error; } });
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    expect(f.reportError).toHaveBeenCalledWith(error);
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("propagates a summary read failure after a successful mirror", async () => {
    const error = new Error("Storage operation failed");
    const f = fixture({ run: async () => 1, summary: async () => { throw error; } });
    await expect(f.scheduler.request()).rejects.toBe(error);
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("coalesces concurrent requests and never runs two mirror operations", async () => {
    let release!: () => void;
    let active = 0;
    let peak = 0;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture({ run: async () => {
      active += 1; peak = Math.max(peak, active);
      await barrier;
      active -= 1;
      return 1;
    }, summary: async () => empty });
    const first = f.scheduler.request();
    const second = f.scheduler.request();
    await flush();
    expect(f.run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(f.activeTimers()).toHaveLength(1);
    await f.fire();
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it("suspending a queued mirror fences its actual execution and late completion", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn();
    const f = fixture({ run: async (isCurrent) => {
      await barrier;
      if (!isCurrent()) throw new Error("Clipboard image retry was cancelled");
      execute();
      return 1;
    }});
    const request = f.scheduler.request();
    await flush();
    const resume = f.scheduler.suspend();
    release();
    await expect(request).rejects.toThrow("cancelled");
    resume();
    expect(execute).not.toHaveBeenCalled();
    expect(f.readSummary).not.toHaveBeenCalled();
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("does not let a stale cancelled timer erase or execute a new timer", async () => {
    const f = fixture();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    const old = f.activeTimers()[0]!;
    const resume = f.scheduler.suspend(); resume();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    old.callback();
    await flush();
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.activeTimers()).toHaveLength(1);
    await f.fire();
    expect(f.run).toHaveBeenCalledTimes(3);
    f.scheduler.dispose();
  });

  it("a genuine new request after a cancelled in-flight run is not lost", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const f = fixture({ run: async () => { await barrier; return 1; }, summary: async () => empty });
    const old = f.scheduler.request(); await flush();
    const resume = f.scheduler.suspend(); resume();
    const current = f.scheduler.request();
    release(); await Promise.all([old, current]);
    await f.fire();
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it("bounds screenshot empty-result polling to four shared-timer rounds", async () => {
    const f = fixture({ run: async () => 0, summary: async () => empty });
    await f.scheduler.requestFast();
    for (let round = 0; round < 3; round += 1) await f.fire();
    expect(f.run).toHaveBeenCalledTimes(4);
    expect(f.timers.map(({ delay }) => delay)).toEqual([250, 250, 250]);
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("pending tasks cannot fall through to fast polling after the automatic budget", async () => {
    const f = fixture({ run: async () => 0 });
    await f.scheduler.requestFast();
    for (let round = 0; round < MAX_AUTOMATIC_IMAGE_RETRY_ROUNDS; round += 1) await f.fire();
    expect(f.run).toHaveBeenCalledTimes(6);
    expect(f.timers.map(({ delay }) => delay)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(f.activeTimers()).toHaveLength(0);
  });

  it("nested clear suspensions cannot accidentally re-enable the owner", async () => {
    const f = fixture();
    const first = f.scheduler.suspend();
    const second = f.scheduler.suspend();
    first(); first();
    await expect(f.scheduler.request()).rejects.toThrow("unavailable");
    second();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    f.scheduler.dispose();
  });

  it("unload disposal rejects new requests and suppresses old callbacks", async () => {
    const f = fixture();
    await expect(f.scheduler.request()).rejects.toBe(retryable);
    const timer = f.activeTimers()[0]!;
    f.scheduler.dispose(); timer.callback();
    await flush();
    await expect(f.scheduler.request()).rejects.toThrow("unavailable");
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.activeTimers()).toHaveLength(0);
  });
});
