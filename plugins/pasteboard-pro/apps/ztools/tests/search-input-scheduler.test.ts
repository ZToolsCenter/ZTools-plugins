import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInputScheduler } from "../src/search-input-scheduler";

afterEach(() => vi.useRealTimers());

describe("search input scheduling", () => {
  it("searches the latest input once after a 300ms pause", () => {
    vi.useFakeTimers();
    let query = "i";
    const queries: string[] = [];
    const scheduler = new SearchInputScheduler(() => { queries.push(query); });
    scheduler.schedule();
    vi.advanceTimersByTime(200);
    query = "invoice";
    scheduler.schedule();
    vi.advanceTimersByTime(299);
    expect(queries).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(queries).toEqual(["invoice"]);
    vi.advanceTimersByTime(1_000);
    expect(queries).toHaveLength(1);
  });

  it("bounds continuous typing to one search every 1000ms", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const scheduler = new SearchInputScheduler(search);
    for (let index = 0; index < 10; index++) {
      scheduler.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(search).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
    for (let index = 0; index < 10; index++) {
      scheduler.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("restores a cleared search immediately without a trailing duplicate", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const scheduler = new SearchInputScheduler(search);
    scheduler.schedule();
    scheduler.flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
    vi.advanceTimersByTime(2_000);
    scheduler.flush();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("cancels deferred input when an explicit refresh already searches", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const scheduler = new SearchInputScheduler(search);
    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(2_000);
    expect(search).not.toHaveBeenCalled();
    scheduler.schedule();
    vi.advanceTimersByTime(300);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("lets explicit keyboard actions await the latest search", async () => {
    vi.useFakeTimers();
    let applied = false;
    const scheduler = new SearchInputScheduler(async () => {
      await Promise.resolve();
      applied = true;
    });
    scheduler.schedule();
    const completion = scheduler.flush();
    expect(applied).toBe(false);
    await completion;
    expect(applied).toBe(true);
    expect(scheduler.pending).toBe(false);
  });

  it("never runs pending or future searches after disposal", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const scheduler = new SearchInputScheduler(search);
    scheduler.schedule();
    scheduler.dispose();
    scheduler.schedule();
    vi.advanceTimersByTime(2_000);
    expect(search).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(false);
  });
});
