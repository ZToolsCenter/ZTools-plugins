import { afterEach, describe, expect, it, vi } from "vitest";

import type { PasteItem, PasteStackDirection } from "@pasteboard-pro/core";

import type {
  CanonicalClipboardRecord,
  ZToolsDocumentDatabase,
} from "../preload/clipboard-store";
import {
  PasteStackRuntime,
  type ClipboardWriter,
  type GlobalPasteHook,
} from "../preload/paste-stack-runtime";
import { ZToolsPasteStackStore } from "../preload/paste-stack-store";
import type { NativeImageApi, NativeImageLike } from "../preload/thumbnail";

const ENTRY_COUNT = 100;
const FIXTURE_ROOT = "/private/tmp/paste-stack-large-fixtures";

type FixtureKind = "text" | "html" | "image" | "files";
type ClipboardOutput =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "html"; text: string; html: string }>
  | Readonly<{ type: "image"; imagePath: string }>
  | Readonly<{ type: "files"; format: string; encoded: string }>;
type ExpectedOutput =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "html"; text: string; html: string }>
  | Readonly<{ type: "image"; imagePath: string }>
  | Readonly<{ type: "files"; format: string; filePaths: string[] }>;

function fixtureRecord(index: number): CanonicalClipboardRecord {
  const itemId = `mixed-${String(index).padStart(3, "0")}`;
  const kind: FixtureKind = (["text", "html", "image", "files"] as const)[index % 4]!;
  const timestamp = "2026-10-25T00:00:00.000Z";
  const base = {
    id: itemId,
    sourceDeviceId: "synthetic-large-queue-fixture",
    copiedAt: timestamp,
    updatedAt: timestamp,
    contentFingerprint: `fingerprint-${itemId}`,
    pinned: false,
    fieldClocks: {},
  };

  if (kind === "text") {
    return {
      item: {
        ...base,
        kind: "text",
        payload: { revision: "fixture-v1", text: `fixture-text-${itemId}` },
      },
      origin: { host: "sync", remoteAvailable: true },
    };
  }
  if (kind === "html") {
    return {
      item: {
        ...base,
        kind: "html",
        payload: {
          revision: "fixture-v1",
          text: `fixture-html-text-${itemId}`,
          html: `<p data-fixture-id="${itemId}">fixture-html-${itemId}</p>`,
        },
      },
      origin: { host: "sync", remoteAvailable: true },
    };
  }
  if (kind === "image") {
    return {
      item: {
        ...base,
        kind: "image",
        payload: { revision: "fixture-v1", mediaType: "image/png" },
      },
      origin: {
        host: "sync",
        remoteAvailable: true,
        imagePath: `${FIXTURE_ROOT}/${itemId}.png`,
      },
    };
  }
  return {
    item: {
      ...base,
      kind: "files",
      payload: {
        revision: "fixture-v1",
        filePaths: [
          `${FIXTURE_ROOT}/${itemId}-a.txt`,
          `${FIXTURE_ROOT}/${itemId}-b.txt`,
        ],
      },
    },
    origin: { host: "sync", remoteAvailable: true },
  };
}

function memoryDatabase(): ZToolsDocumentDatabase {
  let document: Record<string, unknown> | undefined;
  let revision = 0;
  return {
    async get() {
      if (document === undefined) throw { status: 404 };
      return structuredClone(document);
    },
    async put(next) {
      revision += 1;
      document = { ...structuredClone(next), _rev: `${revision}-memory` };
      return { ok: true, rev: `${revision}-memory` };
    },
  };
}

function expectedFileFormat(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "NSFilenamesPboardType";
  if (platform === "win32") return "FileNameW";
  if (platform === "linux") return "text/uri-list";
  throw new Error(`Unsupported test platform: ${platform}`);
}

function expectedOutput(record: CanonicalClipboardRecord): ExpectedOutput {
  const { item, origin } = record;
  const filePaths = item.payload.filePaths?.filter((filePath) => filePath.length > 0);
  if (filePaths !== undefined && filePaths.length > 0) {
    return {
      type: "files",
      format: expectedFileFormat(process.platform),
      filePaths: [...filePaths],
    };
  }
  if (item.kind === "image" && origin.imagePath !== undefined) {
    return { type: "image", imagePath: origin.imagePath };
  }
  const text = item.payload.text ?? item.ocrText ?? "";
  if (item.payload.html !== undefined) {
    return { type: "html", text, html: item.payload.html };
  }
  return { type: "text", text };
}

function assertWritesMatch(
  records: readonly CanonicalClipboardRecord[],
  outputs: readonly ClipboardOutput[],
): void {
  expect(outputs).toHaveLength(records.length);
  records.forEach((record, index) => {
    const expected = expectedOutput(record);
    const actual = outputs[index];
    expect(actual?.type, `clipboard write type for ${record.item.id}`).toBe(expected.type);
    if (actual === undefined) return;
    if (expected.type === "text" && actual.type === "text") {
      expect(actual.text).toBe(expected.text);
    } else if (expected.type === "html" && actual.type === "html") {
      expect(actual.text).toBe(expected.text);
      expect(actual.html).toBe(expected.html);
    } else if (expected.type === "image" && actual.type === "image") {
      expect(actual.imagePath).toBe(expected.imagePath);
      expect(actual.imagePath).toContain(record.item.id);
    } else if (expected.type === "files" && actual.type === "files") {
      expect(actual.format).toBe(expected.format);
      for (const filePath of expected.filePaths) {
        expect(actual.encoded).toContain(filePath);
        expect(actual.encoded).toContain(record.item.id);
      }
    } else {
      throw new Error(`Unexpected clipboard output for ${record.item.id}`);
    }
  });
}

describe("paste stack large mixed queues", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["forward", "reverse"] as const)(
    "preserves and consumes all 100 mixed records in %s order, one per paste request",
    async (direction: PasteStackDirection) => {
      vi.useFakeTimers();
      const records = Array.from({ length: ENTRY_COUNT }, (_, index) => fixtureRecord(index));
      const recordsById = new Map(records.map((record) => [record.item.id, record]));
      const itemIds = records.map((record) => record.item.id);
      const outputs: ClipboardOutput[] = [];
      const changes: string[][] = [];
      const imagePaths = new WeakMap<NativeImageLike, string>();
      let pasteHandler: (() => boolean) | undefined;
      let hookStarts = 0;
      let hookStops = 0;
      let runtime: PasteStackRuntime | undefined;
      const stackStore = new ZToolsPasteStackStore(memoryDatabase());
      const clipboard: ClipboardWriter = {
        write(data) {
          outputs.push({ type: "html", text: data.text ?? "", html: data.html ?? "" });
        },
        writeText(text) {
          outputs.push({ type: "text", text });
        },
        writeImage(image) {
          const imagePath = imagePaths.get(image);
          if (imagePath === undefined) throw new Error("Image writer received an unknown fixture image");
          outputs.push({ type: "image", imagePath });
        },
        writeBuffer(format, buffer) {
          const encoding = process.platform === "win32" ? "utf16le" : "utf8";
          outputs.push({ type: "files", format, encoded: Buffer.from(buffer).toString(encoding) });
        },
      };
      const nativeImage: NativeImageApi = {
        createFromPath(imagePath) {
          let image: NativeImageLike;
          image = {
            isEmpty: () => false,
            resize: () => image,
            toJPEG: () => new Uint8Array([1]),
          };
          imagePaths.set(image, imagePath);
          return image;
        },
      };
      const hook: GlobalPasteHook = {
        start(callback) {
          hookStarts += 1;
          pasteHandler = callback;
        },
        stop() {
          hookStops += 1;
          pasteHandler = undefined;
        },
      };

      runtime = new PasteStackRuntime(
        stackStore,
        {
          async findRecordByItemId(itemId) {
            const record = recordsById.get(itemId);
            return record === undefined ? undefined : structuredClone(record);
          },
        },
        clipboard,
        nativeImage,
        hook,
        (state) => changes.push([...state.itemIds]),
      );

      try {
        await runtime.initialize();
        const replaced = await runtime.replace({ direction, itemIds });
        expect(replaced).toEqual({ direction, itemIds });
        expect(await stackStore.get()).toEqual({ direction, itemIds });
        expect(hookStarts).toBe(1);
        expect(pasteHandler).toBeTypeOf("function");
        expect(changes.at(-1)).toEqual(itemIds);

        const remainingAfter = (consumed: number): string[] =>
          direction === "forward"
            ? itemIds.slice(consumed)
            : itemIds.slice(0, ENTRY_COUNT - consumed);
        const firstPasteRequest = pasteHandler;
        expect(firstPasteRequest?.()).toBe(true);
        expect(outputs).toHaveLength(1);
        expect(changes.at(-1)).toEqual(remainingAfter(1));
        expect(changes.at(-1)).toHaveLength(99);
        await vi.advanceTimersByTimeAsync(99);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(vi.getTimerCount()).toBe(0);

        for (let consumed = 2; consumed <= ENTRY_COUNT; consumed += 1) {
          const request = pasteHandler;
          expect(request, `paste hook is active before request ${consumed}`).toBeTypeOf("function");
          expect(request?.()).toBe(true);
          expect(outputs).toHaveLength(consumed);
          expect(changes.at(-1)).toEqual(remainingAfter(consumed));
          await vi.advanceTimersByTimeAsync(100);
          expect(vi.getTimerCount()).toBe(0);
        }

        expect(pasteHandler).toBeUndefined();
        expect(hookStops).toBe(1);
        expect(changes).toEqual([
          [],
          itemIds,
          ...Array.from({ length: ENTRY_COUNT }, (_, index) => remainingAfter(index + 1)),
        ]);
        expect(changes.at(-1)).toEqual([]);
        expect(outputs).toHaveLength(ENTRY_COUNT);
        assertWritesMatch(
          direction === "forward" ? records : [...records].reverse(),
          outputs,
        );

        const refreshed = await runtime.refreshFromStore();
        expect(refreshed).toEqual({ direction, itemIds: [] });
        expect(await stackStore.get()).toEqual({ direction, itemIds: [] });
      } finally {
        runtime.dispose();
        await vi.runOnlyPendingTimersAsync();
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
      }
    },
  );
});
