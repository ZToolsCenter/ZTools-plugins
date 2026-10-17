import { describe, expect, it, vi } from "vitest";
import { createHistoryRefresh } from "../src/history-refresh";

describe("history refresh", () => {
  it("coalesces synchronous notifications into one read", async () => {
    const read = vi.fn(async () => 1);
    const apply = vi.fn();
    const refresh = createHistoryRefresh(read, apply);
    await Promise.all(Array.from({ length: 20 }, refresh));
    expect(read).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("serializes an event burst during a read and never applies stale data", async () => {
    let resolve!: (value: number) => void;
    const read = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const apply = vi.fn();
    const refresh = createHistoryRefresh(read, apply);
    const first = refresh();
    await Promise.resolve();
    const waiting = Array.from({ length: 20 }, refresh);
    expect(read).toHaveBeenCalledTimes(1);
    resolve(1);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
    resolve(2);
    await Promise.all([first, ...waiting]);
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("allows another refresh after failure", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(2);
    const apply = vi.fn();
    const refresh = createHistoryRefresh(read, apply);
    await expect(refresh()).rejects.toThrow("database busy");
    await refresh();
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
  });
});
