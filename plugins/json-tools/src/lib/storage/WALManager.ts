/**
 * 写前日志（WAL）管理器
 * 确保数据持久化的可靠性和崩溃恢复能力
 */

import localforage from "localforage";

import { WALLogEntry, StorageTransaction } from "./types";
import { DataIntegrityChecker } from "./DataIntegrityChecker";

// WAL 存储实例
const walStorage = localforage.createInstance({
  name: "json-tools",
  storeName: "wal",
});

const MAX_WAL_ENTRIES = 100; // 最大 WAL 条目数
const WAL_RETENTION_DAYS = 7; // WAL 保留天数

export class WALManager {
  private isRecovering = false;

  /**
   * 写入事务日志
   */
  async writeLog(transaction: StorageTransaction): Promise<void> {
    try {
      const checksum = DataIntegrityChecker.calculateChecksum(
        transaction.operations,
      );
      const logEntry: WALLogEntry = {
        transactionId: transaction.id,
        timestamp: transaction.timestamp,
        operations: transaction.operations,
        checksum,
      };

      await walStorage.setItem(`wal_${transaction.id}`, logEntry);

      // 清理旧的 WAL 条目
      await this.cleanupOldEntries();
    } catch (error) {
      console.error("写入 WAL 失败:", error);
      throw error;
    }
  }

  /**
   * 应用启动时恢复未完成的事务
   */
  async recover(): Promise<void> {
    if (this.isRecovering) {
      console.log("WAL 恢复已在进行中");

      return;
    }

    this.isRecovering = true;
    console.log("开始 WAL 恢复...");

    try {
      const keys = await walStorage.keys();
      const walKeys = keys.filter((key) => key.startsWith("wal_"));

      if (walKeys.length === 0) {
        console.log("没有需要恢复的 WAL 条目");

        return;
      }

      console.log(`发现 ${walKeys.length} 个 WAL 条目，开始恢复...`);

      let recoveredCount = 0;

      for (const key of walKeys) {
        const logEntry = await walStorage.getItem<WALLogEntry>(key);

        if (!logEntry) continue;

        // 验证校验和
        if (
          !DataIntegrityChecker.validate(logEntry.operations, logEntry.checksum)
        ) {
          console.error(`WAL 条目 ${key} 校验和验证失败，跳过`);
          await walStorage.removeItem(key);
          continue;
        }

        // 检查是否是最近的事务（7天内）
        const entryAge = Date.now() - logEntry.timestamp;

        if (entryAge > WAL_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
          console.log(`WAL 条目 ${key} 过期，跳过`);
          await walStorage.removeItem(key);
          continue;
        }

        // 执行恢复操作（仅对 set 操作进行恢复）
        try {
          const mainStorage = localforage.createInstance({
            name: "json-tools",
            storeName: "store",
          });

          for (const op of logEntry.operations) {
            if (op.type === "set" && op.value !== undefined) {
              await mainStorage.setItem(op.key, op.value);
              console.log(`恢复: 设置 ${op.key}`);
            }
          }

          recoveredCount++;
          // 恢复成功后删除 WAL 条目
          await walStorage.removeItem(key);
        } catch (error) {
          console.error(`恢复 WAL 条目 ${key} 失败:`, error);
        }
      }

      console.log(`WAL 恢复完成，成功恢复 ${recoveredCount} 个事务`);
    } catch (error) {
      console.error("WAL 恢复失败:", error);
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * 清理已完成的 WAL 条目
   */
  async clear(transactionId: string): Promise<void> {
    try {
      await walStorage.removeItem(`wal_${transactionId}`);
    } catch (error) {
      console.error("清理 WAL 条目失败:", error);
    }
  }

  /**
   * 清理旧的 WAL 条目
   */
  private async cleanupOldEntries(): Promise<void> {
    try {
      const keys = await walStorage.keys();
      const walKeys = keys.filter((key) => key.startsWith("wal_"));

      if (walKeys.length <= MAX_WAL_ENTRIES) {
        return;
      }

      // 按时间戳排序，删除最旧的条目
      const entries: Array<{ key: string; timestamp: number }> = [];

      for (const key of walKeys) {
        const logEntry = await walStorage.getItem<WALLogEntry>(key);

        if (logEntry) {
          entries.push({ key, timestamp: logEntry.timestamp });
        }
      }

      entries.sort((a, b) => a.timestamp - b.timestamp);

      // 删除超出数量的旧条目
      const toDelete = entries.slice(0, entries.length - MAX_WAL_ENTRIES);

      for (const entry of toDelete) {
        await walStorage.removeItem(entry.key);
      }

      console.log(`清理了 ${toDelete.length} 个旧 WAL 条目`);
    } catch (error) {
      console.error("清理旧 WAL 条目失败:", error);
    }
  }

  /**
   * 获取所有 WAL 条目（用于调试）
   */
  async getAllEntries(): Promise<WALLogEntry[]> {
    try {
      const keys = await walStorage.keys();
      const walKeys = keys.filter((key) => key.startsWith("wal_"));
      const entries: WALLogEntry[] = [];

      for (const key of walKeys) {
        const logEntry = await walStorage.getItem<WALLogEntry>(key);

        if (logEntry) {
          entries.push(logEntry);
        }
      }

      return entries.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error("获取 WAL 条目失败:", error);

      return [];
    }
  }

  /**
   * 清空所有 WAL 条目（危险操作，仅用于调试）
   */
  async clearAll(): Promise<void> {
    try {
      await walStorage.clear();
      console.log("已清空所有 WAL 条目");
    } catch (error) {
      console.error("清空 WAL 失败:", error);
    }
  }
}
