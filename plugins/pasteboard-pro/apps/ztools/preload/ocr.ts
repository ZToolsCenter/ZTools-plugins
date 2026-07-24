import { spawn as nodeSpawn } from "node:child_process";
import { stat as nodeStat } from "node:fs/promises";
import path from "node:path";

export type OcrRequest = Readonly<{
  requestId: string;
  imagePath: string;
}>;

export interface OcrStream {
  on(event: "data", listener: (chunk: unknown) => void): this;
}

export interface OcrInputStream {
  end(value?: string): void;
}

export interface OcrProcess {
  stdin: OcrInputStream;
  stdout: OcrStream;
  stderr: OcrStream;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
  kill(): void;
}

export type OcrSpawn = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    shell: false;
    stdio: readonly ["pipe", "pipe", "pipe"];
  }>,
) => OcrProcess;

export type OcrClientOptions = Readonly<{
  helperPath: string;
  spawn?: OcrSpawn;
  stat?: (path: string) => Promise<Readonly<{ isFile(): boolean }>>;
  requestId?: () => string;
  timeoutMs?: number;
}>;

export interface OcrClient {
  recognize(imagePath: string): Promise<string>;
}

const MAX_REQUEST_BYTES = 8 * 1_024;
const MAX_RESPONSE_BYTES = 1 * 1_024 * 1_024;
const DEFAULT_TIMEOUT_MS = 15_000;
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateOcrRequest(value: unknown): OcrRequest {
  if (!isRecord(value)) {
    throw new TypeError("OCR request must be an object");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "requestId" && key !== "imagePath")) {
    throw new TypeError("OCR request contains unsupported commands or fields");
  }
  if (typeof value.requestId !== "string" || value.requestId.trim().length === 0) {
    throw new TypeError("OCR requestId must be a non-empty string");
  }
  if (typeof value.imagePath !== "string" || !path.isAbsolute(value.imagePath)) {
    throw new TypeError("OCR imagePath must be absolute");
  }
  if (!IMAGE_EXTENSIONS.has(path.extname(value.imagePath).toLowerCase())) {
    throw new TypeError("OCR input must use a supported image extension");
  }

  const request = {
    requestId: value.requestId.trim(),
    imagePath: value.imagePath,
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES) {
    throw new RangeError("OCR request cannot exceed 8 KiB");
  }
  return request;
}

function responseText(value: unknown, requestId: string): string {
  if (
    !isRecord(value) ||
    value.requestId !== requestId ||
    typeof value.ok !== "boolean"
  ) {
    throw new TypeError("OCR helper returned an invalid response envelope");
  }
  if (!value.ok) {
    throw new Error(
      typeof value.error === "string" ? value.error : "OCR helper failed",
    );
  }
  if (typeof value.text !== "string") {
    throw new TypeError("OCR helper response is missing text");
  }
  return value.text;
}

function defaultSpawn(...args: Parameters<OcrSpawn>): OcrProcess {
  return nodeSpawn(args[0], [...args[1]], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  }) as OcrProcess;
}

export function createOcrClient(options: OcrClientOptions): OcrClient {
  if (!path.isAbsolute(options.helperPath)) {
    throw new TypeError("OCR helper path must be absolute");
  }
  const spawn = options.spawn ?? defaultSpawn;
  const stat = options.stat ?? nodeStat;
  const requestId = options.requestId ?? (() => crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("OCR timeout must be finite and positive");
  }

  return {
    async recognize(imagePath) {
      const request = validateOcrRequest({ requestId: requestId(), imagePath });
      const file = await stat(request.imagePath);
      if (!file.isFile()) {
        throw new TypeError("OCR imagePath must point to a file");
      }

      return await new Promise<string>((resolve, reject) => {
        let child: OcrProcess;
        try {
          child = spawn(options.helperPath, [], {
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          reject(error);
          return;
        }

        let settled = false;
        let stdoutBytes = 0;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(() => reject(new Error(`OCR helper timed out after ${timeoutMs} ms`)));
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
          stdoutBytes += buffer.length;
          if (stdoutBytes > MAX_RESPONSE_BYTES) {
            child.kill();
            finish(() => reject(new RangeError("OCR response cannot exceed 1 MiB")));
            return;
          }
          stdout.push(buffer);
        });
        child.stderr.on("data", (chunk) => {
          if (Buffer.concat(stderr).length < 8_192) {
            stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
        });
        child.on("error", (error) => finish(() => reject(error)));
        child.on("close", (code) => {
          finish(() => {
            try {
              const lines = Buffer.concat(stdout)
                .toString("utf8")
                .split(/\r?\n/u)
                .filter((line) => line.length > 0);
              if (lines.length === 1) {
                resolve(responseText(JSON.parse(lines[0]!), request.requestId));
                return;
              }
              if (code !== 0) {
                const message = Buffer.concat(stderr).toString("utf8").trim();
                throw new Error(message || `OCR helper exited with code ${code}`);
              }
              if (lines.length !== 1) {
                throw new TypeError("OCR helper must return exactly one JSON line");
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        child.stdin.end(`${JSON.stringify(request)}\n`);
      });
    },
  };
}
