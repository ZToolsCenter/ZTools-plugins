import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_FILE_DRAG_GRANT_TTL_MS = 5 * 60 * 1000;

interface FileSystemApi {
  realpath(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ isFile(): boolean }>;
}

interface FileDragGrantOptions {
  fsApi?: FileSystemApi;
  now?: () => number;
  ttlMs?: number;
}

export function createFileDragGrantStore(options: FileDragGrantOptions = {}) {
  const fsApi = options.fsApi ?? fs;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_FILE_DRAG_GRANT_TTL_MS;
  const grants = new Map<string, number>();

  async function canonicalFile(filePath: string): Promise<string> {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
      throw new Error("拖出的输出路径无效。");
    }
    try {
      const canonical = await fsApi.realpath(filePath);
      const stat = await fsApi.stat(canonical);
      if (!stat.isFile()) throw new Error("not a regular file");
      return canonical;
    } catch {
      throw new Error("拖出的输出路径无效或文件已不存在。");
    }
  }

  function pruneExpired(current = now()) {
    for (const [filePath, expiresAt] of grants) {
      if (expiresAt <= current) grants.delete(filePath);
    }
  }

  return {
    async grant(filePath: string) {
      const canonical = await canonicalFile(filePath);
      pruneExpired();
      grants.set(canonical, now() + ttlMs);
      return canonical;
    },

    async grantMany(filePaths: string[]) {
      const canonical = await Promise.all(filePaths.map(canonicalFile));
      pruneExpired();
      const expiresAt = now() + ttlMs;
      canonical.forEach(filePath => grants.set(filePath, expiresAt));
      return canonical;
    },

    async consume(filePaths: string[] | string) {
      const values = Array.isArray(filePaths) ? filePaths : [filePaths];
      if (!values.length) throw new Error("拖出的输出路径无效。");
      const canonical = await Promise.all(values.map(canonicalFile));
      if (new Set(canonical).size !== canonical.length) {
        throw new Error("拖出的输出路径包含重复文件。");
      }
      const current = now();
      pruneExpired(current);
      if (canonical.some(filePath => (grants.get(filePath) ?? 0) <= current)) {
        throw new Error("只能拖出刚刚由插件生成的文件。");
      }
      canonical.forEach(filePath => grants.delete(filePath));
      return canonical;
    },

    clear() {
      grants.clear();
    }
  };
}
