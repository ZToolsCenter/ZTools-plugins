import { execFile as nodeExecFile } from "node:child_process";
import { readdir as nodeReaddir, realpath as nodeRealpath, stat as nodeStat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const OSASCRIPT_PATH = "/usr/bin/osascript";
const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_APPLICATIONS = 4_096;
const MAX_DIRECTORY_ENTRIES = 16_384;
const MAX_OSASCRIPT_ARGV_BYTES = 64 * 1_024;
const MAX_APPLICATION_PATH_LENGTH = 2_048;
const MAX_BUNDLE_ID_LENGTH = 255;
const MAX_NAME_LENGTH = 128;
const EXEC_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 2 * 1_024 * 1_024,
  shell: false,
  timeout: 15_000,
  windowsHide: true,
} as const;

/** One fixed script reads all supplied Info.plist files in the same process. */
export const APPLICATION_CATALOG_SCRIPT = String.raw`
ObjC.import('Foundation');
function stringValue(value) {
  if (!value || (typeof value.isNil === 'function' && value.isNil())) return '';
  try { return ObjC.unwrap(value); } catch (error) { return ''; }
}
function valueFor(dictionary, key) {
  if (!dictionary || (typeof dictionary.isNil === 'function' && dictionary.isNil())) return '';
  try { return stringValue(dictionary.objectForKey($(key))); } catch (error) { return ''; }
}
function run(argv) {
  var records = [];
  for (var index = 0; index < argv.length; index += 1) {
    try {
      var applicationPath = argv[index];
      var infoPath = applicationPath + '/Contents/Info.plist';
      var info = $.NSDictionary.dictionaryWithContentsOfFile($(infoPath));
      if (!info || info.isNil()) continue;
      var bundle = $.NSBundle.bundleWithPath($(applicationPath));
      var localized = bundle && !bundle.isNil() ? bundle.localizedInfoDictionary : null;
      records.push({
        index: index,
        bundleId: valueFor(info, 'CFBundleIdentifier'),
        localizedDisplayName: valueFor(localized, 'CFBundleDisplayName'),
        localizedBundleName: valueFor(localized, 'CFBundleName'),
        displayName: valueFor(info, 'CFBundleDisplayName'),
        bundleName: valueFor(info, 'CFBundleName')
      });
    } catch (error) {
      // A broken app bundle should not prevent other applications from loading.
    }
  }
  return JSON.stringify(records);
}
`;

export type SelectableApplication = { bundleId: string; name: string };
export type ApplicationCatalogResult = { supported: boolean; applications: SelectableApplication[] };

export type ApplicationCatalogDirEntry = Readonly<{
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}>;

export type ApplicationCatalogFileSystem = Readonly<{
  readdir(path: string): Promise<readonly ApplicationCatalogDirEntry[]>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<Readonly<{ isDirectory(): boolean }>>;
}>;

type CatalogExecOptions = Readonly<{
  encoding: "utf8";
  maxBuffer: number;
  shell: false;
  timeout: number;
  windowsHide: true;
}>;

export type ApplicationCatalogExecFile = (
  file: string,
  args: readonly string[],
  options: CatalogExecOptions,
  callback: (error: (Error & { code?: string | number }) | null, stdout: string) => void,
) => unknown;

export type ApplicationCatalogServiceOptions = Readonly<{
  platform?: NodeJS.Platform;
  homeDirectory?: string | (() => string);
  fileSystem?: ApplicationCatalogFileSystem;
  execFile?: ApplicationCatalogExecFile;
  now?: () => number;
}>;

type ApplicationCandidate = Readonly<{ path: string }>;
type CatalogMetadata = Readonly<{
  index?: unknown;
  bundleId?: unknown;
  localizedDisplayName?: unknown;
  localizedBundleName?: unknown;
  displayName?: unknown;
  bundleName?: unknown;
}>;
type ScanResult = Readonly<{
  result: ApplicationCatalogResult;
  pathsByBundleId: ReadonlyMap<string, string>;
}>;
type CacheEntry = Readonly<{ expiresAt: number; scan: ScanResult }>;

const defaultFileSystem: ApplicationCatalogFileSystem = {
  readdir: async (path) => await nodeReaddir(path, { withFileTypes: true }) as ApplicationCatalogDirEntry[],
  realpath: nodeRealpath,
  stat: nodeStat,
};

function defaultExecFile(...args: Parameters<ApplicationCatalogExecFile>): unknown {
  return nodeExecFile(
    args[0],
    [...args[1]],
    args[2],
    args[3] as (error: Error | null, stdout: string) => void,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortApplications(applications: SelectableApplication[]): SelectableApplication[] {
  return applications.sort((left, right) =>
    compareText(left.name.toLowerCase(), right.name.toLowerCase()) ||
    compareText(left.bundleId.toLowerCase(), right.bundleId.toLowerCase()) ||
    compareText(left.bundleId, right.bundleId));
}

function applicationBatches(candidates: readonly ApplicationCandidate[]): ApplicationCandidate[][] {
  const baseArgs = ["-l", "JavaScript", "-e", APPLICATION_CATALOG_SCRIPT];
  const fixedArgvBytes = [OSASCRIPT_PATH, ...baseArgs]
    .reduce((total, argument) => total + Buffer.byteLength(argument, "utf8") + 1, 0);
  if (fixedArgvBytes >= MAX_OSASCRIPT_ARGV_BYTES) {
    throw new Error("The macOS application catalog script exceeds the supported argv limit.");
  }

  const batches: ApplicationCandidate[][] = [];
  let batch: ApplicationCandidate[] = [];
  let argvBytes = fixedArgvBytes;
  for (const candidate of candidates) {
    const candidateBytes = Buffer.byteLength(candidate.path, "utf8") + 1;
    if (argvBytes + candidateBytes > MAX_OSASCRIPT_ARGV_BYTES) {
      if (batch.length === 0) {
        throw new Error("An application path exceeds the supported macOS argv limit.");
      }
      batches.push(batch);
      batch = [];
      argvBytes = fixedArgvBytes;
    }
    batch.push(candidate);
    argvBytes += candidateBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function normalizeBundleId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const bundleId = value.trim();
  return bundleId.length > 0 && bundleId.length <= MAX_BUNDLE_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(bundleId)
    ? bundleId
    : undefined;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f]/u.test(name)
    ? name
    : undefined;
}

function appNameFromPath(applicationPath: string): string | undefined {
  return normalizeName(basename(applicationPath).replace(/\.app$/iu, ""));
}

function isApplicationBundle(name: string): boolean {
  return name.toLowerCase().endsWith(".app");
}

function asMetadata(value: unknown): CatalogMetadata | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as CatalogMetadata
    : undefined;
}

function copyResult(result: ApplicationCatalogResult): ApplicationCatalogResult {
  return {
    supported: result.supported,
    applications: result.applications.map((application) => ({ ...application })),
  };
}

function parseMetadata(output: string, candidates: readonly ApplicationCandidate[]): ScanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("The macOS application catalog returned invalid metadata.");
  }
  if (!Array.isArray(parsed)) throw new Error("The macOS application catalog returned invalid metadata.");

  const applications: SelectableApplication[] = [];
  const pathsByBundleId = new Map<string, string>();
  const seenBundleIds = new Set<string>();
  for (const rawRecord of parsed) {
    const record = asMetadata(rawRecord);
    if (!record || !Number.isInteger(record.index)) continue;
    const candidate = candidates[record.index as number];
    if (!candidate) continue;

    const bundleId = normalizeBundleId(record.bundleId);
    if (!bundleId) continue;
    const key = bundleId.toLowerCase();
    if (seenBundleIds.has(key)) continue;

    const name = [
      record.localizedDisplayName,
      record.localizedBundleName,
      record.displayName,
      record.bundleName,
      appNameFromPath(candidate.path),
    ].map(normalizeName).find((item): item is string => item !== undefined);
    if (!name) continue;

    seenBundleIds.add(key);
    applications.push({ bundleId, name });
    pathsByBundleId.set(key, candidate.path);
  }

  return {
    result: { supported: true, applications },
    pathsByBundleId,
  };
}

function mergeScans(scans: readonly ScanResult[]): ScanResult {
  const applicationsByBundleId = new Map<string, SelectableApplication>();
  const pathsByBundleId = new Map<string, string>();
  for (const scan of scans) {
    for (const application of scan.result.applications) {
      const key = application.bundleId.toLowerCase();
      if (applicationsByBundleId.has(key)) continue;
      applicationsByBundleId.set(key, application);
      const path = scan.pathsByBundleId.get(key);
      if (path) pathsByBundleId.set(key, path);
    }
  }
  return {
    result: { supported: true, applications: sortApplications([...applicationsByBundleId.values()]) },
    pathsByBundleId,
  };
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR");
}

export class ApplicationCatalogService {
  private readonly platform: NodeJS.Platform;
  private readonly homeDirectory: () => string;
  private readonly fileSystem: ApplicationCatalogFileSystem;
  private readonly execFile: ApplicationCatalogExecFile;
  private readonly now: () => number;
  private cache: CacheEntry | undefined;
  private inFlight: Promise<ScanResult> | undefined;

  constructor(options: ApplicationCatalogServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    const homeDirectory = options.homeDirectory;
    this.homeDirectory = typeof homeDirectory === "function"
      ? homeDirectory
      : () => homeDirectory ?? homedir();
    this.fileSystem = options.fileSystem ?? defaultFileSystem;
    this.execFile = options.execFile ?? defaultExecFile;
    this.now = options.now ?? Date.now;
  }

  async listApplications(refresh = false): Promise<ApplicationCatalogResult> {
    if (this.platform !== "darwin") return { supported: false, applications: [] };
    if (!refresh && this.cache && this.cache.expiresAt > this.now()) return copyResult(this.cache.scan.result);

    const pending = this.inFlight ?? this.scan();
    this.inFlight = pending;
    try {
      const scan = await pending;
      this.cache = { expiresAt: this.now() + CACHE_TTL_MS, scan };
      return copyResult(scan.result);
    } finally {
      if (this.inFlight === pending) this.inFlight = undefined;
    }
  }

  getCachedApplicationPath(bundleId: string | undefined): string | undefined {
    const normalized = normalizeBundleId(bundleId);
    return normalized ? this.cache?.scan.pathsByBundleId.get(normalized.toLowerCase()) : undefined;
  }

  private async scan(): Promise<ScanResult> {
    const candidates = await this.discoverApplications();
    const batches = applicationBatches(candidates);
    const scans: ScanResult[] = [];
    for (const batch of batches) scans.push(await this.readMetadataBatch(batch));
    return mergeScans(scans);
  }

  private async readMetadataBatch(candidates: readonly ApplicationCandidate[]): Promise<ScanResult> {
    const output = await new Promise<string>((resolve, reject) => {
      this.execFile(
        OSASCRIPT_PATH,
        ["-l", "JavaScript", "-e", APPLICATION_CATALOG_SCRIPT, ...candidates.map((candidate) => candidate.path)],
        EXEC_OPTIONS,
        (error, stdout) => error ? reject(new Error("Could not read macOS application metadata.")) : resolve(stdout),
      );
    });
    return parseMetadata(output, candidates);
  }

  private async discoverApplications(): Promise<ApplicationCandidate[]> {
    const roots = ["/Applications", "/System/Applications", join(this.homeDirectory(), "Applications")];
    const found: ApplicationCandidate[] = [];
    const seenRealPaths = new Set<string>();
    let entryCount = 0;

    const readEntries = async (path: string): Promise<readonly ApplicationCatalogDirEntry[]> => {
      try {
        return await this.fileSystem.readdir(path);
      } catch (error) {
        if (isMissingPathError(error)) return [];
        throw new Error("Could not scan a macOS application folder.");
      }
    };

    const addApplication = async (applicationPath: string): Promise<void> => {
      if (applicationPath.length > MAX_APPLICATION_PATH_LENGTH) {
        throw new Error("The macOS application catalog contains a path over the supported limit.");
      }
      let resolvedPath: string;
      let target: Readonly<{ isDirectory(): boolean }>;
      try {
        resolvedPath = await this.fileSystem.realpath(applicationPath);
        target = await this.fileSystem.stat(resolvedPath);
      } catch (error) {
        // Missing, broken, or looping .app symlinks are isolated to that bundle.
        return;
      }
      if (!target.isDirectory() || seenRealPaths.has(resolvedPath)) return;
      if (found.length >= MAX_APPLICATIONS) {
        throw new Error("The macOS application catalog exceeds the supported application limit.");
      }
      seenRealPaths.add(resolvedPath);
      found.push({ path: applicationPath });
    };

    for (const root of roots) {
      const entries = await readEntries(root);
      entryCount += entries.length;
      if (entryCount > MAX_DIRECTORY_ENTRIES) {
        throw new Error("The macOS application catalog exceeds the supported directory entry limit.");
      }
      for (const entry of [...entries].sort((left, right) => compareText(left.name, right.name))) {
        const entryPath = join(root, entry.name);
        if (isApplicationBundle(entry.name)) {
          await addApplication(entryPath);
          continue;
        }
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

        const children = await readEntries(entryPath);
        entryCount += children.length;
        if (entryCount > MAX_DIRECTORY_ENTRIES) {
          throw new Error("The macOS application catalog exceeds the supported directory entry limit.");
        }
        for (const child of [...children].sort((left, right) => compareText(left.name, right.name))) {
          if (isApplicationBundle(child.name)) await addApplication(join(entryPath, child.name));
        }
      }
    }

    return found.sort((left, right) => compareText(left.path, right.path));
  }
}
