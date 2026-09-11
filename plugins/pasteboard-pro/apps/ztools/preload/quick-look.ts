import { spawn as nodeSpawn } from "node:child_process";
import { stat as nodeStat } from "node:fs/promises";
import path from "node:path";

export type QuickLookProcess = Readonly<{
  once(event: "error" | "spawn", listener: (...args: any[]) => void): QuickLookProcess;
  unref(): void;
}>;

export type QuickLookSpawn = (
  command: string,
  args: readonly string[],
  options: Readonly<{ shell: false; stdio: "ignore"; detached: true }>,
) => QuickLookProcess;

export type QuickLookOptions = Readonly<{
  platform?: NodeJS.Platform;
  spawn?: QuickLookSpawn;
  stat?: (path: string) => Promise<Readonly<{ isFile(): boolean }>>;
  timeoutMs?: number;
}>;

const QUICK_LOOK_PATH = "/usr/bin/qlmanage";
const DEFAULT_TIMEOUT_MS = 5_000;

function previewCommand(platform: NodeJS.Platform, filePath: string): Readonly<{
  command: string;
  args: readonly string[];
}> {
  if (platform === "darwin") {
    return { command: QUICK_LOOK_PATH, args: ["-p", filePath] };
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [filePath] };
  }
  if (platform === "linux") {
    return { command: "xdg-open", args: [filePath] };
  }
  throw new Error("当前平台不支持文件预览");
}

const defaultSpawn: QuickLookSpawn = (command, args, options) =>
  nodeSpawn(command, [...args], options) as QuickLookProcess;

export async function openQuickLook(
  filePath: string,
  options: QuickLookOptions = {},
): Promise<void> {
  if (!path.isAbsolute(filePath)) {
    throw new TypeError("Quick Look path must be absolute");
  }
  const metadata = await (options.stat ?? nodeStat)(filePath);
  if (!metadata.isFile()) {
    throw new TypeError("Quick Look target must be a file");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Quick Look timeout must be finite and positive");
  }
  const command = previewCommand(options.platform ?? process.platform, filePath);

  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<QuickLookSpawn>;
    try {
      child = (options.spawn ?? defaultSpawn)(command.command, command.args, {
        shell: false,
        stdio: "ignore",
        detached: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Quick Look did not start within ${timeoutMs} ms`)));
    }, timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("spawn", () => {
      child.unref();
      finish(resolve);
    });
  });
}
