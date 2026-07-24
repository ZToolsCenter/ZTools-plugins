import { describe, expect, it, vi } from "vitest";

import {
  isCapturePaused,
  defaultPrivacySettings,
  performDirectPaste,
  planRetentionPrune,
  shouldPersistClipboard,
  ZToolsPrivacySettingsStore,
  type ClipboardPrivacyRules,
} from "../preload/privacy";
import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";

const rules: ClipboardPrivacyRules = {
  ignoredBundleIds: ["com.1password.1password"],
  blockLikelySecrets: true,
  contentRules: [
    { type: "literal", value: "PRIVATE NOTE" },
    { type: "wildcard", value: "card-*-secret" },
    { type: "regex", value: "^internal-[0-9]{4}$", flags: "i" },
  ],
};

describe("clipboard privacy", () => {
  it("blocks ignored apps, confidential markers, secrets, and user rules", () => {
    expect(
      shouldPersistClipboard(
        { sourceBundleId: "com.1password.1password", text: "hello" },
        rules,
      ),
    ).toBe(false);
    expect(shouldPersistClipboard({ confidential: true }, rules)).toBe(false);
    expect(
      shouldPersistClipboard({ text: "Bearer abcdefghijklmnopqrstuvwxyz012345" }, rules),
    ).toBe(false);
    expect(shouldPersistClipboard({ text: "PRIVATE NOTE" }, rules)).toBe(false);
    expect(shouldPersistClipboard({ text: "card-payroll-secret" }, rules)).toBe(
      false,
    );
    expect(shouldPersistClipboard({ text: "INTERNAL-2026" }, rules)).toBe(false);
    expect(
      shouldPersistClipboard(
        { sourceBundleId: "com.apple.TextEdit", text: "ordinary text" },
        rules,
      ),
    ).toBe(true);
  });

  it("rejects unsafe or oversized regular expressions", () => {
    expect(() =>
      shouldPersistClipboard(
        { text: "aaaa" },
        {
          ignoredBundleIds: [],
          blockLikelySecrets: false,
          contentRules: [{ type: "regex", value: "(a+)+$" }],
        },
      ),
    ).toThrow(/unsafe/i);
    expect(() =>
      shouldPersistClipboard(
        { text: "x" },
        {
          ignoredBundleIds: [],
          blockLikelySecrets: false,
          contentRules: [{ type: "regex", value: "x".repeat(257) }],
        },
      ),
    ).toThrow(/256/);
  });

  it("supports indefinite and timed capture pauses", () => {
    expect(isCapturePaused({ paused: true }, Date.parse("2026-07-16T10:00:00Z"))).toBe(
      true,
    );
    expect(
      isCapturePaused(
        { paused: true, resumeAt: "2026-07-16T11:00:00Z" },
        Date.parse("2026-07-16T10:00:00Z"),
      ),
    ).toBe(true);
    expect(
      isCapturePaused(
        { paused: true, resumeAt: "2026-07-16T09:00:00Z" },
        Date.parse("2026-07-16T10:00:00Z"),
      ),
    ).toBe(false);
  });

  it("persists pause settings and retries a database conflict", async () => {
    let document: Record<string, unknown> | undefined;
    let conflict = true;
    const database: ZToolsDocumentDatabase = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        if (conflict) {
          conflict = false;
          throw { status: 409 };
        }
        document = { ...structuredClone(next), _rev: "2-test" };
        return { ok: true };
      },
    };
    const store = new ZToolsPrivacySettingsStore(database);
    const settings = {
      pause: { paused: true } as const,
      rules,
      retention: { days: 30, maxBlobBytes: 512 * 1_024 * 1_024 },
      screenShareProtection: false,
    };

    await store.put(settings);
    await expect(store.get()).resolves.toEqual(settings);
  });

  it("upgrades legacy privacy documents with safe retention and screen-share defaults", async () => {
    const database: ZToolsDocumentDatabase = {
      async get() {
        return {
          _id: "pasteboard-pro:settings:privacy",
          settings: {
            pause: { paused: false },
            rules: {
              ignoredBundleIds: [],
              blockLikelySecrets: true,
              contentRules: [],
            },
          },
        };
      },
      async put() {
        return { ok: true };
      },
    };
    await expect(new ZToolsPrivacySettingsStore(database).get()).resolves.toMatchObject({
      retention: { days: 90, maxBlobBytes: 1_073_741_824 },
      screenShareProtection: true,
    });
  });

  it("rejects unsafe retention settings before persistence", async () => {
    const store = new ZToolsPrivacySettingsStore({
      async get() {
        throw { status: 404 };
      },
      async put() {
        return { ok: true };
      },
    });
    await expect(
      store.put({
        ...defaultPrivacySettings,
        retention: { days: 0, maxBlobBytes: 1_073_741_824 },
      }),
    ).rejects.toThrow(/between 1 and 3650/i);
  });
});

describe("retention", () => {
  it("removes expired and over-budget unprotected blobs but preserves Pinboards", () => {
    const result = planRetentionPrune(
      [
        {
          id: "expired",
          copiedAt: "2026-01-01T00:00:00Z",
          blobBytes: 40,
          pinned: false,
        },
        {
          id: "pinboard-item",
          copiedAt: "2026-01-01T00:00:00Z",
          blobBytes: 80,
          pinned: false,
          pinboardId: "board-work",
        },
        {
          id: "old-large",
          copiedAt: "2026-07-14T00:00:00Z",
          blobBytes: 70,
          pinned: false,
        },
        {
          id: "new-small",
          copiedAt: "2026-07-15T00:00:00Z",
          blobBytes: 20,
          pinned: false,
        },
      ],
      {
        days: 90,
        maxBlobBytes: 100,
        now: "2026-07-16T00:00:00Z",
      },
    );

    expect(result.deletedIds).toEqual(["expired", "old-large"]);
    expect(result.deletedIds).not.toContain("pinboard-item");
    expect(result.remainingBlobBytes).toBe(100);
    expect(result.overBudget).toBe(false);
  });

  it("reports unavoidable protected overage without deleting protected items", () => {
    expect(
      planRetentionPrune(
        [
          {
            id: "protected",
            copiedAt: "2026-01-01T00:00:00Z",
            blobBytes: 120,
            pinned: true,
          },
        ],
        { days: 1, maxBlobBytes: 100, now: "2026-07-16T00:00:00Z" },
      ),
    ).toEqual({
      deletedIds: [],
      remainingBlobBytes: 120,
      overBudget: true,
    });
  });
});

describe("direct paste", () => {
  it("uses the host-native write path when available", async () => {
    const write = vi.fn(async () => undefined);
    const writeContent = vi.fn(async () => undefined);

    await expect(
      performDirectPaste(
        { type: "host", hostItemId: "host-1" },
        { write, writeContent },
      ),
    ).resolves.toEqual({ status: "pasted" });
    expect(write).toHaveBeenCalledWith("host-1", true);
    expect(writeContent).not.toHaveBeenCalled();
  });

  it("falls back to copy-only and reports accessibility requirements", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("paste denied"))
      .mockResolvedValueOnce(undefined);

    await expect(
      performDirectPaste(
        { type: "host", hostItemId: "host-1" },
        { write, writeContent: vi.fn() },
      ),
    ).resolves.toEqual({
      status: "accessibility_required",
      directPasteError: "paste denied",
    });
    expect(write).toHaveBeenNthCalledWith(1, "host-1", true);
    expect(write).toHaveBeenNthCalledWith(2, "host-1", false);
  });

  it("writes canonical content for synced or plugin-owned items", async () => {
    const writeContent = vi.fn(async () => undefined);

    await expect(
      performDirectPaste(
        { type: "content", content: { type: "text", content: "hello" } },
        { write: vi.fn(), writeContent },
      ),
    ).resolves.toEqual({ status: "pasted" });
    expect(writeContent).toHaveBeenCalledWith(
      { type: "text", content: "hello" },
      true,
    );
  });
});
