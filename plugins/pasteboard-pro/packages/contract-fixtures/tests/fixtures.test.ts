import { createCipheriv } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import {
  PasteItemSchema,
  PinboardSchema,
  reducePasteStack,
  reduceSelection,
  searchPasteItems,
  type PasteItem,
  type PasteStackAction,
  type PasteStackState,
  type Pinboard,
  type SelectionAction,
  type SelectionState,
} from "../../core/src/index";
import {
  mergeEntity,
  mergePasteItem,
  mergePinboard,
  type Tombstone,
} from "../../sync-protocol/src/index";
import { describe, expect, it } from "vitest";

import {
  aes256GcmZeroVector,
  concurrentPasteItemEdits,
  concurrentPinboardEdits,
  historyFixture,
  pasteStackKeyboardFixture,
  pinboardFixture,
  selectionKeyboardFixture,
  tombstoneFixture,
} from "@pasteboard-pro/contract-fixtures";
import { historyFixture as historySubmoduleFixture } from "@pasteboard-pro/contract-fixtures/history";
import { selectionKeyboardFixture as keyboardSubmoduleFixture } from "@pasteboard-pro/contract-fixtures/keyboard";
import { aes256GcmZeroVector as syncSubmoduleFixture } from "@pasteboard-pro/contract-fixtures/sync";
import { deepFreeze } from "../src/freeze";

const HISTORY_IDS = [
  "text-old",
  "image-new",
  "url-middle",
  "files-item",
  "color-item",
] as const;

const HISTORY_TIMESTAMPS = [
  ["2026-07-10T08:15:00.000Z", "2026-07-10T08:20:00.000Z"],
  ["2026-07-16T09:30:00.000Z", "2026-07-16T09:35:00.000Z"],
  ["2026-07-14T14:00:00.000Z", "2026-07-14T14:05:00.000Z"],
  ["2026-07-13T11:45:00.000Z", "2026-07-13T11:50:00.000Z"],
  ["2026-07-12T16:10:00.000Z", "2026-07-12T16:12:00.000Z"],
] as const;

const PINBOARD_TIMESTAMPS = [
  ["2026-07-01T08:00:00.000Z", "2026-07-10T08:20:00.000Z"],
  ["2026-07-02T08:00:00.000Z", "2026-07-16T09:35:00.000Z"],
] as const;

function expectFrozenClocks(
  fieldClocks: Readonly<Record<string, object>>,
): void {
  expect(Object.isFrozen(fieldClocks)).toBe(true);
  for (const clock of Object.values(fieldClocks)) {
    expect(Object.isFrozen(clock)).toBe(true);
  }
}

function expectClockInRange(
  wallMs: number,
  lowerTimestamp: string,
  upperTimestamp: string,
): void {
  expect(wallMs).toBeGreaterThanOrEqual(Date.parse(lowerTimestamp));
  expect(wallMs).toBeLessThanOrEqual(Date.parse(upperTimestamp));
}

describe("deepFreeze", () => {
  it("handles primitives, functions, already-frozen parents, and cycles", () => {
    const identity = (value: string): string => value;
    const alreadyFrozen = Object.freeze({ nested: { value: 1 } });
    const cyclic: { self?: object } = {};
    cyclic.self = cyclic;

    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze(identity)).toBe(identity);
    expect(deepFreeze(alreadyFrozen)).toBe(alreadyFrozen);
    expect(Object.isFrozen(alreadyFrozen.nested)).toBe(true);
    expect(deepFreeze(cyclic)).toBe(cyclic);
    expect(Object.isFrozen(cyclic)).toBe(true);
  });
});

describe("history and pinboard contract fixtures", () => {
  it("parses every entity, keeps exact identities and timestamps, and freezes top arrays", () => {
    expect(historyFixture.map(({ id }) => id)).toEqual(HISTORY_IDS);
    expect(new Set(historyFixture.map(({ id }) => id)).size).toBe(
      HISTORY_IDS.length,
    );
    expect(
      historyFixture.map(({ copiedAt, updatedAt }) => [copiedAt, updatedAt]),
    ).toEqual(HISTORY_TIMESTAMPS);
    expect(
      pinboardFixture.map(({ createdAt, updatedAt }) => [createdAt, updatedAt]),
    ).toEqual(PINBOARD_TIMESTAMPS);
    expect(Object.isFrozen(historyFixture)).toBe(true);
    expect(Object.isFrozen(pinboardFixture)).toBe(true);

    for (const item of historyFixture) {
      expect(PasteItemSchema.parse(item)).toEqual(item);
      expect(Number.isNaN(Date.parse(item.copiedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false);
    }
    for (const pinboard of pinboardFixture) {
      expect(PinboardSchema.parse(pinboard)).toEqual(pinboard);
      expect(Number.isNaN(Date.parse(pinboard.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(pinboard.updatedAt))).toBe(false);
    }

    expect(pinboardFixture.map(({ id, orderKey }) => [id, orderKey])).toEqual([
      ["board-work", "a0"],
      ["board-reference", "a2"],
    ]);
    expect(
      historyFixture.filter(({ pinboardId }) => pinboardId).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("returns the fixed invoice ranking from real query scoring and capture times", () => {
    const mutableHistory = structuredClone(historyFixture) as unknown as PasteItem[];

    expect(
      searchPasteItems(mutableHistory, "invoice").map(({ id }) => id),
    ).toEqual(["url-middle", "text-old", "image-new"]);
  });

  it("deep-freezes every nested history and pinboard value", () => {
    for (const item of historyFixture) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.payload)).toBe(true);
      if (item.sourceApp !== undefined) {
        expect(Object.isFrozen(item.sourceApp)).toBe(true);
      }
      if (item.payload.filePaths !== undefined) {
        expect(Object.isFrozen(item.payload.filePaths)).toBe(true);
      }
      expectFrozenClocks(item.fieldClocks);
    }

    for (const pinboard of pinboardFixture) {
      expect(Object.isFrozen(pinboard)).toBe(true);
      expectFrozenClocks(pinboard.fieldClocks);
    }
  });

  it("keeps every entity field clock inside its lifecycle", () => {
    for (const item of historyFixture) {
      for (const clock of Object.values(item.fieldClocks)) {
        expectClockInRange(clock.wallMs, item.copiedAt, item.updatedAt);
      }
    }

    for (const pinboard of pinboardFixture) {
      for (const clock of Object.values(pinboard.fieldClocks)) {
        expectClockInRange(clock.wallMs, pinboard.createdAt, pinboard.updatedAt);
      }
    }
  });
});

describe("keyboard contract fixtures", () => {
  it("replays selection actions with the expected anchor and focus", () => {
    let state = structuredClone(
      selectionKeyboardFixture.initial,
    ) as SelectionState;

    for (const step of selectionKeyboardFixture.steps) {
      const action = structuredClone(step.action) as SelectionAction;
      state = reduceSelection(state, action);
      expect(state.selected).toEqual(step.expectedSelected);
      expect(state.anchor).toBe(step.expectedAnchor);
      expect(state.focus).toBe(step.expectedFocus);
    }
  });

  it("replays paste-stack actions including deduplication and direction changes", () => {
    let state = structuredClone(
      pasteStackKeyboardFixture.initial,
    ) as PasteStackState;

    for (const step of pasteStackKeyboardFixture.steps) {
      const action = structuredClone(step.action) as PasteStackAction;
      state = reducePasteStack(state, action);
      expect(state).toEqual({
        itemIds: step.expectedItemIds,
        direction: step.expectedDirection,
      });
    }
  });

  it("deep-freezes keyboard states, steps, events, actions, and arrays", () => {
    expect(Object.isFrozen(selectionKeyboardFixture)).toBe(true);
    expect(Object.isFrozen(selectionKeyboardFixture.orderedIds)).toBe(true);
    expect(Object.isFrozen(selectionKeyboardFixture.initial)).toBe(true);
    expect(Object.isFrozen(selectionKeyboardFixture.initial.selected)).toBe(true);
    expect(Object.isFrozen(selectionKeyboardFixture.steps)).toBe(true);

    for (const step of selectionKeyboardFixture.steps) {
      expect(Object.isFrozen(step)).toBe(true);
      expect(Object.isFrozen(step.event)).toBe(true);
      expect(Object.isFrozen(step.action)).toBe(true);
      expect(Object.isFrozen(step.expectedSelected)).toBe(true);
      if ("orderedIds" in step.action) {
        expect(Object.isFrozen(step.action.orderedIds)).toBe(true);
      }
    }

    expect(Object.isFrozen(pasteStackKeyboardFixture)).toBe(true);
    expect(Object.isFrozen(pasteStackKeyboardFixture.initial)).toBe(true);
    expect(Object.isFrozen(pasteStackKeyboardFixture.initial.itemIds)).toBe(true);
    expect(Object.isFrozen(pasteStackKeyboardFixture.steps)).toBe(true);

    for (const step of pasteStackKeyboardFixture.steps) {
      expect(Object.isFrozen(step)).toBe(true);
      expect(Object.isFrozen(step.action)).toBe(true);
      expect(Object.isFrozen(step.expectedItemIds)).toBe(true);
      if ("itemIds" in step.action) {
        expect(Object.isFrozen(step.action.itemIds)).toBe(true);
      }
    }
  });
});

describe("sync contract fixtures", () => {
  it("merges concurrent field edits without mutating either fixture side", () => {
    const pasteSnapshot = structuredClone(concurrentPasteItemEdits);
    const pinboardSnapshot = structuredClone(concurrentPinboardEdits);
    const pasteEdits = structuredClone(concurrentPasteItemEdits) as {
      left: PasteItem;
      right: PasteItem;
    };
    const pinboardEdits = structuredClone(concurrentPinboardEdits) as {
      left: Pinboard;
      right: Pinboard;
    };

    const mergedPaste = mergePasteItem(
      pasteEdits.left,
      pasteEdits.right,
    );
    const mergedPinboard = mergePinboard(
      pinboardEdits.left,
      pinboardEdits.right,
    );

    expect({
      title: mergedPaste.title,
      pinboardId: mergedPaste.pinboardId,
    }).toEqual(concurrentPasteItemEdits.expected);
    expect({
      name: mergedPinboard.name,
      color: mergedPinboard.color,
    }).toEqual(concurrentPinboardEdits.expected);
    expect(concurrentPasteItemEdits).toEqual(pasteSnapshot);
    expect(concurrentPinboardEdits).toEqual(pinboardSnapshot);
  });

  it("lets the newer tombstone win without changing the live or deleted fixture", () => {
    const snapshot = structuredClone(tombstoneFixture);
    const mutableFixture = structuredClone(tombstoneFixture) as {
      live: PasteItem;
      tombstone: Tombstone;
    };

    expect(
      mergeEntity(mutableFixture.live, mutableFixture.tombstone),
    ).toMatchObject({ id: "text-old", deleted: true });
    expect(tombstoneFixture).toEqual(snapshot);
  });

  it("deep-freezes sync edits, expected values, tombstones, and clocks", () => {
    for (const fixture of [
      concurrentPasteItemEdits,
      concurrentPinboardEdits,
    ]) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.left)).toBe(true);
      expect(Object.isFrozen(fixture.right)).toBe(true);
      expect(Object.isFrozen(fixture.expected)).toBe(true);
      expectFrozenClocks(fixture.left.fieldClocks);
      expectFrozenClocks(fixture.right.fieldClocks);
    }

    expect(Object.isFrozen(concurrentPasteItemEdits.left.sourceApp)).toBe(true);
    expect(Object.isFrozen(concurrentPasteItemEdits.right.sourceApp)).toBe(true);
    expect(Object.isFrozen(concurrentPasteItemEdits.left.payload)).toBe(true);
    expect(Object.isFrozen(concurrentPasteItemEdits.right.payload)).toBe(true);
    expect(Object.isFrozen(tombstoneFixture)).toBe(true);
    expect(Object.isFrozen(tombstoneFixture.live)).toBe(true);
    expect(Object.isFrozen(tombstoneFixture.live.sourceApp)).toBe(true);
    expect(Object.isFrozen(tombstoneFixture.live.payload)).toBe(true);
    expectFrozenClocks(tombstoneFixture.live.fieldClocks);
    expect(Object.isFrozen(tombstoneFixture.tombstone)).toBe(true);
    expect(Object.isFrozen(tombstoneFixture.tombstone.clock)).toBe(true);
  });

  it("keeps sync clocks inside lifecycle bounds while preserving winners", () => {
    for (const side of [
      concurrentPasteItemEdits.left,
      concurrentPasteItemEdits.right,
    ]) {
      for (const clock of Object.values(side.fieldClocks)) {
        expectClockInRange(clock.wallMs, side.copiedAt, side.updatedAt);
      }
    }
    for (const side of [
      concurrentPinboardEdits.left,
      concurrentPinboardEdits.right,
    ]) {
      for (const clock of Object.values(side.fieldClocks)) {
        expectClockInRange(clock.wallMs, side.createdAt, side.updatedAt);
      }
    }
    for (const clock of Object.values(tombstoneFixture.live.fieldClocks)) {
      expectClockInRange(
        clock.wallMs,
        tombstoneFixture.live.copiedAt,
        tombstoneFixture.live.updatedAt,
      );
    }
    expect(tombstoneFixture.tombstone.clock.wallMs).toBe(
      Date.parse(tombstoneFixture.tombstone.deletedAt),
    );

    expect(concurrentPasteItemEdits.left.fieldClocks.title!.wallMs).toBeGreaterThan(
      concurrentPasteItemEdits.right.fieldClocks.title!.wallMs,
    );
    expect(
      concurrentPasteItemEdits.right.fieldClocks.pinboardId!.wallMs,
    ).toBeGreaterThan(
      concurrentPasteItemEdits.left.fieldClocks.pinboardId!.wallMs,
    );
    expect(concurrentPinboardEdits.left.fieldClocks.name!.wallMs).toBeGreaterThan(
      concurrentPinboardEdits.right.fieldClocks.name!.wallMs,
    );
    expect(
      concurrentPinboardEdits.right.fieldClocks.color!.wallMs,
    ).toBeGreaterThan(
      concurrentPinboardEdits.left.fieldClocks.color!.wallMs,
    );
  });
});

describe("AES-256-GCM fixed-byte contract vector", () => {
  it("keeps the exact NIST-style values, valid hex, byte lengths, and frozen identity", () => {
    expect(aes256GcmZeroVector).toEqual({
      algorithm: "AES-256-GCM",
      keyHex: "0000000000000000000000000000000000000000000000000000000000000000",
      nonceHex: "000000000000000000000000",
      plaintextHex: "00000000000000000000000000000000",
      aadHex: "",
      ciphertextHex: "cea7403d4d606b6e074ec5d3baf39d18",
      tagHex: "d0d1c8a799996bf0265b98b5d48ab919",
    });
    expect(Object.isFrozen(aes256GcmZeroVector)).toBe(true);

    for (const value of [
      aes256GcmZeroVector.keyHex,
      aes256GcmZeroVector.nonceHex,
      aes256GcmZeroVector.plaintextHex,
      aes256GcmZeroVector.aadHex,
      aes256GcmZeroVector.ciphertextHex,
      aes256GcmZeroVector.tagHex,
    ]) {
      expect(value).toMatch(/^(?:[0-9a-f]{2})*$/);
    }

    expect(aes256GcmZeroVector.keyHex.length / 2).toBe(32);
    expect(aes256GcmZeroVector.nonceHex.length / 2).toBe(12);
    expect(aes256GcmZeroVector.plaintextHex.length / 2).toBe(16);
    expect(aes256GcmZeroVector.ciphertextHex.length / 2).toBe(16);
    expect(aes256GcmZeroVector.tagHex.length / 2).toBe(16);
  });

  it("matches the fixed vector with Node native crypto", () => {
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(aes256GcmZeroVector.keyHex, "hex"),
      Buffer.from(aes256GcmZeroVector.nonceHex, "hex"),
    );
    cipher.setAAD(Buffer.from(aes256GcmZeroVector.aadHex, "hex"));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(aes256GcmZeroVector.plaintextHex, "hex")),
      cipher.final(),
    ]);

    expect(ciphertext.toString("hex")).toBe(
      aes256GcmZeroVector.ciphertextHex,
    );
    expect(cipher.getAuthTag().toString("hex")).toBe(aes256GcmZeroVector.tagHex);
  });
});

describe("fixture source determinism and public imports", () => {
  it("does not generate runtime identities or timestamps", async () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceFiles = (await readdir(sourceDirectory)).filter((file: string) =>
      file.endsWith(".ts"),
    );
    const sources = await Promise.all(
      sourceFiles.map((file: string) =>
        readFile(new URL(file, sourceDirectory), "utf8"),
      ),
    );

    expect(sourceFiles).toEqual(
      expect.arrayContaining([
        "freeze.ts",
        "history.ts",
        "index.ts",
        "keyboard.ts",
        "sync.ts",
      ]),
    );
    expect(sourceFiles).toHaveLength(new Set(sourceFiles).size);
    for (const source of sources) {
      expect(source).not.toMatch(/Date\s*\.\s*now\s*\(/);
      expect(source).not.toMatch(/Math\s*\.\s*random\s*\(/);
      expect(source).not.toMatch(/randomUUID\s*\(/);
      expect(source).not.toMatch(/getRandomValues\s*\(/);
      expect(source).not.toMatch(/new\s+Date\s*\(/);
    }
  });

  it("marks the package private while retaining all public exports", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { private?: boolean; exports?: Record<string, string> };

    expect(packageJson.private).toBe(true);
    expect(packageJson.exports).toEqual({
      ".": "./src/index.ts",
      "./history": "./src/history.ts",
      "./keyboard": "./src/keyboard.ts",
      "./sync": "./src/sync.ts",
    });
  });

  it("resolves the root and every subpath with the CI toolchain", async () => {
    const root = await import("@pasteboard-pro/contract-fixtures");

    expect(root.historyFixture).toBe(historySubmoduleFixture);
    expect(root.selectionKeyboardFixture).toBe(keyboardSubmoduleFixture);
    expect(root.aes256GcmZeroVector).toBe(syncSubmoduleFixture);
    expect("deepFreeze" in root).toBe(false);
  });

  it("rejects nested mutation without changing fixture values", () => {
    const originalText = historyFixture[0]!.payload.text;
    const originalKey = selectionKeyboardFixture.steps[0]!.event.key;
    const originalWallMs = tombstoneFixture.tombstone.clock.wallMs;
    const originalTag = aes256GcmZeroVector.tagHex;

    expect(Reflect.set(historyFixture[0]!.payload, "text", "mutated")).toBe(false);
    expect(
      Reflect.set(selectionKeyboardFixture.steps[0]!.event, "key", "Enter"),
    ).toBe(false);
    expect(
      Reflect.set(tombstoneFixture.tombstone.clock, "wallMs", 0),
    ).toBe(false);
    expect(Reflect.set(aes256GcmZeroVector, "tagHex", "00")).toBe(false);

    expect(historyFixture[0]!.payload.text).toBe(originalText);
    expect(selectionKeyboardFixture.steps[0]!.event.key).toBe(originalKey);
    expect(tombstoneFixture.tombstone.clock.wallMs).toBe(originalWallMs);
    expect(aes256GcmZeroVector.tagHex).toBe(originalTag);
  });

  it("exposes the root fixture API and each public source submodule", () => {
    expect(historySubmoduleFixture).toBe(historyFixture);
    expect(keyboardSubmoduleFixture).toBe(selectionKeyboardFixture);
    expect(syncSubmoduleFixture).toBe(aes256GcmZeroVector);
  });
});
