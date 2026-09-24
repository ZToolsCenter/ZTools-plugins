/**
 * HistoryBackend 抽象 —— 统一历史版本的读写接口。
 *
 * dbBackend：包装现有同步 historyRepository，行为与改造前完全等价。
 * localFolderBackend：写入 {basePath}/.goose/history/ 目录。
 *
 * resolveHistoryBackend：根据 pageId 对应的页面类型自动路由。
 */

import { historyRepository } from "./repository";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import type { HistoryIndex, HistoryVersion } from "./types";
import { normalizeHistoryIndex, normalizeHistoryVersion } from "./guards";

// ── 简单 FNV-1a (32-bit) ─────────────────────────────────────────────────────

function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ── 接口定义 ──────────────────────────────────────────────────────────────────

export interface HistoryBackend {
  loadIndex(pageId: string): Promise<HistoryIndex>;
  saveIndex(index: HistoryIndex): Promise<void>;
  loadVersion(pageId: string, versionId: string): Promise<HistoryVersion | null>;
  saveVersion(version: HistoryVersion): Promise<void>;
  removeVersion(pageId: string, versionId: string): Promise<void>;
  dropAll(pageId: string): Promise<void>;
}

// ── dbBackend：包装现有同步实现 ───────────────────────────────────────────────

export const dbBackend: HistoryBackend = {
  async loadIndex(pageId) {
    return historyRepository.loadIndex(pageId);
  },
  async saveIndex(index) {
    historyRepository.saveIndex(index);
  },
  async loadVersion(pageId, versionId) {
    return historyRepository.loadVersion(pageId, versionId);
  },
  async saveVersion(version) {
    historyRepository.saveVersion(version);
  },
  async removeVersion(pageId, versionId) {
    historyRepository.removeVersion(pageId, versionId);
  },
  async dropAll(pageId) {
    historyRepository.dropAll(pageId);
  },
};

// ── localFolderBackend ────────────────────────────────────────────────────────

// 真机 preload 只有同步 readFile/exists（无 *Async 变体），裸调 async 方法会
// TypeError。统一走 helper：优先 async 变体，缺失时回落同步实现。
async function fsRead(fs: GooseFs, path: string): Promise<string | null> {
  return fs.readFileAsync ? await fs.readFileAsync(path) : fs.readFile(path);
}

async function fsExists(fs: GooseFs, path: string): Promise<boolean> {
  return fs.existsAsync ? await fs.existsAsync(path) : fs.exists(path);
}

async function fsWrite(fs: GooseFs, path: string, content: string): Promise<boolean> {
  return fs.writeFileAsync
    ? await fs.writeFileAsync(path, content)
    : fs.writeFile(path, content);
}

/** 按 pageId 串行化写操作，避免 index 读改写竞争 */
const writeChains = new Map<string, Promise<void>>();

function chainWrite(pageId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(pageId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  writeChains.set(pageId, next);
  next.finally(() => {
    if (writeChains.get(pageId) === next) writeChains.delete(pageId);
  });
  return next;
}

function makeLocalFolderBackend(basePath: string): HistoryBackend {
  const histDir = `${basePath}/.goose/history`;

  async function ensureDir(): Promise<void> {
    if (typeof window === "undefined" || !window.gooseFs) return;
    const fs = window.gooseFs;
    // 逐级确保：basePath/.goose 再 basePath/.goose/history
    const gooseDir = `${basePath}/.goose`;
    if (!(await fsExists(fs, gooseDir))) {
      await fs.mkdir(gooseDir);
    }
    if (!(await fsExists(fs, histDir))) {
      await fs.mkdir(histDir);
    }
  }

  function indexPath(pageId: string): string {
    const h = fnv1a32(pageId);
    return `${histDir}/${h}.index.json`;
  }

  function versionPath(pageId: string, versionId: string): string {
    const h = fnv1a32(pageId);
    return `${histDir}/${h}.${versionId}.json`;
  }

  async function readJson<T>(path: string): Promise<T | null> {
    if (typeof window === "undefined" || !window.gooseFs) return null;
    try {
      const text = await fsRead(window.gooseFs, path);
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async function writeJson(path: string, data: unknown): Promise<void> {
    if (typeof window === "undefined" || !window.gooseFs) return;
    await fsWrite(window.gooseFs, path, JSON.stringify(data));
  }

  return {
    async loadIndex(pageId) {
      const data = await readJson<HistoryIndex>(indexPath(pageId));
      if (data && data.pageId !== pageId) {
        return { pageId, versions: [], lastVersionCharCount: 0 };
      }
      return normalizeHistoryIndex(data, pageId);
    },

    saveIndex(index) {
      return chainWrite(index.pageId, async () => {
        await ensureDir();
        await writeJson(indexPath(index.pageId), index);
      });
    },

    async loadVersion(pageId, versionId) {
      const data = await readJson<HistoryVersion>(versionPath(pageId, versionId));
      return normalizeHistoryVersion(data, pageId, versionId);
    },

    saveVersion(version) {
      return chainWrite(version.pageId, async () => {
        await ensureDir();
        await writeJson(versionPath(version.pageId, version.versionId), version);
      });
    },

    removeVersion(pageId, versionId) {
      return chainWrite(pageId, async () => {
        if (typeof window === "undefined" || !window.gooseFs) return;
        try {
          await window.gooseFs.deleteFile(versionPath(pageId, versionId));
        } catch {
          // 不存在时忽略
        }
      });
    },

    async dropAll(pageId) {
      if (typeof window === "undefined" || !window.gooseFs) return;
      const fs = window.gooseFs;
      const h = fnv1a32(pageId);
      // 读 index 拿所有 versionId，删版本文件，再删 index
      const idx = await this.loadIndex(pageId);
      await Promise.all(
        idx.versions.map((v) => {
          try {
            return fs.deleteFile(versionPath(pageId, v.versionId));
          } catch {
            return Promise.resolve();
          }
        }),
      );
      try {
        await fs.deleteFile(`${histDir}/${h}.index.json`);
      } catch {
        // 忽略
      }
    },
  };
}

// ── 路由函数 ──────────────────────────────────────────────────────────────────

export function resolveHistoryBackend(pageId: string): HistoryBackend {
  const page = usePages.getState().pages[pageId];
  if (!page?.localFilePath) return dbBackend;

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  if (!notebook?.localPath) return dbBackend;

  return makeLocalFolderBackend(notebook.localPath);
}
