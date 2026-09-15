import { describe, expect, it, vi } from "vitest";

import { PasteItemSchema } from "@pasteboard-pro/core";
import type { CanonicalClipboardRecord } from "../preload/clipboard-store";
import {
  copyCanonicalRecord,
  directPasteTarget,
  pasteCanonicalRecord,
  withRichClipboard,
} from "../preload/paste-item";

function record(overrides: Partial<CanonicalClipboardRecord> = {}): CanonicalClipboardRecord {
  return {
    item: PasteItemSchema.parse({
      id: "item-1",
      kind: "html",
      sourceDeviceId: "device-1",
      copiedAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      contentFingerprint: "sha256:test",
      payload: {
        revision: "sha256:payload",
        text: "Plain fallback",
        html: "<strong>Rich value</strong>",
      },
      pinned: false,
      fieldClocks: {},
    }),
    origin: { host: "ztools", hostItemId: "host-1", hostType: "text" },
    ...overrides,
  };
}

describe("canonical direct paste", () => {
  it("uses the canonical source content instead of the disposable host record", () => {
    expect(directPasteTarget(record())).toEqual({
      type: "content",
      content: {
        type: "html",
        content: {
          text: "Plain fallback",
          html: "<strong>Rich value</strong>",
        },
      },
    });
  });

  it("writes canonical HTML and returns focus before simulating paste", async () => {
    const calls: string[] = [];
    const baseHost = {
      write: vi.fn(async () => false),
      writeContent: vi.fn(async () => ({ success: true })),
    };
    const write = vi.fn(() => calls.push("write"));
    const host = withRichClipboard(baseHost, {
      write,
      leavePlugin: () => calls.push("leave"),
      waitForTarget: async () => { calls.push("wait"); },
      simulatePaste: () => calls.push("paste"),
    });

    await expect(pasteCanonicalRecord(record(), host)).resolves.toEqual({
      status: "pasted",
    });
    expect(write).toHaveBeenCalledWith({
      text: "Plain fallback",
      html: "<strong>Rich value</strong>",
    });
    expect(calls).toEqual(["write", "leave", "wait", "paste"]);
    expect(baseHost.writeContent).not.toHaveBeenCalled();
  });

  it("uses canonical text for Shift-Return and Shift-Command quick paste", () => {
    expect(directPasteTarget(record(), true)).toEqual({
      type: "content",
      content: { type: "text", content: "Plain fallback" },
    });
  });

  it("uses canonical image and file sources supported by ZTools", () => {
    const baseItem = record().item;
    const imageRecord = record({
      item: PasteItemSchema.parse({
        ...baseItem,
        kind: "image",
        payload: { revision: "image-revision", mediaType: "image/png" },
      }),
      origin: {
        host: "ztools",
        hostItemId: "image-host-id",
        hostType: "image",
        imagePath: "/tmp/source.png",
      },
    });
    const fileRecord = record({
      item: PasteItemSchema.parse({
        ...baseItem,
        kind: "files",
        payload: {
          revision: "files-revision",
          filePaths: ["/tmp/source-a.txt", "/tmp/source-b.txt"],
        },
      }),
      origin: {
        host: "ztools",
        hostItemId: "file-host-id",
        hostType: "file",
      },
    });

    expect(directPasteTarget(imageRecord)).toEqual({
      type: "content",
      content: { type: "image", content: "/tmp/source.png" },
    });
    expect(directPasteTarget(fileRecord)).toEqual({
      type: "content",
      content: {
        type: "file",
        content: ["/tmp/source-a.txt", "/tmp/source-b.txt"],
      },
    });
  });

  it("preserves the copy-only fallback when direct insertion is denied", async () => {
    const host = {
      write: vi.fn().mockRejectedValueOnce(new Error("denied")),
      writeContent: vi
        .fn()
        .mockRejectedValueOnce(new Error("denied"))
        .mockResolvedValueOnce({ success: true }),
    };
    await expect(pasteCanonicalRecord(record(), host, true)).resolves.toEqual({
      status: "accessibility_required",
      directPasteError: "denied",
    });
    expect(host.writeContent.mock.calls).toEqual([
      [{ type: "text", content: "Plain fallback" }, true],
      [{ type: "text", content: "Plain fallback" }, false],
    ]);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("pastes canonical history content without reading the host id", async () => {
    const host = {
      write: vi.fn(async () => false),
      writeContent: vi.fn(async () => ({ success: true })),
    };

    await expect(pasteCanonicalRecord(record(), host, true)).resolves.toEqual({
      status: "pasted",
    });
    expect(host.writeContent).toHaveBeenCalledWith(
      { type: "text", content: "Plain fallback" },
      true,
    );
    expect(host.write).not.toHaveBeenCalled();
  });

  it("copies without ever requesting direct insertion", async () => {
    const host = {
      write: vi.fn(async () => true),
      writeContent: vi.fn(async () => ({ success: true })),
    };
    await copyCanonicalRecord(record(), host, true);
    expect(host.writeContent).toHaveBeenCalledWith(
      { type: "text", content: "Plain fallback" },
      false,
    );
    expect(host.write).not.toHaveBeenCalled();
  });

  it("rejects copy when the host returns an unsuccessful result object", async () => {
    const host = {
      write: vi.fn(async () => ({ success: false })),
      writeContent: vi.fn(async () => ({ success: false })),
    };

    await expect(copyCanonicalRecord(record(), host, true)).rejects.toThrow(
      "ZTools 未能复制所选剪贴板内容",
    );
  });
});
