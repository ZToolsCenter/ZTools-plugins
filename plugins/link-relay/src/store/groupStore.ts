/**
 * 分组表 store（pinia Setup Store，1:1 对应 types/group.ts）。
 * ref = 实体表，computed = 只读派生，函数 = CRUD 动作（create / update / remove）。
 * 分组可为空：不预置任何固定组，主键 uuid v4。
 *
 * 持久化由 ztoolsPersist 插件自动完成（快照文档 store:group）：
 * 创建时自动水合，state 变更后防抖写库；需要手动刷新/落盘用 $hydrate() / $persist()。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { v4 as uuidv4 } from 'uuid';
import type { GroupCreateDTO, GroupQueryDTO, GroupUpdateDTO, GroupVO } from './types/group';

export const useGroupStore = defineStore(
  'group',
  () => {
    // ────────────── state ──────────────

    /** 分组表（可为空） */
    const groups = ref<GroupVO[]>([]);

    // ────────────── getters（只读派生） ──────────────

    /** 分组数 */
    const count = computed<number>(() => groups.value.length);

    /** 启用中的分组（停用组灰显保留，不隐藏） */
    const enabledGroups = computed<GroupVO[]>(() => groups.value.filter((group) => group.enabled));

    /** 条件查询（带参，不做缓存） */
    function query(dto: GroupQueryDTO = {}): GroupVO[] {
      return groups.value.filter(
        (group) => (!dto.name || group.name.includes(dto.name)) && (dto.enabled === undefined || group.enabled === dto.enabled)
      );
    }

    /** 主键查询 */
    function findById(id: string): GroupVO | null {
      return groups.value.find((group) => group.id === id) ?? null;
    }

    // ────────────── actions（只改 state，落库由插件负责） ──────────────

    /** C：新增分组 */
    function create(dto: GroupCreateDTO): GroupVO {
      const created: GroupVO = {
        id: uuidv4(),
        enabled: true,
        createdAt: new Date().toISOString(),
        ...dto,
      };
      groups.value = [...groups.value, created];
      return created;
    }

    /** U：改名 / 整组启停（停用只灰显，不删数据） */
    function update(id: string, dto: GroupUpdateDTO): void {
      const index = groups.value.findIndex((group) => group.id === id);
      if (index >= 0) groups.value[index] = { ...groups.value[index], ...dto };
    }

    /** D：删除分组（组下行的 groupId 会悬空，需上层先置为未分组或级联删行） */
    function remove(id: string): void {
      groups.value = groups.value.filter((group) => group.id !== id);
    }

    return { groups, count, enabledGroups, query, findById, create, update, remove };
  },
  { persist: { pick: ['groups'] } }
);
