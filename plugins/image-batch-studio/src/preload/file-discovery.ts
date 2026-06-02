import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SourceFile } from "../shared/types";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".heif", ".heic", ".tif", ".tiff", ".gif"]);
const pdfExtensions = new Set([".pdf"]);
const excludedDirectories = new Set([".git", "node_modules", ".DS_Store"]);

export function isImagePath(filePath: string): boolean {
  return imageExtensions.has(path.extname(filePath).toLowerCase());
}

export function isPdfPath(filePath: string): boolean {
  return pdfExtensions.has(path.extname(filePath).toLowerCase());
}

export async function discoverFiles(paths: string[]): Promise<SourceFile[]> {
  const discovered: SourceFile[] = [];
  const seen = new Set<string>();
  const visitedDirectories = new Set<string>();

  for (const itemPath of paths) {
    const resolved = path.resolve(itemPath);
    const files = await walk(resolved, visitedDirectories);
    for (const file of files) {
      const realPath = await fs.realpath(file.path).catch(() => file.path);
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      discovered.push(file);
    }
  }

  return discovered;
}

async function walk(targetPath: string, visitedDirectories: Set<string>): Promise<SourceFile[]> {
  const linkStat = await fs.lstat(targetPath).catch(() => null);
  if (!linkStat) return [];

  const realPath = await fs.realpath(targetPath).catch(() => targetPath);
  const stat = linkStat.isSymbolicLink() ? await fs.stat(realPath).catch(() => null) : linkStat;
  if (!stat) return [];

  if (stat.isDirectory()) {
    if (visitedDirectories.has(realPath)) return [];
    if (excludedDirectories.has(path.basename(targetPath))) return [];
    visitedDirectories.add(realPath);
    const children = await fs.readdir(targetPath).catch(() => [] as string[]);
    const results = await Promise.all(children.map((child) => walk(path.join(targetPath, child), visitedDirectories)));
    return results.flat();
  }

  if (!stat.isFile()) return [];
  if (!isImagePath(targetPath) && !isPdfPath(targetPath)) return [];
  return [await inspectFile(targetPath)];
}

export async function inspectFile(filePath: string): Promise<SourceFile> {
  const stat = await fs.stat(filePath);
  const base = {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size
  };

  if (isPdfPath(filePath)) {
    return { ...base, type: "pdf" };
  }

  if (isImagePath(filePath)) {
    const metadata = await sharp(filePath, { animated: true }).metadata().catch(() => null);
    return {
      ...base,
      type: "image",
      width: metadata?.width,
      height: metadata?.height,
      format: metadata?.format
    };
  }

  return { ...base, type: "unknown" };
}
