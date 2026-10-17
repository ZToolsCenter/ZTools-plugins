import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolvePasteboardBlobRoots } from "../preload/plugin-data";

describe("Pasteboard plugin data", () => {
  it("uses the 3.2 plugin-owned directory while retaining the legacy root", () => {
    expect(
      resolvePasteboardBlobRoots(
        { getPath: () => "/tmp/ztools/pasteboard-pro" },
        "/tmp/home",
      ),
    ).toEqual({
      primary: path.join("/tmp/ztools/pasteboard-pro", "sync", "blobs"),
      legacy: [path.join("/tmp/home", ".pasteboard-pro", "ztools", "blobs")],
    });
  });

  it("falls back to the historical directory on ZTools 2.4-3.1", () => {
    expect(
      resolvePasteboardBlobRoots(
        { getPath: () => { throw new Error("unknown path"); } },
        "/tmp/home",
      ),
    ).toEqual({
      primary: path.join("/tmp/home", ".pasteboard-pro", "ztools", "blobs"),
      legacy: [],
    });
  });
});
