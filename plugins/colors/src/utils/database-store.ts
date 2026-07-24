/**
 * 数据库注册中心（Pinia Store）
 *
 * 所有已构建的 DatabaseApi 实例存储在这里，
 * 各业务模块通过 getDb() 读取，不再使用模块级全局变量注入。
 */

import { defineStore } from "pinia";
import { ref } from "vue";
import type { DatabaseApi } from "./database";

export const useDatabaseStore = defineStore("database-registry", () => {
  const registry = ref(new Map<string, DatabaseApi<any>>());

  /** 注册一个已构建的数据库 API */
  function setDB(name: string, db: DatabaseApi<any>): void {
    registry.value.set(name, db);
  }

  /** 获取已注册的数据库 API，未注册时抛错 */
  function getDB<T extends Record<string, any>>(name: string): DatabaseApi<T> {
    const db = registry.value.get(name);
    if (!db) {
      throw new Error(
        `[database-store] 数据库 "${name}" 未注册，请确保 migrateAll() 或 build() 已执行`,
      );
    }
    return db as DatabaseApi<T>;
  }

  /** 检查是否已注册 */
  function has(name: string): boolean {
    return registry.value.has(name);
  }

  return { setDB, getDB, has };
});
