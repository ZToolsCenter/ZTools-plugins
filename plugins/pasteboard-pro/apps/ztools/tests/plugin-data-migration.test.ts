import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migratePasteboardProPluginData } from "../preload/plugin-data-migration";

describe("pluginData migration", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function makeRoot(prefix: string): Promise<string> {
    const temporaryDirectory = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
    const root = await mkdtemp(path.join(temporaryDirectory, prefix));
    roots.push(root);
    return root;
  }

  async function marker(dataRoot: string): Promise<Record<string, any>> {
    const contents = await readFile(path.join(dataRoot, ".pasteboard-pro-plugin-data-migration-v1.json"), "utf8");
    return JSON.parse(contents);
  }

  function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  it("copies and verifies legacy blobs, rewrites known paths, and retains the legacy root", async () => {
    const root = await makeRoot("pasteboard-plugin-data-");
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
    let putCount = 0;
    const database = {
      async allDocs() { return { rows: documents.map((doc) => ({ doc })) }; },
      async put(document: Record<string, unknown>) {
        putCount += 1;
        documents.splice(0, 1, document as any);
        return { ok: true };
      },
    };

    await migratePasteboardProPluginData(database, {
      dataRoot: pluginData,
      blobRoot,
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    });

    const copiedPath = path.join(blobRoot, relative);
    const originalBytes = await readFile(oldPath);
    const copiedBytes = await readFile(copiedPath);
    expect(sha256(copiedBytes)).toBe(sha256(originalBytes));
    expect((await stat(legacy)).isDirectory()).toBe(true);
    expect((documents[0] as any).record.origin.imagePath).toBe(path.join(blobRoot, relative));
    expect(await marker(pluginData)).toMatchObject({
      version: 1,
      stages: {
        copy: { status: "verified", roots: 1 },
        knownRecordRewrite: { status: "verified-for-returned-documents", updatedRecords: 1 },
      },
      legacyRetained: true,
      hostEnumerationCompleteness: "unverified",
    });
    expect(await marker(pluginData)).not.toHaveProperty("completedAt");

    await migratePasteboardProPluginData(database, {
      dataRoot: pluginData,
      blobRoot,
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    });
    expect(putCount).toBe(1);
    expect(await stat(legacy)).toBeDefined();
  });

  it("keeps both copies and the old database path when allDocs returns an empty result", async () => {
    const root = await makeRoot("pasteboard-plugin-data-empty-");
    const legacy = path.join(root, "legacy", "blobs");
    const pluginData = path.join(root, "pluginData");
    const blobRoot = path.join(pluginData, "sync", "blobs");
    const relative = path.join("aa", "blob.png");
    const oldPath = path.join(legacy, relative);
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "blob from old record");
    const document = {
      _id: "pasteboard-pro:record:test",
      type: "pasteboard-pro-record",
      record: { origin: { imagePath: oldPath } },
    };
    let putCount = 0;
    const database = {
      async allDocs() { return []; },
      async put() { putCount += 1; return { ok: true }; },
    };
    const paths = { dataRoot: pluginData, blobRoot, legacyBlobRoots: [legacy], usesPluginData: true };

    await migratePasteboardProPluginData(database, paths);
    await migratePasteboardProPluginData(database, paths);

    expect(putCount).toBe(0);
    expect(document.record.origin.imagePath).toBe(oldPath);
    expect(await readFile(oldPath, "utf8")).toBe("blob from old record");
    expect(await readFile(path.join(blobRoot, relative), "utf8")).toBe("blob from old record");
    expect(await stat(legacy)).toBeDefined();
    expect(await marker(pluginData)).toMatchObject({
      stages: {
        copy: { status: "verified" },
        knownRecordRewrite: { status: "verified-for-returned-documents", updatedRecords: 0 },
      },
      legacyRetained: true,
      hostEnumerationCompleteness: "unverified",
    });
    expect(await marker(pluginData)).not.toHaveProperty("completedAt");
  });

  it("rejects an explicit database read error and retains the verified backup and old path", async () => {
    const root = await makeRoot("pasteboard-plugin-data-read-fail-");
    const legacy = path.join(root, "legacy", "blobs");
    const pluginData = path.join(root, "pluginData");
    const blobRoot = path.join(pluginData, "sync", "blobs");
    const oldPath = path.join(legacy, "aa", "blob.png");
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "blob");
    const document = { _id: "pasteboard-pro:record:test", record: { origin: { imagePath: oldPath } } };
    const database = {
      async allDocs() { return { error: true, name: "exception", message: "private host error" }; },
      async put() { throw new Error("must not write after a read failure"); },
    };

    await expect(migratePasteboardProPluginData(database, {
      dataRoot: pluginData, blobRoot, legacyBlobRoots: [legacy], usesPluginData: true,
    })).rejects.toThrow("迁移读取数据库失败");
    expect(document.record.origin.imagePath).toBe(oldPath);
    expect(await readFile(oldPath, "utf8")).toBe("blob");
    expect(await readFile(path.join(blobRoot, "aa", "blob.png"), "utf8")).toBe("blob");
    expect(await stat(legacy)).toBeDefined();
    expect(await marker(pluginData)).toMatchObject({
      stages: {
        copy: { status: "verified" },
        knownRecordRewrite: { status: "pending" },
      },
      legacyRetained: true,
      hostEnumerationCompleteness: "unverified",
    });
  });

  it("keeps backups and retries a failed path update idempotently", async () => {
    const root = await makeRoot("pasteboard-plugin-data-write-fail-");
    const legacy = path.join(root, "legacy", "blobs");
    const pluginData = path.join(root, "pluginData");
    const oldPath = path.join(legacy, "aa", "blob.png");
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "blob");
    let document: Record<string, any> = {
      _id: "pasteboard-pro:record:test",
      type: "pasteboard-pro-record",
      record: { origin: { imagePath: oldPath } },
    };
    let shouldFail = true;
    let putCount = 0;
    const database = {
      async allDocs() { return { rows: [{ doc: document }] }; },
      async put(next: Record<string, unknown>) {
        putCount += 1;
        if (shouldFail) return { ok: false, error: "conflict" };
        document = next;
        return { ok: true };
      },
    };
    const paths = {
      dataRoot: pluginData,
      blobRoot: path.join(pluginData, "sync", "blobs"),
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    };
    await expect(migratePasteboardProPluginData(database, paths)).rejects.toThrow("更新附件路径失败");
    expect(document.record.origin.imagePath).toBe(oldPath);
    expect((await stat(legacy)).isDirectory()).toBe(true);
    expect(await readFile(path.join(paths.blobRoot, "aa", "blob.png"), "utf8")).toBe("blob");
    expect(await marker(pluginData)).toMatchObject({ stages: { knownRecordRewrite: { status: "pending" } } });

    shouldFail = false;
    await migratePasteboardProPluginData(database, paths);
    expect(document.record.origin.imagePath).toBe(path.join(paths.blobRoot, "aa", "blob.png"));
    expect(await marker(pluginData)).toMatchObject({
      stages: { knownRecordRewrite: { status: "verified-for-returned-documents", updatedRecords: 1 } },
      legacyRetained: true,
    });

    await migratePasteboardProPluginData(database, paths);
    expect(putCount).toBe(2);
    expect(document.record.origin.imagePath).toBe(path.join(paths.blobRoot, "aa", "blob.png"));
    expect((await stat(legacy)).isDirectory()).toBe(true);
  });

  it("rejects a symlinked legacy root without copying or changing its external target", async () => {
    const root = await makeRoot("pasteboard-plugin-data-source-root-link-");
    const external = path.join(root, "external", "blobs");
    const legacy = path.join(root, "legacy-blobs");
    const sentinel = path.join(external, "sentinel.txt");
    await mkdir(external, { recursive: true });
    await writeFile(sentinel, "external source sentinel");
    await symlink(external, legacy, process.platform === "win32" ? "junction" : "dir");
    const pluginData = path.join(root, "pluginData");

    await expect(migratePasteboardProPluginData({
      async allDocs() { return []; },
      async put() { return { ok: true }; },
    }, {
      dataRoot: pluginData,
      blobRoot: path.join(pluginData, "sync", "blobs"),
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    })).rejects.toThrow("不允许符号链接");

    expect(await readFile(sentinel, "utf8")).toBe("external source sentinel");
    await expect(stat(path.join(pluginData, "sync", "blobs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked ancestor of the legacy root without following it", async () => {
    const root = await makeRoot("pasteboard-plugin-data-source-parent-link-");
    const external = path.join(root, "external");
    const externalLegacy = path.join(external, "blobs");
    const sourceFile = path.join(externalLegacy, "aa", "source.txt");
    const legacyParent = path.join(root, "legacy-parent");
    const legacy = path.join(legacyParent, "blobs");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "external source parent sentinel");
    await symlink(external, legacyParent, process.platform === "win32" ? "junction" : "dir");
    const pluginData = path.join(root, "pluginData");

    await expect(migratePasteboardProPluginData({
      async allDocs() { return []; },
      async put() { return { ok: true }; },
    }, {
      dataRoot: pluginData,
      blobRoot: path.join(pluginData, "sync", "blobs"),
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    })).rejects.toThrow("不允许符号链接");

    expect(await readFile(sourceFile, "utf8")).toBe("external source parent sentinel");
    await expect(stat(path.join(pluginData, "sync", "blobs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlinked destination roots and ancestors before copying source data", async () => {
    const root = await makeRoot("pasteboard-plugin-data-destination-link-");
    for (const kind of ["root", "ancestor"] as const) {
      const caseRoot = path.join(root, kind);
      const legacy = path.join(caseRoot, "legacy", "blobs");
      const oldFile = path.join(legacy, "aa", "source.txt");
      const pluginData = path.join(caseRoot, "pluginData");
      const blobRoot = path.join(pluginData, "sync", "blobs");
      const external = path.join(caseRoot, "external");
      const sentinel = kind === "root"
        ? path.join(external, "sentinel.txt")
        : path.join(external, "blobs", "sentinel.txt");
      await mkdir(path.dirname(oldFile), { recursive: true });
      await writeFile(oldFile, `source ${kind}`);
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, `external ${kind} sentinel`);

      if (kind === "root") {
        await mkdir(path.dirname(blobRoot), { recursive: true });
        await symlink(external, blobRoot, process.platform === "win32" ? "junction" : "dir");
      } else {
        await mkdir(pluginData, { recursive: true });
        await symlink(external, path.join(pluginData, "sync"), process.platform === "win32" ? "junction" : "dir");
      }

      await expect(migratePasteboardProPluginData({
        async allDocs() { return []; },
        async put() { return { ok: true }; },
      }, {
        dataRoot: pluginData,
        blobRoot,
        legacyBlobRoots: [legacy],
        usesPluginData: true,
      })).rejects.toThrow("不允许符号链接");

      expect(await readFile(oldFile, "utf8")).toBe(`source ${kind}`);
      expect(await readFile(sentinel, "utf8")).toBe(`external ${kind} sentinel`);
      expect(await stat(legacy)).toBeDefined();
      await expect(stat(path.join(path.dirname(sentinel), "source.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects nested destination symlinks without writing through them", async () => {
    const root = await makeRoot("pasteboard-plugin-data-destination-nested-link-");
    const legacy = path.join(root, "legacy", "blobs");
    const oldFile = path.join(legacy, "aa", "source.txt");
    const pluginData = path.join(root, "pluginData");
    const blobRoot = path.join(pluginData, "sync", "blobs");
    const external = path.join(root, "external");
    const sentinel = path.join(external, "sentinel.txt");
    await mkdir(path.dirname(oldFile), { recursive: true });
    await writeFile(oldFile, "nested destination source");
    await mkdir(blobRoot, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(sentinel, "nested destination sentinel");
    await symlink(external, path.join(blobRoot, "aa"), process.platform === "win32" ? "junction" : "dir");

    await expect(migratePasteboardProPluginData({
      async allDocs() { return []; },
      async put() { return { ok: true }; },
    }, {
      dataRoot: pluginData,
      blobRoot,
      legacyBlobRoots: [legacy],
      usesPluginData: true,
    })).rejects.toThrow("不允许符号链接");

    expect(await readFile(oldFile, "utf8")).toBe("nested destination source");
    expect(await readFile(sentinel, "utf8")).toBe("nested destination sentinel");
    await expect(stat(path.join(external, "source.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await stat(legacy)).toBeDefined();
  });
});
