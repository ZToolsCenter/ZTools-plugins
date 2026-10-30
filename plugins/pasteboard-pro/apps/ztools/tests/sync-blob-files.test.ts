import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  writeVerifiedSyncBlobFile,
} from "../preload/sync-blob-files";

const TEST_ARTIFACTS_ROOT = fileURLToPath(
  new URL("../../../artifacts/v026-blob-tests", import.meta.url),
);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function managedPath(root: string, bytes: Uint8Array): string {
  const hash = digest(bytes);
  return path.join(root, hash.slice(0, 2), `${hash}.png`);
}

async function tempRoot(): Promise<string> {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  return mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "blob-files-"));
}

async function captureOutcome<T>(task: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await task };
  } catch (error) {
    return { error };
  }
}

describe("verified sync blob files", () => {
  it("keeps a valid cached file and its mtime", async () => {
    const root = await tempRoot();
    const bytes = new Uint8Array([3, 1, 4, 1, 5, 9]);
    const filePath = managedPath(root, bytes);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      await utimes(filePath, 1, 1);
      const originalMtime = (await stat(filePath)).mtimeMs;

      const result = await writeVerifiedSyncBlobFile(root, bytes, "image/png");

      expect(result).toEqual({ digest: digest(bytes), filePath, byteLength: bytes.byteLength });
      expect((await stat(filePath)).mtimeMs).toBe(originalMtime);
      expect(await readFile(filePath)).toEqual(Buffer.from(bytes));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { name: "same-length corruption", corruptBytes: new Uint8Array([9, 9, 9, 9]) },
    { name: "different-length corruption", corruptBytes: new Uint8Array([7]) },
  ])("repairs $name in an ordinary cache file", async ({ corruptBytes }) => {
    const root = await tempRoot();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const filePath = managedPath(root, bytes);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, corruptBytes);

      const result = await writeVerifiedSyncBlobFile(root, bytes, "image/png");

      expect(result.filePath).toBe(filePath);
      expect(await readFile(filePath)).toEqual(Buffer.from(bytes));
      expect(digest(await readFile(filePath))).toBe(result.digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a write failure instead of treating an unrelated path as success", async () => {
    const base = await tempRoot();
    const root = path.join(base, "not-a-directory");
    const bytes = new Uint8Array([2, 4, 6]);
    try {
      await writeFile(root, "root blocker");

      await expect(writeVerifiedSyncBlobFile(root, bytes, "image/png")).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("refuses symlink and directory cache targets without reading or replacing them", async () => {
    const base = await tempRoot();
    const root = path.join(base, "blobs");
    const outside = path.join(base, "outside.png");
    const symlinkBytes = new Uint8Array([1, 3, 3, 7]);
    const directoryBytes = new Uint8Array([8, 6, 7, 5]);
    const symlinkPath = managedPath(root, symlinkBytes);
    const directoryPath = managedPath(root, directoryBytes);
    try {
      await mkdir(path.dirname(symlinkPath), { recursive: true });
      await writeFile(outside, new Uint8Array([5, 5, 5]));
      await symlink(outside, symlinkPath);
      await mkdir(path.dirname(directoryPath), { recursive: true });
      await mkdir(directoryPath);

      await expect(
        writeVerifiedSyncBlobFile(root, symlinkBytes, "image/png"),
      ).rejects.toThrow(/symbolic-link/i);
      await expect(
        writeVerifiedSyncBlobFile(root, directoryBytes, "image/png"),
      ).rejects.toThrow(/regular file/i);
      expect(await readFile(outside)).toEqual(Buffer.from([5, 5, 5]));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("rejects a managed root symlink before writing into its target", async () => {
    const base = await tempRoot();
    const outsideRoot = path.join(base, "outside-root");
    const managedRoot = path.join(base, "managed-link");
    const sentinel = path.join(outsideRoot, "sentinel.bin");
    const bytes = new Uint8Array([1, 5, 9, 2]);
    try {
      await mkdir(outsideRoot);
      await writeFile(sentinel, Buffer.from([0x41, 0x42]));
      await symlink(outsideRoot, managedRoot, "dir");

      const outcome = await captureOutcome(
        writeVerifiedSyncBlobFile(managedRoot, bytes, "image/png"),
      );
      expect(await readdir(outsideRoot)).toEqual(["sentinel.bin"]);
      expect(await readFile(sentinel)).toEqual(Buffer.from([0x41, 0x42]));
      expect(outcome).toHaveProperty("error");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked managed-root ancestor before creating its child tree", async () => {
    const base = await tempRoot();
    const outsideParent = path.join(base, "outside-parent");
    const parentLink = path.join(base, "parent-link");
    const managedRoot = path.join(parentLink, "managed");
    const sentinel = path.join(outsideParent, "sentinel.bin");
    const bytes = new Uint8Array([2, 7, 1, 8]);
    try {
      await mkdir(outsideParent);
      await writeFile(sentinel, Buffer.from([0x31, 0x32]));
      await symlink(outsideParent, parentLink, "dir");

      const outcome = await captureOutcome(
        writeVerifiedSyncBlobFile(managedRoot, bytes, "image/png"),
      );
      expect(await readdir(outsideParent)).toEqual(["sentinel.bin"]);
      expect(await readFile(sentinel)).toEqual(Buffer.from([0x31, 0x32]));
      expect(outcome).toHaveProperty("error");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked digest-prefix directory before creating external files", async () => {
    const base = await tempRoot();
    const managedRoot = path.join(base, "managed");
    const outsidePrefix = path.join(base, "outside-prefix");
    const bytes = new Uint8Array([3, 3, 8, 3]);
    const filePath = managedPath(managedRoot, bytes);
    const prefix = path.dirname(filePath);
    const sentinel = path.join(outsidePrefix, "sentinel.bin");
    try {
      await mkdir(managedRoot);
      await mkdir(outsidePrefix);
      await writeFile(sentinel, Buffer.from([0x51, 0x52]));
      await symlink(outsidePrefix, prefix, "dir");

      const outcome = await captureOutcome(
        writeVerifiedSyncBlobFile(managedRoot, bytes, "image/png"),
      );
      expect(await readdir(outsidePrefix)).toEqual(["sentinel.bin"]);
      expect(await readFile(sentinel)).toEqual(Buffer.from([0x51, 0x52]));
      expect(outcome).toHaveProperty("error");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("uses collision-resistant temporary files for concurrent writes of the same hash", async () => {
    const root = await tempRoot();
    const bytes = new Uint8Array(3 * 1_024 * 1_024).fill(0x5a);
    const filePath = managedPath(root, bytes);
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          writeVerifiedSyncBlobFile(root, bytes, "image/png"),
        ),
      );

      expect(new Set(results.map((result) => result.filePath))).toEqual(new Set([filePath]));
      expect((await readFile(filePath)).equals(Buffer.from(bytes))).toBe(true);
      expect(digest(await readFile(filePath))).toBe(digest(bytes));
      expect(await readdir(path.dirname(filePath))).toEqual([path.basename(filePath)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
