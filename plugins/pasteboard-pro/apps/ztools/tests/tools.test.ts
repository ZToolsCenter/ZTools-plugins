import { describe, expect, it } from "vitest";

import type { PasteItem } from "@pasteboard-pro/core";

import { createSearchHistoryHandler } from "../preload/tools";

const item = (overrides: Partial<PasteItem> = {}): PasteItem => ({
  id: "item-1",
  kind: "text",
  title: "A".repeat(200),
  sourceApp: { name: "TextEdit" },
  sourceDeviceId: "device",
  copiedAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  contentFingerprint: "fp",
  payload: { revision: "rev", text: "x".repeat(700) },
  pinned: false,
  fieldClocks: {},
  ...overrides,
});

describe("search_history tool", () => {
  it("normalizes inputs and returns truncated canonical previews", async () => {
    const calls: Array<{ query: string; limit: number }> = [];
    const handler = createSearchHistoryHandler({
      async search(query, limit) {
        calls.push({ query, limit });
        return { items: [item()], total: 1 };
      },
    });

    await expect(handler({ query: "  invoice  ", limit: 999 })).resolves.toEqual({
      items: [
        {
          id: "item-1",
          kind: "text",
          title: "A".repeat(160),
          copiedAt: "2026-07-16T10:00:00.000Z",
          sourceApp: "TextEdit",
          preview: "x".repeat(500),
          truncated: true,
        },
      ],
      total: 1,
    });
    expect(calls).toEqual([{ query: "invoice", limit: 100 }]);
  });

  it("returns file names without exposing absolute paths", async () => {
    const handler = createSearchHistoryHandler({
      async search() {
        return {
          items: [
            item({
              kind: "files",
              payload: {
                revision: "files-rev",
                filePaths: ["/Users/private/secret.pdf", "C:\\work\\brief.docx"],
              },
            }),
          ],
          total: 1,
        };
      },
    });

    const result = await handler();
    expect(result.items[0]).toMatchObject({
      files: ["secret.pdf", "brief.docx"],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("/Users/private");
    expect(JSON.stringify(result)).not.toContain("C:\\work");
  });

  it("uses safe defaults for malformed runtime input", async () => {
    const calls: Array<{ query: string; limit: number }> = [];
    const handler = createSearchHistoryHandler({
      async search(query, limit) {
        calls.push({ query, limit });
        return { items: [], total: 0 };
      },
    });

    await handler({ query: 42, limit: Number.NaN } as never);
    expect(calls).toEqual([{ query: "", limit: 20 }]);
  });
});
