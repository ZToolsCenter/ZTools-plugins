import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { rotateImageFile } from "../preload/image-rotation";
import type { OcrProcess, OcrSpawn } from "../preload/ocr";

class FakeStream extends EventEmitter {
  end(): void {}
}

class FakeProcess extends EventEmitter implements OcrProcess {
  readonly stdin = new FakeStream();
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  killed = false;

  kill(): void {
    this.killed = true;
  }
}

describe("image rotation", () => {
  it("uses absolute sips invocation without a shell", async () => {
    const process = new FakeProcess();
    const calls: unknown[][] = [];
    const spawn: OcrSpawn = (...args) => {
      calls.push(args);
      queueMicrotask(() => process.emit("close", 0));
      return process;
    };

    await rotateImageFile(
      {
        sourcePath: "/tmp/input.tiff",
        destinationPath: "/tmp/output.png",
        quarterTurns: -1,
      },
      {
        spawn,
        stat: async () => ({ isFile: () => true, size: 128 }),
      },
    );

    expect(calls[0]).toEqual([
      "/usr/bin/sips",
      [
        "--rotate",
        "-90",
        "--setProperty",
        "format",
        "png",
        "/tmp/input.tiff",
        "--out",
        "/tmp/output.png",
      ],
      { shell: false, stdio: ["pipe", "pipe", "pipe"] },
    ]);
  });

  it("rejects unsafe paths and unsupported turns before spawning", async () => {
    await expect(
      rotateImageFile({
        sourcePath: "relative.png",
        destinationPath: "/tmp/output.png",
        quarterTurns: 1,
      }),
    ).rejects.toThrow(/absolute/i);
    await expect(
      rotateImageFile({
        sourcePath: "/tmp/input.png",
        destinationPath: "/tmp/output.jpg",
        quarterTurns: 1,
      }),
    ).rejects.toThrow(/PNG/i);
  });

  it("kills a process whose output exceeds the bounded limit", async () => {
    const process = new FakeProcess();
    const spawn: OcrSpawn = () => {
      queueMicrotask(() => process.stdout.emit("data", Buffer.alloc(65_537)));
      return process;
    };
    await expect(
      rotateImageFile(
        {
          sourcePath: "/tmp/input.png",
          destinationPath: "/tmp/output.png",
          quarterTurns: 1,
        },
        { spawn, stat: async () => ({ isFile: () => true }) },
      ),
    ).rejects.toThrow(/64 KiB/i);
    expect(process.killed).toBe(true);
  });
});
