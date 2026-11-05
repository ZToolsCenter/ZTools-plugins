import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { maxFormatBytesV2 } from "@pasteboard-pro/core";
import { SnapshotStoreErrorV2 } from "../src/errors.js";
import { openBlobStoreV2 } from "../src/blob-store.js";

const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v020-blob-tests",
);
const maxBlobBytes = maxFormatBytesV2("binary");
const ownedSandboxes: string[] = [];

afterEach(async () => {
  const sandboxes = ownedSandboxes.splice(0, ownedSandboxes.length);
  await Promise.all(sandboxes.map((path) => fs.rm(path, { recursive: true, force: true })));
});

describe("BlobStoreV2", () => {
  it("persists owned byte copies across reopen and supports empty blobs", async () => {
    const root = await newObjectRoot();
    const source = Uint8Array.of(3, 1, 4, 1, 5);
    const ownedValue = [...source];
    const sha256 = digest(source);
    const store = await openBlobStoreV2(root);
    const info = await store.stage(source, sha256);
    source.fill(9);

    const reopened = await openBlobStoreV2(root);
    expect(Array.from(await reopened.read(info.blobRef, { sha256, byteLength: ownedValue.length }))).toEqual(
      ownedValue,
    );
    expect(await reopened.stage(Uint8Array.from(ownedValue), sha256)).toEqual(info);

    const empty = new Uint8Array();
    const emptyInfo = await reopened.stage(empty, digest(empty));
    expect(emptyInfo.byteLength).toBe(0);
    expect(Array.from(await reopened.read(emptyInfo.blobRef, emptyInfo))).toEqual([]);
    expect(await reopened.listObjects()).toHaveLength(2);
  });

  it("serializes concurrent same-hash stages across store instances", async () => {
    const root = await newObjectRoot();
    const bytes = Uint8Array.from({ length: 32 * 1024 }, (_, index) => index % 251);
    const sha256 = digest(bytes);
    const first = await openBlobStoreV2(root);
    const second = await openBlobStoreV2(root);

    const results = await Promise.all([
      first.stage(bytes, sha256),
      second.stage(bytes, sha256),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await first.listObjects()).toHaveLength(1);
  });

  it("rejects malformed, mismatched, shared, detached and over-limit input before writing", async () => {
    const root = await newObjectRoot();
    const store = await openBlobStoreV2(root);
    const bytes = Uint8Array.of(1, 2, 3);
    await expectCode(store.stage(bytes, "not-a-digest"), "invalid-input");
    await expectCode(store.stage(bytes, "0".repeat(64)), "invalid-input");
    await expectCode(store.stage(new Uint8Array(new SharedArrayBuffer(1)), "0".repeat(64)), "invalid-input");

    const detached = new Uint8Array(1);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await expectCode(store.stage(detached, "0".repeat(64)), "invalid-input");
    await expectCode(
      store.stage(new Uint8Array(maxBlobBytes + 1), "0".repeat(64)),
      "over-limit",
    );
    expect(await store.listObjects()).toEqual([]);
    expect(await fs.readdir(join(root, ".staging"))).toEqual([]);
  });

  it("rejects corrupt existing content instead of replacing it", async () => {
    const root = await newObjectRoot();
    const store = await openBlobStoreV2(root);
    const bytes = Uint8Array.of(7, 8, 9);
    const info = await store.stage(bytes, digest(bytes));
    const objectPath = pathFor(root, info.sha256);
    await fs.writeFile(objectPath, Uint8Array.of(2, 2, 2));

    await expectCode(store.stage(bytes, info.sha256), "storage-corrupt");
    expect(await fs.readFile(objectPath)).toEqual(Buffer.from([2, 2, 2]));
    await expectCode(store.read(info.blobRef, info), "storage-corrupt");
    await expectCode(store.listObjects(), "storage-corrupt");
  });

  it("checks size before read allocation and rejects truncated objects", async () => {
    const root = await newObjectRoot();
    const store = await openBlobStoreV2(root);
    const bytes = Uint8Array.of(5, 4, 3, 2);
    const info = await store.stage(bytes, digest(bytes));
    const objectPath = pathFor(root, info.sha256);
    const file = await fs.open(objectPath, "r+");
    try {
      await file.truncate(maxBlobBytes + 1);
    } finally {
      await file.close();
    }

    await expectCode(store.read(info.blobRef, info), "storage-corrupt");
    await expectCode(store.listObjects(), "storage-corrupt");

    const secondRoot = await newObjectRoot();
    const second = await openBlobStoreV2(secondRoot);
    const small = Uint8Array.of(6, 7, 8);
    const smallInfo = await second.stage(small, digest(small));
    await fs.truncate(pathFor(secondRoot, smallInfo.sha256), 1);
    await expectCode(second.read(smallInfo.blobRef, smallInfo), "storage-corrupt");
  });

  it("rejects symlink roots, shards, staging paths and objects", async () => {
    const base = await newSandbox();
    const realRoot = join(base, "real-objects");
    await openBlobStoreV2(realRoot);
    const rootAlias = join(base, "root-alias");
    await fs.symlink(realRoot, rootAlias, "dir");
    await expectCode(openBlobStoreV2(rootAlias), "invalid-input");

    const root = join(base, "object-root");
    const store = await openBlobStoreV2(root);
    const bytes = Uint8Array.of(8, 6, 7, 5);
    const sha256 = digest(bytes);
    const shard = join(root, "sha256", sha256.slice(0, 2));
    const outside = join(base, "outside");
    await fs.mkdir(outside, { mode: 0o700 });
    await fs.symlink(outside, shard, "dir");
    await expectCode(store.stage(bytes, sha256), "invalid-input");
    await fs.unlink(shard);

    const info = await store.stage(bytes, sha256);
    const objectPath = pathFor(root, sha256);
    const externalFile = join(base, "external-object");
    await fs.writeFile(externalFile, bytes);
    await fs.unlink(objectPath);
    await fs.symlink(externalFile, objectPath);
    await expectCode(store.read(info.blobRef, info), "storage-corrupt");
    await expectCode(store.listObjects(), "storage-corrupt");

    await fs.unlink(objectPath);
    const staging = join(root, ".staging");
    await fs.rmdir(staging);
    await fs.symlink(outside, staging, "dir");
    await expectCode(store.discardStaging(), "storage-corrupt");
  });

  it("recovers controlled staging files without deleting objects", async () => {
    const root = await newObjectRoot();
    const store = await openBlobStoreV2(root);
    const bytes = Uint8Array.of(1, 6, 1, 8);
    const info = await store.stage(bytes, digest(bytes));
    await fs.writeFile(join(root, ".staging", `blob-${"a".repeat(32)}.tmp`), Uint8Array.of(9));

    expect(await store.discardStaging()).toBe(1);
    expect(await store.listObjects()).toEqual([info]);
    await expectCode(store.removeUnreferenced("sha256-not-a-digest"), "invalid-input");
    await store.removeUnreferenced(info.blobRef);
    await store.removeUnreferenced(info.blobRef);
    await store.removeUnreferenced(`sha256-${"f".repeat(64)}`);
    expect(await store.listObjects()).toEqual([]);
  });

  it.each([
    ["after-write", false],
    ["after-file-sync", false],
    ["after-rename", true],
    ["after-directory-sync", true],
  ] as const)("handles injected %s failure and supports restart recovery", async (point, leavesObject) => {
    const root = await newObjectRoot();
    const bytes = Uint8Array.of(2, 7, 1, 8);
    const sha256 = digest(bytes);
    const failingStore = await openBlobStoreV2(root, {
      fault: (current) => {
        if (current === point) throw new Error("injected failure details must not escape");
      },
    });

    await expectCode(failingStore.stage(bytes, sha256), "storage-failed");
    const recovered = await openBlobStoreV2(root);
    const objects = await recovered.listObjects();
    expect(objects).toHaveLength(leavesObject ? 1 : 0);
    if (leavesObject) {
      const object = objects[0];
      expect(object).toBeDefined();
      if (object) expect(Array.from(await recovered.read(object.blobRef, object))).toEqual(Array.from(bytes));
    }
    expect(await recovered.discardStaging()).toBe(0);
  });
});

async function newObjectRoot(): Promise<string> {
  return join(await newSandbox(), "objects");
}

async function newSandbox(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const path = await fs.mkdtemp(join(artifactRoot, "case-"));
  ownedSandboxes.push(path);
  return path;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathFor(root: string, sha256: string): string {
  return join(root, "sha256", sha256.slice(0, 2), sha256);
}

async function expectCode(promise: Promise<unknown>, code: SnapshotStoreErrorV2["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "SnapshotStoreErrorV2", code });
}
