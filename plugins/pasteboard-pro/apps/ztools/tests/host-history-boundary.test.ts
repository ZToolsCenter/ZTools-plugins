import { describe, expect, it } from "vitest";

import {
  HistoryClearSourceError,
  readHostHistoryBoundary,
  readHostHistoryClearBoundary,
} from "../preload/host-history-boundary";
import { historyClearIdentity, MAX_HISTORY_CLEAR_IDENTITIES } from "../preload/history-clear-identity";
import type { HostClipboardApi } from "../preload/clipboard-store-types";

const fixedMessage = "Cannot confirm clipboard history clear boundary";

type HistoryPage = Readonly<{ items: readonly unknown[]; total: number }>;

function hostFor(
  pageFor: (page: number, pageSize: number) => HistoryPage | Promise<HistoryPage>,
) {
  const calls: Array<Readonly<{ page: number; pageSize: number }>> = [];
  const host: HostClipboardApi = {
    async getHistory(page, pageSize) {
      calls.push({ page, pageSize });
      return pageFor(page, pageSize);
    },
  };
  return { host, calls };
}

function item(id: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { id, timestamp, ...extra };
}

async function expectSourceError(
  promise: Promise<unknown>,
  code: HistoryClearSourceError["code"],
) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HistoryClearSourceError);
  expect(error).toMatchObject({ code, message: fixedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  expect((error as Error).message).not.toMatch(/secret|private|path/i);
}

describe("readHostHistoryBoundary", () => {
  it("scans unordered pages and returns the maximum timestamp cursor", async () => {
    const { host, calls } = hostFor((page) => page === 1
      ? { items: [item("later", 90), item("old", 10)], total: 4 }
      : page === 2
        ? { items: [item("newest", 100), item("middle", 50)], total: 4 }
        : { items: [], total: 4 });

    await expect(readHostHistoryBoundary(host, { pageSize: 2 })).resolves.toEqual({
      id: "newest",
      timestamp: 100,
    });
    expect(calls).toEqual([
      { page: 1, pageSize: 2 },
      { page: 2, pageSize: 2 },
    ]);
  });

  it("uses the host cursor ID as a deterministic timestamp tie-breaker", async () => {
    const { host } = hostFor((page) => page === 1
      ? { items: [item("alpha", 42)], total: 2 }
      : { items: [item("zeta", 42)], total: 2 });

    await expect(readHostHistoryBoundary(host, { pageSize: 1 })).resolves.toEqual({
      id: "zeta",
      timestamp: 42,
    });
  });

  it("returns undefined for an empty history with total zero", async () => {
    const { host, calls } = hostFor(() => ({ items: [], total: 0 }));
    await expect(readHostHistoryBoundary(host)).resolves.toBeUndefined();
    expect(calls).toEqual([{ page: 1, pageSize: 100 }]);
  });

  it("copies only cursor fields and snapshots options before awaiting the host", async () => {
    let releasePage: ((page: HistoryPage) => void) | undefined;
    const sourceItem = item("cursor-id", 123, { content: "must not be retained", imagePath: "/private/file" });
    const { host, calls } = hostFor((page) => page === 1
      ? new Promise<HistoryPage>((resolve) => { releasePage = resolve; })
      : { items: [item("older", 100)], total: 2 });
    const options = { pageSize: 1, maxPages: 4 };
    const pending = readHostHistoryBoundary(host, options);
    options.pageSize = 500;
    options.maxPages = 1;
    releasePage?.({ items: [sourceItem], total: 2 });

    const boundary = await pending;
    expect(calls).toEqual([
      { page: 1, pageSize: 1 },
      { page: 2, pageSize: 1 },
    ]);
    expect(boundary).toEqual({ id: "cursor-id", timestamp: 123 });
    expect(boundary).not.toBe(sourceItem);
    sourceItem.id = "mutated";
    expect(boundary).toEqual({ id: "cursor-id", timestamp: 123 });
    expect(boundary).not.toHaveProperty("content");
    expect(boundary).not.toHaveProperty("imagePath");
  });

  it("maps host rejection and host method getter exceptions to an unavailable error", async () => {
    const { host } = hostFor(() => { throw new Error("secret /private/history.db"); });
    await expectSourceError(readHostHistoryBoundary(host), "history-clear-source-unavailable");

    const getterHost = Object.defineProperty({}, "getHistory", {
      get() { throw new Error("secret /private/host"); },
    }) as HostClipboardApi;
    await expectSourceError(readHostHistoryBoundary(getterHost), "history-clear-source-unavailable");
  });

  it.each([
    ["items is not an array", { items: "bad", total: 0 }],
    ["page is larger than requested", { items: [item("a", 1), item("b", 2)], total: 2 }],
    ["negative total", { items: [], total: -1 }],
    ["fractional total", { items: [], total: 1.5 }],
    ["unsafe total", { items: [], total: Number.MAX_SAFE_INTEGER + 1 }],
    ["nonempty page declares zero", { items: [item("a", 1)], total: 0 }],
  ])("rejects an invalid host page: %s", async (_label, response) => {
    const { host } = hostFor(() => response as HistoryPage);
    await expectSourceError(readHostHistoryBoundary(host, { pageSize: 1 }), "history-clear-source-invalid");
  });

  it("rejects page and item getters that throw without exposing their errors", async () => {
    const response = Object.defineProperty({}, "items", {
      get() { throw new Error("secret /private/response"); },
    });
    const responseHost = { getHistory: async () => response } as unknown as HostClipboardApi;
    await expectSourceError(readHostHistoryBoundary(responseHost), "history-clear-source-invalid");

    const badItem = Object.defineProperty({}, "id", {
      get() { throw new Error("secret /private/item"); },
    });
    const { host } = hostFor(() => ({ items: [badItem], total: 1 }));
    await expectSourceError(readHostHistoryBoundary(host), "history-clear-source-invalid");
  });

  it("rejects an invalid cursor instead of treating it as a missing item", async () => {
    const { host, calls } = hostFor((page) => page === 1
      ? { items: [item("missing-time", Number.NaN)], total: 2 }
      : { items: [item("later", 2)], total: 2 });
    await expectSourceError(readHostHistoryBoundary(host, { pageSize: 1 }), "history-clear-source-invalid");
    expect(calls).toEqual([{ page: 1, pageSize: 1 }]);
  });

  it("rejects a cursor ID that the clear-boundary store cannot persist", async () => {
    const { host } = hostFor(() => ({ items: [item("x".repeat(4_097), 1)], total: 1 }));
    await expectSourceError(readHostHistoryBoundary(host), "history-clear-source-invalid");
  });

  it("rejects an empty page before the declared total has been loaded", async () => {
    const { host } = hostFor((page) => page === 1
      ? { items: [item("only-one", 1)], total: 2 }
      : { items: [], total: 2 });
    await expectSourceError(readHostHistoryBoundary(host, { pageSize: 1 }), "history-clear-source-invalid");
  });

  it("rejects invalid and unknown pagination options", async () => {
    const { host } = hostFor(() => ({ items: [], total: 0 }));
    for (const options of [
      { pageSize: 0 },
      { pageSize: 501 },
      { pageSize: 1.5 },
      { maxPages: 0 },
      { maxPages: 1_001 },
      { unexpected: true },
    ]) {
      await expectSourceError(
        readHostHistoryBoundary(host, options as never),
        "history-clear-source-invalid",
      );
    }
  });

  it("accepts the inclusive page and page-count limits", async () => {
    const { host, calls } = hostFor(() => ({ items: [], total: 0 }));
    await expect(readHostHistoryBoundary(host, { pageSize: 500, maxPages: 1_000 }))
      .resolves.toBeUndefined();
    expect(calls).toEqual([{ page: 1, pageSize: 500 }]);
  });

  it("rejects option accessors safely", async () => {
    const { host } = hostFor(() => ({ items: [], total: 0 }));
    const options = Object.defineProperty({}, "pageSize", {
      get() { throw new Error("secret option"); },
    });
    await expectSourceError(
      readHostHistoryBoundary(host, options as { pageSize?: number; maxPages?: number }),
      "history-clear-source-invalid",
    );
  });

  it("rejects totals beyond the configured budget as over-limit", async () => {
    const { host } = hostFor(() => ({ items: [item("a", 1)], total: 2 }));
    await expectSourceError(
      readHostHistoryBoundary(host, { pageSize: 1, maxPages: 1 }),
      "history-clear-source-over-limit",
    );
  });

  it("rejects when the final allowed page still has declared items remaining", async () => {
    const { host, calls } = hostFor((page) => page === 1
      ? { items: [item("a", 1), item("b", 2)], total: 4 }
      : { items: [item("c", 3)], total: 4 });
    await expectSourceError(
      readHostHistoryBoundary(host, { pageSize: 2, maxPages: 2 }),
      "history-clear-source-over-limit",
    );
    expect(calls).toHaveLength(2);
  });

  it("accepts a total that grows between pages and scans the added items", async () => {
    const { host } = hostFor((page) => page === 1
      ? { items: [item("first", 2)], total: 2 }
      : page === 2
        ? { items: [item("grew", 9)], total: 3 }
        : page === 3
          ? { items: [item("grew-again", 12)], total: 3 }
          : { items: [], total: 3 });
    await expect(readHostHistoryBoundary(host, { pageSize: 1, maxPages: 4 })).resolves.toEqual({
      id: "grew-again",
      timestamp: 12,
    });
  });

  it("accepts a total that shrinks when all currently declared items are loaded", async () => {
    const { host } = hostFor((page) => page === 1
      ? { items: [item("a", 1)], total: 3 }
      : { items: [item("b", 2)], total: 2 });
    await expect(readHostHistoryBoundary(host, { pageSize: 1 })).resolves.toEqual({
      id: "b",
      timestamp: 2,
    });
  });

  it("uses only getHistory and passes no query or mutation arguments", async () => {
    const accesses: string[] = [];
    const host = Object.defineProperty({}, "getHistory", {
      value: async (...args: unknown[]) => {
        accesses.push(`call:${args.length}`);
        return { items: [item("read-only", 4)], total: 1 };
      },
      enumerable: true,
    }) as HostClipboardApi;
    await expect(readHostHistoryBoundary(host)).resolves.toEqual({ id: "read-only", timestamp: 4 });
    expect(accesses).toEqual(["call:2"]);
    expect(Object.keys(host)).toEqual(["getHistory"]);
  });
  it("returns the exact sorted identity snapshot and distinguishes same-time IDs", async () => {
    const zeta = item("same-time-zeta", 10, { content: "private payload", imagePath: "/private/image" });
    const alpha = item("same-time-alpha", 10, { content: "private payload" });
    const old = item("older-item", 1, { filePath: "/private/file" });
    const { host } = hostFor((page) => page === 1
      ? { items: [zeta, old], total: 4 }
      : { items: [alpha, zeta], total: 4 });

    const snapshot = await readHostHistoryClearBoundary(host, { pageSize: 2 });
    const expected = [
      historyClearIdentity({ id: old.id, timestamp: old.timestamp }),
      historyClearIdentity({ id: alpha.id, timestamp: alpha.timestamp }),
      historyClearIdentity({ id: zeta.id, timestamp: zeta.timestamp }),
    ].sort();

    expect(snapshot).toEqual({
      through: { id: zeta.id, timestamp: zeta.timestamp },
      clearedIdentities: expected,
    });
    if (snapshot === undefined) throw new Error("Expected a nonempty clear boundary");
    expect(historyClearIdentity({ id: alpha.id, timestamp: 10 }))
      .not.toBe(historyClearIdentity({ id: zeta.id, timestamp: 10 }));
    expect(snapshot.clearedIdentities).toContain(historyClearIdentity(snapshot.through));
    expect(snapshot).not.toHaveProperty("content");
    expect(snapshot).not.toHaveProperty("imagePath");
    expect(snapshot).not.toHaveProperty("filePath");
  });

  it("rejects a page whose item count exceeds that page's declared total", async () => {
    const { host } = hostFor(() => ({
      items: [item("one", 1), item("two", 2)],
      total: 1,
    }));
    await expectSourceError(
      readHostHistoryClearBoundary(host, { pageSize: 2 }),
      "history-clear-source-invalid",
    );
  });

  it("accepts exactly 100,000 unique identities and rejects the 100,001st", async () => {
    const pageSize = 500;
    const totalAtCap = MAX_HISTORY_CLEAR_IDENTITIES;
    const makeHost = (total: number) => hostFor((page, requestedPageSize) => {
      const start = (page - 1) * requestedPageSize;
      const end = Math.min(total, start + requestedPageSize);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
        const index = start + offset;
        return item(`cursor-${String(index).padStart(6, "0")}`, index);
      });
      return { items, total };
    });

    const accepted = makeHost(totalAtCap);
    const snapshot = await readHostHistoryClearBoundary(accepted.host, {
      pageSize,
      maxPages: totalAtCap / pageSize,
    });
    expect(snapshot?.clearedIdentities).toHaveLength(totalAtCap);
    expect(new Set(snapshot?.clearedIdentities).size).toBe(totalAtCap);
    expect(snapshot?.through).toEqual({ id: "cursor-099999", timestamp: 99_999 });
    expect(accepted.calls).toHaveLength(totalAtCap / pageSize);

    const rejected = makeHost(totalAtCap + 1);
    await expectSourceError(
      readHostHistoryClearBoundary(rejected.host, {
        pageSize,
        maxPages: Math.ceil((totalAtCap + 1) / pageSize),
      }),
      "history-clear-source-over-limit",
    );
    expect(rejected.calls).toHaveLength(Math.ceil((totalAtCap + 1) / pageSize));

    const legacy = makeHost(totalAtCap + 1);
    await expect(readHostHistoryBoundary(legacy.host, {
      pageSize,
      maxPages: Math.ceil((totalAtCap + 1) / pageSize),
    })).resolves.toEqual({ id: "cursor-100000", timestamp: 100_000 });
    expect(legacy.calls).toHaveLength(Math.ceil((totalAtCap + 1) / pageSize));
  });

});
