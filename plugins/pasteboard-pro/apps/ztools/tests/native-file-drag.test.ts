import { describe, expect, it, vi } from "vitest";

import {
  normalizeHostClipboardItem,
  type CanonicalClipboardRecord,
} from "../preload/clipboard-store";
import { NativeFileDragService } from "../preload/native-file-drag";

function record(input: Record<string, unknown>): CanonicalClipboardRecord {
  const normalized = normalizeHostClipboardItem(input, "native-file-drag-test");
  if (normalized === null) throw new Error("Expected a clipboard record");
  return normalized;
}

describe("ZTools native file drag", () => {
  it("drags a clipboard image as one native file", () => {
    const image = record({
      id: "image-1",
      type: "image",
      timestamp: 100,
      imagePath: "/tmp/image-1.png",
    });
    const startDrag = vi.fn();
    const service = new NativeFileDragService(
      { findRecordByItemId: async () => undefined },
      { startDrag },
    );

    service.refresh([image]);

    expect(service.start(image.item.id)).toBe(true);
    expect(startDrag).toHaveBeenCalledWith("/tmp/image-1.png");
  });

  it("drags every path from a multi-file clipboard record", () => {
    const files = record({
      id: "files-1",
      type: "file",
      timestamp: 200,
      files: [
        { path: "/tmp/report.pdf", name: "report.pdf" },
        { path: "/tmp/archive.zip", name: "archive.zip" },
      ],
    });
    const startDrag = vi.fn();
    const service = new NativeFileDragService(
      { findRecordByItemId: async () => undefined },
      { startDrag },
    );

    service.refresh([files]);

    expect(service.start(files.item.id)).toBe(true);
    expect(startDrag).toHaveBeenCalledWith([
      "/tmp/report.pdf",
      "/tmp/archive.zip",
    ]);
  });

  it("prepares newly changed file records before dragging", async () => {
    const files = record({
      id: "files-2",
      type: "file",
      timestamp: 300,
      files: [{ path: "/tmp/document.docx", name: "document.docx" }],
    });
    const startDrag = vi.fn();
    const service = new NativeFileDragService(
      { findRecordByItemId: async () => files },
      { startDrag },
    );

    await expect(service.prepare(files.item.id)).resolves.toBe(true);
    expect(service.start(files.item.id)).toBe(true);
    expect(startDrag).toHaveBeenCalledWith("/tmp/document.docx");
  });

  it("rejects text records and relative file paths", () => {
    const text = record({
      id: "text-1",
      type: "text",
      timestamp: 400,
      content: "hello",
    });
    const relativeFiles = record({
      id: "files-relative",
      type: "file",
      timestamp: 500,
      files: [{ path: "relative.pdf", name: "relative.pdf" }],
    });
    const startDrag = vi.fn();
    const service = new NativeFileDragService(
      { findRecordByItemId: async () => undefined },
      { startDrag },
    );

    service.refresh([text, relativeFiles]);

    expect(service.start(text.item.id)).toBe(false);
    expect(service.start(relativeFiles.item.id)).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
  });

  it("falls back to the card drag when the native host rejects a file", () => {
    const files = record({
      id: "files-missing",
      type: "file",
      timestamp: 600,
      files: [{ path: "/tmp/missing.pdf", name: "missing.pdf" }],
    });
    const service = new NativeFileDragService(
      { findRecordByItemId: async () => undefined },
      {
        startDrag: () => {
          throw new Error("missing file");
        },
      },
    );
    service.refresh([files]);

    expect(service.start(files.item.id)).toBe(false);
    expect(service.start(files.item.id)).toBe(false);
  });
});
