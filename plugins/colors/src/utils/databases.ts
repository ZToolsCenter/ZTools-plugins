/**
 * 数据库统一初始化
 *
 * useDatabaseManager() 返回所有需要的数据和方法，无全局状态：
 *
 *   // setup 顶层调用
 *   const dbs = useDatabaseManager();
 *
 *   onMounted(() => {
 *     if (dbs.needsAction) { ... }
 *     await dbs.migrate();
 *     dbs.buildAndRegister();
 *   });
 *
 * 约定：use* 函数内部顶层调用 useXxx()，
 * 只能在 Vue setup 第一层调用。
 * buildAndRegister() 不调用 use*，只是闭包引用 store，无需 use 前缀。
 */

import { type DatabaseMigrationStatus, type DatabaseBuilder } from "./database";
import { useDatabaseStore } from "./database-store";
import { DBBuilder as favoritesDBBuilder } from "./favorites";

/**
 * 获取数据库构建器列表
 *
 * @returns {DatabaseBuilderEntry<any>[]} 返回包含数据库名称和对应构建函数的对象数组
 */
function databaseBuilders(): DatabaseBuilderEntry<any>[] {
  // ── 创建 builders ──
  return [
    favoritesDBBuilder,
    // 在这里添加更多数据库...
  ];
}
/**
 * 获取所有数据库的名称列表
 *
 * @returns {string[]} 包含所有数据库名称的字符串数组
 */
export function databaseNames(): string[] {
  return databaseBuilders().map((b) => b.name);
}

/** 单个数据库的运行时状态 */
interface DatabaseEntry {
  name: string;
  builder: DatabaseBuilder<any>;
  status: DatabaseMigrationStatus;
  currentVersion: number;
  targetVersion: number;
}

export interface DatabaseBuilderEntry<T extends Record<string, any> = Record<string, any>> {
  name: string;
  builder: () => DatabaseBuilder<T>;
}

/** useDatabaseManager() 返回值 */
export interface DatabaseManager {
  /** 所有数据库条目 */
  entries: DatabaseEntry[];
  /** 是否有数据库需要处理 */
  needsAction: boolean;
  /** 需要处理的数据库列表 */
  pending: DatabaseEntry[];
  /** 执行所有迁移 */
  migrate(): Promise<void>;
  /** 构建所有数据库 API 并注入到 useDatabaseStore */
  buildAndRegister(): void;
  /** 重新检测所有数据库状态（导入后调用） */
  refresh(): void;
}

/** 从 entries 中筛选需要处理的数据库 */
function buildPending(entries: DatabaseEntry[]): DatabaseEntry[] {
  return entries.filter(
    (e) => e.status.status === "needs_migration" || e.status.status === "interrupted",
  );
}

/**
 * 初始化所有数据库（use 函数）
 * 内部顶层调用 useDatabaseStore()，因此必须在 Vue setup 顶层调用
 */
export function useDatabaseManager(): DatabaseManager {
  // ── 顶层调用 Pinia store ──
  const store = useDatabaseStore();

  const entries: DatabaseEntry[] = databaseBuilders().map((item) => {
    // ── 检查状态 + 获取版本号 ──
    let builder = item.builder();
    const info = builder.getVersionInfo();
    return {
      name: item.name,
      status: builder.checkStatus(),
      currentVersion: info.currentVersion,
      targetVersion: info.targetVersion,
      builder,
    };
  });

  let pending = buildPending(entries);

  return {
    entries,
    get needsAction() {
      return pending.length > 0;
    },
    get pending() {
      return pending;
    },

    async migrate() {
      for (const entry of entries) {
        await entry.builder.migrate();
      }
    },

    /** 构建并注册到 store（闭包引用 store，不调用 use*） */
    buildAndRegister() {
      for (const entry of entries) {
        const db = entry.builder.build();
        store.setDB(entry.name, db);
      }
    },

    /** 重新检测所有数据库状态，更新 pending 列表 */
    refresh() {
      for (const entry of entries) {
        const info = entry.builder.getVersionInfo();
        entry.status = entry.builder.checkStatus();
        entry.currentVersion = info.currentVersion;
        entry.targetVersion = info.targetVersion;
      }
      pending = buildPending(entries);
    },
  };
}
