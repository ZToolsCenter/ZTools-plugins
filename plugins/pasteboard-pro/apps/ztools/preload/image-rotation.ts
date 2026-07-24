import { spawn as nodeSpawn } from "node:child_process";
import { stat as nodeStat } from "node:fs/promises";
import path from "node:path";

import type { OcrProcess, OcrSpawn } from "./ocr";

export type ImageRotationInput = Readonly<{
  sourcePath: string;
  destinationPath: string;
  quarterTurns: -1 | 1;
}>;

export type ImageRotationOptions = Readonly<{
  spawn?: OcrSpawn;
  stat?: (path: string) => Promise<Readonly<{ isFile(): boolean; size?: number }>>;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1_024;

function defaultSpawn(...args: Parameters<OcrSpawn>): OcrProcess {
  return nodeSpawn(args[0], [...args[1]], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  }) as OcrProcess;
}

export async function rotateImageFile(
  input: ImageRotationInput,
  options: ImageRotationOptions = {},
): Promise<void> {
  if (!path.isAbsolute(input.sourcePath) || !path.isAbsolute(input.destinationPath)) {
    throw new TypeError("Image rotation paths must be absolute");
  }
  if (input.sourcePath === input.destinationPath) {
    throw new TypeError("Image rotation must write to a separate destination");
  }
  if (input.quarterTurns !== -1 && input.quarterTurns !== 1) {
    throw new RangeError("Image rotation must be -1 or 1 quarter turn");
  }
  if (path.extname(input.destinationPath).toLowerCase() !== ".png") {
    throw new TypeError("Image rotation destination must use PNG");
  }
  const source = await (options.stat ?? nodeStat)(input.sourcePath);
  if (!source.isFile()) {
    throw new TypeError("Image rotation source must be a file");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Image rotation timeout must be finite and positive");
  }
  const spawn = options.spawn ?? defaultSpawn;
  const degrees = input.quarterTurns > 0 ? "90" : "-90";

  await new Promise<void>((resolve, reject) => {
    let child: OcrProcess;
    try {
      child = spawn(
        "/usr/bin/sips",
        [
          "--rotate",
          degrees,
          "--setProperty",
          "format",
          "png",
          input.sourcePath,
          "--out",
          input.destinationPath,
        ],
        { shell: false, stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let outputBytes = 0;
    const stderr: Buffer[] = [];
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`Image rotation timed out after ${timeoutMs} ms`)));
    }, timeoutMs);
    const collect = (chunk: unknown, target?: Buffer[]): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += buffer.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new RangeError("Image rotation process output exceeds 64 KiB")));
        return;
      }
      target?.push(buffer);
    };
    child.stdout.on("data", (chunk) => collect(chunk));
    child.stderr.on("data", (chunk) => collect(chunk, stderr));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        const message = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(message || `Image rotation exited with code ${code}`));
      });
    });
    child.stdin.end();
  });

  const destination = await (options.stat ?? nodeStat)(input.destinationPath);
  if (!destination.isFile()) {
    throw new TypeError("Image rotation did not create an output file");
  }
}
