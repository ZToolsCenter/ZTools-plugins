import type { FileStats } from './types';

export interface DirectoryEntry extends FileStats {
  name: string;
  path: string;
}

/**
 * 用于预加载脚本公开的文件系统操作的桥接接口。
 * 提供对Node.js文件系统功能的类型安全抽象。
 */
export interface FSBridge {
  /**
   * 将文件或目录从旧路径重命名到新路径。
   * @param oldPath - 当前文件路径
   * @param newPath - 目标文件路径
   */
  rename: (oldPath: string, newPath: string) => Promise<void>;
  /**
   * 检查给定路径是否存在文件或目录。
   * @param path - 要检查是否存在的路径
   * @returns 如果路径存在则返回true，否则返回false
   */
  exists: (path: string) => Promise<boolean>;
  /**
   * 获取给定路径的详细文件统计信息。
   * @param path - 要获取统计信息的路径
   * @returns 包含文件元数据的对象，如果未找到则返回null
   */
  getStats: (path: string) => Promise<FileStats>;
  /** 读取目录的直接子项，不递归展开。 */
  readDirectory: (path: string) => Promise<DirectoryEntry[]>;
  /** 读取操作系统剪贴板中复制的文件路径。 */
  getClipboardFilePaths: () => string[] | Promise<string[]>;
  /** 将纯文本写入操作系统剪贴板。 */
  writeClipboardText: (text: string) => void | Promise<void>;
}

/** 延迟读取预加载桥接，兼容开发环境的后置注入。 */
const getBridge = () => window.services as FSBridge | undefined;

/**
 * 提供对预加载桥接文件系统操作的安全包装。
 * 处理错误情况并提供一致的返回类型。
 */
export const fsBridge = {
  /**
   * 将文件从oldPath重命名到newPath。
   * @param oldPath - 当前文件路径
   * @param newPath - 目标文件路径
   * @returns 包含成功状态和可选错误消息的对象
   */
  async rename(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }> {
    const bridge = getBridge();
    if (!bridge) {
      console.error('Bridge not found. Make sure preload script is loaded.');
      return { success: false, error: 'Bridge not found' };
    }
    try {
      await bridge.rename(oldPath, newPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * 检查指定路径是否存在文件或目录。
   * @param targetPath - 要检查是否存在的路径
   * @returns 如果路径存在则返回true，否则返回false
   */
  async exists(targetPath: string): Promise<boolean> {
    const bridge = getBridge();
    if (!bridge || typeof bridge.exists !== 'function') {
      return false;
    }

    try {
      return await bridge.exists(targetPath);
    } catch {
      return false;
    }
  },

  /**
   * 获取给定路径的详细文件统计信息。
   * @param targetPath - 要获取文件统计信息的路径
   * @returns 包含文件元数据（大小、时间戳、类型）的对象，如果未找到则返回null
   */
  async getStats(targetPath: string): Promise<FileStats | null> {
    const bridge = getBridge();
    if (!bridge || typeof bridge.getStats !== 'function') {
      return null;
    }

    try {
      return await bridge.getStats(targetPath);
    } catch {
      return null;
    }
  },

  async readDirectory(targetPath: string): Promise<DirectoryEntry[] | null> {
    const bridge = getBridge();
    if (!bridge || typeof bridge.readDirectory !== 'function') {
      return null;
    }

    try {
      return await bridge.readDirectory(targetPath);
    } catch {
      return null;
    }
  },

  async getClipboardFilePaths(): Promise<string[]> {
    const bridge = getBridge();
    if (!bridge || typeof bridge.getClipboardFilePaths !== 'function') {
      return [];
    }

    try {
      return await bridge.getClipboardFilePaths();
    } catch {
      return [];
    }
  },

  async writeClipboardText(text: string): Promise<boolean> {
    const bridge = getBridge();
    if (bridge && typeof bridge.writeClipboardText === 'function') {
      try {
        await bridge.writeClipboardText(text);
        return true;
      } catch {
        // Fall through to the Web Clipboard API.
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
};
