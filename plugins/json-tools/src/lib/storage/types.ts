/**
 * 存储系统类型定义
 */

/**
 * 存储操作类型
 */
export type StorageOperationType = "set" | "remove" | "get";

/**
 * 存储操作
 */
export interface StorageOperation {
  type: StorageOperationType;
  key: string;
  value?: any;
}

/**
 * 存储事务
 */
export interface StorageTransaction {
  id: string;
  timestamp: number;
  operations: StorageOperation[];
  status: "pending" | "completed" | "failed";
}

/**
 * 存储选项
 */
export interface StorageOptions {
  immediate?: boolean; // 立即保存，不使用防抖
  retry?: boolean; // 失败时自动重试
  retryCount?: number; // 重试次数
  sync?: boolean; // 多窗口同步
}

/**
 * 版本向量（用于多窗口冲突解决）
 */
export interface VersionVector {
  [windowId: string]: number;
}

/**
 * 带版本的数据
 */
export interface VersionedData<T> {
  data: T;
  version: VersionVector;
  timestamp: number;
  windowId: string;
}

/**
 * 分布式锁
 */
export interface Lock {
  id: string;
  windowId: string;
  timestamp: number;
  ttl: number; // 生存时间（毫秒）
}

/**
 * WAL 日志条目
 */
export interface WALLogEntry {
  transactionId: string;
  timestamp: number;
  operations: StorageOperation[];
  checksum: string;
}

/**
 * 存储监控指标
 */
export interface StorageMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  lastOperationTime: number;
}

/**
 * 重试选项
 */
export interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  backoff?: boolean; // 指数退避
}

/**
 * 多窗口同步消息
 */
export interface SyncMessage {
  type: "update" | "lock" | "unlock" | "conflict";
  key: string;
  data?: any;
  windowId: string;
  timestamp: number;
  version?: VersionVector;
}
