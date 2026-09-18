import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { migratePasteboardProPluginData } from "../preload/plugin-data-migration";

describe("pluginData migration", () => {
  it("moves legacy blobs, rewrites database paths, and removes the legacy root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-plugin-data-"));
    const legacy = path.join(root, "legacy", "blobs");
    const pluginData = path.join(root, "pluginData");
    const blobRoot = path.join(pluginData, "sync", "blobs");
    const relative = path.join("ab", `${"a".repeat(64)}.png`);
    const oldPath = path.join(legacy, relative);
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "blob");
    const documents = [{
      _id: "pasteboard-pro:record:test",
      _rev: "1-a",
      type: "pasteboard-pro-record",
      record: { item: { id: "item" }, origin: { host: "sync", imagePath: oldPath } },
    }];
    const database = {
      async allDocs() { return { rows: documents.map((doc) => ({ doc })) }; },
      async put(document: Record<string, unknown>) { documents.splice(0, 1, document as any); return { ok: true }; },
    };

    await migratePasteboardProPluginData(database, {
      dataRoot: pluginData,
      blobRoot,
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    });

    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(blobRoot, relative), "utf8")).toBe("blob");
    expect((documents[0] as any).record.origin.imagePath).toBe(path.join(blobRoot, relative));
  });

  it("retains the legacy root when database path rewriting fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-plugin-data-fail-"));
    const legacy = path.join(root, "legacy", "blobs");
    const pluginData = path.join(root, "pluginData");
    const oldPath = path.join(legacy, "aa", "blob.png");
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "blob");
    const database = {
      async allDocs() { return { rows: [{ doc: { _id: "pasteboard-pro:record:test", type: "pasteboard-pro-record", record: { origin: { imagePath: oldPath } } } }] }; },
      async put() { return { ok: false, error: "conflict" }; },
    };
    await expect(migratePasteboardProPluginData(database, {
      dataRoot: pluginData,
      blobRoot: path.join(pluginData, "sync", "blobs"),
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    })).rejects.toThrow("更新附件路径失败");
    expect((await stat(legacy)).isDirectory()).toBe(true);
  });
});
