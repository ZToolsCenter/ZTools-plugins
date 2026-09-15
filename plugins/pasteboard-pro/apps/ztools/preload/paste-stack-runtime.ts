import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  reducePasteStack,
  type PasteStackState,
} from "@pasteboard-pro/core";

import type {
  CanonicalClipboardRecord,
  ZToolsCanonicalClipboardStore,
} from "./clipboard-store";
import type { NativeImageApi, NativeImageLike } from "./thumbnail";
import {
  normalizePasteStackState,
  type ZToolsPasteStackStore,
} from "./paste-stack-store";

export type GlobalPasteHook = Readonly<{
  start(
    callback: () => boolean,
    onStopped: (reason: "accessibility-required" | "exit" | "error") => void,
  ): void;
  stop(): void;
}>;

export type ClipboardWriter = Readonly<{
  write(data: Readonly<{ text?: string; html?: string }>): void;
  writeText(text: string): void;
  writeImage(image: NativeImageLike): void;
  writeBuffer(format: string, buffer: Uint8Array): void;
}>;

export type PreparedStackItem =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "html"; text: string; html: string }>
  | Readonly<{ type: "image"; imagePath: string }>
  | Readonly<{ type: "files"; filePaths: string[] }>;

export function prepareStackItem(
  record: CanonicalClipboardRecord,
): PreparedStackItem | null {
  const filePaths = record.item.payload.filePaths?.filter((value) => value.length > 0);
  if (filePaths !== undefined && filePaths.length > 0) {
    return { type: "files", filePaths: [...filePaths] };
  }
  const imagePath = record.origin.imagePath;
  if (record.item.kind === "image" && imagePath !== undefined) {
    return { type: "image", imagePath };
  }
  const text = record.item.payload.text ?? record.item.ocrText ?? "";
  const html = record.item.payload.html;
  if (html !== undefined) return { type: "html", text, html };
  if (text.length > 0) return { type: "text", text };
  return null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fileListPropertyList(filePaths: readonly string[]): Uint8Array {
  const values = filePaths.map((filePath) => `<string>${escapeXml(filePath)}</string>`).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
      `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
      `<plist version="1.0"><array>${values}</array></plist>`,
    "utf8",
  );
}

function windowsFileDropBuffer(filePaths: readonly string[]): Uint8Array {
  const names = Buffer.from(`${filePaths.join("\0")}\0\0`, "utf16le");
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0);
  header.writeUInt32LE(1, 16);
  return Buffer.concat([header, names]);
}

function linuxFileUriList(filePaths: readonly string[]): Uint8Array {
  return Buffer.from(
    `${filePaths.map((filePath) => pathToFileURL(filePath).href).join("\r\n")}\r\n`,
    "utf8",
  );
}

function fileClipboardData(
  filePaths: readonly string[],
  platform: NodeJS.Platform,
): Readonly<{ format: string; buffer: Uint8Array }> {
  if (platform === "darwin") {
    return { format: "NSFilenamesPboardType", buffer: fileListPropertyList(filePaths) };
  }
  if (platform === "win32") {
    return { format: "FileNameW", buffer: windowsFileDropBuffer(filePaths) };
  }
  if (platform === "linux") {
    return { format: "text/uri-list", buffer: linuxFileUriList(filePaths) };
  }
  throw new Error("当前平台不支持文件粘贴");
}

export function writePreparedStackItem(
  item: PreparedStackItem,
  clipboard: ClipboardWriter,
  nativeImage: NativeImageApi,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (item.type === "text") {
    clipboard.writeText(item.text);
    return true;
  }
  if (item.type === "html") {
    clipboard.write({ text: item.text, html: item.html });
    return true;
  }
  if (item.type === "files") {
    const data = fileClipboardData(item.filePaths, platform);
    clipboard.writeBuffer(data.format, data.buffer);
    return true;
  }
  const image = nativeImage.createFromPath(item.imagePath);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
}

export function createZToolsGlobalPasteHook(options: Readonly<{
  simulatePaste(): void;
  pythonPath?: string;
  scriptPath?: string;
}>): GlobalPasteHook | undefined {
  if (process.platform !== "darwin") return undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  const intentionallyStopped = new WeakSet<ChildProcessWithoutNullStreams>();
  return {
    start(callback, onStopped) {
      if (child !== undefined) return;
      const monitor = spawn(
        options.pythonPath ?? "/usr/bin/python3",
        [options.scriptPath ?? path.join(__dirname, "paste-stack-key-monitor.py")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      child = monitor;
      monitor.stderr.resume();
      monitor.stdin.on("error", () => undefined);
      let stopReason: "accessibility-required" | "exit" | "error" = "exit";
      monitor.on("error", () => {
        stopReason = "error";
      });
      const lines = readline.createInterface({ input: monitor.stdout });
      lines.on("line", (line) => {
        if (line === "accessibility-required") {
          stopReason = "accessibility-required";
          return;
        }
        const match = /^paste:(\d+)$/u.exec(line);
        if (match === null || child !== monitor) return;
        const requestId = match[1]!;
        let consumed = false;
        try {
          consumed = callback();
        } catch {
          consumed = false;
        }
        if (monitor.stdin.destroyed) return;
        monitor.stdin.write(`${consumed ? "consume" : "pass"}:${requestId}\n`);
        if (consumed) {
          monitor.stdin.write("allow-next\n");
          globalThis.setTimeout(() => {
            try {
              options.simulatePaste();
            } catch {}
          }, 20);
        }
      });
      monitor.once("close", () => {
        lines.close();
        if (child === monitor) {
          child = undefined;
          if (!intentionallyStopped.has(monitor)) onStopped(stopReason);
        }
      });
    },
    stop() {
      const monitor = child;
      child = undefined;
      if (monitor !== undefined) intentionallyStopped.add(monitor);
      monitor?.kill();
    },
  };
}

export class PasteStackRuntime {
  private state: PasteStackState = { direction: "forward", itemIds: [] };
  private prepared = new Map<string, PreparedStackItem>();
  private hookStarted = false;
  private generation = 0;
  private stateVersion = 0;
  private persistence = Promise.resolve();
  private persistenceFailed = false;
  private hookRestartTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private hookRestartAttempt = 0;
  private hookBlockedForPermission = false;
  private persistenceRetryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private persistenceRetryAttempt = 0;

  constructor(
    private readonly stackStore: ZToolsPasteStackStore,
    private readonly clipboardStore: Pick<ZToolsCanonicalClipboardStore, "findRecordByItemId">,
    private readonly clipboard: ClipboardWriter,
    private readonly nativeImage: NativeImageApi,
    private readonly hook: GlobalPasteHook | undefined,
    private readonly onChange: (state: PasteStackState) => void = () => undefined,
  ) {}

  async initialize(): Promise<void> {
    await this.replace(await this.stackStore.get(), false);
  }

  async replace(input: PasteStackState, persist = true): Promise<PasteStackState> {
    const generation = ++this.generation;
    const normalized = normalizePasteStackState(input);
    this.hookBlockedForPermission = false;
    this.hookRestartAttempt = 0;
    const entries = await Promise.all(
      normalized.itemIds.map(async (itemId) => {
        const record = await this.clipboardStore.findRecordByItemId(itemId);
        const item = record === undefined ? null : prepareStackItem(record);
        return item === null ? null : ([itemId, item] as const);
      }),
    );
    if (generation !== this.generation) return structuredClone(this.state);

    this.prepared = new Map(entries.flatMap((entry) => (entry === null ? [] : [entry])));
    this.state = {
      direction: normalized.direction,
      itemIds: normalized.itemIds.filter((itemId) => this.prepared.has(itemId)),
    };
    this.stateVersion += 1;
    this.syncHook();
    if (persist || this.state.itemIds.length !== normalized.itemIds.length) {
      this.state = await this.stackStore.put(this.state);
    }
    this.onChange(structuredClone(this.state));
    return structuredClone(this.state);
  }

  async refreshFromStore(): Promise<PasteStackState> {
    const baselineVersion = this.stateVersion;
    while (true) {
      const pending = this.persistence;
      await pending;
      if (pending === this.persistence) break;
    }
    if (this.persistenceFailed) {
      this.persistSnapshot(structuredClone(this.state));
      await this.persistence;
      if (this.persistenceFailed) return structuredClone(this.state);
    }
    if (baselineVersion !== this.stateVersion) return structuredClone(this.state);
    const stored = await this.stackStore.get();
    if (baselineVersion !== this.stateVersion) return structuredClone(this.state);
    if (
      stored.direction === this.state.direction &&
      stored.itemIds.length === this.state.itemIds.length &&
      stored.itemIds.every((itemId, index) => itemId === this.state.itemIds[index])
    ) {
      return structuredClone(this.state);
    }
    return this.replace(stored, false);
  }

  dispose(): void {
    if (this.hookRestartTimer !== undefined) {
      globalThis.clearTimeout(this.hookRestartTimer);
      this.hookRestartTimer = undefined;
    }
    if (this.persistenceRetryTimer !== undefined) {
      globalThis.clearTimeout(this.persistenceRetryTimer);
      this.persistenceRetryTimer = undefined;
    }
    if (this.hookStarted) this.hook?.stop();
    this.hookStarted = false;
  }

  private syncHook(): void {
    const shouldStart =
      this.state.itemIds.length > 0 &&
      this.hook !== undefined &&
      !this.hookBlockedForPermission;
    if (shouldStart && !this.hookStarted) {
      this.hookStarted = true;
      try {
        this.hook?.start(
          () => this.handlePasteRequest(),
          (reason) => this.handleHookStopped(reason),
        );
      } catch {
        this.hookStarted = false;
      }
    } else if (!shouldStart && this.hookStarted) {
      this.hook?.stop();
      this.hookStarted = false;
    }
  }

  private handleHookStopped(reason: "accessibility-required" | "exit" | "error"): void {
    this.hookStarted = false;
    if (this.state.itemIds.length === 0) return;
    if (this.hookRestartTimer !== undefined) globalThis.clearTimeout(this.hookRestartTimer);
    if (reason === "accessibility-required") {
      this.hookBlockedForPermission = true;
      this.hookRestartTimer = undefined;
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.hookRestartAttempt, 30_000);
    this.hookRestartAttempt += 1;
    this.hookRestartTimer = globalThis.setTimeout(() => {
      this.hookRestartTimer = undefined;
      this.syncHook();
    }, delay);
  }

  retryGlobalHook(): void {
    this.hookBlockedForPermission = false;
    this.hookRestartAttempt = 0;
    this.syncHook();
  }

  private handlePasteRequest(): boolean {
    this.hookRestartAttempt = 0;
    return this.consumeCurrent();
  }

  private consumeCurrent(): boolean {
    const itemId =
      this.state.direction === "forward"
        ? this.state.itemIds[0]
        : this.state.itemIds.at(-1);
    const item = itemId === undefined ? undefined : this.prepared.get(itemId);
    if (itemId === undefined || item === undefined) return false;
    if (!writePreparedStackItem(item, this.clipboard, this.nativeImage)) return false;

    this.generation += 1;
    this.state = reducePasteStack(this.state, { type: "consume" });
    this.stateVersion += 1;
    this.prepared.delete(itemId);
    globalThis.setTimeout(() => this.syncHook(), 100);
    const snapshot = structuredClone(this.state);
    this.onChange(snapshot);
    this.persistSnapshot(snapshot);
    return true;
  }

  private persistSnapshot(snapshot: PasteStackState): void {
    this.persistence = this.persistence.then(async () => {
      try {
        await this.stackStore.put(snapshot);
        this.persistenceFailed = false;
        this.persistenceRetryAttempt = 0;
        if (this.persistenceRetryTimer !== undefined) {
          globalThis.clearTimeout(this.persistenceRetryTimer);
          this.persistenceRetryTimer = undefined;
        }
      } catch {
        this.persistenceFailed = true;
        this.schedulePersistenceRetry();
      }
    });
  }

  private schedulePersistenceRetry(): void {
    if (this.persistenceRetryTimer !== undefined) return;
    const delay = Math.min(250 * 2 ** this.persistenceRetryAttempt, 30_000);
    this.persistenceRetryAttempt += 1;
    this.persistenceRetryTimer = globalThis.setTimeout(() => {
      this.persistenceRetryTimer = undefined;
      this.persistSnapshot(structuredClone(this.state));
    }, delay);
  }
}
