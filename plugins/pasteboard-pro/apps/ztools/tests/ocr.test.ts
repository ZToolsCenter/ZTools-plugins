import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createOcrClient,
  validateOcrRequest,
  type OcrProcess,
  type OcrSpawn,
} from "../preload/ocr";

class FakeStream extends EventEmitter {
  end(value?: string): void {
    if (value !== undefined) this.emit("written", value);
  }
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

describe("OCR protocol", () => {
  it("validates absolute image requests and rejects unsafe input", () => {
    expect(
      validateOcrRequest({ requestId: "req-1", imagePath: "/tmp/input.png" }),
    ).toEqual({ requestId: "req-1", imagePath: "/tmp/input.png" });
    expect(() =>
      validateOcrRequest({ requestId: "req-1", imagePath: "relative.png" }),
    ).toThrow(/absolute/i);
    expect(() =>
      validateOcrRequest({
        requestId: "req-1",
        imagePath: `/tmp/${"x".repeat(8_200)}.png`,
      }),
    ).toThrow(/8 KiB/i);
    expect(() =>
      validateOcrRequest({ requestId: "req-1", imagePath: "/tmp/input.txt" }),
    ).toThrow(/image/i);
  });

  it("spawns the absolute helper without a shell and parses one JSON response", async () => {
    const process = new FakeProcess();
    const calls: unknown[][] = [];
    const spawn: OcrSpawn = (...args) => {
      calls.push(args);
      queueMicrotask(() => {
        process.stdout.emit(
          "data",
          Buffer.from('{"requestId":"req-1","ok":true,"text":"hello"}\n'),
        );
        process.emit("close", 0);
      });
      return process;
    };
    const client = createOcrClient({
      helperPath: "/Applications/PasteboardPro/pasteboard-vision",
      spawn,
      stat: async () => ({ isFile: () => true }),
      requestId: () => "req-1",
    });

    await expect(client.recognize("/tmp/input.png")).resolves.toBe("hello");
    expect(calls[0]).toEqual([
      "/Applications/PasteboardPro/pasteboard-vision",
      [],
      { shell: false, stdio: ["pipe", "pipe", "pipe"] },
    ]);
  });

  it("kills helpers that exceed the response limit", async () => {
    const process = new FakeProcess();
    const spawn: OcrSpawn = () => {
      queueMicrotask(() => {
        process.stdout.emit("data", Buffer.alloc(1_048_577));
      });
      return process;
    };
    const client = createOcrClient({
      helperPath: "/absolute/helper",
      spawn,
      stat: async () => ({ isFile: () => true }),
      requestId: () => "req-1",
    });

    await expect(client.recognize("/tmp/input.png")).rejects.toThrow(/1 MiB/i);
    expect(process.killed).toBe(true);
  });

  it("preserves structured helper errors even when the process exits nonzero", async () => {
    const process = new FakeProcess();
    const spawn: OcrSpawn = () => {
      queueMicrotask(() => {
        process.stdout.emit(
          "data",
          Buffer.from(
            '{"requestId":"req-1","ok":false,"error":"unsupported image"}\n',
          ),
        );
        process.emit("close", 1);
      });
      return process;
    };
    const client = createOcrClient({
      helperPath: "/absolute/helper",
      spawn,
      stat: async () => ({ isFile: () => true }),
      requestId: () => "req-1",
    });

    await expect(client.recognize("/tmp/input.png")).rejects.toThrow(
      "unsupported image",
    );
  });

  it("keeps the Swift helper constrained to Vision and JSON line IO", async () => {
    const source = await readFile(
      new URL("../native/vision-helper/main.swift", import.meta.url),
      "utf8",
    );
    expect(source).toContain("VNRecognizeTextRequest");
    expect(source).toContain("CGImageSourceCreateWithURL");
    expect(source).toContain("readLine");
    expect(source).not.toMatch(/URLSession|Process\(|system\(|NSTask/);
  });
});
