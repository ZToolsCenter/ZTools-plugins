import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PasteboardProDataPaths } from "./plugin-data";

type MigrationDatabase = Readonly<{
  allDocs?: (options: Readonly<Record<string, unknown>>) => Promise<unknown>;
  put: (document: Record<string, unknown>) => Promise<unknown>;
}>;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertSafeTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    const status = await lstat(candidate);
    if (status.isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
    if (status.isDirectory()) await assertSafeTree(candidate);
    else if (!status.isFile()) throw new TypeError("PasteboardPro 数据迁移只允许普通文件和目录");
  }
}

async function fileDigest(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function copyAndVerify(source: string, destination: string): Promise<boolean> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    try { await stat(to); } catch { await cp(from, to, { recursive: true, force: false, errorOnExist: true }); }
    const [sourceStatus, destinationStatus] = await Promise.all([lstat(from), lstat(to)]);
    if (sourceStatus.isDirectory() !== destinationStatus.isDirectory()) return false;
    if (sourceStatus.isDirectory()) {
      if (!(await copyAndVerify(from, to))) return false;
    } else if (!sourceStatus.isFile() || !destinationStatus.isFile()
      || sourceStatus.size !== destinationStatus.size
      || (await fileDigest(from)) !== (await fileDigest(to))) return false;
  }
  return true;
}

function documents(result: unknown): Record<string, any>[] {
  if (Array.isArray(result)) return result.filter((value): value is Record<string, any> => value !== null && typeof value === "object");
  if (!result || typeof result !== "object") return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows)
    ? rows.flatMap((row) => row && typeof row === "object" && (row as any).doc ? [(row as any).doc] : [])
    : [];
}

function failedResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return value.error === true || typeof value.error === "string" || value.ok === false
    || (Number.isFinite(Number(value.status)) && Number(value.status) >= 400);
}

function migratedPath(filePath: unknown, legacyRoot: string, blobRoot: string): unknown {
  if (typeof filePath !== "string") return filePath;
  const absolute = path.resolve(filePath);
  return inside(legacyRoot, absolute) ? path.join(blobRoot, path.relative(legacyRoot, absolute)) : filePath;
}

async function rewriteDatabasePaths(database: MigrationDatabase, legacyRoots: readonly string[], blobRoot: string): Promise<void> {
  if (database.allDocs === undefined) throw new TypeError("ZTools database does not expose allDocs for pluginData migration");
  const result = await database.allDocs({ include_docs: true, startkey: "pasteboard-pro:record:", endkey: "pasteboard-pro:record:\uffff" });
  if (failedResult(result)) throw new Error("PasteboardPro 迁移读取数据库失败");
  for (const document of documents(result)) {
    const record = document.record;
    const origin = record?.origin;
    if (!origin || typeof origin !== "object") continue;
    let imagePath = origin.imagePath;
    for (const legacyRoot of legacyRoots) imagePath = migratedPath(imagePath, legacyRoot, blobRoot);
    if (imagePath === origin.imagePath) continue;
    const putResult = await database.put({ ...document, record: { ...record, origin: { ...origin, imagePath } } });
    if (failedResult(putResult)) throw new Error("PasteboardPro 迁移更新附件路径失败");
  }
}

export async function migratePasteboardProPluginData(database: MigrationDatabase, paths: PasteboardProDataPaths): Promise<void> {
  if (!paths.usesPluginData || paths.legacyBlobRoots.length === 0) return;
  const existingRoots: string[] = [];
  for (const legacyRoot of paths.legacyBlobRoots) {
    try {
      if (!(await stat(legacyRoot)).isDirectory()) continue;
      await assertSafeTree(legacyRoot);
      if (!(await copyAndVerify(legacyRoot, paths.blobRoot))) throw new Error("PasteboardPro 旧附件校验失败");
      existingRoots.push(path.resolve(legacyRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (existingRoots.length === 0) return;
  await rewriteDatabasePaths(database, existingRoots, paths.blobRoot);
  for (const legacyRoot of existingRoots) {
    await rm(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    try { await stat(legacyRoot); throw new Error("PasteboardPro 旧附件目录清理失败"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try { await rmdir(path.dirname(legacyRoot)); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
  await writeFile(path.join(paths.dataRoot, ".pasteboard-pro-plugin-data-migration-v1.json"), JSON.stringify({ version: 1, completedAt: new Date().toISOString() }));
}
