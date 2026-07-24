/**
 * 多窗口同步管理器
 * 使用 BroadcastChannel API 实现多窗口数据同步
 */

import { SyncMessage, VersionVector } from "./types";
import { DataIntegrityChecker } from "./DataIntegrityChecker";

export class MultiWindowSyncManager {
  private channel: BroadcastChannel;
  private windowId: string;
  private updateHandlers: Map<string, Set<(data: any) => void>>;
  private isConnected: boolean = false;

  constructor(channelName: string = "json-tools-sync") {
    this.channel = new BroadcastChannel(channelName);
    this.windowId = this.generateWindowId();
    this.updateHandlers = new Map();

    this.initialize();
  }

  /**
   * 生成窗口 ID
   */
  private generateWindowId(): string {
    return `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 初始化监听
   */
  private initialize(): void {
    if (typeof BroadcastChannel === "undefined") {
      console.warn("BroadcastChannel 不可用，多窗口同步功能禁用");

      return;
    }

    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.isConnected = true;
    console.log(`多窗口同步已启用 (窗口 ID: ${this.windowId})`);
  }

  /**
   * 处理来自其他窗口的消息
   */
  private handleMessage(message: SyncMessage): void {
    // 忽略自己发送的消息
    if (message.windowId === this.windowId) {
      return;
    }

    console.log("收到同步消息:", message);

    switch (message.type) {
      case "update":
        this.handleUpdate(message);
        break;
      case "lock":
      case "unlock":
        // 锁消息由 DistributedLockManager 处理
        break;
      case "conflict":
        this.handleConflict(message);
        break;
    }
  }

  /**
   * 处理数据更新消息
   */
  private handleUpdate(message: SyncMessage): void {
    if (!message.key) return;

    // 通知特定 key 的处理器
    const handlers = this.updateHandlers.get(message.key);

    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message.data);
        } catch (error) {
          console.error("执行更新处理器失败:", error);
        }
      });
    }

    // 同时通知统一的 storage_update 处理器
    const universalHandlers = this.updateHandlers.get("storage_update");

    if (universalHandlers) {
      universalHandlers.forEach((handler) => {
        try {
          handler({
            key: message.key,
            value: message.data,
            version: message.version,
          });
        } catch (error) {
          console.error("执行统一更新处理器失败:", error);
        }
      });
    }
  }

  /**
   * 处理冲突消息
   */
  private handleConflict(message: SyncMessage): void {
    console.warn("检测到数据冲突:", message);

    // 这里可以实现更复杂的冲突解决策略
    // 目前使用简单的最后写入优先（LWW）策略
  }

  /**
   * 广播数据更新
   */
  broadcastUpdate(key: string, data: any, version?: VersionVector): void {
    if (!this.isConnected) return;

    const message: SyncMessage = {
      type: "update",
      key,
      data,
      windowId: this.windowId,
      timestamp: Date.now(),
      version,
    };

    try {
      this.channel.postMessage(message);
      console.log(`广播更新: ${key}`, data);
    } catch (error) {
      console.error("广播更新失败:", error);
    }
  }

  /**
   * 注册更新处理器
   */
  onUpdate(key: string, handler: (data: any) => void): () => void {
    if (!this.updateHandlers.has(key)) {
      this.updateHandlers.set(key, new Set());
    }

    this.updateHandlers.get(key)!.add(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.updateHandlers.get(key);

      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.updateHandlers.delete(key);
        }
      }
    };
  }

  /**
   * 解决冲突（最后写入优先 LWW）
   */
  resolveConflict(
    localData: any,
    remoteData: any,
    localVersion?: VersionVector,
    remoteVersion?: VersionVector,
  ): any {
    // 如果没有版本信息，使用时间戳比较
    if (!localVersion || !remoteVersion) {
      // 假设数据有 timestamp 字段
      const localTime = localData.timestamp || 0;
      const remoteTime = remoteData.timestamp || 0;

      return localTime > remoteTime ? localData : remoteData;
    }

    // 使用版本向量比较
    const comparison = DataIntegrityChecker.compareVersions(
      localVersion,
      remoteVersion,
    );

    if (comparison === 1) {
      return localData; // 本地版本更新
    } else if (comparison === -1) {
      return remoteData; // 远程版本更新
    } else {
      // 并发冲突，使用时间戳作为最终仲裁
      const localTime = localData.timestamp || 0;
      const remoteTime = remoteData.timestamp || 0;

      return localTime > remoteTime ? localData : remoteData;
    }
  }

  /**
   * 广播锁请求
   */
  broadcastLockRequest(lockId: string): void {
    if (!this.isConnected) return;

    const message: SyncMessage = {
      type: "lock",
      key: lockId,
      windowId: this.windowId,
      timestamp: Date.now(),
    };

    try {
      this.channel.postMessage(message);
    } catch (error) {
      console.error("广播锁请求失败:", error);
    }
  }

  /**
   * 广播锁释放
   */
  broadcastLockRelease(lockId: string): void {
    if (!this.isConnected) return;

    const message: SyncMessage = {
      type: "unlock",
      key: lockId,
      windowId: this.windowId,
      timestamp: Date.now(),
    };

    try {
      this.channel.postMessage(message);
    } catch (error) {
      console.error("广播锁释放失败:", error);
    }
  }

  /**
   * 获取窗口 ID
   */
  getWindowId(): string {
    return this.windowId;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.isConnected) {
      this.channel.close();
      this.isConnected = false;
      console.log("多窗口同步已断开");
    }
  }
}

// 全局单例
let globalSyncManager: MultiWindowSyncManager | null = null;

export function getSyncManager(): MultiWindowSyncManager {
  if (!globalSyncManager) {
    globalSyncManager = new MultiWindowSyncManager();
  }

  return globalSyncManager;
}
