import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { WorkspaceNavMemory, WorkspaceTab } from '../types';

/***********************工作区导航记忆*********************/

/**
 * 记住「每个层级最后选中哪个子项目」和「每个叶子最后停在哪个页签」。
 *
 * 只存在内存里（本次运行有效），**不持久化**：
 * 主要价值是「返回列表再进来」「切到别的一级项目再切回」这两种会话内操作，
 * 内存版就够。要跨应用重启就得写盘，而放进 Settings 会连带触发
 * `App.vue` 的 `triggerSave` → 全量重写 data.json（用户的项目资产文件），
 * 代价与收益不成比例；真要做应另开一个独立的 localStorage key。
 *
 * 用 store 而不是 composable：需要被 ProjectWorkspace 读写、被 project store
 * 的 removeProject 清理，必须是单例。
 */
export const useNavMemoryStore = defineStore('navMemory', () => {
  const memory = ref<WorkspaceNavMemory>({
    leafTab: {},
    levelLeaf: {},
  });

  /***********************读*********************/

  /**
   * 取某个叶子最后手动选择的页签。
   * 没有记忆时返回 null，由调用方回落到默认页签——本函数不做可用性校验，
   * 那是 utils/workspaceTabFallback.ts 的职责，只留一份规则。
   */
  function getLeafTab(leafId: string): WorkspaceTab | null {
    return memory.value.leafTab[leafId] ?? null;
  }

  /**
   * 取某个层级最后选中的叶子。
   *
   * @param levelId 层级节点 id
   * @param isUsable 校验回调：项目还在不在、是否仍属于这个层级、是否仍能当叶子
   * @returns 叶子 id；null 表示「选中层级自身」或没有可用记忆
   *
   * 校验失败时顺手删掉这条记忆（惰性自愈）。这是唯一能覆盖
   * 「项目被搬到别的父级」的路径——全仓没有 moveProject，挂不上钩子。
   */
  function getLevelLeaf(levelId: string, isUsable: (leafId: string) => boolean): string | null {
    if (!(levelId in memory.value.levelLeaf)) return null;

    const remembered = memory.value.levelLeaf[levelId];
    // null 是有效记忆：表示用户选的是父项目入口卡
    if (remembered === null) return null;

    if (!isUsable(remembered)) {
      delete memory.value.levelLeaf[levelId];
      return null;
    }
    return remembered;
  }

  /***********************写*********************/

  /**
   * 记住用户**手动**选择的页签。
   *
   * 只在点击页签时调用，不要挂在 `watch(rightTab)` 上：那会把「能力变化后的
   * 兜底纠正」也写进记忆，形成单向棘轮——脚本被删导致 console 被纠成 git 后，
   * 用户把脚本加回来也再也回不到 console。
   */
  function rememberLeafTab(leafId: string, tab: WorkspaceTab): void {
    memory.value.leafTab[leafId] = tab;
  }

  /** 记住某层级选中的叶子；null 表示选中层级自身 */
  function rememberLevelLeaf(levelId: string, leafId: string | null): void {
    memory.value.levelLeaf[levelId] = leafId;
  }

  /***********************清理*********************/

  /**
   * 裁掉已删除项目的记忆。
   * 形状与 stores/usage.ts 的同名函数一致：传存活 id，删其余。
   */
  function cleanupRemovedProjects(activeProjectIds: string[]): void {
    const alive = new Set(activeProjectIds);

    for (const leafId of Object.keys(memory.value.leafTab)) {
      if (!alive.has(leafId)) delete memory.value.leafTab[leafId];
    }
    for (const levelId of Object.keys(memory.value.levelLeaf)) {
      // 层级本身没了，或它记住的叶子没了，都直接丢掉这条
      const remembered = memory.value.levelLeaf[levelId];
      if (!alive.has(levelId) || (remembered !== null && !alive.has(remembered))) {
        delete memory.value.levelLeaf[levelId];
      }
    }
  }

  /** 清空全部记忆 */
  function clearAll(): void {
    memory.value = { leafTab: {}, levelLeaf: {} };
  }

  return {
    memory,
    getLeafTab,
    getLevelLeaf,
    rememberLeafTab,
    rememberLevelLeaf,
    cleanupRemovedProjects,
    clearAll,
  };
});
