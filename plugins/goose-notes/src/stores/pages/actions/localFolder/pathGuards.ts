import type { Page } from "@/types";

/** 统一本地路径比较口径，避免斜杠差异导致重复路径漏判。 */
export function normalizeLocalFilePathKey(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/**
 * 查找是否已有另一个页面指向同一个本地文件。
 * 重命名提交和内容保存都会调用它：前者用于拦截同名目标，后者作为写盘前兜底。
 */
export function findDuplicateLocalFileOwner(
  pages: Record<string, Page>,
  pageId: string,
  filePath: string,
): Page | null {
  const targetKey = normalizeLocalFilePathKey(filePath);
  return (
    Object.values(pages).find(
      (candidate) =>
        candidate.id !== pageId &&
        !candidate.isFolder &&
        candidate.localFilePath &&
        normalizeLocalFilePathKey(candidate.localFilePath) === targetKey,
    ) ?? null
  );
}

/** 优先使用异步 exists，兼容只提供同步 exists 的 gooseFs 实现。 */
export async function localFilePathExists(
  fs: GooseFs,
  filePath: string,
): Promise<boolean> {
  try {
    if (fs.existsAsync) {
      return await fs.existsAsync(filePath);
    }
    return fs.exists?.(filePath) ?? false;
  } catch {
    return false;
  }
}

/**
 * 目标路径是否已被占用（磁盘已有 或 其它页面已绑定）。
 * 当前页自己的路径视为空闲（重命名回环时不应被 exists 挡住）。
 */
export async function isLocalFilePathTaken(
  fs: GooseFs,
  pages: Record<string, Page>,
  pageId: string,
  filePath: string,
  currentFilePath?: string | null,
): Promise<boolean> {
  if (
    currentFilePath &&
    normalizeLocalFilePathKey(currentFilePath) ===
      normalizeLocalFilePathKey(filePath)
  ) {
    return false;
  }
  if (findDuplicateLocalFileOwner(pages, pageId, filePath)) return true;
  return localFilePathExists(fs, filePath);
}

/**
 * 为本地文件解析可用基名：目标空闲则原样；否则按 `名称 (1)`、`名称 (2)`… 递增。
 * 与新建页命名策略对齐，避免重命名撞名后再弹二次确认。
 */
export async function allocateUniqueLocalBaseName(
  fs: GooseFs,
  pages: Record<string, Page>,
  pageId: string,
  dir: string,
  baseName: string,
  ext: string,
  currentFilePath?: string | null,
): Promise<string> {
  const preferredPath = `${dir}/${baseName}${ext}`;
  if (
    !(await isLocalFilePathTaken(
      fs,
      pages,
      pageId,
      preferredPath,
      currentFilePath,
    ))
  ) {
    return baseName;
  }

  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const candidate = `${baseName} (${suffix})`;
    const candidatePath = `${dir}/${candidate}${ext}`;
    if (
      !(await isLocalFilePathTaken(
        fs,
        pages,
        pageId,
        candidatePath,
        currentFilePath,
      ))
    ) {
      return candidate;
    }
  }

  throw new Error("无法生成可用名称，请手动修改");
}
