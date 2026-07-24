/**
 * 分布式锁管理器
 * 防止多窗口同时写入导致的数据冲突
 */

import localforage from 'localforage';
import { Lock } from './types';
import { MultiWindowSyncManager, getSyncManager } from './MultiWindowSyncManager';

// 锁存储实例
const lockStorage = localforage.createInstance({
  name: 'json-tools',
  storeName: 'locks',
});

const DEFAULT_LOCK_TTL = 5000; // 默认锁超时时间（毫秒）
const LOCK_RETRY_DELAY = 100; // 锁获取重试延迟（毫秒）

export class DistributedLockManager {
  private windowId: string;
  private syncManager: MultiWindowSyncManager;
  private heldLocks: Set<string>;

  constructor(syncManager: MultiWindowSyncManager) {
    this.windowId = this.generateWindowId();
    this.syncManager = syncManager;
    this.heldLocks = new Set();
  }

  /**
   * 生成窗口 ID
   */
  private generateWindowId(): string {
    return `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取锁
   */
  async acquire(lockId: string, timeout: number = DEFAULT_LOCK_TTL): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const existingLock = await lockStorage.getItem<Lock>(lockId);

      // 检查锁是否已过期或不存在
      if (!existingLock || this.isExpired(existingLock)) {
        // 获取锁
        const lock: Lock = {
          id: lockId,
          windowId: this.windowId,
          timestamp: Date.now(),
          ttl: DEFAULT_LOCK_TTL,
        };

        await lockStorage.setItem(lockId, lock);
        this.heldLocks.add(lockId);

        // 广播锁获取
        this.syncManager.broadcastLockRequest(lockId);

        console.log(`成功获取锁: ${lockId}`);
        return;
      }

      // 检查锁是否被自己持有
      if (existingLock.windowId === this.windowId) {
        console.log(`锁已被当前窗口持有: ${lockId}`);
        this.heldLocks.add(lockId);
        return;
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY));
    }

    throw new Error(`获取锁超时: ${lockId}`);
  }

  /**
   * 释放锁
   */
  async release(lockId: string): Promise<void> {
    try {
      const existingLock = await lockStorage.getItem<Lock>(lockId);

      // 只有锁的持有者才能释放
      if (existingLock && existingLock.windowId === this.windowId) {
        await lockStorage.removeItem(lockId);
        this.heldLocks.delete(lockId);

        // 广播锁释放
        this.syncManager.broadcastLockRelease(lockId);

        console.log(`已释放锁: ${lockId}`);
      } else {
        console.warn(`尝试释放未被持有的锁: ${lockId}`);
      }
    } catch (error) {
      console.error(`释放锁失败: ${lockId}`, error);
    }
  }

  /**
   * 检查锁是否已过期
   */
  private isExpired(lock: Lock): boolean {
    return Date.now() - lock.timestamp > lock.ttl;
  }

  /**
   * 检查锁是否被持有
   */
  async isLocked(lockId: string): Promise<boolean> {
    try {
      const lock = await lockStorage.getItem<Lock>(lockId);
      if (!lock) {
        return false;
      }

      // 检查是否过期
      if (this.isExpired(lock)) {
        await lockStorage.removeItem(lockId);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`检查锁状态失败: ${lockId}`, error);
      return false;
    }
  }

  /**
   * 延长锁的超时时间
   */
  async renew(lockId: string, ttl: number = DEFAULT_LOCK_TTL): Promise<void> {
    try {
      const existingLock = await lockStorage.getItem<Lock>(lockId);

      if (existingLock && existingLock.windowId === this.windowId) {
        existingLock.timestamp = Date.now();
        existingLock.ttl = ttl;
        await lockStorage.setItem(lockId, existingLock);
        console.log(`已延长锁的有效期: ${lockId}`);
      } else {
        throw new Error(`无法延长未被持有的锁: ${lockId}`);
      }
    } catch (error) {
      console.error(`延长锁有效期失败: ${lockId}`, error);
      throw error;
    }
  }

  /**
   * 释放所有由当前窗口持有的锁
   */
  async releaseAll(): Promise<void> {
    const promises = Array.from(this.heldLocks).map(lockId => this.release(lockId));
    await Promise.all(promises);
  }

  /**
   * 清理过期的锁
   */
  async cleanupExpiredLocks(): Promise<void> {
    try {
      const keys = await lockStorage.keys();
      let cleanedCount = 0;

      for (const key of keys) {
        const lock = await lockStorage.getItem<Lock>(key);
        if (lock && this.isExpired(lock)) {
          await lockStorage.removeItem(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`清理了 ${cleanedCount} 个过期锁`);
      }
    } catch (error) {
      console.error('清理过期锁失败:', error);
    }
  }
}

// 全局单例
let globalLockManager: DistributedLockManager | null = null;

export function getLockManager(): DistributedLockManager {
  if (!globalLockManager) {
    const syncManager = getSyncManager();
    globalLockManager = new DistributedLockManager(syncManager);
  }
  return globalLockManager;
}
