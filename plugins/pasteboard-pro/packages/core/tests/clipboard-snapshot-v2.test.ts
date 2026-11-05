import { describe, expect, it } from "vitest";

import {
  ClipboardItemV2Schema,
  ClipboardRepresentationV2Schema,
  ClipboardSnapshotManifestV2Schema,
} from "../src/clipboard-snapshot-v2";

const sha256 = "a".repeat(64);

function readyBlob(key: string, formatId = "text/plain") {
  return {
    representationKey: key,
    formatId,
    nativeName: formatId,
    state: "ready" as const,
    storage: "blob" as const,
    fidelity: "exact" as const,
    byteLength: 4,
    sha256,
    blobRef: `blob:${key}`,
  };
}

function unavailable(key: string) {
  return {
    representationKey: key,
    formatId: "application/x-private",
    nativeName: "private",
    state: "unsupported" as const,
    reasonCode: "not-allowlisted",
  };
}

function source(platform: "macos" | "windows" | "linux") {
  const itemModels = {
    macos: "macos-items",
    windows: "windows-format-set",
    linux: "linux-clipboard",
  } as const;
  const sourceApplications = {
    macos: { kind: "bundle-id", identifier: "com.example.Editor" },
    windows: { kind: "aumid", identifier: "Example.Editor_123!Editor" },
    linux: { kind: "executable", identifier: "/usr/bin/example-editor" },
  } as const;

  return {
    hostEpoch: "host-epoch-1",
    platform,
    osRevision: "revision-19",
    capturedAt: "2026-10-27T16:00:00.000Z",
    osBuild: platform === "windows" ? "19045.7811" : "15.7.0",
    architecture: "x64",
    adapterVersion: "adapter-2",
    itemModel: itemModels[platform],
    sourceApplication: sourceApplications[platform],
    attribution: "trusted" as const,
  };
}

function manifest(
  platform: "macos" | "windows" | "linux",
  items: Array<{ index: number; representations: unknown[] }>,
) {
  const representations = items.flatMap((item) => item.representations);
  const captured = representations.filter(
    (representation) =>
      typeof representation === "object" &&
      representation !== null &&
      "state" in representation &&
      representation.state === "ready",
  ).length;

  return {
    schemaVersion: 2,
    snapshotId: "snapshot-1",
    manifestRevision: "revision-1",
    source: source(platform),
    policyReceiptId: "policy-1",
    items,
    coverage: {
      requested: representations.length,
      captured,
      omitted: representations.length - captured,
    },
    captureState:
      captured === representations.length ? "ready" : captured > 0 ? "partial" : "failed",
  };
}

describe("ClipboardRepresentationV2Schema", () => {
  it("requires a byte length, digest and blob reference for ready blobs", () => {
    const { byteLength: _byteLength, ...missingLength } = readyBlob("plain");
    const { sha256: _sha256, ...missingDigest } = readyBlob("plain");
    const { blobRef: _blobRef, ...missingBlob } = readyBlob("plain");

    expect(ClipboardRepresentationV2Schema.safeParse(missingLength).success).toBe(false);
    expect(ClipboardRepresentationV2Schema.safeParse(missingDigest).success).toBe(false);
    expect(ClipboardRepresentationV2Schema.safeParse(missingBlob).success).toBe(false);
  });

  it("accepts an exact file reference without inventing blob bytes", () => {
    const result = ClipboardRepresentationV2Schema.safeParse({
      representationKey: "files",
      formatId: "public.file-url",
      nativeName: "public.file-url",
      state: "ready",
      storage: "file-reference",
      fidelity: "reference",
      originDeviceId: "device-1",
      references: [
        { url: "file:///Users/example/Documents/plan.txt", isDirectory: false, observedAvailability: "available" },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty file-reference lists and falsified failure fidelity fields", () => {
    const validReference = {
      representationKey: "files",
      formatId: "public.file-url",
      nativeName: "public.file-url",
      state: "ready",
      storage: "file-reference",
      fidelity: "reference",
      originDeviceId: "device-1",
      references: [],
    };
    const invalidFailure = {
      ...unavailable("private"),
      fidelity: "exact",
      blobRef: "blob:private",
    };

    expect(ClipboardRepresentationV2Schema.safeParse(validReference).success).toBe(false);
    expect(ClipboardRepresentationV2Schema.safeParse(invalidFailure).success).toBe(false);
  });

  it("accepts only local file locators for file references", () => {
    const reference = {
      representationKey: "files",
      formatId: "CF_HDROP",
      nativeName: "CF_HDROP",
      state: "ready",
      storage: "file-reference",
      fidelity: "reference",
      originDeviceId: "device-1",
      references: [
        { url: "C:\\Docs\\one.txt", isDirectory: false, observedAvailability: "unknown" },
      ],
    };

    expect(ClipboardRepresentationV2Schema.safeParse(reference).success).toBe(true);
    for (const url of ["", "https://example.com/file.txt", "javascript:alert(1)"]) {
      expect(
        ClipboardRepresentationV2Schema.safeParse({
          ...reference,
          references: [{ ...reference.references[0], url }],
        }).success,
      ).toBe(false);
    }
  });

  it("preserves file path and URL strings exactly, including trailing spaces", () => {
    const reference = {
      representationKey: "files",
      formatId: "public.file-url",
      nativeName: "public.file-url",
      state: "ready",
      storage: "file-reference",
      fidelity: "reference",
      originDeviceId: "device-1",
      references: [
        { url: "/tmp/file ", isDirectory: false, observedAvailability: "available" },
        { url: "file:///tmp/file ", isDirectory: false, observedAvailability: "available" },
      ],
    };
    const parsed = ClipboardRepresentationV2Schema.parse(reference);

    expect(parsed).toMatchObject({
      storage: "file-reference",
      references: [
        { url: "/tmp/file ", isDirectory: false, observedAvailability: "available" },
        { url: "file:///tmp/file ", isDirectory: false, observedAvailability: "available" },
      ],
    });
  });

  it("rejects V1 payload fields and unknown future properties instead of stripping them", () => {
    expect(
      ClipboardRepresentationV2Schema.safeParse({
        ...readyBlob("plain"),
        text: "this old payload field must not be silently discarded",
      }).success,
    ).toBe(false);
  });
});

describe("ClipboardSnapshotManifestV2Schema", () => {
  it("accepts native macOS multi-item and Windows format-set manifests", () => {
    const mac = manifest("macos", [
      { index: 0, representations: [readyBlob("plain"), readyBlob("html", "text/html")] },
      { index: 1, representations: [readyBlob("image", "public.png")] },
    ]);
    const windows = manifest("windows", [
      {
        index: 0,
        representations: [
          readyBlob("plain", "CF_UNICODETEXT"),
          readyBlob("html", "HTML Format"),
          readyBlob("rtf", "Rich Text Format"),
          {
            representationKey: "files",
            formatId: "CF_HDROP",
            nativeName: "CF_HDROP",
            state: "ready",
            storage: "file-reference",
            fidelity: "reference",
            originDeviceId: "device-1",
            references: [
              { url: "C:\\Docs\\one.txt", isDirectory: false, observedAvailability: "available" },
            ],
          },
        ],
      },
    ]);

    expect(ClipboardSnapshotManifestV2Schema.safeParse(mac).success).toBe(true);
    expect(ClipboardSnapshotManifestV2Schema.safeParse(windows).success).toBe(true);
  });

  it("accepts a partial capture with an explicit unsupported representation", () => {
    const partial = manifest("macos", [
      { index: 0, representations: [readyBlob("plain"), unavailable("private")] },
    ]);

    expect(partial.captureState).toBe("partial");
    expect(ClipboardSnapshotManifestV2Schema.safeParse(partial).success).toBe(true);
  });

  it("rejects repeated item indexes and non-increasing item order", () => {
    const repeatedIndex = manifest("macos", [
      { index: 0, representations: [readyBlob("plain")] },
      { index: 0, representations: [readyBlob("html")] },
    ]);
    const backwards = manifest("macos", [
      { index: 1, representations: [readyBlob("plain")] },
      { index: 0, representations: [readyBlob("html")] },
    ]);

    expect(ClipboardSnapshotManifestV2Schema.safeParse(repeatedIndex).success).toBe(false);
    expect(ClipboardSnapshotManifestV2Schema.safeParse(backwards).success).toBe(false);
  });

  it("rejects representation keys repeated in different items", () => {
    const repeatedKey = manifest("macos", [
      { index: 0, representations: [readyBlob("same-key")] },
      { index: 1, representations: [readyBlob("same-key", "text/html")] },
    ]);

    expect(ClipboardSnapshotManifestV2Schema.safeParse(repeatedKey).success).toBe(false);
  });

  it("requires counts and capture state to agree with each representation", () => {
    const ready = manifest("macos", [{ index: 0, representations: [readyBlob("plain")] }]);
    const omittedMismatch = {
      ...ready,
      coverage: { requested: 2, captured: 1, omitted: 0 },
      captureState: "partial",
    };
    const stateMismatch = { ...ready, captureState: "partial" };
    const unavailableOnly = manifest("windows", [
      { index: 0, representations: [unavailable("private")] },
    ]);

    expect(ClipboardSnapshotManifestV2Schema.safeParse(omittedMismatch).success).toBe(false);
    expect(ClipboardSnapshotManifestV2Schema.safeParse(stateMismatch).success).toBe(false);
    expect(unavailableOnly.captureState).toBe("failed");
    expect(ClipboardSnapshotManifestV2Schema.safeParse(unavailableOnly).success).toBe(true);
  });

  it("enforces the platform item model and Windows single-item mapping", () => {
    const validWindows = manifest("windows", [
      { index: 0, representations: [readyBlob("plain")] },
    ]);
    const wrongModel: unknown = {
      ...validWindows,
      source: { ...validWindows.source, itemModel: "macos-items" },
    };
    const multipleWindowsItems = manifest("windows", [
      { index: 0, representations: [readyBlob("plain")] },
      { index: 1, representations: [readyBlob("html")] },
    ]);
    const wrongIdentity: unknown = {
      ...validWindows,
      source: {
        ...validWindows.source,
        sourceApplication: { kind: "bundle-id", identifier: "com.example.App" },
      },
    };

    expect(ClipboardSnapshotManifestV2Schema.safeParse(wrongModel).success).toBe(false);
    expect(ClipboardSnapshotManifestV2Schema.safeParse(multipleWindowsItems).success).toBe(false);
    expect(ClipboardSnapshotManifestV2Schema.safeParse(wrongIdentity).success).toBe(false);
  });

  it("requires source attribution to agree with a known source identity", () => {
    const validWindows = manifest("windows", [
      { index: 0, representations: [readyBlob("plain")] },
    ]);
    const knownIdentityUnknownAttribution: unknown = {
      ...validWindows,
      source: { ...validWindows.source, attribution: "unknown" },
    };

    expect(
      ClipboardSnapshotManifestV2Schema.safeParse(knownIdentityUnknownAttribution).success,
    ).toBe(false);
  });

  it("rejects an unsupported legacy top-level payload without stripping it", () => {
    const legacy = manifest("macos", [{ index: 0, representations: [readyBlob("plain")] }]);
    Object.assign(legacy, { payload: { revision: "rev-1", text: "old shape" } });

    expect(ClipboardSnapshotManifestV2Schema.safeParse(legacy).success).toBe(false);
  });

  it("validates representation item objects with strict keys", () => {
    expect(
      ClipboardItemV2Schema.safeParse({
        index: 0,
        representations: [readyBlob("plain")],
        content: "legacy payload content",
      }).success,
    ).toBe(false);
  });
});
