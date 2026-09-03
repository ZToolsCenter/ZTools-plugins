/**
 * 迁移目录配置表 store（pinia Setup Store，1:1 对应 types/mapping.ts）。
 * ref = 实体表，computed = 只读派生，函数 = CRUD 动作（create / update / remove）。
 *
 * 持久化由 ztoolsPersist 插件自动完成（快照文档 store:mapping）：
 * 创建时自动水合，state 变更后防抖写库；需要手动刷新/落盘用 $hydrate() / $persist()。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { v4 as uuidv4 } from 'uuid';
import type { MappingCreateDTO, MappingQueryDTO, MappingUpdateDTO, MappingVO } from './types/mapping';

export const useMappingStore = defineStore(
  'mapping',
  () => {
    // ────────────── state ──────────────

    /** 配置表全部行 */
    const rows = ref<MappingVO[]>([]);

    // ────────────── getters（只读派生） ──────────────

    /** 行数 */
    const count = computed<number>(() => rows.value.length);

    /** 可释放空间合计（字节） */
    const totalSize = computed<number>(() => rows.value.reduce((sum, row) => sum + row.sizeBytes, 0));

    /** 条件查询（带参，不做缓存） */
    function query(dto: MappingQueryDTO = {}): MappingVO[] {
      return rows.value.filter(
        (row) =>
          (!dto.groupId || row.groupId === dto.groupId) &&
          (!dto.status || row.status === dto.status) &&
          (dto.enabled === undefined || row.enabled === dto.enabled) &&
          (!dto.keyword || row.name.includes(dto.keyword))
      );
    }

    /** 主键查询 */
    function findById(id: string): MappingVO | null {
      return rows.value.find((row) => row.id === id) ?? null;
    }

    // ────────────── actions（只改 state，落库由插件负责） ──────────────

    /** C：新增一行，主键 uuid v4，默认列在此补齐 */
    function create(dto: MappingCreateDTO): MappingVO {
      const created: MappingVO = {
        id: uuidv4(),
        groupId: '',
        exeNames: [],
        cachePatterns: [],
        enabled: true,
        status: 'unknown',
        sizeBytes: 0,
        lastMigratedAt: '',
        lastError: '',
        createdAt: new Date().toISOString(),
        ...dto,
      };
      rows.value = [...rows.value, created];
      return created;
    }

    /** U：按可写白名单列更新 */
    function update(id: string, dto: MappingUpdateDTO): void {
      const index = rows.value.findIndex((row) => row.id === id);
      if (index >= 0) rows.value[index] = { ...rows.value[index], ...dto };
    }

    /** D：删除一行（仅删配置，不动磁盘数据） */
    function remove(id: string): void {
      rows.value = rows.value.filter((row) => row.id !== id);
    }

    return { rows, count, totalSize, query, findById, create, update, remove };
  },
  { persist: { pick: ['rows'] } }
);
