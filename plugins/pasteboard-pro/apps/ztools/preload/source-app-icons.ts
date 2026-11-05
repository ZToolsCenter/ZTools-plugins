import { execFile as nodeExecFile } from "node:child_process";
import { isAbsolute } from "node:path";

const OSASCRIPT_PATH = "/usr/bin/osascript";
const EXEC_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 4_096,
  shell: false,
  timeout: 3_000,
  windowsHide: true,
} as const;
const MAX_SOURCE_NAME_LENGTH = 128;
const MAX_BUNDLE_ID_LENGTH = 255;
const MAX_APPLICATION_PATH_LENGTH = 2_048;
const MAX_ICON_BYTES = 256 * 1_024;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 2_500;
const DEFAULT_CACHE_ENTRIES = 128;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_QUEUED = 32;

/** A fixed script: untrusted source metadata is passed only as argv values. */
export const MAC_APPLICATION_PATH_SCRIPT = String.raw`
ObjC.import('AppKit');
function run(argv) {
  var workspace = $.NSWorkspace.sharedWorkspace;
  var bundleId = argv.length > 0 ? argv[0] : '';
  var name = argv.length > 1 ? argv[1] : '';
  var appUrl = null;
  if (bundleId) {
    appUrl = workspace.URLForApplicationWithBundleIdentifier($(bundleId));
  }
  if ((!appUrl || appUrl.isNil()) && name) {
    var fullPath = workspace.fullPathForApplication($(name));
    return fullPath && !fullPath.isNil() ? ObjC.unwrap(fullPath) : '';
  }
  return appUrl && !appUrl.isNil() ? ObjC.unwrap(appUrl.path) : '';
}
`;

export type SourceAppIdentity = Readonly<{
  name?: string;
  bundleId?: string;
}>;

export type SourceAppExecFile = (
  file: string,
  args: readonly string[],
  options: typeof EXEC_OPTIONS,
  callback: (error: (Error & { code?: string | number }) | null, stdout: string) => void,
) => unknown;

export type SourceAppIconServiceOptions = Readonly<{
  getFileIcon?: (applicationPath: string) => unknown | Promise<unknown>;
  resolveApplicationPath?: (
    sourceApp: SourceAppIdentity,
  ) => string | undefined | Promise<string | undefined>;
  execFile?: SourceAppExecFile;
  platform?: NodeJS.Platform;
  now?: () => number;
  cacheEntries?: number;
  concurrency?: number;
  maxQueued?: number;
}>;

type NormalizedSourceApp = Readonly<{
  name?: string;
  bundleId?: string;
}>;

type CacheEntry = Readonly<{
  expiresAt: number;
  icon?: string;
}>;

function defaultExecFile(...args: Parameters<SourceAppExecFile>): unknown {
  return nodeExecFile(
    args[0],
    [...args[1]],
    args[2],
    args[3] as (error: Error | null, stdout: string) => void,
  );
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > MAX_SOURCE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    return undefined;
  }
  return name;
}

function normalizeBundleId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const bundleId = value.trim();
  if (
    bundleId.length === 0 ||
    bundleId.length > MAX_BUNDLE_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(bundleId)
  ) {
    return undefined;
  }
  return bundleId;
}

export function normalizeSourceAppIdentity(value: unknown): NormalizedSourceApp | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const sourceApp = value as Record<string, unknown>;
  const name = normalizeName(sourceApp.name);
  const bundleId = normalizeBundleId(sourceApp.bundleId);
  return name === undefined && bundleId === undefined
    ? undefined
    : {
        ...(name === undefined ? {} : { name }),
        ...(bundleId === undefined ? {} : { bundleId }),
      };
}

export function isLocalApplicationPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_APPLICATION_PATH_LENGTH &&
    isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /\.(?:app|exe)$/iu.test(value)
  );
}

export function normalizePngDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix) || value.length > Math.ceil(MAX_ICON_BYTES * 4 / 3) + prefix.length + 4) {
    return undefined;
  }
  const base64 = value.slice(prefix.length);
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(base64, "base64");
  return decoded.byteLength > 0 && decoded.byteLength <= MAX_ICON_BYTES && decoded.toString("base64") === base64
    ? value
    : undefined;
}

export async function resolveMacApplicationPath(
  sourceApp: SourceAppIdentity,
  options: Readonly<{
    platform?: NodeJS.Platform;
    execFile?: SourceAppExecFile;
  }> = {},
): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  const identity = normalizeSourceAppIdentity(sourceApp);
  if (identity === undefined) return undefined;

  const execFile = options.execFile ?? defaultExecFile;
  const args = [
    "-l",
    "JavaScript",
    "-e",
    MAC_APPLICATION_PATH_SCRIPT,
    "--",
    identity.bundleId ?? "",
    identity.name ?? "",
  ];
  const resolved = await new Promise<string | undefined>((resolve) => {
    execFile(OSASCRIPT_PATH, args, EXEC_OPTIONS, (error, stdout) => {
      if (error !== null) {
        resolve(undefined);
        return;
      }
      const applicationPath = stdout.trim();
      resolve(isLocalApplicationPath(applicationPath) ? applicationPath : undefined);
    });
  });
  return resolved;
}

/**
 * Resolves local application icons without adding machine-specific paths or
 * image bytes to clipboard records or sync payloads.
 */
export class SourceAppIconService {
  private readonly options: SourceAppIconServiceOptions;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly waiters: Array<() => void> = [];
  private activeQueries = 0;

  constructor(options: SourceAppIconServiceOptions = {}) {
    this.options = options;
  }

  getSourceAppIcon(sourceAppValue: SourceAppIdentity): Promise<string | undefined> {
    const identity = normalizeSourceAppIdentity(sourceAppValue);
    if (
      identity === undefined ||
      (this.options.platform ?? process.platform) !== "darwin" ||
      this.options.getFileIcon === undefined
    ) {
      return Promise.resolve(undefined);
    }

    const key = identity.bundleId === undefined
      ? `name:${identity.name?.toLocaleLowerCase("en-US") ?? ""}`
      : `bundle:${identity.bundleId.toLocaleLowerCase("en-US")}`;
    const cached = this.getCached(key);
    if (cached !== undefined) return Promise.resolve(cached.icon);
    const inFlight = this.inFlight.get(key);
    if (inFlight !== undefined) return inFlight;

    const request = Promise.resolve()
      .then(() => this.loadIcon(identity))
      .catch(() => undefined)
      .then((icon) => {
        const now = (this.options.now ?? Date.now)();
        this.setCached(key, {
          expiresAt: now + (icon === undefined ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
          ...(icon === undefined ? {} : { icon }),
        });
        return icon;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  private getCached(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= (this.options.now ?? Date.now)()) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private setCached(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    const limit = Math.max(1, Math.floor(this.options.cacheEntries ?? DEFAULT_CACHE_ENTRIES));
    while (this.cache.size > limit) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async loadIcon(identity: NormalizedSourceApp): Promise<string | undefined> {
    const release = await this.acquireQuerySlot();
    if (release === undefined) return undefined;
    try {
      const pathResolver = this.options.resolveApplicationPath ?? ((sourceApp) =>
        resolveMacApplicationPath(sourceApp, {
          ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
          ...(this.options.execFile === undefined ? {} : { execFile: this.options.execFile }),
        }));
      const applicationPath = await pathResolver(identity);
      if (!isLocalApplicationPath(applicationPath)) return undefined;
      const dataUrl = await this.options.getFileIcon?.(applicationPath);
      return normalizePngDataUrl(dataUrl);
    } finally {
      release();
    }
  }

  private async acquireQuerySlot(): Promise<(() => void) | undefined> {
    const concurrency = Math.max(1, Math.floor(this.options.concurrency ?? DEFAULT_CONCURRENCY));
    let receivedHandoff = false;
    if (this.activeQueries >= concurrency) {
      const maxQueued = Math.max(0, Math.floor(this.options.maxQueued ?? DEFAULT_MAX_QUEUED));
      if (this.waiters.length >= maxQueued) return undefined;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      receivedHandoff = true;
    }
    if (!receivedHandoff) this.activeQueries += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next === undefined) {
        this.activeQueries = Math.max(0, this.activeQueries - 1);
      } else {
        // Hand the occupied slot directly to the waiting operation.
        next();
      }
    };
  }
}
