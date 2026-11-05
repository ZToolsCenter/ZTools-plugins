import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  const rootStatus = await inspectPathWithoutSymlinks(root, false);
  if (!rootStatus?.isDirectory()) throw new TypeError("PasteboardPro 数据迁移只允许普通文件和目录");
  await assertSafeTreeContents(root);
}

async function assertSafeTreeContents(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    const status = await lstat(candidate);
    if (status.isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
    if (status.isDirectory()) await assertSafeTreeContents(candidate);
    else if (!status.isFile()) throw new TypeError("PasteboardPro 数据迁移只允许普通文件和目录");
  }
}

async function inspectPathWithoutSymlinks(
  target: string,
  allowMissing: boolean,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  let currentStatus: Awaited<ReturnType<typeof lstat>> | undefined;

  if (components.length === 0) {
    currentStatus = await lstat(current);
    if (currentStatus.isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
    return currentStatus;
  }

  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]!);
    try {
      currentStatus = await lstat(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (currentStatus.isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
    if (index < components.length - 1 && !currentStatus.isDirectory()) {
      throw new TypeError("PasteboardPro 数据迁移路径祖先必须是普通目录");
    }
  }

  return currentStatus;
}

async function fileDigest(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function copyAndVerify(source: string, destination: string): Promise<boolean> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    try {
      if ((await lstat(to)).isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await cp(from, to, { recursive: true, force: false, errorOnExist: true });
    }
    const [sourceStatus, destinationStatus] = await Promise.all([lstat(from), lstat(to)]);
    if (destinationStatus.isSymbolicLink()) throw new TypeError("PasteboardPro 数据迁移不允许符号链接");
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

async function rewriteDatabasePaths(database: MigrationDatabase, legacyRoots: readonly string[], blobRoot: string): Promise<number> {
  if (database.allDocs === undefined) throw new TypeError("ZTools database does not expose allDocs for pluginData migration");
  const result = await database.allDocs({ include_docs: true, startkey: "pasteboard-pro:record:", endkey: "pasteboard-pro:record:\uffff" });
  if (failedResult(result)) throw new Error("PasteboardPro 迁移读取数据库失败");
  let rewritten = 0;
  for (const document of documents(result)) {
    const record = document.record;
    const origin = record?.origin;
    if (!origin || typeof origin !== "object") continue;
    let imagePath = origin.imagePath;
    for (const legacyRoot of legacyRoots) imagePath = migratedPath(imagePath, legacyRoot, blobRoot);
    if (imagePath === origin.imagePath) continue;
    const putResult = await database.put({ ...document, record: { ...record, origin: { ...origin, imagePath } } });
    if (failedResult(putResult)) throw new Error("PasteboardPro 迁移更新附件路径失败");
    rewritten += 1;
  }
  return rewritten;
}

type PluginDataMigrationMarker = Readonly<{
  version: 1;
  stages: Readonly<{
    copy: Readonly<{ status: "verified"; verifiedAt: string; roots: number }>;
    knownRecordRewrite:
      | Readonly<{ status: "pending" }>
      | Readonly<{
          status: "verified-for-returned-documents";
          verifiedAt: string;
          updatedRecords: number;
        }>;
  }>;
  legacyRetained: true;
  hostEnumerationCompleteness: "unverified";
}>;

async function writeMigrationMarker(
  dataRoot: string,
  marker: PluginDataMigrationMarker,
): Promise<void> {
  await writeFile(
    path.join(dataRoot, ".pasteboard-pro-plugin-data-migration-v1.json"),
    JSON.stringify(marker),
  );
}

export async function migratePasteboardProPluginData(database: MigrationDatabase, paths: PasteboardProDataPaths): Promise<void> {
  if (!paths.usesPluginData || paths.legacyBlobRoots.length === 0) return;
  const existingRoots: string[] = [];
  for (const legacyRoot of paths.legacyBlobRoots) {
    try {
      const sourceStatus = await inspectPathWithoutSymlinks(legacyRoot, true);
      if (!sourceStatus) continue;
      if (!sourceStatus.isDirectory()) continue;
      await assertSafeTree(legacyRoot);
      const destinationStatus = await inspectPathWithoutSymlinks(paths.blobRoot, true);
      if (destinationStatus) {
        if (!destinationStatus.isDirectory()) {
          throw new TypeError("PasteboardPro 数据迁移目标必须是普通目录");
        }
        await assertSafeTree(paths.blobRoot);
      }
      if (!(await copyAndVerify(legacyRoot, paths.blobRoot))) throw new Error("PasteboardPro 旧附件校验失败");
      existingRoots.push(path.resolve(legacyRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (existingRoots.length === 0) return;
  const copyVerifiedAt = new Date().toISOString();
  await writeMigrationMarker(paths.dataRoot, {
    version: 1,
    stages: {
      copy: { status: "verified", verifiedAt: copyVerifiedAt, roots: existingRoots.length },
      knownRecordRewrite: { status: "pending" },
    },
    legacyRetained: true,
    hostEnumerationCompleteness: "unverified",
  });

  const updatedRecords = await rewriteDatabasePaths(database, existingRoots, paths.blobRoot);
  await writeMigrationMarker(paths.dataRoot, {
    version: 1,
    stages: {
      copy: { status: "verified", verifiedAt: copyVerifiedAt, roots: existingRoots.length },
      knownRecordRewrite: {
        status: "verified-for-returned-documents",
        verifiedAt: new Date().toISOString(),
        updatedRecords,
      },
    },
    legacyRetained: true,
    hostEnumerationCompleteness: "unverified",
  });
}
