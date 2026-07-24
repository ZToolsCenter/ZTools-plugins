/**
 * 存储管理器
 * 提供统一的存储接口，支持事务、WAL、重试、多窗口同步等功能
 */

import localforage from "localforage";

import {
  StorageOperation,
  StorageTransaction,
  StorageOptions,
  VersionedData,
  VersionVector,
} from "./types";
import { WALManager } from "./WALManager";
import { MultiWindowSyncManager } from "./MultiWindowSyncManager";

import { generateUUID } from "@/utils/uuid";

// 主存储实例
const mainStorage = localforage.createInstance({
  name: "json-tools",
  storeName: "store",
});

// 内存缓存（L1 Cache）
const memoryCache = new Map<string, any>();

// 默认选项
const DEFAULT_OPTIONS: StorageOptions = {
  immediate: false,
  retry: true,
  retryCount: 3,
  sync: true,
};

export class StorageManager {
  private walManager: WALManager;
  private syncManager: MultiWindowSyncManager;
  private windowId: string;
  private isFlushing = false;
  private isRemoteUpdate = false; // 标志位: 防止循环同步

  constructor(syncManager?: MultiWindowSyncManager) {
    this.walManager = new WALManager();
    this.syncManager = syncManager || new MultiWindowSyncManager();
    this.windowId = this.generateWindowId();
    this.setupSyncListeners();
  }

  /**
   * 生成窗口 ID
   */
  private generateWindowId(): string {
    return `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 设置多窗口同步监听器
   */
  private setupSyncListeners(): void {
    // 监听来自其他窗口的更新
    this.syncManager.onUpdate("storage_update", (data) => {
      this.handleRemoteUpdate(data);
    });
  }

  /**
   * 处理来自其他窗口的远程更新
   */
  private async handleRemoteUpdate(data: {
    key: string;
    value: any;
    version: VersionVector;
  }): Promise<void> {
    try {
      this.isRemoteUpdate = true;

      // 直接更新内存缓存和持久化存储,不广播
      const versionedData: VersionedData<any> = {
        data: data.value,
        version: data.version,
        timestamp: Date.now(),
        windowId: data.version ? Object.keys(data.version)[0] : "unknown",
      };

      memoryCache.set(data.key, versionedData);
      await mainStorage.setItem(data.key, versionedData);

      console.log(`已同步远程更新: ${data.key}`);
    } catch (error) {
      console.error("处理远程更新失败:", error);
    } finally {
      this.isRemoteUpdate = false;
    }
  }

  /**
   * 获取数据（支持缓存）
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      // 首先检查内存缓存
      if (memoryCache.has(key)) {
        const cached = memoryCache.get(key);

        return this.extractVersionedData<T>(cached);
      }

      // 从持久化存储读取
      const value = await mainStorage.getItem<any>(key);

      if (value !== null) {
        // 更新缓存
        memoryCache.set(key, value);

        return this.extractVersionedData<T>(value);
      }

      return null;
    } catch (error) {
      console.error(`获取 ${key} 失败:`, error);
      throw error;
    }
  }

  /**
   * 提取版本化数据
   */
  private extractVersionedData<T>(value: any): T {
    if (value && typeof value === "object" && "data" in value) {
      return (value as VersionedData<T>).data;
    }

    return value as T;
  }

  /**
   * 设置数据
   */
  async set(
    key: string,
    value: any,
    options: StorageOptions = {},
  ): Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (opts.retry) {
      return this.withRetry(
        () => this.setInternal(key, value, opts),
        opts.retryCount!,
      );
    }

    return this.setInternal(key, value, options);
  }

  /**
   * 内部设置实现
   */
  private async setInternal(
    key: string,
    value: any,
    options: StorageOptions,
  ): Promise<void> {
    try {
      // 创建版本化数据
      const versionedData: VersionedData<any> = {
        data: value,
        version: this.getCurrentVersion(key),
        timestamp: Date.now(),
        windowId: this.windowId,
      };

      // 更新版本号
      versionedData.version[this.windowId] =
        (versionedData.version[this.windowId] || 0) + 1;

      // 写入 WAL（用于关键数据）
      if (options.immediate) {
        const transaction: StorageTransaction = {
          id: generateUUID(),
          timestamp: Date.now(),
          operations: [{ type: "set", key, value }],
          status: "pending",
        };

        await this.walManager.writeLog(transaction);
      }

      // 更新内存缓存
      memoryCache.set(key, versionedData);

      // 持久化存储
      await mainStorage.setItem(key, versionedData);

      // 清理 WAL（如果使用）
      if (options.immediate) {
        // 注意：这里需要 transactionId，简化处理暂时跳过
      }

      // 多窗口同步: 仅在非远程更新时广播
      if (options.sync !== false && !this.isRemoteUpdate) {
        this.syncManager.broadcastUpdate(key, value, versionedData.version);
      }
    } catch (error) {
      console.error(`设置 ${key} 失败:`, error);
      throw error;
    }
  }

  /**
   * 获取当前版本号
   */
  private getCurrentVersion(key: string): VersionVector {
    try {
      const cached = memoryCache.get(key);

      if (cached && cached.version) {
        return { ...cached.version };
      }

      return {};
    } catch (error) {
      return {};
    }
  }

  /**
   * 删除数据
   */
  async remove(key: string, options: StorageOptions = {}): Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (opts.retry) {
      return this.withRetry(
        () => this.removeInternal(key, opts),
        opts.retryCount!,
      );
    }

    return this.removeInternal(key, opts);
  }

  /**
   * 内部删除实现
   */
  private async removeInternal(
    key: string,
    _options: StorageOptions,
  ): Promise<void> {
    try {
      // 从缓存删除
      memoryCache.delete(key);

      // 从持久化存储删除
      await mainStorage.removeItem(key);
    } catch (error) {
      console.error(`删除 ${key} 失败:`, error);
      throw error;
    }
  }

  /**
   * 事务性批量操作
   */
  async transaction(
    operations: StorageOperation[],
    _options: StorageOptions = {},
  ): Promise<void> {
    const transaction: StorageTransaction = {
      id: generateUUID(),
      timestamp: Date.now(),
      operations,
      status: "pending",
    };

    try {
      // 写入 WAL
      await this.walManager.writeLog(transaction);

      // 执行操作
      for (const op of operations) {
        await this.executeOperation(op, false); // 不写入 WAL，避免重复
      }

      transaction.status = "completed";
    } catch (error) {
      transaction.status = "failed";
      console.error("事务执行失败:", error);
      throw error;
    }
  }

  /**
   * 执行单个操作
   */
  private async executeOperation(
    op: StorageOperation,
    writeToWAL: boolean = true,
  ): Promise<void> {
    switch (op.type) {
      case "set":
        if (op.value !== undefined) {
          await this.setInternal(op.key, op.value, { immediate: writeToWAL });
        }
        break;
      case "remove":
        await this.removeInternal(op.key, {});
        break;
      case "get":
        // get 操作不需要执行
        break;
    }
  }

  /**
   * 页面关闭前强制刷新缓存
   */
  async flush(): Promise<void> {
    if (this.isFlushing) {
      return;
    }

    this.isFlushing = true;
    console.log("开始刷新存储缓存...");

    try {
      // 将所有内存缓存的数据持久化
      const promises: Promise<void>[] = [];

      memoryCache.forEach((value, key) => {
        promises.push(mainStorage.setItem(key, value));
      });

      await Promise.all(promises);
      console.log(`已刷新 ${memoryCache.size} 个缓存项`);
    } catch (error) {
      console.error("刷新缓存失败:", error);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * 重试机制
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.error(`操作失败 (尝试 ${attempt}/${maxAttempts}):`, error);

        if (attempt < maxAttempts) {
          // 指数退避
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * 清空所有数据（危险操作）
   */
  async clear(): Promise<void> {
    try {
      memoryCache.clear();
      await mainStorage.clear();
      console.log("已清空所有存储数据");
    } catch (error) {
      console.error("清空存储失败:", error);
      throw error;
    }
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<string[]> {
    try {
      return await mainStorage.keys();
    } catch (error) {
      console.error("获取键列表失败:", error);

      return [];
    }
  }

  /**
   * 获取存储大小（估算）
   */
  async getSize(): Promise<number> {
    try {
      const keys = await this.keys();
      let totalSize = 0;

      for (const key of keys) {
        const value = await mainStorage.getItem(key);

        if (value) {
          totalSize += JSON.stringify(value).length;
        }
      }

      return totalSize;
    } catch (error) {
      console.error("获取存储大小失败:", error);

      return 0;
    }
  }

  /**
   * 清理内存缓存
   */
  clearCache(): void {
    memoryCache.clear();
    console.log("已清理内存缓存");
  }

  /**
   * 获取同步管理器实例
   */
  getSyncManager(): MultiWindowSyncManager {
    return this.syncManager;
  }

  /**
   * 获取窗口 ID
   */
  getWindowId(): string {
    return this.windowId;
  }
}
