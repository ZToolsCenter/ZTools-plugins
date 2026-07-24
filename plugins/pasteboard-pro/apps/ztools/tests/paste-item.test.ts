import { describe, expect, it, vi } from "vitest";

import { PasteItemSchema } from "@pasteboard-pro/core";
import type { CanonicalClipboardRecord } from "../preload/clipboard-store";
import {
  copyCanonicalRecord,
  directPasteTarget,
  pasteCanonicalRecord,
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
  it("uses the host-native record for formatted paste", () => {
    expect(directPasteTarget(record())).toEqual({
      type: "host",
      hostItemId: "host-1",
    });
  });

  it("uses canonical text for Shift-Return and Shift-Command quick paste", () => {
    expect(directPasteTarget(record(), true)).toEqual({
      type: "content",
      content: { type: "text", content: "Plain fallback" },
    });
  });

  it("preserves the copy-only fallback when direct insertion is denied", async () => {
    const host = {
      write: vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined),
      writeContent: vi.fn(),
    };
    await expect(pasteCanonicalRecord(record(), host)).resolves.toEqual({
      status: "accessibility_required",
      directPasteError: "denied",
    });
    expect(host.write.mock.calls).toEqual([
      ["host-1", true],
      ["host-1", false],
    ]);
  });

  it("copies without ever requesting direct insertion", async () => {
    const host = { write: vi.fn(), writeContent: vi.fn() };
    await copyCanonicalRecord(record(), host);
    expect(host.write).toHaveBeenCalledWith("host-1", false);
    expect(host.writeContent).not.toHaveBeenCalled();
  });
});
