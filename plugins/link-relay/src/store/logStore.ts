/**
 * 操作日志表 store（pinia Setup Store，1:1 对应 types/log.ts）。
 * ref = 实体表，computed = 只读派生，函数 = CRUD 动作（create / clear）。
 *
 * 持久化由 ztoolsPersist 插件自动完成（快照文档 store:log）：
 * 创建时自动水合，state 变更后防抖写库；需要手动刷新/落盘用 $hydrate() / $persist()。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { v4 as uuidv4 } from 'uuid';
import type { LogCreateDTO, LogQueryDTO, LogVO } from './types/log';

/** 日志容量上限，超出丢最旧 */
const LOG_LIMIT = 200;

export const useLogStore = defineStore(
  'log',
  () => {
    // ────────────── state ──────────────

    /** 全部日志（新在前） */
    const items = ref<LogVO[]>([]);

    // ────────────── getters（只读派生） ──────────────

    /** 条数 */
    const count = computed<number>(() => items.value.length);

    /** 最新一条 */
    const latest = computed<LogVO | null>(() => items.value[0] ?? null);

    /** 错误条数 */
    const errorCount = computed<number>(() => items.value.filter((item) => item.level === 'error').length);

    /** 条件查询（带参，不做缓存） */
    function query(dto: LogQueryDTO = {}): LogVO[] {
      return items.value
        .filter(
          (item) =>
            (!dto.resource || item.resource === dto.resource) &&
            (!dto.resourceId || item.resourceId === dto.resourceId) &&
            (!dto.action || item.action === dto.action) &&
            (!dto.level || item.level === dto.level)
        )
        .slice(0, dto.limit ?? LOG_LIMIT);
    }

    // ────────────── actions（只改 state，落库由插件负责） ──────────────

    /** C：追加一条，置顶并裁剪到上限 */
    function create(dto: LogCreateDTO): LogVO {
      // createdAt（展示/落库）与 timestamp（排序/耗时）同源，避免两字段不一致
      const now = new Date();
      const created: LogVO = {
        id: uuidv4(),
        resourceId: '',
        resourceName: '',
        createdAt: now.toISOString(),
        timestamp: now.getTime(),
        ...dto,
      };
      items.value = [created, ...items.value].slice(0, LOG_LIMIT);
      return created;
    }

    /** D：清空整表 */
    function clear(): void {
      items.value = [];
    }

    return { items, count, latest, errorCount, query, create, clear };
  },
  { persist: { pick: ['items'] } }
);
