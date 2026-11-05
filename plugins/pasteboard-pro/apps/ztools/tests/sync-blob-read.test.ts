import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_SYNC_BLOB_BYTES,
  readBoundedImageBytes,
  SyncBlobReadLimitError,
} from "../preload/sync-blob-files";

const TEST_ARTIFACTS_ROOT = fileURLToPath(
  new URL("../../../artifacts/v026-blob-tests", import.meta.url),
);

async function tempRoot(): Promise<string> {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  return mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "blob-read-"));
}

describe("bounded sync image reader", () => {
  it("reads complete bytes from an absolute regular-file path", async () => {
    const root = await tempRoot();
    const filePath = path.join(root, "fixture.bin");
    const bytes = Buffer.from([0, 1, 2, 0xff, 0x80, 0x0a]);
    try {
      await writeFile(filePath, bytes);

      await expect(readBoundedImageBytes(filePath)).resolves.toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["", "relative/fixture.bin"])(
    "rejects a non-absolute image path (%s)",
    async (filePath) => {
      await expect(readBoundedImageBytes(filePath)).rejects.toThrow(/absolute path/i);
    },
  );

  it("rejects oversize metadata before opening or allocating the file", async () => {
    const root = await tempRoot();
    const filePath = path.join(root, "small.bin");
    const openSpy = vi.fn(open);
    try {
      await writeFile(filePath, Buffer.from([1, 2, 3]));
      const fakeOversizeLstat = async (target: string): Promise<BigIntStats> => {
        const status = await lstat(target, { bigint: true });
        return new Proxy(status, {
          get(current, property, receiver) {
            if (property === "size") return BigInt(MAX_SYNC_BLOB_BYTES + 1);
            return Reflect.get(current, property, receiver);
          },
        });
      };

      await expect(
        readBoundedImageBytes(filePath, {
          lstat: fakeOversizeLstat,
          open: openSpy,
        }),
      ).rejects.toMatchObject({
        code: "ERR_SYNC_BLOB_TOO_LARGE",
        name: "SyncBlobReadLimitError",
      } satisfies Partial<SyncBlobReadLimitError>);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses static symlinks and directories", async () => {
    const root = await tempRoot();
    const outside = path.join(root, "outside.bin");
    const link = path.join(root, "link.bin");
    const directory = path.join(root, "directory");
    try {
      await writeFile(outside, Buffer.from([4, 5, 6]));
      await symlink(outside, link);
      await mkdir(directory);

      await expect(readBoundedImageBytes(link)).rejects.toThrow(/symbolic-link/i);
      await expect(readBoundedImageBytes(directory)).rejects.toThrow(/regular file/i);
      expect(await readFile(outside)).toEqual(Buffer.from([4, 5, 6]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects a symlink substituted after lstat when native no-follow is unavailable", async () => {
    const root = await tempRoot();
    const filePath = path.join(root, "source.bin");
    const outside = path.join(root, "outside.bin");
    try {
      await writeFile(filePath, Buffer.from([7, 8, 9]));
      await writeFile(outside, Buffer.from([0xfa, 0xfb, 0xfc]));
      const openAfterSwap = async (target: string, flags: number) => {
        await unlink(target);
        await symlink(outside, target);
        const noFollow =
          typeof fileSystemConstants.O_NOFOLLOW === "number"
            ? fileSystemConstants.O_NOFOLLOW
            : 0;
        return open(target, flags & ~noFollow);
      };

      await expect(
        readBoundedImageBytes(filePath, { open: openAfterSwap }),
      ).rejects.toThrow(/changed between path inspection and open/i);
      expect(await readFile(outside)).toEqual(Buffer.from([0xfa, 0xfb, 0xfc]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
