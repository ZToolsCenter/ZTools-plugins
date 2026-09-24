import { describe, expect, it } from "vitest";

import { PasteItemSchema, type PasteItem } from "@pasteboard-pro/core";
import { writeSourceDragData } from "../src/drag-content";

function item(overrides: Partial<PasteItem> = {}): PasteItem {
  return PasteItemSchema.parse({
    id: "item-1",
    kind: "text",
    sourceDeviceId: "device-1",
    copiedAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    contentFingerprint: "fingerprint-1",
    payload: { revision: "revision-1" },
    pinned: false,
    fieldClocks: {},
    ...overrides,
  });
}

function transfer(): {
  setData: (format: string, data: string) => void;
  effectAllowed: string;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    setData(format, data) {
      values.set(format, data);
    },
    effectAllowed: "none",
    values,
  };
}

describe("source clipboard drag data", () => {
  it("exposes the original plain text to external drop targets", () => {
    const dataTransfer = transfer();

    writeSourceDragData(
      item({ payload: { revision: "revision-1", text: "actual source text" } }),
      dataTransfer,
    );

    expect(dataTransfer.values).toEqual(
      new Map([
        ["application/x-pasteboard-pro-item", "item-1"],
        ["text/plain", "actual source text"],
      ]),
    );
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("provides both plain and rich source formats for rich text", () => {
    const dataTransfer = transfer();

    writeSourceDragData(
      item({
        kind: "rich_text",
        payload: {
          revision: "revision-1",
          text: "plain source",
          html: "<strong>rich source</strong>",
        },
      }),
      dataTransfer,
    );

    expect(dataTransfer.values.get("text/plain")).toBe("plain source");
    expect(dataTransfer.values.get("text/html")).toBe("<strong>rich source</strong>");
  });

  it("does not turn image or file records into internal links", () => {
    for (const clipboardItem of [
      item({
        id: "image-1",
        kind: "image",
        payload: {
          revision: "revision-image",
          text: "https://example.test/image",
          blobId: "blob-image",
        },
      }),
      item({
        id: "files-1",
        kind: "files",
        payload: {
          revision: "revision-files",
          text: "https://example.test/files",
          filePaths: ["/tmp/report.pdf"],
        },
      }),
    ]) {
      const dataTransfer = transfer();
      writeSourceDragData(clipboardItem, dataTransfer);

      expect(dataTransfer.values).toEqual(
        new Map([["application/x-pasteboard-pro-item", clipboardItem.id]]),
      );
      expect(dataTransfer.effectAllowed).toBe("copy");
    }
  });
});
