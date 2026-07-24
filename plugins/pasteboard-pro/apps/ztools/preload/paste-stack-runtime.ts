import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

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
  start(callback: () => boolean): void;
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

export function writePreparedStackItem(
  item: PreparedStackItem,
  clipboard: ClipboardWriter,
  nativeImage: NativeImageApi,
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
    clipboard.writeBuffer("NSFilenamesPboardType", fileListPropertyList(item.filePaths));
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
  return {
    start(callback) {
      if (child !== undefined) return;
      const monitor = spawn(
        options.pythonPath ?? "/usr/bin/python3",
        [options.scriptPath ?? path.join(__dirname, "paste-stack-key-monitor.py")],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      child = monitor;
      monitor.stderr.resume();
      monitor.stdin.on("error", () => undefined);
      monitor.on("error", () => undefined);
      const lines = readline.createInterface({ input: monitor.stdout });
      lines.on("line", (line) => {
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
      monitor.once("exit", () => {
        lines.close();
        if (child === monitor) child = undefined;
      });
    },
    stop() {
      const monitor = child;
      child = undefined;
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
    if (this.hookStarted) this.hook?.stop();
    this.hookStarted = false;
  }

  private syncHook(): void {
    const shouldStart = this.state.itemIds.length > 0 && this.hook !== undefined;
    if (shouldStart && !this.hookStarted) {
      try {
        this.hook?.start(() => this.handlePasteRequest());
        this.hookStarted = true;
      } catch {
        this.hookStarted = false;
      }
    } else if (!shouldStart && this.hookStarted) {
      this.hook?.stop();
      this.hookStarted = false;
    }
  }

  private handlePasteRequest(): boolean {
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
    const pending = this.persistence.then(async () => {
      await this.stackStore.put(snapshot);
    });
    this.persistence = pending.catch(() => undefined);
    return true;
  }
}
