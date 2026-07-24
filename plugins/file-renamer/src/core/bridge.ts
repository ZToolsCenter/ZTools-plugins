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
  getStats: (path: string) => Promise<any>;
}

/** 通过window.services公开的桥接引用 */
const bridge = (window as any).services as FSBridge;

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
  async getStats(targetPath: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
  } | null> {
    if (!bridge || typeof bridge.getStats !== 'function') {
      return null;
    }

    try {
      return await bridge.getStats(targetPath);
    } catch {
      return null;
    }
  }
};
