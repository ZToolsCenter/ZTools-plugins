import type { JSONContent, Page } from "@/types";

interface LocalFolderEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  size?: number;
}

export interface UnreferencedLocalAsset {
  path: string;
  relativePath: string;
  name: string;
  size: number;
}

interface ScanUnreferencedLocalAssetsOptions {
  basePath: string;
  pages: Pick<Page, "content" | "localFilePath" | "isFolder">[];
  gooseFs: GooseFs;
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const prefix =
    normalized.match(/^[A-Za-z]:\//)?.[0] ??
    (normalized.startsWith("/") ? "/" : "");
  const segments: string[] = [];
  for (const segment of normalized.slice(prefix.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${prefix}${segments.join("/")}` || "/";
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized.slice(0, 1) : normalized.slice(0, index);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function resolveLocalAssetPath(value: string, pagePath: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^(?:https?:|data:|blob:|att:|uuid:|#)/i.test(trimmed))
    return null;
  const path = normalizePath(
    isAbsolutePath(trimmed) ? trimmed : `${dirname(pagePath)}/${trimmed}`,
  );
  return /(?:^|\/)assets(?:\/|$)/i.test(path) ? path : null;
}

function collectReferences(
  value: unknown,
  pagePath: string,
  referenced: Set<string>,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, pagePath, referenced));
    return;
  }
  if (!value || typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "";
  if (["image", "imageResize", "video", "audio", "file"].includes(type)) {
    for (const containerKey of ["props", "attrs"]) {
      const container = node[containerKey];
      if (!container || typeof container !== "object") continue;
      for (const key of ["url", "src"]) {
        const candidate = (container as Record<string, unknown>)[key];
        if (typeof candidate !== "string") continue;
        const resolved = resolveLocalAssetPath(candidate, pagePath);
        if (resolved) referenced.add(resolved);
      }
    }
  }

  for (const key of ["content", "children", "rows", "cells"]) {
    collectReferences(node[key], pagePath, referenced);
  }
}

async function readDirectory(
  gooseFs: GooseFs,
  path: string,
): Promise<LocalFolderEntry[]> {
  return (
    (gooseFs.readDirAsync
      ? await gooseFs.readDirAsync(path)
      : gooseFs.readDir(path)) ?? []
  );
}

async function collectAssetFiles(
  gooseFs: GooseFs,
  directory: string,
): Promise<LocalFolderEntry[]> {
  const entries = await readDirectory(gooseFs, directory);
  const files: LocalFolderEntry[] = [];
  for (const entry of entries) {
    if (entry.isFile) files.push(entry);
    if (entry.isDirectory)
      files.push(...(await collectAssetFiles(gooseFs, entry.path)));
  }
  return files;
}

function relativePath(basePath: string, targetPath: string): string {
  const base = normalizePath(basePath).replace(/\/$/, "");
  const target = normalizePath(targetPath);
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : target;
}

function getFileSize(gooseFs: GooseFs, entry: LocalFolderEntry): number {
  if (typeof entry.size === "number") return entry.size;
  const base64 = gooseFs.readFileBase64?.(entry.path);
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export async function scanUnreferencedLocalAssets({
  basePath,
  pages,
  gooseFs,
}: ScanUnreferencedLocalAssetsOptions): Promise<UnreferencedLocalAsset[]> {
  const normalizedBasePath = normalizePath(basePath);
  const referenced = new Set<string>();
  const assetDirectories = new Set<string>([
    normalizePath(`${normalizedBasePath}/assets`),
  ]);

  for (const page of pages) {
    if (page.isFolder || !page.localFilePath) continue;
    collectReferences(
      page.content as JSONContent,
      page.localFilePath,
      referenced,
    );
    assetDirectories.add(
      normalizePath(`${dirname(page.localFilePath)}/assets`),
    );
  }

  const assets = await Promise.all(
    [...assetDirectories].map(async (directory) => {
      try {
        return await collectAssetFiles(gooseFs, directory);
      } catch {
        return [];
      }
    }),
  );

  return assets
    .flat()
    .map((entry) => ({ ...entry, path: normalizePath(entry.path) }))
    .filter((entry) => !referenced.has(entry.path))
    .map((entry) => ({
      path: entry.path,
      relativePath: relativePath(normalizedBasePath, entry.path),
      name: entry.name,
      size: getFileSize(gooseFs, entry),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export const localAssetPaths = {
  normalizePath,
  resolveLocalAssetPath,
};
