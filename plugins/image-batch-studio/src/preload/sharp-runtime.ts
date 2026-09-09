import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SharpRuntimeProgress, SharpRuntimeStatus } from "../shared/types";

interface RuntimePackageConfig {
  name: string;
  version: string;
  url: string;
  fallbackUrl?: string;
  integrity: string;
  size: number;
  artifacts: string[];
}

interface RuntimeTargetConfig {
  platform: string;
  arch: string;
  packages: RuntimePackageConfig[];
}

interface RuntimeConfig {
  sharpVersion: string;
  targets: RuntimeTargetConfig[];
}

type SharpFactory = typeof import("sharp").default;

const execFileAsync = promisify(execFile);
const maxDownloadBytes = 20 * 1024 * 1024;
let configCache: RuntimeConfig | undefined;
let sharpFactory: SharpFactory | undefined;
let installPromise: Promise<SharpRuntimeStatus> | undefined;

function directoriesMatch(source: string, destination: string): boolean {
  const sourceStat = fsSync.lstatSync(source);
  const destinationStat = fsSync.lstatSync(destination);
  if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) return false;
  if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return false;
  if (!sourceStat.isDirectory()) {
    return sourceStat.size === destinationStat.size
      && crypto.createHash("sha256").update(fsSync.readFileSync(source)).digest("hex")
        === crypto.createHash("sha256").update(fsSync.readFileSync(destination)).digest("hex");
  }
  const sourceNames = fsSync.readdirSync(source).sort();
  const destinationNames = fsSync.readdirSync(destination).sort();
  if (sourceNames.length !== destinationNames.length || sourceNames.some((name, index) => name !== destinationNames[index])) return false;
  return sourceNames.every((name) => directoriesMatch(path.join(source, name), path.join(destination, name)));
}

function configPath(): string {
  const packaged = path.join(__dirname, "sharp-runtime-targets.json");
  return fsSync.existsSync(packaged)
    ? packaged
    : path.resolve(__dirname, "../../scripts/sharp-runtime-targets.json");
}

function runtimeConfig(): RuntimeConfig {
  if (!configCache) {
    configCache = JSON.parse(fsSync.readFileSync(configPath(), "utf8")) as RuntimeConfig;
  }
  return configCache;
}

function targetKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function selectSharpRuntimeTarget(
  config: RuntimeConfig,
  platform = process.platform,
  arch = process.arch
): RuntimeTargetConfig | undefined {
  return config.targets.find((target) => target.platform === platform && target.arch === arch);
}

export function resolveSharpRuntimeRoot(
  ztools: { getPath?: (name: string) => string } | undefined,
  legacyRoot: string | undefined,
): string {
  if (!ztools?.getPath) return legacyRoot ?? path.join(os.tmpdir(), "image-batch-studio-runtime");
  let root: string | undefined;
  try {
    const pluginData = ztools.getPath("pluginData");
    if (!pluginData) return legacyRoot ?? path.join(os.tmpdir(), "image-batch-studio-runtime");
    root = path.join(pluginData, "runtime");
    const marker = path.join(pluginData, ".image-batch-runtime-migration-v2.json");
    if (legacyRoot && fsSync.existsSync(legacyRoot)) {
      fsSync.mkdirSync(path.dirname(root), { recursive: true });
      if (!fsSync.existsSync(root)) {
        fsSync.cpSync(legacyRoot, root, { recursive: true, force: false, errorOnExist: false });
      }
      if (!directoriesMatch(legacyRoot, root)) return legacyRoot;
      fsSync.rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (fsSync.existsSync(legacyRoot)) return legacyRoot;
      try { fsSync.rmdirSync(path.dirname(legacyRoot)); } catch {}
    }
    fsSync.mkdirSync(pluginData, { recursive: true });
    fsSync.writeFileSync(marker, JSON.stringify({ version: 2, destination: root, completedAt: new Date().toISOString() }));
    return root;
  } catch {
    if (legacyRoot && fsSync.existsSync(legacyRoot)) return legacyRoot;
    if (root && fsSync.existsSync(root)) return root;
    return legacyRoot ?? path.join(os.tmpdir(), "image-batch-studio-runtime");
  }
}

function userDataPath(): string {
  if (process.env.IMAGE_BATCH_RUNTIME_ROOT) return process.env.IMAGE_BATCH_RUNTIME_ROOT;
  const ztools = typeof window !== "undefined" ? (window as any).ztools : undefined;
  let legacyRoot: string | undefined;
  try { legacyRoot = path.join(ztools.getPath("userData"), "image-batch-studio", "runtime"); } catch {}
  return resolveSharpRuntimeRoot(ztools, legacyRoot);
}

function targetRoot(config: RuntimeConfig, target: RuntimeTargetConfig): string {
  return path.join(userDataPath(), config.sharpVersion, targetKey(target.platform, target.arch));
}

function targetNodeModules(config: RuntimeConfig, target: RuntimeTargetConfig): string {
  return path.join(targetRoot(config, target), "node_modules");
}

function packageDirectory(root: string, packageName: string): string {
  return path.join(root, "node_modules", ...packageName.split("/"));
}

async function containsArtifact(directory: string, extension: string): Promise<boolean> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && (await containsArtifact(entryPath, extension))) return true;
    if (entry.isFile() && entry.name.endsWith(extension)) return true;
  }
  return false;
}

async function isInstalled(config: RuntimeConfig, target: RuntimeTargetConfig): Promise<boolean> {
  const root = targetRoot(config, target);
  for (const runtimePackage of target.packages) {
    const directory = packageDirectory(root, runtimePackage.name);
    const packageJson = await fs
      .readFile(path.join(directory, "package.json"), "utf8")
      .then((value) => JSON.parse(value) as { name?: string; version?: string })
      .catch(() => undefined);
    if (packageJson?.name !== runtimePackage.name || packageJson.version !== runtimePackage.version) return false;
    for (const extension of runtimePackage.artifacts) {
      if (!(await containsArtifact(directory, extension))) return false;
    }
  }
  return true;
}

function configureRuntimePath(config: RuntimeConfig, target: RuntimeTargetConfig): void {
  const nodeModules = targetNodeModules(config, target);
  const entries = (process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean);
  if (!entries.includes(nodeModules)) {
    process.env.NODE_PATH = [nodeModules, ...entries].join(path.delimiter);
    const Module = require("node:module") as { _initPaths?: () => void };
    Module._initPaths?.();
  }
}

function tryLoadSharp(): SharpFactory | undefined {
  if (sharpFactory) return sharpFactory;
  try {
    const candidate = require("sharp") as SharpFactory;
    if (candidate.versions.sharp !== runtimeConfig().sharpVersion) return undefined;
    sharpFactory = candidate;
    return sharpFactory;
  } catch {
    return undefined;
  }
}

export function getSharp(): SharpFactory {
  const loaded = tryLoadSharp();
  if (!loaded) throw new Error("图像运行组件尚未安装");
  return loaded;
}

export const sharp = ((...args: unknown[]) => getSharp()(...(args as [never]))) as SharpFactory;

function downloadBytes(target: RuntimeTargetConfig | undefined): number {
  return target?.packages.reduce((sum, item) => sum + item.size, 0) ?? 0;
}

export async function sharpRuntimeStatus(): Promise<SharpRuntimeStatus> {
  const config = runtimeConfig();
  const target = selectSharpRuntimeTarget(config);
  const base = {
    version: config.sharpVersion,
    target: targetKey(),
    downloadBytes: downloadBytes(target)
  };
  if (!target) return { ...base, state: "unsupported" };
  if (tryLoadSharp()) return { ...base, state: "ready" };
  if (!(await isInstalled(config, target))) return { ...base, state: "missing" };
  configureRuntimePath(config, target);
  return tryLoadSharp()
    ? { ...base, state: "ready" }
    : { ...base, state: "error", error: "运行组件已安装但无法加载" };
}

export function verifyRuntimeIntegrity(buffer: Buffer, integrity: string): boolean {
  const separator = integrity.indexOf("-");
  if (separator <= 0) return false;
  const algorithm = integrity.slice(0, separator);
  const expected = Buffer.from(integrity.slice(separator + 1), "base64");
  const actual = crypto.createHash(algorithm).update(buffer).digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function downloadToFile(
  url: string,
  destination: string,
  onChunk: (bytes: number) => void,
  redirects = 5
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("运行组件下载地址必须使用 HTTPS");
  await new Promise<void>((resolve, reject) => {
    const request = https.get(parsed, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) return reject(new Error("运行组件下载重定向次数过多"));
        const nextUrl = new URL(response.headers.location, parsed).toString();
        downloadToFile(nextUrl, destination, onChunk, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`运行组件下载失败：HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }
      let received = 0;
      const output = fsSync.createWriteStream(destination, { flags: "wx" });
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxDownloadBytes) request.destroy(new Error("运行组件下载文件过大"));
        onChunk(chunk.length);
      });
      response.pipe(output);
      output.on("finish", () => output.close(() => resolve()));
      output.on("error", reject);
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function downloadPackage(
  runtimePackage: RuntimePackageConfig,
  archivePath: string,
  onReceived: (bytes: number) => void
): Promise<Buffer> {
  const urls = [runtimePackage.url, runtimePackage.fallbackUrl].filter((url): url is string => Boolean(url));
  let lastError: unknown;
  for (const url of urls) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    let received = 0;
    try {
      await downloadToFile(url, archivePath, (bytes) => {
        received += bytes;
        onReceived(received);
      });
      const buffer = await fs.readFile(archivePath);
      if (!verifyRuntimeIntegrity(buffer, runtimePackage.integrity)) {
        throw new Error(`运行组件校验失败：${runtimePackage.name}`);
      }
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`无法下载 ${runtimePackage.name}`);
}

async function extractPackage(archivePath: string, destination: string): Promise<void> {
  const extractRoot = `${destination}-extract`;
  await fs.mkdir(extractRoot, { recursive: true });
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractRoot], { windowsHide: true });
    const extractedPackage = path.join(extractRoot, "package");
    await fs.access(path.join(extractedPackage, "package.json"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(extractedPackage, destination, { recursive: true, force: true });
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function emitProgress(
  callback: ((progress: SharpRuntimeProgress) => void) | undefined,
  phase: SharpRuntimeProgress["phase"],
  loaded: number,
  total: number
): void {
  callback?.({ phase, loaded, total, percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0 });
}

async function installRuntime(
  onProgress?: (progress: SharpRuntimeProgress) => void
): Promise<SharpRuntimeStatus> {
  const existing = await sharpRuntimeStatus();
  if (existing.state === "ready" || existing.state === "unsupported") return existing;

  const config = runtimeConfig();
  const target = selectSharpRuntimeTarget(config);
  if (!target) return existing;
  const total = downloadBytes(target);
  const runtimeParent = path.dirname(targetRoot(config, target));
  await fs.mkdir(runtimeParent, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(runtimeParent, ".install-"));
  let loaded = 0;

  try {
    for (const [index, runtimePackage] of target.packages.entries()) {
      const archivePath = path.join(stagingRoot, `package-${index}.tgz`);
      const packageStart = loaded;
      const archive = await downloadPackage(runtimePackage, archivePath, (received) => {
        emitProgress(onProgress, "downloading", packageStart + received, total);
      });
      loaded += archive.byteLength;
      emitProgress(onProgress, "verifying", loaded, total);
      await extractPackage(archivePath, packageDirectory(stagingRoot, runtimePackage.name));
      await fs.rm(archivePath, { force: true });
    }

    emitProgress(onProgress, "installing", total, total);
    if (!(await isInstalledAt(stagingRoot, target))) throw new Error("运行组件文件不完整");
    await fs.writeFile(
      path.join(stagingRoot, "runtime.json"),
      `${JSON.stringify({ version: config.sharpVersion, target: targetKey(target.platform, target.arch) }, null, 2)}\n`
    );
    const finalRoot = targetRoot(config, target);
    await fs.rm(finalRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await fs.rename(stagingRoot, finalRoot);
    configureRuntimePath(config, target);
    if (!tryLoadSharp()) throw new Error("运行组件安装完成但无法加载");
    return { state: "ready", version: config.sharpVersion, target: targetKey(), downloadBytes: total };
  } catch (error) {
    return {
      state: "error",
      version: config.sharpVersion,
      target: targetKey(),
      downloadBytes: total,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }
}

async function isInstalledAt(root: string, target: RuntimeTargetConfig): Promise<boolean> {
  for (const runtimePackage of target.packages) {
    const directory = packageDirectory(root, runtimePackage.name);
    const packageJson = await fs
      .readFile(path.join(directory, "package.json"), "utf8")
      .then((value) => JSON.parse(value) as { name?: string; version?: string })
      .catch(() => undefined);
    if (packageJson?.name !== runtimePackage.name || packageJson.version !== runtimePackage.version) return false;
    for (const extension of runtimePackage.artifacts) {
      if (!(await containsArtifact(directory, extension))) return false;
    }
  }
  return true;
}

export function installSharpRuntime(
  onProgress?: (progress: SharpRuntimeProgress) => void
): Promise<SharpRuntimeStatus> {
  if (!installPromise) {
    installPromise = installRuntime(onProgress).finally(() => {
      installPromise = undefined;
    });
  }
  return installPromise;
}
