/***********************工作区右侧页签的可用性与回退*********************/

/**
 * 右侧工作区页签。
 *
 * 与 `types.ts` 的 `WorkspaceTab` 字面量一致。
 */
export type WorkspaceTab = 'console' | 'git' | 'editor' | 'files' | 'memo' | 'env';

/** 判定页签可用性所需的能力快照，全部来自 ProjectWorkspace 的 computed */
export interface WorkspaceTabCapabilities {
  /** 当前没有活动叶子项目（项目被删等瞬时空状态） */
  leafTabsDisabled: boolean;
  /** 有可运行的脚本或自定义命令 */
  hasRunnableCommands: boolean;
  /** 当前项目已确认是 Git 仓库 */
  hasGitRepo: boolean;
  /** 有前端环境配置组 */
  hasFrontendEnv: boolean;
  /** 当前面板允许完整编辑器 */
  editorEnabled: boolean;
}

/**
 * 该页签在当前能力下能否渲染。
 *
 * 「命令」入口带 `v-if="hasRunnableCommands"`、「Git」入口带 `v-if="hasGitRepo"`、
 * 「环境」入口带 `v-if="hasFrontendEnv"`，
 * 条件不满足时整个按钮不存在，停在上面等于停在一个看不见的页签上。
 * 「文件」「备忘录」始终可用；没有活动项目时绑定项目的页签受限。
 */
export function isWorkspaceTabAvailable(
  tab: WorkspaceTab,
  capabilities: WorkspaceTabCapabilities,
): boolean {
  // 没有活动叶子时，绑定叶子的三个页签都渲染不出内容
  if (capabilities.leafTabsDisabled && (tab === 'console' || tab === 'git' || tab === 'env' || tab === 'editor')) {
    return false;
  }
  if (tab === 'console') return capabilities.hasRunnableCommands;
  if (tab === 'git') return capabilities.hasGitRepo;
  if (tab === 'env') return capabilities.hasFrontendEnv;
  if (tab === 'editor') return capabilities.editorEnabled;
  return true;
}

/**
 * 页签仍可用时原样返回，不可用时给出回退目标。
 *
 * 这是「当前页签失效该退到哪」的**唯一**判据：切换子项目时用它保住用户已选的页签，
 * 能力变化时也用它做兜底纠正，避免两处各写一份规则而漂移。
 *
 * 回退目标：优先保留命令页，其次是 Git，最后是始终可用的文件页。
 * 没有活动项目时直接回到文件页，避免停留在不可见的绑定页签。
 */
export function resolveWorkspaceTabFallback(
  tab: WorkspaceTab,
  capabilities: WorkspaceTabCapabilities,
): WorkspaceTab {
  if (isWorkspaceTabAvailable(tab, capabilities)) return tab;
  if (capabilities.leafTabsDisabled) return 'files';
  if (capabilities.hasRunnableCommands) return 'console';
  if (capabilities.hasGitRepo) return 'git';
  return 'files';
}
