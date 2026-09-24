import { describe, expect, it } from "vitest";

import type { HybridClock, PasteItem, Pinboard } from "../../core/src/index";
import {
  mergeEntity,
  mergePasteItem,
  mergePinboard,
  type Tombstone,
} from "../src/index";

function clock(
  wallMs: number,
  counter = 0,
  deviceId = "device-a",
): HybridClock {
  return { wallMs, counter, deviceId };
}

function pasteItem(overrides: Partial<PasteItem> = {}): PasteItem {
  return {
    id: "item-1",
    kind: "text",
    sourceApp: { bundleId: "com.example.source", name: "Source" },
    sourceDeviceId: "capture-device",
    copiedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    contentFingerprint: "fingerprint-1",
    payload: { revision: "rev-1", text: "original" },
    pinned: false,
    fieldClocks: {},
    ...overrides,
  };
}

function pinboard(overrides: Partial<Pinboard> = {}): Pinboard {
  return {
    id: "pinboard-1",
    name: "Work",
    color: "#3366FF",
    orderKey: "a0",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    fieldClocks: {},
    ...overrides,
  };
}

function tombstone(overrides: Partial<Tombstone> = {}): Tombstone {
  return {
    id: "item-1",
    entityType: "paste_item",
    deleted: true,
    deletedAt: "2026-07-15T01:00:00.000Z",
    sourceDeviceId: "device-a",
    clock: clock(10),
    ...overrides,
  };
}

function expectBothOrdersToThrow<T>(
  merge: (left: T, right: T) => unknown,
  left: T,
  right: T,
): void {
  expect(() => merge(left, right)).toThrow(RangeError);
  expect(() => merge(right, left)).toThrow(RangeError);
}

describe("mergePasteItem", () => {
  it("merges independently updated title and pinboard fields", () => {
    const left = pasteItem({
      title: "Local title",
      pinboardId: "old-board",
      fieldClocks: {
        title: clock(30, 0, "local"),
        pinboardId: clock(10, 0, "local"),
      },
    });
    const right = pasteItem({
      title: "Remote title",
      pinboardId: "remote-board",
      fieldClocks: {
        title: clock(20, 0, "remote"),
        pinboardId: clock(40, 0, "remote"),
      },
    });

    const merged = mergePasteItem(left, right);

    expect(merged.title).toBe("Local title");
    expect(merged.pinboardId).toBe("remote-board");
  });

  it("picks a different payload revision as one whole object", () => {
    const left = pasteItem({
      payload: {
        revision: "rev-local",
        text: "local text",
        html: "<b>local</b>",
      },
      fieldClocks: { payload: clock(10, 0, "local") },
    });
    const right = pasteItem({
      payload: {
        revision: "rev-remote",
        blobId: "blob-remote",
        mediaType: "image/png",
      },
      fieldClocks: { payload: clock(20, 0, "remote") },
    });

    expect(mergePasteItem(left, right).payload).toEqual(right.payload);
  });

  it("rejects different payload bytes under the same revision", () => {
    const left = pasteItem({
      payload: { revision: "rev-1", text: "left" },
    });
    const right = pasteItem({
      payload: { revision: "rev-1", text: "right" },
    });

    expect(() => mergePasteItem(left, right)).toThrow(RangeError);
  });

  it("rejects conflicting values and deletions at an equal field clock", () => {
    const equalClock = clock(30, 0, "shared");
    const titleLeft = pasteItem({
      title: "Left title",
      fieldClocks: { title: equalClock },
    });
    const titleRight = pasteItem({
      title: "Right title",
      fieldClocks: { title: { ...equalClock } },
    });
    const deletedTitle = pasteItem({
      fieldClocks: { title: { ...equalClock } },
    });

    expectBothOrdersToThrow(mergePasteItem, titleLeft, titleRight);
    expectBothOrdersToThrow(mergePasteItem, titleLeft, deletedTitle);
  });

  it("rejects different payload revisions at an equal field clock", () => {
    const equalClock = clock(30, 0, "shared");
    const left = pasteItem({
      payload: { revision: "rev-left", text: "same bytes" },
      fieldClocks: { payload: equalClock },
    });
    const right = pasteItem({
      payload: { revision: "rev-right", text: "same bytes" },
      fieldClocks: { payload: { ...equalClock } },
    });

    expectBothOrdersToThrow(mergePasteItem, left, right);
  });

  it("accepts semantically identical values at an equal field clock", () => {
    const equalClock = clock(30, 0, "shared");
    const left = pasteItem({
      title: "Same title",
      payload: { revision: "rev-same", text: "same bytes" },
      fieldClocks: { title: equalClock, payload: equalClock },
    });
    const right = structuredClone(left);

    expect(mergePasteItem(left, right)).toEqual(left);
    expect(mergePasteItem(right, left)).toEqual(left);
  });

  it("treats missing and undefined nested optional fields as equivalent", () => {
    const sourceAppWithUndefined = pasteItem({
      sourceApp: { bundleId: undefined },
    });
    const sourceAppWithoutKey = pasteItem({ sourceApp: {} });

    expect(() =>
      mergePasteItem(sourceAppWithUndefined, sourceAppWithoutKey),
    ).not.toThrow();
    expect(() =>
      mergePasteItem(sourceAppWithoutKey, sourceAppWithUndefined),
    ).not.toThrow();

    const payloadWithUndefined = pasteItem({
      payload: {
        revision: "rev-1",
        text: undefined,
        filePaths: undefined,
      },
    });
    const payloadWithoutKeys = pasteItem({ payload: { revision: "rev-1" } });

    for (const merged of [
      mergePasteItem(payloadWithUndefined, payloadWithoutKeys),
      mergePasteItem(payloadWithoutKeys, payloadWithUndefined),
    ]) {
      expect(merged.payload).toEqual({ revision: "rev-1" });
      expect(Object.hasOwn(merged.payload, "text")).toBe(false);
      expect(Object.hasOwn(merged.payload, "filePaths")).toBe(false);
    }
  });

  it("still distinguishes a missing sourceApp from a present empty sourceApp", () => {
    expectBothOrdersToThrow(
      mergePasteItem,
      pasteItem({ sourceApp: undefined }),
      pasteItem({ sourceApp: {} }),
    );
  });

  it("applies an optional title deletion with a newer field clock", () => {
    const left = pasteItem({
      title: "Delete me",
      fieldClocks: { title: clock(10, 0, "local") },
    });
    const right = pasteItem({
      fieldClocks: { title: clock(20, 0, "remote") },
    });

    const merged = mergePasteItem(left, right);

    expect("title" in merged).toBe(false);
    expect(merged.fieldClocks.title).toEqual(clock(20, 0, "remote"));
  });

  it("preserves unknown field clocks from both sides", () => {
    const left = pasteItem({
      fieldClocks: { futureLeft: clock(10, 0, "left") },
    });
    const right = pasteItem({
      fieldClocks: {
        futureLeft: clock(5, 0, "right"),
        futureRight: clock(20, 0, "right"),
      },
    });

    expect(mergePasteItem(left, right).fieldClocks).toEqual({
      futureLeft: clock(10, 0, "left"),
      futureRight: clock(20, 0, "right"),
    });
  });

  it("preserves an own __proto__ field clock without changing the result prototype", () => {
    const leftClocks: Record<string, HybridClock> = {};
    const rightClocks: Record<string, HybridClock> = {};
    Object.defineProperty(leftClocks, "__proto__", {
      value: clock(20, 0, "left"),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(rightClocks, "__proto__", {
      value: clock(10, 0, "right"),
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const merged = mergePasteItem(
      pasteItem({ fieldClocks: leftClocks }),
      pasteItem({ fieldClocks: rightClocks }),
    );

    expect(Object.getPrototypeOf(merged.fieldClocks)).toBe(Object.prototype);
    expect(Object.hasOwn(merged.fieldClocks, "__proto__")).toBe(true);
    expect(merged.fieldClocks.__proto__).toEqual(clock(20, 0, "left"));
  });

  it("ignores inherited field clocks when an own clock is missing", () => {
    const leftClocks = Object.create({ futureField: clock(30, 0, "inherited") }) as Record<
      string,
      HybridClock
    >;
    const rightClocks = { futureField: clock(10, 0, "right") };

    expect(
      mergePasteItem(
        pasteItem({ fieldClocks: leftClocks }),
        pasteItem({ fieldClocks: rightClocks }),
      ).fieldClocks.futureField,
    ).toEqual(clock(10, 0, "right"));
  });

  it("rejects different ids and immutable capture fields", () => {
    const conflicts: PasteItem[] = [
      pasteItem({ id: "item-2" }),
      pasteItem({ kind: "url" }),
      pasteItem({ sourceDeviceId: "other-capture-device" }),
      pasteItem({ copiedAt: "2026-07-14T00:00:00.000Z" }),
      pasteItem({ contentFingerprint: "other-fingerprint" }),
      pasteItem({ sourceApp: { bundleId: "com.other", name: "Source" } }),
      pasteItem({ sourceApp: undefined }),
    ];

    for (const conflict of conflicts) {
      expect(() => mergePasteItem(pasteItem(), conflict)).toThrow(RangeError);
    }
  });

  it("is commutative for distinct field clocks and does not mutate inputs", () => {
    const left = pasteItem({
      title: "Local title",
      pinboardId: "old-board",
      updatedAt: "2026-07-15T01:00:00.000Z",
      fieldClocks: {
        title: clock(30, 0, "local"),
        pinboardId: clock(10, 0, "local"),
      },
    });
    const right = pasteItem({
      title: "Remote title",
      pinboardId: "remote-board",
      updatedAt: "2026-07-15T02:00:00.000Z",
      fieldClocks: {
        title: clock(20, 0, "remote"),
        pinboardId: clock(40, 0, "remote"),
      },
    });
    const leftBefore = structuredClone(left);
    const rightBefore = structuredClone(right);

    expect(mergePasteItem(left, right)).toEqual(mergePasteItem(right, left));
    expect(left).toEqual(leftBefore);
    expect(right).toEqual(rightBefore);
  });
});

describe("mergePinboard", () => {
  it("merges mutable fields independently and selects the later updatedAt", () => {
    const left = pinboard({
      name: "Local name",
      color: "#111111",
      orderKey: "local-order",
      updatedAt: "2026-07-15T03:00:00.000Z",
      fieldClocks: {
        name: clock(30, 0, "local"),
        color: clock(10, 0, "local"),
        orderKey: clock(50, 0, "local"),
      },
    });
    const right = pinboard({
      name: "Remote name",
      color: "#EEEEEE",
      orderKey: "remote-order",
      updatedAt: "2026-07-15T04:00:00.000Z",
      fieldClocks: {
        name: clock(20, 0, "remote"),
        color: clock(40, 0, "remote"),
        orderKey: clock(45, 0, "remote"),
      },
    });
    const leftBefore = structuredClone(left);
    const rightBefore = structuredClone(right);

    const merged = mergePinboard(left, right);

    expect(merged.name).toBe("Local name");
    expect(merged.color).toBe("#EEEEEE");
    expect(merged.orderKey).toBe("local-order");
    expect(merged.updatedAt).toBe("2026-07-15T04:00:00.000Z");
    expect(left).toEqual(leftBefore);
    expect(right).toEqual(rightBefore);
  });

  it("rejects different ids and immutable creation times", () => {
    expect(() => mergePinboard(pinboard(), pinboard({ id: "pinboard-2" }))).toThrow(
      RangeError,
    );
    expect(() =>
      mergePinboard(
        pinboard(),
        pinboard({ createdAt: "2026-07-14T00:00:00.000Z" }),
      ),
    ).toThrow(RangeError);
  });

  it("rejects different names at an equal field clock in both orders", () => {
    const equalClock = clock(30, 0, "shared");
    const left = pinboard({
      name: "Left name",
      fieldClocks: { name: equalClock },
    });
    const right = pinboard({
      name: "Right name",
      fieldClocks: { name: { ...equalClock } },
    });

    expectBothOrdersToThrow(mergePinboard, left, right);
  });

  it("uses deterministic lexical ordering when updatedAt cannot be dated", () => {
    const left = pinboard({ updatedAt: "invalid-a" }) as Pinboard;
    const right = pinboard({ updatedAt: "invalid-b" }) as Pinboard;

    expect(mergePinboard(left, right).updatedAt).toBe("invalid-b");
    expect(mergePinboard(right, left).updatedAt).toBe("invalid-b");
  });
});

describe("mergeEntity tombstones", () => {
  it("keeps a newer tombstone over an older live edit", () => {
    const live = pasteItem({ fieldClocks: { title: clock(10) } });
    const deleted = tombstone({ clock: clock(20) });

    expect(mergeEntity(live, deleted)).toEqual(deleted);
  });

  it("keeps a newer explicit live revision over an older tombstone", () => {
    const live = pasteItem({ fieldClocks: { title: clock(20) } });
    const deleted = tombstone({ clock: clock(10) });

    expect(mergeEntity(deleted, live)).toEqual(live);
  });

  it("lets a tombstone win a tie to prevent silent resurrection", () => {
    const live = pasteItem({ fieldClocks: { title: clock(20) } });
    const deleted = tombstone({ clock: clock(20) });

    expect(mergeEntity(live, deleted)).toEqual(deleted);
    expect(mergeEntity(deleted, live)).toEqual(deleted);
  });

  it("picks the newer tombstone and accepts equal semantic tombstones", () => {
    const older = tombstone({
      deletedAt: "2026-07-15T01:00:00.000Z",
      clock: clock(10),
    });
    const newer = tombstone({
      deletedAt: "2026-07-15T02:00:00.000Z",
      clock: clock(20),
    });
    const equalLeft = tombstone({ clock: clock(30) });
    const equalRight = structuredClone(equalLeft);

    expect(mergeEntity(older, newer)).toEqual(newer);
    expect(mergeEntity(newer, older)).toEqual(newer);
    expect(mergeEntity(equalLeft, equalRight)).toEqual(equalLeft);
  });

  it("rejects conflicting tombstone metadata at an equal clock in both orders", () => {
    const base = tombstone({ clock: clock(30, 0, "shared") });
    const conflicts: Tombstone[] = [
      tombstone({
        deletedAt: "2026-07-15T04:00:00.000Z",
        clock: { ...base.clock },
      }),
      tombstone({
        sourceDeviceId: "other-device",
        clock: { ...base.clock },
      }),
      tombstone({
        entityType: "pinboard",
        clock: { ...base.clock },
      }),
    ];

    for (const conflict of conflicts) {
      expectBothOrdersToThrow(mergeEntity, base, conflict);
    }
  });

  it("compares a tombstone against the maximum known or future live clock", () => {
    const live = pasteItem({
      fieldClocks: {
        title: clock(10),
        futureField: clock(30, 0, "future"),
      },
    });
    const deleted = tombstone({ clock: clock(20) });

    expect(mergeEntity(live, deleted)).toEqual(live);
  });

  it("does not let the missing-clock sentinel hide a valid lower live clock", () => {
    const wallMs = Number.MIN_SAFE_INTEGER - 1;
    const live = pasteItem({
      fieldClocks: { title: clock(wallMs, 0, "a") },
    });
    const deleted = tombstone({ clock: clock(wallMs, 0, "z") });

    expect(mergeEntity(live, deleted)).toHaveProperty("deleted", true);
  });

  it("rejects id and entity-type mismatches", () => {
    expect(() =>
      mergeEntity(pasteItem(), tombstone({ id: "item-2" })),
    ).toThrow(RangeError);
    expect(() =>
      mergeEntity(
        pasteItem(),
        tombstone({ entityType: "pinboard" }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      mergeEntity(
        tombstone(),
        tombstone({ entityType: "pinboard" }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      mergeEntity(pasteItem(), pinboard({ id: "item-1" })),
    ).toThrow(RangeError);
  });

  it("does not mutate live entities or tombstones", () => {
    const live = pasteItem({ fieldClocks: { title: clock(10) } });
    const deleted = tombstone({ clock: clock(20) });
    const liveBefore = structuredClone(live);
    const deletedBefore = structuredClone(deleted);

    mergeEntity(live, deleted);

    expect(live).toEqual(liveBefore);
    expect(deleted).toEqual(deletedBefore);
  });

  it("deep-clones a winning tombstone before returning it", () => {
    const live = pasteItem({ fieldClocks: { title: clock(10) } });
    const deleted = tombstone({ clock: clock(20) });
    const merged = mergeEntity(live, deleted) as Tombstone;

    expect(merged).not.toBe(live);
    expect(merged).not.toBe(deleted);
    merged.clock.wallMs = 99;

    expect(deleted.clock.wallMs).toBe(20);
  });

  it("deep-clones a winning live entity before returning it", () => {
    const live = pasteItem({
      sourceApp: { bundleId: "com.example.source", name: "Source" },
      payload: { revision: "rev-1", filePaths: ["/tmp/original"] },
      fieldClocks: { payload: clock(20) },
    });
    const deleted = tombstone({ clock: clock(10) });
    const merged = mergeEntity(deleted, live) as PasteItem;

    expect(merged).not.toBe(live);
    expect(merged).not.toBe(deleted);
    merged.payload.filePaths?.push("/tmp/mutated");
    merged.fieldClocks.payload!.wallMs = 99;
    if (merged.sourceApp) {
      merged.sourceApp.bundleId = "com.example.mutated";
    }

    expect(live.payload.filePaths).toEqual(["/tmp/original"]);
    expect(live.fieldClocks.payload!.wallMs).toBe(20);
    expect(live.sourceApp?.bundleId).toBe("com.example.source");
  });

  it("never returns an input directly for tombstone-only merges", () => {
    const older = tombstone({ clock: clock(10) });
    const newer = tombstone({ clock: clock(20) });
    const merged = mergeEntity(older, newer);

    expect(merged).not.toBe(older);
    expect(merged).not.toBe(newer);
    expect(merged).toEqual(newer);
  });
});
